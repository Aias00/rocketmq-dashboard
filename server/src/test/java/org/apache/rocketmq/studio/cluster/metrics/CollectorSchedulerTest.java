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
package org.apache.rocketmq.studio.cluster.metrics;

import org.apache.rocketmq.studio.instance.InstanceRepository;
import org.apache.rocketmq.studio.instance.InstanceVO;
import org.apache.rocketmq.studio.ops.alert.AlertDomain;
import org.apache.rocketmq.studio.ops.alert.NativeAlertProcessor;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CollectorSchedulerTest {

    @Test
    void collectsAndPersistsSupportedSamplesWhenEnabled() {
        AlertingProperties properties = new AlertingProperties();
        properties.setCollectionEnabled(true);
        InstanceRepository instances = mock(InstanceRepository.class);
        ClusterMetricsCollector collector = mock(ClusterMetricsCollector.class);
        MetricSnapshotRepository snapshots = mock(MetricSnapshotRepository.class);
        InstanceVO instance = InstanceVO.builder().name("local").endpoint("localhost:9876").build();
        MetricSample sample = new MetricSample("nameserver.availability", AlertDomain.CLUSTER, "local", null,
                null, 1D, MetricAvailability.AVAILABLE, Instant.now());
        when(instances.findAll()).thenReturn(List.of(instance));
        when(collector.supports(instance)).thenReturn(true);
        when(collector.collect(instance)).thenReturn(List.of(sample));

        NativeAlertProcessor processor = mock(NativeAlertProcessor.class);
        AlertCollectionLease lease = mock(AlertCollectionLease.class);
        when(lease.tryAcquire()).thenReturn(true);
        new CollectorScheduler(properties, instances, List.of(collector), List.of(), snapshots, processor, lease).collect();

        verify(snapshots).saveAll(List.of(sample));
        verify(processor).process(List.of(sample));
    }

    @Test
    void doesNotCollectWhenDisabled() {
        AlertingProperties properties = new AlertingProperties();
        InstanceRepository instances = mock(InstanceRepository.class);
        MetricSnapshotRepository snapshots = mock(MetricSnapshotRepository.class);

        new CollectorScheduler(properties, instances, List.of(), List.of(), snapshots, mock(NativeAlertProcessor.class),
                mock(AlertCollectionLease.class)).collect();

        verify(instances, never()).findAll();
        verify(snapshots, never()).saveAll(any());
    }

    @Test
    void removesExpiredSnapshotsUsingConfiguredRetention() {
        AlertingProperties properties = new AlertingProperties();
        properties.setSnapshotRetention("PT2H");
        MetricSnapshotRepository snapshots = mock(MetricSnapshotRepository.class);

        new CollectorScheduler(properties, mock(InstanceRepository.class), List.of(), List.of(), snapshots,
                mock(NativeAlertProcessor.class), mock(AlertCollectionLease.class)).cleanUpSnapshots();

        verify(snapshots).deleteBefore(any(Instant.class));
    }

    @Test
    void doesNotCollectWhenAnotherReplicaHoldsTheLease() {
        AlertingProperties properties = new AlertingProperties();
        properties.setCollectionEnabled(true);
        InstanceRepository instances = mock(InstanceRepository.class);
        AlertCollectionLease lease = mock(AlertCollectionLease.class);
        when(lease.tryAcquire()).thenReturn(false);

        new CollectorScheduler(properties, instances, List.of(), List.of(), mock(MetricSnapshotRepository.class),
                mock(NativeAlertProcessor.class), lease).collect();

        verify(instances, never()).findAll();
    }

    @Test
    void discardsCollectedSamplesWhenTheLeaseExpiresBeforePersistence() {
        AlertingProperties properties = new AlertingProperties();
        properties.setCollectionEnabled(true);
        InstanceRepository instances = mock(InstanceRepository.class);
        ClusterMetricsCollector collector = mock(ClusterMetricsCollector.class);
        MetricSnapshotRepository snapshots = mock(MetricSnapshotRepository.class);
        NativeAlertProcessor processor = mock(NativeAlertProcessor.class);
        AlertCollectionLease lease = mock(AlertCollectionLease.class);
        InstanceVO instance = InstanceVO.builder().name("local").endpoint("localhost:9876").build();
        MetricSample sample = new MetricSample("nameserver.availability", AlertDomain.CLUSTER, "local", null,
                null, 1D, MetricAvailability.AVAILABLE, Instant.now());
        when(instances.findAll()).thenReturn(List.of(instance));
        when(collector.supports(instance)).thenReturn(true);
        when(collector.collect(instance)).thenReturn(List.of(sample));
        when(lease.tryAcquire()).thenReturn(true, false);

        new CollectorScheduler(properties, instances, List.of(collector), List.of(), snapshots, processor, lease).collect();

        verify(snapshots, never()).saveAll(any());
        verify(processor, never()).process(any());
    }
}
