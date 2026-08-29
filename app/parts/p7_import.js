
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
    el('h2', { text: 'Import your history' }),
    el('p', { class: 'dim lille', text:
      'Netflix viewing activity, Trakt, Letterboxd, IMDb or TV Time — as a .csv file. '
      + 'Sequel syncs to Trakt, so a Trakt export is the way out of Sequel.' }),

    el('div', { class: 'formgrid' }, [
      el('label', { text: 'File' }),
      el('input', {
        type: 'file', accept: '.csv,.txt,text/csv,text/plain', style: 'font-size:16px',
        onchange: (e) => laesImportFil(e.target.files && e.target.files[0]),
      }),
    ]),

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
  return { tekst: '', analyse: null, status: null, fejl: '', dateOrder: null };
}

async function laesImportFil(fil) {
  if (!fil) return;
  state.import = tomImport();
  tegnSide();
  try {
    // Filen laeses i BROWSEREN og sendes som tekst. Serveren parser den med
    // det SAMME modul, saa der ikke findes to tolkninger af den samme fil.
    const tekst = await fil.text();
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
      text: state.import.tekst,
      options: { dateOrder: state.import.dateOrder },
    } });
    // Teksten slippes med det samme - en historik paa mange megabyte skal
    // ikke ligge i browserens hukommelse, mens jobbet koerer paa serveren.
    state.import.tekst = '';
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
      + 'Press ? above for the exact steps — the redirect uri has to be a specific value.' }),
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
      'Sequel syncs to Trakt, so connecting Trakt is the way to bring your Sequel '
      + 'history across without an export file.' }),

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

  const urlFelt = el('input', {
    type: 'text', placeholder: 'http://192.168.1.50:32400', spellcheck: 'false',
    value: p.url || '', style: 'font-size:16px',
    oninput: (e) => { state.plex.url = e.target.value; },
  });
  const tokenFelt = el('input', {
    type: 'password', autocomplete: 'off', spellcheck: 'false',
    placeholder: forbundet ? 'A token is saved — paste a new one to replace it' : 'X-Plex-Token',
    style: 'font-size:16px',
    oninput: (e) => { state.plex.token = e.target.value; },
  });

  return el('div', {}, [
    afsnitshoved('Plex', 'plex', 'h3'),
    hjaelpePanel('plex'),
    el('p', { class: 'dim lille', text:
      'Plex is the only service that can tell spolen what you actually watched. '
      + 'Everything it finds is matched on Plex’s own ids, so it is exact — not guesswork.' }),

    el('div', { class: 'formgrid' }, [
      el('label', { text: 'Server address' }), urlFelt,
      el('label', { text: 'Token' }), tokenFelt,
    ]),

    p.svar ? plexSvar(p.svar) : null,
    p.fejl ? el('p', { class: 'noeglestatus mangler', text: p.fejl }) : null,

    el('div', { class: 'knaprad' }, [
      el('button', { class: 'btn ghost', text: 'Test connection',
        onclick: (e) => proevPlex(e.target, false) }),
      el('button', { class: 'btn primary', text: 'Save and connect',
        onclick: (e) => proevPlex(e.target, true) }),
      forbundet
        ? el('button', { class: 'btn ghost', text: 'Disconnect', onclick: async () => {
            await api('/plex', { method: 'DELETE' });
            state.config.plexLinked = false;
            state.plex = { url: '', token: '', svar: null, fejl: '' };
            tegnSide();
          } })
        : null,
    ]),

    forbundet
      ? el('div', {}, [
          el('p', { class: 'noeglestatus har', text:
            'Connected. spolen checks for new plays every 10 minutes.' }),
          plexWebhookAfsnit(),
          el('div', { class: 'knaprad' }, [
            el('button', { class: 'btn primary', text: 'Import everything from Plex',
              onclick: (e) => importerFraPlex(e.target, true) }),
            el('button', { class: 'btn ghost', text: 'Fetch new plays now',
              onclick: (e) => importerFraPlex(e.target, false) }),
          ]),
        ])
      : null,
  ]);
}

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
