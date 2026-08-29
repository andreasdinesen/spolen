# spolen — faseplan

Den fulde plan med begrundelser ligger i samtalens plandokument. Her står kun,
**hvor vi er**. Opdatér efter hver fase.

| Fase | Indhold | Status |
|---|---|---|
| **F0** | Repo, build-kæde, rune-YAML, auth-stak, de tre dataplaner, selektiv deling, Up Next | **Færdig, ikke udgivet** |
| **F1** | TMDB-klient + cache, søg, titelvisning, marker set | **Bygget, ikke prøvet mod TMDB** |
| **F2** | Kalender, baggrundsopdatering, iCal | **Bygget** — notifikationer mangler |
| **F3** | Importpipeline + parsere + Trakt-bro | **Bygget** (zip mangler) |
| **F4** | Watch providers, "mine tjenester", statistik, husstandsvisninger | Ikke begyndt |
| **F5** | Plex: historik, polling, webhook, lokalt katalog | Ikke begyndt |
| **F6** | MCP + connector, Shortcuts-API, PWA, mobilgennemgang | Ikke begyndt |

## F0 — hvad der står, og hvad der er efterprøvet

**Bygget:** `app/server.js` (~2.060 linjer), `app/shared/beregn.js`,
`app/parts/p1_core.js` + `p2_app.js`, `build_rune.py`, `runes/spolen.yaml`,
`tests/beregn.test.js`. Auth (scrypt, sessioner, TOTP, adgangsnøgler, rate-limit)
er tovos stak kopieret ordret.

**Efterprøvet 2026-08-28:**
- Alle fire migrationer kører; skemaet bygges fra tomt.
- 20 prøver af `beregn.js` grønne — og **fem sabotager gør dem røde**.
- Isolationen: ni angreb fra en rigtigt registreret bruger nr. 2 afvist,
  ejerens data urørt.
- Selektiv deling: titel-deling lækker ikke andre titler, profil-deling udvider,
  tilbagekaldelse virker, modtager kan ikke tilbagekalde, fire fejlstier afvist.
- Fladen renderer: login, skal, Up Next-tomtilstand, delingsside.

**Ikke efterprøvet endnu:**
- Runen er aldrig installeret i panelet (kræver commit + tag + push).
- Ikonet `icon-192.png` mangler — kun `icon.svg` findes.
- Ingen TMDB-hentning, så fremdriftstallene er nul overalt. Det er F1.
- Passkeys/WebAuthn-modulet er kopieret ind, men hverken koblet på eller prøvet.


## F1 — hvad der står, og hvad der er efterprøvet

**Bygget:** `app/tmdb.js` (klient + oversættelse), plakat-proxy med diskcache i
`/data/posters`, ruterne `GET /api/search`, `POST /api/titles`, `GET /api/library`,
`DELETE /api/watches/episode/:id` og `GET /api/poster/:size/:navn`, samt
`app/parts/p3_soeg.js` (søgning, bibliotek, titelvisning).

**Efterprøvet 2026-08-28 (uden TMDB-nøgle, med sået testdata):**
- 24 prøver grønne; otte sabotager i alt gør dem røde.
- Up Next følger `beregn` mod rigtige data over HTTP: første usete, hullet
  (fjern S1E2 → den bliver næste, ikke S2E3), ajour-tilstanden (nedtælling i
  stedet for "se nu"), og markér/afmarkér frem og tilbage.
- Fladen: bibliotek med fremdriftsbjælke, titelvisning med sæsoner, markering
  opdaterer både bjælken og Up Next.
- Fejlstien uden nøgle peger på Settings — og udløser **ikke** runens
  `[fejl]`-watcher.

**To fejl fundet og rettet undervejs:**
1. **Bevidste 5xx-fejl fik deres besked slugt.** Reglen »en 500 røber aldrig sin
   egen besked« er rigtig for nedbrud, men den gjorde "der er ingen TMDB-nøgle"
   til "Something went wrong on the server". Fejl med en `kode` er bevidste og
   beholder nu deres besked; uventede fejl er uændret.
2. **Søgefeltet mistede fokus efter 350 ms.** Hvert tastetryk gentegnede hele
   siden, så inputfeltet blev revet ned og bygget op igen. Målt:
   `activeElement` blev til BODY. Resultaterne har nu deres egen beholder, og
   feltet genskabes aldrig under indtastning.

**Ikke efterprøvet:** alt der kræver en rigtig TMDB-nøgle — søgning, tilføjelse
af en rigtig titel, sæsonhentningen og plakat-proxyens succesvej. Koden er skrevet
og fejlstierne er prøvet, men den første rigtige titel er ikke hentet endnu.


