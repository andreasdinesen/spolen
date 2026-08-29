
/* -------------------------------------------------------------- import */

/*
 * Importfladen (F3).
 *
 * Tre trin, med vilje adskilt: VÆLG fil -> SE hvad appen forstod -> IMPORTÉR.
 * Mellemtrinnet er hele pointen. En import skriver tusindvis af raekker i
 * historikken, og den eneste chance for at opdage, at datoerne blev laest
 * baglaens, er FOER den koerer.
 */
function importSide() {
  const i = state.import;
  return el('div', {}, [
    el('p', { class: 'dim lille', text:
      'Drop a Trakt export straight from Downloads — the whole .zip, unopened. '
      + 'Also takes Netflix viewing activity, Letterboxd, IMDb and TV Time as '
      + '.csv, .json or .zip. '
      + 'Sequel syncs to Trakt, so a Trakt export is the way out of Sequel.' }),

    dropZone(),

    traktAfsnit(),
    plexAfsnit(),

    i.fejl ? el('p', { class: 'noeglestatus mangler', text: i.fejl }) : null,
    i.analyse ? analyseKort(i.analyse) : null,
    i.status ? importFremdrift(i.status) : null,
  ]);
}

function analyseKort(a) {
  const usikker = !a.dateOrderCertain;
  const ordenValg = el('select', { style: 'font-size:16px' }, [
    el('option', { value: 'dmy', text: 'Day/month/year (3/2 = 3 February)' }),
    el('option', { value: 'mdy', text: 'Month/day/year (3/2 = 2 March)' }),
  ]);
  ordenValg.value = state.import.dateOrder || a.dateOrder;
  ordenValg.addEventListener('change', () => { state.import.dateOrder = ordenValg.value; });

  return el('div', { class: 'card' }, [
    el('h3', { text: a.formatName }),
    state.import.zipNavn
      ? el('p', { class: 'dim lille', text: `From ${state.import.zipNavn}.` })
      : null,
    (a.used && a.used.length > 1)
      ? el('details', {}, [
          el('summary', { text: `${a.used.length} files used`
            + (a.ignored && a.ignored.length ? `, ${a.ignored.length} skipped` : '') }),
          el('div', { class: 'liste' }, a.used.slice(0, 30).map((u) => el('div', { class: 'item-row' }, [
            el('span', { class: 'lille', text: u.navn }),
            el('span', { class: 'dim lille', text: `${u.raekker} rows · ${u.format}` }),
          ]))),
          (a.ignored && a.ignored.length)
            ? el('p', { class: 'dim lille', text:
                'Skipped (not a history format): ' + a.ignored.slice(0, 12).join(', ') })
            : null,
          a.crossFileDuplicates
            ? el('p', { class: 'dim lille', text:
                `${a.crossFileDuplicates} entries appeared in more than one file and were counted once.` })
            : null,
        ])
      : null,
    el('p', { class: 'dim', text:
      `${a.rows} rows — ${a.movies} films, ${a.episodes} episodes, ${a.shows} shows. `
      + `${a.withDates} have a date.`
      + (a.skipped ? ` ${a.skipped} rows could not be read.` : '') }),

    /*
     * Datoernes retning vises ALTID - ogsaa naar appen er sikker. Er den
     * usikker, siges det med rene ord, for 3/2 er tvetydig, og en historik
     * med baglaens datoer er umulig at opdage bagefter.
     */
    el('div', { class: usikker ? 'card advarsel' : '' }, [
      el('p', { class: 'lille', text: usikker
        ? 'Every date in this file is ambiguous (all numbers are 12 or lower), '
          + 'so spolen cannot tell which way round they are. Check this before importing.'
        : 'The file itself shows which way the dates run.' }),
      el('div', { class: 'formgrid' }, [
        el('label', { text: 'Dates are' }), ordenValg,
      ]),
    ]),

    el('h4', { text: 'First rows, as spolen understood them' }),
    el('div', { class: 'liste' }, (a.sample || []).map((r) => el('div', { class: 'item-row' }, [
      el('span', { class: 'afsnitsmaerke', text: r.type }),
      el('span', { text: r.title + (r.year ? ` (${r.year})` : '')
        + (r.season ? ` · S${r.season}` : '') + (r.episodeName ? ` · ${r.episodeName}` : '') }),
      el('span', { class: 'dim lille', text: r.watchedAt
        ? new Date(r.watchedAt * 1000).toISOString().slice(0, 10) : 'no date' }),
    ]))),

    el('div', { class: 'knaprad' }, [
      el('button', { class: 'btn primary', text: `Import ${a.rows} rows`,
        onclick: (e) => startImport(e.target) }),
      el('button', { class: 'btn ghost', text: 'Cancel',
        onclick: () => { state.import = tomImport(); tegnSide(); } }),
    ]),
  ]);
}

