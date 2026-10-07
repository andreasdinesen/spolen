# Beslutninger og begrundelser

> Reddet fra den gamle faseplan (`PLAN.md`, fjernet 2026-10-07) — kun det, der stadig
> gælder og er tjekket mod koden. Status, faser og to-do er kasseret; historikken
> ligger i git (`git log -- PLAN.md`).

## Metadata og baggrundsjobbet

- **`metadata_language` er installationens, ikke brugerens.** Metadata-cachen har ÉN
  række pr. titel, så dens sprog kan ikke være personligt. Den bruges overalt, hvor
  metadata SKRIVES (tilføj + opdatér). Den personlige `language` gælder kun søgningen,
  hvis resultater ikke caches.
- **En titel, TMDB ikke kan slå op, skubbes et døgn frem** (`next_check_at`) — ellers
  hentes den hver time for evigt. Men **ikke** ved `tmdb_bad_key` eller
  `tmdb_rate_limited`: de fejl er vores, ikke titlens, og ville udsætte hele
  biblioteket et døgn.
- **Bevidste fejl (med en `kode`) beholder deres besked**, også som 5xx. Reglen »en
  500 røber aldrig sin egen besked« gælder kun uventede nedbrud — ellers bliver
  »der er ingen TMDB-nøgle« til »Something went wrong on the server«.

## Import (fil, Trakt, Plex)

- **Én vej ind i historikken:** fil, Trakt og Plex går alle gennem
  `koerImportRaekker()`. Byg aldrig en fjerde vej.
- **Formatet genkendes på headerne**, ikke på filnavnet.
- **Matchning efter pålidelighed, ikke hastighed:** 1) `tmdb_id` fra eksporten
  (eksakt), 2) `imdb`/`tvdb`-id via TMDB's `/find` (eksakt, ét opslag), 3) titel +
  årstal — et *gæt*, markeret som usikkert. Opslag caches på tværs af hele kørslen.
- **Datoretningen (d/m vs. m/d) udledes af HELE filen** — kun entydige rækker (et tal
  over 12) tæller, og kun de erklærede datokolonner spørges (en titel med »9/11« må
  ikke forgifte det). Resultatet vises med et `sikker`-flag, så et gæt aldrig er skjult.
- **Én dårlig række må aldrig koste hele importen** — oversættelsen skal tåle tomme
  poster (Trakt sendte en).
- **Trakt:** device-code-login (ingen `redirect_uri` at registrere pr. husstand).
  Tokenet er **brugerens**, ikke installationens.
- **Plex:** både de nye GUID-former (`imdb://`, `tmdb://`, `tvdb://`) og de gamle
  `com.plexapp.agents.*`-URI'er læses — en gammel server har begge side om side.
  GUID'er slås op pr. **unik titel**, ikke pr. post. `plex_last_sync` gemmer nyeste
  `viewedAt`. **Kontovalget** (`plex_account_id`) er der, fordi spolen ellers henter
  hele serverens historik — også de andres seervaner.

## Datoer i historikken og statistikken

- **Massemarkering (`source: 'backfill'`) bruger afsnittets udsendelsesdag**, så
  dubletnøglen (bruger + afsnit + dag) er stabil og en genkørsel ikke laver nye rækker.
- **`datoSikker: false` gælder kun kilden `undated`** (hverken dato fra kilden eller
  en udsendelsesdag). De tæller med i totaler, genrer og tjenester, men holdes ude af
  alt, der handler om *hvornår*.
- *Kendt i data:* rækker fra før denne regel kan stå som `manual` og tælle som én
  lang aften. At omdøbe dem er en ændring af Andreas' data og kræver hans ja.

## MCP

- **Hvert værktøj får `auth` med og giver `auth.user.id` videre** — signaturen er med
  vilje ubekvem. dodas MCP er én-bruger; kopieret derfra ville en nøgle læse »første
  bruger i tabellen«.
- En nøgle uden skrive-scope afvises i `tools/call` med en læsbar besked, ikke en
  protokolfejl — så kan modellen rette op.

## Flade

- **Søgefeltet genskabes aldrig under indtastning** — resultaterne har deres egen
  beholder. Gentegnes hele siden, mister feltet fokus (`activeElement` bliver BODY).
- Mobilmenuens knap: pladsen laves i den `sticky` topbjælke, ikke som topmargen på
  `.main` (bjælken med `top: 0` slipper uden om margenen). Sidebarens indglidnings-
  tilstand står utvetydigt i spolen-blokken nederst i `style.css` frem for at jagte,
  hvilken arvet doda-regel der taber.

## Audit før push

- **Kør auditten i Python, ikke med `grep --include=*.js` i zsh** — zsh æder mønstrene,
  og hver »ingen fund« er i virkeligheden en shell-fejl. En audit, der ikke kører, ser
  ud til at bestå.
- Testfixtures, der ligner nøgler, skal *se* falske ud (`deadbeef…`).
