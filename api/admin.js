// Passwortgeschützte Admin-API: Login, CSV-Import, Platten verwalten, Bestellungen
import crypto from 'node:crypto';
import { db, ensureSchema } from './_lib/db.js';
import { send, intIds, isJson, likeEsc, blobConfigured } from './_lib/util.js';
import { isAdmin, checkPassword, passwordConfigured, setSession, clearSession } from './_lib/auth.js';
import { fetchCover, enrichRecord, salePrice, csvIsNotVinyl, rateRemaining } from './_lib/katalog.js';

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
    if (action === 'needcond') return await needCondition(res);
    if (action === 'market-next') return await marketNext(req, res);
    if (action === 'market-recent') return await marketRecent(res);
    if (post && action === 'condition') return await setCondition(req, res);
    if (post && action === 'market-price') return await marketPrice(req, res);
    if (post && action === 'undelete') return await undelete(req, res);
    if (post && action === 'settings') return send(res, 200, await saveSettings(cleanSettings(req.body)));
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
  const settings = await loadSettings();
  const api = settings.priceSource !== 'market';
  const [byStatus, ord, covers, enrich] = await Promise.all([
    sql.query(`SELECT status, count(*)::int AS n, coalesce(sum(price), 0)::float AS value FROM records GROUP BY status`),
    sql.query(`SELECT count(*)::int AS n, coalesce(sum(total), 0)::float AS revenue FROM orders WHERE status = 'completed'`),
    sql.query(`SELECT count(*)::int AS n FROM records WHERE (cover_url IS NULL OR tracks IS NULL) AND release_id IS NOT NULL`),
    sql.query(`SELECT count(*) FILTER (WHERE enrich_status = 'pending')::int AS pending, count(*) FILTER (WHERE enrich_status = 'error')::int AS errors,
      count(*) FILTER (WHERE enrich_status = 'novinyl')::int AS novinyl,
      count(*) FILTER (WHERE enrich_status = 'needcond')::int AS needcond,
      count(*) FILTER (WHERE enrich_status = 'market')::int AS market,
      count(*) FILTER (WHERE enrich_status = 'pending')::int AS pending_only,
      max(updated_at) FILTER (WHERE enrich_status = 'done' AND market_offers IS NOT NULL) AS last_market,
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
    // Bei Preisquelle „API“ werden auch Platten aus der Preis-Tool-Warteschlange direkt bepreist
    enrichPending: api ? enrich[0].pending + enrich[0].market : enrich[0].pending,
    enrichErrors: enrich[0].errors,
    enrichNoVinyl: enrich[0].novinyl,
    enrichNoSugg: enrich[0].nosugg,
    needCondition: enrich[0].needcond,
    marketPending: api ? 0 : enrich[0].market,
    priceSource: settings.priceSource,
    minPrice: settings.minPrice,
    lastMarket: enrich[0].last_market,
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
  const discount = 0; // kein Rabatt: Verkaufspreis = Ø-Marktpreis
  const minPrice = Math.max(0, Number(req.body?.minPrice ?? 0));
  const auto = req.body?.auto === true;
  const batch = clean(req.body?.batch, 120);
  const location = clean(req.body?.location, 120);
  if (auto) await saveSettings({ discount, minPrice, ...cleanSettings({ priceSource: req.body?.priceSource }) });

  const cols = { idx: [], key: [], ikey: [], rel: [], lst: [], artist: [], title: [], label: [], catno: [], format: [], released: [], genre: [],
    media: [], sleeve: [], descr: [], notes: [], avg: [], price: [], status: [], cover: [], batch: [], tracks: [], country: [] };
  const seen = new Set();
  const instCount = new Map();
  let skipped = 0;

  for (const [rowIdx, r] of rows.entries()) {
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
    // Zweiter, stabiler Schlüssel je Exemplar: Release-ID + Datum „hinzugefügt“ (ändert sich nicht,
    // wenn du in Discogs Zustand oder Notiz eines Exemplars nachträgst)
    const added = String(r.date_added ?? '').trim();
    let ikey = null;
    if (listing) ikey = crypto.createHash('sha1').update(`IL:${listing}`).digest('hex');
    else if (rel && added) {
      const base = `${rel}|${added}`;
      const n = instCount.get(base) || 0;
      instCount.set(base, n + 1);
      ikey = crypto.createHash('sha1').update(`I:${base}|${n}`).digest('hex');
    }

    const avg = posNum(r.avg_price);
    let price = avg ? Math.round(avg * (100 - discount)) / 100 : null;
    if (price != null && price < minPrice) price = minPrice;

    cols.idx.push(rowIdx); cols.key.push(key); cols.ikey.push(ikey); cols.rel.push(rel); cols.lst.push(listing);
    cols.artist.push(artist); cols.title.push(title); cols.label.push(clean(r.label)); cols.catno.push(clean(r.catno, 120));
    cols.format.push(clean(r.format)); cols.released.push(clean(r.released, 40)); cols.genre.push(clean(r.genre));
    cols.media.push(clean(r.media_condition, 80)); cols.sleeve.push(clean(r.sleeve_condition, 80));
    cols.descr.push(clean(r.description, 2000)); cols.notes.push(clean(r.notes, 2000));
    cols.avg.push(avg); cols.price.push(price); cols.status.push(price ? 'available' : 'draft');
    cols.cover.push(clean(r.cover_url, 1000)); cols.batch.push(batch);
    cols.tracks.push(clean(r.tracks, 8000)); cols.country.push(clean(r.country, 80));
  }
  if (!cols.key.length) return send(res, 200, { inserted: 0, updated: 0, skipped });

  // „Platten erfassen“: nur NEUE Platten anlegen. Schon vorhandene (auch verkaufte) und gelöschte bleiben unberührt.
  let existing = 0, deleted = 0;
  const deletedRows = []; // Zeilennummern (in dieser Sendung) früher gelöschter Platten, mit ihren Schlüsseln
  if (auto) {
    const sql = db();
    const ik = cols.ikey.filter(Boolean);
    const known = await sql.query(
      `SELECT import_key, instance_key FROM records WHERE import_key = ANY($1::text[]) OR instance_key = ANY($2::text[])`,
      [cols.key, ik]);
    const gone = await sql.query(`SELECT key FROM deleted_keys WHERE key = ANY($1::text[])`, [[...cols.key, ...ik]]);
    const knownSet = new Set(known.flatMap((r) => [r.import_key, r.instance_key]).filter(Boolean));
    const goneSet = new Set(gone.map((r) => r.key));
    // Fehlenden Exemplar-Schlüssel bei vorhandenen Platten nachtragen (für künftige Abgleiche)
    const fill = cols.key.map((k, i) => [k, cols.ikey[i]]).filter(([k, i]) => i && knownSet.has(k) && !knownSet.has(i));
    if (fill.length) {
      await sql.query(`UPDATE records r SET instance_key = t.ik FROM unnest($1::text[], $2::text[]) AS t(k, ik)
        WHERE r.import_key = t.k AND r.instance_key IS NULL`, [fill.map((f) => f[0]), fill.map((f) => f[1])]);
    }
    const keep = cols.key.map((k, i) => {
      const i2 = cols.ikey[i];
      if (goneSet.has(k) || (i2 && goneSet.has(i2))) {
        deleted++;
        deletedRows.push({ i: cols.idx[i], keys: [k, i2].filter(Boolean) });
        return false;
      }
      if (knownSet.has(k) || (i2 && knownSet.has(i2))) { existing++; return false; }
      return true;
    });
    for (const c of Object.keys(cols)) cols[c] = cols[c].filter((_, i) => keep[i]);
    if (!cols.key.length) return send(res, 200, { inserted: 0, updated: 0, existing, deleted, deletedRows, skipped });
  }

  const result = await db().query(
    `INSERT INTO records (import_key, instance_key, release_id, listing_id, artist, title, label, catno, format, released, genre,
       media_condition, sleeve_condition, description, notes, avg_price, price, status, cover_url, thumb_url, batch, tracks, country, enrich_status, location)
     SELECT k, ik, rel, lst, artist, title, label, catno, format, released, genre, media, sleeve, descr, notes, avg, price, status, cover, cover, batch, tracks, country,
            CASE WHEN $22::boolean THEN 'needcond' END, $23::text
     FROM unnest($1::text[], $2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
                 $10::text[], $11::text[], $12::text[], $13::text[], $14::text[], $15::numeric[], $16::numeric[], $17::text[],
                 $18::text[], $19::text[], $20::text[], $21::text[], $24::text[])
       AS t(k, rel, lst, artist, title, label, catno, format, released, genre, media, sleeve, descr, notes, avg, price, status, cover, batch, tracks, country, ik)
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
       enrich_status = CASE WHEN $22::boolean AND records.status NOT IN ('sold', 'reserved') THEN 'needcond' ELSE records.enrich_status END,
       location = coalesce(EXCLUDED.location, records.location),
       instance_key = coalesce(records.instance_key, EXCLUDED.instance_key),
       updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [cols.key, cols.rel, cols.lst, cols.artist, cols.title, cols.label, cols.catno, cols.format, cols.released, cols.genre,
      cols.media, cols.sleeve, cols.descr, cols.notes, cols.avg, cols.price, cols.status, cols.cover, cols.batch, cols.tracks, cols.country, auto, location, cols.ikey],
  );
  const inserted = result.filter((r) => r.inserted).length;
  send(res, 200, { inserted, updated: result.length - inserted, existing, deleted, deletedRows, skipped });
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
    rows = await sql.query(`DELETE FROM records WHERE id = ANY($1::int[]) RETURNING id, import_key, instance_key`, [ids]);
    // Gelöschte Platten merken, damit sie beim nächsten Import derselben Discogs-Liste nicht wieder auftauchen
    const keys = rows.flatMap((r) => [r.import_key, r.instance_key]).filter(Boolean);
    if (keys.length) await sql.query(`INSERT INTO deleted_keys (key) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`, [keys]);
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
  await saveSettings({ discount: 0 });
  const rows = await db().query(
    // Verkaufspreis = Ø-Marktpreis (kein Rabatt)
    `UPDATE records SET price = round(avg_price * (100 - $1) / 100.0, 2), updated_at = now()
     WHERE avg_price IS NOT NULL AND NOT price_locked AND status IN ('available', 'draft') RETURNING id`,
    [0],
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
  const sql = db();
  const settings = await loadSettings();
  const states = settings.priceSource === 'market' ? ['pending'] : ['pending', 'market'];
  const next = await sql.query(`SELECT id, release_id, artist, title, catno, format, media_condition FROM records
    WHERE enrich_status = ANY($1::text[]) ORDER BY (enrich_status = 'pending') DESC, id LIMIT 1`, [states]);
  const count = async () => (await sql.query(`SELECT count(*)::int AS n FROM records WHERE enrich_status = ANY($1::text[])`, [states]))[0].n;
  if (!next.length) return send(res, 200, { done: true, remaining: 0 });
  const rec = next[0];
  let result;
  try {
    result = await enrichRecord(rec, settings);
  } catch (e) {
    if (e.rateLimit) return send(res, 200, { wait: 60, remaining: await count(), rate: 0 });
    // Als Fehler markieren, damit die Warteschlange nicht an einer Platte hängen bleibt („Erneut versuchen“ möglich)
    await sql.query(`UPDATE records SET enrich_status = 'error', enrich_note = $2 WHERE id = $1`, [rec.id, e.message.slice(0, 200)]);
    result = { notes: [e.message], error: true };
  }
  send(res, 200, { record: { id: rec.id, artist: rec.artist, title: rec.title, media_condition: rec.media_condition, ...result }, remaining: await count(), rate: rateRemaining });
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

// ---------- Einstellungen (Mindestpreis) – das Preis-Tool rechnet damit. Rabatt gibt es nicht mehr. ----------
async function loadSettings() {
  const row = (await db().query(`SELECT value FROM app_settings WHERE key = 'pricing'`))[0];
  return { minPrice: 0, priceSource: 'api', ...(row?.value || {}), discount: 0 };
}
// Nur erlaubte Werte übernehmen
function cleanSettings(b = {}) {
  const out = {};
  if (['api', 'market'].includes(b.priceSource)) out.priceSource = b.priceSource;
  if (b.minPrice != null && Number.isFinite(Number(b.minPrice))) out.minPrice = Math.max(0, Number(b.minPrice));
  return out;
}
async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await db().query(`INSERT INTO app_settings (key, value) VALUES ('pricing', $1::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(next)]);
  return next;
}

// ---------- Zustand nach dem Import abfragen ----------
async function needCondition(res) {
  // CDs, Kassetten usw. (laut CSV) nicht abfragen – die werden ohnehin nicht bepreist
  const all = await db().query(`SELECT id, format FROM records WHERE enrich_status = 'needcond'`);
  const skipIds = all.filter((r) => csvIsNotVinyl(r.format)).map((r) => r.id);
  if (skipIds.length) await db().query(`UPDATE records SET enrich_status = 'pending' WHERE id = ANY($1::int[])`, [skipIds]);
  const items = await db().query(`SELECT id, release_id, artist, title, label, catno, format, released, media_condition, sleeve_condition, location
    FROM records WHERE enrich_status = 'needcond' ORDER BY id LIMIT 2000`);
  send(res, 200, { items });
}

const CONDITIONS = ['Mint (M)', 'Near Mint (NM or M-)', 'Very Good Plus (VG+)', 'Very Good (VG)', 'Good Plus (G+)', 'Good (G)', 'Fair (F)', 'Poor (P)'];
const SLEEVES = [...CONDITIONS, 'Generic', 'Not Graded', 'No Cover'];

async function setCondition(req, res) {
  const sql = db();
  // „Zustand aus der Liste übernehmen“ für alle wartenden Platten, die schon einen haben
  if (req.body?.keepExisting) {
    const rows = await sql.query(`UPDATE records SET enrich_status = 'pending', updated_at = now()
      WHERE enrich_status = 'needcond' AND coalesce(media_condition, '') <> '' RETURNING id`);
    return send(res, 200, { changed: rows.length });
  }
  const ids = intIds(req.body?.ids ?? [req.body?.id], 2000);
  const media = String(req.body?.media || '');
  const sleeve = String(req.body?.sleeve || '');
  if (!ids.length) return send(res, 400, { error: 'Keine Platte angegeben.' });
  if (!CONDITIONS.includes(media)) return send(res, 400, { error: 'Unbekannter Zustand der Platte.' });
  if (sleeve && !SLEEVES.includes(sleeve)) return send(res, 400, { error: 'Unbekannter Zustand der Hülle.' });
  const rows = await sql.query(`UPDATE records SET media_condition = $2, sleeve_condition = coalesce(nullif($3, ''), sleeve_condition),
      enrich_status = CASE WHEN enrich_status = 'needcond' THEN 'pending' ELSE enrich_status END, updated_at = now()
    WHERE id = ANY($1::int[]) RETURNING id`, [ids, media, sleeve]);
  send(res, 200, { changed: rows.length });
}

// ---------- Marktpreis vom Preis-Tool (PC) ----------
// Nächste Platte, deren Preis aus den Marktplatz-Angeboten ermittelt werden soll
async function marketNext(req, res) {
  const sql = db();
  const settings = await loadSettings();
  if (settings.priceSource !== 'market') {
    // Preise kommen über die Discogs-API direkt im Shop – das Preis-Tool hat nichts zu tun
    return send(res, 200, { record: null, remaining: 0, waiting: 0, source: 'api', settings });
  }
  const skip = intIds(req.query.skip, 50);
  const pick = () => sql.query(`SELECT id, release_id, artist, title, label, catno, format, media_condition
    FROM records WHERE enrich_status = 'market' AND NOT (id = ANY($1::int[])) ORDER BY id LIMIT 1`, [skip]);
  let next = await pick();
  // Nichts bereit, aber Platten warten noch auf Cover & Daten → eine davon gleich hier ergänzen,
  // damit das Preis-Tool auch ohne geöffneten Admin-Bereich weiterarbeiten kann
  let enriched = false;
  if (!next.length) {
    const pending = (await sql.query(`SELECT id, release_id, artist, title, catno, format, media_condition FROM records WHERE enrich_status = 'pending' ORDER BY id LIMIT 1`))[0];
    if (pending) {
      enriched = true;
      try { await enrichRecord(pending, settings); } catch (e) {
        if (!e.rateLimit) await sql.query(`UPDATE records SET enrich_status = 'error', enrich_note = $2 WHERE id = $1`, [pending.id, e.message.slice(0, 200)]);
      }
      next = await pick();
    }
  }
  const remaining = (await sql.query(`SELECT count(*)::int AS n FROM records WHERE enrich_status = 'market'`))[0].n;
  const waiting = (await sql.query(`SELECT count(*)::int AS n FROM records WHERE enrich_status IN ('needcond', 'pending')`))[0].n;
  send(res, 200, { record: next[0] || null, remaining, waiting, enriched, settings });
}

async function marketRecent(res) {
  const items = await db().query(`SELECT id, artist, title, media_condition, avg_price, price, status, cover_url, enrich_note, market_offers
    FROM records WHERE market_offers IS NOT NULL ORDER BY updated_at DESC LIMIT 30`);
  send(res, 200, { items });
}

const r2 = (n) => Math.round(n * 100) / 100;

// Ergebnis vom Preis-Tool: Angebote (in Euro) → Durchschnitt → Verkaufspreis
async function marketPrice(req, res) {
  const sql = db();
  const id = parseInt(req.body?.id, 10);
  const rec = (await sql.query(`SELECT id, release_id, status, price_locked FROM records WHERE id = $1`, [id]))[0];
  if (!rec) return send(res, 404, { error: 'Platte nicht gefunden.' });
  const offers = (Array.isArray(req.body?.offers) ? req.body.offers : [])
    .map((o) => ({ eur: Number(o.eur), country: String(o.country || '').slice(0, 60), condition: String(o.condition || '').slice(0, 60), item: String(o.item || '').slice(0, 30) }))
    .filter((o) => Number.isFinite(o.eur) && o.eur > 0 && o.eur < 100000)
    .slice(0, 10);
  const url = String(req.body?.url || '').slice(0, 500);
  const foundRelease = /^\d+$/.test(String(req.body?.releaseId || '')) ? String(req.body.releaseId) : null;

  if (!offers.length) {
    const note = String(req.body?.error || '').slice(0, 200) || 'Keine Angebote auf dem Marktplatz gefunden – bleibt Entwurf, Preis bitte von Hand eintragen';
    await sql.query(`UPDATE records SET enrich_status = 'done', enrich_note = $2, market_offers = '[]'::jsonb,
        release_id = coalesce(release_id, $3), updated_at = now() WHERE id = $1`, [id, note, foundRelease]);
    return send(res, 200, { id, avg: null, price: null, note });
  }

  const s = await loadSettings();
  // Die ersten (bis zu) 10 Angebote addieren und durch ihre Anzahl teilen
  const avg = r2(offers.reduce((a, o) => a + o.eur, 0) / offers.length);
  const sale = salePrice(avg, s);
  const de = offers.filter((o) => /^(germany|deutschland)$/i.test(o.country)).length;
  const parts = [`Ø aus ${offers.length} Angebot${offers.length === 1 ? '' : 'en'}`, `${de}× Deutschland`];
  if (offers.length - de) parts.push(`${offers.length - de}× andere Länder`);
  if (offers.length < 10) parts.push('weniger als 10 Angebote vorhanden');
  if (sale === r2(s.minPrice) && s.minPrice > 0) parts.push(`Mindestpreis ${Number(s.minPrice).toFixed(2)} €`);
  const note = parts.join(' · ');
  const rows = await sql.query(
    `UPDATE records SET avg_price = $2, lowest_offer = $3, market_offers = $4::jsonb,
       price = CASE WHEN price_locked OR status IN ('sold', 'reserved') THEN price ELSE $5 END,
       status = CASE WHEN status = 'draft' THEN 'available' ELSE status END,
       release_id = coalesce(release_id, $6), enrich_status = 'done', enrich_note = $7, updated_at = now()
     WHERE id = $1 RETURNING price, status`,
    [id, avg, Math.min(...offers.map((o) => o.eur)), JSON.stringify({ url, offers }), sale, foundRelease, note],
  );
  // Release erst jetzt bekannt (Suche über Katalognummer) → Cover & Tracks nachladen
  if (!rec.release_id && foundRelease) await fetchCover({ id, release_id: foundRelease }).catch(() => {});
  send(res, 200, { id, avg, sale, note, ...rows[0] });
}

// Früher gelöschte Platten wieder zulassen: Merker entfernen, danach legt der Import sie neu an
async function undelete(req, res) {
  const keys = (Array.isArray(req.body?.keys) ? req.body.keys : []).map(String).filter((k) => /^[0-9a-f]{40}$/.test(k)).slice(0, 4000);
  if (!keys.length) return send(res, 400, { error: 'Keine Platten angegeben.' });
  const rows = await db().query(`DELETE FROM deleted_keys WHERE key = ANY($1::text[]) RETURNING key`, [keys]);
  send(res, 200, { changed: rows.length });
}
