/* ---- p1_core.js ---- */
'use strict';
/*
 * spolen - frontendens kerne.
 *
 * Vanilla JS, ingen bundler, ingen rammer. Filerne i app/parts/ samles til
 * app/public/app.js af build_rune.py - REDIGER ALDRIG app.js i haanden.
 *
 * Versionen bor ÉT sted: her. Build'et laeser den og skriver den i runens
 * version:, i ?v=-stemplerne og i install-loggen.
 *
 * BUMP DEN ALDRIG UNDERVEJS - kun ved en udgivelse, Andreas har sagt ja til
 * (RUNE-ERFARINGER §8). Flere aendringer samles i ÉN version.
 */
const APP_VERSION = 5;

/* Mobilgraensen bor i ÉN konstant, fordi den findes BEGGE steder: her og i
   style.css. Er de ude af trit, folder menuknappen sidebaren sammen paa en
   iPad, hvor CSS'en tror den er en overlay (Kokkeri v20). 900 og ikke 760 -
   en iPad i portraet er 768/834 px. */
const MOBIL = 900;
const smalSkaerm = () => window.matchMedia(`(max-width: ${MOBIL}px)`).matches;

const state = {
  user: null,
  config: null,
  view: 'up-next',
  rows: [],
  people: [],
  shares: { out: [], in: [] },
  // 'lokale' SKAL staa her. Uden den er den undefined ved foerste tegning,
  // og `s.lokale.length` kaster - panelet aabner sig og forbliver tomt, uden
  // at noget andet ser forkert ud. En starttilstand skal have ALLE de felter,
  // fladen laeser, ogsaa dem der altid fyldes af et svar.
  soeg: { q: '', lokale: [], resultater: [], arbejder: false, fejl: '' },
  bibliotek: { raekker: [] },
  titel: { id: null, data: null, fejl: '' },
  kalender: { hentet: false, fejl: '', raekker: [], idag: '', fra: '', til: '', icalPath: null },
  import: { tekst: '', analyse: null, status: null, fejl: '', dateOrder: null },
  tjenester: { hentet: false, fejl: '', region: 'DK', providers: [], mine: [] },
  stats: { hentet: false, fejl: '', data: null },
  trakt: { kode: null, url: '', fejl: '', besked: '' },
  plex: { url: '', token: '', accountId: '', svar: null, fejl: '', webhook: null },
  noegler: { liste: [], ny: null },
  hjaelp: null,
  push: { abon: [], noegle: '', fejl: '' },
  settings: {},
  delte: {},
  tmdb: { besked: '' },
};

/* ------------------------------------------------------------- hjaelpere */

const $ = (sel, rod) => (rod || document).querySelector(sel);

function el(tag, attrs, born) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const b of [].concat(born || [])) {
    if (b === null || b === undefined || b === false) continue;
    n.appendChild(typeof b === 'string' ? document.createTextNode(b) : b);
  }
  return n;
}

function toast(besked, slags) {
  const t = el('div', { class: `toast ${slags || ''}`, text: besked });
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

/**
 * Alle API-kald gaar herigennem.
 *
 * POST/PUT/DELETE saetter Content-Type: application/json, fordi serveren
 * KRAEVER den som CSRF-barriere oven paa SameSite=Lax (§3). Glemmer man den
 * ét sted, faar man en 415, der ikke ligner et sikkerhedssvar.
 */
async function api(sti, opts) {
  const o = opts || {};
  const init = { method: o.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (o.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(o.body);
  }
  const svar = await fetch(`/api${sti}`, init);
  let krop = null;
  try { krop = await svar.json(); } catch { /* tomt svar er lovligt */ }
  if (!svar.ok) {
    const fejl = new Error((krop && krop.message) || `Request failed (${svar.status})`);
    fejl.kode = krop && krop.error;
    fejl.status = svar.status;
    fejl.krop = krop;
    throw fejl;
  }
  return krop;
}

/* ---------------------------------------------------------------- login */

function loginSide(besked) {
  const cfg = state.config || {};
  let brugerNavn = '';
  let kraeverKode = false;

  function tegn() {
    const rod = $('#root');
    rod.textContent = '';
    const felt = (navn, type, vaerdi) => el('input', {
      // 16 px eller derover - ellers zoomer iOS ind, saa snart feltet faar
      // fokus (Beanledger v33). Feltet arver fra sin LABEL, saa det er ikke
      // nok at saette body's skriftstoerrelse.
      id: `f-${navn}`, name: navn, type, value: vaerdi || '', autocomplete:
        type === 'password' ? 'current-password' : 'username', style: 'font-size:16px',
    });

    const brugerFelt = felt('username', 'text', brugerNavn);
    const kodeFelt = felt('password', 'password');
    const totpFelt = el('input', {
      id: 'f-code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code',
      placeholder: '123456', style: 'font-size:16px',
    });

    async function send(erRegistrering) {
      const krop = {
        username: brugerFelt.value.trim(),
        password: kodeFelt.value,
      };
      if (kraeverKode) krop.code = totpFelt.value.trim();
      try {
        const svar = await api(erRegistrering ? '/register' : '/login', { method: 'POST', body: krop });
        state.user = svar.user;
        await indlaes();
      } catch (err) {
        // needsCode: fold kodefeltet UD og lad brugernavnet staa. Ved et
        // forkert kodeord ryddes formularen i stedet - de to fejl foeles
        // forskellige, og fladen skal vise det.
        if (err.krop && err.krop.needsCode) {
          brugerNavn = brugerFelt.value.trim();
          kraeverKode = true;
          tegn();
          toast(err.message, 'fejl');
          return;
        }
        toast(err.message, 'fejl');
      }
    }

    rod.appendChild(el('div', { class: 'gate' }, [el('div', { class: 'card' }, [
      el('h1', { class: 'brand', text: 'spolen' }),
      el('p', { class: 'dim', text: cfg.needsSetup
        ? 'No account yet — the first one you create runs this server.'
        : 'Sign in to your library.' }),
      besked ? el('p', { class: 'dim', text: besked }) : null,
      // Etiket og felt i et gitter - ellers flyder de sammen paa én linje.
      el('div', { class: 'formgrid' }, [
        el('label', { for: 'f-username', text: 'Username' }), brugerFelt,
        el('label', { for: 'f-password', text: 'Password' }), kodeFelt,
        kraeverKode ? el('label', { for: 'f-code', text: 'Two-factor code' }) : null,
        kraeverKode ? totpFelt : null,
      ]),
      el('div', { class: 'knaprad' }, [
        el('button', { class: 'btn primary', text: cfg.needsSetup ? 'Create account' : 'Sign in',
          onclick: () => send(!!cfg.needsSetup) }),
        // Registreringslinket SKJULES ogsaa, ikke bare afvises af serveren -
        // ellers ligner en lukket server en i stykker (§3).
        (!cfg.needsSetup && cfg.allowRegistration)
          ? el('button', { class: 'btn ghost', text: 'Create account', onclick: () => send(true) })
          : null,
      ]),
      cfg.secureContext ? null : el('p', { class: 'dim lille', text:
        'Served over plain http — passkeys and notifications need https.' }),
    ])]));
  }
  tegn();
}

/* ---- p2_app.js ---- */


/*
 * Ikonerne. Inline SVG - ingen ikonfont, ingen CDN.
 *
 * Alle er 24x24 med `stroke="currentColor"`, saa de arver farven fra
 * .nav-item og skifter med temaet af sig selv. `aria-hidden`, fordi teksten
 * ved siden af siger det samme - to oplaesninger af "Calendar" er stoej.
 */
function ikon(sti, opts) {
  const o = opts || {};
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(o.stoerrelse || 18));
  svg.setAttribute('height', String(o.stoerrelse || 18));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = sti;
  return svg;
}

const IKONER = {
  // Afspil-trekant i en cirkel: "det naeste, du skal se".
  'up-next': '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>',
  // Stablede kort - biblioteket.
  library: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="12" y="4" width="4" height="16" rx="1.5"/><path d="M18.5 5.5l2.2 14"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  // Soejler - statistik.
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  // To personer - deling.
  sharing: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.5a3 3 0 0 1 0 5M18 20a6 6 0 0 0-2-4.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  // Filmspolen - samme maerke som appens ikon.
  brand: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="7" r="1.6"/><circle cx="12" cy="17" r="1.6"/><circle cx="7" cy="12" r="1.6"/><circle cx="17" cy="12" r="1.6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};

/*
 * Overlay-tilstanden styres fra JS, ikke af en media query.
 *
 * Graensen ville ellers ligge to steder - matchMedia her og @media i CSS -
 * og er de ude af trit, folder menuknappen sidebaren sammen paa en iPad,
 * hvor CSS'en tror, den er en overlay (Kokkeri v20). Med ÉN kilde kan de
 * ikke blive uenige.
 */
function opdaterNavTilstand() {
  const smal = smalSkaerm();
  document.body.classList.toggle('navskjult', smal);
  if (!smal) document.body.classList.remove('navopen');
}

function tilslutNav() {
  opdaterNavTilstand();
  // matchMedia frem for resize: den fyrer kun, naar graensen KRYDSES.
  window.matchMedia(`(max-width: ${MOBIL}px)`).addEventListener('change', () => {
    opdaterNavTilstand();
    tegnSide();
  });
}

/* ------------------------------------------------------------- skallen */

/*
 * Sidebaren folder sig til en overlay under MOBIL px. Graensen bor baade her
 * og i style.css - hold dem i trit (se konstanten i p1).
 */
/* Ingen "Search"-side laengere: soegefeltet staar i toppen paa ALLE sider,
   saa en soegning er noget man goer midt i noget andet - ikke et sted man
   gaar hen. */
const SIDER = [
  { id: 'up-next', navn: 'Up Next' },
  { id: 'library', navn: 'Library' },
  { id: 'calendar', navn: 'Calendar' },
  { id: 'stats', navn: 'Statistics' },
  { id: 'sharing', navn: 'Sharing' },
  { id: 'settings', navn: 'Settings' },
];

function skal(indhold) {
  const rod = $('#root');
  // Husk rullepositionen ved gentegning af SAMME side. Et fast scrollTo(0,0)
  // sender brugeren til toppen, hver gang en afkrydsning gemmer og gentegner
  // (Beanledger v24).
  const samme = rod.dataset.view === state.view;
  const sc = document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight
    ? document.scrollingElement : document.body;
  const gemtRul = samme ? sc.scrollTop : 0;

  rod.textContent = '';
  rod.dataset.view = state.view;
  // .app er dodas flex-foraelder: .sidebar har `flex: none` og .main har
  // `flex: 1`, saa uden den staar de to UNDER hinanden, og hovedomraadet
  // ryger under skaermkanten. Fejlen ses ikke i DOM'en - kun paa geometrien.
  const app = el('div', { class: 'app' });
  /*
   * Menuknappen og sloeret ligger UDEN FOR .app: begge er position: fixed,
   * og knappen skal kunne naas, ogsaa naar sidebaren er skubbet ud af
   * skaermen.
   */
  rod.appendChild(el('button', {
    class: 'btn ghost navtoggle', 'aria-label': 'Menu',
    'aria-expanded': document.body.classList.contains('navopen') ? 'true' : 'false',
    // GENTEGN efter skiftet - ellers skifter klassen, men sloeret bliver
    // aldrig bygget, fordi det kun laegges ind, naar skallen tegnes.
    onclick: () => { document.body.classList.toggle('navopen'); tegnSide(); },
  }, [ikon(IKONER.menu, { stoerrelse: 20 })]));
  if (document.body.classList.contains('navopen')) {
    rod.appendChild(el('div', {
      class: 'backdrop',
      onclick: () => { document.body.classList.remove('navopen'); tegnSide(); },
    }));
  }
  rod.appendChild(app);
  app.appendChild(el('nav', { class: 'sidebar nav' }, [
    el('div', { class: 'brand' }, [ikon(IKONER.brand, { stoerrelse: 20 }), 'spolen']),
    ...SIDER.map((s) => el('button', {
      class: 'nav-item',
      // Dodas stylesheet markerer den aktive side paa aria-current, ikke paa
      // en klasse. Det er ogsaa det rigtige for en skaermlaeser.
      'aria-current': state.view === s.id ? 'page' : null,
      onclick: async () => {
        state.view = s.id;
        tegnSide();
        // Biblioteket kan vaere aendret af en tilfoejelse siden sidst.
        if (s.id === 'library') { await hentBibliotek(); tegnSide(); }
        // Noeglens tilstand hentes, naar man aabner siden - ikke ved login.
        // Det er et rigtigt TMDB-kald, og det skal ikke koere hver gang.
        if (s.id === 'settings') { await Promise.all([hentSettings(), tjekTmdb(), hentTjenester(), hentNoegler(), hentPlexWebhook(), hentPush()]); tegnSide(); }
        if (s.id === 'calendar') { await hentKalender(); tegnSide(); }
        if (s.id === 'stats') { await hentStats(); tegnSide(); }
        // Paa en telefon skal menuen lukke sig selv, naar man har valgt.
        if (smalSkaerm()) document.body.classList.remove('navopen');
      },
    }, [ikon(IKONER[s.id] || IKONER.library), s.navn])),
    /*
     * TMDB-attributionen er et VILKAAR for noeglen, ikke en pyntedetalje:
     * man maa bruge deres API gratis til ikke-kommerciel brug, mod at sige
     * at man goer det, og at de ikke staar inde for appen. Den skal derfor
     * staa et sted, der altid er synligt - ikke gemt i en om-dialog.
     */
    el('div', { class: 'sidebar-foot' }, [
      el('span', { class: 'dim lille', text: state.user ? state.user.username : '' }),
      el('button', { class: 'btn ghost lille', text: 'Sign out', onclick: async () => {
        await api('/logout', { method: 'POST' });
        state.user = null;
        loginSide('Signed out.');
      } }),
      versionsLinje(),
      el('p', { class: 'dim tmdb-kredit', text:
        'Uses the TMDB API but is not endorsed or certified by TMDB.' }),
    ]),
  ]));
  /*
   * Topbaren bygges FORFRA ved hver gentegning - men kun naar den ikke
   * allerede staar der med noget i. Skrev brugeren midt i en gentegning
   * (fx fordi et afsnit blev markeret), maa feltet ikke rives ned.
   */
  const gammelTop = document.getElementById('omniCard');
  const beholdTop = gammelTop && document.activeElement === document.getElementById('omni');
  app.appendChild(el('main', { class: 'main' }, [
    beholdTop ? gammelTop.parentElement : byggTopbar(),
    indhold,
  ]));
  if (beholdTop) tegnOmniPanel();
  sc.scrollTop = gemtRul;
}

/*
 * Versionen, altid synlig i sidebarens fod.
 *
 * Det er SAMME tal som runens `version:` i panelet, saa man kan se med det
 * blotte oeje, om Update/Reinstall faktisk skiftede noget - den hyppigste
 * forvirring i panelets todelte opdateringsflow (§6).
 *
 * Kun et NYERE servertal taeller som "der er en opdatering". `!==` er
 * forkert den ene vej: er serverens tal LAVERE end det, browseren koerer -
 * en rullet udgivelse, eller en serverproces der ikke er genstartet - stod
 * der "v3 available" ved siden af v4, og det er vaas. (doda og Sagu fandt
 * begge den fejl; spolen havde den ogsaa, i toasten ved opstart.)
 */
function versionsLinje() {
  const server = state.config && state.config.version;
  if (server && server > APP_VERSION) {
    return el('button', {
      class: 'version-linje gammel',
      title: `Your browser is running v${APP_VERSION}, but the server has v${server}. `
        + 'Click to reload.',
      onclick: () => location.reload(),
    }, [`v${APP_VERSION} · v${server} available — reload`]);
  }
  return el('div', { class: 'version-linje', text: `v${APP_VERSION}` });
}

function tomtRum(overskrift, forklaring) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty-title', text: overskrift }),
    el('p', { text: forklaring }),
  ]);
}

