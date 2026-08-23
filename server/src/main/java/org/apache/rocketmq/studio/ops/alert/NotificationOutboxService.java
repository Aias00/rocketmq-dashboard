/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0.
 */
package org.apache.rocketmq.studio.ops.alert;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import lombok.extern.slf4j.Slf4j;
import org.apache.rocketmq.studio.audit.OperationAuditService;
import org.apache.rocketmq.studio.common.util.NoRedirectClientHttpRequestFactory;
import org.apache.rocketmq.studio.common.util.UrlHostGuard;
import org.apache.rocketmq.studio.persistence.entity.RmqAlertNotificationOutbox;
import org.apache.rocketmq.studio.persistence.mapper.RmqAlertNotificationOutboxMapper;
import org.apache.rocketmq.studio.settings.GeneralSettingsVO;
import org.apache.rocketmq.studio.settings.SettingsRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.ArrayList;
import java.util.function.Supplier;
import java.util.UUID;
import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;

/** Persists notification work so collection never blocks on remote webhook availability. */
@Slf4j
@Service
public class NotificationOutboxService {
    private static final int MAX_ATTEMPTS = 5;
    private static final int BATCH_SIZE = 20;
    private static final Duration CLAIM_TIMEOUT = Duration.ofMinutes(1);

    private final RmqAlertNotificationOutboxMapper mapper;
    private final SettingsRepository settingsRepository;
    private final AlertSilenceService silenceService;
    private final AlertRepository alertRepository;
    private final OperationAuditService operationAuditService;
    private final RestTemplate restTemplate;
    private final Supplier<JavaMailSender> mailSender;

    NotificationOutboxService(RmqAlertNotificationOutboxMapper mapper, SettingsRepository settingsRepository,
            AlertSilenceService silenceService, AlertRepository alertRepository,
            OperationAuditService operationAuditService) {
        this(mapper, settingsRepository, silenceService, alertRepository, operationAuditService, newClient(),
                () -> null);
    }

    @Autowired
    public NotificationOutboxService(RmqAlertNotificationOutboxMapper mapper, SettingsRepository settingsRepository,
            AlertSilenceService silenceService, AlertRepository alertRepository,
            OperationAuditService operationAuditService, ObjectProvider<JavaMailSender> mailSender) {
        this(mapper, settingsRepository, silenceService, alertRepository, operationAuditService, newClient(),
                mailSender::getIfAvailable);
    }

    NotificationOutboxService(RmqAlertNotificationOutboxMapper mapper, SettingsRepository settingsRepository,
            AlertSilenceService silenceService, AlertRepository alertRepository,
            OperationAuditService operationAuditService, RestTemplate restTemplate) {
        this(mapper, settingsRepository, silenceService, alertRepository, operationAuditService, restTemplate,
                () -> null);
    }

    NotificationOutboxService(RmqAlertNotificationOutboxMapper mapper, SettingsRepository settingsRepository,
            AlertSilenceService silenceService, AlertRepository alertRepository,
            OperationAuditService operationAuditService, RestTemplate restTemplate,
            Supplier<JavaMailSender> mailSender) {
        this.mapper = mapper;
        this.settingsRepository = settingsRepository;
        this.silenceService = silenceService;
        this.alertRepository = alertRepository;
        this.operationAuditService = operationAuditService;
        this.restTemplate = restTemplate;
        this.mailSender = mailSender;
    }

    public void enqueue(SystemAlertVO alert, AlertRuleVO rule) {
        enqueue(alert, rule, Map.of());
    }

    public void enqueue(SystemAlertVO alert, AlertRuleVO rule, Map<String, String> labels) {
        if (alert.getId() == null) {
            throw new IllegalStateException("Cannot enqueue notification for an alert without a persistent ID");
        }
        Map<String, String> effectiveLabels = labels == null ? Map.of() : labels;
        LocalDateTime silenceEndsAt = silenceService.activeUntil(rule, alert.getInstanceId(), effectiveLabels,
                alert.getTime());
        Set<String> channels = new LinkedHashSet<>();
        if (rule.getChannels() != null) {
            rule.getChannels().stream().filter(StringUtils::hasText)
                    .map(value -> value.trim().toLowerCase()).forEach(channels::add);
        }
        for (String channel : channels) {
            if (!"dingtalk".equals(channel) && !"sms".equals(channel) && !"email".equals(channel)) {
                continue;
            }
            RmqAlertNotificationOutbox row = new RmqAlertNotificationOutbox();
            row.setAlertId(alert.getId());
            row.setChannel(channel);
            row.setStatus(NotificationOutboxStatus.PENDING.name());
            row.setAttemptCount(0);
            row.setNextAttemptAt(silenceEndsAt == null ? utcNow() : silenceEndsAt);
            mapper.insert(row);
        }
    }

