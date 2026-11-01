// Homerun Records – Marktpreise für den Shop
// Holt sich die wartenden Platten vom Shop, öffnet für jede die Discogs-Verkaufsseite in einem echten
// Browser (Microsoft Edge auf diesem PC), nimmt die ersten 10 Angebote von Verkäufern aus Deutschland,
// füllt fehlende mit Angeboten aus anderen Ländern auf, bildet den Durchschnitt und meldet ihn an den Shop.
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (n) => Math.round(n * 100) / 100;
const DISCOGS = process.env.HR_DISCOGS_BASE || 'https://www.discogs.com';
const WANT = 10; // so viele Angebote werden gemittelt
const GERMANY = /^(germany|deutschland)$/i;

export function createMarket({ dataDir, outRoot, getSettings, saveSettings, rates, loadRates }) {
  const profileDir = path.join(dataDir, 'edge-profil');
  const debugDir = path.join(outRoot, 'debug');
  const state = {
    state: 'idle', // idle | running | stopping | stopped | error
    note: '', error: '', needLogin: false, challenge: false,
    done: 0, remaining: null, waiting: null, results: [], started: 0,
  };
  let browserObj = null;
  let page = null;
  let runToken = 0;
  const skip = new Set();

  // ---------- Shop ----------
  // Nur Protokoll + Domain verwenden, z. B. aus „https://…vercel.app/admin“ wird „https://…vercel.app“
  const site = () => {
    const raw = String(getSettings().site || '').trim();
    try { return new URL(raw).origin; } catch { return raw.replace(/\/+$/, ''); }
  };
  async function shop(action, { body, query = '' } = {}) {
    const s = getSettings();
    const r = await fetch(`${site()}/api/admin?action=${action}${query}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(s.shopCookie ? { Cookie: s.shopCookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { const e = new Error('Anmeldung beim Shop abgelaufen – bitte Passwort eingeben.'); e.login = true; throw e; }
    if (!r.ok) throw new Error(j.error || `Website antwortet mit Fehler ${r.status}`);
    return { j, setCookie: r.headers.get('set-cookie') || '' };
  }

  async function login(password) {
    if (!/^https?:\/\//.test(site())) throw new Error('Bitte zuerst die Adresse deiner Website eintragen.');
    const { setCookie } = await shop('login', { body: { password } });
    const cookie = (setCookie.match(/hr_admin=[^;]+/) || [])[0];
    if (!cookie) throw new Error('Anmeldung fehlgeschlagen.');
    // Nur die Sitzung (14 Tage gültig) wird gespeichert, nicht das Passwort
    saveSettings({ shopCookie: cookie });
    state.needLogin = false;
    state.error = '';
  }

  // ---------- Browser ----------
  // Edge wird ganz normal als eigenes Programm gestartet (wie per Doppelklick) und das Tool verbindet
  // sich erst danach. So fehlen die Automatik-Kennzeichen, an denen Cloudflare ferngesteuerte Browser erkennt.
  let proc = null;
  const PORT = Number(process.env.HR_BROWSER_PORT) || 9333;
  const cdpUp = () => fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.ok).catch(() => false);
  function browserPath() {
    if (process.env.HR_BROWSER_PATH) return process.env.HR_BROWSER_PATH;
    const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    const rel = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe'];
    for (const r of rel) for (const base of pf) {
      const f = path.join(base, r);
      if (fs.existsSync(f)) return f;
    }
    return '';
  }
  // Beim Schließen des Preis-Tool-Fensters auch Edge schließen
  const killBrowser = () => { try { proc?.kill(); } catch { /* egal */ } };
  process.on('exit', killBrowser);
  for (const sig of ['SIGINT', 'SIGHUP', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => { killBrowser(); process.exit(0); });
  async function openBrowser() {
    if (page && !page.isClosed()) return;
    let chromium;
    try { ({ chromium } = await import('playwright-core')); } catch {
      throw new Error('Browser-Steuerung fehlt. Bitte das Preis-Tool schließen und neu starten (es richtet sich dann selbst ein).');
    }
    if (!browserObj && await cdpUp()) {
      // Edge vom letzten Lauf ist noch offen → wiederverwenden
      try {
        browserObj = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
        browserObj.on('disconnected', () => { browserObj = null; page = null; });
      } catch {
        browserObj = null;
        for (let i = 0; i < 20 && await cdpUp(); i++) await sleep(500); // wird gerade geschlossen
      }
    }
    if (!browserObj) {
      const exe = browserPath();
      if (!exe) throw new Error('Microsoft Edge wurde auf diesem PC nicht gefunden.');
      const visible = Boolean(getSettings().marketVisible);
      const args = [
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run', '--no-default-browser-check', '--disable-features=msEdgeSidebarV2',
        ...(visible ? [] : ['--start-minimized']),
        ...(process.env.HR_HEADLESS === '1' ? ['--headless=new', '--no-sandbox'] : []),
        'about:blank',
      ];
      const { spawn } = await import('node:child_process');
      proc = spawn(exe, args, { stdio: 'ignore', detached: false });
      proc.on('exit', () => { proc = null; browserObj = null; page = null; });
      // Warten, bis Edge bereit ist
      let ok = false;
      for (let i = 0; i < 90 && !ok; i++) {
        await sleep(500);
        ok = await cdpUp();
      }
      if (!ok) { try { proc?.kill(); } catch { /* egal */ } throw new Error('Microsoft Edge konnte nicht gestartet werden.'); }
      browserObj = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
      browserObj.on('disconnected', () => { browserObj = null; page = null; });
    }
    const context = browserObj.contexts()[0] || await browserObj.newContext();
    page = context.pages().find((p) => !p.isClosed()) || await context.newPage();
  }
  async function closeBrowser() {
    const b = browserObj;
    const p = proc;
    browserObj = null;
    page = null;
    proc = null;
    // Edge über die Verbindung beenden (ein reines Trennen ließe das Fenster offen)
    try { const cdp = await b?.newBrowserCDPSession(); await cdp?.send('Browser.close'); } catch { /* schon zu */ }
    try { await b?.close(); } catch { /* schon zu */ }
    try { p?.kill(); } catch { /* schon zu */ }
    // Warten, bis Edge wirklich zu ist
    for (let i = 0; i < 20 && await cdpUp(); i++) await sleep(500);
  }

  // Seite laden; bei der „Bist du ein Mensch?“-Prüfung das Fenster zeigen und warten
  async function load(url, token) {
    await openBrowser();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Discogs bremst: „Too many requests“ → Aufrufer wartet und versucht es später erneut
    const tooMany = async () => resp?.status() === 429
      || /too many requests|retry later|zu viele anfragen/i.test(await page.evaluate(() => (document.body?.innerText || '').slice(0, 300)).catch(() => ''));
    if (await tooMany()) { const e = new Error('Discogs meldet zu viele Abrufe'); e.rateLimit = true; throw e; }
    const deadline = Date.now() + 5 * 60000;
    let shown = false;
    for (;;) {
      if (token !== runToken) throw new Error('angehalten');
      const title = await page.title().catch(() => '');
      const challenge = /just a moment|einen moment|attention required|nur einen moment|bitte warten/i.test(title)
        || await page.locator('#challenge-running, #challenge-form, iframe[src*="challenges.cloudflare.com"]').count().catch(() => 0) > 0;
      if (!challenge) break;
      state.challenge = true;
      state.note = 'Discogs prüft, ob ein Mensch am Rechner sitzt – bitte im Edge-Fenster die Prüfung bestätigen.';
      if (!shown) { shown = true; await page.bringToFront().catch(() => {}); }
      if (Date.now() > deadline) throw new Error('Die Discogs-Prüfung wurde nicht bestätigt.');
      await sleep(1500);
    }
    if (state.challenge) { state.challenge = false; state.note = ''; }
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    await page.waitForSelector('table.mpitems, tr.shortcut_navigable, .no_items, [class*="noResults"], [class*="empty"]', { timeout: 15000 }).catch(() => {});
  }

  // Angebote aus der geladenen Verkaufsseite lesen (in der Reihenfolge, in der sie erscheinen)
  async function readOffers() {
    return page.evaluate(() => {
      const rows = [...new Set([...document.querySelectorAll('table.mpitems tbody tr, tr.shortcut_navigable')])];
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      const offers = rows.map((tr) => {
        const pe = tr.querySelector('.price[data-pricevalue]') || tr.querySelector('span.price, .price');
        let shipsFrom = '';
        for (const li of tr.querySelectorAll('li')) {
          const lab = li.querySelector('.mplabel');
          if (lab && /ships from|versand aus|versand von|versendet aus/i.test(lab.textContent)) shipsFrom = txt(li).replace(txt(lab), '').trim();
        }
        const link = tr.querySelector('a.item_link, a[href*="/sell/item/"]');
        const item = ((link && link.getAttribute('href')) || '').match(/\/sell\/item\/(\d+)/)?.[1] || '';
        const relLink = tr.querySelector('a[href*="/release/"]');
        const rel = tr.dataset.releaseId || ((relLink && relLink.getAttribute('href')) || '').match(/\/release\/(\d+)/)?.[1] || '';
        const condEl = tr.querySelector('.item_condition');
        let cond = '';
        if (condEl) {
          const spans = [...condEl.querySelectorAll('span')].map(txt).filter((t) => /\((M|NM|VG\+?|G\+?|F|P)[^)]*\)|mint|good|fair|poor/i.test(t));
          cond = spans[0] || '';
        }
        return {
          value: pe ? pe.getAttribute('data-pricevalue') : null,
          currency: pe ? pe.getAttribute('data-currency') : null,
          text: txt(pe),
          converted: txt(tr.querySelector('.converted_price')),
          shipsFrom, item, rel, cond,
        };
      });
      // Neue Marktplatz-Ansicht (Karten statt Tabelle)
      for (const c of document.querySelectorAll('.msr-listing-card')) {
        const itemA = c.querySelector('a[href*="/item/"]');
        const relA = c.querySelector('a[href*="/release/"]');
        offers.push({
          value: null, currency: null,
          text: txt(c.querySelector('.msr-listing-card-price')),
          converted: '',
          shipsFrom: txt(c.querySelector('.msr-listing-card-ships-from-country')),
          item: ((itemA && itemA.getAttribute('href')) || '').match(/\/item\/(\d+)/)?.[1] || '',
          rel: ((relA && relA.getAttribute('href')) || '').match(/\/release\/(\d+)/)?.[1] || '',
          cond: txt(c.querySelector('.hifi-grade-chip-label')),
          labels: txt(c.querySelector('.msr-listing-card-labels')),
        });
      }
      const body = document.body ? document.body.innerText : '';
      const empty = /no items for sale|keine artikel|nothing for sale|0 items|keine angebote/i.test(body);
      return { offers: offers.filter((o) => o.value || o.text), empty, title: document.title };
    });
  }

  // Preis eines Angebots in Euro
  const SYMBOLS = { '€': 'EUR', $: 'USD', 'US$': 'USD', '£': 'GBP', '¥': 'JPY', 'A$': 'AUD', 'CA$': 'CAD', 'C$': 'CAD', 'NZ$': 'NZD', CHF: 'CHF', SEK: 'SEK', 'R$': 'BRL', DKK: 'DKK', 'MX$': 'MXN', ZAR: 'ZAR' };
  const parseNum = (s) => {
    let t = String(s || '').replace(/[^\d.,]/g, '');
    if (!t) return null;
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  };
  function toEur(o) {
    const R = rates();
    let cur = String(o.currency || '').trim();
    if (cur && !/^[A-Z]{3}$/.test(cur)) cur = SYMBOLS[cur] || '';
    if (!cur) {
      const sym = Object.keys(SYMBOLS).sort((a, b) => b.length - a.length).find((k) => o.text.includes(k));
      cur = sym ? SYMBOLS[sym] : '';
    }
    const value = o.value != null && o.value !== '' ? Number(o.value) : parseNum(o.text);
    if (Number.isFinite(value) && cur && R[cur]) return round2(value / R[cur]);
    // Notlösung: von Discogs umgerechneter Euro-Betrag („ca. €12,34“)
    if (/€|eur/i.test(o.converted)) return parseNum(o.converted);
    return null;
  }

  // Verkaufsseite einer Pressung (Release-ID). Der Länderfilter „ships_from“ wirkt hier zuverlässig.
  function sellUrl(releaseId, germanyOnly) {
    const qs = new URLSearchParams();
    if (germanyOnly) qs.set('ships_from', 'Germany');
    qs.set('limit', '50');
    return `${DISCOGS}/sell/release/${releaseId}?${qs}`;
  }

  // Ohne Release-ID: auf dem Marktplatz nach Künstler + Titel suchen und die Pressung nehmen,
  // deren Katalognummer passt (die Marktplatz-Suche selbst kennt keine Katalognummern).
  const normCat = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  async function findRelease(rec, token) {
    const cat = normCat(String(rec.catno || '').split(',')[0]);
    if (!cat) return '';
    const qs = new URLSearchParams({ q: [rec.artist, rec.title].filter(Boolean).join(' '), formatName: 'Vinyl' });
    await load(`${DISCOGS}/shop/list?${qs}`, token);
    const { offers } = await readOffers();
    const counts = {};
    for (const o of offers) {
      if (!o.rel) continue;
      const cats = String(o.labels || '').split(/[,•]/).map(normCat);
      if (cats.includes(cat) || normCat(o.labels).includes(cat)) counts[o.rel] = (counts[o.rel] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }

  function saveDebug(rec, html, why) {
    try {
      fs.mkdirSync(debugDir, { recursive: true });
      const f = path.join(debugDir, `platte-${rec.id}.html`);
      fs.writeFileSync(f, `<!-- ${why} -->\n${html}`);
      return f;
    } catch { return ''; }
  }

  async function priceRecord(rec, token) {
    let releaseId = rec.release_id ? String(rec.release_id) : '';
    if (!releaseId) {
      if (!rec.catno) return { offers: [], error: 'Weder Release-ID noch Katalognummer – Preis bitte von Hand eintragen' };
      releaseId = await findRelease(rec, token);
      if (!releaseId) return { offers: [], error: `Pressung mit Katalognummer „${rec.catno}“ auf dem Marktplatz nicht gefunden – bitte Release-ID prüfen oder Preis von Hand eintragen` };
      await sleep(2000 + Math.random() * 2000);
    }
    const used = [];
    const seen = new Set();
    // onlyGermany: true = nur Verkäufer aus Deutschland, false = alle übrigen zum Auffüllen
    const take = (list, onlyGermany) => {
      for (const o of list) {
        if (used.length >= WANT) break;
        const key = o.item || `${o.value}|${o.text}|${o.shipsFrom}|${o.cond}`;
        if (seen.has(key)) continue;
        if (onlyGermany && o.shipsFrom && !GERMANY.test(o.shipsFrom)) continue;
        if (!onlyGermany && GERMANY.test(o.shipsFrom) && !o.item) continue;
        const eur = toEur(o);
        if (eur == null || eur <= 0) continue;
        seen.add(key);
        used.push({ eur, country: o.shipsFrom || (onlyGermany ? 'Germany' : ''), condition: o.cond, item: o.item });
      }
    };
    // 1. Nur Verkäufer aus Deutschland
    const deUrl = sellUrl(releaseId, true);
    await load(deUrl, token);
    const de = await readOffers();
    take(de.offers, true);
    // 2. Weniger als 10 → mit Angeboten aus anderen Ländern auffüllen
    let all = null;
    if (used.length < WANT) {
      await sleep(4000 + Math.random() * 3000);
      await load(sellUrl(releaseId, false), token);
      all = await readOffers();
      take(all.offers, false);
    }
    if (!used.length) {
      const title = (all || de).title || '';
      if (!/zu verkaufen|for sale|marktplatz|marketplace/i.test(title)) {
        // Seite sah anders aus als erwartet → zur Fehlersuche speichern
        const f = saveDebug(rec, await page.content().catch(() => ''), 'keine Angebote erkannt');
        return { offers: [], url: deUrl, releaseId, technical: true, error: `Angebote auf der Seite nicht erkannt${f ? ` (gespeichert: Ergebnisse/debug/${path.basename(f)})` : ''}` };
      }
      return { offers: [], url: deUrl, releaseId, error: 'Keine Angebote auf dem Marktplatz – bleibt Entwurf, Preis bitte von Hand eintragen' };
    }
    return { offers: used, url: deUrl, releaseId };
  }

  // ---------- Ablauf ----------
  async function run(token) {
    await loadRates();
    while (token === runToken && state.state === 'running') {
      let next;
      try {
        ({ j: next } = await shop('market-next', { query: `&skip=${[...skip].join(',')}` }));
      } catch (e) {
        if (e.login) { state.needLogin = true; state.state = 'stopped'; state.error = e.message; break; }
        state.note = `Website nicht erreichbar (${e.message}) – neuer Versuch in 30 Sekunden`;
        await sleep(30000);
        continue;
      }
      state.remaining = next.remaining;
      state.waiting = next.waiting;
      if (!next.record && next.enriched) {
        // Der Shop hat gerade Cover & Daten einer Platte geladen – gleich nochmal fragen
        state.note = 'Shop lädt Cover & Daten der nächsten Platte …';
        await sleep(1500);
        continue;
      }
      if (!next.record) {
        // Nichts zu tun: Browser schließen und regelmäßig nachsehen
        await closeBrowser();
        state.note = next.waiting
          ? `Alle bisherigen Platten bepreist. ${next.waiting} Platte(n) warten im Admin-Bereich noch auf die Zustandsangabe – ich schaue jede Minute nach.`
          : 'Alle Platten bepreist. Ich schaue jede Minute nach neuen Platten.';
        for (let i = 0; i < 60 && token === runToken; i++) await sleep(1000);
        continue;
      }
      const rec = next.record;
      state.note = `Lese Angebote: ${rec.artist} – ${rec.title}`;
      const t0 = Date.now();
      let result;
      try {
        result = await priceRecord(rec, token);
      } catch (e) {
        if (token !== runToken) break;
        if (e.rateLimit) {
          // Discogs bremst → 3 Minuten Pause, dann dieselbe Platte erneut
          await closeBrowser();
          for (let w = 180; w > 0 && token === runToken; w--) {
            state.note = `Discogs meldet zu viele Abrufe – Pause, weiter in ${Math.ceil(w / 60)} Min.`;
            await sleep(1000);
          }
          continue;
        }
        // Technisches Problem (Browser, Internet) → diese Platte später nochmal
        skip.add(rec.id);
        state.results.unshift({ ...rec, error: e.message.split('\n')[0], at: Date.now() });
        await closeBrowser();
        await sleep(10000);
        continue;
      }
      if (result.technical) skip.add(rec.id);
      else {
        try {
          const { j } = await shop('market-price', { body: { id: rec.id, offers: result.offers, url: result.url, releaseId: result.releaseId, error: result.error } });
          Object.assign(result, j);
          state.done++;
        } catch (e) {
          if (e.login) { state.needLogin = true; state.state = 'stopped'; state.error = e.message; break; }
          skip.add(rec.id);
          result.error = e.message;
        }
      }
      state.results.unshift({ ...rec, ...result, at: Date.now(), ms: Date.now() - t0 });
      state.results.length = Math.min(state.results.length, 300);
      // Schonend abrufen: 8–12 Sekunden Pause zwischen zwei Platten
      const pause = 8000 + Math.random() * 4000;
      state.note = 'kurze Pause …';
      for (let w = 0; w < pause && token === runToken; w += 500) await sleep(500);
    }
    if (token === runToken && state.state === 'stopping') state.state = 'stopped';
    if (token === runToken) await closeBrowser();
  }

  return {
    state,
    async start(password) {
      if (state.state === 'running') return;
      state.error = '';
      if (password) await login(password);
      if (!getSettings().shopCookie) { state.needLogin = true; throw new Error('Bitte einmal das Admin-Passwort deiner Website eingeben.'); }
      // Anmeldung prüfen, bevor der Browser startet
      try { await shop('market-next', { query: '&skip=' }); } catch (e) {
        if (e.login) { state.needLogin = true; saveSettings({ shopCookie: '' }); }
        throw e;
      }
      skip.clear();
      state.state = 'running';
      state.started = Date.now();
      state.done = 0;
      const token = ++runToken;
      run(token).catch((e) => { state.state = 'error'; state.error = e.message; closeBrowser(); });
    },
    async stop() {
      if (state.state !== 'running') return;
      state.state = 'stopped';
      state.note = 'Angehalten.';
      runToken++;
      await closeBrowser();
    },
    async logout() { saveSettings({ shopCookie: '' }); state.needLogin = true; },
    // Für Tests: eine einzelne Platte bepreisen, ohne etwas an den Shop zu melden
    async test(rec) {
      if (state.state === 'running') throw new Error('Bitte zuerst anhalten.');
      const token = runToken;
      await loadRates();
      try { return await priceRecord(rec, token); } finally { if (state.state !== 'running') await closeBrowser(); }
    },
  };
}
