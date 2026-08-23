/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.apache.rocketmq.studio.ops.alert;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;

/** Adds native-alerting fields to alert tables created by earlier Studio builds. */
@Slf4j
@Component
@RequiredArgsConstructor
public class AlertSchemaMigration implements ApplicationRunner {
    private static final List<Column> COLUMNS = List.of(
            new Column("rmq_alert_rule", "aggregation", "VARCHAR(16) NOT NULL DEFAULT 'LAST'"),
            new Column("rmq_alert_rule", "window_seconds", "INT NOT NULL DEFAULT 0"),
            new Column("rmq_alert_rule", "domain", "VARCHAR(16) NOT NULL DEFAULT 'BUSINESS'"),
            new Column("rmq_alert_rule", "instance_id", "VARCHAR(128)"),
            new Column("rmq_alert_rule", "consumer_group", "VARCHAR(255)"),
            new Column("rmq_alert_rule", "topic", "VARCHAR(255)"),
            new Column("rmq_alert_rule", "consecutive_samples", "INT NOT NULL DEFAULT 1"),
            new Column("rmq_system_alert", "acknowledged_by", "VARCHAR(128)"),
            new Column("rmq_system_alert", "acknowledged_at", "DATETIME"),
            new Column("rmq_system_alert", "domain", "VARCHAR(16)"),
            new Column("rmq_system_alert", "rule_id", "BIGINT"),
            new Column("rmq_system_alert", "fingerprint", "CHAR(64)"),
            new Column("rmq_system_alert", "transition", "VARCHAR(16)"),
            new Column("rmq_system_alert", "instance_id", "VARCHAR(128)"),
            new Column("rmq_system_alert", "current_value", "DOUBLE"),
            new Column("rmq_system_alert", "labels_json", "TEXT"),
            new Column("rmq_alert_notification_outbox", "claim_token", "VARCHAR(64)"));
    private static final List<Index> INDEXES = List.of(
            new Index("rmq_system_alert", "idx_system_alert_domain_time", "domain, time"),
            new Index("rmq_system_alert", "idx_system_alert_feed", "domain, instance_id, transition, time"));

    private final DataSource dataSource;

    @Override
    public void run(ApplicationArguments args) throws Exception {
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            DatabaseMetaData metadata = connection.getMetaData();
            for (Column column : COLUMNS) {
                ensureColumn(metadata, connection.getCatalog(), statement, column);
            }
            for (Index index : INDEXES) {
                ensureIndex(metadata, connection.getCatalog(), statement, index);
            }
        }
    }

    private static void ensureColumn(DatabaseMetaData metadata, String catalog, Statement statement, Column column)
            throws Exception {
        if (hasColumn(metadata, catalog, column.table(), column.name())) {
            return;
        }
        try {
            log.info("Adding native alerting column {}.{}", column.table(), column.name());
            statement.executeUpdate("ALTER TABLE " + column.table() + " ADD COLUMN " + column.name()
                    + " " + column.definition());
        } catch (SQLException failure) {
            if (!hasColumn(metadata, catalog, column.table(), column.name())) {
                throw failure;
            }
        }
    }

    private static void ensureIndex(DatabaseMetaData metadata, String catalog, Statement statement, Index index)
            throws Exception {
        if (hasIndex(metadata, catalog, index.table(), index.name())) {
            return;
        }
        try {
            log.info("Adding native alerting index {}.{}", index.table(), index.name());
            statement.executeUpdate("CREATE INDEX " + index.name() + " ON " + index.table()
                    + " (" + index.columns() + ")");
        } catch (SQLException failure) {
            if (!hasIndex(metadata, catalog, index.table(), index.name())) {
                throw failure;
            }
        }
    }

    private static boolean hasColumn(DatabaseMetaData metadata, String catalog, String table, String column)
            throws Exception {
        try (ResultSet columns = metadata.getColumns(catalog, null, table, column)) {
            return columns.next();
        }
    }

    private static boolean hasIndex(DatabaseMetaData metadata, String catalog, String table, String index)
            throws Exception {
        try (ResultSet indexes = metadata.getIndexInfo(catalog, null, table, false, false)) {
            while (indexes.next()) {
                if (index.equalsIgnoreCase(indexes.getString("INDEX_NAME"))) {
                    return true;
                }
            }
            return false;
        }
    }

    private record Column(String table, String name, String definition) {
    }

    private record Index(String table, String name, String columns) {
    }
}
