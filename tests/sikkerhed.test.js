'use strict';
/*
 * Proever for kontoens sikkerhed: totrinsbekraeftelse og passkeys.
 *
 * Begge motorer LAA faerdige i repoet fra begyndelsen - totp.js, qr.js og
 * webauthn.js, og `credentials`-tabellen kom med foerste migration. Det, der
 * manglede, var HTTP-vejen og fladen (Andreas, 2026-08-30).
 *
 * Proeverne her passer paa de faa regler, det er dyrt at bryde.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rod = (...d) => path.join(__dirname, '..', ...d);
const SRV = fs.readFileSync(rod('app', 'server.js'), 'utf8');
const SET = fs.readFileSync(rod('app', 'parts', 'p4_settings.js'), 'utf8');
const CORE = fs.readFileSync(rod('app', 'parts', 'p1_core.js'), 'utf8');
const totp = require(rod('app', 'totp.js'));
const qr = require(rod('app', 'qr.js'));

/* Klip ét endepunkt ud af rutetabellen. */
function rute(navn) {
  const i = SRV.indexOf(`'${navn}':`);
  assert.notStrictEqual(i, -1, `${navn} findes ikke`);
  return SRV.slice(i, SRV.indexOf('\n  },', i));
}

/*
 * DEN VIGTIGSTE REGEL.
 *
 * En adgangsnoegle til et program maa ALDRIG kunne roere kontoens sikkerhed.
 * Ellers kan én laekket noegle slaa totrinsbekraeftelsen fra og tilfoeje sin
 * egen passkey - og saa er noeglen blevet til varig adgang.
 */
