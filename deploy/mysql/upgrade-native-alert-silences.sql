-- Adds time-bounded native alert notification silences for existing Studio databases.
CREATE TABLE IF NOT EXISTS rmq_alert_silence (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `domain` VARCHAR(16) NULL,
  `rule_id` bigint(20) unsigned NULL,
  `instance_id` VARCHAR(128) NULL,
  `starts_at` DATETIME NOT NULL,
  `ends_at` DATETIME NOT NULL,
  `reason` VARCHAR(512) NULL,
  `created_by` VARCHAR(128) NOT NULL,
  `gmt_create` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `gmt_modified` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX idx_alert_silence_active (`starts_at`, `ends_at`),
  INDEX idx_alert_silence_scope (`domain`, `rule_id`, `instance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
