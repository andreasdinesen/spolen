'use strict';
/*
 * Versionsnumrene og runen. Koer: node --test tests/version.test.js
 *
 * Indtil v22 var invarianten »N steder, samme tal«: APP_VERSION, index.html,
 * sw.js OG runen skulle alle sige det samme. Fra v23 gaelder den ikke mere,
 * fordi runen er blevet en STARTSNOR: serveren henter selv sin kode ved
 * opstart, saa runens tal skal netop IKKE foelge appens - goer det det, er
 * man tilbage ved to trin i panelet ved hver udgivelse.
 *
 * Invarianten er derfor skiftet ud, ikke slettet:
 *
 *   1. appens egne steder foelges stadig ad (APP_VERSION, index.html, sw.js)
 *   2. runens version <= appens - ellers henter install en tag, der ikke
 *      findes endnu
 *   3. ALLE refs/tags/vN i runen peger paa runens EGEN version
 *   4. laasen findes i panelet, og dens standard er TOM
 *   5. startup henter koden - og overlever, at hentningen ikke kan
 *
 * Punkt 2 og 3 fejler kun hos en, der installerer FORFRA. Det er derfor, de
 * staar her og ikke opdages ved at bruge appen.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROD = path.join(__dirname, '..');
const fil = (...dele) => fs.readFileSync(path.join(ROD, ...dele), 'utf8');

/** Ét tal ud af en fil, med en laesbar fejl hvis moensteret ikke findes. */
function tal(tekst, re, hvor) {
  const m = tekst.match(re);
  assert.ok(m, `kunne ikke finde versionsnummeret i ${hvor}`);
  return Number(m[1]);
}

/**
 * Traekker et af runens scripts UD af YAML'en og pakker det ud til den
 * shell, panelet faktisk koerer.
 *
 * Det er ikke pedanteri: pyyaml skriver lange scripts som ét dobbelt-
 * citeret scalar med `\n` for linjeskift, `\"` for anfoerselstegn og
 * ombrydning midt i linjerne. Et regulaert udtryk over den tekst rammer
 * derfor tilfaeldigt - `node app/kilde.js` findes, men `K="$K"` goer ikke,
 * fordi anfoerselstegnene staar escaped og linjen maaske er brudt paa
 * midten. Foerste udgave af proeven her var groen paa det ene og roed paa
 * det andet, uden at noget var galt med runen.
 */
function scriptet(yamlTekst, sektion, noegle) {
  const fra = yamlTekst.indexOf(`\n  ${sektion}:\n`);
  assert.ok(fra > 0, `kunne ikke finde ${sektion}: i runen`);
  const start = yamlTekst.indexOf(`${noegle}: "`, fra) + noegle.length + 2;
  assert.ok(start > fra, `kunne ikke finde ${noegle}: under ${sektion}:`);
  let i = start + 1;
  for (; i < yamlTekst.length; i += 1) {   // find det AFSLUTTENDE anfoerselstegn
    if (yamlTekst[i] === '\\') { i += 1; continue; }
    if (yamlTekst[i] === '"') break;
  }
  const raa = yamlTekst.slice(start, i + 1)
    // pyyaml bryder en lang linje med `\` til sidst. Skal der staa et
    // MELLEMRUM paa brudstedet, begynder naeste linje med et escaped
    // mellemrum (`\ `) - og det er ikke en gyldig JSON-escape, saa det skal
    // vaek FOER de almindelige brud, ikke efter.
    .replace(/\\\n\s*\\ /g, ' ')
    .replace(/\\\n\s*/g, '')
    .replace(/\n\s*/g, ' ')
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return JSON.parse(raa);        // resten er JSON-escapes
}

const appVersion = () => tal(fil('app', 'parts', 'p1_core.js'),
  /^const APP_VERSION = (\d+);/m, 'p1_core.js');

/* ------------------------------------------------------------ 1. appen */

