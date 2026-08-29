'use strict';
/*
 * TMDB-klienten. Ren node:https - ingen npm-pakker.
 *
 * HELE modulet koerer paa SERVEREN, og noeglen forlader den aldrig. Fladen
 * kalder /api/search, serveren kalder TMDB. Det er ikke kun for at skjule
 * noeglen: gjorde browseren kaldet selv, skulle CSP'en aabnes for
 * api.themoviedb.org, og saa ville hver enkelt husstands browser tale direkte
 * med TMDB om, hvad de kigger paa (RUNE-ERFARINGER §6b).
 *
 * Modulet OVERSAETTER ogsaa. TMDB's felter (`first_air_date`, `poster_path`,
 * `number_of_seasons`) hedder ikke det, spolen hedder dem, og en oversaettelse
 * spredt ud over ruterne bliver til to modeller. Derfor: TMDB-former gaar ind,
 * spolen-former kommer ud, og resten af serveren ser aldrig et TMDB-felt.
 */

const https = require('node:https');

const VAERT = 'api.themoviedb.org';
const BILLED_VAERT = 'image.tmdb.org';

/* Plakatstoerrelsen. w342 er ~25 KB pr. plakat og skarp nok til et gitter -
   w500 er tre gange saa tung uden at kunne ses paa et kort paa 140 px. */
const PLAKAT_BREDDE = 'w342';

class TmdbFejl extends Error {
  constructor(besked, status, kode) {
    super(besked);
    this.status = status;
    this.kode = kode || 'tmdb_error';
  }
}

/*
 * TMDB udleverer to slags noegler, og folk indsaetter den, de finder foerst:
 *
 *   v3: 32 hex-tegn        -> ?api_key=...
 *   v4: et langt JWT       -> Authorization: Bearer ...
 *
 * Begge virker mod /3/-endepunkterne (efterproevet 2026-08-28: begge svarer
 * 401 paa en ugyldig noegle, ikke 410). At kraeve den ene ville betyde, at
 * halvdelen af brugerne faar "ugyldig noegle" paa en noegle, der er gyldig.
 */
function erBearer(noegle) {
  return /^ey[A-Za-z0-9_-]/.test(String(noegle || '').trim());
}

function hent(noegle, sti, params) {
  const q = new URLSearchParams(params || {});
  const bearer = erBearer(noegle);
  if (!bearer) q.set('api_key', String(noegle || '').trim());
  const url = `https://${VAERT}/3${sti}?${q.toString()}`;
  const headers = { accept: 'application/json', 'user-agent': 'spolen' };
  if (bearer) headers.authorization = `Bearer ${String(noegle).trim()}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const bidder = [];
      res.on('data', (b) => bidder.push(b));
      res.on('end', () => {
        const raa = Buffer.concat(bidder).toString('utf8');
        let krop = null;
        try { krop = JSON.parse(raa); } catch { /* ikke-JSON haandteres nedenfor */ }
        if (res.statusCode === 401) {
          reject(new TmdbFejl('The TMDB key was rejected. Check it under Settings.',
            502, 'tmdb_bad_key'));
          return;
        }
        if (res.statusCode === 404) {
          reject(new TmdbFejl('TMDB does not know that title.', 404, 'tmdb_not_found'));
          return;
        }
        if (res.statusCode === 429) {
          // Stop straks frem for at hamre videre (§6b).
          reject(new TmdbFejl('TMDB is rate limiting us. Try again in a moment.',
            503, 'tmdb_rate_limited'));
          return;
        }
        if (res.statusCode !== 200 || !krop) {
          reject(new TmdbFejl(`TMDB answered ${res.statusCode}.`, 502, 'tmdb_error'));
          return;
        }
        resolve(krop);
      });
    });
    req.on('error', (e) => reject(new TmdbFejl(`Could not reach TMDB: ${e.message}`, 502)));
    // Uden timeout kan en haengende forbindelse holde en rute aaben i minutter.
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new TmdbFejl('TMDB did not answer in time.', 504, 'tmdb_timeout'));
    });
  });
}

/** '2026-08-28' -> 2026. Tom streng og null giver null, ikke NaN. */
function aar(dato) {
  const m = /^(\d{4})/.exec(String(dato || ''));
  return m ? Number(m[1]) : null;
}

/*
 * Plakatstien gemmes RAA ('/abc.jpg'), ikke som en faerdig URL.
 *
 * Serveren bygger selv adressen, naar den henter billedet - saa kan
 * plakatstoerrelsen aendres uden at skulle skrive hele cachen om, og der
 * ligger ikke et vaertsnavn gemt i tusindvis af JSON-blobs.
 */
function billedUrl(sti, bredde) {
  if (!sti) return null;
  return `https://${BILLED_VAERT}/t/p/${bredde || PLAKAT_BREDDE}${sti}`;
}

