const base = () =>
  process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

async function accessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal ist noch nicht eingerichtet.');
  const r = await fetch(`${base()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('PayPal-Anmeldung fehlgeschlagen – Client-ID/Secret und PAYPAL_MODE prüfen.');
  return j.access_token;
}

export async function paypal(path, body) {
  const token = await accessToken();
  const r = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
