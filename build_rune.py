#!/usr/bin/env python3
"""Bygger runes/spolen.yaml ud fra kilderne i app/.

    python3 build_rune.py

Trin:
  1. Saml app/parts/p*.js -> app/public/app.js og koer `node --check`.
  2. Stempl ?v=<APP_VERSION> ind i index.html OG skriv den tilbage til disk
     (Cloudflare edge-cacher .js/.css i timevis og ignorerer no-cache - §5).
  3. Tjek kilderne for de to ting, der oedelaegger et install-script.
  4. Spoerg git, om de GENEREREDE filer er committet.
  5. Skriv og valider runens YAML.

runes/spolen.yaml og app/public/app.js er GENEREREDE artefakter - redigér
dem aldrig i haanden.

Install-scriptet BAERER ikke app-koden, det HENTER den fra refs/tags/vN
(Sagu-broen). Derfor er der ingen brotli/base85-payload her, og derfor er
en udgivelse TRE trin:  commit -> git tag vN -> git push --tags.
Uden taggen svarer GitHub 404, og runen kan ikke installeres.
"""

import os
import re
import subprocess
import sys
import textwrap

import yaml

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, 'app')
PARTS = os.path.join(APP, 'parts')
PUBLIC = os.path.join(APP, 'public')
OUT = os.path.join(ROOT, 'runes', 'spolen.yaml')

GITHUB_BRUGER = 'andreasdinesen'
GITHUB_REPO = 'spolen'

# ---------------------------------------------- runens version vs. appens
#
# Indtil v22 var de ét tal. Runen bar ikke koden - den hentede den fra en
# tag - men taggen stod i install-scriptet, saa en ny app-udgave KRAEVEDE en
# ny rune. Andreas skulle derfor gennem panelets to trin (Reload rune, saa
# Update) ved hver eneste udgivelse for at flytte ét tal i en YAML.
#
# Fra v23 henter `app/kilde.js` koden ved hver opstart, og **en genstart ER
# opdateringen**. Runen er blevet en startsnor: den skal kun udgives, naar
# selve runen aendrer sig (variabler, startup, porte, watchers, events).
#
# Derfor to tal:
#   APP_VERSION (i app/parts/p1_core.js) - koden. Bumpes ved hver udgivelse.
#   RUNE_VERSION (her)                   - runen. Bumpes KUN naar YAML'en
#                                          herunder aendrer sig.
#
# Bumper man runen ved hver udgivelse alligevel, er man tilbage ved to trin
# i panelet, og hele oevelsen er spildt.
#
# RUNE_VERSION er ogsaa den tag, install-scriptet henter FOERSTE gang. Den
# behoever ikke vaere den nyeste - foerste opstart henter alligevel det, der
# staar i KODE_VERSION - men den skal vaere en udgave, der KAN starte, og
# den skal vaere >= FOERSTE_MED_KILDE, ellers lander en ny installation paa
# kode uden kilde.js, og saa opdaterer en genstart ingenting.
RUNE_VERSION = 23

# Panelet templaterer {{STORE_BOGSTAVER}} - staar det i en kildefil, bliver
# filen aendret bag om ryggen paa os. Og heredoc-markoeren ville lukke
# heredoc'en midt i scriptet.
HEREDOC = 'YGG_PAYLOAD_EOF'
FORBUDT_MOENSTER = re.compile(r'\{\{[A-Z_]{2,}\}\}')


def fejl(besked):
    print(f'FEJL: {besked}', file=sys.stderr)
    sys.exit(1)


def node(*args, stdin=None):
    res = subprocess.run(['node', *args], input=stdin, capture_output=True)
    return res


def app_version():
    """Versionen bor ÉT sted: `const APP_VERSION = N;` i p1_core.js."""
    sti = os.path.join(PARTS, 'p1_core.js')
    with open(sti, encoding='utf8') as fh:
        m = re.search(r'^const APP_VERSION = (\d+);', fh.read(), re.M)
    if not m:
        fejl('kunne ikke finde `const APP_VERSION = N;` i app/parts/p1_core.js')
    return int(m.group(1))


