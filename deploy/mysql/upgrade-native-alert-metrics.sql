-- Native alert metric snapshot storage for existing Studio MySQL volumes.
CREATE TABLE IF NOT EXISTS rmq_metric_snapshot (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  instance_id VARCHAR(128) NOT NULL,
  metric_key VARCHAR(128) NOT NULL,
  domain VARCHAR(16) NOT NULL,
  cluster_id VARCHAR(128),
  labels_hash CHAR(64) NOT NULL,
  labels_json TEXT NOT NULL,
  value DOUBLE NULL,
  availability VARCHAR(16) NOT NULL,
  collected_at DATETIME NOT NULL,
  gmt_create datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_metric_snapshot_lookup (instance_id, metric_key, collected_at),
  INDEX idx_metric_snapshot_retention (collected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
