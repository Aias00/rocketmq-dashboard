-- Adds native-alert rule scope and debounce fields to existing Studio databases.
-- Rules remain inert for native collection until an instance_id is configured deliberately.

SET @instance_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'rmq_alert_rule' AND column_name = 'instance_id'
);
SET @add_instance_column = IF(@instance_column_exists = 0,
  'ALTER TABLE rmq_alert_rule ADD COLUMN instance_id VARCHAR(128) NULL AFTER domain', 'SELECT 1');
PREPARE add_instance_column FROM @add_instance_column;
EXECUTE add_instance_column;
DEALLOCATE PREPARE add_instance_column;

SET @group_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'rmq_alert_rule' AND column_name = 'consumer_group'
);
SET @add_group_column = IF(@group_column_exists = 0,
  'ALTER TABLE rmq_alert_rule ADD COLUMN consumer_group VARCHAR(255) NULL AFTER instance_id', 'SELECT 1');
PREPARE add_group_column FROM @add_group_column;
EXECUTE add_group_column;
DEALLOCATE PREPARE add_group_column;

SET @samples_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'rmq_alert_rule' AND column_name = 'consecutive_samples'
);
SET @add_samples_column = IF(@samples_column_exists = 0,
  'ALTER TABLE rmq_alert_rule ADD COLUMN consecutive_samples INT NOT NULL DEFAULT 1 AFTER consumer_group', 'SELECT 1');
PREPARE add_samples_column FROM @add_samples_column;
EXECUTE add_samples_column;
DEALLOCATE PREPARE add_samples_column;
