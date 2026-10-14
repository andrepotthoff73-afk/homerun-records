# Homerun Records

Vinyl-Shop im Discogs-Stil mit passwortgeschütztem Admin-Bereich.

- **Shop** (`/`): einfache Suche nach Künstler, Album/Titel und Track, Filter (Format, Zustand, Preis), Listen- und Rasteransicht, Detailseiten mit Trackliste, Warenkorb
- **Erweiterte Suche** (`/suche`): Künstler, Album, Track, Label, Katalognummer, Format, Genre/Stil, Land, Jahr von–bis, Zustand Platte/Hülle, Preis, Sortierung – mit Live-Trefferzahl
- Auf der öffentlichen Website wird Discogs nirgends erwähnt (Preise heißen dort „Marktpreis“).
- **PayPal-Checkout** (`/cart`): Preise werden auf dem Server geprüft, bezahlte Platten werden **automatisch als verkauft markiert**
- **Admin** (`/admin`): CSV-Import aus Discogs (Preis = Discogs-Ø minus 10 %), Platten als verkauft markieren, Preise ändern, Bestellungen mit Lieferadresse ansehen, Cover von Discogs laden

Technik: statisches HTML/CSS/JS + 3 Vercel-Funktionen (`/api`) + Postgres-Datenbank (Neon, kostenloser Tarif reicht für 20.000 Platten).

