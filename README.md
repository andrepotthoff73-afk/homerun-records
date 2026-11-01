# Homerun Records

Vinyl-Shop im Discogs-Stil mit passwortgeschütztem Admin-Bereich.

- **Shop** (`/`): einfache Suche nach Künstler, Album/Titel und Track, Filter (Format, Zustand, Preis), Listen- und Rasteransicht, Detailseiten mit Trackliste, Warenkorb
- **Erweiterte Suche** (`/suche`): Künstler, Album, Track, Label, Katalognummer, Format, Genre/Stil, Land, Jahr von–bis, Zustand Platte/Hülle, Preis, Sortierung – mit Live-Trefferzahl
- Auf der öffentlichen Website wird Discogs nirgends erwähnt (Preise heißen dort „Marktpreis“).
- **PayPal-Checkout** (`/cart`): Preise werden auf dem Server geprüft, bezahlte Platten werden **automatisch als verkauft markiert**
- **Admin** (`/admin`): CSV-Import aus Discogs mit Zustandsabfrage (Preis = Ø der ersten 10 Marktplatz-Angebote aus Deutschland, ohne Rabatt, über das Preis-Tool), Platten als verkauft markieren, Preise ändern, Bestellungen mit Lieferadresse ansehen, Cover von Discogs laden

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
| `SHIPPING_EUR` | Versandkosten je Paket (bis 8 Platten): `7.50` |
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
4. Optional einen Mindestpreis prüfen → **Import starten**.

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
- **Preise neu berechnen**: setzt alle automatischen Preise auf den Ø-Marktpreis (von Hand gesetzte Preise bleiben unverändert).
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

---

## Platten erfassen – empfohlen

1. Admin → **„Platten erfassen“** → Mindestpreis und Lagerort (Kiste) prüfen.
2. **Discogs-CSV ablegen.** Die Platten werden sofort angelegt (bereits vorhandene nur aktualisiert).
3. **Zustand angeben:** Die Seite fragt Platte für Platte nach dem Zustand von Platte und Hülle.
   - Klicken oder Tastatur: Ziffern **1–8** = M, NM, VG+, VG, G+, G, F, P – erst für die Platte, dann für die Hülle (**9** = Generic, **0** = keine Hülle)
   - **Enter** übernimmt den Zustand aus der CSV (grün unterstrichen), **←** geht eine Platte zurück
   - „Zustand aus der CSV für alle übernehmen“ überspringt die Abfrage für Platten, die schon einen Zustand haben
   - CDs, Kassetten usw. werden nicht abgefragt und nicht bepreist
4. **Cover & Daten** (Cover, Trackliste, Genre, Land) werden automatisch über die Discogs-API geladen.
5. **Preise:** Auf dem PC `Preis-Tool-starten.bat` doppelklicken → Bereich **„Marktpreise für den Shop“** → Website-Adresse und (nur beim ersten Mal) Admin-Passwort → **Start**.

### So wird der Preis berechnet
- Das Preis-Tool öffnet für jede Platte die Discogs-Verkaufsseite in **Microsoft Edge** auf deinem PC:
  über die **Release-ID** (`discogs.com/sell/release/…?ships_from=Germany`). Ist keine bekannt, sucht es auf dem Marktplatz nach Künstler + Titel und nimmt die Pressung mit der passenden **Katalognummer**.
- Es nimmt die **ersten 10 Angebote von Verkäufern aus Deutschland** – in der Reihenfolge, in der Discogs sie anzeigt, egal in welchem Zustand.
- Gibt es weniger als 10, wird mit Angeboten **aus anderen Ländern** aufgefüllt. Gibt es insgesamt weniger als 10, wird durch die tatsächliche Anzahl geteilt.
- **Ø = Summe ÷ Anzahl** (Fremdwährungen mit dem EZB-Tageskurs in Euro), **Verkaufspreis = Ø** (kein Rabatt), mindestens der Mindestpreis.
- Die Platte geht sofort online. Ohne ein einziges Angebot bleibt sie Entwurf (Preis dann von Hand eintragen).
- Im Admin-Bereich steht bei jeder Platte, aus wie vielen Angeboten (davon wie viele aus Deutschland) der Preis stammt, mit Link zu den Angeboten.

