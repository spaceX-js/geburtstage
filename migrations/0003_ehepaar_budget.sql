-- v0.3: Ehepaar (Geschenke bleiben geheim) und Budget je Anlass
ALTER TABLE persons ADD COLUMN self TEXT NOT NULL DEFAULT '';
ALTER TABLE persons ADD COLUMN budgets TEXT NOT NULL DEFAULT '{}';
-- bisheriges Gesamt-Budget wird zum Geburtstags-Budget
UPDATE persons SET budgets = json_object('geburtstag', json_patch(CASE WHEN budget_min IS NULL THEN '{}' ELSE json_object('min', budget_min) END,
  CASE WHEN budget_max IS NULL THEN '{}' ELSE json_object('max', budget_max) END))
  WHERE budget_min IS NOT NULL OR budget_max IS NOT NULL;
-- Jonas und Clara als Ehepaar kennzeichnen (Einträge mit genau diesem Namen)
UPDATE persons SET self = name WHERE name IN ('Jonas', 'Clara');
-- E-Mail-Adressen werden nicht mehr gebraucht
DELETE FROM settings WHERE key = 'emails';
