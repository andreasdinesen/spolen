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
