'use strict';
/*
 * Proever for historik-siden - "hvad har jeg sidst set, og hvornaar".
 *
 * Modstykket til Up Next (Andreas, 2026-08-31).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rod = (...d) => path.join(__dirname, '..', ...d);
const SRV = fs.readFileSync(rod('app', 'server.js'), 'utf8');
const SOEG = fs.readFileSync(rod('app', 'parts', 'p3_soeg.js'), 'utf8');
const APP = fs.readFileSync(rod('app', 'parts', 'p2_app.js'), 'utf8');

function rute(navn) {
  const i = SRV.indexOf(`'${navn}':`);
  assert.notStrictEqual(i, -1, `${navn} findes ikke`);
  return SRV.slice(i, SRV.indexOf('\n  },', i));
}

/*
 * DEN VIGTIGSTE.
 *
 * Historikken er det MEST personlige i appen. Brugeren skal komme fra
 * sessionen, aldrig fra forespoergslen.
 */
test('historikken er bundet til den, der spoerger', () => {
  const krop = rute('GET /api/history');
  assert.match(krop, /hentWatches\(g\.user\.id,/,
    'brugeren kommer ikke fra sessionen - saa kan man laese andres historik');
  assert.ok(!/ctx\.query\.get\('user|body\.userId/.test(krop),
    'der laeses et bruger-id ud af forespoergslen');
});

/*
 * `titles.data` er en hel TMDB-post og `episodes.data` baerer resuméet. At
 * sende dem pr. visning ville vaere de megabytes i en liste, Kokkeri laerte
 * at holde ude (§4) - 200 visninger ville blive mange megabyte for at vise
 * et navn og et nummer.
 */
test('svaret baerer kun de felter, der skal vises', () => {
  const krop = rute('GET /api/history');
  assert.match(krop, /id: t\.id, kind: t\.kind, name: t\.name, year: t\.year, posterPath/,
    'titlen sendes ikke som en udvalgt raekke felter');
  assert.match(krop, /\{ id: a\.id, season: a\.season, number: a\.number, name: a\.name \}/,
    'afsnittet sendes med alt paa - ogsaa resuméet');
  assert.ok(!/title: t,|episode: a,/.test(krop),
    'hele objektet sendes med i stedet for de valgte felter');
});

/* Ser man ti afsnit af samme serie, skal titlen slaas op ÉN gang. */
test('titler og afsnit slaas op én gang hver', () => {
  const krop = rute('GET /api/history');
  assert.match(krop, /const titler = new Map\(\)/, 'titler caches ikke');
  assert.match(krop, /const afsnit = new Map\(\)/, 'afsnit caches ikke');
  assert.match(krop, /if \(!titler\.has\(w\.titleId\)\)/, 'cachen bruges ikke');
});

test('loftet er begraenset i begge ender', () => {
  const krop = rute('GET /api/history');
  assert.match(krop, /Math\.min\(Math\.max\(Number\(ctx\.query\.get\('limit'\)\) \|\| 200, 1\), 1000\)/,
    'graensen kan saettes frit - saa kan ét kald traekke hele historikken');
});

/* ------------------------------------------------------------- fladen */

test('History staar i menuen lige efter Library', () => {
  const i = APP.indexOf('const SIDER');
  const sider = APP.slice(i, APP.indexOf('];', i));
  assert.match(sider, /\{ id: 'history', navn: 'History' \}/, 'menupunktet mangler');

  /*
   * Foer laa History mellem Library og Calendar. Da kalenderen blev
   * startside og rykkede oeverst (2026-09-02), holdt den formulering op med
   * at passe - men EGENSKABEN er den samme: History hoerer sammen med de to
   * andre "kig i mine ting"-sider, lige efter Library.
   */
  const raek = [...sider.matchAll(/id: '([a-z-]+)'/g)].map((m) => m[1]);
  assert.strictEqual(raek[raek.indexOf('library') + 1], 'history',
    'History staar ikke lige efter Library');
  assert.match(APP, /if \(state\.view === 'history'\) \{ skal\(historikSide\(\)\); return; \}/,
    'siden rutes ikke');
  assert.match(APP, /if \(s\.id === 'history'\) \{ await hentHistorik\(\)/,
    'historikken hentes ikke, naar man aabner siden');
});

/*
 * Dagen skal regnes i den LOKALE tidszone.
 *
 * Ser man et afsnit klokken 23 dansk tid om vinteren, er det stadig samme
 * dag - men UTC-datoen ville sige i morgen. En historik, hvor aftenen
 * flytter sig en dag frem, er svaer at stole paa.
 */
test('dagen udregnes lokalt, ikke i UTC', () => {
  const i = SOEG.indexOf('const dagFor =');
  assert.notStrictEqual(i, -1, 'dagFor findes ikke');
  const krop = SOEG.slice(i, SOEG.indexOf('};', i));
  assert.match(krop, /getFullYear\(\)/, 'aaret laeses ikke lokalt');
  assert.match(krop, /getMonth\(\)/, 'maaneden laeses ikke lokalt');
  assert.match(krop, /getDate\(\)/, 'dagen laeses ikke lokalt');
  assert.ok(!/toISOString/.test(krop),
    'dagen kommer fra toISOString - saa flytter en sen aften sig til dagen efter');
});

test('"Today" og "Yesterday" i stedet for datoer man skal regne paa', () => {
  const i = SOEG.indexOf('function dagOverskrift');
  const krop = SOEG.slice(i, SOEG.indexOf('\n}', i));
  assert.match(krop, /'Today'/, '"Today" mangler');
  assert.match(krop, /'Yesterday'/, '"Yesterday" mangler');
  // Midt paa dagen, ikke midnat: midnat kan tippe til dagen foer i vestlige
  // tidszoner - samme faelde som i importens datotolkning.
  assert.match(krop, /T12:00:00/,
    'datoen laeses ved midnat - den kan tippe en dag i en vestlig tidszone');
});

test('et loft der er naaet, siges hoejt', () => {
  const i = SOEG.indexOf('function historikSide');
  const krop = SOEG.slice(i, SOEG.indexOf('\n}\n', i));
  assert.match(krop, /raekker\.length >= 200/,
    'der siges ikke til, naar listen er skaaret af - saa tror man, det er alt');
});

test('kortene kan klikkes som paa Up Next', () => {
  const i = SOEG.indexOf('function historikKort');
  const krop = SOEG.slice(i, SOEG.indexOf('\n}\n', i));
  assert.match(krop, /aabnTitel\(t\.id\)/, 'plakaten foerer ikke til titlen');
  assert.match(krop, /visAfsnit\(e\.id\)/, 'afsnittet aabner ikke sin beskrivelse');
  // Kilden forklarer overraskelser: en raekke, man ikke selv satte, kom fra
  // Plex eller en import.
  assert.match(krop, /r\.source !== 'manual'/, 'kilden vises ikke');
});
