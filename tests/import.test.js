'use strict';
/*
 * Proever for importlaget.
 *
 * Alle fixtures er OPDIGTEDE. Der maa ikke ligge rigtige seerhistorikker i
 * repoet - hverken Andreas' eller andres.
 *
 * Vaegten ligger paa de steder, hvor en importoer taber data TAVST: en naiv
 * CSV-laeser paa titler med komma, en dato der bliver til NaN, og Netflix'
 * titelstreng, hvor formen er den eneste oplysning om, hvad raekken er.
 */
const test = require('node:test');
const assert = require('node:assert');
const imp = require('../app/shared/import.js');

/* ------------------------------------------------------------------ csv */

test('CSV: komma inde i et citeret felt splitter ikke raekken', () => {
  // Den klassiske. En naiv split(',') laver to felter ud af titlen og
  // forskyder ALLE efterfoelgende kolonner - uden at fejle.
  const t = imp.parseCsv('Name,Year\n"Good, Bad and Ugly",1966\n');
  assert.deepEqual(t[1], ['Good, Bad and Ugly', '1966']);
});

test('CSV: fordoblet anfoerselstegn bliver til ét', () => {
  const t = imp.parseCsv('Name\n"The ""Burbs"\n');
  assert.equal(t[1][0], 'The "Burbs');
});

test('CSV: linjeskift inde i et citeret felt bryder ikke raekken', () => {
  const t = imp.parseCsv('Name,Note\n"A film","line one\nline two"\n');
  assert.equal(t.length, 2);
  assert.equal(t[1][1], 'line one\nline two');
});

test('CSV: CRLF og BOM haandteres', () => {
  // Excel skriver begge dele. Uden BOM-fjernelsen hedder foerste kolonne
  // "﻿Title" og matcher ingen formatgenkendelse.
  const t = imp.parseCsv('﻿Title,Date\r\nA,2026-01-01\r\n');
  assert.deepEqual(t[0], ['Title', 'Date']);
  assert.deepEqual(t[1], ['A', '2026-01-01']);
});

test('CSV: tomme felter bevares, saa kolonnerne ikke forskydes', () => {
  const t = imp.parseCsv('a,b,c\n1,,3\n');
  assert.deepEqual(t[1], ['1', '', '3']);
});

/* --------------------------------------------------------------- datoer */

test('datoer: ISO med og uden tid', () => {
  assert.equal(imp.tolkDato('2026-08-29T20:15:00Z'),
    Math.floor(Date.UTC(2026, 7, 29, 20, 15) / 1000));
  // Ren dato lander MIDT paa dagen, ikke midnat: midnat kan tippe til dagen
  // foer, naar det senere vises i en vestlig tidszone.
  assert.equal(imp.tolkDato('2026-08-29'), Math.floor(Date.UTC(2026, 7, 29, 12) / 1000));
});

test('datoer: en manglende dato giver null - ALDRIG NaN og aldrig i dag', () => {
  // At gaette dagens dato ville fylde historikken med opdigtede tidspunkter,
  // som ingen bagefter kan skelne fra de rigtige.
  assert.equal(imp.tolkDato(''), null);
  assert.equal(imp.tolkDato(null), null);
  assert.equal(imp.tolkDato('ikke en dato'), null);
});

test('datoer: dag/maaned afgoeres af, om foerste tal er over 12', () => {
  // 29/08/2026 kan kun vaere dag/maaned.
  assert.equal(imp.tolkDato('29/08/2026'), Math.floor(Date.UTC(2026, 7, 29, 12) / 1000));
  // 8/29/26 kan kun vaere maaned/dag (og tocifret aar).
  assert.equal(imp.tolkDato('8/29/26'), Math.floor(Date.UTC(2026, 7, 29, 12) / 1000));
});

test('aarstal: urimelige tal afvises frem for at blive gemt', () => {
  assert.equal(imp.tolkAar('1966'), 1966);
  assert.equal(imp.tolkAar('The Film (1999)'), 1999);
  assert.equal(imp.tolkAar('1500'), null);
  assert.equal(imp.tolkAar(''), null);
});

/* -------------------------------------------------------------- netflix */

