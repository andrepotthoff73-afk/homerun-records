// Öffentliche Shop-API: Liste, Detail, Warenkorb-Prüfung, Konfiguration, Cover
import { db, ensureSchema } from './_lib/db.js';
import { send, settings, intIds, likeEsc } from './_lib/util.js';
import { ZONE_PRICES, ZONE_NAMES, zoneOf, shippableCountries } from './_lib/versand.js';
import { fetchCover } from './_lib/katalog.js';

const LIST_COLS = `id, release_id, artist, title, label, catno, format, released, genre, country,
  media_condition, sleeve_condition, price, status, cover_url, thumb_url, created_at`;
const PUBLIC_COLS = `${LIST_COLS}, description, tracks`;
const YEAR = `(substring(released from '(\\d{4})'))::int`;

const SORTS = {
  new: 'created_at DESC, id DESC',
  price_asc: 'price ASC, id',
  price_desc: 'price DESC, id',
  artist: 'lower(artist), lower(title)',
  title: 'lower(title), lower(artist)',
  year: `${YEAR} DESC NULLS LAST, id`,
  year_asc: `${YEAR} ASC NULLS LAST, id`,
};

export default async function handler(req, res) {
  try {
    const action = req.query.action || 'list';
    if (action === 'config') {
      const s = settings();
      return send(res, 200, {
        paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
        currency: 'EUR',
        shipping: s.shipping,
        perPackage: s.perPackage,
        zonePrices: ZONE_PRICES,
        zoneNames: ZONE_NAMES,
        countries: shippableCountries().map((cc) => [cc, zoneOf(cc)]),
        freeFrom: s.freeFrom,
      }, { 'Cache-Control': 's-maxage=300' });
    }
    await ensureSchema();
    if (action === 'list') return await list(req, res);
    if (action === 'get') return await getOne(req, res);
    if (action === 'many') return await many(req, res);
    if (action === 'facets') return await facets(res);
    if (action === 'cover') return await cover(req, res);
    send(res, 404, { error: 'Unbekannte Aktion' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}

async function list(req, res) {
  const Q = req.query;
  const where = ["status = 'available'"];
  const p = [];
  const add = (clause, val) => { p.push(val); where.push(clause.replaceAll('?', `$${p.length}`)); };

  const words = (v) => String(v || '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
  // Freitext über alle Felder inkl. Trackliste
  for (const t of words(Q.q)) add(`concat_ws(' ', artist, title, label, catno, format, released, genre, country, tracks) ILIKE ?`, `%${likeEsc(t)}%`);
  // Einzelne Felder: jedes Wort muss im jeweiligen Feld vorkommen
  const FIELD = { artist: 'artist', title: 'title', track: 'tracks', label: 'label', genre: 'genre', country: 'country' };
  for (const [param, col] of Object.entries(FIELD)) {
    for (const t of words(Q[param])) add(`${col} ILIKE ?`, `%${likeEsc(t)}%`);
  }
  if (Q.catno) add(`regexp_replace(coalesce(catno, ''), '[^[:alnum:]]', '', 'g') ILIKE ?`, `%${likeEsc(String(Q.catno).replace(/[^\p{L}\p{N}]/gu, ''))}%`);
  if (Q.format) add('format ILIKE ?', `%${likeEsc(Q.format)}%`);
  if (Q.cond) add('media_condition ILIKE ?', `%(${likeEsc(Q.cond)})%`);
  if (Q.sleeve) add(`(sleeve_condition ILIKE '%(' || ? || ')%' OR sleeve_condition ILIKE ?)`, likeEsc(Q.sleeve));
  if (Q.artist_exact) add('lower(artist) = lower(?)', String(Q.artist_exact));
  const yFrom = parseInt(Q.year_from, 10), yTo = parseInt(Q.year_to, 10);
  if (yFrom > 0) add(`${YEAR} >= ?`, yFrom);
  if (yTo > 0) add(`${YEAR} <= ?`, yTo);
  const min = parseFloat(Q.min), max = parseFloat(Q.max);
  if (Number.isFinite(min)) add('price >= ?', min);
  if (Number.isFinite(max)) add('price <= ?', max);
  const exclude = parseInt(Q.exclude, 10);
  if (exclude > 0) add('id <> ?', exclude);

  const per = Math.min(96, Math.max(1, parseInt(Q.per, 10) || 48));
  const page = Math.max(1, parseInt(Q.page, 10) || 1);
  const order = SORTS[Q.sort] || SORTS.new;
  const w = where.join(' AND ');
  const sql = db();

  const [cnt, items, stock] = await Promise.all([
    sql.query(`SELECT count(*)::int AS n FROM records WHERE ${w}`, p),
    sql.query(`SELECT ${LIST_COLS} FROM records WHERE ${w} ORDER BY ${order} LIMIT ${per} OFFSET ${(page - 1) * per}`, p),
    sql.query(`SELECT count(*)::int AS n FROM records WHERE status = 'available'`),
  ]);
  send(res, 200, { total: cnt[0].n, stock: stock[0].n, page, per, items },
    { 'Cache-Control': 's-maxage=20, stale-while-revalidate=60' });
}

async function getOne(req, res) {
  const id = parseInt(req.query.id, 10);
  const rows = await db().query(`SELECT ${PUBLIC_COLS} FROM records WHERE id = $1 AND status <> 'draft'`, [id || 0]);
  if (!rows.length) return send(res, 404, { error: 'Platte nicht gefunden' });
  send(res, 200, rows[0], { 'Cache-Control': 's-maxage=20' });
}

// Kategorien für die Knöpfe im Shop: Genres/Stile und Jahrzehnte mit Anzahl der verfügbaren Platten
async function facets(res) {
  const sql = db();
  const [tags, decades] = await Promise.all([
    // „Folk, World, & Country“ enthält selbst Kommas – vor dem Aufteilen zusammenfassen
    sql.query(`SELECT trim(t) AS name, count(*)::int AS n
               FROM records, regexp_split_to_table(replace(coalesce(genre, ''), 'Folk, World, & Country', 'Folk World & Country'), ',') AS t
               WHERE status = 'available' AND trim(t) <> ''
               GROUP BY 1 ORDER BY n DESC, name LIMIT 80`),
    sql.query(`SELECT (${YEAR} / 10) * 10 AS decade, count(*)::int AS n
               FROM records WHERE status = 'available' AND ${YEAR} IS NOT NULL
               GROUP BY 1 ORDER BY 1`),
  ]);
  send(res, 200, { tags, decades }, { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' });
}

async function many(req, res) {
  const ids = intIds(req.query.ids, 100);
  if (!ids.length) return send(res, 200, { items: [] });
  const items = await db().query(
    `SELECT id, release_id, artist, title, format, price, status, cover_url, thumb_url FROM records WHERE id = ANY($1::int[])`,
    [ids],
  );
  send(res, 200, { items }, { 'Cache-Control': 'no-store' });
}

async function cover(req, res) {
  const id = parseInt(req.query.id, 10);
  const full = req.query.size === 'full';
  const redirect = (loc, maxAge) => {
    res.writeHead(302, { Location: loc, 'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}` });
    res.end();
  };
  const rows = await db().query('SELECT id, release_id, cover_url, thumb_url FROM records WHERE id = $1', [id || 0]);
  const rec = rows[0];
  if (!rec) return redirect('/assets/vinyl.svg', 300);
  let url = full ? rec.cover_url : (rec.thumb_url || rec.cover_url);
  if (rec.cover_url == null) {
    const r = await fetchCover(rec).catch(() => ({ status: 'error' }));
    if (r.status === 'ok') url = full ? r.cover : r.thumb;
    else return redirect('/assets/vinyl.svg', 120); // später erneut versuchen
  }
  redirect(url || '/assets/vinyl.svg', 86400);
}
