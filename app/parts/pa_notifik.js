
/* ------------------------------------------------------- notifikationer */

/*
 * Notifikationer om nye afsnit.
 *
 * KRAEVER https. Over panelets IP:port findes hverken Notification eller
 * PushManager, og et ubetinget kald ville kaste ved hver indlaesning (§4).
 * Derfor siger fladen det HOEJT frem for at vise en knap, der ikke kan virke.
 */
function notifikationAfsnit() {
  const n = state.push;
  const kanTeknisk = 'Notification' in window && 'serviceWorker' in navigator
    && 'PushManager' in window;

  if (!kanTeknisk || (state.config && !state.config.secureContext)) {
    return el('div', {}, [
      el('p', { class: 'dim', text:
        'Notifications need https. Open spolen on its own domain instead of the '
        + 'panel’s IP address, and this section becomes available.' }),
    ]);
  }

  const tilladelse = Notification.permission;
  return el('div', {}, [
    el('p', { class: 'dim lille', text:
      'A notification when a new episode of something you follow airs. '
      + 'One per episode — spolen checks every hour but never tells you twice.' }),

    tilladelse === 'denied'
      ? el('p', { class: 'noeglestatus mangler', text:
          'Your browser is blocking notifications for this site. You have to allow '
          + 'them in the browser’s own settings — a website cannot ask again once denied.' })
      : null,

    n.abon.length
      ? el('div', {}, [
          el('p', { class: 'noeglestatus har', text:
            `${n.abon.length} device${n.abon.length === 1 ? '' : 's'} subscribed.` }),
          el('div', { class: 'liste' }, n.abon.map((a) => el('div', { class: 'item-row' }, [
            el('span', { text: a.service }),
            el('span', { class: 'dim lille', text: a.lastOkAt
              ? `last delivered ${new Date(a.lastOkAt * 1000).toISOString().slice(0, 10)}`
              : 'never delivered yet' }),
          ]))),
          el('div', { class: 'knaprad' }, [
            el('button', { class: 'btn primary', text: 'Send a test notification',
              onclick: (e) => proevNotifikation(e.target) }),
            el('button', { class: 'btn ghost', text: 'Turn off on this device',
              onclick: (e) => afmeld(e.target) }),
          ]),
        ])
      : el('button', {
          class: 'btn primary', text: 'Turn on notifications',
          disabled: tilladelse === 'denied',
          onclick: (e) => tilmeld(e.target),
        }),

    n.fejl ? el('p', { class: 'noeglestatus mangler', text: n.fejl }) : null,
  ]);
}

/** base64url -> Uint8Array. PushManager vil have raa bytes, ikke en streng. */
function b64uTilBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function tilmeld(knap) {
  knap.disabled = true;
  state.push.fejl = '';
  try {
    const tilladelse = await Notification.requestPermission();
    if (tilladelse !== 'granted') {
      state.push.fejl = tilladelse === 'denied'
        ? 'You said no. The browser will not ask again — allow it in the site settings.'
        : 'No answer to the permission request.';
      tegnSide();
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/push');
    const abon = await reg.pushManager.subscribe({
      // userVisibleOnly er PAAKRAEVET i Chrome: man maa ikke abonnere paa
      // push uden at vise brugeren noget.
      userVisibleOnly: true,
      applicationServerKey: b64uTilBytes(key),
    });
    const j = abon.toJSON();
    await api('/push/subscribe', { method: 'POST', body: {
      endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
    } });
    await hentPush();
    tegnSide();
    toast('Notifications are on.');
  } catch (err) {
    state.push.fejl = err.message;
    tegnSide();
  }
}

async function afmeld(knap) {
  knap.disabled = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    const abon = await reg.pushManager.getSubscription();
    if (abon) {
      await api('/push/unsubscribe', { method: 'POST', body: { endpoint: abon.endpoint } });
      await abon.unsubscribe();
    }
    await hentPush();
    tegnSide();
    toast('Notifications off on this device.');
  } catch (err) { toast(err.message, 'fejl'); knap.disabled = false; }
}

async function proevNotifikation(knap) {
  knap.disabled = true;
  const gammel = knap.textContent;
  knap.textContent = 'Sending…';
  try {
    const r = await api('/push/test', { method: 'POST' });
    toast(r.sendt
      ? `Sent to ${r.sendt} device${r.sendt === 1 ? '' : 's'}.`
        + (r.doede ? ` ${r.doede} stale one${r.doede === 1 ? '' : 's'} removed.` : '')
      : 'The push service accepted nothing — see the server log.', r.sendt ? '' : 'fejl');
    await hentPush();
    tegnSide();
  } catch (err) { toast(err.message, 'fejl'); }
  knap.disabled = false;
  knap.textContent = gammel;
}

async function hentPush() {
  try {
    const r = await api('/push');
    state.push.abon = r.subscriptions || [];
    state.push.noegle = r.key;
  } catch { state.push.abon = []; }
}
