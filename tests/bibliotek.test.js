'use strict';
/*
 * Proever for bibliotekets visning og for titelsidens knapper.
 *
 * Fladen kan ikke koeres i node, saa det her er KILDE-proever. De er skrevet
 * til at fange netop de fejl, maalingen i browseren afsloerede undervejs
 * 2026-08-29 - ikke til at bevise at UI'et ser rigtigt ud.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rod = (...d) => path.join(__dirname, '..', ...d);
const APP = fs.readFileSync(rod('app', 'parts', 'p2_app.js'), 'utf8');
const SOEG = fs.readFileSync(rod('app', 'parts', 'p3_soeg.js'), 'utf8');
const TITEL = fs.readFileSync(rod('app', 'parts', 'p5_titel.js'), 'utf8');
const CSS = fs.readFileSync(rod('app', 'public', 'style.css'), 'utf8');

/*
 * DEN FOERSTE, JEG BLEV FANGET AF.
 *
 * Knappen i sidehovedet blev bygget uden onclick. Den saa helt rigtig ud -
 * ikon, tekst, det hele - og gjorde ingenting. Maalt: klasse uaendret,
 * localStorage tom, sidens hoejde uaendret.
 */
test('BEGGE kompaktknapper har en handler', () => {
  const top = APP.slice(APP.indexOf('function kompaktKnap'), APP.indexOf('function kompaktKnap') + 320);
  assert.match(top, /onclick: skiftKompakt/,
    'knappen i sidehovedet gør ingenting - den blev bygget uden onclick');

  const flyder = APP.slice(APP.indexOf("id: 'kompaktFlyder'"), APP.indexOf("id: 'kompaktFlyder'") + 260);
  assert.match(flyder, /onclick: skiftKompakt/, 'den flydende skifter mangler sin handler');
});

/*
 * DEN ANDEN.
 *
 * Droslingen satte `venter = true` og nulstillede flaget INDE i
 * requestAnimationFrame. Fyrer rAF ikke - maalt: den fyrer aldrig i en fane,
 * der ikke tegnes - staar flaget paa true for evigt, og hver senere rulning
 * ignoreres. Bogreolen kalder sin opdatering direkte, og det goer vi ogsaa.
 */
