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

/*
 * Et TITELNAVN, skaaret ned til det, to skrivemaader har til faelles.
 *
 * "Spider-Man 3" og "Spiderman 3" er den samme film, men LIKE '%spiderman 3%'
 * rammer aldrig den foerste. Andreas soegte paa "Spiderman 3", havde filmen i
 * biblioteket, og fik den kun at se under "From TMDB" med et "Added"-maerke -
 * afsnittet "In your library" var tomt (2026-08-29).
 *
 * Alt andet end bogstaver og tal ryger: bindestreger, kolon, apostroffer,
 * mellemrum og accenter. Saa bliver "Spider-Man 3", "Spiderman 3" og
 * "SPIDER MAN 3" til det samme - og "WALL·E" til "walle".
 *
 * Det er MED VILJE grovkornet. Den bruges kun til at finde kandidater i et
 * bibliotek paa hundreder af titler, ikke til at afgoere om to titler ER ens.
 */
function sammenligneligTitel(navn) {
  return String(navn == null ? '' : navn)
    .toLowerCase()
    /*
     * ae og oe skal foldes MANUELT.
     *
     * NFD dekomponerer é til e + accent og aa til a + ring, saa dem klarer
     * linjen nedenfor. Men ae (U+00E6) og oe (U+00F8) er selvstaendige
     * bogstaver UDEN dekomponering - de ville blive kastet vaek af
     * [^a-z0-9], saa "OErkenens SOEnner" blev til "rkenenssnner" og
     * "Fraek" til "frk". Det er ikke forkert paa samme maade i begge ender
     * (baade titel og soegning foldes ens), men det goer det umuligt at
     * finde titlen ved at skrive den UDEN de danske tegn - og det er
     * praecis, hvad man goer paa et fremmed tastatur.
     */
    .replace(/\u00e6/g, 'ae')            // ae -> ae
    .replace(/\u00f8/g, 'o')             // oe -> o  (ikke "oe": "Sonner" skal ogsaa ramme)
    .replace(/\u00df/g, 'ss')            // tysk scharfes s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')     // accenter vaek: é -> e, aa -> a
    .replace(/[^a-z0-9]+/g, '');          // kun bogstaver og tal tilbage
}

/*
 * Hvilke titler passer paa det, der blev skrevet - og i hvilken orden.
 *
 * Ligger HER og ikke i server.js, fordi det er en REGEL. En proeve kan
 * kalde den med rigtige navne og faa et rigtigt svar; ligger reglen inde i
 * en databasefunktion, kan en proeve kun kigge paa kildeteksten - og en
 * proeve, der leder efter et ORD i koden, opdager ikke, at sammenligningen
 * blev lavet om under den (maalt 2026-08-29: en sabotage, der satte raa
 * tekstsammenligning tilbage, blev groen).
 *
 * `emner` er [{ id, name }]. Der returneres de samme objekter, sorteret.
 */
function findTitler(emner, soegning, loft) {
  const noegle = sammenligneligTitel(soegning);
  if (!noegle) return [];

  const traf = [];
  for (const e of (emner || [])) {
    if (sammenligneligTitel(e && e.name).includes(noegle)) traf.push(e);
  }

  /*
   * Den, der BEGYNDER med det, man skrev, staar oeverst: soeger man
   * "Spiderman", er "Spider-Man" mere sandsynlig end "The Amazing
   * Spider-Man". Derefter alfabetisk, saa listen ikke hopper rundt.
   */
  traf.sort((a, b) => {
    const aa = sammenligneligTitel(a.name).startsWith(noegle) ? 0 : 1;
    const bb = sammenligneligTitel(b.name).startsWith(noegle) ? 0 : 1;
    return aa - bb || String(a.name).localeCompare(String(b.name));
  });

  const n = Number(loft);
  return n > 0 ? traf.slice(0, n) : traf;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { visNavn, sammenligneligTitel, findTitler };
}
