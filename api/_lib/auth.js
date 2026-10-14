import crypto from 'node:crypto';

const COOKIE = 'hr_admin';
const DAYS = 14;

const secret = () => process.env.SESSION_SECRET || `hr:${process.env.ADMIN_PASSWORD || ''}`;
const sign = (v) => crypto.createHmac('sha256', secret()).update(v).digest('base64url');

function makeToken() {
  const v = `admin.${Date.now() + DAYS * 864e5}`;
  return `${v}.${sign(v)}`;
}

function verify(token) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  const v = token.slice(0, i);
  const exp = Number(v.split('.')[1]);
  if (!exp || exp < Date.now()) return false;
  const a = Buffer.from(token.slice(i + 1));
  const b = Buffer.from(sign(v));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

export const isAdmin = (req) => verify(getCookie(req, COOKIE));

export const passwordConfigured = () => String(process.env.ADMIN_PASSWORD || '').length >= 10;

export function checkPassword(pw) {
  if (!passwordConfigured()) return false;
  const a = crypto.createHash('sha256').update(String(pw || '')).digest();
  const b = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

export function setSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=${makeToken()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${DAYS * 86400}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