/* ------------------------------------------------------------- up next */

function upNextSide() {
  if (!state.rows.length) {
    return tomtRum('Nothing queued',
      state.config && !state.config.tmdbKeySet
        ? 'Add a TMDB key under Settings, then search for a show to follow.'
        : 'Follow a show and its next episode shows up here.');
  }
  return el('div', {}, [
    el('h1', { text: 'Up Next' }),
    el('div', { class: 'kortliste' }, state.rows.map(naesteKort)),
  ]);
}

function naesteKort(raekke) {
  const t = raekke.title;
  const n = raekke.next;
  const afsnit = n.klar || n.naeste;
  const klar = !!n.klar;
  return el('article', { class: 'naeste-kort card' }, [
    /* Plakaten fører til seriens side. En knap og ikke en div, saa den kan
       naas med tastaturet - og alt-teksten er tom, fordi knappens eget
       navn (title) allerede siger, hvad den goer. To oplaesninger af samme
       titel ville bare stoeje. */
    el('button', {
      class: 'plakatknap', title: `Open ${t.name}`,
      onclick: () => aabnTitel(t.id),
    }, [
      t.posterPath
        ? el('img', { class: 'plakat', src: `/api/poster/w342${t.posterPath}`, alt: '', loading: 'lazy' })
        : el('div', { class: 'plakat' }),
    ]),
    el('div', {}, [
      // Titlen fører samme sted hen. Den var doed at klikke paa, og det er
      // det foerste, man proever, naar plakaten kan klikkes.
      el('h3', {}, [
        el('button', { class: 'afsnitslink', text: t.name,
          title: `Open ${t.name}`,
          onclick: () => aabnTitel(t.id) }),
      ]),
      /* Afsnitslinjen aabner beskrivelsen. En knap og ikke en div, saa den
         kan naas med tastaturet og laeses op som noget, der kan trykkes paa. */
      el('button', {
        class: 'afsnitsmaerke afsnitslink',
        text: `S${afsnit.season}E${afsnit.number}${afsnit.name ? ' · ' + afsnit.name : ''}`,
        title: 'Show the episode description',
        onclick: () => visAfsnit(afsnit.id),
      }),
      el('div', { class: 'kortbund' }, [
        // Chippen siger det ogsaa med ORD. En chip, der kun er groen, siger
        // intet til den, der ikke ser farven.
        el('span', { class: `chip${klar ? ' klar' : ''}`,
          text: klar ? 'Ready to watch' : datoTekst(afsnit.airDate) }),
        klar ? el('button', {
          class: 'btn primary lille', text: 'Watched',
          onclick: () => markerSet(t.id, afsnit.id),
        }) : null,
      ]),
    ]),
  ]);
}

function datoTekst(airDate) {
  if (!airDate) return 'Date unknown';
  const idag = new Date().toISOString().slice(0, 10);
  if (airDate === idag) return 'Airs today';
  if (airDate < idag) return `Aired ${airDate}`;
  return `Airs ${airDate}`;
}

async function markerSet(titleId, episodeId) {
  try {
    await api('/watches', { method: 'POST', body: { titleId, episodeId, source: 'manual' } });
    await hentUpNext();
    tegnSide();
  } catch (err) {
    toast(err.message, 'fejl');
  }
}

/* ------------------------------------------------------------- deling */

/*
 * Deling er SELEKTIV (Andreas, 2026-08-28): man vaelger hvem, og man vaelger
 * hvad. Fladen skal derfor vise begge retninger hver for sig - "jeg deler ud"
 * og "der deles med mig" er ikke det samme spoergsmaal, og kun det foerste
 * kan man lave om paa.
 */
function delingsSide() {
  const ud = state.shares.out;
  const ind = state.shares.in;
  return el('div', {}, [
    el('h1', { text: 'Sharing' }),
    el('p', { class: 'dim', text:
      'Nothing is shared until you say so. Pick a person, then pick how much they see.' }),

    el('h2', { text: 'You share' }),
    ud.length ? el('div', { class: 'liste' }, ud.map(delingsRaekke))
      : el('p', { class: 'dim', text: 'You are not sharing anything.' }),

    el('h2', { text: 'Share with someone' }),
    state.people.length ? nyDelingFormular()
      : el('p', { class: 'dim', text: 'Nobody else has an account on this server yet.' }),

    el('h2', { text: 'Shared with you' }),
    ind.length ? el('div', { class: 'liste' }, ind.map((d) => el('div', { class: 'item-row' }, [
      el('strong', { text: d.owner }),
      el('span', { class: 'dim', text: ' · ' + emneTekst(d) }),
      // Modtageren kan IKKE fjerne en deling. Kun ejeren bestemmer, og en
      // knap, der ikke virker, er vaerre end ingen knap.
    ]))) : el('p', { class: 'dim', text: 'Nobody is sharing with you.' }),
  ]);
}

function emneTekst(d) {
  if (d.subjectKind === 'profile') return 'everything — full history and progress';
  if (d.subjectKind === 'list') return `list "${d.subjectId}"${d.canWrite ? '" (can add)' : ''}`;
  return `one title (${d.subjectId})`;
}

function delingsRaekke(d) {
  return el('div', { class: 'item-row' }, [
    el('strong', { text: d.grantee }),
    el('span', { class: 'dim', text: ' · ' + emneTekst(d) }),
    el('button', {
      class: 'btn ghost lille', text: 'Stop sharing',
      onclick: async () => {
        await api(`/shares/${d.id}`, { method: 'DELETE' });
        await hentDelinger();
        tegnSide();
        toast('Stopped sharing.');
      },
    }),
  ]);
}

function nyDelingFormular() {
  const person = el('select', { style: 'font-size:16px' },
    state.people.map((p) => el('option', { value: p.id, text: p.username })));
  const emne = el('select', { style: 'font-size:16px' }, [
    el('option', { value: 'profile', text: 'Everything — my whole history' }),
    el('option', { value: 'title', text: 'One title only' }),
    el('option', { value: 'list', text: 'One list' }),
  ]);
  const emneId = el('input', { placeholder: 'tv:1396', style: 'font-size:16px' });
  const skriv = el('input', { type: 'checkbox' });

  function opdaterSynlighed() {
    const p = emne.value === 'profile';
    emneId.hidden = p;
    // Skriveret giver kun mening for lister - man kan ikke se en film paa en
    // andens vegne. Feltet skjules frem for at staa og lyve.
    skriv.parentElement.hidden = emne.value !== 'list';
  }
  emne.addEventListener('change', opdaterSynlighed);
  setTimeout(opdaterSynlighed, 0);

  return el('div', { class: 'formgrid' }, [
    el('label', { text: 'Person' }), person,
    el('label', { text: 'What they see' }), emne,
    el('label', { text: 'Which one' }), emneId,
    el('label', {}, [skriv, ' They can add to it']),
    el('button', {
      class: 'btn primary', text: 'Share',
      onclick: async () => {
        try {
          await api('/shares', { method: 'POST', body: {
            granteeId: person.value,
            subjectKind: emne.value,
            subjectId: emne.value === 'profile' ? undefined : emneId.value.trim(),
            canWrite: skriv.checked,
          } });
          await hentDelinger();
          tegnSide();
          toast('Shared.');
        } catch (err) { toast(err.message, 'fejl'); }
      },
    }),
  ]);
}

/* ------------------------------------------------------------- indlaes */

async function hentUpNext() {
  const svar = await api('/up-next');
  state.rows = svar.rows || [];
}

async function hentDelinger() {
  const [folk, delinger] = await Promise.all([api('/people'), api('/shares')]);
  state.people = folk.people || [];
  state.shares = { out: delinger.out || [], in: delinger.in || [] };
}

function tegnSide() {
  if (state.view === 'sharing') { skal(delingsSide()); return; }
  if (state.view === 'up-next') { skal(upNextSide()); return; }
  if (state.view === 'library') { skal(bibliotekSide()); return; }
  if (state.view === 'title') { skal(titelSide()); return; }
  if (state.view === 'settings') { skal(settingsSide()); return; }
  if (state.view === 'calendar') { skal(kalenderSide()); return; }
  if (state.view === 'stats') { skal(statsSide()); return; }
  skal(tomtRum('Not built yet', 'This part of spolen comes in a later phase.'));
}

