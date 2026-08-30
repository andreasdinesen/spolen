
/* ---------------------------------------------------------- titelvisning */

async function aabnTitel(id) {
  state.view = 'title';
  state.titel = { id, data: null, fejl: '', aabne: new Set(), beslaegtede: null };
  tegnSide();
  try {
    state.titel.data = await api(`/titles/${encodeURIComponent(id)}`);
    /*
     * Fold den saeson ud, man faktisk er i gang med - ikke saeson 1.
     *
     * En serie med 351 afsnit maa ikke aabne som 351 raekker: det er baade
     * uoverskueligt og langsomt at tegne. Sammenklappede saesoner loeser
     * begge dele, men kun hvis den RIGTIGE er foldet ud fra start.
     */
    const n = state.titel.data.next;
    const maal = (n && (n.klar || n.naeste)) || null;
    if (maal) state.titel.aabne.add(maal.season);
  } catch (err) {
    state.titel.fejl = err.message;
  }
  tegnSide();
}

function titelSide() {
  const t = state.titel;
  if (t.fejl) return tomtRum('Could not open that', t.fejl);
  if (!t.data) return el('p', { class: 'dim', text: 'Loading…' });
  const titel = t.data.title;
  const p = t.data.progress;

  return el('div', {}, [
    el('div', { class: 'titelrad' }, [
      el('button', { class: 'btn ghost lille', text: '← Library',
        onclick: () => { state.view = 'library'; tegnSide(); } }),
      // Kun paa noget, man FAKTISK har. Ellers ville knappen love at fjerne
      // en titel, der ikke er der.
      t.data.tracking && titel.kind === 'tv' ? skjulFraUpNext(t.data) : null,
      t.data.tracking ? fjernFraBiblioteket(t.data) : null,
    ]),
    el('div', { class: 'titelhoved' }, [
      titel.posterPath
        ? el('img', { class: 'plakat', src: `/api/poster/w342${titel.posterPath}`, alt: '' })
        : el('div', { class: 'plakat' }),
      el('div', {}, [
        el('h1', { text: titel.name }),
        el('div', { class: 'dim',
          text: [titel.year, titel.status, (titel.genres || []).join(', ')]
            .filter(Boolean).join(' · ') }),
        p ? el('div', { class: 'fremdrift' }, [el('i', { style: `width:${p.procent}%` })]) : null,
        p ? el('div', { class: 'dim lille',
          text: `${p.sete} of ${p.sendte} aired episodes watched` }) : null,
        el('p', { text: titel.overview || '' }),
        // En FILM har ingen afsnit at markere - den skal have sin egen knap.
        titel.kind === 'movie' ? filmSet(t.data) : null,
        udbudsAfsnit(t.data),
      ]),
    ]),
    samlingsAfsnit(t.data),
    beslaegtedeAfsnit(),
    t.data.episodes ? saesonListe(t.data.episodes, titel.id) : null,
  ]);
}

/*
 * "Set" for en FILM.
 *
 * En serie markeres afsnit for afsnit, og det er hele saesonlisten til for.
 * En film har ingen afsnit, og indtil nu havde den derfor slet ingen vej til
 * at blive markeret set - biblioteket skrev "Not watched", og der var intet
 * at goere ved det (Andreas, 2026-08-29).
 *
 * Serveren sendte allerede `watched` med hver film; fladen tegnede den bare
 * aldrig.
 *
 * En film kan ses FLERE gange, og det er ikke det samme som at have set den:
 * derfor en liste over gangene og ikke bare et flueben.
 */
