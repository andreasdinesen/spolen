
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
