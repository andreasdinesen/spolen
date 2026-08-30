/* ---- shared/navn.js (delt med serveren) ---- */
/*
 * Hvordan et brugernavn SKRIVES paa skaermen.
 *
 * Navnet gemmes altid med smaa bogstaver. Det er med vilje: login slaar op
 * paa lower(username), saa "andreas", "Andreas" og "ANDREAS" er den SAMME
 * konto, og to konti kan ikke skille sig ad paa store bogstaver alene. Den
 * regel maa ikke roeres - den er det, der goer login utvetydigt.
 *
 * Men gemt form og vist form behoever ikke vaere det samme. Et navn i
 * venstre menu skal se ud som et navn (Andreas, 2026-08-29).
 *
 * Ligger i shared/, fordi BAADE serveren (samtykkesiden i OAuth) og
 * fladen skriver navne ud. To kopier ville drive fra hinanden, og saa
 * hedder man Andreas ét sted og andreas et andet.
 */

/*
 * Stort begyndelsesbogstav i hvert LED. Sammensatte navne er almindelige -
 * "anne-marie" skal blive "Anne-Marie", ikke "Anne-marie".
 *
 * toUpperCase() klarer ae, oe og aa af sig selv; det er derfor der ikke
 * staar en tabel over danske tegn her.
 */
function visNavn(navn) {
  if (typeof navn !== 'string') return '';
  return navn.replace(
    /[^\s\-_.]+/gu,
    (led) => led.charAt(0).toUpperCase() + led.slice(1)
  );
}

/*
 * Et TITELNAVN, skaaret ned til det, to skrivemaader har til faelles.
 *
 * "Spider-Man 3" og "Spiderman 3" er den samme film, men LIKE '%spiderman 3%'
 * rammer aldrig den foerste. Andreas soegte paa "Spiderman 3", havde filmen i
 * biblioteket, og fik den kun at se under "From TMDB" med et "Added"-maerke -
 * afsnittet "In your library" var tomt (2026-08-29).
 *
 * Alt andet end bogstaver og tal ryger: bindestreger, kolon, apostroffer,
 * mellemrum og accenter. Saa bliver "Spider-Man 3", "Spiderman 3" og
 * "SPIDER MAN 3" til det samme - og "WALL·E" til "walle".
 *
 * Det er MED VILJE grovkornet. Den bruges kun til at finde kandidater i et
 * bibliotek paa hundreder af titler, ikke til at afgoere om to titler ER ens.
 */
function sammenligneligTitel(navn) {
  return String(navn == null ? '' : navn)
    .toLowerCase()
    /*
     * ae og oe skal foldes MANUELT.
     *
     * NFD dekomponerer é til e + accent og aa til a + ring, saa dem klarer
     * linjen nedenfor. Men ae (U+00E6) og oe (U+00F8) er selvstaendige
     * bogstaver UDEN dekomponering - de ville blive kastet vaek af
     * [^a-z0-9], saa "OErkenens SOEnner" blev til "rkenenssnner" og
     * "Fraek" til "frk". Det er ikke forkert paa samme maade i begge ender
     * (baade titel og soegning foldes ens), men det goer det umuligt at
     * finde titlen ved at skrive den UDEN de danske tegn - og det er
     * praecis, hvad man goer paa et fremmed tastatur.
     */
    .replace(/\u00e6/g, 'ae')            // ae -> ae
    .replace(/\u00f8/g, 'o')             // oe -> o  (ikke "oe": "Sonner" skal ogsaa ramme)
    .replace(/\u00df/g, 'ss')            // tysk scharfes s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')     // accenter vaek: é -> e, aa -> a
    .replace(/[^a-z0-9]+/g, '');          // kun bogstaver og tal tilbage
}

/*
 * Hvilke titler passer paa det, der blev skrevet - og i hvilken orden.
 *
 * Ligger HER og ikke i server.js, fordi det er en REGEL. En proeve kan
 * kalde den med rigtige navne og faa et rigtigt svar; ligger reglen inde i
 * en databasefunktion, kan en proeve kun kigge paa kildeteksten - og en
 * proeve, der leder efter et ORD i koden, opdager ikke, at sammenligningen
 * blev lavet om under den (maalt 2026-08-29: en sabotage, der satte raa
 * tekstsammenligning tilbage, blev groen).
 *
 * `emner` er [{ id, name }]. Der returneres de samme objekter, sorteret.
 */
function findTitler(emner, soegning, loft) {
  const noegle = sammenligneligTitel(soegning);
  if (!noegle) return [];

  const traf = [];
  for (const e of (emner || [])) {
    if (sammenligneligTitel(e && e.name).includes(noegle)) traf.push(e);
  }

  /*
   * Den, der BEGYNDER med det, man skrev, staar oeverst: soeger man
   * "Spiderman", er "Spider-Man" mere sandsynlig end "The Amazing
   * Spider-Man". Derefter alfabetisk, saa listen ikke hopper rundt.
   */
  traf.sort((a, b) => {
    const aa = sammenligneligTitel(a.name).startsWith(noegle) ? 0 : 1;
    const bb = sammenligneligTitel(b.name).startsWith(noegle) ? 0 : 1;
    return aa - bb || String(a.name).localeCompare(String(b.name));
  });

  const n = Number(loft);
  return n > 0 ? traf.slice(0, n) : traf;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { visNavn, sammenligneligTitel, findTitler };
}

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
const APP_VERSION = 17;

/* ---------------------------------------------------------------- tema */

/*
 * Lyst, moerkt eller "foelg maskinen" - som i doda (Andreas, 2026-08-29).
 *
 * Noeglen 'spolen_theme' er den SAMME, som index.html laeser i sit lille
 * skript i <head>. Det skript koerer FOER app.js og saetter data-theme med
 * det samme, saa siden ikke blinker hvidt paa vej ind i moerkt tema. Skifter
 * man noeglen her, skal den skiftes dér ogsaa - ellers husker appen et tema,
 * den ikke faar sat ved indlaesning.
 */
function anvendTema(valg) {
  if (valg === 'light' || valg === 'dark') document.documentElement.setAttribute('data-theme', valg);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('spolen_theme', valg); } catch { /* privat tilstand */ }
}

function nuvaerendeTema() {
  try { return localStorage.getItem('spolen_theme') || 'auto'; } catch { return 'auto'; }
}

/*
 * Det tema, man rent faktisk SER.
 *
 * "Follow system" er ikke en tredje farve - den er lys eller moerk,
 * afhaengigt af maskinen. Knappen i foden skal vise vejen til det MODSATTE
 * af det, oejet ser, og den kan altsaa ikke noejes med at kigge paa det
 * gemte valg.
 */
function visuelTema() {
  const valg = nuvaerendeTema();
  if (valg === 'light' || valg === 'dark') return valg;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

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
  bibliotek: { raekker: [], slags: 'alle' },
  titel: { id: null, data: null, fejl: '' },
  kalender: { hentet: false, fejl: '', raekker: [], idag: '', fra: '', til: '', icalPath: null },
  import: { tekst: '', analyse: null, status: null, fejl: '', dateOrder: null },
  tjenester: { hentet: false, fejl: '', region: 'DK', providers: [], mine: [] },
  stats: { hentet: false, fejl: '', data: null },
  trakt: { kode: null, url: '', fejl: '', besked: '' },
  plex: { url: '', token: '', accountId: '', svar: null, fejl: '', webhook: null, servere: null, manuelToken: '' },
  noegler: { liste: [], ny: null },
  hjaelp: null,
  push: { abon: [], noegle: '', fejl: '' },
  settings: {},
  delte: {},
  tmdb: { besked: '' },
  totp: { hentet: false },
  passkeys: { hentet: false },
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
      /*
       * Login med passkey. Vises kun, naar browseren FAKTISK kan det - uden
       * https findes PublicKeyCredential slet ikke, og en knap, der kaster,
       * er vaerre end ingen knap. Der er intet brugernavn at taste: browseren
       * viser selv de noegler, den har til adressen.
       */
      (!cfg.needsSetup && cfg.secureContext && typeof window.PublicKeyCredential === 'function')
        ? el('button', { class: 'btn ghost', style: 'margin-top:10px',
            text: 'Sign in with a passkey', onclick: (e) => loginMedPasskey(e.target) })
        : null,
      cfg.secureContext ? null : el('p', { class: 'dim lille', text:
        'Served over plain http — passkeys and notifications need https.' }),
    ])]));
  }
  tegn();
}

/*
 * Login med en passkey - uden brugernavn.
 *
 * b64url-omregningen findes ogsaa i p4_settings.js. Den er den samme fem
 * linjer, men de to steder moedes aldrig: login-siden vises FOER
 * indstillingsfladen overhovedet er relevant, og at flytte hele
 * opsaetningskoden herind for fem linjers skyld ville koste mere end det
 * sparer.
 *
 * Det er HER en passkey-integration plejer at gaa galt: WebAuthn taler
 * binaert, JSON goer ikke. base64 med + og / i stedet for - og _, eller
 * glemt polstring, og saa siger browseren bare nej uden at forklare hvorfor.
 */
