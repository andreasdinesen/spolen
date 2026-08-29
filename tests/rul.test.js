'use strict';
/*
 * Proever for bogstavskinnen - og for HVEM der ruller.
 *
 * Det sidste er den vigtige. Andreas, 2026-08-29: paa 375px har <body> sin
 * egen hoejde og overflow-y: auto, saa det er BODY der ruller. Dokumentet
 * staar stille, og window.scrollY er 0 uanset hvor langt nede man er - maalt:
 * 9712px indhold i en 812px boks, window.scrollY = 0.
 *
 * Alt, der spurgte vinduet, virkede derfor slet ikke paa telefonen: de
 * flydende knapper dukkede aldrig op, "til toppen" flyttede intet, og
 * springet til et bogstav gjorde ingenting. Netop den skaerm, hvor de er mest
 * vaerd.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rod = (...d) => path.join(__dirname, '..', ...d);
const APP = fs.readFileSync(rod('app', 'parts', 'p2_app.js'), 'utf8');
const SOEG = fs.readFileSync(rod('app', 'parts', 'p3_soeg.js'), 'utf8');
const CSS = fs.readFileSync(rod('app', 'public', 'style.css'), 'utf8');

/* Kilden UDEN kommentarer - ellers taeller en forklaring med som kode. */
const udenKommentarer = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const KODE = udenKommentarer(APP) + '\n' + udenKommentarer(SOEG);

test('ingen rulning spoerger vinduet direkte', () => {
  /*
   * rullePosition() SELV maa gerne falde tilbage paa window.scrollY - det er
   * hele dens opgave at samle de to tilfaelde ét sted. Foerste udgave af den
   * her proeve scannede ogsaa dens krop og var derfor roed, selv om koden var
   * rigtig: proeven maalte det forkerte omfang (2026-08-29).
   */
  const start = KODE.indexOf('function rullePosition');
  const udenHjaelperen = start === -1 ? KODE
    : KODE.slice(0, start) + KODE.slice(KODE.indexOf('}', start) + 1);

  const synder = udenHjaelperen.match(/window\.(scrollY|scrollTo)\b/g) || [];
  assert.deepStrictEqual(synder, [],
    `${synder.length} steder UDEN FOR rullePosition() bruger window direkte - `
    + 'de virker ikke paa en telefon, hvor det er <body> der ruller');
});

test('rullebeholderen findes og vaelges paa hoejden', () => {
  const i = APP.indexOf('function rulleBeholder');
  assert.notStrictEqual(i, -1, 'rulleBeholder findes ikke');
  const krop = APP.slice(i, APP.indexOf('\n}', i));
  assert.match(krop, /scrollHeight > d\.clientHeight/,
    'der vaelges ikke ud fra, hvem der FAKTISK kan rulle');
  assert.match(krop, /document\.body/, 'body er ikke med som mulighed');
});

/*
 * Rullehaendelser bobler ikke. Lytter man kun paa window, hoerer man aldrig
 * en rulning i <body>.
 */
test('der lyttes i capture, saa baade vindue og body fanges', () => {
  assert.match(APP, /document\.addEventListener\('scroll', opdater, \{ passive: true, capture: true \}\)/,
    'rullelytteren fanger ikke haendelser fra andre elementer end vinduet');
  assert.ok(!/window\.addEventListener\('scroll'/.test(KODE),
    'der lyttes stadig kun paa vinduet et sted');
});

test('flyderne maaler paa den rigtige position', () => {
  const i = APP.indexOf('const opdater = () =>');
  const krop = APP.slice(i, APP.indexOf('};', i));
  assert.match(krop, /rullePosition\(\) > 600/,
    'graensen maales paa vinduet - saa dukker knapperne aldrig op paa en telefon');
});

/* ------------------------------------------------------- bogstaverne */

test('forbogstav samler tal og lader danske bogstaver staa', () => {
  const i = SOEG.indexOf('function forbogstav');
  assert.notStrictEqual(i, -1, 'forbogstav findes ikke');
  const f = new Function(SOEG.slice(i, SOEG.indexOf('\n}', i) + 2) + '; return forbogstav;')();

  assert.strictEqual(f('Dune'), 'D');
  assert.strictEqual(f('alien'), 'A', 'smaa bogstaver skal loeftes');
  assert.strictEqual(f('12 Years a Slave'), '#', 'tal samles under #');
  assert.strictEqual(f('2067'), '#');
  /*
   * AE, OE og AA er BOGSTAVER paa dansk. Foldes de sammen med A og O, havner
   * "OErkenens SOEnner" under O, hvor ingen leder efter den.
   */
  assert.strictEqual(f('Ørkenens Sønner'), 'Ø');
  assert.strictEqual(f('Blæst'), 'B');
  assert.strictEqual(f(''), '#', 'et tomt navn maa ikke vaelte');
  assert.strictEqual(f(null), '#');
});

test('overskriften spaender hele gitterraekken', () => {
  const i = CSS.indexOf('.bogstavhoved {');
  assert.notStrictEqual(i, -1, '.bogstavhoved findes ikke i CSS');
  const blok = CSS.slice(i, CSS.indexOf('}', i));
  assert.match(blok, /grid-column: 1 \/ -1/,
    'overskriften optager én celle og skubber plakaterne ud af takt');
  assert.match(blok, /scroll-margin-top/,
    'uden scroll-margin-top lander overskriften bag den klaebende toplinje');
});

test('springet trækker toplinjens hoejde fra', () => {
  const i = SOEG.indexOf('function hopTilBogstav');
  const krop = SOEG.slice(i, SOEG.indexOf('\n}', i));
  assert.match(krop, /\.topbar/, 'toplinjen tages ikke med i beregningen');
  assert.match(krop, /rullePosition\(\)/, 'positionen laeses fra vinduet');
  assert.match(krop, /rulTil\(y, true\)/, 'der rulles ikke gennem den faelles hjaelper');
});

test('skinnen vises kun, naar der er mere end ét bogstav', () => {
  assert.match(SOEG, /grupper\.length > 1 \? bogstavSkinne/,
    'en skinne med ét bogstav er ren stoej');
});

test('skinnen daekker ikke titlerne paa en telefon', () => {
  const i = CSS.lastIndexOf('@media (max-width: 900px)');
  const blok = CSS.slice(i);
  assert.match(blok, /\.plakater \{ padding-right/,
    'gitteret har ingen plads sat af til skinnen - den ville ligge oven paa kortene');
});
