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

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.rocketmq.studio.instance.InstanceRepository;
import org.apache.rocketmq.studio.instance.InstanceVO;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

/** Runs native collectors independently for each configured instance. */
@Slf4j
@Component
@RequiredArgsConstructor
@EnableConfigurationProperties(AlertingProperties.class)
public class CollectorScheduler {
    private final AlertingProperties properties;
    private final InstanceRepository instanceRepository;
    private final List<ClusterMetricsCollector> clusterCollectors;
    private final List<BusinessMetricsCollector> businessCollectors;
    private final MetricSnapshotRepository snapshotRepository;

    @Scheduled(fixedDelayString = "${studio.alerting.collection-interval:PT30S}")
    public void collect() {
        if (!properties.isCollectionEnabled()) {
            return;
        }
        for (InstanceVO instance : instanceRepository.findAll()) {
            collectClusterMetrics(instance);
            collectBusinessMetrics(instance);
        }
    }

    private void collectClusterMetrics(InstanceVO instance) {
        for (ClusterMetricsCollector collector : clusterCollectors) {
            try {
                persist(collector.supports(instance) ? collector.collect(instance) : List.of());
            } catch (RuntimeException error) {
                log.warn("Native metric collector failed for instance {}: {}", instance.getName(), error.getMessage());
            }
        }
    }

    private void collectBusinessMetrics(InstanceVO instance) {
        for (BusinessMetricsCollector collector : businessCollectors) {
            try {
                persist(collector.supports(instance) ? collector.collect(instance) : List.of());
            } catch (RuntimeException error) {
                log.warn("Native metric collector failed for instance {}: {}", instance.getName(), error.getMessage());
            }
        }
    }

    private void persist(List<MetricSample> samples) {
        if (!samples.isEmpty()) {
            snapshotRepository.saveAll(samples);
        }
    }
}
