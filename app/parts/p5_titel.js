
/* ---------------------------------------------------------- titelvisning */

async function aabnTitel(id) {
  state.view = 'title';
  state.titel = { id, data: null, fejl: '', aabne: new Set() };
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
    el('button', { class: 'btn ghost lille', text: '← Library',
      onclick: () => { state.view = 'library'; tegnSide(); } }),
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
        udbudsAfsnit(t.data),
      ]),
    ]),
    t.data.episodes ? saesonListe(t.data.episodes, titel.id) : null,
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
  state.titel.data = await api(`/titles/${encodeURIComponent(titleId)}`);
  state.titel.aabne = aabne;
  await Promise.all([hentUpNext(), hentBibliotek()]);
  tegnSide();
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