function importFremdrift(s) {
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  return el('div', { class: 'card' }, [
    el('h3', { text: s.running ? 'Importing…' : 'Import finished' }),
    el('div', { class: 'fremdrift' }, [el('i', { style: `width:${pct}%` })]),
    el('p', { class: 'dim lille', text:
      `${s.done} of ${s.total} rows · ${s.added} watches added`
      + (s.duplicates ? `, ${s.duplicates} already there` : '')
      + (s.newTitles ? ` · ${s.newTitles} new titles fetched` : '') }),
    s.running
      ? el('button', { class: 'btn ghost lille', text: 'Stop',
          onclick: () => api('/import/stop', { method: 'POST' }) })
      : null,
    (s.errors && s.errors.length)
      ? el('p', { class: 'dim lille', text: 'Errors: ' + s.errors.join(' · ') }) : null,
    (s.unmatchedTotal)
      ? el('details', {}, [
          el('summary', { text: `${s.unmatchedTotal} rows could not be matched` }),
          el('p', { class: 'dim lille', text:
            'These are usually titles TMDB does not have, or episodes named differently '
            + 'than in the export. Nothing was written for them.' }),
          el('div', { class: 'liste' }, (s.unmatched || []).map((u) => el('div', { class: 'item-row' }, [
            el('span', { text: `${u.titel || '?'}${u.season ? ` S${u.season}` : ''}`
              + `${u.number ? `E${u.number}` : ''}` }),
            el('span', { class: 'dim lille', text: u.grund }),
          ]))),
        ])
      : null,
  ]);
}

function tomImport() {
  return { tekst: '', filer: null, analyse: null, status: null, fejl: '',
    dateOrder: null, zipNavn: null, overZonen: false };
}

async function laesImportFil(fil) {
  if (!fil) return;
  state.import = tomImport();
  tegnSide();
  try {
    // Filen laeses i BROWSEREN og sendes som tekst. Serveren parser den med
    // det SAMME modul, saa der ikke findes to tolkninger af den samme fil.
    let tekst;
    if (/\.zip$/i.test(fil.name) || fil.type === 'application/zip') {
      /*
       * En eksport er ikke ÉN fil.
       *
       * Trakts historik er delt over watched-history-1..17.json, og
       * watchlist og bedoemmelser ligger for sig. Foerste udgave valgte
       * "den stoerste genkendte fil" - det ville have importeret en
       * syttendedel af historikken og set vellykket ud.
       *
       * Zip'en pakkes ud i BROWSEREN, og alle laesbare filer sendes til
       * serveren, som afgoer hvilke der er brugbare. Resten (profiler,
       * indstillinger, kommentarer) genkendes ikke og springes over.
       */
      const filer = await zipFindFiler(await fil.arrayBuffer());
      if (!filer.length) {
        state.import.fejl = 'No .csv or .json files inside that zip.';
        tegnSide();
        return;
      }
      const samlet = filer.reduce((n, f) => n + f.tekst.length, 0);
      // Under serverens 48 MB med god margen: JSON-indpakningen goer
      // teksten ~15 % stoerre paa traaden.
      if (samlet > 30 * 1024 * 1024) {
        state.import.fejl = 'That export unpacks to more than 30 MB — too big to import in one go.';
        tegnSide();
        return;
      }
      try {
        const a = await api('/import/analyse', { method: 'POST', body: { files: filer } });
        state.import.filer = filer;
        state.import.analyse = a;
        state.import.dateOrder = a.dateOrder;
        state.import.zipNavn = `${fil.name} (${filer.length} files inside)`;
      } catch (err) {
        state.import.fejl = err.message;
      }
      tegnSide();
      return;
    }
    tekst = await fil.text();
    if (tekst.length > 20 * 1024 * 1024) {
      state.import.fejl = 'That file is larger than 20 MB.';
      tegnSide();
      return;
    }
    state.import.tekst = tekst;
    const a = await api('/import/analyse', { method: 'POST', body: { text: tekst } });
    state.import.analyse = a;
    state.import.dateOrder = a.dateOrder;
  } catch (err) {
    state.import.fejl = err.message;
  }
  tegnSide();
}

async function startImport(knap) {
  knap.disabled = true;
  try {
    state.import.status = await api('/import/start', { method: 'POST', body: {
      text: state.import.tekst || undefined,
      files: state.import.filer || undefined,
      options: { dateOrder: state.import.dateOrder },
    } });
    // Teksten slippes med det samme - en historik paa mange megabyte skal
    // ikke ligge i browserens hukommelse, mens jobbet koerer paa serveren.
    state.import.tekst = '';
    state.import.filer = null;
    state.import.analyse = null;
    tegnSide();
    poll();
  } catch (err) {
    knap.disabled = false;
    toast(err.message, 'fejl');
  }
}

/*
 * Poller hvert 2. sekund, mens jobbet koerer.
 *
 * Jobbet lever paa serveren, saa lukker man fanen, koerer importen videre -
 * og status kan hentes igen, naar man kommer tilbage.
 */
async function poll() {
  try {
    const s = await api('/import');
    state.import.status = s;
    if (state.view === 'settings') tegnSide();
    if (s.running) setTimeout(poll, 2000);
    else await Promise.all([hentUpNext(), hentBibliotek()]);
  } catch { /* en afbrudt polling er ikke vaerd at larme om */ }
}


/* --------------------------------------------------------------- zip */

