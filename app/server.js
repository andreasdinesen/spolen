'use strict';
/*
 * spolen - privat film- og serietracker.
 *
 * Ren Node: node:http + node:sqlite + node:crypto. Ingen npm-pakker, ingen CDN.
 * Det er ikke sparsommelighed, men sikkerhedsvalget: uden afhaengigheder findes
 * der ingen transitiv forsyningskaede at holde patchet (RUNE-ERFARINGER §1).
 *
 * spolen er FLERBRUGER som tovo, ikke én-bruger som doda: en husstand deler
 * installationen, men ikke sin historik. Auth-stakken og dataadgangen er
 * derfor tovos, ikke dodas - doda henter brugeren med "FROM users LIMIT 1".
 *
 * DE TRE DATAPLANER (se PLAN.md). Det er husets vigtigste beslutning:
 *
 *   1. METADATA (titles, episodes, providers) er INSTALLATIONENS og har
 *      derfor INGEN user_id. To husstandsmedlemmer, der foelger samme serie,
 *      skal ikke hente den fra TMDB to gange.
 *   2. WATCHES har sin EGEN tabel - ikke items. En Trakt-import er tusindvis
 *      af raekker, og tabellen laeses paa hver eneste sideindlaesning.
 *   3. ITEMS er det personlige: tracking, rating, note, list, listItem.
 *
 * Grænsen mellem 1 og 3 er hele pointen: metadata er installationens,
 * HOLDNINGEN er brugerens.
 */

// Tidszonen SKAL saettes foer den foerste Date bruges - ellers regner
// containeren i UTC, og "i dag" bliver forkert nogle timer i doegnet.
process.env.TZ = process.env.TZ || 'Europe/Copenhagen';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const totp = require('./totp.js');
const qr = require('./qr.js');

// Delte udregninger. Webappen, MCP og iCal skal give SAMME svar paa
// "hvad er naeste usete afsnit" - derfor bor regnestykket ét sted.
const beregn = require('./shared/beregn.js');
const tmdb = require('./tmdb.js');
const importer = require('./shared/import.js');
const statistik = require('./shared/statistik.js');
// Samme navneregel som fladen - shared/navn.js laegges ogsaa ind i app.js
// af build_rune.py, saa der findes ÉN definition (2026-08-29).
const { visNavn } = require('./shared/navn.js');
const trakt = require('./trakt.js');
const plex = require('./plex.js');
const mcpModul = require('./mcp.js');
const pushModul = require('./push.js');

const DATA_DIR = process.env.DATA_DIR || process.cwd();

// KUN BIND_PORT - aldrig PORT_web eller SPOLEN_PORT.
//
// Panelet injicerer PORT_<navn> med den HOST-port, det har allokeret - ikke
// container-porten. Container-siden er den konstant, runen selv erklaerer i
// ports.default (3000). Binder appen sig til host-porten inde i containeren,
// peger panelets mapping paa 3000, hvor der ikke lytter noget, og INTET
// fejler hoejlydt: installationen lykkes, done_regex matcher, og siden er
// bare doed (doda v3).
const BIND_PORT = Number(process.env.BIND_PORT || 3000);
const APP_NAME = process.env.APP_NAME || 'spolen';

// Under udvikling staar APP_VERSION stille (den bumpes foerst ved udgivelse),
// men de statiske filer serveres "immutable" - saa koerer browseren glad den
// gamle app.js videre, og man fejlsoeger kode, der ikke er indlaest (doda F1).
const DEV = process.env.SPOLEN_DEV === '1';

const PUBLIC_DIR = path.join(__dirname, 'public');

/*
 * Plakaterne caches paa disk i /data.
 *
 * De hoerer til metadata-planen: hentes ÉN gang for hele husstanden, og er
 * ren cache - kan altid hentes igen fra TMDB. Derfor er de UDE af backuppen
 * (se runens backup.include) og MED i wipe. En backup, der slaeber tusindvis
 * af plakater med, er stor uden at indeholde noget, man ikke kan skaffe igen.
 */
const PLAKAT_DIR = path.join(DATA_DIR, 'posters');
const SESSION_COOKIE = 'spolen_session';
const SESSION_DAYS = 90;

/*
 * Hemmeligheder returneres ALDRIG til frontenden - kun et "…Set: true"-flag
 * (RUNE-ERFARINGER §6b). Serveren proxier hvert kald mod TMDB, Trakt og Plex.
 * Listen staar her, hvor `hentSettings` kan naa den, og den skal vokse, hver
 * gang en ny integration faar en noegle.
 */
const HEMMELIGE_SETTINGS = new Set([
  'tmdb_key',
  'trakt_client_id',
  'trakt_client_secret',
  'trakt_access_token',
  'trakt_refresh_token',
  'plex_token',
  'totp_secret',
  'totp_last',
]);

/*
 * Hvad en bruger selv maa saette, og hvad kun admin maa.
 *
 * To hvidlister frem for én med et flag: spoergsmaalet "maa DEN HER bruger
 * skrive den her noegle" skal kunne besvares uden at laese en betingelse.
 * Og en noegle, der ikke staar paa nogen af listerne, kan ikke skrives af
 * nogen - heller ikke ved et uheld fra en import.
 */
const PERSONLIGE_SETTINGS = new Set([
  'region',            // 'DK' - hvilket lands streamingudbud der vises (S1)
  'language',          // 'en-US' / 'da-DK' - sproget, TMDB svarer paa
  'services',          // JSON-array af udbyder-id'er brugeren abonnerer paa (S2)
  'theme',
  'notify_new',          // '1'/'0' - besked om nye afsnit
  'plex_url',
  'plex_token',        // hemmelig - personlig, fordi hver bruger har sin egen konto
  'trakt_access_token',
  'trakt_refresh_token',
  'plex_konto_token',    // hemmelig - kontoens token til plex.tv-opdagelsen
  'plex_server_id',      // hvilken af de tilgaengelige servere der er valgt
  'plex_webhook_token',  // saettes server-side, aldrig af klienten
  'plex_account_navn',   // Plex' webhook sender navn, ikke id
  'plex_last_sync',      // epoke for sidste hentede viewedAt
  'plex_account_id',     // hvilken Plex-konto der er BRUGERENS
]);

const INSTALLATION_SETTINGS = new Set([
  'allow_registration',
  /*
   * Sproget for det, der SKRIVES i metadata-cachen.
   *
   * Det kan ikke vaere personligt: cachen har ÉN raekke pr. titel, saa to
   * brugere kan ikke faa hver sin oversaettelse af den. Den personlige
   * `language` gaelder derfor kun SOEGNINGEN, hvis resultater ikke caches.
   * Alternativet - en raekke pr. sprog - ville tredoble cachen for at loese
   * et problem, ingen husstand har.
   */
  'metadata_language',
  'tmdb_key',            // hemmelig - ÉN noegle for hele huset
  'trakt_client_id',     // hemmelig
  'trakt_client_secret', // hemmelig
]);

/* ---------------------------------------------------------------- database */

const db = new DatabaseSync(path.join(DATA_DIR, 'spolen.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

/*
 * Skema-trin. Tilfoej ALDRIG til et eksisterende trin efter udgivelse - laeg
 * en ny funktion i enden af listen i stedet (doda: migrationsliste styret af
 * PRAGMA user_version fra dag ét, saa der aldrig skal danses ALTER i haanden).
 */
const MIGRATIONS = [
  function m1(d) {
    // Auth-laget. Kopieret ordret fra tovo - det er den gennemproevede stak,
    // og en app, der opfinder sin egen, opfinder ogsaa dens huller.
    d.exec(`
      CREATE TABLE users (
        id         TEXT PRIMARY KEY,
        username   TEXT NOT NULL UNIQUE,
        password   TEXT NOT NULL,
        -- Foerste registrerede bruger er admin. Admin driver APPEN (adgang,
        -- registrering, noegler, sikkerhedslog) og ser ALDRIG andres historik.
        is_admin   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX ix_sessions_udloeb ON sessions(expires_at);

      -- scope = brugerens id, eller '*' for de faa indstillinger, der hoerer
      -- til installationen. TMDB-noeglen er '*' (én konto for hele huset),
      -- Plex-tokenet og "mine tjenester" er personlige.
      CREATE TABLE settings (
        scope TEXT NOT NULL,
        key   TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (scope, key)
      );

      -- Rate-limit hoerer til i databasen, ikke i memory: panelets
      -- auto-opdatering genstarter containeren kl. 04 (doda).
      CREATE TABLE rate (
        bucket   TEXT PRIMARY KEY,
        count    INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      );

      CREATE TABLE audit (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at      INTEGER NOT NULL,
        event   TEXT NOT NULL,
        subject TEXT,
        detail  TEXT
      );
      CREATE INDEX ix_audit_tid ON audit(at DESC);

      CREATE TABLE credentials (
        id         TEXT PRIMARY KEY,          -- credentialId, base64url
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL DEFAULT '',
        public_key TEXT NOT NULL,             -- SPKI PEM
        alg        TEXT NOT NULL,
        sign_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
      CREATE INDEX ix_credentials_bruger ON credentials(user_id);

      -- Kun hashen gemmes. OAuth-access-tokens (F6) laegges i SAMME tabel med
      -- client_id + expires_at, saa der er ét sted at validere, ét sted at
      -- tilbagekalde og ét sted at rate-limite (§9a).
      CREATE TABLE tokens (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        hash       TEXT NOT NULL UNIQUE,
        prefix     TEXT NOT NULL,
        scope      TEXT NOT NULL DEFAULT 'full',
        client_id  TEXT,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX ix_tokens_hash ON tokens(hash) WHERE revoked_at IS NULL;

      CREATE TABLE recovery_codes (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hash       TEXT NOT NULL,
        used_at    INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX ix_recovery_bruger ON recovery_codes(user_id) WHERE used_at IS NULL;
    `);
  },

  function m2(d) {
    /*
     * PLAN 1: metadata-cachen. INGEN user_id - med vilje.
     *
     * `id` er en LAESBAR sammensat noegle ('tv:1396', 'movie:603') og ikke et
     * tilfaeldigt id. Det er ikke kosmetik: importen, Plex-matchningen og
     * MCP-laget skal alle kunne DANNE noeglen ud af et TMDB-id uden at slaa
     * op foerst. Et surrogat-id ville kraeve en ekstra rundtur hvert sted.
     *
     * `data` er hele TMDB-svaret renset ned til det, vi bruger. Det ligger som
     * JSON, fordi TMDB tilfoejer felter loebende, og et skema, der skal aendres
     * hver gang de goer, er et skema, der ikke bliver opdateret.
     *
     * `next_check_at` styrer baggrundsjobbet (K7): en serie der sender i
     * morgen tjekkes dagligt, en afsluttet serie sjaeldent. At lade jobbet
     * SPOERGE tabellen frem for at regne en liste ud i memory betyder, at et
     * genstartet job tager fat praecis hvor det slap.
     */
    d.exec(`
      CREATE TABLE titles (
        id         TEXT PRIMARY KEY,      -- 'tv:1396' | 'movie:603'
        kind       TEXT NOT NULL,         -- 'tv' | 'movie'
        tmdb_id    INTEGER NOT NULL,
        imdb_id    TEXT,
        tvdb_id    INTEGER,
        name       TEXT NOT NULL,         -- til soegning og sortering
        year       INTEGER,
        status     TEXT,                  -- 'Returning Series' | 'Ended' | 'Released' ...
        data       TEXT NOT NULL,         -- JSON: plakat, resume, genrer, cast, runtime
        fetched_at INTEGER NOT NULL,
        next_check_at INTEGER              -- NULL = tjek aldrig igen (afsluttet film)
      );
      CREATE UNIQUE INDEX ix_titles_tmdb ON titles(kind, tmdb_id);
      CREATE INDEX ix_titles_imdb ON titles(imdb_id) WHERE imdb_id IS NOT NULL;
      -- Baggrundsjobbet spoerger PRAECIS paa den her: hvad er forfaldent nu?
      CREATE INDEX ix_titles_check ON titles(next_check_at) WHERE next_check_at IS NOT NULL;

      CREATE TABLE episodes (
        id       TEXT PRIMARY KEY,        -- 'tv:1396:s1e1'
        title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
        season   INTEGER NOT NULL,
        number   INTEGER NOT NULL,
        name     TEXT,
        -- ISO-dato som TEKST, ikke epoke. Et afsnit sendes paa en DATO i sin
        -- egen tidszone; goer man det til et tidspunkt, flytter det sig en dag
        -- for nogen. Kalenderen og iCal-feedet vil have datoen, ikke sekundet.
        air_date TEXT,
        runtime  INTEGER,
        data     TEXT NOT NULL DEFAULT '{}',
        UNIQUE (title_id, season, number)
      );
      -- Kalenderen (K6) spoerger paa datointerval paa tvaers af ALLE serier.
      CREATE INDEX ix_ep_air ON episodes(air_date) WHERE air_date IS NOT NULL;
      CREATE INDEX ix_ep_title ON episodes(title_id, season, number);

      -- Hvor kan man se den (S1). Pr. titel OG region, fordi svaret er
      -- forskelligt i DK og US, og en husstand kan rejse.
      CREATE TABLE providers (
        title_id   TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
        region     TEXT NOT NULL,
        data       TEXT NOT NULL,          -- JSON: {flatrate:[], rent:[], buy:[]}
        fetched_at INTEGER NOT NULL,
        -- Forrige svar bevares, saa "forsvinder snart / kommer snart" (S3) kan
        -- ses som en FORSKEL. Uden den kolonne skal man gemme en historik for
        -- at opdage en aendring, der kun betyder noget i det oejeblik den sker.
        previous   TEXT,
        PRIMARY KEY (title_id, region)
      );
    `);
  },

  function m3(d) {
    /*
     * PLAN 2: sete afsnit. Egen tabel, ikke items.
     *
     * Begrundelsen er maalt andetsteds: Kokkeri laerte, at et listesvar, der
     * skal parse JSON pr. raekke, er en hukommelsesspids (§4). Historikken her
     * er den stoerste tabel i appen - en Trakt-import kan vaere titusinder af
     * raekker - og den summeres, sorteres og filtreres paa tid.
     *
     * `episode_id` er NULL for film. Det er derfor dubletnoeglen bruger
     * COALESCE: uden den ville to film-visninger samme dag ikke kunne skelnes
     * fra hinanden af et UNIQUE-indeks, fordi NULL aldrig er lig NULL i SQL.
     * Den finesse er praecis den slags, en genkoert import falder over.
     */
    d.exec(`
      CREATE TABLE watches (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title_id   TEXT NOT NULL,
        episode_id TEXT,                   -- NULL for film
        watched_at INTEGER NOT NULL,
        source     TEXT NOT NULL,          -- manual | plex | trakt | netflix | import | mcp
        created_at INTEGER NOT NULL
      );
      CREATE INDEX ix_watch_user_time ON watches(user_id, watched_at DESC);
      CREATE INDEX ix_watch_user_title ON watches(user_id, title_id);
      -- Genkoerbar import: samme afsnit, samme bruger, samme DAG er den samme
      -- begivenhed. Vi gemmer sekundet, men dubletnoeglen bruger dagen - to
      -- kilder (Plex og Trakt) rammer aldrig det samme sekund.
      CREATE UNIQUE INDEX ix_watch_dedup
        ON watches(user_id, title_id, COALESCE(episode_id, ''), date(watched_at, 'unixepoch'));

      -- PLAN 3: det personlige. Samme generiske form som doda og tovo.
      CREATE TABLE items (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL,
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX ix_items_user_kind ON items(user_id, kind);
      -- "Foelger jeg den her serie?" slaas op for HVER titel, der vises.
      -- Uden indekset er hver opslag en scanning af brugerens tracking-raekker.
      CREATE INDEX ix_items_title ON items(user_id, json_extract(data, '$.titleId'))
        WHERE json_extract(data, '$.titleId') IS NOT NULL;
      -- Delte lister slaas op fra et endepunkt UDEN login. Udtryks-indeks, saa
      -- det aldrig bliver en fuld scanning (§4).
      CREATE INDEX ix_items_token ON items(json_extract(data, '$.shareToken'))
        WHERE json_extract(data, '$.shareToken') IS NOT NULL;
    `);
  },

  function m4(d) {
    /*
     * SELEKTIV DELING (Andreas, 2026-08-28: "man skal kunne vaelge hvem man
     * vil dele informationer med").
     *
     * En husstand er ikke ét faelles rum. Modellen er derfor ikke et flag paa
     * installationen men EKSPLICITTE tildelinger: ejer -> modtager, for et
     * bestemt emne. Tre slags emner daekker det, der faktisk oenskes:
     *
     *   profile : "Anna maa se hele min historik og fremdrift."
     *   list    : "Sofalisten deles med Anna og Bo." (den hyppigste)
     *   title   : "Anna maa se, hvor langt jeg er i DEN HER serie."
     *             Den fine-kornede findes for spoilervagtens skyld (H3):
     *             man vil dele fremdrift paa det, man ser sammen, og intet andet.
     *
     * `can_write` betyder kun noget for lister - dér er den pointen: en faelles
     * liste, alle kan laegge i. Man kan ikke se en film paa en andens vegne,
     * saa skrive-adgang til en profil ville ikke have en betydning at have.
     *
     * ---------------------------------------------------------------------
     * DEN VIGTIGE REGEL, som resten af koden er bundet af:
     *
     *   Deling er en SEPARAT vej ind i dataene - ALDRIG en opbloedning af
     *   user_id-filteret i hentItems/hentWatches.
     *
     * Fristelsen er at lade hentItems tage et "ogsaaDelt"-flag. Det ville
     * betyde, at ét glemt argument ét sted aabner hele historikken for hele
     * huset, tavst. I stedet spoerger man eksplicit med hentDeltMedMig(), og
     * de gamle funktioner bliver ved med at betyde praecis ÉN ting: mit eget.
     * Sprangradius for en fejl i delingslogikken er saa det, der er delt -
     * ikke alt.
     * ---------------------------------------------------------------------
     */
    d.exec(`
      CREATE TABLE shares (
        id           TEXT PRIMARY KEY,
        owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        grantee_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_kind TEXT NOT NULL,          -- 'profile' | 'list' | 'title'
        subject_id   TEXT,                   -- NULL naar subject_kind = 'profile'
        can_write    INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL
      );
      -- Samme tildeling kan kun findes én gang. COALESCE, fordi NULL aldrig er
      -- lig NULL i SQL - uden den ville 'profile' kunne tildeles i det uendelige.
      CREATE UNIQUE INDEX ix_shares_unik
        ON shares(owner_id, grantee_id, subject_kind, COALESCE(subject_id, ''));
      -- "Hvad er delt MED mig" er det opslag, fladen laver ved hver indlaesning.
      CREATE INDEX ix_shares_modtager ON shares(grantee_id, subject_kind);
      CREATE INDEX ix_shares_ejer ON shares(owner_id);
    `);
  },

  function m5(d) {
    /*
     * Kalenderfeed (K6).
     *
     * Egen tabel med tokenet som PRIMARY KEY - ikke et felt i items. Feedet
     * slaas op fra et endepunkt UDEN login, og et saadant endepunkt maa
     * aldrig scanne datasaettet: kalender-apps poller hvert kvarter, og et
     * feed, der laeser hele biblioteket hver gang, ligger og arbejder
     * doegnet rundt (§4/§5).
     *
     * `revoked_at` frem for at slette raekken: et tilbagekaldt feed skal
     * kunne genkendes som tilbagekaldt, ikke som "har aldrig eksisteret".
     */
    d.exec(`
      CREATE TABLE ical_feeds (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX ix_ical_bruger ON ical_feeds(user_id) WHERE revoked_at IS NULL;
    `);
  },

  function m6(d) {
    /*
     * OAuth 2.1 til claude.ai's connectors (§9a).
     *
     * Claude Code og Desktop kan sende en fast noegle i en header. WEBklienten
     * kan ikke: den kender ikke serveren paa forhaand, saa den skal kunne
     * registrere sig selv og sende brugeren gennem et login.
     *
     * Access-tokens faar IKKE deres egen tabel: de ligger i `tokens` med et
     * client_id og et udloeb, saa de valideres ad PRAECIS samme vej som en
     * haandlavet noegle. Én validering, ét sted at tilbagekalde, ét sted at
     * rate-limite. Kolonnerne findes allerede fra m1.
     */
    d.exec(`
      CREATE TABLE oauth_clients (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        redirect_uris TEXT NOT NULL,          -- JSON-array, matches NOEJAGTIGT
        created_at    INTEGER NOT NULL
      );
      CREATE TABLE oauth_refresh (
        hash       TEXT PRIMARY KEY,          -- sha256, aldrig klartekst
        token_id   TEXT NOT NULL,
        client_id  TEXT NOT NULL,
        scope      TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX ix_oauth_refresh_klient ON oauth_refresh(client_id) WHERE revoked_at IS NULL;
    `);
  },

  function m7(d) {
    /*
     * Push-abonnementer (F2/F6).
     *
     * Endpointet er PRIMARY KEY: browseren giver den samme adresse igen ved
     * et fornyet abonnement, og saa skal det opdatere - ikke lave en dublet,
     * der sender den samme notifikation to gange.
     *
     * Noeglerne (p256dh, auth) er browserens egne og bruges til at kryptere
     * beskeden, saa push-tjenesten ikke kan laese den. De er ikke
     * hemmeligheder paa vores side, men de hoerer til ÉN bruger.
     */
    d.exec(`
      CREATE TABLE push_subs (
        endpoint   TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        p256dh     TEXT NOT NULL,
        auth       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_ok_at INTEGER,
        fejl       INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX ix_push_bruger ON push_subs(user_id);
    `);
  },

  function m8(d) {
    /*
     * Samlinger ("Spider-Man Collection" med 1, 2 og 3).
     *
     * Hoerer til metadata-planen: samlingen er den samme for hele husstanden,
     * saa der er intet user_id. Det PERSONLIGE er, hvilke dele man har set,
     * og det staar allerede i watches.
     */
    d.exec(`
      CREATE TABLE collections (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        data       TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
    `);
  },
];

function migrate() {
  const cur = db.prepare('PRAGMA user_version').get().user_version || 0;
  for (let i = cur; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      MIGRATIONS[i](db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
      log(`skema opdateret til version ${i + 1}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/* ----------------------------------------------------------------- hjaelpere */

const now = () => Math.floor(Date.now() / 1000);
const log = (msg) => console.log(`[spolen] ${msg}`);
const logError = (msg) => console.error(`[fejl] ${msg}`);
// Ruller op pr. subjekt i panelets sikkerhedshistorik via runens events:-blok.
const logSecurity = (msg) => console.warn(`[sikkerhed] ${msg}`);

function newId() {
  return crypto.randomBytes(16).toString('hex');
}

function audit(event, subject, detail) {
  try {
    db.prepare('INSERT INTO audit (at, event, subject, detail) VALUES (?,?,?,?)')
      .run(now(), event, subject || null, detail ? String(detail).slice(0, 500) : null);
  } catch (err) {
    logError(`kunne ikke skrive audit: ${err.message}`);
  }
}

function getSetting(scope, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE scope = ? AND key = ?').get(scope, key);
  return row ? row.value : fallback;
}

function setSetting(scope, key, value) {
  db.prepare(`INSERT INTO settings (scope, key, value) VALUES (?,?,?)
              ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`)
    .run(scope, key, String(value));
}

function hentSettings(scope) {
  const ud = {};
  for (const r of db.prepare('SELECT key, value FROM settings WHERE scope = ?').all(scope)) {
    if (HEMMELIGE_SETTINGS.has(r.key)) continue;
    ud[r.key] = r.value;
  }
  return ud;
}

function rateAllow(bucket, limit, windowSec) {
  const t = now();
  const row = db.prepare('SELECT count, reset_at FROM rate WHERE bucket = ?').get(bucket);
  if (!row || row.reset_at <= t) {
    db.prepare(`INSERT INTO rate (bucket, count, reset_at) VALUES (?,1,?)
                ON CONFLICT(bucket) DO UPDATE SET count = 1, reset_at = excluded.reset_at`)
      .run(bucket, t + windowSec);
    return true;
  }
  if (row.count >= limit) return false;
  db.prepare('UPDATE rate SET count = count + 1 WHERE bucket = ?').run(bucket);
  return true;
}

function rateClear(bucket) {
  db.prepare('DELETE FROM rate WHERE bucket = ?').run(bucket);
}

/* ---------------------------------------------------------------- kodeord */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  let actual;
  try {
    actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/* ---------------------------------------------------------------- sessioner */

/* ------------------------------------------- totrinsbekraeftelse (§9d) */

function totpStatus(userId) {
  return {
    enabled: getSetting(userId, 'totp_enabled', '') === '1',
    // »Paabegyndt« er en TREDJE tilstand: hemmeligheden findes, men kontakten
    // er ikke gaaet til endnu. Uden den ville fladen vise »slaa til« til en,
    // der staar midt i opsaetningen.
    pending: !!getSetting(userId, 'totp_secret', '') && getSetting(userId, 'totp_enabled', '') !== '1',
    recoveryLeft: db.prepare(
      'SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(userId).n,
  };
}

function slaaTotpFra(userId) {
  db.prepare('DELETE FROM settings WHERE scope = ? AND key IN (?,?,?)')
    .run(userId, 'totp_secret', 'totp_enabled', 'totp_last');
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
}

/** Ti nye koder. De gamle - ogsaa de ubrugte - doer i samme aandedrag. */
function nyeGenoprettelseskoder(userId) {
  const koder = totp.nyeKoder(10);
  const t = now();
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
  const ind = db.prepare(
    'INSERT INTO recovery_codes (id, user_id, hash, used_at, created_at) VALUES (?,?,?,NULL,?)');
  for (const k of koder) ind.run(newId(), userId, totp.hashKode(k), t);
  return koder;
}

/**
 * Andet trin ved login: en engangskode ELLER en genoprettelseskode.
 *
 * To ting er lette at gaa galt i (§9d):
 *
 *  1. **Vinduet braendes.** `tjek()` returnerer det vindue, koden kom fra -
 *     ikke `true` - og vi afviser det samme vindue igen. Ellers kan en
 *     opsnappet kode bruges to gange inden for det halve minut.
 *  2. **En genoprettelseskode kan ikke gaa om.** Raekken bliver STAAENDE med
 *     `used_at`, saa den er brugt for altid og kan taelles. Slettede man den,
 *     ville »ni tilbage« ligne »der var kun ni«.
 */
function tjekAndetTrin(userId, kode) {
  const hem = getSetting(userId, 'totp_secret', '');
  if (hem) {
    const vindue = totp.tjek(hem, kode);
    if (vindue !== null) {
      const sidst = Number(getSetting(userId, 'totp_last', '0'));
      if (vindue <= sidst) return { ok: false, besked: 'That code has already been used.' };
      setSetting(userId, 'totp_last', String(vindue));
      return { ok: true };
    }
  }
  // Ikke en engangskode - saa maaske en genoprettelseskode.
  const hash = totp.hashKode(kode);
  const raekke = db.prepare(
    'SELECT id FROM recovery_codes WHERE user_id = ? AND hash = ? AND used_at IS NULL').get(userId, hash);
  if (!raekke) return { ok: false, besked: 'That code is not right.' };
  db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ?').run(now(), raekke.id);
  const tilbage = db.prepare(
    'SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(userId).n;
  return { ok: true, genoprettelse: true, tilbage };
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const t = now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId, t, t + SESSION_DAYS * 86400);
  return token;
}

function sessionUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.is_admin, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at <= now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.id, username: row.username, isAdmin: !!row.is_admin };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function sessionCookie(req, token, maxAge) {
  const bits = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttps(req)) bits.push('Secure');
  return bits.join('; ');
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'ukendt';
}

/* ------------------------------------------------------------ http-svar */

// Hashen af det inline tema-script i index.html. Beregnes ved OPSTART i stedet
// for at blive stemplet ind af build'et - saa kan CSP'en aldrig komme ud af
// trit med filen, og build og server er ikke koblet sammen (doda).
let INLINE_SCRIPT_HASH = '';
let INLINE_SCRIPT_TEXT = '';
let APP_VERSION_FIL = '1';

function computeInlineHash() {
  try {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    const v = html.match(/style\.css\?v=(\d+)/);
    if (v) APP_VERSION_FIL = v[1];
    const m = html.match(/<script data-theme-init>([\s\S]*?)<\/script>/);
    if (!m) return;
    INLINE_SCRIPT_TEXT = m[1];
    INLINE_SCRIPT_HASH = ` 'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`;
  } catch (err) {
    logError(`kunne ikke beregne CSP-hash: ${err.message}`);
  }
}

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'",
    `script-src 'self'${INLINE_SCRIPT_HASH}`,
    // 'unsafe-inline' gaelder KUN typografi. Den betydningsfulde spaerring er
    // script-src; uden style-attributter kan en vanilla-JS-frontend ikke bygge
    // markup med innerHTML.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    // Uden worker-src falder en service worker tilbage til default-src 'none'
    // og blokeres af vores egen CSP - uden at fejlen naevner CSP med ét ord.
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy',
    'geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function sendJson(res, status, body, extraHeaders) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(data),
  }, extraHeaders || {}));
  res.end(data);
}

