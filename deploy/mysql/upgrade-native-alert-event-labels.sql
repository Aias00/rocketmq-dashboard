-- Persists native metric scope labels with alert events on existing Studio databases.

SET @labels_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'rmq_system_alert'
    AND column_name = 'labels_json'
);
SET @add_labels_column = IF(@labels_column_exists = 0,
  'ALTER TABLE rmq_system_alert ADD COLUMN labels_json TEXT NULL AFTER current_value',
  'SELECT 1');
PREPARE add_labels_column FROM @add_labels_column;
EXECUTE add_labels_column;
DEALLOCATE PREPARE add_labels_column;
