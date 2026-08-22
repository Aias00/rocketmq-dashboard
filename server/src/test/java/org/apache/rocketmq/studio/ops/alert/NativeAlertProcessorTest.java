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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class NativeAlertProcessorTest {

    @Test
    void requiresInstanceScopeBeforeProcessingNativeSamples() {
        AlertService service = mock(AlertService.class);
        when(service.listRules(AlertDomain.BUSINESS)).thenReturn(List.of(rule(null, null, 1)));
        AlertStateRepository states = mock(AlertStateRepository.class);
        AlertRepository alerts = mock(AlertRepository.class);

        processor(service, states, alerts).process(List.of(sample("orders")));

        verifyNoInteractions(states, alerts);
    }

    @Test
    void appliesConsumerGroupScopeAndConsecutiveSampleRequirement() {
        AlertService service = mock(AlertService.class);
        AlertRuleVO rule = rule("local", "orders", 2);
        when(service.listRules(AlertDomain.BUSINESS)).thenReturn(List.of(rule));
        Map<AlertStateKey, AlertRuleState> saved = new HashMap<>();
        AlertStateRepository states = new AlertStateRepository() {
            @Override
            public Optional<AlertRuleState> find(AlertStateKey key) {
                return Optional.ofNullable(saved.get(key));
            }

            @Override
            public void save(AlertStateKey key, AlertRuleState state) {
                saved.put(key, state);
            }

            @Override
            public boolean acknowledge(AlertStateKey key) {
                return false;
            }
        };
        AlertRepository alerts = mock(AlertRepository.class);
        NativeAlertProcessor processor = processor(service, states, alerts);

        processor.process(List.of(sample("payments")));
        assertThat(saved).isEmpty();

        processor.process(List.of(sample("orders")));
        assertThat(saved.values()).singleElement().extracting(AlertRuleState::status)
                .isEqualTo(AlertStateStatus.PENDING);
        verifyNoInteractions(alerts);

        processor.process(List.of(sample("orders")));
        assertThat(saved.values()).singleElement().extracting(AlertRuleState::status)
                .isEqualTo(AlertStateStatus.FIRING);
    }

    @Test
    void loadsRulesOncePerDomainForABatchOfSamples() {
        AlertService service = mock(AlertService.class);
        when(service.listRules(AlertDomain.BUSINESS)).thenReturn(List.of());

        processor(service, mock(AlertStateRepository.class), mock(AlertRepository.class))
                .process(List.of(sample("orders"), sample("payments")));

        verify(service, times(1)).listRules(AlertDomain.BUSINESS);
    }

    private static NativeAlertProcessor processor(AlertService service, AlertStateRepository states,
            AlertRepository alerts) {
        return new NativeAlertProcessor(service, new AlertRuleEvaluator(), new AlertStateMachine(), states, alerts,
                mock(NotificationOutboxService.class));
    }

    private static AlertRuleVO rule(String instanceId, String group, int consecutiveSamples) {
        return AlertRuleVO.builder().id(1L).domain(AlertDomain.BUSINESS).name("Orders lag")
                .metric("consumer.lag.total").operator(">").threshold(10).enabled(true)
                .instanceId(instanceId).consumerGroup(group).consecutiveSamples(consecutiveSamples).build();
    }

    private static MetricSample sample(String group) {
        return new MetricSample("consumer.lag.total", AlertDomain.BUSINESS, "local", null,
                Map.of("consumerGroup", group), 20D, MetricAvailability.AVAILABLE, Instant.now());
    }
}
