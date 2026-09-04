'use strict';
/*
 * spolen henter sin egen kode. Koer: node --test tests/kilde.test.js
 *
 * Det, der kan gaa galt her, er ikke hentningen - det er REGLERNE omkring
 * den, og de er alle sammen af den slags, der ikke fejler hoejlydt:
 *
 *  - »seneste« maa ikke kunne blive til en tilfaeldig tag. GitHub sorterer
 *    tags ALFABETISK, og alfabetisk er v9 nyere end v80. Spolen er paa v22,
 *    saa fejlen bider allerede: v9 staar efter v22.
 *  - En laas maa ikke kunne tolkes vaek. Skriver man »v21«, skal spolen sige
 *    fra - ikke gaette paa 21 og heller ikke stille og roligt hente nyeste.
 *  - Der maa ikke byttes til noget, der ikke er en hel spolen, eller til
 *    kode, der ikke er den, taggen lover.
 *
 * Hentningen selv (https, gunzip, tar) proeves IKKE her: den kraever GitHub.
 * Det er et bevidst hul - og derfor er alt det, der KAN proeves uden net,
 * skilt ud i rene funktioner.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const K = require('../app/kilde.js');
const ROD = path.join(__dirname, '..');

/* ------------------------------------------------------- KODE_VERSION */

/* Tom er STANDARDEN - ikke bare en tilladt vaerdi. Kunne den tomme streng
   ikke laeses som »nyeste«, ville et nyt panel-felt betyde »ingen udgave«,
   og hver genstart ville enten fejle eller staa stille. */
test('tom, seneste og latest betyder alle det samme', () => {
  for (const v of ['', '   ', 'seneste', 'latest', 'Seneste', 'LATEST']) {
    const o = K.oensket(v);
    assert.strictEqual(o.laast, false, `»${v}« skulle ikke laase`);
    assert.strictEqual(o.tekst, 'seneste');
    assert.strictEqual(o.fejl, undefined);
  }
});

test('et tal laaser til praecis den udgave', () => {
  const o = K.oensket('21');
  assert.strictEqual(o.laast, true);
  assert.strictEqual(o.version, 21);
  assert.strictEqual(o.tekst, '21');
});

test('noget, der LIGNER et tal, laaser ikke - det siger fra', () => {
  // »v21« er det, man skriver, naar man taenker paa taggen. Blev det tolket
  // som 21, ville spolen gaette; blev det tolket som »seneste« i stilhed,
  // ville laasen forsvinde, uden at nogen fik det at vide.
  for (const v of ['v21', '21.2', 'nyeste', '-1']) {
    const o = K.oensket(v);
    assert.strictEqual(o.laast, false, `»${v}« maa ikke laase`);
    assert.strictEqual(o.tekst, 'seneste');
    assert.ok(o.fejl, `»${v}« skal give en forklaring`);
    assert.match(o.fejl, /KODE_VERSION/);
  }
});

test('mellemrum omkring et tal trimmes vaek', () => {
  assert.strictEqual(K.oensket(' 21 ').version, 21);
});

/* ---------------------------------------------------------- nyeste tag */

/** En hentJson, der svarer med faste sider i stedet for at ringe til GitHub. */
const faestet = (sider) => async (url) => {
  const m = /[?&]page=(\d+)/.exec(url);
  return sider[Number(m[1]) - 1] || [];
};

test('det hoejeste vN vinder - ikke det foerste, GitHub naevner', async () => {
  // Praecis den raekkefoelge, en alfabetisk sortering giver. Tog vi bare
  // liste[0], ville v9 blive »nyeste«, og hver server ville rulle 13
  // udgaver tilbage ved naeste genstart.
  const svar = [[{ name: 'v9' }, { name: 'v22' }, { name: 'v8' }, { name: 'v20' }]];
  assert.strictEqual(await K.nyesteTag(faestet(svar)), 22);
});

test('der bladres, indtil en side ikke er fuld', async () => {
  const side1 = Array.from({ length: 100 }, (_, i) => ({ name: `v${i + 1}` }));
  const side2 = [{ name: 'v101' }, { name: 'v102' }];
  assert.strictEqual(await K.nyesteTag(faestet([side1, side2])), 102);
});

test('tags, der ikke er udgivelser, taeller ikke med', async () => {
  const svar = [[{ name: 'start' }, { name: 'v3' }, { name: 'v10-rc1' }, { name: 'V99' }]];
  assert.strictEqual(await K.nyesteTag(faestet(svar)), 3);
});

test('en tagliste helt uden vN er en fejl, ikke et nul', async () => {
  // Et nul ville betyde »hent v0«, og v0 findes ikke. En fejl her lader
  // serveren starte paa den kode, der ligger - se regel 1 i kilde.js.
  await assert.rejects(() => K.nyesteTag(faestet([[{ name: 'start' }]])), /ingen vN-tag/);
});

/* --------------------------------------------------- tjek foer der byttes */

/** Listen, kilde.js faktisk kraever - laest ud af kilde.js, ikke gentaget. */
function kraevedeFiler() {
  const kode = fs.readFileSync(path.join(ROD, 'app', 'kilde.js'), 'utf8');
  const m = kode.match(/const kraevede = \[([\s\S]*?)\];/);
  assert.ok(m, 'kunne ikke finde listen over kraevede filer i kilde.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function traeMed(version, { udelad = [] } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spolen-kilde-'));
  const html = `<link rel="stylesheet" href="/style.css?v=${version}">\n`
    + `<script src="/app.js?v=${version}"></script>\n`;
  for (const navn of kraevedeFiler()) {
    if (udelad.includes(navn)) continue;
    fs.mkdirSync(path.join(d, path.dirname(navn)), { recursive: true });
    fs.writeFileSync(path.join(d, navn), navn.endsWith('index.html') ? html : `// ${navn}\n`);
  }
  return d;
}

