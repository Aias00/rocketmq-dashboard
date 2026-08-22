/*
Licensed to the Apache Software Foundation (ASF) under one or more
contributor license agreements.  See the NOTICE file distributed with
this work for additional information regarding copyright ownership.
The ASF licenses this file to You under the Apache License, Version 2.0.
*/
package org.apache.rocketmq.studio.ops.alert;

import org.apache.rocketmq.studio.common.domain.enums.AlertLevel;
import org.apache.rocketmq.studio.persistence.entity.RmqAlertNotificationOutbox;
import org.apache.rocketmq.studio.persistence.mapper.RmqAlertNotificationOutboxMapper;
import org.apache.rocketmq.studio.settings.SettingsRepository;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class NotificationOutboxServiceTest {
    @Test
    void enqueuesEachSupportedChannelOnceUnlessTheEventIsSilenced() {
        RmqAlertNotificationOutboxMapper mapper = mock(RmqAlertNotificationOutboxMapper.class);
        AlertSilenceService silences = mock(AlertSilenceService.class);
        AlertRuleVO rule = AlertRuleVO.builder().id(4L).domain(AlertDomain.BUSINESS)
                .channels(List.of("dingtalk", "sms", "dingtalk", "email")).build();
        SystemAlertVO alert = SystemAlertVO.builder().id(9L).level(AlertLevel.warning).title("Lag")
                .description("lag is high").instanceId("local").time(LocalDateTime.now()).build();
        NotificationOutboxService service = new NotificationOutboxService(mapper, mock(SettingsRepository.class),
                silences, mock(AlertRepository.class));

        when(silences.isActive(rule, "local", alert.getTime())).thenReturn(false);
        service.enqueue(alert, rule);
        verify(mapper, org.mockito.Mockito.times(2)).insert(any(RmqAlertNotificationOutbox.class));

        when(silences.isActive(rule, "local", alert.getTime())).thenReturn(true);
        service.enqueue(alert, rule);
        verify(mapper, org.mockito.Mockito.times(2)).insert(any(RmqAlertNotificationOutbox.class));
    }
}