/*
 * Zip-laeser til GDPR-eksporter (TV Time, Netflix, Letterboxd).
 *
 * Skrevet selv, fordi browseren allerede har det svaere: DecompressionStream
 * kan 'deflate-raw', som er praecis det, en zip bruger. Tilbage er kun at
 * finde ud af, HVOR i filen hver post begynder - og det er en veldokumenteret
 * struktur, ikke en gaette-leg.
 *
 * Vi laeser den CENTRALE mappe bagfra (den er sandheden om, hvad arkivet
 * indeholder) og bruger den til at finde hver posts lokale hoved. At scanne
 * forfra efter lokale hoveder virker paa simple arkiver og fejler paa dem,
 * der er skrevet i stroem - dér staar stoerrelsen foerst EFTER dataene.
 */
const ZIP_EOCD = 0x06054b50;   // End of central directory
const ZIP_CEN = 0x02014b50;    // Central directory header
const ZIP_LOC = 0x04034b50;    // Local file header

function zipPoster(buf) {
  const dv = new DataView(buf);
  // EOCD ligger til sidst, men kan have en kommentar efter sig. Soeg bagfra.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 22 - 65536; i--) {
    if (dv.getUint32(i, true) === ZIP_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That does not look like a zip file.');

  const antal = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);      // start paa den centrale mappe
  const ud = [];
  for (let i = 0; i < antal; i++) {
    if (dv.getUint32(p, true) !== ZIP_CEN) break;
    const metode = dv.getUint16(p + 10, true);
    const komp = dv.getUint32(p + 20, true);
    const navnLen = dv.getUint16(p + 28, true);
    const ekstraLen = dv.getUint16(p + 30, true);
    const kommentarLen = dv.getUint16(p + 32, true);
    const lokal = dv.getUint32(p + 42, true);
    const navn = new TextDecoder().decode(new Uint8Array(buf, p + 46, navnLen));
    ud.push({ navn, metode, komp, lokal });
    p += 46 + navnLen + ekstraLen + kommentarLen;
  }
  return ud;
}

/**
 * Pakker ÉN post ud som tekst.
 *
 * Datastarten kan kun beregnes fra det LOKALE hoved: dets navne- og
 * ekstra-felter har andre laengder end den centrale mappes, og bruger man
 * mappens tal, lander man et par bytes forkert - og saa fejler
 * dekomprimeringen med noget, der ikke ligner aarsagen.
 */
async function zipUdpak(buf, post) {
  const dv = new DataView(buf);
  if (dv.getUint32(post.lokal, true) !== ZIP_LOC) throw new Error('Broken zip entry.');
  const navnLen = dv.getUint16(post.lokal + 26, true);
  const ekstraLen = dv.getUint16(post.lokal + 28, true);
  const start = post.lokal + 30 + navnLen + ekstraLen;
  const raa = new Uint8Array(buf, start, post.komp);

  if (post.metode === 0) return new TextDecoder().decode(raa);   // gemt uden komprimering
  if (post.metode !== 8) throw new Error(`Unsupported compression in ${post.navn}.`);

  const stroem = new Blob([raa]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stroem).text();
}

/**
 * Finder de CSV-filer i arkivet, der ligner en historik.
 *
 * En GDPR-eksport indeholder alt muligt - profiler, enheder, betalinger.
 * Vi kigger kun paa .csv og lader FORMATGENKENDELSEN afgoere, om filen er
 * brugbar: at gaette paa filnavne ville betyde, at eksporten kun virker,
 * saa laenge tjenesten ikke omdoeber noget.
 */
async function zipFindFiler(buf) {
  const poster = zipPoster(buf).filter((p) =>
    /\.(csv|json)$/i.test(p.navn) && !p.navn.endsWith('/') && p.komp > 0
    // __MACOSX er de ressourcegafler, macOS lægger i et zip-arkiv. De ligner
    // rigtige filer og indeholder ingenting.
    && !p.navn.startsWith('__MACOSX/'));
  const ud = [];
  // 120: en Trakt-eksport har ~75 filer, en GDPR-eksport kan have flere.
  // Loftet er der, saa et fjendtligt arkiv ikke kan pakke browseren ned.
  for (const p of poster.slice(0, 120)) {
    try {
      ud.push({ navn: p.navn, tekst: await zipUdpak(buf, p) });
    } catch { /* en ulaeselig post springes over - resten er stadig brugbar */ }
  }
  return ud;
}

/* ------------------------------------------------- trakt-appens noegler */

/*
 * Client id og secret for den Trakt-APP, hele installationen bruger.
 *
 * De MANGLEDE helt i foerste udgave: fejlbeskeden sagde "an administrator
 * adds one under Settings", men der var intet felt at tilfoeje dem i, saa
 * beskeden pegede paa det sted, brugeren allerede stod (Andreas, 2026-08-29).
 *
 * Adskilt fra selve forbindelsen nedenfor: app-noeglerne er husets, mens
 * LOGINET er personligt - to i huset har hver sin Trakt-konto.
 */
