'use strict';
/*
 * Trakt-broen (F3).
 *
 * DEN ANBEFALEDE VEJ UD AF SEQUEL: Sequel synkroniserer selv til Trakt, saa
 * hele historikken kan hentes derfra uden en eksportfil.
 *
 * Login sker med DEVICE CODE, ikke med et omdirigeret webflow. Grunden er
 * praktisk: runen koerer bag panelets proxy paa en adresse, Trakt ikke
 * kender, og en redirect_uri, der skal registreres pr. installation, ville
 * betyde, at hver husstand skulle rette i en Trakt-app for at logge ind.
 * Med device code taster man en kode paa trakt.tv, og serveren venter.
 *
 * Svarene oversaettes til SAMME form som shared/import.js producerer, saa
 * matchningen og importjobbet er de samme. Der maa ikke findes to veje ind
 * i historikken.
 */

const https = require('node:https');

const VAERT = 'api.trakt.tv';

class TraktFejl extends Error {
  constructor(besked, status, kode) {
    super(besked);
    this.status = status;
    this.kode = kode || 'trakt_error';
  }
}

function kald(sti, opts) {
  const o = opts || {};
  const krop = o.body ? JSON.stringify(o.body) : null;
  const headers = {
    'content-type': 'application/json',
    'trakt-api-version': '2',
    'user-agent': 'spolen',
  };
  if (o.clientId) headers['trakt-api-key'] = o.clientId;
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (krop) headers['content-length'] = Buffer.byteLength(krop);

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: VAERT, path: sti, method: o.method || 'GET', headers,
    }, (res) => {
      const bidder = [];
      res.on('data', (b) => bidder.push(b));
      res.on('end', () => {
        const raa = Buffer.concat(bidder).toString('utf8');
        let data = null;
        try { data = raa ? JSON.parse(raa) : null; } catch { /* haandteres nedenfor */ }
        resolve({ status: res.statusCode, headers: res.headers, data, raa });
      });
    });
    req.on('error', (e) => reject(new TraktFejl(`Could not reach Trakt: ${e.message}`, 502)));
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new TraktFejl('Trakt did not answer in time.', 504, 'trakt_timeout'));
    });
    if (krop) req.write(krop);
    req.end();
  });
}

/* ------------------------------------------------------------ device code */

/** Trin 1: hent en kode, brugeren skal taste paa trakt.tv. */
async function startLogin(clientId) {
  const r = await kald('/oauth/device/code', { method: 'POST', body: { client_id: clientId } });
  if (r.status !== 200 || !r.data) {
    throw new TraktFejl(
      r.status === 401 || r.status === 403
        ? 'Trakt rejected the client id. Check it under Settings.'
        : `Trakt answered ${r.status}.`,
      502, r.status === 401 || r.status === 403 ? 'trakt_bad_client' : 'trakt_error');
  }
  return {
    deviceCode: r.data.device_code,
    userCode: r.data.user_code,
    url: r.data.verification_url,
    expiresIn: r.data.expires_in,
    // Trakt bestemmer selv, hvor tit der maa spoerges. Respekteres det ikke,
    // svarer de 429 og forlaenger intervallet.
    interval: Math.max(Number(r.data.interval) || 5, 5),
  };
}

/**
 * Trin 2: spoerg om brugeren har godkendt endnu.
 *
 * Statuskoderne ER svaret her, og de betyder noget forskelligt:
 *   400 = venter stadig (den normale tilstand, ikke en fejl)
 *   404 = koden findes ikke   409 = allerede brugt
 *   410 = udloebet            418 = brugeren sagde nej
 *   429 = for hurtigt
 * Behandler man dem alle som "fejl", faar brugeren en fejlbesked, mens han
 * staar og taster koden ind.
 */
async function tjekLogin(clientId, clientSecret, deviceCode) {
  const r = await kald('/oauth/device/token', {
    method: 'POST',
    body: { code: deviceCode, client_id: clientId, client_secret: clientSecret },
  });
  if (r.status === 200 && r.data) {
    return {
      tilstand: 'ok',
      accessToken: r.data.access_token,
      refreshToken: r.data.refresh_token,
      udloeber: Math.floor(Date.now() / 1000) + (Number(r.data.expires_in) || 0),
    };
  }
  if (r.status === 400) return { tilstand: 'venter' };
  if (r.status === 429) return { tilstand: 'for-hurtigt' };
  if (r.status === 418) return { tilstand: 'afvist', besked: 'You denied the request on Trakt.' };
  if (r.status === 410) return { tilstand: 'udloebet', besked: 'The code expired. Start again.' };
  if (r.status === 409) return { tilstand: 'brugt', besked: 'That code was already used.' };
  return { tilstand: 'fejl', besked: `Trakt answered ${r.status}.` };
}