# Delte moduler, der ogsaa skal med UD I BROWSEREN.
#
# Serveren require'r dem; fladen faar dem lagt foerst i bundtet. Pointen er
# ÉN definition: en regel, der findes i to kopier, driver fra hinanden, og
# saa hedder brugeren Andreas ét sted og andreas et andet (2026-08-29).
# Modulerne skal derfor taale baade require og at blive indsat raat - de
# afslutter med `if (typeof module !== 'undefined' ...)`.
DELT_I_BUNDT = ['navn.js']


def saml_frontend():
    """shared/{DELT_I_BUNDT} + p*.js -> public/app.js, i navneorden."""
    navne = sorted(n for n in os.listdir(PARTS) if re.match(r'^p\w+\.js$', n))
    if not navne:
        fejl('ingen app/parts/p*.js at samle')
    dele = []
    for delt in DELT_I_BUNDT:
        sti = os.path.join(APP, 'shared', delt)
        if not os.path.exists(sti):
            fejl(f'shared/{delt} staar i DELT_I_BUNDT, men findes ikke')
        with open(sti, encoding='utf8') as fh:
            raa = fh.read()
        # 'use strict' i toppen af et indsat modul ville gaelde HELE bundtet.
        raa = re.sub(r"^\s*'use strict';\s*", '', raa)
        dele.append(f'/* ---- shared/{delt} (delt med serveren) ---- */\n' + raa)
    for navn in navne:
        with open(os.path.join(PARTS, navn), encoding='utf8') as fh:
            dele.append(f'/* ---- {navn} ---- */\n' + fh.read())
    samlet = '\n'.join(dele)
    ud = os.path.join(PUBLIC, 'app.js')
    with open(ud, 'w', encoding='utf8') as fh:
        fh.write(samlet)
    # Syntakstjek paa RESULTATET, ikke paa delene. En del kan vaere gyldig
    # for sig og alligevel kollidere med en anden.
    res = node('--check', ud)
    if res.returncode != 0:
        fejl('app.js er ikke gyldig JavaScript:\n'
             + res.stderr.decode('utf8', 'replace')[:2000])
    print(f'  app.js: {len(DELT_I_BUNDT)}+{len(navne)} dele, {len(samlet):,} tegn')
    return navne


def stempl_version(version):
    """?v=N i index.html - og SKRIV DEN TILBAGE til disk.

    Glemmer man tilbageskrivningen, henter hentningen den gamle HTML fra
    GitHub, og browseren bliver ved med at koere den cachede app.js (§5).
    """
    sti = os.path.join(PUBLIC, 'index.html')
    with open(sti, encoding='utf8') as fh:
        html = fh.read()
    ny = re.sub(r'(style\.css|app\.js)(\?v=\d+)?', rf'\1?v={version}', html)
    if ny != html:
        with open(sti, 'w', encoding='utf8') as fh:
            fh.write(ny)
    if f'app.js?v={version}' not in ny:
        fejl('kunne ikke stemple versionen ind i index.html')
    print(f'  index.html: stemplet ?v={version}')


def stempl_sw(version):
    """Versionen SKAL ogsaa staa i service workeren.

    Uden et versioneret cache-navn rydder `activate` aldrig de gamle filer,
    og workeren kan servere en foraeldet app.js i det uendelige - ogsaa efter
    at panelet har installeret en ny version (RUNE-ERFARINGER §5).
    """
    sti = os.path.join(PUBLIC, 'sw.js')
    if not os.path.exists(sti):
        return
    with open(sti, encoding='utf8') as fh:
        kode = fh.read()
    ny = re.sub(r'^const VERSION = \d+;', f'const VERSION = {version};', kode, count=1, flags=re.M)
    if ny != kode:
        with open(sti, 'w', encoding='utf8') as fh:
            fh.write(ny)
    if f'const VERSION = {version};' not in ny:
        fejl('kunne ikke stemple versionen i sw.js')
    print(f'  sw.js: cache-navn spolen-v{version}')


