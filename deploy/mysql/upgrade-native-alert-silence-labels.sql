-- Adds exact-match resource label scopes to existing native alert silences.
SET @labels_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'rmq_alert_silence' AND column_name = 'labels_json'
);
SET @add_labels_column = IF(@labels_column_exists = 0,
  'ALTER TABLE rmq_alert_silence ADD COLUMN labels_json TEXT NULL AFTER instance_id', 'SELECT 1');
PREPARE add_labels_column FROM @add_labels_column;
EXECUTE add_labels_column;
DEALLOCATE PREPARE add_labels_column;
