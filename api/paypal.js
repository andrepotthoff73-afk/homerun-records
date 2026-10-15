// PayPal-Checkout: Bestellung anlegen und bezahlen. Preise kommen immer aus der Datenbank,
// nie aus dem Browser. Nach erfolgreicher Zahlung werden die Platten automatisch "verkauft".
import { db, ensureSchema } from './_lib/db.js';
import { send, intIds, isJson, cents, money, shippingFor } from './_lib/util.js';
import { paypal } from './_lib/paypal.js';
import { customerId } from './_lib/kunde.js';
import { zoneOf } from './_lib/versand.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' || !isJson(req)) return send(res, 405, { error: 'Nur POST/JSON erlaubt' });
  try {
    await ensureSchema();
    const action = req.query.action;
    if (action === 'create') return await createOrder(req, res);
    if (action === 'capture') return await captureOrder(req, res);
    send(res, 404, { error: 'Unbekannte Aktion' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}

async function createOrder(req, res) {
  const ids = intIds(req.body?.ids, 50);
  if (!ids.length) return send(res, 400, { error: 'Der Warenkorb ist leer.' });
  const sql = db();
  const rows = await sql.query(
    `SELECT id, artist, title, price FROM records
     WHERE id = ANY($1::int[]) AND status = 'available' AND price > 0`,
    [ids],
  );
  if (rows.length !== ids.length) {
    const ok = new Set(rows.map((r) => r.id));
    return send(res, 409, {
      error: 'Einige Platten sind leider nicht mehr verfügbar und wurden aus dem Warenkorb entfernt.',
      unavailable: ids.filter((id) => !ok.has(id)),
    });
  }

  const country = String(req.body?.country || 'DE').toUpperCase();
  const itemCents = rows.reduce((s, r) => s + cents(r.price), 0);
  const shipCents = shippingFor(itemCents, rows.length, country);
  if (shipCents == null) return send(res, 400, { error: 'In dieses Land können wir leider nicht liefern.' });
  const items = rows.map((r) => ({
    name: `${r.artist} – ${r.title}`.slice(0, 127),
    sku: String(r.id),
    quantity: '1',
    category: 'PHYSICAL_GOODS',
    unit_amount: { currency_code: 'EUR', value: money(cents(r.price)) },
  }));

  const r = await paypal('/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: 'homerun',
      description: 'Homerun Records – Schallplatten',
      amount: {
        currency_code: 'EUR',
        value: money(itemCents + shipCents),
        breakdown: {
          item_total: { currency_code: 'EUR', value: money(itemCents) },
          shipping: { currency_code: 'EUR', value: money(shipCents) },
        },
      },
      items,
    }],
    application_context: {
      brand_name: 'Homerun Records',
      locale: 'de-DE',
      shipping_preference: 'GET_FROM_FILE',
      user_action: 'PAY_NOW',
    },
  });
  if (!r.ok) {
    console.error('PayPal create', JSON.stringify(r.data));
    return send(res, 502, { error: 'PayPal-Bestellung konnte nicht erstellt werden.' });
  }

  await sql.query(
    `INSERT INTO orders (paypal_order_id, record_ids, items, item_total, shipping, total, customer_id, ship_country)
     VALUES ($1, $2::int[], $3::jsonb, $4, $5, $6, $7, $8)`,
    [r.data.id, ids, JSON.stringify(items), money(itemCents), money(shipCents), money(itemCents + shipCents), customerId(req), country],
  );
  send(res, 200, { id: r.data.id });
}

async function captureOrder(req, res) {
  const orderID = String(req.body?.orderID || '');
  const sql = db();
  const orders = await sql.query(`SELECT * FROM orders WHERE paypal_order_id = $1 AND status = 'created'`, [orderID]);
  const order = orders[0];
  if (!order) return send(res, 404, { error: 'Bestellung nicht gefunden.' });
  const ids = order.record_ids;

  // Vor dem Abbuchen prüfen: Passt die PayPal-Lieferadresse zur Versandzone, die im Warenkorb gewählt wurde?
  const check = await paypal(`/v2/checkout/orders/${encodeURIComponent(orderID)}`, null, 'GET');
  const addrCountry = check.data?.purchase_units?.[0]?.shipping?.address?.country_code;
  const chosen = order.ship_country || 'DE';
  if (!check.ok || zoneOf(addrCountry) == null || zoneOf(addrCountry) !== zoneOf(chosen)) {
    await sql.query(`UPDATE orders SET status = 'failed' WHERE id = $1`, [order.id]);
    const blocked = addrCountry && zoneOf(addrCountry) == null;
    return send(res, 422, {
      error: blocked
        ? 'In das Land deiner PayPal-Lieferadresse können wir leider nicht liefern. Es wurde nichts abgebucht.'
        : 'Deine PayPal-Lieferadresse liegt in einem anderen Land als im Warenkorb ausgewählt. Bitte wähle im Warenkorb das richtige Lieferland und bezahle erneut. Es wurde nichts abgebucht.',
      issue: 'COUNTRY',
    });
  }

  // Platten reservieren, damit sie nicht doppelt verkauft werden
  const reserved = await sql.query(
    `UPDATE records SET status = 'reserved', updated_at = now()
     WHERE id = ANY($1::int[]) AND status = 'available' RETURNING id`,
    [ids],
  );
  const release = (list) => sql.query(
    `UPDATE records SET status = 'available', updated_at = now() WHERE id = ANY($1::int[]) AND status = 'reserved'`,
    [list],
  );
  if (reserved.length !== ids.length) {
    await release(reserved.map((r) => r.id));
    await sql.query(`UPDATE orders SET status = 'failed' WHERE id = $1`, [order.id]);
    return send(res, 409, { error: 'Leider wurde eine der Platten in der Zwischenzeit verkauft. Es wurde nichts abgebucht.' });
  }

  let r;
  try {
    r = await paypal(`/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`);
  } catch (e) {
    await release(ids);
    throw e;
  }
  if (!r.ok || r.data.status !== 'COMPLETED') {
    await release(ids);
    const issue = r.data?.details?.[0]?.issue || '';
    return send(res, 422, { error: 'Die Zahlung wurde nicht abgeschlossen.', issue });
  }

  const unit = r.data.purchase_units?.[0] || {};
  const payer = r.data.payer || {};
  const name = unit.shipping?.name?.full_name
    || [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(' ');
  await sql.query(
    `UPDATE records SET status = 'sold', sold_at = now(), updated_at = now() WHERE id = ANY($1::int[])`,
    [ids],
  );
  await sql.query(
    `UPDATE orders SET status = 'completed', completed_at = now(),
       payer_email = $2, payer_name = $3, shipping_address = $4::jsonb WHERE id = $1`,
    [order.id, payer.email_address || null, name || null, JSON.stringify(unit.shipping?.address || null)],
  );
  send(res, 200, { ok: true, name, total: order.total });
}
