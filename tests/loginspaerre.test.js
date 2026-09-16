'use strict';
/*
 * Proever mod det RIGTIGE endepunkt: login-spaerringen kan ikke snydes med
 * X-Forwarded-For.
 *
 * Indtil rune-audit 2026-09-16 var klientens adresse den FOERSTE vaerdi i
 * headeren - og den vaelger klienten selv. Et nyt opdigtet tal forrest i hvert
 * forsoeg gav en ny spand hver gang, og loftet paa 20 forsoeg ramte aldrig.
 * Samtidig fyldte [sikkerhed]-linjerne sig med adresser, der ikke fandtes.
 *
 * Lokalt er socket-adressen loopback, altsaa "en proxy foran os". Derfor
 * sendes `<forfalsket>, 203.0.113.50`: den bageste, ikke-egne vaerdi er den,
 * tunnelen saa - og den skal vaere noeglen, uanset hvad der staar foran.
 *
 * Porten er fast, fordi `BIND_PORT=0` falder tilbage til 3000.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rod = (...d) => path.join(__dirname, '..', ...d);

const PORT = Number(process.env.SPOLEN_SPAERRE_PORT || 9012);
const BASE = `http://127.0.0.1:${PORT}`;
const RIGTIG = '203.0.113.50';

/* Start serveren, og saml ALT hvad den skriver - [sikkerhed] gaar til stderr. */
function startServer(dataDir) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [rod('app', 'server.js')], {
      env: { ...process.env, BIND_PORT: String(PORT), DATA_DIR: dataDir, SPOLEN_DEV: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    p.ud = '';
    const tid = setTimeout(() => { p.kill(); reject(new Error(`serveren startede ikke:\n${p.ud}`)); }, 15000);
    const lyt = (b) => {
      p.ud += b;
      if (p.ud.includes('spolen lytter')) { clearTimeout(tid); resolve(p); }
    };
    p.stdout.on('data', lyt);
    p.stderr.on('data', lyt);
    p.on('exit', (kode) => { clearTimeout(tid); reject(new Error(`serveren doede (${kode}):\n${p.ud}`)); });
  });
}

async function kald(sti, krop, xff) {
  const headers = { 'content-type': 'application/json' };
  if (xff) headers['x-forwarded-for'] = xff;
  const r = await fetch(BASE + sti, { method: 'POST', headers, body: JSON.stringify(krop) });
  return { status: r.status, data: await r.json() };
}

test('et nyt forfalsket X-Forwarded-For pr. forsoeg slipper ikke uden om spaerringen', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spolen-spaerre-'));
  const server = await startServer(dataDir);
  t.after(() => {
    server.removeAllListeners('exit');
    server.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const reg = await kald('/api/register', { username: 'proeve', password: 'hemmeligt-kodeord' });
  assert.strictEqual(reg.status, 200, JSON.stringify(reg.data));

  // Loftet er 20 pr. kvarter. De 20 forkerte forsoeg bruger det op ...
  for (let i = 1; i <= 20; i += 1) {
    const r = await kald('/api/login', { username: 'proeve', password: 'forkert' },
      `198.51.100.${i}, ${RIGTIG}`);
    assert.strictEqual(r.status, 401, `forsoeg ${i}: ${JSON.stringify(r.data)}`);
  }
  // ... og nr. 21 er spaerret - ogsaa med en helt ny forfalsket adresse og
  // det RIGTIGE kodeord.
  const spaerret = await kald('/api/login', { username: 'proeve', password: 'hemmeligt-kodeord' },
    `198.51.100.99, ${RIGTIG}`);
  assert.strictEqual(spaerret.status, 429, JSON.stringify(spaerret.data));

  // [sikkerhed]-linjerne skriver adressen, tunnelen saa - aldrig det opdigtede.
  const linjer = server.ud.split('\n').filter((l) => l.includes('[sikkerhed] login-fejl'));
  assert.strictEqual(linjer.length, 20, server.ud);
  for (const l of linjer) assert.ok(l.endsWith(`ip=${RIGTIG}`), l);
  assert.ok(!server.ud.includes('198.51.100.'), 'en forfalsket adresse naaede loggen');
});
