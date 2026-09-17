'use strict';
/*
 * Saesonlisten for en titel, man IKKE har i biblioteket.
 *
 * Endepunktet er proevet mod en RIGTIG server, fordi det, der kan gaa galt,
 * er parametrene - og de laeses af serveren, ikke af TMDB-klienten (den er
 * daekket i tmdb.test.js).
 *
 * Faelden er `tal()`: den KLAMPER, og en manglende parameter er `null` ->
 * Number(null) er 0 -> klampet op til minimum. Uden en vagt paa TEKSTEN
 * ville `/api/preview/season` uden `season` hente specials, og uden
 * `tmdbId` hente titel nr. 1 - tavst, og med et rigtigt TMDB-kald.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rod = (...d) => path.join(__dirname, '..', ...d);
const PORT = Number(process.env.SPOLEN_TEST_PORT || 9014);
const BASE = `http://127.0.0.1:${PORT}`;

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

async function kald(sti, cookie) {
  const r = await fetch(BASE + sti, { headers: cookie ? { cookie } : {} });
  return { status: r.status, data: await r.json() };
}

test('en saesonforespoergsel uden gyldige parametre afvises - den gaetter ikke', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spolen-saeson-'));
  const server = await startServer(dataDir);
  t.after(() => {
    server.removeAllListeners('exit');
    server.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const reg = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'proeve', password: 'et-langt-proevekodeord' }),
  });
  const m = (reg.headers.get('set-cookie') || '').match(/spolen_session=([^;]*)/);
  assert.ok(m, 'kunne ikke oprette proevebrugeren');
  const cookie = `spolen_session=${m[1]}`;

  // Uden login: ingen adgang, uanset parametre.
  const uden = await kald('/api/preview/season?kind=tv&tmdbId=1&season=1', null);
  assert.strictEqual(uden.status, 401, 'saesonerne kan hentes uden at vaere logget ind');

  for (const [sti, hvorfor] of [
    ['/api/preview/season', 'ingen parametre'],
    ['/api/preview/season?kind=tv&tmdbId=1', 'ingen season - ville hente specials'],
    ['/api/preview/season?kind=tv&season=1', 'ingen tmdbId - ville hente titel nr. 1'],
    ['/api/preview/season?kind=tv&tmdbId=abc&season=1', 'tmdbId er ikke et tal'],
    ['/api/preview/season?kind=tv&tmdbId=1&season=-1', 'negativ saeson'],
  ]) {
    const svar = await kald(sti, cookie);
    assert.strictEqual(svar.status, 400, `${hvorfor}: fik ${svar.status}, ikke 400`);
  }

  /*
   * MED gyldige parametre naar kaldet frem til noeglen - og der er ingen.
   * 503 og ikke 400 er netop beviset paa, at vagten slap den igennem.
   */
  const gyldig = await kald('/api/preview/season?kind=tv&tmdbId=1&season=0', cookie);
  assert.strictEqual(gyldig.status, 503, 'saeson 0 (specials) blev afvist som ugyldig');
  assert.strictEqual(gyldig.data.error, 'no_tmdb_key');
});
