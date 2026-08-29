'use strict';
/*
 * Hvordan et brugernavn SKRIVES paa skaermen.
 *
 * Navnet gemmes altid med smaa bogstaver. Det er med vilje: login slaar op
 * paa lower(username), saa "andreas", "Andreas" og "ANDREAS" er den SAMME
 * konto, og to konti kan ikke skille sig ad paa store bogstaver alene. Den
 * regel maa ikke roeres - den er det, der goer login utvetydigt.
 *
 * Men gemt form og vist form behoever ikke vaere det samme. Et navn i
 * venstre menu skal se ud som et navn (Andreas, 2026-08-29).
 *
 * Ligger i shared/, fordi BAADE serveren (samtykkesiden i OAuth) og
 * fladen skriver navne ud. To kopier ville drive fra hinanden, og saa
 * hedder man Andreas ét sted og andreas et andet.
 */

/*
 * Stort begyndelsesbogstav i hvert LED. Sammensatte navne er almindelige -
 * "anne-marie" skal blive "Anne-Marie", ikke "Anne-marie".
 *
 * toUpperCase() klarer ae, oe og aa af sig selv; det er derfor der ikke
 * staar en tabel over danske tegn her.
 */
function visNavn(navn) {
  if (typeof navn !== 'string') return '';
  return navn.replace(
    /[^\s\-_.]+/gu,
    (led) => led.charAt(0).toUpperCase() + led.slice(1)
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { visNavn };
}
