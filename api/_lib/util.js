import { zoneOf, ZONE_PRICES } from './versand.js';

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
    // Versand: pro Paket (max. 8 Platten je Paket) 7,50 €
    shipping: num(process.env.SHIPPING_EUR, 7.5),
    perPackage: Math.max(1, parseInt(process.env.SHIPPING_PER_PACKAGE, 10) || 8),
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

// Preis je Paket (in Cent) für ein Lieferland, null = kein Versand dorthin
export function packagePrice(country = 'DE') {
  const zone = zoneOf(country);
  if (zone == null) return null;
  return zone === 'DE' ? cents(settings().shipping) : cents(ZONE_PRICES[zone]);
}

// Versandkosten: je angefangene 8 Platten ein Paket. Versandkostenfrei-Grenze gilt nur für Deutschland.
export function shippingFor(itemCents, count = 1, country = 'DE') {
  const s = settings();
  const price = packagePrice(country);
  if (price == null) return null;
  if (zoneOf(country) === 'DE' && s.freeFrom > 0 && itemCents >= cents(s.freeFrom)) return 0;
  return Math.ceil(Math.max(1, count) / s.perPackage) * price;
}
