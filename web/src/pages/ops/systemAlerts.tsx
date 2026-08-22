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

import { useEffect, useState } from 'react';
import {
  Card,
  Tag,
  Flex,
  Typography,
  Badge,
  Button,
  message,
  Pagination,
  Select,
  Spin,
  Modal,
  Form,
  Input,
} from 'antd';
import { CheckCircle, Trash } from '@phosphor-icons/react';
import PageHeader from '../../components/PageHeader';
import { useLang } from '../../i18n/LangContext';
import useAuthStore from '../../stores/authStore';
import {
  acknowledgeAlert,
  clearAcknowledgedAlerts,
  getCollectorStatus,
  listAlertDeliveries,
  listSystemAlertsPage,
  createAlertSilence,
  deleteAlertSilence,
  listAlertSilences,
} from '../../services/opsService';
import type {
  AlertSilence,
  CollectorStatus,
  CreateAlertSilence,
  NotificationDelivery,
  PageResult,
  SystemAlert,
} from '../../api/ops';

const { Text } = Typography;

const normalizeAlertLevel = (level?: string | null) => (level ?? '').toLowerCase();

const parseSilenceLabels = (value?: string): Record<string, string> | undefined => {
  if (!value?.trim()) return undefined;
  const labels: Record<string, string> = {};
  for (const pair of value.split(',')) {
    const separator = pair.indexOf('=');
    if (separator <= 0 || !pair.slice(separator + 1).trim()) {
      throw new Error('标签格式应为 key=value，并以逗号分隔');
    }
    labels[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
  }
  return labels;
};

const SystemAlertsPage = () => {
  const { t } = useLang();
  const userId = useAuthStore((state) => state.userId);
  const admin = useAuthStore((state) => state.admin);
  const canManageSilences = !userId || admin === true;

  const alertLevelConfig: Record<string, { color: string; bg: string; label: string }> = {
    error: { color: '#ff4d4f', bg: '#fff2f0', label: t('sysAlerts.severe') },
    warning: { color: '#fa8c16', bg: '#fff7e6', label: t('sysAlerts.warning') },
    info: { color: '#1677ff', bg: '#e6f4ff', label: t('sysAlerts.info') },
  };

  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [transitionFilter, setTransitionFilter] = useState<string>('all');
  const [collectorStatus, setCollectorStatus] = useState<CollectorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const pageSize = 20;
  const [acknowledgingIds, setAcknowledgingIds] = useState<Set<number>>(() => new Set());
  const [clearing, setClearing] = useState(false);
  const [deliveries, setDeliveries] = useState<Record<number, NotificationDelivery[]>>({});
  const [loadingDeliveries, setLoadingDeliveries] = useState<Set<number>>(() => new Set());
  const [silencesVisible, setSilencesVisible] = useState(false);
  const [silences, setSilences] = useState<AlertSilence[]>([]);
  const [loadingSilences, setLoadingSilences] = useState(false);
  const [savingSilence, setSavingSilence] = useState(false);
  const [deletingSilenceId, setDeletingSilenceId] = useState<number | null>(null);
  const [silenceForm] = Form.useForm();

  useEffect(() => {
    let cancelled = false;

    void listSystemAlertsPage({
      level: levelFilter === 'all' ? undefined : levelFilter,
      domain: domainFilter === 'all' ? undefined : (domainFilter as 'BUSINESS' | 'CLUSTER'),
      transition: transitionFilter === 'all' ? undefined : transitionFilter,
      page,
      pageSize,
    })
      .then((data: PageResult<SystemAlert>) => {
        if (!cancelled) {
          setAlerts(data.items);
          setTotal(data.total);
        }
      })
      .catch(() => {
        if (!cancelled) message.error('系统告警加载失败，请稍后重试');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void getCollectorStatus()
      .then((status) => {
        if (!cancelled) setCollectorStatus(status);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [domainFilter, levelFilter, page, refreshNonce, transitionFilter]);

  const unackCount = alerts.filter((a) => !a.acknowledged).length;

  const handleAck = async (id: number) => {
    setAcknowledgingIds((current) => new Set(current).add(id));
    try {
      await acknowledgeAlert(id);
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
      message.success(t('sysAlerts.acknowledged'));
    } catch {
      message.error('确认告警失败，请稍后重试');
    } finally {
      setAcknowledgingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const handleClearAcked = async () => {
    setClearing(true);
    try {
      await clearAcknowledgedAlerts();
      if (page === 1) setRefreshNonce((value) => value + 1);
      else setPage(1);
      message.success(t('sysAlerts.cleared'));
    } catch {
      message.error('清理已确认告警失败，请稍后重试');
    } finally {
      setClearing(false);
    }
  };

  const loadDeliveries = async (alertId: number) => {
    if (deliveries[alertId] || loadingDeliveries.has(alertId)) return;
    setLoadingDeliveries((current) => new Set(current).add(alertId));
    try {
      const result = await listAlertDeliveries(alertId);
      setDeliveries((current) => ({ ...current, [alertId]: result }));
    } catch {
      message.error('通知投递记录加载失败，请稍后重试');
    } finally {
      setLoadingDeliveries((current) => {
        const next = new Set(current);
        next.delete(alertId);
        return next;
      });
    }
  };

  const loadSilences = async () => {
    setLoadingSilences(true);
    try {
      setSilences(await listAlertSilences());
    } catch {
      message.error('维护窗口加载失败，请稍后重试');
    } finally {
      setLoadingSilences(false);
    }
  };

  const openSilences = () => {
    setSilencesVisible(true);
    void loadSilences();
  };

  const createSilence = async () => {
    let values: {
      domain?: 'BUSINESS' | 'CLUSTER';
      ruleId?: string;
      instanceId?: string;
      startsAt: string;
      endsAt: string;
      reason?: string;
      labelsText?: string;
    };
    try {
      values = await silenceForm.validateFields();
    } catch {
      return;
    }
    setSavingSilence(true);
    try {
      const request: CreateAlertSilence = {
        instanceId: values.instanceId,
        startsAt: values.startsAt,
        endsAt: values.endsAt,
        reason: values.reason,
        ruleId: values.ruleId ? Number(values.ruleId) : undefined,
        domain: values.domain || undefined,
        labels: parseSilenceLabels(values.labelsText),
      };
      await createAlertSilence(request);
      silenceForm.resetFields();
      await loadSilences();
      message.success('维护窗口已创建');
    } catch {
      message.error('维护窗口创建失败，请检查时间范围');
    } finally {
      setSavingSilence(false);
    }
  };

  const deleteSilence = async (id: number) => {
    setDeletingSilenceId(id);
    try {
      await deleteAlertSilence(id);
      await loadSilences();
      message.success('维护窗口已结束');
    } catch {
      message.error('维护窗口结束失败，请稍后重试');
    } finally {
      setDeletingSilenceId(null);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title={t('sysAlerts.title')}
        subtitle={t('sysAlerts.subtitle', { n: unackCount })}
        extra={
          <Flex gap={8}>
            <Button onClick={openSilences}>维护窗口</Button>
            <Button
              icon={<Trash size={14} />}
              onClick={handleClearAcked}
              disabled={!alerts.some((a) => a.acknowledged)}
              loading={clearing}
            >
              {t('sysAlerts.clearAcked')}
            </Button>
          </Flex>
        }
      />

      <Flex gap={8} style={{ marginBottom: 16 }}>
        {['all', 'error', 'warning', 'info'].map((level) => (
          <Button
            key={level}
            type={levelFilter === level ? 'primary' : 'default'}
            size="small"
            onClick={() => {
              setLevelFilter(level);
              setPage(1);
            }}
          >
            {level === 'all' ? t('common.all') : alertLevelConfig[level]?.label}
            {level !== 'all' && (
              <Badge
                count={alerts.filter((a) => normalizeAlertLevel(a.level) === level).length}
                style={{
                  marginLeft: 4,
                  backgroundColor:
                    level === 'error' ? '#ff4d4f' : level === 'warning' ? '#fa8c16' : '#1677ff',
                }}
                size="small"
              />
            )}
          </Button>
        ))}
        <Select
          value={domainFilter}
          size="small"
          style={{ minWidth: 132 }}
          onChange={(value) => {
            setDomainFilter(value);
            setPage(1);
          }}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'BUSINESS', label: '业务告警' },
            { value: 'CLUSTER', label: '集群告警' },
          ]}
        />
        <Select
          value={transitionFilter}
          size="small"
          style={{ minWidth: 124 }}
          onChange={(value) => {
            setTransitionFilter(value);
            setPage(1);
          }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'FIRING', label: '触发中' },
            { value: 'RESOLVED', label: '已恢复' },
          ]}
        />
        {collectorStatus && (
          <Tag color={collectorStatus.collectionEnabled ? 'success' : 'default'}>
            {collectorStatus.collectionEnabled ? '原生采集已启用' : '原生采集未启用'}
          </Tag>
        )}
      </Flex>

      <Flex vertical gap={12}>
        {loading && <Card loading />}
        {!loading &&
          alerts.map((alert) => {
            const normalizedLevel = normalizeAlertLevel(alert.level);
            const cfg = alertLevelConfig[normalizedLevel] ?? {
              color: '#8c8c8c',
              bg: '#fafafa',
              label: alert.level || t('common.na'),
            };
            return (
              <div
                key={alert.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: cfg.bg,
                  borderLeft: `3px solid ${cfg.color}`,
                  opacity: alert.acknowledged ? 0.6 : 1,
                }}
              >
                <div style={{ flex: 1 }}>
                  <Flex align="center" gap={8}>
                    <Text strong style={{ fontSize: 14 }}>
                      {alert.title}
                    </Text>
                    <Tag
                      color={
                        normalizedLevel === 'error'
                          ? 'error'
                          : normalizedLevel === 'warning'
                            ? 'warning'
                            : normalizedLevel === 'info'
                              ? 'processing'
                              : 'default'
                      }
                      style={{ fontSize: 14, lineHeight: '18px', padding: '0 6px' }}
                    >
                      {cfg.label}
                    </Tag>
                    {alert.domain && (
                      <Tag color={alert.domain === 'CLUSTER' ? 'geekblue' : 'green'}>
                        {alert.domain === 'CLUSTER' ? '集群' : '业务'}
                      </Tag>
                    )}
                    {alert.transition && <Tag>{alert.transition}</Tag>}
                  </Flex>
                  <Text type="secondary" style={{ fontSize: 14 }}>
                    {alert.description}
                  </Text>
                  {alert.instanceId && (
                    <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                      {alert.instanceId}
                      {alert.currentValue != null ? ` · ${alert.currentValue}` : ''}
                    </Text>
                  )}
                  {alert.labels && Object.keys(alert.labels).length > 0 && (
                    <Flex gap={4} wrap="wrap" style={{ marginTop: 6 }}>
                      {Object.entries(alert.labels).map(([key, value]) => (
                        <Tag key={key}>
                          {key}={value}
                        </Tag>
                      ))}
                    </Flex>
                  )}
                  {loadingDeliveries.has(alert.id) && <Spin size="small" />}
                  {deliveries[alert.id] && (
                    <Flex gap={6} wrap="wrap" style={{ marginTop: 6 }}>
                      {deliveries[alert.id].length === 0 && (
                        <Text type="secondary">未配置通知通道</Text>
                      )}
                      {deliveries[alert.id].map((delivery) => (
                        <Tag
                          key={delivery.channel}
                          color={
                            delivery.status === 'DELIVERED'
                              ? 'success'
                              : delivery.status === 'FAILED'
                                ? 'error'
                                : 'processing'
                          }
                        >
                          {delivery.channel}: {delivery.status} ({delivery.attemptCount})
                          {delivery.lastError ? ` - ${delivery.lastError}` : ''}
                        </Tag>
                      ))}
                    </Flex>
                  )}
                </div>
                <Flex align="center" gap={8} style={{ flexShrink: 0 }}>
                  <Text type="secondary" style={{ fontSize: 14 }}>
                    {alert.time}
                  </Text>
                  <Button size="small" type="link" onClick={() => void loadDeliveries(alert.id)}>
                    通知
                  </Button>
                  {!alert.acknowledged && (
                    <Button
                      size="small"
                      type="link"
                      icon={<CheckCircle size={14} />}
                      onClick={() => handleAck(alert.id)}
                      loading={acknowledgingIds.has(alert.id)}
                    >
                      {t('sysAlerts.acknowledge')}
                    </Button>
                  )}
                </Flex>
              </div>
            );
          })}
        {!loading && alerts.length === 0 && (
          <Card>
            <Flex justify="center" style={{ padding: 40 }}>
              <Text type="secondary">{t('sysAlerts.noAlerts')}</Text>
            </Flex>
          </Card>
        )}
      </Flex>
      {total > pageSize && (
        <Pagination
          current={page}
          pageSize={pageSize}
          total={total}
          showSizeChanger={false}
          style={{ marginTop: 16, textAlign: 'right' }}
          onChange={setPage}
        />
      )}
      <Modal
        title="维护窗口"
        open={silencesVisible}
        onCancel={() => setSilencesVisible(false)}
        onOk={() => void createSilence()}
        okText="创建"
        okButtonProps={{ style: { display: canManageSilences ? undefined : 'none' } }}
        confirmLoading={savingSilence}
        width={680}
      >
        {canManageSilences && (
          <Form form={silenceForm} layout="vertical" initialValues={{ domain: 'BUSINESS' }}>
            <Flex gap={8}>
              <Form.Item name="domain" label="告警域" style={{ flex: 1 }}>
                <Select
                  options={[
                    { value: 'BUSINESS', label: '业务告警' },
                    { value: 'CLUSTER', label: '集群告警' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="ruleId"
                label="规则 ID"
                style={{ flex: 1 }}
                rules={[{ pattern: /^\d+$/, message: '请输入有效的规则 ID' }]}
              >
                <Input inputMode="numeric" />
              </Form.Item>
              <Form.Item name="instanceId" label="实例 ID" style={{ flex: 1 }}>
                <Input />
              </Form.Item>
            </Flex>
            <Flex gap={8}>
              <Form.Item
                name="startsAt"
                label="开始时间"
                rules={[{ required: true, message: '请选择开始时间' }]}
                style={{ flex: 1 }}
              >
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item
                name="endsAt"
                label="结束时间"
                rules={[{ required: true, message: '请选择结束时间' }]}
                style={{ flex: 1 }}
              >
                <Input type="datetime-local" />
              </Form.Item>
            </Flex>
            <Form.Item name="reason" label="原因">
              <Input maxLength={512} />
            </Form.Item>
            <Form.Item
              name="labelsText"
              label="标签范围"
              extra="可选，格式：brokerName=broker-a,topic=orders"
            >
              <Input />
            </Form.Item>
          </Form>
        )}
        <Spin spinning={loadingSilences}>
          <Flex vertical gap={6}>
            {silences.length === 0 && <Text type="secondary">当前没有维护窗口</Text>}
            {silences.map((silence) => (
              <Flex key={silence.id} justify="space-between" align="center" gap={8}>
                <Text>
                  {silence.domain ?? '全部'} · {silence.instanceId ?? '全部实例'} ·{' '}
                  {silence.startsAt} - {silence.endsAt}
                  {silence.labels && Object.keys(silence.labels).length > 0
                    ? ` · ${Object.entries(silence.labels)
                        .map(([key, value]) => `${key}=${value}`)
                        .join(', ')}`
                    : ''}
                </Text>
                {canManageSilences && (
                  <Button
                    size="small"
                    danger
                    loading={deletingSilenceId === silence.id}
                    onClick={() => void deleteSilence(silence.id)}
                  >
                    结束
                  </Button>
                )}
              </Flex>
            ))}
          </Flex>
        </Spin>
      </Modal>
    </div>
  );
};

export default SystemAlertsPage;
