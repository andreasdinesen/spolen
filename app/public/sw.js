'use strict';
/*
 * spolens service worker.
 *
 * VERSIONEN STEMPLES HER AF build_rune.py. Det er ikke pynt: uden et
 * versioneret cache-navn rydder `activate` aldrig de gamle filer, og en
 * service worker kan servere en forældet app.js i det uendelige - ogsaa
 * efter at panelet har installeret en ny version (RUNE-ERFARINGER §5,
 * Kokkeri).
 *
 * DET DER **IKKE** CACHES er lige saa vigtigt: alt under /api/ er brugerens
 * data. En cachet historik ville vise gamle tal efter en markering, og en
 * cachet /api/me kunne i værste fald vise den forrige brugers navn efter et
 * skift. Kun de statiske filer gemmes.
 */

const VERSION = 1;               /* stemples af build_rune.py */
const CACHE = `spolen-v${VERSION}`;

/* Samme ?v=-stempler som index.html, ellers henter appen én fil fra cachen
   og en anden fra nettet, og de to kan være fra hver sin udgivelse. */
const FILER = [
  './',
  `./style.css?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
  './icon.svg',
  './icon-192.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // addAll fejler samlet, hvis ÉN fil mangler - og så installeres workeren
    // slet ikke. Hver fil for sig, så en manglende ikonfil ikke slår resten ud.
    await Promise.all(FILER.map((f) => c.add(f).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const navn of await caches.keys()) {
      // Alt der hedder spolen-v<noget andet> er en tidligere udgivelse.
      if (navn.startsWith('spolen-v') && navn !== CACHE) await caches.delete(navn);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  /*
   * API'et og plakaterne går UDEN OM cachen her.
   *
   * API'et er brugerens data og må aldrig serveres gammelt. Plakaterne har
   * deres egen cache på serveren og sendes med `immutable`, så browserens
   * almindelige HTTP-cache klarer dem bedre end vi kan.
   */
  if (url.pathname.startsWith('/api/') || url.pathname === '/mcp') return;

  e.respondWith((async () => {
    const cachet = await caches.match(req);
    if (cachet) {
      // Hent en frisk kopi i baggrunden, så næste indlæsning er opdateret,
      // men vis den cachede med det samme.
      e.waitUntil((async () => {
        try {
          const frisk = await fetch(req);
          if (frisk && frisk.ok) (await caches.open(CACHE)).put(req, frisk.clone());
        } catch { /* offline er ikke en fejl her */ }
      })());
      return cachet;
    }
    try {
      return await fetch(req);
    } catch {
      // Offline og ikke i cachen: giv skallen, så appen i det mindste tegner
      // sig selv og kan sige, at der ikke er forbindelse.
      const skal = await caches.match('./');
      if (skal) return skal;
      throw new Error('offline');
    }
  })());
});
