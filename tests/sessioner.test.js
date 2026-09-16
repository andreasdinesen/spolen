'use strict';
/*
 * Proever mod det RIGTIGE endepunkt: naar totrinsbekraeftelse slaas til, doer
 * brugerens andre sessioner.
 *
 * Uden det lever en session, der blev aabnet med kodeordet alene, videre i op
 * til SESSION_DAYS (90 dage), som om det andet trin aldrig var slaaet til -
 * og det er netop den session, man slaar 2FA til for at lukke ude
 * (rune-audit 2026-09-16). Kodeordsskiftet har haft reglen hele tiden.
 *
 * Serveren startes som en rigtig proces paa en tom datamappe. Porten er fast,
 * fordi `BIND_PORT=0` falder tilbage til 3000 (`Number('0') || 3000`).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rod = (...d) => path.join(__dirname, '..', ...d);
const totp = require(rod('app', 'totp.js'));

const PORT = Number(process.env.SPOLEN_TEST_PORT || 9011);
const BASE = `http://127.0.0.1:${PORT}`;

/* Start serveren og vent paa den linje, runens done_regex ogsaa venter paa. */
function startServer(dataDir) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [rod('app', 'server.js')], {
      env: { ...process.env, BIND_PORT: String(PORT), DATA_DIR: dataDir, SPOLEN_DEV: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ud = '';
    const tid = setTimeout(() => { p.kill(); reject(new Error(`serveren startede ikke:\n${ud}`)); }, 15000);
    const lyt = (b) => {
      ud += b;
      if (ud.includes('spolen lytter')) { clearTimeout(tid); resolve(p); }
    };
    p.stdout.on('data', lyt);
    p.stderr.on('data', lyt);
    p.on('exit', (kode) => { clearTimeout(tid); reject(new Error(`serveren doede (${kode}):\n${ud}`)); });
  });
}

/* Et kald med en bestemt session. Returnerer status, krop og en ny cookie. */
async function kald(metode, sti, cookie, krop) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (krop !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(BASE + sti, {
    method: metode, headers, body: krop === undefined ? undefined : JSON.stringify(krop),
  });
  const saet = r.headers.get('set-cookie') || '';
  const m = saet.match(/spolen_session=([^;]*)/);
  return { status: r.status, data: await r.json(), cookie: m ? `spolen_session=${m[1]}` : null };
}

test('2FA til slaar brugerens ANDRE sessioner ihjel, men ikke den aktuelle', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spolen-sess-'));
  const server = await startServer(dataDir);
  t.after(() => {
    server.removeAllListeners('exit');
    server.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // To sessioner paa samme konto: "telefonen" og "den gamle browser".
  const reg = await kald('POST', '/api/register', null,
    { username: 'proeve', password: 'hemmeligt-kodeord' });
  assert.strictEqual(reg.status, 200, JSON.stringify(reg.data));
  const a = reg.cookie;
  const log = await kald('POST', '/api/login', null,
    { username: 'proeve', password: 'hemmeligt-kodeord' });
  assert.strictEqual(log.status, 200, JSON.stringify(log.data));
  const b = log.cookie;
  assert.ok(a && b && a !== b, 'fik ikke to forskellige sessioner');

  // Begge lever foer.
  assert.strictEqual((await kald('GET', '/api/me', a)).data.user?.username, 'proeve');
  assert.strictEqual((await kald('GET', '/api/me', b)).data.user?.username, 'proeve');

  // Slaa 2FA til fra A - med en kode, vi selv regner ud af hemmeligheden.
  const start = await kald('POST', '/api/2fa/start', a, {});
  assert.strictEqual(start.status, 200, JSON.stringify(start.data));
  const kode = totp.kodeFor(start.data.secret, Math.floor(Date.now() / 30000));
  const til = await kald('POST', '/api/2fa/enable', a, { code: kode });
  assert.strictEqual(til.status, 200, JSON.stringify(til.data));
  assert.strictEqual((await kald('GET', '/api/2fa', a)).data.enabled, true, '2FA blev ikke slaaet til');

  // A lever stadig - man skal ikke smides ud af den side, man lige har brugt.
  const efterA = await kald('GET', '/api/me', a);
  assert.strictEqual(efterA.data.user?.username, 'proeve',
    'den session, der slog 2FA til, blev ogsaa logget ud');

  // B er doed - baade i /api/me og paa en rute, der kraever login.
  const efterB = await kald('GET', '/api/me', b);
  assert.strictEqual(efterB.data.user, null,
    'den anden session lever videre efter 2FA blev slaaet til - den blev aabnet uden andet trin');
  const beskyttet = await kald('GET', '/api/2fa', b);
  assert.strictEqual(beskyttet.status, 401, 'den anden session kan stadig kalde en beskyttet rute');
});