function filmSet(d) {
  const set = d.watched || [];
  const knap = el('button', {
    class: set.length ? 'btn ghost lille' : 'btn primary',
    text: set.length ? 'Watch again' : 'Mark as watched',
    onclick: async (e) => {
      e.target.disabled = true;
      try {
        const svar = await api('/watches', { method: 'POST',
          body: { titleId: d.title.id, source: 'manual' } });
        /*
         * Dubletnoeglen er pr. DAG, ikke pr. sekund - saa en import kan
         * koeres igen uden at fordoble historikken (se ix_watch_dedup).
         * Foelgen er, at et gensyn SAMME dag ikke bliver til en ny gang.
         * Uden den her besked trykker man paa en knap, der tier stille, og
         * tror at den er i stykker (2026-08-29).
         */
        if (svar && svar.dublet) toast('Already recorded for today.');
        await aabnTitel(d.title.id);
      } catch (err) {
        e.target.disabled = false;
        toast(err.message, 'fejl');
      }
    },
  });

  return el('div', { class: 'filmset' }, [
    knap,
    set.length
      ? el('div', { class: 'dim lille', text: set.length === 1
          ? 'Seen once.' : `Seen ${set.length} times.` })
      : null,
    /*
     * Hver gang staar for sig med sin egen dato, saa man kan fjerne PRAECIS
     * den, der blev sat ved en fejl. En samlet "fjern alle" ville ogsaa slette
     * de rigtige (2026-08-29).
     */
    set.length ? el('div', { class: 'liste' }, set.map((w) => el('div', { class: 'item-row' }, [
      el('span', { class: 'lille', text: w.watchedAt
        ? new Date(w.watchedAt * 1000).toLocaleDateString('en-GB',
            { day: 'numeric', month: 'short', year: 'numeric' })
        : 'no date' }),
      el('span', { class: 'dim lille', text: w.source || 'manual' }),
      el('button', { class: 'btn ghost lille', text: 'Remove',
        title: 'Remove just this viewing',
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            await api(`/watches/${encodeURIComponent(w.id)}`, { method: 'DELETE' });
            await aabnTitel(d.title.id);
          } catch (err) {
            e.target.disabled = false;
            toast(err.message, 'fejl');
          }
        } }),
    ]))) : null,
  ]);
}

/*
 * Saesonerne, sammenklappede.
 *
 * SPECIALS (saeson 0) laegges SIDST. De sorterer foerst i tal, men det er
 * ikke den raekkefoelge nogen ser en serie i - med dem oeverst aabner en
 * lang serie paa en julespecial fra saeson fem.
 */
function saesonListe(afsnit, titleId) {
  const idag = state.titel.data.today || new Date().toISOString().slice(0, 10);
  const grupper = new Map();
  for (const e of afsnit) {
    if (!grupper.has(e.season)) grupper.set(e.season, []);
    grupper.get(e.season).push(e);
  }
  const numre = [...grupper.keys()].sort((a, b) => {
    if (a === 0) return 1;          // specials sidst
    if (b === 0) return -1;
    return a - b;
  });

  return el('div', {}, numre.map((nr) => {
    const liste = grupper.get(nr);
    const sete = liste.filter((e) => e.seen).length;
    const aaben = state.titel.aabne.has(nr);
    return el('section', { class: 'saeson' }, [
      el('button', {
        class: 'saesonhoved', 'aria-expanded': aaben ? 'true' : 'false',
        onclick: () => {
          if (aaben) state.titel.aabne.delete(nr); else state.titel.aabne.add(nr);
          tegnSide();
        },
      }, [
        el('span', { class: 'saesonpil', text: aaben ? '▾' : '▸' }),
        el('span', { text: nr === 0 ? 'Specials' : `Season ${nr}` }),
        el('span', { class: 'dim lille', text: `${sete}/${liste.length}` }),
      ]),
      aaben
        ? el('div', { class: 'afsnitsliste' }, liste.map((e) => afsnitsRaekke(e, titleId, idag)))
        : null,
    ]);
  }));
}

function afsnitsRaekke(e, titleId, idag) {
  const sendt = e.airDate && e.airDate <= idag;
  return el('div', { class: `afsnitsrag${e.seen ? ' set' : ''}` }, [
    el('span', { class: 'afsnitsmaerke', text: `S${e.season}E${e.number}` }),
    el('button', { class: 'afsnitslink', text: e.name || '—',
      title: 'Show the episode description',
      onclick: () => visAfsnit(e.id) }),
    el('span', { class: 'dim lille', text: e.airDate || '' }),
    el('button', {
      class: `btn ${e.seen ? 'ghost' : 'primary'} lille`,
      // Et uudsendt afsnit kan ikke vaere set. Knappen slaas FRA frem for at
      // forsvinde, saa raekken stadig ser ud til at have en handling.
      disabled: !sendt && !e.seen,
      text: e.seen ? 'Seen' : (sendt ? 'Mark seen' : 'Not aired'),
      onclick: () => skiftSet(titleId, e),
    }),
  ]);
}