async function indlaes() {
  try {
    const [cfg, me] = await Promise.all([api('/public-config'), api('/me')]);
    state.config = cfg;
    state.user = me.user;
    if (me.integrations) {
      state.config.tmdbKeySet = me.integrations.tmdbKeySet;
      state.config.traktLinked = me.integrations.traktLinked;
      state.config.plexLinked = me.integrations.plexLinked;
    }
    if (!state.user) { loginSide(); return; }
    await Promise.all([hentUpNext(), hentDelinger(), hentBibliotek()]);
    tegnSide();
    tilslutSkrivForAtSoege();
    tilslutNav();
    tilslutServiceWorker();
    // Serveren udleverer ogsaa sin egen version. Stemmer den ikke med den her
    // fil, sidder der en gammel app.js i cachen - og saa fejlsoeger man kode,
    // der ikke er indlaest (§5).
    // Kun NYERE. Se versionsLinje() for hvorfor `!==` var forkert.
    if (cfg.version && cfg.version > APP_VERSION) {
      toast(`This page is v${APP_VERSION}, the server has v${cfg.version}. Reload.`, 'fejl');
    }
  } catch (err) {
    loginSide(err.status === 401 ? '' : err.message);
  }
}

indlaes();


/*
 * Service worker - offline og hurtig start.
 *
 * KUN i et sikkert kontekst (https eller localhost). Over panelets IP:port
 * findes navigator.serviceWorker slet ikke, og et ubetinget kald ville kaste
 * ved hver indlaesning (§4: flere browser-API'er kraever https).
 */
function tilslutServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // I DEV ville en cachet app.js betyde, at man fejlsoeger kode, der ikke er
  // indlaest - den fejl kostede en aften i doda.
  if (state.config && state.config.dev) return;
  navigator.serviceWorker.register('sw.js').catch(() => {
    // En afvist registrering er ikke vaerd at larme om: appen virker uden.
  });
}

/* ---- p3_soeg.js ---- */

/* --------------------------------------------------------------- omni */

/*
 * Soegefeltet i toppen - dodas omni-moenster.
 *
 * Feltet er ALTID der, paa alle sider. Det er derfor der ikke laengere findes
 * en "Search"-side: en soegning er noget man goer midt i noget andet, ikke et
 * sted man gaar hen.
 *
 * Feltet gentegnes ALDRIG, mens der skrives i det. Resultaterne bor i deres
 * egen beholder, og kun den opdateres - ellers mister inputtet fokus midt i
 * indtastningen (maalt: activeElement blev til BODY efter 350 ms).
 */
const SOEG_PAUSE = 300;
let soegTimer = null;
let soegSekvens = 0;

function omniFelt() { return document.getElementById('omni'); }
function omniPanel() { return document.getElementById('omnipanel'); }

function byggTopbar() {
  const felt = el('input', {
    id: 'omni', class: 'omni-input', type: 'text', autocomplete: 'off',
    spellcheck: 'false', placeholder: 'Search your library and TMDB…',
    // 16 px, ellers zoomer iOS ind ved fokus.
    style: 'font-size:16px',
    oninput: (e) => planlaegSoegning(e.target.value),
    onkeydown: (e) => {
      if (e.key === 'Escape') { luk(); e.target.blur(); }
    },
  });
  return el('div', { class: 'topbar' }, [
    el('div', { class: 'omni-card', id: 'omniCard' }, [
      felt,
      el('div', { class: 'omni-panel', id: 'omnipanel', hidden: true }),
    ]),
  ]);
}

function luk() {
  const p = omniPanel();
  if (p) { p.hidden = true; p.textContent = ''; }
  state.soeg.resultater = [];
  state.soeg.lokale = [];
}

/*
 * Skriv hvor som helst -> skriv i soegefeltet.
 *
 * Kun almindelige tegn, og kun naar man ikke allerede staar i et felt.
 * Genvejstaster (Cmd/Ctrl/Alt) gaar fri, ellers ville Cmd+R lande som "r"
 * i soegefeltet i stedet for at genindlaese siden.
 */
/*
 * Beslutningen er trukket UD som en ren funktion.
 *
 * Grunden er ikke ryddelighed: browser-panen sender syntetiske keydown med
 * TOM `e.key`, saa hverken funktionen eller genvejen kan drives dér. Kan
 * mekanikken ikke drives i et testmiljoe, er regnestykket det eneste sted,
 * fejlen kan fanges - og saa skal det staa alene og kunne proeves i node
 * (RUNE-ERFARINGER, Sagu v40).
 *
 * @param {object} e    {key, metaKey, ctrlKey, altKey}
 * @param {object} maal det element, tasten ramte {tagName, isContentEditable}
 */
function skalFangeTast(e, maal) {
  if (!e || typeof e.key !== 'string') return false;
  // Genvejstaster gaar fri - ellers ville Cmd+R lande som "r" i soegefeltet
  // i stedet for at genindlaese siden.
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  // Ét tegn = et skrivbart tegn. 'Enter', 'Tab', 'ArrowUp', 'Escape' og
  // 'Dead' er alle laengere. Tom streng (som panen sender) er kortere.
  if (e.key.length !== 1) return false;
  // Staar man allerede i et felt, skal tegnet blive dér.
  if (!maal) return true;
  const tag = String(maal.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (maal.isContentEditable) return false;
  return true;
}

function tilslutSkrivForAtSoege() {
  document.addEventListener('keydown', (e) => {
    if (!skalFangeTast(e, e.target)) return;
    const felt = omniFelt();
    if (!felt) return;
    felt.focus();
    // Tegnet skrives IKKE her - fokus er flyttet, saa browseren leverer det
    // selv til feltet. Skrev vi det ogsaa, ville det staa der to gange.
  });
}

function planlaegSoegning(q) {
  state.soeg.q = q;
  clearTimeout(soegTimer);
  if (q.trim().length < 2) { luk(); return; }
  soegTimer = setTimeout(() => soeg(q), SOEG_PAUSE);
}

async function soeg(q) {
  // Sekvensnummeret afgoer hvem der vinder: uden det kan et langsomt svar paa
  // "sev" lande efter det hurtige svar paa "severance".
  const min = ++soegSekvens;
  state.soeg.arbejder = true;
  tegnOmniPanel();
  try {
    const svar = await api(`/search?q=${encodeURIComponent(q)}`);
    if (min !== soegSekvens) return;
    state.soeg.lokale = svar.local || [];
    state.soeg.resultater = svar.results || [];
    state.soeg.fejl = svar.tmdbError || '';
  } catch (err) {
    if (min !== soegSekvens) return;
    state.soeg.lokale = [];
    state.soeg.resultater = [];
    state.soeg.fejl = err.message;
  } finally {
    if (min === soegSekvens) { state.soeg.arbejder = false; tegnOmniPanel(); }
  }
}

function tegnOmniPanel() {
  const p = omniPanel();
  if (!p) return;
  p.textContent = '';
  const s = state.soeg;
  if (s.q.trim().length < 2) { p.hidden = true; return; }
  p.hidden = false;

  if (s.lokale.length) {
    p.appendChild(el('div', { class: 'omni-legend', text: 'In your library' }));
    for (const l of s.lokale) p.appendChild(lokalRaekke(l));
  }
  if (s.resultater.length) {
    p.appendChild(el('div', { class: 'omni-legend', text: 'From TMDB' }));
    for (const r of s.resultater) p.appendChild(tmdbRaekke(r));
  }
  if (s.arbejder) p.appendChild(el('div', { class: 'omni-row dim', text: 'Searching TMDB…' }));
  // Fejlen staar UNDER de lokale traeffere: uden net skal man stadig kunne
  // finde det, man allerede har.
  if (s.fejl) p.appendChild(el('div', { class: 'omni-row dim', text: s.fejl }));
  if (!s.arbejder && !s.lokale.length && !s.resultater.length && !s.fejl) {
    p.appendChild(el('div', { class: 'omni-row dim', text: 'Nothing found.' }));
  }
}

function lokalRaekke(l) {
  return el('div', {
    class: 'omni-row', role: 'button', tabindex: '0',
    onclick: () => { luk(); omniFelt().value = ''; state.soeg.q = ''; aabnTitel(l.id); },
  }, [
    miniPlakat(l.posterPath),
    el('div', { class: 'omni-row-main' }, [
      el('div', { class: 'omni-row-title', text: l.name }),
      el('div', { class: 'omni-row-sub',
        text: `${l.kind === 'tv' ? 'Series' : 'Film'}${l.year ? ' · ' + l.year : ''}`
          + (l.tracked ? ' · following' : '') }),
    ]),
  ]);
}

function tmdbRaekke(r) {
  const knap = el('button', {
    class: 'btn primary lille', text: r.tracked ? 'Added' : 'Add',
    disabled: !!r.tracked,
    // stopPropagation: knappen ligger INDE i en raekke, der ogsaa kan klikkes.
    // Uden den ville et tryk paa Add baade tilfoeje OG aabne overblikket.
    onclick: (e) => { e.stopPropagation(); tilfoej(r, e.target); },
  });
  return el('div', {
    /*
     * Hele raekken kan klikkes og aabner et overblik.
     *
     * Uden det skal man tilfoeje en titel for at se, hvad den er - og saa
     * finde ud af, at det var den forkerte "Harry Hole" (Andreas, 2026-08-28).
     */
    class: 'omni-row', role: 'button', tabindex: '0',
    onclick: () => visOverblik(r),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); visOverblik(r); } },
  }, [
    miniPlakat(r.posterPath),
    el('div', { class: 'omni-row-main' }, [
      el('div', { class: 'omni-row-title', text: r.name }),
      el('div', { class: 'omni-row-sub',
        text: `${r.kind === 'tv' ? 'Series' : 'Film'}${r.year ? ' · ' + r.year : ''}` }),
    ]),
    knap,
  ]);
}

/* ------------------------------------------------------------- overblik */

/*
 * Overblikket over en titel, man overvejer.
 *
 * Det, soegningen ALLEREDE har (navn, aar, plakat, resume), vises med det
 * samme - og de dyrere felter (saesoner, medvirkende, bedoemmelse) hentes
 * bagefter og fyldes ind. Ellers stirrer man paa en tom rude, mens TMDB
 * svarer, og det er langsommere end at kigge videre i listen.
 */
