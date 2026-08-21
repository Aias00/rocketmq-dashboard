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
import org.apache.rocketmq.studio.cluster.metrics.MetricSample;
import org.apache.rocketmq.studio.common.domain.enums.AlertLevel;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

/** Applies native samples to persisted rule state and emits only lifecycle transitions. */
@Component
@RequiredArgsConstructor
public class NativeAlertProcessor {
    private final AlertService alertService;
    private final AlertRuleEvaluator evaluator;
    private final AlertStateMachine stateMachine;
    private final AlertStateRepository stateRepository;
    private final AlertRepository alertRepository;

    public void process(List<MetricSample> samples) {
        for (MetricSample sample : samples) {
            for (AlertRuleVO rule : alertService.listRules(sample.domain())) {
                if (rule.getId() == null) {
                    continue;
                }
                AlertEvaluationResult evaluation = evaluator.evaluate(rule, sample);
                if (!evaluation.matches()) {
                    continue;
                }
                AlertStateKey key = new AlertStateKey(rule.getId(),
                        AlertFingerprint.of(rule.getId(), sample.instanceId(), sample.labels()));
                AlertStateUpdate update = stateMachine.advance(stateRepository.find(key).orElse(null), evaluation,
                        1, sample.collectedAt());
                stateRepository.save(key, update.state());
                if (update.transition() == AlertStateTransition.FIRING || update.transition() == AlertStateTransition.RESOLVED) {
                    alertRepository.saveAlert(SystemAlertVO.builder().level(level(rule.getSeverity()))
                            .title(rule.getName()).description(update.transition() + " " + sample.metricKey()
                                    + " on " + sample.instanceId()).time(LocalDateTime.ofInstant(sample.collectedAt(), ZoneOffset.UTC))
                            .acknowledged(false).domain(sample.domain()).ruleId(rule.getId())
                            .fingerprint(key.fingerprint()).transition(update.transition().name())
                            .instanceId(sample.instanceId()).currentValue(update.state().currentValue()).build());
                }
            }
        }
    }

    private static AlertLevel level(String severity) {
        if ("critical".equalsIgnoreCase(severity)) {
            return AlertLevel.error;
        }
        if ("warning".equalsIgnoreCase(severity)) {
            return AlertLevel.warning;
        }
        return AlertLevel.info;
    }
}
