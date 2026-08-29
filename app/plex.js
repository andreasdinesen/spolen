'use strict';
/*
 * Plex-broen (F5).
 *
 * Plex er den ENESTE af de tjenester, Andreas bruger, der kan fortaelle, hvad
 * der faktisk er set. Netflix og de oevrige har intet offentligt API til
 * afspilningstilstand - dér markerer man selv.
 *
 * DET AFGOERENDE ved Plex er, at serveren udstiller sine egne GUID'er:
 * `imdb://tt1234567`, `tmdb://12345`, `tvdb://999`. Matchningen bliver derfor
 * EKSAKT. En Netflix-fil har kun en titelstreng at gaa efter, og dér gaetter
 * vi; her behoever vi ikke.
 *
 * Forbindelsen gaar til brugerens EGEN Plex-server paa hans eget net - ikke
 * til plex.tv. Derfor er der ingen OAuth: man henter et X-Plex-Token og
 * skriver serverens adresse.
 */

const http = require('node:http');
const https = require('node:https');

class PlexFejl extends Error {
  constructor(besked, status, kode) {
    super(besked);
    this.status = status;
    this.kode = kode || 'plex_error';
  }
}

/**
 * Kalder Plex.
 *
 * `Accept: application/json` er ikke valgfrit: uden den svarer Plex XML, og
 * saa skulle vi have en XML-parser med i en app, hvis hele pointe er nul
 * afhaengigheder.
 */
function kald(baseUrl, token, sti, params) {
  let url;
  try {
    url = new URL(sti, baseUrl);
  } catch {
    return Promise.reject(new PlexFejl('That Plex address is not a valid URL.', 400, 'plex_bad_url'));
  }
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'X-Plex-Token': token,
        'X-Plex-Client-Identifier': 'spolen',
        'X-Plex-Product': 'spolen',
      },
      // En hjemmeserver har tit et selvsigneret certifikat. Vi taler med en
      // maskine paa brugerens eget net, som han selv har peget os paa - og
      // alternativet er, at https slet ikke kan bruges.
      rejectUnauthorized: false,
    }, (res) => {
      const bidder = [];
      res.on('data', (b) => bidder.push(b));
      res.on('end', () => {
        const raa = Buffer.concat(bidder).toString('utf8');
        if (res.statusCode === 401) {
          reject(new PlexFejl('Plex rejected the token. Check it under Settings.',
            502, 'plex_bad_token'));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new PlexFejl(`Plex answered ${res.statusCode}.`, 502));
          return;
        }
        try {
          resolve(JSON.parse(raa));
        } catch {
          // Svarede den XML, er Accept-headeren ikke slaaet igennem - og saa
          // er det vaerd at sige praecis dét frem for "ugyldigt svar".
          reject(new PlexFejl(
            raa.trim().startsWith('<')
              ? 'Plex answered XML, not JSON — is that really a Plex server?'
              : 'Plex sent something that is not JSON.',
            502, 'plex_bad_response'));
        }
      });
    });
    req.on('error', (e) => reject(new PlexFejl(`Could not reach Plex: ${e.message}`, 502)));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new PlexFejl('Plex did not answer in time.', 504, 'plex_timeout'));
    });
    req.end();
  });
}

/** Er der en Plex-server i den anden ende, og vil den tale med os? */
async function tjekForbindelse(baseUrl, token) {
  const r = await kald(baseUrl, token, '/identity');
  const m = r.MediaContainer || {};
  return {
    navn: m.friendlyName || null,
    version: m.version || null,
    maskinId: m.machineIdentifier || null,
  };
}

/** Bibliotekerne paa serveren - film, serier, musik, billeder. */
async function hentBiblioteker(baseUrl, token) {
  const r = await kald(baseUrl, token, '/library/sections');
  return ((r.MediaContainer || {}).Directory || [])
    // Kun film og serier. Musik- og fotobiblioteker hoerer ikke hjemme her,
    // og at hente deres historik ville vaere baade nytteloest og indiskret.
    .filter((d) => d.type === 'movie' || d.type === 'show')
    .map((d) => ({ id: d.key, navn: d.title, slags: d.type }));
}

/** Kontiene paa serveren - så man kan vaelge SIN egen historik, ikke husets. */
async function hentKonti(baseUrl, token) {
  const r = await kald(baseUrl, token, '/accounts');
  return ((r.MediaContainer || {}).Account || [])
    .filter((a) => String(a.id) !== '0')      // id 0 er serveren selv
    .map((a) => ({ id: String(a.id), navn: a.name || '(unnamed)' }));
}

