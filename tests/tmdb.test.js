'use strict';
/*
 * Proever for TMDB-klientens RENE dele: noegleformat, aarstal, billed-URL.
 *
 * Selve netvaerkskaldene proeves ikke her - de kraever en noegle og et
 * fremmed system. Det, der KAN gaa galt uden net, er oversaettelsen, og
 * det er den, der er proevet.
 */
const test = require('node:test');
const assert = require('node:assert');
const tmdb = require('../app/tmdb.js');

test('noegleformatet afgoer auth-maaden', () => {
  // TMDB udleverer to slags, og folk indsaetter den, de finder foerst.
  // Et v4-token er et JWT; en v3-noegle er 32 hex-tegn.
  assert.equal(tmdb.erBearer('eyJhbGciOiJIUzI1NiJ9.abc.def'), true);
  // Bevidst genkendelig som opdigtet: en rigtig v3-noegle er 32 tilfaeldige
  // hex-tegn, og saadan en maa ikke ligge i et offentligt repo - heller ikke
  // en falsk, for en laeser kan ikke se forskel.
  assert.equal(tmdb.erBearer('deadbeefdeadbeefdeadbeefdeadbeef'), false);
  // Mellemrum omkring en indsat noegle maa ikke aendre svaret.
  assert.equal(tmdb.erBearer('  eyJhbGci  '), true);
  assert.equal(tmdb.erBearer(''), false);
  assert.equal(tmdb.erBearer(null), false);
});

test('aarstal trækkes ud af en dato - og tom dato giver null, ikke NaN', () => {
  assert.equal(tmdb.aar('2026-08-28'), 2026);
  assert.equal(tmdb.aar('1998'), 1998);
  // TMDB sender ofte en TOM streng for uannoncerede titler. Blev det til
  // NaN, ville aarstallet staa som "NaN" i fladen.
  assert.equal(tmdb.aar(''), null);
  assert.equal(tmdb.aar(null), null);
  assert.equal(tmdb.aar(undefined), null);
});

test('billed-URL bygges af stien, og manglende plakat giver null', () => {
  assert.equal(tmdb.billedUrl('/abc.jpg'), 'https://image.tmdb.org/t/p/w342/abc.jpg');
  assert.equal(tmdb.billedUrl('/abc.jpg', 'w500'), 'https://image.tmdb.org/t/p/w500/abc.jpg');
  // En titel uden plakat er almindelig - den maa ikke give ".../null".
  assert.equal(tmdb.billedUrl(null), null);
  assert.equal(tmdb.billedUrl(''), null);
});

test('en ukendt medietype afvises frem for at blive gaettet', () => {
  assert.throws(() => tmdb.hentTitel('noegle', 'bog', 1), /unknown kind/);
});
