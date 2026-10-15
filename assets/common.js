// Homerun Records – gemeinsame Funktionen für alle Seiten
const HR = (() => {
  const ICON = {
    logo: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#000"/><circle cx="32" cy="32" r="22" fill="none" stroke="#2c2c2c" stroke-width="1.5"/><circle cx="32" cy="32" r="26" fill="none" stroke="#262626" stroke-width="1"/><circle cx="32" cy="32" r="12" fill="#d93a2b"/><path d="M24 29c4 3 12 3 16 0M24 35c4-3 12-3 16 0" stroke="#fff" stroke-width="1.4" fill="none" stroke-dasharray="2 2"/><circle cx="32" cy="32" r="1.8" fill="#000"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20.5" r="1.3"/><circle cx="17" cy="20.5" r="1.3"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    heart: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20z"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>',
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (n) => (n == null || n === '' ? '–' : Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
  const num = (n) => Number(n || 0).toLocaleString('de-DE');

  async function api(path, opts = {}) {
    const o = { ...opts, headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } };
    if (o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body);
    if (o.body && !o.method) o.method = 'POST';
    const r = await fetch(path, o);
    let j = {};
    try { j = await r.json(); } catch { /* keine JSON-Antwort */ }
    if (!r.ok) {
      const e = new Error(j.error || `Fehler ${r.status}`);
      e.status = r.status;
      e.data = j;
      throw e;
    }
    return j;
  }

  // Cover: gespeichertes Bild, sonst über die API nachladen, sonst Platzhalter
  function cover(r, size = 'thumb') {
    const url = size === 'full' ? (r.cover_url || r.thumb_url) : (r.thumb_url || r.cover_url);
    if (url) return url;
    if (url === '' || r.cover_url === '' || !r.release_id) return '/assets/vinyl.svg';
    return `/api/shop?action=cover&id=${r.id}&size=${size}`;
  }
  const imgTag = (r, size = 'thumb', eager = false) =>
    `<img src="${esc(cover(r, size))}" alt="${esc(r.artist)} – ${esc(r.title)}" ${eager ? '' : 'loading="lazy"'} onerror="this.onerror=null;this.src='/assets/vinyl.svg'">`;

  const discount = (r) => (r.avg_price && r.price ? Math.round((1 - r.price / r.avg_price) * 100) : 0);

  // ---------- Warenkorb (im Browser gespeichert) ----------
  const KEY = 'hr_cart';
  const cart = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } },
    set(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* privat-Modus */ } updateBadge(); },
    has(id) { return this.get().some((x) => x.id === id); },
    add(r) {
      if (this.has(r.id)) return;
      this.set([...this.get(), { id: r.id, artist: r.artist, title: r.title, format: r.format, price: Number(r.price), thumb_url: r.thumb_url, cover_url: r.cover_url, release_id: r.release_id }]);
      toast(`„${r.title}“ liegt im Warenkorb`);
    },
    remove(id) { this.set(this.get().filter((x) => x.id !== id)); },
    clear() { this.set([]); },
  };
  function updateBadge() {
    const b = document.getElementById('cart-badge');
    if (b) { const n = cart.get().length; b.textContent = n; b.dataset.n = n; }
  }

  // Warenkorb-Button: sich selbst aktualisierend
  function cartButton(r, cls = '') {
    const inCart = cart.has(r.id);
    return `<button class="btn btn-sm ${inCart ? 'in-cart' : 'btn-primary'} ${cls}" data-cart="${r.id}">${inCart ? `${ICON.check} Im Warenkorb` : 'In den Warenkorb'}</button>`;
  }
  function bindCartButtons(root, lookup) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cart]');
      if (!b) return;
      const id = Number(b.dataset.cart);
      if (cart.has(id)) { location.href = '/cart'; return; }
      const r = lookup(id);
      if (!r) return;
      cart.add(r);
      b.outerHTML = cartButton(r, b.classList.contains('btn-block') ? 'btn-block btn-lg' : '');
    });
  }

  let toastTimer;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- Layout ----------
  function header() {
    const q = new URLSearchParams(location.search).get('q') || '';
    const el = document.getElementById('site-header');
    if (!el) return;
    el.outerHTML = `
    <header class="site-header">
      <div class="wrap hdr">
        <a class="brand" href="/" aria-label="Homerun Records – Startseite">${ICON.logo}<span class="brand-name">Homerun<b>Records</b></span></a>
        <form class="search" action="/" role="search" id="hdr-search">
          <input name="q" value="${esc(q)}" placeholder="Künstler, Titel, Label, Katalognummer …" aria-label="Suche" autocomplete="off">
          <button aria-label="Suchen">${ICON.search}</button>
        </form>
        <nav class="hdr-nav">
          <a class="hide-sm" href="/?sort=new">Neuzugänge</a>
          <a class="hide-sm" href="/rechtliches#ueber">Über uns</a>
          <a class="account-link" href="/konto" id="account-link" aria-label="Kundenkonto">${ICON.user}<span class="hide-sm" id="account-label">Anmelden</span></a>
          <a class="cart-link" href="/cart" aria-label="Warenkorb">${ICON.cart}<span class="badge" id="cart-badge" data-n="0">0</span></a>
        </nav>
      </div>
      <div class="subnav"><div class="wrap">
        <a href="/">Alle Platten</a>
        <a href="/?format=LP">LPs</a>
        <a href="/?format=12%22">12"</a>
        <a href="/?format=7%22">7" Singles</a>
        <a href="/?format=10%22">10"</a>
        <a href="/?format=Box">Box Sets</a>
        <a href="/?sort=price_asc">Schnäppchen</a>
        <a href="/suche">Erweiterte Suche</a>
        <span class="subnav-note"><strong>Fast alle Platten 10&nbsp;% günstiger</strong> als auf jeder anderen Seite</span>
      </div></div>
    </header>`;
    updateBadge();
    me().then(setAccount);
  }

  // Kundenkonto (Mitgliederbereich)
  let mePromise;
  function me() {
    mePromise ||= api('/api/konto?action=me').then((r) => r.customer).catch(() => null);
    return mePromise;
  }
  function setAccount(c) {
    mePromise = Promise.resolve(c);
    const l = document.getElementById('account-label');
    if (l) l.textContent = c ? 'Mein Konto' : 'Anmelden';
  }

  function footer() {
    const el = document.getElementById('site-footer');
    if (!el) return;
    el.outerHTML = `
    <footer class="site-footer">
      <div class="wrap">
        <div>
          <a class="brand" href="/" style="margin-bottom:12px">${ICON.logo}<span class="brand-name">Homerun<b>Records</b></span></a>
          <p style="max-width:380px;margin:0">Eine private Sammlung von rund 20.000 Schallplatten – Stück für Stück erfasst, ehrlich gradet und fair bepreist.</p>
        </div>
        <div>
          <h4>Shop</h4>
          <a href="/">Alle Platten</a>
          <a href="/?sort=new">Neuzugänge</a>
          <a href="/cart">Warenkorb</a>
        </div>
        <div>
          <h4>Infos</h4>
          <a href="/rechtliches#versand">Versand &amp; Zahlung</a>
          <a href="/rechtliches#impressum">Impressum</a>
          <a href="/rechtliches#datenschutz">Datenschutz</a>
          <a href="/rechtliches#widerruf">Widerruf &amp; AGB</a>
          <a href="#" data-cookie-open>Cookie-Hinweis</a>
        </div>
      </div>
      <div class="legal">© ${new Date().getFullYear()} Homerun Records · Alle Preise inkl. MwSt. · zzgl. Versand</div>
    </footer>`;
  }

  window.addEventListener('storage', (e) => { if (e.key === KEY) updateBadge(); });
  // ---------- Cookie-Hinweis ----------
  // Es werden nur technisch notwendige Speicherungen genutzt (§ 25 Abs. 2 TDDDG) – daher ein Hinweis, keine Einwilligungsabfrage.
  const COOKIE_KEY = 'hr_cookie_hinweis';
  function cookieNotice(force = false) {
    if (location.pathname.startsWith('/admin')) return;
    let seen = false;
    try { seen = localStorage.getItem(COOKIE_KEY) === '1'; } catch { /* privat-Modus */ }
    if (seen && !force) return;
    document.querySelector('.cookie-banner')?.remove();
    const el = document.createElement('div');
    el.className = 'cookie-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Hinweis zu Cookies');
    el.innerHTML = `
      <strong>Cookies &amp; Datenschutz</strong>
      <p>Wir verwenden <strong>nur technisch notwendige Cookies</strong> und Browser-Speicher – für deinen Warenkorb, dein Lieferland und die Anmeldung im Kundenkonto. Es gibt <strong>kein Tracking und keine Werbung</strong>. Beim Bezahlen werden die Bezahlknöpfe von PayPal geladen.</p>
      <div class="cookie-actions">
        <button class="btn btn-primary btn-sm" data-cookie-ok>Verstanden</button>
        <a class="btn btn-sm" href="/rechtliches#datenschutz">Datenschutzerklärung</a>
      </div>`;
    el.querySelector('[data-cookie-ok]').addEventListener('click', () => {
      try { localStorage.setItem(COOKIE_KEY, '1'); } catch { /* egal */ }
      el.remove();
    });
    document.body.append(el);
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-cookie-open]')) return;
    e.preventDefault();
    cookieNotice(true);
  });

  document.addEventListener('DOMContentLoaded', () => { header(); footer(); cookieNotice(); });

  return { api, esc, eur, num, cover, imgTag, discount, cart, cartButton, bindCartButtons, toast, ICON, me, setAccount };
})();
