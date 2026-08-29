'use strict';
/*
 * Proever for den LOKALE soegning.
 *
 * Andreas, 2026-08-29: han soegte "Spiderman 3", havde filmen i biblioteket,
 * og afsnittet "In your library" var tomt - filmen dukkede kun op under
 * "From TMDB" med et "Added"-maerke. Aarsagen var
 * `lower(name) LIKE '%spiderman 3%'`, som aldrig rammer "Spider-Man 3".
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { sammenligneligTitel, findTitler } = require('../app/shared/navn.js');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'app', 'server.js'), 'utf8');
const SOEG = fs.readFileSync(path.join(__dirname, '..', 'app', 'parts', 'p3_soeg.js'), 'utf8');

test('bindestreger, kolon og mellemrum betyder ikke noget', () => {
  const ens = ['Spider-Man 3', 'Spiderman 3', 'SPIDER MAN 3', 'spider man 3', 'Spider  Man  3'];
  const former = new Set(ens.map(sammenligneligTitel));
  assert.strictEqual(former.size, 1,
    `de her skulle give samme noegle, men gav ${[...former].join(', ')}`);
  assert.strictEqual(sammenligneligTitel('Spider-Man 3'), 'spiderman3');
});

test('accenter og saertegn falder væk', () => {
  assert.strictEqual(sammenligneligTitel('WALL·E'), 'walle');
  assert.strictEqual(sammenligneligTitel('Amélie'), 'amelie');
  assert.strictEqual(sammenligneligTitel("Ocean's Eleven"), 'oceanseleven');
});

test('tal overlever', () => {
  assert.strictEqual(sammenligneligTitel('12 Years a Slave'), '12yearsaslave');
});

/*
 * Danske titler skal kunne findes UDEN de danske tegn - det er praecis, hvad
 * man goer paa et fremmed tastatur, eller naar man har travlt.
 *
 * aa klarer NFD selv (a + ring). ae og oe har ingen dekomponering og skal
 * foldes i haanden, ellers bliver "Ørkenens Sønner" til "rkenenssnner".
 */
test('danske tegn kan skrives baade med og uden', () => {
  const par = [
    ['Ørkenens Sønner', 'Orkenens Sonner'],
    ['Blæst', 'Blaest'],
    ['Kastaniegården', 'Kastaniegarden'],
  ];
  for (const [rigtigt, skrevet] of par) {
    assert.strictEqual(sammenligneligTitel(rigtigt), sammenligneligTitel(skrevet),
      `"${rigtigt}" og "${skrevet}" skal give samme noegle, men gav `
      + `"${sammenligneligTitel(rigtigt)}" og "${sammenligneligTitel(skrevet)}"`);
  }
  assert.strictEqual(sammenligneligTitel('Ørkenens Sønner'), 'orkenenssonner');
});

test('tomt og maerkeligt input vaelter ikke', () => {
  for (const v of ['', null, undefined, 42, {}]) {
    assert.doesNotThrow(() => sammenligneligTitel(v));
  }
  assert.strictEqual(sammenligneligTitel(null), '');
});

/*
 * Matchningen proeves ved at KALDE den, ikke ved at lede efter et ord i
 * server.js.
 *
 * Foerste udgave af den her proeve gjorde det sidste - og en sabotage, der
 * satte raa tekstsammenligning tilbage i selve filterlinjen, forblev GROEN,
 * fordi ordet "sammenligneligTitel" stadig stod andre steder i funktionen.
 * En proeve, der leder efter et ord, proever ikke opfoerslen (2026-08-29).
 */
const BIBLIOTEK = [
  { id: 'movie:559', name: 'Spider-Man 3' },
  { id: 'movie:557', name: 'Spider-Man' },
  { id: 'movie:634649', name: 'Spider-Man: No Way Home' },
  /*
   * "Amazing..." sorterer ALFABETISK foerst, men begynder ikke med
   * soegningen. Uden den skelner proeven ikke: "The Amazing Spider-Man"
   * havner sidst af sig selv, og en sabotage, der fjernede rangeringen,
   * forblev groen (2026-08-29).
   */
  { id: 'movie:1930', name: 'Amazing Spider-Man, The' },
  { id: 'movie:1', name: 'WALL\u00b7E' },
  { id: 'movie:2', name: '\u00d8rkenens S\u00f8nner' },
];
const navne = (r) => r.map((x) => x.name);

