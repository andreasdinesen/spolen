'use strict';
/*
 * »Opdater spolen«-knappen. Koer: node --test tests/opdatering.test.js
 *
 * Proeverne koerer PANELETS EGET script - hevet ud af runes/spolen.yaml, ikke
 * skrevet af igen - mod en lokal arkivserver. Kun to ting byttes ud, og der
 * staar en assertion foran hver: adressen og `require("https")`.
 *
 * Hvorfor det er den vigtigste prove i huset:
 *
 * Sagu laa nede i ti timer 2026-09-04. Ikke paa grund af kilde.js, som er
 * fejlfri, men paa grund af else-grenen her - den vej, der KUN bruges, naar
 * kilde.js endnu ikke findes, og altsaa praecis den ene opgradering, hele
 * mekanikken handler om. Tre fejl, som vi alle sammen havde skrevet ned som
 * de baerende valg og bygget hovedvejen udenom - og ladet staa i
 * redningsvejen:
 *
 *   1. fast temp-sti i /tmp, delt mellem to samtidige koersler
 *   2. `rm -rf app` FOER `mv` - et vindue helt uden app/, og dermed uden
 *      kilde.js til at redde sig selv
 *   3. `mv` fra /tmp er en KOPI over to filsystemer, som kan afbrydes
 *
 * Og en fjerde, som panelet leverer gratis: **knappen kan trykkes igen,
 * mens den koerer** (Andreas trykkede to gange paa otte sekunder), og
 * `app-update` svarer 202 UDEN at genstarte serveren.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync, spawn } = require('node:child_process');

const { scriptet } = require('./yamlskript.js');

const ROD = path.join(__dirname, '..');
const YAML = fs.readFileSync(path.join(ROD, 'runes', 'spolen.yaml'), 'utf8');
const UPDATE = scriptet(YAML, 'update', 'script');
const STARTUP = scriptet(YAML, 'startup', 'command');
const INSTALL = scriptet(YAML, 'install', 'script');

/* --------------------------------------------------------------- fixtur */

/** Et arkiv formet som GitHubs: praefiks-mappe udenom, app/ indeni. */
function byggArkiv(filer) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spolen-ark-'));
  for (const [navn, indhold] of Object.entries(filer)) {
    const sti = path.join(d, 'spolen-99', navn);
    fs.mkdirSync(path.dirname(sti), { recursive: true });
    fs.writeFileSync(sti, indhold);
  }
  const tgz = path.join(d, 'arkiv.tar.gz');
  const r = spawnSync('tar', ['czf', tgz, '-C', d, 'spolen-99'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `tar fejlede: ${r.stderr}`);
  const buf = fs.readFileSync(tgz);
  fs.rmSync(d, { recursive: true, force: true });
  return buf;
}

const NY_APP = byggArkiv({
  'app/server.js': '// ny server\n',
  'app/kilde.js': '// ny kilde\n',
  'app/public/index.html': '<script src="/app.js?v=99"></script>\n',
  'app/public/app.js': '// ny app\n',
});

/** En arkivserver. `forsink` er det, der goer kapløbsproeven aegte. */
function serveArkiv({ krop = NY_APP, status = 200, forsink = 0 } = {}) {
  let kald = 0;
  const s = http.createServer((req, res) => {
    kald += 1;
    setTimeout(() => {
      if (status !== 200) { res.writeHead(status); res.end('nej'); return; }
      res.writeHead(200, { 'content-type': 'application/gzip' });
      res.end(krop);
    }, forsink);
  });
  s.listen(0, '127.0.0.1');
  return new Promise((ok) => s.on('listening', () => ok({
    url: `http://127.0.0.1:${s.address().port}/arkiv.tar.gz`,
    kald: () => kald,
    // `close()` alene venter paa aabne forbindelser. Doer en hentning midt i
    // en overfoersel - hvilket er praecis det, fejlstierne herunder proever -
    // bliver socketen haengende, og luk() svarer aldrig. Proeven fejler saa
    // ikke: den HAENGER, indtil hele filen timer ud, og fejlen ser ud til at
    // ligge i det sidste, der naaede at koere. Kostede en fejlsoegning
    // 2026-09-05.
    luk: () => new Promise((f) => { s.closeAllConnections(); s.close(f); }),
  })));
}

