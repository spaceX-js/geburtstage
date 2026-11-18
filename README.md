# Geburtstage

Gemeinsame App für Jonas & Clara, die an die Geburtstage von Freunden und Familie erinnert – mit Geschenke-Planung als Zusatz.
Läuft kostenlos auf Cloudflare Workers mit einer D1-Datenbank.
Anmeldung mit einem gemeinsamen Passwort, das beim allerersten Aufruf festgelegt wird.

## Funktionen (v0.5)

- **Demnächst**: Geburtstage und eigene Termine (Hochzeitstag …) der nächsten 12 Monate, „Heute“ hervorgehoben, Alter und runde Geburtstage
- **Kalender**: Monatsansicht (Raster Mo–So mit Namen, Tag antippen zeigt die Einträge) und Jahresübersicht (12 Mini-Monate, Monat antippen öffnet ihn); Feiertage (Weihnachten, Nikolaus, Ostern, Valentinstag, Muttertag, Vatertag) immer gelb eingetragen
- **Alle**: alle Personen nach Geburtsmonat, mit Suche; Personen ohne Datum am Ende
- **Erinnerungen** per **Push-Nachricht** (Einstellungen → Zahnrad):
  - Vorlauf frei wählbar (am Tag selbst, 1, 3, 7, 14, 15, 30, 60 Tage), Uhrzeit wählbar (Standard 9 Uhr, deutsche Zeit)
  - pro Person: Standard / nur am Tag selbst / aus
  - jedes Handy bekommt seine eigene Fassung (siehe Ehepaar); iPhone: nur als Home-Bildschirm-App; Antippen öffnet die Person
  - **Kalender-Abo**: geheimer Link (`/kalender/<token>.ics`), der alle Geburtstage in den Handy-Kalender bringt
  - Weihnachten & Co. nur für Personen, bei denen das als Geschenk-Anlass eingeschaltet ist (abschaltbar)
  - technisch: Cron-Trigger stündlich, verschickt ab der eingestellten Uhrzeit; `reminders_sent` verhindert Doppelte
- **Ehepaar Jonas & Clara**: Personen-Einträge mit „Ist das einer von euch beiden?“ (Feld `self`).
  - Alles zu Geschenken für mich (Ideen, Geschenke, Budget, Notizen) wird auf meinem Handy ausgeblendet – auch in den Push-Nachrichten. Ist nicht gewählt, wem das Handy gehört, bleibt es für beide verborgen.
  - Nur ausgeblendet, nicht technisch gesperrt: beide nutzen dasselbe Passwort.
  - Gemeinsame Termine (gleicher Name und Tag, z. B. Hochzeitstag) erscheinen nur einmal („💍 Clara & Jonas“); Antippen führt zum Partner.
  - An den eigenen Geburtstag wird man nicht erinnert.
- **🎁 Geschenke** (Zusatz): Übersicht aller Anlässe inkl. Feiertage mit Stand (Idee → Gekauft → Verpackt → Überreicht oder „Diesmal nichts“),
  **Budget je Anlass** (Geburtstag, Weihnachten, Hochzeitstag … – gilt jedes Jahr), Ideen-Notizbuch, frühere Geschenke mit Bewertung, Interessen, Notizen
- **✨ Geschenkvorschläge per KI** (im Anlass-Dialog): Cloudflare Workers AI (`@cf/google/gemma-4-26b-a4b-it`, Ersatz: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
  schlägt 5 Ideen vor – aus Interessen, Notizen, Ideen-Notizbuch, früheren Geschenken (mit Bewertung) und dem Budget für den Anlass; optional mit Wunsch („eher ein Erlebnis“).
  Ein Vorschlag kann direkt als Geschenk übernommen oder ins Notizbuch gemerkt werden. Kostenloses Tageskontingent; Begrenzung auf 60 Anfragen pro Tag (`settings.ai_day`).
- **Ausgaben** (Geschenke → Ausgaben): je Jahr ausgegeben (gekauft/verpackt/überreicht) und noch geplant, pro Person, pro Anlass, „über Budget“, Vergleich der letzten 5 Jahre.
  Geschenke für einen selbst zählen nicht mit (geheim).
- Der 29. Februar wird in normalen Jahren am 28. angezeigt

Geplant: Import aus Kontakten · evtl. E-Mail für Geschenkideen

## Aufbau

| Datei | Zweck |
|---|---|
| `src/index.js` | Worker: Anmeldung, API (`/api/state`, `/api/person`, `/api/idea`, `/api/gift`, jeweils `/delete`, `/api/settings`, `/api/push/…`, `/api/calendar`, `/api/password`), Kalender-Abo |
| `src/notify.js` | Erinnerungen: welche fällig sind (je Empfänger), stündlicher Lauf, Push, iCal |
| `src/suggest.js` | Geschenkvorschläge: Prompt, Aufruf von Workers AI, Antwort auslesen |
| `src/push.js` | Web Push ohne Fremddienst (VAPID, RFC 8291/8292) |
| `public/sw.js` | Service Worker: zeigt Push-Nachrichten an |
| `public/occasions.js` | Datumsberechnung (Ostern, Muttertag, Alter, nächste Anlässe) – von Oberfläche und Worker genutzt |
| `public/index.html`, `public/app.js` | Oberfläche (nur nach Anmeldung erreichbar) |
| `d1-schema.sql` | Tabellen `persons`, `ideas`, `gifts`, `settings`, `login_attempts`, `push_subs`, `reminders_sent` (für eine neue Datenbank) |
| `migrations/` | Änderungen für eine bestehende Datenbank |
| `wrangler.jsonc` | Cloudflare-Einstellungen (Datenbank `geburtstage-db`) |
| `test/` | Tests (`npm test`) |

## Veröffentlichen

Cloudflare baut und veröffentlicht automatisch bei jedem Push auf `main` (Workers Builds, mit GitHub verbunden).
Manuell: `npm install && npx wrangler deploy`.

## Datenbank neu aufsetzen

```sh
npx wrangler d1 create geburtstage-db            # ID in wrangler.jsonc eintragen
npx wrangler d1 execute geburtstage-db --remote --file=d1-schema.sql
```