test('Netflix: serie med saeson og afsnitsnavn', () => {
  const r = imp.tolkNetflixTitel('Some Show: Season 3: The Long Night');
  assert.equal(r.type, 'episode');
  assert.equal(r.title, 'Some Show');
  assert.equal(r.season, 3);
  assert.equal(r.episodeName, 'The Long Night');
});

test('Netflix: DANSK profil siger "Sæson"', () => {
  const r = imp.tolkNetflixTitel('En Serie: Sæson 2: Et Afsnit');
  assert.equal(r.type, 'episode');
  assert.equal(r.title, 'En Serie');
  assert.equal(r.season, 2);
});

test('Netflix: "Limited Series" har intet nummer og bliver saeson 1', () => {
  const r = imp.tolkNetflixTitel('Some Show: Limited Series: Part One');
  assert.equal(r.season, 1);
  assert.equal(r.title, 'Some Show');
});

test('Netflix: en serie, der SELV har kolon i navnet', () => {
  // Alt foer saesondelen er navnet - ikke bare det foerste stykke.
  const r = imp.tolkNetflixTitel('Alias: Section One: Season 2: The Episode');
  assert.equal(r.title, 'Alias: Section One');
  assert.equal(r.season, 2);
});

test('Netflix: en film har ingen inddeling', () => {
  const r = imp.tolkNetflixTitel('A Perfectly Ordinary Film');
  assert.equal(r.type, 'movie');
  assert.equal(r.season, null);
});

test('Netflix: to dele uden saesonord regnes som AFSNIT, ikke film', () => {
  // Kaldte man det en film, forsvandt afsnittet ud af serieregnskabet.
  const r = imp.tolkNetflixTitel('An Anthology: The First Story');
  assert.equal(r.type, 'episode');
  assert.equal(r.title, 'An Anthology');
  assert.equal(r.episodeName, 'The First Story');
});

/* ------------------------------------------------------- formatgenkendelse */

test('genkender Netflix paa headerne, ikke paa filnavnet', () => {
  const ud = imp.laesFil('Title,Date\n"Some Show: Season 1: Pilot",29/08/2026\n');
  assert.equal(ud.format, 'netflix');
  assert.equal(ud.raekker.length, 1);
  assert.equal(ud.raekker[0].type, 'episode');
  assert.equal(ud.raekker[0].season, 1);
});

test('genkender Letterboxd og regner halve stjerner om til 1-10', () => {
  const ud = imp.laesFil(
    'Date,Name,Year,Letterboxd URI,Rating,Watched Date\n'
    + '2026-01-02,A Made-Up Film,2001,https://example.invalid/x,3.5,2026-01-01\n');
  assert.equal(ud.format, 'letterboxd-diary');
  assert.equal(ud.raekker[0].rating, 7);          // 3,5 stjerner -> 7 af 10
  assert.equal(ud.raekker[0].year, 2001);
});

test('genkender IMDb og tager tt-id med', () => {
  const ud = imp.laesFil(
    'Const,Your Rating,Date Rated,Title,Title Type,Year\n'
    + 'tt0000001,8,2026-03-04,Invented Title,movie,1999\n');
  assert.equal(ud.format, 'imdb');
  assert.equal(ud.raekker[0].ids.imdb, 'tt0000001');
  assert.equal(ud.raekker[0].rating, 8);
});

test('genkender Trakt og laeser saeson/afsnit', () => {
  const ud = imp.laesFil(
    'watched_at,type,title,year,season,episode,tmdb_id\n'
    + '2026-05-06T21:00:00Z,episode,Invented Series,2020,2,4,12345\n');
  assert.equal(ud.format, 'trakt');
  const r = ud.raekker[0];
  assert.equal(r.type, 'episode');
  assert.equal(r.season, 2);
  assert.equal(r.number, 4);
  assert.equal(r.ids.tmdb, 12345);
});

test('en ukendt fil siger hvilke kolonner den SAA', () => {
  // Uden det er "unknown format" umuligt at handle paa.
  const ud = imp.laesFil('alfa,beta\n1,2\n');
  assert.equal(ud.format, null);
  assert.match(ud.fejl, /alfa, beta/);
});

