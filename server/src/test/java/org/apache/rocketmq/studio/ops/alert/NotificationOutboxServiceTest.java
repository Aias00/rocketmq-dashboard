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
import org.apache.rocketmq.studio.settings.GeneralSettingsVO;
import org.apache.rocketmq.studio.settings.SettingsRepository;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

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

    @Test
    void dispatchesDingTalkDeliveryAndMarksTheOutboxRowDelivered() {
        RmqAlertNotificationOutboxMapper mapper = mock(RmqAlertNotificationOutboxMapper.class);
        SettingsRepository settings = mock(SettingsRepository.class);
        AlertSilenceService silences = mock(AlertSilenceService.class);
        AlertRepository alerts = mock(AlertRepository.class);
        RestTemplate client = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(client).build();
        RmqAlertNotificationOutbox row = new RmqAlertNotificationOutbox();
        row.setId(8L);
        row.setAlertId(9L);
        row.setChannel("dingtalk");
        row.setStatus("PENDING");
        row.setAttemptCount(0);
        when(mapper.selectList(any())).thenReturn(List.of(row));
        when(mapper.update(any(), any())).thenReturn(1);
        when(alerts.findAlerts(null)).thenReturn(List.of(SystemAlertVO.builder().id(9L)
                .level(AlertLevel.warning).title("Lag").description("high").instanceId("local").build()));
        when(settings.loadGeneralSettings()).thenReturn(GeneralSettingsVO.builder()
                .dingtalkWebhook("https://example.com/hook").build());
        server.expect(once(), requestTo("https://example.com/hook"))
                .andExpect(method(org.springframework.http.HttpMethod.POST))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("Lag")))
                .andRespond(withSuccess());

        new NotificationOutboxService(mapper, settings, silences, alerts, client).dispatch();

        server.verify();
        verify(mapper, org.mockito.Mockito.times(2)).update(any(), any());
    }

    @Test
    void retriesAClaimedDeliveryWhenNoWebhookIsConfigured() {
        RmqAlertNotificationOutboxMapper mapper = mock(RmqAlertNotificationOutboxMapper.class);
        RmqAlertNotificationOutbox row = new RmqAlertNotificationOutbox();
        row.setId(8L);
        row.setAlertId(9L);
        row.setChannel("dingtalk");
        row.setStatus("PENDING");
        row.setAttemptCount(0);
        when(mapper.selectList(any())).thenReturn(List.of(row));
        when(mapper.update(any(), any())).thenReturn(1);
        AlertRepository alerts = mock(AlertRepository.class);
        when(alerts.findAlerts(null)).thenReturn(List.of(SystemAlertVO.builder().id(9L).build()));

        new NotificationOutboxService(mapper, mock(SettingsRepository.class), mock(AlertSilenceService.class), alerts)
                .dispatch();

        verify(mapper, org.mockito.Mockito.times(2)).update(any(), argThat(wrapper -> wrapper != null));
    }
}