/* ---------------------------------------------------------------- sync */

/**
 * Henter en pagineret liste.
 *
 * Trakt melder sidetallet i X-Pagination-Page-Count. Der er et LOFT paa
 * antal sider: en historik kan vaere titusinder af poster, og et job uden
 * loft kan ikke afsluttes af nogen (§6b).
 */
async function hentSider(sti, clientId, token, opts) {
  const o = opts || {};
  const perSide = o.perSide || 100;
  const maxSider = o.maxSider || 200;
  const ud = [];
  for (let side = 1; side <= maxSider; side++) {
    const skil = sti.includes('?') ? '&' : '?';
    const r = await kald(`${sti}${skil}page=${side}&limit=${perSide}`, { clientId, token });
    if (r.status === 401) {
      throw new TraktFejl('Trakt rejected the login. Connect again.', 502, 'trakt_unauthorised');
    }
    if (r.status === 429) {
      throw new TraktFejl('Trakt is rate limiting us. Try again shortly.', 503, 'trakt_rate_limited');
    }
    if (r.status !== 200 || !Array.isArray(r.data)) {
      throw new TraktFejl(`Trakt answered ${r.status}.`, 502);
    }
    ud.push(...r.data);
    const sider = Number(r.headers['x-pagination-page-count'] || 1);
    if (side >= sider || !r.data.length) break;
    if (o.pause) await o.pause();
  }
  return ud;
}

/* ------------------------------------------------------------ oversaettelse */

/*
 * Trakt -> spolens importform.
 *
 * Den SAMME form som shared/import.js producerer, saa matchningen og
 * importjobbet er faelles. Trakt har rigtige id'er paa alt, saa de her
 * raekker matcher eksakt - modsat en Netflix-fil, der kun har en titel.
 */
function oversaetHistorik(poster) {
  const ud = [];
  for (const p of poster || []) {
    /*
     * En tom post maa ikke vaelte hele oversaettelsen.
     *
     * Uden vagten kaster loekken paa den foerste null, og saa importeres
     * INTET - ikke bare den ene raekke. En historik paa titusinder af poster
     * gaar tabt paa én daarlig post fra API'et.
     */
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'episode' && p.show && p.episode) {
      const ids = (p.show.ids || {});
      ud.push({
        type: 'episode',
        title: p.show.title || '',
        year: p.show.year || null,
        ids: { imdb: ids.imdb || null, tmdb: ids.tmdb || null, tvdb: ids.tvdb || null },
        season: p.episode.season,
        number: p.episode.number,
        watchedAt: p.watched_at ? Math.floor(new Date(p.watched_at).getTime() / 1000) : null,
        rating: null,
        kilde: 'trakt',
      });
    } else if (p.type === 'movie' && p.movie) {
      const ids = (p.movie.ids || {});
      ud.push({
        type: 'movie',
        title: p.movie.title || '',
        year: p.movie.year || null,
        ids: { imdb: ids.imdb || null, tmdb: ids.tmdb || null },
        season: null, number: null,
        watchedAt: p.watched_at ? Math.floor(new Date(p.watched_at).getTime() / 1000) : null,
        rating: null,
        kilde: 'trakt',
      });
    }
  }
  return ud;
}

/** Watchlist -> raekker af typen 'show'/'movie' (en FOELGNING, ikke en visning). */
function oversaetWatchlist(poster) {
  const ud = [];
  for (const p of poster || []) {
    if (!p || typeof p !== 'object') continue;
    const m = p.movie || p.show;
    if (!m) continue;
    const ids = m.ids || {};
    ud.push({
      type: p.show ? 'show' : 'movie',
      title: m.title || '',
      year: m.year || null,
      ids: { imdb: ids.imdb || null, tmdb: ids.tmdb || null, tvdb: ids.tvdb || null },
      season: null, number: null,
      // En watchlist-post er ikke set. Uden dato bliver den ikke til en
      // visning i importjobbet - kun til en foelgning.
      watchedAt: null,
      rating: null,
      kilde: 'trakt',
    });
  }
  return ud;
}

async function hentHistorik(clientId, token, opts) {
  const [afsnit, film] = [
    await hentSider('/sync/history/episodes', clientId, token, opts),
    await hentSider('/sync/history/movies', clientId, token, opts),
  ];
  return oversaetHistorik([...afsnit, ...film]);
}

async function hentWatchlist(clientId, token, opts) {
  return oversaetWatchlist(await hentSider('/sync/watchlist', clientId, token, opts));
}

module.exports = {
  TraktFejl, startLogin, tjekLogin, hentSider,
  oversaetHistorik, oversaetWatchlist, hentHistorik, hentWatchlist,
};
