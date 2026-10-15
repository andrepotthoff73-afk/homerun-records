// Admin-Bereich: Login, Übersicht, CSV-Import, Platten verwalten, Bestellungen, Werkzeuge
document.addEventListener('DOMContentLoaded', async () => {
  const { api, esc, eur, num, cover, toast, ICON } = HR;
  const $ = (id) => document.getElementById(id);
  const brand = `${ICON.logo}<span class="brand-name">Homerun<b>Records</b></span>`;
  $('login-brand').innerHTML = brand;
  $('bar-brand').innerHTML = brand;

  // ---------- Login ----------
  async function boot() {
    let me = { admin: false, configured: true };
    try { me = await api('/api/admin?action=me'); } catch { /* Server nicht erreichbar */ }
    if (me.admin) { $('login').classList.add('hidden'); $('app').classList.remove('hidden'); show('overview'); return; }
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    if (!me.configured) {
      $('login-msg').innerHTML = '<div class="notice warn">Es ist noch kein Admin-Passwort hinterlegt. Setze in Vercel die Umgebungsvariable <code>ADMIN_PASSWORD</code> (mind. 10 Zeichen) und deploye neu.</div>';
    }
  }
  $('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api('/api/admin?action=login', { body: { password: e.target.password.value } });
      e.target.reset();
      $('login-msg').innerHTML = '';
      boot();
    } catch (err) {
      $('login-msg').innerHTML = `<div class="notice err">${esc(err.message)}</div>`;
    } finally { btn.disabled = false; }
  });
  $('logout').addEventListener('click', async () => { await api('/api/admin?action=logout', { body: {} }).catch(() => {}); boot(); });

  // Abgelaufene Sitzung → zurück zum Login
  async function call(path, opts) {
    try { return await api(path, opts); } catch (e) {
      if (e.status === 401) { toast('Sitzung abgelaufen – bitte neu anmelden'); boot(); }
      throw e;
    }
  }

  // ---------- Tabs ----------
  const loaders = {};
  function show(tab) {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab));
    loaders[tab]?.();
  }
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) show(b.dataset.tab);
  });

  // ---------- Übersicht ----------
  loaders.overview = async () => {
    try {
      const s = await call('/api/admin?action=stats');
      $('kpis').innerHTML = [
        ['Im Shop', num(s.available), `Warenwert ${eur(s.availableValue)}`],
        ['Verkauft', num(s.sold), `Umsatz ${eur(s.soldValue)}`],
        ['Entwürfe', num(s.draft), 'ohne Preis / versteckt'],
        ['PayPal-Bestellungen', num(s.orders), `Online ${eur(s.revenue)}`],
      ].map(([k, v, sub]) => `<div class="kpi"><span>${k}</span><b>${v}</b><small>${sub}</small></div>`).join('');
      const item = (state, html) => `<li><span class="dot ${state}"></span><span>${html}</span></li>`;
      $('checklist').innerHTML = [
        item('ok', 'Datenbank verbunden'),
        item('ok', 'Admin-Passwort aktiv'),
        s.paypal
          ? item(s.paypalMode === 'live' ? 'ok' : 'warn', s.paypalMode === 'live' ? 'PayPal <strong>live</strong> – echte Zahlungen aktiv' : 'PayPal im <strong>Sandbox-Testmodus</strong> – setze <code>PAYPAL_MODE=live</code> für echte Zahlungen')
          : item('no', 'PayPal fehlt – setze <code>PAYPAL_CLIENT_ID</code> und <code>PAYPAL_CLIENT_SECRET</code>'),
        s.coverToken
          ? item('ok', `Token für Cover &amp; Tracklisten gesetzt${s.missingCovers ? ` – bei ${num(s.missingCovers)} Platten noch nicht geladen (Werkzeuge)` : ''}`)
          : item('warn', 'Optional: Token für Cover &amp; Tracklisten setzen (siehe README), damit Cover und Track-Suche funktionieren'),
        s.blob
          ? item('ok', 'Bildspeicher verbunden – Cover aus dem Preis-Tool werden gespeichert')
          : item('warn', 'Optional: Blob-Bildspeicher in Vercel verbinden, damit das Preis-Tool Cover hochladen kann'),
        s.reserved ? item('warn', `${num(s.reserved)} Platte(n) reserviert (laufende Zahlung)`) : '',
      ].join('');
    } catch (e) {
      $('kpis').innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
    }
  };

  // ---------- CSV-Import ----------
  const FIELDS = [
    ['artist', 'Künstler *', ['artist', 'künstler', 'interpret', 'band']],
    ['title', 'Titel *', ['title', 'titel', 'album']],
    ['avg_price', 'Ø Marktpreis', ['average price', 'avg price', 'average', 'avg', 'durchschnitt', 'median', 'mittelwert', 'price', 'preis', 'value', 'wert']],
    ['label', 'Label', ['label']],
    ['catno', 'Katalognummer', ['catalog#', 'catno', 'catalog number', 'catalog', 'katalognummer', 'cat#']],
    ['format', 'Format', ['format']],
    ['released', 'Erscheinungsjahr', ['released', 'year', 'jahr', 'erschienen']],
    ['genre', 'Genre / Stil', ['genre', 'style', 'stil']],
    ['release_id', 'Release-ID', ['release_id', 'release id', 'releaseid']],
    ['listing_id', 'Listing-ID', ['listing_id', 'listing id']],
    ['media_condition', 'Zustand Platte', ['collection media condition', 'media_condition', 'media condition', 'zustand platte']],
    ['sleeve_condition', 'Zustand Hülle', ['collection sleeve condition', 'sleeve_condition', 'sleeve condition', 'zustand hülle']],
    ['description', 'Beschreibung (öffentlich)', ['comments', 'description', 'beschreibung']],
    ['notes', 'Notiz (privat)', ['collection notes', 'notes', 'notiz']],
    ['date_added', 'Hinzugefügt am', ['date added', 'date_added', 'listed']],
    ['cover_url', 'Cover-Bild-URL', ['image', 'cover', 'thumb']],
    ['tracks', 'Tracks / Trackliste', ['tracklist', 'track list', 'tracks', 'titelliste']],
    ['country', 'Land', ['country', 'land']],
  ];
  let csv = { headers: [], rows: [], name: '' };
  let map = {};

  function detectDelimiter(text) {
    const line = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length);
    const c = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch in c) c[ch]++; }
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  }
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const d = detectDelimiter(text);
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { row.push(f); f = ''; }
      else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (ch !== '\r') f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return { delimiter: d, rows: rows.filter((r) => r.some((c) => c.trim() !== '')) };
  }
  function parsePrice(s) {
    let t = String(s ?? '').replace(/[^\d.,]/g, '');
    if (!t) return null;
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    const n = parseFloat(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function autoMap(headers) {
    const low = headers.map((h) => h.trim().toLowerCase());
    const used = new Set();
    const m = {};
    for (const [key, , aliases] of FIELDS) {
      let idx = -1;
      for (const a of aliases) { idx = low.findIndex((h, i) => !used.has(i) && h === a); if (idx >= 0) break; }
      if (idx < 0) for (const a of aliases) { idx = low.findIndex((h, i) => !used.has(i) && h.includes(a)); if (idx >= 0) break; }
      if (idx >= 0) { m[key] = idx; used.add(idx); }
    }
    return m;
  }

  async function readFile(file) {
    if (!file) return;
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // Excel-CSV
    const { rows, delimiter } = parseCSV(text);
    if (rows.length < 2) { toast('Die Datei enthält keine Daten.'); return; }
    csv = { headers: rows[0].map((h) => h.trim()), rows: rows.slice(1), name: file.name };
    map = autoMap(csv.headers);
    $('file-info').innerHTML = `<strong>${esc(file.name)}</strong> · ${num(csv.rows.length)} Zeilen · Trennzeichen „${delimiter === '\t' ? 'Tab' : delimiter}“`;
    $('batch').value = file.name.replace(/\.csv$/i, '');
    $('import-config').classList.remove('hidden');
    $('log').classList.add('hidden');
    $('prog-wrap').classList.add('hidden');
    $('do-import').disabled = false;
    renderMapping();
    renderPreview();
  }
  $('file').addEventListener('change', (e) => readFile(e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => readFile(e.dataTransfer.files[0]));

  function renderMapping() {
    const opts = (sel) => `<option value="">– nicht verwenden –</option>${csv.headers.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h || `Spalte ${i + 1}`)}</option>`).join('')}`;
    $('mapping').innerHTML = FIELDS.map(([key, label]) =>
      `<label class="field">${label}<select class="select" data-map="${key}">${opts(map[key])}</select></label>`).join('');
  }
  $('mapping').addEventListener('change', (e) => {
    const k = e.target.dataset.map;
    if (!k) return;
    if (e.target.value === '') delete map[k]; else map[k] = Number(e.target.value);
    renderPreview();
  });
  ['discount', 'min-price'].forEach((id) => $(id).addEventListener('input', renderPreview));

  function settingsNow() {
    return {
      discount: Math.min(90, Math.max(0, Number($('discount').value) || 0)),
      minPrice: Math.max(0, Number($('min-price').value) || 0),
    };
  }
  function calcPrice(avg, s) {
    if (!avg) return null;
    const p = Math.round(avg * (100 - s.discount)) / 100;
    return Math.max(p, s.minPrice);
  }

  function buildRows() {
    const get = (row, k) => (map[k] != null ? (row[map[k]] ?? '').trim() : '');
    const counts = new Map();
    return csv.rows.map((row) => {
      const r = {};
      for (const [k] of FIELDS) r[k] = get(row, k);
      r.avg_price = parsePrice(r.avg_price);
      // Gleiche Platte mehrfach in der Liste → laufende Nummer, damit jedes Exemplar einzeln angelegt wird
      const ident = r.listing_id || [r.release_id, r.date_added, r.media_condition, r.sleeve_condition, r.notes, r.artist, r.title, r.catno].join('|');
      const n = counts.get(ident) || 0;
      counts.set(ident, n + 1);
      r.dup = n;
      return r;
    });
  }

  function renderPreview() {
    const s = settingsNow();
    const rows = buildRows();
    const valid = rows.filter((r) => r.artist && r.title);
    const priced = valid.filter((r) => r.avg_price).length;
    const missing = map.artist == null || map.title == null;
    $('summary').innerHTML = missing
      ? '<div class="notice err">Bitte ordne mindestens „Künstler“ und „Titel“ zu.</div>'
      : `<div class="notice ${priced ? 'ok' : 'warn'}"><strong>${num(valid.length)}</strong> Platten erkannt ·
           <strong>${num(priced)}</strong> mit Marktpreis → gehen direkt online ·
           <strong>${num(valid.length - priced)}</strong> ohne Preis → werden als Entwurf gespeichert
           ${rows.length - valid.length ? ` · ${num(rows.length - valid.length)} Zeilen ohne Künstler/Titel werden übersprungen` : ''}</div>`;
    $('do-import').disabled = missing;
    $('preview').innerHTML = `<thead><tr><th>Künstler</th><th>Titel</th><th class="hide-m">Format</th><th class="hide-m">Zustand</th><th>Ø Marktpreis</th><th>Dein Preis</th></tr></thead>
      <tbody>${valid.slice(0, 10).map((r) => `<tr>
        <td>${esc(r.artist)}</td><td>${esc(r.title)}</td><td class="hide-m">${esc(r.format)}</td><td class="hide-m">${esc(r.media_condition)}</td>
        <td>${r.avg_price ? eur(r.avg_price) : '<span class="muted">–</span>'}</td>
        <td><strong>${r.avg_price ? eur(calcPrice(r.avg_price, s)) : '<span class="st draft">Entwurf</span>'}</strong></td></tr>`).join('')}</tbody>`;
  }

  $('do-import').addEventListener('click', async () => {
    const s = settingsNow();
    const rows = buildRows().filter((r) => r.artist && r.title);
    if (!rows.length) return;
    const btn = $('do-import');
    btn.disabled = true;
    $('prog-wrap').classList.remove('hidden');
    const log = $('log');
    log.classList.remove('hidden');
    log.textContent = '';
    const BATCH = 400;
    const tot = { inserted: 0, updated: 0, skipped: 0 };
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
          const r = await call('/api/admin?action=import', { body: { rows: chunk, discount: s.discount, minPrice: s.minPrice, batch: $('batch').value } });
          tot.inserted += r.inserted; tot.updated += r.updated; tot.skipped += r.skipped;
          ok = true;
        } catch (e) {
          log.textContent += `Fehler bei Zeile ${i + 1}–${i + chunk.length} (Versuch ${attempt}): ${e.message}\n`;
          if (e.status === 401) { btn.disabled = false; return; }
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      const done = Math.min(rows.length, i + BATCH);
      $('prog').style.width = `${(done / rows.length) * 100}%`;
      $('prog-text').textContent = `${num(done)} von ${num(rows.length)} verarbeitet`;
    }
    log.textContent += `Fertig: ${num(tot.inserted)} neu, ${num(tot.updated)} aktualisiert, ${num(tot.skipped)} übersprungen.\n`;
    toast('Import abgeschlossen');
    btn.disabled = false;
  });

  // ---------- Platten ----------
  const rec = { page: 1, items: [], selected: new Set(), total: 0 };
  const STATUS = { available: 'Verfügbar', draft: 'Entwurf', reserved: 'Reserviert', sold: 'Verkauft' };

  loaders.records = () => loadRecords();
  $('rec-filter').addEventListener('submit', (e) => { e.preventDefault(); rec.page = 1; loadRecords(); });
  $('rec-filter').addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') { rec.page = 1; loadRecords(); } });

  async function loadRecords() {
    const f = $('rec-filter');
    const qs = new URLSearchParams({ action: 'records', q: f.q.value, status: f.status.value, sort: f.sort.value, page: rec.page, per: 50 });
    $('rec-table').innerHTML = '<tbody><tr><td class="muted">Lade …</td></tr></tbody>';
    try {
      const data = await call(`/api/admin?${qs}`);
      rec.items = data.items;
      rec.total = data.total;
      rec.selected.clear();
      renderRecords();
    } catch (e) {
      $('rec-table').innerHTML = `<tbody><tr><td><div class="notice err">${esc(e.message)}</div></td></tr></tbody>`;
    }
  }

  function renderRecords() {
    $('rec-count').textContent = `${num(rec.total)} Platten`;
    if (!rec.items.length) {
      $('rec-table').innerHTML = '<tbody><tr><td class="muted" style="padding:24px">Keine Platten gefunden.</td></tr></tbody>';
      $('rec-pager').innerHTML = '';
      updateBulk();
      return;
    }
    $('rec-table').innerHTML = `
      <thead><tr>
        <th><input type="checkbox" id="sel-all" aria-label="Alle auswählen"></th>
        <th class="hide-m"></th><th>Platte</th><th class="hide-m">Zustand</th><th class="hide-m">Ø Markt</th><th>Preis</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>${rec.items.map((r) => `
        <tr data-id="${r.id}">
          <td><input type="checkbox" data-sel="${r.id}" aria-label="Auswählen"></td>
          <td class="hide-m"><div class="thumb"><img src="${esc(cover(r))}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/assets/vinyl.svg'"></div></td>
          <td><strong>${esc(r.artist)}</strong> – ${esc(r.title)}
            <div class="small muted">#${r.id} · ${[r.label, r.catno, r.format].filter(Boolean).map(esc).join(' · ')}</div>
            ${r.notes ? `<div class="small" style="color:var(--warn)">Notiz: ${esc(r.notes)}</div>` : ''}</td>
          <td class="hide-m small">${esc(r.media_condition || '')}${r.sleeve_condition ? `<br><span class="muted">${esc(r.sleeve_condition)}</span>` : ''}</td>
          <td class="hide-m">${r.avg_price ? eur(r.avg_price) : '–'}</td>
          <td><input class="input price-in" data-price="${r.id}" value="${r.price != null ? Number(r.price).toFixed(2).replace('.', ',') : ''}" inputmode="decimal" placeholder="€" ${r.status === 'sold' ? 'disabled' : ''} title="${r.price_locked ? 'Von Hand gesetzt' : 'Automatisch berechnet'}"></td>
          <td><span class="st ${r.status}">${STATUS[r.status] || r.status}</span>${r.sold_at && r.status === 'sold' ? `<div class="small muted">${new Date(r.sold_at).toLocaleDateString('de-DE')}</div>` : ''}</td>
          <td><div class="row-actions">${r.status === 'sold'
            ? `<button class="btn btn-sm" data-act="available" data-id="${r.id}">Zurücksetzen</button>`
            : `<button class="btn btn-sm btn-ok" data-act="sold" data-id="${r.id}">Verkauft</button>`}</div></td>
        </tr>`).join('')}
      </tbody>`;
    renderRecPager();
    updateBulk();
  }

  function updateBulk() {
    const n = rec.selected.size;
    $('bulk').classList.toggle('hidden', !n);
    $('bulk-n').textContent = `${n} ausgewählt`;
    document.querySelectorAll('#rec-table tr[data-id]').forEach((tr) => tr.classList.toggle('sel', rec.selected.has(Number(tr.dataset.id))));
  }

  $('rec-table').addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'sel-all') {
      rec.selected = new Set(t.checked ? rec.items.map((r) => r.id) : []);
      document.querySelectorAll('[data-sel]').forEach((c) => { c.checked = t.checked; });
      updateBulk();
    } else if (t.dataset.sel) {
      const id = Number(t.dataset.sel);
      if (t.checked) rec.selected.add(id); else rec.selected.delete(id);
      updateBulk();
    } else if (t.dataset.price) {
      const price = parseFloat(t.value.replace(',', '.'));
      if (!(price > 0)) { toast('Ungültiger Preis'); return; }
      try {
        await call('/api/admin?action=update', { body: { op: 'price', ids: [Number(t.dataset.price)], price } });
        toast(`Preis gespeichert: ${eur(price)}`);
        const r = rec.items.find((x) => x.id === Number(t.dataset.price));
        if (r && r.status === 'draft') loadRecords();
      } catch (err) { toast(err.message); }
    }
  });
  $('rec-table').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.price) e.target.blur(); });

  $('rec-table').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    b.disabled = true;
    await mutate(b.dataset.act, [Number(b.dataset.id)]);
  });
  $('bulk').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-bulk]');
    if (!b) return;
    const ids = [...rec.selected];
    if (b.dataset.bulk === 'delete' && !confirm(`${ids.length} Platte(n) endgültig löschen?`)) return;
    await mutate(b.dataset.bulk, ids);
  });

  async function mutate(op, ids) {
    try {
      const r = await call('/api/admin?action=update', { body: { op, ids } });
      const labels = { sold: 'als verkauft markiert', available: 'wieder verfügbar', draft: 'versteckt', delete: 'gelöscht' };
      toast(`${r.changed} Platte(n) ${labels[op] || 'geändert'}${op === 'available' && r.changed < ids.length ? ' (ohne Preis bleiben versteckt)' : ''}`);
      loadRecords();
    } catch (err) { toast(err.message); }
  }

  function renderRecPager() {
    const pages = Math.ceil(rec.total / 50);
    if (pages <= 1) { $('rec-pager').innerHTML = ''; return; }
    const p = rec.page;
    $('rec-pager').innerHTML = `<button data-p="${p - 1}" ${p === 1 ? 'disabled' : ''}>‹</button>
      <span class="gap">Seite ${p} von ${pages}</span>
      <button data-p="${p + 1}" ${p === pages ? 'disabled' : ''}>›</button>`;
  }
  $('rec-pager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    rec.page = Number(b.dataset.p);
    loadRecords();
    window.scrollTo({ top: 0 });
  });

  // ---------- Bestellungen ----------
  loaders.orders = async () => {
    const t = $('orders');
    t.innerHTML = '<tbody><tr><td class="muted">Lade …</td></tr></tbody>';
    try {
      const { items } = await call('/api/admin?action=orders');
      if (!items.length) { t.innerHTML = '<tbody><tr><td class="muted" style="padding:24px">Noch keine Bestellungen.</td></tr></tbody>'; return; }
      const addr = (a) => (a ? [a.address_line_1, a.address_line_2, `${a.postal_code || ''} ${a.admin_area_2 || ''}`.trim(), a.country_code].filter(Boolean).map(esc).join('<br>') : '');
      const OS = { completed: 'Bezahlt', failed: 'Abgebrochen', created: 'Offen' };
      t.innerHTML = `<thead><tr><th>Datum</th><th>Käufer &amp; Adresse</th><th>Platten</th><th>Summe</th><th>Status</th></tr></thead>
        <tbody>${items.map((o) => `<tr>
          <td class="small">${new Date(o.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}<div class="muted">${esc(o.paypal_order_id)}</div></td>
          <td class="small"><strong>${esc(o.payer_name || '')}</strong>${o.payer_email ? `<br><a href="mailto:${esc(o.payer_email)}">${esc(o.payer_email)}</a>` : ''}<br>${addr(o.shipping_address)}</td>
          <td class="small">${(o.items || []).map((i) => `#${esc(i.sku)} ${esc(i.name)} – ${eur(i.unit_amount?.value)}`).join('<br>')}</td>
          <td><strong>${eur(o.total)}</strong><div class="small muted">inkl. ${eur(o.shipping)} Versand</div></td>
          <td><span class="st ${o.status}">${OS[o.status] || o.status}</span></td>
        </tr>`).join('')}</tbody>`;
    } catch (e) {
      t.innerHTML = `<tbody><tr><td><div class="notice err">${esc(e.message)}</div></td></tr></tbody>`;
    }
  };

  // ---------- Werkzeuge ----------
  $('reprice').addEventListener('click', async () => {
    const d = Number($('reprice-discount').value);
    if (!confirm(`Alle automatischen Preise auf Ø-Marktpreis minus ${d} % setzen?`)) return;
    try {
      const r = await call('/api/admin?action=reprice', { body: { discount: d } });
      toast(`${num(r.changed)} Preise neu berechnet`);
    } catch (e) { toast(e.message); }
  });

  let coverRun = false;
  $('covers').addEventListener('click', async () => {
    const btn = $('covers');
    if (coverRun) { coverRun = false; btn.textContent = 'Cover & Tracklisten laden'; return; }
    coverRun = true;
    btn.textContent = 'Stoppen';
    let start = null;
    let loaded = 0;
    while (coverRun) {
      try {
        const r = await call('/api/admin?action=cover', { body: {} });
        if (start == null) start = r.remaining + 1;
        loaded++;
        $('covers-prog').style.width = `${start ? ((start - r.remaining) / start) * 100 : 100}%`;
        $('covers-text').textContent = r.done ? 'Alles geladen.' : `${num(loaded)} geladen · noch ${num(r.remaining)} offen${r.status === 'ratelimit' ? ' · zu viele Abfragen, warte kurz …' : ''}`;
        if (r.done || !r.remaining) break;
        await new Promise((res) => setTimeout(res, r.status === 'ratelimit' ? 20000 : 1100));
      } catch (e) {
        $('covers-text').textContent = e.message;
        break;
      }
    }
    coverRun = false;
    btn.textContent = 'Cover & Tracklisten laden';
  });

  boot();
});
