
/* ---------------------------------------------------------- indstillinger */

/*
 * Settings.
 *
 * Hemmeligheder er SKRIVE-ONLY i fladen: serveren sender aldrig noeglen
 * tilbage, kun et flag (§6b). Feltet staar derfor altid tomt, og teksten
 * ved siden af siger, om der ER en noegle - i stedet for at vise prikker,
 * der ligner en vaerdi, man kunne rette i.
 */
function settingsSide() {
  const admin = state.user && state.user.isAdmin;
  /*
   * Alle hovedpunkter er foldbare og starter LUKKEDE.
   *
   * Indholdet bygges foerst, naar afsnittet aabnes - tjenestelisten alene er
   * 62 raekker med hvert sit logo.
   */
  return el('div', {}, [
    el('h1', { text: 'Settings' }),

    /*
     * Temaet staar OEVERST og er ikke foldet.
     *
     * Det er den ene indstilling, man aendrer for at se paa den - er den
     * gemt bag en overskrift, skal man folde ud, klikke, og folde ind igen
     * for at se resultatet. De tre valg fylder én linje (Andreas,
     * 2026-08-29).
     */
    temaAfsnit(),

    foldAfsnit('metadata', 'Metadata', 'tmdb', () => (admin
      ? tmdbAfsnit()
      : el('p', { class: 'dim', text: 'Only the administrator can change the TMDB key.' }))),

    foldAfsnit('praef', 'Your preferences', null, personligeAfsnit),

    foldAfsnit('tjenester', 'Your streaming services', null, tjenesteAfsnit),

    foldAfsnit('import', 'Import your history', null, importSide),

    /*
     * Plex staar for sig selv - ikke inde under importen.
     *
     * Det er en LOEBENDE forbindelse (polling, webhook, watchlist, lokalt
     * katalog), ikke et engangstrin. Inde i importafsnittet skulle man
     * foerst aabne "Import your history" for at naa den, og den skubbede
     * samtidig importens eget svar ned under skaermkanten
     * (Andreas, 2026-08-29).
     */
    foldAfsnit('plex', 'Plex', 'plex', plexAfsnit),

    admin ? foldAfsnit('traktapp', 'Trakt application', 'trakt', traktAppAfsnit) : null,

    foldAfsnit('notifik', 'Notifications', null, notifikationAfsnit),

    foldAfsnit('noegler', 'Access keys', 'noegler', noegleAfsnit),

    admin ? foldAfsnit('server', 'This server', null, serverAfsnit) : null,
  ]);
}

/*
 * Alle tre temavalg. Genvejen i sidebarens fod skifter kun mellem lys og
 * moerk; "Follow system" findes kun her, fordi den ikke er en tredje farve,
 * man kan skifte TIL i en toggle.
 */
