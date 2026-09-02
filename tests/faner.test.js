'use strict';
/*
 * Proever for fanerne under Settings.
 *
 * Indstillingerne var vokset til tolv overskrifter i én stribe, saa man
 * rullede forbi ti ting for at naa den ellevte. Samme inddeling som Sagu v45
 * fik, som igen har den fra verdande (2026-09-02).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rod = (...d) => path.join(__dirname, '..', ...d);
const SET = fs.readFileSync(rod('app', 'parts', 'p4_settings.js'), 'utf8');
const CSS = fs.readFileSync(rod('app', 'public', 'style.css'), 'utf8');

/*
 * DET VALG, DER BAERER DET HELE: alt tegnes, ét vises.
 *
 * Fanerne skjuler med `hidden` - de udelader ikke noget fra dokumentet.
 * Tegner man kun den aabne fane, findes halvdelen af elementerne ikke, og
 * alt, der peger paa dem, skal laves om til noget, der koerer igen ved hvert
 * faneskift. Det er den slags omskrivning, der taber en knap undervejs uden
 * at noget fejler.
 */
test('alle faner tegnes - kun én vises', () => {
  const i = SET.indexOf('function settingsSide');
  const krop = SET.slice(i, SET.indexOf('\n}\n', i));

  assert.match(krop, /hidden: id !== nu/,
    'fanerne skjules ikke med hidden - saa udelades de fra dokumentet');
  assert.ok(!/id === nu \?[\s\S]{0,80}: null/.test(krop),
    'en fane udelades helt, naar den ikke er valgt');

  // Alle fem afsnit skal bygges, uanset hvilken fane der staar aaben.
  for (const navn of ['konto', 'medier', 'import', 'broer']) {
    assert.ok(krop.includes(`fane('${navn}'`), `fanen ${navn} bygges ikke`);
  }
});

/*
 * Valget huskes i localStorage, ikke i state: det afhaenger af, hvad man
 * sidst var i gang med paa DENNE maskine, ikke af kontoen - samme
 * begrundelse som temaet.
 */
test('den aabne fane huskes paa maskinen, ikke paa kontoen', () => {
  assert.match(SET, /localStorage\.getItem\('spolen_fane'\)/, 'fanen laeses ikke');
  assert.match(SET, /localStorage\.setItem\('spolen_fane'/, 'fanen gemmes ikke');
  assert.ok(!/state\.fane\b/.test(SET),
    'fanen ligger i state - saa foelger den kontoen i stedet for maskinen');
});

/*
 * DEN, DER ER LET AT GLEMME.
 *
 * Har man gemt "Server" og logger ind som en, der ikke er administrator,
 * skal den falde tilbage til den foerste fane. Ellers aabner man
 * indstillingerne og ser en TOM side.
 */
test('en gemt fane, man ikke maa se, falder tilbage', () => {
  const i = SET.indexOf('function aktivFane');
  assert.notStrictEqual(i, -1, 'aktivFane findes ikke');
  const krop = SET.slice(i, SET.indexOf('\n}', i));

  assert.match(krop, /!f\.kunAdmin \|\| admin/,
    'der tjekkes ikke, om fanen er synlig for brugeren');
  assert.match(krop, /: 'konto'/, 'der falder ikke tilbage til den foerste fane');
  assert.match(krop, /state\.user && state\.user\.isAdmin/,
    'admin-tilstanden laeses ikke fra brugeren');
});

test('en ukendt gemt vaerdi falder ogsaa tilbage', () => {
  const i = SET.indexOf('function gemtFane');
  const krop = SET.slice(i, SET.indexOf('\n}', i));
  assert.match(krop, /SETTINGS_FANER\.some\(\(f\) => f\.id === g\) \? g : 'konto'/,
    'en gemt vaerdi, der ikke er en fane, bruges alligevel');
  assert.match(krop, /catch \{ return 'konto'; \}/,
    'uden localStorage kaster den i stedet for at vaelge den foerste');
});

test('Server-fanen findes kun for administratorer', () => {
  assert.match(SET, /\{ id: 'server', navn: 'Server', kunAdmin: true \}/,
    'Server er ikke markeret som admin-only');
  const i = SET.indexOf('function settingsSide');
  const krop = SET.slice(i, SET.indexOf('\n}\n', i));
  assert.match(krop, /filter\(\(f\) => !f\.kunAdmin \|\| admin\)/,
    'fanerakken filtrerer ikke admin-faner fra');
  assert.match(krop, /admin \? fane\('server'/, 'selve panelet bygges ogsaa for ikke-admins');
});

/* ------------------------------------------------------------- CSS */

/*
 * Fanerakken ruller VANDRET paa en smal skaerm frem for at ombryde: to
 * linjer faner flytter indholdet ned og ligner to raekker knapper.
 */
test('fanerakken ruller frem for at ombryde', () => {
  const i = CSS.indexOf('.faner {');
  assert.notStrictEqual(i, -1, '.faner findes ikke');
  const blok = CSS.slice(i, CSS.indexOf('}', i));
  assert.match(blok, /overflow-x: auto/, 'raekken ruller ikke');
  assert.match(blok, /scrollbar-width: none/, 'scrollbaren skjules ikke');
  assert.ok(!/flex-wrap: wrap/.test(blok), 'raekken ombryder');
  assert.match(CSS, /\.faner::-webkit-scrollbar \{ display: none; \}/,
    'scrollbaren vises stadig i webkit');
});

/*
 * Understregningen tegnes ALTID - gennemsigtig, naar fanen ikke er valgt.
 * Ellers hopper raekken en pixel, hver gang man skifter fane.
 */
test('understregningen tegnes altid, saa raekken ikke hopper', () => {
  const i = CSS.indexOf('.fane-knap {');
  const blok = CSS.slice(i, CSS.indexOf('}', i));
  assert.match(blok, /border-bottom: 2px solid transparent/,
    'den uvalgte fane har ingen kant - saa hopper raekken ved hvert skift');
  assert.match(blok, /margin-bottom: -1px/,
    'kanten ligger ikke oven i raekkens egen streg');
  assert.match(CSS, /\.fane-knap\.paa \{[^}]*border-bottom-color: var\(--accent-text\)/,
    'den valgte fane faar ingen farvet understregning');
});

test('skiftet ruller til toppen', () => {
  const i = SET.indexOf('function settingsSide');
  const krop = SET.slice(i, SET.indexOf('\n}\n', i));
  /* En fane, man skifter til, skal begynde ved sin foerste overskrift - ikke
     midt i, fordi den forrige var laengere. */
  assert.match(krop, /rulTil\(0, false\)/,
    'der rulles ikke til toppen ved faneskift');
});
