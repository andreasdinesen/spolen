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

const VERSION = 29;               /* stemples af build_rune.py */
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

  /*
   * HTML-SKALLEN HENTES FRA NETTET FØRST. Cachen er kun nødnettet offline.
   *
   * Første udgave serverede ALT cache-først, også '/'. Det satte hele
   * versionsstemplingen ud af kraft: den cachede HTML pegede på app.js?v=3,
   * og den fil lå også i cachen — så en installeret v4 kørte v3's frontend
   * i browseren for evigt. Målt 2026-08-29: serveren udleverede v4 med de
   * rigtige funktioner i, mens browseren viste v2-fladen.
   *
   * De VERSIONEREDE filer må gerne komme fra cachen: deres URL skifter ved
   * hver udgivelse, så en gammel kopi kan aldrig forveksles med en ny. Det
   * er kun skallen, der har samme adresse hele vejen igennem, og derfor er
   * det kun skallen, der skal spørge nettet.
   */
  const erSkal = req.mode === 'navigate'
    || url.pathname === '/'
    || url.pathname.endsWith('/index.html');

  if (erSkal) {
    e.respondWith((async () => {
      try {
        const frisk = await fetch(req);
        if (frisk && frisk.ok) (await caches.open(CACHE)).put('./', frisk.clone());
        return frisk;
      } catch {
        // Offline: vis den sidst kendte skal, så appen i det mindste
        // tegner sig selv og kan sige, at der ikke er forbindelse.
        const cachet = await caches.match('./');
        if (cachet) return cachet;
        throw new Error('offline');
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cachet = await caches.match(req);
    if (cachet) return cachet;
    try {
      const frisk = await fetch(req);
      // Kun de versionerede filer gemmes. Alt andet ville samle sig op.
      if (frisk && frisk.ok && url.search.startsWith('?v=')) {
        (await caches.open(CACHE)).put(req, frisk.clone());
      }
      return frisk;
    } catch {
      const skal = await caches.match('./');
      if (skal) return skal;
      throw new Error('offline');
    }
  })());
});

/*
 * NOTIFIKATIONER.
 *
 * De to lyttere herunder er HELE grunden til, at en push-besked bliver til
 * noget, man kan se. Uden dem modtager browseren beskeden, kaster den vaek
 * og siger ingenting - serveren faar 201 fra push-tjenesten og tror, at alt
 * er vel.
 *
 * v5 omskrev filen for at rette cachen og tabte dem undervejs. Fra v5 til
 * v29 kom der derfor ingen notifikationer overhovedet, heller ikke
 * proeven fra Settings. tests/push.test.js holder nu oeje med, at de findes.
 *
 * Safari paa iPhone er strengere endnu: en push, der ikke viser en
 * notifikation, taeller som en "lydloes" push, og efter nogle af dem
 * tilbagekalder Safari abonnementet. Derfor vises der ALTID noget - ogsaa
 * naar beskeden ikke kan laeses.
 */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'spolen' }; }
  // Serveren sender Declarative Web Push (`web_push: 8030`); teksten ligger
  // saa under `notification`. Viser systemet den selv, kommer vi aldrig hertil.
  if (d && d.notification) d = { ...d.notification, url: d.notification.navigate };
  e.waitUntil(self.registration.showNotification(d.title || 'spolen', {
    body: d.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    // Samme tag = en NY besked erstatter den gamle i stedet for at stable
    // sig op. To afsnit af samme serie paa én dag bliver til én besked.
    tag: d.tag || d.url || 'spolen',
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const maal = new URL((e.notification.data && e.notification.data.url) || '/',
    self.location.origin).href;
  e.waitUntil((async () => {
    /*
     * Er appen allerede aaben, skal den have FOKUS - ikke aabnes igen.
     * Ellers ender man med en ny fane hver gang, man trykker paa en besked.
     */
    const klienter = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const k of klienter) {
      if (new URL(k.url).origin === self.location.origin) {
        await k.focus();
        if ('navigate' in k) await k.navigate(maal).catch(() => null);
        return;
      }
    }
    await self.clients.openWindow(maal);
  })());
});
