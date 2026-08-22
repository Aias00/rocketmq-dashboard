/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0.
 */
package org.apache.rocketmq.studio.ops.alert;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.rocketmq.studio.common.util.NoRedirectClientHttpRequestFactory;
import org.apache.rocketmq.studio.common.util.UrlHostGuard;
import org.apache.rocketmq.studio.persistence.entity.RmqAlertNotificationOutbox;
import org.apache.rocketmq.studio.persistence.mapper.RmqAlertNotificationOutboxMapper;
import org.apache.rocketmq.studio.settings.GeneralSettingsVO;
import org.apache.rocketmq.studio.settings.SettingsRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Persists notification work so collection never blocks on remote webhook availability. */
@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationOutboxService {
    private static final int MAX_ATTEMPTS = 5;
    private static final int BATCH_SIZE = 20;

    private final RmqAlertNotificationOutboxMapper mapper;
    private final SettingsRepository settingsRepository;
    private final AlertSilenceService silenceService;
    private final AlertRepository alertRepository;
    private final RestTemplate restTemplate = newClient();

    public void enqueue(SystemAlertVO alert, AlertRuleVO rule) {
        if (alert.getId() == null || silenceService.isActive(rule, alert.getInstanceId(), alert.getTime())) {
            return;
        }
        Set<String> channels = new LinkedHashSet<>();
        if (rule.getChannels() != null) {
            rule.getChannels().stream().filter(StringUtils::hasText)
                    .map(value -> value.trim().toLowerCase()).forEach(channels::add);
        }
        for (String channel : channels) {
            if (!"dingtalk".equals(channel) && !"sms".equals(channel)) {
                continue;
            }
            RmqAlertNotificationOutbox row = new RmqAlertNotificationOutbox();
            row.setAlertId(alert.getId());
            row.setChannel(channel);
            row.setStatus(NotificationOutboxStatus.PENDING.name());
            row.setAttemptCount(0);
            row.setNextAttemptAt(LocalDateTime.now());
            mapper.insert(row);
        }
    }

    @Scheduled(fixedDelayString = "${studio.alerting.notification-dispatch-interval:PT10S}")
    public void dispatch() {
        LocalDateTime now = LocalDateTime.now();
        List<RmqAlertNotificationOutbox> due = mapper.selectList(new QueryWrapper<RmqAlertNotificationOutbox>()
                .in("status", NotificationOutboxStatus.PENDING.name(), NotificationOutboxStatus.RETRY_WAIT.name())
                .le("next_attempt_at", now).orderByAsc("id").last("LIMIT " + BATCH_SIZE));
        for (RmqAlertNotificationOutbox row : due) {
            if (mapper.update(null, new UpdateWrapper<RmqAlertNotificationOutbox>().eq("id", row.getId())
                    .in("status", NotificationOutboxStatus.PENDING.name(), NotificationOutboxStatus.RETRY_WAIT.name())
                    .set("status", NotificationOutboxStatus.SENDING.name())) != 1) {
                continue;
            }
            send(row, now);
        }
    }

    private void send(RmqAlertNotificationOutbox row, LocalDateTime now) {
        try {
            SystemAlertVO alert = loadAlert(row.getAlertId());
            String webhook = webhook(row.getChannel());
            if (!StringUtils.hasText(webhook)) {
                throw new IllegalStateException("No configured " + row.getChannel() + " webhook");
            }
            UrlHostGuard.check(webhook, false);
            ResponseEntity<Void> response = restTemplate.postForEntity(webhook, payload(alert, row.getChannel()), Void.class);
            if (!response.getStatusCode().is2xxSuccessful()) {
                throw new IllegalStateException("Webhook returned " + response.getStatusCode());
            }
            mapper.update(null, new UpdateWrapper<RmqAlertNotificationOutbox>().eq("id", row.getId())
                    .set("status", NotificationOutboxStatus.DELIVERED.name()).set("delivered_at", now)
                    .set("last_error", null));
        } catch (Exception error) {
            retry(row, now, error.getMessage());
        }
    }

    private SystemAlertVO loadAlert(Long id) {
        return alertRepository.findAlerts(null).stream().filter(alert -> id.equals(alert.getId())).findFirst()
                .orElseThrow(() -> new IllegalStateException("Alert event no longer exists: " + id));
    }

    private String webhook(String channel) {
        GeneralSettingsVO settings = settingsRepository.loadGeneralSettings();
        return settings == null ? null : ("dingtalk".equals(channel)
                ? settings.getDingtalkWebhook() : settings.getSmsWebhook());
    }

    private Map<String, Object> payload(SystemAlertVO alert, String channel) {
        String content = "[" + alert.getLevel() + "] " + alert.getTitle() + " - " + alert.getDescription();
        if ("dingtalk".equals(channel)) {
            return Map.of("msgtype", "text", "text", Map.of("content", content));
        }
        return Map.of("title", alert.getTitle(), "description", alert.getDescription(), "level", alert.getLevel(),
                "transition", alert.getTransition(), "instanceId", alert.getInstanceId());
    }

    private void retry(RmqAlertNotificationOutbox row, LocalDateTime now, String error) {
        int attempts = (row.getAttemptCount() == null ? 0 : row.getAttemptCount()) + 1;
        boolean exhausted = attempts >= MAX_ATTEMPTS;
        mapper.update(null, new UpdateWrapper<RmqAlertNotificationOutbox>().eq("id", row.getId())
                .set("attempt_count", attempts).set("status", (exhausted ? NotificationOutboxStatus.FAILED
                        : NotificationOutboxStatus.RETRY_WAIT).name())
                .set("next_attempt_at", now.plusSeconds(Math.min(300, 5L << Math.min(attempts - 1, 5))))
                .set("last_error", abbreviate(error)));
        log.warn("Alert notification {} for event {}: {}", exhausted ? "failed" : "will retry", row.getAlertId(), error);
    }

    private static String abbreviate(String value) {
        if (value == null) return "Delivery failed";
        return value.length() > 1000 ? value.substring(0, 1000) : value;
    }

    private static RestTemplate newClient() {
        NoRedirectClientHttpRequestFactory factory = new NoRedirectClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(3));
        factory.setReadTimeout(Duration.ofSeconds(5));
        return new RestTemplate(factory);
    }
}