/** Fejlsvar med to lag: en kode til maskinen, en saetning til mennesket. */
/*
 * `ekstra` er til de faa fejl, klienten skal kunne HANDLE paa ud over koden.
 * I dag kun `needsCode` ved login: fladen skal vide, om kodefeltet skal blive
 * staaende (forkert engangskode) eller foldes vaek (forkert kodeord).
 */
function apiFejl(res, status, kode, besked, ekstra) {
  sendJson(res, status, Object.assign({ error: kode, message: besked }, ekstra || {}));
}

const MAX_BODY = 2 * 1024 * 1024;

/*
 * Importen maa fylde mere. En Trakt-dataeksport er ~4,5 MB JSON fordelt paa
 * 77 filer, og JSON-indpakningen goer den til godt 5 MB paa traaden. Den
 * generelle 2 MB-graense er rigtig for alt andet og skal blive staaende -
 * den her gaelder KUN de to importruter (Andreas' eksport, 2026-08-29).
 */
const MAX_IMPORT_BODY = 48 * 1024 * 1024;

/**
 * @param {boolean} tilgivende  Saettes KUN naar forespoergslen er godkendt med
 *   en adgangsnoegle. Kravet om application/json er en CSRF-barriere, og CSRF
 *   forudsaetter en ambient legitimation (cookien). En Bearer-noegle sendes
 *   aktivt af klienten, saa der er intet at forfalske.
 */
function readJsonBody(req, tilgivende, tilladArray, maxBody) {
  const graense = maxBody || MAX_BODY;
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    const erJson = type.includes('application/json');
    if (!erJson && !tilgivende) {
      reject(Object.assign(new Error('Content-Type must be application/json'), { status: 415 }));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > graense) {
        /*
         * Afvis FOERST, afbryd bagefter.
         *
         * Foerste udgave kaldte req.destroy() med det samme, og saa naaede
         * svaret aldrig frem: klienten saa kun "100 Continue" og hang. En
         * for stor forespoergsel skal sige det - ikke gaa i staa.
         */
        reject(Object.assign(
          new Error(`the request is too large (over ${Math.round(graense / 1048576)} MB)`),
          { status: 413, kode: 'too_large' }));
        setTimeout(() => req.destroy(), 50);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) { resolve({}); return; }
      if (erJson || raw.startsWith('{') || (tilladArray && raw.startsWith('['))) {
        try {
          const parsed = JSON.parse(raw);
          // En generel body-laeser skal have et EKSPLICIT tilladArray-flag.
          // Tavs afvisning af arrays gjorde JSON-RPC-batch umulig i doda.
          if (Array.isArray(parsed)) { resolve(tilladArray ? parsed : {}); return; }
          resolve(parsed && typeof parsed === 'object' ? parsed : {});
        } catch {
          reject(Object.assign(new Error('The body is not valid JSON.'), { status: 400 }));
        }
        return;
      }
      if (type.includes('application/x-www-form-urlencoded')) {
        const felter = {};
        for (const [n, v] of new URLSearchParams(raw)) felter[n] = v;
        resolve(felter);
        return;
      }
      resolve({ text: raw });
    });
    req.on('error', reject);
  });
}

function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/* ------------------------------------------------------------ statisk */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(PUBLIC_DIR, rel);
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) {
    apiFejl(res, 403, 'forbidden', 'Not allowed.');
    return;
  }
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    apiFejl(res, 404, 'not_found', 'No such file.');
    return;
  }
  if (!stat.isFile()) { apiFejl(res, 404, 'not_found', 'No such file.'); return; }

  const ext = path.extname(full).toLowerCase();
  const isHtml = ext === '.html';
  securityHeaders(res);

  // I DEV stemples ?v= med filernes mtime. Ellers beholder browseren en
  // "immutable" app.js og spoerger aldrig serveren igen (doda F1).
  if (isHtml && DEV) {
    let html = fs.readFileSync(full, 'utf8');
    html = html.replace(/(style\.css|app\.js)\?v=\d+/g, (_, fil) => {
      let m = 0;
      try { m = Math.floor(fs.statSync(path.join(PUBLIC_DIR, fil)).mtimeMs); } catch { /* ligegyldigt */ }
      return `${fil}?v=${m}`;
    });
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    // HTML altid frisk: Cloudflare edge-cacher .js/.css i timevis og ignorerer
    // no-cache, saa versionerede URL'er baerer opdateringen (§5).
    'Cache-Control': (isHtml || DEV) ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(full).pipe(res);
}

/* ------------------------------------------------- adgangsnoegler */

/* En mistet telefon maa ikke kunne laese hele systemet: en capture-noegle kan
   KUN oprette, ikke se noget. */
const SCOPE_TILLADER = {
  capture: new Set(['capture']),
  read: new Set(['read']),
  full: new Set(['capture', 'read', 'write']),
};

function hashToken(raa) {
  return crypto.createHash('sha256').update(String(raa), 'utf8').digest('hex');
}

