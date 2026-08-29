'use strict';
/*
 * Proever for de rene udregninger.
 *
 * TO regler, som resten af projektet ogsaa er bundet af:
 *
 *  1. "I dag" gives ALTID ind som en fast dato. En proeve, hvis forventning
 *     afhaenger af dagen i dag, er roed én ugedag ud af syv (tovo 2026-08-28).
 *  2. Proeverne henter funktionerne UD AF KILDEN. En afskrift proever
 *     afskriften (Sagu v40).
 *
 * Koeres med:  node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const beregn = require('../app/shared/beregn.js');

const IDAG = '2026-08-28';

/** Bygger en serie: saeson 1 med 5 afsnit, hver en uge fra hinanden. */
function serie(opts) {
  const o = opts || {};
  const start = o.start || '2026-08-01';
  const antal = o.antal || 5;
  const ud = [];
  for (let i = 0; i < antal; i++) {
    const d = new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10)));
    d.setUTCDate(d.getUTCDate() + i * 7);
    ud.push({
      id: `tv:1:s1e${i + 1}`,
      season: 1,
      number: i + 1,
      airDate: d.toISOString().slice(0, 10),
    });
  }
  return ud;
}

/* ------------------------------------------------------- naesteUsete */

test('intet set: naeste og klar er foerste afsnit', () => {
  const a = serie();                       // 1. aug ... 29. aug
  const r = beregn.naesteUsete(a, new Set(), { idag: IDAG });
  assert.equal(r.naeste.id, 'tv:1:s1e1');
  assert.equal(r.klar.id, 'tv:1:s1e1');
  assert.equal(r.sete, 0);
  assert.equal(r.ialt, 5);
});

test('HULLER: set 1 og 3 -> naeste er 2, ikke 4', () => {
  // Den vigtigste enkeltregel i hele appen. "Hoejeste sete plus én" ville
  // give afsnit 4 og springe et afsnit over, brugeren aldrig har set.
  const a = serie();
  const sete = new Set(['tv:1:s1e1', 'tv:1:s1e3']);
  const r = beregn.naesteUsete(a, sete, { idag: IDAG });
  assert.equal(r.naeste.id, 'tv:1:s1e2');
  assert.equal(r.klar.id, 'tv:1:s1e2');
  assert.equal(r.sete, 2);
});

test('naeste og klar er FORSKELLIGE, naar man er ajour', () => {
  // Afsnit 1-4 er sendt (1., 8., 15., 22. aug), afsnit 5 sendes 29. aug -
  // altsaa I MORGEN i forhold til IDAG. Har man set alle fire sendte, er der
  // intet at se i aften, men der ER noget paa vej.
  const a = serie();
  const sete = new Set(['tv:1:s1e1', 'tv:1:s1e2', 'tv:1:s1e3', 'tv:1:s1e4']);
  const r = beregn.naesteUsete(a, sete, { idag: IDAG });
  assert.equal(r.klar, null, 'intet klar - afsnit 5 er ikke sendt endnu');
  assert.equal(r.naeste.id, 'tv:1:s1e5', 'men afsnit 5 er paa vej');
  assert.equal(r.ajour, true);
  assert.equal(r.faerdig, false, 'ajour er ikke det samme som faerdig');
});

test('et afsnit der sendes I DAG er klar', () => {
  const a = [{ id: 'tv:1:s1e1', season: 1, number: 1, airDate: IDAG }];
  const r = beregn.naesteUsete(a, new Set(), { idag: IDAG });
  assert.equal(r.klar.id, 'tv:1:s1e1');
});

test('afsnit UDEN dato er ikke klar, men er stadig naeste', () => {
  // TMDB har masser af annoncerede afsnit uden dato. De maa ikke dukke op paa
  // forsiden som noget, man kan se i aften.
  const a = [{ id: 'tv:1:s1e1', season: 1, number: 1, airDate: null }];
  const r = beregn.naesteUsete(a, new Set(), { idag: IDAG });
  assert.equal(r.klar, null);
  assert.equal(r.naeste.id, 'tv:1:s1e1');
});

test('alt set og intet paa vej -> faerdig', () => {
  const a = serie({ start: '2026-01-01', antal: 3 });
  const sete = new Set(a.map((e) => e.id));
  const r = beregn.naesteUsete(a, sete, { idag: IDAG });
  assert.equal(r.faerdig, true);
  assert.equal(r.ajour, true);
  assert.equal(r.naeste, null);
});

test('specials er FRA som standard - og saeson 0 kaprer ellers forsiden', () => {
  const a = serie().concat([
    { id: 'tv:1:s0e1', season: 0, number: 1, airDate: '2026-01-01' },
  ]);
  const fra = beregn.naesteUsete(a, new Set(), { idag: IDAG });
  assert.equal(fra.naeste.id, 'tv:1:s1e1', 'specials skal ikke vaere foerste afsnit');
  assert.equal(fra.ialt, 5);

  const til = beregn.naesteUsete(a, new Set(), { idag: IDAG, hideSpecials: false });
  assert.equal(til.naeste.id, 'tv:1:s0e1', 'med specials sorterer saeson 0 foerst');
  assert.equal(til.ialt, 6);
});

