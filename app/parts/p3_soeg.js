
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
      ryddeKnap(alle),
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
 * Titler man foelger UDEN at have set noget af dem.
 *
 * Udregnes af det, biblioteket ALLEREDE har hentet - `progress` for serier,
 * `watched` for film - saa knappen kan vide, om der er noget at rydde op i,
 * uden et ekstra kald ved hver sideindlaesning.
 */
function useteTitler(alle, kunSerier) {
  return alle.filter((r) => {
    if (kunSerier && r.title.kind !== 'tv') return false;
    return r.title.kind === 'tv' ? !(r.progress && r.progress.sete > 0) : !r.watched;
  });
}

/*
 * Ryd op i biblioteket.
 *
 * Knappen vises kun, naar der ER noget at rydde - ellers er den bare en
 * knap, der siger "nul".
 */
function ryddeKnap(alle) {
  const kandidater = useteTitler(alle, false);
  if (!kandidater.length) return null;
  return el('button', {
    class: 'btn ghost lille',
    text: `Tidy up (${kandidater.length})`,
    title: 'Remove titles you follow but have not watched anything of',
    onclick: () => visOprydning(alle),
  });
}

/*
 * Oprydningen, med listen FOER handlingen.
 *
 * En knap, der fjerner hundredvis af titler paa ét tryk, skal vise hvad den
 * tager. Det er ikke til at huske, hvad der stod i biblioteket, og en
 * fortrydelse findes ikke - de skal tilfoejes én ad gangen igen.
 *
 * Importen gav ALLE serier tilstanden `watchlist`, uanset om de kom fra
 * oenskelisten eller samlingen, saa tilstanden kan ikke skelne. Det, der KAN
 * skelnes paa, er hvor markeringen kom fra - derfor staar `source` med.
 */
function visOprydning(alle) {
  let kunSerier = true;
  const bag = el('div', { class: 'modalbag', onclick: (e) => { if (e.target === bag) luk(); } });
  const luk = () => { bag.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') luk(); };

  const kort = el('div', { class: 'modal-card oprydning', role: 'dialog', 'aria-modal': 'true' });
  const tegn = () => {
    const liste = useteTitler(alle, kunSerier);
    kort.textContent = '';
    /*
     * FILTRÉR null'erne fra.
     *
     * el() springer tomme boern over, men DOM'ens egen append() laver `null`
     * om til TEKSTEN "null" - og saa staar der bogstaveligt "null" paa
     * skaermen. Fanget paa et skaermbillede; ingen af de strukturelle
     * proever saa det, fordi de kun kiggede paa .item-row og <p>
     * (2026-09-01).
     */
    kort.append(...[
      el('h3', { text: 'Tidy up your library' }),
      el('p', { class: 'dim lille', text:
        'These are titles you follow but have not watched anything of. Removing them leaves '
        + 'no history behind — there is none. You can add any of them again later.' }),
      el('label', { class: 'lille', style: 'display:flex;gap:8px;align-items:center;margin:10px 0' }, [
        (() => {
          const b = el('input', { type: 'checkbox' });
          b.checked = kunSerier;
          b.addEventListener('change', () => { kunSerier = b.checked; tegn(); });
          return b;
        })(),
        el('span', { text: 'Series only (leave films alone)' }),
      ]),
      el('p', { class: liste.length ? 'chip klar' : 'dim',
        text: liste.length === 1 ? '1 title will be removed' : `${liste.length} titles will be removed` }),
      el('div', { class: 'liste oprydningsliste' }, liste.slice(0, 400).map((r) => el('div', { class: 'item-row' }, [
        el('span', { class: 'lille', text: r.title.name }),
        el('span', { class: 'dim lille', text: [
          r.title.kind === 'tv' ? 'series' : 'film',
          r.tracking && r.tracking.source === 'import' ? 'from the import' : null,
        ].filter(Boolean).join(' · ') }),
      ]))),
      liste.length > 400
        ? el('p', { class: 'dim lille', text: `…and ${liste.length - 400} more. All of them will be removed.` })
        : null,
      el('div', { class: 'knaprad' }, [
        el('button', { class: 'btn primary', disabled: !liste.length,
          text: `Remove ${liste.length}`,
          onclick: async (e) => { e.target.disabled = true; await ryd(liste, luk); } }),
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: luk }),
      ]),
    ].filter(Boolean));
  };

  tegn();
  bag.appendChild(kort);
  document.body.appendChild(bag);
  document.addEventListener('keydown', paaTast);
}

