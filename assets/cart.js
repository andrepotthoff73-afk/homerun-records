// Warenkorb + PayPal-Checkout
document.addEventListener('DOMContentLoaded', async () => {
  const { api, esc, eur, imgTag, cart, ICON } = HR;
  const root = document.getElementById('cart');
  let config = { shipping: 6.19, perPackage: 8, freeFrom: 0, paypalClientId: '' };
  let message = '';

  try { config = await api('/api/shop?action=config'); } catch { /* Standardwerte */ }

  // Preise & Verfügbarkeit mit dem Server abgleichen
  async function refresh() {
    const list = cart.get();
    if (!list.length) return;
    try {
      const { items } = await api(`/api/shop?action=many&ids=${list.map((x) => x.id).join(',')}`);
      const byId = new Map(items.map((r) => [r.id, r]));
      const gone = [];
      const next = [];
      for (const x of list) {
        const r = byId.get(x.id);
        if (!r || r.status !== 'available') gone.push(x);
        else next.push({ ...x, ...r, price: Number(r.price) });
      }
      cart.set(next);
      if (gone.length) {
        message = `<div class="notice warn">Leider schon verkauft und entfernt: ${gone.map((g) => esc(`${g.artist} – ${g.title}`)).join(', ')}</div>`;
      }
    } catch { /* offline: lokale Daten anzeigen */ }
  }

  function totals(list) {
    const items = list.reduce((s, x) => s + Math.round(x.price * 100), 0);
    const packages = Math.ceil(list.length / (config.perPackage || 8));
    const ship = list.length ? (config.freeFrom > 0 && items >= config.freeFrom * 100 ? 0 : packages * Math.round(config.shipping * 100)) : 0;
    return { items: items / 100, ship: ship / 100, total: (items + ship) / 100, packages };
  }

  function render() {
    const list = cart.get();
    if (!list.length) {
      root.innerHTML = `${message}<div class="empty"><img src="/assets/vinyl.svg" alt="" width="80" style="margin:0 auto 12px;border-radius:50%"><p><strong>Dein Warenkorb ist leer.</strong></p><p><a class="btn btn-primary" href="/">Platten entdecken</a></p></div>`;
      return;
    }
    const t = totals(list);
    root.innerHTML = `
      ${message}
      <div class="cart-layout">
        <div>
          ${list.map((x) => `
            <div class="cart-item">
              <a class="cover" href="/record?id=${x.id}">${imgTag(x)}</a>
              <div>
                <a class="row-title" href="/record?id=${x.id}"><span class="by">${esc(x.artist)}</span> – ${esc(x.title)}</a>
                <div class="row-meta">${esc(x.format || '')}</div>
                <button class="x" data-remove="${x.id}">Entfernen</button>
              </div>
              <div class="price">${eur(x.price)}</div>
            </div>`).join('')}
        </div>
        <aside class="summary">
          <div class="line"><span>Zwischensumme (${list.length} ${list.length === 1 ? 'Platte' : 'Platten'})</span><span>${eur(t.items)}</span></div>
          <div class="line"><span>Versand${t.ship ? ` (${t.packages} ${t.packages === 1 ? 'Paket' : 'Pakete'} à ${eur(config.shipping)})` : ''}</span><span>${t.ship ? eur(t.ship) : 'kostenlos'}</span></div>
          <div class="small muted">${eur(config.shipping)} je angefangene ${config.perPackage || 8} Platten</div>
          ${config.freeFrom > 0 && t.ship ? `<div class="small muted">Versandkostenfrei ab ${eur(config.freeFrom)}</div>` : ''}
          <div class="line total"><span>Gesamt</span><span>${eur(t.total)}</span></div>
          <div id="pay-msg"></div>
          <div id="paypal-buttons"></div>
          <p class="small muted" style="margin:0">Mit dem Kauf akzeptierst du unsere <a href="/rechtliches#agb">AGB</a> und die <a href="/rechtliches#widerruf">Widerrufsbelehrung</a>. <strong>Versand ausschließlich an die in deinem PayPal-Konto hinterlegte Adresse.</strong></p>
        </aside>
      </div>`;
    mountPayPal();
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    cart.remove(Number(b.dataset.remove));
    message = '';
    render();
  });

  function payMsg(html, cls = 'err') {
    const el = document.getElementById('pay-msg');
    if (el) el.innerHTML = html ? `<div class="notice ${cls}">${html}</div>` : '';
  }

  let sdk;
  function loadSdk() {
    if (sdk) return sdk;
    sdk = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypalClientId)}&currency=EUR&locale=de_DE&intent=capture`;
      s.onload = resolve;
      s.onerror = () => { sdk = null; reject(new Error('PayPal konnte nicht geladen werden.')); };
      document.head.append(s);
    });
    return sdk;
  }

  async function mountPayPal() {
    const box = document.getElementById('paypal-buttons');
    if (!config.paypalClientId) {
      box.innerHTML = '<div class="notice warn">Die Bezahlung ist gerade noch nicht freigeschaltet.</div>';
      return;
    }
    try { await loadSdk(); } catch (e) { box.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; return; }
    box.innerHTML = '';
    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },
      createOrder: async () => {
        payMsg('');
        try {
          const { id } = await api('/api/paypal?action=create', { body: { ids: cart.get().map((x) => x.id) } });
          return id;
        } catch (e) {
          if (e.data?.unavailable) {
            const gone = new Set(e.data.unavailable);
            cart.set(cart.get().filter((x) => !gone.has(x.id)));
            message = `<div class="notice warn">${esc(e.message)}</div>`;
            render();
          } else {
            payMsg(esc(e.message));
          }
          throw e;
        }
      },
      onApprove: async (data, actions) => {
        try {
          const r = await api('/api/paypal?action=capture', { body: { orderID: data.orderID } });
          cart.clear();
          root.innerHTML = `
            <div class="thanks">
              ${ICON.check.replace('width="16" height="16"', 'width="64" height="64"')}
              <h1>Vielen Dank${r.name ? `, ${esc(r.name.split(' ')[0])}` : ''}!</h1>
              <p>Deine Zahlung über ${eur(r.total)} ist eingegangen. Du bekommst eine Bestätigung von PayPal per E-Mail. Wir verpacken deine Platten sorgfältig und schicken sie in den nächsten Tagen los.</p>
              <p><a class="btn btn-primary" href="/">Weiter stöbern</a></p>
            </div>`;
          window.scrollTo({ top: 0 });
        } catch (e) {
          if (e.data?.issue === 'INSTRUMENT_DECLINED') return actions.restart();
          payMsg(esc(e.message));
        }
      },
      onError: () => payMsg('Bei PayPal ist ein Fehler aufgetreten. Bitte versuche es erneut.'),
    }).render('#paypal-buttons');
  }

  await refresh();
  render();
});