/* ------------------------------------------------------------- soegning */

/**
 * Soeger paa tvaers af film og serier.
 *
 * `search/multi` giver ogsaa PERSONER, og dem filtrerer vi fra: spolen
 * foelger titler, ikke skuespillere. (Filmografi er en senere funktion, og
 * den skal bruge et andet endepunkt.)
 */
async function soeg(noegle, tekst, opts) {
  const o = opts || {};
  const svar = await hent(noegle, '/search/multi', {
    query: String(tekst || '').slice(0, 200),
    include_adult: 'false',
    language: o.sprog || 'en-US',
    page: String(o.side || 1),
  });
  const ud = [];
  for (const r of svar.results || []) {
    if (r.media_type !== 'tv' && r.media_type !== 'movie') continue;
    ud.push({
      kind: r.media_type,
      tmdbId: r.id,
      name: r.media_type === 'tv' ? r.name : r.title,
      originalName: r.media_type === 'tv' ? r.original_name : r.original_title,
      year: aar(r.media_type === 'tv' ? r.first_air_date : r.release_date),
      overview: r.overview || '',
      posterPath: r.poster_path || null,
      // TMDB's egen popularitet bruges KUN til at sortere - den vises aldrig.
      // Et tal uden enhed betyder intet for brugeren.
      popularity: r.popularity || 0,
    });
  }
  ud.sort((a, b) => b.popularity - a.popularity);
  return { results: ud, total: svar.total_results || ud.length };
}

/**
 * Slaar op paa et EKSTERNT id (imdb, tvdb).
 *
 * Det er den eneste EKSAKTE vej. Titel plus aarstal er et gaet: to film kan
 * hedde det samme og udkomme samme aar, og en dansk titel matcher slet ikke
 * den engelske. Har eksporten et tt-id, skal det bruges - alt andet er
 * andenrangs.
 */
async function findVedEksterntId(noegle, kilde, id) {
  const gyldige = { imdb: 'imdb_id', tvdb: 'tvdb_id' };
  if (!gyldige[kilde] || !id) return null;
  const svar = await hent(noegle, `/find/${encodeURIComponent(id)}`, {
    external_source: gyldige[kilde],
  });
  // TMDB svarer med fem lister. Vi vil kun have film og serier - og et
  // AFSNITS-tt-id giver et tv_episode_results, som peger paa serien.
  const film = (svar.movie_results || [])[0];
  if (film) return { kind: 'movie', tmdbId: film.id, name: film.title, year: aar(film.release_date) };
  const serie = (svar.tv_results || [])[0];
  if (serie) return { kind: 'tv', tmdbId: serie.id, name: serie.name, year: aar(serie.first_air_date) };
  const afsnit = (svar.tv_episode_results || [])[0];
  if (afsnit) {
    return {
      kind: 'tv', tmdbId: afsnit.show_id, name: null, year: null,
      // Afsnittets egen placering foelger med - den er mere paalidelig end
      // det, eksporten selv skrev.
      season: afsnit.season_number, number: afsnit.episode_number,
    };
  }
  return null;
}

/* --------------------------------------------------------------- titler */

/**
 * Et OVERBLIK over én titel - til at kigge paa, foer man tilfoejer.
 *
 * ÉT kald. Den maa netop ikke goere det, hentSerie goer: en serie med ti
 * saesoner er elleve kald med pauser imellem, og det skal man ikke betale
 * for at se, om det er den rigtige "Harry Hole".
 *
 * Svaret gemmes IKKE i cachen. Kigger man paa ti titler og tilfoejer én,
 * skal de ni ikke ligge tilbage i metadata-planen - den er for det, huset
 * FOELGER, ikke for det, nogen har kigget paa.
 */
