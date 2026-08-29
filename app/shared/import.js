'use strict';
/*
 * spolen - import af brugerens egen historik.
 *
 * HELE dette modul er RENT: ingen database, intet net, ingen Date.now().
 * Det er ikke ryddelighed men en betingelse for at kunne proeve det. En
 * importoer, der kun kan afproeves ved at koere en rigtig fil gennem en
 * rigtig server, bliver ikke proevet - og en importoer, der taber raekker
 * TAVST, er den vaerste slags fejl: man opdager det foerst maaneder senere,
 * naar man undrer sig over et hul i historikken.
 *
 * Formen ind: en tekstfil. Formen ud: NORMALISEREDE raekker, som resten af
 * appen kan behandle ens, uanset om de kom fra Trakt eller Netflix:
 *
 *   { type: 'movie' | 'episode' | 'show',
 *     title, year, ids: {imdb, tmdb, tvdb},
 *     season, number, watchedAt, rating, list, kilde }
 *
 * `watchedAt` er epoke-SEKUNDER eller null. Null betyder "set, men vi ved
 * ikke hvornaar" - det er en rigtig tilstand: Letterboxds watched.csv har
 * ingen dato, og en historik uden datoer er stadig en historik.
 */

/* ------------------------------------------------------------------ csv */

/**
 * En rigtig CSV-laeser - ikke split(',').
 *
 * Felter kan indeholde komma, linjeskift og anfoerselstegn (fordoblet inde i
 * et citeret felt). En naiv split oedelaegger hver eneste filmtitel med et
 * komma i, og det opdager man ikke, for resultatet ser ud som en raekke.
 */
function parseCsv(tekst) {
  const raekker = [];
  let felt = '';
  let raekke = [];
  let iCitat = false;
  // BOM fjernes: Excel skriver den, og ellers hedder den foerste kolonne
  // "﻿Title" og matcher ingen header-genkendelse.
  const s = String(tekst || '').replace(/^﻿/, '');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (iCitat) {
      if (c === '"') {
        if (s[i + 1] === '"') { felt += '"'; i++; }   // fordoblet = et rigtigt "
        else iCitat = false;
      } else felt += c;
      continue;
    }
    if (c === '"') { iCitat = true; continue; }
    if (c === ',') { raekke.push(felt); felt = ''; continue; }
    if (c === '\r') continue;                          // CRLF -> LF
    if (c === '\n') { raekke.push(felt); raekker.push(raekke); raekke = []; felt = ''; continue; }
    felt += c;
  }
  if (felt !== '' || raekke.length) { raekke.push(felt); raekker.push(raekke); }
  // Helt tomme linjer smides vaek - de er filens afslutning, ikke data.
  return raekker.filter((r) => r.length > 1 || (r[0] || '').trim() !== '');
}

/** Header -> indeks, med smaa bogstaver og uden mellemrum, saa opslag er robuste. */
function headerKort(header) {
  const kort = {};
  header.forEach((h, i) => { kort[String(h || '').trim().toLowerCase()] = i; });
  return kort;
}

function felt(raekke, kort, ...navne) {
  for (const n of navne) {
    const i = kort[n];
    if (i !== undefined && raekke[i] !== undefined && raekke[i] !== '') return String(raekke[i]).trim();
  }
  return '';
}

/* ---------------------------------------------------------------- datoer */

/**
 * Dato -> epoke-sekunder. Tolererer de former, eksporterne faktisk bruger.
 *
 * Ukendt eller tom giver null, ALDRIG NaN og aldrig "i dag". At gaette
 * dagens dato paa en manglende dato ville fylde historikken med opdigtede
 * tidspunkter, som ingen bagefter kan skelne fra de rigtige.
 */