    public List<NotificationDeliveryVO> listDeliveries(Long alertId) {
        if (alertId == null) {
            throw new org.apache.rocketmq.studio.common.exception.BusinessException(400, "Alert ID is required");
        }
        return mapper.selectList(new QueryWrapper<RmqAlertNotificationOutbox>().eq("alert_id", alertId)
                        .orderByAsc("id"))
                .stream().map(row -> NotificationDeliveryVO.builder().channel(row.getChannel())
                        .status(NotificationOutboxStatus.valueOf(row.getStatus()))
                        .attemptCount(row.getAttemptCount() == null ? 0 : row.getAttemptCount())
                        .nextAttemptAt(row.getNextAttemptAt()).lastError(row.getLastError())
                        .deliveredAt(row.getDeliveredAt()).build()).toList();
    }

    @Scheduled(fixedDelayString = "${studio.alerting.notification-dispatch-interval:PT10S}")
    public void dispatch() {
        LocalDateTime now = utcNow();
        LocalDateTime staleBefore = now.minus(CLAIM_TIMEOUT);
        List<RmqAlertNotificationOutbox> due = mapper.findDispatchable(now, staleBefore, BATCH_SIZE);
        for (RmqAlertNotificationOutbox row : due) {
            String claimToken = UUID.randomUUID().toString();
            if (mapper.claimForDispatch(row.getId(), now, staleBefore, now, claimToken) != 1) {
                continue;
            }
            send(row, now, claimToken);
        }
    }

    private void send(RmqAlertNotificationOutbox row, LocalDateTime now, String claimToken) {
        try {
            SystemAlertVO alert = loadAlert(row.getAlertId());
            LocalDateTime silenceEndsAt = silenceService.activeUntil(
                    AlertRuleVO.builder().id(alert.getRuleId()).domain(alert.getDomain()).build(),
                    alert.getInstanceId(), alert.getLabels(), now);
            if (silenceEndsAt != null) {
                deferUntilSilenceEnds(row, silenceEndsAt, claimToken);
                return;
            }
            GeneralSettingsVO settings = settingsRepository.loadGeneralSettings();
            if ("email".equals(row.getChannel())) {
                sendEmail(settings, alert);
            } else {
                sendWebhook(settings, alert, row.getChannel());
            }
            if (!updateClaimed(row, claimToken, new UpdateWrapper<RmqAlertNotificationOutbox>()
                    .set("status", NotificationOutboxStatus.DELIVERED.name()).set("delivered_at", now)
                    .set("sending_started_at", null)
                    .set("last_error", null))) {
                return;
            }
            recordDelivery(row, "DELIVER_ALERT_NOTIFICATION", "SUCCESS", null);
        } catch (Exception error) {
            retry(row, now, claimToken, error.getMessage());
        }
    }

    private void deferUntilSilenceEnds(RmqAlertNotificationOutbox row, LocalDateTime silenceEndsAt, String claimToken) {
        updateClaimed(row, claimToken, new UpdateWrapper<RmqAlertNotificationOutbox>()
                .set("status", NotificationOutboxStatus.PENDING.name()).set("next_attempt_at", silenceEndsAt)
                .set("sending_started_at", null));
    }

    private void sendWebhook(GeneralSettingsVO settings, SystemAlertVO alert, String channel) {
        String webhook = webhook(settings, channel);
        if (!StringUtils.hasText(webhook)) {
            throw new IllegalStateException("No configured " + channel + " webhook");
        }
        UrlHostGuard.check(webhook, false);
        ResponseEntity<Void> response = restTemplate.postForEntity(webhook, payload(alert, channel), Void.class);
        if (!response.getStatusCode().is2xxSuccessful()) {
            throw new IllegalStateException("Webhook returned " + response.getStatusCode());
        }
    }

    private SystemAlertVO loadAlert(Long id) {
        return alertRepository.findAlertById(id)
                .orElseThrow(() -> new IllegalStateException("Alert event no longer exists: " + id));
    }

    private String webhook(GeneralSettingsVO settings, String channel) {
        return settings == null ? null : ("dingtalk".equals(channel)
                ? settings.getDingtalkWebhook() : settings.getSmsWebhook());
    }

