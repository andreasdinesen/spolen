# Versionsnumre og selvhentning

> Flyttet ordret fra `CLAUDE.md` (2026-10-07). Læs den, før du rører
> `APP_VERSION`/`RUNE_VERSION`, `app/kilde.js`, runens `startup:`/`update:` eller låsen.

- **To versionsnumre, og de følges IKKE ad:**
  - `APP_VERSION` (i `app/parts/p1_core.js`) er koden. Bumpes ved hver udgivelse.
  - `RUNE_VERSION` (i `build_rune.py`) er runen. **Bumpes kun, når YAML'en selv
    ændrer sig** — variabler, porte, `startup`, watchers, events. Bumper man den
    ved hver udgivelse, er man tilbage ved panelets to trin, og hele pointen med
    selvhentningen er væk.
  - `RUNE_VERSION` må aldrig overhale `APP_VERSION` (build'et fælder på det): så
    peger startsnoren på en tag, der ikke findes, og runen kan ikke installeres
    forfra. **Det viser sig aldrig hos en, der allerede har en kørende server.**
  - Og den skal være ≥ `FOERSTE_MED_KILDE` i `app/kilde.js` — ellers lander en frisk
    installation på kode uden `kilde.js`, som aldrig henter sig selv.
- **Serveren henter sin egen kode ved opstart** (`app/kilde.js`, kørt fra runens
  `startup:` før serveren). **En genstart ER opdateringen.** Reglerne, der bærer det:
  1. Alt i `kilde.js` ender med `exit 0`. Kan GitHub ikke nås, starter serveren på
     den kode, der ligger. En netværksfejl må udsætte en opdatering — aldrig slukke
     for appen.
  2. Der pakkes ud i `.spolen-ny/` **ved siden af** `app/`, aldrig i `/tmp`: to
     `rename` inden for samme filsystem kan ikke afbrydes på midten, en kopi kan.
     Mellem de to omdøbninger ligger den gamle app under `.spolen-gammel`, og
     `startup:` sætter den tilbage. **Det er den eneste rigtigt farlige brik.**
  3. `tjekTrae`s fil-liste skal spejle **alt, `server.js` require'r på modulniveau**.
     `tests/kilde.test.js` håndhæver det — tilføjer du et modul, skal det på listen,
     ellers godkendes et halvt arkiv, og containeren dør med MODULE_NOT_FOUND.
  4. Advarsler i `kilde.js` skriver **aldrig** `[fejl]` — panelets watcher tæller de
     linjer og ville notificere, hver gang nettet blinkede.
- **`update:`-scriptets else-gren er lige så farlig som `kilde.js`.** Den bruges kun,
  når `kilde.js` ikke findes — altså ved den ene opgradering, hele mekanikken handler
  om, og fejl dér kan `kilde.js` ikke rette, for den er der ikke. Sagu lå nede i ti
  timer på præcis den funktion (2026-09-04). Reglerne er de samme som i `kilde.js`:
  ingen `/tmp`, to `rename`, og den gamle app **flyttet** til `.spolen-gammel` frem
  for slettet. `tjek_scripts()` i build'et og `tests/opdatering.test.js` vogter begge
  dele — prøven kører **panelets eget script**, hevet ud af YAML'en.
- **Knappen genstarter ikke serveren.** Panelets `app-update` svarer 202 og lader
  processen køre videre på de nye filer. Derfor slutter scriptet med en ramme, der
  beder om en genstart — og en prøve holder den på plads som **sidste** linjer.
- **Rækkefølgen i `update:`: `if [ -f app/kilde.js ]` FØRST.** Henter man startsnoren
  først og kører `kilde.js` bagefter, nedgraderer hvert tryk appen til runens tag —
  og fejler nettet i andet trin, bliver den liggende der, tavst (tovo, 2026-09-04).
- **Låsen er `mkdir .spolen-laas`** (atomisk; `[ -d ] && mkdir` har et hul), om **hele**
  scriptet, og frigivet af en `trap`. En strandet lås ryddes af `startup`, fordi
  `trap` ikke når at køre ved et hårdt drab.