async function skiftSet(titleId, e) {
  try {
    if (e.seen) {
      await api(`/watches/episode/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
      await genindlaesTitel(titleId);
      return;
    }
    /*
     * Er man hoppet ind midt i en serie, saa spoerg.
     *
     * Serveren taeller de USETE, SENDTE afsnit foer dette - fladen gaetter
     * ikke selv, for den kender hverken specials-indstillingen eller hvad
     * der er sendt. Er tallet 0, spoerges der ikke om noget.
     */
    const foer = await api(`/watches/before?episodeId=${encodeURIComponent(e.id)}`);
    if (foer.count > 0) {
      const svar = await spoerg(
        `Mark the ${foer.count} earlier episode${foer.count === 1 ? '' : 's'} too?`,
        `You are marking S${e.season}E${e.number}, but ${foer.count} earlier `
        + `episode${foer.count === 1 ? ' has' : 's have'} not been marked as seen.`,
        [
          { id: 'alle', text: `Mark all ${foer.count + 1}`, primary: true },
          { id: 'kun', text: 'Just this one' },
          { id: 'fortryd', text: 'Cancel' },
        ]);
      if (svar === 'fortryd') return;
      if (svar === 'alle') {
        const r = await api('/watches/upto', { method: 'POST', body: { episodeId: e.id } });
        toast(`Marked ${r.tilfoejet} episodes as seen.`);
        await genindlaesTitel(titleId);
        return;
      }
    }
    await api('/watches', { method: 'POST', body: { titleId, episodeId: e.id, source: 'manual' } });
    await genindlaesTitel(titleId);
  } catch (err) {
    toast(err.message, 'fejl');
  }
}

async function genindlaesTitel(titleId) {
  // Foldetilstanden skal OVERLEVE en gentegning - ellers klapper alle
  // saesoner sammen, hver gang man markerer et afsnit.
  const aabne = state.titel.aabne;
  const beslaegtede = state.titel.beslaegtede;
  state.titel.data = await api(`/titles/${encodeURIComponent(titleId)}`);
  state.titel.aabne = aabne;
  // De beslaegtede skal ikke hentes igen, fordi et afsnit blev markeret.
  state.titel.beslaegtede = beslaegtede;
  await Promise.all([hentUpNext(), hentBibliotek()]);
  tegnSide();
}

/*
 * Tag en serie ud af Up Next uden at fjerne den.
 *
 * Andreas, 2026-08-30: nogle serier er man holdt op med at se, men man vil
 * stadig kunne se hvor langt man naaede. Up Next er "hvad skal jeg se nu" -
 * en serie, man ikke er i gang med, goer listen laengere uden at goere den
 * mere brugbar.
 *
 * Tilstanden `paused` FANDTES i forvejen: Up Next viser kun `watching` og
 * `watchlist`, saa der skulle ingen ny model til - kun en vej til at saette
 * den. Historikken, fremdriften og selve titlen bliver praecis hvor de er.
 */
function skjulFraUpNext(d) {
  const skjult = d.tracking.state === 'paused';
  return el('button', {
    class: 'btn ghost lille',
    text: skjult ? 'Show in Up Next' : 'Hide from Up Next',
    title: skjult
      ? 'Put this series back on Up Next'
      : 'Keep the series and its history, but stop it showing on Up Next',
    onclick: async (e) => {
      e.target.disabled = true;
      try {
        /*
         * HELE tracking-objektet sendes med, ikke kun det aendrede felt.
         * gemItem skriver `data` som ét stykke, saa et delvist objekt ville
         * slette resten - fx hideSpecials og hvornaar man begyndte.
         */
        await api('/items', { method: 'POST', body: Object.assign({}, d.tracking, {
          state: skjult ? 'watching' : 'paused',
        }) });
        toast(skjult ? 'Back on Up Next.' : 'Hidden from Up Next.');
        await Promise.all([hentUpNext(), hentBibliotek()]);
        await aabnTitel(d.title.id);
      } catch (err) {
        e.target.disabled = false;
        toast(err.message, 'fejl');
      }
    },
  });
}

/*
 * Fjern en titel fra biblioteket igen.
 *
 * Skal virke, uanset om titlen bare er tilfoejet eller ogsaa er markeret
 * set (Andreas, 2026-08-29). Og det er netop DÉR, spoergsmaalet bliver
 * svaert: historikken er ikke det samme som biblioteket.
 *
 * Derfor tre svar, ikke to:
 *
 *   - Fjern, og BEHOLD historikken. Standarden. Titlen forsvinder fra
 *     biblioteket, men det, man har set, taeller stadig i statistikken. At
 *     rydde op i sit bibliotek maa ikke stille og roligt slette aar af
 *     historik.
 *   - Fjern ALT, ogsaa historikken. Findes, fordi den anden vej ikke kan
 *     naas bagefter: er titlen foerst vaek fra biblioteket, er der ingen
 *     side at gaa ind paa for at rydde historikken.
 *   - Fortryd.
 *
 * Bedoemmelse og note bliver staaende. De hoerer ikke til "biblioteket", og
 * tilfoejer man titlen igen, er de der stadig.
 */
function fjernFraBiblioteket(d) {
  const navn = d.title.name;
  // Hvor meget historik er der? En serie taeller afsnit, en film gange.
  const antal = d.progress ? d.progress.sete : (d.watched || []).length;

  return el('button', {
    class: 'btn ghost lille fjernknap', text: 'Remove from library',
    onclick: async (e) => {
      const valg = antal
        ? await spoerg('Remove from library?',
            `${navn} will be removed from your library. You have ${antal} `
            + `${antal === 1 ? 'viewing' : 'viewings'} recorded — that history counts `
            + 'towards your statistics. Once the title is gone you cannot get back '
            + 'to this page to clear it.',
            [
              { id: 'behold', text: 'Remove, keep history', primary: true },
              { id: 'alt', text: 'Remove and delete history' },
              { id: 'fortryd', text: 'Cancel' },
            ])
        : await spoerg('Remove from library?',
            `${navn} will be removed from your library. You can add it again at any time.`,
            [
              { id: 'behold', text: 'Remove', primary: true },
              { id: 'fortryd', text: 'Cancel' },
            ]);
      if (valg === 'fortryd') return;

      e.target.disabled = true;
      try {
        /*
         * Historikken FOERST. Gaar noget galt undervejs, staar titlen stadig
         * i biblioteket - og saa kan man proeve igen. Den omvendte orden
         * ville efterlade en historik uden en side at rydde den fra.
         */
        if (valg === 'alt') {
          await api(`/watches/title/${encodeURIComponent(d.title.id)}`, { method: 'DELETE' });
        }
        await api(`/items/${encodeURIComponent(d.tracking.id)}`, { method: 'DELETE' });
        toast(`${navn} removed.`);
        state.view = 'library';
        await Promise.all([hentUpNext(), hentBibliotek()]);
        tegnSide();
      } catch (err) {
        e.target.disabled = false;
        toast(err.message, 'fejl');
      }
    },
  });
}

/* ------------------------------------------------------------- dialog */

/*
 * Et spoergsmaal med flere svar. Returnerer id'et paa det valgte.
 *
 * confirm() kan kun ja/nej, og her er der tre svar - "alle", "kun den" og
 * "fortryd". At presse tre valg ned i to ville betyde, at man ikke kan
 * markere ét enkelt afsnit midt i en serie uden at tage resten med.
 */
function spoerg(titel, tekst, valg) {
  return new Promise((resolve) => {
    const luk = (id) => { baggrund.remove(); document.removeEventListener('keydown', paaTast); resolve(id); };
    const paaTast = (ev) => { if (ev.key === 'Escape') luk('fortryd'); };
    const baggrund = el('div', { class: 'modalbag', onclick: (ev) => {
      if (ev.target === baggrund) luk('fortryd');
    } }, [
      el('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' }, [
        el('h3', { text: titel }),
        el('p', { class: 'dim', text: tekst }),
        el('div', { class: 'knaprad' }, valg.map((v) => el('button', {
          class: `btn ${v.primary ? 'primary' : 'ghost'}`, text: v.text,
          onclick: () => luk(v.id),
        }))),
      ]),
    ]);
    document.body.appendChild(baggrund);
    document.addEventListener('keydown', paaTast);
    const foerste = baggrund.querySelector('button');
    if (foerste) foerste.focus();
  });
}

/* --------------------------------------------------------- afsnitsrude */

/*
 * Beskrivelsen af ét afsnit.
 *
 * Resuméet hentes paa forespoergsel og ligger IKKE i listesvarene - en serie
 * med 351 afsnit ville ellers sende 351 resuméer med hver eneste
 * sideindlaesning (§4).
 *
 * Ruden kan ogsaa MARKERE afsnittet. Det er hele pointen paa Up Next: man
 * aabner den for at finde ud af, om man har set det - og skal saa kunne
 * svare paa det med det samme, uden at lukke ruden og lede efter knappen.
 */
async function visAfsnit(episodeId) {
  const krop = el('div', {});
  const knaprad = el('div', { class: 'knaprad' });
  const luk = () => { bag.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') luk(); };
  const bag = el('div', { class: 'modalbag', onclick: (e) => { if (e.target === bag) luk(); } }, [
    el('div', { class: 'modal-card afsnitsrude', role: 'dialog', 'aria-modal': 'true' }, [
      krop, knaprad,
    ]),
  ]);
  document.body.appendChild(bag);
  document.addEventListener('keydown', paaTast);
  krop.appendChild(el('p', { class: 'dim', text: 'Loading…' }));

  let e;
  try {
    e = await api(`/episodes/${encodeURIComponent(episodeId)}`);
  } catch (err) {
    if (!bag.isConnected) return;
    krop.textContent = '';
    krop.appendChild(el('p', { class: 'dim', text: err.message }));
    knaprad.appendChild(el('button', { class: 'btn ghost', text: 'Close', onclick: luk }));
    return;
  }
  if (!bag.isConnected) return;

  const tegn = () => {
    krop.textContent = '';
    knaprad.textContent = '';
    // Stillbilledet er 16:9 og staar oeverst - det er afsnittets eget
    // billede, ikke seriens plakat, og det er tit dét, der giver
    // genkendelsen: "naa ja, DET afsnit".
    if (e.still) krop.appendChild(el('img', { class: 'afsnitsstill', src: e.still, alt: '' }));
    krop.appendChild(el('div', { class: 'dim lille', text: e.titleName }));
    krop.appendChild(el('h3', { text: `S${e.season}E${e.number}${e.name ? ' · ' + e.name : ''}` }));
    const sendt = e.airDate && e.airDate <= e.today;
    krop.appendChild(el('div', { class: 'dim', text: [
      e.airDate ? (sendt ? `Aired ${e.airDate}` : `Airs ${e.airDate}`) : 'Air date unknown',
      e.runtime ? `${e.runtime} min` : null,
    ].filter(Boolean).join(' · ') }));
    krop.appendChild(el('p', { class: 'overblik-resume',
      // Et manglende resume er almindeligt paa nye afsnit - sig det, frem
      // for at efterlade et tomt felt der ligner en indlaesningsfejl.
      text: e.overview || 'TMDB has no description for this episode yet.' }));

    knaprad.appendChild(el('button', {
      class: `btn ${e.seen ? 'ghost' : 'primary'}`,
      disabled: !sendt && !e.seen,
      text: e.seen ? 'Mark as not seen' : (sendt ? 'Mark seen' : 'Not aired yet'),
      onclick: async (knap) => {
        knap.target.disabled = true;
        try {
          if (e.seen) {
            await api(`/watches/episode/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
            e.seen = false;
          } else {
            await api('/watches', { method: 'POST',
              body: { titleId: e.titleId, episodeId: e.id, source: 'manual' } });
            e.seen = true;
          }
          // Baade forsiden og biblioteket kan have aendret sig.
          await Promise.all([hentUpNext(), hentBibliotek()]);
          // Staar man PAA titelsiden, skal afsnitslisten ogsaa med.
          if (state.view === 'title' && state.titel.id === e.titleId) {
            await genindlaesTitel(e.titleId);
          } else {
            tegnSide();
          }
          tegn();
        } catch (err) {
          knap.target.disabled = false;
          toast(err.message, 'fejl');
        }
      },
    }));
    knaprad.appendChild(el('button', { class: 'btn ghost', text: 'Close', onclick: luk }));
  };
  tegn();
}