function traktAppAfsnit() {
  const sat = state.delte && state.delte.trakt_client_id;
  const idFelt = el('input', {
    type: 'text', spellcheck: 'false', style: 'font-size:16px',
    value: sat || '',
    placeholder: 'Client ID from trakt.tv',
  });
  const hemFelt = el('input', {
    type: 'password', autocomplete: 'off', spellcheck: 'false', style: 'font-size:16px',
    placeholder: sat ? 'A secret is saved — paste a new one to replace it' : 'Client Secret',
  });

  return el('div', {}, [
    el('p', { class: 'dim lille', text:
      'Register an app on trakt.tv once, for the whole household. '
      + 'This needs a Trakt VIP membership — Trakt gated API applications behind it. '
      + 'Press ? above for the steps and for what to do without VIP.' }),
    el('div', { class: 'formgrid' }, [
      el('label', { text: 'Client ID' }), idFelt,
      el('label', { text: 'Client Secret' }), hemFelt,
      el('button', { class: 'btn primary', text: sat ? 'Replace' : 'Save', onclick: async (e) => {
        const krop = {};
        if (idFelt.value.trim()) krop.trakt_client_id = idFelt.value.trim();
        if (hemFelt.value.trim()) krop.trakt_client_secret = hemFelt.value.trim();
        if (!Object.keys(krop).length) { toast('Fill in at least one field.', 'fejl'); return; }
        e.target.disabled = true;
        try {
          await api('/admin/settings', { method: 'PUT', body: krop });
          // Hemmeligheden slippes fra hukommelsen, saa snart den er gemt.
          hemFelt.value = '';
          await hentSettings();
          tegnSide();
          toast('Saved. You can connect Trakt now.');
        } catch (err) { toast(err.message, 'fejl'); }
        e.target.disabled = false;
      } }),
    ]),
    sat
      ? el('p', { class: 'noeglestatus har', text: 'A Trakt application is configured.' })
      : el('p', { class: 'noeglestatus mangler', text: 'No Trakt application yet.' }),
  ]);
}

/* ---------------------------------------------------------- trakt-broen */

/*
 * Trakt-forbindelsen.
 *
 * Device code: brugeren faar en kode, taster den paa trakt.tv, og fladen
 * spoerger imens serveren, om den er godkendt. Der er ingen omdirigering -
 * runen ligger paa en adresse, Trakt ikke kender.
 */
let traktPoll = null;

function traktAfsnit() {
  const t = state.trakt;
  const forbundet = state.config && state.config.traktLinked;

  return el('div', {}, [
    afsnitshoved('Trakt', 'trakt', 'h3'),
    hjaelpePanel('trakt'),
    el('p', { class: 'dim lille', text:
      'Sequel syncs to Trakt. Note that Trakt now requires a paid VIP membership to '
      + 'create an API application — without it, use an export file instead. '
      + 'Press ? for the details.' }),

    t.kode ? traktKode(t) : null,

    !t.kode && forbundet
      ? el('div', {}, [
          el('p', { class: 'noeglestatus har', text: 'Your Trakt account is connected.' }),
          el('div', { class: 'knaprad' }, [
            el('button', { class: 'btn primary', text: 'Import from Trakt now',
              onclick: (e) => importerFraTrakt(e.target) }),
            el('button', { class: 'btn ghost', text: 'Disconnect', onclick: async () => {
              await api('/trakt', { method: 'DELETE' });
              state.config.traktLinked = false;
              tegnSide();
            } }),
          ]),
        ])
      : null,

    !t.kode && !forbundet
      ? el('button', { class: 'btn primary', text: 'Connect Trakt', onclick: (e) => forbindTrakt(e.target) })
      : null,

    t.fejl ? el('p', { class: 'noeglestatus mangler', text: t.fejl }) : null,
  ]);
}

function traktKode(t) {
  return el('div', { class: 'card' }, [
    el('p', { text: 'Open this address and type the code:' }),
    el('p', { class: 'traktadresse', text: t.url }),
    // Koden staar stort og med afstand mellem tegnene - den skal laeses fra
    // en skaerm og tastes paa en anden, tit paa en telefon.
    el('p', { class: 'traktkode', text: t.kode }),
    el('p', { class: 'dim lille', text: t.besked || 'Waiting for you to approve it on Trakt…' }),
    el('button', { class: 'btn ghost lille', text: 'Cancel', onclick: () => {
      clearTimeout(traktPoll);
      state.trakt = { kode: null, url: '', fejl: '', besked: '' };
      tegnSide();
    } }),
  ]);
}

async function forbindTrakt(knap) {
  knap.disabled = true;
  state.trakt.fejl = '';
  try {
    const r = await api('/trakt/connect', { method: 'POST' });
    state.trakt = { kode: r.userCode, url: r.url, fejl: '', besked: '' };
    tegnSide();
    // Trakt bestemmer selv intervallet. Spoerger man hurtigere, svarer de
    // 429 og forlaenger det.
    traktPoll = setTimeout(() => tjekTrakt(Math.max(r.interval || 5, 5)), (r.interval || 5) * 1000);
  } catch (err) {
    knap.disabled = false;
    state.trakt.fejl = err.message;
    tegnSide();
  }
}

