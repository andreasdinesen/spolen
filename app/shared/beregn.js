'use strict';
/*
 * spolen - de rene udregninger.
 *
 * ALT hvad der regnes ud, bor her. Ikke i app/parts/ og ikke i ruterne.
 * Grunden er ikke ryddelighed: webappen, MCP-serveren og iCal-feedet skal
 * svare det SAMME paa "hvad er naeste usete afsnit". Ligger regnestykket to
 * steder, er der to sandheder, og den ene af dem er forkert uden at nogen
 * opdager det (tovo/CLAUDE.md).
 *
 * Modulet er med vilje uden afhaengigheder - hverken database, http eller
 * Date.now(). "I dag" gives ind som argument. Det er dét, der goer, at en
 * test kan koere paa en hvilken som helst dag og stadig vaere sand: en proeve,
 * hvis forventning afhaenger af dagen i dag, er roed én ugedag ud af syv
 * (RUNE-ERFARINGER, tovo 2026-08-28).
 */

/*
 * ISO-datoer (YYYY-MM-DD) sammenlignes som TEKST.
 *
 * Det er ikke en genvej men den rigtige maade: formatet er konstruereret til
 * at sortere leksikografisk, og enhver omvej over Date() ville laegge en
 * tidszone ind i et spoergsmaal, der ikke har en. Et afsnit sendes paa en
 * DATO - goer man den til et tidspunkt, flytter den sig en dag for nogen.
 */
function foer(a, b) {
  return String(a) < String(b);
}

function foerEllerLig(a, b) {
  return String(a) <= String(b);
}