    private void sendEmail(GeneralSettingsVO settings, SystemAlertVO alert) throws AddressException {
        if (settings == null || !StringUtils.hasText(settings.getEmailRecipients())) {
            throw new IllegalStateException("No configured email recipients");
        }
        JavaMailSender sender = mailSender.get();
        if (sender == null) {
            throw new IllegalStateException("SMTP is not configured");
        }
        SimpleMailMessage message = new SimpleMailMessage();
        message.setTo(parseRecipients(settings.getEmailRecipients()));
        message.setSubject("[RocketMQ Studio] " + alert.getTitle());
        message.setText("[" + alert.getLevel() + "] " + alert.getTitle() + " - " + alert.getDescription()
                + formatLabels(alert));
        sender.send(message);
    }

    private static String[] parseRecipients(String raw) throws AddressException {
        List<String> recipients = new ArrayList<>();
        for (String value : raw.split("[,;]")) {
            String recipient = value.trim();
            if (!recipient.isEmpty()) {
                InternetAddress address = new InternetAddress(recipient, true);
                address.validate();
                recipients.add(address.getAddress());
            }
        }
        if (recipients.isEmpty()) {
            throw new AddressException("No valid email recipients");
        }
        return recipients.toArray(String[]::new);
    }

    private Map<String, Object> payload(SystemAlertVO alert, String channel) {
        String content = "[" + alert.getLevel() + "] " + alert.getTitle() + " - " + alert.getDescription()
                + formatLabels(alert);
        if ("dingtalk".equals(channel)) {
            return Map.of("msgtype", "text", "text", Map.of("content", content));
        }
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("title", alert.getTitle());
        payload.put("description", alert.getDescription());
        payload.put("level", alert.getLevel());
        payload.put("transition", alert.getTransition());
        payload.put("instanceId", alert.getInstanceId());
        payload.put("labels", alert.getLabels() == null ? Map.of() : alert.getLabels());
        return payload;
    }

    private static String formatLabels(SystemAlertVO alert) {
        if (alert.getLabels() == null || alert.getLabels().isEmpty()) {
            return "";
        }
        return "\nLabels: " + alert.getLabels().entrySet().stream().sorted(Map.Entry.comparingByKey())
                .map(entry -> entry.getKey() + "=" + entry.getValue()).collect(java.util.stream.Collectors.joining(", "));
    }

    private void retry(RmqAlertNotificationOutbox row, LocalDateTime now, String claimToken, String error) {
        int attempts = (row.getAttemptCount() == null ? 0 : row.getAttemptCount()) + 1;
        boolean exhausted = attempts >= MAX_ATTEMPTS;
        if (!updateClaimed(row, claimToken, new UpdateWrapper<RmqAlertNotificationOutbox>()
                .set("attempt_count", attempts).set("status", (exhausted ? NotificationOutboxStatus.FAILED
                        : NotificationOutboxStatus.RETRY_WAIT).name())
                .set("next_attempt_at", now.plusSeconds(Math.min(300, 5L << Math.min(attempts - 1, 5))))
                .set("sending_started_at", null)
                .set("last_error", abbreviate(error)))) {
            return;
        }
        recordDelivery(row, exhausted ? "FAIL_ALERT_NOTIFICATION" : "RETRY_ALERT_NOTIFICATION",
                exhausted ? "FAILURE" : "RETRYING", abbreviate(error));
        log.warn("Alert notification {} for event {}: {}", exhausted ? "failed" : "will retry", row.getAlertId(), error);
    }

    private void recordDelivery(RmqAlertNotificationOutbox row, String operation, String result, String error) {
        operationAuditService.record(operation, "ALERT_NOTIFICATION", String.valueOf(row.getId()), null,
                "alertId=" + row.getAlertId() + ", channel=" + row.getChannel(), result, error);
    }

    private static String abbreviate(String value) {
        if (value == null) return "Delivery failed";
        return value.length() > 1000 ? value.substring(0, 1000) : value;
    }

    private boolean updateClaimed(RmqAlertNotificationOutbox row, String claimToken,
            UpdateWrapper<RmqAlertNotificationOutbox> updates) {
        return mapper.update(null, updates.eq("id", row.getId()).eq("claim_token", claimToken)) == 1;
    }

    private static LocalDateTime utcNow() {
        return LocalDateTime.now(ZoneOffset.UTC);
    }

    private static RestTemplate newClient() {
        NoRedirectClientHttpRequestFactory factory = new NoRedirectClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(3));
        factory.setReadTimeout(Duration.ofSeconds(5));
        return new RestTemplate(factory);
    }
}