---

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. Auf GitHub hochladen
1. Auf [github.com](https://github.com) ein neues **privates** Repository anlegen, z. B. `homerun-records`.
2. „uploading an existing file“ wählen und **den Inhalt dieses Ordners** (nicht den Ordner selbst) hineinziehen → „Commit changes“.

### 2. Mit Vercel verbinden
1. Auf [vercel.com](https://vercel.com) mit GitHub anmelden → **Add New… → Project** → das Repository importieren.
2. Framework Preset: **Other**. Sonst nichts ändern → **Deploy**.

### 3. Datenbank anlegen
1. Im Vercel-Projekt: **Storage → Create Database → Neon (Postgres)** → Free Plan → mit dem Projekt verbinden.
2. Vercel setzt `DATABASE_URL` automatisch. Die Tabellen legt die Website beim ersten Aufruf selbst an.

### 4. Umgebungsvariablen setzen
Vercel-Projekt → **Settings → Environment Variables**:

| Variable | Wert |
|---|---|
| `ADMIN_PASSWORD` | dein Admin-Passwort (mind. 10 Zeichen) |
| `SESSION_SECRET` | beliebiger langer Zufallstext (z. B. 40 Zeichen) |
| `PAYPAL_CLIENT_ID` | aus [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials |
| `PAYPAL_CLIENT_SECRET` | ebenda |
| `PAYPAL_MODE` | `sandbox` zum Testen, danach `live` |
| `SHIPPING_EUR` | Versandkosten pro Bestellung, z. B. `5.90` |
| `FREE_SHIPPING_FROM` | optional: versandkostenfrei ab Betrag, z. B. `100` (0 = aus) |
| `DISCOGS_TOKEN` | **empfohlen**, für Cover, Tracklisten, Genre und Land (nötig für die Track-Suche): [discogs.com/settings/developers](https://www.discogs.com/settings/developers) → „Generate token“ |

Danach **Deployments → … → Redeploy**, damit die Werte aktiv werden.

> PayPal: Zuerst im **Sandbox**-Modus mit den Sandbox-Zugangsdaten und einem Sandbox-Käuferkonto testen. Für echte Zahlungen die **Live**-Zugangsdaten eintragen und `PAYPAL_MODE=live` setzen.

### 5. Eigene Domain (optional)
Vercel → Settings → Domains → z. B. `homerun-records.de` eintragen und den DNS-Anweisungen folgen.

---

## Täglicher Betrieb

### Platten importieren
1. `https://deine-domain/admin` öffnen und mit dem Passwort anmelden.
2. **CSV-Import** → CSV-Datei hineinziehen.
3. Die Spalten werden automatisch erkannt. Prüfe vor allem, dass **„Ø Discogs-Preis“** auf die richtige Spalte zeigt.
4. Rabatt (Standard 10 %) und optional einen Mindestpreis prüfen → **Import starten**.

- Dieselbe Liste kann problemlos erneut hochgeladen werden: Vorhandene Platten werden aktualisiert, nicht verdoppelt. Verkaufte Platten und von Hand geänderte Preise bleiben unverändert.
- Mehrere Exemplare derselben Platte in einer Liste werden einzeln angelegt.
- Platten **ohne Preis** werden als **Entwurf** gespeichert (im Shop unsichtbar). Unter „Platten & Verkauft“ einen Preis eintragen, dann geht die Platte online.
- **Wichtig:** Der normale Discogs-**Sammlungs**-Export enthält keine Preisspalte. Deine CSV braucht eine Spalte mit dem Durchschnittspreis (z. B. „Average Price“, „Avg“, „Median“, „Preis“). Sonst wird alles als Entwurf importiert.
- Die Spalte „Collection Notes“ wird als **private Notiz** gespeichert und ist im Shop nie sichtbar.

### Als verkauft markieren
Admin → **Platten & Verkauft** → suchen (Künstler, Titel, Katalognummer oder #ID) → **Verkauft**.
Mehrere Platten: links anhaken → „Als verkauft markieren“. Das funktioniert auch auf dem Handy, z. B. auf einer Plattenbörse.
Verkäufe über PayPal werden automatisch markiert.

### Bestellungen
Admin → **Bestellungen**: Käufer, E-Mail, Lieferadresse und gekaufte Platten. Die Zahlungsbestätigung bekommst du zusätzlich von PayPal per E-Mail.

### Werkzeuge
- **Preise neu berechnen** mit anderem Rabatt (von Hand gesetzte Preise bleiben unverändert).
- **Cover & Tracklisten laden**: holt Cover, Trackliste, Genre und Land über die Discogs-API (ca. 60 pro Minute, 20.000 Platten ≈ 6 Stunden). Den Tab einfach offen lassen; Abbrechen und später Weitermachen ist jederzeit möglich. Cover werden zusätzlich automatisch geladen, sobald jemand eine Platte im Shop ansieht.

### Track-Suche
Die Discogs-CSV enthält keine Tracklisten. Die Suche nach Tracks findet eine Platte daher erst, wenn ihre Trackliste geladen wurde (Werkzeuge → „Cover & Tracklisten laden“) oder deine CSV eine Spalte „Tracks“/„Tracklist“ hat (Tracks durch `;` getrennt).

---

## Vor dem Livegang
- `rechtliches.html`: **Impressum, Datenschutz, Widerrufsbelehrung und AGB** ausfüllen (gelb markierte Platzhalter). Für Verkäufe im Internet ist das in Deutschland Pflicht.
- Einen Testkauf im PayPal-Sandbox-Modus machen.

## Projektstruktur
```
index.html, record.html, cart.html, admin.html, rechtliches.html, suche.html   Seiten
assets/                    CSS, JavaScript, Logo
suche.html                 erweiterte Suche
api/shop.js                öffentliche Shop-API (Liste, Suche, Detail, Cover)
api/paypal.js              PayPal-Bestellung anlegen und bezahlen
api/admin.js               Login, Import, Verwaltung (nur mit Passwort)
api/_lib/                  Datenbank, Login, PayPal, Katalog-API (von außen nicht abrufbar)
vorschau/, Vorschau-starten.bat   lokale Vorschau (wird nicht mit hochgeladen)
beispiel-import.csv        Beispieldatei zum Testen des Imports
```

## Lokale Vorschau
`Vorschau-starten.bat` doppelklicken → Browser öffnet http://localhost:4321 (Admin-Passwort: `vorschau12345`). Benötigt Node.js. Daten gehen beim Schließen des Fensters verloren.