/* ------------------------------------------------------- hvor kan jeg se den */

/*
 * Streamingudbuddet (S1/S2/S3).
 *
 * Det, brugeren SELV abonnerer paa, staar foerst og fremhaevet. Resten er
 * ogsaa nyttigt - men spoergsmaalet er "kan jeg se den i aften uden at
 * betale ekstra", og svaret skal ikke skulle findes i en liste.
 */
function udbudsAfsnit(d) {
  const p = d.providers;
  if (!p) return null;
  const abonnement = p.flatrate || [];
  const leje = p.rent || [];
  const koeb = p.buy || [];
  if (!abonnement.length && !leje.length && !koeb.length) {
    return el('p', { class: 'dim lille', text:
      `Not on any streaming service in ${d.providerRegion || 'your region'} right now.` });
  }

  const linje = (etiket, liste) => liste.length
    ? el('div', { class: 'udbudslinje' }, [
        el('span', { class: 'dim lille', text: etiket }),
        el('span', { class: 'udbydere' }, liste.map((u) => el('span', {
          class: `udbyder${(d.onMyServices || []).includes(u.name) ? ' min' : ''}`,
        }, [
          u.logoPath ? el('img', { src: `/api/poster/w154${u.logoPath}`, alt: '' }) : null,
          el('span', { text: u.name }),
        ]))),
      ])
    : null;

  return el('div', { class: 'udbud' }, [
    d.onMyServices
      ? el('p', { class: 'chip klar', text: `You can watch this on ${d.onMyServices.join(', ')}` })
      : null,
    /*
     * "Kommet til" og "forsvundet" siden sidste hentning (S3).
     *
     * Vises kun, naar der FAKTISK er en forskel - en tom linje i hvert svar
     * ville ligne, at der altid var nyt.
     */
    d.providerChange && d.providerChange.kommet.length
      ? el('p', { class: 'lille', text: `New on ${d.providerChange.kommet.join(', ')}` }) : null,
    d.providerChange && d.providerChange.forsvundet.length
      ? el('p', { class: 'lille', text: `No longer on ${d.providerChange.forsvundet.join(', ')}` }) : null,
    linje('Subscription', abonnement),
    linje('Rent', leje),
    linje('Buy', koeb),
    el('p', { class: 'dim lille', text: 'Availability from TMDB/JustWatch.' }),
  ]);
}