async function loginMedPasskey(knap) {
  const tilBuf = (str) => {
    const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const raa = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const ud = new Uint8Array(raa.length);
    for (let i = 0; i < raa.length; i++) ud[i] = raa.charCodeAt(i);
    return ud.buffer;
  };
  const tilB64 = (b) => {
    const bytes = new Uint8Array(b);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  knap.disabled = true;
  const gammel = knap.textContent;
  knap.textContent = 'Waiting for the device…';
  try {
    const start = await api('/passkeys/login/start', { method: 'POST', body: {} });
    const pk = start.publicKey;
    pk.challenge = tilBuf(pk.challenge);
    const cred = await navigator.credentials.get({ publicKey: pk });
    const r = await api('/passkeys/login/finish', { method: 'POST', body: {
      challengeId: start.challengeId,
      id: cred.id,
      clientDataJSON: tilB64(cred.response.clientDataJSON),
      authenticatorData: tilB64(cred.response.authenticatorData),
      signature: tilB64(cred.response.signature),
    } });
    state.user = r.user;
    await indlaes();
  } catch (err) {
    knap.disabled = false;
    knap.textContent = gammel;
    if (err && err.name === 'NotAllowedError') return;   // afbrudt af brugeren
    toast(err.message || 'That passkey did not work.', 'fejl');
  }
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
  // Sol og maane til temaknappen - samme streger som i doda, saa de to
  // apps foles ens i sidebarens fod.
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6L6.2 6.2"/>',
  moon: '<path d="M20 14.6A8.6 8.6 0 019.4 4 8.6 8.6 0 1020 14.6z"/>',
  out: '<path d="M14.5 4.5H18a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-3.5"/><path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5"/>',
  // Pil op - tilbage til toppen.
  op: '<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/>',
  // Fire linjer: den taette liste.
  taet: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  // Gitter: plakaterne igen.
  gitter: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
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
  /*
   * Settings staar IKKE her. Brugerknappen i sidebarens fod er indgangen,
   * som i doda (Andreas, 2026-08-29). Siden findes stadig som view - den
   * naas bare gennem brugermenuen.
   */
];

/*
 * HVEM ruller egentlig?
 *
 * Paa en bred skaerm er det dokumentet. Paa en telefon har <body> sin egen
 * hoejde og `overflow-y: auto`, saa det er BODY, der ruller - dokumentet
 * staar stille, og window.scrollY er 0 uanset hvor langt man er nede.
 *
 * Maalt 2026-08-29: paa 375px var body 9712px indhold i en 812px boks, mens
 * window.scrollY blev paa 0. Alt, der spurgte vinduet - de flydende knapper,
 * "til toppen", springet til et bogstav - virkede derfor slet ikke paa
 * telefonen. Netop den skaerm, hvor de er mest vaerd.
 */
function rulleBeholder() {
  const d = document.scrollingElement || document.documentElement;
  return d.scrollHeight > d.clientHeight ? d : document.body;
}

/** Hvor langt er der rullet - uanset hvem der ruller. */
function rullePosition() {
  return rulleBeholder().scrollTop || window.scrollY || 0;
}

/** Rul til en position i den beholder, der faktisk ruller. */
function rulTil(y, bloedt) {
  const b = rulleBeholder();
  if (bloedt) {
    b.scrollTo({ top: y, behavior: 'smooth' });
    /*
     * ...og kontrollér. En bloed rulning er en animation og kan blive
     * droppet - maalt baade her, ved importen og ved "til toppen".
     */
    setTimeout(() => { if (Math.abs(rullePosition() - y) > 4) b.scrollTo(0, y); }, 700);
    return;
  }
  b.scrollTo(0, y);
}

function skal(indhold) {
  const rod = $('#root');
  // Husk rullepositionen ved gentegning af SAMME side. Et fast scrollTo(0,0)
  // sender brugeren til toppen, hver gang en afkrydsning gemmer og gentegner
  // (Beanledger v24).
  const samme = rod.dataset.view === state.view;
  const sc = rulleBeholder();
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
    /*
     * Foden, som i doda: brugerens navn er indgangen til Settings, og
     * versionen deler linje med temaknappen (Andreas, 2026-08-29).
     *
     * "Sign out" stod foer som en knap her. Den er flyttet ind i
     * brugermenuen - to knapper ved siden af hinanden, hvor den ene logger
     * ud, er et uheld der venter paa at ske.
     */
    el('div', { class: 'sidebar-foot' }, [
      brugerKnap(),
      el('div', { class: 'foot-row' }, [versionsLinje(), temaKnap()]),
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
  /*
   * Knappen i sidehovedet bygges tom og faar sit ikon og sin tekst HER.
   * Den tegnes om ved hver gentegning, saa den kan ikke selv huske, hvilken
   * vej den peger.
   */
  opdaterKompaktKnapper();
  sc.scrollTop = gemtRul;
}

/* ------------------------------------------- kompakt visning + flydere */

/*
 * Kompakt er en SKAERM-praeference, ikke en kontoindstilling.
 *
 * Den hoerer til den skaerm, man sidder ved: en telefon vil gerne have den
 * taette liste, en stor skaerm hellere plakaterne. Derfor localStorage og
 * ikke serveren - samme valg som Bogreolen (Andreas, 2026-08-29).
 */
function erKompakt() {
  try { return localStorage.getItem('spolen_kompakt') === '1'; } catch { return false; }
}

function saetKompakt(til) {
  try { localStorage.setItem('spolen_kompakt', til ? '1' : '0'); } catch { /* privat tilstand */ }
}

/*
 * Skift visning UDEN at tegne siden om.
 *
 * En gentegning ville rive plakaterne ned og hente dem igen - hundredvis af
 * billeder, for en aendring der er én klasse. Rullepositionen ville ogsaa
 * springe, og man ville miste det sted i listen, man stod.
 */
function skiftKompakt() {
  const til = !erKompakt();
  saetKompakt(til);
  const gitter = document.querySelector('.plakater');
  if (gitter) gitter.classList.toggle('kompakt', til);
  opdaterKompaktKnapper();
}

/* Begge knapper viser det samme - de skal foelges ad, ogsaa naar man
   trykker paa den ene. */
function opdaterKompaktKnapper() {
  const til = erKompakt();
  for (const k of document.querySelectorAll('[data-kompakt]')) {
    k.classList.toggle('til', til);
    k.setAttribute('aria-pressed', til ? 'true' : 'false');
    const t = til ? 'Show posters' : 'Compact list — more titles at once';
    k.title = t;
    k.setAttribute('aria-label', t);
    const nytIkon = ikon(til ? IKONER.gitter : IKONER.taet, { stoerrelse: k.dataset.kompakt === 'flyder' ? 19 : 16 });
    const gammelt = k.querySelector('svg');
    if (gammelt) gammelt.replaceWith(nytIkon); else k.prepend(nytIkon);
    const mrk = k.querySelector('.knaptekst');
    if (mrk) mrk.textContent = til ? 'Posters' : 'Compact';
  }
}

/* Knappen i toppen af biblioteket - den man finder, naar man ikke har
   rullet endnu og flyderne derfor ikke er fremme. */
function kompaktKnap() {
  return el('button', {
    class: 'btn ghost lille', 'data-kompakt': 'top',
    onclick: skiftKompakt,
  }, [el('span', { class: 'knaptekst', text: '' })]);
}

/*
 * De to flydende knapper.
 *
 * De bygges ÉN gang og bliver liggende i <body> - ikke inde i siden, som
 * tegnes om ved hver handling. Skifteren vises kun paa biblioteket, hvor
 * der er noget at skifte; "til toppen" er nyttig paa enhver lang side.
 */
function tilslutFlydere() {
  if (document.getElementById('tilToppen')) return;

  const top = el('button', {
    class: 'flydeknap', id: 'tilToppen', hidden: true,
    title: 'Back to the top', 'aria-label': 'Back to the top',
    /*
     * Bloed rulning med KONTROL.
     *
     * En bloed rulning er en animation, og animationer kan blive droppet -
     * maalt her og ved importen 2026-08-29: scrollY stod uroert efter et
     * sekund. En knap, der hedder "til toppen" og ikke flytter noget, er
     * vaerre end ingen knap, saa efter 700 ms springes der haardt.
     *
     * IKKE fokus i soegefeltet undervejs: paa en telefon ville tastaturet
     * springe frem, og det er ikke det, man beder om.
     */
    onclick: () => rulTil(0, true),
  }, [ikon(IKONER.op, { stoerrelse: 19 })]);

  const komp = el('button', {
    class: 'flydeknap kompaktknap', id: 'kompaktFlyder', hidden: true,
    'data-kompakt': 'flyder',
    onclick: skiftKompakt,
  }, []);

  document.body.appendChild(top);
  document.body.appendChild(komp);
  opdaterKompaktKnapper();

  /*
   * Kaldes DIREKTE paa hver rullehaendelse - som i Bogreolen.
   *
   * Foerste udgave droslede gennem requestAnimationFrame med et
   * `venter`-flag, der blev nulstillet INDE i tilbagekaldet. Maalt: i en
   * skjult fane fyrer rAF aldrig, og saa stod flaget paa true for evigt -
   * hver eneste senere rulning blev ignoreret. En drosling, der kan
   * gaa i baglaas, er vaerre end ingen drosling (2026-08-29).
   *
   * Arbejdet er ogsaa lille nok til at taale det: en laesning af scrollY og
   * to klasseskift. Ingen getBoundingClientRect, altsaa ingen tvungen
   * ombrydning.
   */
  const opdater = () => {
    // 600px: langt nok nede til, at vejen tilbage er besvaerlig.
    const vis = rullePosition() > 600;
    // Skifteren hoerer kun hjemme, hvor der ER et gitter at skifte.
    const harGitter = !!document.querySelector('.plakater');
    for (const k of [top, komp]) {
      if (vis && (k !== komp || harGitter)) {
        if (k.hidden) {
          k.hidden = false;
          // Tving en ombrydning, saa skubbet har en starttilstand at gaa ud
          // fra. Sker det ikke, staar knappen bare med det samme - den er
          // synlig uanset, for opaciteten afhaenger ikke af overgangen.
          void k.offsetHeight;
        }
        k.classList.add('vis');
      } else {
        k.classList.remove('vis');
        k.hidden = true;
      }
    }
  };
  /*
   * Lyt paa DOKUMENTET i capture-fasen.
   *
   * En rullehaendelse fra et element bobler ikke, men den fanges i capture
   * paa vej ned. Saa virker det, uanset om det er vinduet eller <body>, der
   * ruller - og det skifter med skaermbredden.
   */
  document.addEventListener('scroll', opdater, { passive: true, capture: true });
  opdater();
}

/*
 * Brugerknappen - indgangen til Settings.
 *
 * Settings staar ikke i navigationen laengere, saa knappen skal ogsaa vise,
 * NAAR man er derinde. Ellers er intet punkt markeret, og man kan ikke se
 * hvor man er (samme greb som doda).
 */
function brugerKnap() {
  return el('button', {
    class: 'nav-item',
    id: 'brugerKnap',
    'aria-current': state.view === 'settings' ? 'page' : null,
    onclick: (e) => { e.stopPropagation(); visBrugerMenu(); },
  }, [ikon(IKONER.settings), el('span', { text: state.user ? visNavn(state.user.username) : '' })]);
}

/*
 * Ét klik mellem lyst og moerkt, uden at gaa i Settings.
 *
 * Knappen viser det tema, man skifter TIL - ikke det, man er i. Alle tre
 * valg (inklusive "Follow system") bliver staaende under Settings; det her
 * er genvejen, ikke hele indstillingen.
 */
function temaKnap() {
  const naeste = visuelTema() === 'dark' ? 'light' : 'dark';
  return el('button', {
    class: 'temabtn',
    id: 'temaKnap',
    'aria-label': `Switch to ${naeste} theme`,
    title: `Switch to ${naeste} theme`,
    onclick: () => {
      anvendTema(naeste);
      // Er man PAA indstillingssiden, skal de tre knapper dér ogsaa foelge
      // med - ellers staar den gamle markering tilbage.
      tegnSide();
    },
  }, [ikon(naeste === 'dark' ? IKONER.moon : IKONER.sun, { stoerrelse: 16 })]);
}

/*
 * Brugermenuen.
 *
 * Log ud skal kunne naas uden at gaa i indstillingerne. Menuen er en lille
 * popover over brugerknappen - samme sted, man i forvejen klikker.
 */
function visBrugerMenu() {
  const gammel = document.getElementById('brugerMenu');
  if (gammel) { gammel.remove(); return; }        // andet klik lukker igen
  const anker = document.getElementById('brugerKnap');
  if (!anker) return;

  const gaa = async (hvad) => {
    const m = document.getElementById('brugerMenu');
    if (m) m.remove();
    if (hvad === 'settings') {
      state.view = 'settings';
      tegnSide();
      await Promise.all([hentSettings(), tjekTmdb(), hentTjenester(), hentNoegler(),
        hentPlexWebhook(), hentPush()]);
      tegnSide();
      if (smalSkaerm()) document.body.classList.remove('navopen');
      return;
    }
    await api('/logout', { method: 'POST' });
    state.user = null;
    loginSide('Signed out.');
  };

  const menu = el('div', { class: 'usermenu', id: 'brugerMenu' }, [
    el('div', { class: 'usermenu-head' }, [
      el('div', { class: 'usermenu-name', text: state.user ? visNavn(state.user.username) : '' }),
      el('div', { class: 'meta', text: 'Signed in' }),
    ]),
    el('button', { class: 'usermenu-item', onclick: () => gaa('settings') },
      [ikon(IKONER.settings, { stoerrelse: 17 }), el('span', { text: 'Settings' })]),
    el('button', { class: 'usermenu-item danger', onclick: () => gaa('logout') },
      [ikon(IKONER.out, { stoerrelse: 17 }), el('span', { text: 'Log out' })]),
  ]);

  const r = anker.getBoundingClientRect();
  menu.style.left = `${Math.round(r.left)}px`;
  menu.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`;
  document.body.appendChild(menu);

  /*
   * Ét klik udenfor lukker igen. setTimeout, saa klikket der AABNEDE menuen
   * ikke naar at lukke den med det samme.
   */
  setTimeout(() => {
    document.addEventListener('click', function udenfor(e) {
      if (!menu.isConnected) { document.removeEventListener('click', udenfor); return; }
      if (!menu.contains(e.target) && e.target !== anker) {
        menu.remove();
        document.removeEventListener('click', udenfor);
      }
    });
  }, 0);
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
      el('strong', { text: visNavn(d.owner) }),
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
    el('strong', { text: visNavn(d.grantee) }),
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
    state.people.map((p) => el('option', { value: p.id, text: visNavn(p.username) })));
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
  /*
   * Temaet saettes ogsaa HER, selv om index.html allerede gjorde det i
   * <head>. Det skript kan kun laese localStorage; her fanger vi ogsaa den
   * situation, hvor lageret er utilgaengeligt, og appen skal falde tilbage
   * til systemets valg uden at kaste.
   */
  anvendTema(nuvaerendeTema());
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
    tilslutSideDrop();
    tilslutFlydere();
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
    onclick: () => aabnTraeffer(r),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aabnTraeffer(r); } },
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

/*
 * Hvad et klik paa en traeffer skal goere.
 *
 * Har man den ALLEREDE, er overblikket det forkerte svar: man kender jo
 * filmen - man vil ind paa dens side og markere den set eller se, hvor den
 * kan streames. Overblikket er til dem, man overvejer (Andreas, 2026-08-29).
 */
function aabnTraeffer(r) {
  if (r.tracked) {
    luk();
    const felt = omniFelt();
    if (felt) felt.value = '';
    state.soeg.q = '';
    aabnTitel(r.id);
    return;
  }
  visOverblik(r);
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
  const alle = state.bibliotek.raekker;
  if (!alle.length) {
    return tomtRum('Your library is empty', 'Search at the top and add a film or series.');
  }

  /*
   * Film og serier hver for sig.
   *
   * De to er ikke det samme at lede efter: en serie har fremdrift og et
   * naeste afsnit, en film er set eller ikke set (Andreas, 2026-08-29).
   *
   * Valget lever i state og ikke i localStorage - modsat kompakt. Et FILTER,
   * der huskes paa tvaers af besoeg, er den slags, hvor man aabner
   * biblioteket, ser halvdelen af sine titler og tror, resten er vaek.
   */
  const valgt = state.bibliotek.slags || 'alle';
  const antal = {
    alle: alle.length,
    movie: alle.filter((r) => r.title.kind === 'movie').length,
    tv: alle.filter((r) => r.title.kind === 'tv').length,
  };
  const raekker = valgt === 'alle' ? alle : alle.filter((r) => r.title.kind === valgt);

  const flig = (id, navn) => el('button', {
    class: `chip${valgt === id ? ' valgt' : ''}`,
    'aria-pressed': valgt === id ? 'true' : 'false',
    text: `${navn} ${antal[id]}`,
    onclick: () => { state.bibliotek.slags = id; tegnSide(); },
  });

  /* Kun de flige, der HAR noget. Har man ingen serier, er en tom
     "Series 0" bare stoej. */
  const flige = [flig('alle', 'All')];
  if (antal.movie) flige.push(flig('movie', 'Films'));
  if (antal.tv) flige.push(flig('tv', 'Series'));
  /*
   * Overskrift og skifter deler linje. Knappen staar HER og ikke kun som
   * flyder, fordi flyderne foerst dukker op, naar man har rullet - og man
   * skal kunne vaelge visning, foer man goer det (Andreas, 2026-08-29).
   */
  /*
   * Titlerne grupperes efter forbogstav, med en overskrift foran hver gruppe.
   *
   * Overskriften spaender hele gitterrækken (grid-column: 1 / -1), saa den
   * ikke stjaeler en plads fra plakaterne. Den er samtidig det ANKER,
   * bogstavskinnen springer til - som i Bogreolen (Andreas, 2026-08-29).
   *
   * Raekkefoelgen kommer fra serveren, som allerede sorterer paa navn. Vi
   * grupperer bare det, der kommer - saa kan skinnen ikke komme i utakt med
   * listen.
   */
  const grupper = [];
  for (const r of raekker) {
    const b = forbogstav(r.title.name);
    if (!grupper.length || grupper[grupper.length - 1].bogstav !== b) {
      grupper.push({ bogstav: b, raekker: [] });
    }
    grupper[grupper.length - 1].raekker.push(r);
  }

  const gitterboern = [];
  for (const g of grupper) {
    gitterboern.push(el('div', {
      class: 'bogstavhoved', id: `bogstav-${g.bogstav}`, text: g.bogstav,
    }));
    for (const r of g.raekker) gitterboern.push(bibliotekKort(r));
  }

  const gitter = el('div', { class: `plakater${erKompakt() ? ' kompakt' : ''}` }, gitterboern);

  /*
   * `bredside`: fyld den plads, der ER.
   *
   * .main er en kolonne-flexboks med `align-items: center`, saa et barn UDEN
   * bredde krymper til sit eget indhold - maalt: 407px inde i en main paa
   * 1016px, og et auto-fill-gitter faldt derfor til to soejler paa en bred
   * skaerm. Med rigtige plakater sloerer billedernes egen bredde det, men
   * gitteret faar aldrig den fulde plads (2026-08-29).
   */
  return el('div', { class: 'bredside' }, [
    el('div', { class: 'sidehoved' }, [
      el('h1', { text: 'Library' }),
      el('span', { class: 'dim lille', text: raekker.length === 1 ? '1 title' : `${raekker.length} titles` }),
      kompaktKnap(),
    ]),
    flige.length > 1 ? el('div', { class: 'omni-chips bibliotekflige' }, flige) : null,
    raekker.length
      ? gitter
      : el('p', { class: 'dim', text: 'Nothing of that kind yet.' }),
    // Skinnen ligger fast i hoejre kant, saa den maa gerne staa sidst i
    // dokumentet - den er ude af flowet alligevel.
    grupper.length > 1 ? bogstavSkinne(grupper) : null,
  ]);
}

/*
 * Hvilket bogstav en titel hoerer under.
 *
 * Tal samles under '#': "12 Years a Slave" og "2067" hoerer sammen, og en
 * skinne med ti cifre foran bogstaverne er mest stoej.
 *
 * AE, OE og AA staar for sig selv - de ER bogstaver paa dansk, og at folde
 * dem sammen med A og O ville sende "OErkenens SOEnner" hen under O, hvor
 * ingen leder efter den.
 */
function forbogstav(navn) {
  const t = String(navn || '').trim();
  if (!t) return '#';
  const c = t[0].toUpperCase();
  return /[0-9]/.test(c) ? '#' : c;
}

/*
 * Bogstavskinnen i hoejre kant.
 *
 * Med hundredvis af titler er den eneste vej til "S" ellers at rulle - og
 * paa en telefon er det mange strygninger (§9b).
 */
function bogstavSkinne(grupper) {
  return el('div', { class: 'bogstavskinne', 'aria-label': 'Jump to a letter' },
    grupper.map((g) => el('button', {
      class: 'bogstavknap', 'data-bogstav': g.bogstav,
      title: `Jump to ${g.bogstav}`,
      text: g.bogstav,
      onclick: () => hopTilBogstav(g.bogstav),
    })));
}

/*
 * Spring til et bogstav.
 *
 * Toplinjen er klaebende, saa der trækkes dens hoejde fra - ellers lander
 * overskriften LIGE bag soegefeltet, og man tror, springet ramte forkert.
 *
 * Og som ved importen og "til toppen": en bloed rulning er en animation og
 * kan blive droppet, saa der kontrolleres bagefter (2026-08-29).
 */
function hopTilBogstav(bogstav) {
  const maal = document.getElementById(`bogstav-${bogstav}`);
  if (!maal) return;
  const bjaelke = document.querySelector('.topbar');
  const luft = (bjaelke ? bjaelke.getBoundingClientRect().height : 0) + 12;
  // rullePosition(), ikke window.scrollY: paa en telefon er det <body>, der
  // ruller, og vinduet staar paa 0 uanset hvor langt nede man er.
  const y = Math.max(0, maal.getBoundingClientRect().top + rullePosition() - luft);
  rulTil(y, true);
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
  /*
   * Alle hovedpunkter er foldbare og starter LUKKEDE.
   *
   * Indholdet bygges foerst, naar afsnittet aabnes - tjenestelisten alene er
   * 62 raekker med hvert sit logo.
   */
  return el('div', {}, [
    el('h1', { text: 'Settings' }),

    /*
     * Temaet staar OEVERST og er ikke foldet.
     *
     * Det er den ene indstilling, man aendrer for at se paa den - er den
     * gemt bag en overskrift, skal man folde ud, klikke, og folde ind igen
     * for at se resultatet. De tre valg fylder én linje (Andreas,
     * 2026-08-29).
     */
    temaAfsnit(),

    foldAfsnit('metadata', 'Metadata', 'tmdb', () => (admin
      ? tmdbAfsnit()
      : el('p', { class: 'dim', text: 'Only the administrator can change the TMDB key.' }))),

    foldAfsnit('praef', 'Your preferences', null, personligeAfsnit),

    foldAfsnit('tjenester', 'Your streaming services', null, tjenesteAfsnit),

    foldAfsnit('import', 'Import your history', null, importSide),

    /*
     * Plex staar for sig selv - ikke inde under importen.
     *
     * Det er en LOEBENDE forbindelse (polling, webhook, watchlist, lokalt
     * katalog), ikke et engangstrin. Inde i importafsnittet skulle man
     * foerst aabne "Import your history" for at naa den, og den skubbede
     * samtidig importens eget svar ned under skaermkanten
     * (Andreas, 2026-08-29).
     */
    foldAfsnit('plex', 'Plex', 'plex', plexAfsnit),

    admin ? foldAfsnit('traktapp', 'Trakt application', 'trakt', traktAppAfsnit) : null,

    foldAfsnit('notifik', 'Notifications', null, notifikationAfsnit),

    foldAfsnit('sikkerhed', 'Security', null, sikkerhedsAfsnit),

    foldAfsnit('mcp', 'Claude connector', 'mcp', mcpAfsnit),

    foldAfsnit('noegler', 'Access keys', 'noegler', noegleAfsnit),

    admin ? foldAfsnit('server', 'This server', null, serverAfsnit) : null,
  ]);
}

/*
 * Alle tre temavalg. Genvejen i sidebarens fod skifter kun mellem lys og
 * moerk; "Follow system" findes kun her, fordi den ikke er en tredje farve,
 * man kan skifte TIL i en toggle.
 */
function temaAfsnit() {
  const nu = nuvaerendeTema();
  const valg = [['auto', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']];
  return el('section', { class: 'card' }, [
    el('h2', { text: 'Theme' }),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' },
      valg.map(([v, l]) => el('button', {
        class: `btn ${nu === v ? 'primary' : ''}`,
        'aria-pressed': nu === v ? 'true' : 'false',
        text: l,
        // Hele siden tegnes om, saa BAADE de tre knapper og temaknappen i
        // foden foelger med. Ellers viser foden vej til det tema, man
        // allerede er i.
        onclick: () => { anvendTema(v); tegnSide(); },
      }))),
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

/* ------------------------------------------- totrinsbekraeftelse (§9d) */

/*
 * Sikkerhed: kodeord og totrinsbekraeftelse.
 *
 * Motoren har ligget i serveren fra begyndelsen - hemmelighed, engangskoder,
 * genoprettelseskoder og andet trin ved login. Der manglede kun en vej til at
 * taende den (Andreas, 2026-08-30).
 */
function sikkerhedsAfsnit() {
  const t = state.totp;
  if (!t || !t.hentet) {
    hentTotp();
    return el('p', { class: 'dim lille', text: 'Loading…' });
  }
  if (t.fejl) return el('p', { class: 'noeglestatus mangler', text: t.fejl });

  /* Er opsaetningen i gang, fylder den hele afsnittet - man skal ikke kunne
     starte forfra ved siden af sig selv. */
  if (t.opsaetning) return totpOpsaetning(t);
  if (t.koder) return totpKoder(t);

  return el('div', {}, [
    el('p', { class: t.enabled ? 'noeglestatus ok' : 'noeglestatus mangler',
      text: t.enabled
        ? `Two-factor is on. ${t.recoveryLeft} recovery ${t.recoveryLeft === 1 ? 'code' : 'codes'} left.`
        : 'Two-factor is off.' }),
    el('p', { class: 'dim lille', text: t.enabled
      ? 'You are asked for a code from your phone when you sign in.'
      : 'A code from your phone on top of your password. Works with any '
        + 'authenticator app — the code is made on the phone, so it works without a network.' }),
    t.enabled ? totpFraForm() : el('button', { class: 'btn primary', text: 'Turn on two-factor',
      onclick: (e) => startTotp(e.target) }),
    t.enabled ? totpNyeKoderForm() : null,
    passkeyAfsnit(),
  ]);
}

/* Billedet OG teksten. Sidder man ved telefonen og ser siden paa den samme
   skaerm, kan en QR-kode ikke scannes - saa skal hemmeligheden kunne tastes. */
function totpOpsaetning(t) {
  const felt = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code',
    placeholder: '000000', style: 'font-size:16px;max-width:140px' });
  const qr = el('div', { class: 'totp-qr' });
  qr.innerHTML = t.opsaetning.qr;      // vores egen SVG fra serveren

  return el('div', {}, [
    el('h3', { text: 'Scan this' }),
    qr,
    el('p', { class: 'dim lille', text: 'Cannot scan? Type this into the app instead:' }),
    el('code', { class: 'totp-hem', text: t.opsaetning.secret }),
    el('p', { class: 'lille', text:
      'Then type the six digits the app shows, to prove it works before it is switched on.' }),
    el('div', { class: 'knaprad' }, [
      felt,
      el('button', { class: 'btn primary', text: 'Turn on', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await api('/2fa/enable', { method: 'POST', body: { code: felt.value } });
          state.totp = Object.assign({}, state.totp, { opsaetning: null, koder: r.recovery, enabled: true });
          tegnSide();
        } catch (err) { e.target.disabled = false; toast(err.message, 'fejl'); }
      } }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => {
        state.totp = Object.assign({}, state.totp, { opsaetning: null });
        tegnSide();
      } }),
    ]),
  ]);
}

/*
 * Koderne vises ÉN gang.
 *
 * De kan ikke hentes frem igen - kun erstattes af ti nye. Derfor staar det
 * med rene ord, og listen kan koperes i ét stykke.
 */
function totpKoder(t) {
  return el('div', { class: 'card advarsel' }, [
    el('h3', { text: 'Save these recovery codes' }),
    el('p', { class: 'lille', text:
      'Each one works once, if you lose your phone. They are shown now and never again — '
      + 'you can only replace them with ten new ones.' }),
    el('pre', { class: 'totp-koder', text: t.koder.join('\n') }),
    el('div', { class: 'knaprad' }, [
      el('button', { class: 'btn ghost', text: 'Copy', onclick: async (e) => {
        try { await navigator.clipboard.writeText(t.koder.join('\n')); toast('Copied.'); }
        catch { toast('Could not copy — select the text instead.', 'fejl'); }
      } }),
      el('button', { class: 'btn primary', text: 'I have saved them', onclick: async () => {
        state.totp = { hentet: false };
        await hentTotp();
        tegnSide();
      } }),
    ]),
  ]);
}

/* Fra igen mod KODEORD - ikke mod en engangskode. Har man mistet telefonen,
   ville et krav om en engangskode goere det umuligt at komme videre. */
function totpFraForm() {
  const felt = el('input', { type: 'password', autocomplete: 'current-password',
    placeholder: 'Your password', style: 'font-size:16px' });
  return el('div', { class: 'knaprad' }, [
    felt,
    el('button', { class: 'btn ghost', text: 'Turn off', onclick: async (e) => {
      e.target.disabled = true;
      try {
        await api('/2fa', { method: 'DELETE', body: { password: felt.value } });
        toast('Two-factor is off.');
        state.totp = { hentet: false };
        await hentTotp();
        tegnSide();
      } catch (err) { e.target.disabled = false; toast(err.message, 'fejl'); }
    } }),
  ]);
}

function totpNyeKoderForm() {
  const felt = el('input', { type: 'password', autocomplete: 'current-password',
    placeholder: 'Your password', style: 'font-size:16px' });
  return el('details', { style: 'margin-top:12px' }, [
    el('summary', { class: 'lille', text: 'Replace the recovery codes' }),
    el('p', { class: 'dim lille', text:
      'Ten new ones. The old ones stop working the moment these are made — also the unused.' }),
    el('div', { class: 'knaprad' }, [
      felt,
      el('button', { class: 'btn ghost', text: 'Make new codes', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await api('/2fa/recovery', { method: 'POST', body: { password: felt.value } });
          state.totp = Object.assign({}, state.totp, { koder: r.recovery });
          tegnSide();
        } catch (err) { e.target.disabled = false; toast(err.message, 'fejl'); }
      } }),
    ]),
  ]);
}

async function hentTotp() {
  try {
    const r = await api('/2fa');
    state.totp = Object.assign({ hentet: true, fejl: '', opsaetning: null, koder: null }, r);
  } catch (err) {
    state.totp = { hentet: true, fejl: err.message };
  }
  tegnSide();
}

async function startTotp(knap) {
  knap.disabled = true;
  try {
    const r = await api('/2fa/start', { method: 'POST', body: {} });
    state.totp = Object.assign({}, state.totp, { opsaetning: r });
    tegnSide();
  } catch (err) { knap.disabled = false; toast(err.message, 'fejl'); }
}

/* ------------------------------------------------------ passkeys (§3) */

/*
 * Passkeys.
 *
 * Modulet har ligget faerdigt i app/webauthn.js fra begyndelsen, og
 * `credentials`-tabellen kom med foerste migration - det var bare aldrig
 * koblet til (Andreas, 2026-08-30).
 *
 * Uden https findes hverken PublicKeyCredential eller browserens
 * noeglehaandtering. Det siges med rene ord i stedet for at vise en knap,
 * der kaster.
 */
function passkeyAfsnit() {
  const p = state.passkeys;
  if (!p || !p.hentet) { hentPasskeys(); return el('p', { class: 'dim lille', text: 'Loading…' }); }

  const kanBruges = typeof window.PublicKeyCredential === 'function'
    && (window.isSecureContext !== false);

  return el('div', { style: 'margin-top:18px' }, [
    el('h3', { text: 'Passkeys' }),
    el('p', { class: 'dim lille', text:
      'Sign in with the fingerprint or face on your phone or laptop, instead of typing a '
      + 'password. The key never leaves the device, and it only works on this address.' }),
    p.fejl ? el('p', { class: 'noeglestatus mangler', text: p.fejl }) : null,
    !kanBruges
      ? el('p', { class: 'noeglestatus mangler', text:
          'Passkeys need https and a browser that supports them.' })
      : null,
    p.liste && p.liste.length
      ? el('div', { class: 'liste' }, p.liste.map((k) => el('div', { class: 'item-row' }, [
          el('span', { class: 'lille', text: k.name || 'Passkey' }),
          el('span', { class: 'dim lille', text: k.lastUsedAt
            ? 'last used ' + new Date(k.lastUsedAt * 1000).toLocaleDateString('en-GB',
                { day: 'numeric', month: 'short', year: 'numeric' })
            : 'never used' }),
          el('button', { class: 'btn ghost lille', text: 'Remove', onclick: async (e) => {
            e.target.disabled = true;
            try {
              await api(`/passkeys/${encodeURIComponent(k.id)}`, { method: 'DELETE' });
              state.passkeys = { hentet: false };
              await hentPasskeys();
            } catch (err) { e.target.disabled = false; toast(err.message, 'fejl'); }
          } }),
        ])))
      : el('p', { class: 'dim lille', text: 'No passkeys yet.' }),
    kanBruges
      ? el('button', { class: 'btn', text: 'Add a passkey', onclick: (e) => tilfoejPasskey(e.target) })
      : null,
  ]);
}

async function hentPasskeys() {
  try {
    const r = await api('/passkeys');
    state.passkeys = { hentet: true, fejl: '', liste: r.passkeys || [] };
  } catch (err) {
    state.passkeys = { hentet: true, fejl: err.message, liste: [] };
  }
  tegnSide();
}

/*
 * base64url <-> ArrayBuffer.
 *
 * WebAuthn taler binaert, JSON goer ikke. Det er HER, en passkey-integration
 * plejer at gaa galt: base64 med + og / i stedet for - og _, eller glemt
 * polstring - og saa siger browseren bare nej uden at forklare hvorfor.
 */
function b64urlTilBuf(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const raa = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const ud = new Uint8Array(raa.length);
  for (let i = 0; i < raa.length; i++) ud[i] = raa.charCodeAt(i);
  return ud.buffer;
}

function bufTilB64url(b) {
  const bytes = new Uint8Array(b);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function tilfoejPasskey(knap) {
  knap.disabled = true;
  const gammelTekst = knap.textContent;
  knap.textContent = 'Waiting for the device…';
  try {
    const start = await api('/passkeys/register/start', { method: 'POST', body: {} });
    const pk = start.publicKey;
    pk.challenge = b64urlTilBuf(pk.challenge);
    pk.user.id = b64urlTilBuf(pk.user.id);
    for (const c of (pk.excludeCredentials || [])) c.id = b64urlTilBuf(c.id);

    const cred = await navigator.credentials.create({ publicKey: pk });
    await api('/passkeys/register/finish', { method: 'POST', body: {
      challengeId: start.challengeId,
      clientDataJSON: bufTilB64url(cred.response.clientDataJSON),
      attestationObject: bufTilB64url(cred.response.attestationObject),
      // Et navn man kan kende den paa, naar der ligger tre.
      name: navigator.platform || 'This device',
    } });
    toast('Passkey added.');
    state.passkeys = { hentet: false };
    await hentPasskeys();
  } catch (err) {
    knap.disabled = false;
    knap.textContent = gammelTekst;
    // Afbryder man selv, er det ikke en fejl at raabe op om.
    if (err && err.name === 'NotAllowedError') return;
    toast(err.message || 'That did not work.', 'fejl');
  }
}

/* ------------------------------------------------ Claude-connector (§9a) */

/*
 * MCP-serveren har koert siden F6 - men den stod kun naevnt som ÉN linje
 * nede under "Access keys", og der er ingen, der finder den (Andreas,
 * 2026-08-30). En funktion, ingen kan finde, er ikke leveret.
 *
 * Der er TO veje ind, og forskellen er vaerd at sige hoejt:
 *
 *   - claude.ai i browseren bruger OAuth. Man godkender i sin egen browser,
 *     og der skifter ingen noegle haender.
 *   - Claude Code og Desktop har ingen browser at godkende i og skal have en
 *     adgangsnoegle med som Bearer-token.
 */
function mcpAfsnit() {
  const adresse = `${location.origin}/mcp`;
  const sikker = location.protocol === 'https:';

  const felt = el('input', {
    type: 'text', readonly: true, value: adresse,
    style: 'font-size:16px;flex:1;min-width:0',
    onclick: (e) => e.target.select(),
  });

  return el('div', {}, [
    el('p', { class: 'dim lille', text:
      'Let Claude look things up in your library and mark episodes watched — '
      + '"what should I watch tonight?"' }),

    el('label', { class: 'lille', text: 'Connector address' }),
    el('div', { class: 'knaprad' }, [
      felt,
      el('button', { class: 'btn', text: 'Copy', onclick: async () => {
        try { await navigator.clipboard.writeText(adresse); toast('Copied.'); }
        catch {
          // Uden clipboard-adgang (fx plain http) skal brugeren vide, at
          // feltet er markeret i stedet - samme greb som ved adgangsnoegler.
          felt.select();
          toast('Could not copy — the address is selected, press Cmd/Ctrl+C.', 'fejl');
        }
      } }),
    ]),

    /*
     * Uden https kan Claude slet ikke naa serveren. Det skal staa HER og
     * ikke opdages, naar man har indsat adressen og faaet en fejl, man ikke
     * kan tolke.
     */
    sikker ? null : el('p', { class: 'noeglestatus mangler', text:
      'This address is plain http. Claude can only connect over https.' }),

    el('p', { class: 'dim lille', text:
      'On claude.ai: Settings → Connectors → Add custom connector. You approve it in your own '
      + 'browser, so Claude only ever sees your library — no key changes hands.' }),
    el('p', { class: 'dim lille', text:
      'Claude Code and Desktop have no browser to approve in: make an access key below and send '
      + 'it as a Bearer token instead.' }),
    el('p', { class: 'dim lille', text: 'Press ? above for the full steps.' }),
  ]);
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
    el('div', { class: 'titelrad' }, [
      el('button', { class: 'btn ghost lille', text: '← Library',
        onclick: () => { state.view = 'library'; tegnSide(); } }),
      // Kun paa noget, man FAKTISK har. Ellers ville knappen love at fjerne
      // en titel, der ikke er der.
      t.data.tracking && titel.kind === 'tv' ? skjulFraUpNext(t.data) : null,
      t.data.tracking ? fjernFraBiblioteket(t.data) : null,
    ]),
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
        // En FILM har ingen afsnit at markere - den skal have sin egen knap.
        titel.kind === 'movie' ? filmSet(t.data) : null,
        udbudsAfsnit(t.data),
      ]),
    ]),
    samlingsAfsnit(t.data),
    beslaegtedeAfsnit(),
    t.data.episodes ? saesonListe(t.data.episodes, titel.id) : null,
  ]);
}

/*
 * "Set" for en FILM.
 *
 * En serie markeres afsnit for afsnit, og det er hele saesonlisten til for.
 * En film har ingen afsnit, og indtil nu havde den derfor slet ingen vej til
 * at blive markeret set - biblioteket skrev "Not watched", og der var intet
 * at goere ved det (Andreas, 2026-08-29).
 *
 * Serveren sendte allerede `watched` med hver film; fladen tegnede den bare
 * aldrig.
 *
 * En film kan ses FLERE gange, og det er ikke det samme som at have set den:
 * derfor en liste over gangene og ikke bare et flueben.
 */
function filmSet(d) {
  const set = d.watched || [];
  const knap = el('button', {
    class: set.length ? 'btn ghost lille' : 'btn primary',
    text: set.length ? 'Watch again' : 'Mark as watched',
    onclick: async (e) => {
      e.target.disabled = true;
      try {
        const svar = await api('/watches', { method: 'POST',
          body: { titleId: d.title.id, source: 'manual' } });
        /*
         * Dubletnoeglen er pr. DAG, ikke pr. sekund - saa en import kan
         * koeres igen uden at fordoble historikken (se ix_watch_dedup).
         * Foelgen er, at et gensyn SAMME dag ikke bliver til en ny gang.
         * Uden den her besked trykker man paa en knap, der tier stille, og
         * tror at den er i stykker (2026-08-29).
         */
        if (svar && svar.dublet) toast('Already recorded for today.');
        await aabnTitel(d.title.id);
      } catch (err) {
        e.target.disabled = false;
        toast(err.message, 'fejl');
      }
    },
  });

  return el('div', { class: 'filmset' }, [
    knap,
    set.length
      ? el('div', { class: 'dim lille', text: set.length === 1
          ? 'Seen once.' : `Seen ${set.length} times.` })
      : null,
    /*
     * Hver gang staar for sig med sin egen dato, saa man kan fjerne PRAECIS
     * den, der blev sat ved en fejl. En samlet "fjern alle" ville ogsaa slette
     * de rigtige (2026-08-29).
     */
    set.length ? el('div', { class: 'liste' }, set.map((w) => el('div', { class: 'item-row' }, [
      el('span', { class: 'lille', text: w.watchedAt
        ? new Date(w.watchedAt * 1000).toLocaleDateString('en-GB',
            { day: 'numeric', month: 'short', year: 'numeric' })
        : 'no date' }),
      el('span', { class: 'dim lille', text: w.source || 'manual' }),
      el('button', { class: 'btn ghost lille', text: 'Remove',
        title: 'Remove just this viewing',
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            await api(`/watches/${encodeURIComponent(w.id)}`, { method: 'DELETE' });
            await aabnTitel(d.title.id);
          } catch (err) {
            e.target.disabled = false;
            toast(err.message, 'fejl');
          }
        } }),
    ]))) : null,
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

/*
 * Tag en serie ud af Up Next uden at fjerne den.
 *
 * Andreas, 2026-08-30: nogle serier er man holdt op med at se, men man vil
 * stadig kunne se hvor langt man naaede. Up Next er "hvad skal jeg se nu" -
 * en serie, man ikke er i gang med, goer listen laengere uden at goere den
 * mere brugbar.
 *
 * Tilstanden `paused` FANDTES i forvejen: Up Next viser kun `watching` og
 * `watchlist`, saa der skulle ingen ny model til - kun en vej til at saette
 * den. Historikken, fremdriften og selve titlen bliver praecis hvor de er.
 */
function skjulFraUpNext(d) {
  const skjult = d.tracking.state === 'paused';
  return el('button', {
    class: 'btn ghost lille',
    text: skjult ? 'Show in Up Next' : 'Hide from Up Next',
    title: skjult
      ? 'Put this series back on Up Next'
      : 'Keep the series and its history, but stop it showing on Up Next',
    onclick: async (e) => {
      e.target.disabled = true;
      try {
        /*
         * HELE tracking-objektet sendes med, ikke kun det aendrede felt.
         * gemItem skriver `data` som ét stykke, saa et delvist objekt ville
         * slette resten - fx hideSpecials og hvornaar man begyndte.
         */
        await api('/items', { method: 'POST', body: Object.assign({}, d.tracking, {
          state: skjult ? 'watching' : 'paused',
        }) });
        toast(skjult ? 'Back on Up Next.' : 'Hidden from Up Next.');
        await Promise.all([hentUpNext(), hentBibliotek()]);
        await aabnTitel(d.title.id);
      } catch (err) {
        e.target.disabled = false;
        toast(err.message, 'fejl');
      }
    },
  });
}

/*
 * Fjern en titel fra biblioteket igen.
 *
 * Skal virke, uanset om titlen bare er tilfoejet eller ogsaa er markeret
 * set (Andreas, 2026-08-29). Og det er netop DÉR, spoergsmaalet bliver
 * svaert: historikken er ikke det samme som biblioteket.
 *
 * Derfor tre svar, ikke to:
 *
 *   - Fjern, og BEHOLD historikken. Standarden. Titlen forsvinder fra
 *     biblioteket, men det, man har set, taeller stadig i statistikken. At
 *     rydde op i sit bibliotek maa ikke stille og roligt slette aar af
 *     historik.
 *   - Fjern ALT, ogsaa historikken. Findes, fordi den anden vej ikke kan
 *     naas bagefter: er titlen foerst vaek fra biblioteket, er der ingen
 *     side at gaa ind paa for at rydde historikken.
 *   - Fortryd.
 *
 * Bedoemmelse og note bliver staaende. De hoerer ikke til "biblioteket", og
 * tilfoejer man titlen igen, er de der stadig.
 */
function fjernFraBiblioteket(d) {
  const navn = d.title.name;
  // Hvor meget historik er der? En serie taeller afsnit, en film gange.
  const antal = d.progress ? d.progress.sete : (d.watched || []).length;

  return el('button', {
    class: 'btn ghost lille fjernknap', text: 'Remove from library',
    onclick: async (e) => {
      const valg = antal
        ? await spoerg('Remove from library?',
            `${navn} will be removed from your library. You have ${antal} `
            + `${antal === 1 ? 'viewing' : 'viewings'} recorded — that history counts `
            + 'towards your statistics. Once the title is gone you cannot get back '
            + 'to this page to clear it.',
            [
              { id: 'behold', text: 'Remove, keep history', primary: true },
              { id: 'alt', text: 'Remove and delete history' },
              { id: 'fortryd', text: 'Cancel' },
            ])
        : await spoerg('Remove from library?',
            `${navn} will be removed from your library. You can add it again at any time.`,
            [
              { id: 'behold', text: 'Remove', primary: true },
              { id: 'fortryd', text: 'Cancel' },
            ]);
      if (valg === 'fortryd') return;

      e.target.disabled = true;
      try {
        /*
         * Historikken FOERST. Gaar noget galt undervejs, staar titlen stadig
         * i biblioteket - og saa kan man proeve igen. Den omvendte orden
         * ville efterlade en historik uden en side at rydde den fra.
         */
        if (valg === 'alt') {
          await api(`/watches/title/${encodeURIComponent(d.title.id)}`, { method: 'DELETE' });
        }
        await api(`/items/${encodeURIComponent(d.tracking.id)}`, { method: 'DELETE' });
        toast(`${navn} removed.`);
        state.view = 'library';
        await Promise.all([hentUpNext(), hentBibliotek()]);
        tegnSide();
      } catch (err) {
        e.target.disabled = false;
        toast(err.message, 'fejl');
      }
    },
  });
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
    /*
     * Hele kortet kan klikkes - ikke kun knappen.
     *
     * Man peger paa plakaten, fordi det er den, man kan se. En knap, der
     * hedder "Open" nede i hjoernet, er ikke der, oejet gaar hen
     * (Andreas, 2026-08-29). Reglen for HVAD et klik goer er den samme som
     * i soegningen: har man titlen, aabnes dens side; ellers vises
     * overblikket foerst.
     */
    el('div', { class: 'plakater' }, c.dele.map((del) => el('div', {
      class: `soegekort${del.denne ? ' denne' : ''}`,
      role: del.denne ? null : 'button',
      tabindex: del.denne ? null : '0',
      // Ingen vej fra den, man staar paa, til sig selv.
      onclick: del.denne ? null : () => aabnTraeffer({
        id: del.id, kind: 'movie', tmdbId: del.tmdbId, name: del.name,
        year: del.year, posterPath: del.posterPath, tracked: !!del.iBiblioteket,
      }),
      onkeydown: del.denne ? null : (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          aabnTraeffer({
            id: del.id, kind: 'movie', tmdbId: del.tmdbId, name: del.name,
            year: del.year, posterPath: del.posterPath, tracked: !!del.iBiblioteket,
          });
        }
      },
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
      /*
       * stopPropagation: knappen ligger INDE i et kort, der ogsaa kan
       * klikkes. Uden den ville et tryk paa Add baade tilfoeje OG navigere
       * vaek fra siden, saa man aldrig saa at det lykkedes.
       */
      (!del.denne && !del.iBiblioteket)
        ? el('button', { class: 'btn primary lille', text: 'Add',
            onclick: (e) => { e.stopPropagation();
              tilfoej({ kind: 'movie', tmdbId: del.tmdbId, name: del.name }, e.target); } })
        : null,
      (!del.denne && del.iBiblioteket)
        ? el('button', { class: 'btn ghost lille', text: 'Open',
            onclick: (e) => { e.stopPropagation(); aabnTitel(del.id); } })
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
    el('div', { class: 'plakater' }, b.map((r) => el('div', {
      class: 'soegekort', role: 'button', tabindex: '0',
      onclick: () => aabnTraeffer(r),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aabnTraeffer(r); } },
    }, [
      r.poster
        ? el('img', { class: 'plakat', src: r.poster, alt: '', loading: 'lazy' })
        : el('div', { class: 'plakat' }),
      el('div', { class: 'soegekort-titel', text: r.name }),
      el('div', { class: 'dim lille', text: `${r.kind === 'tv' ? 'Series' : 'Film'}`
        + `${r.year ? ' · ' + r.year : ''}` }),
      r.tracked
        ? el('button', { class: 'btn ghost lille', text: 'Open',
            onclick: (e) => { e.stopPropagation(); aabnTitel(r.id); } })
        : el('button', { class: 'btn primary lille', text: 'Add',
            onclick: (e) => { e.stopPropagation(); tilfoej(r, e.target); } }),
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
    el('p', { class: 'dim lille', text:
      'Drop a Trakt export straight from Downloads — the whole .zip, unopened. '
      + 'Also takes Netflix viewing activity, Letterboxd, IMDb and TV Time as '
      + '.csv, .json or .zip. '
      + 'Sequel syncs to Trakt, so a Trakt export is the way out of Sequel.' }),

    dropZone(),

    /*
     * Svaret paa et drop staar LIGE UNDER zonen - ikke under Trakt- og
     * Plex-afsnittene, som det gjorde foer.
     *
     * Maalt hos Andreas 2026-08-29: analysekortet blev tegnet i y=1459 i et
     * vindue paa 676 px, altsaa 783 px under skaermkanten, og siden rullede
     * ikke. Zonen sagde stadig "Drop your export here". Importen HAVDE
     * laest alle 77 filer og 8753 raekker - der var bare ingen maade at se
     * det paa. Hver enkelt del af kaeden var maalt og virkede; det, ingen
     * proeve daekkede, var om resultatet var SYNLIGT.
     */
    i.fejl ? el('p', { class: 'noeglestatus mangler importsvar', text: i.fejl }) : null,
    i.analyse ? analyseKort(i.analyse) : null,
    i.status ? importFremdrift(i.status) : null,

    /*
     * Trakt bliver HER. Device-login er ikke en forbindelse, man plejer -
     * det er vejen ud af Sequel, altsaa en import. Plex er det modsatte og
     * har faaet sit eget punkt (Andreas, 2026-08-29).
     */
    traktAfsnit(),
  ]);
}

/* "1 rows - 1 films" stod der foer. Tallet er som regel stort, saa fejlen
   var usynlig indtil man importerede en enkelt raekke (2026-08-29). */
function flertal(n, ental, flertalsform) {
  return `${n} ${n === 1 ? ental : (flertalsform || ental + 's')}`;
}

function analyseKort(a) {
  const usikker = !a.dateOrderCertain;

  /*
   * En Trakt-eksport baerer fulde tidsstempler (2024-03-11T20:15:00Z). Der
   * er intet at vaelge, og der SKAL ikke vaelges: tolkDato() matcher ISO
   * foer skraastregs-grenen, saa 'dmy'/'mdy' roerer ikke den slags datoer.
   *
   * Foer viste vi valget alligevel. Vaerdien 'iso' findes ikke blandt de to
   * muligheder, og en <select> sat til en ukendt vaerdi bliver TOM - saa
   * Andreas stod med et blankt felt og spurgte, hvad han skulle vaelge
   * (2026-08-29). Et valg, der hverken kan besvares eller betyder noget, er
   * vaerre end intet valg.
   */
  const isoFil = a.dateOrder === 'iso';

  const ordenValg = el('select', { style: 'font-size:16px' }, [
    el('option', { value: 'dmy', text: 'Day/month/year (3/2 = 3 February)' }),
    el('option', { value: 'mdy', text: 'Month/day/year (3/2 = 2 March)' }),
  ]);
  if (!isoFil) {
    const oenske = state.import.dateOrder || a.dateOrder;
    // Kun en vaerdi, der FINDES blandt mulighederne - ellers staar den tom igen.
    ordenValg.value = (oenske === 'dmy' || oenske === 'mdy') ? oenske : 'dmy';
    state.import.dateOrder = ordenValg.value;
    ordenValg.addEventListener('change', () => { state.import.dateOrder = ordenValg.value; });
  }

  return el('div', { class: 'card importsvar' }, [
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
            el('span', { class: 'dim lille', text: `${flertal(u.raekker, 'row')} · ${u.format}` }),
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
      `${flertal(a.rows, 'row')} — ${flertal(a.movies, 'film')}, `
      + `${flertal(a.episodes, 'episode')}, ${flertal(a.shows, 'show')}. `
      + `${a.withDates} ${a.withDates === 1 ? 'has' : 'have'} a date.`
      + (a.skipped ? ` ${flertal(a.skipped, 'row')} could not be read.` : '') }),

    /*
     * Datoernes retning vises ALTID - ogsaa naar appen er sikker. Er den
     * usikker, siges det med rene ord, for 3/2 er tvetydig, og en historik
     * med baglaens datoer er umulig at opdage bagefter.
     */
    isoFil
      ? el('p', { class: 'dim lille', text:
          'This export carries full timestamps, so the dates are already exact — '
          + 'there is nothing to choose.' })
      : el('div', { class: usikker ? 'card advarsel' : '' }, [
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
      el('button', { class: 'btn primary', text: `Import ${flertal(a.rows, 'row')}`,
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
      `${s.done} of ${flertal(s.total, 'row')} · ${flertal(s.added, 'watch', 'watches')} added`
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
          el('summary', { text: `${flertal(s.unmatchedTotal, 'row')} could not be matched` }),
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
    dateOrder: null, zipNavn: null, overZonen: false, laeser: null };
}

/*
 * Rul svaret frem, og kvitter for filen med det samme.
 *
 * En import er den ene handling i spolen, hvor der gaar flere sekunder,
 * uden at noget aendrer sig oeverst paa skaermen. Sker der intet SYNLIGT,
 * konkluderer man at det ikke virkede - og proever igen (Andreas,
 * 2026-08-29).
 */
function rulTilImportsvar() {
  const m = document.querySelector('.importsvar');
  if (!m) return;
  const synligt = () => {
    const r = m.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  };
  // Rul kun, hvis svaret faktisk ligger uden for skaermen. Et ryk i en
  // visning, der allerede er rigtig, er sin egen slags forvirring.
  if (synligt()) return;

  m.scrollIntoView({ behavior: 'smooth', block: 'center' });

  /*
   * Og KONTROLLÉR saa, at der rent faktisk blev rullet.
   *
   * En bloed rulning er en animation, og en animation kan blive droppet -
   * maalt: scrollY stod paa 0 efter 1,5 sekund, mens den samme rulning
   * uden 'smooth' flyttede 516 px. Sker det, har brugeren praecis det
   * problem, rettelsen skulle loese: svaret findes, og han ser det ikke.
   * Derfor et haardt spring som reserve (2026-08-29).
   */
  setTimeout(() => { if (!synligt()) m.scrollIntoView({ block: 'center' }); }, 700);
}

async function laesImportFil(fil) {
  if (!fil) return;
  state.import = tomImport();
  // Navnet vises FOER filen laeses. En zip paa en halv megabyte tager tid
  // at pakke ud, og indtil nu sagde zonen praecis det samme hele vejen.
  state.import.laeser = fil.name;
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
        state.import.laeser = null;
        tegnSide(); rulTilImportsvar();
        return;
      }
      const samlet = filer.reduce((n, f) => n + f.tekst.length, 0);
      // Under serverens 48 MB med god margen: JSON-indpakningen goer
      // teksten ~15 % stoerre paa traaden.
      if (samlet > 30 * 1024 * 1024) {
        state.import.fejl = 'That export unpacks to more than 30 MB — too big to import in one go.';
        state.import.laeser = null;
        tegnSide(); rulTilImportsvar();
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
      state.import.laeser = null;
      tegnSide(); rulTilImportsvar();
      return;
    }
    tekst = await fil.text();
    if (tekst.length > 20 * 1024 * 1024) {
      state.import.fejl = 'That file is larger than 20 MB.';
      state.import.laeser = null;
      tegnSide(); rulTilImportsvar();
      return;
    }
    state.import.tekst = tekst;
    const a = await api('/import/analyse', { method: 'POST', body: { text: tekst } });
    state.import.analyse = a;
    state.import.dateOrder = a.dateOrder;
  } catch (err) {
    state.import.fejl = err.message;
  }
  state.import.laeser = null;
  tegnSide();
  rulTilImportsvar();
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
    el('div', { class: 'dropzone-tekst', text: state.import.laeser
      ? `Reading ${state.import.laeser}…`
      : 'Drop your export here' }),
    el('div', { class: 'dim lille', text: state.import.laeser
      ? 'Unpacking and checking what is inside — this takes a moment.'
      : 'or click to choose — .zip, .csv or .json' }),
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
    url: 'https://trakt.tv/settings/data',
    trin: [
      'NOTE: since 2026 Trakt requires a paid VIP membership to create an API '
        + 'application. Without VIP you cannot connect Trakt directly to spolen.',
      'Without VIP, try an export instead: trakt.tv → Settings → Data. If you can '
        + 'download your history there, spolen imports the file — same result, no membership.',
      'With VIP: Settings → Your API Apps → New Application. Any name will do.',
      'Under Redirect uri write: urn:ietf:wg:oauth:2.0:oob',
      'Save, and copy the Client ID and Client Secret into the two fields here.',
      'Then press Connect Trakt — you get a code to type on trakt.tv.',
    ],
    note: 'Sequel syncs to Trakt, so Trakt was the obvious way out of Sequel. If VIP '
      + 'blocks you, the file import above takes anything: a Trakt export, Letterboxd, '
      + 'IMDb, TV Time or Netflix — as .csv or a whole GDPR .zip. Sequel also has '
      + 'Shortcuts actions that can write a file.',
  },
  plex: {
    titel: 'Connecting Plex',
    url: 'https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/',
    trin: [
      'You do not need a server address. spolen asks plex.tv which servers your '
        + 'account can reach — including ones other people have shared with you.',
      'You only need an X-Plex-Token. It is not a password: open Plex in a browser, '
        + 'play something, then open developer tools → Network and look for X-Plex-Token '
        + 'in any request. Plex’s own guide below shows a second way.',
      'Paste it, press Find my servers, and pick one from the list.',
      'If the server has several accounts, choose whose history to read — otherwise '
        + 'spolen imports everyone’s.',
    ],
    note: 'A server shared with you may or may not let spolen read watch history; that '
      + 'is the owner’s setting. Plex is still the only service that can report what you '
      + 'actually watched — everything else is an import or marked by hand.',
  },
  plexToken: {
    titel: 'Finding your Plex token',
    url: 'https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/',
    trin: [
      'Quickest, from browser storage: open app.plex.tv, open the developer tools '
        + 'console, and type  localStorage.getItem("myPlexAccessToken")  — it prints the '
        + 'token. If that key is not there, list them with  '
        + 'Object.keys(localStorage).filter(k => /token/i.test(k))',
      'Plex’s own documented way: open any film or series on app.plex.tv, then the … menu '
        + '→ Get Info → View XML. The page that opens has ?X-Plex-Token=… in its address. '
        + 'Copy everything after the equals sign. Slower, but it survives Plex changing '
        + 'their web app.',
      'Or the Network tab: open developer tools → Network, click around in Plex, and find '
        + 'X-Plex-Token in the address or headers of any request.',
      'Paste it in the field, not anywhere else, then press Find my servers.',
    ],
    note: 'This is an ACCOUNT token, not a server token — and that is what the discovery '
      + 'needs. It gives access to your Plex account, so treat it like a password. spolen '
      + 'keeps it server-side and never sends it back to the browser, and you can always '
      + 'revoke it by signing out of all devices in your Plex account settings.',
  },

  mcp: {
    titel: 'Connecting Claude to spolen',
    url: 'https://claude.ai/settings/connectors',
    trin: [
      'On claude.ai: open Settings → Connectors → Add custom connector, and paste the address below.',
      'Claude opens a spolen page in your browser and asks you to approve. You sign in as yourself, '
        + 'so Claude only ever sees YOUR library — no key changes hands.',
      'In Claude Code or Claude Desktop there is no browser to approve in. Make an access key under '
        + '"Access keys" instead, and add spolen as an MCP server with the key as a Bearer token.',
      'Ask things like "what should I watch tonight?" or "mark episode 4 of Silo as watched".',
    ],
    note: 'The connector needs https — Claude cannot reach a plain http address. '
      + 'You can revoke it at any time under Access keys.',
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


/* ------------------------------------------------------ foldbare afsnit */

/*
 * Indstillinger foldet sammen.
 *
 * Siden var vokset til otte afsnit, hvoraf ét alene har 62 afkrydsningsfelter.
 * Alt aabent paa én gang betyder, at man ruller forbi det meste for at naa
 * det, man kom efter (Andreas, 2026-08-29).
 *
 * Tilstanden gemmes i localStorage og ikke i `state`: hvilke afsnit man har
 * aabnet, er en vane pr. browser, ikke data. Den skal derfor ikke i
 * settings-tabellen og ikke synkroniseres mellem enheder.
 */
function foldetAf(id) {
  try {
    const raa = localStorage.getItem('spolen_foldet');
    const f = raa ? JSON.parse(raa) : null;
    // Standard: ALT foldet sammen. Man aabner det, man skal bruge.
    if (!f || typeof f !== 'object') return true;
    return f[id] !== false;
  } catch {
    // localStorage kan kaste i private vinduer og naar site-data er spaerret.
    return true;
  }
}

function saetFoldet(id, foldet) {
  try {
    const raa = localStorage.getItem('spolen_foldet');
    const f = (raa ? JSON.parse(raa) : null) || {};
    f[id] = foldet;
    localStorage.setItem('spolen_foldet', JSON.stringify(f));
  } catch { /* uden lager foldes der bare igen naeste gang */ }
}

/**
 * Et afsnit med en overskrift, der kan klikkes.
 *
 * @param {function} byg  Indholdet bygges FOERST naar afsnittet er aabent.
 *   Det er ikke kun pænt: tjenestelisten er 62 raekker med hvert sit
 *   billede, og at bygge dem for at skjule dem er spild ved hver gentegning.
 */
function foldAfsnit(id, titel, hjaelpNavn, byg) {
  const foldet = foldetAf(id);
  return el('section', { class: `foldafsnit${foldet ? ' foldet' : ''}` }, [
    el('div', { class: 'foldhoved' }, [
      el('button', {
        class: 'foldknap-titel',
        'aria-expanded': foldet ? 'false' : 'true',
        onclick: () => { saetFoldet(id, !foldet); tegnSide(); },
      }, [
        el('span', { class: 'foldpil', text: foldet ? '▸' : '▾' }),
        el('span', { text: titel }),
      ]),
      hjaelpNavn ? hjaelpeKnap(hjaelpNavn) : null,
    ]),
    (!foldet && hjaelpNavn) ? hjaelpePanel(hjaelpNavn) : null,
    foldet ? null : el('div', { class: 'foldindhold' }, [byg()]),
  ]);
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
/*
 * Hvorfor kan der IKKE sendes notifikationer her?
 *
 * Tre grunde, og de kraever hver sit svar. Foerste udgave slog dem sammen
 * til "notifications need https" - og den besked stod paa en iPhone, der
 * var paa https og paa sit eget domaene (Andreas, 2026-08-29). En
 * fejlbesked, der peger paa noget, brugeren allerede har gjort, er vaerre
 * end ingen.
 */
function pushHindring() {
  if (state.config && state.config.secureContext === false) {
    return {
      grund: 'https',
      tekst: 'Notifications need https. Open spolen on its own domain instead of the '
        + 'panel’s IP address.',
    };
  }
  /*
   * iOS udstiller hverken Notification eller PushManager i en almindelig
   * Safari-fane. De findes KUN, naar siden er lagt paa hjemmeskaermen.
   * `navigator.standalone` er Apples eget flag for netop det.
   */
  const erIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const paaHjemmeskaerm = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  if (erIos && !paaHjemmeskaerm) {
    return {
      grund: 'ios',
      tekst: 'On iPhone and iPad, Safari only allows notifications when the site is '
        + 'added to the Home Screen.',
      trin: [
        'Tap the Share button in Safari (the square with an arrow).',
        'Choose "Add to Home Screen" and confirm.',
        'Open spolen from the new icon — not from Safari.',
        'Come back here and the button appears.',
      ],
    };
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator)
      || !('PushManager' in window)) {
    return {
      grund: 'browser',
      tekst: 'This browser does not support web push. Chrome, Edge, Firefox and Safari '
        + 'all do — on iPhone only from the Home Screen.',
    };
  }
  return null;
}

function notifikationAfsnit() {
  const n = state.push;
  const hindring = pushHindring();

  if (hindring) {
    return el('div', {}, [
      el('p', { class: 'dim', text: hindring.tekst }),
      hindring.trin
        ? el('ol', { class: 'dim lille' }, hindring.trin.map((t) => el('li', { text: t })))
        : null,
      // Er der allerede abonnementer fra ANDRE enheder, skal de stadig
      // kunne ses og fjernes herfra.
      n.abon.length
        ? el('p', { class: 'dim lille', text:
            `${n.abon.length} other device${n.abon.length === 1 ? '' : 's'} already `
            + 'subscribed.' })
        : null,
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
