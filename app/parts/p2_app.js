

/*
 * Ikonerne. Inline SVG - ingen ikonfont, ingen CDN.
 *
 * Alle er 24x24 med `stroke="currentColor"`, saa de arver farven fra
 * .nav-item og skifter med temaet af sig selv. `aria-hidden`, fordi teksten
 * ved siden af siger det samme - to oplaesninger af "Calendar" er stoej.
 */
function ikon(sti, opts) {
  const o = opts || {};
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(o.stoerrelse || 18));
  svg.setAttribute('height', String(o.stoerrelse || 18));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = sti;
  return svg;
}

const IKONER = {
  // Afspil-trekant i en cirkel: "det naeste, du skal se".
  'up-next': '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>',
  // Stablede kort - biblioteket.
  library: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="12" y="4" width="4" height="16" rx="1.5"/><path d="M18.5 5.5l2.2 14"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  // Soejler - statistik.
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  // To personer - deling.
  sharing: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.5a3 3 0 0 1 0 5M18 20a6 6 0 0 0-2-4.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  // Filmspolen - samme maerke som appens ikon.
  brand: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="7" r="1.6"/><circle cx="12" cy="17" r="1.6"/><circle cx="7" cy="12" r="1.6"/><circle cx="17" cy="12" r="1.6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};

/*
 * Overlay-tilstanden styres fra JS, ikke af en media query.
 *
 * Graensen ville ellers ligge to steder - matchMedia her og @media i CSS -
 * og er de ude af trit, folder menuknappen sidebaren sammen paa en iPad,
 * hvor CSS'en tror, den er en overlay (Kokkeri v20). Med ÉN kilde kan de
 * ikke blive uenige.
 */
function opdaterNavTilstand() {
  const smal = smalSkaerm();
  document.body.classList.toggle('navskjult', smal);
  if (!smal) document.body.classList.remove('navopen');
}

function tilslutNav() {
  opdaterNavTilstand();
  // matchMedia frem for resize: den fyrer kun, naar graensen KRYDSES.
  window.matchMedia(`(max-width: ${MOBIL}px)`).addEventListener('change', () => {
    opdaterNavTilstand();
    tegnSide();
  });
}

/* ------------------------------------------------------------- skallen */

/*
 * Sidebaren folder sig til en overlay under MOBIL px. Graensen bor baade her
 * og i style.css - hold dem i trit (se konstanten i p1).
 */
/* Ingen "Search"-side laengere: soegefeltet staar i toppen paa ALLE sider,
   saa en soegning er noget man goer midt i noget andet - ikke et sted man
   gaar hen. */
const SIDER = [
  { id: 'up-next', navn: 'Up Next' },
  { id: 'library', navn: 'Library' },
  { id: 'calendar', navn: 'Calendar' },
  { id: 'stats', navn: 'Statistics' },
  { id: 'sharing', navn: 'Sharing' },
  { id: 'settings', navn: 'Settings' },
];

function skal(indhold) {
  const rod = $('#root');
  // Husk rullepositionen ved gentegning af SAMME side. Et fast scrollTo(0,0)
  // sender brugeren til toppen, hver gang en afkrydsning gemmer og gentegner
  // (Beanledger v24).
  const samme = rod.dataset.view === state.view;
  const sc = document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight
    ? document.scrollingElement : document.body;
  const gemtRul = samme ? sc.scrollTop : 0;

  rod.textContent = '';
  rod.dataset.view = state.view;
  // .app er dodas flex-foraelder: .sidebar har `flex: none` og .main har
  // `flex: 1`, saa uden den staar de to UNDER hinanden, og hovedomraadet
  // ryger under skaermkanten. Fejlen ses ikke i DOM'en - kun paa geometrien.
  const app = el('div', { class: 'app' });
  /*
   * Menuknappen og sloeret ligger UDEN FOR .app: begge er position: fixed,
   * og knappen skal kunne naas, ogsaa naar sidebaren er skubbet ud af
   * skaermen.
   */
  rod.appendChild(el('button', {
    class: 'btn ghost navtoggle', 'aria-label': 'Menu',
    'aria-expanded': document.body.classList.contains('navopen') ? 'true' : 'false',
    // GENTEGN efter skiftet - ellers skifter klassen, men sloeret bliver
    // aldrig bygget, fordi det kun laegges ind, naar skallen tegnes.
    onclick: () => { document.body.classList.toggle('navopen'); tegnSide(); },
  }, [ikon(IKONER.menu, { stoerrelse: 20 })]));
  if (document.body.classList.contains('navopen')) {
    rod.appendChild(el('div', {
      class: 'backdrop',
      onclick: () => { document.body.classList.remove('navopen'); tegnSide(); },
    }));
  }
  rod.appendChild(app);
  app.appendChild(el('nav', { class: 'sidebar nav' }, [
    el('div', { class: 'brand' }, [ikon(IKONER.brand, { stoerrelse: 20 }), 'spolen']),
    ...SIDER.map((s) => el('button', {
      class: 'nav-item',
      // Dodas stylesheet markerer den aktive side paa aria-current, ikke paa
      // en klasse. Det er ogsaa det rigtige for en skaermlaeser.
      'aria-current': state.view === s.id ? 'page' : null,
      onclick: async () => {
        state.view = s.id;
        tegnSide();
        // Biblioteket kan vaere aendret af en tilfoejelse siden sidst.
        if (s.id === 'library') { await hentBibliotek(); tegnSide(); }
        // Noeglens tilstand hentes, naar man aabner siden - ikke ved login.
        // Det er et rigtigt TMDB-kald, og det skal ikke koere hver gang.
        if (s.id === 'settings') { await Promise.all([hentSettings(), tjekTmdb(), hentTjenester(), hentNoegler(), hentPlexWebhook(), hentPush()]); tegnSide(); }
        if (s.id === 'calendar') { await hentKalender(); tegnSide(); }
        if (s.id === 'stats') { await hentStats(); tegnSide(); }
        // Paa en telefon skal menuen lukke sig selv, naar man har valgt.
        if (smalSkaerm()) document.body.classList.remove('navopen');
      },
    }, [ikon(IKONER[s.id] || IKONER.library), s.navn])),
    /*
     * TMDB-attributionen er et VILKAAR for noeglen, ikke en pyntedetalje:
     * man maa bruge deres API gratis til ikke-kommerciel brug, mod at sige
     * at man goer det, og at de ikke staar inde for appen. Den skal derfor
     * staa et sted, der altid er synligt - ikke gemt i en om-dialog.
     */
    el('div', { class: 'sidebar-foot' }, [
      el('span', { class: 'dim lille', text: state.user ? state.user.username : '' }),
      el('button', { class: 'btn ghost lille', text: 'Sign out', onclick: async () => {
        await api('/logout', { method: 'POST' });
        state.user = null;
        loginSide('Signed out.');
      } }),
      versionsLinje(),
      el('p', { class: 'dim tmdb-kredit', text:
        'Uses the TMDB API but is not endorsed or certified by TMDB.' }),
    ]),
  ]));
  /*
   * Topbaren bygges FORFRA ved hver gentegning - men kun naar den ikke
   * allerede staar der med noget i. Skrev brugeren midt i en gentegning
   * (fx fordi et afsnit blev markeret), maa feltet ikke rives ned.
   */
  const gammelTop = document.getElementById('omniCard');
  const beholdTop = gammelTop && document.activeElement === document.getElementById('omni');
  app.appendChild(el('main', { class: 'main' }, [
    beholdTop ? gammelTop.parentElement : byggTopbar(),
    indhold,
  ]));
  if (beholdTop) tegnOmniPanel();
  sc.scrollTop = gemtRul;
}

/*
 * Versionen, altid synlig i sidebarens fod.
 *
 * Det er SAMME tal som runens `version:` i panelet, saa man kan se med det
 * blotte oeje, om Update/Reinstall faktisk skiftede noget - den hyppigste
 * forvirring i panelets todelte opdateringsflow (§6).
 *
 * Kun et NYERE servertal taeller som "der er en opdatering". `!==` er
 * forkert den ene vej: er serverens tal LAVERE end det, browseren koerer -
 * en rullet udgivelse, eller en serverproces der ikke er genstartet - stod
 * der "v3 available" ved siden af v4, og det er vaas. (doda og Sagu fandt
 * begge den fejl; spolen havde den ogsaa, i toasten ved opstart.)
 */
function versionsLinje() {
  const server = state.config && state.config.version;
  if (server && server > APP_VERSION) {
    return el('button', {
      class: 'version-linje gammel',
      title: `Your browser is running v${APP_VERSION}, but the server has v${server}. `
        + 'Click to reload.',
      onclick: () => location.reload(),
    }, [`v${APP_VERSION} · v${server} available — reload`]);
  }
  return el('div', { class: 'version-linje', text: `v${APP_VERSION}` });
}

function tomtRum(overskrift, forklaring) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty-title', text: overskrift }),
    el('p', { text: forklaring }),
  ]);
}

