'use strict';
/*
 * MCP-server for spolen (F6, RUNE-ERFARINGER §9a).
 *
 * Samme form som dodas: JSON-RPC over HTTP paa /mcp, alt besvaret i selve
 * POST-svaret - ingen SSE-stroem.
 *
 * FLERBRUGER: hvert vaerktoej faar `auth` med og giver brugerens id videre
 * til srv-laget. Dodas MCP kan noejes uden, fordi den er én-bruger - her
 * ville det betyde, at en noegle laeste den foerste bruger i tabellen.
 * Signaturen er med vilje ubekvem: man kan ikke kalde et vaerktoej uden at
 * tage stilling til, hvis data det er.
 *
 * VAERKTOEJERNE er skaaret efter, hvad man faktisk spoerger om i en stue:
 * "hvad skal vi se i aften", "har jeg set den", "saet den paa listen". Ikke
 * en CRUD-flade oven paa databasen - en model, der kan skrive i hvert felt,
 * skriver ogsaa i de forkerte.
 */

const PROTOKOL = '2025-06-18';
const PROTOKOLLER = ['2025-06-18', '2025-03-26', '2024-11-05'];

function opret(srv) {
  /* ---------------------------------------------------------- vaerktoejer */

  const VAERKTOEJER = [
    {
      name: 'up_next',
      scope: 'read',
      description:
        'What the user can watch right now: the next unwatched episode of every series '
        + 'they follow, newest first. Series where everything aired has been seen are '
        + 'listed with the date the next episode arrives. This is the answer to '
        + '"what should we watch tonight".',
      inputSchema: { type: 'object', properties: {} },
      kald(a, auth) {
        const r = srv.upNext(auth.user.id);
        if (!r.length) return { tekst: 'Nothing is queued up.' };
        const linjer = r.map((x) => {
          const e = x.next.klar || x.next.naeste;
          const hvor = x.next.klar ? 'ready' : `airs ${e.airDate || 'date unknown'}`;
          return `${x.title.name} — S${e.season}E${e.number}`
            + `${e.name ? ` "${e.name}"` : ''} (${hvor})`;
        });
        return { tekst: linjer.join('\n'), data: { rows: r.length } };
      },
    },
    {
      name: 'search',
      scope: 'read',
      description:
        'Search the user\'s library and TMDB for a film or series. Returns ids in the '
        + 'form "tv:1396" or "movie:603" — use those with the other tools. Always search '
        + 'before adding or marking something: never invent an id.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Title to look for.' } },
        required: ['query'],
      },
      async kald(a, auth) {
        const q = String(a.query || '').trim();
        if (q.length < 2) return { fejl: 'Give at least two characters to search for.' };
        const r = await srv.soeg(auth.user.id, q);
        if (!r.local.length && !r.tmdb.length) return { tekst: `Nothing found for "${q}".` };
        const vis = (x, mine) => `${x.id}  ${x.name}${x.year ? ` (${x.year})` : ''}`
          + `${mine ? ' — in the library' : ''}`;
        return {
          tekst: [
            ...r.local.map((x) => vis(x, true)),
            ...r.tmdb.slice(0, 8).map((x) => vis(x, false)),
          ].join('\n'),
        };
      },
    },
    {
      name: 'title',
      scope: 'read',
      description:
        'Everything about one title the user follows: progress, the next unwatched '
        + 'episode, and where it can be streamed. Takes an id from search.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Title id, e.g. "tv:1396".' } },
        required: ['id'],
      },
      async kald(a, auth) {
        const d = await srv.titel(auth.user.id, String(a.id || ''));
        if (!d) return { fejl: 'That title is not in the library. Add it first.' };
        const dele = [`${d.title.name}${d.title.year ? ` (${d.title.year})` : ''}`];
        if (d.progress) {
          dele.push(`${d.progress.sete} of ${d.progress.sendte} aired episodes watched`);
        }
        if (d.next && (d.next.klar || d.next.naeste)) {
          const e = d.next.klar || d.next.naeste;
          dele.push(d.next.klar
            ? `Next up: S${e.season}E${e.number}${e.name ? ` "${e.name}"` : ''}`
            : `Caught up. Next episode S${e.season}E${e.number} airs ${e.airDate || 'at an unknown date'}`);
        }
        const flat = ((d.providers || {}).flatrate || []).map((p) => p.name);
        if (flat.length) dele.push(`Streaming on ${flat.join(', ')}`);
        return { tekst: dele.join('\n') };
      },
    },
    {
      name: 'mark_watched',
      scope: 'write',
      description:
        'Mark an episode or film as seen. For a series give the title id plus season and '
        + 'episode; for a film just the title id. Ask the user before marking a whole '
        + 'run of episodes — it is not easily undone in bulk.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Title id, e.g. "tv:1396".' },
          season: { type: 'number', description: 'Season number, for series.' },
          episode: { type: 'number', description: 'Episode number, for series.' },
        },
        required: ['id'],
      },
      kald(a, auth) {
        const r = srv.markerSet(auth.user.id, String(a.id || ''), a.season, a.episode);
        if (r.fejl) return { fejl: r.fejl };
        return { tekst: r.dublet ? 'That was already marked as seen.' : `Marked ${r.hvad} as seen.` };
      },
    },
    {
      name: 'add_title',
      scope: 'write',
      description:
        'Add a film or series to the library so the user starts following it. Takes an '
        + 'id from search. Fetching a long series can take a few seconds.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Title id from search, e.g. "tv:1396".' },
          state: {
            type: 'string',
            enum: ['watchlist', 'watching'],
            description: 'watchlist = wants to see it; watching = already started.',
          },
        },
        required: ['id'],
      },
      async kald(a, auth) {
        const r = await srv.tilfoej(auth.user.id, String(a.id || ''), a.state);
        if (r.fejl) return { fejl: r.fejl };
        return { tekst: `${r.navn} is now in the library.` };
      },
    },
    {
      name: 'calendar',
      scope: 'read',
      description:
        'Episodes coming up for the series the user follows, in date order. Use it for '
        + '"what is on this week" and "when does X come back".',
      inputSchema: {
        type: 'object',
        properties: { days: { type: 'number', description: 'How many days ahead. Default 30.' } },
      },
      kald(a, auth) {
        const dage = Math.min(Math.max(Number(a.days) || 30, 1), 400);
        const r = srv.kalender(auth.user.id, dage);
        if (!r.length) return { tekst: `Nothing scheduled in the next ${dage} days.` };
        return {
          tekst: r.map((x) => `${x.airDate}  ${x.titleName} S${x.season}E${x.number}`
            + `${x.name ? ` "${x.name}"` : ''}`).join('\n'),
        };
      },
    },
    {
      name: 'stats',
      scope: 'read',
      description:
        'How much the user has watched: total time, films, episodes, and the top genres. '
        + 'Numbers with no runtime on TMDB are estimated, and the answer says how many.',
      inputSchema: {
        type: 'object',
        properties: { year: { type: 'string', description: 'Limit to one year, e.g. "2026".' } },
      },
      kald(a, auth) {
        const s = srv.stats(auth.user.id, a.year ? String(a.year) : null);
        const t = s.total;
        if (!t.antal) return { tekst: 'Nothing watched yet.' };
        const dele = [
          `${t.antal} things watched — ${t.film} films, ${t.afsnit} episodes, ${t.serier} series.`,
          `About ${Math.round(t.minutter / 60)} hours.`,
        ];
        if (t.gaettedePoster) {
          dele.push(`${t.gaettedePoster} had no runtime on TMDB and were counted as `
            + `${t.gaetMinutter} minutes each.`);
        }
        if (s.topGenres.length) {
          dele.push('Most watched genres: '
            + s.topGenres.slice(0, 4).map((g) => g.navn).join(', ') + '.');
        }
        return { tekst: dele.join(' ') };
      },
    },
  ];

  /* -------------------------------------------------------- json-rpc */

  const fejl = (id, kode, besked, data) => ({
    jsonrpc: '2.0', id: id === undefined ? null : id,
    error: Object.assign({ code: kode, message: besked }, data ? { data } : {}),
  });
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });

  async function behandl(besked, auth) {
    if (!besked || besked.jsonrpc !== '2.0' || typeof besked.method !== 'string') {
      return fejl(besked && besked.id, -32600, 'Invalid Request');
    }
    const { id, method, params } = besked;

    if (method === 'initialize') {
      const oensket = params && params.protocolVersion;
      return ok(id, {
        protocolVersion: PROTOKOLLER.includes(oensket) ? oensket : PROTOKOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'spolen', title: 'spolen', version: String(srv.version) },
        instructions:
          'spolen is a private film and TV tracker. "Up next" is what the user can watch '
          + 'right now; a series listed with a future date means they are caught up. '
          + 'Ids look like "tv:1396" or "movie:603" — always get them from search, never '
          + 'invent them. Marking things watched changes the user\'s history, so ask '
          + 'before marking more than one episode.',
      });
    }
    if (method === 'ping') return ok(id, {});
    // Notifikationer har intet id og skal IKKE besvares - kun kvitteres med
    // 202 og tom krop, ellers venter klienten paa et svar, der aldrig kommer.
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) return null;

    if (method === 'tools/list') {
      // Vis kun det, noeglen faktisk maa. Saa foreslaar modellen ikke noget,
      // der alligevel giver 403.
      return ok(id, {
        tools: VAERKTOEJER.filter((v) => srv.maa(auth, v.scope)).map((v) => ({
          name: v.name, description: v.description, inputSchema: v.inputSchema,
        })),
      });
    }

    if (method === 'tools/call') {
      const navn = params && params.name;
      const v = VAERKTOEJER.find((x) => x.name === navn);
      if (!v) return fejl(id, -32602, `Unknown tool: ${navn}`);
      if (!srv.maa(auth, v.scope)) {
        return ok(id, {
          isError: true,
          content: [{ type: 'text', text:
            `This access key is "${auth.token.scope}" and cannot ${v.scope}. `
            + 'Create a key with a wider scope in spolen under Settings.' }],
        });
      }
      let svar;
      try {
        svar = await v.kald((params && params.arguments) || {}, auth);
      } catch (err) {
        srv.logError(`mcp ${navn}: ${err && err.stack ? err.stack : err}`);
        return ok(id, { isError: true, content: [{ type: 'text', text:
          'The tool failed. See the spolen server log.' }] });
      }
      /*
       * En fejl fra et vaerktoej er IKKE en protokolfejl. Sendes den som
       * JSON-RPC-error, ser modellen den som "serveren er i stykker" og
       * giver op; som isError kan den laese beskeden og rette op.
       */
      if (svar.fejl) return ok(id, { isError: true, content: [{ type: 'text', text: svar.fejl }] });
      return ok(id, Object.assign(
        { content: [{ type: 'text', text: svar.tekst }] },
        svar.data ? { structuredContent: svar.data } : {},
      ));
    }

    return fejl(id, -32601, `Method not found: ${method}`);
  }

  /* ------------------------------------------------------------ http */

  async function haandter(req, res) {
    if (req.method === 'GET' || req.method === 'DELETE') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'method_not_allowed',
        message: 'spolen answers MCP on POST only.' }));
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

    /*
     * DNS-rebinding: en browser paa et fremmed site maa ikke kunne naa den
     * her. Kommer der ingen Origin (Claude Code, Desktop), er der intet at
     * tjekke - det er kun browsere, der saetter den.
     */
    const origin = req.headers.origin;
    if (origin) {
      const vaert = req.headers['x-forwarded-host'] || req.headers.host || '';
      let tilladt = false;
      try { tilladt = new URL(origin).host === String(vaert).split(',')[0].trim(); } catch { /* nej */ }
      if (!tilladt) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_origin', message: 'Origin not allowed.' }));
        return;
      }
    }

    const auth = srv.godkendMcp(req);
    if (!auth) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        /*
         * WWW-Authenticate er HELE indgangen til OAuth: uden
         * resource_metadata kan claude.ai ikke finde autorisationsserveren
         * og opgiver forbindelsen (RFC 9728).
         */
        'WWW-Authenticate': srv.oauthUdfordring
          ? srv.oauthUdfordring(req) : 'Bearer realm="spolen"',
      });
      res.end(JSON.stringify({ error: 'invalid_key',
        message: 'Send a valid spolen access key as "Authorization: Bearer spolen_…".' }));
      return;
    }

    let krop;
    try {
      // tilladArray: JSON-RPC maa sende et bundt beskeder.
      krop = await srv.readJsonBody(req, true, true);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fejl(null, -32700, 'Parse error')));
      return;
    }

    const flere = Array.isArray(krop);
    const beskeder = flere ? krop : [krop];
    const svar = [];
    for (const b of beskeder) {
      const s = await behandl(b, auth);
      if (s) svar.push(s);
    }

    // Kun notifikationer i bundtet: kvitter uden krop, som protokollen kraever.
    if (!svar.length) { res.writeHead(202); res.end(); return; }
    const krop2 = JSON.stringify(flere ? svar : svar[0]);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(krop2),
      'Cache-Control': 'no-store',
    });
    res.end(krop2);
  }

  return { haandter, VAERKTOEJER };
}

module.exports = { opret, PROTOKOL, PROTOKOLLER };
