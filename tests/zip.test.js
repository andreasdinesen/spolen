'use strict';
/*
 * Proever for zip-laeseren.
 *
 * Funktionerne hentes UD AF KILDEN (samme greb som tast.test.js) og koeres
 * mod RIGTIGE zip-arkiver, lavet med systemets eget `zip`. En efterlignet
 * zip ville kun proeve, at min laeser er enig med min egen efterligning.
 *
 * Node 22 har DecompressionStream, saa 'deflate-raw' virker her som i
 * browseren.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const os = require('node:os');

const kilde = fs.readFileSync(path.join(__dirname, '..', 'app', 'parts', 'p7_import.js'), 'utf8');
function hent(navn) {
  const start = kilde.indexOf(`function ${navn}(`);
  assert.ok(start >= 0, `${navn} findes ikke i kilden`);
  const slut = kilde.indexOf('\n}', start);
  return kilde.slice(start, slut + 2);
}
const konstanter = kilde.slice(kilde.indexOf('const ZIP_EOCD'), kilde.indexOf('function zipPoster'));
// eslint-disable-next-line no-new-func
const modul = new Function(`
  ${konstanter}
  ${hent('zipPoster')}
  ${hent('zipUdpak')}
  return { zipPoster, zipUdpak };
`)();

/** Laver et RIGTIGT zip-arkiv med systemets zip. */
function lavZip(filer, flag) {
  const mappe = fs.mkdtempSync(path.join(os.tmpdir(), 'spolenzip-'));
  for (const [navn, indhold] of Object.entries(filer)) {
    const sti = path.join(mappe, navn);
    fs.mkdirSync(path.dirname(sti), { recursive: true });
    fs.writeFileSync(sti, indhold);
  }
  const zipSti = path.join(mappe, 'ud.zip');
  execFileSync('zip', ['-q', ...(flag || []), '-r', zipSti, ...Object.keys(filer)], { cwd: mappe });
  const buf = fs.readFileSync(zipSti);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

test('finder posterne i et rigtigt zip-arkiv', () => {
  const buf = lavZip({ 'a.csv': 'Title,Date\nX,2026-01-01\n', 'b.txt': 'hej' });
  const navne = modul.zipPoster(buf).map((p) => p.navn).sort();
  assert.deepEqual(navne, ['a.csv', 'b.txt']);
});

test('pakker en KOMPRIMERET post ud (deflate)', async () => {
  // Lang, gentagen tekst tvinger zip til faktisk at komprimere.
  const linjer = ['Title,Date'];
  for (let i = 0; i < 400; i++) linjer.push(`"Some Show: Season 1: Episode ${i}",2026-01-01`);
  const indhold = linjer.join('\n') + '\n';
  const buf = lavZip({ 'history.csv': indhold });
  const post = modul.zipPoster(buf).find((p) => p.navn === 'history.csv');
  assert.equal(post.metode, 8, 'skulle vaere deflate');
  assert.equal(await modul.zipUdpak(buf, post), indhold);
});

test('pakker en GEMT post ud (uden komprimering)', async () => {
  // -0 = gem uden at komprimere. Begge metoder findes i rigtige arkiver.
  const indhold = 'Title,Date\nA Film,2026-02-02\n';
  const buf = lavZip({ 'x.csv': indhold }, ['-0']);
  const post = modul.zipPoster(buf).find((p) => p.navn === 'x.csv');
  assert.equal(post.metode, 0, 'skulle vaere gemt');
  assert.equal(await modul.zipUdpak(buf, post), indhold);
});

test('DANSKE TEGN overlever - i BAADE filnavn og indhold', async () => {
  /*
   * Filnavnet skal ogsaa vaere dansk.
   *
   * Foerste udgave af denne proeve havde æøå i indholdet, men et rent
   * ASCII-filnavn - og saa maalte den kun indholdets afkodning. Sabotagen
   * (laes filnavne som latin-1) forblev GROEN, og det er den slags falske
   * bestaaelse, der er vaerre end ingen proeve.
   */
  const indhold = 'Title,Date\n"Prøveserien: Sæson 1: Første afsnit",2026-03-03\n';
  const buf = lavZip({ 'histørik-æøå.csv': indhold });
  const poster = modul.zipPoster(buf);
  const post = poster.find((p) => p.navn === 'histørik-æøå.csv');
  assert.ok(post, `filnavnet blev laest forkert: ${poster.map((x) => x.navn).join(', ')}`);
  assert.equal(await modul.zipUdpak(buf, post), indhold);
});

test('mapper i arkivet forvirrer ikke laeseren', async () => {
  const buf = lavZip({ 'mappe/dyb/fil.csv': 'Title,Date\nY,2026-01-01\n' });
  const post = modul.zipPoster(buf).find((p) => p.navn.endsWith('fil.csv'));
  assert.ok(post, 'filen i undermappen skal findes');
  assert.match(await modul.zipUdpak(buf, post), /^Title,Date/);
});

test('en fil, der ikke er en zip, afvises med en laesbar besked', () => {
  const buf = new TextEncoder().encode('det her er slet ikke en zip').buffer;
  assert.throws(() => modul.zipPoster(buf), /does not look like a zip/);
});

test('datastarten laeses fra det LOKALE hoved, ikke fra den centrale mappe', async () => {
  /*
   * Den centrale mappes ekstra-felt har en ANDEN laengde end det lokale
   * hoveds. Bruger man mappens tal, lander man et par bytes forkert, og
   * dekomprimeringen fejler med noget, der ikke ligner aarsagen.
   * Et arkiv med mange filer gør forskellen sandsynlig.
   */
  const filer = {};
  for (let i = 0; i < 12; i++) {
    filer[`f${i}.csv`] = 'Title,Date\n' + `"Show ${i}",2026-01-0${(i % 9) + 1}\n`.repeat(60);
  }
  const buf = lavZip(filer);
  for (const post of modul.zipPoster(buf)) {
    const t = await modul.zipUdpak(buf, post);
    assert.match(t, /^Title,Date/, `${post.navn} blev pakket forkert ud`);
  }
});
