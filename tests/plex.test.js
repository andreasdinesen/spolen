'use strict';
/*
 * Proever for Plex-broens RENE dele: GUID-laesning og oversaettelse.
 *
 * Selve netvaerket kan ikke proeves her - det kraever en koerende Plex-server.
 * Det, der kan gaa galt UDEN net, er formen, og den er ikke triviel: Plex
 * pakker afsnit og film forskelligt, og en server, der har koert i aarevis,
 * har baade nye og gamle GUID-former liggende side om side.
 *
 * Alle fixtures er opdigtede og efterligner Plex' dokumenterede form.
 */
const test = require('node:test');
const assert = require('node:assert');
const plex = require('../app/plex.js');

/* ------------------------------------------------------------- guids */

test('nye GUID-former laeses', () => {
  assert.deepEqual(plex.laesGuids(['imdb://tt0000001', 'tmdb://123', 'tvdb://456']),
    { imdb: 'tt0000001', tmdb: 123, tvdb: 456 });
});

test('GAMLE agent-URI\'er laeses ogsaa', () => {
  // En server, der har koert i aarevis, har begge former. Laeser man kun de
  // nye, mister man historikken for alt det gamle - tavst.
  assert.deepEqual(
    plex.laesGuids(['com.plexapp.agents.thetvdb://73141/1/1?lang=en']), { tvdb: 73141 });
  assert.deepEqual(
    plex.laesGuids(['com.plexapp.agents.imdb://tt0000002?lang=en']), { imdb: 'tt0000002' });
});

test('ukendte GUID-former ignoreres frem for at kaste', () => {
  assert.deepEqual(plex.laesGuids(['plex://episode/abc123', 'local://42', '']), {});
  assert.deepEqual(plex.laesGuids(null), {});
});

/* ------------------------------------------------------- oversaettelse */

const afsnit = {
  type: 'episode',
  title: 'An Episode',
  grandparentTitle: 'Invented Series',
  grandparentRatingKey: '1001',
  parentIndex: 2,
  index: 5,
  viewedAt: 1767225600,
  ratingKey: '2002',
};

test('et afsnit bruger SERIENS titel og noegle - ikke afsnittets', () => {
  /*
   * Den vigtigste enkeltregel her. Matchningen slaar SERIER op i TMDB, saa
   * bruger man afsnittets titel ("An Episode"), matcher intet. Og GUID'erne
   * hoerer til grandparentRatingKey, ikke til afsnittets egen ratingKey.
   */
  const guids = new Map([['1001', { tmdb: 999 }]]);
  const r = plex.oversaetHistorik([afsnit], guids)[0];
  assert.equal(r.type, 'episode');
  assert.equal(r.title, 'Invented Series');
  assert.equal(r.season, 2);
  assert.equal(r.number, 5);
  assert.equal(r.ids.tmdb, 999);
  assert.equal(r.watchedAt, 1767225600);
});

test('en film bruger sin EGEN noegle', () => {
  const guids = new Map([['3003', { imdb: 'tt0000003' }]]);
  const r = plex.oversaetHistorik([{
    type: 'movie', title: 'Invented Film', year: 1999, ratingKey: '3003', viewedAt: 1767225600,
  }], guids)[0];
  assert.equal(r.type, 'movie');
  assert.equal(r.ids.imdb, 'tt0000003');
  assert.equal(r.season, null);
});

test('saeson 0 (specials) bevares som 0 - ikke som "mangler"', () => {
  // Number.isFinite(0) er true, men et naivt `p.parentIndex || null` ville
  // goere saeson 0 til null og sende alle specials i den umatchede bunke.
  const r = plex.oversaetHistorik([{ ...afsnit, parentIndex: 0, index: 1 }], new Map())[0];
  assert.equal(r.season, 0);
  assert.equal(r.number, 1);
});

test('en post uden saeson/afsnit giver null, saa den kan meldes umatchet', () => {
  const r = plex.oversaetHistorik([{ ...afsnit, parentIndex: undefined, index: undefined }], new Map())[0];
  assert.equal(r.season, null);
  assert.equal(r.number, null);
});

test('musik og andre typer springes over', () => {
  const ud = plex.oversaetHistorik([
    { type: 'track', title: 'A Song', viewedAt: 1 },
    { type: 'photo', title: 'A Photo', viewedAt: 2 },
    null,
  ], new Map());
  assert.equal(ud.length, 0);
});

test('manglende guids giver et tomt objekt, ikke en fejl', () => {
  const r = plex.oversaetHistorik([afsnit], new Map())[0];
  assert.deepEqual(r.ids, {});
});

/* ------------------------------------------------- opslag pr. UNIK titel */

test('der slaas GUID\'er op pr. SERIE, ikke pr. afsnit', () => {
  /*
   * En serie med 60 sete afsnit skal give ÉT opslag mod Plex, ikke tres.
   * Uden det ville en foerste import hamre serveren i minutter.
   */
  const poster = Array.from({ length: 60 }, (_, i) => ({ ...afsnit, index: i + 1, ratingKey: `2${i}` }));
  assert.deepEqual(plex.noeglerAtSlaaOp(poster), ['1001']);
});

test('film og serier blandet giver én noegle for hver', () => {
  const noegler = plex.noeglerAtSlaaOp([
    afsnit,
    { ...afsnit, index: 6 },
    { type: 'movie', ratingKey: '3003' },
    { type: 'track', ratingKey: '9999' },
  ]);
  assert.deepEqual(noegler.sort(), ['1001', '3003']);
});

test('oversaettelsen giver SAMME form som fil- og Trakt-importen', () => {
  const r = plex.oversaetHistorik([afsnit], new Map())[0];
  for (const felt of ['type', 'title', 'year', 'ids', 'season', 'number', 'watchedAt', 'kilde']) {
    assert.ok(felt in r, `mangler feltet ${felt}`);
  }
  assert.equal(r.kilde, 'plex');
});