async function tjekTrakt(interval) {
  try {
    const r = await api('/trakt/check', { method: 'POST' });
    if (r.state === 'ok') {
      state.trakt = { kode: null, url: '', fejl: '', besked: '' };
      state.config.traktLinked = true;
      toast('Trakt connected.');
      tegnSide();
      return;
    }
    if (r.state === 'venter') {
      traktPoll = setTimeout(() => tjekTrakt(interval), interval * 1000);
      return;
    }
    if (r.state === 'for-hurtigt') {
      // Trakt bad os sagtne farten - saa goer vi det, i stedet for at
      // fortsaette og blive afvist.
      traktPoll = setTimeout(() => tjekTrakt(interval + 2), (interval + 2) * 1000);
      return;
    }
    state.trakt = { kode: null, url: '', fejl: r.message || 'Trakt login failed.', besked: '' };
    tegnSide();
  } catch (err) {
    state.trakt = { kode: null, url: '', fejl: err.message, besked: '' };
    tegnSide();
  }
}

async function importerFraTrakt(knap) {
  knap.disabled = true;
  knap.textContent = 'Fetching from Trakt…';
  try {
    state.import.status = await api('/trakt/import', { method: 'POST', body: { watchlist: true } });
    tegnSide();
    poll();
  } catch (err) {
    knap.disabled = false;
    knap.textContent = 'Import from Trakt now';
    toast(err.message, 'fejl');
  }
}

/* ------------------------------------------------------------ plex-broen */

/*
 * Forbindelsen til brugerens EGEN Plex-server.
 *
 * Ingen OAuth: man peger paa en maskine paa sit eget net og giver et token.
 * Derfor er "afproev"-knappen vigtigere her end andre steder - en forkert
 * adresse giver ellers bare tavshed.
 */
function plexAfsnit() {
  const p = state.plex;
  const forbundet = state.config && state.config.plexLinked;

  const tokenFelt = el('input', {
    type: 'password', autocomplete: 'off', spellcheck: 'false', style: 'font-size:16px',
    placeholder: forbundet ? 'A token is saved — paste a new one to replace it' : 'X-Plex-Token',
    oninput: (e) => { state.plex.token = e.target.value; },
  });

  return el('div', {}, [
    el('p', { class: 'dim lille', text:
      'Plex is the only service that can tell spolen what you actually watched. '
      + 'Everything it finds is matched on Plex’s own ids, so it is exact — not guesswork.' }),

    /*
     * ÉT felt: kontoens token. Ikke en serveradresse.
     *
     * Bruger man app.plex.tv til at se film, der er DELT med én, findes der
     * ingen adresse at skrive - serveren staar hos en anden, og dens adresse
     * skifter (Andreas, 2026-08-29). plex.tv kender baade adressen og det
     * token, netop den server vil acceptere, saa vi spoerger den i stedet.
     */
    el('div', { class: 'formgrid' }, [
      // "?"-knappen sidder ved selve FELTET, ikke ved overskriften: det er
      // her, man staar og ikke ved, hvor token'et findes.
      el('label', { class: 'medhjaelp' }, ['Plex account token', hjaelpeKnap('plexToken')]),
      tokenFelt,
      el('button', { class: 'btn primary', text: 'Find my servers',
        onclick: (e) => findServere(e.target) }),
    ]),
    hjaelpePanel('plexToken'),

    p.fejl ? el('p', { class: 'noeglestatus mangler', text: p.fejl }) : null,
    p.servere ? serverListe(p.servere) : null,

    /*
     * Den MANUELLE vej beholdes.
     *
     * Opdagelsen via plex.tv er den rigtige for de fleste - og den eneste,
     * der virker, naar serveren er delt med én. Men koerer man selv en
     * server paa samme net, er en adresse hurtigere og virker uden at
     * spoerge plex.tv om noget (Andreas, 2026-08-29).
     */
    el('details', { class: 'manuel-plex' }, [
      el('summary', { text: 'I run my own server and know its address' }),
      manuelPlexAfsnit(),
    ]),

    forbundet
      ? el('div', {}, [
          el('p', { class: 'noeglestatus har', text:
            'Connected. spolen checks for new plays every 10 minutes.' }),
          p.svar && p.svar.accounts && p.svar.accounts.length > 1 ? kontoValg(p.svar.accounts) : null,
          plexWebhookAfsnit(),
          el('div', { class: 'knaprad' }, [
            el('button', { class: 'btn primary', text: 'Import everything from Plex',
              onclick: (e) => importerFraPlex(e.target, true) }),
            el('button', { class: 'btn ghost', text: 'Fetch new plays now',
              onclick: (e) => importerFraPlex(e.target, false) }),
            el('button', { class: 'btn ghost', text: 'Disconnect', onclick: async () => {
              await api('/plex', { method: 'DELETE' });
              state.config.plexLinked = false;
              state.plex = { url: '', token: '', accountId: '', svar: null, fejl: '',
                webhook: null, servere: null };
              tegnSide();
            } }),
          ]),
        ])
      : null,
  ]);
}

/*
 * Serverne, som de FAKTISK kunne naas - ikke som plex.tv siger de findes.
 *
 * En hjemmeserver kan vaere slukket, og en lokal adresse virker kun fra
 * samme net. At vise en uopnaaelig server som et valg ville betyde, at
 * fejlen foerst dukker op ved den foerste hentning.
 */
