'use strict';
/*
 * Web Push til spolen (F6/F2).
 *
 * Ren node:crypto - ingen pakker. Tre standarder skal opfyldes samtidig:
 *
 *   RFC 8291  Message Encryption: aes128gcm med en noegle udledt af
 *             browserens p256dh + auth via HKDF.
 *   RFC 8292  VAPID: et signeret JWT, der siger hvem der sender.
 *   RFC 8188  Content-Encoding: aes128gcm - selve rammeformatet.
 *
 * DET, DER GOER DET SVAERT AT BYGGE, er at man ikke kan proeve det: push
 * kraever https og en rigtig browser-abonnering. Derfor proeves modulet mod
 * RFC 8291's EGNE testvektorer (§5) - kendte input med kendte output. Er de
 * rigtige, er udregningen rigtig, uanset at ingen telefon har ringet endnu.
 */

const crypto = require('node:crypto');

const b64u = (b) => Buffer.from(b).toString('base64url');
const fraB64u = (s) => Buffer.from(String(s), 'base64url');

/* ------------------------------------------------------------- vapid */

/**
 * Et VAPID-noeglepar. Gemmes ÉN gang pr. installation.
 *
 * Den offentlige noegle er den "applicationServerKey", browseren skal have
 * ved abonnering - skifter den, doer alle eksisterende abonnementer.
 */
function nyeVapidNoegler() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    offentlig: b64u(publicKey.export({ type: 'spki', format: 'der' }).subarray(-65)),
    privat: b64u(privateKey.export({ type: 'pkcs8', format: 'der' })),
  };
}

function privatNoegle(privat) {
  return crypto.createPrivateKey({ key: fraB64u(privat), format: 'der', type: 'pkcs8' });
}

/**
 * VAPID-JWT'et, der ledsager en push.
 *
 * `aud` er push-tjenestens ORIGIN, ikke hele endpointet - sender man hele
 * adressen, afviser flere tjenester med 401, og fejlen naevner ikke aud.
 */
function vapidToken(endpoint, emne, privat) {
  const aud = new URL(endpoint).origin;
  const hoved = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const krop = b64u(JSON.stringify({
    aud,
    // 12 timer. Over 24 afvises af flere tjenester.
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: emne,
  }));
  const sig = crypto.sign('sha256', Buffer.from(`${hoved}.${krop}`), {
    key: privatNoegle(privat),
    dsaEncoding: 'ieee-p1363',     // JOSE vil have r||s, ikke DER
  });
  return `${hoved}.${krop}.${b64u(sig)}`;
}

/* -------------------------------------------------------- kryptering */

function hkdf(salt, ikm, info, laengde) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return crypto.createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, laengde);
}

/**
 * Krypterer én besked efter RFC 8291.
 *
 * @param {object} abon  {endpoint, keys:{p256dh, auth}} fra browseren
 * @param {string} besked
 * @param {object} [test] KUN til proever: fast salt og serveroegle, saa
 *   resultatet kan sammenlignes med RFC'ens vektorer. Aldrig i drift.
 */
function krypter(abon, besked, test) {
  const modtagerNoegle = fraB64u(abon.keys.p256dh);      // 65 bytes, ukomprimeret
  const authHemmelighed = fraB64u(abon.keys.auth);       // 16 bytes
  const salt = test ? fraB64u(test.salt) : crypto.randomBytes(16);

  const ecdh = crypto.createECDH('prime256v1');
  if (test) ecdh.setPrivateKey(fraB64u(test.serverPrivat));
  else ecdh.generateKeys();
  const serverOffentlig = ecdh.getPublicKey();
  const delt = ecdh.computeSecret(modtagerNoegle);

  /*
   * Noegleudledningen er den del, der er let at faa forkert - og som fejler
   * TAVST: en forkert info-streng giver en gyldig, men ulaeselig besked, og
   * push-tjenesten svarer 201 alligevel.
   */
  const prkInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'), modtagerNoegle, serverOffentlig,
  ]);
  const ikm = hkdf(authHemmelighed, delt, prkInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  // Padding-afgraensningen 0x02 betyder "sidste post". Uden den afviser
  // browseren beskeden.
  const klar = Buffer.concat([Buffer.from(besked, 'utf8'), Buffer.from([2])]);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const kryptTekst = Buffer.concat([c.update(klar), c.final(), c.getAuthTag()]);

  // RFC 8188-rammen: salt(16) + recordsize(4) + noeglelaengde(1) + noegle + data
  const hoved = Buffer.alloc(21);
  salt.copy(hoved, 0);
  hoved.writeUInt32BE(4096, 16);
  hoved.writeUInt8(serverOffentlig.length, 20);
  return Buffer.concat([hoved, serverOffentlig, kryptTekst]);
}

/* ------------------------------------------------------------- sending */

/**
 * Sender én push.
 *
 * Returnerer {ok, status, doed}. `doed` betyder, at abonnementet skal
 * SLETTES: 404 og 410 er push-tjenestens maade at sige, at browseren er
 * afmeldt. Bliver de liggende, sender vi til dem for evigt.
 */
function send(abon, besked, vapid, emne) {
  const https = require('node:https');
  const krop = krypter(abon, besked);
  const url = new URL(abon.endpoint);
  return new Promise((resolve) => {
    const req = https.request({
      host: url.host, path: url.pathname + url.search, method: 'POST',
      headers: {
        TTL: '86400',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'Content-Length': krop.length,
        Authorization: `vapid t=${vapidToken(abon.endpoint, emne, vapid.privat)}, `
          + `k=${vapid.offentlig}`,
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        doed: res.statusCode === 404 || res.statusCode === 410,
      }));
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, fejl: e.message, doed: false }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, status: 0, doed: false }); });
    req.write(krop);
    req.end();
  });
}

module.exports = { nyeVapidNoegler, vapidToken, krypter, send, hkdf, b64u, fraB64u };
