// Homerun Records – Preis-Tool
// Liest eine Discogs-CSV, holt Preise, Cover, Tracklisten über die offizielle Discogs-API,
// berechnet den Verkaufspreis (Ø minus Rabatt) und lädt auf Wunsch alles in den Shop.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = 4410;
const UA = 'HomerunRecordsPreisTool/1.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_ROOT = path.join(ROOT, 'Ergebnisse');
const COVER_DIR = path.join(OUT_ROOT, 'cover');
// Einstellungen und Zwischenspeicher liegen außerhalb des Projekts (damit der Token nie hochgeladen wird)
const DATA_DIR = path.join(process.env.APPDATA || os.homedir(), 'HomerunPreisTool');
const SETTINGS_FILE = path.join(DATA_DIR, 'einstellungen.json');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const PRICE_MAX_AGE = 30 * 864e5; // Preise nach 30 Tagen neu abfragen
for (const d of [DATA_DIR, OUT_ROOT, COVER_DIR]) fs.mkdirSync(d, { recursive: true });

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
let settings = { token: '', discount: 10, minPrice: 0, site: '', covers: true, ...readJson(SETTINGS_FILE, {}) };
const cache = readJson(CACHE_FILE, {});
let cacheTimer;
const saveCache = () => { clearTimeout(cacheTimer); cacheTimer = setTimeout(() => fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)), 500); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (n) => Math.round(n * 100) / 100;

// ---------------- CSV ----------------
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length);
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
  const d = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], f = '';
  q = false;
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
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCSV = (rows) => `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

// ---------------- Discogs-API ----------------
let lastCall = 0;
let waitNote = '';
async function discogs(p) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const gap = 1100 - (Date.now() - lastCall); // max. ~55 Abfragen pro Minute
    if (gap > 0) await sleep(gap);
    lastCall = Date.now();
    let r;
    try {
      r = await fetch(`https://api.discogs.com${p}`, {
        headers: { 'User-Agent': UA, ...(settings.token ? { Authorization: `Discogs token=${settings.token}` } : {}) },
      });
    } catch {
      waitNote = 'Keine Internetverbindung – neuer Versuch in 20 Sekunden';
      await sleep(20000);
      continue;
    }
    const remaining = Number(r.headers.get('x-discogs-ratelimit-remaining'));
    if (r.status === 429) { waitNote = 'Discogs-Limit erreicht – warte 60 Sekunden'; await sleep(60000); continue; }
    waitNote = '';
    if (remaining === 0) await sleep(20000);
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) return { notFound: true };
    if (!r.ok) return { error: j.message || `HTTP ${r.status}`, status: r.status };
    return j;
  }
  return { error: 'Discogs antwortet nicht' };
}

