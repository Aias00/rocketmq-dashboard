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
package org.apache.rocketmq.studio.cluster.metrics;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.apache.rocketmq.studio.persistence.entity.RmqMetricSnapshot;
import org.apache.rocketmq.studio.persistence.mapper.RmqMetricSnapshotMapper;
import org.springframework.stereotype.Repository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

@Repository
@RequiredArgsConstructor
public class MybatisPlusMetricSnapshotRepository implements MetricSnapshotRepository {
    private final RmqMetricSnapshotMapper mapper;
    private final ObjectMapper objectMapper;

    @Override
    public void saveAll(List<MetricSample> samples) {
        for (MetricSample sample : samples) {
            mapper.insert(toEntity(sample));
        }
    }

    @Override
    public int deleteBefore(Instant cutoff) {
        return Math.toIntExact(mapper.delete(new QueryWrapper<RmqMetricSnapshot>()
                .lt("collected_at", LocalDateTime.ofInstant(cutoff, ZoneOffset.UTC))));
    }

    private RmqMetricSnapshot toEntity(MetricSample sample) {
        Map<String, String> labels = new TreeMap<>(sample.labels());
        String labelsJson;
        try {
            labelsJson = objectMapper.writeValueAsString(labels);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Unable to serialize metric labels", error);
        }
        RmqMetricSnapshot entity = new RmqMetricSnapshot();
        entity.setInstanceId(sample.instanceId());
        entity.setMetricKey(sample.metricKey());
        entity.setDomain(sample.domain().name());
        entity.setClusterId(sample.clusterId());
        entity.setLabelsHash(sha256(labelsJson));
        entity.setLabelsJson(labelsJson);
        entity.setValue(sample.value());
        entity.setAvailability(sample.availability().name());
        entity.setCollectedAt(LocalDateTime.ofInstant(sample.collectedAt(), ZoneOffset.UTC));
        return entity;
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte item : digest) {
                hex.append(String.format("%02x", item));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is not available", impossible);
        }
    }
}
