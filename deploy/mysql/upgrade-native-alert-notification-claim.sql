-- Makes notification delivery claims reclaimable after a Studio process crash.

SET @claim_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'rmq_alert_notification_outbox'
    AND column_name = 'sending_started_at'
);
SET @add_claim_column = IF(@claim_column_exists = 0,
  'ALTER TABLE rmq_alert_notification_outbox ADD COLUMN sending_started_at DATETIME NULL AFTER next_attempt_at',
  'SELECT 1');
PREPARE add_claim_column FROM @add_claim_column;
EXECUTE add_claim_column;
DEALLOCATE PREPARE add_claim_column;
