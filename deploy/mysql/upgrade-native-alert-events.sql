-- Adds native lifecycle context to existing Alert Events records.
SET @event_column_exists = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'rmq_system_alert' AND column_name = 'domain');
SET @event_upgrade = IF(@event_column_exists = 0,
  'ALTER TABLE rmq_system_alert ADD COLUMN domain VARCHAR(16), ADD COLUMN rule_id BIGINT UNSIGNED, ADD COLUMN fingerprint CHAR(64), ADD COLUMN transition VARCHAR(16), ADD COLUMN instance_id VARCHAR(128), ADD COLUMN current_value DOUBLE, ADD INDEX idx_system_alert_domain_time (domain, time)',
  'SELECT 1');
PREPARE event_upgrade FROM @event_upgrade;
EXECUTE event_upgrade;
DEALLOCATE PREPARE event_upgrade;
