'use strict';
/*
 * Proever for statistikken.
 *
 * Vaegten ligger paa de steder, hvor et tal kan blive FORKERT uden at se
 * forkert ud: gaettet spilletid, der lægges sammen tusind gange, og en
 * "laengste aften", der maales i den forkerte enhed.
 */
const test = require('node:test');
const assert = require('node:assert');
const st = require('../app/shared/statistik.js');

const dag = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 20) / 1000);

test('tom historik giver nuller - ikke NaN', () => {
  const s = st.statistik([]);
  assert.equal(s.antal, 0);
  assert.equal(s.minutter, 0);
  assert.equal(s.laengsteDag, null);
  assert.equal(s.serier, 0);
});

test('film og afsnit taelles hver for sig', () => {
  const s = st.statistik([
    { watchedAt: dag('2026-01-01'), type: 'movie', runtime: 120, titleId: 'movie:1' },
    { watchedAt: dag('2026-01-02'), type: 'episode', runtime: 50, titleId: 'tv:1' },
    { watchedAt: dag('2026-01-03'), type: 'episode', runtime: 50, titleId: 'tv:1' },
  ]);
  assert.equal(s.film, 1);
  assert.equal(s.afsnit, 2);
  assert.equal(s.serier, 1, 'to afsnit af samme serie er ÉN serie');
  assert.equal(s.minutter, 220);
});

test('GAETTET spilletid taelles med - men rapporteres separat', () => {
  // Det er hele pointen: et gaet, der lægges sammen tusind gange, er ikke
  // laengere et gaet, medmindre man siger hvor meget der er gaettet.
  const s = st.statistik([
    { watchedAt: dag('2026-01-01'), type: 'episode', runtime: 60, titleId: 'tv:1' },
    { watchedAt: dag('2026-01-02'), type: 'episode', runtime: null, titleId: 'tv:1' },
  ], { gaetMinutter: 45 });
  assert.equal(s.minutter, 105);
  assert.equal(s.gaettedeMinutter, 45);
  assert.equal(s.gaettedePoster, 1);
  assert.equal(s.gaetMinutter, 45);
});

test('en spilletid paa 0 eller negativ regnes som UKENDT, ikke som nul', () => {
  // TMDB har 0 i feltet, naar den ikke ved det. Regnede vi 0 som sandhed,
  // ville en hel serie taelle nul minutter og forsvinde ud af regnskabet.
  const s = st.statistik([
    { watchedAt: dag('2026-01-01'), type: 'episode', runtime: 0, titleId: 'tv:1' },
  ], { gaetMinutter: 45 });
  assert.equal(s.minutter, 45);
  assert.equal(s.gaettedePoster, 1);
});

test('laengste dag maales i MINUTTER, ikke i antal afsnit', () => {
  // Seks afsnit sitcom er ikke en laengere aften end tre afsnit drama.
  const s = st.statistik([
    ...Array.from({ length: 6 }, () => ({ watchedAt: dag('2026-02-01'), type: 'episode', runtime: 20, titleId: 'tv:1' })),
    ...Array.from({ length: 3 }, () => ({ watchedAt: dag('2026-02-02'), type: 'episode', runtime: 55, titleId: 'tv:2' })),
  ]);
  assert.equal(s.laengsteDag.dato, '2026-02-02');   // 165 min mod 120
  assert.equal(s.laengsteDag.minutter, 165);
  assert.equal(s.laengsteDag.antal, 3);
});

test('minutter fordeles paa aar', () => {
  const s = st.statistik([
    { watchedAt: dag('2025-12-31'), type: 'movie', runtime: 100, titleId: 'movie:1' },
    { watchedAt: dag('2026-01-01'), type: 'movie', runtime: 90, titleId: 'movie:2' },
  ]);
  assert.equal(s.perAar['2025'], 100);
  assert.equal(s.perAar['2026'], 90);
});

test('en titel paa FLERE tjenester taelles hos dem alle', () => {
  // Summen af tjenesterne er derfor stoerre end totalen. Det er med vilje -
  // spoergsmaalet "hvor meget saa jeg paa Netflix" har ikke et svar, der
  // kan lægges sammen med de andre.
  const s = st.statistik([
    { watchedAt: dag('2026-01-01'), type: 'movie', runtime: 100, titleId: 'movie:1',
      services: ['Netflix', 'Max'] },
  ]);
  assert.equal(s.minutter, 100);
  assert.equal(s.perTjeneste.Netflix, 100);
  assert.equal(s.perTjeneste.Max, 100);
});

