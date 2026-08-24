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

import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.rocketmq.studio.common.domain.PageResult;
import org.apache.rocketmq.studio.common.domain.enums.AlertLevel;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.time.LocalDateTime;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(SystemAlertController.class)
@AutoConfigureMockMvc(addFilters = false)
class SystemAlertControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AlertService alertService;

    @MockBean
    private NotificationOutboxService notificationOutboxService;

    @Test
    void listAlertsShouldReturnSystemAlerts() throws Exception {
        SystemAlertVO alert = SystemAlertVO.builder()
                .id(1L)
                .level(AlertLevel.error)
                .title("Broker Down")
                .acknowledged(false)
                .build();
        when(alertService.listAlerts("error", null, null, null)).thenReturn(List.of(alert));

        mockMvc.perform(get("/api/system-alerts").param("level", "error"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[0].id").value(1))
                .andExpect(jsonPath("$.data[0].level").value("error"))
                .andExpect(jsonPath("$.data[0].acknowledged").value(false));

        verify(alertService).listAlerts("error", null, null, null);
    }

    @Test
    void listAlertsPageShouldForwardFiltersAndPaging() throws Exception {
        SystemAlertVO alert = SystemAlertVO.builder().id(2L).level(AlertLevel.warning).build();
        LocalDateTime from = LocalDateTime.of(2026, 8, 1, 0, 0);
        LocalDateTime to = LocalDateTime.of(2026, 8, 2, 0, 0);
        when(alertService.listAlerts("warning", AlertDomain.BUSINESS, "local", "FIRING",
                "brokerName", "broker-a", from, to, 2, 10))
                .thenReturn(PageResult.of(List.of(alert), 11, 2, 10));

        mockMvc.perform(get("/api/system-alerts/page").param("level", "warning")
                        .param("domain", "BUSINESS").param("instanceId", "local")
                        .param("transition", "FIRING").param("labelKey", "brokerName")
                        .param("labelValue", "broker-a").param("from", "2026-08-01T00:00")
                        .param("to", "2026-08-02T00:00").param("page", "2").param("pageSize", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(11))
                .andExpect(jsonPath("$.data.items[0].id").value(2));

        verify(alertService).listAlerts("warning", AlertDomain.BUSINESS, "local", "FIRING",
                "brokerName", "broker-a", from, to, 2, 10);
    }

    @Test
    void listDeliveriesPageShouldForwardFiltersAndPaging() throws Exception {
        NotificationDeliveryPageVO delivery = NotificationDeliveryPageVO.builder().id(8L).alertId(9L)
                .channel("dingtalk").status(NotificationOutboxStatus.DELIVERED).attemptCount(0)
                .alertTitle("Disk usage high").instanceId("local")
                .messageContent("[info] Disk usage high").build();
        when(notificationOutboxService.listDeliveries("dingtalk", "DELIVERED", "local", 2, 10))
                .thenReturn(PageResult.of(List.of(delivery), 11, 2, 10));

        mockMvc.perform(get("/api/system-alerts/deliveries/page").param("channel", "dingtalk")
                        .param("status", "DELIVERED").param("instanceId", "local")
                        .param("page", "2").param("pageSize", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(11))
                .andExpect(jsonPath("$.data.items[0].channel").value("dingtalk"))
                .andExpect(jsonPath("$.data.items[0].alertTitle").value("Disk usage high"))
                .andExpect(jsonPath("$.data.items[0].messageContent").value("[info] Disk usage high"));

        verify(notificationOutboxService).listDeliveries("dingtalk", "DELIVERED", "local", 2, 10);
    }

    @Test
    void retryFailedDeliveryShouldForwardDeliveryId() throws Exception {
        mockMvc.perform(post("/api/system-alerts/deliveries/8/retry"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200));

        verify(notificationOutboxService).retryFailedDelivery(8L);
    }

    @Test
    void acknowledgeAlertShouldPassValidatedRequest() throws Exception {
        SystemAlertVO acknowledged = SystemAlertVO.builder()
                .id(1L)
                .level(AlertLevel.warning)
                .title("High Lag")
                .acknowledged(true)
                .build();
        when(alertService.acknowledgeAlert(1L)).thenReturn(acknowledged);

        mockMvc.perform(post("/api/system-alerts/acknowledge")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("id", 1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.id").value(1))
                .andExpect(jsonPath("$.data.acknowledged").value(true));

        verify(alertService).acknowledgeAlert(1L);
    }

    @Test
    void acknowledgeAlertShouldRejectNullRequestBody() throws Exception {
        mockMvc.perform(post("/api/system-alerts/acknowledge")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("null"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("System alert acknowledge request is required"));

        verifyNoInteractions(alertService);
    }

    @Test
    void acknowledgeAlertShouldRejectBlankId() throws Exception {
        mockMvc.perform(post("/api/system-alerts/acknowledge")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(java.util.Collections.singletonMap("id", null))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("id is required"));

        verifyNoInteractions(alertService);
    }

    @Test
    void acknowledgeAlertShouldRejectMissingId() throws Exception {
        mockMvc.perform(post("/api/system-alerts/acknowledge")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("id is required"));

        verifyNoInteractions(alertService);
    }

    @Test
    void clearAcknowledgedShouldReturnClearedCount() throws Exception {
        when(alertService.clearAcknowledged()).thenReturn(3);

        mockMvc.perform(post("/api/system-alerts/clear-acknowledged"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.cleared").value(3));

        verify(alertService).clearAcknowledged();
    }
}