## F2 — hvad der står, og hvad der er efterprøvet

**Bygget:** baggrundsjob der holder metadata frisk (kører af sig selv hver time),
kalendervisning grupperet pr. dag, iCal-feed med token, og `metadata_language`
som installationsindstilling.

**Den ene arkitektoniske afklaring:** metadata-cachen har ÉN række pr. titel, så
dens sprog kan ikke være personligt. `metadata_language` er derfor installationens
og bruges overalt hvor metadata SKRIVES (tilføj + opdatér). Den personlige
`language` gælder kun søgningen, hvis resultater ikke caches.

**Efterprøvet 2026-08-29:**
- Jobbet kørte to titler: den ægte lykkedes, den syntetiske fejlede pænt, og
  jobbet **fortsatte** i stedet for at stoppe. Admin-gated (bob afvist).
- Kalenderen: 13 afsnit over 12 dage med relative dagnavne. Datoskiftet i nat
  bekræftede "Yesterday"/"Tomorrow"-udregningen gratis.
- iCal: forkert token → 404, for kort token → 404, **fremmed session → 404**,
  egen session → 200, POST → 405, efter tilbagekald → 404.
- `EXPLAIN QUERY PLAN` på alle tre varme stier (feed-opslag, kalenderinterval,
  "hvad er forfaldent") viser **indeks-opslag, ingen scanninger**.
- 34 prøver grønne; ti sabotager i alt gør dem røde.

**Én fejl fundet og rettet:** en titel, TMDB ikke kan slå op, fik ikke sin
`next_check_at` rykket frem og blev derfor hentet **hver time for evigt**.
Målt: den stod på `1`. Nu skubbes den et døgn frem ved titel-fejl — men
*ikke* ved dårlig nøgle eller rate-limit, for de fejl er vores, ikke titlens,
og ville ellers udsætte hele biblioteket et døgn.

**Ikke bygget: notifikationer.** Web push kræver VAPID-nøgler, en service worker
og **https** — over panelets `IP:port` kan de slet ikke virke. De hører sammen
med PWA-arbejdet i F6 og bør bygges der, når appen har et rigtigt domæne.


## F3 — hvad der står, og hvad der er efterprøvet

**Bygget:** `app/shared/import.js` (ren CSV-læser + seks formatparsere),
matchning mod TMDB efter pålidelighed, importjob som baggrundsjob på serveren,
og en trestrins-flade i Settings: vælg fil → se hvad appen forstod → importér.

**Formater:** Netflix viewing activity, Trakt-CSV, Letterboxd (diary + watched),
IMDb, TV Time. Genkendes på **headerne**, ikke på filnavnet.

**Matchning efter pålidelighed, ikke efter hastighed:**
1. `tmdb_id` fra eksporten — eksakt, intet opslag.
2. `imdb`/`tvdb`-id via TMDB's `/find` — eksakt, ét opslag.
3. Titel + årstal — et *gæt*, og markeret som usikkert.

Opslagene caches på tværs af hele kørslen: 300 Netflix-rækker fra samme serie
giver **ét** titelopslag, ikke 300.

