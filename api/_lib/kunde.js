// Kunden-Anmeldung: Passwörter mit scrypt, Sitzung als signiertes HttpOnly-Cookie
import crypto from 'node:crypto';

const COOKIE = 'hr_kunde';
const DAYS = 30;

const secret = () => `kunde:${process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'lokal'}`;
const sign = (v) => crypto.createHmac('sha256', secret()).update(v).digest('base64url');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

export function checkPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const a = crypto.scryptSync(String(pw || ''), salt, 64);
  const b = Buffer.from(hash, 'base64url');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return '';
}

// Liefert die Kunden-ID aus dem Cookie oder null
export function customerId(req) {
  const token = readCookie(req);
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const v = token.slice(0, i);
  const [kind, id, exp] = v.split('.');
  if (kind !== 'k' || !(Number(exp) > Date.now())) return null;
  const a = Buffer.from(token.slice(i + 1));
  const b = Buffer.from(sign(v));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? Number(id) : null;
}

export function setCustomerSession(res, id) {
  const v = `k.${id}.${Date.now() + DAYS * 864e5}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${v}.${sign(v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`);
}

export function clearCustomerSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