/** Antal dage mellem to ISO-datoer. Positivt naar `til` ligger efter `fra`. */
function dageMellem(fra, til) {
  const a = Date.UTC(+fra.slice(0, 4), +fra.slice(5, 7) - 1, +fra.slice(8, 10));
  const b = Date.UTC(+til.slice(0, 4), +til.slice(5, 7) - 1, +til.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** Epoke-sekunder -> ISO-dato i den koerende tidszone. */
function isoDato(sekunder) {
  const d = new Date(sekunder * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/*
 * Sendeorden.
 *
 * Sorteres paa (saeson, nummer) - IKKE paa udsendelsesdato. De to er som
 * regel enige, men naar de ikke er, er det fordi et afsnit blev sendt ude af
 * orden eller fik en dato paasat bagefter, og saa er nummereringen den, seeren
 * foelger. Afsnit UDEN dato skal ogsaa have en plads i raekken; sorterer man
 * paa dato, ryger de ud af den.
 */
function sendeorden(a, b) {
  if (a.season !== b.season) return a.season - b.season;
  return a.number - b.number;
}

/*
 * Specials (saeson 0) er FRA som standard.
 *
 * Grunden er sorteringen: saeson 0 sorterer foerst, saa med dem inde ville
 * "naeste usete afsnit" for en ny serie blive en julespecial fra saeson fem.
 * Den, der vil have dem med, ved hvad han beder om.
 */
function relevante(afsnit, opts) {
  const o = opts || {};
  const medSpecials = o.hideSpecials === false;
  return afsnit
    .filter((e) => medSpecials || e.season !== 0)
    .slice()
    .sort(sendeorden);
}

/**
 * Hjertet: hvad er naeste usete afsnit?
 *
 * Returnerer BAADE `naeste` og `klar`, og forskellen er hele pointen:
 *
 *   naeste = foerste usete i sendeorden, uanset om det er sendt endnu.
 *   klar   = foerste usete der ER sendt - altsaa det, man kan se i aften.
 *
 * Up Next viser `klar`. Nedtaellingen viser `naeste`, naar der ikke er noget
 * klar. Slaar man de to sammen til ét felt, faar man enten en forside, der
 * beder folk se et afsnit, der ikke findes endnu, eller en nedtaelling, der
 * forsvinder, saa snart man er bagud.
 *
 * HULLER i historikken respekteres: har man set afsnit 1 og 3, er naeste
 * afsnit nummer 2 - ikke nummer 4. Det er det, "foerste usete i sendeorden"
 * betyder, og det er med vilje ikke "den hoejeste sete plus én".
 *
 * @param {Array} afsnit  [{id, season, number, airDate}]
 * @param {Set}   sete    afsnits-id'er brugeren har set
 * @param {object} opts   {idag: 'YYYY-MM-DD', hideSpecials: boolean}
 */
function naesteUsete(afsnit, sete, opts) {
  const o = opts || {};
  const idag = o.idag;
  if (!idag) throw new Error('naesteUsete kraever opts.idag - "i dag" gaettes aldrig');
  const raekke = relevante(afsnit || [], o);
  const setDem = sete || new Set();

  let naeste = null;
  let klar = null;
  let seteAntal = 0;
  let useteSendte = 0;

  for (const e of raekke) {
    if (setDem.has(e.id)) { seteAntal++; continue; }
    if (!naeste) naeste = e;
    // Et afsnit uden dato er IKKE sendt. TMDB mangler ofte datoen paa afsnit,
    // der er annonceret men ikke planlagt - de maa ikke dukke op som "klar".
    const sendt = e.airDate ? foerEllerLig(e.airDate, idag) : false;
    if (sendt) {
      useteSendte++;
      if (!klar) klar = e;
    }
  }

  return {
    naeste,
    klar,
    sete: seteAntal,
    useteSendte,
    ialt: raekke.length,
    // Faerdig = intet uset der er sendt, OG intet der venter. En serie, hvor
    // man har set alt hidtil sendt, er ikke faerdig - den er ajour.
    ajour: klar === null,
    faerdig: klar === null && naeste === null,
  };
}

/**
 * Fremdrift som brøk og procent.
 *
 * Naevneren er de SENDTE afsnit, ikke alle. En serie med to sendte afsnit ud
 * af en bestilt saeson paa ti staar 100 % naar man har set begge - for man er
 * lige saa langt fremme, som det er muligt at vaere. Regnede man i alle
 * afsnit, ville en igangvaerende serie aldrig komme over 20 %, og tallet
 * ville maale TMDB's planlaegning i stedet for brugerens seen.
 */
function fremdrift(afsnit, sete, opts) {
  const o = opts || {};
  const idag = o.idag;
  if (!idag) throw new Error('fremdrift kraever opts.idag');
  const raekke = relevante(afsnit || [], o);
  const setDem = sete || new Set();
  let sendte = 0;
  let setteSendte = 0;
  for (const e of raekke) {
    if (!e.airDate || !foerEllerLig(e.airDate, idag)) continue;
    sendte++;
    if (setDem.has(e.id)) setteSendte++;
  }
  return {
    sendte,
    sete: setteSendte,
    ialt: raekke.length,
    procent: sendte === 0 ? 0 : Math.round((setteSendte / sendte) * 100),
  };
}

/**
 * Hvad er status paa en udsendelsesdato?
 *
 * 'ukendt' er en rigtig tilstand og ikke en fejl: TMDB har masser af afsnit
 * uden dato. Fladen skal kunne sige "dato mangler" frem for at gaette.
 */
function udsendelsesstatus(airDate, idag) {
  if (!airDate) return { status: 'ukendt', dage: null };
  if (airDate === idag) return { status: 'idag', dage: 0 };
  if (foer(airDate, idag)) return { status: 'sendt', dage: -dageMellem(airDate, idag) };
  return { status: 'kommer', dage: dageMellem(idag, airDate) };
}

/*
 * Hvornaar skal en titel ses efter igen?
 *
 * Baggrundsjobbet (K7) spoerger databasen "hvad er forfaldent nu", saa svaret
 * skal vaere et TIDSPUNKT, ikke en prioritet. Reglerne:
 *
 *   - Sender inden for en uge  -> dagligt. Datoer flytter sig i sidste oejeblik.
 *   - Loebende serie ellers    -> ugentligt. En ny saeson annonceres ikke i dag.
 *   - Under produktion/planlagt-> ugentligt.
 *   - Afsluttet serie          -> hver 90. dag. Metadata rettes stadig, sjaeldent.
 *   - Udgivet film            -> hver 30. dag. Selve filmen aendrer sig ikke,
 *                                 men den flytter mellem streamingtjenester,
 *                                 og DET er grunden til at se efter (S3).
 *
 * Returnerer epoke-sekunder, eller null for "aldrig igen" (findes ikke i dag,
 * men kolonnen tillader det, saa en fremtidig regel kan bruge den).
 */
function naesteTjek(status, naesteUdsendelse, nu) {
  const DAG = 86400;
  const s = String(status || '');
  if (naesteUdsendelse) {
    const dage = dageMellem(isoDato(nu), naesteUdsendelse);
    if (dage >= 0 && dage <= 7) return nu + DAG;
  }
  if (s === 'Returning Series' || s === 'In Production' || s === 'Planned') return nu + 7 * DAG;
  if (s === 'Ended' || s === 'Canceled') return nu + 90 * DAG;
  return nu + 30 * DAG;
}

module.exports = {
  foer, foerEllerLig, dageMellem, isoDato, sendeorden, relevante,
  naesteUsete, fremdrift, udsendelsesstatus, naesteTjek,
};
