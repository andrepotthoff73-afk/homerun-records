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

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    show(a.dataset.goto);
  });

  // ---------- Übersicht ----------
  loaders.overview = async () => {
    try {
      const s = await call('/api/admin?action=stats');
      setBadge(s.enrichPending);
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
        s.enrichPending ? item('warn', `${num(s.enrichPending)} Platte(n) warten auf Preise &amp; Cover – <a href="#" data-goto="import">jetzt ermitteln</a>`) : '',
        s.enrichErrors ? item('no', `${num(s.enrichErrors)} Platte(n) konnten nicht ermittelt werden – <a href="#" data-goto="import">erneut versuchen</a>`) : '',
        s.reserved ? item('warn', `${num(s.reserved)} Platte(n) reserviert (laufende Zahlung)`) : '',
      ].join('');
    } catch (e) {
      $('kpis').innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
    }
  };

  // ---------- Platten erfassen: CSV hochladen → anlegen → Preise & Cover ermitteln (automatisch) ----------
  const FIELDS = [
    ['artist', 'Künstler *', ['artist', 'künstler', 'interpret', 'band']],
    ['title', 'Titel *', ['title', 'titel', 'album']],
    ['release_id', 'Release-ID', ['release_id', 'release id', 'releaseid']],
    ['label', 'Label', ['label']],
    ['catno', 'Katalognummer', ['catalog#', 'catno', 'catalog number', 'catalog', 'katalognummer', 'cat#']],
    ['format', 'Format', ['format']],
    ['released', 'Erscheinungsjahr', ['released', 'year', 'jahr', 'erschienen']],
    ['media_condition', 'Zustand Platte', ['collection media condition', 'media_condition', 'media condition', 'zustand platte']],
    ['sleeve_condition', 'Zustand Hülle', ['collection sleeve condition', 'sleeve_condition', 'sleeve condition', 'zustand hülle']],
    ['notes', 'Notiz (privat)', ['collection notes', 'notes', 'notiz']],
    ['description', 'Beschreibung (öffentlich)', ['comments', 'description', 'beschreibung']],
    ['date_added', 'Hinzugefügt am', ['date added', 'date_added', 'listed']],
    ['listing_id', 'Listing-ID', ['listing_id', 'listing id']],
    ['avg_price', 'Ø Marktpreis (falls vorhanden)', ['average price', 'avg price', 'average', 'avg', 'durchschnitt', 'median', 'mittelwert', 'price', 'preis', 'value', 'wert']],
    ['genre', 'Genre / Stil', ['genre', 'style', 'stil']],
    ['country', 'Land', ['country', 'land']],
    ['tracks', 'Tracks / Trackliste', ['tracklist', 'track list', 'tracks', 'titelliste']],
    ['cover_url', 'Cover-Bild-URL', ['image', 'cover', 'thumb']],
  ];
  let csv = { headers: [], rows: [], name: '' };
  let map = {};
  let importing = false;

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
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
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

  // Rabatt & Mindestpreis merken
  try {
    const saved = JSON.parse(localStorage.getItem('hr_enrich_v2') || '{}');
    if (saved.discount != null) $('discount').value = saved.discount;
    if (saved.minPrice != null) $('min-price').value = saved.minPrice;
  } catch { /* ignorieren */ }
  function settingsNow() {
    return {
      discount: Math.min(90, Math.max(0, Number($('discount').value) || 0)),
      minPrice: Math.max(0, Number(String($('min-price').value).replace(',', '.')) || 0),
    };
  }
  function saveSettings() {
    try { localStorage.setItem('hr_enrich_v2', JSON.stringify(settingsNow())); } catch { /* ignorieren */ }
  }
  ['discount', 'min-price'].forEach((id) => $(id).addEventListener('change', saveSettings));

  async function readFile(file) {
    if (!file) return;
    if (importing || en.running) { toast('Bitte warten, bis die aktuelle Liste fertig ist – oder erst anhalten.'); return; }
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // Excel-CSV
    const rows = parseCSV(text);
    if (rows.length < 2) { toast('Die Datei enthält keine Daten.'); return; }
    csv = { headers: rows[0].map((h) => h.trim()), rows: rows.slice(1), name: file.name };
    map = autoMap(csv.headers);
    $('file-info').innerHTML = `<strong>${esc(file.name)}</strong> · ${num(csv.rows.length)} Zeilen`;
    renderMapping();
    renderPreview();
    if (map.artist == null || map.title == null) {
      $('adv').open = true;
      $('map-msg').innerHTML = '<div class="notice err">In dieser Datei wurden „Künstler“ und „Titel“ nicht erkannt. Bitte hier zuordnen und dann auf „Mit dieser Zuordnung erfassen“ klicken.</div>';
      $('adv').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    $('map-msg').innerHTML = '';
    runAll();
  }
  $('file').addEventListener('change', (e) => { readFile(e.target.files[0]); e.target.value = ''; });
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
    const valid = buildRows().filter((r) => r.artist && r.title);
    const missing = map.artist == null || map.title == null;
    $('do-import').disabled = missing || !valid.length;
    $('preview').innerHTML = `<thead><tr><th>Künstler</th><th>Titel</th><th class="hide-m">Format</th><th class="hide-m">Release-ID</th></tr></thead>
      <tbody>${valid.slice(0, 5).map((r) => `<tr><td>${esc(r.artist)}</td><td>${esc(r.title)}</td><td class="hide-m">${esc(r.format)}</td><td class="hide-m">${esc(r.release_id)}</td></tr>`).join('')}</tbody>`;
  }
  $('do-import').addEventListener('click', () => {
    $('map-msg').innerHTML = '';
    $('adv').open = false;
    runAll();
  });

  function setStep(id, state) {
    $(id).classList.toggle('active', state === 'active');
    $(id).classList.toggle('done', state === 'done');
  }

  // Schritt 1: alle Platten anlegen (als Entwurf, in der Warteschlange) – danach direkt Schritt 2
  async function runAll() {
    const s = settingsNow();
    saveSettings();
    const rows = buildRows().filter((r) => r.artist && r.title);
    if (!rows.length) { toast('Keine Platten in der Datei gefunden.'); return; }
    importing = true;
    $('run-box').classList.remove('hidden');
    setStep('step-import', 'active');
    setStep('step-enrich', '');
    $('e-prog').style.background = '';
    $('e-status').textContent = 'wartet …';
    $('e-prog').style.width = '0%';
    const log = $('log');
    log.classList.add('hidden');
    log.textContent = '';
    $('run-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const batch = csv.name.replace(/\.csv$/i, '');
    const BATCH = 400;
    const tot = { inserted: 0, updated: 0, skipped: 0 };
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
          const r = await call('/api/admin?action=import', { body: { rows: chunk, discount: s.discount, minPrice: s.minPrice, batch, auto: true } });
          tot.inserted += r.inserted; tot.updated += r.updated; tot.skipped += r.skipped;
          ok = true;
        } catch (e) {
          log.classList.remove('hidden');
          log.textContent += `Fehler bei Zeile ${i + 1}–${i + chunk.length} (Versuch ${attempt}): ${e.message}\n`;
          if (e.status === 401) { importing = false; return; }
          await new Promise((res) => setTimeout(res, 1500 * attempt));
        }
      }
      const done = Math.min(rows.length, i + BATCH);
      $('import-text').textContent = `${num(done)} von ${num(rows.length)} angelegt …`;
      $('e-prog').style.width = `${(done / rows.length) * 100}%`;
    }
    importing = false;
    setStep('step-import', 'done');
    $('import-text').textContent = `${num(tot.inserted)} neu, ${num(tot.updated)} aktualisiert${tot.skipped ? `, ${num(tot.skipped)} übersprungen` : ''}`;
    startEnrich();
  }

  // Schritt 2: Warteschlange abarbeiten – Preise, Verkaufspreis, Cover, Trackliste, Genre, Land
  const en = { running: false, paused: false, startCount: null, done: 0, started: 0, rows: [], wake: null };

  function setBadge(n) {
    const b = $('enrich-badge');
    b.textContent = num(n);
    b.classList.toggle('hidden', !n);
  }

  let lastStats = null;
  function renderKpis() {
    const s = lastStats;
    if (!s) return;
    $('e-kpis').innerHTML = [
      ['Noch offen', num(s.enrichPending), s.enrichPending ? `ca. ${num(Math.max(1, Math.ceil(s.enrichPending / 20)))} Min.` : 'alles erledigt'],
      ['Ergänzt', num(en.done), 'in dieser Sitzung'],
      ['Fehlgeschlagen', num(s.enrichErrors), s.enrichErrors ? 'erneut versuchen möglich' : '–'],
      ['Kein Vinyl', num(s.enrichNoVinyl), s.enrichNoVinyl ? 'CDs usw. – nicht bepreist' : '–'],
      ['Im Shop', num(s.available), 'Platten online'],
    ].map(([k, v, sub]) => `<div class="kpi"><span>${k}</span><b>${v}</b><small>${sub}</small></div>`).join('');
  }
  async function enrichStats() {
    const s = await call('/api/admin?action=stats');
    lastStats = s;
    setBadge(s.enrichPending);
    renderKpis();
    $('e-retry').classList.toggle('hidden', !s.enrichErrors);
    $('e-nosugg').classList.toggle('hidden', !s.enrichNoSugg);
    $('e-nosugg').textContent = `${num(s.enrichNoSugg)} Platte(n) mit Ersatzpreis neu ermitteln`;
    const warn = [];
    if (!s.coverToken) warn.push('Kein Katalog-Token gesetzt (DISCOGS_TOKEN, siehe README) – ohne Token gibt es keine Preisvorschläge und nur ca. 8 Platten pro Minute.');
    if (!s.blob) warn.push('Bildspeicher nicht verbunden – Cover werden vom Katalog-Server angezeigt.');
    $('e-warn').textContent = warn.join(' ');
    if (s.enrichPending || s.enrichErrors || s.enrichNoSugg) $('run-box').classList.remove('hidden');
    return s;
  }

  // Beim Öffnen der Seite eine unterbrochene Erfassung automatisch fortsetzen
  loaders.import = async () => {
    const s = await enrichStats().catch(() => null);
    if (s?.enrichPending && !en.running && !importing && !en.paused) {
      setStep('step-import', 'done');
      if ($('import-text').textContent === '–') $('import-text').textContent = 'erledigt';
      startEnrich();
    }
  };

  function renderEnrichRows() {
    const fmt = (v) => (v == null ? '–' : eur(v));
    $('e-table').querySelector('tbody').innerHTML = en.rows.slice(0, 200).map((r) => `<tr>
      <td><div class="thumb"><img src="${esc(r.cover_url || '/assets/vinyl.svg')}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/assets/vinyl.svg'"></div></td>
      <td><strong>${esc(r.artist)}</strong> – ${esc(r.title)}<div class="small muted">#${r.id} · <span class="st ${r.error ? 'failed' : r.novinyl ? 'draft' : r.status || 'draft'}">${r.error ? 'Fehler' : r.novinyl ? 'Kein Vinyl' : ({ available: 'Im Shop', draft: 'Entwurf', sold: 'Verkauft', reserved: 'Reserviert' }[r.status] || r.status)}</span></div></td>
      <td class="hide-m">${esc(r.cond || '–')}</td><td class="num hide-m">${fmt(r.condPrice)}</td><td class="num hide-m">${fmt(r.lowest)}${r.forSale ? ` <span class="muted small">(${r.forSale}×)</span>` : ''}</td>
      <td class="num">${fmt(r.avg)}</td><td class="sale">${r.price != null ? eur(r.price) : '–'}</td>
      <td class="hide-m e-note">${esc((r.notes || []).join(' · '))}</td>
    </tr>`).join('');
  }

  async function startEnrich() {
    if (en.running) return;
    en.running = true;
    en.paused = false;
    en.started = Date.now();
    en.startCount = null;
    let sessionDone = 0;
    let finished = false;
    $('run-box').classList.remove('hidden');
    $('e-table-wrap').classList.remove('hidden');
    setStep('step-enrich', 'active');
    $('e-prog').style.background = '';
    $('e-start').textContent = 'Anhalten';
    $('e-start').classList.remove('hidden');
    $('e-status').textContent = 'startet …';
    enrichStats().catch(() => {});
    try { en.wake = await navigator.wakeLock?.request('screen'); } catch { /* nicht unterstützt */ }
    while (en.running) {
      const t0 = Date.now();
      const s = settingsNow();
      let r;
      try {
        r = await call('/api/admin?action=enrich', { body: { discount: s.discount, minPrice: s.minPrice } });
      } catch (e) {
        if (e.status === 401) break;
        $('e-status').textContent = `Fehler: ${e.message} – neuer Versuch in 20 Sekunden`;
        await new Promise((res) => setTimeout(res, 20000));
        continue;
      }
      if (r.done) { finished = true; break; }
      if (en.startCount == null) en.startCount = r.remaining + (r.record ? 1 : 0);
      setBadge(r.remaining);
      if (r.record) {
        en.rows.unshift(r.record);
        en.done++;
        sessionDone++;
        renderEnrichRows();
        if (lastStats) {
          lastStats.enrichPending = r.remaining;
          if (r.record.error) lastStats.enrichErrors++;
          renderKpis();
        }
        if (en.done % 10 === 0) enrichStats().catch(() => {});
      }
      const total = en.startCount || 1;
      $('e-prog').style.width = `${Math.min(100, ((total - r.remaining) / total) * 100)}%`;
      const perItem = (Date.now() - en.started) / Math.max(1, sessionDone);
      $('e-status').textContent = r.wait
        ? 'Katalog bremst – kurze Pause …'
        : `${num(en.done)} ergänzt · noch ${num(r.remaining)} · ca. ${num(Math.max(1, Math.round((r.remaining * perItem) / 60000)))} Min.`;
      if (!r.remaining) { finished = true; break; }
      // Tempo an das Abfrage-Limit des Katalogs anpassen (60 pro Minute, 3 pro Platte)
      const pause = r.wait ? r.wait * 1000 : r.rate != null && r.rate < 6 ? 15000 : Math.max(0, 3100 - (Date.now() - t0));
      await new Promise((res) => setTimeout(res, pause));
    }
    en.running = false;
    try { await en.wake?.release(); } catch { /* ignorieren */ }
    if (finished) {
      setStep('step-enrich', 'done');
      $('e-prog').style.width = '100%';
      $('e-prog').style.background = 'var(--ok)';
      $('e-status').textContent = `Fertig – ${num(en.done)} Platten ergänzt.`;
      $('e-start').classList.add('hidden');
      toast('Erfassung abgeschlossen');
    } else {
      $('e-start').textContent = 'Fortsetzen';
      $('e-status').textContent = 'Angehalten – mit „Fortsetzen“ geht es weiter.';
    }
    enrichStats().catch(() => {});
  }
  $('e-start').addEventListener('click', () => {
    if (en.running) { en.running = false; en.paused = true; $('e-start').textContent = 'Wird angehalten …'; } else startEnrich();
  });
  $('e-retry').addEventListener('click', async () => {
    const r = await call('/api/admin?action=enrich-retry', { body: {} });
    toast(`${num(r.changed)} Platte(n) werden erneut ermittelt`);
    startEnrich();
  });
  $('e-nosugg').addEventListener('click', async () => {
    const r = await call('/api/admin?action=enrich-nosugg', { body: {} });
    toast(`${num(r.changed)} Platte(n) werden mit Preisvorschlägen neu ermittelt`);
    startEnrich();
  });
  window.addEventListener('beforeunload', (e) => { if (en.running || importing) { e.preventDefault(); e.returnValue = ''; } });

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
      const labels = { sold: 'als verkauft markiert', available: 'wieder verfügbar', draft: 'versteckt', delete: 'gelöscht', enrich: 'werden neu ermittelt' };
      toast(`${r.changed} Platte(n) ${labels[op] || 'geändert'}${op === 'available' && r.changed < ids.length ? ' (ohne Preis bleiben versteckt)' : ''}`);
      loadRecords();
      if (op === 'enrich' && r.changed) startEnrich();
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
