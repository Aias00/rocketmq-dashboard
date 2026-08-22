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
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ClusterAlertRuleController.class)
@AutoConfigureMockMvc(addFilters = false)
class ClusterAlertRuleControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AlertService alertService;

    @MockBean
    private NativeAlertRuleTestService nativeAlertRuleTestService;

    @MockBean
    private NativeAlertMetricCatalogService metricCatalogService;

    @Test
    void listRulesShouldUseClusterDomain() throws Exception {
        when(alertService.listRules(AlertDomain.CLUSTER)).thenReturn(List.of(
                AlertRuleVO.builder().id(7L).name("Broker unavailable").domain(AlertDomain.CLUSTER).build()));

        mockMvc.perform(get("/api/cluster-alert-rules"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(7))
                .andExpect(jsonPath("$.data[0].domain").value("CLUSTER"));
    }

    @Test
    void createRuleShouldForceClusterDomain() throws Exception {
        AlertRuleVO created = AlertRuleVO.builder().id(7L).name("Broker unavailable")
                .domain(AlertDomain.CLUSTER).build();
        when(alertService.createRule(eq(AlertDomain.CLUSTER), any(AlertRuleVO.class))).thenReturn(created);

        mockMvc.perform(post("/api/cluster-alert-rules/create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Broker unavailable\",\"enabled\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.domain").value("CLUSTER"));

        verify(alertService).createRule(eq(AlertDomain.CLUSTER), any(AlertRuleVO.class));
    }

    @Test
    void toggleRuleShouldUseClusterDomain() throws Exception {
        AlertRuleVO toggled = AlertRuleVO.builder().id(7L).enabled(false)
                .domain(AlertDomain.CLUSTER).build();
        when(alertService.toggleRule(AlertDomain.CLUSTER, 7L, false)).thenReturn(toggled);

        mockMvc.perform(post("/api/cluster-alert-rules/toggle")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(java.util.Map.of("id", 7, "enabled", false))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.enabled").value(false));

        verify(alertService).toggleRule(AlertDomain.CLUSTER, 7L, false);
    }
}
