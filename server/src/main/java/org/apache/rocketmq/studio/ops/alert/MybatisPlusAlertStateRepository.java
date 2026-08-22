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

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import lombok.RequiredArgsConstructor;
import org.apache.rocketmq.studio.persistence.entity.RmqAlertState;
import org.apache.rocketmq.studio.persistence.mapper.RmqAlertStateMapper;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class MybatisPlusAlertStateRepository implements AlertStateRepository {
    private final RmqAlertStateMapper mapper;

    @Override
    public Optional<AlertRuleState> find(AlertStateKey key) {
        return Optional.ofNullable(mapper.selectOne(new QueryWrapper<RmqAlertState>()
                .eq("rule_id", key.ruleId()).eq("fingerprint", key.fingerprint()).last("LIMIT 1")))
                .map(MybatisPlusAlertStateRepository::toState);
    }

    @Override
    public void save(AlertStateKey key, AlertRuleState state) {
        RmqAlertState entity = mapper.selectOne(new QueryWrapper<RmqAlertState>()
                .eq("rule_id", key.ruleId()).eq("fingerprint", key.fingerprint()).last("LIMIT 1"));
        if (entity == null) {
            entity = new RmqAlertState();
            entity.setRuleId(key.ruleId());
            entity.setFingerprint(key.fingerprint());
            entity.setVersion(0);
            apply(entity, state);
            mapper.insert(entity);
        } else {
            int version = entity.getVersion() == null ? 0 : entity.getVersion();
            apply(entity, state);
            // A concurrent acknowledgement wins over this sample. The next collection cycle reloads the state.
            mapper.updateIfVersion(entity, version);
        }
    }

    @Override
    public boolean acknowledge(AlertStateKey key) {
        return mapper.acknowledgeFiring(key.ruleId(), key.fingerprint(), LocalDateTime.now(ZoneOffset.UTC)) > 0;
    }

    private static void apply(RmqAlertState entity, AlertRuleState state) {
        entity.setStatus(state.status().name());
        entity.setConsecutiveHits(state.consecutiveHits());
        entity.setCurrentValue(state.currentValue());
        entity.setFirstPendingAt(toLocal(state.firstPendingAt()));
        entity.setFiredAt(toLocal(state.firedAt()));
        entity.setResolvedAt(toLocal(state.resolvedAt()));
        entity.setGmtModified(LocalDateTime.now(ZoneOffset.UTC));
    }

    private static AlertRuleState toState(RmqAlertState entity) {
        return new AlertRuleState(AlertStateStatus.valueOf(entity.getStatus()),
                entity.getConsecutiveHits() == null ? 0 : entity.getConsecutiveHits(), entity.getCurrentValue(),
                toInstant(entity.getFirstPendingAt()), toInstant(entity.getFiredAt()), toInstant(entity.getResolvedAt()));
    }

    private static LocalDateTime toLocal(Instant instant) {
        return instant == null ? null : LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private static Instant toInstant(LocalDateTime value) {
        return value == null ? null : value.toInstant(ZoneOffset.UTC);
    }
}