test('APP_VERSION, index.html og sw.js er det SAMME tal', () => {
  const kilde = appVersion();
  const html = fil('app', 'public', 'index.html');

  // app.js?v= er den, kilde.js laeser, naar den skal afgoere, om et hentet
  // arkiv er den udgave, taggen lover.
  assert.strictEqual(tal(html, /app\.js\?v=(\d+)/, 'index.html (app.js)'), kilde,
    'cache-bust i index.html skal foelge APP_VERSION (RUNE-ERFARINGER §5)');
  // style.css?v= er den, SERVEREN laeser og melder i /api/public-config.
  // De to stempler saettes af det samme regulaere udtryk i build_rune.py,
  // men de laeses af hver sin kode - og saa er det ikke gratis at antage,
  // at de er ens.
  assert.strictEqual(tal(html, /style\.css\?v=(\d+)/, 'index.html (style.css)'), kilde,
    'serveren laeser sin version ud af style.css?v= - den skal foelge med');
  assert.strictEqual(tal(fil('app', 'public', 'sw.js'), /^const VERSION = (\d+);/m, 'sw.js'), kilde,
    'service workerens cache-navn skal bumpes, ellers serveres gammel kode');
});

/* ------------------------------------------------------------ 2. + 3. runen */

test('runen er en startsnor - og peger paa en tag, der er udgivet', () => {
  const app = appVersion();
  const yamlTekst = fil('runes', 'spolen.yaml');
  const rune = tal(yamlTekst, /\n {2}version: ["']?(\d+)/, 'runes/spolen.yaml');

  assert.ok(rune <= app,
    `runens version (${rune}) er nyere end app-koden (${app}) - `
    + 'install ville hente en tag, der ikke findes');

  const tags = [...yamlTekst.matchAll(/refs\/tags\/v(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(tags.length > 0, 'runen henter ikke koden fra en tag');
  for (const t of tags) {
    assert.strictEqual(t, rune, 'tag-adressen i runen skal foelge runens egen version');
  }
});

/* ---------------------------------------------------------------- 4. laasen */

test('KODE_VERSION staar i panelet, og standarden er TOM', () => {
  const yamlTekst = fil('runes', 'spolen.yaml');
  assert.match(yamlTekst, /key: KODE_VERSION/, 'panelet skal kunne saette laasen');
  // Tom = nyeste. Et felt, man SKAL udfylde for at faa den almindelige
  // opfoersel, laeser man som en indstilling, nogen har taget.
  assert.match(yamlTekst, /key: KODE_VERSION\n(?: .*\n)*? {4}default: ''\n/,
    'standarden skal vaere TOM - saa foelger spolen nyeste udgivelse af sig selv');
  // Uden spoergsmaalstegnet kan den tomme standard ikke gemmes i panelet.
  assert.match(yamlTekst, /pattern: \^\(\[0-9\]\+\|seneste\|latest\)\?\$/,
    'moensteret skal tillade tomt');
});

/* --------------------------------------------------------------- 5. opstart */

test('startup henter koden - og overlever, at den ikke kan', () => {
  const kommando = scriptet(fil('runes', 'spolen.yaml'), 'startup', 'command');

  assert.match(kommando, /\n\s*node app\/kilde\.js/,
    'uden hentningen opdaterer en genstart ingenting');
  // Fejler hentningen - eller findes kilde.js slet ikke, fordi KODE_VERSION
  // laaser til en gammel udgave - SKAL serveren stadig starte.
  assert.match(kommando, /node app\/kilde\.js \|\| echo/,
    'hentningen maa ikke kunne forhindre serveren i at starte');
  // Og findes modulet slet ikke - fordi laasen peger tilbage paa en udgave
  // fra foer det fandtes - maa der ikke staa et Node-stakspor i panelets
  // log ved hver eneste genstart (tovo, 2026-09-03). Et stakspor, der ikke
  // er en fejl, bliver liggende for evigt.
  assert.match(kommando, /if \[ -f app\/kilde\.js \]; then/,
    'startup skal tjekke, at kilde.js findes, foer den koerer den');
  assert.match(kommando, /else\n\s*echo "\[kode\][^"]*"/,
    'og sige, hvad vejen videre er, i stedet for at kaste et stakspor');
  assert.match(kommando, /exec node app\/server\.js/,
    'serveren skal stadig startes til sidst');
  // Raekkefoelgen er hele pointen: hentes koden EFTER serveren er startet,
  // koerer den gamle kode indtil naeste genstart.
  assert.ok(kommando.indexOf('node app/kilde.js') < kommando.indexOf('exec node'),
    'hentningen skal ske FOER serveren startes');
});

test('startup saetter app/ tilbage efter en afbrudt udskiftning', () => {
  // Den eneste rigtigt farlige brik i hele mekanismen: kilde.js bytter app/
  // ud med to omdoebninger, og doer containeren imellem dem, ligger den
  // gamle app under .spolen-gammel. Uden det her trin ville et daarligt
  // sekund efterlade en container UDEN app/ - og uden app/ er der heller
  // ingen kilde.js til at hente en ny.
  const kommando = scriptet(fil('runes', 'spolen.yaml'), 'startup', 'command');
  assert.match(kommando, /\[ ! -f app\/server\.js \] && \[ -f \.spolen-gammel\/server\.js \]/,
    'redningen skal staa i startup');
  assert.match(kommando, /mv \.spolen-gammel app/, 'og den skal faktisk flytte mappen tilbage');
  assert.ok(kommando.indexOf('mv .spolen-gammel app') < kommando.indexOf('node app/kilde.js'),
    'redningen skal koere FOER hentningen - ellers er der ingen kilde.js at koere');
});

test('update-knappen bruger kilde.js, naar den findes', () => {
  // Ellers henter knappen startsnorens tag oven i en nyere app - en
  // nedgradering, ingen bad om.
  const script = scriptet(fil('runes', 'spolen.yaml'), 'update', 'script');
  assert.match(script, /if \[ -f app\/kilde\.js \]; then/,
    'update skal foretraekke kilde.js frem for startsnorens tag');
  assert.match(script, /KODE_VERSION="\$K" node app\/kilde\.js/,
    'og den skal give laasen videre');
  // Fallback'et: panelet templaterer maaske variablen ind i TEKSTEN, maaske
  // sender det den kun som env. Hvad det goer, er ikke bevist (doda,
  // 2026-09-03), saa laasningen maa ikke afhaenge af svaret.
  assert.match(script, /K="\{\{KODE_VERSION\}\}"/, 'skabelonen skal proeves foerst');
  assert.match(script, /K="\$\{KODE_VERSION:-\}"/, 'og env skal vaere reserven');
  // Startsnoren skal stadig ligge i else-grenen: en container, hvor app/ er
  // vaek, har heller ingen kilde.js.
  assert.match(script, /codeload\.github\.com/, 'startsnoren skal blive i else-grenen');
});

/* ------------------------------------------------------- build'ets vagt */

test('build\'et vogter, at startsnoren kan hente sig selv', () => {
  // Peger startsnoren paa en tag fra FOER kilde.js fandtes, lander en frisk
  // installation paa kode, der ikke kan hente sig selv - og saa opdaterer
  // en genstart ingenting, hvilket er praecis den ting, mekanismen skulle
  // fjerne. Det tal kan ikke tjekkes herfra, fordi det med vilje ER for
  // lavt indtil udgivelsen; det, der KAN tjekkes, er at vagten stadig er
  // koblet paa - en fil, der bliver ved med at bygge, naar man river den
  // ud, er en fil, der ikke vogter noget.
  const byg = fil('build_rune.py');
  assert.match(byg, /def tjek_startsnor\(/, 'vagten skal findes');
  assert.match(byg, /\n {4}tjek_startsnor\(RUNE_VERSION, version\)/,
    'vagten skal KALDES fra main() - ikke bare staa der');
  assert.match(byg, /FOERSTE_MED_KILDE/,
    'vagten skal sammenligne med kilde.js\' eget tal');
  // Tallet bor ÉT sted. To kopier ville drive fra hinanden, og forskellen
  // ville foerst vise sig hos en, der installerer forfra.
  const kilde = fil('app', 'kilde.js');
  assert.match(kilde, /^const FOERSTE_MED_KILDE = \d+;/m);
  assert.strictEqual((byg.match(/FOERSTE_MED_KILDE = \d+/g) || []).length, 0,
    'build_rune.py maa ikke have sin EGEN kopi af tallet - den skal laese kilde.js');
});
