'use strict';
/*
 * spolen - statistik over det, man har set.
 *
 * Rent modul: ingen database, intet net, ingen Date.now(). Alt gives ind.
 *
 * DEN VIGTIGSTE BESLUTNING her er, hvordan MANGLENDE spilletid haandteres.
 * TMDB har ikke en varighed paa hvert afsnit - saerligt ikke paa nye eller
 * paa nordiske serier. Man kan gaette (45 minutter er den saedvanlige
 * antagelse), men et gaet, der bliver lagt sammen tusind gange, er ikke
 * laengere et gaet: det er et tal, brugeren tror paa.
 *
 * Derfor: der gaettes, men der TAELLES OGSAA, hvor meget der er gaettet, og
 * tallet foelger med ud. Saa kan fladen sige "ca. 210 timer, heraf 40 timer
 * anslaaet" i stedet for at lade som om, den ved det.
 *
 * SAMME REGEL GAELDER DATOEN. Massemarkerer man en serie paa 351 afsnit, ved
 * vi AT de er set - ikke HVORNAAR. Skriver man "i dag" paa dem alle, bliver
 * "laengste aften" til 351 afsnit paa én dag, og aarsopgoerelsen laegger et
 * helt livs seen i indevaerende aar. Derfor baerer hver post et
 * `datoSikker`-flag: usikre datoer taeller MED i totalerne (de er set) og
 * UDE af alt, der handler om hvornaar.
 */

/** Epoke-sekunder -> 'YYYY-MM-DD' i UTC. Alle dagsopgoerelser bruger samme. */
function dagFor(sekunder) {
  return new Date(sekunder * 1000).toISOString().slice(0, 10);
}

/**
 * @param {Array} poster  [{watchedAt, runtime, type, titleId, titleName, genres, services}]
 *   `runtime` i minutter, eller null naar den er ukendt.
 * @param {object} [opts] {gaetMinutter: 45}
 */
function statistik(poster, opts) {
  const o = opts || {};
  // 45 er ikke sandhed, men den mest almindelige afsnitslaengde. Tallet
  // staar ÉT sted og foelger med i svaret, saa fladen kan naevne det.
  const gaet = Number.isFinite(o.gaetMinutter) ? o.gaetMinutter : 45;

  const ud = {
    antal: 0,
    film: 0,
    afsnit: 0,
    minutter: 0,
    gaettedeMinutter: 0,
    gaettedePoster: 0,
    gaetMinutter: gaet,
    udenSikkerDato: 0,
    perAar: {},
    perGenre: {},
    perTjeneste: {},
    serier: new Set(),
    laengsteDag: null,
    foerste: null,
    sidste: null,
  };
  const perDag = new Map();

  for (const p of poster || []) {
    if (!p || !p.watchedAt) continue;
    ud.antal++;
    if (p.type === 'movie') ud.film++; else ud.afsnit++;
    if (p.titleId && p.type !== 'movie') ud.serier.add(p.titleId);

    const kendt = Number.isFinite(p.runtime) && p.runtime > 0;
    const min = kendt ? p.runtime : gaet;
    if (!kendt) { ud.gaettedeMinutter += min; ud.gaettedePoster++; }
    ud.minutter += min;

    for (const g of p.genres || []) ud.perGenre[g] = (ud.perGenre[g] || 0) + min;
    // En titel kan ligge paa flere tjenester. Minutterne taelles saa med hos
    // dem alle - summen af tjenesterne er derfor IKKE lig totalen, og det
    // skal fladen ikke lade som om.
    for (const t of p.services || []) ud.perTjeneste[t] = (ud.perTjeneste[t] || 0) + min;

    /*
     * ALT hvad der handler om HVORNAAR, kraever en dato, vi tror paa.
     * En massemarkering har et tidsstempel - men det er tidspunktet, hvor
     * der blev trykket, ikke hvor der blev set.
     */
    if (p.datoSikker === false) { ud.udenSikkerDato++; continue; }

    const dag = dagFor(p.watchedAt);
    ud.perAar[dag.slice(0, 4)] = (ud.perAar[dag.slice(0, 4)] || 0) + min;

    const d = perDag.get(dag) || { dato: dag, antal: 0, minutter: 0 };
    d.antal++; d.minutter += min;
    perDag.set(dag, d);

    if (!ud.foerste || p.watchedAt < ud.foerste) ud.foerste = p.watchedAt;
    if (!ud.sidste || p.watchedAt > ud.sidste) ud.sidste = p.watchedAt;
  }

  // Den laengste dag maales i MINUTTER, ikke i antal afsnit: seks afsnit af
  // en sitcom er ikke en laengere aften end tre afsnit af et drama.
  for (const d of perDag.values()) {
    if (!ud.laengsteDag || d.minutter > ud.laengsteDag.minutter) ud.laengsteDag = d;
  }

  ud.serier = ud.serier.size;
  ud.dage = perDag.size;
  return ud;
}

/** Sorterer et {navn: minutter}-objekt til en liste, stoerste foerst. */
function top(objekt, graense) {
  return Object.entries(objekt || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, graense || 10)
    .map(([navn, minutter]) => ({ navn, minutter }));
}

/**
 * Minutter -> laesbar tekst.
 *
 * Under en time vises minutter; derover timer. "0 t" for 40 minutter ville
 * ligne, at der ikke var set noget.
 */
function varighed(minutter) {
  const m = Math.round(minutter || 0);
  if (m < 60) return `${m} min`;
  const timer = Math.round(m / 60);
  if (timer < 48) return `${timer} h`;
  // Over to doegn bliver timer uhaandterlige - men dagene skal ikke staa
  // alene, for "9 days" siger ikke, om det er 9 eller 14 doegns indhold.
  return `${Math.round(timer / 24)} d ${timer % 24} h`;
}

module.exports = { dagFor, statistik, top, varighed };
