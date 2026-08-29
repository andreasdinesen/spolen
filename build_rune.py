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

import yaml

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, 'app')
PARTS = os.path.join(APP, 'parts')
PUBLIC = os.path.join(APP, 'public')
OUT = os.path.join(ROOT, 'runes', 'spolen.yaml')

GITHUB_BRUGER = 'andreasdinesen'
GITHUB_REPO = 'spolen'

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


def saml_frontend():
    """p*.js -> public/app.js, i navneorden."""
    navne = sorted(n for n in os.listdir(PARTS) if re.match(r'^p\w+\.js$', n))
    if not navne:
        fejl('ingen app/parts/p*.js at samle')
    dele = []
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
    print(f'  app.js: {len(navne)} dele, {len(samlet):,} tegn')
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
    return f"""set -eu
echo "Installerer spolen v{version} ..."
echo "Node: $(node --version)"

{hente_trin(version)}
echo "Filer udpakket:"
ls -1 app app/public
echo "Klar. Start serveren i panelet."
"""


def opdater_script(version):
    return f"""set -eu
echo "Opdaterer spolen til v{version} ..."
echo "Node: $(node --version)"

{hente_trin(version)}
echo "App-filerne er skiftet ud. Databasen i /data er uroert."
echo "Skemaet opdateres automatisk, naar serveren starter."
"""


def byg_yaml(version):
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
            'version': version,
            'icon': 'app',
            'docker': {'image': '{{NODE_IMAGE}}'},
            'variables': [
                {'key': 'APP_NAME', 'name': 'Appens navn', 'type': 'string', 'default': 'spolen'},
                {'key': 'NODE_IMAGE', 'name': 'Node-image', 'type': 'string',
                 'default': 'node:24-alpine',
                 'pattern': r'^node:[0-9][A-Za-z0-9._-]*$',
                 'hint': 'Skal vaere et node:-image, fx node:24-alpine'},
            ],
            'install': {'image': '{{NODE_IMAGE}}', 'script': install_script(version)},
            'update': {'image': '{{NODE_IMAGE}}', 'label': 'Opdater spolen',
                       'script': opdater_script(version)},
            'startup': {
                # node:sqlite er stabil fra Node 24, men flaget skal stadig
                # kunne bruges, hvis nogen saetter et aeldre image.
                'command': ('if node -e "require(\'node:sqlite\')" >/dev/null 2>&1; then\n'
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


def main():
    print('spolen - bygger rune')
    version = app_version()
    print(f'  version: {version}')
    saml_frontend()
    stempl_version(version)
    stempl_sw(version)
    filer = indsaml_filer()
    tjek_kilder(filer)
    tjek_git(filer)

    doc = byg_yaml(version)
    tjek_events(doc)
    tekst = yaml.dump(doc, allow_unicode=False, sort_keys=False, width=120)
    # Valider ved at LAESE den igen - en YAML, panelet ikke kan parse, er
    # vaerre end ingen YAML.
    tilbage = yaml.safe_load(tekst)
    if tilbage['gameskill']['version'] != version:
        fejl('YAML-rundturen gav en anden version')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf8') as fh:
        fh.write(tekst)
    print(f'  runes/spolen.yaml: {len(tekst):,} tegn')
    print()
    print(f'Faerdig. Udgivelse er TRE trin:  commit  ->  git tag v{version}  ->  git push --tags')
    print('Uden taggen svarer GitHub 404, og runen kan ikke installeres.')


if __name__ == '__main__':
    main()