/* ---------------------------------------------------------- samlingen */

/*
 * "Findes der en toer?" (Andreas, 2026-08-29).
 *
 * TMDB knytter selv efterfoelgere sammen i en SAMLING, saa Spider-Man 1, 2
 * og 3 hoerer sammen som et faktum - ikke som et gaet ud fra titler. Et gaet
 * ville tage fejl begge veje: "Spider-Man 2" og "The Amazing Spider-Man 2"
 * ligner hinanden og hoerer ikke sammen.
 *
 * Overskriften siger det, man SPURGTE om, frem for bare at liste delene:
 * "du har set 1 af 3" er et svar, en liste er det ikke.
 */
function samlingsAfsnit(d) {
  const c = d.collection;
  if (!c || c.dele.length < 2) return null;

  const usete = c.dele.filter((x) => !x.set && !x.denne);
  const besked = usete.length
    ? `You have seen ${c.sete} of ${c.ialt}. `
      + `${usete.length === 1 ? 'One more' : `${usete.length} more`} in this series: `
      + usete.map((x) => x.name).join(', ') + '.'
    : `You have seen all ${c.ialt}.`;

  return el('section', { class: 'samling' }, [
    el('h2', { text: c.name }),
    el('p', { class: usete.length ? 'chip klar' : 'dim', text: besked }),
    /*
     * Hele kortet kan klikkes - ikke kun knappen.
     *
     * Man peger paa plakaten, fordi det er den, man kan se. En knap, der
     * hedder "Open" nede i hjoernet, er ikke der, oejet gaar hen
     * (Andreas, 2026-08-29). Reglen for HVAD et klik goer er den samme som
     * i soegningen: har man titlen, aabnes dens side; ellers vises
     * overblikket foerst.
     */
    el('div', { class: 'plakater' }, c.dele.map((del) => el('div', {
      class: `soegekort${del.denne ? ' denne' : ''}`,
      role: del.denne ? null : 'button',
      tabindex: del.denne ? null : '0',
      // Ingen vej fra den, man staar paa, til sig selv.
      onclick: del.denne ? null : () => aabnTraeffer({
        id: del.id, kind: 'movie', tmdbId: del.tmdbId, name: del.name,
        year: del.year, posterPath: del.posterPath, tracked: !!del.iBiblioteket,
      }),
      onkeydown: del.denne ? null : (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          aabnTraeffer({
            id: del.id, kind: 'movie', tmdbId: del.tmdbId, name: del.name,
            year: del.year, posterPath: del.posterPath, tracked: !!del.iBiblioteket,
          });
        }
      },
    }, [
      del.posterPath
        ? el('img', { class: 'plakat', src: `/api/poster/w342${del.posterPath}`,
            alt: '', loading: 'lazy' })
        : el('div', { class: 'plakat' }),
      el('div', { class: 'soegekort-titel', text: del.name }),
      el('div', { class: 'dim lille', text: [
        del.year || '',
        del.denne ? 'you are here' : (del.set ? 'seen' : (del.iBiblioteket ? 'in library' : '')),
      ].filter(Boolean).join(' · ') }),
      // Ingen knap paa den, man staar paa - og ingen paa dem, man allerede
      // har. Kun det, der er noget at goere ved.
      /*
       * stopPropagation: knappen ligger INDE i et kort, der ogsaa kan
       * klikkes. Uden den ville et tryk paa Add baade tilfoeje OG navigere
       * vaek fra siden, saa man aldrig saa at det lykkedes.
       */
      (!del.denne && !del.iBiblioteket)
        ? el('button', { class: 'btn primary lille', text: 'Add',
            onclick: (e) => { e.stopPropagation();
              tilfoej({ kind: 'movie', tmdbId: del.tmdbId, name: del.name }, e.target); } })
        : null,
      (!del.denne && del.iBiblioteket)
        ? el('button', { class: 'btn ghost lille', text: 'Open',
            onclick: (e) => { e.stopPropagation(); aabnTitel(del.id); } })
        : null,
    ]))),
  ]);
}