function serverListe(servere) {
  if (!servere.length) {
    return el('p', { class: 'dim', text:
      'That token works, but the account has access to no Plex servers.' });
  }
  return el('div', {}, [
    el('h4', { text: 'Servers this account can reach' }),
    el('div', { class: 'liste' }, servere.map((srv) => el('div', { class: 'item-row' }, [
      el('div', { class: 'omni-row-main' }, [
        el('div', { class: 'omni-row-title', text: srv.navn }),
        el('div', { class: 'omni-row-sub', text: [
          srv.ejer ? 'your own server' : `shared${srv.ejerNavn ? ` by ${srv.ejerNavn}` : ''}`,
          srv.naaet ? `reachable (${srv.vej})` : 'could not be reached',
          srv.version ? `Plex ${srv.version}` : null,
        ].filter(Boolean).join(' · ') }),
      ]),
      srv.naaet
        ? el('button', { class: 'btn primary lille', text: 'Use this one',
            onclick: (e) => vaelgServer(srv, e.target) })
        : el('span', { class: 'dim lille', text: 'offline?' }),
    ]))),
    el('p', { class: 'dim lille', text:
      'A server shared with you may or may not let spolen read your watch history — '
      + 'that is the owner’s setting, and you find out when you import.' }),
  ]);
}

/*
 * Hvis historik? Kun relevant naar serveren har flere konti.
 *
 * Uden valget henter spolen HELE serverens historik, ogsaa de andres - og
 * det er ikke stoej, men andres seervaner i din historik.
 */
function kontoValg(konti) {
  const vaelg = el('select', { style: 'font-size:16px' }, [
    el('option', { value: '', text: 'Everyone on the server' }),
    ...konti.map((a) => el('option', { value: a.id, text: a.navn })),
  ]);
  vaelg.value = state.plex.accountId || '';
  return el('div', { class: 'formgrid' }, [
    el('label', { text: 'Whose history' }), vaelg,
    el('button', { class: 'btn ghost', text: 'Save', onclick: async (e) => {
      e.target.disabled = true;
      try {
        await api('/plex/test', { method: 'POST', body: { save: true, accountId: vaelg.value } });
        state.plex.accountId = vaelg.value;
        toast('Saved.');
      } catch (err) { toast(err.message, 'fejl'); }
      e.target.disabled = false;
    } }),
  ]);
}

async function findServere(knap) {
  knap.disabled = true;
  const gammel = knap.textContent;
  knap.textContent = 'Asking plex.tv…';
  state.plex.fejl = '';
  try {
    const r = await api('/plex/discover', { method: 'POST', body: {
      token: state.plex.token, save: true,
    } });
    state.plex.servere = r.servers || [];
    state.plex.token = '';       // slippes, saa snart den er gemt server-side
  } catch (err) {
    state.plex.servere = null;
    state.plex.fejl = err.message;
  }
  knap.disabled = false;
  knap.textContent = gammel;
  tegnSide();
}

async function vaelgServer(srv, knap) {
  knap.disabled = true;
  knap.textContent = 'Connecting…';
  try {
    const r = await api('/plex/select', { method: 'POST', body: { serverId: srv.id } });
    state.config.plexLinked = true;
    state.plex.svar = { server: srv.navn, accounts: r.accounts || [] };
    state.plex.servere = null;
    await hentPlexWebhook();
    tegnSide();
    toast(`Connected to ${srv.navn}.`);
  } catch (err) {
    knap.disabled = false;
    knap.textContent = 'Use this one';
    toast(err.message, 'fejl');
  }
}

/* Beholdt: den gamle manuelle proeve bruger den stadig. */
function plexSvar(s) {
  return el('div', { class: 'card' }, [
    el('p', { text: `Reached ${s.server || 'the server'}${s.version ? ` (Plex ${s.version})` : ''}.` }),
    s.libraries && s.libraries.length
      ? el('p', { class: 'dim lille', text:
          'Libraries: ' + s.libraries.map((b) => `${b.navn} (${b.slags})`).join(', ') })
      : null,
    /*
     * Kontovalget betyder noget i en husstand: uden det henter spolen HELE
     * serverens historik, ogsaa de andres. Det er ikke bare stoej - det er
     * andres seervaner i din historik.
     */
    s.accounts && s.accounts.length > 1
      ? el('div', { class: 'formgrid' }, [
          el('label', { text: 'Your Plex account' }),
          el('select', {
            style: 'font-size:16px',
            onchange: (e) => { state.plex.accountId = e.target.value; },
          }, [
            el('option', { value: '', text: 'Everyone on the server' }),
            ...s.accounts.map((a) => el('option', { value: a.id, text: a.navn })),
          ]),
        ])
      : null,
    s.saved ? el('p', { class: 'noeglestatus har', text: 'Saved.' }) : null,
  ]);
}

async function proevPlex(knap, gem) {
  knap.disabled = true;
  const gammel = knap.textContent;
  knap.textContent = 'Testing…';
  state.plex.fejl = '';
  try {
    const svar = await api('/plex/test', { method: 'POST', body: {
      url: state.plex.url, token: state.plex.token,
      save: !!gem, accountId: state.plex.accountId || undefined,
    } });
    state.plex.svar = svar;
    if (gem) {
      state.config.plexLinked = true;
      // Tokenet slippes fra hukommelsen, saa snart det er gemt server-side.
      state.plex.token = '';
      toast('Plex connected.');
    }
  } catch (err) {
    state.plex.svar = null;
    state.plex.fejl = err.message;
  }
  knap.disabled = false;
  knap.textContent = gammel;
  tegnSide();
}