test('afsnit sorteres i sendeorden, uanset hvilken orden de kommer i', () => {
  const a = serie().slice().reverse();
  const r = beregn.naesteUsete(a, new Set(), { idag: IDAG });
  assert.equal(r.naeste.id, 'tv:1:s1e1');
});

test('saeson 2 foelger efter saeson 1', () => {
  const a = [
    { id: 'tv:1:s2e1', season: 2, number: 1, airDate: '2026-08-20' },
    { id: 'tv:1:s1e9', season: 1, number: 9, airDate: '2026-08-10' },
  ];
  const r = beregn.naesteUsete(a, new Set(), { idag: IDAG });
  assert.equal(r.naeste.id, 'tv:1:s1e9');
});

test('naesteUsete NAEGTER at gaette "i dag"', () => {
  // Den slags gaet er praecis det, der goer en proeve roed om fredagen.
  assert.throws(() => beregn.naesteUsete([], new Set(), {}), /idag/);
});

/* --------------------------------------------------------- fremdrift */

test('fremdrift regner i SENDTE afsnit, ikke i bestilte', () => {
  // Fire af fem er sendt. Har man set alle fire, er man 100 % fremme -
  // for man er saa langt, som det er muligt at vaere.
  const a = serie();
  const sete = new Set(['tv:1:s1e1', 'tv:1:s1e2', 'tv:1:s1e3', 'tv:1:s1e4']);
  const r = beregn.fremdrift(a, sete, { idag: IDAG });
  assert.equal(r.sendte, 4);
  assert.equal(r.sete, 4);
  assert.equal(r.ialt, 5);
  assert.equal(r.procent, 100);
});

test('fremdrift: halvvejs', () => {
  const a = serie();
  const r = beregn.fremdrift(a, new Set(['tv:1:s1e1', 'tv:1:s1e2']), { idag: IDAG });
  assert.equal(r.procent, 50);
});

test('fremdrift: en serie hvor intet er sendt er 0, ikke NaN', () => {
  const a = serie({ start: '2027-01-01' });
  const r = beregn.fremdrift(a, new Set(), { idag: IDAG });
  assert.equal(r.sendte, 0);
  assert.equal(r.procent, 0);
});

/* ------------------------------------------------- udsendelsesstatus */

test('udsendelsesstatus skelner sendt, i dag, kommer og ukendt', () => {
  assert.deepEqual(beregn.udsendelsesstatus(IDAG, IDAG), { status: 'idag', dage: 0 });
  assert.deepEqual(beregn.udsendelsesstatus('2026-08-31', IDAG), { status: 'kommer', dage: 3 });
  assert.deepEqual(beregn.udsendelsesstatus('2026-08-21', IDAG), { status: 'sendt', dage: -7 });
  assert.deepEqual(beregn.udsendelsesstatus(null, IDAG), { status: 'ukendt', dage: null });
});

test('dageMellem gaar korrekt over et maanedsskifte og et aarsskifte', () => {
  assert.equal(beregn.dageMellem('2026-08-28', '2026-09-01'), 4);
  assert.equal(beregn.dageMellem('2026-12-31', '2027-01-01'), 1);
  // Skudaar: 2028 er et.
  assert.equal(beregn.dageMellem('2028-02-28', '2028-03-01'), 2);
});

/* ---------------------------------------------------------- naesteTjek */

const NU = Math.floor(Date.UTC(2026, 7, 28, 12) / 1000);   // 28. aug 2026
const DAG = 86400;

test('naesteTjek: sender inden for en uge -> dagligt', () => {
  // Datoer flytter sig i sidste oejeblik, saa den her gren er den vigtige.
  assert.equal(beregn.naesteTjek('Returning Series', '2026-08-30', NU), NU + DAG);
  assert.equal(beregn.naesteTjek('Returning Series', beregn.isoDato(NU), NU), NU + DAG);
});

test('naesteTjek: loebende serie uden naer udsendelse -> ugentligt', () => {
  assert.equal(beregn.naesteTjek('Returning Series', '2026-12-01', NU), NU + 7 * DAG);
  assert.equal(beregn.naesteTjek('Returning Series', null, NU), NU + 7 * DAG);
});

test('naesteTjek: afsluttet serie -> hver 90. dag', () => {
  assert.equal(beregn.naesteTjek('Ended', null, NU), NU + 90 * DAG);
  assert.equal(beregn.naesteTjek('Canceled', null, NU), NU + 90 * DAG);
});

test('naesteTjek: udgivet film -> hver 30. dag, fordi den FLYTTER sig', () => {
  // Filmen aendrer sig ikke, men den skifter streamingtjeneste - og det er
  // hele grunden til at se efter (S3).
  assert.equal(beregn.naesteTjek('Released', null, NU), NU + 30 * DAG);
});

test('naesteTjek: en udsendelse i FORTIDEN udloeser ikke dagligt tjek', () => {
  // Ellers ville hver afsluttet serie med en gammel "naeste udsendelse"
  // blive tjekket hver dag for evigt.
  assert.equal(beregn.naesteTjek('Ended', '2020-01-01', NU), NU + 90 * DAG);
});