async function hentOverblik(noegle, kind, tmdbId, opts) {
  const o = opts || {};
  const erTv = kind === 'tv';
  const t = await hent(noegle, `/${erTv ? 'tv' : 'movie'}/${Number(tmdbId)}`, {
    language: o.sprog || 'en-US',
    append_to_response: 'credits',
  });
  const medvirkende = ((t.credits && t.credits.cast) || []).slice(0, 6)
    .map((c) => c.name).filter(Boolean);
  const instruktoerer = ((t.credits && t.credits.crew) || [])
    .filter((c) => c.job === 'Director' || c.job === 'Creator')
    .slice(0, 3).map((c) => c.name).filter(Boolean);

  return {
    kind: erTv ? 'tv' : 'movie',
    tmdbId: t.id,
    name: erTv ? t.name : t.title,
    originalName: erTv ? t.original_name : t.original_title,
    year: aar(erTv ? t.first_air_date : t.release_date),
    status: t.status || null,
    overview: t.overview || '',
    tagline: t.tagline || '',
    posterPath: t.poster_path || null,
    genres: (t.genres || []).map((g) => g.name),
    // Tallene er DET, der adskiller to titler med samme navn: en serie paa
    // fem saesoner og en enkeltstaaende film hedder tit det samme.
    seasonCount: erTv ? (t.number_of_seasons || 0) : null,
    episodeCount: erTv ? (t.number_of_episodes || 0) : null,
    runtime: erTv ? ((t.episode_run_time && t.episode_run_time[0]) || null) : (t.runtime || null),
    networks: erTv ? (t.networks || []).map((n) => n.name) : [],
    countries: (t.origin_country || []).slice(0, 3),
    firstAirDate: erTv ? (t.first_air_date || null) : (t.release_date || null),
    lastAirDate: erTv ? (t.last_air_date || null) : null,
    cast: medvirkende,
    directors: instruktoerer,
    // TMDB's egen bedoemmelse. Vises med antal stemmer - et 10-tal fra to
    // personer betyder noget andet end et 7-tal fra ti tusind.
    score: t.vote_average ? Math.round(t.vote_average * 10) / 10 : null,
    votes: t.vote_count || 0,
  };
}

