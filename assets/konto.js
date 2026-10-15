// Mitgliederbereich: Anmelden / Registrieren, Übersicht, Bestellungen, Merkliste, Profil
document.addEventListener('DOMContentLoaded', async () => {
  const { api, esc, eur, num, imgTag, cartButton, bindCartButtons, toast, ICON } = HR;
  const root = document.getElementById('konto');
  const P = new URLSearchParams(location.search);
  const next = P.get('next') && P.get('next').startsWith('/') ? P.get('next') : '';
  let me = null;
  let wish = [];
  bindCartButtons(root, (id) => wish.find((r) => r.id === id));

  const notice = (id, html, cls = 'err') => { const el = document.getElementById(id); if (el) el.innerHTML = html ? `<div class="notice ${cls}">${html}</div>` : ''; };

  async function load() {
    try { me = (await api('/api/konto?action=me')).customer; } catch { me = null; }
    HR.setAccount?.(me);
    if (me) member(P.get('tab') || 'overview'); else guest(P.get('tab') === 'register' ? 'register' : 'login');
  }

  // ---------- Nicht angemeldet ----------
  function guest(mode) {
    document.title = 'Anmelden – Homerun Records';
    root.innerHTML = `
      <div class="auth">
        <div class="auth-card">
          <div class="auth-tabs">
            <button data-mode="login" class="${mode === 'login' ? 'active' : ''}">Anmelden</button>
            <button data-mode="register" class="${mode === 'register' ? 'active' : ''}">Konto erstellen</button>
          </div>
          ${mode === 'login' ? `
          <form id="f-login" class="auth-form">
            <label class="field">E-Mail<input class="input" type="email" name="email" autocomplete="email" required></label>
            <label class="field">Passwort<input class="input" type="password" name="password" autocomplete="current-password" required></label>
            <div id="msg"></div>
            <button class="btn btn-primary btn-lg btn-block">Anmelden</button>
          </form>` : `
          <form id="f-register" class="auth-form">
            <label class="field">Name<input class="input" name="name" autocomplete="name" required></label>
            <label class="field">E-Mail<input class="input" type="email" name="email" autocomplete="email" required></label>
            <label class="field">Passwort <span class="muted" style="font-weight:400">(mind. 8 Zeichen)</span><input class="input" type="password" name="password" autocomplete="new-password" minlength="8" required></label>
            <div id="msg"></div>
            <button class="btn btn-primary btn-lg btn-block">Konto erstellen</button>
            <p class="small muted" style="margin:0">Mit dem Erstellen stimmst du unserer <a href="/rechtliches#datenschutz">Datenschutzerklärung</a> zu.</p>
          </form>`}
        </div>
        <aside class="auth-info">
          <h2>Dein Homerun-Konto</h2>
          <ul class="perks">
            <li>${ICON.check}<span><strong>Bestellübersicht</strong> – alle Käufe auf einen Blick</span></li>
            <li>${ICON.check}<span><strong>Merkliste</strong> – Platten vormerken und später kaufen</span></li>
            <li>${ICON.check}<span><strong>Schneller Checkout</strong> mit PayPal</span></li>
          </ul>
          <div class="notice warn" style="margin-top:14px">Versand erfolgt <strong>ausschließlich an die in deinem PayPal-Konto hinterlegte Adresse</strong>. Im Kundenkonto wird keine Adresse gespeichert.</div>
          <p class="small muted">Du kannst auch ohne Konto bestellen.</p>
        </aside>
      </div>`;
    root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      history.replaceState(null, '', `?tab=${b.dataset.mode}${next ? `&next=${encodeURIComponent(next)}` : ''}`);
      guest(b.dataset.mode);
    }));
    const form = root.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      const body = Object.fromEntries(new FormData(form));
      try {
        await api(`/api/konto?action=${mode}`, { body });
        toast(mode === 'login' ? 'Willkommen zurück!' : 'Dein Konto wurde erstellt.');
        if (next) { location.href = next; return; }
        history.replaceState(null, '', location.pathname);
        load();
      } catch (err) {
        notice('msg', esc(err.message));
        btn.disabled = false;
      }
    });
  }

  // ---------- Angemeldet ----------
  const TABS = [['overview', 'Übersicht'], ['orders', 'Bestellungen'], ['wishlist', 'Merkliste'], ['profile', 'Profil']];
  function member(tab) {
    document.title = 'Mein Konto – Homerun Records';
    root.innerHTML = `
      <div class="page-head"><h1>Hallo, ${esc(me.name.split(' ')[0])}!</h1><p class="muted" style="margin:0">${esc(me.email)}</p></div>
      <div class="member">
        <nav class="member-nav">
          ${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}${k === 'wishlist' && me.wishlist_count ? ` <span class="badge">${me.wishlist_count}</span>` : ''}</button>`).join('')}
          <button id="logout">Abmelden</button>
        </nav>
        <section id="pane"></section>
      </div>`;
    root.querySelectorAll('.member-nav [data-tab]').forEach((b) => b.addEventListener('click', () => {
      history.replaceState(null, '', `?tab=${b.dataset.tab}`);
      member(b.dataset.tab);
    }));
    document.getElementById('logout').addEventListener('click', async () => {
      await api('/api/konto?action=logout', { body: {} }).catch(() => {});
      toast('Du bist abgemeldet.');
      history.replaceState(null, '', location.pathname);
      load();
    });
    ({ overview, orders, wishlist: wishlistPane, profile })[tab]?.();
  }

  const pane = () => document.getElementById('pane');

  function overview() {
    pane().innerHTML = `
      <div class="kpi-row">
        <a class="kpi-card" href="?tab=orders"><span>Bestellungen</span><b>${num(me.order_count)}</b></a>
        <a class="kpi-card" href="?tab=wishlist"><span>Merkliste</span><b>${num(me.wishlist_count)}</b></a>
        <div class="kpi-card"><span>Kunde seit</span><b>${new Date(me.created_at).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}</b></div>
      </div>
      <div class="notice warn" style="margin-top:18px"><strong>Versand nur an deine PayPal-Adresse:</strong> Wir verschicken jede Bestellung an die Lieferadresse, die in deinem PayPal-Konto hinterlegt ist. Möchtest du an eine andere Adresse liefern lassen, ändere sie bitte vor dem Kauf direkt bei PayPal.</div>
      <p style="margin-top:18px"><a class="btn btn-primary" href="/">Weiter stöbern</a></p>`;
  }

  async function orders() {
    pane().innerHTML = '<p class="muted">Lade Bestellungen …</p>';
    try {
      const { items } = await api('/api/konto?action=orders');
      if (!items.length) { pane().innerHTML = '<div class="empty"><p><strong>Noch keine Bestellungen.</strong></p><p><a class="btn btn-primary" href="/">Platten entdecken</a></p></div>'; return; }
      const addr = (a) => (a ? [a.address_line_1, a.address_line_2, `${a.postal_code || ''} ${a.admin_area_2 || ''}`.trim(), a.country_code].filter(Boolean).map(esc).join(', ') : '–');
      pane().innerHTML = items.map((o) => `
        <article class="order">
          <header>
            <div><strong>Bestellung vom ${new Date(o.created_at).toLocaleDateString('de-DE')}</strong><div class="small muted">PayPal-Nr. ${esc(o.paypal_order_id)}</div></div>
            <div class="price">${eur(o.total)}</div>
          </header>
          <ul>${(o.items || []).map((i) => `<li><span>${esc(i.name)}</span><span>${eur(i.unit_amount?.value)}</span></li>`).join('')}
            <li class="muted"><span>Versand</span><span>${eur(o.shipping)}</span></li></ul>
          <div class="small muted">Versand an (PayPal-Adresse): ${addr(o.shipping_address)}</div>
        </article>`).join('');
    } catch (e) { pane().innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
  }

  async function wishlistPane() {
    pane().innerHTML = '<p class="muted">Lade Merkliste …</p>';
    const { items } = await api('/api/konto?action=wishlist');
    wish = items;
    if (!items.length) { pane().innerHTML = '<div class="empty"><p><strong>Deine Merkliste ist leer.</strong></p><p class="small">Auf jeder Platte findest du den Knopf „Merken“.</p><p><a class="btn btn-primary" href="/">Platten entdecken</a></p></div>'; return; }
    pane().innerHTML = `<div class="grid">${items.map((r) => `
      <article class="card">
        <a class="cover" href="/record?id=${r.id}">${imgTag(r)}</a>
        <a class="row-title" href="/record?id=${r.id}"><span class="by">${esc(r.artist)}</span> – ${esc(r.title)}</a>
        <div class="row-meta">${esc(r.format || '')}</div>
        <div class="card-foot">${r.status === 'available' ? `<div class="price">${eur(r.price)}</div>${cartButton(r)}` : '<span class="sold-tag" style="font-size:.72rem">Verkauft</span>'}</div>
        <button class="x-wish" data-unwish="${r.id}">Entfernen</button>
      </article>`).join('')}</div>`;
    pane().querySelectorAll('[data-unwish]').forEach((b) => b.addEventListener('click', async () => {
      await api('/api/konto?action=wishlist', { body: { record_id: Number(b.dataset.unwish), remove: true } });
      me.wishlist_count = Math.max(0, me.wishlist_count - 1);
      member('wishlist');
    }));
  }

  function profile() {
    pane().innerHTML = `
      <form id="f-profile" class="card-panel">
        <h2>Persönliche Daten</h2>
        <label class="field">Name<input class="input" name="name" value="${esc(me.name)}" required></label>
        <label class="field">E-Mail<input class="input" value="${esc(me.email)}" disabled></label>
        <h2 style="margin-top:12px">Passwort ändern</h2>
        <label class="field">Aktuelles Passwort<input class="input" type="password" name="password" autocomplete="current-password"></label>
        <label class="field">Neues Passwort<input class="input" type="password" name="newPassword" minlength="8" autocomplete="new-password"></label>
        <div id="p-msg"></div>
        <button class="btn btn-primary">Speichern</button>
      </form>
      <form id="f-delete" class="card-panel" style="margin-top:18px">
        <h2>Konto löschen</h2>
        <p class="small muted" style="margin:0">Dein Konto und deine Merkliste werden endgültig gelöscht. Bestellungen bleiben für die Buchhaltung erhalten, sind aber nicht mehr mit dir verknüpft.</p>
        <label class="field">Passwort zur Bestätigung<input class="input" type="password" name="password" autocomplete="current-password" required></label>
        <div id="d-msg"></div>
        <button class="btn">Konto endgültig löschen</button>
      </form>`;
    document.getElementById('f-profile').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try {
        await api('/api/konto?action=profile', { body });
        me.name = body.name;
        notice('p-msg', 'Gespeichert.', 'ok');
        e.target.password.value = '';
        e.target.newPassword.value = '';
      } catch (err) { notice('p-msg', esc(err.message)); }
    });
    document.getElementById('f-delete').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!confirm('Konto wirklich endgültig löschen?')) return;
      try {
        await api('/api/konto?action=delete', { body: Object.fromEntries(new FormData(e.target)) });
        toast('Dein Konto wurde gelöscht.');
        history.replaceState(null, '', location.pathname);
        load();
      } catch (err) { notice('d-msg', esc(err.message)); }
    });
  }

  load();
});
