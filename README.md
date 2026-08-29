# spolen

Privat film- og serietracker som **yggdrasil-rune** — en egen udgave af trakt.tv,
der kører på din egen server, med din egen database.

Holder styr på hvad du har set, hvad du mangler, og hvornår næste afsnit sendes.
Flerbruger, så en husstand kan dele installationen — men **ingenting deles, før du
selv vælger hvem og hvor meget**.

## Hvad den kan (og hvad den ikke kan)

**Hvor kan jeg se den?** — for alle tjenester. Streamingtilgængelighed hentes fra
TMDB (JustWatch-data) pr. land: Netflix, Disney+, Max, Viaplay, TV 2 Play, Prime
Video, SkyShowtime m.fl. Kryds af hvilke abonnementer du har, og filtrér på
"hvad kan jeg se i aften uden at betale ekstra".

**Hvad har jeg set?** — Plex fuldt ud, resten ved import. Ingen kommerciel
streamingtjeneste har et offentligt API til afspilningstilstand. Plex har:
historik hentes direkte fra din server og matches **eksakt** på Plex' egne
GUID'er. Netflix kan engangs-importeres fra deres egen CSV. For alt andet
markerer man selv — præcis som i Sequel.

**Kommer der noget nyt?** — kalender over kommende afsnit for de serier, du
følger, plus iCal-feed til telefonens kalender og notifikationer.

**Import** fra Trakt (API eller CSV), Letterboxd, IMDb, TV Time, Simkl og Netflix.
Sequel synkroniserer selv til Trakt, så vejen ud af Sequel går derigennem.

## Deling

Deling er **selektiv og eksplicit**. Man vælger en person og hvor meget de ser:

| Omfang | Betyder |
|---|---|
| `profile` | Hele min historik og fremdrift |
| `list` | Én liste — fx en fælles "hvad ser vi i aften" (kan gives skriveret) |
| `title` | Én serie: hvor langt er de nået, uden afsnitstitler der spoiler |

Kun ejeren kan tage en deling tilbage.

## Teknik

Ren Node ≥22 (`node:http` + `node:sqlite` + `node:crypto`). **Nul npm-pakker,
nul CDN** — det er sikkerhedsvalget: uden afhængigheder findes der ingen
forsyningskæde at holde patchet.

```sh
BIND_PORT=8912 DATA_DIR=/tmp/spolendata node app/server.js   # kør lokalt
node --test tests/beregn.test.js                              # prøver
python3 build_rune.py                                         # byg runen
```

`app/public/app.js` og `runes/spolen.yaml` er **genererede** — ret kilderne og byg.

## Installation

Runen installeres fra Yggdrasil Panel. Opdatering er **to trin**:

1. **Runes → Browse GitHub → Reload** — henter kun rune-definitionen.
2. **Serveren → Settings → Update/Reinstall** — installerer selve appen.
   `/data` (databasen) overlever.

Efter installation: opret den første bruger — den bliver administrator.
Tilføj en (gratis) TMDB-nøgle under Settings, før du søger.

## Versionshistorik

### v1 — under udvikling
Fundamentet: flerbruger-auth (kodeord, TOTP, adgangsnøgler), de tre dataplaner,
historik-tabellen, selektiv deling, Up Next-beregningen og build-kæden.

---

Bruger TMDB's API, men er hverken godkendt eller certificeret af TMDB.