function opretToken(userId, navn, scope, ekstra) {
  const e = ekstra || {};
  const hemmelig = crypto.randomBytes(32).toString('base64url');
  const noegle = `spolen_${hemmelig}`;
  const id = newId();
  db.prepare(`INSERT INTO tokens (id, user_id, name, hash, prefix, scope, client_id, expires_at, created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, navn, hashToken(noegle), hemmelig.slice(0, 6), scope,
      e.clientId || null, e.expiresAt || null, now());
  audit(e.clientId ? 'oauth-token-udstedt' : 'noegle-oprettet', navn, scope);
  // Noeglen returneres ÉN gang og gemmes aldrig i klartekst.
  return { id, key: noegle };
}

function findToken(raa) {
  if (typeof raa !== 'string' || !raa.startsWith('spolen_')) return null;
  return db.prepare(`
    SELECT id, user_id, name, scope, last_used_at, client_id FROM tokens
     WHERE hash = ? AND revoked_at IS NULL
       -- Uden udloebstjekket HER ville et OAuth-token leve evigt, uanset hvad
       -- vi lovede klienten i expires_in.
       AND (expires_at IS NULL OR expires_at > ?)`).get(hashToken(raa), now()) || null;
}

function stemplBrug(token) {
  const t = now();
  if (token.last_used_at && t - token.last_used_at < 60) return;
  db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(t, token.id);
}

/* ------------------------------------------------------------ godkendelse */

/**
 * Godkender via adgangsnoegle ELLER session-cookie. Webappen bruger samme API
 * som eksterne klienter - der er ingen intern bagvej (doda F2).
 *
 * @returns {{user, token, viaToken}|null} null naar svaret allerede er sendt.
 */
function godkend(req, res, kraevetScope) {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.match(/^Bearer\s+(\S+)$/i);
  const raaNoegle = bearer ? bearer[1] : String(req.headers['x-api-key'] || '');

  if (raaNoegle) {
    const token = findToken(raaNoegle);
    if (!token) {
      logSecurity(`noegle-afvist ip=${clientIp(req)}`);
      apiFejl(res, 401, 'invalid_key', 'That access key is not valid. It may have been revoked.');
      return null;
    }
    if (!rateAllow(`api:${token.id}`, 600, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many requests with this key. Try again shortly.');
      return null;
    }
    if (!SCOPE_TILLADER[token.scope].has(kraevetScope)) {
      apiFejl(res, 403, 'wrong_scope',
        `This key is "${token.scope}" and cannot ${kraevetScope}. Create a key with a wider scope.`);
      return null;
    }
    stemplBrug(token);
    // Noeglen hoerer til ÉN bruger. Uden user_id paa tokens ville en noegle
    // give adgang til den foerste bruger i tabellen - som i doda, hvor der
    // kun findes én.
    const bruger = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(token.user_id);
    if (!bruger) { apiFejl(res, 401, 'invalid_key', 'That key has no owner.'); return null; }
    return {
      user: { id: bruger.id, username: bruger.username, isAdmin: !!bruger.is_admin },
      token,
      viaToken: true,
    };
  }

  const user = sessionUser(req);
  if (!user) {
    apiFejl(res, 401, 'not_signed_in', 'You are not signed in.');
    return null;
  }
  return { user, token: null, viaToken: false };
}

/**
 * Kraever en rigtig SESSION - en adgangsnoegle er ikke nok.
 *
 * Kun til kodeordsskift og administration af noeglerne selv. Ellers ville én
 * laekket noegle vaere nok til at give sig selv varig adgang (doda F2).
 */
function requireUser(req, res) {
  const user = sessionUser(req);
  if (!user) {
    apiFejl(res, 401, 'session_required',
      'This needs a signed-in browser session — an access key cannot do it.');
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.isAdmin) {
    apiFejl(res, 403, 'admin_only', 'Only the administrator can change this.');
    return null;
  }
  return user;
}

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function tilladRegistrering() {
  // Ingen bruger endnu: foerste registrering skal altid kunne lade sig goere.
  if (userCount() === 0) return true;
  return getSetting('*', 'allow_registration', '0') === '1';
}


/* ------------------------------------------------------------ elementer */

/*
 * HELE dataadgangen ligger her, og user_id-filteret ligger i FUNKTIONERNE -
 * aldrig i kaldstederne. Laegges det i kaldstederne, bliver ét glemt, og saa
 * ser en bruger en andens historik (Kokkeri §4 / CLAUDE.md).
 *
 * Alle funktioner tager userId som foerste argument. Det er med vilje
 * ubekvemt: man kan ikke komme til at kalde dem uden at tage stilling.
 *
 * Metadata-funktionerne laengere nede tager IKKE et userId - og det er lige
 * saa bevidst. En titel er installationens, ikke brugerens. Forskellen skal
 * kunne ses paa signaturen alene.
 */

const MAX_ITEM_JSON = 200 * 1024;

/* De fem slags personligt indhold. Hvidlisten staar ÉT sted, saa et API-kald
   ikke kan lave en sjette slags, som ingen visning kender. */
const KINDS = new Set(['tracking', 'rating', 'note', 'list', 'listItem']);

/*
 * Felterne pr. slags. En EKSPLICIT hvidliste, ikke en sortliste.
 *
 * Det er ikke pedanteri: F3's genkoerbare import skal kunne opdatere nogle
 * felter og aldrig roere andre (en Trakt-genimport maa ikke aede en note,
 * brugeren selv har skrevet), og den regel kan kun skrives sikkert, hvis der
 * findes en udtoemmende liste over, hvad et element overhovedet har.
 * En sortliste glemmer det felt, nogen tilfoejer om et halvt aar.
 */
const FELTER = {
  // Brugerens forhold til én titel. Adskilt fra `titles` med vilje:
  // metadata er installationens, holdningen er brugerens.
  tracking: ['titleId', 'state', 'favorite', 'startedAt', 'finishedAt', 'droppedAt',
    'hideSpecials', 'notifyNew', 'addedAt', 'source'],
  rating: ['titleId', 'episodeId', 'score', 'ratedAt'],
  note: ['titleId', 'episodeId', 'body', 'spoiler'],
  // 'shareToken' er det OFFENTLIGE, skrivebeskyttede link (H4) - en anden
  // ting end at dele med en navngiven bruger, som bor i shares-tabellen.
  list: ['name', 'description', 'color', 'position', 'shareToken', 'shared'],
  listItem: ['listId', 'titleId', 'position', 'addedAt'],
};

/* Gyldige vaerdier for tracking.state. En serie er ét af de her - aldrig
   "watchlist OG droppet". At haandhaeve det her frem for i fladen betyder,
   at en import ikke kan smugle en sjette tilstand ind. */
const STATES = new Set(['watchlist', 'watching', 'completed', 'dropped', 'paused']);

function pakUd(row) {
  const data = JSON.parse(row.data);
  return Object.assign({}, data, { id: row.id, kind: row.kind, updatedAt: row.updated_at });
}

/** @param {object} [filter] {kind, ids, titleId, medSlettede} */
function hentItems(userId, filter) {
  const f = filter || {};
  const hvor = ['user_id = ?'];
  const arg = [userId];
  if (f.kind) {
    if (!KINDS.has(f.kind)) return [];
    hvor.push('kind = ?');
    arg.push(f.kind);
  }
  if (f.titleId) {
    hvor.push("json_extract(data, '$.titleId') = ?");
    arg.push(String(f.titleId));
  }
  if (Array.isArray(f.ids)) {
    if (!f.ids.length) return [];
    hvor.push(`id IN (${f.ids.map(() => '?').join(',')})`);
    arg.push(...f.ids.map(String));
  }
  // Bloed sletning bor i JSON'en (deletedAt), saa skemaet er praecis det,
  // planen beskriver. Filteret ligger HER, saa ingen liste kan glemme det.
  if (!f.medSlettede) hvor.push("json_extract(data, '$.deletedAt') IS NULL");
  const rows = db.prepare(
    `SELECT id, kind, data, updated_at FROM items WHERE ${hvor.join(' AND ')} ORDER BY updated_at DESC`
  ).all(...arg);
  return rows.map(pakUd);
}

function hentItem(userId, id) {
  const row = db.prepare('SELECT id, kind, data, updated_at FROM items WHERE id = ? AND user_id = ?')
    .get(String(id || ''), userId);
  if (!row) return null;
  const item = pakUd(row);
  return item.deletedAt ? null : item;
}

/**
 * Opretter eller opdaterer ÉT element.
 *
 * @param {boolean} [erDelvis] Saettes af kaldsstedet, hvis objektet kommer fra
 *   en liste, der kun sendte nogle felter. Vagten ligger i GEMME-funktionen,
 *   ikke i kaldsstedet - der bliver ét glemt (Kokkeri §4).
 */
function gemItem(userId, raa, erDelvis) {
  if (erDelvis || (raa && raa.partial)) {
    throw Object.assign(new Error('a partial item can never be saved as a whole one'), { status: 400 });
  }
  const kind = String(raa && raa.kind || '');
  if (!KINDS.has(kind)) {
    throw Object.assign(new Error(`unknown kind "${kind}"`), { status: 400 });
  }
  const id = str(raa.id, 64) || newId();
  const t = now();

  // Findes elementet, skal det tilhoere den samme bruger. Ellers ville et
  // gaet paa et id kunne overskrive en andens note.
  const eksisterende = db.prepare('SELECT user_id, data FROM items WHERE id = ?').get(id);
  if (eksisterende && eksisterende.user_id !== userId) {
    throw Object.assign(new Error('no such item'), { status: 404 });
  }

  // Rensningen sker HER - ikke i ruterne. Alt uden for FELTER[kind] falder
  // fra, uanset om det kommer fra webappen, en import eller en MCP-klient.
  const data = renseItem(kind, raa);

  // De to INTERNE felter staar med vilje uden for FELTER: de hoerer til
  // lagringen, ikke til modellen. Men de skal foeres med, ellers aeder
  // hvidlisten den bloede sletning.
  if ('deletedAt' in raa) data.deletedAt = raa.deletedAt ? tal(raa.deletedAt, 0, 1e11) : null;
  if (!data.createdAt) {
    data.createdAt = eksisterende ? (JSON.parse(eksisterende.data).createdAt || t) : t;
  }
  const json = JSON.stringify(data);
  if (json.length > MAX_ITEM_JSON) {
    throw Object.assign(new Error('that item is too large'), { status: 413 });
  }

  db.prepare(`INSERT INTO items (id, user_id, kind, data, updated_at) VALUES (?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, data = excluded.data,
                                            updated_at = excluded.updated_at`)
    .run(id, userId, kind, json, t);
  return Object.assign({}, data, { id, kind, updatedAt: t });
}

/**
 * Gemmer mange elementer i ÉN transaktion.
 *
 * Bulk er den farlige: en importrutine kan oedelaegge hundredvis af poster
 * paa én gang, stille. Derfor gaar den gennem den SAMME gemItem med den
 * samme vagt - ikke ad en hurtigere vej udenom.
 */
function saveBulk(userId, liste) {
  if (!Array.isArray(liste)) {
    throw Object.assign(new Error('expected an array of items'), { status: 400 });
  }
  if (liste.length > 200) {
    throw Object.assign(new Error('at most 200 items per call'), { status: 413 });
  }
  const ud = [];
  db.exec('BEGIN');
  try {
    for (const raa of liste) ud.push(gemItem(userId, raa));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return ud;
}

function sletItem(userId, id) {
  const item = hentItem(userId, id);
  if (!item) return false;
  db.prepare('DELETE FROM items WHERE id = ? AND user_id = ?').run(String(id), userId);
  return true;
}

/** Brugerens tracking-raekke for én titel, eller null. */
function hentTracking(userId, titleId) {
  const raekker = hentItems(userId, { kind: 'tracking', titleId });
  return raekker[0] || null;
}

/* ---------------------------------------------------------- samlinger */

/* En samling aendrer sig sjaeldent - en efterfoelger annonceres ikke i dag.
   30 dage er rigeligt til at fange en ny del, foer nogen leder efter den. */
const SAMLING_ALDER = 30 * 86400;

async function sikrSamling(noegle, samlingId, sprog) {
  const id = Number(samlingId);
  if (!id) return null;
  const r = db.prepare('SELECT data, fetched_at FROM collections WHERE id = ?').get(id);
  if (r && now() - r.fetched_at < SAMLING_ALDER) {
    try { return JSON.parse(r.data); } catch { /* daarlig cache hentes igen */ }
  }
  try {
    const c = await tmdb.hentSamling(noegle, id, { sprog });
    db.prepare(`INSERT INTO collections (id, name, data, fetched_at) VALUES (?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name,
                  data = excluded.data, fetched_at = excluded.fetched_at`)
      .run(id, c.name, JSON.stringify(c), now());
    return c;
  } catch {
    // Har vi en gammel kopi, er den bedre end ingenting.
    if (r) { try { return JSON.parse(r.data); } catch { /* nej */ } }
    return null;
  }
}

/**
 * Samlingen, som BRUGEREN ser den: hver del med "har jeg den" og "har jeg set den".
 *
 * Det er hele pointen med funktionen. En liste over Spider-Man 1, 2 og 3
 * siger ikke ret meget; en liste, hvor 1 er set og 2 og 3 ikke er, svarer paa
 * det spoergsmaal, man faktisk stillede.
 */
function samlingForBruger(userId, samling, denneTitelId) {
  if (!samling) return null;
  const ids = samling.dele.map((d) => titelId('movie', d.tmdbId));
  const iBiblioteket = new Set(
    hentItems(userId, { kind: 'tracking' })
      .map((t) => t.titleId).filter((x) => ids.includes(x)));
  const sete = new Set();
  for (const id of ids) {
    if (hentWatches(userId, { titleId: id, graense: 1 }).length) sete.add(id);
  }
  const dele = samling.dele.map((d) => {
    const id = titelId('movie', d.tmdbId);
    return Object.assign({}, d, {
      id,
      denne: id === denneTitelId,
      iBiblioteket: iBiblioteket.has(id),
      set: sete.has(id),
    });
  });
  return {
    id: samling.id,
    name: samling.name,
    dele,
    // Tallene, fladen kan skrive en saetning ud fra.
    ialt: dele.length,
    sete: dele.filter((d) => d.set).length,
    manglerSete: dele.filter((d) => !d.set && !d.denne).length,
  };
}

/* ------------------------------------------------------- streamingudbud */

/*
 * Hvor kan man se den (S1).
 *
 * Hoerer til metadata-planen: svaret er det samme for hele husstanden, saa
 * der er intet user_id. Det PERSONLIGE er, hvilke tjenester man abonnerer
 * paa - og det bor i settings.
 */

/* Udbud aendrer sig i ryk, ikke loebende. En uge er tit nok til at fange en
   aendring, foer den betyder noget, uden at hente det samme hver dag. */
const PROVIDER_ALDER = 7 * 86400;

function hentProvidersCache(titleId, region) {
  const row = db.prepare(
    'SELECT data, previous, fetched_at FROM providers WHERE title_id = ? AND region = ?')
    .get(String(titleId), String(region || 'DK').toUpperCase());
  if (!row) return null;
  let data = {};
  let previous = null;
  try { data = JSON.parse(row.data || '{}'); } catch { /* tom cache */ }
  try { previous = row.previous ? JSON.parse(row.previous) : null; } catch { /* ligegyldigt */ }
  return { data, previous, fetchedAt: row.fetched_at };
}

/**
 * Skriver udbuddet - og flytter det FORRIGE svar til `previous`.
 *
 * Det er hele mekanikken bag "forsvinder snart" (S3): en aendring kan kun
 * ses som en FORSKEL, og uden at gemme det forrige svar ville man skulle
 * foere en historik for at opdage noget, der kun betyder noget i det
 * oejeblik det sker.
 *
 * `previous` opdateres KUN naar svaret rent faktisk er anderledes - ellers
 * ville en ugentlig hentning uden aendringer skubbe den rigtige forskel ud
 * efter syv dage.
 */
function gemProviders(titleId, region, data) {
  const r = String(region || 'DK').toUpperCase();
  const nyJson = JSON.stringify(data || {});
  const gammel = hentProvidersCache(titleId, r);
  const gammelJson = gammel ? JSON.stringify(gammel.data) : null;
  const forrige = (gammelJson && gammelJson !== nyJson)
    ? gammelJson
    : (gammel ? (gammel.previous ? JSON.stringify(gammel.previous) : null) : null);
  db.prepare(`
    INSERT INTO providers (title_id, region, data, fetched_at, previous)
    VALUES (?,?,?,?,?)
    ON CONFLICT(title_id, region) DO UPDATE SET
      data = excluded.data, fetched_at = excluded.fetched_at, previous = excluded.previous`)
    .run(String(titleId), r, nyJson, now(), forrige);
}

/** Henter udbuddet, hvis det mangler eller er gammelt. */
async function sikrProviders(noegle, titleId, region) {
  const r = String(region || 'DK').toUpperCase();
  const cachet = hentProvidersCache(titleId, r);
  if (cachet && now() - cachet.fetchedAt < PROVIDER_ALDER) return cachet;
  const titel = hentTitel(titleId);
  if (!titel) return cachet;
  try {
    const friskt = await tmdb.hentProviders(noegle, titel.kind, titel.tmdbId, r);
    gemProviders(titleId, r, friskt);
    return hentProvidersCache(titleId, r);
  } catch (err) {
    // Et manglende udbud maa ikke vaelte titelvisningen. Vi viser det, vi
    // har - ogsaa selv om det er gammelt.
    if (err.kode === 'tmdb_bad_key' || err.kode === 'tmdb_rate_limited') throw err;
    return cachet;
  }
}

/**
 * Hvad er KOMMET til og FORSVUNDET siden sidst (S3)?
 *
 * Kun abonnements-udbuddet (`flatrate`) sammenlignes. Leje og koeb aendrer
 * sig hele tiden og betyder ikke det samme: at en film ikke laengere kan
 * lejes ét sted, er ikke en nyhed - at den forsvinder fra det abonnement,
 * man betaler for, er.
 */
function udbudsAendring(cachet) {
  if (!cachet || !cachet.previous) return { kommet: [], forsvundet: [] };
  const navne = (d) => new Set(((d && d.flatrate) || []).map((p) => p.name));
  const nu = navne(cachet.data);
  const foer = navne(cachet.previous);
  return {
    kommet: [...nu].filter((n) => !foer.has(n)),
    forsvundet: [...foer].filter((n) => !nu.has(n)),
  };
}

/** Brugerens egne abonnementer, som et Set af udbyder-navne. */
function mineTjenester(userId) {
  try {
    const raa = JSON.parse(getSetting(userId, 'services', '[]'));
    return new Set(Array.isArray(raa) ? raa.map(String) : []);
  } catch {
    return new Set();
  }
}

/** Kan brugeren se den her titel paa noget, han allerede betaler for? */
function paaMineTjenester(cachet, mine) {
  if (!cachet || !mine.size) return null;
  const paa = ((cachet.data && cachet.data.flatrate) || [])
    .map((p) => p.name).filter((n) => mine.has(n));
  return paa.length ? paa : null;
}

/* ------------------------------------------------------------ historik */

/*
 * Sete afsnit og film. Egen tabel, samme regel: user_id ligger i FUNKTIONEN.
 *
 * Bemaerk at der ikke findes en "hentAlleWatches()" uden userId. Det er ikke
 * en forglemmelse - der er ingen lovlig grund til at laese hele husstandens
 * historik paa én gang, og en funktion, der kan, bliver kaldt.
 */

/*
 * 'backfill' = massemarkering. Datoen er afsnittets UDSENDELSESDAG, ikke
 * tidspunktet for trykket (Andreas, 2026-08-29). Udgivelsesdagen er et
 * meningsfuldt anker - man saa det engang efter, at det blev sendt - mens
 * "i dag" bare er, hvornaar museknappen blev trykket, og det gjorde
 * aarsopgoerelsen til vroevl.
 *
 * 'undated' = vi har hverken en dato fra kilden eller en udsendelsesdag.
 * Den ene slags, der stadig maa holdes ude af "hvornaar"-tallene.
 */
const WATCH_KILDER = new Set(['manual', 'plex', 'trakt', 'netflix', 'import', 'mcp',
  'backfill', 'undated']);

/** ISO-dato -> epoke-sekunder ved middag UTC (samme regel som importen). */
function datoTilEpoke(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;
  return Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 12) / 1000);
}

function pakWatch(row) {
  return {
    id: row.id,
    titleId: row.title_id,
    episodeId: row.episode_id,
    watchedAt: row.watched_at,
    source: row.source,
  };
}

/**
 * @param {object} [filter] {titleId, fra, til, graense}
 *
 * `graense` har en DEFAULT og et loft. Historikken er appens stoerste tabel,
 * og et endepunkt, der kan bede om det hele, bliver spurgt om det hele -
 * typisk fra en visning, der kun skulle bruge de tyve nyeste.
 */
function hentWatches(userId, filter) {
  const f = filter || {};
  const hvor = ['user_id = ?'];
  const arg = [userId];
  if (f.titleId) { hvor.push('title_id = ?'); arg.push(String(f.titleId)); }
  if (f.fra) { hvor.push('watched_at >= ?'); arg.push(tal(f.fra, 0, 1e11)); }
  if (f.til) { hvor.push('watched_at <= ?'); arg.push(tal(f.til, 0, 1e11)); }
  const graense = Math.min(Math.max(Number(f.graense) || 200, 1), 5000);
  return db.prepare(
    `SELECT id, title_id, episode_id, watched_at, source FROM watches
      WHERE ${hvor.join(' AND ')} ORDER BY watched_at DESC LIMIT ?`
  ).all(...arg, graense).map(pakWatch);
}

/**
 * Sete afsnits-ID'er for én titel - som et Set, ikke en liste.
 *
 * Det er DEN forespoergsel, "naeste usete afsnit" hviler paa, og den koeres
 * for hver serie paa forsiden. Derfor henter den kun episode_id-kolonnen:
 * en serie med ti saesoner har hundredvis af raekker, og resten af dem er
 * ligegyldige for spoergsmaalet.
 */
function seteAfsnit(userId, titleId) {
  const rows = db.prepare(
    `SELECT DISTINCT episode_id FROM watches
      WHERE user_id = ? AND title_id = ? AND episode_id IS NOT NULL`).all(userId, String(titleId));
  return new Set(rows.map((r) => r.episode_id));
}

/**
 * Registrerer en visning. Idempotent pr. (bruger, titel, afsnit, DAG).
 *
 * Returnerer {ok, dublet} frem for at kaste ved dublet: en genkoert import
 * rammer tusindvis af dubletter, og det er en normal tilstand, ikke en fejl.
 */
function gemWatch(userId, raa) {
  const titleId = str(raa && raa.titleId, 64);
  if (!titleId) throw Object.assign(new Error('titleId is required'), { status: 400 });
  const episodeId = str(raa.episodeId, 64) || null;
  // Et afsnits-id skal HOERE til titlen. Uden tjekket kunne en import knytte
  // 'tv:1396:s1e1' til 'movie:603', og saa taeller afsnittet med i en film.
  if (episodeId && !episodeId.startsWith(titleId + ':')) {
    throw Object.assign(new Error('that episode does not belong to that title'), { status: 400 });
  }
  const source = WATCH_KILDER.has(raa.source) ? raa.source : 'manual';
  const watchedAt = raa.watchedAt ? tal(raa.watchedAt, 0, 1e11) : now();
  const t = now();
  const res = db.prepare(
    `INSERT INTO watches (id, user_id, title_id, episode_id, watched_at, source, created_at)
     VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`
  ).run(newId(), userId, titleId, episodeId, watchedAt, source, t);
  return { ok: true, dublet: res.changes === 0 };
}

/**
 * Mange visninger i ÉN transaktion. Importens arbejdshest.
 *
 * Loftet er 500 og ikke 200 som items: en watch-raekke er faa hundrede bytes
 * mod et items JSON-blob, og importen sender dem i tusindvis. Frontenden
 * sender i portioner og viser fremdrift (§6c).
 */
function gemWatches(userId, liste) {
  if (!Array.isArray(liste)) {
    throw Object.assign(new Error('expected an array'), { status: 400 });
  }
  if (liste.length > 500) {
    throw Object.assign(new Error('at most 500 watches per call'), { status: 413 });
  }
  let tilfoejet = 0;
  let dubletter = 0;
  db.exec('BEGIN');
  try {
    for (const raa of liste) {
      const r = gemWatch(userId, raa);
      if (r.dublet) dubletter++; else tilfoejet++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { tilfoejet, dubletter };
}

/**
 * Markerer alt SENDT til og med ét afsnit som set.
 *
 * Det er den handling, man i praksis vil have, naar man er hoppet ind midt i
 * en lang serie: at markere afsnit 4 i saeson 13 ét ad gangen ville vaere
 * hundredvis af klik.
 *
 * To ting den IKKE goer, med vilje:
 *  - Den roerer ikke afsnit, der allerede er markeret (dubletnoeglen sorterer
 *    det, men vi taeller dem heller ikke med i svaret).
 *  - Den markerer ikke UUDSENDTE afsnit, selv om de sorterer foer. Et afsnit
 *    uden dato eller med en dato i fremtiden kan ikke vaere set.
 *
 * Specials foelger brugerens hideSpecials: er de skjult i visningen, maa de
 * heller ikke blive markeret af en handling, man udfoerte uden at se dem.
 */
function markerTilOgMed(userId, titleId, episodeId, idag) {
  const tracking = hentTracking(userId, titleId);
  const skjulSpecials = tracking ? tracking.hideSpecials !== false : true;
  const alle = hentAfsnit(titleId);
  const raekke = beregn.relevante(alle, { hideSpecials: skjulSpecials });
  const maal = raekke.findIndex((e) => e.id === episodeId);
  if (maal < 0) {
    throw Object.assign(new Error('that episode is not in this title'), { status: 404 });
  }
  const sete = seteAfsnit(userId, titleId);
  const skalMarkeres = raekke.slice(0, maal + 1).filter((e) =>
    !sete.has(e.id) && e.airDate && beregn.foerEllerLig(e.airDate, idag));
  if (!skalMarkeres.length) return { tilfoejet: 0, dubletter: 0 };
  /*
   * Datoen bliver AFSNITTETS UDSENDELSESDAG.
   *
   * Filteret ovenfor slipper kun afsnit igennem, der HAR en dato, saa der er
   * altid en at bruge - og dubletnoeglen (bruger + afsnit + dag) bliver
   * dermed stabil: koerer man massemarkeringen igen i morgen, rammer den
   * samme dag og laver ikke en ny raekke.
   */
  return gemWatches(userId, skalMarkeres.map((e) => ({
    titleId, episodeId: e.id, source: 'backfill',
    watchedAt: datoTilEpoke(e.airDate) || now(),
  })));
}

/**
 * Hvor mange USETE, sendte afsnit ligger FOER dette afsnit?
 *
 * Fladen spoerger, foer den markerer, saa den kan naa at spoerge brugeren.
 * Tallet er hele grundlaget for at stille spoergsmaalet - er det 0, skal der
 * ikke spoerges om noget.
 */
function useteFoer(userId, titleId, episodeId, idag) {
  const tracking = hentTracking(userId, titleId);
  const raekke = beregn.relevante(hentAfsnit(titleId), {
    hideSpecials: tracking ? tracking.hideSpecials !== false : true,
  });
  const maal = raekke.findIndex((e) => e.id === episodeId);
  if (maal <= 0) return 0;
  const sete = seteAfsnit(userId, titleId);
  return raekke.slice(0, maal).filter((e) =>
    !sete.has(e.id) && e.airDate && beregn.foerEllerLig(e.airDate, idag)).length;
}

function sletWatch(userId, id) {
  const res = db.prepare('DELETE FROM watches WHERE id = ? AND user_id = ?').run(String(id || ''), userId);
  return res.changes > 0;
}

/** Fjerner markeringen af ét afsnit, uanset hvornaar det blev set. */
function afmarkerAfsnit(userId, titleId, episodeId) {
  const res = db.prepare(
    'DELETE FROM watches WHERE user_id = ? AND title_id = ? AND episode_id IS ?')
    .run(userId, String(titleId), episodeId ? String(episodeId) : null);
  return res.changes;
}

/* --------------------------------------------------------- deling */

/*
 * Selektiv deling. Se m4 for begrundelsen.
 *
 * LAEG MAERKE TIL SIGNATURERNE: hver laesefunktion her tager BAADE en
 * `viewerId` og en `ownerId`. Det er med vilje ubekvemt - man kan ikke kalde
 * dem uden at tage stilling til, hvem der kigger, og hvis data der kigges i.
 * hentItems() og hentWatches() ovenfor betyder stadig og udelukkende "mit
 * eget", og det skal de blive ved med.
 */

const DELE_EMNER = new Set(['profile', 'list', 'title']);

/**
 * Maa `viewerId` se `ownerId`s `subjectKind`/`subjectId`?
 *
 * En profil-tildeling daekker ALT hos ejeren. En liste- eller titel-tildeling
 * daekker praecis sit eget emne. Rangordenen giver sig selv: har man faaet
 * hele profilen, behoever man ikke ogsaa den enkelte serie.
 */
function maaSe(viewerId, ownerId, subjectKind, subjectId) {
  if (viewerId === ownerId) return true;
  const profil = db.prepare(
    `SELECT 1 FROM shares WHERE owner_id = ? AND grantee_id = ? AND subject_kind = 'profile'`)
    .get(ownerId, viewerId);
  if (profil) return true;
  if (!subjectKind || subjectKind === 'profile') return false;
  return !!db.prepare(
    `SELECT 1 FROM shares WHERE owner_id = ? AND grantee_id = ?
       AND subject_kind = ? AND subject_id = ?`)
    .get(ownerId, viewerId, subjectKind, String(subjectId || ''));
}

/** Maa `viewerId` SKRIVE i ejerens liste? Kun lister kan deles med skriveret. */
function maaSkrive(viewerId, ownerId, listId) {
  if (viewerId === ownerId) return true;
  const r = db.prepare(
    `SELECT can_write FROM shares WHERE owner_id = ? AND grantee_id = ?
       AND subject_kind = 'list' AND subject_id = ?`).get(ownerId, viewerId, String(listId || ''));
  return !!(r && r.can_write);
}

/** Det, JEG deler ud. */
function hentDelinger(ownerId) {
  return db.prepare(`
    SELECT s.id, s.grantee_id, u.username AS grantee, s.subject_kind, s.subject_id,
           s.can_write, s.created_at
      FROM shares s JOIN users u ON u.id = s.grantee_id
     WHERE s.owner_id = ? ORDER BY s.created_at DESC`).all(ownerId)
    .map((r) => ({
      id: r.id, granteeId: r.grantee_id, grantee: r.grantee,
      subjectKind: r.subject_kind, subjectId: r.subject_id,
      canWrite: !!r.can_write, createdAt: r.created_at,
    }));
}

/** Det, ANDRE deler med mig. */
function hentDeltMedMig(viewerId) {
  return db.prepare(`
    SELECT s.id, s.owner_id, u.username AS owner, s.subject_kind, s.subject_id,
           s.can_write, s.created_at
      FROM shares s JOIN users u ON u.id = s.owner_id
     WHERE s.grantee_id = ? ORDER BY s.created_at DESC`).all(viewerId)
    .map((r) => ({
      id: r.id, ownerId: r.owner_id, owner: r.owner,
      subjectKind: r.subject_kind, subjectId: r.subject_id,
      canWrite: !!r.can_write, createdAt: r.created_at,
    }));
}

function gemDeling(ownerId, raa) {
  const granteeId = str(raa && raa.granteeId, 64);
  const subjectKind = str(raa.subjectKind, 20);
  if (!DELE_EMNER.has(subjectKind)) {
    throw Object.assign(new Error('subjectKind must be profile, list or title'), { status: 400 });
  }
  // Man kan ikke dele med sig selv. Det er ikke farligt, men raekken ville
  // ligge og lyve om, at der var delt noget.
  if (granteeId === ownerId) {
    throw Object.assign(new Error('you cannot share with yourself'), { status: 400 });
  }
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(granteeId)) {
    throw Object.assign(new Error('no such person'), { status: 404 });
  }
  const subjectId = subjectKind === 'profile' ? null : str(raa.subjectId, 64);
  if (subjectKind !== 'profile' && !subjectId) {
    throw Object.assign(new Error('subjectId is required'), { status: 400 });
  }
  // Deler man en LISTE, skal den vaere ens egen. Ellers kunne man "dele"
  // en andens liste videre - og tildelingen ville se aegte ud.
  if (subjectKind === 'list' && !hentItem(ownerId, subjectId)) {
    throw Object.assign(new Error('no such list'), { status: 404 });
  }
  // Skriveret giver kun mening for lister (se m4).
  const canWrite = subjectKind === 'list' && bool(raa.canWrite) ? 1 : 0;
  const id = newId();
  db.prepare(`
    INSERT INTO shares (id, owner_id, grantee_id, subject_kind, subject_id, can_write, created_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(owner_id, grantee_id, subject_kind, COALESCE(subject_id, ''))
      DO UPDATE SET can_write = excluded.can_write`)
    .run(id, ownerId, granteeId, subjectKind, subjectId, canWrite, now());
  audit('deling-oprettet', ownerId, `${subjectKind}:${subjectId || '*'} -> ${granteeId}`);
  return hentDelinger(ownerId).find((d) => d.granteeId === granteeId
    && d.subjectKind === subjectKind && (d.subjectId || null) === subjectId) || null;
}

/** Kun EJEREN kan tage en deling tilbage. */
function sletDeling(ownerId, id) {
  const r = db.prepare('DELETE FROM shares WHERE id = ? AND owner_id = ?').run(String(id || ''), ownerId);
  if (r.changes) audit('deling-fjernet', ownerId, String(id));
  return r.changes > 0;
}

/**
 * En andens fremdrift i én serie - spoilervagten (H3).
 *
 * Returnerer TAL, ikke afsnit: hvor langt er de naaet, ikke hvad der sker.
 * Det er hele forskellen paa "Anna er to afsnit bagud" og en afsnitstitel,
 * der roeber slutningen.
 */
function deltFremdrift(viewerId, ownerId, titleId, idag) {
  if (!maaSe(viewerId, ownerId, 'title', titleId)) return null;
  const afsnit = hentAfsnit(titleId);
  const sete = seteAfsnit(ownerId, titleId);
  const tracking = hentTracking(ownerId, titleId);
  const opts = { idag, hideSpecials: tracking ? tracking.hideSpecials !== false : true };
  const f = beregn.fremdrift(afsnit, sete, opts);
  const n = beregn.naesteUsete(afsnit, sete, opts);
  return {
    progress: f,
    // KUN nummeret paa naeste afsnit - ikke titlen, ikke resumeet.
    nextNumber: n.naeste ? { season: n.naeste.season, number: n.naeste.number } : null,
    state: tracking ? tracking.state : null,
  };
}

/* ------------------------------------------------------- plakat-cache */

/* Kun de stoerrelser, fladen faktisk beder om. En hvidliste frem for at
   sende brugerens streng videre til TMDB. */
/* Plakater er hoeje (2:3), stills er brede (16:9) - TMDB har egne
   stoerrelser til hver. Hvidlisten daekker begge, saa den samme proxy kan
   servere dem. */
const PLAKAT_STOERRELSER = new Set(['w154', 'w342', 'w500', 'w300', 'w780']);
/* TMDB's filnavne er indholdsadresserede (hashen ER navnet), saa et navn kan
   aldrig pege paa noget nyt. Derfor kan de serveres "immutable". */
const PLAKAT_NAVN = /^[A-Za-z0-9._-]{4,120}\.(jpg|png)$/;

function plakatSti(stoerrelse, navn) {
  return path.join(PLAKAT_DIR, `${stoerrelse}_${navn}`);
}

/**
 * Henter én plakat fra TMDB og laegger den paa disk.
 *
 * Ingen noegle noedvendig - image.tmdb.org er aabent. Det er derfor proxyen
 * kan vaere saa enkel: den skal kun daekke CSP'en og privatlivet, ikke
 * godkendelse.
 */
function hentPlakat(stoerrelse, navn) {
  return new Promise((resolve, reject) => {
    const url = `https://image.tmdb.org/t/p/${stoerrelse}/${navn}`;
    https.get(url, { headers: { 'user-agent': 'spolen' } }, (r) => {
      if (r.statusCode !== 200) {
        r.resume();
        reject(Object.assign(new Error(`TMDB image answered ${r.statusCode}`), { status: 404 }));
        return;
      }
      const bidder = [];
      let stoerrelseBytes = 0;
      r.on('data', (b) => {
        stoerrelseBytes += b.length;
        // Et loft, saa en uventet stor fil ikke kan fylde /data.
        if (stoerrelseBytes > 4 * 1024 * 1024) {
          r.destroy();
          reject(Object.assign(new Error('image too large'), { status: 502 }));
          return;
        }
        bidder.push(b);
      });
      r.on('end', () => {
        if (stoerrelseBytes > 4 * 1024 * 1024) return;
        try {
          fs.mkdirSync(PLAKAT_DIR, { recursive: true });
          // Skriv til et midlertidigt navn og omdoeb: saa kan en afbrudt
          // hentning aldrig efterlade en halv fil, der ser gyldig ud.
          const tmp = plakatSti(stoerrelse, navn) + '.tmp';
          fs.writeFileSync(tmp, Buffer.concat(bidder));
          fs.renameSync(tmp, plakatSti(stoerrelse, navn));
          resolve(Buffer.concat(bidder));
        } catch (e) { reject(e); }
      });
    }).on('error', (e) => reject(Object.assign(e, { status: 502 })));
  });
}

/**
 * Henter en titels plakat NU, i stedet for ved foerste visning.
 *
 * Plakatstien staar allerede i titlen efter en import - det er selve
 * BILLEDET, der mangler, og det hentes normalt foerst naar nogen kigger.
 * Efter en stor import betyder det, at biblioteket staar med tomme felter,
 * indtil man har rullet forbi hver enkelt (Andreas, 2026-08-29).
 *
 * Kun w342: det er den stoerrelse, gitrene og titelvisningen bruger. De
 * smaa (w154) er lette og faa steder, og de kan hentes ved behov - at hente
 * begge ville fordoble trafikken for lidt.
 *
 * Fejler den, er det ligegyldigt: proxyen henter den igen ved foerste
 * visning. Derfor ingen fejlhaandtering ud over at lade vaere med at kaste.
 */
async function forhentPlakat(posterPath) {
  const navn = String(posterPath || '').replace(/^\//, '');
  if (!navn || !PLAKAT_NAVN.test(navn)) return false;
  try {
    fs.accessSync(plakatSti('w342', navn));
    return false;                      // ligger der allerede
  } catch { /* skal hentes */ }
  try {
    await hentPlakat('w342', navn);
    return true;
  } catch {
    return false;
  }
}

async function serverPlakat(req, res, stoerrelse, navn) {
  if (!PLAKAT_STOERRELSER.has(stoerrelse) || !PLAKAT_NAVN.test(navn)) {
    apiFejl(res, 400, 'bad_request', 'Not a poster path.');
    return;
  }
  const sti = plakatSti(stoerrelse, navn);
  let data = null;
  try {
    data = fs.readFileSync(sti);
  } catch {
    try {
      data = await hentPlakat(stoerrelse, navn);
    } catch (err) {
      apiFejl(res, err.status === 404 ? 404 : 502, 'poster_unavailable',
        'That poster could not be fetched.');
      return;
    }
  }
  res.writeHead(200, {
    'Content-Type': navn.endsWith('.png') ? 'image/png' : 'image/jpeg',
    'Content-Length': data.length,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

/* ------------------------------------------------------ metadata-cachen */

/*
 * Installationens plan. Ingen af funktionerne her tager et userId, og det er
 * ikke en forglemmelse: en titel, et afsnit og en udgivelsesdato er de samme
 * for alle i huset. Kan man se paa signaturen, at der ikke er et brugerfilter,
 * kan man ogsaa se, at der ikke MANGLER et.
 */

function titelId(kind, tmdbId) {
  return `${kind}:${Number(tmdbId)}`;
}

function afsnitId(titleId, season, number) {
  return `${titleId}:s${Number(season)}e${Number(number)}`;
}

function hentTitel(id) {
  const row = db.prepare('SELECT * FROM titles WHERE id = ?').get(String(id || ''));
  if (!row) return null;
  return Object.assign(JSON.parse(row.data), {
    id: row.id,
    kind: row.kind,
    tmdbId: row.tmdb_id,
    imdbId: row.imdb_id,
    name: row.name,
    year: row.year,
    status: row.status,
    fetchedAt: row.fetched_at,
  });
}

function hentTitler(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const ud = [];
  // SQLite's parametergraense er 999. Titellister fra en stor watchlist kan
  // vaere laengere, saa der spoerges i bidder frem for at bygge én kaempe IN.
  for (let i = 0; i < ids.length; i += 500) {
    const bid = ids.slice(i, i + 500).map(String);
    const rows = db.prepare(
      `SELECT * FROM titles WHERE id IN (${bid.map(() => '?').join(',')})`).all(...bid);
    for (const row of rows) {
      ud.push(Object.assign(JSON.parse(row.data), {
        id: row.id, kind: row.kind, tmdbId: row.tmdb_id, imdbId: row.imdb_id,
        name: row.name, year: row.year, status: row.status, fetchedAt: row.fetched_at,
      }));
    }
  }
  return ud;
}

/**
 * Skriver en titel i cachen.
 *
 * `next_check_at` saettes af beregn.naesteTjek(), ikke her: hvornaar en titel
 * skal ses efter, er en REGEL, og regler hoerer i shared/ hvor baade serveren
 * og en test kan naa dem.
 */
function gemTitel(t) {
  const kind = t.kind === 'movie' ? 'movie' : 'tv';
  const id = titelId(kind, t.tmdbId);
  const data = JSON.stringify(t.data || {});
  db.prepare(`
    INSERT INTO titles (id, kind, tmdb_id, imdb_id, tvdb_id, name, year, status, data,
                        fetched_at, next_check_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      imdb_id = excluded.imdb_id, tvdb_id = excluded.tvdb_id, name = excluded.name,
      year = excluded.year, status = excluded.status, data = excluded.data,
      fetched_at = excluded.fetched_at, next_check_at = excluded.next_check_at`)
    .run(id, kind, Number(t.tmdbId), t.imdbId || null, t.tvdbId || null,
      String(t.name || ''), t.year ? Number(t.year) : null, t.status || null, data,
      now(), beregn.naesteTjek(t.status, t.naesteUdsendelse, now()));
  return id;
}

/**
 * Soeger i de titler, der ALLEREDE er hentet.
 *
 * Svarer med det samme og uden et TMDB-kald, saa fladen kan vise "det her har
 * du" foer det, der skal hentes. LIKE med to jokere er godt nok: en husstands
 * bibliotek er hundreder af titler, ikke millioner - og maalet skal tages
 * igen, den dag det ikke passer.
 */
function soegLokalt(userId, tekst, graense) {
  const q = `%${String(tekst || '').trim().toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT t.* FROM titles t
     WHERE lower(t.name) LIKE ?
     ORDER BY t.name LIMIT ?`).all(q, Math.min(Number(graense) || 20, 50));
  const mine = new Set(hentItems(userId, { kind: 'tracking' }).map((x) => x.titleId));
  return rows.map((row) => Object.assign(JSON.parse(row.data), {
    id: row.id, kind: row.kind, tmdbId: row.tmdb_id, name: row.name,
    year: row.year, status: row.status, tracked: mine.has(row.id),
  }));
}

/** Afsnittene for én titel, i sendeorden. */
function hentAfsnit(titleId) {
  return db.prepare(
    `SELECT id, season, number, name, air_date, runtime FROM episodes
      WHERE title_id = ? ORDER BY season, number`).all(String(titleId || ''))
    .map((r) => ({
      id: r.id, season: r.season, number: r.number,
      name: r.name, airDate: r.air_date, runtime: r.runtime,
    }));
}

/**
 * ÉT afsnit med alt paa - inkl. resume og billede.
 *
 * Modsat hentAfsnit(), der bevidst er LET: den henter ikke `data`, fordi et
 * listesvar med 351 resuméer er praecis den haandfuld megabytes, Kokkeri
 * laerte at holde ude af lister (§4). Resuméet hentes derfor ét ad gangen,
 * naar nogen faktisk vil laese det.
 */
function hentEtAfsnit(episodeId) {
  const row = db.prepare(
    `SELECT id, title_id, season, number, name, air_date, runtime, data
       FROM episodes WHERE id = ?`).get(String(episodeId || ''));
  if (!row) return null;
  const data = JSON.parse(row.data || '{}');
  return {
    id: row.id,
    titleId: row.title_id,
    season: row.season,
    number: row.number,
    name: row.name,
    airDate: row.air_date,
    runtime: row.runtime,
    overview: data.overview || '',
    stillPath: data.stillPath || null,
  };
}

/**
 * Skriver en hel saesons afsnit.
 *
 * Afsnit FJERNES ikke, selv om TMDB holder op med at naevne dem. En bruger,
 * der har markeret et afsnit set, skal ikke miste markeringen, fordi en
 * frivillig omnummererede en saeson. Det er en bevidst asymmetri: vi
 * tilfoejer og opdaterer, men sletter aldrig af os selv.
 */
function gemAfsnit(titleId, liste) {
  const ind = db.prepare(`
    INSERT INTO episodes (id, title_id, season, number, name, air_date, runtime, data)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, air_date = excluded.air_date,
      runtime = excluded.runtime, data = excluded.data`);
  db.exec('BEGIN');
  try {
    for (const e of liste || []) {
      const id = afsnitId(titleId, e.season, e.number);
      ind.run(id, titleId, Number(e.season), Number(e.number), e.name || null,
        e.airDate || null, e.runtime ? Number(e.runtime) : null,
        JSON.stringify(e.data || {}));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* ------------------------------------------------------- rensning */

/*
 * Ét sted, hvor ALT brugerinput bliver til de felter, modellen kender.
 * Ruterne renser ikke selv - de kalder gemItem, og gemItem kalder herned.
 */

function tal(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.round(n), min), max);
}

/** ISO-dato (YYYY-MM-DD) eller null. Ingen tidspunkter, ingen tidszoner. */
function dato(v) {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function renseItem(kind, raa) {
  const ud = {};
  for (const felt of FELTER[kind]) {
    if (!(felt in raa)) continue;
    const v = raa[felt];
    switch (felt) {
      // Tidsstempler i sekunder. Loftet paa 1e11 er aar 5138 - rigeligt, og
      // det fanger den klassiske fejl at sende millisekunder.
      case 'startedAt': case 'finishedAt': case 'droppedAt': case 'addedAt':
      case 'ratedAt':
        ud[felt] = v === null ? null : tal(v, 0, 1e11);
        break;
      case 'score':
        // 1-10 som heltal. TMDB og Trakt regner i tiendedele; det goer vi
        // ikke, fordi ingen kan skelne 7,3 fra 7,4 om sin egen smag.
        ud[felt] = v === null ? null : tal(v, 1, 10);
        break;
      case 'position':
        ud[felt] = tal(v, 0, 1e6) || 0;
        break;
      case 'favorite': case 'hideSpecials': case 'notifyNew': case 'spoiler':
      case 'shared': case 'household':
        ud[felt] = bool(v);
        break;
      case 'state':
        // En ukendt tilstand bliver til 'watchlist' frem for at blive gemt.
        // En import med et fremmed ord maa ikke kunne skabe en sjette
        // tilstand, som ingen visning filtrerer paa - saa forsvinder titlen
        // bare fra fladen, uden at noget fejler.
        ud[felt] = STATES.has(v) ? v : 'watchlist';
        break;
      case 'body':
        // Noten er markdown og maa fylde. Loftet er MAX_ITEM_JSON's ansvar;
        // her klippes kun det urimelige.
        ud[felt] = str(v, 50000);
        break;
      case 'description':
        ud[felt] = str(v, 2000);
        break;
      case 'shareToken':
        // Tokenet saettes ALDRIG af klienten - kun af serveren, naar en liste
        // deles. Kom det ind udefra, kunne to lister faa samme token, og
        // delingslinket ville pege paa den forkerte.
        break;
      default:
        ud[felt] = str(v, 300);
    }
  }
  return ud;
}

/* ------------------------------------------------------------ kalender */

/**
 * Kommende (og nyligt sendte) afsnit for de serier, brugeren foelger.
 *
 * Slaar op paa DATOINTERVAL paa tvaers af alle titler - derfor indekset paa
 * episodes(air_date). Uden det er en kalendermaaned en fuld scanning af hvert
 * eneste afsnit i biblioteket.
 */
function kalender(userId, fra, til) {
  const fulgte = hentItems(userId, { kind: 'tracking' })
    .filter((t) => t.state !== 'dropped')
    .map((t) => t.titleId);
  if (!fulgte.length) return [];

  const ud = [];
  // SQLite's parametergraense er 999 - spoerg i bidder.
  for (let i = 0; i < fulgte.length; i += 400) {
    const bid = fulgte.slice(i, i + 400);
    const rows = db.prepare(`
      SELECT e.id, e.title_id, e.season, e.number, e.name, e.air_date, e.runtime,
             t.name AS title_name, t.data AS title_data
        FROM episodes e JOIN titles t ON t.id = e.title_id
       WHERE e.air_date IS NOT NULL AND e.air_date >= ? AND e.air_date <= ?
         AND e.title_id IN (${bid.map(() => '?').join(',')})
       ORDER BY e.air_date, t.name, e.season, e.number`).all(fra, til, ...bid);
    for (const r of rows) {
      let plakat = null;
      try { plakat = JSON.parse(r.title_data || '{}').posterPath || null; } catch { /* ligegyldigt */ }
      ud.push({
        id: r.id,
        titleId: r.title_id,
        titleName: r.title_name,
        posterPath: plakat,
        season: r.season,
        number: r.number,
        name: r.name,
        airDate: r.air_date,
        runtime: r.runtime,
      });
    }
  }
  // Specials udelades ikke her: staar de i kalenderen, er det fordi de
  // FAKTISK sendes den dag, og saa er de en begivenhed som alle andre.
  ud.sort((a, b) => (a.airDate < b.airDate ? -1 : a.airDate > b.airDate ? 1 : 0));
  return ud;
}

/* ------------------------------------------------------------ ical-feed */

function hentIcalFeed(userId, opret) {
  const r = db.prepare(
    'SELECT token FROM ical_feeds WHERE user_id = ? AND revoked_at IS NULL').get(userId);
  if (r) return r.token;
  if (!opret) return null;
  // base64url og ikke hex: kortere adresse, samme entropi.
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO ical_feeds (token, user_id, created_at) VALUES (?,?,?)')
    .run(token, userId, now());
  audit('ical-feed-oprettet', userId, null);
  return token;
}

function findIcalFeed(raa) {
  return db.prepare(
    'SELECT token, user_id FROM ical_feeds WHERE token = ? AND revoked_at IS NULL')
    .get(String(raa || '')) || null;
}

function tilbagekaldIcal(userId) {
  const r = db.prepare(
    'UPDATE ical_feeds SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(now(), userId);
  if (r.changes) audit('ical-feed-tilbagekaldt', userId, null);
  return r.changes > 0;
}

function icalEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/* iCal-linjer maa hoejst vaere 75 OKTETTER. Foldes der paa tegn i stedet for
   bytes, knaekker en linje midt i et ae/oe/aa, og hele begivenheden afvises
   af nogle kalendere. */
function foldLinje(linje) {
  const b = Buffer.from(linje, 'utf8');
  if (b.length <= 75) return linje;
  const dele = [];
  let start = 0;
  while (start < b.length) {
    let slut = Math.min(start + (start === 0 ? 75 : 74), b.length);
    // Ryk tilbage til en tegngraense (fortsaettelsesbytes er 10xxxxxx).
    while (slut < b.length && (b[slut] & 0xc0) === 0x80) slut--;
    dele.push((start === 0 ? '' : ' ') + b.slice(start, slut).toString('utf8'));
    start = slut;
  }
  return dele.join('\r\n');
}

/**
 * Bygger feedet.
 *
 * Afsnit er HELDAGS-begivenheder. Et afsnit sendes paa en dato i sin egen
 * tidszone; gav vi det et klokkeslaet, ville det flytte sig en dag for nogen
 * - og det er praecis den slags, en kalender goer synligt hver uge.
 */
function byggIcal(userId) {
  const idag = beregn.isoDato(now());
  const fra = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const til = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
  const stempel = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const linjer = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//spolen//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icalEscape('spolen')}`,
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const e of kalender(userId, fra, til)) {
    const d = e.airDate.replace(/-/g, '');
    const naeste = new Date(`${e.airDate}T00:00:00Z`);
    naeste.setUTCDate(naeste.getUTCDate() + 1);
    linjer.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@spolen`,
      `DTSTAMP:${stempel}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${naeste.toISOString().slice(0, 10).replace(/-/g, '')}`,
      foldLinje(`SUMMARY:${icalEscape(`${e.titleName} S${e.season}E${e.number}`
        + (e.name ? ` · ${e.name}` : ''))}`),
      'END:VEVENT');
  }
  linjer.push('END:VCALENDAR');
  return linjer.join('\r\n') + '\r\n';
}

/* ------------------------------------------------- baggrundsopdatering */

/*
 * Holder metadata frisk (K7).
 *
 * Jobbet bor paa SERVEREN og ikke i en fane. En frontend-drevet loekke doer
 * med fanen, og en serie med ti saesoner tager sekunder - et helt bibliotek
 * tager minutter (§6c). Tilstanden ligger i memory: gaar serveren ned midt i
 * det, er der intet at rydde op, for `next_check_at` i databasen er den
 * rigtige hukommelse. Jobbet tager bare fat, hvor det slap.
 *
 * ÉT job ad gangen. To samtidige ville kalde TMDB dobbelt saa hurtigt og
 * skrive oven i hinanden.
 */
const opdaterJob = {
  koerer: false,
  faerdig: 0,
  ialt: 0,
  startet: null,
  sidsteTitel: '',
  fejl: [],
  stopOensket: false,
  sidsteKoersel: null,
};

/* Hoeflighed: ~1,2 sek. mellem titler, oven i de 250 ms mellem saesonkald
   inde i hver titel. TMDB skal ikke maerke, at et helt bibliotek opdateres. */
const PAUSE_MELLEM_TITLER = 1200;

function forfaldneTitler(graense) {
  return db.prepare(
    `SELECT id, kind, tmdb_id, name FROM titles
      WHERE next_check_at IS NOT NULL AND next_check_at <= ?
      ORDER BY next_check_at LIMIT ?`).all(now(), Math.min(Number(graense) || 200, 500));
}

function opdaterStatus() {
  return {
    running: opdaterJob.koerer,
    done: opdaterJob.faerdig,
    total: opdaterJob.ialt,
    startedAt: opdaterJob.startet,
    current: opdaterJob.sidsteTitel,
    errors: opdaterJob.fejl.slice(-5),
    lastRun: opdaterJob.sidsteKoersel,
    due: forfaldneTitler(500).length,
  };
}

async function koerOpdatering() {
  if (opdaterJob.koerer) return opdaterStatus();
  const noegle = getSetting('*', 'tmdb_key', '');
  // Ingen noegle er ikke en fejl - det er en installation, der ikke er sat op
  // endnu. Jobbet skal ikke larme om det hver time.
  if (!noegle) return opdaterStatus();

  const liste = forfaldneTitler(200);
  if (!liste.length) { opdaterJob.sidsteKoersel = now(); return opdaterStatus(); }

  Object.assign(opdaterJob, {
    koerer: true, faerdig: 0, ialt: liste.length, startet: now(),
    sidsteTitel: '', fejl: [], stopOensket: false,
  });
  log(`opdaterer ${liste.length} titler`);

  (async () => {
    for (const raekke of liste) {
      if (opdaterJob.stopOensket) { log('opdatering stoppet paa oenske'); break; }
      opdaterJob.sidsteTitel = raekke.name;
      try {
        const hentet = await tmdb.hentTitel(noegle, raekke.kind, raekke.tmdb_id, {
          sprog: metadataSprog(),
          pause: () => new Promise((r) => setTimeout(r, 250)),
        });
        gemTitel(hentet.titel);
        if (hentet.afsnit.length) gemAfsnit(raekke.id, hentet.afsnit);
          // Plakaten kan vaere skiftet - fx naar en serie faar ny saeson.
          if (hentet.titel.data && hentet.titel.data.posterPath) {
            await forhentPlakat(hentet.titel.data.posterPath);
          }
      } catch (err) {
        opdaterJob.fejl.push(`${raekke.name}: ${err.message}`);
        /*
         * Stop STRAKS ved en doed noegle eller rate-limit - hamr ikke videre
         * gennem 200 titler med et token, TMDB har afvist (§6b).
         */
        if (err.kode === 'tmdb_bad_key' || err.kode === 'tmdb_rate_limited') {
          logError(`opdatering afbrudt: ${err.message}`);
          // Titlen roeres IKKE. Fejlen er vores, ikke dens - skubbede vi den
          // frem, ville en time med en daarlig noegle udsaette HELE
          // biblioteket et doegn.
          break;
        }
        /*
         * Titlen selv fejlede (slettet paa TMDB, flettet, forkert id).
         *
         * Skub den frem ALLIGEVEL - ellers staar next_check_at i fortiden,
         * og saa hentes den hver eneste time for evigt og fejler hver gang.
         * Maalt: en syntetisk titel med et id, TMDB ikke kender, blev
         * liggende paa next_check_at = 1.
         *
         * Et doegn og ikke "aldrig igen": TMDB-poster bliver rettet og
         * flettet, saa en titel kan komme tilbage. Én forgaeves hentning om
         * dagen er en pris, der staar maal med det.
         */
        db.prepare('UPDATE titles SET next_check_at = ? WHERE id = ?')
          .run(now() + 86400, raekke.id);
      }
      opdaterJob.faerdig++;
      await new Promise((r) => setTimeout(r, PAUSE_MELLEM_TITLER));
    }
    opdaterJob.koerer = false;
    opdaterJob.sidsteKoersel = now();
    opdaterJob.sidsteTitel = '';
    log(`opdatering faerdig: ${opdaterJob.faerdig} af ${opdaterJob.ialt}`);
  })();

  return opdaterStatus();
}

/* --------------------------------------------------------- plex-webhook */

/**
 * Webhook-adressen for én bruger. Oprettes foerst naar den bedes om.
 *
 * ADRESSEN er hemmeligheden - Plex kan ikke sende cookies, praecis som en
 * kalender-app. Den kan tilbagekaldes ved at slette noeglen.
 */
function plexWebhookToken(userId, opret) {
  const findes = getSetting(userId, 'plex_webhook_token', '');
  if (findes) return findes;
  if (!opret) return null;
  const t = crypto.randomBytes(24).toString('base64url');
  setSetting(userId, 'plex_webhook_token', t);
  audit('plex-webhook-oprettet', userId, null);
  return t;
}

function findPlexWebhook(raa) {
  const r = db.prepare(
    `SELECT scope FROM settings WHERE key = 'plex_webhook_token' AND value = ?`)
    .get(String(raa || ''));
  return r ? r.scope : null;
}

/**
 * Tager imod én scrobble fra Plex.
 *
 * Kroppen laeses RAA (multipart), ikke som JSON. Loftet er lavt med vilje:
 * Plex sender et miniaturebillede med, og vi vil kun have tekstfeltet.
 */
async function haandterPlexWebhook(req, res, token) {
  const userId = findPlexWebhook(token);
  // Forkert token giver 404, ikke 403 - samme regel som iCal-feedet: et 403
  // ville bekraefte, at tokenet findes.
  if (!userId || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const bidder = [];
  let n = 0;
  await new Promise((resolve, reject) => {
    req.on('data', (b) => {
      n += b.length;
      if (n > 2 * 1024 * 1024) { req.destroy(); reject(new Error('for stor')); return; }
      bidder.push(b);
    });
    req.on('end', resolve);
    req.on('error', reject);
  }).catch(() => null);

  let payload = null;
  try {
    const felt = plex.laesMultipartFelt(Buffer.concat(bidder), req.headers['content-type'], 'payload');
    payload = felt ? JSON.parse(felt) : null;
  } catch { payload = null; }

  const raekke = payload ? plex.oversaetWebhook(payload) : null;
  /*
   * Kvitter ALTID med 200, ogsaa naar vi ikke bruger begivenheden.
   *
   * Plex sender play, pause, resume, stop og rate ved siden af scrobble. Et
   * fejlsvar paa dem ville faa Plex til at proeve igen og til sidst slaa
   * webhooken fra - for noget, der virker som det skal.
   */
  if (!raekke) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return; }

  /*
   * Er der valgt en Plex-konto, skal webhooken vaere FRA den konto. Uden
   * tjekket ville en andens afspilning paa den samme server lande i din
   * historik - og det er hele grunden til, at kontovalget findes.
   */
  const valgt = getSetting(userId, 'plex_account_id', '');
  const valgtNavn = getSetting(userId, 'plex_account_navn', '');
  if (valgt && valgtNavn && raekke.konto && raekke.konto !== valgtNavn) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true,"ignored":"other account"}');
    return;
  }

  try {
    // Én raekke ad gangen - webhooken er ikke et importjob og maa ikke
    // blokere et, der koerer.
    if (!importJob.koerer) {
      await koerImportRaekker(userId, [raekke], 'Plex webhook', []);
    }
  } catch (err) {
    log(`plex-webhook: ${err.message}`);
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"ok":true}');
}

/* --------------------------------------------------------- plex-hentning */

/**
 * Henter ny historik fra brugerens Plex-server og koerer den gennem den
 * FAELLES importmotor.
 *
 * `plex_last_sync` gemmer det nyeste `viewedAt`, vi har set. Naeste hentning
 * stopper dér - en Plex-server kan have aars historik, og at hente det hele
 * hver tiende minut ville vaere spild i begge ender.
 */
async function hentFraPlex(userId, opts) {
  const o = opts || {};
  const url = getSetting(userId, 'plex_url', '');
  const token = getSetting(userId, 'plex_token', '');
  if (!url || !token) {
    throw Object.assign(new Error('Connect your Plex server first.'),
      { status: 400, kode: 'plex_not_connected' });
  }
  const siden = o.alt ? 0 : Number(getSetting(userId, 'plex_last_sync', '0')) || 0;
  const accountId = getSetting(userId, 'plex_account_id', '') || null;

  const poster = await plex.hentHistorik(url, token, {
    siden, accountId, pause: () => new Promise((r) => setTimeout(r, 200)),
  });
  if (!poster.length) return Object.assign(importStatus(), { fetched: 0 });

  /*
   * GUID'erne slaas op pr. UNIK titel, ikke pr. post. En serie med 60 sete
   * afsnit giver ét opslag - ellers hamrer en foerste hentning serveren i
   * minutter for det samme svar tres gange.
   */
  const guids = new Map();
  for (const noegle of plex.noeglerAtSlaaOp(poster)) {
    try {
      guids.set(noegle, await plex.hentGuids(url, token, noegle));
    } catch {
      // En titel uden GUID'er falder tilbage paa titel+aar i matchningen.
      guids.set(noegle, {});
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  const raekker = plex.oversaetHistorik(poster, guids);
  // Nyeste viewedAt gemmes FOER importen: gaar den galt undervejs, er det
  // bedre at springe lidt over end at hente det hele igen i en loekke.
  const nyeste = poster.reduce((m, p) => Math.max(m, Number(p.viewedAt) || 0), siden);
  if (nyeste > siden) setSetting(userId, 'plex_last_sync', String(nyeste));

  return Object.assign(
    await koerImportRaekker(userId, raekker, 'Plex', []),
    { fetched: raekker.length });
}

/*
 * Automatisk hentning hvert tiende minut.
 *
 * Plex' webhooks ville give oejeblikkelig besked, men de kraever Plex Pass -
 * saa polling er STANDARDEN her, ikke reserven. Ti minutters forsinkelse er
 * rigeligt til alt andet end en "ser lige nu"-visning.
 */
function plexBrugere() {
  return db.prepare(
    `SELECT DISTINCT scope FROM settings WHERE key = 'plex_url' AND value != ''`)
    .all().map((r) => r.scope).filter((s) => s !== '*');
}

async function plexTik() {
  if (importJob.koerer) return;          // ét job ad gangen
  for (const userId of plexBrugere()) {
    try {
      const r = await hentFraPlex(userId, {});
      if (r.fetched) log(`plex: ${r.fetched} nye visninger for ${userId}`);
    } catch (err) {
      // En slukket hjemmeserver er den normale tilstand om natten - det er
      // ikke en fejl, der skal larme i panelets watcher.
      log(`plex-hentning sprunget over: ${err.message}`);
    }
    if (importJob.koerer) break;
  }
}

/* ------------------------------------------------------------- import */

/**
 * Laeser MANGE filer som ÉN import.
 *
 * En Trakt-eksport er ikke én fil: historikken er delt over
 * watched-history-1..17.json, og watchlist og bedoemmelser ligger for sig.
 * At vaelge "den stoerste fil" ville importere en syttendedel af historikken
 * og se vellykket ud (Andreas' eksport, 2026-08-29).
 *
 * Filer, der ikke kan genkendes, springes over MED NAVN i svaret - en
 * GDPR-eksport indeholder ogsaa profiler, indstillinger og kommentarer, og
 * brugeren skal kunne se, at de blev sprunget over med vilje.
 */
function laesFiler(filer, valg) {
  const raekker = [];
  const sprunget = [];
  const brugte = [];
  const ignorerede = [];
  for (const f of filer || []) {
    const navn = String(f.navn || 'fil');
    const r = importer.laesFil(String(f.tekst || ''), valg);
    if (r.fejl || !r.raekker.length) { ignorerede.push(navn); continue; }
    brugte.push({ navn, format: r.formatNavn, raekker: r.raekker.length });
    raekker.push(...r.raekker);
    for (const sp of r.sprunget) sprunget.push(Object.assign({ fil: navn }, sp));
  }
  /*
   * Dubletter paa tvaers af filer er normalt i en Trakt-eksport:
   * watched-movies.json gentager det, watched-history staar for. Uden
   * frafiltrering her ville de blive sendt til importmotoren to gange -
   * dubletnoeglen fanger dem, men det er spild af tid og af TMDB-kald.
   */
  const set = new Set();
  const unikke = [];
  for (const r of raekker) {
    const n = [r.type, r.ids.tmdb || r.ids.imdb || r.title, r.season, r.number,
      r.watchedAt ? Math.floor(r.watchedAt / 86400) : ''].join('|');
    if (set.has(n)) continue;
    set.add(n);
    unikke.push(r);
  }
  return { raekker: unikke, sprunget, brugte, ignorerede, dubletter: raekker.length - unikke.length };
}


/*
 * Importjobbet (F3).
 *
 * Ligger paa SERVEREN som baggrundsjob. En historik fra Trakt kan vaere
 * titusinder af raekker, og matchningen mod TMDB tager minutter - en
 * frontend-drevet loekke doer med fanen (§6c). Frontenden poller og viser
 * fremdrift; brugeren kan lukke browseren.
 *
 * DEN VIGTIGSTE OPTIMERING er opslags-cachen: en Netflix-eksport med 300
 * afsnit af samme serie maa give ÉT titelopslag, ikke 300. Uden den ville
 * importen baade tage en time og braende TMDB-kald af paa det samme svar.
 */
/*
 * Aabne Trakt-logins. I MEMORY med vilje: en device_code lever et par
 * minutter og hoerer til et paabegyndt login, ikke til brugeren. Genstarter
 * serveren imens, skal man starte forfra - og det er den rigtige opfoersel,
 * ikke et tab.
 */
const traktLogins = new Map();

/*
 * De adresser, opdagelsen fandt. I MEMORY: en plex.direct-adresse indeholder
 * et maskin-id og kan skifte, saa den skal ikke ligge og blive gammel i
 * databasen. Gaar serveren ned imellem, soeger man bare igen.
 */
const plexServerCache = new Map();

const importJob = {
  koerer: false,
  userId: null,
  faerdig: 0,
  ialt: 0,
  tilfoejet: 0,
  dubletter: 0,
  nyeTitler: 0,
  umatchede: [],
  fejl: [],
  stopOensket: false,
  format: null,
  startet: null,
  sidsteKoersel: null,
};

function importStatus() {
  return {
    running: importJob.koerer,
    done: importJob.faerdig,
    total: importJob.ialt,
    added: importJob.tilfoejet,
    duplicates: importJob.dubletter,
    newTitles: importJob.nyeTitler,
    // Kun de foerste 200 sendes med - en fil med tusindvis af umatchede
    // raekker maa ikke goere status-svaret til en megabyte ved hver polling.
    unmatched: importJob.umatchede.slice(0, 200),
    unmatchedTotal: importJob.umatchede.length,
    errors: importJob.fejl.slice(-5),
    format: importJob.format,
    startedAt: importJob.startet,
    lastRun: importJob.sidsteKoersel,
  };
}

/**
 * Finder den TMDB-titel, en importraekke peger paa.
 *
 * Raekkefoelgen er efter PAALIDELIGHED, ikke efter hvad der er hurtigst:
 *   1. tmdb-id fra eksporten  - eksakt, intet opslag.
 *   2. imdb/tvdb-id           - eksakt, ét opslag.
 *   3. titel + aarstal        - et GAET. To film kan hedde det samme.
 *
 * `cache` deles paa tvaers af hele koerslen (se ovenfor).
 */
async function findTitel(noegle, r, cache, sprog) {
  const erSerie = r.type === 'episode' || r.type === 'show';
  const kind = erSerie ? 'tv' : 'movie';

  if (r.ids && r.ids.tmdb) return { kind, tmdbId: r.ids.tmdb, sikker: true };

  const noegleStreng = `${kind}|${(r.ids && (r.ids.imdb || r.ids.tvdb)) || ''}|`
    + `${String(r.title).toLowerCase()}|${r.year || ''}`;
  if (cache.has(noegleStreng)) return cache.get(noegleStreng);

  let fund = null;
  for (const kilde of ['imdb', 'tvdb']) {
    if (fund || !r.ids || !r.ids[kilde]) continue;
    try {
      const t = await tmdb.findVedEksterntId(noegle, kilde, r.ids[kilde]);
      if (t) fund = { kind: t.kind, tmdbId: t.tmdbId, sikker: true, season: t.season, number: t.number };
    } catch { /* faldes tilbage til titelsoegning */ }
  }

  if (!fund) {
    try {
      const svar = await tmdb.soeg(noegle, r.title, { sprog });
      const kandidater = svar.results.filter((k) => k.kind === kind);
      // Med et aarstal kraeves der enighed inden for ét aar: udgivelsesaar
      // og "set-aar" afviger tit med et, naar noget udkom hen over nytaar.
      const traef = r.year
        ? kandidater.find((k) => k.year && Math.abs(k.year - r.year) <= 1)
        : kandidater[0];
      if (traef) {
        fund = {
          kind, tmdbId: traef.tmdbId,
          // Uden aarstal er det ikke sikkert - saa er det bare det mest
          // populaere navnesammenfald.
          sikker: !!r.year,
        };
      }
    } catch (err) {
      if (err.kode === 'tmdb_bad_key' || err.kode === 'tmdb_rate_limited') throw err;
    }
  }
  cache.set(noegleStreng, fund);
  return fund;
}

/** Sikrer at titlen ER i den lokale cache - henter den fra TMDB om noedvendigt. */
async function sikrTitel(noegle, kind, tmdbId, sprog) {
  const id = titelId(kind, tmdbId);
  if (hentTitel(id)) return { id, ny: false };
  const hentet = await tmdb.hentTitel(noegle, kind, tmdbId, {
    sprog, pause: () => new Promise((r) => setTimeout(r, 250)),
  });
  gemTitel(hentet.titel);
  if (hentet.afsnit.length) gemAfsnit(id, hentet.afsnit);
  /*
   * Plakaten hentes med det samme, saa et nyimporteret bibliotek ikke staar
   * med tomme felter. Det er ét billede pr. titel - de afsnit, vi lige har
   * hentet, faar ikke deres egne.
   */
  if (hentet.titel.data && hentet.titel.data.posterPath) {
    await forhentPlakat(hentet.titel.data.posterPath);
  }
  return { id, ny: true };
}

async function koerImport(userId, tekst, valg) {
  const noegle = tmdbNoegle();
  const laest = importer.laesFil(tekst, { dateOrder: (valg || {}).dateOrder });
  if (laest.fejl) throw Object.assign(new Error(laest.fejl), { status: 400, kode: 'bad_format' });
  return koerImportRaekker(userId, laest.raekker, laest.formatNavn, laest.sprunget);
}

/**
 * Motoren. Tager NORMALISEREDE raekker - uanset om de kom fra en fil eller
 * fra Trakts API.
 *
 * Der maa ikke findes to veje ind i historikken: matchningen, hentningen af
 * nye titler og skrivningen skal vaere den samme, ellers opfoerer de to
 * importveje sig forskelligt paa de svaere raekker - og det er praecis dem,
 * der betyder noget.
 */
async function koerImportRaekker(userId, raekker, formatNavn, sprunget) {
  if (importJob.koerer) {
    throw Object.assign(new Error('An import is already running.'), { status: 409, kode: 'busy' });
  }
  const noegle = tmdbNoegle();
  const laest = { raekker };
  Object.assign(importJob, {
    koerer: true, userId, faerdig: 0, ialt: raekker.length,
    tilfoejet: 0, dubletter: 0, nyeTitler: 0, umatchede: [], fejl: [],
    stopOensket: false, format: formatNavn, startet: now(),
  });
  // Raekker, kilden selv sprang over, tages med som umatchede - ellers
  // forsvinder de mellem to lag uden at nogen faar det at vide.
  for (const sp of sprunget || []) {
    importJob.umatchede.push({ linje: sp.linje, titel: '(unreadable row)', grund: sp.grund });
  }

  const sprog = metadataSprog();
  const cache = new Map();

  (async () => {
    let pulje = [];
    const skyl = () => {
      if (!pulje.length) return;
      try {
        const r = gemWatches(userId, pulje);
        importJob.tilfoejet += r.tilfoejet;
        importJob.dubletter += r.dubletter;
      } catch (err) {
        importJob.fejl.push(err.message);
      }
      pulje = [];
    };

    for (const r of laest.raekker) {
      if (importJob.stopOensket) { log('import stoppet paa oenske'); break; }
      try {
        const t = await findTitel(noegle, r, cache, sprog);
        if (!t) {
          importJob.umatchede.push({
            titel: r.title, aar: r.year, type: r.type,
            season: r.season, number: r.number, grund: 'no match on TMDB',
          });
          // Taelleren SKAL med, ogsaa naar raekken ikke kunne matches.
          // Uden den naar fremdriften aldrig 100 %, og et faerdigt job ser
          // ud til at haenge. (De andre continue-grene taeller allerede.)
          importJob.faerdig++;
          continue;
        }
        const { id, ny } = await sikrTitel(noegle, t.kind, t.tmdbId, sprog);
        if (ny) importJob.nyeTitler++;

        // Foelg titlen, hvis brugeren ikke allerede goer det.
        if (!hentTracking(userId, id)) {
          gemItem(userId, {
            kind: 'tracking', titleId: id,
            state: r.type === 'show' ? 'watchlist' : 'watching',
            addedAt: now(), source: 'import',
          });
        }

        /*
         * BEDOEMMELSEN gemmes FOER vagterne nedenfor.
         *
         * En bedoemmelse er gyldig, uanset om raekken ogsaa er en visning:
         * Trakts ratings-filer har hverken watched_at eller afsnit, saa de
         * ramte baade `show`-vagten og erVisning-vagten og blev sprunget
         * over. Maalt paa Andreas' eksport: 64 bedoemmelser i filen, 0 i
         * basen (2026-08-29).
         */
        if (r.rating) {
          let ratingAfsnit = null;
          if (r.season !== null && r.number !== null) {
            const kandidat = afsnitId(id, r.season, r.number);
            if (hentEtAfsnit(kandidat)) ratingAfsnit = kandidat;
          }
          gemItem(userId, {
            kind: 'rating', titleId: id, episodeId: ratingAfsnit,
            score: r.rating, ratedAt: r.watchedAt || now(),
          });
        }

        // En 'show'-raekke er en FOELGNING, ikke en visning - fx en
        // watchlist-eksport. Den maa ikke blive til et set afsnit.
        if (r.type === 'show') { importJob.faerdig++; continue; }

        let episodeId = null;
        if (r.type === 'episode') {
          const saeson = t.season !== undefined && t.season !== null ? t.season : r.season;
          const nummer = t.number !== undefined && t.number !== null ? t.number : r.number;
          if (saeson === null || nummer === null) {
            /*
             * Netflix giver afsnitsNAVN, ikke nummer. Slaa det op i de
             * afsnit, vi lige har hentet - det er den eneste vej fra
             * "Season 1: Good News" til et afsnits-id.
             */
            const navn = String(r.episodeName || '').toLowerCase();
            const kandidat = navn
              ? hentAfsnit(id).find((e) => String(e.name || '').toLowerCase() === navn
                  && (saeson === null || e.season === saeson))
              : null;
            if (!kandidat) {
              importJob.umatchede.push({
                titel: r.title, aar: r.year, type: r.type,
                season: r.season, number: r.number, episodeName: r.episodeName,
                grund: 'could not identify the episode',
              });
              importJob.faerdig++;
              continue;
            }
            episodeId = kandidat.id;
          } else {
            episodeId = afsnitId(id, saeson, nummer);
            // Findes afsnittet ikke i cachen, peger raekken paa noget, TMDB
            // ikke kender - fx en omnummereret saeson.
            if (!hentEtAfsnit(episodeId)) {
              importJob.umatchede.push({
                titel: r.title, aar: r.year, type: r.type,
                season: saeson, number: nummer, grund: 'no such episode on TMDB',
              });
              importJob.faerdig++;
              continue;
            }
          }
        }

        /*
         * Har eksporten ingen dato, bruges afsnittets udsendelsesdag efter
         * samme regel som massemarkeringen. Er der heller ikke en - fx en
         * film uden udgivelsesdato - markeres raekken 'undated', saa
         * statistikken kan holde den ude af aarsopgoerelsen frem for at
         * lade som om, den blev set i dag.
         */
        /*
         * Er raekken IKKE en visning, stopper vi her.
         *
         * En collection-post ("jeg har filen") maa aldrig blive til en
         * visning. Uden vagten faldt den igennem til udsendelsesdagen
         * nedenfor og blev registreret som set - 4.250 afsnit i Andreas'
         * eksport (2026-08-29). Titlen er fulgt; det er alt, den siger.
         */
        if (r.erVisning === false) { importJob.faerdig++; continue; }

        let naar = r.watchedAt;
        let kilde = 'import';
        if (!naar && episodeId) {
          const e = hentEtAfsnit(episodeId);
          naar = e && e.airDate ? datoTilEpoke(e.airDate) : null;
        }
        if (!naar) { naar = now(); kilde = 'undated'; }
        pulje.push({ titleId: id, episodeId, watchedAt: naar, source: kilde });
        if (pulje.length >= 100) skyl();

      } catch (err) {
        importJob.fejl.push(`${r.title}: ${err.message}`);
        if (err.kode === 'tmdb_bad_key' || err.kode === 'tmdb_rate_limited') {
          logError(`import afbrudt: ${err.message}`);
          break;
        }
      }
      importJob.faerdig++;
    }
    skyl();
    importJob.koerer = false;
    importJob.sidsteKoersel = now();
    log(`import faerdig: ${importJob.tilfoejet} visninger, ${importJob.nyeTitler} nye titler, `
      + `${importJob.umatchede.length} umatchede`);
  })();

  return importStatus();
}

/* ---------------------------------------------------------------- push */

/*
 * Notifikationer om nye afsnit.
 *
 * VAPID-noeglerne hoerer til INSTALLATIONEN og laves én gang. Skifter den
 * offentlige noegle, doer alle eksisterende abonnementer - browseren binder
 * sit abonnement til netop den noegle. Derfor genereres de kun, hvis de
 * mangler, og de slettes aldrig af sig selv.
 */
function vapidNoegler() {
  let off = getSetting('*', 'vapid_offentlig', '');
  let priv = getSetting('*', 'vapid_privat', '');
  if (!off || !priv) {
    const n = pushModul.nyeVapidNoegler();
    setSetting('*', 'vapid_offentlig', n.offentlig);
    setSetting('*', 'vapid_privat', n.privat);
    off = n.offentlig; priv = n.privat;
    log('nye VAPID-noegler oprettet');
  }
  return { offentlig: off, privat: priv };
}

/*
 * `sub`-feltet i VAPID skal vaere en mailto: eller en https-adresse - det er
 * push-tjenestens vej til at kontakte afsenderen. Vi har ingen mailadresse
 * at give, og maa ikke opfinde brugerens, saa vi bruger serverens egen
 * adresse.
 */
function vapidEmne() {
  const d = getSetting('*', 'public_url', '');
  return d ? d.replace(/\/+$/, '') : 'mailto:spolen@localhost';
}

function pushAbonnementer(userId) {
  return db.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?')
    .all(userId).map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
}

/**
 * Sender én besked til alle en brugers enheder.
 *
 * Doede abonnementer SLETTES med det samme (404/410 fra push-tjenesten
 * betyder, at browseren er afmeldt). Bliver de liggende, sender vi til dem
 * for evigt og faar en voksende fejlrate, der ikke betyder noget.
 */
async function sendPush(userId, titel, tekst, url) {
  const abon = pushAbonnementer(userId);
  if (!abon.length) return { sendt: 0, doede: 0, ingen: true };
  const v = vapidNoegler();
  const krop = JSON.stringify({ title: titel, body: tekst, url: url || '/' });
  let sendt = 0;
  let doede = 0;
  for (const a of abon) {
    const r = await pushModul.send(a, krop, v, vapidEmne());
    if (r.ok) {
      sendt++;
      db.prepare('UPDATE push_subs SET last_ok_at = ?, fejl = 0 WHERE endpoint = ?')
        .run(now(), a.endpoint);
    } else if (r.doed) {
      doede++;
      db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(a.endpoint);
    } else {
      db.prepare('UPDATE push_subs SET fejl = fejl + 1 WHERE endpoint = ?').run(a.endpoint);
      log(`push fejlede (${r.status}): ${r.fejl || ''}`);
    }
  }
  return { sendt, doede };
}

/*
 * Hvem skal have besked om hvad?
 *
 * Kun afsnit, der sendes I DAG, af serier brugeren FOELGER - og kun én gang
 * pr. afsnit. Uden det sidste ville det timevise job sende den samme besked
 * 24 gange paa en dag, og folk slaar notifikationer fra efter den anden.
 */
async function pushOmNyeAfsnit() {
  const idag = beregn.isoDato(now());
  const sendteI = new Set(
    (getSetting('*', 'push_sendt', '') || '').split(',').filter(Boolean));
  let nye = 0;
  for (const u of db.prepare('SELECT id FROM users').all()) {
    if (getSetting(u.id, 'notify_new', '1') !== '1') continue;
    if (!pushAbonnementer(u.id).length) continue;
    for (const tr of hentItems(u.id, { kind: 'tracking' })) {
      if (tr.state !== 'watching' && tr.state !== 'watchlist') continue;
      if (tr.notifyNew === false) continue;
      const titel = hentTitel(tr.titleId);
      if (!titel || titel.kind !== 'tv') continue;
      for (const e of hentAfsnit(tr.titleId)) {
        if (e.airDate !== idag) continue;
        const noegle = `${u.id}:${e.id}`;
        if (sendteI.has(noegle)) continue;
        sendteI.add(noegle);
        nye++;
        await sendPush(u.id,
          titel.name,
          `S${e.season}E${e.number}${e.name ? ` · ${e.name}` : ''} airs today`,
          `/#title-${titel.id}`);
      }
    }
  }
  if (nye) {
    // Hold listen kort: kun de sidste 400 noegler. Den er en huskeseddel,
    // ikke en historik.
    setSetting('*', 'push_sendt', [...sendteI].slice(-400).join(','));
  }
  return nye;
}

/* --------------------------------------------------------------- oauth */

/**
 * Udsteder et access- og et refresh-token.
 *
 * Access-tokenet lander i `tokens` med et client_id og et udloeb - SAMME
 * tabel som de haandlavede noegler. Dermed valideres begge slags ad én vej,
 * og der er ét sted at tilbagekalde og rate-limite.
 */
function udstedTokens(clientId, scope, userId) {
  const adgang = opretToken(userId, `Connector ${clientId.slice(-8)}`, scope, {
    clientId, expiresAt: now() + oauth.ADGANG_LEVETID,
  });
  const forny = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO oauth_refresh (hash, token_id, client_id, scope, user_id, created_at)
              VALUES (?,?,?,?,?,?)`)
    .run(hashToken(forny), adgang.id, clientId, scope, userId, now());
  return {
    access_token: adgang.key,
    token_type: 'Bearer',
    expires_in: oauth.ADGANG_LEVETID,
    refresh_token: forny,
    scope,
  };
}

function findRefresh(raa) {
  return db.prepare(
    'SELECT client_id, scope, user_id FROM oauth_refresh WHERE hash = ? AND revoked_at IS NULL')
    .get(hashToken(String(raa || ''))) || null;
}

function tilbagekaldRefresh(raa) {
  db.prepare('UPDATE oauth_refresh SET revoked_at = ? WHERE hash = ? AND revoked_at IS NULL')
    .run(now(), hashToken(String(raa || '')));
}

const oauth = require('./oauth.js').opret({
  gemKlient(k) {
    db.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?,?,?,?)')
      .run(k.id, k.name, k.redirect_uris, now());
    audit('oauth-klient-registreret', k.name, null);
  },
  hentKlient(id) {
    return db.prepare('SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?')
      .get(String(id || '')) || null;
  },
  udstedTokens,
  findRefresh,
  tilbagekaldRefresh,
});

/* ------------------------------------------------------ samtykkesiden */

function escHtml(t) {
  return String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/*
 * Samtykkesiden har INGEN JavaScript.
 *
 * Det er ikke nostalgi: siden er den ene flade, hvor en fremmed klient sender
 * brugeren hen, og en almindelig <form method="post"> med to submit-knapper
 * kan ikke goere andet end det, den ser ud til. CSP'en kan derfor vaere
 * strammere her end i selve appen (§9a).
 */
function oauthSide(titel, indhold) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(titel)} — spolen</title>
<style>
:root{color-scheme:light dark}
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;
 display:flex;min-height:100vh;align-items:center;justify-content:center;
 background:#141210;color:#f3efe9;padding:20px}
.k{max-width:440px;width:100%;background:#1c1917;border:1px solid #33302c;
 border-radius:14px;padding:26px}
h1{font-size:1.25rem;margin:0 0 6px}
p{color:#a9a19a}
.n{color:#e8c07d;font-weight:600}
ul{color:#a9a19a;padding-left:20px}
form{display:flex;gap:10px;margin-top:20px}
button{font:inherit;padding:10px 18px;border-radius:9px;border:1px solid #33302c;cursor:pointer}
button.j{background:#e8c07d;color:#1c1917;border-color:transparent;font-weight:600}
button.n2{background:transparent;color:#a9a19a}
code{background:#26231f;padding:2px 6px;border-radius:5px;font-size:.9em}
</style></head><body><div class="k">${indhold}</div></body></html>`;
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // Samtykkesiden maa ALDRIG kunne rammes ind: en usynlig iframe med et
    // klik oveni ville vaere en tilladelse, brugeren aldrig gav.
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  });
  res.end(html);
}

async function haandterOauth(req, res, urlPath, query) {
  /*
   * FAELDE: de offentlige OAuth-ruter maa IKKE gennem securityHeaders().
   *
   * De skal have Access-Control-Allow-Origin: *, men
   * Cross-Origin-Resource-Policy: same-origin faar browseren til at afvise
   * svaret alligevel - og saa staar der intet i netvaerkspanelet at fejlsoege
   * paa. (Dodas fælde 3.)
   */
  const cors = () => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, mcp-protocol-version');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  };
  const json = (status, krop) => {
    cors();
    const t = JSON.stringify(krop);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(t) });
    res.end(t);
  };

  if (req.method === 'OPTIONS') { cors(); res.writeHead(204); res.end(); return; }

  /* -------- opdagelse: de to dokumenter, klienten finder rundt efter -------- */
  if (urlPath === '/.well-known/oauth-protected-resource'
      || urlPath === '/.well-known/oauth-protected-resource/mcp') {
    json(200, oauth.beskyttetRessource(req));
    return;
  }
  if (urlPath === '/.well-known/oauth-authorization-server') {
    json(200, oauth.serverMetadata(req));
    return;
  }

  /* -------------------------- dynamisk registrering -------------------------- */
  if (urlPath === '/oauth/register') {
    if (req.method !== 'POST') { json(405, { error: 'method_not_allowed' }); return; }
    if (!rateAllow(`oauthreg:${clientIp(req)}`, 20, 3600)) {
      json(429, { error: 'too_many_requests' });
      return;
    }
    const krop = await readJsonBody(req, true);
    const r = oauth.registrer(krop);
    if (r.fejl) { json(400, { error: 'invalid_redirect_uri', error_description: r.fejl }); return; }
    json(201, r.klient);
    return;
  }

  /* -------------------------------- authorize -------------------------------- */
  if (urlPath === '/oauth/authorize') {
    /*
     * POST behandles FOERST og validerer ud fra KROPPEN.
     *
     * Foerste udgave validerede `query` oeverst, uanset metode - men en POST
     * baerer sine felter i kroppen, saa query var tom, og samtykket blev
     * afvist med "Unknown client". Beskeden var sand om en tom
     * foresproergsel og fuldstaendig vildledende om klienten.
     */
    if (req.method === 'POST') {
      const bruger0 = sessionUser(req);
      if (!bruger0) {
        sendHtml(res, 403, oauthSide('Cannot continue',
          '<h1>Cannot continue</h1><p>Your session ended. Sign in and try again.</p>'));
        return;
      }
      /*
       * Formularen er sidens EGEN CSRF-spaerre: den er den eneste flade i
       * appen, der ikke kraever Content-Type: application/json, saa et
       * fremmed site kunne ellers sende den. Derfor tjekkes Origin/Referer
       * mod vores egen vaert.
       */
      const oprindelse = req.headers.origin || req.headers.referer || '';
      const vaert = String(req.headers['x-forwarded-host'] || req.headers.host || '')
        .split(',')[0].trim();
      let egen = false;
      try { egen = new URL(oprindelse).host === vaert; } catch { egen = false; }
      if (!egen) {
        sendHtml(res, 403, oauthSide('Cannot continue',
          '<h1>Cannot continue</h1><p>That request did not come from spolen.</p>'));
        return;
      }

      const krop = await readJsonBody(req, true);
      const igen = oauth.tjekAutorisation(new URLSearchParams(krop));
      if (igen.fejl) {
        sendHtml(res, 400, oauthSide('Cannot continue',
          `<h1>Cannot continue</h1><p>${escHtml(igen.fejl)}</p>`));
        return;
      }
      if (krop.svar !== 'ja') {
        const url = new URL(igen.redirect);
        url.searchParams.set('error', 'access_denied');
        if (igen.state) url.searchParams.set('state', igen.state);
        res.writeHead(302, { Location: url.toString(), 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      audit('oauth-tilladelse', bruger0.username, igen.klient.name);
      res.writeHead(302, {
        Location: oauth.giveTilladelse(igen, bruger0.id),
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }
    if (req.method !== 'GET') { json(405, { error: 'method_not_allowed' }); return; }

    const oplysninger = oauth.tjekAutorisation(query);
    if (oplysninger.fejl) {
      sendHtml(res, 400, oauthSide('Cannot continue',
        `<h1>Cannot continue</h1><p>${escHtml(oplysninger.fejl)}</p>`));
      return;
    }

    const bruger = sessionUser(req);
    if (!bruger) {
      /*
       * Ikke logget ind. Vi viser IKKE et login her - brugeren sendes til
       * appens egen loginside med adressen at vende tilbage til. Ét sted at
       * logge ind betyder ét sted, hvor kodeord haandteres.
       */
      sendHtml(res, 200, oauthSide('Sign in first', `
        <h1>Sign in first</h1>
        <p><span class="n">${escHtml(oplysninger.klient.name)}</span> wants access to your
        spolen library. Sign in, then open this link again.</p>
        <form method="get" action="/"><button class="j" type="submit">Open spolen</button></form>`));
      return;
    }

    if (req.method === 'GET') {
      const felter = ['client_id', 'redirect_uri', 'response_type', 'scope',
        'code_challenge', 'code_challenge_method', 'state']
        .map((n) => `<input type="hidden" name="${n}" value="${escHtml(query.get(n) || '')}">`)
        .join('');
      const maa = oplysninger.scope === 'read'
        ? '<li>See your library, history and what is coming up</li>'
        : '<li>See your library, history and what is coming up</li>'
          + '<li>Mark things as watched and add titles</li>';
      sendHtml(res, 200, oauthSide('Allow access', `
        <h1>Allow access?</h1>
        <p><span class="n">${escHtml(oplysninger.klient.name)}</span> is asking to connect to
        spolen as <span class="n">${escHtml(visNavn(bruger.username))}</span>.</p>
        <p>It will be able to:</p><ul>${maa}</ul>
        <p>It can never see other people's libraries, and you can revoke it at any time
        under Settings → Access keys.</p>
        <form method="post" action="/oauth/authorize">${felter}
          <button class="j" type="submit" name="svar" value="ja">Allow</button>
          <button class="n2" type="submit" name="svar" value="nej">Deny</button>
        </form>`));
      return;
    }

  }

  /* ---------------------------------- token ---------------------------------- */
  if (urlPath === '/oauth/token') {
    if (req.method !== 'POST') { json(405, { error: 'method_not_allowed' }); return; }
    if (!rateAllow(`oauthtok:${clientIp(req)}`, 60, 3600)) {
      json(429, { error: 'slow_down' });
      return;
    }
    const krop = await readJsonBody(req, true);
    const type = krop.grant_type;
    let r;
    if (type === 'authorization_code') r = oauth.byttKode(krop);
    else if (type === 'refresh_token') r = oauth.forny(krop);
    else { json(400, { error: 'unsupported_grant_type' }); return; }
    if (r.fejl) { json(400, { error: r.fejl }); return; }
    json(200, r);
    return;
  }

  if (urlPath === '/oauth/revoke') {
    if (req.method !== 'POST') { json(405, { error: 'method_not_allowed' }); return; }
    const krop = await readJsonBody(req, true);
    // Baade et refresh- og et access-token kan sendes hertil.
    tilbagekaldRefresh(krop.token);
    db.prepare('UPDATE tokens SET revoked_at = ? WHERE hash = ? AND revoked_at IS NULL')
      .run(now(), hashToken(String(krop.token || '')));
    json(200, {});
    return;
  }

  json(404, { error: 'not_found' });
}

/* ----------------------------------------------------------------- mcp */

/**
 * Godkender et MCP-kald. KUN adgangsnoegler - ingen session-cookie.
 *
 * En MCP-klient er ikke en browser, og et cookie-baseret MCP-endepunkt ville
 * betyde, at et fremmed site kunne kalde det med brugerens egen session.
 */
function godkendMcp(req) {
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  const raa = m ? m[1] : String(req.headers['x-api-key'] || '');
  if (!raa) return null;
  const token = findToken(raa);
  if (!token) return null;
  if (!rateAllow(`mcp:${token.id}`, 600, 3600)) return null;
  const bruger = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?')
    .get(token.user_id);
  if (!bruger) return null;
  stemplBrug(token);
  return {
    user: { id: bruger.id, username: bruger.username, isAdmin: !!bruger.is_admin },
    token,
  };
}

/*
 * Broen mellem MCP-vaerktoejerne og appen.
 *
 * Hver funktion tager userId FOERST - samme regel som dataadgangen. Der er
 * ingen "aktuel bruger" at falde tilbage paa i en MCP-server: noeglen ER
 * brugeren.
 */
const mcp = mcpModul.opret({
  version: 1,
  logError,
  readJsonBody,
  godkendMcp,
  oauthUdfordring: (req) =>
    `Bearer realm="spolen", resource_metadata="${oauth.base(req)}/.well-known/oauth-protected-resource"`,
  maa: (auth, kraevet) => !!(auth && SCOPE_TILLADER[auth.token.scope]
    && SCOPE_TILLADER[auth.token.scope].has(kraevet)),

  upNext(userId) {
    const idag = beregn.isoDato(now());
    const ud = [];
    for (const tr of hentItems(userId, { kind: 'tracking' })) {
      if (tr.state !== 'watching' && tr.state !== 'watchlist') continue;
      const titel = hentTitel(tr.titleId);
      if (!titel || titel.kind !== 'tv') continue;
      const n = beregn.naesteUsete(hentAfsnit(tr.titleId), seteAfsnit(userId, tr.titleId),
        { idag, hideSpecials: tr.hideSpecials !== false });
      if (!n.klar && !n.naeste) continue;
      ud.push({ title: titel, next: n });
    }
    ud.sort((a, b) => ((a.next.klar ? 0 : 1) - (b.next.klar ? 0 : 1)));
    return ud;
  },

  async soeg(userId, q) {
    const lokale = soegLokalt(userId, q, 10);
    const setLokalt = new Set(lokale.map((l) => l.id));
    let fjerne = [];
    try {
      const svar = await tmdb.soeg(tmdbNoegle(), q, { sprog: sprogFor(userId) });
      fjerne = svar.results
        .map((r) => Object.assign({ id: `${r.kind}:${r.tmdbId}` }, r))
        .filter((r) => !setLokalt.has(r.id));
    } catch { /* uden TMDB er de lokale stadig et svar */ }
    return { local: lokale, tmdb: fjerne };
  },

  titel: (userId, id) => titelMedFremdrift(userId, id, beregn.isoDato(now())),

  markerSet(userId, id, saeson, nummer) {
    const titel = hentTitel(id);
    if (!titel) return { fejl: 'That title is not in the library. Add it first.' };
    let episodeId = null;
    let hvad = titel.name;
    if (titel.kind === 'tv') {
      if (!Number.isFinite(Number(saeson)) || !Number.isFinite(Number(nummer))) {
        return { fejl: 'A series needs both a season and an episode number.' };
      }
      episodeId = afsnitId(id, Number(saeson), Number(nummer));
      if (!hentEtAfsnit(episodeId)) {
        return { fejl: `${titel.name} has no season ${saeson} episode ${nummer}.` };
      }
      hvad = `${titel.name} S${saeson}E${nummer}`;
    }
    const r = gemWatch(userId, { titleId: id, episodeId, source: 'mcp' });
    return { hvad, dublet: r.dublet };
  },

  async tilfoej(userId, id, state) {
    const m = /^(tv|movie):(\d+)$/.exec(String(id || ''));
    if (!m) return { fejl: 'That is not a title id. Use search first to get one.' };
    const kind = m[1];
    const tmdbId = Number(m[2]);
    /*
     * ÉN vej ind: sikrTitel.
     *
     * Den samme hentning stod FIRE steder, og da plakat-forhentningen
     * blev lagt i sikrTitel, virkede den kun det ene: tilfoejede man en
     * titel fra fladen eller fra MCP, blev plakaten ikke hentet
     * (Andreas, 2026-08-29). Fire kopier er fire steder, den naeste
     * aendring skal huskes - og tre af dem bliver glemt.
     */
    await sikrTitel(tmdbNoegle(), kind, tmdbId, metadataSprog());
    const titel = hentTitel(id);
    if (!hentTracking(userId, id)) {
      gemItem(userId, {
        kind: 'tracking', titleId: id,
        state: STATES.has(state) ? state : 'watchlist',
        addedAt: now(), source: 'mcp',
      });
    }
    return { navn: titel.name };
  },

  kalender(userId, dage) {
    const fra = beregn.isoDato(now());
    const til = new Date(Date.now() + dage * 86400000).toISOString().slice(0, 10);
    return kalender(userId, fra, til).slice(0, 60);
  },

  stats(userId, aar) {
    const region = (getSetting(userId, 'region', 'DK') || 'DK').toUpperCase();
    const raekker = db.prepare(`
      SELECT w.watched_at, w.episode_id, w.source, e.runtime AS ep_runtime, t.data AS title_data
        FROM watches w JOIN titles t ON t.id = w.title_id
        LEFT JOIN episodes e ON e.id = w.episode_id
       WHERE w.user_id = ?`).all(userId);
    const poster = [];
    for (const r of raekker) {
      if (aar && new Date(r.watched_at * 1000).toISOString().slice(0, 4) !== aar) continue;
      let td = {};
      try { td = JSON.parse(r.title_data || '{}'); } catch { /* tom */ }
      poster.push({
        watchedAt: r.watched_at,
        type: r.episode_id ? 'episode' : 'movie',
        titleId: r.episode_id ? r.episode_id.replace(/:s\d+e\d+$/, '') : null,
        datoSikker: r.source !== 'undated',
        runtime: r.ep_runtime || td.runtime || null,
        genres: td.genres || [],
      });
    }
    const st = statistik.statistik(poster);
    return { total: st, topGenres: statistik.top(st.perGenre, 6) };
  },
});

/* --------------------------------------------------------------- ruter */

/** Samler det, en titelvisning har brug for, i ÉT svar. */
async function titelMedFremdrift(userId, id, idag) {
  const titel = hentTitel(id);
  if (!titel) return null;
  const tracking = hentTracking(userId, id);
  // Fladen maa ikke danne "i dag" selv - saa ville browserens tidszone
  // afgoere, om et afsnit er sendt.
  const ud = { title: titel, tracking, today: idag };
  if (titel.kind === 'tv') {
    const afsnit = hentAfsnit(id);
    const sete = seteAfsnit(userId, id);
    const opts = { idag, hideSpecials: tracking ? tracking.hideSpecials !== false : true };
    ud.episodes = afsnit.map((e) => Object.assign({ seen: sete.has(e.id) }, e));
    ud.next = beregn.naesteUsete(afsnit, sete, opts);
    ud.progress = beregn.fremdrift(afsnit, sete, opts);
  } else {
    ud.watched = hentWatches(userId, { titleId: id, graense: 50 });
  }

  /*
   * Hvor kan man se den (S1).
   *
   * Hentes doven: kun naar titlen aabnes, og kun hvis cachen er gammel.
   * At hente udbud for hele biblioteket paa forhaand ville vaere hundredvis
   * af TMDB-kald for noget, brugeren maaske aldrig kigger paa.
   *
   * Et manglende udbud er ikke en fejl - mange titler er ikke paa noget i
   * Danmark, og det er i sig selv svaret.
   */
  /*
   * Er filmen del af en samling, hentes den med. Kun for FILM: TMDB har
   * ingen samlinger for serier, og en serie har saesoner i stedet.
   */
  const noegle = getSetting('*', 'tmdb_key', '');
  if (titel.kind === 'movie' && titel.collectionId && noegle) {
    try {
      const c = await sikrSamling(noegle, titel.collectionId, metadataSprog());
      ud.collection = samlingForBruger(userId, c, id);
    } catch { /* en manglende samling maa ikke vaelte titelvisningen */ }
  }

  const region = (getSetting(userId, 'region', 'DK') || 'DK').toUpperCase();
  try {
    const cachet = await sikrProviders(getSetting('*', 'tmdb_key', ''), id, region);
    if (cachet) {
      ud.providers = cachet.data;
      ud.providerRegion = region;
      ud.onMyServices = paaMineTjenester(cachet, mineTjenester(userId));
      const aendring = udbudsAendring(cachet);
      // Kun hvis der ER en aendring - et tomt objekt i hvert svar ville
      // ligne, at der altid var nyt.
      if (aendring.kommet.length || aendring.forsvundet.length) ud.providerChange = aendring;
    }
  } catch { /* udbud maa aldrig vaelte titelvisningen */ }

  return ud;
}

/**
 * TMDB-noeglen, eller en fejl der siger hvad man skal goere.
 *
 * Noeglen er INSTALLATIONENS (scope '*'), ikke brugerens: der er ét hus og
 * én TMDB-konto. En fejl her skal pege paa Settings, ikke bare sige "nej" -
 * det er den hyppigste grund til, at soegningen ikke virker paa dag ét.
 */
function tmdbNoegle() {
  const n = getSetting('*', 'tmdb_key', '');
  if (!n) {
    throw Object.assign(
      new Error('No TMDB key yet. An administrator adds one under Settings.'),
      { status: 503, kode: 'no_tmdb_key' });
  }
  return n;
}

/** Brugerens sprogvalg til SOEGNING (ikke cachet, saa det maa gerne variere). */
function sprogFor(userId) {
  return getSetting(userId, 'language', 'en-US');
}

/** Sproget for alt, der skrives i metadata-cachen. Installationens. */
function metadataSprog() {
  return getSetting('*', 'metadata_language', 'en-US');
}

const ROUTES = {
  'GET /api/public-config': (req, res) => {
    sendJson(res, 200, {
      appName: APP_NAME,
      // Den version, SERVEREN udleverer. Stemmer den ikke med den, browseren
      // koerer, sidder der en gammel app.js i cachen - og det skal brugeren
      // vide frem for at lede efter en funktion, der ikke er indlaest.
      version: Number(APP_VERSION_FIL),
      needsSetup: userCount() === 0,
      // Skjuler ogsaa selve registreringslinket paa login-siden (§3).
      allowRegistration: tilladRegistrering(),
      secureContext: isHttps(req),
      dev: DEV,
    });
  },

  'GET /api/me': (req, res) => {
    const user = sessionUser(req);
    if (!user) { sendJson(res, 200, { user: null }); return; }
    sendJson(res, 200, {
      user,
      totp: totpStatus(user.id),
      // Kun FLAGENE - aldrig vaerdierne (§6b).
      integrations: {
        tmdbKeySet: !!getSetting('*', 'tmdb_key', ''),
        traktLinked: !!getSetting(user.id, 'trakt_access_token', ''),
        plexLinked: !!getSetting(user.id, 'plex_token', ''),
      },
    });
  },

  'POST /api/register': async (req, res) => {
    const ip = clientIp(req);
    if (!tilladRegistrering()) {
      logSecurity(`registrering-afvist ip=${ip}`);
      apiFejl(res, 403, 'registration_closed', 'Sign-up is closed on this server.');
      return;
    }
    if (!rateAllow(`register:${ip}`, 10, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many attempts — try again later.');
      return;
    }
    const body = await readJsonBody(req);
    const username = str(body.username, 64).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (username.length < 2) { apiFejl(res, 400, 'bad_username', 'The username is too short.'); return; }
    if (password.length < 8) {
      apiFejl(res, 400, 'bad_password', 'The password must be at least 8 characters.');
      return;
    }
    // Sammenlign med lower() - ellers er "Andreas" og "andreas" to konti (§3).
    if (db.prepare('SELECT 1 FROM users WHERE lower(username) = ?').get(username)) {
      apiFejl(res, 409, 'username_taken', 'That username is taken.');
      return;
    }
    const erFoerste = userCount() === 0;
    const id = newId();
    db.prepare('INSERT INTO users (id, username, password, is_admin, created_at) VALUES (?,?,?,?,?)')
      .run(id, username, hashPassword(password), erFoerste ? 1 : 0, now());
    audit('bruger-oprettet', username, erFoerste ? 'admin' : null);
    const token = createSession(id);
    sendJson(res, 200, { user: { id, username, isAdmin: erFoerste } },
      { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  },

  'POST /api/login': async (req, res) => {
    const ip = clientIp(req);
    if (!rateAllow(`login:${ip}`, 20, 900)) {
      apiFejl(res, 429, 'rate_limited', 'Too many sign-in attempts — try again later.');
      return;
    }
    const body = await readJsonBody(req);
    const username = str(body.username, 64).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const row = db.prepare('SELECT id, username, password, is_admin FROM users WHERE lower(username) = ?')
      .get(username);
    // Samme svar uanset om brugeren findes: ellers kan man opregne konti.
    if (!row || !verifyPassword(password, row.password)) {
      logSecurity(`login-fejl bruger=${username || '(tom)'} ip=${ip}`);
      apiFejl(res, 401, 'bad_credentials', 'That username or password is not right.');
      return;
    }
    const status = totpStatus(row.id);
    if (status.enabled) {
      const kode = str(body.code, 20);
      if (!kode) {
        // needsCode faar fladen til at FOLDE kodefeltet ud og lade brugernavnet
        // staa - i stedet for at rydde formularen som ved et forkert kodeord.
        apiFejl(res, 401, 'code_required', 'Enter your two-factor code.', { needsCode: true });
        return;
      }
      const tjek = tjekAndetTrin(row.id, kode);
      if (!tjek.ok) {
        logSecurity(`totp-fejl bruger=${row.username} ip=${ip}`);
        apiFejl(res, 401, 'bad_code', tjek.besked, { needsCode: true });
        return;
      }
    }
    rateClear(`login:${ip}`);
    audit('login', row.username, null);
    const token = createSession(row.id);
    sendJson(res, 200, { user: { id: row.id, username: row.username, isAdmin: !!row.is_admin } },
      { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  },

  'POST /api/logout': async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  },

  'POST /api/password': async (req, res) => {
    // requireUser, ikke godkend: én laekket adgangsnoegle maa ikke kunne give
    // sig selv varig adgang ved at skifte kodeordet (doda F2).
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const row = db.prepare('SELECT password FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(typeof body.current === 'string' ? body.current : '', row.password)) {
      apiFejl(res, 401, 'bad_credentials', 'That is not your current password.');
      return;
    }
    const ny = typeof body.next === 'string' ? body.next : '';
    if (ny.length < 8) {
      apiFejl(res, 400, 'bad_password', 'The new password must be at least 8 characters.');
      return;
    }
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(ny), user.id);
    // Alle ANDRE sessioner doer. Skifter man kodeord, er det tit netop fordi
    // man tror, nogen sidder med en aaben session.
    const denne = parseCookies(req.headers.cookie)[SESSION_COOKIE] || '';
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, denne);
    audit('kodeord-skiftet', user.username, null);
    sendJson(res, 200, { ok: true });
  },

  /* ---------------------------------------------------------- settings */

  'GET /api/settings': (req, res) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    sendJson(res, 200, {
      settings: hentSettings(g.user.id),
      // Installationens indstillinger er admins, men ALLE skal kunne se dem -
      // fladen skal fx vide, om TMDB er sat op, for at kunne sige hvorfor
      // soegningen ikke virker.
      shared: hentSettings('*'),
    });
  },

  'PUT /api/settings': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const ud = {};
    for (const [key, value] of Object.entries(body || {})) {
      if (!PERSONLIGE_SETTINGS.has(key)) {
        apiFejl(res, 400, 'unknown_setting', `"${key}" is not a setting you can change.`);
        return;
      }
      // 'services' er et array - gem det som JSON frem for "[object Object]".
      const raa = key === 'services' && Array.isArray(value)
        ? JSON.stringify(value.map(String).slice(0, 200))
        : String(value);
      setSetting(user.id, key, raa.slice(0, 8000));
      if (!HEMMELIGE_SETTINGS.has(key)) ud[key] = raa.slice(0, 8000);
    }
    sendJson(res, 200, { ok: true, settings: ud });
  },

  'PUT /api/admin/settings': async (req, res) => {
    const user = requireAdmin(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    for (const [key, value] of Object.entries(body || {})) {
      if (!INSTALLATION_SETTINGS.has(key)) {
        apiFejl(res, 400, 'unknown_setting', `"${key}" is not an installation setting.`);
        return;
      }
      setSetting('*', key, String(value).slice(0, 4000));
      audit('indstilling-aendret', key, HEMMELIGE_SETTINGS.has(key) ? '(hemmelig)' : String(value).slice(0, 100));
    }
    sendJson(res, 200, { ok: true, shared: hentSettings('*') });
  },

  /* ------------------------------------------------------------ items */

  'GET /api/items': (req, res, ctx) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    const kind = ctx.query.get('kind') || '';
    if (kind && !KINDS.has(kind)) {
      apiFejl(res, 400, 'unknown_kind', `Unknown kind "${kind}".`);
      return;
    }
    sendJson(res, 200, {
      items: hentItems(g.user.id, {
        kind: kind || undefined,
        titleId: ctx.query.get('titleId') || undefined,
      }),
    });
  },

  'POST /api/items': async (req, res) => {
    const g = godkend(req, res, 'write');
    if (!g) return;
    const body = await readJsonBody(req, g.viaToken);
    sendJson(res, 200, { item: gemItem(g.user.id, body) });
  },

  'POST /api/items/bulk': async (req, res) => {
    const g = godkend(req, res, 'write');
    if (!g) return;
    const body = await readJsonBody(req, g.viaToken, true);
    const liste = Array.isArray(body) ? body : body.items;
    sendJson(res, 200, { items: saveBulk(g.user.id, liste) });
  },

  /* ---------------------------------------------------------- historik */

  'GET /api/watches': (req, res, ctx) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    sendJson(res, 200, {
      watches: hentWatches(g.user.id, {
        titleId: ctx.query.get('titleId') || undefined,
        fra: ctx.query.get('from') || undefined,
        til: ctx.query.get('to') || undefined,
        graense: ctx.query.get('limit') || undefined,
      }),
    });
  },

  'POST /api/watches': async (req, res) => {
    const g = godkend(req, res, 'write');
    if (!g) return;
    const body = await readJsonBody(req, g.viaToken);
    sendJson(res, 200, gemWatch(g.user.id, body));
  },

  'POST /api/watches/bulk': async (req, res) => {
    const g = godkend(req, res, 'write');
    if (!g) return;
    const body = await readJsonBody(req, g.viaToken, true);
    const liste = Array.isArray(body) ? body : body.watches;
    sendJson(res, 200, gemWatches(g.user.id, liste));
  },

  /* ---------------------------------------------------------- sofalisten */

  /*
   * Lister, man kan dele med skriveret (H2).
   *
   * En "sofaliste" er ikke en ny slags data - det er en almindelig liste,
   * delt med `can_write`. Derfor er der ingen ny tabel: delingen ligger
   * allerede i shares, og en liste, alle kan laegge i, er den samme liste
   * set fra en anden bruger.
   *
   * DET AFGOERENDE er, at man kan se BAADE sine egne og dem, andre har delt -
   * og at de to ikke blandes sammen til én liste, hvor man ikke kan se, hvis
   * den er.
   */
  'GET /api/lists': (req, res) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    const mine = hentItems(g.user.id, { kind: 'list' }).map((l) => ({
      list: l, ejer: g.user.username, ejerId: g.user.id, minEgen: true, kanSkrive: true,
      items: hentItems(g.user.id, { kind: 'listItem' }).filter((i) => i.listId === l.id),
    }));

    /*
     * Delt MED mig. Hentes gennem delings-tildelingerne - ikke ved at
     * slaa user_id-filteret fra. hentItems betyder stadig "mit eget".
     */
    const delte = [];
    for (const d of hentDeltMedMig(g.user.id)) {
      if (d.subjectKind !== 'list' && d.subjectKind !== 'profile') continue;
      const ejerLister = d.subjectKind === 'profile'
        ? hentItems(d.ownerId, { kind: 'list' })
        : hentItems(d.ownerId, { kind: 'list', ids: [d.subjectId] });
      for (const l of ejerLister) {
        if (delte.some((x) => x.list.id === l.id)) continue;
        delte.push({
          list: l, ejer: d.owner, ejerId: d.ownerId, minEgen: false,
          kanSkrive: !!d.canWrite,
          items: hentItems(d.ownerId, { kind: 'listItem' }).filter((i) => i.listId === l.id),
        });
      }
    }

    // Titlerne slaas op ÉN gang for alle lister - ikke pr. element.
    const ids = [...new Set([...mine, ...delte].flatMap((l) => l.items.map((i) => i.titleId)))];
    const titler = new Map(hentTitler(ids).map((t) => [t.id, t]));
    const berig = (l) => Object.assign({}, l, {
      items: l.items
        .map((i) => Object.assign({}, i, { title: titler.get(i.titleId) || null }))
        .sort((a, b) => (a.position || 0) - (b.position || 0)),
    });
    sendJson(res, 200, { mine: mine.map(berig), shared: delte.map(berig) });
  },

  /*
   * Laeg en titel paa en liste - ogsaa en, der tilhoerer en anden.
   *
   * `maaSkrive` afgoer det, og den ser KUN paa en list-deling med can_write.
   * En profil-deling giver laeseadgang, ikke skriveadgang: at nogen viser
   * dig sin historik, betyder ikke, at du maa aendre i den.
   */
  'POST /api/lists/add': async (req, res) => {
    const g = godkend(req, res, 'write');
    if (!g) return;
    const body = await readJsonBody(req, g.viaToken);
    const listId = str(body.listId, 64);
    const titleId = str(body.titleId, 64);
    const ejerId = str(body.ownerId, 64) || g.user.id;
    if (!listId || !titleId) {
      apiFejl(res, 400, 'bad_request', 'listId and titleId are required.');
      return;
    }
    if (!maaSkrive(g.user.id, ejerId, listId)) {
      // 404 og ikke 403: man skal ikke kunne afsoege, hvilke lister andre har.
      apiFejl(res, 404, 'not_found', 'No such list.');
      return;
    }
    if (!hentItem(ejerId, listId)) { apiFejl(res, 404, 'not_found', 'No such list.'); return; }
    if (!hentTitel(titleId)) {
      apiFejl(res, 400, 'unknown_title', 'That title is not in the library yet.');
      return;
    }
    // Elementet gemmes hos LISTENS EJER - ellers ville det forsvinde for
    // ham selv, og listen ville se forskellig ud for hver deltager.
    const findes = hentItems(ejerId, { kind: 'listItem' })
      .find((i) => i.listId === listId && i.titleId === titleId);
    if (findes) { sendJson(res, 200, { item: findes, dublet: true }); return; }
    const item = gemItem(ejerId, {
      kind: 'listItem', listId, titleId,
      position: hentItems(ejerId, { kind: 'listItem' }).filter((i) => i.listId === listId).length,
      addedAt: now(),
    });
    sendJson(res, 200, { item, dublet: false });
  },

  'POST /api/lists/remove': async (req, res) => {
    const g = godkend(req, res, 'write');
    if (!g) return;
    const body = await readJsonBody(req, g.viaToken);
    const listId = str(body.listId, 64);
    const ejerId = str(body.ownerId, 64) || g.user.id;
    if (!maaSkrive(g.user.id, ejerId, listId)) {
      apiFejl(res, 404, 'not_found', 'No such list.');
      return;
    }
    const item = hentItems(ejerId, { kind: 'listItem' })
      .find((i) => i.listId === listId && i.titleId === str(body.titleId, 64));
    if (!item) { apiFejl(res, 404, 'not_found', 'Not on that list.'); return; }
    sletItem(ejerId, item.id);
    sendJson(res, 200, { ok: true });
  },

  /* ------------------------------------------------------------- deling */

  /*
   * Hvem kan jeg overhovedet dele med?
   *
   * Kun id og navn - ALDRIG noget om hvad de ser eller hvornaar de var her.
   * Listen findes for at kunne vaelge en person i en menu, og et endepunkt,
   * der giver mere end det, bliver brugt til mere end det.
   */
  'GET /api/people': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, {
      people: db.prepare('SELECT id, username FROM users WHERE id != ? ORDER BY username')
        .all(user.id),
    });
  },

  'GET /api/shares': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    // To retninger, to lister. "Jeg deler ud" og "der deles med mig" er ikke
    // det samme spoergsmaal, og en flad liste ville skjule hvem der bestemmer.
    sendJson(res, 200, { out: hentDelinger(user.id), in: hentDeltMedMig(user.id) });
  },

  'POST /api/shares': async (req, res) => {
    // requireUser og ikke godkend: at give en anden adgang til sin historik er
    // ikke noget, en adgangsnoegle til en telefon-genvej skal kunne.
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    sendJson(res, 200, { share: gemDeling(user.id, body) });
  },

  /*
   * Afproev TMDB-noeglen.
   *
   * Et rigtigt kald mod TMDB - ikke et formattjek. En noegle kan se rigtig ud
   * og stadig vaere tilbagekaldt, og det er praecis den forskel, brugeren
   * gerne vil kende, FOER han begynder at soege.
   */
  'GET /api/tmdb-status': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const noegle = getSetting('*', 'tmdb_key', '');
    if (!noegle) { sendJson(res, 200, { set: false, ok: false, message: 'No key yet.' }); return; }
    try {
      const svar = await tmdb.soeg(noegle, 'blade runner', { sprog: sprogFor(user.id) });
      sendJson(res, 200, {
        set: true, ok: true,
        // Noeglens FORM roebes (v3 eller v4), aldrig noeglen selv - den er
        // nyttig at kende, naar noget driller, og den er ikke hemmelig.
        format: tmdb.erBearer(noegle) ? 'read access token (v4)' : 'api key (v3)',
        message: `Works — TMDB answered with ${svar.results.length} results.`,
      });
    } catch (err) {
      sendJson(res, 200, { set: true, ok: false, message: err.message });
    }
  },

  /* ------------------------------------------------------- soeg og tilfoej */

  /*
   * Soegning (K2).
   *
   * Resultatet markeres med, hvad brugeren ALLEREDE har - ellers tilfoejer man
   * den samme serie to gange og opdager det foerst paa forsiden. Markeringen
   * slaas op i ét kald mod cachen, ikke ét pr. resultat.
   */
  'GET /api/search': async (req, res, ctx) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    const q = str(ctx.query.get('q'), 200);
    if (q.length < 2) { sendJson(res, 200, { results: [], query: q }); return; }
    if (!rateAllow(`soeg:${g.user.id}`, 120, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'That is a lot of searching. Try again shortly.');
      return;
    }
    /*
     * TO kilder, i den raekkefoelge de er nyttige:
     *
     *  1. LOKALT - det, der allerede er hentet. Svarer med det samme, uden
     *     net, og det er som regel dét, man leder efter: "hvor langt var jeg
     *     nu i den serie".
     *  2. TMDB - alt andet.
     *
     * Lokale traeffere fjernes fra TMDB-listen, saa den samme titel ikke
     * staar to gange med to forskellige knapper.
     */
    const lokale = soegLokalt(g.user.id, q, 20);
    const setLokalt = new Set(lokale.map((l) => l.id));

    let fjerne = [];
    let tmdbFejl = null;
    try {
      const svar = await tmdb.soeg(tmdbNoegle(), q, { sprog: sprogFor(g.user.id) });
      const mine = new Set(hentItems(g.user.id, { kind: 'tracking' }).map((t) => t.titleId));
      fjerne = svar.results
        .map((r) => Object.assign({}, r, {
          id: `${r.kind}:${r.tmdbId}`,
          poster: r.posterPath ? `/api/poster/w342${r.posterPath}` : null,
          tracked: mine.has(`${r.kind}:${r.tmdbId}`),
        }))
        .filter((r) => !setLokalt.has(r.id));
    } catch (err) {
      /*
       * En TMDB-fejl maa IKKE tage de lokale traeffere med sig.
       * Uden net - eller uden noegle - skal man stadig kunne finde frem til
       * det, man allerede har. Fejlen rapporteres ved siden af resultatet.
       */
      tmdbFejl = err.message;
    }

    sendJson(res, 200, {
      query: q,
      local: lokale.map((l) => Object.assign({}, l, {
        poster: l.posterPath ? `/api/poster/w342${l.posterPath}` : null,
      })),
      results: fjerne,
      tmdbError: tmdbFejl,
    });
  },

  /*
   * Kig paa en titel uden at tilfoeje den.
   *
   * Svarer OGSAA, om titlen allerede er i biblioteket - saa knappen i
   * overblikket kan sige "Added" i stedet for at tilbyde noget, der allerede
   * er sket.
   */
  'GET /api/preview': async (req, res, ctx) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    const kind = ctx.query.get('kind') === 'movie' ? 'movie' : 'tv';
    const tmdbId = tal(ctx.query.get('tmdbId'), 1, 1e12);
    if (!tmdbId) { apiFejl(res, 400, 'bad_request', 'tmdbId is required.'); return; }
    if (!rateAllow(`preview:${g.user.id}`, 200, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many lookups. Try again shortly.');
      return;
    }
    const id = titelId(kind, tmdbId);
    const o = await tmdb.hentOverblik(tmdbNoegle(), kind, tmdbId, { sprog: sprogFor(g.user.id) });
    sendJson(res, 200, Object.assign(o, {
      id,
      poster: o.posterPath ? `/api/poster/w342${o.posterPath}` : null,
      tracked: !!hentTracking(g.user.id, id),
    }));
  },

  /*
   * Tilfoej en titel (K2).
   *
   * To ting sker: metadata skrives i den FAELLES cache, og brugerens EGEN
   * tracking-raekke oprettes. Adskillelsen er hele husets pointe - foelger en
   * anden i huset serien i forvejen, er metadataen der allerede, og
   * tilfoejelsen koster ingen TMDB-kald.
   */
  'POST /api/titles': async (req, res) => {
    const g = godkend(req, res, 'write');
    if (!g) return;
    const body = await readJsonBody(req, g.viaToken);
    const kind = body.kind === 'movie' ? 'movie' : 'tv';
    const tmdbId = tal(body.tmdbId, 1, 1e12);
    if (!tmdbId) { apiFejl(res, 400, 'bad_request', 'tmdbId is required.'); return; }
    const id = titelId(kind, tmdbId);

    // Er den allerede i cachen, hentes den ikke igen. Det er baade hurtigere
    // og hoefligere - og det er derfor cachen ikke har et user_id.
    /*
     * ÉN vej ind: sikrTitel.
     *
     * Den samme hentning stod FIRE steder, og da plakat-forhentningen
     * blev lagt i sikrTitel, virkede den kun det ene: tilfoejede man en
     * titel fra fladen eller fra MCP, blev plakaten ikke hentet
     * (Andreas, 2026-08-29). Fire kopier er fire steder, den naeste
     * aendring skal huskes - og tre af dem bliver glemt.
     */
    await sikrTitel(tmdbNoegle(), kind, tmdbId, metadataSprog());
    const titel = hentTitel(id);

    // Brugerens holdning. Findes den i forvejen, roeres den ikke - at
    // "tilfoeje" noget, man allerede foelger, maa ikke nulstille ens tilstand.
    let tracking = hentTracking(g.user.id, id);
    if (!tracking) {
      tracking = gemItem(g.user.id, {
        kind: 'tracking',
        titleId: id,
        state: STATES.has(body.state) ? body.state : 'watchlist',
        addedAt: now(),
        source: 'manual',
      });
    }
    sendJson(res, 200, { title: titel, tracking, episodes: hentAfsnit(id).length });
  },

  /*
   * Biblioteket (K4/K5).
   *
   * Fremdriften regnes for hver serie. Det er ét afsnits-opslag og ét
   * watch-opslag pr. titel - acceptabelt ved et personligt bibliotek, og
   * maalet skal tages igen, den dag nogen har tusinde serier.
   */
  'GET /api/library': (req, res, ctx) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    const idag = beregn.isoDato(now());
    const oensket = str(ctx.query.get('state'), 20);
    const raekker = [];
    for (const tr of hentItems(g.user.id, { kind: 'tracking' })) {
      if (oensket && tr.state !== oensket) continue;
      const titel = hentTitel(tr.titleId);
      if (!titel) continue;
      const post = { title: titel, tracking: tr };
      if (titel.kind === 'tv') {
        const afsnit = hentAfsnit(tr.titleId);
        const sete = seteAfsnit(g.user.id, tr.titleId);
        const opts = { idag, hideSpecials: tr.hideSpecials !== false };
        post.progress = beregn.fremdrift(afsnit, sete, opts);
        post.next = beregn.naesteUsete(afsnit, sete, opts);
      } else {
        post.watched = hentWatches(g.user.id, { titleId: tr.titleId, graense: 1 }).length > 0;
      }
      raekker.push(post);
    }
    raekker.sort((a, b) => a.title.name.localeCompare(b.title.name));
    sendJson(res, 200, { today: idag, rows: raekker });
  },

  /*
   * "Hvor mange usete afsnit ligger foer det her?"
   *
   * Fladen spoerger FOER den markerer, saa den kan naa at spoerge brugeren,
   * om de tidligere ogsaa skal med. Er svaret 0, spoerges der ikke.
   */
  'GET /api/watches/before': (req, res, ctx) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    const episodeId = str(ctx.query.get('episodeId'), 80);
    const titleId = episodeId.replace(/:s\d+e\d+$/, '');
    if (!episodeId || titleId === episodeId) {
      apiFejl(res, 400, 'bad_request', 'episodeId is required.');
      return;
    }
    sendJson(res, 200, {
      count: useteFoer(g.user.id, titleId, episodeId, beregn.isoDato(now())),
    });
  },

  /* Marker alt sendt til og med ét afsnit. */
  'POST /api/watches/upto': async (req, res) => {
    const g = godkend(req, res, 'write');
    if (!g) return;
    const body = await readJsonBody(req, g.viaToken);
    const episodeId = str(body.episodeId, 80);
    const titleId = episodeId.replace(/:s\d+e\d+$/, '');
    if (!episodeId || titleId === episodeId) {
      apiFejl(res, 400, 'bad_request', 'episodeId is required.');
      return;
    }
    sendJson(res, 200, markerTilOgMed(g.user.id, titleId, episodeId, beregn.isoDato(now())));
  },

  /* ------------------------------------------------------- notifikationer */

  'GET /api/push': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, {
      // Den OFFENTLIGE noegle er ikke en hemmelighed - browseren skal have
      // den for at kunne abonnere.
      key: vapidNoegler().offentlig,
      subscriptions: db.prepare(
        'SELECT endpoint, created_at, last_ok_at FROM push_subs WHERE user_id = ?')
        .all(user.id).map((r) => ({
          // Kun vaertsnavnet - hele endpointet er en adresse, der kan sende
          // til brugerens telefon, og den skal ikke ligge i et API-svar,
          // der maaske havner i en log.
          service: (() => { try { return new URL(r.endpoint).host; } catch { return '?'; } })(),
          createdAt: r.created_at, lastOkAt: r.last_ok_at,
        })),
      secure: isHttps(req),
    });
  },

  'POST /api/push/subscribe': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const endpoint = str(body.endpoint, 600);
    const p256dh = str(body.p256dh, 200);
    const auth = str(body.auth, 100);
    if (!endpoint || !p256dh || !auth) {
      apiFejl(res, 400, 'bad_request', 'endpoint, p256dh and auth are required.');
      return;
    }
    if (!/^https:\/\//.test(endpoint)) {
      apiFejl(res, 400, 'bad_request', 'The push endpoint must be https.');
      return;
    }
    // ON CONFLICT: browseren giver samme endpoint igen ved fornyelse, og en
    // dublet ville sende den samme besked to gange.
    db.prepare(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at)
                VALUES (?,?,?,?,?)
                ON CONFLICT(endpoint) DO UPDATE SET
                  user_id = excluded.user_id, p256dh = excluded.p256dh,
                  auth = excluded.auth, fejl = 0`)
      .run(endpoint, user.id, p256dh, auth, now());
    sendJson(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const e = str(body.endpoint, 600);
    if (e) db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(e, user.id);
    else db.prepare('DELETE FROM push_subs WHERE user_id = ?').run(user.id);
    sendJson(res, 200, { ok: true });
  },

  /*
   * Send en proevebesked.
   *
   * Den er ikke pynt: push kan ikke proeves paa anden maade end at en
   * notifikation faktisk lander. Svaret siger, hvor mange enheder der tog
   * imod, og hvor mange der var doede.
   */
  'POST /api/push/test': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const r = await sendPush(user.id, 'spolen',
      'If you can read this, notifications work.', '/');
    if (r.ingen) {
      apiFejl(res, 400, 'no_subscription', 'This browser is not subscribed yet.');
      return;
    }
    sendJson(res, 200, r);
  },

  /* --------------------------------------------------------- adgangsnoegler */

  /*
   * Noegler til iOS Genveje, MCP-klienter og alt andet uden for browseren.
   *
   * requireUser og ikke godkend: én laekket noegle maa ikke kunne lave FLERE
   * noegler til sig selv. At administrere noegler kraever en rigtig session.
   */
  'GET /api/keys': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, {
      keys: db.prepare(`
        SELECT id, name, prefix, scope, created_at, last_used_at, client_id
          FROM tokens WHERE user_id = ? AND revoked_at IS NULL
         ORDER BY created_at DESC`).all(user.id).map((k) => ({
        id: k.id, name: k.name,
        // Kun praefikset - resten af noeglen findes ikke i klartekst nogen
        // steder, heller ikke her.
        prefix: k.prefix, scope: k.scope,
        createdAt: k.created_at, lastUsedAt: k.last_used_at,
        oauth: !!k.client_id,
      })),
    });
  },

  'POST /api/keys': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const navn = str(body.name, 80) || 'Untitled key';
    const scope = SCOPE_TILLADER[body.scope] ? body.scope : 'read';
    const antal = db.prepare(
      'SELECT COUNT(*) AS n FROM tokens WHERE user_id = ? AND revoked_at IS NULL').get(user.id).n;
    if (antal >= 25) {
      apiFejl(res, 429, 'too_many_keys', 'You already have 25 keys. Revoke one first.');
      return;
    }
    const ny = opretToken(user.id, navn, scope);
    // Noeglen returneres ÉN gang. Der findes ingen vej til at se den igen -
    // kun hashen er gemt.
    sendJson(res, 200, { id: ny.id, key: ny.key, name: navn, scope });
  },

  /* ----------------------------------------------------------- plex-broen */

  /*
   * Afproev forbindelsen til brugerens EGEN Plex-server.
   *
   * Adressen og tokenet sendes med i kaldet, saa man kan proeve dem FOER de
   * gemmes - ellers skal man gemme noget forkert for at opdage, at det er
   * forkert. Gemmes foerst naar `save` er sat.
   */
  /*
   * Find de servere, KONTOEN har adgang til.
   *
   * Vejen for alle, der ikke selv koerer en Plex-server: bruger man
   * app.plex.tv til at se film, der er DELT med én, findes der ingen
   * IP-adresse at skrive. plex.tv kender adresserne - og det token, hver
   * enkelt server vil acceptere.
   */
  'POST /api/plex/discover': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const token = str(body.token, 200) || getSetting(user.id, 'plex_konto_token', '');
    if (!token) {
      apiFejl(res, 400, 'bad_request', 'A Plex account token is needed to find your servers.');
      return;
    }
    const servere = await plex.hentServere(token);
    if (body.save) setSetting(user.id, 'plex_konto_token', token);

    /*
     * Hver server proeves, saa brugeren ser hvad der FAKTISK kan naas -
     * ikke en liste over adresser, plex.tv mener findes. En hjemmeserver
     * kan vaere slukket, og en lokal adresse virker kun fra samme net.
     */
    const ud = [];
    for (const srv of servere.slice(0, 10)) {
      const virker = await plex.foersteVirkende(srv);
      ud.push({
        id: srv.maskinId,
        navn: srv.navn,
        ejer: srv.ejer,
        ejerNavn: srv.ejerNavn,
        naaet: !!virker,
        // Adressen vises IKKE - den indeholder et maskin-id og hoerer ikke
        // hjemme i en flade. Kun HVORDAN den blev naaet.
        vej: virker ? (virker.relay ? 'relay' : (virker.lokal ? 'local network' : 'direct')) : null,
        version: virker ? virker.version : null,
      });
      if (virker) plexServerCache.set(srv.maskinId, { uri: virker.uri, token: srv.token });
    }
    sendJson(res, 200, { servers: ud });
  },

  /* Vaelg den server, historikken skal hentes fra. */
  'POST /api/plex/select': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const id = str(body.serverId, 80);
    const c = plexServerCache.get(id);
    if (!c) {
      apiFejl(res, 400, 'unknown_server',
        'That server was not among the reachable ones. Search again.');
      return;
    }
    setSetting(user.id, 'plex_server_id', id);
    setSetting(user.id, 'plex_url', c.uri);
    setSetting(user.id, 'plex_token', c.token);
    audit('plex-server-valgt', user.id, id);
    const konti = await plex.hentKonti(c.uri, c.token).catch(() => []);
    sendJson(res, 200, { ok: true, accounts: konti });
  },

  'POST /api/plex/test': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const url = str(body.url, 300) || getSetting(user.id, 'plex_url', '');
    const token = str(body.token, 200) || getSetting(user.id, 'plex_token', '');
    if (!url || !token) {
      apiFejl(res, 400, 'bad_request', 'Both the Plex address and a token are needed.');
      return;
    }
    const id = await plex.tjekForbindelse(url, token);
    const [biblioteker, konti] = await Promise.all([
      plex.hentBiblioteker(url, token).catch(() => []),
      plex.hentKonti(url, token).catch(() => []),
    ]);
    if (body.save) {
      setSetting(user.id, 'plex_url', url);
      setSetting(user.id, 'plex_token', token);
      if (body.accountId) {
        setSetting(user.id, 'plex_account_id', String(body.accountId));
        // Webhooken kender KONTONAVNET, ikke id'et - Plex sender
        // Account.title. Uden navnet kan webhooken ikke filtrere.
        const k = konti.find((x) => x.id === String(body.accountId));
        if (k) setSetting(user.id, 'plex_account_navn', k.navn);
      }
      audit('plex-forbundet', user.id, id.navn || null);
    }
    // Tokenet returneres ALDRIG - kun det, der er harmloest at vise.
    sendJson(res, 200, {
      server: id.navn, version: id.version,
      libraries: biblioteker, accounts: konti,
      saved: !!body.save,
    });
  },

  'DELETE /api/plex': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    db.prepare('DELETE FROM settings WHERE scope = ? AND key IN (?,?,?,?)')
      .run(user.id, 'plex_url', 'plex_token', 'plex_last_sync', 'plex_account_id');
    sendJson(res, 200, { ok: true });
  },

  'GET /api/plex/webhook': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const t = plexWebhookToken(user.id, false);
    sendJson(res, 200, { path: t ? `/plex/webhook/${t}` : null });
  },

  'POST /api/plex/webhook': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, { path: `/plex/webhook/${plexWebhookToken(user.id, true)}` });
  },

  'DELETE /api/plex/webhook': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    db.prepare('DELETE FROM settings WHERE scope = ? AND key = ?')
      .run(user.id, 'plex_webhook_token');
    sendJson(res, 200, { ok: true, path: null });
  },

  'POST /api/plex/import': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    sendJson(res, 200, await hentFraPlex(user.id, { alt: !!body.all }));
  },

  /* ---------------------------------------------------------- trakt-broen */

  /*
   * Trakt-login med device code.
   *
   * Koden vises for brugeren, som taster den paa trakt.tv. Serveren spoerger
   * imens, om den er godkendt. Selve device_code'en gemmes IKKE i databasen -
   * den lever et par minutter og hoerer til det aabne login, ikke til
   * brugeren.
   */
  'POST /api/trakt/connect': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const clientId = getSetting('*', 'trakt_client_id', '');
    if (!clientId) {
      apiFejl(res, 503, 'no_trakt_app',
        'No Trakt client id yet. An administrator adds one under Settings.');
      return;
    }
    const start = await trakt.startLogin(clientId);
    traktLogins.set(user.id, {
      deviceCode: start.deviceCode, udloeber: now() + (start.expiresIn || 600),
    });
    // device_code sendes ALDRIG til browseren - kun den kode, mennesket skal
    // taste. Den ene er en hemmelighed, den anden er til at laese hoejt.
    sendJson(res, 200, {
      userCode: start.userCode, url: start.url,
      expiresIn: start.expiresIn, interval: start.interval,
    });
  },

  'POST /api/trakt/check': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const aabent = traktLogins.get(user.id);
    if (!aabent || aabent.udloeber < now()) {
      traktLogins.delete(user.id);
      sendJson(res, 200, { state: 'udloebet', message: 'The code expired. Start again.' });
      return;
    }
    const svar = await trakt.tjekLogin(
      getSetting('*', 'trakt_client_id', ''),
      getSetting('*', 'trakt_client_secret', ''),
      aabent.deviceCode);
    if (svar.tilstand === 'ok') {
      // Tokenet er brugerens - ikke installationens. To i huset har hver sin
      // Trakt-konto.
      setSetting(user.id, 'trakt_access_token', svar.accessToken);
      if (svar.refreshToken) setSetting(user.id, 'trakt_refresh_token', svar.refreshToken);
      traktLogins.delete(user.id);
      audit('trakt-forbundet', user.id, null);
      sendJson(res, 200, { state: 'ok' });
      return;
    }
    sendJson(res, 200, { state: svar.tilstand, message: svar.besked || null });
  },

  'DELETE /api/trakt': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    db.prepare('DELETE FROM settings WHERE scope = ? AND key IN (?,?)')
      .run(user.id, 'trakt_access_token', 'trakt_refresh_token');
    traktLogins.delete(user.id);
    sendJson(res, 200, { ok: true });
  },

  /*
   * Hent historikken fra Trakt og koer den gennem SAMME importmotor som en
   * fil. Trakt har rigtige id'er paa alt, saa raekkerne matcher eksakt -
   * modsat en Netflix-fil, der kun har en titel at gaa efter.
   */
  'POST /api/trakt/import': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const token = getSetting(user.id, 'trakt_access_token', '');
    if (!token) {
      apiFejl(res, 400, 'not_connected', 'Connect your Trakt account first.');
      return;
    }
    const clientId = getSetting('*', 'trakt_client_id', '');
    const body = await readJsonBody(req);
    const pause = () => new Promise((r) => setTimeout(r, 400));
    const raekker = [];
    raekker.push(...await trakt.hentHistorik(clientId, token, { pause }));
    if (body.watchlist !== false) {
      raekker.push(...await trakt.hentWatchlist(clientId, token, { pause }));
    }
    sendJson(res, 200, await koerImportRaekker(user.id, raekker, 'Trakt', []));
  },

  /*
   * De LOESERE slaegtninge - TMDB's egne anbefalinger.
   *
   * Adskilt fra titelvisningen og hentet paa forespoergsel: det er ét kald
   * mere pr. titel, og de fleste vil se fremdriften, ikke naboerne. Samlingen
   * (efterfoelgerne) kommer derimod med i titelvisningen, fordi "findes der
   * en toer?" er et spoergsmaal, man har MENS man kigger.
   */
  'GET /api/related': async (req, res, ctx) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    const id = str(ctx.query.get('id'), 64);
    const m = /^(tv|movie):(\d+)$/.exec(id);
    if (!m) { apiFejl(res, 400, 'bad_request', 'A title id is required.'); return; }
    const liste = await tmdb.hentAnbefalinger(tmdbNoegle(), m[1], Number(m[2]),
      { sprog: sprogFor(g.user.id) });
    const mine = new Set(hentItems(g.user.id, { kind: 'tracking' }).map((t) => t.titleId));
    sendJson(res, 200, {
      results: liste.map((r) => Object.assign({}, r, {
        id: `${r.kind}:${r.tmdbId}`,
        poster: r.posterPath ? `/api/poster/w342${r.posterPath}` : null,
        tracked: mine.has(`${r.kind}:${r.tmdbId}`),
      })),
    });
  },

  /* ------------------------------------------------------ streamingudbud */

  /*
   * Alle tjenester, der findes i brugerens land - til "mine tjenester" (S2).
   *
   * Serie- og filmudbydere slaas sammen: man abonnerer paa Netflix, ikke paa
   * "Netflix til serier". Cachet i settings, fordi listen naesten aldrig
   * aendrer sig og ellers ville koste to TMDB-kald hver gang siden aabnes.
   */
  'GET /api/providers': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const region = (getSetting(user.id, 'region', 'DK') || 'DK').toUpperCase();
    const cacheNoegle = `providers_${region}`;
    const cachet = getSetting('*', cacheNoegle, '');
    if (cachet) {
      try {
        const p = JSON.parse(cachet);
        if (p.hentet && now() - p.hentet < 30 * 86400) {
          sendJson(res, 200, { region, providers: p.liste, mine: [...mineTjenester(user.id)] });
          return;
        }
      } catch { /* daarlig cache hentes bare igen */ }
    }
    const [tv, film] = await Promise.all([
      tmdb.hentUdbydere(tmdbNoegle(), 'tv', region),
      tmdb.hentUdbydere(tmdbNoegle(), 'movie', region),
    ]);
    const kort = new Map();
    for (const p of [...tv, ...film]) if (!kort.has(p.name)) kort.set(p.name, p);
    const liste = [...kort.values()];
    setSetting('*', cacheNoegle, JSON.stringify({ hentet: now(), liste }));
    sendJson(res, 200, { region, providers: liste, mine: [...mineTjenester(user.id)] });
  },

  /* -------------------------------------------------------------- statistik */

  /*
   * Aar i tal.
   *
   * Bygges af historikken sammen med spilletid, genrer og tjenester. Selve
   * regnestykket ligger i shared/statistik.js, saa MCP-laget senere kan give
   * det samme svar - og saa gaettet spilletid kan proeves.
   */
  'GET /api/stats': (req, res, ctx) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    const region = (getSetting(g.user.id, 'region', 'DK') || 'DK').toUpperCase();
    const aar = str(ctx.query.get('year'), 4);

    const raekker = db.prepare(`
      SELECT w.watched_at, w.episode_id, w.title_id, w.source,
             e.runtime AS ep_runtime,
             t.name AS title_name, t.kind, t.data AS title_data,
             p.data AS provider_data
        FROM watches w
        JOIN titles t ON t.id = w.title_id
        LEFT JOIN episodes e ON e.id = w.episode_id
        LEFT JOIN providers p ON p.title_id = w.title_id AND p.region = ?
       WHERE w.user_id = ?`).all(region, g.user.id);

    const poster = [];
    for (const r of raekker) {
      if (aar && new Date(r.watched_at * 1000).toISOString().slice(0, 4) !== aar) continue;
      let td = {};
      try { td = JSON.parse(r.title_data || '{}'); } catch { /* tom */ }
      let tjenester = [];
      try {
        const pd = JSON.parse(r.provider_data || '{}');
        tjenester = (pd.flatrate || []).map((x) => x.name);
      } catch { /* ingen udbudsdata */ }
      poster.push({
        watchedAt: r.watched_at,
        /*
         * Kun 'undated' mangler et meningsfuldt tidspunkt. En massemarkering
         * baerer nu udsendelsesdagen, og den ER et svar paa "hvornaar" -
         * omtrentligt, men ikke tilfaeldigt som tidspunktet for et museklik.
         */
        datoSikker: r.source !== 'undated',
        type: r.episode_id ? 'episode' : 'movie',
        titleId: r.title_id,
        titleName: r.title_name,
        // Afsnittets EGEN laengde foerst; ellers seriens gennemsnit. Et
        // afsnit uden nogen af delene taelles som gaettet - ikke som nul.
        runtime: r.ep_runtime || td.runtime || null,
        genres: td.genres || [],
        services: tjenester,
      });
    }

    const s = statistik.statistik(poster);
    sendJson(res, 200, {
      year: aar || null,
      total: s,
      topGenres: statistik.top(s.perGenre, 8),
      topServices: statistik.top(s.perTjeneste, 8),
      byYear: Object.entries(s.perAar).sort((a, b) => b[0].localeCompare(a[0]))
        .map(([y, m]) => ({ year: y, minutes: m })),
    });
  },

  /* ------------------------------------------------------- set sammen (H1) */

  /*
   * Marker et afsnit set for FLERE i husstanden paa én gang.
   *
   * Man maa kun skrive i en andens historik, hvis DEN ANDEN har delt sin
   * profil med én. Ellers kunne enhver i huset fylde andres historik op -
   * og en historik, man ikke selv har skrevet, er ikke en historik.
   */
  'POST /api/watches/together': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const titleId = str(body.titleId, 64);
    const episodeId = str(body.episodeId, 80) || null;
    const andre = Array.isArray(body.userIds) ? body.userIds.map(String).slice(0, 20) : [];
    if (!titleId) { apiFejl(res, 400, 'bad_request', 'titleId is required.'); return; }

    const resultat = [];
    for (const id of new Set([user.id, ...andre])) {
      if (id !== user.id && !maaSe(user.id, id, 'profile')) {
        resultat.push({ userId: id, ok: false, grund: 'they have not shared their profile with you' });
        continue;
      }
      try {
        const r = gemWatch(id, { titleId, episodeId, source: 'manual' });
        resultat.push({ userId: id, ok: true, dublet: r.dublet });
      } catch (err) {
        resultat.push({ userId: id, ok: false, grund: err.message });
      }
    }
    sendJson(res, 200, { results: resultat });
  },

  /* --------------------------------------------------------------- import */

  /*
   * Kig paa filen UDEN at importere.
   *
   * Formatgenkendelsen og en stikproeve, saa brugeren kan se, at appen har
   * forstaaet filen rigtigt, foer der skrives noget. Ingen TMDB-kald, saa
   * det er oejeblikkeligt.
   */
  'POST /api/import/analyse': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req, false, false, MAX_IMPORT_BODY);
    const filer = Array.isArray(body.files) && body.files.length
      ? body.files
      : [{ navn: 'file', tekst: typeof body.text === 'string' ? body.text : '' }];
    if (!filer.some((f) => String(f.tekst || '').trim())) {
      apiFejl(res, 400, 'bad_request', 'The file is empty.');
      return;
    }
    const laest = filer.length === 1
      ? Object.assign(importer.laesFil(filer[0].tekst), { brugte: [], ignorerede: [] })
      : laesFiler(filer);
    if (laest.fejl) { apiFejl(res, 400, 'bad_format', laest.fejl); return; }
    if (!laest.raekker.length) {
      apiFejl(res, 400, 'bad_format',
        `Nothing readable in ${filer.length} file(s). Skipped: `
        + (laest.ignorerede || []).slice(0, 6).join(', '));
      return;
    }
    const tael = (t) => laest.raekker.filter((r) => r.type === t).length;
    sendJson(res, 200, {
      format: laest.format,
      formatName: laest.formatNavn,
      // Hvilken vej datoerne blev laest, og om filen selv beviste det.
      // Er den ikke sikker, skal fladen SPOERGE frem for at gaette videre.
      dateOrder: laest.dateOrder || 'iso',
      dateOrderCertain: laest.dateOrderSikker !== false,
      rows: laest.raekker.length,
      // Hvilke filer der blev brugt, og hvilke der blev sprunget over. En
      // GDPR-eksport har snesevis af filer, og brugeren skal kunne se, at
      // profiler og indstillinger blev valgt fra med vilje.
      used: laest.brugte || [],
      ignored: (laest.ignorerede || []).slice(0, 40),
      crossFileDuplicates: laest.dubletter || 0,
      skipped: laest.sprunget.length,
      movies: tael('movie'),
      episodes: tael('episode'),
      shows: tael('show'),
      withDates: laest.raekker.filter((r) => r.watchedAt).length,
      // Hvor mange der faktisk bliver til VISNINGER. Forskellen mellem
      // rows og watches er collection-poster: ting man ejer, ikke har set.
      watches: laest.raekker.filter((r) => r.erVisning !== false && r.watchedAt).length,
      followsOnly: laest.raekker.filter((r) => r.erVisning === false || !r.watchedAt).length,
      // Fem raekker er nok til at se, om titler og datoer er landet rigtigt.
      sample: laest.raekker.slice(0, 5),
    });
  },

  'POST /api/import/start': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req, false, false, MAX_IMPORT_BODY);
    if (Array.isArray(body.files) && body.files.length > 1) {
      const l = laesFiler(body.files, { dateOrder: (body.options || {}).dateOrder });
      if (!l.raekker.length) {
        apiFejl(res, 400, 'bad_format', 'Nothing readable in those files.');
        return;
      }
      sendJson(res, 200, await koerImportRaekker(user.id, l.raekker,
        `${l.brugte.length} files`, l.sprunget));
      return;
    }
    const tekst = Array.isArray(body.files) && body.files.length
      ? String(body.files[0].tekst || '')
      : (typeof body.text === 'string' ? body.text : '');
    if (!tekst.trim()) { apiFejl(res, 400, 'bad_request', 'The file is empty.'); return; }
    sendJson(res, 200, await koerImport(user.id, tekst, body.options));
  },

  'GET /api/import': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    /*
     * Kun ÉN import ad gangen for hele installationen, og status hoerer til
     * DEN bruger, der startede den. En anden bruger skal ikke kunne se, hvad
     * der staar i en andens historik - heller ikke som en liste over
     * umatchede titler.
     */
    if (importJob.userId && importJob.userId !== user.id) {
      sendJson(res, 200, { running: importJob.koerer, busyElsewhere: true });
      return;
    }
    sendJson(res, 200, importStatus());
  },

  'POST /api/import/stop': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (importJob.userId !== user.id) {
      apiFejl(res, 403, 'not_yours', 'That import was started by someone else.');
      return;
    }
    importJob.stopOensket = true;
    sendJson(res, 200, importStatus());
  },

  /* ------------------------------------------------------------ kalender */

  'GET /api/calendar': (req, res, ctx) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    const idag = beregn.isoDato(now());
    // Standardvinduet er en maaned frem OG en uge tilbage: det, man er bagud
    // med, hoerer lige saa meget til i en kalender som det, der kommer.
    const fra = dato(ctx.query.get('from'))
      || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const til = dato(ctx.query.get('to'))
      || new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10);
    const raekker = kalender(g.user.id, fra, til);
    // Hvad brugeren har set, afgoeres HER - kalenderfunktionen er faelles med
    // iCal-feedet og skal ikke kende til brugerens historik.
    const sete = new Set();
    for (const titleId of new Set(raekker.map((r) => r.titleId))) {
      for (const id of seteAfsnit(g.user.id, titleId)) sete.add(id);
    }
    sendJson(res, 200, {
      today: idag, from: fra, to: til,
      rows: raekker.map((r) => Object.assign({ seen: sete.has(r.id) }, r)),
    });
  },

  'GET /api/ical': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const token = hentIcalFeed(user.id, false);
    sendJson(res, 200, {
      // Kun STIEN - vaerten udleder klienten selv. Serveren kender ikke sit
      // eget udadvendte navn bag panelets proxy.
      path: token ? `/ical/${token}.ics` : null,
    });
  },

  'POST /api/ical': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, { path: `/ical/${hentIcalFeed(user.id, true)}.ics` });
  },

  'DELETE /api/ical': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    tilbagekaldIcal(user.id);
    sendJson(res, 200, { ok: true, path: null });
  },

  /* ------------------------------------------------- baggrundsopdatering */

  /* Status er aaben for alle - det er installationens tilstand, ikke data. */
  'GET /api/refresh': (req, res) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    sendJson(res, 200, opdaterStatus());
  },

  /* At starte og stoppe er admins: jobbet kalder TMDB paa hele husets vegne. */
  'POST /api/refresh/start': async (req, res) => {
    const user = requireAdmin(req, res);
    if (!user) return;
    sendJson(res, 200, await koerOpdatering());
  },

  'POST /api/refresh/stop': (req, res) => {
    const user = requireAdmin(req, res);
    if (!user) return;
    // Flaget laeses mellem to titler - jobbet afbrydes ikke midt i en
    // hentning, saa en halvskrevet serie kan ikke opstaa.
    opdaterJob.stopOensket = true;
    sendJson(res, 200, opdaterStatus());
  },

  /* ------------------------------------------------------------ visninger */

  /*
   * Up Next (K1) - forsiden.
   *
   * Beregnes paa SERVEREN og ikke i fladen. Ikke af performancehensyn, men
   * fordi MCP-laget og iCal-feedet skal have det samme svar, og det kun kan
   * garanteres, hvis der er ét sted, der spoerger beregn.naesteUsete().
   */
  'GET /api/up-next': (req, res) => {
    const g = godkend(req, res, 'read');
    if (!g) return;
    const idag = beregn.isoDato(now());
    const raekker = [];
    for (const tr of hentItems(g.user.id, { kind: 'tracking' })) {
      if (tr.state !== 'watching' && tr.state !== 'watchlist') continue;
      const titel = hentTitel(tr.titleId);
      if (!titel || titel.kind !== 'tv') continue;
      const afsnit = hentAfsnit(tr.titleId);
      const sete = seteAfsnit(g.user.id, tr.titleId);
      const n = beregn.naesteUsete(afsnit, sete, {
        idag, hideSpecials: tr.hideSpecials !== false,
      });
      if (!n.klar && !n.naeste) continue;
      raekker.push({ title: titel, tracking: tr, next: n });
    }
    // Klar foerst (det man kan se i aften), derefter det der venter - hver
    // gruppe i udsendelsesorden. Sorteringen bor her og ikke i fladen: den
    // ER svaret paa "hvad skal jeg se nu".
    raekker.sort((a, b) => {
      const ak = a.next.klar ? 0 : 1;
      const bk = b.next.klar ? 0 : 1;
      if (ak !== bk) return ak - bk;
      const ad = (a.next.klar || a.next.naeste).airDate || '9999-99-99';
      const bd = (b.next.klar || b.next.naeste).airDate || '9999-99-99';
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
    sendJson(res, 200, { today: idag, rows: raekker });
  },
};

/*
 * Ruter med et id i stien. Holdt adskilt fra ROUTES, saa den direkte opslag
 * i objektet bliver ved med at vaere ét opslag - moenstrene proeves kun, naar
 * der ikke var et praecist match.
 */
const MOENSTRE = [
  {
    /*
     * Plakat-proxyen.
     *
     * Ligger under /api/, saa den arver godkendelsen og CSP'ens 'self'.
     * <img> sender cookien med paa samme oprindelse, saa et almindeligt
     * img-tag virker uden videre.
     */
    metode: 'GET', re: /^\/api\/poster\/(w\d{2,4})\/([A-Za-z0-9._-]{4,120}\.(?:jpg|png))$/,
    kald: async (req, res, ctx) => {
      const g = godkend(req, res, 'read');
      if (!g) return;
      await serverPlakat(req, res, ctx.params[0], ctx.params[1]);
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/items\/([A-Za-z0-9_-]{1,64})$/,
    kald: (req, res, ctx) => {
      const g = godkend(req, res, 'write');
      if (!g) return;
      if (!sletItem(g.user.id, ctx.params[0])) {
        apiFejl(res, 404, 'not_found', 'No such item.');
        return;
      }
      sendJson(res, 200, { ok: true });
    },
  },
  {
    /*
     * Fjern markeringen af ÉT afsnit, uanset hvornaar det blev set.
     *
     * Adskilt fra DELETE /api/watches/:id, fordi fladen kender AFSNITTET,
     * ikke den enkelte visningspost - og et afsnit kan vaere set flere gange.
     * Afsnits-id'et baerer selv titlen ('tv:1396:s1e1'), saa der er intet at
     * gaette om ejerskabet.
     */
    metode: 'DELETE', re: /^\/api\/watches\/episode\/([A-Za-z0-9:_-]{1,80})$/,
    kald: (req, res, ctx) => {
      const g = godkend(req, res, 'write');
      if (!g) return;
      const episodeId = ctx.params[0];
      const titleId = episodeId.replace(/:s\d+e\d+$/, '');
      if (titleId === episodeId) {
        apiFejl(res, 400, 'bad_request', 'That is not an episode id.');
        return;
      }
      const n = afmarkerAfsnit(g.user.id, titleId, episodeId);
      sendJson(res, 200, { ok: true, fjernet: n });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/watches\/([A-Za-z0-9_-]{1,64})$/,
    kald: (req, res, ctx) => {
      const g = godkend(req, res, 'write');
      if (!g) return;
      if (!sletWatch(g.user.id, ctx.params[0])) {
        apiFejl(res, 404, 'not_found', 'No such entry.');
        return;
      }
      sendJson(res, 200, { ok: true });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/keys\/([A-Za-z0-9_-]{1,64})$/,
    kald: (req, res, ctx) => {
      const user = requireUser(req, res);
      if (!user) return;
      const r = db.prepare(
        'UPDATE tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
        .run(now(), ctx.params[0], user.id);
      if (!r.changes) { apiFejl(res, 404, 'not_found', 'No such key.'); return; }
      audit('noegle-tilbagekaldt', user.username, ctx.params[0]);
      sendJson(res, 200, { ok: true });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/shares\/([A-Za-z0-9_-]{1,64})$/,
    kald: (req, res, ctx) => {
      const user = requireUser(req, res);
      if (!user) return;
      // Kun ejeren kan tage tilbage. En modtager, der proever, faar 404 og
      // ikke 403: han skal ikke kunne udlede, at tildelingen findes.
      if (!sletDeling(user.id, ctx.params[0])) {
        apiFejl(res, 404, 'not_found', 'No such share.');
        return;
      }
      sendJson(res, 200, { ok: true });
    },
  },
  {
    /*
     * En andens fremdrift i én serie - spoilervagten (H3).
     *
     * Svarer 404 og ikke 403, naar der ikke er delt: ellers kunne man afsoege,
     * hvad andre foelger, ved at se paa forskellen mellem de to koder.
     */
    metode: 'GET',
    re: /^\/api\/shared\/([A-Za-z0-9_-]{1,64})\/progress\/([A-Za-z0-9:_-]{1,64})$/,
    kald: (req, res, ctx) => {
      const user = requireUser(req, res);
      if (!user) return;
      const ud = deltFremdrift(user.id, ctx.params[0], ctx.params[1], beregn.isoDato(now()));
      if (!ud) { apiFejl(res, 404, 'not_found', 'Nothing shared here.'); return; }
      sendJson(res, 200, ud);
    },
  },
  {
    /*
     * Ét afsnit med resume. Metadata er installationens, saa der er ingen
     * ejer at tjekke - men `seen` er brugerens og slaas op pr. kald.
     */
    metode: 'GET', re: /^\/api\/episodes\/([A-Za-z0-9:_-]{1,80})$/,
    kald: (req, res, ctx) => {
      const g = godkend(req, res, 'read');
      if (!g) return;
      const e = hentEtAfsnit(ctx.params[0]);
      if (!e) { apiFejl(res, 404, 'not_found', 'No such episode.'); return; }
      const titel = hentTitel(e.titleId);
      sendJson(res, 200, Object.assign(e, {
        seen: seteAfsnit(g.user.id, e.titleId).has(e.id),
        titleName: titel ? titel.name : '',
        still: e.stillPath ? `/api/poster/w300${e.stillPath}` : null,
        today: beregn.isoDato(now()),
      }));
    },
  },
  {
    metode: 'GET', re: /^\/api\/titles\/([A-Za-z0-9:_-]{1,64})$/,
    kald: async (req, res, ctx) => {
      const g = godkend(req, res, 'read');
      if (!g) return;
      const ud = await titelMedFremdrift(g.user.id, ctx.params[0], beregn.isoDato(now()));
      if (!ud) { apiFejl(res, 404, 'not_found', 'That title is not in the library yet.'); return; }
      sendJson(res, 200, ud);
    },
  },
];

function findRute(metode, sti) {
  const direkte = ROUTES[`${metode} ${sti}`];
  if (direkte) return { kald: direkte, params: [] };
  for (const m of MOENSTRE) {
    if (m.metode !== metode) continue;
    const fund = sti.match(m.re);
    if (fund) return { kald: m.kald, params: fund.slice(1) };
  }
  return null;
}

/* ------------------------------------------------------------ server */

const server = http.createServer(async (req, res) => {
  let urlPath;
  let query;
  try {
    const u = new URL(req.url, 'http://localhost');
    urlPath = decodeURIComponent(u.pathname);
    query = u.searchParams;
  } catch {
    apiFejl(res, 400, 'bad_request', 'Bad address.');
    return;
  }

  try {
    /*
     * Kalenderfeedet er UDEN login - en kalender-app kan ikke sende cookies.
     * ADRESSEN er hemmeligheden, og den kan tilbagekaldes.
     *
     * Forkert token giver 404, ikke 401 eller 403: et 403 ville bekraefte, at
     * tokenet FINDES men ikke maa bruges, og saa kan man afsoege dem.
     */
    const ical = urlPath.match(/^\/ical\/([A-Za-z0-9_-]{16,64})\.ics$/);
    if (ical) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        apiFejl(res, 405, 'method_not_allowed', 'That method is not allowed here.');
        return;
      }
      const feed = findIcalFeed(ical[1]);
      /*
       * En FREMMED session paa adressen giver ogsaa 404. Uden session ER
       * adressen legitimationen, men sidder man logget ind som en anden,
       * skal feedet ikke se ud til at findes. (Reglen laa paa tovos
       * start-links og manglede i feedet - begge skal have den.)
       */
      const session = sessionUser(req);
      if (!feed || (session && session.id !== feed.user_id)) {
        logSecurity(`ical-token-afvist ip=${clientIp(req)}`);
        res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
        res.end('Not found');
        return;
      }
      const krop = byggIcal(feed.user_id);
      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Length': Buffer.byteLength(krop),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : krop);
      return;
    }

    // Plex-webhook: uden login, adressen ER hemmeligheden.
    const hook = urlPath.match(/^\/plex\/webhook\/([A-Za-z0-9_-]{16,64})$/);
    if (hook) { await haandterPlexWebhook(req, res, hook[1]); return; }

    if (urlPath.startsWith('/oauth/') || urlPath.startsWith('/.well-known/oauth-')) {
      await haandterOauth(req, res, urlPath, query);
      return;
    }

    // MCP ligger paa /mcp - kort nok til at skrive i en klientkonfiguration.
    if (urlPath === '/mcp') {
      securityHeaders(res);
      await mcp.haandter(req, res);
      return;
    }

    if (urlPath.startsWith('/api/')) {
      securityHeaders(res);
      const rute = findRute(req.method, urlPath);
      if (!rute) { apiFejl(res, 404, 'unknown_endpoint', 'Unknown endpoint.'); return; }
      await rute.kald(req, res, { query, params: rute.params });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      apiFejl(res, 405, 'method_not_allowed', 'That method is not allowed here.');
      return;
    }
    serveStatic(req, res, urlPath);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    /*
     * En fejl med en `kode` er BEVIDST - den er kastet af vores egen kode for
     * at sige noget bestemt ("der er ingen TMDB-noegle endnu", "TMDB afviste
     * noeglen"). Den beholder sin besked, ogsaa naar status er 5xx.
     *
     * Uden den skelnen slugte reglen »en 500 roeber aldrig sin egen besked«
     * netop de beskeder, brugeren skal handle paa: en manglende noegle kom ud
     * som "Something went wrong on the server", og saa leder man efter en
     * serverfejl i stedet for at gaa til Settings. Reglen er rigtig for
     * UVENTEDE fejl - de har ingen kode, og de faar stadig den generiske.
     */
    const bevidst = !!(err && err.kode);
    if (status >= 500 && !bevidst) {
      logError(`${req.method} ${urlPath}: ${err && err.stack ? err.stack : err}`);
    } else if (status >= 500) {
      /*
       * IKKE med [fejl]-praefiks. Runens watchers: slaar alarm paa `\[fejl\]`
       * (5 hits / 5 min), og en manglende TMDB-noegle er ikke en serverfejl -
       * fem soegninger uden noegle ville ellers sende en panel-notifikation
       * om noget, brugeren selv kan se paa skaermen.
       */
      log(`${req.method} ${urlPath}: ${err.kode} - ${err.message}`);
    }
    if (!res.headersSent) {
      const KODER = { 400: 'bad_request', 404: 'not_found', 413: 'too_large', 415: 'wrong_content_type' };
      apiFejl(res, status,
        bevidst ? err.kode : (KODER[status] || 'server_error'),
        bevidst ? err.message
          : (status >= 500 ? 'Something went wrong on the server.' : (err && err.message) || 'Bad request.'));
    } else res.end();
  }
});

/* --------------------------------------------------------- oprydning */

/*
 * Udloebne sessioner og rate-spande ryddes ved opstart og derefter i doegnet.
 * Panelets auto-opdatering genstarter containeren kl. 04, saa opstarts-
 * kaldet er i praksis det, der koerer - men appen maa ikke VAERE afhaengig
 * af en genstart for at rydde op.
 */
function sweep() {
  const t = now();
  try {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(t);
    db.prepare('DELETE FROM rate WHERE reset_at <= ?').run(t - 3600);
    db.prepare('DELETE FROM audit WHERE at < ?').run(t - 180 * 86400);
  } catch (err) {
    logError(`oprydning: ${err.message}`);
  }
}

migrate();
computeInlineHash();
sweep();
setInterval(sweep, 6 * 3600 * 1000).unref();

/*
 * Opdateringen skal koere AF SIG SELV - ellers er "nye afsnit dukker op"
 * afhaengigt af, at nogen husker at trykke paa en knap.
 *
 * Hver time, ikke hvert doegn: `next_check_at` afgoer alligevel hvad der er
 * forfaldent, saa et hyppigt tik koster kun en billig forespoergsel, mens et
 * doegn-tik ville betyde, at en serie der sender i aften foerst opdages i
 * morgen. Foerste tik venter et minut, saa opstarten ikke belastes.
 */
setTimeout(() => {
  koerOpdatering().catch((e) => logError(`opdatering: ${e.message}`));
  pushOmNyeAfsnit().catch((e) => logError(`push: ${e.message}`));
  setInterval(() => {
    koerOpdatering().catch((e) => logError(`opdatering: ${e.message}`));
    pushOmNyeAfsnit().catch((e) => logError(`push: ${e.message}`));
  }, 3600 * 1000).unref();
}, 60 * 1000).unref();

/* Plex-hentningen tikker hvert 10. minut. Foerste gang efter to minutter,
   saa opstarten ikke belastes af baade metadata og Plex paa én gang. */
setTimeout(() => {
  plexTik().catch((e) => logError(`plex: ${e.message}`));
  setInterval(() => {
    plexTik().catch((e) => logError(`plex: ${e.message}`));
  }, 10 * 60 * 1000).unref();
}, 120 * 1000).unref();

server.listen(BIND_PORT, '0.0.0.0', () => {
  // done_regex i runen matcher PRAECIS den her linje. AEndres teksten, skal
  // runens startup.done_regex aendres i samme commit - ellers staar panelet
  // og venter paa en besked, der aldrig kommer.
  log(`spolen lytter paa port ${BIND_PORT}`);
});

// SIGTERM er den vej, panelet stopper containeren. WAL taaler det, men
// forbindelsen lukkes pænt, saa der ikke efterlades en -wal at gendanne fra.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log(`${sig} modtaget - lukker`);
    server.close(() => {
      try { db.close(); } catch { /* lukket allerede */ }
      process.exit(0);
    });
    // Haenger en forbindelse, doer vi alligevel. Uden det her kan panelets
    // stop_timeout loebe ud, og containeren bliver draebt haardt.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
