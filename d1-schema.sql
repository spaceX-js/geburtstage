-- Geschenke – Datenbank-Schema (Cloudflare D1)
-- Einmalig ausführen: npx wrangler d1 execute geschenke-db --remote --file=d1-schema.sql

-- Personen, an die wir denken
CREATE TABLE IF NOT EXISTS persons (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  relation    TEXT NOT NULL DEFAULT '',     -- Familie, Freunde, Kollegen …
  bday_day    INTEGER,                      -- Geburtstag: Tag
  bday_month  INTEGER,                      -- Geburtstag: Monat
  bday_year   INTEGER,                      -- Geburtsjahr, freiwillig
  holidays    TEXT NOT NULL DEFAULT '',     -- zugeschaltete Feiertage, z. B. "weihnachten|ostern"
  extra       TEXT NOT NULL DEFAULT '[]',   -- eigene Termine als JSON: [{"id","label","d","m","y"}]
  interests   TEXT NOT NULL DEFAULT '',     -- Hobbys/Interessen, durch "|" getrennt
  dislikes    TEXT NOT NULL DEFAULT '',     -- mag nicht / hat schon
  notes       TEXT NOT NULL DEFAULT '',     -- alles, was beim Schenken hilft (Größen, Wünsche …)
  budget_min  INTEGER,                      -- Preisspanne in Euro
  budget_max  INTEGER,
  responsible TEXT NOT NULL DEFAULT '',     -- wer sich normalerweise kümmert (leer = beide)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Ideen-Notizbuch: was uns unterm Jahr einfällt
CREATE TABLE IF NOT EXISTS ideas (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL,
  text       TEXT NOT NULL,
  link       TEXT NOT NULL DEFAULT '',
  price      INTEGER,                       -- ungefährer Preis in Euro
  added_by   TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ideas_person ON ideas(person_id);

-- Geschenke (geplant oder schon verschenkt), je Anlass und Jahr
CREATE TABLE IF NOT EXISTS gifts (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL,
  occasion   TEXT NOT NULL,                 -- "geburtstag", "weihnachten", "x:<id>" …
  year       INTEGER NOT NULL,
  title      TEXT NOT NULL,
  price      INTEGER,                       -- Euro
  status     TEXT NOT NULL DEFAULT 'idee',  -- idee, gekauft, verpackt, ueberreicht, nichts
  rating     INTEGER NOT NULL DEFAULT 0,    -- 0 = keine Angabe, 1 = naja, 2 = gut, 3 = Volltreffer
  note       TEXT NOT NULL DEFAULT '',
  who        TEXT NOT NULL DEFAULT '',      -- wer sich kümmert (leer = beide)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gifts_person ON gifts(person_id, year);

-- pw_salt, pw_hash, session_secret, rev (Änderungszähler), people (JSON-Liste der Namen)
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, ts TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts(ip, ts);