/* ------------------------------------------------------------- up next */

function upNextSide() {
  if (!state.rows.length) {
    return tomtRum('Nothing queued',
      state.config && !state.config.tmdbKeySet
        ? 'Add a TMDB key under Settings, then search for a show to follow.'
        : 'Follow a show and its next episode shows up here.');
  }
  return el('div', {}, [
    el('h1', { text: 'Up Next' }),
    el('div', { class: 'kortliste' }, state.rows.map(naesteKort)),
  ]);
}

function naesteKort(raekke) {
  const t = raekke.title;
  const n = raekke.next;
  const afsnit = n.klar || n.naeste;
  const klar = !!n.klar;
  return el('article', { class: 'naeste-kort card' }, [
    /* Plakaten fører til seriens side. En knap og ikke en div, saa den kan
       naas med tastaturet - og alt-teksten er tom, fordi knappens eget
       navn (title) allerede siger, hvad den goer. To oplaesninger af samme
       titel ville bare stoeje. */
    el('button', {
      class: 'plakatknap', title: `Open ${t.name}`,
      onclick: () => aabnTitel(t.id),
    }, [
      t.posterPath
        ? el('img', { class: 'plakat', src: `/api/poster/w342${t.posterPath}`, alt: '', loading: 'lazy' })
        : el('div', { class: 'plakat' }),
    ]),
    el('div', {}, [
      // Titlen fører samme sted hen. Den var doed at klikke paa, og det er
      // det foerste, man proever, naar plakaten kan klikkes.
      el('h3', {}, [
        el('button', { class: 'afsnitslink', text: t.name,
          title: `Open ${t.name}`,
          onclick: () => aabnTitel(t.id) }),
      ]),
      /* Afsnitslinjen aabner beskrivelsen. En knap og ikke en div, saa den
         kan naas med tastaturet og laeses op som noget, der kan trykkes paa. */
      el('button', {
        class: 'afsnitsmaerke afsnitslink',
        text: `S${afsnit.season}E${afsnit.number}${afsnit.name ? ' · ' + afsnit.name : ''}`,
        title: 'Show the episode description',
        onclick: () => visAfsnit(afsnit.id),
      }),
      el('div', { class: 'kortbund' }, [
        // Chippen siger det ogsaa med ORD. En chip, der kun er groen, siger
        // intet til den, der ikke ser farven.
        el('span', { class: `chip${klar ? ' klar' : ''}`,
          text: klar ? 'Ready to watch' : datoTekst(afsnit.airDate) }),
        klar ? el('button', {
          class: 'btn primary lille', text: 'Watched',
          onclick: () => markerSet(t.id, afsnit.id),
        }) : null,
      ]),
    ]),
  ]);
}