function tolkDato(raa, orden) {
  const s = String(raa || '').trim();
  if (!s) return null;
  // ISO med tid: 2026-08-29T20:15:00Z / 2026-08-29 20:15:00
  let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000);
  // Ren ISO-dato: 2026-08-29 -> MIDDAG UTC, ikke midnat. Midnat kan tippe til
  // dagen foer i vestlige tidszoner, naar det senere vises som en lokal dato.
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], 12) / 1000);
  // Skraastregs-datoer: 03/02/2022 og 8/29/26
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    let a = +m[1]; let b = +m[2]; let aar = +m[3];
    if (aar < 100) aar += aar < 70 ? 2000 : 1900;
    /*
     * Raekkefoelgen afgoeres af HELE filen (se gaetDatoformat), ikke af den
     * enkelte raekke.
     *
     * 03/02/2022 er tvetydig i sig selv: 3. februar eller 2. marts. Gaetter
     * man pr. raekke, faar man begge dele i samme historik - og en forkert
     * dato i en seerhistorik opdager man aldrig. Derfor besluttes det ét
     * sted, ud fra de raekker i filen, der IKKE er tvetydige.
     */
    let dag; let maaned;
    if (orden === 'mdy') { maaned = a; dag = b; }
    else if (orden === 'dmy') { dag = a; maaned = b; }
    else { [dag, maaned] = a > 12 ? [a, b] : [b, a]; }   // uden besked: den gamle regel
    if (maaned >= 1 && maaned <= 12 && dag >= 1 && dag <= 31) {
      return Math.floor(Date.UTC(aar, maaned - 1, dag, 12) / 1000);
    }
  }
  return null;
}

/**
 * Hvilken vej laeses skraastregs-datoerne i DENNE fil?
 *
 * Kun de raekker, der ER entydige, tæller: et foerste tal over 12 kan kun
 * vaere en dag, et andet tal over 12 kan kun vaere en dag paa andenpladsen.
 * Er hele filen tvetydig (alle tal under 13), er der ikke noget at udlede -
 * og saa skal brugeren spoerges frem for at faa et gaet.
 *
 * @returns {'dmy'|'mdy'|'blandet'|'ukendt'}
 */
function gaetDatoformat(raaDatoer) {
  let dagFoerst = 0;
  let maanedFoerst = 0;
  for (const raa of raaDatoer) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(raa || '').trim());
    if (!m) continue;
    const a = +m[1]; const b = +m[2];
    if (a > 12 && b <= 12) dagFoerst++;
    else if (b > 12 && a <= 12) maanedFoerst++;
  }
  // 'blandet' betyder, at filen modsiger sig selv - fx to eksporter klistret
  // sammen. Det er en rigtig tilstand og skal siges hoejt, ikke afrundes.
  if (dagFoerst && maanedFoerst) return 'blandet';
  if (dagFoerst) return 'dmy';
  if (maanedFoerst) return 'mdy';
  return 'ukendt';
}

function tolkAar(raa) {
  const m = /(\d{4})/.exec(String(raa || ''));
  const n = m ? +m[1] : null;
  // 1870 er foer filmen blev opfundet; alt derunder er et fejllaest felt.
  return n && n >= 1870 && n <= 2100 ? n : null;
}

