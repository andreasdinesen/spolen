'use strict';
/*
 * Proever for iCal-foldningen.
 *
 * Funktionerne hentes UD AF KILDEN (samme greb som tast.test.js) - en
 * afskrift ville proeve afskriften.
 *
 * Hvorfor lige de her to: RFC 5545 kraever hoejst 75 OKTETTER pr. linje, og
 * en dansk serietitel er fuld af tegn, der fylder to bytes. Folder man paa
 * TEGN, knaekker linjen midt i et ae/oe/aa, og flere kalendere afviser saa
 * hele begivenheden - uden at sige hvorfor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const kilde = fs.readFileSync(path.join(__dirname, '..', 'app', 'server.js'), 'utf8');
function hentFunktion(navn) {
  // Ingen regex-gymnastik: find funktionens start, og laes frem til den
  // afsluttende kroellede parentes i kolonne 0. Serverens funktioner staar
  // paa topniveau, saa "\n}" er entydigt.
  const start = kilde.indexOf(`function ${navn}(`);
  assert.ok(start >= 0, `${navn} blev ikke fundet i kilden`);
  const slut = kilde.indexOf('\n}', start);
  assert.ok(slut > start, `kunne ikke finde enden paa ${navn}`);
  const kode = kilde.slice(start, slut + 2);
  // eslint-disable-next-line no-new-func
  return new Function(`${kode}; return ${navn};`)();
}

const foldLinje = hentFunktion('foldLinje');
const icalEscape = hentFunktion('icalEscape');

/** Alle linjer skal holde sig under 75 oktetter (fortsaettelser starter med mellemrum). */
function oktetter(ud) {
  return ud.split('\r\n').map((l) => Buffer.byteLength(l, 'utf8'));
}

test('korte linjer roeres ikke', () => {
  assert.equal(foldLinje('SUMMARY:Reacher S1E1'), 'SUMMARY:Reacher S1E1');
});

test('lange rene ASCII-linjer foldes under 75 oktetter', () => {
  const linje = 'SUMMARY:' + 'a'.repeat(300);
  const ud = foldLinje(linje);
  assert.ok(ud.includes('\r\n'), 'skulle vaere foldet');
  for (const n of oktetter(ud)) assert.ok(n <= 75, `linje paa ${n} oktetter`);
  // Foldningen maa ikke tabe eller tilfoeje tegn.
  assert.equal(ud.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join(''), linje);
});

test('DANSKE TEGN: der foldes paa byte-graenser, ikke midt i et tegn', () => {
  // 'ø' er to bytes i UTF-8. Med 200 af dem er der rig lejlighed til at
  // ramme en tegngraense forkert.
  const linje = 'SUMMARY:Prøveserien ' + 'ø'.repeat(200);
  const ud = foldLinje(linje);
  for (const n of oktetter(ud)) assert.ok(n <= 75, `linje paa ${n} oktetter`);
  // Det afgoerende: intet tegn maa vaere gaaet i stykker. Et knaekket tegn
  // bliver til U+FFFD, naar strengen saettes sammen igen.
  const samlet = ud.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join('');
  assert.equal(samlet, linje);
  assert.ok(!samlet.includes('�'), 'et tegn blev knaekket');
});

test('aa, ae og oe overlever ogsaa hver for sig', () => {
  for (const tegn of ['æ', 'ø', 'å', 'é', '—']) {
    const linje = 'SUMMARY:' + tegn.repeat(120);
    const ud = foldLinje(linje);
    const samlet = ud.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join('');
    assert.equal(samlet, linje, tegn);
    for (const n of oktetter(ud)) assert.ok(n <= 75, `${tegn}: linje paa ${n} oktetter`);
  }
});

test('escape: semikolon, komma, backslash og linjeskift', () => {
  /*
   * RFC 5545: ; , og \ skal have en backslash foran, og et linjeskift bliver
   * til de TO tegn \ og n.
   *
   * Forventningerne staar med String.raw, saa backslashen er utvetydig.
   * Skriver man '\;' i en almindelig JS-streng, kollapser det til ';' - og
   * saa proever man ingenting. Denne proeve doemte foerst koden forkert af
   * praecis den grund, to gange.
   */
  assert.equal(icalEscape('a;b'), String.raw`a\;b`);
  assert.equal(icalEscape('a,b'), String.raw`a\,b`);
  assert.equal(icalEscape(String.raw`a\b`), String.raw`a\\b`);
  assert.equal(icalEscape('a\nb'), String.raw`a\nb`);
  assert.equal(icalEscape('a\r\nb'), String.raw`a\nb`);
  // Tom og null maa give en tom streng, ikke "null".
  assert.equal(icalEscape(null), '');
  assert.equal(icalEscape(undefined), '');
});