test('et helt trae med det rigtige stempel godtages', () => {
  const d = traeMed(23);
  try { K.tjekTrae(d, 23); } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('en halv hentning byttes ikke ind - uanset HVILKEN fil der mangler', () => {
  for (const mangler of kraevedeFiler()) {
    const d = traeMed(23, { udelad: [mangler] });
    try {
      assert.throws(() => K.tjekTrae(d, 23), new RegExp(mangler.replace('/', '\\/')),
        `et traee uden ${mangler} blev godkendt`);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  }
});

test('listen daekker ALT, serveren indlaeser paa modulniveau', () => {
  // Den her proeve findes, fordi tovo brugte dodas liste uden at rette den
  // (2026-09-03): serveren require'r flere moduler, end forlaegget gjorde,
  // saa et halvt arkiv blev godkendt - og containeren startede og doede med
  // MODULE_NOT_FOUND ved hver genstart. En liste, der er rigtig i
  // forlaegget, er ikke rigtig hos modtageren.
  const server = fs.readFileSync(path.join(ROD, 'app', 'server.js'), 'utf8');
  const paaModulniveau = [...server.matchAll(
    /^(?:const|let|var)\s+[^=]+=\s*require\((['"])(\.[^'"]+)\1\)/gm)].map((m) => m[2]);
  assert.ok(paaModulniveau.length > 5, 'fandt for faa require-linjer - moensteret er nok forkert');

  const liste = kraevedeFiler();
  for (const sti of paaModulniveau) {
    const rel = sti.replace(/^\.\//, '');
    assert.ok(liste.includes(rel),
      `server.js indlaeser ${rel} ved opstart, men kilde.js godkender et arkiv uden den`);
  }
});

test('en tag, der indeholder en ANDEN version, afvises', () => {
  // Det sker, naar en tag er flyttet oven paa en anden commit. Koden ville
  // koere - men ingen kunne navngive den, og panelet ville lyve.
  const d = traeMed(20);
  try {
    assert.throws(() => K.tjekTrae(d, 23), /v23 indeholder kode stemplet v20/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('en index.html uden versionsstempel afvises', () => {
  const d = traeMed(23);
  try {
    fs.writeFileSync(path.join(d, 'public', 'index.html'), '<h1>spolen</h1>\n');
    assert.throws(() => K.tjekTrae(d, 23), /intet versionsstempel/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

/* ------------------------------------------------ hvad ligger der lige nu */

test('maerket laeses, naar det findes', () => {
  const d = traeMed(23);
  try {
    fs.writeFileSync(path.join(d, '.kode-version'), JSON.stringify({
      version: 20, oensket: '20', hentet: '2026-09-03T10:00:00.000Z', kilde: 'github',
    }));
    const m = K.installeret(d);
    assert.strictEqual(m.version, 20);
    assert.strictEqual(m.kilde, 'github');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('uden maerke staar tallet i index.html', () => {
  // Den vej gaelder for hver eneste spolen, der er installeret FOER denne
  // aendring: runens install-script skriver ikke noget maerke. Uden det
  // fallback ville foerste genstart hente koden igen, ogsaa naar den
  // allerede var den rigtige.
  const d = traeMed(22);
  try {
    const m = K.installeret(d);
    assert.strictEqual(m.version, 22);
    assert.strictEqual(m.kilde, 'install');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('et ulaeseligt maerke falder tilbage til index.html', () => {
  const d = traeMed(22);
  try {
    fs.writeFileSync(path.join(d, '.kode-version'), '{ ikke json');
    assert.strictEqual(K.installeret(d).version, 22);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('en mappe helt uden app giver null, ikke et kraks', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spolen-tom-'));
  try { assert.strictEqual(K.installeret(d), null); } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('den rigtige app/ kan navngive sig selv', () => {
  const m = K.installeret(path.join(ROD, 'app'));
  assert.ok(m && Number.isInteger(m.version), 'app/ skulle kunne laeses');
});

/* ------------------------------------------------------------ regel 1 */

test('modulet skriver aldrig [fejl] i en advarsel', () => {
  // Panelets watcher taeller [fejl]-linjer og sender en notifikation ved
  // fem paa fem minutter. »GitHub svarede ikke« er ikke en serverfejl - og
  // en notifikation, hver gang nettet blinker, laerer man at ignorere.
  const kode = fs.readFileSync(path.join(ROD, 'app', 'kilde.js'), 'utf8');
  const advarsel = kode.match(/function advar[\s\S]*?\n}/);
  assert.ok(advarsel, 'advar() skulle findes');
  assert.ok(!advarsel[0].includes('[fejl]'), 'advarsler maa ikke taelle som serverfejl');
});

test('main() ender ALTID paa exit 0', () => {
  // Den vigtigste egenskab i hele filen: en netvaerksfejl paa serveren maa
  // udsaette en opdatering - aldrig slukke for appen.
  const kode = fs.readFileSync(path.join(ROD, 'app', 'kilde.js'), 'utf8');
  const main = kode.match(/async function main\(\)[\s\S]*?\n}/);
  assert.ok(main, 'main() skulle findes');
  assert.match(main[0], /process\.exit\(0\)/);
  assert.ok(!/process\.exit\([^0]/.test(main[0]), 'main() maa ikke kunne ende paa andet end 0');
  assert.match(main[0], /catch/, 'en fejl skal fanges, ikke boble op');
});