test('kontoens sikkerhed kraever en rigtig session, ikke en adgangsnoegle', () => {
  const ruter = ['GET /api/2fa', 'POST /api/2fa/start', 'POST /api/2fa/enable',
    'DELETE /api/2fa', 'POST /api/2fa/recovery',
    'GET /api/passkeys', 'POST /api/passkeys/register/start',
    'POST /api/passkeys/register/finish'];
  for (const r of ruter) {
    const krop = rute(r);
    assert.match(krop, /requireUser\(req, res\)/,
      `${r} bruger ikke requireUser - saa kan en adgangsnoegle goere det`);
    assert.ok(!/godkend\(req, res/.test(krop),
      `${r} bruger godkend() - det accepterer en adgangsnoegle`);
  }
});

/*
 * Kontakten maa ikke gaa til, foer telefonen har bevist sig.
 *
 * Uden det kunne man slaa noget til, man ikke kan komme igennem bagefter -
 * og saa er kontoen laast ude af sin ejer.
 */
test('2FA taendes foerst efter en gyldig kode', () => {
  const start = rute('POST /api/2fa/start');
  assert.match(start, /setSetting\(user\.id, 'totp_secret'/, 'hemmeligheden gemmes ikke');
  assert.ok(!/totp_enabled', '1'/.test(start),
    'start slaar totrinsbekraeftelse TIL med det samme - en afbrudt opsaetning ville laase kontoen');

  const enable = rute('POST /api/2fa/enable');
  assert.match(enable, /totp\.tjek\(hem, kode\)/, 'koden proeves ikke');
  assert.match(enable, /vindue === null/, 'en forkert kode afvises ikke');
  const tjek = enable.indexOf('vindue === null');
  const taend = enable.indexOf("'totp_enabled', '1'");
  assert.ok(tjek !== -1 && taend !== -1 && tjek < taend,
    'kontakten gaar til FOER koden er proevet');
});

/* Et kodevindue maa kun bruges én gang - ellers kan en opsnappet kode
   bruges igen inden for det halve minut. */
test('kodevinduet braendes', () => {
  const enable = rute('POST /api/2fa/enable');
  assert.match(enable, /setSetting\(user\.id, 'totp_last', String\(vindue\)\)/,
    'vinduet gemmes ikke - saa kan den samme kode bruges to gange');
});

/*
 * Fra igen mod KODEORD, ikke mod en engangskode.
 *
 * Har man mistet telefonen, ville et krav om en engangskode goere det umuligt
 * at komme videre; og en aaben session maa ikke kunne fjerne det andet trin
 * uden at kende kodeordet.
 */
test('2FA kan kun slaas fra med kodeordet', () => {
  for (const r of ['DELETE /api/2fa', 'POST /api/2fa/recovery']) {
    const krop = rute(r);
    assert.match(krop, /verifyPassword\(/, `${r} kraever ikke kodeordet`);
  }
});

test('engangskoder og QR virker', () => {
  const hem = totp.nyHemmelighed();
  const t = Math.floor(Date.now() / 30000);
  const kode = totp.kodeFor(hem, t);
  assert.match(kode, /^\d{6}$/, 'koden er ikke seks cifre');
  assert.notStrictEqual(totp.tjek(hem, kode), null, 'vores egen kode godtages ikke');
  assert.strictEqual(totp.tjek(hem, '000000'), null, 'en forkert kode godtages');

  const url = totp.otpauth(hem, 'andreas', 'spolen');
  assert.match(url, /^otpauth:\/\/totp\/spolen:andreas\?secret=/, 'otpauth-adressen er forkert');
  const svg = qr.tilSvg(url, { px: 200 });
  assert.match(svg, /^<svg /, 'QR-koden er ikke en SVG');
  assert.match(svg, /width="200"/, 'stoerrelsen slaar ikke igennem');
  // px, ikke stoerrelse: foerste udgave sendte et navn, modulet ikke kender,
  // og saa faldt den tilbage til 220 uden at sige noget (2026-08-30).
  assert.match(SRV, /qr\.tilSvg\(url, \{ px: 200 \}\)/, 'serveren kalder QR med et ukendt navn');
});

/* ------------------------------------------------------------ passkeys */

test('passkeys kraever https', () => {
  const krop = rute('POST /api/passkeys/register/start');
  assert.match(krop, /isHttps\(req\)/,
    'der tjekkes ikke for https - uden det findes browserens noeglehaandtering slet ikke');
});

/*
 * Login med passkey maa ikke ogsaa kraeve en engangskode. En passkey ER to
 * faktorer: noeglen ligger i telefonen, og telefonen laaser den op med
 * ansigt eller finger.
 */
test('passkey-login laver en session for noeglens EGEN ejer', () => {
  const krop = rute('POST /api/passkeys/login/finish');
  assert.match(krop, /svar\.credential\.user_id/,
    'brugeren findes ikke ud fra noeglen - saa kan man logge ind som en anden');
  assert.ok(!/body\.username|body\.userId/.test(krop),
    'der laeses en bruger ud af forespoergslen - den maa aldrig bestemme, hvem man bliver');
  assert.match(krop, /sessionCookie\(req, createSession\(bruger\.id\)/,
    'sessionen laves ikke for den bruger, noeglen hoerer til');
});

test('taelleren opdateres, saa en klonet noegle kan opdages', () => {
  const krop = rute('POST /api/passkeys/login/finish');
  assert.match(krop, /UPDATE credentials SET sign_count = \?/,
    'taelleren gemmes ikke - saa virker klon-tjekket aldrig');
});

test('en passkey kan kun fjernes af sin ejer', () => {
  const i = SRV.indexOf("re: /^\\/api\\/passkeys\\/");
  assert.notStrictEqual(i, -1, 'sletteruten findes ikke');
  const krop = SRV.slice(i, SRV.indexOf('\n  },', i));
  assert.match(krop, /DELETE FROM credentials WHERE id = \? AND user_id = \?/,
    'sletningen filtrerer ikke paa bruger - saa kan man fjerne andres noegler');
  assert.match(krop, /requireUser/, 'en adgangsnoegle kan fjerne passkeys');
});

test('login-knappen vises kun, naar browseren kan det', () => {
  assert.match(CORE, /typeof window\.PublicKeyCredential === 'function'/,
    'knappen vises uden at tjekke, om browseren kan passkeys');
  assert.match(CORE, /cfg\.secureContext &&/,
    'knappen vises ogsaa over plain http, hvor den ikke kan virke');
});

/*
 * base64url, ikke base64. Det er HER en passkey-integration plejer at gaa
 * galt: + og / i stedet for - og _, eller glemt polstring - og saa siger
 * browseren nej uden at forklare hvorfor.
 */
test('binaert omregnes som base64URL i begge ender', () => {
  for (const [navn, kilde] of [['login', CORE], ['opsaetning', SET]]) {
    assert.match(kilde, /replace\(\/-\/g, '\+'\)\.replace\(\/_\/g, '\/'\)/,
      `${navn}: der afkodes ikke base64url`);
    assert.match(kilde, /replace\(\/\\\+\/g, '-'\)\.replace\(\/\\\/\/g, '_'\)/,
      `${navn}: der kodes ikke til base64url`);
    assert.match(kilde, /'==='\.slice\(\(b64\.length \+ 3\) % 4\)/,
      `${navn}: polstringen mangler`);
  }
});

/* ------------------------------------------- Claude-connector (§9a) */

/*
 * MCP-serveren har koert siden F6, men stod kun naevnt som ÉN linje nede
 * under "Access keys" - og der er ingen, der finder den (Andreas,
 * 2026-08-30, spurgte om den overhovedet var med).
 *
 * En funktion, ingen kan finde, er ikke leveret.
 */
test('Claude-connectoren har sit eget punkt med adresse og hjaelp', () => {
  assert.match(SET, /foldAfsnit\('mcp', 'Claude connector', 'mcp', mcpAfsnit\)/,
    'connectoren har ikke sit eget punkt under Settings');

  const i = SET.indexOf('function mcpAfsnit');
  assert.notStrictEqual(i, -1, 'mcpAfsnit findes ikke');
  const krop = SET.slice(i, SET.indexOf('\n}\n', i));

  assert.match(krop, /\$\{location\.origin\}\/mcp/,
    'adressen bygges ikke ud fra den, man staar paa - saa passer den ikke bag en tunnel');
  assert.match(krop, /clipboard\.writeText/, 'adressen kan ikke kopieres');
  assert.match(krop, /felt\.select\(\)/,
    'uden clipboard-adgang faar brugeren ingen vej videre');

  /*
   * Uden https kan Claude slet ikke naa serveren. Det skal staa paa siden og
   * ikke opdages, naar man har indsat adressen og faaet en fejl, man ikke kan
   * tolke.
   */
  assert.match(krop, /location\.protocol === 'https:'/, 'der advares ikke om plain http');
});

test('hjaelpen skelner mellem browseren og Claude Code', () => {
  const H = fs.readFileSync(rod('app', 'parts', 'p9_hjaelp.js'), 'utf8');
  const i = H.indexOf('  mcp: {');
  assert.notStrictEqual(i, -1, 'hjaelpeteksten til mcp findes ikke');
  const krop = H.slice(i, H.indexOf('\n  },', i));

  assert.match(krop, /claude\.ai/, 'browservejen naevnes ikke');
  assert.match(krop, /Bearer token/, 'noeglevejen til Claude Code naevnes ikke');
  assert.match(krop, /no key changes hands|no key/,
    'det siges ikke, at browservejen IKKE kraever en noegle - og det er hele forskellen');
});
