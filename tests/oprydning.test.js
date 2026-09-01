'use strict';
/*
 * Proever for oprydningen i biblioteket.
 *
 * Andreas, 2026-09-01: efter Trakt-importen fulgte han "en masse serier",
 * han aldrig havde set et afsnit af. Importen tilfoejer alt, den moeder -
 * ogsaa samlingen og oenskelisten.
 *
 * Det er en HANDLING, der kan fjerne hundredvis af titler paa ét tryk, og
 * der findes ingen fortrydelse. Proeverne her passer paa de vaern.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rod = (...d) => path.join(__dirname, '..', ...d);
const SRV = fs.readFileSync(rod('app', 'server.js'), 'utf8');
const SOEG = fs.readFileSync(rod('app', 'parts', 'p3_soeg.js'), 'utf8');

const rute = (navn) => {
  const i = SRV.indexOf(`'${navn}':`);
  assert.notStrictEqual(i, -1, `${navn} findes ikke`);
  return SRV.slice(i, SRV.indexOf('\n  },', i));
};

/*
 * DEN VIGTIGSTE.
 *
 * Fladen sender listen ud fra det, den hentede. Imellem at listen blev vist
 * og knappen trykket, kan man have markeret noget set - eller en
 * Plex-synkronisering kan. Uden serverens eget tjek ville et foraeldet id
 * fjerne en titel, man lige er begyndt paa.
 */
test('serveren tjekker SELV, at hver titel er uset', () => {
  const krop = rute('POST /api/library/cleanup');
  assert.match(krop, /hentWatches\(g\.user\.id, \{ titleId, graense: 1 \}\)\.length/,
    'der tjekkes ikke for visninger - saa kan en set titel blive fjernet');
  // Og den skal SPRINGES OVER, ikke fjernes.
  const tjek = krop.indexOf('graense: 1 }).length');
  const slet = krop.indexOf('sletItem(');
  assert.ok(tjek !== -1 && slet !== -1 && tjek < slet,
    'sletningen sker foer tjekket');
  assert.match(krop, /sprunget\.push/,
    'en overspringet titel rapporteres ikke - saa passer tallet ikke, og ingen ved hvorfor');
});

test('kun ens EGNE titler roeres', () => {
  const krop = rute('POST /api/library/cleanup');
  assert.match(krop, /hentTracking\(g\.user\.id, titleId\)/,
    'markeringen slaas ikke op paa brugeren - saa kan man fjerne andres');
  assert.match(krop, /sletItem\(g\.user\.id, tr\.id\)/,
    'sletningen er ikke bundet til brugeren');
  assert.ok(!/body\.userId|query\.get\('user/.test(krop),
    'der laeses et bruger-id ud af forespoergslen');
});

test('listen har et loft og skrives i én transaktion', () => {
  const krop = rute('POST /api/library/cleanup');
  assert.match(krop, /slice\(0, 2000\)/,
    'der er intet loft - ét kald kunne bede om vilkaarligt mange');
  assert.match(krop, /db\.exec\('BEGIN'\)/, 'der er ingen transaktion');
  assert.match(krop, /db\.exec\('ROLLBACK'\)/,
    'en fejl midtvejs efterlader biblioteket halvt ryddet');
});

/* ------------------------------------------------------------- fladen */

test('"uset" betyder nul sete afsnit - ogsaa for film', () => {
  const i = SOEG.indexOf('function useteTitler');
  assert.notStrictEqual(i, -1, 'useteTitler findes ikke');
  const krop = SOEG.slice(i, SOEG.indexOf('\n}', i));
  assert.match(krop, /r\.progress && r\.progress\.sete > 0/,
    'serier maales ikke paa sete afsnit');
  assert.match(krop, /!r\.watched/, 'film maales ikke paa, om de er set');
});

/*
 * En knap, der fjerner hundredvis af titler, skal VISE hvad den tager. Det
 * er ikke til at huske, hvad der stod i biblioteket.
 */
test('listen vises FOER handlingen', () => {
  const i = SOEG.indexOf('function visOprydning');
  const krop = SOEG.slice(i, SOEG.indexOf('\n}\n', i));
  assert.match(krop, /liste\.slice\(0, 400\)/, 'listen vises ikke');
  assert.match(krop, /titles will be removed/, 'antallet siges ikke');
  assert.match(krop, /liste\.length > 400/,
    'en afskaaret liste siges ikke - saa tror man, det er alt, der fjernes');
  assert.match(krop, /text: 'Cancel'/, 'der kan ikke fortrydes');
});

/*
 * Importen giver ALLE serier tilstanden `watchlist`, uanset om de kom fra
 * oenskelisten eller samlingen - saa tilstanden kan ikke skelne. Det, der
 * KAN skelnes paa, er hvor markeringen kom fra.
 */
test('det siges, hvad der kom fra importen', () => {
  const i = SOEG.indexOf('function visOprydning');
  const krop = SOEG.slice(i, SOEG.indexOf('\n}\n', i));
  assert.match(krop, /source === 'import'/, 'kilden vises ikke pr. titel');
});

test('film kan holdes udenfor', () => {
  const i = SOEG.indexOf('function visOprydning');
  const krop = SOEG.slice(i, SOEG.indexOf('\n}\n', i));
  assert.match(krop, /let kunSerier = true/,
    '"kun serier" er ikke standarden - Andreas spurgte om SERIER');
  assert.match(krop, /Series only/, 'valget vises ikke');
});

/*
 * DOM'ens append() laver `null` om til TEKSTEN "null" - modsat el(), der
 * springer tomme boern over. Fanget paa et skaermbillede 2026-09-01; ingen
 * strukturel proeve saa det, fordi de kun kiggede paa .item-row og <p>.
 */
test('tomme boern skrives ikke ud som "null"', () => {
  const i = SOEG.indexOf('function visOprydning');
  const krop = SOEG.slice(i, SOEG.indexOf('\n}\n', i));
  assert.match(krop, /kort\.append\(\.\.\.\[/, 'boernene samles ikke i en liste');
  assert.match(krop, /\]\.filter\(Boolean\)\)/,
    'null-boernene filtreres ikke fra - saa staar der bogstaveligt "null" paa skaermen');
});

test('overspringne titler siges hoejt bagefter', () => {
  const i = SOEG.indexOf('async function ryd');
  const krop = SOEG.slice(i, SOEG.indexOf('\n}\n', i));
  assert.match(krop, /svar\.sprunget/,
    'brugeren faar ikke at vide, at noget blev sprunget over');
  assert.match(krop, /Kept \$\{sprunget\}/, 'antallet af overspringne siges ikke');
});

test('knappen vises kun, naar der er noget at rydde', () => {
  const i = SOEG.indexOf('function ryddeKnap');
  const krop = SOEG.slice(i, SOEG.indexOf('\n}', i));
  assert.match(krop, /if \(!kandidater\.length\) return null/,
    'knappen vises ogsaa, naar der intet er - saa er den bare en knap, der siger nul');
});