test('raekker uden titel springes over - og RAPPORTERES', () => {
  // Det er hele pointen: en import, der springer over i tavshed, er en fejl,
  // man opdager maaneder senere.
  const ud = imp.laesFil('Title,Date\nA Show,2026-01-01\n,2026-01-02\n');
  assert.equal(ud.raekker.length, 1);
  assert.equal(ud.sprunget.length, 1);
  assert.equal(ud.sprunget[0].linje, 3);
});

/* ------------------------------------------------ datoernes raekkefoelge */

test('datoformat udledes af HELE filen, ikke af den enkelte raekke', () => {
  // 03/02 er tvetydig. 29/08 er det ikke - den kan kun vaere dag/maaned.
  // Derfor skal HELE filen laeses som dag/maaned.
  assert.equal(imp.gaetDatoformat(['03/02/2022', '29/08/2026']), 'dmy');
  // Og omvendt: 08/29 kan kun vaere maaned/dag.
  assert.equal(imp.gaetDatoformat(['03/02/2022', '08/29/2026']), 'mdy');
});

test('en fil uden ét eneste entydigt eksempel er "ukendt"', () => {
  // Alle tal under 13 - der er intet at udlede, og saa maa man ikke lade
  // som om der var.
  assert.equal(imp.gaetDatoformat(['03/02/2022', '05/06/2023']), 'ukendt');
  assert.equal(imp.gaetDatoformat([]), 'ukendt');
});

test('en fil, der modsiger sig selv, kaldes "blandet"', () => {
  // Fx to eksporter klistret sammen. Det er en rigtig tilstand og skal
  // siges hoejt frem for at blive afrundet til det ene eller det andet.
  assert.equal(imp.gaetDatoformat(['29/08/2026', '08/29/2026']), 'blandet');
});

test('DANSK Netflix-fil laeses som dag/maaned, naar filen selv viser det', () => {
  const ud = imp.laesFil(
    'Title,Date\n'
    + '"Some Show: Season 1: One",03/02/2022\n'
    + '"Some Show: Season 1: Two",29/08/2022\n');
  assert.equal(ud.dateOrder, 'dmy');
  assert.equal(ud.dateOrderSikker, true);
  // 03/02/2022 skal vaere 3. FEBRUAR - ikke 2. marts.
  assert.equal(ud.raekker[0].watchedAt, Math.floor(Date.UTC(2022, 1, 3, 12) / 1000));
});

test('AMERIKANSK fil laeses som maaned/dag, naar filen selv viser det', () => {
  const ud = imp.laesFil(
    'Title,Date\n'
    + '"Some Show: Season 1: One",03/02/2022\n'
    + '"Some Show: Season 1: Two",08/29/2022\n');
  assert.equal(ud.dateOrder, 'mdy');
  // Samme streng, modsat svar - fordi filen omkring den siger noget andet.
  assert.equal(ud.raekker[0].watchedAt, Math.floor(Date.UTC(2022, 2, 2, 12) / 1000));
});

test('en helt tvetydig fil melder det - og brugeren kan overstyre', () => {
  const auto = imp.laesFil('Title,Date\n"A Film",03/02/2022\n');
  assert.equal(auto.dateOrderGaettet, 'ukendt');
  assert.equal(auto.dateOrderSikker, false, 'skal IKKE paastaa at vaere sikker');
  // Standarden er dag/maaned, men den er oplyst, ikke skjult.
  assert.equal(auto.raekker[0].watchedAt, Math.floor(Date.UTC(2022, 1, 3, 12) / 1000));
  // Overstyring vinder.
  const tvunget = imp.laesFil('Title,Date\n"A Film",03/02/2022\n', { dateOrder: 'mdy' });
  assert.equal(tvunget.raekker[0].watchedAt, Math.floor(Date.UTC(2022, 2, 2, 12) / 1000));
});

test('en titel med skraastregstal forgifter ikke gaettet', () => {
  // Kun de ERKLAEREDE datokolonner spoerges. Ellers ville "9/11" i en titel
  // kunne afgoere, hvordan hele historikken bliver laest.
  const ud = imp.laesFil(
    'Title,Date\n'
    + '"A Film About 9/11/2001",29/08/2022\n');
  assert.equal(ud.dateOrder, 'dmy');
});