async function ryd(liste, luk) {
  try {
    const svar = await api('/library/cleanup', { method: 'POST',
      body: { titleIds: liste.map((r) => r.title.id) } });
    luk();
    /*
     * Serveren springer titler over, der HAR faaet en visning imens - fx
     * fra Plex. Det skal siges, ikke skjules: ellers undrer man sig over,
     * at tallet ikke passer.
     */
    const sprunget = (svar.sprunget || []).length;
    toast(sprunget
      ? `Removed ${svar.fjernet}. Kept ${sprunget} that had been watched in the meantime.`
      : `Removed ${svar.fjernet}.`);
    await Promise.all([hentUpNext(), hentBibliotek()]);
    tegnSide();
  } catch (err) {
    toast(err.message, 'fejl');
  }
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

/* ------------------------------------------------------------- historik */

/*
 * Hvad man SIDST har set - modstykket til Up Next (Andreas, 2026-08-31).
 *
 * Grupperet efter DAG. En flad liste med et klokkeslaet pr. raekke svarer
 * ikke paa "hvornaar" - man skal selv laese datoer og finde skiftene. Med en
 * overskrift pr. dag ser man det med det samme, og en aftens seance staar
 * samlet.
 */
function historikSide() {
  const h = state.historik;
  if (!h.hentet) { hentHistorik(); return el('p', { class: 'dim', text: 'Loading…' }); }
  if (h.fejl) return el('p', { class: 'noeglestatus mangler', text: h.fejl });
  if (!h.raekker.length) {
    return tomtRum('Nothing watched yet',
      'Mark an episode or a film as watched, and it shows up here.');
  }

  /*
   * Dagen udregnes i den LOKALE tidszone, ikke i UTC.
   *
   * Ser man et afsnit klokken 23 dansk tid om vinteren, er det stadig samme
   * dag - men UTC-datoen ville sige i morgen. En historik, hvor aftenen
   * flytter sig en dag frem, er svaer at stole paa.
   */
  const dagFor = (epoke) => {
    const d = new Date(epoke * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const grupper = [];
  for (const r of h.raekker) {
    const dag = dagFor(r.watchedAt);
    if (!grupper.length || grupper[grupper.length - 1].dag !== dag) grupper.push({ dag, raekker: [] });
    grupper[grupper.length - 1].raekker.push(r);
  }

  return el('div', { class: 'bredside' }, [
    el('div', { class: 'sidehoved' }, [
      el('h1', { text: 'History' }),
      el('span', { class: 'dim lille', text: h.raekker.length === 1
        ? '1 viewing' : `${h.raekker.length} viewings` }),
    ]),
    ...grupper.map((g) => el('div', {}, [
      el('div', { class: 'bogstavhoved', text: dagOverskrift(g.dag, h.today) }),
      el('div', { class: 'kortliste' }, g.raekker.map(historikKort)),
    ])),
    /* Loftet er 200. Er der flere, skal det siges - ellers tror man, at det
       er alt, hvad man har set. */
    h.raekker.length >= 200
      ? el('p', { class: 'dim lille', text:
          'Showing the 200 most recent. Older entries are still counted under Statistics.' })
      : null,
  ]);
}

/* "Today" og "Yesterday" i stedet for datoer, man skal regne paa. */
function dagOverskrift(dag, idag) {
  if (dag === idag) return 'Today';
  const d = new Date(`${dag}T12:00:00`);
  const iGaar = new Date(`${idag}T12:00:00`);
  iGaar.setDate(iGaar.getDate() - 1);
  if (d.toDateString() === iGaar.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function historikKort(r) {
  const t = r.title;
  const e = r.episode;
  const tid = new Date(r.watchedAt * 1000)
    .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return el('article', { class: 'naeste-kort card' }, [
    el('button', { class: 'plakatknap', title: `Open ${t.name}`, onclick: () => aabnTitel(t.id) }, [
      t.posterPath
        ? el('img', { class: 'plakat', src: `/api/poster/w342${t.posterPath}`, alt: '', loading: 'lazy' })
        : el('div', { class: 'plakat' }),
    ]),
    el('div', {}, [
      el('h3', {}, [
        el('button', { class: 'afsnitslink', text: t.name, title: `Open ${t.name}`,
          onclick: () => aabnTitel(t.id) }),
      ]),
      e
        ? el('button', { class: 'afsnitsmaerke afsnitslink',
            text: `S${e.season}E${e.number}${e.name ? ' · ' + e.name : ''}`,
            title: 'Show the episode description',
            onclick: () => visAfsnit(e.id) })
        : el('div', { class: 'dim lille', text: `Film${t.year ? ' · ' + t.year : ''}` }),
      el('div', { class: 'kortbund' }, [
        el('span', { class: 'chip neutral', text: tid }),
        /*
         * Kilden staar med, fordi den forklarer overraskelser: en raekke, man
         * ikke selv satte, kom fra Plex eller en import - og saa er det ikke
         * appen, der har fundet paa noget.
         */
        r.source && r.source !== 'manual'
          ? el('span', { class: 'dim lille', text: r.source })
          : null,
      ]),
    ]),
  ]);
}

async function hentHistorik() {
  try {
    const svar = await api('/history?limit=200');
    state.historik = { hentet: true, fejl: '', raekker: svar.rows || [], today: svar.today };
  } catch (err) {
    state.historik = { hentet: true, fejl: err.message, raekker: [] };
  }
}