def indsaml_filer():
    """De filer, der SKAL findes efter en hentning fra GitHub."""
    ud = []
    for mappe, _, navne in os.walk(APP):
        for navn in sorted(navne):
            sti = os.path.join(mappe, navn)
            rel = os.path.relpath(sti, ROOT)
            # parts/ er KILDE - den hentes ikke med, app.js er det byggede.
            if os.path.sep + 'parts' + os.path.sep in sti:
                continue
            ud.append((rel, sti))
    if not any(r == os.path.join('app', 'server.js') for r, _ in ud):
        fejl('app/server.js mangler')
    return ud


def tjek_kilder(filer):
    for rel, sti in filer:
        if not sti.endswith(('.js', '.html', '.css', '.webmanifest')):
            continue
        with open(sti, encoding='utf8') as fh:
            indhold = fh.read()
        if HEREDOC in indhold:
            fejl(f'{rel} indeholder heredoc-markoeren {HEREDOC}')
        fund = FORBUDT_MOENSTER.search(indhold)
        if fund:
            fejl(f'{rel} indeholder {fund.group(0)} - panelet ville templatere den')
    print(f'  kilder: {len(filer)} filer tjekket')


def tjek_git(filer):
    """I hente-tilstand er det, GITHUB har, det der bliver installeret.

    Den farlige fejl er ikke en manglende fil i en liste, men en GENERERET fil,
    der ikke er committet: ligger app/public/app.js ikke i repoet, stopper
    containeren paa en 404 eller en tom side. Spoerg derfor git, ikke .gitignore.
    """
    if not os.path.isdir(os.path.join(ROOT, '.git')):
        print('  git: intet repo endnu - hentningen virker foerst naar app/ er pushet OG tagget')
        return
    res = subprocess.run(['git', '-C', ROOT, 'ls-files', '-z'], capture_output=True)
    if res.returncode != 0:
        fejl('git ls-files fejlede: ' + res.stderr.decode('utf8', 'replace')[:400])
    sporet = set(res.stdout.decode('utf8').split('\0'))
    mangler = [rel for rel, _ in filer if rel not in sporet]
    if mangler:
        print('  git: IKKE committet endnu: ' + ', '.join(mangler[:6])
              + (' ...' if len(mangler) > 6 else ''))
    beskidt = subprocess.run(['git', '-C', ROOT, 'status', '--porcelain', '--', 'app'],
                             capture_output=True).stdout.decode('utf8').strip()
    if beskidt:
        print(f'  git: {len(beskidt.splitlines())} aendrede filer i app/ - '
              'husk commit + `git tag v<N>` + `git push --tags`')
    else:
        print('  git: app/ er committet')


def hent_krop(version):
    """Den node-snas, der henter og pakker arkivet ud.

    Staar i en 'single quoted' sh-streng -> den maa IKKE indeholde '.
    """
    url = (f'https://codeload.github.com/{GITHUB_BRUGER}/{GITHUB_REPO}'
           f'/tar.gz/refs/tags/v{version}')
    return (
        'const https=require("https"),zlib=require("zlib");'
        f'const U="{url}";'
        'function d(m){console.error("[fejl] "+m);console.error("Adresse: "+U);'
        'console.error("Repoet er offentligt, saa en 404 betyder, at adressen ikke findes '
        '- tjek at taggen er pushet.");process.exit(1);}'
        'function hent(u,n){const h={"user-agent":"spolen-installer"};'
        'https.get(u,{headers:h},(r)=>{'
        'if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){'
        'if(n<=0)return d("for mange omdirigeringer");r.resume();'
        'return hent(new URL(r.headers.location,u).toString(),n-1);}'
        'if(r.statusCode!==200)return d("GitHub svarede "+r.statusCode);'
        'const g=zlib.createGunzip();'
        'g.on("error",(e)=>d("arkivet kunne ikke pakkes ud: "+e.message));'
        'r.pipe(g).pipe(process.stdout);'
        '}).on("error",(e)=>d("kunne ikke naa GitHub: "+e.message));}hent(U,3);'
    )


