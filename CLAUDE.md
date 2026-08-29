# spolen — projektregler

Privat film- og serietracker. Yggdrasil-rune. Erstatning for Sequel/Trakt.
**Flerbruger** (husstand) med **selektiv deling**. Engelsk UI, danske kommentarer.

## Før du gør noget

1. Læs `~/ClaudeMacBook/RUNE-ERFARINGER.md` — hele filen. Læs den **igen efter**
   et større stykke arbejde, ikke kun før. Nye generelle lærdomme skrives i dens Log.
2. Læs `PLAN.md` for den fase, du er i gang med.

Arven er hentet fra to steder, og det er allerede fundet — det behøver ikke findes igen:

- **Dataadgangen er tovos** (`tovo/app/server.js:872-975`). `user_id`-filteret ligger
  i FUNKTIONERNE, ikke i kaldstederne. doda kan ikke kopieres her: den er én-bruger
  og henter brugeren med `FROM users LIMIT 1`.
- **Stylesheet og skal er dodas.** `app/public/style.css` er dodas, kopieret ordret;
  spolens egne regler står i blokken nederst. Brug dodas ordforråd —
  `.btn`/`.btn.primary`/`.btn.ghost`, `.card`, `.nav-item` (aktiv = `aria-current="page"`,
  ikke en klasse), `.main`, `.sidebar`, `.sidebar-foot`, `.brand`, `.empty` +
  `.empty-title`, `.dim`, `.item-row`, `.gate` til login — **opfind ikke parallelle
  navne for det samme.**
  - **`.sidebar` og `.main` er flex-BØRN.** De skal ligge i en `.app`-forælder
    (`display: flex`). Uden den står de under hinanden, og hovedområdet ryger under
    skærmkanten — og fejlen ses **ikke** i DOM'en, kun på geometrien. Kostede en
    fejlsøgning 2026-08-28.

## Ufravigeligt

- **Nul npm-pakker, nul CDN.** Node ≥22: `node:http`, `node:sqlite`, `node:crypto`.
- **De tre dataplaner** (se `app/server.js`s hoved og migrationerne):
  1. `titles`/`episodes`/`providers` er **installationens** — INGEN `user_id`.
  2. `watches` har sin **egen tabel** — ikke `items`. Det er den største tabel.
  3. `items` er det personlige (`tracking`, `rating`, `note`, `list`, `listItem`).
  Metadata er installationens; **holdningen er brugerens**. Den grænse er husets
  vigtigste beslutning.
- **Alle udregninger i `app/shared/beregn.js`** — aldrig i `app/parts/` og aldrig i
  en rute. Webappen, MCP og iCal skal svare det SAMME på "hvad er næste usete afsnit".
  `beregn` tager **aldrig** `Date.now()` selv: "i dag" gives ind som argument.
- **Deling er en SEPARAT vej ind i dataene — aldrig en opblødning af `user_id`-filteret.**
  `hentItems`/`hentWatches` betyder præcis ÉN ting: mit eget. Vil man se en andens,
  spørger man `maaSe()` / `deltFremdrift()`. Fristelsen er et `ogsaaDelt`-flag på
  `hentItems`; det ville betyde, at ét glemt argument ét sted åbner hele historikken
  for hele huset, tavst.
- **`shares` er eksplicitte tildelinger**: ejer → modtager, for `profile`, `list` eller
  `title`. Kun ejeren kan tilbagekalde. En modtager, der prøver, får **404** — ikke 403.
- **Endepunkter uden login** (delingslinks, iCal) svarer 404 ved forkert token og må
  aldrig scanne datasættet. Brug udtryks-indekset på `$.shareToken`.
- **Hemmeligheder returneres aldrig til frontenden** — kun `…Set: true`. Se
  `HEMMELIGE_SETTINGS`. Serveren proxier hvert kald mod TMDB, Trakt og Plex.
- `app/public/app.js` og `runes/spolen.yaml` er **genererede** — redigér dem aldrig.
- Kildefiler må ikke indeholde `{{STORE_BOGSTAVER}}` eller `YGG_PAYLOAD_EOF`
  (build'et fejler højt på begge). Echo-linjer i install-scriptet: **ASCII**.
- `done_regex` i runen matcher log-linjen `spolen lytter` i `server.js`.
  Ændres teksten ét sted, skal den ændres begge steder **i samme commit**.

## Arbejdsgang

- **Bump aldrig `APP_VERSION` undervejs.** (Den bor i `app/parts/p1_core.js`.)
  Kun ved udgivelse, efter Andreas har sagt ja. Flere ændringer samles i én version.
- **Hver udgivelse SKAL tagges:** `git tag vN && git push --tags`. Install-scriptet
  henter `refs/tags/vN` — glemmer man taggen, svarer GitHub 404, og runen kan ikke
  installeres. Build'et minder om det i sin sidste linje.
- **Commit og push kræver et udtrykkeligt ja.** Et push er en udgivelse.
- **Repoet er OFFENTLIGT** (Andreas, 2026-08-28), som dodas og Sagus. **Hver ændring
  auditeres før push:** ingen rigtige mailadresser, værtsnavne eller tokens.
  `navn@eksempel.dk` og `spolen.eksempel.dk` er formerne.
- Ny generel lærdom → Loggen i `RUNE-ERFARINGER.md`. Projektspecifik → denne fil.

## Test

```sh
node --test tests/beregn.test.js      # ikke `node --test tests/` - den prøver mappen
BIND_PORT=8912 DATA_DIR=/tmp/spolendata SPOLEN_DEV=1 node app/server.js
python3 build_rune.py
```

- **Sabotér dine egne prøver, før du tror på dem.** De fem sabotager af `beregn.js`
  (huller, fremdriftens nævner, fortids-vagten i `naesteTjek`, specials-standarden,
  afsnit uden dato) skal alle gøre suiten **rød**. En grøn suite, der bliver grøn
  under sabotage, beviser ingenting.
- **Isolationsprøven skal køres med en RIGTIGT registreret anden bruger.** Første
  forsøg 2026-08-28 så grønt ud, men bruger nr. 2 var aldrig oprettet
  (`allow_registration` er som standard slået fra) — alle "tomme" svar var i
  virkeligheden *"not signed in"*. Åbn registreringen som admin først.
- Browser-panen: programmatisk rulning fyrer hverken `scroll` eller
  `IntersectionObserver`, og syntetiske keydown har tom `e.key`. Mål strukturelt
  med `read_page`/`javascript_tool` — og mål **geometrien**, ikke kun DOM'en.
