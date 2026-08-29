'use strict';
/*
 * Proever for sidebarens fod: brugerknap, temaknap og brugermenu.
 *
 * Andreas, 2026-08-29: "flyt settings ind paa brugernavnet som i doda, og
 * tilfoej valg af tema". Fladen kan ikke koeres i node, saa proeverne her
 * holder KILDEN fast paa de faa ting, der er nemme at komme til at bryde
 * igen - saerligt at temanoeglen skal vaere den samme to steder.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rod = (...d) => path.join(__dirname, '..', ...d);
const CORE = fs.readFileSync(rod('app', 'parts', 'p1_core.js'), 'utf8');
const APP = fs.readFileSync(rod('app', 'parts', 'p2_app.js'), 'utf8');
const SET = fs.readFileSync(rod('app', 'parts', 'p4_settings.js'), 'utf8');
const HTML = fs.readFileSync(rod('app', 'public', 'index.html'), 'utf8');

/*
 * DEN VIGTIGE.
 *
 * index.html saetter data-theme i <head>, FOER app.js koerer - det er dét,
 * der forhindrer et hvidt blink paa vej ind i moerkt tema. Laeser de to
 * steder hver sin noegle, gemmer appen et tema, den aldrig faar sat ved
 * indlaesning, og valget ser ud til ikke at blive husket.
 */
test('index.html og app.js bruger SAMME temanoegle', () => {
  const iHtml = HTML.match(/localStorage\.getItem\('([^']+)'\)/);
  assert.ok(iHtml, 'index.html laeser ikke et tema fra localStorage laengere');

  const iApp = CORE.match(/localStorage\.setItem\('([^']+)', valg\)/);
  assert.ok(iApp, 'anvendTema gemmer ikke temaet');

  assert.strictEqual(iApp[1], iHtml[1],
    `app.js gemmer under "${iApp[1]}", men index.html laeser "${iHtml[1]}" `
    + '- saa bliver valget ikke sat ved indlaesning');
});

test('temaknappen viser vejen til det MODSATTE af det, man ser', () => {
  assert.match(APP, /const naeste = visuelTema\(\) === 'dark' \? 'light' : 'dark'/,
    'temaknappen gaetter ikke ud fra det VISTE tema');
  // "Follow system" er ikke en farve - visuelTema skal slaa den op i maskinen.
  assert.match(CORE, /prefers-color-scheme: dark/,
    'visuelTema spoerger ikke maskinen, naar valget er "auto"');
});

test('alle tre valg findes under Settings', () => {
  assert.match(SET, /\['auto', 'Follow system'\]/, '"Follow system" mangler');
  assert.match(SET, /\['light', 'Light'\]/, '"Light" mangler');
  assert.match(SET, /\['dark', 'Dark'\]/, '"Dark" mangler');
  assert.match(SET, /temaAfsnit\(\)/, 'temaafsnittet vises ikke paa siden');
});

test('Settings er ude af navigationen og ligger paa brugerknappen', () => {
  const sider = APP.slice(APP.indexOf('const SIDER'), APP.indexOf('function skal('));
  assert.ok(!/id: 'settings'/.test(sider),
    'Settings staar stadig i venstremenuen - saa er der to indgange');

  assert.match(APP, /id: 'brugerKnap'/, 'brugerknappen findes ikke');
  assert.match(APP, /state\.view === 'settings' \? 'page' : null/,
    'brugerknappen markeres ikke, naar man ER paa Settings - saa er intet markeret');
  assert.match(APP, /onclick: \(\) => gaa\('settings'\)/,
    'brugermenuen foerer ikke til Settings');
});

test('log ud findes kun i brugermenuen, ikke som knap i foden', () => {
  const fod = APP.slice(APP.indexOf("class: 'sidebar-foot'"),
    APP.indexOf("class: 'sidebar-foot'") + 900);
  assert.ok(!/Sign out/.test(fod),
    'en "Sign out"-knap staar stadig i foden ved siden af brugerknappen');
  assert.match(APP, /usermenu-item danger/, 'log ud mangler i brugermenuen');
});

test('temaet saettes ogsaa naar app.js starter', () => {
  assert.match(APP, /anvendTema\(nuvaerendeTema\(\)\)/,
    'temaet anvendes ikke ved opstart - uden lager falder appen ikke tilbage pænt');
});
