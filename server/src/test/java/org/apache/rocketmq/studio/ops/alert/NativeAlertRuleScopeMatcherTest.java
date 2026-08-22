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

import org.apache.rocketmq.studio.cluster.metrics.MetricAvailability;
import org.apache.rocketmq.studio.cluster.metrics.MetricSample;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class NativeAlertRuleScopeMatcherTest {
    @Test
    void matchesExactBrokerAndClusterSelectors() {
        AlertRuleVO rule = AlertRuleVO.builder().instanceId("local").brokerName("broker-a")
                .clusterName("cluster-a").build();

        assertThat(NativeAlertRuleScopeMatcher.matches(rule, sample("cluster-a", "broker-a"))).isTrue();
        assertThat(NativeAlertRuleScopeMatcher.matches(rule, sample("cluster-a", "broker-b"))).isFalse();
        assertThat(NativeAlertRuleScopeMatcher.matches(rule, sample("cluster-b", "broker-a"))).isFalse();
    }

    @Test
    void wildcardSelectorsMatchAllAvailableResources() {
        AlertRuleVO rule = AlertRuleVO.builder().instanceId("local").brokerName("*").clusterName("*").build();

        assertThat(NativeAlertRuleScopeMatcher.matches(rule, sample("cluster-a", "broker-a"))).isTrue();
    }

    private static MetricSample sample(String clusterId, String brokerName) {
        return new MetricSample("broker.availability", AlertDomain.CLUSTER, "local", clusterId,
                Map.of("brokerName", brokerName), 1D, MetricAvailability.AVAILABLE, Instant.now());
    }
}
