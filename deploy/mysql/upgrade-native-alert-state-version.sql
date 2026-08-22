-- Adds optimistic-lock state revisioning to existing native alert state tables.

SET @version_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'rmq_alert_state' AND column_name = 'version'
);
SET @add_version_column = IF(@version_column_exists = 0,
  'ALTER TABLE rmq_alert_state ADD COLUMN version INT NOT NULL DEFAULT 0 AFTER resolved_at',
  'SELECT 1');
PREPARE add_version_column FROM @add_version_column;
EXECUTE add_version_column;
DEALLOCATE PREPARE add_version_column;