function datoTekst(airDate) {
  if (!airDate) return 'Date unknown';
  const idag = new Date().toISOString().slice(0, 10);
  if (airDate === idag) return 'Airs today';
  if (airDate < idag) return `Aired ${airDate}`;
  return `Airs ${airDate}`;
}

async function markerSet(titleId, episodeId) {
  try {
    await api('/watches', { method: 'POST', body: { titleId, episodeId, source: 'manual' } });
    await hentUpNext();
    tegnSide();
  } catch (err) {
    toast(err.message, 'fejl');
  }
}

/* ------------------------------------------------------------- deling */

/*
 * Deling er SELEKTIV (Andreas, 2026-08-28): man vaelger hvem, og man vaelger
 * hvad. Fladen skal derfor vise begge retninger hver for sig - "jeg deler ud"
 * og "der deles med mig" er ikke det samme spoergsmaal, og kun det foerste
 * kan man lave om paa.
 */
function delingsSide() {
  const ud = state.shares.out;
  const ind = state.shares.in;
  return el('div', {}, [
    el('h1', { text: 'Sharing' }),
    el('p', { class: 'dim', text:
      'Nothing is shared until you say so. Pick a person, then pick how much they see.' }),

    el('h2', { text: 'You share' }),
    ud.length ? el('div', { class: 'liste' }, ud.map(delingsRaekke))
      : el('p', { class: 'dim', text: 'You are not sharing anything.' }),

    el('h2', { text: 'Share with someone' }),
    state.people.length ? nyDelingFormular()
      : el('p', { class: 'dim', text: 'Nobody else has an account on this server yet.' }),

    el('h2', { text: 'Shared with you' }),
    ind.length ? el('div', { class: 'liste' }, ind.map((d) => el('div', { class: 'item-row' }, [
      el('strong', { text: d.owner }),
      el('span', { class: 'dim', text: ' · ' + emneTekst(d) }),
      // Modtageren kan IKKE fjerne en deling. Kun ejeren bestemmer, og en
      // knap, der ikke virker, er vaerre end ingen knap.
    ]))) : el('p', { class: 'dim', text: 'Nobody is sharing with you.' }),
  ]);
}

