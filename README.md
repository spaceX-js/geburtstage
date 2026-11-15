# Geburtstage

Gemeinsame App für Jonas & Clara, die an die Geburtstage von Freunden und Familie erinnert – mit Geschenke-Planung als Zusatz.
(Repo und Cloudflare-Worker heißen weiterhin „geschenke“.) Läuft kostenlos auf Cloudflare Workers mit einer D1-Datenbank.
Anmeldung mit einem gemeinsamen Passwort, das beim allerersten Aufruf festgelegt wird.

## Funktionen (v0.2)

- **Demnächst**: Geburtstage und eigene Termine (Hochzeitstag …) der nächsten 12 Monate, „Heute“ hervorgehoben, Alter und runde Geburtstage
- **Alle**: alle Personen nach Geburtsmonat, mit Suche; Personen ohne Datum am Ende
- **Erinnerungen** (Einstellungen → Zahnrad):
  - Vorlauf frei wählbar (am Tag selbst, 1, 3, 7, 14, 15, 30, 60 Tage; Standard 30/15/7/am Tag), Uhrzeit wählbar (Standard 9 Uhr, deutsche Zeit)
  - pro Person: Standard / nur am Tag selbst / aus
  - **Push-Nachricht** auf jedes Handy, auf dem sie eingeschaltet ist (iPhone: nur als Home-Bildschirm-App); Antippen öffnet die Person
  - **E-Mail** (optional): eine Sammel-Mail pro Tag an die hinterlegten Adressen – braucht eine eigene Domain bei Cloudflare (siehe unten)
  - **Kalender-Abo**: geheimer Link (`/kalender/<token>.ics`), der alle Geburtstage in den Handy-Kalender bringt; „Neuer Link“ macht den alten ungültig
  - Weihnachten & Co. nur für Personen, bei denen das als Geschenk-Anlass eingeschaltet ist (abschaltbar)
  - technisch: Cron-Trigger stündlich, verschickt ab der eingestellten Uhrzeit; verschickte Erinnerungen stehen in `reminders_sent`, damit nichts doppelt kommt
- **🎁 Geschenke** (Zusatz): Übersicht aller Anlässe inkl. Feiertage mit Stand (Idee → Gekauft → Verpackt → Überreicht oder „Diesmal nichts“),
  Ideen-Notizbuch pro Person, frühere Geschenke mit Bewertung, Budget, Interessen, Notizen
- Der 29. Februar wird in normalen Jahren am 28. angezeigt

Geplant: Geschenkvorschläge mit Cloudflare Workers AI · Import aus Kontakten · Ausgabenübersicht

## E-Mail einschalten (optional)

1. Eine eigene Domain muss bei Cloudflare liegen; unter Email Service → Email Routing einrichten.
2. Unter „Destination Addresses“ eure beiden E-Mail-Adressen eintragen und per Mail bestätigen.
3. In `wrangler.jsonc` die Zeilen `send_email` und `vars` (MAIL_FROM = Absender auf eurer Domain) einkommentieren.
4. In der App unter Einstellungen die eigene Adresse speichern und „Test-Mail schicken“.

## Aufbau

| Datei | Zweck |
|---|---|
| `src/index.js` | Worker: Anmeldung, API (`/api/state`, `/api/person`, `/api/idea`, `/api/gift`, jeweils `/delete`, `/api/settings`, `/api/push/…`, `/api/email/test`, `/api/calendar`, `/api/password`), Kalender-Abo |
| `src/notify.js` | Erinnerungen: welche fällig sind, stündlicher Lauf, Push, E-Mail, iCal |
| `src/push.js` | Web Push ohne Fremddienst (VAPID, RFC 8291/8292) |
| `public/sw.js` | Service Worker: zeigt Push-Nachrichten an |
| `public/occasions.js` | Datumsberechnung (Ostern, Muttertag, Alter, nächste Anlässe) – von Oberfläche und Worker genutzt |
| `public/index.html`, `public/app.js` | Oberfläche (nur nach Anmeldung erreichbar) |
| `d1-schema.sql` | Tabellen `persons`, `ideas`, `gifts`, `settings`, `login_attempts`, `push_subs`, `reminders_sent` (für eine neue Datenbank) |
| `migrations/` | Änderungen für eine bestehende Datenbank |
| `wrangler.jsonc` | Cloudflare-Einstellungen (Datenbank `geschenke-db`) |
| `test/` | Tests (`npm test`) |

## Veröffentlichen

Cloudflare baut und veröffentlicht automatisch bei jedem Push auf `main` (Workers Builds, mit GitHub verbunden).
Manuell: `npm install && npx wrangler deploy`.

## Datenbank neu aufsetzen

```sh
npx wrangler d1 create geschenke-db            # ID in wrangler.jsonc eintragen
npx wrangler d1 execute geschenke-db --remote --file=d1-schema.sql
```
