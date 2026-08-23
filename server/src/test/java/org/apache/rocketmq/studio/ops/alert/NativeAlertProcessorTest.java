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
import org.apache.rocketmq.studio.cluster.metrics.MetricSnapshotRepository;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
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
            public boolean save(AlertStateKey key, AlertRuleState state) {
                saved.put(key, state);
                return true;
            }

            @Override
            public boolean acknowledge(AlertStateKey key, Instant firedAt) {
                return false;
            }

            @Override
            public void deleteByRuleId(Long ruleId) {
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

    @Test
    void doesNotEmitLifecycleEventsWhenAnotherEvaluatorWinsTheStateWrite() {
        AlertService service = mock(AlertService.class);
        when(service.listRules(AlertDomain.BUSINESS)).thenReturn(List.of(rule("local", "orders", 1)));
        AlertStateRepository states = mock(AlertStateRepository.class);
        when(states.find(any(AlertStateKey.class))).thenReturn(Optional.empty());
        when(states.save(any(AlertStateKey.class), any(AlertRuleState.class))).thenReturn(false);
        AlertRepository alerts = mock(AlertRepository.class);

        processor(service, states, alerts).process(List.of(sample("orders")));

        verifyNoInteractions(alerts);
    }

    @Test
    void evaluatesMaxAggregationAcrossTheConfiguredSnapshotWindow() {
        AlertService service = mock(AlertService.class);
        AlertRuleVO rule = AlertRuleVO.builder().id(1L).domain(AlertDomain.BUSINESS).name("Orders lag")
                .metric("consumer.lag.total").operator(">").threshold(25).enabled(true).instanceId("local")
                .consumerGroup("orders").aggregation("MAX").windowSeconds(300).build();
        when(service.listRules(AlertDomain.BUSINESS)).thenReturn(List.of(rule));
        MetricSnapshotRepository snapshots = mock(MetricSnapshotRepository.class);
        MetricSample current = sample("orders");
        when(snapshots.findRecent(any(MetricSample.class), any(Instant.class)))
                .thenReturn(List.of(sample("orders", 10D), sample("orders", 30D), current));
        Map<AlertStateKey, AlertRuleState> saved = new HashMap<>();
        AlertStateRepository states = new AlertStateRepository() {
            @Override
            public Optional<AlertRuleState> find(AlertStateKey key) {
                return Optional.empty();
            }

            @Override
            public boolean save(AlertStateKey key, AlertRuleState state) {
                saved.put(key, state);
                return true;
            }

            @Override
            public boolean acknowledge(AlertStateKey key, Instant firedAt) {
                return false;
            }

            @Override
            public void deleteByRuleId(Long ruleId) {
            }
        };

        new NativeAlertProcessor(service, new AlertRuleEvaluator(), new AlertStateMachine(), states, snapshots,
                mock(AlertRepository.class), mock(NotificationOutboxService.class)).process(List.of(current));

        assertThat(saved.values()).singleElement().satisfies(state -> {
            assertThat(state.status()).isEqualTo(AlertStateStatus.FIRING);
            assertThat(state.currentValue()).isEqualTo(30D);
        });
    }

    @Test
    void evaluatesSumAggregationAcrossTheConfiguredSnapshotWindow() {
        AlertService service = mock(AlertService.class);
        AlertRuleVO rule = AlertRuleVO.builder().id(1L).domain(AlertDomain.BUSINESS).name("Orders lag")
                .metric("consumer.lag.total").operator(">").threshold(50).enabled(true).instanceId("local")
                .consumerGroup("orders").aggregation("SUM").windowSeconds(300).build();
        when(service.listRules(AlertDomain.BUSINESS)).thenReturn(List.of(rule));
        MetricSnapshotRepository snapshots = mock(MetricSnapshotRepository.class);
        MetricSample current = sample("orders");
        when(snapshots.findRecent(any(MetricSample.class), any(Instant.class)))
                .thenReturn(List.of(sample("orders", 10D), sample("orders", 30D), current));
        Map<AlertStateKey, AlertRuleState> saved = new HashMap<>();
        AlertStateRepository states = new AlertStateRepository() {
            @Override
            public Optional<AlertRuleState> find(AlertStateKey key) {
                return Optional.empty();
            }

            @Override
            public boolean save(AlertStateKey key, AlertRuleState state) {
                saved.put(key, state);
                return true;
            }

            @Override
            public boolean acknowledge(AlertStateKey key, Instant firedAt) {
                return false;
            }

            @Override
            public void deleteByRuleId(Long ruleId) {
            }
        };

        new NativeAlertProcessor(service, new AlertRuleEvaluator(), new AlertStateMachine(), states, snapshots,
                mock(AlertRepository.class), mock(NotificationOutboxService.class)).process(List.of(current));

        assertThat(saved.values()).singleElement().satisfies(state -> {
            assertThat(state.status()).isEqualTo(AlertStateStatus.FIRING);
            assertThat(state.currentValue()).isEqualTo(60D);
        });
    }

    @Test
    void recordsTheRuleTriggerTimeWhenEmittingAFiringEvent() {
        AlertService service = mock(AlertService.class);
        when(service.listRules(AlertDomain.BUSINESS)).thenReturn(List.of(rule("local", "orders", 1)));
        AlertStateRepository states = mock(AlertStateRepository.class);
        when(states.find(any(AlertStateKey.class))).thenReturn(Optional.empty());
        when(states.save(any(AlertStateKey.class), any(AlertRuleState.class))).thenReturn(true);
        AlertRepository alerts = mock(AlertRepository.class);
        when(alerts.saveAlert(any(SystemAlertVO.class))).thenAnswer(invocation -> {
            SystemAlertVO event = invocation.getArgument(0);
            event.setId(8L);
            return event;
        });

        processor(service, states, alerts).process(List.of(sample("orders")));

        verify(alerts).markRuleTriggered(org.mockito.ArgumentMatchers.eq(1L), any(String.class));
    }

    private static NativeAlertProcessor processor(AlertService service, AlertStateRepository states,
            AlertRepository alerts) {
        return new NativeAlertProcessor(service, new AlertRuleEvaluator(), new AlertStateMachine(), states,
                mock(MetricSnapshotRepository.class), alerts, mock(NotificationOutboxService.class));
    }

    private static AlertRuleVO rule(String instanceId, String group, int consecutiveSamples) {
        return AlertRuleVO.builder().id(1L).domain(AlertDomain.BUSINESS).name("Orders lag")
                .metric("consumer.lag.total").operator(">").threshold(10).enabled(true)
                .instanceId(instanceId).consumerGroup(group).consecutiveSamples(consecutiveSamples).build();
    }

    private static MetricSample sample(String group) {
        return sample(group, 20D);
    }

    private static MetricSample sample(String group, double value) {
        return new MetricSample("consumer.lag.total", AlertDomain.BUSINESS, "local", null,
                Map.of("consumerGroup", group), value, MetricAvailability.AVAILABLE, Instant.now());
    }
}