function tolkTal(raa) {
  const n = parseInt(String(raa || '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/* --------------------------------------------------------------- netflix */

/*
 * Netflix' titelstreng er ét felt, og alt ligger i den:
 *
 *   "Severance: Season 1: Good News About Hell"
 *   "The Crown: Sæson 2: Misadventure"        (dansk profil)
 *   "Show: Limited Series: Episode 3"
 *   "The Irishman"                            (film - ingen inddeling)
 *
 * Der er ingen kolonne, der siger, om raekken er en film eller et afsnit.
 * Formen ER oplysningen, og derfor bor tolkningen her, hvor den kan proeves.
 */
const SAESON_ORD = /^(?:season|s[æa]son|series|serie|part|del|volume|bind|chapter|book|collection|limited series)\b\s*(\d+)?/i;

function tolkNetflixTitel(raa) {
  const dele = String(raa || '').split(':').map((d) => d.trim()).filter((d) => d !== '');
  if (dele.length <= 1) return { type: 'movie', title: dele[0] || '', season: null, number: null };

  // Led efter den del, der ligner en saesonangivelse.
  for (let i = 1; i < dele.length; i++) {
    const m = SAESON_ORD.exec(dele[i]);
    if (!m) continue;
    return {
      type: 'episode',
      // Alt FOER saesondelen er seriens navn - en serie kan selv hedde
      // noget med kolon i ("Alias: Sektion 1").
      title: dele.slice(0, i).join(': '),
      // "Limited Series" har intet nummer - saa er det saeson 1.
      season: m[1] ? +m[1] : 1,
      number: null,
      episodeName: dele.slice(i + 1).join(': ') || null,
    };
  }
  /*
   * To dele uden saesonord: "Serie: Afsnitsnavn". Almindeligt for
   * antologier og for danske titler. Vi kalder det et AFSNIT uden
   * saesonnummer - matchningen kan saa slaa afsnitsnavnet op. Kalder man
   * det en film, forsvinder det ud af serieregnskabet.
   */
  return {
    type: 'episode',
    title: dele[0],
    season: null,
    number: null,
    episodeName: dele.slice(1).join(': '),
  };
}

/* --------------------------------------------------------- trakt (json) */

/*
 * Trakts DATAEKSPORT er JSON, ikke CSV - og den har samme form som deres API.
 *
 * Det er heldigt og ikke tilfaeldigt: eksporten er dumpet af de samme
 * endepunkter. Derfor bor oversaettelsen HER og bruges af baade filimporten
 * og API-broen (app/trakt.js kalder ind hertil). Der maa ikke findes to
 * laesninger af den samme form - saa opfoerer de to veje sig forskelligt paa
 * de svaere poster.
 *
 * Eksporten er delt over MANGE filer: watched-history-1..17.json for en
 * historik paa nogle tusinde poster. De skal laeses SAMLET, ikke som
 * "den stoerste fil" (Andreas' eksport, 2026-08-29).
 */
function traktPost(p) {
  if (!p || typeof p !== 'object') return null;
  const tid = (v) => {
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  };
  const ids = (o) => {
    const i = (o && o.ids) || {};
    return {
      imdb: typeof i.imdb === 'string' ? i.imdb : null,
      // Trakt pakker plex-id'et som et OBJEKT ({guid, slug}), ikke et tal.
      // Et naivt Number() paa det ville give NaN og forgifte matchningen.
      tmdb: Number.isInteger(i.tmdb) ? i.tmdb : null,
      tvdb: Number.isInteger(i.tvdb) ? i.tvdb : null,
    };
  };

  /*
   * ER DET EN VISNING ELLER BARE NOGET, MAN EJER?
   *
   * Den vigtigste skelnen i hele eksporten. Trakts collection-filer har
   * `collected_at` - det betyder "jeg HAR den", ikke "jeg har SET den". I
   * Andreas' eksport var det 17 filer med ~4.250 afsnit, og uden det her
   * flag ville de alle blive til visninger dateret paa udsendelsesdagen.
   * Historikken ville blive fyldt med afsnit, han maaske aldrig har set -
   * og det ville se ud som en vellykket import.
   *
   * `last_watched_at` fra watched-movies/shows ER derimod en visning: den
   * er samlet pr. titel i stedet for pr. afspilning, men den siger, at
   * titlen er set.
   */
  const naar = tid(p.watched_at) || tid(p.last_watched_at);
  const erVisning = !!naar;

  if (p.episode && p.show) {
    return {
      type: 'episode',
      title: p.show.title || '',
      year: Number.isInteger(p.show.year) ? p.show.year : null,
      ids: ids(p.show),
      season: Number.isInteger(p.episode.season) ? p.episode.season : null,
      number: Number.isInteger(p.episode.number) ? p.episode.number : null,
      watchedAt: naar,
      erVisning,
      rating: Number.isInteger(p.rating) ? p.rating : null,
      kilde: 'trakt',
    };
  }
  if (p.movie) {
    return {
      type: 'movie',
      title: p.movie.title || '',
      year: Number.isInteger(p.movie.year) ? p.movie.year : null,
      ids: ids(p.movie),
      season: null, number: null,
      watchedAt: naar,
      erVisning,
      rating: Number.isInteger(p.rating) ? p.rating : null,
      kilde: 'trakt',
    };
  }
  /*
   * En SHOW-post uden afsnit er en foelgning (watchlist, ratings paa serien),
   * ikke en visning.
   */
  if (p.show) {
    return {
      type: 'show',
      title: p.show.title || '',
      year: Number.isInteger(p.show.year) ? p.show.year : null,
      ids: ids(p.show),
      season: null, number: null,
      watchedAt: naar,
      erVisning: false,
      rating: Number.isInteger(p.rating) ? p.rating : null,
      kilde: 'trakt',
    };
  }
  return null;
}

/** Genkender en Trakt-JSON-fil paa dens FORM, ikke paa filnavnet. */
function erTraktJson(data) {
  if (!Array.isArray(data) || !data.length) return false;
  return data.slice(0, 5).some((p) => p && typeof p === 'object'
    && (p.movie || p.show || p.episode));
}

/**
 * Laeser ÉN JSON-fil fra en Trakt-eksport.
 *
 * `watched_at` mangler i watchlist- og ratings-filer, og det er rigtigt:
 * de er ikke visninger. Importmotoren laver kun en visning, naar der ER en
 * dato, saa de bliver til foelgninger og bedoemmelser i stedet.
 */
function laesTraktJson(tekst) {
  let data;
  try { data = JSON.parse(tekst); } catch { return null; }
  if (!erTraktJson(data)) return null;
  const raekker = [];
  const sprunget = [];
  data.forEach((p, i) => {
    const r = traktPost(p);
    if (r && r.title) raekker.push(r);
    else sprunget.push({ linje: i + 1, grund: 'no title' });
  });
  return { raekker, sprunget };
}

/* -------------------------------------------------------------- formater */

/*
 * Genkendelsen sker paa HEADERNE, ikke paa filnavnet.
 *
 * Filnavne bliver omdoebt, og en "export.csv" siger intet. Headerne er
 * derimod formatets fingeraftryk - og de er stabile, fordi de er en del af
 * eksportens kontrakt med sine egne brugere.
 */
const FORMATER = [
  {
    id: 'letterboxd-diary',
    navn: 'Letterboxd (diary)',
    datoFelter: ['watched date', 'date'],
    genkend: (k) => 'letterboxd uri' in k && ('watched date' in k || 'date' in k) && 'name' in k,
    laes: (r, k, orden) => ({
      type: 'movie',
      title: felt(r, k, 'name'),
      year: tolkAar(felt(r, k, 'year')),
      watchedAt: tolkDato(felt(r, k, 'watched date', 'date'), orden),
      // Letterboxd bedoemmer i halve stjerner 0,5-5. Ganget med to bliver
      // det 1-10 uden at tabe halvstjernerne.
      rating: (() => { const n = parseFloat(felt(r, k, 'rating')); return Number.isFinite(n) ? Math.round(n * 2) : null; })(),
    }),
  },
  {
    id: 'letterboxd-watched',
    navn: 'Letterboxd (watched)',
    datoFelter: ['date'],
    genkend: (k) => 'letterboxd uri' in k && 'name' in k,
    laes: (r, k, orden) => ({
      type: 'movie',
      title: felt(r, k, 'name'),
      year: tolkAar(felt(r, k, 'year')),
      watchedAt: tolkDato(felt(r, k, 'date'), orden),
      rating: null,
    }),
  },
  {
    id: 'imdb',
    navn: 'IMDb',
    datoFelter: ['date rated', 'created', 'modified'],
    genkend: (k) => 'const' in k && 'title' in k,
    laes: (r, k, orden) => {
      const slags = felt(r, k, 'title type').toLowerCase();
      return {
        // IMDb's "tvEpisode" har sit eget tt-id, som TMDB kan slaa op.
        type: slags.includes('episode') ? 'episode' : (slags.includes('series') ? 'show' : 'movie'),
        title: felt(r, k, 'title', 'original title'),
        year: tolkAar(felt(r, k, 'year', 'release date')),
        ids: { imdb: felt(r, k, 'const') || null },
        watchedAt: tolkDato(felt(r, k, 'date rated', 'created', 'modified'), orden),
        rating: tolkTal(felt(r, k, 'your rating')),
      };
    },
  },
  {
    id: 'netflix',
    navn: 'Netflix viewing activity',
    datoFelter: ['date'],
    // Netflix' fil har PRAECIS to kolonner og ingen id'er - derfor er den
    // ogsaa den svaereste at matche.
    genkend: (k) => 'title' in k && 'date' in k && Object.keys(k).length <= 3,
    laes: (r, k, orden) => {
      const t = tolkNetflixTitel(felt(r, k, 'title'));
      return {
        type: t.type,
        title: t.title,
        year: null,
        season: t.season,
        number: t.number,
        episodeName: t.episodeName || null,
        watchedAt: tolkDato(felt(r, k, 'date'), orden),
        rating: null,
      };
    },
  },
  {
    id: 'trakt',
    navn: 'Trakt (CSV)',
    datoFelter: ['watched_at', 'watched at', 'listed_at'],
    genkend: (k) => ('watched_at' in k || 'watched at' in k || 'listed_at' in k)
      && ('title' in k || 'show_title' in k),
    laes: (r, k, orden) => {
      const saeson = tolkTal(felt(r, k, 'season', 'season_number'));
      const nummer = tolkTal(felt(r, k, 'episode', 'episode_number', 'number'));
      const slags = felt(r, k, 'type').toLowerCase();
      return {
        type: slags.includes('episode') || (saeson !== null && nummer !== null)
          ? 'episode' : (slags.includes('show') ? 'show' : 'movie'),
        title: felt(r, k, 'show_title', 'title'),
        year: tolkAar(felt(r, k, 'year')),
        ids: {
          imdb: felt(r, k, 'imdb_id', 'imdb') || null,
          tmdb: tolkTal(felt(r, k, 'tmdb_id', 'tmdb')),
          tvdb: tolkTal(felt(r, k, 'tvdb_id', 'tvdb')),
        },
        season: saeson,
        number: nummer,
        watchedAt: tolkDato(felt(r, k, 'watched_at', 'watched at', 'listed_at'), orden),
        rating: tolkTal(felt(r, k, 'rating')),
      };
    },
  },
  {
    id: 'tvtime',
    navn: 'TV Time',
    datoFelter: ['watched_at', 'created_at', 'updated_at'],
    genkend: (k) => ('episode_id' in k || 'episode_number' in k)
      && ('series_name' in k || 'show_name' in k || 'tvdb_id' in k),
    laes: (r, k, orden) => ({
      type: 'episode',
      title: felt(r, k, 'series_name', 'show_name'),
      year: null,
      ids: { tvdb: tolkTal(felt(r, k, 'tvdb_id', 'series_id')) },
      season: tolkTal(felt(r, k, 'season_number', 'season')),
      number: tolkTal(felt(r, k, 'episode_number', 'episode')),
      watchedAt: tolkDato(felt(r, k, 'watched_at', 'created_at', 'updated_at'), orden),
      rating: null,
    }),
  },
];

/** Hvilket format ER det her? Null hvis ingen genkender headerne. */
function detekter(header) {
  const k = headerKort(header);
  for (const f of FORMATER) {
    try { if (f.genkend(k)) return f; } catch { /* et format der kaster, matcher ikke */ }
  }
  return null;
}

/**
 * Fil -> normaliserede raekker.
 *
 * Returnerer OGSAA de raekker, der ikke kunne laeses, og hvorfor. En import,
 * der tavst springer over, er den fejl, man opdager maaneder senere.
 */
function laesFil(tekst, valg) {
  const o = valg || {};

  // JSON foerst: Trakts dataeksport er JSON, og en JSON-fil vil aldrig
  // kunne laeses fornuftigt som CSV - den ville blive til én lang raekke.
  const t = String(tekst || '').trimStart();
  if (t.startsWith('[') || t.startsWith('{')) {
    const j = laesTraktJson(tekst);
    if (j) {
      return {
        format: 'trakt-json', formatNavn: 'Trakt (export)',
        raekker: j.raekker, sprunget: j.sprunget, fejl: null,
        dateOrder: 'iso', dateOrderGaettet: 'iso', dateOrderSikker: true,
      };
    }
    return { format: null, raekker: [], sprunget: [],
      fejl: 'That JSON file is not a Trakt export spolen recognises.' };
  }

  const tabel = parseCsv(tekst);
  if (tabel.length < 2) {
    return { format: null, raekker: [], sprunget: [], fejl: 'The file has no rows.' };
  }
  const format = detekter(tabel[0]);
  if (!format) {
    return {
      format: null, raekker: [], sprunget: [],
      fejl: `Unknown format. The columns were: ${tabel[0].slice(0, 8).join(', ')}`,
    };
  }
  const k = headerKort(tabel[0]);

  /*
   * FOERSTE GENNEMLOEB: hvilken vej laeses datoerne i denne fil?
   *
   * Kun de erklaerede datokolonner spoerges - ellers kunne en titel som
   * "9/11" forgifte gaettet. Beslutningen tages ÉN gang og gaelder hele
   * filen, saa den samme historik ikke faar begge tolkninger.
   */
  const raaDatoer = [];
  for (let i = 1; i < tabel.length; i++) {
    const v = felt(tabel[i], k, ...(format.datoFelter || []));
    if (v) raaDatoer.push(v);
  }
  const gaettet = gaetDatoformat(raaDatoer);
  // Brugeren kan overstyre. Er filen tvetydig hele vejen, er der intet at
  // udlede, og saa er en oplyst standard bedre end et tavst gaet.
  const orden = o.dateOrder || (gaettet === 'ukendt' || gaettet === 'blandet' ? 'dmy' : gaettet);

  const raekker = [];
  const sprunget = [];
  for (let i = 1; i < tabel.length; i++) {
    let r;
    try {
      r = format.laes(tabel[i], k, orden);
    } catch (e) {
      sprunget.push({ linje: i + 1, grund: e.message });
      continue;
    }
    if (!r || !r.title) { sprunget.push({ linje: i + 1, grund: 'no title' }); continue; }
    r.ids = r.ids || {};
    r.season = r.season === undefined ? null : r.season;
    r.number = r.number === undefined ? null : r.number;
    r.kilde = format.id;
    raekker.push(r);
  }
  return {
    format: format.id, formatNavn: format.navn, raekker, sprunget, fejl: null,
    // Rapporteres, saa fladen kan sige "datoer laest som dag/maaned" og lade
    // brugeren rette det. Et gaet, ingen faar at vide, er det farlige.
    dateOrder: orden,
    dateOrderGaettet: gaettet,
    dateOrderSikker: gaettet === 'dmy' || gaettet === 'mdy',
  };
}

module.exports = {
  parseCsv, headerKort, felt, tolkDato, tolkAar, tolkTal,
  tolkNetflixTitel, detekter, laesFil, gaetDatoformat, FORMATER,
  traktPost, erTraktJson, laesTraktJson,
};
