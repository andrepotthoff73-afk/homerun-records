// Lokale Vorschau von Homerun Records – nur zum Ausprobieren auf dem eigenen Rechner.
// Nutzt eine Datenbank im Arbeitsspeicher (PGlite) statt Neon. Daten gehen beim Beenden verloren.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT) || 4321;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const app = path.join(os.tmpdir(), 'homerun-records-vorschau');

// Projekt in einen Temp-Ordner kopieren und die Datenbank gegen PGlite tauschen
fs.rmSync(app, { recursive: true, force: true });
fs.cpSync(root, app, {
  recursive: true,
  filter: (src) => !/[\\/](vorschau|node_modules|\.git|\.vercel)([\\/]|$)/.test(src.slice(root.length)),
});
fs.writeFileSync(path.join(app, 'api', '_lib', 'db.js'),
  fs.readFileSync(path.join(root, 'api', '_lib', 'db.js'), 'utf8')
    .replace("import { neon } from '@neondatabase/serverless';", "import { PGlite } from '@electric-sql/pglite';\nconst pg = new PGlite();")
    .replace(/client = neon\(url\);/, 'client = { query: async (t, p) => (await pg.query(t, p)).rows };')
    .replace(/if \(!url\) throw[^\n]*\n/, ''));
fs.symlinkSync(path.join(here, 'node_modules'), path.join(app, 'node_modules'), 'junction');

process.env.ADMIN_PASSWORD ||= 'vorschau12345';
const handlers = {};
for (const n of ['shop', 'paypal', 'admin']) handlers[n] = (await import(pathToFileURL(path.join(app, 'api', `${n}.js`)))).default;

// Beispielplatten anlegen
const { db, ensureSchema } = await import(pathToFileURL(path.join(app, 'api', '_lib', 'db.js')));
await ensureSchema();
const demo = [
  ['The Beatles', 'Abbey Road', 'Parlophone', 'PCS 7088', 'LP, Album, RE', '1969', 24.9, 'Very Good Plus (VG+)', 'Very Good (VG)'],
  ['Pink Floyd', 'The Dark Side Of The Moon', 'Harvest', 'SHVL 804', 'LP, Album', '1973', 38.5, 'Near Mint (NM or M-)', 'Very Good Plus (VG+)'],
  ['Miles Davis', 'Kind Of Blue', 'Columbia', 'CL 1355', 'LP, Album, Mono', '1959', 45, 'Very Good (VG)', 'Good Plus (G+)'],
  ['Fleetwood Mac', 'Rumours', 'Warner Bros. Records', 'K 56344', 'LP, Album', '1977', 19.95, 'Very Good Plus (VG+)', 'Very Good Plus (VG+)'],
  ['David Bowie', 'Heroes', 'RCA Victor', 'PL 12522', 'LP, Album', '1977', 29, 'Near Mint (NM or M-)', 'Very Good Plus (VG+)'],
  ['Kraftwerk', 'Das Model', 'EMI', '1C 006-46 155', '7", Single', '1981', 6.5, 'Very Good Plus (VG+)', 'Very Good (VG)'],
];
const demoMeta = [
  ['UK', ['A1\tCome Together', 'A2\tSomething', "A3\tMaxwell's Silver Hammer", 'B1\tHere Comes The Sun', 'B2\tBecause']],
  ['UK', ['A1\tSpeak To Me', 'A2\tBreathe', 'A3\tOn The Run', 'A4\tTime', 'B1\tMoney', 'B2\tUs And Them', 'B5\tEclipse']],
  ['US', ['A1\tSo What', 'A2\tFreddie Freeloader', 'A3\tBlue In Green', 'B1\tAll Blues', 'B2\tFlamenco Sketches']],
  ['UK', ['A1\tSecond Hand News', 'A2\tDreams', "A3\tNever Going Back Again", "B1\tGo Your Own Way", 'B5\tThe Chain']],
  ['Germany', ['A1\tBeauty And The Beast', 'A3\tHeroes', 'B1\tV-2 Schneider', 'B5\tThe Secret Life Of Arabia']],
  ['Germany', ['A\tDas Model', 'B\tWindow Shopper']],
];
for (const [i, d] of demo.entries()) {
  await db().query(
    `INSERT INTO records (import_key, artist, title, label, catno, format, released, avg_price, price, media_condition, sleeve_condition, country, tracks, batch)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Vorschau') ON CONFLICT DO NOTHING`,
    [`demo${i}`, ...d.slice(0, 6), d[6], Math.round(d[6] * 90) / 100, d[7], d[8], demoMeta[i][0], demoMeta[i][1].join('\n')],
  );
}

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.csv': 'text/csv', '.txt': 'text/plain' };
http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/api/')) {
      const h = handlers[u.pathname.slice(5).replace(/\.js$/, '')];
      if (!h) { res.statusCode = 404; return res.end('404'); }
      req.query = Object.fromEntries(u.searchParams);
      let raw = '';
      for await (const c of req) raw += c;
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
      return await h(req, res);
    }
    let p = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    if (!path.extname(p)) p += '.html';
    const f = path.join(app, p);
    if (!f.startsWith(app) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('Seite nicht gefunden'); }
    res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('Fehler');
  }
}).listen(PORT, () => {
  console.log('');
  console.log('  Homerun Records Vorschau laeuft:');
  console.log(`  Shop:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin   (Passwort: ${process.env.ADMIN_PASSWORD})`);
  console.log('');
  console.log('  Zum Beenden dieses Fenster schliessen.');
});
