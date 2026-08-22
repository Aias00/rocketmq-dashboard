/*
Licensed to the Apache Software Foundation (ASF) under one or more
contributor license agreements.  See the NOTICE file distributed with
this work for additional information regarding copyright ownership.
The ASF licenses this file to You under the Apache License, Version 2.0.
*/
package org.apache.rocketmq.studio.ops.alert;

import org.apache.rocketmq.studio.common.domain.enums.AlertLevel;
import org.apache.rocketmq.studio.audit.OperationAuditService;
import org.apache.rocketmq.studio.persistence.entity.RmqAlertNotificationOutbox;
import org.apache.rocketmq.studio.persistence.mapper.RmqAlertNotificationOutboxMapper;
import org.apache.rocketmq.studio.settings.GeneralSettingsVO;
import org.apache.rocketmq.studio.settings.SettingsRepository;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
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
                silences, mock(AlertRepository.class), mock(OperationAuditService.class));

        when(silences.activeUntil(rule, "local", java.util.Map.of(), alert.getTime())).thenReturn(null);
        service.enqueue(alert, rule);
        verify(mapper, org.mockito.Mockito.times(3)).insert(any(RmqAlertNotificationOutbox.class));

        when(silences.activeUntil(rule, "local", java.util.Map.of(), alert.getTime()))
                .thenReturn(alert.getTime().plusHours(1));
        service.enqueue(alert, rule);
        verify(mapper, org.mockito.Mockito.times(6)).insert(any(RmqAlertNotificationOutbox.class));
    }

    @Test
    void defersDeliveryUntilTheActiveSilenceEnds() {
        RmqAlertNotificationOutboxMapper mapper = mock(RmqAlertNotificationOutboxMapper.class);
        AlertSilenceService silences = mock(AlertSilenceService.class);
        AlertRepository alerts = mock(AlertRepository.class);
        OperationAuditService audit = mock(OperationAuditService.class);
        RmqAlertNotificationOutbox row = new RmqAlertNotificationOutbox();
        row.setId(8L);
        row.setAlertId(9L);
        row.setChannel("dingtalk");
        when(mapper.findDispatchable(any(LocalDateTime.class), any(LocalDateTime.class), any(Integer.class)))
                .thenReturn(List.of(row));
        when(mapper.claimForDispatch(any(), any(LocalDateTime.class), any(LocalDateTime.class),
                any(LocalDateTime.class))).thenReturn(1);
        LocalDateTime silenceEndsAt = LocalDateTime.now().plusHours(1);
        when(alerts.findAlerts(null)).thenReturn(List.of(SystemAlertVO.builder().id(9L).ruleId(4L)
                .domain(AlertDomain.BUSINESS).instanceId("local").build()));
        when(silences.activeUntil(any(AlertRuleVO.class), org.mockito.ArgumentMatchers.eq("local"),
                org.mockito.ArgumentMatchers.eq(java.util.Map.of()), any(LocalDateTime.class))).thenReturn(silenceEndsAt);

        new NotificationOutboxService(mapper, mock(SettingsRepository.class), silences, alerts, audit).dispatch();

        verify(mapper).update(any(), any());
        verify(audit, never()).record(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void dispatchesDingTalkDeliveryAndMarksTheOutboxRowDelivered() {
        RmqAlertNotificationOutboxMapper mapper = mock(RmqAlertNotificationOutboxMapper.class);
        SettingsRepository settings = mock(SettingsRepository.class);
        AlertSilenceService silences = mock(AlertSilenceService.class);
        AlertRepository alerts = mock(AlertRepository.class);
        OperationAuditService audit = mock(OperationAuditService.class);
        RestTemplate client = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(client).build();
        RmqAlertNotificationOutbox row = new RmqAlertNotificationOutbox();
        row.setId(8L);
        row.setAlertId(9L);
        row.setChannel("dingtalk");
        row.setStatus("PENDING");
        row.setAttemptCount(0);
        when(mapper.findDispatchable(any(LocalDateTime.class), any(LocalDateTime.class), any(Integer.class)))
                .thenReturn(List.of(row));
        when(mapper.claimForDispatch(any(), any(LocalDateTime.class), any(LocalDateTime.class),
                any(LocalDateTime.class))).thenReturn(1);
        when(mapper.update(any(), any())).thenReturn(1);
        when(alerts.findAlerts(null)).thenReturn(List.of(SystemAlertVO.builder().id(9L)
                .level(AlertLevel.warning).title("Lag").description("high").instanceId("local")
                .labels(java.util.Map.of("topic", "orders")).build()));
        when(settings.loadGeneralSettings()).thenReturn(GeneralSettingsVO.builder()
                .dingtalkWebhook("https://example.com/hook").build());
        server.expect(once(), requestTo("https://example.com/hook"))
                .andExpect(method(org.springframework.http.HttpMethod.POST))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("Lag")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("orders")))
                .andRespond(withSuccess());

        new NotificationOutboxService(mapper, settings, silences, alerts, audit, client).dispatch();

        server.verify();
        verify(mapper).update(any(), any());
        verify(audit).record("DELIVER_ALERT_NOTIFICATION", "ALERT_NOTIFICATION", "8", null,
                "alertId=9, channel=dingtalk", "SUCCESS", null);
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
        when(mapper.findDispatchable(any(LocalDateTime.class), any(LocalDateTime.class), any(Integer.class)))
                .thenReturn(List.of(row));
        when(mapper.claimForDispatch(any(), any(LocalDateTime.class), any(LocalDateTime.class),
                any(LocalDateTime.class))).thenReturn(1);
        when(mapper.update(any(), any())).thenReturn(1);
        AlertRepository alerts = mock(AlertRepository.class);
        OperationAuditService audit = mock(OperationAuditService.class);
        when(alerts.findAlerts(null)).thenReturn(List.of(SystemAlertVO.builder().id(9L).build()));

        new NotificationOutboxService(mapper, mock(SettingsRepository.class), mock(AlertSilenceService.class), alerts,
                audit).dispatch();

        verify(mapper).update(any(), argThat(wrapper -> wrapper != null));
        verify(audit).record("RETRY_ALERT_NOTIFICATION", "ALERT_NOTIFICATION", "8", null,
                "alertId=9, channel=dingtalk", "RETRYING", "No configured dingtalk webhook");
    }

    @Test
    void dispatchesEmailDeliveryToConfiguredRecipients() {
        RmqAlertNotificationOutboxMapper mapper = mock(RmqAlertNotificationOutboxMapper.class);
        SettingsRepository settings = mock(SettingsRepository.class);
        AlertRepository alerts = mock(AlertRepository.class);
        OperationAuditService audit = mock(OperationAuditService.class);
        JavaMailSender mailSender = mock(JavaMailSender.class);
        RmqAlertNotificationOutbox row = new RmqAlertNotificationOutbox();
        row.setId(8L);
        row.setAlertId(9L);
        row.setChannel("email");
        row.setStatus("PENDING");
        row.setAttemptCount(0);
        when(mapper.findDispatchable(any(LocalDateTime.class), any(LocalDateTime.class), any(Integer.class)))
                .thenReturn(List.of(row));
        when(mapper.claimForDispatch(any(), any(LocalDateTime.class), any(LocalDateTime.class),
                any(LocalDateTime.class))).thenReturn(1);
        when(mapper.update(any(), any())).thenReturn(1);
        when(alerts.findAlerts(null)).thenReturn(List.of(SystemAlertVO.builder().id(9L)
                .level(AlertLevel.warning).title("Lag").description("high").instanceId("local").build()));
        when(settings.loadGeneralSettings()).thenReturn(GeneralSettingsVO.builder()
                .emailRecipients("ops@example.com, oncall@example.com").build());

        new NotificationOutboxService(mapper, settings, mock(AlertSilenceService.class), alerts, audit,
                new RestTemplate(), () -> mailSender).dispatch();

        verify(mailSender).send(argThat((SimpleMailMessage message) -> message.getTo() != null
                && Arrays.equals(message.getTo(), new String[] {"ops@example.com", "oncall@example.com"})
                && "[RocketMQ Studio] Lag".equals(message.getSubject())));
        verify(audit).record("DELIVER_ALERT_NOTIFICATION", "ALERT_NOTIFICATION", "8", null,
                "alertId=9, channel=email", "SUCCESS", null);
    }

    @Test
    void reclaimsAStaleSendingDelivery() {
        RmqAlertNotificationOutboxMapper mapper = mock(RmqAlertNotificationOutboxMapper.class);
        RmqAlertNotificationOutbox row = new RmqAlertNotificationOutbox();
        row.setId(8L);
        row.setAlertId(9L);
        row.setChannel("dingtalk");
        row.setStatus("SENDING");
        row.setSendingStartedAt(LocalDateTime.now().minusMinutes(2));
        when(mapper.findDispatchable(any(LocalDateTime.class), any(LocalDateTime.class), any(Integer.class)))
                .thenReturn(List.of(row));
        when(mapper.claimForDispatch(any(), any(LocalDateTime.class), any(LocalDateTime.class),
                any(LocalDateTime.class))).thenReturn(0);

        new NotificationOutboxService(mapper, mock(SettingsRepository.class), mock(AlertSilenceService.class),
                mock(AlertRepository.class), mock(OperationAuditService.class)).dispatch();

        verify(mapper).claimForDispatch(org.mockito.ArgumentMatchers.eq(8L), any(LocalDateTime.class),
                any(LocalDateTime.class), any(LocalDateTime.class));
    }
}
