/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0.
 */
import { useEffect, useState } from 'react';
import { Card, Flex, Select, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '../../components/PageHeader';
import { useLang } from '../../i18n/LangContext';
import type { Instance } from '../../api/instance';
import type { NotificationDeliveryRecord } from '../../api/ops';
import { listInstances } from '../../services/instanceService';
import { listAlertDeliveriesPage } from '../../services/opsService';
import { formatDateTime } from '../../utils/format';
import { tableScrollX } from '../../utils/table';

const statusColors: Record<NotificationDeliveryRecord['status'], string> = {
  PENDING: 'default',
  SENDING: 'processing',
  DELIVERED: 'success',
  RETRY_WAIT: 'warning',
  FAILED: 'error',
};

const NotificationDeliveriesPage = () => {
  const { t } = useLang();
  const [items, setItems] = useState<NotificationDeliveryRecord[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [channel, setChannel] = useState<string>();
  const [status, setStatus] = useState<NotificationDeliveryRecord['status']>();
  const [instanceId, setInstanceId] = useState<string>();

  useEffect(() => {
    void listInstances()
      .then(setInstances)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listAlertDeliveriesPage({ channel, status, instanceId, page, pageSize })
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch(() => {
        if (!cancelled) message.error(t('deliveries.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channel, status, instanceId, page, pageSize, t]);

  const resetPage = (change: () => void) => {
    setLoading(true);
    change();
    setPage(1);
  };

  const columns: ColumnsType<NotificationDeliveryRecord> = [
    {
      title: t('deliveries.alert'),
      dataIndex: 'alertTitle',
      width: 260,
      render: (title, record) => (
        <Flex vertical gap={2}>
          <Typography.Text ellipsis={{ tooltip: title }}>{title}</Typography.Text>
          <Typography.Text type="secondary">
            #{record.alertId} · {record.transition ?? '-'}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: t('deliveries.instance'),
      dataIndex: 'instanceId',
      width: 150,
      render: (value) => value ?? '-',
    },
    { title: t('deliveries.channel'), dataIndex: 'channel', width: 110 },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 130,
      render: (value: NotificationDeliveryRecord['status']) => (
        <Tag color={statusColors[value]}>{value}</Tag>
      ),
    },
    { title: t('deliveries.attempts'), dataIndex: 'attemptCount', width: 100 },
    {
      title: t('deliveries.result'),
      width: 280,
      render: (_, record) =>
        record.lastError ? (
          <Typography.Text type="danger" ellipsis={{ tooltip: record.lastError }}>
            {record.lastError}
          </Typography.Text>
        ) : record.deliveredAt ? (
          t('deliveries.delivered')
        ) : record.nextAttemptAt ? (
          `${t('deliveries.nextAttempt')} ${formatDateTime(record.nextAttemptAt)}`
        ) : (
          '-'
        ),
    },
    {
      title: t('deliveries.createdAt'),
      dataIndex: 'createdAt',
      width: 180,
      render: formatDateTime,
    },
    {
      title: t('deliveries.deliveredAt'),
      dataIndex: 'deliveredAt',
      width: 180,
      render: formatDateTime,
    },
  ];

  return (
    <>
      <PageHeader title={t('deliveries.title')} subtitle={t('deliveries.subtitle')} />
      <Card>
        <Flex gap={12} wrap="wrap" style={{ marginBottom: 16 }}>
          <Select
            allowClear
            placeholder={t('deliveries.allChannels')}
            value={channel}
            style={{ width: 150 }}
            options={['dingtalk', 'email', 'sms'].map((value) => ({ value, label: value }))}
            onChange={(value) => resetPage(() => setChannel(value))}
          />
          <Select
            allowClear
            placeholder={t('deliveries.allStatuses')}
            value={status}
            style={{ width: 160 }}
            options={Object.keys(statusColors).map((value) => ({ value, label: value }))}
            onChange={(value) => resetPage(() => setStatus(value))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('deliveries.allInstances')}
            value={instanceId}
            style={{ width: 190 }}
            options={instances.map((instance) => ({ value: instance.name, label: instance.name }))}
            onChange={(value) => resetPage(() => setInstanceId(value))}
          />
        </Flex>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={loading}
          scroll={{ x: tableScrollX(columns) }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (count) => `${t('common.total')} ${count}`,
            onChange: (nextPage, nextPageSize) => {
              setLoading(true);
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          }}
        />
      </Card>
    </>
  );
};

export default NotificationDeliveriesPage;