test('"Spiderman 3" finder "Spider-Man 3"', () => {
  assert.deepStrictEqual(navne(findTitler(BIBLIOTEK, 'Spiderman 3')), ['Spider-Man 3'],
    'praecis den soegning Andreas lavede 2026-08-29');
});

test('den der BEGYNDER med soegningen staar oeverst', () => {
  const r = navne(findTitler(BIBLIOTEK, 'spiderman'));
  assert.strictEqual(r.length, 4, `forventede fire Spider-Man-titler, fik ${r.length}`);

  // Uden rangering ville "Amazing..." staa FOERST - den sorterer jo foer S.
  assert.strictEqual(r[r.length - 1], 'Amazing Spider-Man, The',
    'den der ikke begynder med soegningen skal staa SIDST, ikke alfabetisk foerst');
  assert.deepStrictEqual(r.slice(0, 3),
    ['Spider-Man', 'Spider-Man 3', 'Spider-Man: No Way Home'],
    'de tre foerste skal staa alfabetisk indbyrdes');
});

test('saertegn og danske bogstaver kan skrives udenom', () => {
  assert.deepStrictEqual(navne(findTitler(BIBLIOTEK, 'walle')), ['WALL\u00b7E']);
  assert.deepStrictEqual(navne(findTitler(BIBLIOTEK, 'Orkenens Sonner')),
    ['\u00d8rkenens S\u00f8nner'], 'skrevet uden de danske tegn');
  assert.deepStrictEqual(navne(findTitler(BIBLIOTEK, '\u00d8RKENENS')),
    ['\u00d8rkenens S\u00f8nner'], 'og med, i versaler');
});

test('loftet og det tomme tilfaelde', () => {
  assert.strictEqual(findTitler(BIBLIOTEK, 'spiderman', 2).length, 2);
  assert.deepStrictEqual(findTitler(BIBLIOTEK, ''), []);
  assert.deepStrictEqual(findTitler(BIBLIOTEK, '   '), []);
  assert.deepStrictEqual(findTitler(BIBLIOTEK, 'findes-ikke'), []);
  assert.deepStrictEqual(findTitler(null, 'spiderman'), [], 'ingen emner maa ikke vaelte');
});

test('soegLokalt henter kandidaterne LET og laegger reglen i shared/', () => {
  const start = SRV.indexOf('function soegLokalt(');
  assert.notStrictEqual(start, -1, 'soegLokalt findes ikke laengere');
  const krop = SRV.slice(start, SRV.indexOf('\n}', start));

  assert.match(krop, /findTitler\(/,
    'soegLokalt bruger ikke den faelles regel - saa kan den drive fra proeven');
  assert.ok(!/LIKE/.test(krop), 'der er stadig en LIKE tilbage i soegLokalt');

  /*
   * `titles.data` er en hel TMDB-post. Et SELECT * over hele tabellen ved
   * hvert tastetryk er de megabytes i en liste, Kokkeri laerte at holde
   * ude (§4).
   */
  assert.match(krop, /SELECT id, name FROM titles/,
    'kandidaterne findes ikke laengere med en LET forespoergsel');
});

test('en titel man allerede har, aabner sin egen side', () => {
  assert.match(SOEG, /function aabnTraeffer/,
    'aabnTraeffer findes ikke');
  const start = SOEG.indexOf('function aabnTraeffer');
  const krop = SOEG.slice(start, SOEG.indexOf('\n}', start));

  assert.match(krop, /if \(r\.tracked\)/,
    'der skelnes ikke paa, om titlen allerede er tilfoejet');
  assert.match(krop, /aabnTitel\(r\.id\)/,
    'en tilfoejet titel aabner ikke sin egen side');
  assert.match(krop, /visOverblik\(r\)/,
    'en titel man IKKE har, skal stadig vise overblikket foerst - '
    + 'ellers tilfoejer man "den forkerte Harry Hole" for at se hvad den er');
});