async function visOverblik(r) {
  const krop = el('div', { class: 'overblik' });
  const knaprad = el('div', { class: 'knaprad' });
  const luk = () => { bag.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') luk(); };
  const bag = el('div', { class: 'modalbag', onclick: (e) => { if (e.target === bag) luk(); } }, [
    el('div', { class: 'modal-card overblik-kort', role: 'dialog', 'aria-modal': 'true' }, [
      krop, knaprad,
    ]),
  ]);
  document.body.appendChild(bag);
  document.addEventListener('keydown', paaTast);

  const tegn = (d, henter) => {
    krop.textContent = '';
    knaprad.textContent = '';
    krop.appendChild(el('div', { class: 'overblik-hoved' }, [
      d.posterPath
        ? el('img', { class: 'plakat', src: `/api/poster/w342${d.posterPath}`, alt: '' })
        : el('div', { class: 'plakat' }),
      el('div', {}, [
        el('h3', { text: d.name }),
        // Originaltitlen vises KUN naar den er en anden - ellers staar der
        // det samme to gange. Den er tit netop det, der afgoer, om det er
        // den rigtige udenlandske serie.
        (d.originalName && d.originalName !== d.name)
          ? el('div', { class: 'dim lille', text: d.originalName }) : null,
        el('div', { class: 'dim', text: overblikLinje(d) }),
        d.score ? el('div', { class: 'dim lille',
          text: `TMDB ${d.score}/10 from ${d.votes.toLocaleString()} votes` }) : null,
        d.cast && d.cast.length
          ? el('div', { class: 'dim lille', text: 'With ' + d.cast.join(', ') }) : null,
        d.directors && d.directors.length
          ? el('div', { class: 'dim lille', text: 'By ' + d.directors.join(', ') }) : null,
      ]),
    ]));
    krop.appendChild(el('p', { class: 'overblik-resume',
      text: d.overview || 'TMDB has no description for this one.' }));
    if (henter) krop.appendChild(el('p', { class: 'dim lille', text: 'Loading details…' }));

    knaprad.appendChild(el('button', {
      class: 'btn primary',
      text: d.tracked ? 'Already in your library' : 'Add to library',
      disabled: !!d.tracked,
      onclick: async (e) => {
        await tilfoej(r, e.target);
        if (r.tracked) luk();
      },
    }));
    knaprad.appendChild(el('button', { class: 'btn ghost', text: 'Close', onclick: luk }));
  };

  // 1. Det vi allerede ved - med det samme.
  tegn(r, true);

  // 2. Resten, naar TMDB svarer.
  try {
    const fuld = await api(`/preview?kind=${r.kind}&tmdbId=${r.tmdbId}`);
    // Er ruden lukket imens, skal der ikke tegnes i den.
    if (!bag.isConnected) return;
    r.tracked = fuld.tracked;
    tegn(Object.assign({}, r, fuld), false);
  } catch (err) {
    if (!bag.isConnected) return;
    tegn(r, false);
    krop.appendChild(el('p', { class: 'dim lille', text: `Could not load details: ${err.message}` }));
  }
}

/** Den ene linje, der siger hvad det ER: art, aar, omfang, genrer. */
function overblikLinje(d) {
  const dele = [d.kind === 'tv' ? 'Series' : 'Film'];
  if (d.year) dele.push(String(d.year));
  if (d.status) dele.push(d.status);
  if (d.seasonCount) {
    dele.push(`${d.seasonCount} season${d.seasonCount === 1 ? '' : 's'}`
      + (d.episodeCount ? `, ${d.episodeCount} episodes` : ''));
  } else if (d.runtime) {
    dele.push(`${d.runtime} min`);
  }
  if (d.genres && d.genres.length) dele.push(d.genres.join(', '));
  return dele.join(' · ');
}

function miniPlakat(sti) {
  return sti
    ? el('img', { class: 'omni-plakat', src: `/api/poster/w154${sti}`, alt: '', loading: 'lazy' })
    : el('div', { class: 'omni-plakat' });
}

async function tilfoej(r, knap) {
  // En lang serie er mange TMDB-kald med pause imellem - det tager sekunder.
  // Knappen skal sige det, ellers trykker man igen.
  knap.disabled = true;
  knap.textContent = 'Adding…';
  try {
    await api('/titles', { method: 'POST', body: { kind: r.kind, tmdbId: r.tmdbId } });
    r.tracked = true;
    knap.textContent = 'Added';
    toast(`${r.name} added.`);
    await Promise.all([hentUpNext(), hentBibliotek()]);
  } catch (err) {
    knap.disabled = false;
    knap.textContent = 'Add';
    toast(err.message, 'fejl');
  }
}

/* ------------------------------------------------------------ bibliotek */

function bibliotekSide() {
  const raekker = state.bibliotek.raekker;
  if (!raekker.length) {
    return tomtRum('Your library is empty', 'Search at the top and add a film or series.');
  }
  return el('div', {}, [
    el('h1', { text: 'Library' }),
    el('div', { class: 'plakater' }, raekker.map(bibliotekKort)),
  ]);
}

function bibliotekKort(raekke) {
  const t = raekke.title;
  const p = raekke.progress;
  return el('div', {
    class: 'soegekort', role: 'button', tabindex: '0',
    onclick: () => aabnTitel(t.id),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') aabnTitel(t.id); },
  }, [
    t.posterPath
      ? el('img', { class: 'plakat', src: `/api/poster/w342${t.posterPath}`, alt: '', loading: 'lazy' })
      : el('div', { class: 'plakat' }),
    el('div', { class: 'soegekort-titel', text: t.name }),
    p ? el('div', { class: 'fremdrift' }, [el('i', { style: `width:${p.procent}%` })]) : null,
    el('div', { class: 'dim lille', text: p
      ? `${p.sete}/${p.sendte} aired watched`
      : (raekke.watched ? 'Watched' : 'Not watched') }),
  ]);
}

async function hentBibliotek() {
  const svar = await api('/library');
  state.bibliotek.raekker = svar.rows || [];
}

/* ---- p4_settings.js ---- */

/* ---------------------------------------------------------- indstillinger */

/*
 * Settings.
 *
 * Hemmeligheder er SKRIVE-ONLY i fladen: serveren sender aldrig noeglen
 * tilbage, kun et flag (§6b). Feltet staar derfor altid tomt, og teksten
 * ved siden af siger, om der ER en noegle - i stedet for at vise prikker,
 * der ligner en vaerdi, man kunne rette i.
 */
function settingsSide() {
  const admin = state.user && state.user.isAdmin;
  return el('div', {}, [
    el('h1', { text: 'Settings' }),

    afsnitshoved('Metadata', 'tmdb'),
    hjaelpePanel('tmdb'),
    admin ? tmdbAfsnit() : el('p', { class: 'dim', text:
      'Only the administrator can change the TMDB key.' }),

    el('h2', { text: 'Your preferences' }),
    personligeAfsnit(),

    el('h2', { text: 'Your streaming services' }),
    tjenesteAfsnit(),

    importSide(),

    noegleAfsnit(),

    admin ? afsnitshoved('Trakt application', 'trakt') : null,
    admin ? hjaelpePanel('trakt') : null,
    admin ? traktAppAfsnit() : null,

    el('h2', { text: 'Notifications' }),
    notifikationAfsnit(),

    afsnitshoved('Access keys', 'noegler'),
    hjaelpePanel('noegler'),

    admin ? el('h2', { text: 'This server' }) : null,
    admin ? serverAfsnit() : null,
  ]);
}

function tmdbAfsnit() {
  const harNoegle = !!(state.config && state.config.tmdbKeySet);
  const felt = el('input', {
    type: 'password',
    /*
     * Feltet staar altid TOMT - noeglen sendes aldrig tilbage fra serveren.
     * Men et tomt felt med "indsaet din noegle her" ligner "der er ingen
     * noegle", og det er praecis den forvirring, Andreas paapegede.
     * Pladsholderen siger derfor, hvad feltet GOER, og linjen nedenunder
     * siger, hvad tilstanden ER.
     */
    placeholder: harNoegle ? 'Paste a new key to replace the saved one'
      : 'Paste your TMDB key here',
    autocomplete: 'off', spellcheck: 'false',
    style: 'font-size:16px',
  });
  const status = el('p', {
    class: harNoegle ? 'noeglestatus har' : 'noeglestatus mangler',
    text: state.tmdb.besked || 'Checking…',
  });

  return el('div', {}, [
    el('p', { class: 'dim', text:
      'spolen accepts either kind TMDB gives you — the API Read Access Token '
      + '(the long one) or the API Key (the short one). Paste whichever you have.' }),
    el('div', { class: 'formgrid' }, [
      el('label', { text: 'TMDB key' }), felt,
      el('button', {
        class: 'btn primary', text: harNoegle ? 'Replace key' : 'Save key',
        onclick: async (e) => {
          const v = felt.value.trim();
          if (!v) { toast('Paste a key first.', 'fejl'); return; }
          e.target.disabled = true;
          try {
            await api('/admin/settings', { method: 'PUT', body: { tmdb_key: v } });
            // Ryd feltet med det samme. En noegle, der bliver staaende i et
            // formularfelt, ryger med i browserens autofyld og i et screenshot.
            felt.value = '';
            toast('Key saved. Testing it…');
            /*
             * Tjenestelisten skal hentes IGEN. Den fejlede, foer noeglen var
             * der, og fejlen bliver staaende i state - saa staar der "No TMDB
             * key yet" lige under en linje, der siger at noeglen virker
             * (Andreas, 2026-08-29).
             */
            await Promise.all([tjekTmdb(), hentTjenester()]);
            tegnSide();
          } catch (err) {
            toast(err.message, 'fejl');
          } finally { e.target.disabled = false; }
        },
      }),
    ]),
    status,
    el('button', { class: 'btn ghost lille', text: 'Test the key again',
      onclick: async () => { await tjekTmdb(); tegnSide(); } }),
  ]);
}

function personligeAfsnit() {
  const sprog = el('select', { style: 'font-size:16px' }, [
    el('option', { value: 'en-US', text: 'English' }),
    el('option', { value: 'da-DK', text: 'Dansk' }),
  ]);
  sprog.value = state.settings.language || 'en-US';
  const region = el('select', { style: 'font-size:16px' }, [
    el('option', { value: 'DK', text: 'Denmark' }),
    el('option', { value: 'US', text: 'United States' }),
    el('option', { value: 'GB', text: 'United Kingdom' }),
  ]);
  region.value = state.settings.region || 'DK';

  return el('div', { class: 'formgrid' }, [
    el('label', { text: 'Titles and summaries in' }), sprog,
    el('label', { text: 'Streaming availability for' }), region,
    el('button', {
      class: 'btn primary', text: 'Save',
      onclick: async () => {
        try {
          await api('/settings', { method: 'PUT',
            body: { language: sprog.value, region: region.value } });
          state.settings.language = sprog.value;
          state.settings.region = region.value;
          toast('Saved.');
        } catch (err) { toast(err.message, 'fejl'); }
      },
    }),
  ]);
}

function serverAfsnit() {
  const aaben = state.delte.allow_registration === '1';
  return el('div', {}, [
    el('label', {}, [
      el('input', {
        type: 'checkbox', checked: aaben,
        onchange: async (e) => {
          try {
            await api('/admin/settings', { method: 'PUT',
              body: { allow_registration: e.target.checked ? '1' : '0' } });
            state.delte.allow_registration = e.target.checked ? '1' : '0';
            toast(e.target.checked ? 'Anyone with the address can sign up.' : 'Sign-up closed.');
          } catch (err) { toast(err.message, 'fejl'); }
        },
      }),
      ' Let new people create an account',
    ]),
    el('p', { class: 'dim lille', text:
      'Leave this off once everyone in the house has an account.' }),
  ]);
}

async function tjekTmdb() {
  try {
    const s = await api('/tmdb-status');
    state.config.tmdbKeySet = s.set;
    // Teksten skal foerst og fremmest svare paa "er der en noegle?" - og
    // DEREFTER paa "virker den?".
    state.tmdb.besked = s.set
      ? (s.ok ? `A key is saved and working — ${s.format}. ${s.message}`
              : `A key is saved, but it is not working: ${s.message}`)
      : 'No key saved yet — paste one above.';
  } catch (err) {
    state.tmdb.besked = err.message;
  }
}

async function hentSettings() {
  const s = await api('/settings');
  state.settings = s.settings || {};
  state.delte = s.shared || {};
}

/* ---- p5_titel.js ---- */

/* ---------------------------------------------------------- titelvisning */

async function aabnTitel(id) {
  state.view = 'title';
  state.titel = { id, data: null, fejl: '', aabne: new Set(), beslaegtede: null };
  tegnSide();
  try {
    state.titel.data = await api(`/titles/${encodeURIComponent(id)}`);
    /*
     * Fold den saeson ud, man faktisk er i gang med - ikke saeson 1.
     *
     * En serie med 351 afsnit maa ikke aabne som 351 raekker: det er baade
     * uoverskueligt og langsomt at tegne. Sammenklappede saesoner loeser
     * begge dele, men kun hvis den RIGTIGE er foldet ud fra start.
     */
    const n = state.titel.data.next;
    const maal = (n && (n.klar || n.naeste)) || null;
    if (maal) state.titel.aabne.add(maal.season);
  } catch (err) {
    state.titel.fejl = err.message;
  }
  tegnSide();
}

function titelSide() {
  const t = state.titel;
  if (t.fejl) return tomtRum('Could not open that', t.fejl);
  if (!t.data) return el('p', { class: 'dim', text: 'Loading…' });
  const titel = t.data.title;
  const p = t.data.progress;

  return el('div', {}, [
    el('button', { class: 'btn ghost lille', text: '← Library',
      onclick: () => { state.view = 'library'; tegnSide(); } }),
    el('div', { class: 'titelhoved' }, [
      titel.posterPath
        ? el('img', { class: 'plakat', src: `/api/poster/w342${titel.posterPath}`, alt: '' })
        : el('div', { class: 'plakat' }),
      el('div', {}, [
        el('h1', { text: titel.name }),
        el('div', { class: 'dim',
          text: [titel.year, titel.status, (titel.genres || []).join(', ')]
            .filter(Boolean).join(' · ') }),
        p ? el('div', { class: 'fremdrift' }, [el('i', { style: `width:${p.procent}%` })]) : null,
        p ? el('div', { class: 'dim lille',
          text: `${p.sete} of ${p.sendte} aired episodes watched` }) : null,
        el('p', { text: titel.overview || '' }),
        udbudsAfsnit(t.data),
      ]),
    ]),
    samlingsAfsnit(t.data),
    beslaegtedeAfsnit(),
    t.data.episodes ? saesonListe(t.data.episodes, titel.id) : null,
  ]);
}

/*
 * Saesonerne, sammenklappede.
 *
 * SPECIALS (saeson 0) laegges SIDST. De sorterer foerst i tal, men det er
 * ikke den raekkefoelge nogen ser en serie i - med dem oeverst aabner en
 * lang serie paa en julespecial fra saeson fem.
 */
function saesonListe(afsnit, titleId) {
  const idag = state.titel.data.today || new Date().toISOString().slice(0, 10);
  const grupper = new Map();
  for (const e of afsnit) {
    if (!grupper.has(e.season)) grupper.set(e.season, []);
    grupper.get(e.season).push(e);
  }
  const numre = [...grupper.keys()].sort((a, b) => {
    if (a === 0) return 1;          // specials sidst
    if (b === 0) return -1;
    return a - b;
  });

  return el('div', {}, numre.map((nr) => {
    const liste = grupper.get(nr);
    const sete = liste.filter((e) => e.seen).length;
    const aaben = state.titel.aabne.has(nr);
    return el('section', { class: 'saeson' }, [
      el('button', {
        class: 'saesonhoved', 'aria-expanded': aaben ? 'true' : 'false',
        onclick: () => {
          if (aaben) state.titel.aabne.delete(nr); else state.titel.aabne.add(nr);
          tegnSide();
        },
      }, [
        el('span', { class: 'saesonpil', text: aaben ? '▾' : '▸' }),
        el('span', { text: nr === 0 ? 'Specials' : `Season ${nr}` }),
        el('span', { class: 'dim lille', text: `${sete}/${liste.length}` }),
      ]),
      aaben
        ? el('div', { class: 'afsnitsliste' }, liste.map((e) => afsnitsRaekke(e, titleId, idag)))
        : null,
    ]);
  }));
}

function afsnitsRaekke(e, titleId, idag) {
  const sendt = e.airDate && e.airDate <= idag;
  return el('div', { class: `afsnitsrag${e.seen ? ' set' : ''}` }, [
    el('span', { class: 'afsnitsmaerke', text: `S${e.season}E${e.number}` }),
    el('button', { class: 'afsnitslink', text: e.name || '—',
      title: 'Show the episode description',
      onclick: () => visAfsnit(e.id) }),
    el('span', { class: 'dim lille', text: e.airDate || '' }),
    el('button', {
      class: `btn ${e.seen ? 'ghost' : 'primary'} lille`,
      // Et uudsendt afsnit kan ikke vaere set. Knappen slaas FRA frem for at
      // forsvinde, saa raekken stadig ser ud til at have en handling.
      disabled: !sendt && !e.seen,
      text: e.seen ? 'Seen' : (sendt ? 'Mark seen' : 'Not aired'),
      onclick: () => skiftSet(titleId, e),
    }),
  ]);
}

async function skiftSet(titleId, e) {
  try {
    if (e.seen) {
      await api(`/watches/episode/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
      await genindlaesTitel(titleId);
      return;
    }
    /*
     * Er man hoppet ind midt i en serie, saa spoerg.
     *
     * Serveren taeller de USETE, SENDTE afsnit foer dette - fladen gaetter
     * ikke selv, for den kender hverken specials-indstillingen eller hvad
     * der er sendt. Er tallet 0, spoerges der ikke om noget.
     */
    const foer = await api(`/watches/before?episodeId=${encodeURIComponent(e.id)}`);
    if (foer.count > 0) {
      const svar = await spoerg(
        `Mark the ${foer.count} earlier episode${foer.count === 1 ? '' : 's'} too?`,
        `You are marking S${e.season}E${e.number}, but ${foer.count} earlier `
        + `episode${foer.count === 1 ? ' has' : 's have'} not been marked as seen.`,
        [
          { id: 'alle', text: `Mark all ${foer.count + 1}`, primary: true },
          { id: 'kun', text: 'Just this one' },
          { id: 'fortryd', text: 'Cancel' },
        ]);
      if (svar === 'fortryd') return;
      if (svar === 'alle') {
        const r = await api('/watches/upto', { method: 'POST', body: { episodeId: e.id } });
        toast(`Marked ${r.tilfoejet} episodes as seen.`);
        await genindlaesTitel(titleId);
        return;
      }
    }
    await api('/watches', { method: 'POST', body: { titleId, episodeId: e.id, source: 'manual' } });
    await genindlaesTitel(titleId);
  } catch (err) {
    toast(err.message, 'fejl');
  }
}

async function genindlaesTitel(titleId) {
  // Foldetilstanden skal OVERLEVE en gentegning - ellers klapper alle
  // saesoner sammen, hver gang man markerer et afsnit.
  const aabne = state.titel.aabne;
  const beslaegtede = state.titel.beslaegtede;
  state.titel.data = await api(`/titles/${encodeURIComponent(titleId)}`);
  state.titel.aabne = aabne;
  // De beslaegtede skal ikke hentes igen, fordi et afsnit blev markeret.
  state.titel.beslaegtede = beslaegtede;
  await Promise.all([hentUpNext(), hentBibliotek()]);
  tegnSide();
}

/* ------------------------------------------------------------- dialog */

/*
 * Et spoergsmaal med flere svar. Returnerer id'et paa det valgte.
 *
 * confirm() kan kun ja/nej, og her er der tre svar - "alle", "kun den" og
 * "fortryd". At presse tre valg ned i to ville betyde, at man ikke kan
 * markere ét enkelt afsnit midt i en serie uden at tage resten med.
 */
function spoerg(titel, tekst, valg) {
  return new Promise((resolve) => {
    const luk = (id) => { baggrund.remove(); document.removeEventListener('keydown', paaTast); resolve(id); };
    const paaTast = (ev) => { if (ev.key === 'Escape') luk('fortryd'); };
    const baggrund = el('div', { class: 'modalbag', onclick: (ev) => {
      if (ev.target === baggrund) luk('fortryd');
    } }, [
      el('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' }, [
        el('h3', { text: titel }),
        el('p', { class: 'dim', text: tekst }),
        el('div', { class: 'knaprad' }, valg.map((v) => el('button', {
          class: `btn ${v.primary ? 'primary' : 'ghost'}`, text: v.text,
          onclick: () => luk(v.id),
        }))),
      ]),
    ]);
    document.body.appendChild(baggrund);
    document.addEventListener('keydown', paaTast);
    const foerste = baggrund.querySelector('button');
    if (foerste) foerste.focus();
  });
}

/* --------------------------------------------------------- afsnitsrude */

/*
 * Beskrivelsen af ét afsnit.
 *
 * Resuméet hentes paa forespoergsel og ligger IKKE i listesvarene - en serie
 * med 351 afsnit ville ellers sende 351 resuméer med hver eneste
 * sideindlaesning (§4).
 *
 * Ruden kan ogsaa MARKERE afsnittet. Det er hele pointen paa Up Next: man
 * aabner den for at finde ud af, om man har set det - og skal saa kunne
 * svare paa det med det samme, uden at lukke ruden og lede efter knappen.
 */
async function visAfsnit(episodeId) {
  const krop = el('div', {});
  const knaprad = el('div', { class: 'knaprad' });
  const luk = () => { bag.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') luk(); };
  const bag = el('div', { class: 'modalbag', onclick: (e) => { if (e.target === bag) luk(); } }, [
    el('div', { class: 'modal-card afsnitsrude', role: 'dialog', 'aria-modal': 'true' }, [
      krop, knaprad,
    ]),
  ]);
  document.body.appendChild(bag);
  document.addEventListener('keydown', paaTast);
  krop.appendChild(el('p', { class: 'dim', text: 'Loading…' }));

  let e;
  try {
    e = await api(`/episodes/${encodeURIComponent(episodeId)}`);
  } catch (err) {
    if (!bag.isConnected) return;
    krop.textContent = '';
    krop.appendChild(el('p', { class: 'dim', text: err.message }));
    knaprad.appendChild(el('button', { class: 'btn ghost', text: 'Close', onclick: luk }));
    return;
  }
  if (!bag.isConnected) return;

  const tegn = () => {
    krop.textContent = '';
    knaprad.textContent = '';
    // Stillbilledet er 16:9 og staar oeverst - det er afsnittets eget
    // billede, ikke seriens plakat, og det er tit dét, der giver
    // genkendelsen: "naa ja, DET afsnit".
    if (e.still) krop.appendChild(el('img', { class: 'afsnitsstill', src: e.still, alt: '' }));
    krop.appendChild(el('div', { class: 'dim lille', text: e.titleName }));
    krop.appendChild(el('h3', { text: `S${e.season}E${e.number}${e.name ? ' · ' + e.name : ''}` }));
    const sendt = e.airDate && e.airDate <= e.today;
    krop.appendChild(el('div', { class: 'dim', text: [
      e.airDate ? (sendt ? `Aired ${e.airDate}` : `Airs ${e.airDate}`) : 'Air date unknown',
      e.runtime ? `${e.runtime} min` : null,
    ].filter(Boolean).join(' · ') }));
    krop.appendChild(el('p', { class: 'overblik-resume',
      // Et manglende resume er almindeligt paa nye afsnit - sig det, frem
      // for at efterlade et tomt felt der ligner en indlaesningsfejl.
      text: e.overview || 'TMDB has no description for this episode yet.' }));

    knaprad.appendChild(el('button', {
      class: `btn ${e.seen ? 'ghost' : 'primary'}`,
      disabled: !sendt && !e.seen,
      text: e.seen ? 'Mark as not seen' : (sendt ? 'Mark seen' : 'Not aired yet'),
      onclick: async (knap) => {
        knap.target.disabled = true;
        try {
          if (e.seen) {
            await api(`/watches/episode/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
            e.seen = false;
          } else {
            await api('/watches', { method: 'POST',
              body: { titleId: e.titleId, episodeId: e.id, source: 'manual' } });
            e.seen = true;
          }
          // Baade forsiden og biblioteket kan have aendret sig.
          await Promise.all([hentUpNext(), hentBibliotek()]);
          // Staar man PAA titelsiden, skal afsnitslisten ogsaa med.
          if (state.view === 'title' && state.titel.id === e.titleId) {
            await genindlaesTitel(e.titleId);
          } else {
            tegnSide();
          }
          tegn();
        } catch (err) {
          knap.target.disabled = false;
          toast(err.message, 'fejl');
        }
      },
    }));
    knaprad.appendChild(el('button', { class: 'btn ghost', text: 'Close', onclick: luk }));
  };
  tegn();
}


