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

/*
 * Saesonerne i overblikket.
 *
 * TMDB-kald KAN proeves uden net og uden noegle ved at give modulet en
 * attrap-https: det, der maales, er stadig oversaettelsen - og her ogsaa
 * HVILKEN adresse der kaldes, for det er prisen i TMDB-kald, der er hele
 * pointen med at dele overblikket og saesonerne i to endepunkter.
 */
function medAttrapTmdb(svar, koer) {
  const https = require('node:https');
  const rigtige = https.get;
  const kaldte = [];
  https.get = (url, opts, cb) => {
    kaldte.push(String(url).split('?')[0]);
    const res = {
      statusCode: 200,
      on: (navn, f) => {
        if (navn === 'data') f(Buffer.from(JSON.stringify(svar), 'utf8'));
        if (navn === 'end') f();
      },
    };
    cb(res);
    return { on: () => {}, setTimeout: () => {}, destroy: () => {} };
  };
  return Promise.resolve(koer(kaldte)).finally(() => { https.get = rigtige; });
}

test('overblikket faar saesonerne med - uden ét kald pr. saeson', async () => {
  await medAttrapTmdb({
    id: 1, name: 'Proeveserien', number_of_seasons: 2, number_of_episodes: 8,
    seasons: [
      { season_number: 2, name: 'Season 2', episode_count: 4, air_date: '2026-09-01' },
      { season_number: 0, name: 'Specials', episode_count: 2, air_date: '2026-12-01' },
      { season_number: 1, name: 'Season 1', episode_count: 4, air_date: '2026-01-01' },
    ],
  }, async (kaldte) => {
    const o = await tmdb.hentOverblik('noegle', 'tv', 1);
    assert.deepStrictEqual(o.seasons.map((s) => s.season), [1, 2, 0],
      'saesonerne staar ikke i den orden, man ser en serie i (specials sidst)');
    assert.strictEqual(o.seasons[0].episodeCount, 4);
    // ÉT kald. Hentede overblikket ogsaa afsnittene, ville et kig paa en
    // serie med ti saesoner koste elleve kald.
    assert.strictEqual(kaldte.length, 1, `overblikket koster ${kaldte.length} TMDB-kald`);
  });
});

test('en FILM har ingen saesoner - feltet er null, ikke en tom liste', async () => {
  await medAttrapTmdb({ id: 2, title: 'En film', runtime: 100 }, async () => {
    const o = await tmdb.hentOverblik('noegle', 'movie', 2);
    assert.strictEqual(o.seasons, null);
  });
});

test('én saeson hentes for sig - ét kald, og kun den saeson', async () => {
  await medAttrapTmdb({
    episodes: [
      { season_number: 2, episode_number: 1, name: 'Afsnit 5', air_date: '2026-09-10',
        runtime: 45, overview: 'Et resume.' },
      { season_number: 2, episode_number: 2, name: '', air_date: null },
    ],
  }, async (kaldte) => {
    const liste = await tmdb.hentSaeson('noegle', 1, 2);
    assert.deepStrictEqual(kaldte, ['https://api.themoviedb.org/3/tv/1/season/2'],
      'den forkerte adresse - eller mere end én saeson');
    assert.strictEqual(liste.length, 2);
    assert.strictEqual(liste[0].name, 'Afsnit 5');
    // Et afsnit uden navn eller dato er almindeligt i en kommende saeson og
    // maa ikke blive til "null" eller "undefined" paa skaermen.
    assert.strictEqual(liste[1].name, '');
    assert.strictEqual(liste[1].airDate, null);
  });
});
