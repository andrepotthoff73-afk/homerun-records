// Mitgliederbereich: Registrieren, Anmelden, Profil, Bestellungen, Merkliste
import { db, ensureSchema } from './_lib/db.js';
import { send, isJson, intIds } from './_lib/util.js';
import { hashPassword, checkPassword, customerId, setCustomerSession, clearCustomerSession } from './_lib/kunde.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST' && !isJson(req)) return send(res, 415, { error: 'JSON erwartet' });
  const action = req.query.action;
  try {
    await ensureSchema();
    if (action === 'register') return await register(req, res);
    if (action === 'login') return await login(req, res);
    if (action === 'logout') { clearCustomerSession(res); return send(res, 200, { ok: true }); }
    const id = customerId(req);
    if (action === 'me') return await me(id, res);
    if (!id) return send(res, 401, { error: 'Bitte melde dich an.' });
    if (action === 'orders') return await orders(id, res);
    if (action === 'wishlist') return await wishlist(id, req, res);
    if (action === 'profile' && req.method === 'POST') return await profile(id, req, res);
    if (action === 'delete' && req.method === 'POST') return await removeAccount(id, req, res);
    send(res, 404, { error: 'Unbekannte Aktion' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}

async function register(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().slice(0, 120);
  const pw = String(req.body?.password || '');
  if (!EMAIL.test(email)) return send(res, 400, { error: 'Bitte gib eine gültige E-Mail-Adresse ein.' });
  if (!name) return send(res, 400, { error: 'Bitte gib deinen Namen ein.' });
  if (pw.length < 8) return send(res, 400, { error: 'Das Passwort muss mindestens 8 Zeichen haben.' });
  const rows = await db().query(
    `INSERT INTO customers (email, name, password_hash, last_login) VALUES ($1, $2, $3, now())
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [email, name, hashPassword(pw)],
  );
  if (!rows.length) return send(res, 409, { error: 'Mit dieser E-Mail-Adresse gibt es schon ein Konto. Bitte melde dich an.' });
  setCustomerSession(res, rows[0].id);
  send(res, 200, { ok: true });
}

async function login(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const rows = await db().query('SELECT id, password_hash FROM customers WHERE email = $1', [email]);
  if (!rows.length || !checkPassword(req.body?.password, rows[0].password_hash)) {
    await sleep(800);
    return send(res, 401, { error: 'E-Mail oder Passwort ist falsch.' });
  }
  await db().query('UPDATE customers SET last_login = now() WHERE id = $1', [rows[0].id]);
  setCustomerSession(res, rows[0].id);
  send(res, 200, { ok: true });
}

async function me(id, res) {
  if (!id) return send(res, 200, { customer: null });
  const rows = await db().query(
    `SELECT c.id, c.email, c.name, c.created_at,
       (SELECT count(*)::int FROM wishlist w WHERE w.customer_id = c.id) AS wishlist_count,
       (SELECT count(*)::int FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed') AS order_count
     FROM customers c WHERE c.id = $1`,
    [id],
  );
  send(res, 200, { customer: rows[0] || null });
}

async function orders(id, res) {
  const items = await db().query(
    `SELECT paypal_order_id, items, item_total, shipping, total, status, shipping_address, created_at, completed_at
     FROM orders WHERE customer_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 200`,
    [id],
  );
  send(res, 200, { items });
}

async function wishlist(id, req, res) {
  const sql = db();
  if (req.method === 'POST') {
    const [recordId] = intIds([req.body?.record_id]);
    if (!recordId) return send(res, 400, { error: 'Platte fehlt.' });
    if (req.body?.remove) await sql.query('DELETE FROM wishlist WHERE customer_id = $1 AND record_id = $2', [id, recordId]);
    else await sql.query('INSERT INTO wishlist (customer_id, record_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, recordId]);
  }
  const items = await sql.query(
    `SELECT r.id, r.release_id, r.artist, r.title, r.format, r.price, r.avg_price, r.status, r.cover_url, r.thumb_url
     FROM wishlist w JOIN records r ON r.id = w.record_id
     WHERE w.customer_id = $1 AND r.status <> 'draft' ORDER BY w.created_at DESC`,
    [id],
  );
  send(res, 200, { items });
}

async function profile(id, req, res) {
  const sql = db();
  const rows = await sql.query('SELECT password_hash FROM customers WHERE id = $1', [id]);
  if (!rows.length) return send(res, 404, { error: 'Konto nicht gefunden.' });
  const name = String(req.body?.name || '').trim().slice(0, 120);
  if (name) await sql.query('UPDATE customers SET name = $2 WHERE id = $1', [id, name]);
  if (req.body?.newPassword) {
    if (!checkPassword(req.body?.password, rows[0].password_hash)) return send(res, 401, { error: 'Das aktuelle Passwort stimmt nicht.' });
    if (String(req.body.newPassword).length < 8) return send(res, 400, { error: 'Das neue Passwort muss mindestens 8 Zeichen haben.' });
    await sql.query('UPDATE customers SET password_hash = $2 WHERE id = $1', [id, hashPassword(req.body.newPassword)]);
  }
  send(res, 200, { ok: true });
}

async function removeAccount(id, req, res) {
  const sql = db();
  const rows = await sql.query('SELECT password_hash FROM customers WHERE id = $1', [id]);
  if (!rows.length || !checkPassword(req.body?.password, rows[0].password_hash)) return send(res, 401, { error: 'Das Passwort stimmt nicht.' });
  await sql.query('UPDATE orders SET customer_id = NULL WHERE customer_id = $1', [id]);
  await sql.query('DELETE FROM customers WHERE id = $1', [id]);
  clearCustomerSession(res);
  send(res, 200, { ok: true });
}