**Efterprøvet 2026-08-29:**
- 62 prøver grønne; ti sabotager på importlaget alene gør dem røde.
- Ægte import kørt mod TMDB (til en testbruger, ikke Andreas' bibliotek):
  3 af 4 rækker matchet og skrevet, den opdigtede serie afvist med en læsbar
  grund, Alices bibliotek urørt.

**To fejl fundet og rettet:**
1. **Datoerne blev læst baglæns.** `03/02/2022` blev til 2. marts i stedet for
   3. februar. Retningen udledes nu af **hele filen** — kun de rækker, der er
   entydige (et tal over 12), tæller — og resultatet vises for brugeren med et
   `sikker`-flag, så et gæt aldrig er skjult. Kun de erklærede datokolonner
   spørges, så en titel med "9/11" ikke kan forgifte det.
2. **Fremdriften nåede aldrig 100 %**, fordi den umatchede gren sprang forbi
   optællingen. Et færdigt job så ud til at hænge.

**Ikke bygget:**
- **Trakt-broen** (device-code-OAuth + `/sync/*`). Det er den anbefalede vej ud
  af Sequel, og den mangler stadig. Filimporten er fundamentet, den skal stå på.
- **Zip-filer** (TV Time GDPR-eksport). Parseren tager CSV-tekst; zip kræver
  `DecompressionStream` i browseren.


## F4 — hvad der står, og hvad der er efterprøvet

**Bygget:** streamingudbud pr. titel med cache og `previous`-diff (S1/S3),
afkrydsning af egne abonnementer fra TMDB's landeliste (S2), statistikside med
`app/shared/statistik.js`, og "set sammen" (H1) der kun kan skrive i en andens
historik, hvis **den anden** har delt sin profil.

**Efterprøvet 2026-08-29:** 62 tjenester hentet for DK, Reacher korrekt vist på
Prime Video, statistik over 375 rigtige poster. 77 prøver grønne; syv sabotager
på statistiklaget alene gør dem røde.

**Én fejl i mine egne tal, fundet og rettet:** massemarkering skrev `watchedAt =
nu` på alle afsnit, så statistikken påstod "længste aften: 375 ting, 194 timer".
Vi ved **at** de er set, ikke **hvornår**. Massemarkeringer får nu kilden
`backfill` og bærer et `datoSikker: false`-flag: de tæller med i totaler, genrer
og tjenester, og holdes ude af alt, der handler om hvornår. Fladen siger det.

**Kendt begrænsning:** de 351 rækker, der allerede lå i basen før rettelsen, står
som `manual` og tælles derfor stadig som én aften. De kan omdøbes til `backfill`,
men det er en ændring af Andreas' data og kræver hans ja.

**Ikke bygget i F4:** sofalisten (H2) og "forsvinder snart" kan først _vises_ som
en forskel, når udbuddet er hentet to gange med en uges mellemrum — mekanikken
står, men den har intet at vise endnu.


## F3 færdiggjort + UI-pudsning (2026-08-29)

**Massemarkering bruger nu udsendelsesdagen** (Andreas). Filteret slipper kun
afsnit igennem, der HAR en dato, så der er altid en at bruge — og dubletnøglen
(bruger + afsnit + dag) bliver stabil, så en genkørsel ikke laver nye rækker.
`datoSikker: false` gælder nu kun kilden `undated`: poster, hvor der hverken er
en dato fra importen eller en udsendelsesdag.

**Trakt-broen er bygget.** Device-code-login (ingen redirect_uri, som ellers
skulle registreres pr. husstand), `/sync/history` + `/sync/watchlist` med
paginering og loft. Historik og watchlist går gennem **samme importmotor** som
filimporten — `koerImportRaekker()` — så der ikke findes to veje ind i historikken.
Tokenet er brugerens, ikke installationens: to i huset har hver sin Trakt-konto.

**Én fejl fanget af prøverne:** oversættelsen kastede på en tom post fra Trakt.
Én dårlig række ville have kostet **hele** historikken, ikke bare den ene.

**UI-pudsning:** ikoner i sidebar og mærke (inline SVG, `currentColor`, ingen
ikonfont), og mobilmenu med hamburger, indglidende sidebar og slør.

**To fejl fundet ved måling, ikke ved øjesyn:**
1. Menuknappen lå oven i søgefeltet. `.main` har 64px topmargen til knappen, men
   topbjælken er `sticky` med `top: 0` og slipper uden om den. Pladsen laves nu
   i bjælken.
2. Sidebaren gled ikke ind: dodas arvede regel vandt ikke. I stedet for at jagte
   hvilken regel der tabte (CSSOM-søgning er upålidelig, §4) står tilstanden
   utvetydigt i spolen-blokken, som alligevel er sidst.

**Stadig ikke bygget:** zip-filer (TV Times GDPR-eksport kræver
`DecompressionStream`), sofalisten (H2), notifikationer (F6, kræver https).


## F5 — hvad der står, og hvad der er efterprøvet

**Bygget:** `app/plex.js` (klient + GUID-læsning + oversættelse), test-forbindelse
med kontovalg, engangsimport og løbende hentning hvert 10. minut.

**Det afgørende ved Plex:** serveren udstiller sine egne GUID'er
(`imdb://`, `tmdb://`, `tvdb://`), så matchningen er **eksakt**. En Netflix-fil
har kun en titelstreng; her behøver vi ikke gætte. Både de nye GUID-former og de
gamle `com.plexapp.agents.*`-URI'er læses — en server, der har kørt i årevis, har
begge liggende side om side, og læser man kun de nye, mistes det gamle tavst.

GUID'er slås op pr. **unik titel**, ikke pr. post: en serie med 60 sete afsnit
giver ét opslag, ikke tres. `plex_last_sync` gemmer nyeste `viewedAt`, så en
hentning ikke gennemgår års historik hver gang.

Historikken går gennem den **fælles importmotor** — tredje kilde efter fil og
Trakt, samme vej ind.

**Kontovalget** betyder noget i en husstand: uden det henter spolen hele
serverens historik, også de andres. Det er ikke støj, men andres seervaner i din
historik.

**Efterprøvet 2026-08-29:** 95 prøver grønne; fem sabotager på Plex-laget alene
gør dem røde. Seks fejlstier prøvet mod den kørende server: ikke forbundet,
manglende adresse, ugyldig URL, adresse der ikke svarer, en server der ikke er
Plex, og isolationen mellem to brugeres integrationsstatus.

**Ikke efterprøvet:** alt der kræver en rigtig Plex-server. Oversættelsen har
prøver, men hverken forbindelse, historikhentning eller GUID-opslag er kørt mod
en levende server.

**Ikke bygget:** webhook (kræver Plex Pass, og Plex sender multipart/form-data,
som skulle parses uden pakker — polling dækker behovet med 10 minutters
forsinkelse), lokalt katalog ("har jeg den allerede på serveren", P3) og
Plex-watchlist (P4).


## F6 — hvad der står, og hvad der er efterprøvet

**Bygget:** MCP-server på `/mcp` med syv værktøjer (`up_next`, `search`, `title`,
`mark_watched`, `add_title`, `calendar`, `stats`), adgangsnøgler med scopes, og
en service worker med versionsstemplet cache.

**Den ene rettelse af dodas mønster:** dodas MCP er én-bruger, så værktøjerne
kalder uden bruger-id. Her får hvert værktøj `auth` med og giver `auth.user.id`
videre — signaturen er med vilje ubekvem. Uden det ville en nøgle læse "første
bruger i tabellen", præcis den fælde tovo advarer om.

**Efterprøvet 2026-08-29 mod den kørende server:**
- `initialize`, `tools/list`, `tools/call` virker; `up_next` og `stats` svarer
  med rigtige data.
- En **read**-nøgle ser kun de fem læse-værktøjer, og `mark_watched` afvises med
  en læsbar besked (ikke en protokolfejl — så kan modellen rette op).
- **Bobs nøgle viser Bobs data**, ikke Alices.
- Ugyldig nøgle → 401, ingen nøgle → 401, `GET /mcp` → 405,
  fremmed `Origin` → 403 (DNS-rebinding).

**To fejl fundet:**
1. `godkendMcp` blev defineret i serveren, men aldrig givet med til
   MCP-modulet — alle kald gav 500.
2. Build'ets egen vagt fangede en `{{SW_VERSION}}`-kommentar i service workeren.
   Panelet templaterer `{{STORE_BOGSTAVER}}`, så kommentaren ville være blevet
   muteret ved installation.

**Ikke bygget:**
- **Connector til claude.ai** (OAuth 2.1 med discovery, dynamisk klient-
  registrering og samtykkeside). MCP virker i dag med en Bearer-nøgle, altså fra
  Claude Code og Claude Desktop — men ikke som fjern-connector på claude.ai.
- Printgennemgang.
- Notifikationer (fra F2 — kræver https).


## v1 udgivet — 2026-08-29

`andreasdinesen/spolen`, offentligt. Commit → `git tag v1` → `git push --tags`,
alle tre trin gennemført.

**Audit før push:** hele repoet scannet for tokens, JWT'er, mailadresser,
IP-adresser og private navne. Ét fund — en opdigtet 32-hex-fixture i
`tests/tmdb.test.js`, der *lignede* en TMDB-nøgle — erstattet med `deadbeef…`,
så en læser kan se, at den er falsk. Databasen og plakat-cachen ligger i
`.gitignore` og er aldrig i repoet.

*Første auditforsøg kørte slet ikke:* zsh åd `--include=*.js`-mønstrene, og hver
"ingen fund" var en shell-fejl. En audit, der ikke kører, er værre end ingen,
fordi den ser ud til at bestå. Kørt om i Python.

**Installationsvejen er efterprøvet, ikke påstået:** tarball'en hentet fra
`refs/tags/v1` (200, 201 KB), pakket ud, `app/server.js` og den genererede
`app/public/app.js` fundet, og serveren startet på en tom datamappe — alle fem
migrationer kørte, `/api/public-config` svarede 200.

**Næste skridt for Andreas:** i Yggdrasil Panel → **Runes → Browse GitHub →
Reload**, derefter installér. TMDB-nøglen skal tastes ind igen, da den kun
findes i den lokale prøvedatabase.
