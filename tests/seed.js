'use strict';
/*
 * Saar en syntetisk serie i metadata-cachen, saa fladen kan proeves UDEN en
 * TMDB-noegle.
 *
 *   node tests/seed.js /tmp/spolendata
 *
 * Serveren skal vaere STOPPET - to skrivere paa samme SQLite-fil er ikke
 * vaerd at fejlsoege. Dataene er aabenlyst syntetiske ("Prøveserien"), saa
 * de aldrig kan forveksles med noget hentet fra TMDB.
 */
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dir = process.argv[2] || '/tmp/spolendata';
const db = new DatabaseSync(path.join(dir, 'spolen.db'));
const nu = Math.floor(Date.now() / 1000);

const ID = 'tv:900001';
db.prepare(`INSERT INTO titles (id, kind, tmdb_id, imdb_id, tvdb_id, name, year, status,
                                data, fetched_at, next_check_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, status = excluded.status`)
  .run(ID, 'tv', 900001, null, null, 'Prøveserien', 2026, 'Returning Series',
    JSON.stringify({
      overview: 'En syntetisk serie, der kun findes for at proeve fladen.',
      posterPath: null, genres: ['Drama'], seasonCount: 2, episodeCount: 8, runtime: 45,
    }), nu, nu + 86400);

/* Otte afsnit: seks er sendt, to ligger frem i tiden. Saa kan BAADE
   "klar til at se" og "kommer" ses paa samme serie. */
const idag = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const afsnit = [];
for (let i = 0; i < 8; i++) {
  const d = new Date(idag);
  d.setDate(d.getDate() + (i - 5) * 7);        // afsnit 1-6 i fortiden, 7-8 fremme
  afsnit.push({
    season: i < 4 ? 1 : 2,
    number: (i % 4) + 1,
    name: `Afsnit ${i + 1}`,
    airDate: iso(d),
  });
}
const ind = db.prepare(`INSERT INTO episodes (id, title_id, season, number, name, air_date, runtime, data)
                        VALUES (?,?,?,?,?,?,?,'{}')
                        ON CONFLICT(id) DO UPDATE SET air_date = excluded.air_date`);
for (const e of afsnit) {
  ind.run(`${ID}:s${e.season}e${e.number}`, ID, e.season, e.number, e.name, e.airDate, 45);
}

/* Tracking for ALLE brugere, saa serien dukker op uanset hvem man logger ind som. */
for (const u of db.prepare('SELECT id FROM users').all()) {
  const findes = db.prepare(
    `SELECT id FROM items WHERE user_id = ? AND kind = 'tracking'
       AND json_extract(data, '$.titleId') = ?`).get(u.id, ID);
  if (findes) continue;
  db.prepare('INSERT INTO items (id, user_id, kind, data, updated_at) VALUES (?,?,?,?,?)')
    .run(`seed-${u.id}`, u.id, 'tracking',
      JSON.stringify({ titleId: ID, state: 'watching', addedAt: nu, createdAt: nu }), nu);
}

console.log(`saaet: ${ID} med ${afsnit.length} afsnit`);
console.log('afsnit:', afsnit.map((e) => `S${e.season}E${e.number} ${e.airDate}`).join('  '));
db.close();