/* -------------------------------------------------------- beslaegtede */

/*
 * De LOESERE slaegtninge - genstarter og spin-offs, som en samling ikke
 * binder sammen. For Spider-Man er det forskellen paa "2 og 3" (samlingen)
 * og "de andre Spider-Man-film" (anbefalingerne).
 *
 * Hentes foerst naar man beder om det: det er ét TMDB-kald mere, og de
 * fleste aabner en titel for at se fremdriften, ikke naboerne.
 */
function beslaegtedeAfsnit() {
  const b = state.titel.beslaegtede;
  if (b === null) {
    return el('button', { class: 'btn ghost lille', text: 'Show related titles',
      onclick: (e) => hentBeslaegtede(e.target) });
  }
  if (!b.length) return el('p', { class: 'dim lille', text: 'TMDB has nothing related.' });
  return el('section', {}, [
    el('h2', { text: 'Related' }),
    el('div', { class: 'plakater' }, b.map((r) => el('div', {
      class: 'soegekort', role: 'button', tabindex: '0',
      onclick: () => aabnTraeffer(r),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aabnTraeffer(r); } },
    }, [
      r.poster
        ? el('img', { class: 'plakat', src: r.poster, alt: '', loading: 'lazy' })
        : el('div', { class: 'plakat' }),
      el('div', { class: 'soegekort-titel', text: r.name }),
      el('div', { class: 'dim lille', text: `${r.kind === 'tv' ? 'Series' : 'Film'}`
        + `${r.year ? ' · ' + r.year : ''}` }),
      r.tracked
        ? el('button', { class: 'btn ghost lille', text: 'Open',
            onclick: (e) => { e.stopPropagation(); aabnTitel(r.id); } })
        : el('button', { class: 'btn primary lille', text: 'Add',
            onclick: (e) => { e.stopPropagation(); tilfoej(r, e.target); } }),
    ]))),
  ]);
}

async function hentBeslaegtede(knap) {
  knap.disabled = true;
  knap.textContent = 'Loading…';
  try {
    const r = await api(`/related?id=${encodeURIComponent(state.titel.id)}`);
    state.titel.beslaegtede = r.results || [];
  } catch (err) {
    state.titel.beslaegtede = [];
    toast(err.message, 'fejl');
  }
  tegnSide();
}
