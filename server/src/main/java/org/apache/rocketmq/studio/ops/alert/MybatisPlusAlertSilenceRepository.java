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
import org.apache.rocketmq.studio.persistence.entity.RmqAlertSilence;
import org.apache.rocketmq.studio.persistence.mapper.RmqAlertSilenceMapper;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
@RequiredArgsConstructor
public class MybatisPlusAlertSilenceRepository implements AlertSilenceRepository {
    private final RmqAlertSilenceMapper mapper;

    @Override
    public AlertSilenceVO save(AlertSilenceVO silence) {
        RmqAlertSilence entity = toEntity(silence);
        mapper.insert(entity);
        silence.setId(entity.getId());
        return silence;
    }

    @Override
    public List<AlertSilenceVO> findAll() {
        return mapper.selectList(new QueryWrapper<RmqAlertSilence>()
                        .orderByDesc("ends_at").orderByDesc("id"))
                .stream().map(MybatisPlusAlertSilenceRepository::toVo).toList();
    }

    @Override
    public boolean deleteById(Long id) {
        return mapper.deleteById(id) > 0;
    }

    private static RmqAlertSilence toEntity(AlertSilenceVO silence) {
        RmqAlertSilence entity = new RmqAlertSilence();
        entity.setDomain(silence.getDomain() == null ? null : silence.getDomain().name());
        entity.setRuleId(silence.getRuleId());
        entity.setInstanceId(silence.getInstanceId());
        entity.setStartsAt(silence.getStartsAt());
        entity.setEndsAt(silence.getEndsAt());
        entity.setReason(silence.getReason());
        entity.setCreatedBy(silence.getCreatedBy());
        return entity;
    }

    private static AlertSilenceVO toVo(RmqAlertSilence entity) {
        return AlertSilenceVO.builder().id(entity.getId())
                .domain(entity.getDomain() == null ? null : AlertDomain.valueOf(entity.getDomain()))
                .ruleId(entity.getRuleId()).instanceId(entity.getInstanceId())
                .startsAt(entity.getStartsAt()).endsAt(entity.getEndsAt())
                .reason(entity.getReason()).createdBy(entity.getCreatedBy()).build();
    }
}
