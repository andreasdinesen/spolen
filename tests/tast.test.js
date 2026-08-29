'use strict';
/*
 * Proever for "skriv hvor som helst -> skriv i soegefeltet".
 *
 * Funktionen hentes UD AF KILDEN og koeres. En afskrift ville proeve
 * afskriften (Sagu v40) - og netop her er det afgoerende, fordi mekanikken
 * IKKE kan drives i browser-panen: den sender syntetiske keydown med tom
 * `e.key`, saa alle taster ser ens ud derinde.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const kilde = fs.readFileSync(path.join(__dirname, '..', 'app', 'parts', 'p3_soeg.js'), 'utf8');
const m = kilde.match(/function skalFangeTast\(e, maal\) \{[\s\S]*?\n\}/);
assert.ok(m, 'skalFangeTast blev ikke fundet i kilden');
// eslint-disable-next-line no-new-func
const skalFangeTast = new Function(`${m[0]}; return skalFangeTast;`)();

const felt = (tag) => ({ tagName: tag });

test('et almindeligt tegn paa siden fanges', () => {
  assert.equal(skalFangeTast({ key: 'a' }, felt('BODY')), true);
  assert.equal(skalFangeTast({ key: 'Æ' }, felt('DIV')), true);
  assert.equal(skalFangeTast({ key: '7' }, felt('BUTTON')), true);
  // Mellemrum er ét tegn og er et gyldigt soegetegn.
  assert.equal(skalFangeTast({ key: ' ' }, felt('BODY')), true);
});

test('genvejstaster gaar fri - ellers stjaeles Cmd+R', () => {
  assert.equal(skalFangeTast({ key: 'r', metaKey: true }, felt('BODY')), false);
  assert.equal(skalFangeTast({ key: 'r', ctrlKey: true }, felt('BODY')), false);
  assert.equal(skalFangeTast({ key: 'r', altKey: true }, felt('BODY')), false);
});

test('styretaster fanges ikke', () => {
  for (const k of ['Enter', 'Tab', 'Escape', 'ArrowUp', 'Backspace', 'Shift', 'Dead', 'F5']) {
    assert.equal(skalFangeTast({ key: k }, felt('BODY')), false, k);
  }
});

test('staar man allerede i et felt, bliver tegnet dér', () => {
  assert.equal(skalFangeTast({ key: 'a' }, felt('INPUT')), false);
  assert.equal(skalFangeTast({ key: 'a' }, felt('TEXTAREA')), false);
  assert.equal(skalFangeTast({ key: 'a' }, felt('SELECT')), false);
  assert.equal(skalFangeTast({ key: 'a' }, { tagName: 'DIV', isContentEditable: true }), false);
  // Smaa bogstaver i tagName maa ikke slippe igennem.
  assert.equal(skalFangeTast({ key: 'a' }, { tagName: 'input' }), false);
});

test('panens TOMME e.key fanges ikke - det er selve grunden til denne proeve', () => {
  assert.equal(skalFangeTast({ key: '' }, felt('BODY')), false);
  assert.equal(skalFangeTast({}, felt('BODY')), false);
  assert.equal(skalFangeTast(null, felt('BODY')), false);
});