test('genrer summeres, og en post uden genrer taeller stadig i totalen', () => {
  const s = st.statistik([
    { watchedAt: dag('2026-01-01'), type: 'movie', runtime: 100, titleId: 'm:1', genres: ['Drama', 'Crime'] },
    { watchedAt: dag('2026-01-02'), type: 'movie', runtime: 50, titleId: 'm:2' },
  ]);
  assert.equal(s.perGenre.Drama, 100);
  assert.equal(s.perGenre.Crime, 100);
  assert.equal(s.minutter, 150);
});

test('poster uden dato springes over', () => {
  const s = st.statistik([
    { watchedAt: null, type: 'movie', runtime: 100, titleId: 'm:1' },
    { watchedAt: dag('2026-01-01'), type: 'movie', runtime: 90, titleId: 'm:2' },
  ]);
  assert.equal(s.antal, 1);
  assert.equal(s.minutter, 90);
});

test('top() sorterer stoerste foerst og respekterer graensen', () => {
  const t = st.top({ a: 10, b: 50, c: 30 }, 2);
  assert.deepEqual(t, [{ navn: 'b', minutter: 50 }, { navn: 'c', minutter: 30 }]);
});

test('varighed: minutter under en time, timer derover', () => {
  // "0 h" for 40 minutter ville ligne, at der ikke var set noget.
  assert.equal(st.varighed(40), '40 min');
  assert.equal(st.varighed(90), '2 h');
  assert.equal(st.varighed(60), '1 h');
  assert.equal(st.varighed(0), '0 min');
});

test('varighed: over to doegn vises dage OG timer', () => {
  // "9 days" alene siger ikke, om det er 9 eller 14 doegns indhold.
  assert.equal(st.varighed(50 * 60), '2 d 2 h');
});

/* -------------------------------------------------- usikre datoer (backfill) */

test('en USIKKER dato taeller med i totalen, men ikke i "hvornaar"', () => {
  /*
   * Massemarkerer man 351 afsnit, ved vi AT de er set - ikke HVORNAAR.
   * Skrev vi "i dag" paa dem alle, blev "laengste aften" til 351 afsnit,
   * og aarsopgoerelsen lagde et helt livs seen i indevaerende aar.
   */
  const s = st.statistik([
    { watchedAt: dag('2026-08-28'), type: 'episode', runtime: 30, titleId: 'tv:1', datoSikker: false },
    { watchedAt: dag('2026-08-28'), type: 'episode', runtime: 30, titleId: 'tv:1', datoSikker: false },
    { watchedAt: dag('2026-08-29'), type: 'episode', runtime: 45, titleId: 'tv:2' },
  ]);
  // Alt er set - det taeller.
  assert.equal(s.antal, 3);
  assert.equal(s.afsnit, 3);
  assert.equal(s.minutter, 105);
  assert.equal(s.serier, 2);
  // Men kun den daterede post siger noget om hvornaar.
  assert.equal(s.udenSikkerDato, 2);
  assert.equal(s.dage, 1);
  assert.equal(s.laengsteDag.dato, '2026-08-29');
  assert.equal(s.laengsteDag.antal, 1);
  assert.deepEqual(s.perAar, { 2026: 45 });
});

test('genrer og tjenester taeller MED, ogsaa uden sikker dato', () => {
  // "Hvad har jeg set" er et andet spoergsmaal end "hvornaar saa jeg det".
  const s = st.statistik([
    { watchedAt: dag('2026-08-28'), type: 'episode', runtime: 60, titleId: 'tv:1',
      datoSikker: false, genres: ['Drama'], services: ['Netflix'] },
  ]);
  assert.equal(s.perGenre.Drama, 60);
  assert.equal(s.perTjeneste.Netflix, 60);
  assert.equal(s.minutter, 60);
  assert.equal(s.dage, 0, 'ingen dag kan tælles');
  assert.equal(s.laengsteDag, null);
});

test('datoSikker udelades = sikker (den almindelige vej)', () => {
  // Flaget skal kun saettes af den, der VED at datoen er gaettet.
  const s = st.statistik([
    { watchedAt: dag('2026-08-29'), type: 'movie', runtime: 90, titleId: 'm:1' },
  ]);
  assert.equal(s.udenSikkerDato, 0);
  assert.equal(s.dage, 1);
});