function temaAfsnit() {
  const nu = nuvaerendeTema();
  const valg = [['auto', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']];
  return el('section', { class: 'card' }, [
    el('h2', { text: 'Theme' }),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' },
      valg.map(([v, l]) => el('button', {
        class: `btn ${nu === v ? 'primary' : ''}`,
        'aria-pressed': nu === v ? 'true' : 'false',
        text: l,
        // Hele siden tegnes om, saa BAADE de tre knapper og temaknappen i
        // foden foelger med. Ellers viser foden vej til det tema, man
        // allerede er i.
        onclick: () => { anvendTema(v); tegnSide(); },
      }))),
  ]);
}

function tmdbAfsnit() {
  const harNoegle = !!(state.config && state.config.tmdbKeySet);
  const felt = el('input', {
    type: 'password',
    /*
     * Feltet staar altid TOMT - noeglen sendes aldrig tilbage fra serveren.
     * Men et tomt felt med "indsaet din noegle her" ligner "der er ingen
     * noegle", og det er praecis den forvirring, Andreas paapegede.
     * Pladsholderen siger derfor, hvad feltet GOER, og linjen nedenunder
     * siger, hvad tilstanden ER.
     */
    placeholder: harNoegle ? 'Paste a new key to replace the saved one'
      : 'Paste your TMDB key here',
    autocomplete: 'off', spellcheck: 'false',
    style: 'font-size:16px',
  });
  const status = el('p', {
    class: harNoegle ? 'noeglestatus har' : 'noeglestatus mangler',
    text: state.tmdb.besked || 'Checking…',
  });

  return el('div', {}, [
    el('p', { class: 'dim', text:
      'spolen accepts either kind TMDB gives you — the API Read Access Token '
      + '(the long one) or the API Key (the short one). Paste whichever you have.' }),
    el('div', { class: 'formgrid' }, [
      el('label', { text: 'TMDB key' }), felt,
      el('button', {
        class: 'btn primary', text: harNoegle ? 'Replace key' : 'Save key',
        onclick: async (e) => {
          const v = felt.value.trim();
          if (!v) { toast('Paste a key first.', 'fejl'); return; }
          e.target.disabled = true;
          try {
            await api('/admin/settings', { method: 'PUT', body: { tmdb_key: v } });
            // Ryd feltet med det samme. En noegle, der bliver staaende i et
            // formularfelt, ryger med i browserens autofyld og i et screenshot.
            felt.value = '';
            toast('Key saved. Testing it…');
            /*
             * Tjenestelisten skal hentes IGEN. Den fejlede, foer noeglen var
             * der, og fejlen bliver staaende i state - saa staar der "No TMDB
             * key yet" lige under en linje, der siger at noeglen virker
             * (Andreas, 2026-08-29).
             */
            await Promise.all([tjekTmdb(), hentTjenester()]);
            tegnSide();
          } catch (err) {
            toast(err.message, 'fejl');
          } finally { e.target.disabled = false; }
        },
      }),
    ]),
    status,
    el('button', { class: 'btn ghost lille', text: 'Test the key again',
      onclick: async () => { await tjekTmdb(); tegnSide(); } }),
  ]);
}

function personligeAfsnit() {
  const sprog = el('select', { style: 'font-size:16px' }, [
    el('option', { value: 'en-US', text: 'English' }),
    el('option', { value: 'da-DK', text: 'Dansk' }),
  ]);
  sprog.value = state.settings.language || 'en-US';
  const region = el('select', { style: 'font-size:16px' }, [
    el('option', { value: 'DK', text: 'Denmark' }),
    el('option', { value: 'US', text: 'United States' }),
    el('option', { value: 'GB', text: 'United Kingdom' }),
  ]);
  region.value = state.settings.region || 'DK';

  return el('div', { class: 'formgrid' }, [
    el('label', { text: 'Titles and summaries in' }), sprog,
    el('label', { text: 'Streaming availability for' }), region,
    el('button', {
      class: 'btn primary', text: 'Save',
      onclick: async () => {
        try {
          await api('/settings', { method: 'PUT',
            body: { language: sprog.value, region: region.value } });
          state.settings.language = sprog.value;
          state.settings.region = region.value;
          toast('Saved.');
        } catch (err) { toast(err.message, 'fejl'); }
      },
    }),
  ]);
}

function serverAfsnit() {
  const aaben = state.delte.allow_registration === '1';
  return el('div', {}, [
    el('label', {}, [
      el('input', {
        type: 'checkbox', checked: aaben,
        onchange: async (e) => {
          try {
            await api('/admin/settings', { method: 'PUT',
              body: { allow_registration: e.target.checked ? '1' : '0' } });
            state.delte.allow_registration = e.target.checked ? '1' : '0';
            toast(e.target.checked ? 'Anyone with the address can sign up.' : 'Sign-up closed.');
          } catch (err) { toast(err.message, 'fejl'); }
        },
      }),
      ' Let new people create an account',
    ]),
    el('p', { class: 'dim lille', text:
      'Leave this off once everyone in the house has an account.' }),
  ]);
}

async function tjekTmdb() {
  try {
    const s = await api('/tmdb-status');
    state.config.tmdbKeySet = s.set;
    // Teksten skal foerst og fremmest svare paa "er der en noegle?" - og
    // DEREFTER paa "virker den?".
    state.tmdb.besked = s.set
      ? (s.ok ? `A key is saved and working — ${s.format}. ${s.message}`
              : `A key is saved, but it is not working: ${s.message}`)
      : 'No key saved yet — paste one above.';
  } catch (err) {
    state.tmdb.besked = err.message;
  }
}

async function hentSettings() {
  const s = await api('/settings');
  state.settings = s.settings || {};
  state.delte = s.shared || {};
}
