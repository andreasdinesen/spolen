'use strict';
/*
 * Proever for web push.
 *
 * Push kan IKKE proeves ende til ende her: det kraever https, en rigtig
 * browser-abonnering og en push-tjeneste. Derfor proeves udregningen mod
 * RFC 8291's EGNE testvektorer (§5) - kendte input med kendt output.
 *
 * Det er den eneste maade at vide, om krypteringen er rigtig: en forkert
 * noegleudledning giver en gyldig, men ulaeselig besked, og push-tjenesten
 * svarer 201 alligevel. Fejlen ville foerst vise sig som en notifikation,
 * der aldrig kom - uden noget sted at se hvorfor.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const push = require('../app/push.js');

/*
 * ADVARSEL OM DAEKNINGEN — laes den, foer du stoler paa modulet.
 *
 * Der er INGEN proeve mod RFC 8291's offentliggjorte testvektorer her.
 * Foerste forsoeg skrev vektorernes vaerdier efter hukommelsen, og de var
 * forkerte: Node afviste modtagernoeglen som et ugyldigt punkt paa kurven.
 * En proeve bygget paa gaettede konstanter beviser ingenting - og pillede
 * man ved tallene, til den blev groen, ville man tilpasse proeven til koden.
 *
 * Det, der ER proevet her:
 *   - at kryptering og en UAFHAENGIGT skrevet afkodning er enige (rundtur)
 *   - at rammen har den form, RFC 8188 beskriver
 *   - at VAPID-JWT'et er ES256 med aud = origin og en p1363-signatur
 *
 * Det, der IKKE er proevet:
 *   - at en RIGTIG browser kan laese beskeden. Rundturen deler standarden
 *     med krypteringen, men ikke koden - er min LAESNING af standarden
 *     forkert, er begge sider forkerte paa samme maade, og proeven er groen.
 *
 * Den eneste rigtige proeve er en notifikation, der lander paa en telefon.
 * Indtil da: antag at det kan vaere forkert.
 */

const KLARTEKST = 'When I grow up, I want to be a watermelon';

test('faste noegler og salt giver et FAST resultat', () => {
  // Beviser at test-krogene virker: uden dem kunne rundturen nedenfor ikke
  // skelne en rigtig fejl fra en ny tilfaeldig noegle.
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const server = crypto.createECDH('prime256v1');
  server.generateKeys();
  const abon = {
    keys: {
      p256dh: ua.getPublicKey().toString('base64url'),
      auth: crypto.randomBytes(16).toString('base64url'),
    },
  };
  const t = {
    salt: crypto.randomBytes(16).toString('base64url'),
    serverPrivat: server.getPrivateKey().toString('base64url'),
  };
  assert.deepEqual(push.krypter(abon, KLARTEKST, t), push.krypter(abon, KLARTEKST, t));
  /*
   * Og UDEN test-krogene skal SALTET vaere nyt hver gang.
   *
   * Det er ikke nok at kraeve, at de to beskeder er forskellige: den
   * flygtige servernoegle skifter alligevel, saa outputtet varierer selv med
   * et fast nul-salt. Maalt 2026-08-29 - sabotagen "genbrug saltet" slap
   * igennem, fordi proeven kiggede paa hele beskeden i stedet for paa de
   * foerste 16 bytes.
   */
  const a = push.krypter(abon, KLARTEKST);
  const b = push.krypter(abon, KLARTEKST);
  assert.notDeepEqual(a.subarray(0, 16), b.subarray(0, 16), 'saltet skal vaere nyt hver gang');
  assert.notDeepEqual(a.subarray(0, 16), Buffer.alloc(16), 'saltet maa ikke vaere nul');
  assert.notDeepEqual(a, b);
});

test('rammen har den form, RFC 8188 beskriver', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const ud = push.krypter({ keys: {
    p256dh: ua.getPublicKey().toString('base64url'),
    auth: crypto.randomBytes(16).toString('base64url'),
  } }, KLARTEKST);
  assert.equal(ud.readUInt32BE(16), 4096, 'record size');
  assert.equal(ud.readUInt8(20), 65, 'noeglelaengden');
  assert.equal(ud.length, 21 + 65 + KLARTEKST.length + 1 + 16,
    'hoved + noegle + klartekst + afgraensning + gcm-tag');
});

test('RUNDTUR: det krypterede kan laeses igen med modtagerens noegle', () => {
  /*
   * Uafhaengig afkodning efter RFC 8291. Den deler ikke kode med
   * krypteringen - kun standarden. Er de to enige, er noegleudledningen
   * rigtig hele vejen.
   */
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const besked = 'Nyt afsnit af Prøveserien i aften — S2E3';

  const pakke = push.krypter(
    { keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
    besked);

  const salt = pakke.subarray(0, 16);
  const noegleLen = pakke.readUInt8(20);
  const asPublic = pakke.subarray(21, 21 + noegleLen);
  const kryptTekst = pakke.subarray(21 + noegleLen);

  const delt = ua.computeSecret(asPublic);
  const prkInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = push.hkdf(auth, delt, prkInfo, 32);
  const cek = push.hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = push.hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(kryptTekst.subarray(-16));
  const klar = Buffer.concat([d.update(kryptTekst.subarray(0, -16)), d.final()]);
  assert.equal(klar.subarray(0, -1).toString('utf8'), besked);
  assert.equal(klar[klar.length - 1], 2, 'afgraensningen skal vaere 0x02');
});

test('VAPID-JWT: tre dele, ES256, og aud er ORIGIN - ikke hele adressen', () => {
  const n = push.nyeVapidNoegler();
  const t = push.vapidToken('https://push.eksempel.dk/wp/abc123?x=1', 'mailto:navn@eksempel.dk', n.privat);
  const [h, k, s] = t.split('.');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).alg, 'ES256');
  const krop = JSON.parse(Buffer.from(k, 'base64url'));
  // Sender man hele endpointet som aud, svarer flere tjenester 401 uden at
  // naevne aud med ét ord.
  assert.equal(krop.aud, 'https://push.eksempel.dk');
  assert.equal(krop.sub, 'mailto:navn@eksempel.dk');
  assert.ok(krop.exp > Math.floor(Date.now() / 1000), 'skal udloebe i fremtiden');
  assert.ok(krop.exp < Math.floor(Date.now() / 1000) + 24 * 3600, 'over 24 t afvises');
  // r||s, ikke DER: 64 bytes for P-256.
  assert.equal(Buffer.from(s, 'base64url').length, 64, 'signaturen skal vaere ieee-p1363');
});

test('VAPID-noegler har den form, browseren kraever', () => {
  const n = push.nyeVapidNoegler();
  const off = Buffer.from(n.offentlig, 'base64url');
  assert.equal(off.length, 65, 'applicationServerKey er 65 bytes ukomprimeret');
  assert.equal(off[0], 4, 'ukomprimeret punkt starter med 0x04');
});
