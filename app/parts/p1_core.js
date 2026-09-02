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
const APP_VERSION = 21;

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
  /* Startsiden. Kalenderen svarer paa "hvornaar kommer der noget nyt" -
     det, appen oftest aabnes for (Andreas, 2026-09-02). */
  view: 'calendar',
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
  historik: { hentet: false, fejl: '', raekker: [] },
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
