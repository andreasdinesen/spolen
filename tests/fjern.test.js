'use strict';
/*
 * Proever for at fjerne en titel fra biblioteket igen.
 *
 * Andreas, 2026-08-29: det skal kunne lade sig goere, baade naar titlen bare
 * er tilfoejet, og naar den er markeret set. Det sidste er det svaere:
 * historikken er ikke det samme som biblioteket, og at rydde op i sit
 * bibliotek maa ikke stille og roligt slette aar af historik.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rod = (...d) => path.join(__dirname, '..', ...d);
const SRV = fs.readFileSync(rod('app', 'server.js'), 'utf8');
const TITEL = fs.readFileSync(rod('app', 'parts', 'p5_titel.js'), 'utf8');

/*
 * DEN VIGTIGSTE.
 *
 * At fjerne en titel fra SIT eget bibliotek maa aldrig kunne roere en andens
 * historik. Filteret hoerer i selve forespoergslen - ikke i kaldsstedet.
 */
test('sletningen af en titels historik er bundet til brugeren', () => {
  const i = SRV.indexOf('function sletTitelsWatches');
  assert.notStrictEqual(i, -1, 'sletTitelsWatches findes ikke');
  const krop = SRV.slice(i, SRV.indexOf('\n}', i));

  assert.match(krop, /DELETE FROM watches WHERE user_id = \? AND title_id = \?/,
    'sletningen filtrerer ikke paa user_id - den ville ramme hele husstanden');
  assert.match(krop, /\.run\(userId,/, 'userId gives ikke med som foerste argument');
});

test('endepunktet tager brugeren fra sessionen, ikke fra stien', () => {
  const i = SRV.indexOf("re: /^\\/api\\/watches\\/title\\/");
  assert.notStrictEqual(i, -1, 'endepunktet findes ikke');
  const krop = SRV.slice(i, SRV.indexOf('\n  },', i));

  assert.match(krop, /godkend\(req, res, 'write'\)/, 'endepunktet kraever ikke skriveret');
  assert.match(krop, /sletTitelsWatches\(g\.user\.id,/,
    'brugeren kommer ikke fra sessionen - saa kan man slette for andre');
  assert.ok(!/ctx\.params\[1\]/.test(krop),
    'der laeses et bruger-id ud af stien - det maa aldrig bestemme, hvis data der rammes');
});

/*
 * Raekkefoelgen af ruterne. /api/watches/:id tillader ikke skraastreg og kan
 * derfor ikke snuppe /api/watches/title/..., men bliver charsettet nogensinde
 * loesnet, aendrer det sig i stilhed.
 */
test('titel-ruten staar foer den generiske watches-rute', () => {
  const titelRute = SRV.indexOf("\\/api\\/watches\\/title\\/");
  const generisk = SRV.indexOf("re: /^\\/api\\/watches\\/([A-Za-z0-9_-]{1,64})$/");
  assert.ok(titelRute !== -1 && generisk !== -1, 'en af ruterne findes ikke');
  assert.ok(titelRute < generisk,
    'den generiske rute staar foerst - byttes charsettet, snupper den titel-stien');
});

test('knappen vises kun paa noget, man faktisk har', () => {
  assert.match(TITEL, /t\.data\.tracking \? fjernFraBiblioteket/,
    'fjern-knappen vises ogsaa paa titler, man ikke har i biblioteket');
});

/*
 * TRE svar, ikke to. "Fjern" og "fjern ALT" er ikke det samme spoergsmaal,
 * og det maa ikke afhaenge af et flueben, man kan overse.
 */
test('med historik gives tre valg - uden gives to', () => {
  const i = TITEL.indexOf('function fjernFraBiblioteket');
  const krop = TITEL.slice(i, TITEL.indexOf('\n}\n', i));

  assert.match(krop, /id: 'behold'/, 'valget "fjern, behold historik" mangler');
  assert.match(krop, /id: 'alt'/, 'valget "fjern alt" mangler');
  assert.match(krop, /id: 'fortryd'/, 'der kan ikke fortrydes');

  // Standarden skal vaere den, der IKKE sletter historik.
  assert.match(krop, /id: 'behold', text: 'Remove, keep history', primary: true/,
    'den fremhaevede knap er ikke den, der beholder historikken');

  // Og antallet skal staa i teksten - ellers ved man ikke, hvad man mister.
  assert.match(krop, /\$\{antal\}/, 'brugeren faar ikke at vide, hvor meget historik der er');
});

test('historikken slettes FOER titlen fjernes', () => {
  const i = TITEL.indexOf('function fjernFraBiblioteket');
  const krop = TITEL.slice(i, TITEL.indexOf('\n}\n', i));
  const watches = krop.indexOf('/watches/title/');
  const items = krop.indexOf('/items/');
  assert.ok(watches !== -1 && items !== -1, 'et af kaldene mangler');
  assert.ok(watches < items,
    'titlen fjernes foerst - gaar historik-sletningen saa galt, er der ingen side '
    + 'tilbage at rydde den fra');
});

test('fortryd gør ingenting', () => {
  const i = TITEL.indexOf('function fjernFraBiblioteket');
  const krop = TITEL.slice(i, TITEL.indexOf('\n}\n', i));
  assert.match(krop, /if \(valg === 'fortryd'\) return;/,
    'der returneres ikke ved fortryd - saa fjernes titlen alligevel');
  // Og returneringen skal ske FOER noget som helst kaldes.
  const retur = krop.indexOf("valg === 'fortryd'");
  assert.ok(retur < krop.indexOf("method: 'DELETE'"),
    'fortryd-tjekket ligger efter det foerste DELETE-kald');
});
