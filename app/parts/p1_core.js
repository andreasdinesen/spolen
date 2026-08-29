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
const APP_VERSION = 2;

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
