'use strict';
/*
 * Proever for om et svar er SYNLIGT - ikke bare om det findes.
 *
 * Baggrund (Andreas, 2026-08-29). Han kunne ikke faa sin Trakt-zip ind.
 * Hver enkelt del af kaeden blev maalt og virkede: droppet fyrede, zip'en
 * blev pakket ud, alle 77 filer blev laest, serveren svarede med 8753
 * raekker, og analysekortet stod i DOM'en. Alligevel skete der "ingenting".
 *
 * Kortet blev tegnet i y=1459 i et vindue paa 676 px - 783 px UNDER
 * skaermkanten - fordi det laa efter traktAfsnit() og plexAfsnit(), og
 * siden rullede ikke. Zonen sagde uaendret "Drop your export here".
 *
 * Alle mekanismeproever var groenne, og de var groenne med rette: hver
 * mekanisme virkede. Det, ingen af dem daekkede, var raekkefoelgen paa
 * skaermen. Derfor denne fil - den proever KILDENS orden, som er den ting,
 * der afgoer om brugeren ser svaret.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const KILDE = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'parts', 'p7_import.js'), 'utf8');

/* Klip importSide()-kroppen ud, saa proeven kun ser paa den ene funktion. */
function importSideKrop() {
  const start = KILDE.indexOf('function importSide()');
  assert.notStrictEqual(start, -1, 'importSide() findes ikke laengere');
  const slut = KILDE.indexOf('\nfunction ', start + 10);
  return KILDE.slice(start, slut === -1 ? undefined : slut);
}

test('importens svar tegnes FOER de lange Trakt- og Plex-afsnit', () => {
  const krop = importSideKrop();
  const zone = krop.indexOf('dropZone()');
  const fejl = krop.indexOf('i.fejl');
  const analyse = krop.indexOf('i.analyse');
  const trakt = krop.indexOf('traktAfsnit()');

  for (const [navn, v] of Object.entries({ zone, fejl, analyse, trakt })) {
    assert.notStrictEqual(v, -1, `${navn} blev ikke fundet i importSide()`);
  }

  assert.ok(zone < analyse,
    'analysekortet skal staa under drop-zonen');
  assert.ok(analyse < trakt,
    `analysekortet stod EFTER Trakt-afsnittet (analyse=${analyse}, `
    + `trakt=${trakt}) - saa lander det under skaermkanten, som 2026-08-29`);
  assert.ok(fejl < trakt,
    'fejlbeskeden skal ogsaa staa foer det lange Trakt-afsnit');

  // Plex flyttede ud til sit eget punkt. Kommer det tilbage hertil, vokser
  // afstanden ned til svaret igen med hele afsnittets hoejde.
  assert.strictEqual(krop.indexOf('plexAfsnit()'), -1,
    'plexAfsnit() er tilbage i importSide() - det skubber svaret ned igen');
});

test('Plex har sit eget punkt under Settings', () => {
  const set = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'parts', 'p4_settings.js'), 'utf8');
  assert.ok(/foldAfsnit\('plex',[^)]*plexAfsnit\)/.test(set),
    'Plex er ikke et selvstaendigt punkt i settingsSide()');
});

test('svaret rulles frem ved hver udgang af laesImportFil', () => {
  const start = KILDE.indexOf('async function laesImportFil(');
  assert.notStrictEqual(start, -1, 'laesImportFil findes ikke laengere');
  const slut = KILDE.indexOf('\nasync function startImport', start);
  const krop = KILDE.slice(start, slut === -1 ? undefined : slut);

  // Hver "return" og den afsluttende tegnSide() skal foelges af en rulning.
  const udgange = (krop.match(/tegnSide\(\);/g) || []).length;
  const rulninger = (krop.match(/rulTilImportsvar\(\)/g) || []).length;

  // Den foerste tegnSide() er kvitteringen ("Reading ...") - den skal IKKE
  // rulle, for der er endnu intet svar at rulle hen til.
  assert.strictEqual(rulninger, udgange - 1,
    `${udgange} gentegninger men ${rulninger} rulninger - en udgang tegner `
    + 'et svar, ingen kommer til at se');

  assert.ok(/scrollIntoView/.test(KILDE),
    'rulTilImportsvar bruger ikke scrollIntoView');
  assert.ok(/\.importsvar/.test(KILDE),
    'der findes ingen .importsvar-markering at rulle hen til');
});

test('zonen kvitterer med filnavnet, mens filen laeses', () => {
  assert.ok(/state\.import\.laeser = fil\.name/.test(KILDE),
    'filnavnet saettes ikke, foer filen laeses');
  assert.ok(/Reading \$\{state\.import\.laeser\}/.test(KILDE),
    'zonen viser ikke filnavnet - saa staar der det samme hele vejen');

  // Og den skal ryddes igen, ellers haenger "Reading ..." for evigt.
  const start = KILDE.indexOf('async function laesImportFil(');
  const slut = KILDE.indexOf('\nasync function startImport', start);
  const krop = KILDE.slice(start, slut);
  const returns = (krop.match(/\n\s+return;/g) || []).length;
  const rydninger = (krop.match(/state\.import\.laeser = null;/g) || []).length;
  assert.strictEqual(rydninger, returns + 1,
    `${returns} tidlige returns + 1 afslutning, men laeser ryddes ${rydninger} `
    + 'steder - en sti efterlader "Reading ..." staaende for evigt');
});
