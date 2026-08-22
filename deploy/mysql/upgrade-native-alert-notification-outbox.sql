-- Adds durable, retryable native alert webhook delivery for existing Studio databases.
CREATE TABLE IF NOT EXISTS rmq_alert_notification_outbox (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `alert_id` bigint(20) unsigned NOT NULL,
  `channel` VARCHAR(32) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `attempt_count` INT NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME NOT NULL,
  `last_error` VARCHAR(1000) NULL,
  `delivered_at` DATETIME NULL,
  `gmt_create` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `gmt_modified` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_alert_notification_outbox (`alert_id`, `channel`),
  INDEX idx_alert_notification_ready (`status`, `next_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