/* ------------------------------------------------------- hvor kan jeg se den */

/*
 * Streamingudbuddet (S1/S2/S3).
 *
 * Det, brugeren SELV abonnerer paa, staar foerst og fremhaevet. Resten er
 * ogsaa nyttigt - men spoergsmaalet er "kan jeg se den i aften uden at
 * betale ekstra", og svaret skal ikke skulle findes i en liste.
 */
function udbudsAfsnit(d) {
  const p = d.providers;
  if (!p) return null;
  const abonnement = p.flatrate || [];
  const leje = p.rent || [];
  const koeb = p.buy || [];
  if (!abonnement.length && !leje.length && !koeb.length) {
    return el('p', { class: 'dim lille', text:
      `Not on any streaming service in ${d.providerRegion || 'your region'} right now.` });
  }

  const linje = (etiket, liste) => liste.length
    ? el('div', { class: 'udbudslinje' }, [
        el('span', { class: 'dim lille', text: etiket }),
        el('span', { class: 'udbydere' }, liste.map((u) => el('span', {
          class: `udbyder${(d.onMyServices || []).includes(u.name) ? ' min' : ''}`,
        }, [
          u.logoPath ? el('img', { src: `/api/poster/w154${u.logoPath}`, alt: '' }) : null,
          el('span', { text: u.name }),
        ]))),
      ])
    : null;

  return el('div', { class: 'udbud' }, [
    d.onMyServices
      ? el('p', { class: 'chip klar', text: `You can watch this on ${d.onMyServices.join(', ')}` })
      : null,
    /*
     * "Kommet til" og "forsvundet" siden sidste hentning (S3).
     *
     * Vises kun, naar der FAKTISK er en forskel - en tom linje i hvert svar
     * ville ligne, at der altid var nyt.
     */
    d.providerChange && d.providerChange.kommet.length
      ? el('p', { class: 'lille', text: `New on ${d.providerChange.kommet.join(', ')}` }) : null,
    d.providerChange && d.providerChange.forsvundet.length
      ? el('p', { class: 'lille', text: `No longer on ${d.providerChange.forsvundet.join(', ')}` }) : null,
    linje('Subscription', abonnement),
    linje('Rent', leje),
    linje('Buy', koeb),
    el('p', { class: 'dim lille', text: 'Availability from TMDB/JustWatch.' }),
  ]);
}


