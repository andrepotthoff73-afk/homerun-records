export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

const num = (v, d) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : d;
};

export function settings() {
  return {
    shipping: num(process.env.SHIPPING_EUR, 5.9),
    freeFrom: num(process.env.FREE_SHIPPING_FROM, 0),
  };
}

export const cents = (v) => Math.round(Number(v) * 100);
export const money = (c) => (c / 100).toFixed(2);

export function intIds(list, max = 200) {
  const arr = Array.isArray(list) ? list : String(list || '').split(',');
  return [...new Set(arr.map((n) => parseInt(n, 10)).filter((n) => n > 0))].slice(0, max);
}

export const isJson = (req) => String(req.headers['content-type'] || '').includes('application/json');

export const likeEsc = (s) => String(s).replace(/[\\%_]/g, '\\$&');

export function shippingFor(itemCents) {
  const s = settings();
  if (s.freeFrom > 0 && itemCents >= cents(s.freeFrom)) return 0;
  return cents(s.shipping);
}