/**
 * Afspilningshistorikken.
 *
 * Sorteret NYEST FOERST og stoppet, saa snart vi naar noget, vi har set foer.
 * En Plex-server kan have aars historik; at hente det hele ved hver polling
 * ville vaere spild i begge ender.
 */
async function hentHistorik(baseUrl, token, opts) {
  const o = opts || {};
  const siden = Number(o.siden) || 0;
  const perSide = 500;
  const maxSider = o.maxSider || 40;
  const ud = [];

  for (let side = 0; side < maxSider; side++) {
    const params = {
      sort: 'viewedAt:desc',
      'X-Plex-Container-Start': side * perSide,
      'X-Plex-Container-Size': perSide,
    };
    if (o.accountId) params.accountID = o.accountId;
    if (o.librarySectionId) params.librarySectionID = o.librarySectionId;

    const r = await kald(baseUrl, token, '/status/sessions/history/all', params);
    const poster = (r.MediaContainer || {}).Metadata || [];
    if (!poster.length) break;

    let naaedeGraensen = false;
    for (const p of poster) {
      if (siden && Number(p.viewedAt) <= siden) { naaedeGraensen = true; break; }
      ud.push(p);
    }
    if (naaedeGraensen) break;
    if (poster.length < perSide) break;
    if (o.pause) await o.pause();
  }
  return ud;
}

/**
 * Henter de eksterne id'er for ét element.
 *
 * Historik-posterne baerer ikke GUID'erne selv - kun en `ratingKey`. Derfor
 * ét ekstra opslag pr. UNIK titel (ikke pr. afsnit): en serie med 60 sete
 * afsnit skal give ét opslag, ikke tres.
 */
async function hentGuids(baseUrl, token, ratingKey) {
  const r = await kald(baseUrl, token, `/library/metadata/${encodeURIComponent(ratingKey)}`);
  const m = ((r.MediaContainer || {}).Metadata || [])[0];
  if (!m) return {};
  const alle = [];
  if (m.guid) alle.push(m.guid);
  for (const g of m.Guid || []) if (g.id) alle.push(g.id);
  return laesGuids(alle);
}

/**
 * Plex' GUID-former -> spolens ids.
 *
 * Der er to slags: de nye `imdb://tt123` fra Guid-listen, og de gamle
 * agent-URI'er som `com.plexapp.agents.thetvdb://73141/1/1?lang=en`. Begge
 * skal kunne laeses - en server, der har koert i aarevis, har begge dele
 * liggende side om side.
 */
function laesGuids(liste) {
  const ud = {};
  for (const raa of liste || []) {
    const s = String(raa);
    let m = /^imdb:\/\/(tt\d+)/.exec(s);
    if (m) { ud.imdb = m[1]; continue; }
    m = /^tmdb:\/\/(\d+)/.exec(s);
    if (m) { ud.tmdb = Number(m[1]); continue; }
    m = /^tvdb:\/\/(\d+)/.exec(s);
    if (m) { ud.tvdb = Number(m[1]); continue; }
    // Gamle agent-URI'er.
    m = /agents\.imdb:\/\/(tt\d+)/.exec(s);
    if (m) { ud.imdb = m[1]; continue; }
    m = /agents\.themoviedb:\/\/(\d+)/.exec(s);
    if (m) { ud.tmdb = Number(m[1]); continue; }
    m = /agents\.thetvdb:\/\/(\d+)/.exec(s);
    if (m) { ud.tvdb = Number(m[1]); continue; }
  }
  return ud;
}

/**
 * Plex-historik -> spolens importform.
 *
 * SAMME form som shared/import.js og trakt.js producerer, saa den faelles
 * importmotor kan tage imod den. `guids` slaas op udenfor og gives ind, saa
 * denne funktion kan proeves uden net.
 *
 * @param {Map} [guids] ratingKey (serie eller film) -> {imdb, tmdb, tvdb}
 */
function oversaetHistorik(poster, guids) {
  const kort = guids || new Map();
  const ud = [];
  for (const p of poster || []) {
    if (!p || typeof p !== 'object') continue;
    const naar = Number(p.viewedAt) || null;

    if (p.type === 'episode') {
      // Seriens noegle er grandparentRatingKey - afsnittets egen duer ikke,
      // for det er SERIEN, vi slaar op i TMDB.
      const serieNoegle = String(p.grandparentRatingKey || '');
      ud.push({
        type: 'episode',
        title: p.grandparentTitle || '',
        year: Number(p.parentYear) || Number(p.year) || null,
        ids: kort.get(serieNoegle) || {},
        // parentIndex er saesonen, index er afsnittet. Mangler de, er posten
        // ubrugelig som afsnit - saa er det bedre at melde den umatchet end
        // at gaette paa saeson 1.
        season: Number.isFinite(Number(p.parentIndex)) ? Number(p.parentIndex) : null,
        number: Number.isFinite(Number(p.index)) ? Number(p.index) : null,
        watchedAt: naar,
        rating: null,
        kilde: 'plex',
      });
      continue;
    }
    if (p.type === 'movie') {
      ud.push({
        type: 'movie',
        title: p.title || '',
        year: Number(p.year) || null,
        ids: kort.get(String(p.ratingKey || '')) || {},
        season: null, number: null,
        watchedAt: naar,
        rating: null,
        kilde: 'plex',
      });
    }
  }
  return ud;
}

