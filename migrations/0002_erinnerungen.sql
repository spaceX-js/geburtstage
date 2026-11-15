-- v0.2: Erinnerungen (Push, E-Mail, Kalender-Abo)
ALTER TABLE persons ADD COLUMN remind TEXT NOT NULL DEFAULT '';   -- '' = Standard, 'tag' = nur am Tag selbst, 'aus' = keine

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  person     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Schon verschickte Erinnerungen (damit keine doppelt kommt)
CREATE TABLE IF NOT EXISTS reminders_sent (key TEXT PRIMARY KEY, at TEXT NOT NULL);