/** Hele serien: stamdata + alle afsnit fra alle saesoner. */
async function hentSerie(noegle, tmdbId, opts) {
  const o = opts || {};
  const sprog = o.sprog || 'en-US';
  const t = await hent(noegle, `/tv/${Number(tmdbId)}`, {
    language: sprog,
    append_to_response: 'external_ids',
  });
  const eks = t.external_ids || {};

  const titel = {
    kind: 'tv',
    tmdbId: t.id,
    imdbId: eks.imdb_id || null,
    tvdbId: eks.tvdb_id || null,
    name: t.name || '',
    year: aar(t.first_air_date),
    status: t.status || null,
    // Bruges af beregn.naesteTjek til at afgoere, hvor tit serien skal ses
    // efter. TMDB har feltet direkte - vi behoever ikke regne det ud.
    naesteUdsendelse: (t.next_episode_to_air && t.next_episode_to_air.air_date) || null,
    data: {
      overview: t.overview || '',
      posterPath: t.poster_path || null,
      backdropPath: t.backdrop_path || null,
      genres: (t.genres || []).map((g) => g.name),
      networks: (t.networks || []).map((n) => n.name),
      seasonCount: t.number_of_seasons || 0,
      episodeCount: t.number_of_episodes || 0,
      // Afsnitslaengden bruges til "jeg har 45 minutter"-filteret senere.
      runtime: (t.episode_run_time && t.episode_run_time[0]) || null,
      originalName: t.original_name || '',
      firstAirDate: t.first_air_date || null,
      lastAirDate: t.last_air_date || null,
    },
  };

  // Saesonerne hentes ÉN ad gangen. TMDB har ikke et "giv mig alle afsnit"-kald,
  // og at hente dem parallelt ville sende ti kald af sted paa én gang for en
  // lang serie. Hoeflighed frem for hastighed (§6c).
  const afsnit = [];
  const saesoner = (t.seasons || [])
    .map((s) => s.season_number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  for (const nr of saesoner) {
    if (o.springSpecialsOver && nr === 0) continue;
    let s;
    try {
      s = await hent(noegle, `/tv/${Number(tmdbId)}/season/${nr}`, { language: sprog });
    } catch (err) {
      // En enkelt saeson, TMDB ikke kan levere, maa ikke vaelte hele
      // tilfoejelsen. Serien er stadig bedre med ni saesoner end med nul.
      if (err.kode === 'tmdb_not_found') continue;
      throw err;
    }
    for (const e of s.episodes || []) {
      afsnit.push({
        season: e.season_number,
        number: e.episode_number,
        name: e.name || null,
        airDate: e.air_date || null,
        runtime: e.runtime || null,
        data: { overview: e.overview || '', stillPath: e.still_path || null },
      });
    }
    if (o.pause) await o.pause();
  }

  return { titel, afsnit };
}

async function hentFilm(noegle, tmdbId, opts) {
  const o = opts || {};
  const f = await hent(noegle, `/movie/${Number(tmdbId)}`, {
    language: o.sprog || 'en-US',
    append_to_response: 'external_ids',
  });
  const eks = f.external_ids || {};
  return {
    titel: {
      kind: 'movie',
      tmdbId: f.id,
      imdbId: f.imdb_id || eks.imdb_id || null,
      tvdbId: null,
      name: f.title || '',
      year: aar(f.release_date),
      status: f.status || null,
      naesteUdsendelse: null,
      data: {
        overview: f.overview || '',
        posterPath: f.poster_path || null,
        backdropPath: f.backdrop_path || null,
        genres: (f.genres || []).map((g) => g.name),
        runtime: f.runtime || null,
        originalName: f.original_title || '',
        releaseDate: f.release_date || null,
      },
    },
    afsnit: [],
  };
}

/** Faelles indgang - kalderen skal ikke kende forskellen. */
function hentTitel(noegle, kind, tmdbId, opts) {
  if (kind === 'movie') return hentFilm(noegle, tmdbId, opts);
  if (kind === 'tv') return hentSerie(noegle, tmdbId, opts);
  throw new TmdbFejl(`unknown kind "${kind}"`, 400, 'bad_kind');
}

/**
 * Alle udbydere, der overhovedet findes i et land.
 *
 * Bruges til "mine tjenester" (S2): man skal kunne krydse af i en liste over
 * det, der FINDES i Danmark, frem for at skrive navne i et felt og haabe, de
 * staver ligesom TMDB.
 */
async function hentUdbydere(noegle, kind, region) {
  const svar = await hent(noegle, `/watch/providers/${kind === 'movie' ? 'movie' : 'tv'}`, {
    watch_region: String(region || 'DK').toUpperCase(),
  });
  return (svar.results || [])
    // display_priority er TMDB's egen rangering pr. land - den saetter de
    // tjenester, folk faktisk har, oeverst i stedet for alfabetisk.
    .sort((a, b) => (a.display_priority || 999) - (b.display_priority || 999))
    .map((p) => ({ id: p.provider_id, name: p.provider_name, logoPath: p.logo_path || null }));
}

/** Hvor kan man streame den (S1). Region er et LANDEKODE-par, fx 'DK'. */
async function hentProviders(noegle, kind, tmdbId, region) {
  const svar = await hent(noegle, `/${kind}/${Number(tmdbId)}/watch/providers`, {});
  const r = (svar.results || {})[String(region || 'DK').toUpperCase()] || {};
  const kort = (liste) => (liste || []).map((p) => ({
    id: p.provider_id, name: p.provider_name, logoPath: p.logo_path || null,
  }));
  return {
    link: r.link || null,
    flatrate: kort(r.flatrate),   // med i abonnementet
    rent: kort(r.rent),
    buy: kort(r.buy),
  };
}

module.exports = {
  TmdbFejl, erBearer, aar, billedUrl, PLAKAT_BREDDE,
  soeg, findVedEksterntId, hentOverblik, hentUdbydere, hentSerie, hentFilm, hentTitel, hentProviders,
};
