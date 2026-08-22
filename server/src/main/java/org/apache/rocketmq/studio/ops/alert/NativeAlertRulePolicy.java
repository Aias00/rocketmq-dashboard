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

import org.apache.rocketmq.studio.common.exception.BusinessException;
import org.springframework.util.StringUtils;

import java.util.Map;
import java.util.Set;

/** Enforces the scope required to safely evaluate Studio-native metric rules. */
final class NativeAlertRulePolicy {
    private static final Map<String, AlertDomain> NATIVE_METRICS = Map.of(
            "nameserver.availability", AlertDomain.CLUSTER,
            "broker.availability", AlertDomain.CLUSTER,
            "proxy.availability", AlertDomain.CLUSTER,
            "cloud.instance.availability", AlertDomain.CLUSTER,
            "broker.disk.usage_ratio", AlertDomain.CLUSTER,
            "broker.jvm.heap.usage_ratio", AlertDomain.CLUSTER,
            "broker.send_queue.usage_ratio", AlertDomain.CLUSTER,
            "consumer.lag.total", AlertDomain.BUSINESS,
            "consumer.lag.max_queue", AlertDomain.BUSINESS,
            "dlq.message.count", AlertDomain.BUSINESS);
    private static final Set<String> GROUP_SCOPED_METRICS = Set.of(
            "consumer.lag.total", "consumer.lag.max_queue", "dlq.message.count");
    private static final Set<String> AVAILABILITY_METRICS = Set.of(
            "nameserver.availability", "broker.availability", "proxy.availability", "cloud.instance.availability");

    private NativeAlertRulePolicy() {
    }

    static void validate(AlertRuleVO rule) {
        if (!StringUtils.hasText(rule.getMetric())) {
            return;
        }
        AlertDomain metricDomain = NATIVE_METRICS.get(rule.getMetric());
        if (metricDomain == null) {
            return;
        }
        if (rule.getDomain() != metricDomain) {
            throw new BusinessException(400, "Native metric " + rule.getMetric()
                    + " belongs to the " + metricDomain + " alert domain");
        }
        if (!StringUtils.hasText(rule.getInstanceId())) {
            throw new BusinessException(400, "instanceId is required for native alert rules");
        }
        if ("UNAVAILABLE".equals(rule.getOperator()) && !AVAILABILITY_METRICS.contains(rule.getMetric())) {
            throw new BusinessException(400, "UNAVAILABLE is only supported for native availability metrics");
        }
        if (StringUtils.hasText(rule.getConsumerGroup()) && !GROUP_SCOPED_METRICS.contains(rule.getMetric())) {
            throw new BusinessException(400, "consumerGroup is not supported for metric " + rule.getMetric());
        }
        if (rule.getConsecutiveSamples() < 1) {
            throw new BusinessException(400, "consecutiveSamples must be at least 1");
        }
    }
}
