// Kontaktformular: Nachricht speichern und per E-Mail an CONTACT_TO (Standard info@myrecords.online) senden.
// Mailversand über SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in Vercel). Ohne SMTP wird nur gespeichert
// und die Nachricht erscheint im Admin-Bereich unter „Nachrichten“.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { db, ensureSchema } from './_lib/db.js';
import { send, isJson } from './_lib/util.js';

const TO = process.env.CONTACT_TO || 'info@myrecords.online';
const clean = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/\n+/g, ' ');
const emailOk = (e) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(e);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' || !isJson(req)) return send(res, 405, { error: 'Nur POST/JSON erlaubt' });
  try {
    const b = req.body || {};
    // Spam-Schutz: verstecktes Feld muss leer sein, Formular muss mind. 3 Sekunden offen gewesen sein
    if (b.website || (Number(b.t) && Date.now() - Number(b.t) < 3000)) return send(res, 200, { ok: true });

    const name = oneLine(b.name, 100);
    const email = oneLine(b.email, 200);
    const subject = oneLine(b.subject, 150);
    const body = clean(b.message, 5000);
    if (!name || !body) return send(res, 400, { error: 'Bitte Name und Nachricht ausfüllen.' });
    if (!emailOk(email)) return send(res, 400, { error: 'Bitte eine gültige E-Mail-Adresse angeben.' });

    await ensureSchema();
    const sql = db();
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ipHash = crypto.createHash('sha256').update(`${ip}|${process.env.SESSION_SECRET || ''}`).digest('hex').slice(0, 32);
    const [{ n }] = await sql.query(
      `SELECT count(*)::int AS n FROM messages WHERE ip_hash = $1 AND created_at > now() - interval '1 hour'`, [ipHash]);
    if (n >= 5) return send(res, 429, { error: 'Zu viele Nachrichten. Bitte versuche es später noch einmal.' });

    const [{ id }] = await sql.query(
      `INSERT INTO messages (name, email, subject, body, ip_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, email, subject || null, body, ipHash]);

    let mailed = false;
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        const port = parseInt(process.env.SMTP_PORT, 10) || 465;
        const tx = nodemailer.createTransport({
          host: process.env.SMTP_HOST, port, secure: port === 465,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        await tx.sendMail({
          from: { name: 'myrecords Kontaktformular', address: process.env.SMTP_FROM || process.env.SMTP_USER },
          to: TO,
          replyTo: { name, address: email },
          subject: `Kontaktformular: ${subject || 'Neue Nachricht'}`,
          text: `Name: ${name}\nE-Mail: ${email}\nBetreff: ${subject || '–'}\n\n${body}\n\n— gesendet über das Kontaktformular auf myrecords`,
        });
        mailed = true;
        await sql.query('UPDATE messages SET mailed = true WHERE id = $1', [id]);
      } catch (e) {
        console.error('Mailversand fehlgeschlagen:', e.message);
      }
    }
    send(res, 200, { ok: true, mailed });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Die Nachricht konnte nicht gesendet werden. Bitte schreib direkt an ' + TO + '.' });
  }
}