/* ---------------------------------------------------------- samlingen */

/*
 * "Findes der en toer?" (Andreas, 2026-08-29).
 *
 * TMDB knytter selv efterfoelgere sammen i en SAMLING, saa Spider-Man 1, 2
 * og 3 hoerer sammen som et faktum - ikke som et gaet ud fra titler. Et gaet
 * ville tage fejl begge veje: "Spider-Man 2" og "The Amazing Spider-Man 2"
 * ligner hinanden og hoerer ikke sammen.
 *
 * Overskriften siger det, man SPURGTE om, frem for bare at liste delene:
 * "du har set 1 af 3" er et svar, en liste er det ikke.
 */
function samlingsAfsnit(d) {
  const c = d.collection;
  if (!c || c.dele.length < 2) return null;

  const usete = c.dele.filter((x) => !x.set && !x.denne);
  const besked = usete.length
    ? `You have seen ${c.sete} of ${c.ialt}. `
      + `${usete.length === 1 ? 'One more' : `${usete.length} more`} in this series: `
      + usete.map((x) => x.name).join(', ') + '.'
    : `You have seen all ${c.ialt}.`;

  return el('section', { class: 'samling' }, [
    el('h2', { text: c.name }),
    el('p', { class: usete.length ? 'chip klar' : 'dim', text: besked }),
    el('div', { class: 'plakater' }, c.dele.map((del) => el('div', {
      class: `soegekort${del.denne ? ' denne' : ''}`,
    }, [
      del.posterPath
        ? el('img', { class: 'plakat', src: `/api/poster/w342${del.posterPath}`,
            alt: '', loading: 'lazy' })
        : el('div', { class: 'plakat' }),
      el('div', { class: 'soegekort-titel', text: del.name }),
      el('div', { class: 'dim lille', text: [
        del.year || '',
        del.denne ? 'you are here' : (del.set ? 'seen' : (del.iBiblioteket ? 'in library' : '')),
      ].filter(Boolean).join(' · ') }),
      // Ingen knap paa den, man staar paa - og ingen paa dem, man allerede
      // har. Kun det, der er noget at goere ved.
      (!del.denne && !del.iBiblioteket)
        ? el('button', { class: 'btn primary lille', text: 'Add',
            onclick: (e) => tilfoej({ kind: 'movie', tmdbId: del.tmdbId, name: del.name }, e.target) })
        : null,
      (!del.denne && del.iBiblioteket)
        ? el('button', { class: 'btn ghost lille', text: 'Open',
            onclick: () => aabnTitel(del.id) })
        : null,
    ]))),
  ]);
}

/* -------------------------------------------------------- beslaegtede */

/*
 * De LOESERE slaegtninge - genstarter og spin-offs, som en samling ikke
 * binder sammen. For Spider-Man er det forskellen paa "2 og 3" (samlingen)
 * og "de andre Spider-Man-film" (anbefalingerne).
 *
 * Hentes foerst naar man beder om det: det er ét TMDB-kald mere, og de
 * fleste aabner en titel for at se fremdriften, ikke naboerne.
 */
function beslaegtedeAfsnit() {
  const b = state.titel.beslaegtede;
  if (b === null) {
    return el('button', { class: 'btn ghost lille', text: 'Show related titles',
      onclick: (e) => hentBeslaegtede(e.target) });
  }
  if (!b.length) return el('p', { class: 'dim lille', text: 'TMDB has nothing related.' });
  return el('section', {}, [
    el('h2', { text: 'Related' }),
    el('div', { class: 'plakater' }, b.map((r) => el('div', { class: 'soegekort' }, [
      r.poster
        ? el('img', { class: 'plakat', src: r.poster, alt: '', loading: 'lazy' })
        : el('div', { class: 'plakat' }),
      el('div', { class: 'soegekort-titel', text: r.name }),
      el('div', { class: 'dim lille', text: `${r.kind === 'tv' ? 'Series' : 'Film'}`
        + `${r.year ? ' · ' + r.year : ''}` }),
      r.tracked
        ? el('button', { class: 'btn ghost lille', text: 'Open',
            onclick: () => aabnTitel(r.id) })
        : el('button', { class: 'btn primary lille', text: 'Add',
            onclick: (e) => tilfoej(r, e.target) }),
    ]))),
  ]);
}

async function hentBeslaegtede(knap) {
  knap.disabled = true;
  knap.textContent = 'Loading…';
  try {
    const r = await api(`/related?id=${encodeURIComponent(state.titel.id)}`);
    state.titel.beslaegtede = r.results || [];
  } catch (err) {
    state.titel.beslaegtede = [];
    toast(err.message, 'fejl');
  }
  tegnSide();
}

/* ---- p6_kalender.js ---- */

/* ------------------------------------------------------------ kalender */

/*
 * Kalenderen (K6).
 *
 * Grupperet pr. DAG og ikke som et maanedsgitter. Et gitter er pænt, men det,
 * man vil vide, er "hvad kommer der, og hvornaar" - og med tre-fire serier er
 * de fleste felter i et gitter tomme. En liste med dagoverskrifter siger det
 * samme paa en tiendedel af pladsen og virker paa en telefon.
 */
function kalenderSide() {
  const k = state.kalender;
  if (k.fejl) return tomtRum('Could not load the calendar', k.fejl);
  if (!k.hentet) return el('p', { class: 'dim', text: 'Loading…' });
  if (!k.raekker.length) {
    return el('div', {}, [
      el('h1', { text: 'Calendar' }),
      tomtRum('Nothing scheduled',
        'Follow a series with upcoming episodes and they show up here.'),
      icalAfsnit(),
    ]);
  }

  // Gruppér pr. dato. Map bevarer indsaettelsesorden, og serveren har
  // allerede sorteret - saa der skal ikke sorteres igen.
  const dage = new Map();
  for (const r of k.raekker) {
    if (!dage.has(r.airDate)) dage.set(r.airDate, []);
    dage.get(r.airDate).push(r);
  }

  return el('div', {}, [
    el('h1', { text: 'Calendar' }),
    el('p', { class: 'dim lille', text: `${k.fra} – ${k.til}` }),
    el('div', { class: 'kalender' }, [...dage.entries()].map(([dato, liste]) =>
      el('section', { class: `kalenderdag${dato === k.idag ? ' idag' : ''}` }, [
        el('div', { class: 'kalenderdato' }, [
          el('strong', { text: dagTekst(dato, k.idag) }),
          el('span', { class: 'dim lille', text: dato }),
        ]),
        el('div', { class: 'liste' }, liste.map(kalenderRaekke)),
      ]))),
    icalAfsnit(),
  ]);
}