async function importerFraPlex(knap, alt) {
  knap.disabled = true;
  const gammel = knap.textContent;
  knap.textContent = 'Fetching from Plex…';
  try {
    state.import.status = await api('/plex/import', { method: 'POST', body: { all: !!alt } });
    tegnSide();
    poll();
  } catch (err) {
    knap.disabled = false;
    knap.textContent = gammel;
    toast(err.message, 'fejl');
  }
}


/* ---------------------------------------------------------- plex-webhook */

/*
 * Webhooken er en TILFOEJELSE, ikke fundamentet.
 *
 * Polling henter det samme med op til ti minutters forsinkelse. Webhooken
 * goer det oejeblikkeligt - men den kraever Plex Pass, og adressen skal kunne
 * naas FRA Plex-serveren. Begge dele staar i teksten, saa man ikke bruger en
 * aften paa at finde ud af, at man ikke har Plex Pass.
 */
function plexWebhookAfsnit() {
  const p = state.plex;
  const fuld = p.webhook ? location.origin + p.webhook : '';
  const felt = el('input', { readonly: true, value: fuld, style: 'font-size:16px',
    onclick: (e) => e.target.select() });

  return el('div', { class: 'webhookboks' }, [
    el('h4', { text: 'Instant updates (optional)' }),
    el('p', { class: 'dim lille', text:
      'Plex can tell spolen the moment something finishes, instead of waiting for the '
      + 'next check. It needs Plex Pass — without it the field exists but Plex never '
      + 'sends anything.' }),
    p.webhook
      ? el('div', {}, [
          el('div', { class: 'formgrid' }, [
            el('label', { text: 'Webhook address' }), felt,
            el('button', { class: 'btn ghost', text: 'Copy', onclick: async () => {
              try { await navigator.clipboard.writeText(fuld); toast('Copied.'); }
              catch { felt.select(); toast('Selected — press Cmd/Ctrl+C.', 'fejl'); }
            } }),
          ]),
          el('p', { class: 'dim lille', text:
            'Paste it under Plex → Settings → Webhooks. Your Plex server has to be able '
            + 'to reach this address — if spolen is only on your own network, so is Plex.' }),
          el('p', { class: 'dim lille', text:
            'Anyone with this address can add entries to your history, so treat it like '
            + 'a password.' }),
          el('button', { class: 'btn ghost lille', text: 'Revoke address', onclick: async () => {
            const svar = await spoerg('Revoke the webhook address?',
              'Plex stops being able to report plays instantly. The 10-minute check keeps working.',
              [{ id: 'ja', text: 'Revoke', primary: true }, { id: 'nej', text: 'Cancel' }]);
            if (svar !== 'ja') return;
            await api('/plex/webhook', { method: 'DELETE' });
            state.plex.webhook = null;
            tegnSide();
          } }),
        ])
      : el('button', { class: 'btn ghost', text: 'Create webhook address', onclick: async (e) => {
          e.target.disabled = true;
          try {
            const r = await api('/plex/webhook', { method: 'POST' });
            state.plex.webhook = r.path;
            tegnSide();
          } catch (err) { e.target.disabled = false; toast(err.message, 'fejl'); }
        } }),
  ]);
}

async function hentPlexWebhook() {
  try { state.plex.webhook = (await api('/plex/webhook')).path; }
  catch { state.plex.webhook = null; }
}


/* --------------------------------------------------- plex, manuel vej */

/*
 * Adresse + token, skrevet i haanden.
 *
 * For dem, der selv koerer en Plex-server og kender dens adresse. Vejen
 * gaar UDEN OM plex.tv, saa den virker ogsaa paa et net uden internet -
 * og den er hurtigere, naar man ved hvad man laver.
 */
function manuelPlexAfsnit() {
  const p = state.plex;
  const urlFelt = el('input', {
    type: 'text', placeholder: 'http://192.168.1.50:32400', spellcheck: 'false',
    value: p.url || '', style: 'font-size:16px',
    oninput: (e) => { state.plex.url = e.target.value; },
  });
  const tokenFelt = el('input', {
    type: 'password', autocomplete: 'off', spellcheck: 'false', style: 'font-size:16px',
    placeholder: 'X-Plex-Token for that server',
    oninput: (e) => { state.plex.manuelToken = e.target.value; },
  });

  return el('div', {}, [
    el('p', { class: 'dim lille', text:
      'Only works if spolen can reach that address — the same network, or a port '
      + 'that is open to it. A server shared with you will not have one.' }),
    el('div', { class: 'formgrid' }, [
      el('label', { text: 'Server address' }), urlFelt,
      el('label', { text: 'Token' }), tokenFelt,
    ]),
    p.svar && p.svar.server ? plexSvar(p.svar) : null,
    el('div', { class: 'knaprad' }, [
      el('button', { class: 'btn ghost', text: 'Test connection',
        onclick: (e) => proevManuel(e.target, false) }),
      el('button', { class: 'btn primary', text: 'Save and connect',
        onclick: (e) => proevManuel(e.target, true) }),
    ]),
  ]);
}

