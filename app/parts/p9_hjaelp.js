
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