def hente_trin(version):
    """Faelles krop for install og update. ASCII i echo-linjerne (§2)."""
    return f"""echo "Henter app-koden fra GitHub ..."
rm -rf /tmp/spolen-hent
mkdir -p /tmp/spolen-hent
node -e '{hent_krop(version)}' > /tmp/spolen-hent/app.tar
tar x -C /tmp/spolen-hent -f /tmp/spolen-hent/app.tar

# Mappenavnet i et GitHub-arkiv er <repo>-<ref uden v>, og arkivet begynder
# med en pax_global_header-post. Ingen af delene gaettes: find den app-mappe,
# der FINDES.
NY=$(find /tmp/spolen-hent -maxdepth 2 -type d -name app | head -n 1)
if [ -z "$NY" ] || [ ! -f "$NY/server.js" ]; then
  echo "[fejl] arkivet fra GitHub indeholder ingen app/server.js"
  exit 1
fi
rm -rf app
mv "$NY" app
rm -rf /tmp/spolen-hent
"""


def install_script(version):
    """Runens STARTSNOR. Henter `v<runens version>` - ikke nyeste app-udgave.

    Runen kender kun sin egen version; resten klarer kilde.js ved foerste
    opstart. Derfor slutter scriptet ikke med "klar", men med at fortaelle,
    hvad der sker naeste gang serveren starter.
    """
    return f"""set -eu
echo "Installerer spolen (startsnor v{version}) ..."
echo "Node: $(node --version)"

{hente_trin(version)}
echo "Filer udpakket:"
ls -1 app app/public
echo "Klar. Start serveren i panelet - den henter selv nyeste"
echo "udgave (eller den, KODE_VERSION laaser til), foer den starter."
"""


def opdater_script(version):
    """update:-knappen i panelet.

    Den maa ALDRIG hente startsnorens tag, naar appen allerede er laengere
    fremme: v23 oven i v40 er en nedgradering, ingen bad om. Findes
    app/kilde.js, er den facit - den kender KODE_VERSION og henter praecis
    den udgave, serveren ville hente ved en genstart. Startsnoren er kun
    redningen, hvis app/ er vaek eller fra foer kilde.js fandtes.
    """
    hent = textwrap.indent(hente_trin(version), '  ')
    return f"""set -eu
echo "Opdaterer spolen ..."
echo "Node: $(node --version)"

if [ -f app/kilde.js ]; then
  # Panelet templaterer variabler ind i scriptets TEKST, og de findes
  # OGSAA som env i containeren. Hvilken af delene der sker, er ikke
  # bevist (doda, 2026-09-03), saa vi proever skabelonen og falder tilbage
  # til env, hvis den staar utemplateret. En laasning maa ikke kunne tabes
  # paa en antagelse om, hvad panelet goer.
  K="{{{{KODE_VERSION}}}}"
  case "$K" in
    \'\') : ;;
    seneste|latest|[0-9]*) : ;;
    *) K="${{KODE_VERSION:-}}" ;;
  esac
  echo "Oensket udgave: ${{K:-nyeste}}"
  KODE_VERSION="$K" node app/kilde.js
else
{hent}fi

echo "App-filerne er skiftet ud. Databasen i /data er uroert."
echo "Genstart spolen, saa serveren koerer den nye kode."
"""


