'use strict';
/*
 * Runens scripts, som PANELET faar dem.
 *
 * Node har ingen YAML-parser, og et regulaert udtryk over YAML-tekst prover
 * ikke det, panelet koerer: PyYAML skriver et langt script som ét
 * dobbeltciteret scalar med \n for linjeskift, \" for anfoerselstegn og
 * ombrydning midt i linjerne. `node app/kilde.js` findes i den tekst, men
 * `K="$K"` goer ikke - og forskellen er ren tilfaeldighed om, hvor filen er
 * braekket. Derfor pakkes scalaren ud her.
 *
 * Afkodningen er sammenlignet BYTE FOR BYTE med PyYAMLs egen paa alle tre
 * scripts (2026-09-04). Proev den igen, hvis du roerer den:
 *
 *   python3 -c "import yaml;d=yaml.safe_load(open('runes/spolen.yaml'))..."
 */

const assert = require('node:assert');

/**
 * Traekker et af runens scripts UD af YAML'en og pakker det ud til den
 * shell, panelet faktisk koerer.
 *
 * Det er ikke pedanteri: pyyaml skriver lange scripts som ét dobbelt-
 * citeret scalar med `\n` for linjeskift, `\"` for anfoerselstegn og
 * ombrydning midt i linjerne. Et regulaert udtryk over den tekst rammer
 * derfor tilfaeldigt - `node app/kilde.js` findes, men `K="$K"` goer ikke,
 * fordi anfoerselstegnene staar escaped og linjen maaske er brudt paa
 * midten. Foerste udgave af proeven her var groen paa det ene og roed paa
 * det andet, uden at noget var galt med runen.
 */
function scriptet(yamlTekst, sektion, noegle) {
  const fra = yamlTekst.indexOf(`\n  ${sektion}:\n`);
  assert.ok(fra > 0, `kunne ikke finde ${sektion}: i runen`);
  const start = yamlTekst.indexOf(`${noegle}: "`, fra) + noegle.length + 2;
  assert.ok(start > fra, `kunne ikke finde ${noegle}: under ${sektion}:`);
  let i = start + 1;
  for (; i < yamlTekst.length; i += 1) {   // find det AFSLUTTENDE anfoerselstegn
    if (yamlTekst[i] === '\\') { i += 1; continue; }
    if (yamlTekst[i] === '"') break;
  }
  const raa = yamlTekst.slice(start, i + 1)
    // pyyaml bryder en lang linje med `\` til sidst. Skal der staa et
    // MELLEMRUM paa brudstedet, begynder naeste linje med et escaped
    // mellemrum (`\ `) - og det er ikke en gyldig JSON-escape, saa det skal
    // vaek FOER de almindelige brud, ikke efter.
    .replace(/\\\n\s*\\ /g, ' ')
    .replace(/\\\n\s*/g, '')
    .replace(/\n\s*/g, ' ')
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return JSON.parse(raa);        // resten er JSON-escapes
}

const appVersion = () => tal(fil('app', 'parts', 'p1_core.js'),
  /^const APP_VERSION = (\d+);/m, 'p1_core.js');

module.exports = { scriptet };
