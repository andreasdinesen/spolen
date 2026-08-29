
/* ------------------------------------------------------------ kalender */

/*
 * Kalenderen (K6).
 *
 * Grupperet pr. DAG og ikke som et maanedsgitter. Et gitter er pænt, men det,
 * man vil vide, er "hvad kommer der, og hvornaar" - og med tre-fire serier er
 * de fleste felter i et gitter tomme. En liste med dagoverskrifter siger det
 * samme paa en tiendedel af pladsen og virker paa en telefon.
 */
function kalenderSide() {
  const k = state.kalender;
  if (k.fejl) return tomtRum('Could not load the calendar', k.fejl);
  if (!k.hentet) return el('p', { class: 'dim', text: 'Loading…' });
  if (!k.raekker.length) {
    return el('div', {}, [
      el('h1', { text: 'Calendar' }),
      tomtRum('Nothing scheduled',
        'Follow a series with upcoming episodes and they show up here.'),
      icalAfsnit(),
    ]);
  }

  // Gruppér pr. dato. Map bevarer indsaettelsesorden, og serveren har
  // allerede sorteret - saa der skal ikke sorteres igen.
  const dage = new Map();
  for (const r of k.raekker) {
    if (!dage.has(r.airDate)) dage.set(r.airDate, []);
    dage.get(r.airDate).push(r);
  }

  return el('div', {}, [
    el('h1', { text: 'Calendar' }),
    el('p', { class: 'dim lille', text: `${k.fra} – ${k.til}` }),
    el('div', { class: 'kalender' }, [...dage.entries()].map(([dato, liste]) =>
      el('section', { class: `kalenderdag${dato === k.idag ? ' idag' : ''}` }, [
        el('div', { class: 'kalenderdato' }, [
          el('strong', { text: dagTekst(dato, k.idag) }),
          el('span', { class: 'dim lille', text: dato }),
        ]),
        el('div', { class: 'liste' }, liste.map(kalenderRaekke)),
      ]))),
    icalAfsnit(),
  ]);
}

/** "Today", "Tomorrow", "Yesterday" eller ugedagen. */
function dagTekst(dato, idag) {
  const d = Math.round((Date.UTC(+dato.slice(0, 4), +dato.slice(5, 7) - 1, +dato.slice(8, 10))
    - Date.UTC(+idag.slice(0, 4), +idag.slice(5, 7) - 1, +idag.slice(8, 10))) / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  const uge = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const navn = uge[new Date(`${dato}T12:00:00Z`).getUTCDay()];
  // Ugedagen alene er kun entydig inden for en uge. Laengere ude er datoen
  // ved siden af det, der baerer betydningen.
  return Math.abs(d) < 7 ? navn : `${navn}`;
}

function kalenderRaekke(r) {
  return el('div', { class: `item-row kalenderrag${r.seen ? ' set' : ''}` }, [
    r.posterPath
      ? el('img', { class: 'omni-plakat', src: `/api/poster/w154${r.posterPath}`, alt: '', loading: 'lazy' })
      : el('div', { class: 'omni-plakat' }),
    el('div', { class: 'omni-row-main' }, [
      el('button', { class: 'afsnitslink omni-row-title', text: r.titleName,
        title: `Open ${r.titleName}`, onclick: () => aabnTitel(r.titleId) }),
      el('button', { class: 'afsnitslink omni-row-sub',
        text: `S${r.season}E${r.number}${r.name ? ' · ' + r.name : ''}`,
        title: 'Show the episode description', onclick: () => visAfsnit(r.id) }),
    ]),
    r.seen ? el('span', { class: 'chip', text: 'Seen' }) : null,
  ]);
}

/*
 * Abonnementslinket.
 *
 * Adressen ER hemmeligheden - der er ingen cookie i et kalender-abonnement.
 * Derfor staar den i et laest felt med en kopiknap frem for som et klikbart
 * link: et link inviterer til at dele det, og et delt feed er en delt
 * seerhistorik.
 */
function icalAfsnit() {
  const k = state.kalender;
  const fuld = k.icalPath ? location.origin + k.icalPath : '';
  const felt = el('input', { readonly: true, value: fuld, style: 'font-size:16px',
    onclick: (e) => e.target.select() });

  return el('div', { class: 'icalboks' }, [
    el('h2', { text: 'Subscribe in your calendar' }),
    k.icalPath
      ? el('div', {}, [
          el('p', { class: 'dim lille', text:
            'Add this address as a subscribed calendar. Anyone with it can see '
            + 'what you are watching, so treat it like a password.' }),
          el('div', { class: 'formgrid' }, [
            el('label', { text: 'Feed address' }), felt,
            el('button', { class: 'btn ghost', text: 'Copy', onclick: async () => {
              try {
                // Udklipsholderen kraever et sikkert kontekst (https eller
                // localhost). Over panelets IP:port fejler den - og saa skal
                // brugeren have at vide, at han kan markere feltet i stedet.
                await navigator.clipboard.writeText(fuld);
                toast('Copied.');
              } catch {
                felt.select();
                toast('Could not copy — the address is selected, press Cmd/Ctrl+C.', 'fejl');
              }
            } }),
          ]),
          el('button', { class: 'btn ghost lille', text: 'Revoke this address',
            onclick: async () => {
              const svar = await spoerg('Revoke the calendar feed?',
                'Any calendar subscribed to this address stops updating. '
                + 'You can create a new address afterwards.',
                [{ id: 'ja', text: 'Revoke', primary: true }, { id: 'nej', text: 'Cancel' }]);
              if (svar !== 'ja') return;
              await api('/ical', { method: 'DELETE' });
              state.kalender.icalPath = null;
              tegnSide();
              toast('Revoked.');
            } }),
        ])
      : el('div', {}, [
          el('p', { class: 'dim lille', text:
            'Create an address you can subscribe to from your phone or computer calendar.' }),
          el('button', { class: 'btn primary', text: 'Create feed address', onclick: async () => {
            const r = await api('/ical', { method: 'POST' });
            state.kalender.icalPath = r.path;
            tegnSide();
          } }),
        ]),
  ]);
}

async function hentKalender() {
  try {
    const [k, f] = await Promise.all([api('/calendar'), api('/ical')]);
    Object.assign(state.kalender, {
      hentet: true, fejl: '', raekker: k.rows || [],
      idag: k.today, fra: k.from, til: k.to, icalPath: f.path,
    });
  } catch (err) {
    Object.assign(state.kalender, { hentet: true, fejl: err.message });
  }
}
