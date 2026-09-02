
/* ---------------------------------------------------------- indstillinger */

/*
 * Settings.
 *
 * Hemmeligheder er SKRIVE-ONLY i fladen: serveren sender aldrig noeglen
 * tilbage, kun et flag (§6b). Feltet staar derfor altid tomt, og teksten
 * ved siden af siger, om der ER en noegle - i stedet for at vise prikker,
 * der ligner en vaerdi, man kunne rette i.
 */
/*
 * Indstillingerne er delt i FANER, ikke én lang stribe.
 *
 * Tolv overskrifter i én kolonne betyder, at man ruller forbi ti ting for at
 * naa den ellevte. Samme inddeling som Sagu v45 fik, som igen har den fra
 * verdande (Andreas, 2026-09-02).
 *
 * Fanerne skjuler med `hidden` - de udelader ikke noget fra dokumentet.
 * Foldeafsnittene bygger i forvejen foerst deres indhold, naar de aabnes, saa
 * en skjult fane koster kun sine overskrifter.
 */
const SETTINGS_FANER = [
  { id: 'konto', navn: 'Account' },
  { id: 'medier', navn: 'Media' },
  { id: 'import', navn: 'Import' },
  { id: 'broer', navn: 'Connections' },
  { id: 'server', navn: 'Server', kunAdmin: true },
];

/*
 * Valget huskes i localStorage, ikke i state.
 *
 * Det afhaenger af, hvad man sidst var i gang med paa DENNE maskine - ikke af
 * kontoen. Samme begrundelse som temaet.
 */
function gemtFane() {
  try {
    const g = localStorage.getItem('spolen_fane');
    return SETTINGS_FANER.some((f) => f.id === g) ? g : 'konto';
  } catch { return 'konto'; }
}

/*
 * Er den gemte fane ikke synlig for DEN HER bruger - "Server" for en, der
 * ikke er administrator - falder den tilbage til den foerste. Ellers aabner
 * man indstillingerne og ser en tom side.
 */
function aktivFane() {
  const g = gemtFane();
  const f = SETTINGS_FANER.find((x) => x.id === g);
  const admin = state.user && state.user.isAdmin;
  return (f && (!f.kunAdmin || admin)) ? g : 'konto';
}

function visFane(id) {
  for (const e of document.querySelectorAll('.fane')) e.hidden = e.dataset.fane !== id;
  for (const k of document.querySelectorAll('[data-fane-knap]')) {
    const paa = k.dataset.faneKnap === id;
    k.classList.toggle('paa', paa);
    k.setAttribute('aria-selected', paa ? 'true' : 'false');
  }
}

function settingsSide() {
  const admin = state.user && state.user.isAdmin;
  const nu = aktivFane();

  const fanebar = el('nav', { class: 'faner', role: 'tablist' },
    SETTINGS_FANER.filter((f) => !f.kunAdmin || admin).map((f) => el('button', {
      class: `fane-knap${f.id === nu ? ' paa' : ''}`,
      'data-fane-knap': f.id,
      role: 'tab',
      'aria-selected': f.id === nu ? 'true' : 'false',
      text: f.navn,
      onclick: () => {
        try { localStorage.setItem('spolen_fane', f.id); } catch { /* privat tilstand */ }
        visFane(f.id);
        /*
         * Til toppen: en fane, man skifter til, skal begynde ved sin foerste
         * overskrift - ikke midt i, fordi den forrige var laengere.
         */
        rulTil(0, false);
      },
    })));

  const fane = (id, boern) => el('section', {
    class: 'fane', 'data-fane': id, role: 'tabpanel', hidden: id !== nu,
  }, boern.filter(Boolean));

  /*
   * `bredside`: fyld kolonnen.
   *
   * .main er en kolonne-flexboks med align-items: center, saa et barn uden
   * bredde krymper til sit eget indhold. Med alt foldet ind blev
   * indstillingerne 340px brede i en kolonne paa 1000, og fanerakken laa og
   * flød i midten (maalt 2026-09-02).
   */
  return el('div', { class: 'bredside' }, [
    el('h1', { text: 'Settings' }),
    fanebar,

    fane('konto', [
      /*
       * Temaet staar OEVERST og er ikke foldet.
       *
       * Det er den ene indstilling, man aendrer for at se paa den - er den
       * gemt bag en overskrift, skal man folde ud, klikke, og folde ind igen
       * for at se resultatet (Andreas, 2026-08-29).
       */
      temaAfsnit(),
      foldAfsnit('praef', 'Your preferences', null, personligeAfsnit),
      foldAfsnit('sikkerhed', 'Security', null, sikkerhedsAfsnit),
    ]),

    fane('medier', [
      /* Noeglen staar HER og ikke under Server: uden den er der hverken
         titler eller plakater, og en almindelig bruger skal kunne se, at det
         er dét, der mangler - ogsaa selv om kun en administrator kan rette
         den. */
      foldAfsnit('metadata', 'Metadata', 'tmdb', () => (admin
        ? tmdbAfsnit()
        : el('p', { class: 'dim', text: 'Only the administrator can change the TMDB key.' }))),
      foldAfsnit('tjenester', 'Your streaming services', null, tjenesteAfsnit),
      foldAfsnit('notifik', 'Notifications', null, notifikationAfsnit),
    ]),

    fane('import', [
      foldAfsnit('import', 'Import your history', null, importSide),
      /*
       * Plex staar for sig selv - ikke inde under importen. Det er en
       * LOEBENDE forbindelse (polling, webhook, watchlist), ikke et
       * engangstrin (Andreas, 2026-08-29).
       */
      foldAfsnit('plex', 'Plex', 'plex', plexAfsnit),
      admin ? foldAfsnit('traktapp', 'Trakt application', 'trakt', traktAppAfsnit) : null,
    ]),

    fane('broer', [
      foldAfsnit('mcp', 'Claude connector', 'mcp', mcpAfsnit),
      foldAfsnit('noegler', 'Access keys', 'noegler', noegleAfsnit),
    ]),

    admin ? fane('server', [
      foldAfsnit('server', 'This server', null, serverAfsnit),
    ]) : null,
  ].filter(Boolean));
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
