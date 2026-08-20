-- deploy/mysql/upgrade-alert-rule-domain.sql
-- Adds the rule domain required by Studio native alerting to an existing MySQL volume.
-- Existing rules are classified as BUSINESS to preserve their previous behavior.
-- Run once on installations created before this column was introduced.
--
--   docker exec -i rocketmq-studio-mysql mysql -uroot -pstudio123 rocketmq < upgrade-alert-rule-domain.sql

SET @domain_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'rmq_alert_rule'
    AND column_name = 'domain'
);
SET @add_domain_column = IF(
  @domain_column_exists = 0,
  'ALTER TABLE rmq_alert_rule ADD COLUMN domain VARCHAR(16) NOT NULL DEFAULT ''BUSINESS'' COMMENT ''BUSINESS or CLUSTER alert rule domain'' AFTER severity',
  'SELECT 1'
);
PREPARE add_domain_column FROM @add_domain_column;
EXECUTE add_domain_column;
DEALLOCATE PREPARE add_domain_column;