let rates = { EUR: 1 };
async function loadRates() {
  try {
    const t = await (await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml')).text();
    for (const m of t.matchAll(/currency=['"](\w{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]] = Number(m[2]);
  } catch { /* nur EUR */ }
}
const toEUR = (p) => (p && p.value != null && rates[p.currency || 'EUR'] ? p.value / rates[p.currency || 'EUR'] : null);

// Releasedaten (Cover, Tracks, Genre, Land) + Preise für eine Release-ID
async function lookup(id) {
  const c = cache[id] || (cache[id] = {});
  const notes = [];
  if (!c.release || !Array.isArray(c.release.formats)) {
    const rel = await discogs(`/releases/${id}`);
    if (rel.notFound) return { error: 'Release-ID bei Discogs nicht gefunden' };
    if (rel.error) return { error: rel.error };
    const imgs = rel.images || [];
    const img = imgs.find((i) => i.type === 'primary') || imgs[0];
    c.release = {
      image: img?.uri || '',
      genre: [...(rel.genres || []), ...(rel.styles || [])].join(', '),
      country: rel.country || '',
      formats: (rel.formats || []).map((f) => f.name),
      vinyl: (rel.formats || []).some((f) => /^(vinyl|flexi-disc|lathe cut|acetate)$/i.test(f.name)),
      year: rel.year ? String(rel.year) : '',
      tracks: (rel.tracklist || []).filter((t) => t.type_ !== 'heading' && t.title).map((t) => `${t.position ? `${t.position} ` : ''}${t.title}`).join('; '),
    };
  }
  if (!c.release.vinyl) { saveCache(); return { c, notes, noVinyl: true }; }
  if (!c.prices || c.prices.suggError || Date.now() - c.prices.at > PRICE_MAX_AGE) {
    const stats = await discogs(`/marketplace/stats/${id}?curr_abbr=EUR`);
    const sugg = await discogs(`/marketplace/price_suggestions/${id}`);
    const pick = (k) => (sugg && !sugg.error ? toEUR(sugg[k]) : null);
    c.prices = {
      at: Date.now(),
      low: pick('Very Good (VG)'),
      mid: pick('Very Good Plus (VG+)'),
      high: pick('Near Mint (NM or M-)'),
      lowest: stats.error ? null : toEUR(stats.lowest_price),
      forSale: stats.error ? null : stats.num_for_sale ?? null,
      suggError: sugg.error || '',
    };
  }
  if (c.prices.suggError) notes.push(/seller settings/i.test(c.prices.suggError)
    ? 'Preisvorschläge fehlen: auf discogs.com die Verkäufer-Einstellungen ausfüllen'
    : `Preisvorschläge: ${c.prices.suggError}`);
  saveCache();
  return { c, notes };
}

async function downloadCover(id, c) {
  if (!c.release?.image) return '';
  const existing = c.coverFile && fs.existsSync(path.join(COVER_DIR, c.coverFile));
  if (existing) return c.coverFile;
  try {
    const r = await fetch(c.release.image, { headers: { 'User-Agent': UA } });
    if (!r.ok) return '';
    const type = r.headers.get('content-type') || 'image/jpeg';
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const file = `${id}.${ext}`;
    fs.writeFileSync(path.join(COVER_DIR, file), Buffer.from(await r.arrayBuffer()));
    c.coverFile = file;
    saveCache();
    return file;
  } catch { return ''; }
}

async function searchRelease(row) {
  const qs = new URLSearchParams({ type: 'release', format: 'Vinyl', artist: row.artist, release_title: row.title });
  if (row.catno) qs.set('catno', row.catno.split(',')[0].trim());
  let r = await discogs(`/database/search?${qs}`);
  if ((!r.results || !r.results.length) && row.catno) { qs.delete('catno'); r = await discogs(`/database/search?${qs}`); }
  return r.results?.[0]?.id ? String(r.results[0].id) : '';
}

// ---------------- Auftrag ----------------
const EXTRA = ['Preis_Niedrig_VG', 'Preis_Mittel_VG+', 'Preis_Hoch_NM', 'Preis_Durchschnitt', 'Verkaufspreis',
  'Guenstigstes_Angebot', 'Angebote_Anzahl', 'Genre', 'Land', 'Tracks', 'Bilddatei', 'Cover_URL', 'Hinweis'];
let job = null;
let shopJob = null;

function colIndex(headers, ...names) {
  const low = headers.map((h) => h.trim().toLowerCase());
  for (const n of names) { const i = low.indexOf(n); if (i >= 0) return i; }
  return -1;
}

function startJob(name, text, covers) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('Die CSV-Datei enthält keine Daten.');
  const headers = rows[0].map((h) => h.trim());
  const ix = {
    id: colIndex(headers, 'release_id', 'release id'),
    artist: colIndex(headers, 'artist', 'künstler'),
    title: colIndex(headers, 'title', 'titel'),
    catno: colIndex(headers, 'catalog#', 'catno'),
  };
  if (ix.artist < 0 || ix.title < 0) throw new Error('Spalten „Artist“ und „Title“ fehlen – ist das ein Discogs-Export?');
  const base = name.replace(/\.csv$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'liste';
  job = {
    name, base, headers, ix, covers,
    data: rows.slice(1).map((r) => headers.map((_, i) => r[i] ?? '')),
    results: [], i: 0, state: 'running', error: '', started: Date.now(),
    outFile: path.join(OUT_ROOT, `${base}-mit-preisen.csv`),
  };
  run(job);
}

function writeOutput(j) {
  const out = [[...j.headers, ...EXTRA]];
  j.data.forEach((row, i) => {
    const r = j.results[i];
    if (!r) return out.push([...row, ...EXTRA.map(() => '')]);
    const f = (n) => (n == null ? '' : n.toFixed(2));
    out.push([...row, f(r.low), f(r.mid), f(r.high), f(r.avg), f(r.sale), f(r.lowest), r.forSale ?? '',
      r.genre, r.country, r.tracks, r.coverFile, r.coverUrl || '', r.notes.join(' | ')]);
  });
  fs.writeFileSync(j.outFile, toCSV(out));
}

async function run(j) {
  await loadRates();
  const discount = Number(settings.discount) || 0;
  const minPrice = Number(settings.minPrice) || 0;
  while (j.i < j.data.length && j.state === 'running') {
    const row = j.data[j.i];
    const get = (k) => (j.ix[k] >= 0 ? String(row[j.ix[k]] || '').trim() : '');
    const res = { artist: get('artist'), title: get('title'), notes: [] };
    try {
      let id = get('id').replace(/\D/g, '');
      if (!id) {
        id = await searchRelease({ artist: res.artist, title: res.title, catno: get('catno') });
        if (id) {
          res.notes.push(`Release per Suche gefunden (ID ${id}) – bitte prüfen`);
          if (j.ix.id >= 0) row[j.ix.id] = id;
        }
      }
      res.id = id;
      if (!id) res.notes.push('Nicht bei Discogs gefunden');
      else {
        const { c, notes, error, noVinyl } = await lookup(id);
        if (error) res.notes.push(error);
        else if (noVinyl) res.notes.push(`Kein Vinyl (${c.release.formats.join(', ') || 'anderes Format'}) – nicht bepreist`);
        else {
          res.notes.push(...notes);
          const p = c.prices;
          Object.assign(res, { low: p.low, mid: p.mid, high: p.high, lowest: p.lowest, forSale: p.forSale,
            genre: c.release.genre, country: c.release.country, tracks: c.release.tracks });
          let vals = [p.low, p.mid, p.high].filter((v) => v != null);
          if (!vals.length && p.lowest != null) { vals = [p.lowest]; res.notes.push('Nur günstigstes Angebot verfügbar – Preis prüfen'); }
          if (vals.length) {
            res.avg = round2(vals.reduce((a, b) => a + b, 0) / vals.length);
            res.sale = round2(res.avg * (100 - discount) / 100);
            if (res.sale < minPrice) { res.sale = minPrice; res.notes.push(`Mindestpreis ${minPrice.toFixed(2)} € angewendet`); }
          } else res.notes.push('Kein Preis ermittelbar – im Shop als Entwurf');
          if (j.covers) res.coverFile = await downloadCover(id, c);
          res.coverUrl = c.coverUrls?.[settings.site] || '';
        }
      }
    } catch (e) {
      res.notes.push(`Fehler: ${e.message}`);
    }
    j.results[j.i] = res;
    j.i++;
    if (j.i % 10 === 0) writeOutput(j);
  }
  writeOutput(j);
  if (j.state === 'running') j.state = 'done';
}

// ---------------- In den Shop übertragen ----------------
async function shopFetch(site, action, body, cookie) {
  const r = await fetch(`${site}/api/admin?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Website antwortet mit Fehler ${r.status}`);
  return { j, setCookie: r.headers.get('set-cookie') || '' };
}

let sharp = null;
try { sharp = (await import('sharp')).default; } catch { /* ohne Verkleinerung */ }

async function shopImport(password) {
  const j = job;
  const site = String(settings.site || '').replace(/\/+$/, '');
  shopJob = { state: 'running', step: 'Anmelden …', done: 0, total: 0, error: '', result: null };
  try {
    if (!/^https?:\/\//.test(site)) throw new Error('Bitte zuerst die Adresse deiner Website eintragen.');
    const login = await shopFetch(site, 'login', { password });
    const cookie = (login.setCookie.match(/hr_admin=[^;]+/) || [])[0];
    if (!cookie) throw new Error('Anmeldung fehlgeschlagen.');

    // 1. Cover hochladen (jedes Release nur einmal)
    const ids = [...new Set(j.results.filter((r) => r?.coverFile && r.id).map((r) => r.id))]
      .filter((id) => !cache[id]?.coverUrls?.[site]);
    shopJob.total = ids.length;
    shopJob.step = 'Cover hochladen';
    let coverError = '';
    for (const id of ids) {
      const c = cache[id];
      try {
        let buf = fs.readFileSync(path.join(COVER_DIR, c.coverFile));
        let type = c.coverFile.endsWith('.png') ? 'image/png' : c.coverFile.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        if (sharp) { buf = await sharp(buf).resize(500, 500, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(); type = 'image/jpeg'; }
        const { j: up } = await shopFetch(site, 'upload-cover', { release_id: id, type, data: buf.toString('base64') }, cookie);
        (c.coverUrls ||= {})[site] = up.url;
        saveCache();
      } catch (e) {
        coverError = e.message;
        if (/Bildspeicher/.test(e.message)) break;
      }
      shopJob.done++;
    }

    // 2. Platten importieren (gleiche Schlüssel wie der CSV-Import im Admin-Bereich)
    const H = j.headers.map((h) => h.trim().toLowerCase());
    const col = (row, ...names) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return String(row[i] ?? '').trim(); } return ''; };
    const counts = new Map();
    const rows = j.data.map((row, i) => {
      const r = j.results[i] || { notes: [] };
      const out = {
        artist: col(row, 'artist'), title: col(row, 'title'), label: col(row, 'label'), catno: col(row, 'catalog#', 'catno'),
        format: col(row, 'format'), released: col(row, 'released'), release_id: col(row, 'release_id') || r.id || '',
        listing_id: col(row, 'listing_id'), media_condition: col(row, 'collection media condition', 'media_condition'),
        sleeve_condition: col(row, 'collection sleeve condition', 'sleeve_condition'), notes: col(row, 'collection notes', 'notes'),
        description: col(row, 'comments'), date_added: col(row, 'date added', 'listed'),
        avg_price: r.avg ?? null, genre: r.genre || '', country: r.country || '', tracks: r.tracks || '',
        cover_url: (r.id && cache[r.id]?.coverUrls?.[site]) || '',
      };
      const ident = out.listing_id || [out.release_id, out.date_added, out.media_condition, out.sleeve_condition, out.notes, out.artist, out.title, out.catno].join('|');
      const n = counts.get(ident) || 0;
      counts.set(ident, n + 1);
      out.dup = n;
      return out;
    }).filter((r) => r.artist && r.title);

    shopJob.step = 'Platten importieren';
    shopJob.done = 0;
    shopJob.total = rows.length;
    const tot = { inserted: 0, updated: 0, skipped: 0 };
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400);
      const { j: r } = await shopFetch(site, 'import', { rows: chunk, discount: Number(settings.discount) || 0, minPrice: Number(settings.minPrice) || 0, batch: j.base }, cookie);
      tot.inserted += r.inserted; tot.updated += r.updated; tot.skipped += r.skipped;
      shopJob.done += chunk.length;
    }
    j.results.forEach((r) => { if (r?.id) r.coverUrl = cache[r.id]?.coverUrls?.[site] || ''; });
    writeOutput(j);
    shopJob.result = { ...tot, coverError };
    shopJob.state = 'done';
  } catch (e) {
    shopJob.state = 'error';
    shopJob.error = e.message;
  }
}

// ---------------- Lokaler Webserver ----------------
function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

function publicState() {
  return {
    settings: { hasToken: Boolean(settings.token), discount: settings.discount, minPrice: settings.minPrice, site: settings.site, covers: settings.covers },
    sharp: Boolean(sharp),
    waitNote,
    job: job && {
      name: job.name, state: job.state, i: job.i, total: job.data.length, error: job.error,
      started: job.started, outFile: job.outFile,
      results: job.results.slice(-300).map((r, k) => ({ n: job.results.length - Math.min(300, job.results.length) + k + 1, ...r })),
      priced: job.results.filter((r) => r?.sale != null).length,
      withCover: job.results.filter((r) => r?.coverFile).length,
    },
    shopJob,
  };
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/') return send(res, 200, fs.readFileSync(path.join(HERE, 'oberflaeche.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && u.pathname === '/api/state') return send(res, 200, publicState());
    if (req.method === 'GET' && u.pathname.startsWith('/cover/')) {
      const f = path.join(COVER_DIR, path.basename(decodeURIComponent(u.pathname.slice(7))));
      if (!fs.existsSync(f)) return send(res, 404, { error: 'nicht gefunden' });
      return send(res, 200, fs.readFileSync(f), f.endsWith('.png') ? 'image/png' : 'image/jpeg');
    }
    if (req.method === 'GET' && u.pathname === '/api/download') {
      if (!job || !fs.existsSync(job.outFile)) return send(res, 404, { error: 'Noch kein Ergebnis' });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${path.basename(job.outFile)}"` });
      return res.end(fs.readFileSync(job.outFile));
    }
    if (req.method !== 'POST' || !String(req.headers['content-type']).includes('application/json')) return send(res, 404, { error: 'Unbekannt' });
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};

    if (u.pathname === '/api/settings') {
      if (typeof body.token === 'string' && body.token.trim()) settings.token = body.token.trim();
      if (body.clearToken) settings.token = '';
      if (body.discount != null) settings.discount = Math.min(90, Math.max(0, Number(body.discount) || 0));
      if (body.minPrice != null) settings.minPrice = Math.max(0, Number(String(body.minPrice).replace(',', '.')) || 0);
      if (typeof body.site === 'string') settings.site = body.site.trim().replace(/\/+$/, '');
      if (typeof body.covers === 'boolean') settings.covers = body.covers;
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      if (body.test && settings.token) {
        const me = await discogs('/oauth/identity');
        return send(res, me.error ? 400 : 200, me.error ? { error: 'Token ungültig' } : { user: me.username });
      }
      return send(res, 200, publicState());
    }
    if (u.pathname === '/api/start') {
      if (job?.state === 'running') return send(res, 409, { error: 'Es läuft bereits eine Liste.' });
      if (!settings.token) return send(res, 400, { error: 'Bitte zuerst den Discogs-Token eintragen.' });
      startJob(String(body.name || 'liste.csv'), String(body.csv || ''), settings.covers);
      return send(res, 200, publicState());
    }
    if (u.pathname === '/api/stop') { if (job?.state === 'running') job.state = 'stopped'; return send(res, 200, publicState()); }
    if (u.pathname === '/api/resume') {
      if (job && job.state === 'stopped') { job.state = 'running'; run(job); }
      return send(res, 200, publicState());
    }
    if (u.pathname === '/api/open') { exec(`explorer "${OUT_ROOT}"`); return send(res, 200, { ok: true }); }
    if (u.pathname === '/api/shop') {
      if (!job || job.state === 'running') return send(res, 400, { error: 'Bitte warten, bis die Liste fertig ist.' });
      if (shopJob?.state === 'running') return send(res, 409, { error: 'Übertragung läuft bereits.' });
      shopImport(String(body.password || ''));
      return send(res, 200, publicState());
    }
    send(res, 404, { error: 'Unbekannt' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Homerun Records Preis-Tool laeuft:  http://localhost:' + PORT);
  console.log('  Ergebnisse:  ' + OUT_ROOT);
  console.log('  Zum Beenden dieses Fenster schliessen.');
});