/** "Today", "Tomorrow", "Yesterday" eller ugedagen. */
function dagTekst(dato, idag) {
  const d = Math.round((Date.UTC(+dato.slice(0, 4), +dato.slice(5, 7) - 1, +dato.slice(8, 10))
    - Date.UTC(+idag.slice(0, 4), +idag.slice(5, 7) - 1, +idag.slice(8, 10))) / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  const uge = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const navn = uge[new Date(`${dato}T12:00:00Z`).getUTCDay()];
  // Ugedagen alene er kun entydig inden for en uge. Laengere ude er datoen
  // ved siden af det, der baerer betydningen.
  return Math.abs(d) < 7 ? navn : `${navn}`;
}

function kalenderRaekke(r) {
  return el('div', { class: `item-row kalenderrag${r.seen ? ' set' : ''}` }, [
    r.posterPath
      ? el('img', { class: 'omni-plakat', src: `/api/poster/w154${r.posterPath}`, alt: '', loading: 'lazy' })
      : el('div', { class: 'omni-plakat' }),
    el('div', { class: 'omni-row-main' }, [
      el('button', { class: 'afsnitslink omni-row-title', text: r.titleName,
        title: `Open ${r.titleName}`, onclick: () => aabnTitel(r.titleId) }),
      el('button', { class: 'afsnitslink omni-row-sub',
        text: `S${r.season}E${r.number}${r.name ? ' · ' + r.name : ''}`,
        title: 'Show the episode description', onclick: () => visAfsnit(r.id) }),
    ]),
    r.seen ? el('span', { class: 'chip', text: 'Seen' }) : null,
  ]);
}

/*
 * Abonnementslinket.
 *
 * Adressen ER hemmeligheden - der er ingen cookie i et kalender-abonnement.
 * Derfor staar den i et laest felt med en kopiknap frem for som et klikbart
 * link: et link inviterer til at dele det, og et delt feed er en delt
 * seerhistorik.
 */
function icalAfsnit() {
  const k = state.kalender;
  const fuld = k.icalPath ? location.origin + k.icalPath : '';
  const felt = el('input', { readonly: true, value: fuld, style: 'font-size:16px',
    onclick: (e) => e.target.select() });

  return el('div', { class: 'icalboks' }, [
    el('h2', { text: 'Subscribe in your calendar' }),
    k.icalPath
      ? el('div', {}, [
          el('p', { class: 'dim lille', text:
            'Add this address as a subscribed calendar. Anyone with it can see '
            + 'what you are watching, so treat it like a password.' }),
          el('div', { class: 'formgrid' }, [
            el('label', { text: 'Feed address' }), felt,
            el('button', { class: 'btn ghost', text: 'Copy', onclick: async () => {
              try {
                // Udklipsholderen kraever et sikkert kontekst (https eller
                // localhost). Over panelets IP:port fejler den - og saa skal
                // brugeren have at vide, at han kan markere feltet i stedet.
                await navigator.clipboard.writeText(fuld);
                toast('Copied.');
              } catch {
                felt.select();
                toast('Could not copy — the address is selected, press Cmd/Ctrl+C.', 'fejl');
              }
            } }),
          ]),
          el('button', { class: 'btn ghost lille', text: 'Revoke this address',
            onclick: async () => {
              const svar = await spoerg('Revoke the calendar feed?',
                'Any calendar subscribed to this address stops updating. '
                + 'You can create a new address afterwards.',
                [{ id: 'ja', text: 'Revoke', primary: true }, { id: 'nej', text: 'Cancel' }]);
              if (svar !== 'ja') return;
              await api('/ical', { method: 'DELETE' });
              state.kalender.icalPath = null;
              tegnSide();
              toast('Revoked.');
            } }),
        ])
      : el('div', {}, [
          el('p', { class: 'dim lille', text:
            'Create an address you can subscribe to from your phone or computer calendar.' }),
          el('button', { class: 'btn primary', text: 'Create feed address', onclick: async () => {
            const r = await api('/ical', { method: 'POST' });
            state.kalender.icalPath = r.path;
            tegnSide();
          } }),
        ]),
  ]);
}

async function hentKalender() {
  try {
    const [k, f] = await Promise.all([api('/calendar'), api('/ical')]);
    Object.assign(state.kalender, {
      hentet: true, fejl: '', raekker: k.rows || [],
      idag: k.today, fra: k.from, til: k.to, icalPath: f.path,
    });
  } catch (err) {
    Object.assign(state.kalender, { hentet: true, fejl: err.message });
  }
}

/* ---- p7_import.js ---- */

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
      'Netflix viewing activity, Trakt, Letterboxd, IMDb or TV Time — as a .csv file, '
      + 'or the whole GDPR export as a .zip. '
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
    state.import.zipNavn
      ? el('p', { class: 'dim lille', text: `From ${state.import.zipNavn} inside the zip.` })
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
  return { tekst: '', analyse: null, status: null, fejl: '', dateOrder: null, zipNavn: null };
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
       * En GDPR-eksport er et zip-arkiv med snesevis af filer. Vi pakker ud
       * i BROWSEREN og sender kun den CSV, der viser sig at vaere en
       * historik - resten (profiler, enheder, betalinger) hoerer ikke
       * hjemme paa serveren overhovedet.
       */
      const filer = await zipFindCsv(await fil.arrayBuffer());
      if (!filer.length) {
        state.import.fejl = 'No .csv files inside that zip.';
        tegnSide();
        return;
      }
      // Lad formatgenkendelsen afgoere hvilken. Den stoerste genkendte fil
      // vinder: en eksport har tit baade "watched" og en lille "watchlist".
      let bedst = null;
      for (const f of filer) {
        try {
          const a = await api('/import/analyse', { method: 'POST', body: { text: f.tekst } });
          if (a.rows && (!bedst || a.rows > bedst.analyse.rows)) bedst = { fil: f, analyse: a };
        } catch { /* ikke et format vi kender - proev naeste */ }
      }
      if (!bedst) {
        state.import.fejl = `None of the ${filer.length} csv files in that zip is a format `
          + `spolen knows: ${filer.map((f) => f.navn.split('/').pop()).slice(0, 5).join(', ')}`;
        tegnSide();
        return;
      }
      state.import.tekst = bedst.fil.tekst;
      state.import.analyse = bedst.analyse;
      state.import.dateOrder = bedst.analyse.dateOrder;
      state.import.zipNavn = bedst.fil.navn;
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
async function zipFindCsv(buf) {
  const poster = zipPoster(buf).filter((p) =>
    /\.csv$/i.test(p.navn) && !p.navn.endsWith('/') && p.komp > 0
    // __MACOSX er de ressourcegafler, macOS lægger i et zip-arkiv. De ligner
    // rigtige filer og indeholder ingenting.
    && !p.navn.startsWith('__MACOSX/'));
  const ud = [];
  for (const p of poster.slice(0, 40)) {
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

/* ---- p8_stats.js ---- */

/* ------------------------------------------------------- mine tjenester */

/*
 * Afkrydsning af egne abonnementer (S2).
 *
 * Listen kommer fra TMDB og er DE tjenester, der findes i landet - man
 * skriver ikke navne i et felt. Ellers ville "HBO Max" og "Max" vaere to
 * forskellige ting, og filtreringen ville tie stille om halvdelen.
 */
function tjenesteAfsnit() {
  const t = state.tjenester;
  if (t.fejl) return el('p', { class: 'dim', text: t.fejl });
  if (!t.hentet) return el('p', { class: 'dim', text: 'Loading services…' });

  const valgte = new Set(t.mine);
  return el('div', {}, [
    el('p', { class: 'dim lille', text:
      `Tick what you subscribe to in ${t.region}. spolen can then tell you what you `
      + 'can watch tonight without paying extra.' }),
    el('div', { class: 'tjenestegitter' }, t.providers.map((p) => el('label', { class: 'tjeneste' }, [
      el('input', {
        type: 'checkbox', checked: valgte.has(p.name),
        onchange: (e) => {
          if (e.target.checked) valgte.add(p.name); else valgte.delete(p.name);
          state.tjenester.mine = [...valgte];
        },
      }),
      p.logoPath
        ? el('img', { class: 'tjenestelogo', src: `/api/poster/w154${p.logoPath}`, alt: '' })
        : null,
      el('span', { class: 'lille', text: p.name }),
    ]))),
    el('button', { class: 'btn primary', text: 'Save services', onclick: async (e) => {
      e.target.disabled = true;
      try {
        await api('/settings', { method: 'PUT', body: { services: state.tjenester.mine } });
        toast(`${state.tjenester.mine.length} services saved.`);
      } catch (err) { toast(err.message, 'fejl'); }
      e.target.disabled = false;
    } }),
  ]);
}

async function hentTjenester() {
  try {
    const p = await api('/providers');
    Object.assign(state.tjenester, {
      hentet: true, fejl: '', region: p.region, providers: p.providers || [], mine: p.mine || [],
    });
  } catch (err) {
    Object.assign(state.tjenester, { hentet: true, fejl: err.message });
  }
}

/* ------------------------------------------------------------ statistik */

function statsSide() {
  const s = state.stats;
  if (s.fejl) return tomtRum('Could not load statistics', s.fejl);
  if (!s.hentet) return el('p', { class: 'dim', text: 'Loading…' });
  const t = s.data.total;
  if (!t.antal) {
    return el('div', {}, [
      el('h1', { text: 'Statistics' }),
      tomtRum('Nothing watched yet', 'Mark something as seen and the numbers show up here.'),
    ]);
  }

  return el('div', {}, [
    el('h1', { text: 'Statistics' }),
    el('div', { class: 'taltavle' }, [
      taltavle('Time watched', varighedTekst(t.minutter)),
      taltavle('Films', String(t.film)),
      taltavle('Episodes', String(t.afsnit)),
      taltavle('Series', String(t.serier)),
      taltavle('Days with something', String(t.dage)),
    ]),

    /*
     * Hvor meget af tallet der er GAETTET, staar lige under det.
     *
     * TMDB mangler spilletid paa mange afsnit. Uden den her linje ville
     * "210 timer" se ud som en maaling - og et gaet, der er lagt sammen
     * tusind gange, ligner en maaling til forveksling.
     */
    t.gaettedePoster
      ? el('p', { class: 'dim lille', text:
          `${t.gaettedePoster} of ${t.antal} entries had no runtime on TMDB and were `
          + `counted as ${t.gaetMinutter} minutes each — that is `
          + `${varighedTekst(t.gaettedeMinutter)} of the total.` })
      : null,

    /*
     * Massemarkerede afsnit staar for sig. Vi ved AT de er set, ikke
     * HVORNAAR - og et tal, der lader som om, ville goere "laengste aften"
     * til noget vroevl.
     */
    /*
     * Kun de poster, der hverken har en dato fra kilden eller en
     * udsendelsesdag, staar for sig. Massemarkerede afsnit baerer nu
     * udsendelsesdagen og hoerer med i tallene.
     */
    t.udenSikkerDato
      ? el('p', { class: 'dim lille', text:
          `${t.udenSikkerDato} entries had no date at all — neither from the import nor `
          + 'an air date — so they count in the totals above but not in the year and '
          + 'evening figures below.' })
      : null,

    t.laengsteDag ? el('p', { text:
      `Longest evening: ${t.laengsteDag.dato} — ${t.laengsteDag.antal} `
      + `${t.laengsteDag.antal === 1 ? 'thing' : 'things'}, `
      + `${varighedTekst(t.laengsteDag.minutter)}.` }) : null,

    s.data.byYear.length ? el('div', {}, [
      el('h2', { text: 'By year' }),
      søjler(s.data.byYear.map((r) => ({ navn: r.year, minutter: r.minutes }))),
    ]) : null,

    s.data.topGenres.length ? el('div', {}, [
      el('h2', { text: 'By genre' }),
      søjler(s.data.topGenres),
    ]) : null,

    s.data.topServices.length ? el('div', {}, [
      el('h2', { text: 'By service' }),
      el('p', { class: 'dim lille', text:
        'A title can be on several services, so these add up to more than the total.' }),
      søjler(s.data.topServices),
    ]) : null,
  ]);
}

function taltavle(etiket, vaerdi) {
  return el('div', { class: 'tal' }, [
    el('div', { class: 'talvaerdi', text: vaerdi }),
    el('div', { class: 'dim lille', text: etiket }),
  ]);
}

/* Vandrette soejler. Bredden er RELATIV til den stoerste - et diagram med en
   fast skala ville vise ingenting for den, der har set lidt. */
function søjler(raekker) {
  const max = Math.max(...raekker.map((r) => r.minutter), 1);
  return el('div', { class: 'soejler' }, raekker.map((r) => el('div', { class: 'soejle' }, [
    el('span', { class: 'soejlenavn', text: r.navn }),
    el('span', { class: 'soejlebar' }, [
      el('i', { style: `width:${Math.max(2, Math.round((r.minutter / max) * 100))}%` }),
    ]),
    el('span', { class: 'dim lille soejletal', text: varighedTekst(r.minutter) }),
  ])));
}

/* Samme regel som shared/statistik.js' varighed(). Duplikeret med vilje:
   frontenden maa ikke require() et modul, og en formatering er ikke en
   UDREGNING - den kan ikke give et forkert tal, kun en grim tekst. */
function varighedTekst(minutter) {
  const m = Math.round(minutter || 0);
  if (m < 60) return `${m} min`;
  const timer = Math.round(m / 60);
  if (timer < 48) return `${timer} h`;
  return `${Math.round(timer / 24)} d ${timer % 24} h`;
}

async function hentStats() {
  try {
    state.stats.data = await api('/stats');
    state.stats.hentet = true;
    state.stats.fejl = '';
  } catch (err) {
    state.stats.hentet = true;
    state.stats.fejl = err.message;
  }
}

/* ------------------------------------------------------- adgangsnoegler */

/*
 * Noegler til iOS Genveje, Claude og alt andet uden for browseren.
 *
 * Noeglen vises ÉN gang. Der findes ingen vej til at se den igen - kun
 * hashen er gemt - og fladen skal sige det HOEJT, mens den staar der. En
 * kopiknap er ikke nok: folk lukker ruden og opdager det bagefter.
 */
function noegleAfsnit() {
  const n = state.noegler;
  // Overskriften kommer FRA settingssiden (med "?"-knappen). Havde den ogsaa
  // staaet her, ville "Access keys" staa to gange - maalt 2026-08-29.
  return el('div', {}, [
    el('p', { class: 'dim lille', text:
      'For iOS Shortcuts, Claude and anything else outside the browser. '
      + 'A key belongs to you alone and sees only your library.' }),

    n.ny ? nyNoegleKort(n.ny) : null,

    n.liste.length
      ? el('div', { class: 'liste' }, n.liste.map(noegleRaekke))
      : el('p', { class: 'dim', text: 'You have no keys.' }),

    el('div', { class: 'formgrid' }, [
      el('label', { text: 'Name' }),
      el('input', { id: 'noeglenavn', placeholder: 'Claude Desktop', style: 'font-size:16px' }),
      el('label', { text: 'Scope' }),
      el('select', { id: 'noeglescope', style: 'font-size:16px' }, [
        el('option', { value: 'read', text: 'Read — see the library, mark nothing' }),
        el('option', { value: 'full', text: 'Full — also mark things watched and add titles' }),
        el('option', { value: 'capture', text: 'Capture — add titles only' }),
      ]),
      el('button', { class: 'btn primary', text: 'Create key', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const svar = await api('/keys', { method: 'POST', body: {
            name: $('#noeglenavn').value.trim() || 'Untitled key',
            scope: $('#noeglescope').value,
          } });
          state.noegler.ny = svar;
          await hentNoegler();
          tegnSide();
        } catch (err) { toast(err.message, 'fejl'); }
        e.target.disabled = false;
      } }),
    ]),
  ]);
}

function nyNoegleKort(ny) {
  const felt = el('input', { readonly: true, value: ny.key, style: 'font-size:16px',
    onclick: (e) => e.target.select() });
  return el('div', { class: 'card advarsel' }, [
    el('p', { text: `"${ny.name}" is ready. This is the only time the key is shown.` }),
    el('div', { class: 'formgrid' }, [
      el('label', { text: 'Key' }), felt,
      el('button', { class: 'btn ghost', text: 'Copy', onclick: async () => {
        try { await navigator.clipboard.writeText(ny.key); toast('Copied.'); }
        catch {
          // Udklipsholderen kraever et sikkert kontekst. Over IP:port fejler
          // den - og saa skal brugeren vide, at feltet er markeret i stedet.
          felt.select();
          toast('Could not copy — the key is selected, press Cmd/Ctrl+C.', 'fejl');
        }
      } }),
    ]),
    el('p', { class: 'dim lille', text:
      `MCP endpoint: ${location.origin}/mcp — send the key as a Bearer token.` }),
    el('button', { class: 'btn ghost lille', text: 'I have saved it',
      onclick: () => { state.noegler.ny = null; tegnSide(); } }),
  ]);
}

function noegleRaekke(k) {
  return el('div', { class: 'item-row' }, [
    el('div', { class: 'omni-row-main' }, [
      el('div', { class: 'omni-row-title', text: k.name }),
      el('div', { class: 'omni-row-sub', text:
        `${k.prefix}… · ${k.scope}`
        + (k.oauth ? ' · connected app' : '')
        + (k.lastUsedAt
          ? ` · last used ${new Date(k.lastUsedAt * 1000).toISOString().slice(0, 10)}`
          : ' · never used') }),
    ]),
    el('button', { class: 'btn ghost lille', text: 'Revoke', onclick: async () => {
      const svar = await spoerg('Revoke this key?',
        `Anything using "${k.name}" stops working immediately.`,
        [{ id: 'ja', text: 'Revoke', primary: true }, { id: 'nej', text: 'Cancel' }]);
      if (svar !== 'ja') return;
      await api(`/keys/${k.id}`, { method: 'DELETE' });
      await hentNoegler();
      tegnSide();
      toast('Revoked.');
    } }),
  ]);
}

async function hentNoegler() {
  try {
    state.noegler.liste = (await api('/keys')).keys || [];
  } catch { state.noegler.liste = []; }
}

/* ---- p9_hjaelp.js ---- */

/* ------------------------------------------------------------- hjaelp */

/*
 * "?"-knapper ved hver integration.
 *
 * Hver af dem kraever, at man henter en noegle et fremmed sted og forstaar,
 * HVILKEN af flere noegler man skal bruge. Uden vejledningen er feltet bare
 * et tomt felt, og fejlbeskeden "an administrator adds one under Settings"
 * peger på et sted, brugeren allerede staar (Andreas, 2026-08-29).
 *
 * Teksten bor i koden og ikke i en ekstern wiki: den skal virke offline og
 * foelge med runen, naar den installeres.
 */
const HJAELP = {
  tmdb: {
    titel: 'Getting a TMDB key',
    url: 'https://www.themoviedb.org/settings/api',
    trin: [
      'Create a free account on themoviedb.org.',
      'Open Settings → API and request a key. Choose "Developer"; it is free for personal use.',
      'You are given two things: an API Key (32 characters) and an API Read Access Token (a long one starting with "ey").',
      'Paste the Read Access Token — it travels in a header instead of in the address, so it never ends up in a log.',
    ],
    note: 'One key serves the whole household. Only an administrator can change it.',
  },
  trakt: {
    titel: 'Connecting Trakt',
    url: 'https://trakt.tv/oauth/applications/new',
    trin: [
      'Sign in on trakt.tv and open Settings → Your API Apps → New Application.',
      'Give it any name, for example "spolen".',
      'Under Redirect uri write: urn:ietf:wg:oauth:2.0:oob',
      'Save, and copy the Client ID and Client Secret into the two fields here.',
      'Then press Connect Trakt — you get a code to type on trakt.tv.',
    ],
    note: 'Sequel syncs to Trakt, so this is the way to bring a Sequel history across '
      + 'without an export file. The client id and secret belong to the installation; '
      + 'the login afterwards is personal, so everyone in the house connects their own account.',
  },
  plex: {
    titel: 'Connecting Plex',
    url: 'https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/',
    trin: [
      'The address is your own Plex server on your network, for example http://192.168.1.50:32400',
      'The token is not a password. Open Plex in a browser, play something, then open the browser’s developer tools → Network and look for X-Plex-Token in any request.',
      'Plex’s own guide (linked below) shows a second way through the XML view.',
      'Press Test connection before saving — a wrong address just goes quiet otherwise.',
    ],
    note: 'Plex is the only service that can tell spolen what you actually watched. '
      + 'Everything else is either an import or marked by hand.',
  },
  noegler: {
    titel: 'Access keys and Claude',
    url: null,
    trin: [
      'A key lets something outside the browser reach spolen: iOS Shortcuts, Claude Code, Claude Desktop.',
      'Read means it can look but not change anything. Full also lets it mark things watched.',
      'For Claude Code or Desktop, add spolen as an MCP server and send the key as a Bearer token.',
      'For claude.ai on the web you do not need a key at all — add spolen as a connector and approve it in the browser.',
    ],
    note: 'The key is shown once. Only its hash is stored, so it cannot be looked up again.',
  },
  ical: {
    titel: 'Subscribing in your calendar',
    url: null,
    trin: [
      'Create the address here, then add it as a subscribed calendar.',
      'On iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.',
      'On a Mac: Calendar → File → New Calendar Subscription.',
      'The calendar updates itself; spolen suggests every six hours.',
    ],
    note: 'The address is the secret — anyone who has it can see what you are watching. '
      + 'Revoke it here if it gets out.',
  },
};

/*
 * Hjaelpen foldes ud PAA SIDEN og ikke i en modal.
 *
 * Man laeser den, mens man udfylder feltet ved siden af - en modal ville
 * daekke praecis det felt, vejledningen handler om.
 */
function hjaelpeKnap(navn) {
  return el('button', {
    class: 'hjaelpknap',
    'aria-label': `Help: ${HJAELP[navn].titel}`,
    title: HJAELP[navn].titel,
    onclick: () => {
      state.hjaelp = state.hjaelp === navn ? null : navn;
      tegnSide();
    },
  }, ['?']);
}

function hjaelpePanel(navn) {
  if (state.hjaelp !== navn) return null;
  const h = HJAELP[navn];
  return el('div', { class: 'hjaelp' }, [
    el('h4', { text: h.titel }),
    el('ol', {}, h.trin.map((t) => el('li', { text: t }))),
    h.note ? el('p', { class: 'dim lille', text: h.note }) : null,
    h.url
      ? el('p', {}, [
          // target=_blank + rel: en fremmed side maa ikke kunne naa
          // window.opener og sende brugeren videre.
          el('a', { href: h.url, target: '_blank', rel: 'noopener noreferrer',
            text: h.url.replace(/^https?:\/\//, '').slice(0, 58) + '…' }),
        ])
      : null,
    el('button', { class: 'btn ghost lille', text: 'Close',
      onclick: () => { state.hjaelp = null; tegnSide(); } }),
  ]);
}

/** Overskrift med et "?" ved siden af. */
function afsnitshoved(tekst, hjaelpNavn, niveau) {
  return el(niveau || 'h2', { class: 'medhjaelp' }, [tekst, hjaelpeKnap(hjaelpNavn)]);
}

/* ---- pa_notifik.js ---- */

/* ------------------------------------------------------- notifikationer */

/*
 * Notifikationer om nye afsnit.
 *
 * KRAEVER https. Over panelets IP:port findes hverken Notification eller
 * PushManager, og et ubetinget kald ville kaste ved hver indlaesning (§4).
 * Derfor siger fladen det HOEJT frem for at vise en knap, der ikke kan virke.
 */
function notifikationAfsnit() {
  const n = state.push;
  const kanTeknisk = 'Notification' in window && 'serviceWorker' in navigator
    && 'PushManager' in window;

  if (!kanTeknisk || (state.config && !state.config.secureContext)) {
    return el('div', {}, [
      el('p', { class: 'dim', text:
        'Notifications need https. Open spolen on its own domain instead of the '
        + 'panel’s IP address, and this section becomes available.' }),
    ]);
  }

  const tilladelse = Notification.permission;
  return el('div', {}, [
    el('p', { class: 'dim lille', text:
      'A notification when a new episode of something you follow airs. '
      + 'One per episode — spolen checks every hour but never tells you twice.' }),

    tilladelse === 'denied'
      ? el('p', { class: 'noeglestatus mangler', text:
          'Your browser is blocking notifications for this site. You have to allow '
          + 'them in the browser’s own settings — a website cannot ask again once denied.' })
      : null,

    n.abon.length
      ? el('div', {}, [
          el('p', { class: 'noeglestatus har', text:
            `${n.abon.length} device${n.abon.length === 1 ? '' : 's'} subscribed.` }),
          el('div', { class: 'liste' }, n.abon.map((a) => el('div', { class: 'item-row' }, [
            el('span', { text: a.service }),
            el('span', { class: 'dim lille', text: a.lastOkAt
              ? `last delivered ${new Date(a.lastOkAt * 1000).toISOString().slice(0, 10)}`
              : 'never delivered yet' }),
          ]))),
          el('div', { class: 'knaprad' }, [
            el('button', { class: 'btn primary', text: 'Send a test notification',
              onclick: (e) => proevNotifikation(e.target) }),
            el('button', { class: 'btn ghost', text: 'Turn off on this device',
              onclick: (e) => afmeld(e.target) }),
          ]),
        ])
      : el('button', {
          class: 'btn primary', text: 'Turn on notifications',
          disabled: tilladelse === 'denied',
          onclick: (e) => tilmeld(e.target),
        }),

    n.fejl ? el('p', { class: 'noeglestatus mangler', text: n.fejl }) : null,
  ]);
}

/** base64url -> Uint8Array. PushManager vil have raa bytes, ikke en streng. */
function b64uTilBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function tilmeld(knap) {
  knap.disabled = true;
  state.push.fejl = '';
  try {
    const tilladelse = await Notification.requestPermission();
    if (tilladelse !== 'granted') {
      state.push.fejl = tilladelse === 'denied'
        ? 'You said no. The browser will not ask again — allow it in the site settings.'
        : 'No answer to the permission request.';
      tegnSide();
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/push');
    const abon = await reg.pushManager.subscribe({
      // userVisibleOnly er PAAKRAEVET i Chrome: man maa ikke abonnere paa
      // push uden at vise brugeren noget.
      userVisibleOnly: true,
      applicationServerKey: b64uTilBytes(key),
    });
    const j = abon.toJSON();
    await api('/push/subscribe', { method: 'POST', body: {
      endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
    } });
    await hentPush();
    tegnSide();
    toast('Notifications are on.');
  } catch (err) {
    state.push.fejl = err.message;
    tegnSide();
  }
}

async function afmeld(knap) {
  knap.disabled = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    const abon = await reg.pushManager.getSubscription();
    if (abon) {
      await api('/push/unsubscribe', { method: 'POST', body: { endpoint: abon.endpoint } });
      await abon.unsubscribe();
    }
    await hentPush();
    tegnSide();
    toast('Notifications off on this device.');
  } catch (err) { toast(err.message, 'fejl'); knap.disabled = false; }
}

async function proevNotifikation(knap) {
  knap.disabled = true;
  const gammel = knap.textContent;
  knap.textContent = 'Sending…';
  try {
    const r = await api('/push/test', { method: 'POST' });
    toast(r.sendt
      ? `Sent to ${r.sendt} device${r.sendt === 1 ? '' : 's'}.`
        + (r.doede ? ` ${r.doede} stale one${r.doede === 1 ? '' : 's'} removed.` : '')
      : 'The push service accepted nothing — see the server log.', r.sendt ? '' : 'fejl');
    await hentPush();
    tegnSide();
  } catch (err) { toast(err.message, 'fejl'); }
  knap.disabled = false;
  knap.textContent = gammel;
}

async function hentPush() {
  try {
    const r = await api('/push');
    state.push.abon = r.subscriptions || [];
    state.push.noegle = r.key;
  } catch { state.push.abon = []; }
}