def byg_yaml(version, rune_version):
    del version   # appens tal hoerer ikke i runen mere - se RUNE_VERSION
    return {
        'gameskill': {
            'id': 'spolen',
            'name': 'spolen',
            'category': 'Apps',
            'description': (
                'Privat film- og serietracker. Holder styr paa hvad du har set, hvad du '
                'mangler, og hvornaar naeste afsnit sendes. Henter metadata fra TMDB, '
                'viser hvor titlen kan streames, importerer historik fra Trakt, Plex, '
                'Letterboxd og Netflix, og deler praecis det, du vaelger, med resten af '
                'husstanden. Egen SQLite-database, ingen eksterne afhaengigheder.'
            ),
            'author': 'andreas',
            'version': rune_version,
            'icon': 'app',
            'docker': {'image': '{{NODE_IMAGE}}'},
            'variables': [
                {'key': 'APP_NAME', 'name': 'Appens navn', 'type': 'string', 'default': 'spolen'},
                {'key': 'NODE_IMAGE', 'name': 'Node-image', 'type': 'string',
                 'default': 'node:24-alpine',
                 'pattern': r'^node:[0-9][A-Za-z0-9._-]*$',
                 'hint': 'Skal vaere et node:-image, fx node:24-alpine'},

                # Laasen. Tom er STANDARDEN, fordi det er den, der goer runen
                # overfloedig i hverdagen: tom = hent nyeste ved hver
                # genstart. Et tal er hele vejen tilbage - saet 21, genstart,
                # og serveren koerer v21 igen.
                #
                # »goer det normale« maa ikke kraeve, at der staar noget: et
                # felt, man SKAL udfylde for at faa den almindelige opfoersel,
                # laeser man som en indstilling, nogen har taget (Andreas
                # efter doda v82). Ordene godtages stadig - gamle servere kan
                # have dem staaende.
                #
                # Spoergsmaalstegnet i moensteret er noedvendigt: uden det kan
                # den tomme standard ikke gemmes i panelet. Og moensteret
                # afviser »v21« og »21.2« DER, frem for at lade kilde.js
                # tolke noget, brugeren ikke skrev.
                {'key': 'KODE_VERSION', 'name': 'Kodeversion', 'type': 'string',
                 'default': '',
                 'pattern': r'^([0-9]+|seneste|latest)?$',
                 'hint': 'Tom = hent nyeste udgivelse fra GitHub ved hver genstart. '
                         'Et tal (fx 21) laaser til praecis den udgave.'},
            ],
            # Der staar ikke et GITHUB_TOKEN her. Repoet er offentligt, saa
            # hentningen kraever ingen godkendelse - og et felt, der ikke goer
            # noget, er et sted at lede efter en fejl, der ikke er der.
            # Begge scripts henter STARTSNOREN, ikke nyeste app-udgave:
            # runen kender kun sin egen version. Resten klarer kilde.js.
            'install': {'image': '{{NODE_IMAGE}}', 'script': install_script(rune_version)},
            'update': {'image': '{{NODE_IMAGE}}', 'label': 'Opdater spolen',
                       'script': opdater_script(rune_version)},
            'startup': {
                # Opstarten ER opdateringen. Tre trin, i den raekkefoelge:
                #
                #  1. Redningen. kilde.js bytter app/ ud med to omdoebninger,
                #     og doer containeren imellem dem, ligger den gamle app
                #     under .spolen-gammel. Uden det her trin ville et
                #     daarligt sekund efterlade en container helt UDEN app/ -
                #     og saa er der heller ingen kilde.js til at hente en ny.
                #     Det er den eneste rigtigt farlige brik; alt andet
                #     herinde maa fejle uden konsekvens.
                #  2. Hentningen. Fejler den, siger den det og gaar videre -
                #     den kode, der ligger, er stadig en koerende spolen.
                #     Derfor `|| echo`, og derfor skriver kilde.js aldrig
                #     [fejl] i en advarsel: panelets watcher taeller de
                #     linjer og ville sende en notifikation, hver gang nettet
                #     blinkede.
                #
                #     `if [ -f ... ]` foran er ikke pynt. Laaser KODE_VERSION
                #     tilbage til en udgave fra FOER kilde.js fandtes, er
                #     modulet vaek sammen med resten af app/, og `node
                #     app/kilde.js` ville kaste et Node-stakspor i panelets
                #     log ved HVER genstart. `||` fanger det, saa serveren
                #     starter - men et stakspor, der ikke er en fejl, bliver
                #     liggende for evigt (tovo, 2026-09-03). Sig i stedet,
                #     hvad vejen videre er.
                #  3. Serveren, som foer. node:sqlite er stabil fra Node 24,
                #     men flaget skal stadig kunne bruges paa et aeldre image.
                'command': ('if [ ! -f app/server.js ] && [ -f .spolen-gammel/server.js ]; then\n'
                            '  rm -rf app\n'
                            '  mv .spolen-gammel app\n'
                            '  echo "[kode] app/ sat tilbage efter en afbrudt udskiftning"\n'
                            'fi\n'
                            'if [ -f app/kilde.js ]; then\n'
                            '  node app/kilde.js || echo "[kode] advarsel: opdateringen kunne ikke koeres"\n'
                            'else\n'
                            '  echo "[kode] denne udgave henter ikke sig selv - brug Opdater spolen i panelet"\n'
                            'fi\n'
                            'if node -e "require(\'node:sqlite\')" >/dev/null 2>&1; then\n'
                            '  exec node app/server.js\n'
                            'else\n'
                            '  exec node --experimental-sqlite app/server.js\n'
                            'fi\n'),
                # Matcher PRAECIS log-linjen i server.js. AEndres teksten ét
                # sted, skal den aendres begge steder i samme commit.
                'done_regex': 'spolen lytter',
                'stop_timeout': 30,
            },
            'ports': [{'name': 'web', 'default': 3000, 'protocol': 'tcp'}],
            'watchers': [{'name': 'Serverfejl i spolen', 'pattern': r'\[fejl\]', 'threshold': 5}],
            # events: er IKKE watchers:. Panelet kraever key + label + match,
            # og `match` skal have en INDFANGNINGSGRUPPE - den er det subjekt,
            # haendelsen rulles op pr. (her IP-adressen). Foerste udgave brugte
            # watchers-skemaet (name + pattern) og blev afvist af panelet med
            # "gameskill.events[0].key is required". Se tjek_events() nedenfor.
            'events': [
                {'key': 'spolen_login_fejl',
                 'label': 'Mislykket login i spolen',
                 'match': r'\[sikkerhed\] login-fejl bruger=\S+ ip=(\S+)'},
                {'key': 'spolen_totp_fejl',
                 'label': 'Forkert totrinskode i spolen',
                 'match': r'\[sikkerhed\] totp-fejl bruger=\S+ ip=(\S+)'},
                {'key': 'spolen_noegle_afvist',
                 'label': 'Afvist adgangsnoegle i spolen',
                 'match': r'\[sikkerhed\] noegle-afvist ip=(\S+)'},
                {'key': 'spolen_ical_afvist',
                 'label': 'Afvist kalender-token i spolen',
                 'match': r'\[sikkerhed\] ical-token-afvist ip=(\S+)'},
                {'key': 'spolen_registrering_afvist',
                 'label': 'Afvist registrering i spolen',
                 'match': r'\[sikkerhed\] registrering-afvist ip=(\S+)'},
            ],
            # Plakaterne er REN CACHE - de kan altid hentes fra TMDB igen.
            # Derfor kun databasen i backuppen: et hus med 500 titler har
            # let 20 MB plakater, og de ville fylde hver eneste backup uden
            # at indeholde noget, man ikke kan skaffe igen.
            'backup': {'include': ['spolen.db']},
            'wipe': {'paths': ['spolen.db', 'spolen.db-wal', 'spolen.db-shm', 'posters'],
                     'backup_first': True},
        }
    }


