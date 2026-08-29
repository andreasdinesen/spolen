
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
  return el('div', {}, [
    el('h2', { text: 'Access keys' }),
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
