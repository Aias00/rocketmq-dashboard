-- Adds a topic selector to native topic-backlog rules on existing Studio databases.

SET @topic_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'rmq_alert_rule' AND column_name = 'topic'
);
SET @add_topic_column = IF(@topic_column_exists = 0,
  'ALTER TABLE rmq_alert_rule ADD COLUMN topic VARCHAR(255) NULL AFTER consumer_group', 'SELECT 1');
PREPARE add_topic_column FROM @add_topic_column;
EXECUTE add_topic_column;
DEALLOCATE PREPARE add_topic_column;
