import { db } from './db.js';

// Zugriff auf die Katalog-API (Token: DISCOGS_TOKEN). Dieser Code läuft nur auf dem Server.
const UA = 'HomerunRecords/1.0';
const API = 'https://api.discogs.com';
const PRICE_MAX_AGE = 30 * 864e5;
export let rateRemaining = null;

export async function dget(p) {
  const token = process.env.DISCOGS_TOKEN;
  const r = await fetch(`${API}${p}`, {
    headers: { 'User-Agent': UA, ...(token ? { Authorization: `Discogs token=${token}` } : {}) },
  });
  const rem = Number(r.headers.get('x-discogs-ratelimit-remaining'));
  if (Number.isFinite(rem)) rateRemaining = rem;
  if (r.status === 429) {
    const e = new Error('Abfrage-Limit erreicht');
    e.rateLimit = true;
    throw e;
  }
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// Wechselkurse der EZB (für Preisvorschläge in Fremdwährung)
let rates = null;
let ratesAt = 0;
async function eurRates() {
  if (rates && Date.now() - ratesAt < 12 * 3600e3) return rates;
  const next = { EUR: 1 };
  try {
    const t = await (await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml')).text();
    for (const m of t.matchAll(/currency=['"](\w{3})['"]\s+rate=['"]([\d.]+)['"]/g)) next[m[1]] = Number(m[2]);
  } catch { /* nur EUR */ }
  rates = next;
  ratesAt = Date.now();
  return rates;
}
const toEUR = (p, R) => (p && p.value != null && R[p.currency || 'EUR'] ? p.value / R[p.currency || 'EUR'] : null);
const round2 = (n) => Math.round(n * 100) / 100;

function releaseInfo(rel) {
  const imgs = rel.images || [];
  const img = imgs.find((i) => i.type === 'primary') || imgs[0];
  return {
    image: img?.uri || '',
    thumb: img?.uri150 || img?.uri || '',
    genre: [...(rel.genres || []), ...(rel.styles || [])].join(', ') || null,
    country: rel.country || null,
    year: rel.year ? String(rel.year) : null,
    tracks: (rel.tracklist || [])
      .filter((t) => t.type_ !== 'heading' && t.title)
      .map((t) => `${t.position ? `${t.position}\t` : ''}${t.title}`)
      .join('\n'),
  };
}

// Releasedaten + Preise, zwischengespeichert in release_cache (Preise 30 Tage)
export async function lookupRelease(id, { prices = true } = {}) {
  const sql = db();
  const row = (await sql.query('SELECT data, fetched_at FROM release_cache WHERE release_id = $1', [id]))[0];
  const data = row?.data || {};
  let changed = false;
  if (!data.info) {
    const r = await dget(`/releases/${id}`);
    if (r.status === 404) return { notFound: true };
    if (!r.ok) throw new Error(r.data.message || `Katalog-Fehler ${r.status}`);
    data.info = releaseInfo(r.data);
    changed = true;
  }
  // Preise neu holen, wenn alt – oder wenn beim letzten Mal die Preisvorschläge fehlten
  if (prices && (!data.prices || data.prices.suggError || Date.now() - (data.prices.at || 0) > PRICE_MAX_AGE)) {
    const R = await eurRates();
    const st = await dget(`/marketplace/stats/${id}?curr_abbr=EUR`);
    const sg = await dget(`/marketplace/price_suggestions/${id}`);
    const s = sg.ok ? sg.data : {};
    data.prices = {
      at: Date.now(),
      low: toEUR(s['Very Good (VG)'], R),
      mid: toEUR(s['Very Good Plus (VG+)'], R),
      high: toEUR(s['Near Mint (NM or M-)'], R),
      lowest: st.ok ? toEUR(st.data.lowest_price, R) : null,
      forSale: st.ok ? st.data.num_for_sale ?? null : null,
      suggError: sg.ok ? '' : (sg.data.message || `HTTP ${sg.status}`),
    };
    changed = true;
  }
  if (changed) await saveCache(id, data);
  return { data };
}

async function saveCache(id, data) {
  await db().query(
    `INSERT INTO release_cache (release_id, data, fetched_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (release_id) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`,
    [id, JSON.stringify(data)],
  );
}

// Cover herunterladen, auf 500 px verkleinern und im eigenen Bildspeicher (Vercel Blob) ablegen.
// Ohne Bildspeicher wird die Bildadresse des Katalogs verwendet.
async function storeCover(id, data) {
  if (data.coverUrl) return data.coverUrl;
  const src = data.info?.image;
  if (!src) return '';
  if (!process.env.BLOB_READ_WRITE_TOKEN) return src;
  const r = await fetch(src, { headers: { 'User-Agent': UA } });
  if (!r.ok) return '';
  let buf = Buffer.from(await r.arrayBuffer());
  let type = r.headers.get('content-type') || 'image/jpeg';
  try {
    const sharp = (await import('sharp')).default;
    buf = await sharp(buf).resize(500, 500, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    type = 'image/jpeg';
  } catch { /* Original verwenden */ }
  const { put } = await import('@vercel/blob');
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const blob = await put(`cover/${id}.${ext}`, buf, { access: 'public', contentType: type, addRandomSuffix: true });
  data.coverUrl = blob.url;
  await saveCache(id, data);
  return blob.url;
}

async function searchRelease(rec) {
  const qs = new URLSearchParams({ type: 'release', artist: rec.artist, release_title: rec.title });
  if (rec.catno) qs.set('catno', String(rec.catno).split(',')[0].trim());
  let r = await dget(`/database/search?${qs}`);
  if (!(r.data.results || []).length && rec.catno) { qs.delete('catno'); r = await dget(`/database/search?${qs}`); }
  return r.data.results?.[0]?.id || null;
}

// Eine Platte aus der Warteschlange vollständig ergänzen: Preise, Verkaufspreis, Cover, Tracks, Genre, Land
export async function enrichRecord(rec, { discount = 10, minPrice = 0 } = {}) {
  const sql = db();
  const notes = [];
  let rid = rec.release_id;
  if (!rid) {
    rid = await searchRelease(rec);
    if (rid) notes.push(`Per Suche zugeordnet (ID ${rid}) – bitte prüfen`);
  }
  if (!rid) {
    await sql.query(`UPDATE records SET enrich_status = 'error', enrich_note = $2 WHERE id = $1`, [rec.id, 'Im Katalog nicht gefunden']);
    return { notes: ['Im Katalog nicht gefunden'], error: true };
  }
  const { data, notFound } = await lookupRelease(rid);
  if (notFound) {
    await sql.query(`UPDATE records SET enrich_status = 'error', enrich_note = $2 WHERE id = $1`, [rec.id, 'Release-ID unbekannt']);
    return { notes: ['Release-ID unbekannt'], error: true };
  }
  const p = data.prices;
  if (p.suggError) {
    notes.push(/seller settings/i.test(p.suggError)
      ? 'Preisvorschläge fehlen: Verkäufer-Einstellungen im Katalog-Konto ausfüllen'
      : 'Keine Preisvorschläge (Token prüfen)');
  }
  let vals = [p.low, p.mid, p.high].filter((v) => v != null);
  if (!vals.length && p.lowest != null) { vals = [p.lowest]; notes.push('Nur günstigstes Angebot – Preis prüfen'); }
  let avg = null;
  let sale = null;
  if (vals.length) {
    avg = round2(vals.reduce((a, b) => a + b, 0) / vals.length);
    sale = round2(avg * (100 - discount) / 100);
    if (sale < minPrice) { sale = minPrice; notes.push(`Mindestpreis ${minPrice.toFixed(2)} €`); }
  } else notes.push('Kein Preis ermittelbar – bleibt Entwurf');

  let cover = '';
  try { cover = await storeCover(rid, data); } catch (e) { notes.push(`Cover: ${e.message}`); }
  const info = data.info;
  const r2 = (v) => (v == null ? null : round2(v));
  const rows = await sql.query(
    `UPDATE records SET
       release_id = coalesce(release_id, $2),
       price_low = $3, price_mid = $4, price_high = $5, lowest_offer = $6,
       avg_price = coalesce($7, avg_price),
       price = CASE WHEN price_locked OR status IN ('sold', 'reserved') THEN price ELSE coalesce($8, price) END,
       status = CASE WHEN status = 'draft' AND coalesce($8, price) IS NOT NULL THEN 'available' ELSE status END,
       genre = coalesce(genre, $9), country = coalesce(country, $10),
       tracks = coalesce(nullif(tracks, ''), $11), released = coalesce(nullif(released, ''), $12),
       cover_url = CASE WHEN $13 = '' THEN coalesce(cover_url, '') ELSE $13 END,
       thumb_url = CASE WHEN $13 = '' THEN coalesce(thumb_url, '') ELSE $13 END,
       enrich_status = 'done', enrich_note = $14, updated_at = now()
     WHERE id = $1
     RETURNING price, status, cover_url`,
    [rec.id, rid, r2(p.low), r2(p.mid), r2(p.high), r2(p.lowest), avg, sale,
      info.genre, info.country, info.tracks || '', info.year, cover, notes.join(' · ') || null],
  );
  return { low: p.low, mid: p.mid, high: p.high, lowest: p.lowest, avg, sale, notes, ...rows[0] };
}

// Nur Cover/Tracks/Genre/Land nachladen (für Platten ohne Preis-Ermittlung)
export async function fetchCover(rec) {
  if (!rec.release_id) return { status: 'skip' };
  try {
    const { data, notFound } = await lookupRelease(rec.release_id, { prices: false });
    if (notFound) {
      await db().query(`UPDATE records SET cover_url = coalesce(cover_url, ''), thumb_url = coalesce(thumb_url, ''), tracks = coalesce(tracks, '') WHERE id = $1`, [rec.id]);
      return { status: 'ok', cover: '', thumb: '' };
    }
    const cover = await storeCover(rec.release_id, data).catch(() => data.info.image);
    const info = data.info;
    await db().query(
      `UPDATE records SET cover_url = $2, thumb_url = $2, genre = coalesce(genre, $3), tracks = coalesce(nullif(tracks, ''), $4),
         country = coalesce(country, $5), released = coalesce(nullif(released, ''), $6) WHERE id = $1`,
      [rec.id, cover || '', info.genre, info.tracks || '', info.country, info.year],
    );
    return { status: 'ok', cover, thumb: cover };
  } catch (e) {
    return { status: e.rateLimit ? 'ratelimit' : 'error' };
  }
}