**Warum auf dem PC?** Discogs blockt automatische Abrufe der Verkaufsseiten von Servern (auch von Vercel). Ein normaler Browser auf deinem PC kommt durch.
- Tempo: etwa eine Platte alle 10–15 Sekunden (absichtlich langsam, damit Discogs nicht sperrt). 1.000 Platten ≈ 3–4 Stunden. Der PC muss dabei laufen; das Edge-Fenster bleibt minimiert.
- Zeigt Discogs eine Prüfung („Bist du ein Mensch?“), öffnet sich das Edge-Fenster: einmal bestätigen, dann geht es weiter.
- Das Tool lädt bei Bedarf auch Cover & Daten nach, der Admin-Bereich muss dafür nicht offen sein.
- Erkennt das Tool auf einer Seite keine Angebote, obwohl welche da sein müssten, speichert es die Seite unter `Ergebnisse/debug/` – damit lässt sich das Tool an einen geänderten Seitenaufbau anpassen.
- Hinweis: Discogs untersagt in seinen Nutzungsbedingungen das automatische Auslesen der Website. Das Tool ruft deshalb bewusst langsam und nur für deinen eigenen Bestand ab.

Einzelne Platten neu bepreisen: Admin → Platten → anhaken → **„Preise & Cover neu ermitteln“** → das Preis-Tool holt die Preise beim nächsten Durchlauf.

---

## Preis-Tool: alternatives Verfahren (Preisvorschläge über die Discogs-API)

`Preis-Tool-starten.bat` doppelklicken → im Browser öffnet sich http://localhost:4410 → unten „Alternative“ aufklappen.

1. **Discogs-Token** eintragen (discogs.com → Einstellungen → Entwickler → „Neuen Token generieren“) und einmalig auf discogs.com die **Verkäufer-Einstellungen** ausfüllen (Währung EUR). Ohne diese gibt Discogs keine Preisvorschläge heraus.
2. CSV-Export deiner Discogs-Sammlung hineinziehen → **„Preise & Cover ermitteln“**.
3. Ergebnis: Ordner `Ergebnisse` mit `<liste>-mit-preisen.csv` und allen Covern in `Ergebnisse/cover`.
4. **„In den Shop übertragen“** (Website-Adresse + Admin-Passwort): lädt die Cover in den Bildspeicher der Website und importiert alle Platten mit Preis, Genre, Land und Trackliste.

**So wird der Preis berechnet** (offizielle Discogs-API, Preisvorschläge basieren auf den Verkäufen bei Discogs):
- Niedrig = Preisvorschlag für Zustand **VG**
- Mittel = Preisvorschlag für Zustand **VG+**
- Hoch = Preisvorschlag für Zustand **NM**
- Durchschnitt = Mittelwert der drei → **Verkaufspreis = Durchschnitt** (kein Rabatt), mindestens der eingestellte Mindestpreis
- Fehlen Preisvorschläge, wird ersatzweise das günstigste aktuelle Angebot verwendet (Hinweis in der Liste). Gibt es gar keinen Preis, landet die Platte im Shop als Entwurf.
- Fremdwährungen werden mit dem Tageskurs der EZB in Euro umgerechnet.

**Tempo:** ca. 20 Platten pro Minute (Discogs-Limit). 1.000 Platten ≈ 50 Minuten. Anhalten und Fortsetzen jederzeit möglich; einmal abgefragte Platten sind 30 Tage zwischengespeichert.

**Einmalig in Vercel für die Cover:** Projekt → **Storage → Create Database → Blob** → mit dem Projekt verbinden → Redeploy. (Kostenloser Tarif: begrenzter Speicher – die Cover werden auf 500 px verkleinert, ca. 30–50 KB pro Bild.)

Token und Zwischenspeicher liegen in `%APPDATA%\HomerunPreisTool`, nicht im Projektordner.
