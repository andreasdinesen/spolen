'use strict';
/*
 * Proever for hvordan brugernavne skrives - og for at visningen IKKE har
 * roert ved, hvordan de slaas op.
 *
 * Andreas, 2026-08-29: "andreas" skal kunne logge ind som "Andreas", og
 * venstre menu skal sige Andreas. Det foerste virkede allerede; det andet
 * gjorde ikke. Faren ved at rette det andet er at komme til at aendre det
 * foerste - saa proeverne her holder BEGGE dele fast.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { visNavn } = require('../app/shared/navn.js');

test('stort begyndelsesbogstav i hvert led', () => {
  assert.strictEqual(visNavn('andreas'), 'Andreas');
  assert.strictEqual(visNavn('bodil'), 'Bodil');
  assert.strictEqual(visNavn('anne-marie'), 'Anne-Marie',
    'sammensatte navne skal have stort i BEGGE led');
  assert.strictEqual(visNavn('jens peter'), 'Jens Peter');
});

test('danske tegn overlever', () => {
  assert.strictEqual(visNavn('æble'), 'Æble');
  assert.strictEqual(visNavn('øystein'), 'Øystein');
  assert.strictEqual(visNavn('aase'), 'Aase');
});

test('tomt og maerkeligt input vaelter ikke', () => {
  assert.strictEqual(visNavn(''), '');
  assert.strictEqual(visNavn(null), '');
  assert.strictEqual(visNavn(undefined), '');
  assert.strictEqual(visNavn(42), '');
  assert.strictEqual(visNavn({}), '');
});

/*
 * DEN VIGTIGE.
 *
 * Visningen maa aldrig sive ind i opslaget. Slog login op paa det VISTE
 * navn, ville "Andreas" og "andreas" holde op med at vaere samme konto -
 * og to konti kunne oprettes, der kun skiller sig ad paa store bogstaver.
 */
test('opslag paa brugernavn sker stadig med lower() overalt', () => {
  const srv = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'server.js'), 'utf8');

  /*
   * Kun WHERE-delen taeller. Foerste udgave af den her proeve matchede ogsaa
   * "FROM users WHERE id != ? ORDER BY username" og blev roed af en
   * sortering, der er fuldstaendig uskadelig - proeven maalte det forkerte.
   */
  const alle = srv.match(/FROM users WHERE [^']*/g) || [];
  const opslag = alle
    .map((h) => h.split(/ ORDER BY | LIMIT /)[0])
    .filter((h) => /username/.test(h));

  assert.ok(opslag.length >= 2,
    `fandt kun ${opslag.length} brugernavns-opslag - er de flyttet?`);
  for (const o of opslag) {
    assert.match(o, /lower\(username\)/,
      `et opslag er blevet foelsomt over for store bogstaver: "${o}"`);
  }

  // Og navnet skal stadig laegges ned i smaa, FOER det gemmes og slaas op.
  const smaa = (srv.match(/str\(body\.username, 64\)\.toLowerCase\(\)/g) || []).length;
  assert.strictEqual(smaa, 2,
    `forventede at BAADE register og login lagde navnet i smaa - fandt ${smaa}`);

  assert.ok(!/visNavn\([^)]*\)\s*(===|==)/.test(srv),
    'et sted sammenlignes der paa det VISTE navn i stedet for det gemte');
});

test('fladen viser navnet med visNavn - ikke raat', () => {
  const app = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'parts', 'p2_app.js'), 'utf8');

  assert.match(app, /visNavn\(state\.user\.username\)/,
    'venstre menu viser stadig det raa navn');

  // Ingen raa username-udskrivning tilbage i fladen.
  const raa = app.match(/text:\s*(state\.user\.username|d\.owner|d\.grantee|p\.username)\b/g);
  assert.strictEqual(raa, null,
    `disse skrives stadig raat ud: ${raa && raa.join(', ')}`);
});

test('shared/navn.js kommer med ud i browseren', () => {
  const byg = fs.readFileSync(
    path.join(__dirname, '..', 'build_rune.py'), 'utf8');
  assert.match(byg, /DELT_I_BUNDT\s*=\s*\[[^\]]*'navn\.js'/,
    'navn.js laegges ikke ind i app.js - saa er visNavn udefineret i fladen');

  // Modulet skal kunne baade require'es og indsaettes raat.
  const kilde = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'shared', 'navn.js'), 'utf8');
  assert.match(kilde, /typeof module !== 'undefined'/,
    'navn.js vil kaste i browseren, hvor module ikke findes');
});
