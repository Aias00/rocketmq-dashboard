-- Coordinates native alert collection across multiple Studio backend replicas.
CREATE TABLE IF NOT EXISTS rmq_alert_collection_lease (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  lease_name VARCHAR(128) NOT NULL,
  holder_id VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  gmt_modified datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_alert_collection_lease_name (lease_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
