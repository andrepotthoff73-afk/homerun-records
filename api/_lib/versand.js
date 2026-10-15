// Versandzonen und -preise je Paket (max. 8 Platten pro Paket).
// Auslandspreise: DHL „Paket bis 5 kg“, Online-Frankierung Privatkunden (Stand Oktober 2026, dhl.de).
// Deutschland: eigener Preis aus SHIPPING_EUR.

export const ZONE_PRICES = { 1: 17.49, 2: 26.99, 3: 29.99, 5: 47.99, 6: 37.99, 7: 45.99, 8: 55.99 };

export const ZONE_NAMES = {
  DE: 'Deutschland',
  1: 'EU',
  2: 'Schweiz & Großbritannien',
  3: 'Übriges Europa',
  5: 'Amerika',
  6: 'Naher Osten & Nordafrika',
  7: 'Asien & Afrika',
  8: 'Australien, Ozeanien & übrige Welt',
};

const ZONES = {
  1: 'AT BE BG CY CZ DK EE ES FI FR GR HR HU IE IT LT LU LV MC MT NL PL PT RO SE SI SK',
  2: 'CH GB',
  3: 'AD AL AX BA FO GG GI IS JE LI MD ME MK NO RS SM TR UA VA XK',
  5: 'AG AI AR AW BB BL BM BO BQ BR BS BZ CA CL CO CR CW DM DO EC FK GD GF GL GP GS GT GY HN HT JM KN KY LC MF MQ MS MX NI PA PE PM PR PY SR SV SX TC US UY VC VE VG VI',
  6: 'DZ EG IL JO LB LY MA PS TN',
  7: 'AE AF AM AO AZ BD BF BH BI BJ BN BT BW CD CF CG CI CM CN CV DJ ER ET GA GE GH GM GN GQ GW HK ID IN IQ JP KE KG KH KM KR KW KZ LA LK LR LS MG ML MM MN MO MR MU MV MW MY MZ NA NE NG NP OM PH PK QA RE RW SA SC SD SG SH SL SN ST SZ TD TG TH TJ TL TT TW TZ UG UZ VN YE YT ZA ZM ZW',
  8: 'AS AU CK FJ FM GU KI MH MP NC NR NU NZ PF PG PN PW SB SO SS TK TO TV VU WF WS',
};

// Kein Versand (Sanktionen bzw. kein PayPal verfügbar)
const BLOCKED = new Set('RU BY KP IR SY CU'.split(' '));

const ZONE_OF = {};
for (const [zone, list] of Object.entries(ZONES)) for (const cc of list.split(' ')) ZONE_OF[cc] = Number(zone);

// Zone eines Landes (ISO-Code): 'DE', 1–8 oder null (kein Versand). Nicht gelistete Länder → Zone 8 (wie bei DHL).
export function zoneOf(country) {
  const cc = String(country || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || BLOCKED.has(cc)) return null;
  if (cc === 'DE') return 'DE';
  return ZONE_OF[cc] || 8;
}

// Alle Länder, in die geliefert wird (für die Auswahl im Warenkorb)
export function shippableCountries() {
  return ['DE', ...Object.keys(ZONE_OF)].filter((cc) => !BLOCKED.has(cc));
}