function emneTekst(d) {
  if (d.subjectKind === 'profile') return 'everything — full history and progress';
  if (d.subjectKind === 'list') return `list "${d.subjectId}"${d.canWrite ? '" (can add)' : ''}`;
  return `one title (${d.subjectId})`;
}

function delingsRaekke(d) {
  return el('div', { class: 'item-row' }, [
    el('strong', { text: d.grantee }),
    el('span', { class: 'dim', text: ' · ' + emneTekst(d) }),
    el('button', {
      class: 'btn ghost lille', text: 'Stop sharing',
      onclick: async () => {
        await api(`/shares/${d.id}`, { method: 'DELETE' });
        await hentDelinger();
        tegnSide();
        toast('Stopped sharing.');
      },
    }),
  ]);
}

function nyDelingFormular() {
  const person = el('select', { style: 'font-size:16px' },
    state.people.map((p) => el('option', { value: p.id, text: p.username })));
  const emne = el('select', { style: 'font-size:16px' }, [
    el('option', { value: 'profile', text: 'Everything — my whole history' }),
    el('option', { value: 'title', text: 'One title only' }),
    el('option', { value: 'list', text: 'One list' }),
  ]);
  const emneId = el('input', { placeholder: 'tv:1396', style: 'font-size:16px' });
  const skriv = el('input', { type: 'checkbox' });

  function opdaterSynlighed() {
    const p = emne.value === 'profile';
    emneId.hidden = p;
    // Skriveret giver kun mening for lister - man kan ikke se en film paa en
    // andens vegne. Feltet skjules frem for at staa og lyve.
    skriv.parentElement.hidden = emne.value !== 'list';
  }
  emne.addEventListener('change', opdaterSynlighed);
  setTimeout(opdaterSynlighed, 0);

  return el('div', { class: 'formgrid' }, [
    el('label', { text: 'Person' }), person,
    el('label', { text: 'What they see' }), emne,
    el('label', { text: 'Which one' }), emneId,
    el('label', {}, [skriv, ' They can add to it']),
    el('button', {
      class: 'btn primary', text: 'Share',
      onclick: async () => {
        try {
          await api('/shares', { method: 'POST', body: {
            granteeId: person.value,
            subjectKind: emne.value,
            subjectId: emne.value === 'profile' ? undefined : emneId.value.trim(),
            canWrite: skriv.checked,
          } });
          await hentDelinger();
          tegnSide();
          toast('Shared.');
        } catch (err) { toast(err.message, 'fejl'); }
      },
    }),
  ]);
}