/**
 * Byt kun det ALLERMINDSTE ud, og saet en assertion foran hver udskiftning.
 * Ellers proever man sin egen afskrift i stedet for panelets script.
 */
function tilLokal(script, url, kode = '') {
  assert.ok(script.includes('require("https")'),
    'scriptet henter ikke over https - er hent_krop lavet om?');
  let s = script.split('require("https")').join('require("http")');

  const rigtig = s.match(/https:\/\/codeload\.github\.com\/[^"]+/);
  assert.ok(rigtig, 'scriptet henter ikke fra codeload - er adressen lavet om?');
  s = s.split(rigtig[0]).join(url);

  // Om panelet templaterer variablen ind i TEKSTEN eller kun sender den
  // som env, er ikke bevist (doda, 2026-09-03). Begge dele proeves, saa en
  // laasning ikke kan tabes paa en antagelse: `kode: null` lader skabelonen
  // staa utemplateret, praecis som hvis panelet ikke roerte den.
  return kode === null ? s : s.split('{{KODE_VERSION}}').join(kode);
}

/** En arbejdsmappe, som runen ser den. */
function arbejdsmappe({ app = null } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spolen-opd-'));
  if (app) {
    for (const [navn, indhold] of Object.entries(app)) {
      const sti = path.join(d, 'app', navn);
      fs.mkdirSync(path.dirname(sti), { recursive: true });
      fs.writeFileSync(sti, indhold);
    }
  }
  return d;
}

const GAMMEL_APP = { 'server.js': '// gammel server\n', 'gammelfil.js': '// skal vaek\n' };

/**
 * Koer scriptet - ALTID asynkront.
 *
 * `spawnSync` blokerer event-loopet, og arkivserveren koerer i den HER
 * proces: en synkron koersel ville vente paa et svar, som foerst kan sendes,
 * naar den er faerdig. Proeven haenger til timeout og ligner en fejl i
 * scriptet. (RUNE-ERFARINGER, Sagu 2026-08-21 - og igen her, 2026-09-05.)
 */
function koer(script, cwd, env = {}) {
  return new Promise((ok) => {
    const p = spawn('/bin/sh', ['-c', script], {
      cwd, env: Object.assign({}, process.env, env),
    });
    let ud = '';
    p.stdout.on('data', (b) => { ud += b; });
    p.stderr.on('data', (b) => { ud += b; });
    p.on('close', (status) => ok({ status, stdout: ud, stderr: ud }));
  });
}

/* ------------------------------------------------- 1. de tre gamle faelder */

test('scriptet roerer ikke /tmp', async () => {
  // En fast temp-sti deles af to samtidige koersler: den ene rydder, mens
  // den anden pakker ud. Og `mv` derfra er en kopi over to filsystemer, som
  // kan afbrydes paa midten. To `rename` i samme filsystem kan ikke.
  for (const [navn, s] of [['update', UPDATE], ['install', INSTALL]]) {
    assert.ok(!/\/tmp\//.test(s), `${navn} bruger stadig /tmp`);
    assert.match(s, /\.spolen-ny/, `${navn} pakker ikke ud ved siden af app/`);
  }
});

test('den gamle app FLYTTES - den slettes ikke foerst', async () => {
  // `rm -rf app` foer `mv` aabner et vindue helt uden app/ - og dermed uden
  // kilde.js til at redde sig selv. Startup-redningen hjaelper ikke: den
  // leder efter .spolen-gammel, og ad den vej findes den ikke.
  const gren = UPDATE.slice(UPDATE.indexOf('else'));
  assert.match(gren, /if \[ -d app \]; then mv app \.spolen-gammel; fi/,
    'den gamle app skal flyttes til side, ikke slettes');
  const flyt = gren.indexOf('mv app .spolen-gammel');
  const paaPlads = gren.indexOf('mv "$NY" app');
  assert.ok(flyt > 0 && paaPlads > 0, 'begge omdoebninger skal findes');
  assert.ok(flyt < paaPlads, 'den gamle skal vaek, foer den nye kommer ind');
});

test('en fil, der er fjernet i den nye udgave, bliver ikke liggende', async () => {
  // Det var det, `rm -rf app` var der for (Beanledger v30). Egenskaben skal
  // vaere bevaret af flytningen - ikke tabt sammen med sletningen.
  const s = await serveArkiv();
  const d = arbejdsmappe({ app: GAMMEL_APP });
  try {
    const r = await koer(tilLokal(UPDATE, s.url), d);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(d, 'app', 'server.js')), 'app/ skal vaere paa plads');
    assert.strictEqual(fs.readFileSync(path.join(d, 'app', 'server.js'), 'utf8'), '// ny server\n');
    assert.ok(!fs.existsSync(path.join(d, 'app', 'gammelfil.js')),
      'en fil fra den gamle udgave laa tilbage - den nye app blev pakket OVENPAA');
  } finally { await s.luk(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('intet efterlades: hverken .spolen-ny, .spolen-gammel eller laasen', async () => {
  const s = await serveArkiv();
  const d = arbejdsmappe({ app: GAMMEL_APP });
  try {
    await koer(tilLokal(UPDATE, s.url), d);
    const rest = fs.readdirSync(d).filter((n) => n.startsWith('.spolen'));
    assert.deepStrictEqual(rest, [], `efterladt: ${rest.join(', ')}`);
  } finally { await s.luk(); fs.rmSync(d, { recursive: true, force: true }); }
});

/* ------------------------------------------------------------ 2. fejlstier */

test('404: scriptet faelder, og app/ er uroert', async () => {
  const s = await serveArkiv({ status: 404 });
  const d = arbejdsmappe({ app: GAMMEL_APP });
  try {
    const r = await koer(tilLokal(UPDATE, s.url), d);
    assert.notStrictEqual(r.status, 0, 'en fejlet hentning skal give en fejlkode');
    assert.strictEqual(fs.readFileSync(path.join(d, 'app', 'server.js'), 'utf8'),
      '// gammel server\n', 'den gamle app skal staa uroert tilbage');
  } finally { await s.luk(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('et arkiv uden app/server.js byttes ikke ind', async () => {
  const s = await serveArkiv({ krop: byggArkiv({ 'laesmig.txt': 'ikke en app\n' }) });
  const d = arbejdsmappe({ app: GAMMEL_APP });
  try {
    const r = await koer(tilLokal(UPDATE, s.url), d);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stdout, /indeholder ingen app\/server\.js/);
    assert.strictEqual(fs.readFileSync(path.join(d, 'app', 'server.js'), 'utf8'), '// gammel server\n');
  } finally { await s.luk(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('laasen frigives efter en FEJLET hentning', async () => {
  // Det er den almindelige fejl - nettet blinker, taggen mangler. En laas,
  // der overlever den, goer knappen doed for altid.
  // Begge servere lukkes i finally. Lukkes en af dem midt i try'en, holder
  // en fejlende assertion den aaben - og saa HAENGER hele filen i stedet for
  // at fejle, fordi test-koereren ikke kan afslutte med en aaben lytter.
  // Praecis det skete, da laasens trap blev saboteret: proeven skulle vaere
  // roed og var i stedet uendelig (2026-09-05).
  const daarlig = await serveArkiv({ status: 500 });
  const god = await serveArkiv();
  const d = arbejdsmappe({ app: GAMMEL_APP });
  try {
    await koer(tilLokal(UPDATE, daarlig.url), d);
    assert.ok(!fs.existsSync(path.join(d, '.spolen-laas')), 'laasen laa tilbage efter en fejl');
    const r = await koer(tilLokal(UPDATE, god.url), d);
    assert.strictEqual(r.status, 0, 'knappen skal virke igen bagefter');
  } finally {
    await daarlig.luk();
    await god.luk();
    fs.rmSync(d, { recursive: true, force: true });
  }
});

/* --------------------------------------------------------- 3. to tryk paa én gang */

test('to samtidige koersler: praecis ÉN kommer igennem, og app/ er hel', async () => {
  // Uden forsinkelsen bestaar proeven ved et tilfaelde, naar hentningen er
  // hurtig nok til, at den foerste er faerdig, foer den anden begynder.
  const s = await serveArkiv({ forsink: 700 });
  const d = arbejdsmappe({ app: GAMMEL_APP });
  const script = tilLokal(UPDATE, s.url);
  try {
    const koersel = () => new Promise((ok) => {
      const p = spawn('/bin/sh', ['-c', script], { cwd: d, encoding: 'utf8' });
      let ud = '';
      p.stdout.on('data', (b) => { ud += b; });
      p.stderr.on('data', (b) => { ud += b; });
      p.on('close', (kode) => ok({ kode, ud }));
    });
    const [a, b] = await Promise.all([koersel(), koersel()]);
    const gennem = [a, b].filter((r) => r.kode === 0);
    const afvist = [a, b].filter((r) => r.kode !== 0);
    assert.strictEqual(gennem.length, 1,
      `praecis én skulle komme igennem, ikke ${gennem.length}`);
    assert.strictEqual(afvist.length, 1);
    assert.match(afvist[0].ud, /allerede i gang/,
      'den afviste skal sige HVORFOR - ellers ligner det en tilfaeldig fejl');
    assert.strictEqual(fs.readFileSync(path.join(d, 'app', 'server.js'), 'utf8'),
      '// ny server\n', 'app/ skal vaere hel bagefter');
    assert.strictEqual(s.kald(), 1, 'kun den ene koersel maatte naa at hente');
  } finally { await s.luk(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('laasen tages FOER forgreningen', async () => {
  // Fra v23 er kilde.js-grenen den almindelige. En laas inde i else-grenen
  // ville beskytte den vej, der snart aldrig bruges.
  //
  // Faelde, der kostede Sagu tid: `indexOf(a) < indexOf(b)` bestaar, naar a
  // mangler - for -1 er mindre end alt. Beviset for at BEGGE led findes
  // skal komme foerst.
  const laas = UPDATE.indexOf('mkdir .spolen-laas');
  const gren = UPDATE.indexOf('if [ -f app/kilde.js ]; then');
  assert.ok(laas > 0, 'laasen findes ikke i scriptet');
  assert.ok(gren > 0, 'forgreningen findes ikke i scriptet');
  assert.ok(laas < gren, 'laasen skal tages foer forgreningen');
  assert.match(UPDATE, /trap '[^']*\.spolen-laas[^']*' EXIT INT TERM/,
    'laasen skal frigives af en trap, ogsaa naar scriptet doer undervejs');
});

test('en strandet laas blokerer knappen - og ryddes af opstarten', async () => {
  const s = await serveArkiv();
  const d = arbejdsmappe({ app: GAMMEL_APP });
  try {
    fs.mkdirSync(path.join(d, '.spolen-laas'));      // som efter et haardt drab
    const r = await koer(tilLokal(UPDATE, s.url), d);
    assert.notStrictEqual(r.status, 0, 'knappen skal afvise, mens laasen ligger');
    assert.match(r.stdout, /allerede i gang/);

    // Startup rydder den. Uden det trin var knappen doed for altid, fordi
    // trap ikke naar at koere ved et haardt drab.
    assert.match(STARTUP, /if \[ -d \.spolen-laas \]; then/,
      'startup skal rydde en strandet laas');
    const kun = STARTUP.slice(0, STARTUP.indexOf('if [ -f app/kilde.js ]'));
    await koer(kun, d);
    assert.ok(!fs.existsSync(path.join(d, '.spolen-laas')), 'laasen skulle vaere ryddet');
  } finally { await s.luk(); fs.rmSync(d, { recursive: true, force: true }); }
});

/* ------------------------------------------------------ 4. de to grene */

test('findes kilde.js, henter knappen IKKE startsnoren', async () => {
  // Hvert tryk ville ellers nedgradere appen til runens tag og hente den
  // frem igen - og slaar nettet fejl i andet trin, bliver den liggende paa
  // den gamle udgave, stille (tovo, 2026-09-04).
  const s = await serveArkiv();
  const d = arbejdsmappe({
    app: {
      'server.js': '// gammel server\n',
      'kilde.js': 'require("fs").writeFileSync("kilde-koerte.txt", process.env.KODE_VERSION || "tom");\n',
    },
  });
  try {
    const r = await koer(tilLokal(UPDATE, s.url), d);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(d, 'kilde-koerte.txt')), 'kilde.js skulle koeres');
    assert.strictEqual(s.kald(), 0, 'startsnoren maatte IKKE hentes');
    assert.strictEqual(fs.readFileSync(path.join(d, 'app', 'server.js'), 'utf8'),
      '// gammel server\n', 'app/ maa ikke vaere rullet tilbage til startsnoren');
  } finally { await s.luk(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('laasen naar frem til kilde.js - uanset hvad panelet goer ved skabelonen', async () => {
  const skriv = 'require("fs").writeFileSync("kilde-koerte.txt", process.env.KODE_VERSION || "tom");\n';
  for (const [navn, kode, env] of [
    ['panelet templaterer feltet ind i teksten', '21', {}],
    ['panelet sender den kun som env', null, { KODE_VERSION: '21' }],
  ]) {
    const s = await serveArkiv();
    const d = arbejdsmappe({ app: { 'server.js': '// gammel\n', 'kilde.js': skriv } });
    try {
      const r = await koer(tilLokal(UPDATE, s.url, kode), d, env);
      assert.strictEqual(r.status, 0, `${navn}: ${r.stderr}`);
      assert.strictEqual(fs.readFileSync(path.join(d, 'kilde-koerte.txt'), 'utf8'), '21',
        `${navn}: laasen naaede ikke frem`);
    } finally { await s.luk(); fs.rmSync(d, { recursive: true, force: true }); }
  }
});

test('redningen staar ogsaa i knappen - den koerer uden om opstarten', async () => {
  const s = await serveArkiv();
  const d = arbejdsmappe();
  try {
    fs.mkdirSync(path.join(d, '.spolen-gammel'));
    fs.writeFileSync(path.join(d, '.spolen-gammel', 'server.js'), '// reddet\n');
    const r = await koer(tilLokal(UPDATE, s.url), d);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /sat tilbage efter en afbrudt udskiftning/);
  } finally { await s.luk(); fs.rmSync(d, { recursive: true, force: true }); }
});

/* -------------------------------------------------------- 5. beskeden */

test('scriptet slutter med at bede om en genstart', async () => {
  // Knappen skifter FILER. Panelets app-update svarer 202 og genstarter
  // ikke serveren - i Sagu gik der ti timer, foer nogen opdagede det, mens
  // den gamle proces koerte oven paa nye filer. Beskeden er den eneste vagt.
  const s = await serveArkiv();
  const d = arbejdsmappe({ app: GAMMEL_APP });
  try {
    const r = await koer(tilLokal(UPDATE, s.url), d);
    const linjer = r.stdout.trimEnd().split('\n').slice(-5);
    assert.match(linjer.join('\n'), /GENSTART SPOLEN NU/,
      'beskeden skal staa TIL SIDST - ovenover drukner den i udpakningen');
    assert.match(r.stdout, /stadig den gamle kode/, 'og den skal sige hvorfor');
  } finally { await s.luk(); fs.rmSync(d, { recursive: true, force: true }); }
});

/* ---------------------------------------- 6. det er panelets eget script */

test('alle tre scripts i runen er gyldig sh', async () => {
  // Beviser samtidig, at YAML-afkodningen i yamlskript.js ikke har
  // oedelagt noget: en forkert udpakket streng er sjaeldent gyldig shell.
  for (const [navn, s] of [['install', INSTALL], ['update', UPDATE], ['startup', STARTUP]]) {
    const r = spawnSync('/bin/sh', ['-n'], { input: s, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${navn} er ikke gyldig sh: ${r.stderr}`);
  }
});
