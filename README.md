# Geschenke

Gemeinsame App für Geburtstage und Geschenke von Freunden und Familie (Jonas & Clara).
Läuft kostenlos auf Cloudflare Workers mit einer D1-Datenbank. Anmeldung mit einem gemeinsamen Passwort,
das beim allerersten Aufruf festgelegt wird.

## Funktionen (v0.1)

- **Demnächst**: alle Anlässe der nächsten 12 Monate nach Monaten, mit „in X Tagen“, rundem Geburtstag und Stand des Geschenks;
  Hinweis, wenn in den nächsten 30 Tagen etwas ohne Geschenk ansteht; Filter „Meine“ (zuständig: ich oder beide)
- **Personen**: Name, Beziehung, Geburtstag (Jahr freiwillig – dann mit Alter), Budget, wer sich kümmert,
  zuschaltbare Feiertage (Weihnachten, Nikolaus, Ostern, Valentinstag, Muttertag, Vatertag), eigene Termine (Hochzeitstag, Namenstag …),
  Interessen, „mag nicht / hat schon“, Notizen
- **Ideen-Notizbuch** pro Person (mit Preis und Link); eine Idee lässt sich für einen Anlass einplanen
- **Geschenke** je Anlass und Jahr mit Stand (Idee → Gekauft → Verpackt → Überreicht oder „Diesmal nichts“),
  Preis, wer sich kümmert, und Bewertung (Naja / Gut / Volltreffer); frühere Geschenke lassen sich nachtragen
- Der 29. Februar wird in normalen Jahren am 28. angezeigt
- Zweites Handy sieht Änderungen nach spätestens ~5 Sekunden; funktioniert als Home-Bildschirm-App

Geplant: v0.2 Erinnerungen (Push, E-Mail, Kalender-Abo) · v0.3 Geschenkvorschläge mit Cloudflare Workers AI · v0.4 Import, Ausgaben, Weihnachts-Übersicht

## Aufbau

| Datei | Zweck |
|---|---|
| `src/index.js` | Worker: Anmeldung, API (`/api/state`, `/api/person`, `/api/idea`, `/api/gift`, jeweils `/delete`, `/api/password`) |
| `public/occasions.js` | Datumsberechnung (Ostern, Muttertag, Alter, nächste Anlässe) – von Oberfläche und Worker genutzt |
| `public/index.html`, `public/app.js` | Oberfläche (nur nach Anmeldung erreichbar) |
| `d1-schema.sql` | Tabellen `persons`, `ideas`, `gifts`, `settings`, `login_attempts` |
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
