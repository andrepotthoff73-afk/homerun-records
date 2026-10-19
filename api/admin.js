// Passwortgeschützte Admin-API: Login, CSV-Import, Platten verwalten, Bestellungen
import crypto from 'node:crypto';
import { db, ensureSchema } from './_lib/db.js';
import { send, intIds, isJson, likeEsc, blobConfigured } from './_lib/util.js';
import { isAdmin, checkPassword, passwordConfigured, setSession, clearSession } from './_lib/auth.js';
import { fetchCover, enrichRecord, rateRemaining } from './_lib/katalog.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const action = req.query.action;
  if (req.method === 'POST' && !isJson(req)) return send(res, 415, { error: 'JSON erwartet' });
  try {
    if (action === 'login') return await login(req, res);
    if (action === 'logout') { clearSession(res); return send(res, 200, { ok: true }); }
    if (action === 'me') return send(res, 200, { admin: isAdmin(req), configured: passwordConfigured() });
    if (!isAdmin(req)) return send(res, 401, { error: 'Bitte zuerst anmelden.' });

    await ensureSchema();
    const post = req.method === 'POST';
    if (action === 'stats') return await stats(res);
    if (action === 'records') return await records(req, res);
    if (action === 'orders') return await orders(res);
    if (action === 'locations') return await locations(res);
    if (post && action === 'import') return await importRows(req, res);
    if (post && action === 'update') return await update(req, res);
    if (post && action === 'reprice') return await reprice(req, res);
    if (post && action === 'cover') return await coverStep(res);
    if (post && action === 'enrich') return await enrichStep(req, res);
    if (post && action === 'enrich-retry') return await enrichRetry(res);
    if (post && action === 'enrich-nosugg') return await enrichNoSuggestions(res);
    if (post && action === 'upload-cover') return await uploadCover(req, res);
    send(res, 404, { error: 'Unbekannte Aktion' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}

async function login(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST erwartet' });
  if (!passwordConfigured()) {
    return send(res, 503, { error: 'ADMIN_PASSWORD ist in Vercel nicht gesetzt (mind. 10 Zeichen).' });
  }
  if (!checkPassword(req.body?.password)) {
    await sleep(900);
    return send(res, 401, { error: 'Falsches Passwort.' });
  }
  setSession(res);
  send(res, 200, { ok: true });
}

async function stats(res) {
  const sql = db();
  const [byStatus, ord, covers, enrich] = await Promise.all([
    sql.query(`SELECT status, count(*)::int AS n, coalesce(sum(price), 0)::float AS value FROM records GROUP BY status`),
    sql.query(`SELECT count(*)::int AS n, coalesce(sum(total), 0)::float AS revenue FROM orders WHERE status = 'completed'`),
    sql.query(`SELECT count(*)::int AS n FROM records WHERE (cover_url IS NULL OR tracks IS NULL) AND release_id IS NOT NULL`),
    sql.query(`SELECT count(*) FILTER (WHERE enrich_status = 'pending')::int AS pending, count(*) FILTER (WHERE enrich_status = 'error')::int AS errors,
      count(*) FILTER (WHERE enrich_status = 'novinyl')::int AS novinyl,
      count(*) FILTER (WHERE enrich_status = 'done' AND enrich_note ILIKE '%Preisvorschläge%' AND status NOT IN ('sold', 'reserved'))::int AS nosugg FROM records`),
  ]);
  const s = Object.fromEntries(byStatus.map((r) => [r.status, r]));
  send(res, 200, {
    available: s.available?.n || 0,
    availableValue: s.available?.value || 0,
    draft: s.draft?.n || 0,
    reserved: s.reserved?.n || 0,
    sold: s.sold?.n || 0,
    soldValue: s.sold?.value || 0,
    orders: ord[0].n,
    revenue: ord[0].revenue,
    missingCovers: covers[0].n,
    enrichPending: enrich[0].pending,
    enrichErrors: enrich[0].errors,
    enrichNoVinyl: enrich[0].novinyl,
    enrichNoSugg: enrich[0].nosugg,
    coverToken: Boolean(process.env.DISCOGS_TOKEN),
    blob: blobConfigured(),
    paypal: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    paypalMode: process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox',
  });
}

async function records(req, res) {
  const Q = req.query;
  const where = ['true'];
  const p = [];
  const add = (clause, val) => { p.push(val); where.push(clause.replaceAll('?', `$${p.length}`)); };
  for (const t of String(Q.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
    add(`concat_ws(' ', id::text, artist, title, label, catno, format, released, notes, batch, tracks, location) ILIKE ?`, `%${likeEsc(t)}%`);
  }
  if (['available', 'draft', 'reserved', 'sold'].includes(Q.status)) add('status = ?', Q.status);
  if (Q.location === '__none__') where.push(`coalesce(location, '') = ''`);
  else if (Q.location) add('location = ?', String(Q.location));
  const per = Math.min(200, Math.max(10, parseInt(Q.per, 10) || 50));
  const page = Math.max(1, parseInt(Q.page, 10) || 1);
  const order = { new: 'created_at DESC, id DESC', artist: 'lower(artist), lower(title)', sold: 'sold_at DESC NULLS LAST, id DESC', price: 'price DESC NULLS LAST' }[Q.sort] || 'created_at DESC, id DESC';
  const w = where.join(' AND ');
  const sql = db();
  const [cnt, items] = await Promise.all([
    sql.query(`SELECT count(*)::int AS n FROM records WHERE ${w}`, p),
    sql.query(`SELECT id, release_id, artist, title, label, catno, format, media_condition, sleeve_condition,
                 notes, avg_price, price, price_locked, status, thumb_url, cover_url, batch, location, created_at, sold_at
               FROM records WHERE ${w} ORDER BY ${order} LIMIT ${per} OFFSET ${(page - 1) * per}`, p),
  ]);
  send(res, 200, { total: cnt[0].n, page, per, items });
}

async function orders(res) {
  const sql = db();
  const items = await sql.query(`SELECT * FROM orders WHERE status <> 'created' OR created_at > now() - interval '1 day'
                                 ORDER BY created_at DESC LIMIT 300`);
  // Lagerort jeder bestellten Platte, damit sie schnell gefunden wird
  const ids = [...new Set(items.flatMap((o) => o.record_ids || []))];
  const locs = ids.length ? await sql.query('SELECT id, location FROM records WHERE id = ANY($1::int[])', [ids]) : [];
  const locations = Object.fromEntries(locs.filter((r) => r.location).map((r) => [r.id, r.location]));
  send(res, 200, { items, locations });
}

// Alle verwendeten Lagerorte mit Anzahl (für Vorschläge und Filter)
async function locations(res) {
  const items = await db().query(`SELECT location AS name, count(*)::int AS n,
      count(*) FILTER (WHERE status = 'available')::int AS available
    FROM records WHERE coalesce(location, '') <> '' GROUP BY 1 ORDER BY 1`);
  send(res, 200, { items });
}

const clean = (v, max = 500) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const posNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

async function importRows(req, res) {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 1000) : [];
  const discount = Math.min(90, Math.max(0, Number(req.body?.discount ?? 5)));
  const minPrice = Math.max(0, Number(req.body?.minPrice ?? 0));
  const auto = req.body?.auto === true;
  const batch = clean(req.body?.batch, 120);
  const location = clean(req.body?.location, 120);

  const cols = { key: [], rel: [], lst: [], artist: [], title: [], label: [], catno: [], format: [], released: [], genre: [],
    media: [], sleeve: [], descr: [], notes: [], avg: [], price: [], status: [], cover: [], batch: [], tracks: [], country: [] };
  const seen = new Set();
  let skipped = 0;

  for (const r of rows) {
    const artist = clean(r.artist), title = clean(r.title);
    if (!artist || !title) { skipped++; continue; }
    const rel = /^\d+$/.test(String(r.release_id ?? '').trim()) ? String(r.release_id).trim() : null;
    const listing = clean(r.listing_id, 60);
    const ident = listing
      ? `L:${listing}`
      : `C:${[rel, r.date_added, r.media_condition, r.sleeve_condition, r.notes, artist, title, r.catno, r.dup || 0].map((x) => String(x ?? '').trim()).join('|')}`;
    const key = crypto.createHash('sha1').update(ident).digest('hex');
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);

    const avg = posNum(r.avg_price);
    let price = avg ? Math.round(avg * (100 - discount)) / 100 : null;
    if (price != null && price < minPrice) price = minPrice;

    cols.key.push(key); cols.rel.push(rel); cols.lst.push(listing);
    cols.artist.push(artist); cols.title.push(title); cols.label.push(clean(r.label)); cols.catno.push(clean(r.catno, 120));
    cols.format.push(clean(r.format)); cols.released.push(clean(r.released, 40)); cols.genre.push(clean(r.genre));
    cols.media.push(clean(r.media_condition, 80)); cols.sleeve.push(clean(r.sleeve_condition, 80));
    cols.descr.push(clean(r.description, 2000)); cols.notes.push(clean(r.notes, 2000));
    cols.avg.push(avg); cols.price.push(price); cols.status.push(price ? 'available' : 'draft');
    cols.cover.push(clean(r.cover_url, 1000)); cols.batch.push(batch);
    cols.tracks.push(clean(r.tracks, 8000)); cols.country.push(clean(r.country, 80));
  }
  if (!cols.key.length) return send(res, 200, { inserted: 0, updated: 0, skipped });

  const result = await db().query(
    `INSERT INTO records (import_key, release_id, listing_id, artist, title, label, catno, format, released, genre,
       media_condition, sleeve_condition, description, notes, avg_price, price, status, cover_url, thumb_url, batch, tracks, country, enrich_status, location)
     SELECT k, rel, lst, artist, title, label, catno, format, released, genre, media, sleeve, descr, notes, avg, price, status, cover, cover, batch, tracks, country,
            CASE WHEN $22::boolean THEN 'pending' END, $23::text
     FROM unnest($1::text[], $2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
                 $10::text[], $11::text[], $12::text[], $13::text[], $14::text[], $15::numeric[], $16::numeric[], $17::text[],
                 $18::text[], $19::text[], $20::text[], $21::text[])
       AS t(k, rel, lst, artist, title, label, catno, format, released, genre, media, sleeve, descr, notes, avg, price, status, cover, batch, tracks, country)
     ON CONFLICT (import_key) DO UPDATE SET
       avg_price = coalesce(EXCLUDED.avg_price, records.avg_price),
       price = CASE WHEN records.status IN ('sold', 'reserved') OR records.price_locked THEN records.price
                    ELSE coalesce(EXCLUDED.price, records.price) END,
       status = CASE WHEN records.status = 'draft' AND EXCLUDED.price IS NOT NULL THEN 'available' ELSE records.status END,
       media_condition = coalesce(EXCLUDED.media_condition, records.media_condition),
       sleeve_condition = coalesce(EXCLUDED.sleeve_condition, records.sleeve_condition),
       description = coalesce(EXCLUDED.description, records.description),
       notes = coalesce(EXCLUDED.notes, records.notes),
       genre = coalesce(EXCLUDED.genre, records.genre),
       cover_url = coalesce(EXCLUDED.cover_url, records.cover_url),
       thumb_url = coalesce(EXCLUDED.thumb_url, records.thumb_url),
       tracks = coalesce(EXCLUDED.tracks, records.tracks),
       country = coalesce(EXCLUDED.country, records.country),
       enrich_status = CASE WHEN $22::boolean AND records.status NOT IN ('sold', 'reserved') THEN 'pending' ELSE records.enrich_status END,
       location = coalesce(EXCLUDED.location, records.location),
       updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [cols.key, cols.rel, cols.lst, cols.artist, cols.title, cols.label, cols.catno, cols.format, cols.released, cols.genre,
      cols.media, cols.sleeve, cols.descr, cols.notes, cols.avg, cols.price, cols.status, cols.cover, cols.batch, cols.tracks, cols.country, auto, location],
  );
  const inserted = result.filter((r) => r.inserted).length;
  send(res, 200, { inserted, updated: result.length - inserted, skipped });
}

async function update(req, res) {
  const { op } = req.body || {};
  const ids = intIds(req.body?.ids, 1000);
  if (!ids.length) return send(res, 400, { error: 'Keine Platten ausgewählt.' });
  const sql = db();
  let rows;
  if (op === 'sold') {
    rows = await sql.query(`UPDATE records SET status = 'sold', sold_at = now(), updated_at = now() WHERE id = ANY($1::int[]) RETURNING id`, [ids]);
  } else if (op === 'available') {
    rows = await sql.query(`UPDATE records SET status = 'available', sold_at = NULL, updated_at = now()
                            WHERE id = ANY($1::int[]) AND price > 0 RETURNING id`, [ids]);
  } else if (op === 'draft') {
    rows = await sql.query(`UPDATE records SET status = 'draft', updated_at = now() WHERE id = ANY($1::int[]) RETURNING id`, [ids]);
  } else if (op === 'enrich') {
    rows = await sql.query(`UPDATE records SET enrich_status = 'pending', enrich_note = NULL WHERE id = ANY($1::int[]) AND status NOT IN ('sold', 'reserved') RETURNING id`, [ids]);
  } else if (op === 'location') {
    const location = clean(req.body?.location, 120);
    rows = await sql.query(`UPDATE records SET location = $2, updated_at = now() WHERE id = ANY($1::int[]) RETURNING id`, [ids, location]);
  } else if (op === 'delete') {
    rows = await sql.query(`DELETE FROM records WHERE id = ANY($1::int[]) RETURNING id`, [ids]);
  } else if (op === 'price') {
    const price = posNum(req.body?.price);
    if (!price) return send(res, 400, { error: 'Ungültiger Preis.' });
    rows = await sql.query(`UPDATE records SET price = $2, price_locked = true, updated_at = now(),
                              status = CASE WHEN status = 'draft' THEN 'available' ELSE status END
                            WHERE id = ANY($1::int[]) RETURNING id`, [ids, price]);
  } else {
    return send(res, 400, { error: 'Unbekannte Aktion.' });
  }
  send(res, 200, { changed: rows.length });
}

async function reprice(req, res) {
  const discount = Math.min(90, Math.max(0, Number(req.body?.discount ?? 5)));
  const rows = await db().query(
    // Basis minus Rabatt, dabei max. ±10 % zum günstigsten Angebot (falls bekannt)
    `UPDATE records SET price = CASE WHEN lowest_offer IS NULL THEN round(avg_price * (100 - $1) / 100.0, 2)
       ELSE greatest(least(round(avg_price * (100 - $1) / 100.0, 2), round(lowest_offer * 1.1, 2)), round(lowest_offer * 0.9, 2)) END,
       updated_at = now()
     WHERE avg_price IS NOT NULL AND NOT price_locked AND status IN ('available', 'draft') RETURNING id`,
    [discount],
  );
  send(res, 200, { changed: rows.length });
}

async function coverStep(res) {
  if (!process.env.DISCOGS_TOKEN) return send(res, 400, { error: 'Der Token für Cover & Tracklisten ist nicht gesetzt (siehe README).' });
  const sql = db();
  const next = await sql.query(`SELECT id, release_id FROM records WHERE (cover_url IS NULL OR tracks IS NULL) AND release_id IS NOT NULL
                                ORDER BY (status = 'available') DESC, id LIMIT 1`);
  if (!next.length) return send(res, 200, { done: true, remaining: 0 });
  const r = await fetchCover(next[0]);
  if (r.status === 'error') await sql.query(`UPDATE records SET cover_url = coalesce(cover_url, ''), thumb_url = coalesce(thumb_url, ''), tracks = coalesce(tracks, '') WHERE id = $1`, [next[0].id]);
  const left = await sql.query(`SELECT count(*)::int AS n FROM records WHERE (cover_url IS NULL OR tracks IS NULL) AND release_id IS NOT NULL`);
  send(res, 200, { status: r.status, remaining: left[0].n });
}

// Cover-Bild vom Preis-Tool entgegennehmen und im Vercel-Blob-Speicher ablegen
async function uploadCover(req, res) {
  if (!blobConfigured()) {
    return send(res, 400, { error: 'Bildspeicher nicht verbunden: In Vercel unter „Storage“ einen Blob-Speicher anlegen, mit dem Projekt verbinden und neu deployen.' });
  }
  const { put } = await import('@vercel/blob');
  const id = String(req.body?.release_id ?? '').replace(/\D/g, '') || 'ohne-id';
  const type = /^image\/(jpeg|png|webp)$/.test(req.body?.type) ? req.body.type : 'image/jpeg';
  const buf = Buffer.from(String(req.body?.data || ''), 'base64');
  if (!buf.length || buf.length > 3_000_000) return send(res, 400, { error: 'Ungültiges oder zu großes Bild.' });
  const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
  const blob = await put(`cover/${id}.${ext}`, buf, { access: 'public', contentType: type, addRandomSuffix: true });
  send(res, 200, { url: blob.url });
}

// Eine Platte aus der Warteschlange ergänzen (der Admin-Browser ruft das Platte für Platte auf)
async function enrichStep(req, res) {
  const discount = Math.min(90, Math.max(0, Number(req.body?.discount ?? 5)));
  const minPrice = Math.max(0, Number(req.body?.minPrice ?? 0));
  const sql = db();
  const next = await sql.query(`SELECT id, release_id, artist, title, catno, format, media_condition FROM records WHERE enrich_status = 'pending' ORDER BY id LIMIT 1`);
  const count = async () => (await sql.query(`SELECT count(*)::int AS n FROM records WHERE enrich_status = 'pending'`))[0].n;
  if (!next.length) return send(res, 200, { done: true, remaining: 0 });
  const rec = next[0];
  let result;
  try {
    result = await enrichRecord(rec, { discount, minPrice });
  } catch (e) {
    if (e.rateLimit) return send(res, 200, { wait: 60, remaining: await count(), rate: 0 });
    // Als Fehler markieren, damit die Warteschlange nicht an einer Platte hängen bleibt („Erneut versuchen“ möglich)
    await sql.query(`UPDATE records SET enrich_status = 'error', enrich_note = $2 WHERE id = $1`, [rec.id, e.message.slice(0, 200)]);
    result = { notes: [e.message], error: true };
  }
  send(res, 200, { record: { id: rec.id, artist: rec.artist, title: rec.title, ...result }, remaining: await count(), rate: rateRemaining });
}

async function enrichRetry(res) {
  const rows = await db().query(`UPDATE records SET enrich_status = 'pending', enrich_note = NULL WHERE enrich_status = 'error' RETURNING id`);
  send(res, 200, { changed: rows.length });
}

// Platten, die nur mit Ersatzpreis (ohne Preisvorschläge) erfasst wurden, erneut ermitteln
async function enrichNoSuggestions(res) {
  const rows = await db().query(`UPDATE records SET enrich_status = 'pending', enrich_note = NULL
    WHERE enrich_status = 'done' AND enrich_note ILIKE '%Preisvorschläge%' AND status NOT IN ('sold', 'reserved') RETURNING id`);
  send(res, 200, { changed: rows.length });
}