/** De ratingKeys, der skal slaas GUID'er op for - unikke, ikke pr. post. */
function noeglerAtSlaaOp(poster) {
  const ud = new Set();
  for (const p of poster || []) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'episode' && p.grandparentRatingKey) ud.add(String(p.grandparentRatingKey));
    else if (p.type === 'movie' && p.ratingKey) ud.add(String(p.ratingKey));
  }
  return [...ud];
}

/* ------------------------------------------------------------ webhook */

/*
 * Plex' webhooks sender multipart/form-data med ét felt, `payload`, der
 * indeholder JSON - og somme tider et miniaturebillede ved siden af.
 *
 * Vi skriver laeseren selv. Den skal kun finde ÉT felt i en krop, vi selv
 * har sat en graense for, og en npm-pakke til multipart ville vaere den
 * foerste afhaengighed i hele projektet.
 *
 * Webhooks kraever Plex Pass. Uden dem henter polling det samme med ti
 * minutters forsinkelse - webhooken er en tilfoejelse, ikke fundamentet.
 */
function laesMultipartFelt(krop, contentType, feltnavn) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType || ''));
  if (!m) return null;
  const graense = `--${(m[1] || m[2]).trim()}`;
  const tekst = krop.toString('utf8');
  for (const del of tekst.split(graense)) {
    // Hoved og krop adskilles af en TOM linje. Findes den ikke, er delen
    // enten afslutningsmarkoeren eller noget, vi ikke skal bruge.
    const skil = del.indexOf('\r\n\r\n');
    if (skil < 0) continue;
    const hoved = del.slice(0, skil);
    if (!new RegExp(`name="${feltnavn}"`, 'i').test(hoved)) continue;
    // Afslut foer den afsluttende CRLF, som hoerer til graensen - ikke til
    // vaerdien.
    return del.slice(skil + 4).replace(/\r\n$/, '');
  }
  return null;
}

/**
 * Plex-webhookens payload -> spolens importform.
 *
 * KUN `media.scrobble` regnes som "set". Plex sender ogsaa play, pause,
 * resume og stop - og at markere noget set, fordi nogen trykkede afspil,
 * ville fylde historikken med ting, der blev slukket efter to minutter.
 * Plex sender selv scrobble ved ~90 % afspillet, og det er den beslutning,
 * vi skal stole paa i stedet for at traeffe den igen.
 */
function oversaetWebhook(payload) {
  if (!payload || payload.event !== 'media.scrobble') return null;
  const m = payload.Metadata;
  if (!m) return null;
  const naar = Math.floor(Date.now() / 1000);
  if (m.type === 'episode') {
    return {
      type: 'episode',
      title: m.grandparentTitle || '',
      year: Number(m.parentYear) || Number(m.year) || null,
      ids: laesGuids([m.grandparentGuid, m.guid].filter(Boolean)),
      season: Number.isFinite(Number(m.parentIndex)) ? Number(m.parentIndex) : null,
      number: Number.isFinite(Number(m.index)) ? Number(m.index) : null,
      watchedAt: naar, rating: null, kilde: 'plex',
      // Hvem saa det - saa serveren kan afvise en webhook for en anden konto.
      konto: (payload.Account && payload.Account.title) || null,
    };
  }
  if (m.type === 'movie') {
    return {
      type: 'movie',
      title: m.title || '',
      year: Number(m.year) || null,
      ids: laesGuids([m.guid].filter(Boolean)),
      season: null, number: null,
      watchedAt: naar, rating: null, kilde: 'plex',
      konto: (payload.Account && payload.Account.title) || null,
    };
  }
  return null;
}

module.exports = {
  PlexFejl, kald, tjekForbindelse, hentBiblioteker, hentKonti,
  hentHistorik, hentGuids, laesGuids, oversaetHistorik, noeglerAtSlaaOp,
  laesMultipartFelt, oversaetWebhook,
};