/* ------------------------------------------------------------- indlaes */

async function hentUpNext() {
  const svar = await api('/up-next');
  state.rows = svar.rows || [];
}

async function hentDelinger() {
  const [folk, delinger] = await Promise.all([api('/people'), api('/shares')]);
  state.people = folk.people || [];
  state.shares = { out: delinger.out || [], in: delinger.in || [] };
}

function tegnSide() {
  if (state.view === 'sharing') { skal(delingsSide()); return; }
  if (state.view === 'up-next') { skal(upNextSide()); return; }
  if (state.view === 'library') { skal(bibliotekSide()); return; }
  if (state.view === 'title') { skal(titelSide()); return; }
  if (state.view === 'settings') { skal(settingsSide()); return; }
  if (state.view === 'calendar') { skal(kalenderSide()); return; }
  if (state.view === 'stats') { skal(statsSide()); return; }
  skal(tomtRum('Not built yet', 'This part of spolen comes in a later phase.'));
}

async function indlaes() {
  try {
    const [cfg, me] = await Promise.all([api('/public-config'), api('/me')]);
    state.config = cfg;
    state.user = me.user;
    if (me.integrations) {
      state.config.tmdbKeySet = me.integrations.tmdbKeySet;
      state.config.traktLinked = me.integrations.traktLinked;
      state.config.plexLinked = me.integrations.plexLinked;
    }
    if (!state.user) { loginSide(); return; }
    await Promise.all([hentUpNext(), hentDelinger(), hentBibliotek()]);
    tegnSide();
    tilslutSkrivForAtSoege();
    tilslutNav();
    tilslutServiceWorker();
    // Serveren udleverer ogsaa sin egen version. Stemmer den ikke med den her
    // fil, sidder der en gammel app.js i cachen - og saa fejlsoeger man kode,
    // der ikke er indlaest (§5).
    // Kun NYERE. Se versionsLinje() for hvorfor `!==` var forkert.
    if (cfg.version && cfg.version > APP_VERSION) {
      toast(`This page is v${APP_VERSION}, the server has v${cfg.version}. Reload.`, 'fejl');
    }
  } catch (err) {
    loginSide(err.status === 401 ? '' : err.message);
  }
}

indlaes();


/*
 * Service worker - offline og hurtig start.
 *
 * KUN i et sikkert kontekst (https eller localhost). Over panelets IP:port
 * findes navigator.serviceWorker slet ikke, og et ubetinget kald ville kaste
 * ved hver indlaesning (§4: flere browser-API'er kraever https).
 */
function tilslutServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // I DEV ville en cachet app.js betyde, at man fejlsoeger kode, der ikke er
  // indlaest - den fejl kostede en aften i doda.
  if (state.config && state.config.dev) return;
  navigator.serviceWorker.register('sw.js').catch(() => {
    // En afvist registrering er ikke vaerd at larme om: appen virker uden.
  });
}
