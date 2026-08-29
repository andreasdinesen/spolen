'use strict';
/*
 * Proever for Trakt-broens OVERSAETTELSE.
 *
 * Selve netvaerket kan ikke proeves her - det kraever en registreret
 * Trakt-app og et login. Det, der KAN gaa galt uden net, er formen: Trakt
 * pakker afsnit og film forskelligt, og en fejl dér taber halvdelen af
 * historikken tavst.
 *
 * Alle fixtures er opdigtede og efterligner Trakts dokumenterede form.
 */
const test = require('node:test');
const assert = require('node:assert');
const trakt = require('../app/trakt.js');

test('et AFSNIT oversaettes med seriens id\'er og afsnittets placering', () => {
  const ud = trakt.oversaetHistorik([{
    type: 'episode',
    watched_at: '2026-05-06T21:00:00.000Z',
    show: { title: 'Invented Series', year: 2020, ids: { imdb: 'tt0000001', tmdb: 111, tvdb: 222 } },
    episode: { season: 2, number: 4, title: 'An Episode' },
  }]);
  assert.equal(ud.length, 1);
  const r = ud[0];
  assert.equal(r.type, 'episode');
  // Titlen er SERIENS, ikke afsnittets - matchningen slaar serier op.
  assert.equal(r.title, 'Invented Series');
  assert.equal(r.season, 2);
  assert.equal(r.number, 4);
  assert.equal(r.ids.tmdb, 111);
  assert.equal(r.watchedAt, Math.floor(Date.parse('2026-05-06T21:00:00Z') / 1000));
});

test('en FILM oversaettes uden saeson og afsnit', () => {
  const ud = trakt.oversaetHistorik([{
    type: 'movie',
    watched_at: '2026-01-02T10:00:00.000Z',
    movie: { title: 'Invented Film', year: 1999, ids: { imdb: 'tt0000002', tmdb: 333 } },
  }]);
  assert.equal(ud[0].type, 'movie');
  assert.equal(ud[0].season, null);
  assert.equal(ud[0].number, null);
  assert.equal(ud[0].ids.tmdb, 333);
});

test('poster uden show/movie springes over frem for at blive halve raekker', () => {
  const ud = trakt.oversaetHistorik([
    { type: 'episode', watched_at: '2026-01-01T00:00:00.000Z' },   // mangler show
    { type: 'movie' },                                              // mangler movie
    null,
  ]);
  assert.equal(ud.length, 0);
});

test('en post uden watched_at giver null - ikke NaN', () => {
  const ud = trakt.oversaetHistorik([{
    type: 'movie', movie: { title: 'X', year: 2000, ids: {} },
  }]);
  assert.equal(ud[0].watchedAt, null);
});

test('WATCHLIST bliver til foelgninger, ikke til visninger', () => {
  /*
   * Det er den vigtigste skelnen i hele broen. En watchlist-post er noget,
   * man VIL se - bliver den til en visning, faar man en historik fuld af
   * ting, man aldrig har set, og "naeste usete afsnit" bliver forkert for
   * hver eneste af dem.
   */
  const ud = trakt.oversaetWatchlist([
    { show: { title: 'A Series', year: 2021, ids: { tmdb: 55 } } },
    { movie: { title: 'A Film', year: 2019, ids: { tmdb: 66 } } },
  ]);
  assert.equal(ud[0].type, 'show');
  assert.equal(ud[1].type, 'movie');
  // Ingen dato = ingen visning i importmotoren.
  assert.equal(ud[0].watchedAt, null);
  assert.equal(ud[1].watchedAt, null);
});

test('oversaettelsen giver SAMME form som filimporten', () => {
  // Motoren er faelles, saa formen skal vaere det ogsaa. Mangler et felt,
  // opfoerer de to importveje sig forskelligt paa de svaere raekker.
  const r = trakt.oversaetHistorik([{
    type: 'episode', watched_at: '2026-01-01T00:00:00.000Z',
    show: { title: 'S', year: 2020, ids: { tmdb: 1 } }, episode: { season: 1, number: 1 },
  }])[0];
  for (const felt of ['type', 'title', 'year', 'ids', 'season', 'number', 'watchedAt', 'kilde']) {
    assert.ok(felt in r, `mangler feltet ${felt}`);
  }
});