def tjek_events(doc):
    """events: har et ANDET skema end watchers: - og panelet siger det foerst.

    Panelet afviste v1 med "gameskill.events[0].key is required", fordi
    blokken var skrevet med watchers' felter (name + pattern). Vagten her
    flytter den besked fra panelet til build'et, hvor den hoerer hjemme.
    """
    for i, e in enumerate(doc['gameskill'].get('events', [])):
        for felt in ('key', 'label', 'match'):
            if not e.get(felt):
                fejl(f'events[{i}] mangler "{felt}" - events er ikke watchers')
        if '(' not in e['match']:
            fejl(f'events[{i}].match har ingen indfangningsgruppe - '
                 'uden den er der intet subjekt at rulle haendelsen op pr.')
        try:
            re.compile(e['match'])
        except re.error as err:
            fejl(f'events[{i}].match er ikke et gyldigt regulaert udtryk: {err}')
    for i, w in enumerate(doc['gameskill'].get('watchers', [])):
        for felt in ('name', 'pattern'):
            if not w.get(felt):
                fejl(f'watchers[{i}] mangler "{felt}"')
    print(f'  events: {len(doc["gameskill"].get("events", []))} gyldige, '
          f'watchers: {len(doc["gameskill"].get("watchers", []))}')


def foerste_med_kilde():
    """Det tal, app/kilde.js selv siger er den foerste selvhentende udgave.

    Det staar ÉT sted (i kilde.js), fordi to kopier af det tal ville drive
    fra hinanden - og forskellen ville foerst vise sig hos en, der
    installerer forfra.
    """
    with open(os.path.join(APP, 'kilde.js'), encoding='utf8') as fh:
        m = re.search(r'^const FOERSTE_MED_KILDE = (\d+);', fh.read(), re.M)
    if not m:
        fejl('kunne ikke finde `const FOERSTE_MED_KILDE = N;` i app/kilde.js')
    return int(m.group(1))