/* ------------------------------------------- feedets indhold og adgang */

const fs2 = require('node:fs');
const path2 = require('node:path');
const SRV2 = fs2.readFileSync(path2.join(__dirname, '..', 'app', 'server.js'), 'utf8');

/*
 * Afsnit er HELDAGS-begivenheder.
 *
 * Et afsnit sendes paa en dato i sin egen tidszone. Gav vi det et
 * klokkeslaet, ville det flytte sig en dag for nogen - og det er praecis den
 * slags, en kalender goer synligt hver eneste uge.
 */
test('afsnit er heldags, ikke et klokkeslaet', () => {
  const i = SRV2.indexOf('function byggIcal');
  const krop = SRV2.slice(i, SRV2.indexOf('\n}', i));
  assert.match(krop, /DTSTART;VALUE=DATE:/, 'starten er ikke en ren dato');
  assert.match(krop, /DTEND;VALUE=DATE:/, 'slutningen er ikke en ren dato');
  assert.ok(!/DTSTART:\d{8}T/.test(krop), 'der saettes et klokkeslaet paa');
  // DTEND skal vaere dagen EFTER: i iCal er slutdatoen eksklusiv, saa ellers
  // fylder afsnittet nul dage og forsvinder i nogle kalendere.
  assert.match(krop, /naeste\.setUTCDate\(naeste\.getUTCDate\(\) \+ 1\)/,
    'slutdatoen er ikke dagen efter - i iCal er den EKSKLUSIV');
});

test('hver begivenhed har et stabilt UID', () => {
  const i = SRV2.indexOf('function byggIcal');
  const krop = SRV2.slice(i, SRV2.indexOf('\n}', i));
  /* Afsnits-id'et er stabilt paa tvaers af hentninger, saa kalenderen
     opdaterer den samme begivenhed i stedet for at lave en ny hver gang. */
  assert.match(krop, /UID:\$\{e\.id\}@spolen/, 'UID bygges ikke paa afsnits-id');
});

test('summary baerer serie, nummer og afsnitsnavn', () => {
  const i = SRV2.indexOf('function byggIcal');
  const krop = SRV2.slice(i, SRV2.indexOf('\n}', i));
  assert.match(krop, /e\.titleName/, 'serienavnet mangler');
  assert.match(krop, /S\$\{e\.season\}E\$\{e\.number\}/, 'saeson og nummer mangler');
  assert.match(krop, /foldLinje\(/, 'summary foldes ikke - lange titler bryder formatet');
  assert.match(krop, /icalEscape\(/, 'teksten escapes ikke');
});

/*
 * ADRESSEN er legitimationen. En forkert token skal give 404 - ikke 403 -
 * saa man ikke kan afsoege, hvilke feeds der findes.
 *
 * Og en FREMMED session paa adressen giver ogsaa 404: sidder man logget ind
 * som en anden, skal feedet ikke se ud til at findes.
 */
test('et feed svarer 404 til alle andre end sin ejer', () => {
  const i = SRV2.indexOf('const krop = byggIcal(feed.user_id)');
  assert.notStrictEqual(i, -1, 'feed-ruten findes ikke');
  const foer = SRV2.slice(Math.max(0, i - 900), i);
  assert.match(foer, /!feed \|\| \(session && session\.id !== feed\.user_id\)/,
    'en fremmed session paa adressen faar ikke 404');
  assert.match(foer, /writeHead\(404/, 'der svares ikke 404');
  assert.ok(!/writeHead\(403/.test(foer),
    'der svares 403 - saa kan man afsoege, hvilke feeds der findes');
});

test('feedet serveres som en kalender og caches ikke', () => {
  const i = SRV2.indexOf('const krop = byggIcal(feed.user_id)');
  const krop = SRV2.slice(i, i + 400);
  assert.match(krop, /text\/calendar; charset=utf-8/, 'forkert indholdstype');
  assert.match(krop, /'Cache-Control': 'no-store'/,
    'feedet caches - saa ser man gamle afsnit i sin kalender');
  assert.match(krop, /X-Content-Type-Options.*nosniff/, 'nosniff mangler');
});