test('rullelytteren kan ikke gaa i baglaas', () => {
  const start = APP.indexOf('function tilslutFlydere');
  /* Udklipningen ledte foer efter `window.addEventListener` - da lytteren
     flyttede til document, gav indexOf -1, og slicen blev TOM. Proeven var
     roed uden at koden fejlede noget (2026-08-29). */
  const lytter = APP.indexOf("addEventListener('scroll', opdater", start);
  assert.notStrictEqual(lytter, -1, 'rullelytteren findes ikke i tilslutFlydere');
  const krop = APP.slice(start, APP.indexOf('\n}', lytter));

  /*
   * Lytteren flyttede til document + capture i v16, fordi <body> ruller paa
   * en telefon og en rullehaendelse derfra aldrig naar window. Egenskaben,
   * proeven passer paa, er den samme: opdateringen skal kaldes DIREKTE.
   */
  assert.match(krop, /addEventListener\('scroll', opdater/,
    'rullelytteren kalder ikke opdateringen direkte');
  assert.ok(!/venter\s*=\s*true/.test(krop),
    'der er en drosling med et flag igen - den kan gaa i baglaas, hvis rAF ikke fyrer');
});

/*
 * DEN TREDJE.
 *
 * Synligheden hang paa en opacitets-overgang. Maalt med et kontrolelement:
 * i den her sammenhaeng gaar en overgang i staa ved STARTvaerdien, saa
 * knappen stod paa opacity 0 - til stede og usynlig.
 */
test('flydeknappernes synlighed afhaenger ikke af en animation', () => {
  const i = CSS.indexOf('.flydeknap {');
  assert.notStrictEqual(i, -1, '.flydeknap findes ikke i CSS');
  const blok = CSS.slice(i, CSS.indexOf('}', i));

  assert.ok(!/opacity:\s*0/.test(blok),
    'flydeknappen starter paa opacity 0 - saa er den usynlig, hvis overgangen ikke koerer');
  assert.ok(!/transition:[^;]*opacity/.test(blok),
    'der er en opacitets-overgang igen - synligheden maa ikke hvile paa den');
});

/*
 * DEN FJERDE - samme fejl som ved importen.
 *
 * En bloed rulning er en animation og kan blive droppet. En knap, der hedder
 * "til toppen" og ikke flytter noget, er vaerre end ingen knap.
 */
test('til-toppen kontrollerer, at der faktisk blev rullet', () => {
  const i = APP.indexOf("id: 'tilToppen'");
  const krop = APP.slice(i, i + 900);
  assert.match(krop, /rulTil\(0, true\)/,
    '"til toppen" ruller ikke gennem den faelles hjaelper');

  /*
   * Reserven bor nu i rulTil(), ikke i knappen. Egenskaben er den samme: en
   * bloed rulning er en animation og kan blive droppet, saa der skal
   * kontrolleres bagefter.
   */
  const j = APP.indexOf('function rulTil');
  assert.notStrictEqual(j, -1, 'rulTil findes ikke');
  const hjaelper = APP.slice(j, APP.indexOf('\n}', j));
  assert.match(hjaelper, /behavior: 'smooth'/, 'den bloede rulning er væk');
  assert.match(hjaelper, /setTimeout\([\s\S]*rullePosition\(\) - y\) > 4[\s\S]*scrollTo\(0, y\)/,
    'der er ingen reserve, hvis den bloede rulning aldrig koerer');
});

test('kompakt er en skaerm-praeference, ikke en kontoindstilling', () => {
  assert.match(APP, /localStorage\.getItem\('spolen_kompakt'\)/, 'kompakt huskes ikke');
  assert.match(APP, /localStorage\.setItem\('spolen_kompakt'/, 'kompakt gemmes ikke');
  // Skift maa ikke tegne siden om: hundredvis af plakater ville blive hentet
  // igen, og rullepositionen ville springe.
  const i = APP.indexOf('function skiftKompakt');
  const krop = APP.slice(i, APP.indexOf('\n}', i));
  assert.ok(!/tegnSide\(\)/.test(krop),
    'skiftKompakt tegner hele siden om - plakaterne hentes forfra og rullet springer');
  assert.match(krop, /classList\.toggle\('kompakt'/, 'klassen skiftes ikke');
});

test('biblioteket kan deles i film og serier', () => {
  const i = SOEG.indexOf('function bibliotekSide');
  const krop = SOEG.slice(i, SOEG.indexOf('\nfunction ', i + 10));

  assert.match(krop, /kind === 'movie'/, 'der taelles ikke film');
  assert.match(krop, /kind === 'tv'/, 'der taelles ikke serier');
  assert.match(krop, /flig\('alle', 'All'\)/, '"All" mangler');

  /*
   * Et filter, der huskes paa tvaers af besoeg, er den slags, hvor man aabner
   * biblioteket, ser halvdelen af sine titler og tror resten er vaek.
   */
  assert.ok(!/localStorage[^\n]*slags/.test(SOEG),
    'filtret gemmes i localStorage - saa aabner man biblioteket filtreret uden at vide det');

  // Tomme flige er stoej.
  assert.match(krop, /if \(antal\.movie\)/, 'en tom "Films"-flig vises alligevel');
  assert.match(krop, /if \(antal\.tv\)/, 'en tom "Series"-flig vises alligevel');
});

test('en film kan markeres set - og hver gang kan fjernes for sig', () => {
  assert.match(TITEL, /titel\.kind === 'movie' \? filmSet/,
    'filmSet vises ikke paa en films side');

  const i = TITEL.indexOf('function filmSet');
  const krop = TITEL.slice(i, TITEL.indexOf('\n}\n', i));

  assert.match(krop, /'Mark as watched'/, 'knappen mangler');
  assert.match(krop, /\/watches['"`]?, \{ method: 'POST'/, 'der gemmes ingen visning');
  assert.match(krop, /method: 'DELETE'/, 'en visning kan ikke fjernes igen');
  assert.match(krop, /watches\/\$\{encodeURIComponent\(w\.id\)\}/,
    'sletningen rammer ikke den ENKELTE visning');

  /*
   * Dubletnoeglen er pr. DAG (ix_watch_dedup), saa et gensyn samme dag bliver
   * ikke til en ny gang. Uden en besked trykker man paa en knap, der tier.
   */
  assert.match(krop, /svar\.dublet/,
    'et gensyn samme dag afvises tavst - brugeren tror knappen er i stykker');
});

test('en plakat i samlingen foerer hen til den titel', () => {
  const i = TITEL.indexOf('function samlingsAfsnit');
  const krop = TITEL.slice(i, TITEL.indexOf('\n}', TITEL.indexOf('c.dele.map', i)));

  assert.match(krop, /onclick: del\.denne \? null : \(\) => aabnTraeffer/,
    'kortet i samlingen kan ikke klikkes');
  assert.match(krop, /tracked: !!del\.iBiblioteket/,
    'klikket ved ikke, om man allerede har titlen');

  /*
   * Knapperne ligger INDE i kortet. Uden stopPropagation ville et tryk paa
   * Add baade tilfoeje OG navigere vaek, saa man aldrig saa at det lykkedes.
   */
  const antalStop = (krop.match(/e\.stopPropagation\(\)/g) || []).length;
  assert.ok(antalStop >= 2,
    `kun ${antalStop} stopPropagation i samlingens kort - knapperne udloeser ogsaa kortets klik`);
});