def tjek_startsnor(rune_version, version):
    """Runen er en startsnor - men den skal kunne baere sin egen vaegt.

    To ting kan gaa galt uset, og begge viser sig foerst hos en, der
    installerer forfra:

      * peger startsnoren paa en tag, der er NYERE end app-koden, findes
        taggen ikke endnu, og install svarer 404;
      * peger den paa en tag fra FOER kilde.js fandtes, lander en frisk
        installation paa kode, der ikke kan hente sig selv - og saa
        opdaterer en genstart ingenting, hvilket er praecis den ting, hele
        oevelsen skulle fjerne.
    """
    if rune_version > version:
        fejl(f'RUNE_VERSION ({rune_version}) er nyere end APP_VERSION ({version}) - '
             'install ville hente en tag, der ikke findes')
    foerste = foerste_med_kilde()
    if rune_version < foerste:
        print()
        print(f'  ADVARSEL: startsnoren peger paa v{rune_version}, og kilde.js kom')
        print(f'            foerst i v{foerste}. En frisk installation ville lande paa')
        print('            kode uden kilde.js og aldrig hente sig selv.')
        print(f'            Saet RUNE_VERSION = {foerste} (eller nyere) ved udgivelsen.')
        print()


def main():
    print('spolen - bygger rune')
    version = app_version()
    print(f'  app:  v{version}')
    print(f'  rune: v{RUNE_VERSION}' + ('' if RUNE_VERSION == version else '  (startsnor - bumpes kun naar YAML aendrer sig)'))
    saml_frontend()
    stempl_version(version)
    stempl_sw(version)
    filer = indsaml_filer()
    tjek_kilder(filer)
    tjek_git(filer)
    tjek_startsnor(RUNE_VERSION, version)

    doc = byg_yaml(version, RUNE_VERSION)
    tjek_events(doc)
    tekst = yaml.dump(doc, allow_unicode=False, sort_keys=False, width=120)
    # Valider ved at LAESE den igen - en YAML, panelet ikke kan parse, er
    # vaerre end ingen YAML.
    tilbage = yaml.safe_load(tekst)
    if tilbage['gameskill']['version'] != RUNE_VERSION:
        fejl('YAML-rundturen gav en anden version')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf8') as fh:
        fh.write(tekst)
    print(f'  runes/spolen.yaml: {len(tekst):,} tegn')
    print()
    print(f'Faerdig. Udgivelse er TRE trin:  commit  ->  git tag v{version}  ->  git push --tags')
    print('Uden taggen svarer GitHub 404 - baade til runens install og til')
    print('serverens egen hentning ved opstart.')
    if RUNE_VERSION == version:
        print()
        print(f'RUNE_VERSION er ogsaa {version} denne gang, saa runen skal genindlaeses')
        print('i panelet. Ellers er en genstart nok.')


if __name__ == '__main__':
    main()