async function proevManuel(knap, gem) {
  knap.disabled = true;
  const gammel = knap.textContent;
  knap.textContent = 'Testing…';
  state.plex.fejl = '';
  try {
    const svar = await api('/plex/test', { method: 'POST', body: {
      url: state.plex.url, token: state.plex.manuelToken, save: !!gem,
    } });
    state.plex.svar = svar;
    if (gem) {
      state.config.plexLinked = true;
      // Tokenet slippes fra hukommelsen, saa snart det er gemt server-side.
      state.plex.manuelToken = '';
      await hentPlexWebhook();
      toast('Plex connected.');
    }
  } catch (err) {
    state.plex.svar = null;
    state.plex.fejl = err.message;
  }
  knap.disabled = false;
  knap.textContent = gammel;
  tegnSide();
}


/* ------------------------------------------------------- traek og slip */

/*
 * Et felt, man kan SLIPPE filen paa.
 *
 * En Trakt-eksport lander i Downloads som én .zip, og vejen derfra gennem en
 * filvaelger er tre klik. Det er en import, man laver ÉN gang - den skal
 * ikke foles besvaerlig (Andreas, 2026-08-29).
 *
 * Filvaelgeren bliver liggende bagved: traek og slip findes ikke paa en
 * telefon, saa zonen kan ogsaa KLIKKES.
 */
function dropZone() {
  const felt = el('input', {
    type: 'file', hidden: true,
    // .zip MANGLEDE her indtil nu: attributterne stod paa én linje, saa en
    // tidligere rettelse af accept ramte aldrig, og filvaelgeren ville slet
    // ikke vise .zip-filer.
    accept: '.csv,.txt,.json,.zip,text/csv,text/plain,application/json,application/zip',
    onchange: (e) => laesImportFil(e.target.files && e.target.files[0]),
    /*
     * STOP boblingen. Feltet ligger INDE i zonen, saa dets eget klik bobler
     * op til zonens onclick, som kalder felt.click() igen. Maalt: ét tryk
     * gav TO klik paa zonen, og den gentagelse afbryder filvaelgeren, saa
     * dialogen aldrig aabner (Andreas, 2026-08-29).
     */
    onclick: (e) => e.stopPropagation(),
  });

  return el('div', {
    class: `dropzone${state.import.overZonen ? ' over' : ''}`,
    role: 'button', tabindex: '0',
    /*
     * dragover SKAL kalde preventDefault - ellers aabner browseren filen i
     * stedet for at give os den, og siden bliver erstattet af raa JSON.
     */
    // BAADE dragenter og dragover skal preventDefault. Uden dragenter
    // afviser nogle browsere slippet, foer dragover naar at sige ja.
    ondragenter: (e) => { e.preventDefault(); },
    ondragover: (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      if (!state.import.overZonen) { state.import.overZonen = true; opdaterZone(); }
    },
    ondragleave: () => { state.import.overZonen = false; opdaterZone(); },
    ondrop: (e) => {
      e.preventDefault();
      state.import.overZonen = false;
      opdaterZone();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) laesImportFil(f);
    },
    onclick: () => felt.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); felt.click(); } },
  }, [
    el('div', { class: 'dropzone-tekst', text: 'Drop your export here' }),
    el('div', { class: 'dim lille', text: 'or click to choose — .zip, .csv or .json' }),
    felt,
  ]);
}

/*
 * Tag ogsaa imod et drop, der lander UDEN FOR zonen.
 *
 * Rammer man ved siden af - paa marginen, overskriften eller den tomme
 * plads - aeder browseren filen og aabner den i stedet, og for brugeren
 * ligner det, at intet skete. Zonen er stadig maalet, men hele siden tager
 * imod (Andreas, 2026-08-29: kunne ikke faa sin zip ind, og hver enkelt del
 * af kaeden virkede maalt for sig).
 */
function tilslutSideDrop() {
  if (window.__spolenDrop) return;      // kun én gang pr. indlaesning
  window.__spolenDrop = true;
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    // Ramte man zonen, har DENS handler allerede taget den.
    if (e.target.closest && e.target.closest('.dropzone')) return;
    /*
     * Landede filen et andet sted, foerer vi brugeren hen til importen i
     * stedet for at afvise den. Det er den eneste ting, man kan slippe en
     * fil paa i spolen, saa hensigten er ikke til at tage fejl af.
     */
    state.view = 'settings';
    try {
      const foldet = JSON.parse(localStorage.getItem('spolen_foldet') || '{}');
      foldet.import = false;
      localStorage.setItem('spolen_foldet', JSON.stringify(foldet));
    } catch { /* uden lager aabnes afsnittet bare ikke af sig selv */ }
    tegnSide();
    laesImportFil(f);
  });
}

/* Kun KLASSEN skiftes. En gentegning af hele siden midt i et traek ville
   rive zonen ned, og saa fyrer drop aldrig. */
function opdaterZone() {
  const z = document.querySelector('.dropzone');
  if (z) z.classList.toggle('over', !!state.import.overZonen);
}
