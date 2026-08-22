CREATE TABLE IF NOT EXISTS rmq_alert_state (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  rule_id bigint(20) unsigned NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  consecutive_hits INT NOT NULL DEFAULT 0,
  current_value DOUBLE NULL,
  first_pending_at DATETIME NULL,
  fired_at DATETIME NULL,
  resolved_at DATETIME NULL,
  version INT NOT NULL DEFAULT 0,
  gmt_modified datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_alert_state_rule_fingerprint (rule_id, fingerprint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
