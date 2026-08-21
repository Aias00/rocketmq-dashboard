-- Adds an index for native Alert Events feed filters on existing Studio databases.
SET @event_index_exists = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'rmq_system_alert'
    AND index_name = 'idx_system_alert_feed'
);
SET @add_event_index = IF(@event_index_exists = 0,
  'CREATE INDEX idx_system_alert_feed ON rmq_system_alert (domain, instance_id, transition, time)', 'SELECT 1');
PREPARE add_event_index FROM @add_event_index;
EXECUTE add_event_index;
DEALLOCATE PREPARE add_event_index;
