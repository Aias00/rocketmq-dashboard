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

import { useEffect, useRef, useState, type Key } from 'react';
import { Copy, DownloadSimple, Plus, Pencil, Trash, UploadSimple } from '@phosphor-icons/react';
import {
  Button,
  Card,
  Table,
  Switch,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Checkbox,
  Flex,
  message,
  Popconfirm,
  theme,
} from 'antd';
import type { ColumnsType, TableRowSelection } from 'antd/es/table/interface';
import PageHeader from '../../components/PageHeader';
import { useLang } from '../../i18n/LangContext';
import type {
  AlertRule,
  AlertRuleDomain,
  AlertRuleTestResult,
  AlertRuleRuntime,
  NativeAlertMetricInfo,
} from '../../api/ops';
import type { AlertRuleTransfer } from '../../api/ops';
import {
  createAlertRule,
  bulkDeleteAlertRules,
  bulkToggleAlertRules,
  deleteAlertRule,
  exportAlertRulesTransfer,
  importAlertRulesTransfer,
  listAlertRules,
  listAlertRuleRuntime,
  listNativeAlertMetrics,
  toggleAlertRule,
  testAlertRule,
  updateAlertRule,
} from '../../services/opsService';
import { tableScrollX } from '../../utils/table';
import { formatDateTime } from '../../utils/format';
import { listInstances } from '../../services/instanceService';
import type { Instance } from '../../api/instance';
import { downloadBlob } from '../../utils/download';
import type { TextAreaRef } from 'antd/es/input/TextArea';
const { TextArea } = Input;

const channelColors: Record<string, string> = {
  dingtalk: 'blue',
  email: 'green',
  sms: 'orange',
};

const durationOptions = ['1m', '5m', '15m', '30m'];
const reminderIntervalOptions = ['5m', '15m', '30m', '1h', '4h'];
const notificationTemplateVariables = [
  'ruleName',
  'title',
  'description',
  'transition',
  'metric',
  'instanceId',
  'value',
  'threshold',
  'thresholdUnit',
  'level',
  'time',
  'labels',
];
const availabilityMetrics = new Set([
  'nameserver.availability',
  'broker.availability',
  'proxy.availability',
  'cloud.instance.availability',
]);
const nativeRatioMetrics = new Set([
  'broker.disk.usage_ratio',
  'broker.jvm.heap.usage_ratio',
  'broker.send_queue.usage_ratio',
]);

const nativeMetricTranslationKeys: Record<string, string> = {
  'nameserver.availability': 'alerts.metrics.nameserverAvailability',
  'broker.availability': 'alerts.metrics.brokerAvailability',
  'proxy.availability': 'alerts.metrics.proxyAvailability',
  'broker.disk.usage_ratio': 'alerts.metrics.brokerDiskUsageRatio',
  'broker.jvm.heap.usage_ratio': 'alerts.metrics.brokerJvmHeapUsageRatio',
  'broker.send_queue.usage_ratio': 'alerts.metrics.brokerSendQueueUsageRatio',
  'consumer.lag.total': 'alerts.metrics.consumerLagTotal',
  'consumer.lag.max_queue': 'alerts.metrics.consumerLagMaxQueue',
  'consumer.delay.seconds': 'alerts.metrics.consumerDelay',
  'topic.backlog.total': 'alerts.metrics.topicBacklogTotal',
  'dlq.message.count': 'alerts.metrics.dlqMessageCount',
  'cloud.instance.availability': 'alerts.metrics.cloudInstanceAvailability',
};

const legacyMetricTranslationKeys: Record<string, string> = {
  rocketmq_disk_use_ratio: 'alerts.metrics.legacyDiskUsageRatio',
};

export const supportsUnavailableOperator = (metric?: string): boolean =>
  metric != null && availabilityMetrics.has(metric);

export const formatThresholdCondition = (rule: AlertRule): string => {
  if (rule.operator === 'UNAVAILABLE') {
    return '指标不可用时触发';
  }
  if (nativeRatioMetrics.has(rule.metric) && !rule.thresholdUnit) {
    return `${rule.operator} ${rule.threshold * 100}%`;
  }
  return `${rule.operator} ${rule.threshold}${rule.thresholdUnit ?? ''}`;
};

interface AlertsPageProps {
  domain?: AlertRuleDomain;
}

const AlertsPage = ({ domain = 'CLUSTER' }: AlertsPageProps) => {
  const { t } = useLang();
  const { token } = theme.useToken();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [runtime, setRuntime] = useState<AlertRuleRuntime[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AlertRuleTestResult | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [selectedRuleIds, setSelectedRuleIds] = useState<Key[]>([]);
  const [bulkAction, setBulkAction] = useState<'enable' | 'disable' | 'delete' | null>(null);
  const [form] = Form.useForm();
  const selectedMetric = Form.useWatch('metric', form);
  const selectedOperator = Form.useWatch('operator', form);
  const [metricOptions, setMetricOptions] = useState<NativeAlertMetricInfo[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>();
  const [metricLoading, setMetricLoading] = useState(false);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [transferringRules, setTransferringRules] = useState(false);
  const metricRequestVersion = useRef(0);
  const importInputRef = useRef<HTMLInputElement>(null);
  const notificationTemplateRef = useRef<TextAreaRef>(null);
  const supportsUnavailableCondition = supportsUnavailableOperator(selectedMetric);
  const selectedMetricIsRatio = selectedMetric != null && nativeRatioMetrics.has(selectedMetric);
  const editingLegacyRule = Boolean(editingRule && !editingRule.instanceId?.trim());

  const metricLabel = (metric: string, fallback = metric) => {
    const key = nativeMetricTranslationKeys[metric] ?? legacyMetricTranslationKeys[metric];
    if (!key) return fallback;
    const translated = t(key);
    return translated === key ? fallback : translated;
  };

  const channelLabels: Record<string, string> = {
    dingtalk: 'DingTalk',
    email: 'Email',
    sms: 'SMS',
  };

  useEffect(() => {
    let cancelled = false;

    void (domain === 'CLUSTER' ? listAlertRules() : listAlertRules(domain))
      .then((nextRules) => {
        if (!cancelled) setRules(nextRules);
      })
      .catch(() => {
        if (!cancelled) message.error('告警规则加载失败，请稍后重试');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void listAlertRuleRuntime(domain)
      .then(setRuntime)
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [domain]);

  useEffect(() => {
    void listInstances()
      .then(setInstances)
      .catch(() => message.error('RocketMQ 实例加载失败，请稍后重试'));
  }, []);

  const enabledCount = rules.filter((r) => r.enabled).length;
  const selectedCount = selectedRuleIds.length;
  const hasSelectedRules = selectedCount > 0;
  const isBulkRunning = bulkAction !== null;
  const isActionRunning = actionId !== null || isBulkRunning;

  // eslint-disable-next-line react-hooks/purity
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const triggered24h = rules.filter(
    (r) => r.lastTriggered && new Date(r.lastTriggered).getTime() > dayAgo,
  ).length;

  const openCreateModal = () => {
    setEditingRule(null);
    metricRequestVersion.current += 1;
    setSelectedInstanceId(undefined);
    setMetricOptions([]);
    setMetricLoading(false);
    setTestResult(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleExportRules = async () => {
    setTransferringRules(true);
    try {
      const transfer = await exportAlertRulesTransfer(domain);
      downloadBlob(
        new Blob([JSON.stringify(transfer, null, 2)], { type: 'application/json;charset=utf-8' }),
        `rocketmq-studio-${domain.toLowerCase()}-alert-rules.json`,
      );
      message.success(t('alerts.exportSuccess'));
    } catch {
      message.error(t('alerts.exportFailed'));
    } finally {
      setTransferringRules(false);
    }
  };

  const handleImportRules = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setTransferringRules(true);
    try {
      const transfer = JSON.parse(await file.text()) as AlertRuleTransfer;
      if (transfer.version !== 1 || transfer.domain !== domain || !Array.isArray(transfer.rules)) {
        throw new Error('invalid transfer document');
      }
      const imported = await importAlertRulesTransfer(transfer, domain);
      setRules((current) => [...current, ...imported]);
      message.success(t('alerts.importSuccess', { count: imported.length }));
    } catch {
      message.error(t('alerts.importFailed'));
    } finally {
      setTransferringRules(false);
    }
  };

  const loadMetricCapabilities = async (instanceId?: string, resetMetric = true) => {
    if (!instanceId?.trim()) return;
    const requestVersion = ++metricRequestVersion.current;
    setMetricLoading(true);
    setMetricOptions([]);
    try {
      const metrics = await listNativeAlertMetrics(instanceId.trim(), domain);
      if (requestVersion !== metricRequestVersion.current) return;
      setMetricOptions(metrics);
      if (resetMetric) form.setFieldValue('metric', undefined);
      if (
        !resetMetric &&
        nativeRatioMetrics.has(form.getFieldValue('metric')) &&
        !form.getFieldValue('thresholdUnit')
      ) {
        form.setFieldValue('threshold', Number(form.getFieldValue('threshold')) * 100);
      }
      if (metrics.length === 0) message.warning('该实例暂不支持原生告警指标');
    } catch {
      if (requestVersion === metricRequestVersion.current) {
        message.error('告警指标能力加载失败，请检查 RocketMQ 实例');
      }
    } finally {
      if (requestVersion === metricRequestVersion.current) setMetricLoading(false);
    }
  };

  const openEditModal = (rule: AlertRule) => {
    setEditingRule(rule);
    form.setFieldsValue(rule);
    setSelectedInstanceId(rule.instanceId);
    if (rule.instanceId?.trim()) {
      void loadMetricCapabilities(rule.instanceId, false);
    } else {
      setMetricOptions([]);
    }
    setModalVisible(true);
  };

  const openDuplicateModal = (rule: AlertRule) => {
    setEditingRule(null);
    setTestResult(null);
    setSelectedInstanceId(rule.instanceId);
    const { id: _id, lastTriggered: _lastTriggered, ...copy } = rule;
    form.setFieldsValue({ ...copy, name: `${rule.name} - 副本` });
    if (rule.instanceId?.trim()) {
      void loadMetricCapabilities(rule.instanceId, false);
    } else {
      setMetricOptions([]);
    }
    setModalVisible(true);
  };

  const handleToggle = async (rule: AlertRule, enabled: boolean) => {
    if (isActionRunning) return;
    setActionId(`toggle-${rule.id}`);
    try {
      const updated = await (domain === 'CLUSTER'
        ? toggleAlertRule(rule.id, enabled)
        : toggleAlertRule(rule.id, enabled, domain));
      setRules((previous) => previous.map((item) => (item.id === rule.id ? updated : item)));
    } catch {
      message.error('更新告警规则状态失败，请稍后重试');
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (rule: AlertRule) => {
    if (isActionRunning) return;
    setActionId(`delete-${rule.id}`);
    try {
      await (domain === 'CLUSTER' ? deleteAlertRule(rule.id) : deleteAlertRule(rule.id, domain));
      setRules((previous) => previous.filter((item) => item.id !== rule.id));
      setSelectedRuleIds((previous) => previous.filter((id) => id !== rule.id));
      message.success('告警规则已删除');
    } catch {
      message.error('删除告警规则失败，请稍后重试');
    } finally {
      setActionId(null);
    }
  };

  const handleBulkToggle = async (enabled: boolean) => {
    const targetIds = selectedRuleIds.map(Number);
    if (targetIds.length === 0 || isActionRunning) return;

    setBulkAction(enabled ? 'enable' : 'disable');
    try {
      const result = await (domain === 'CLUSTER'
        ? bulkToggleAlertRules(targetIds, enabled)
        : bulkToggleAlertRules(targetIds, enabled, domain));
      const updatedRules = new Map(result.updatedRules.map((rule) => [rule.id, rule]));
      const failedIds = Object.keys(result.failures);

      if (updatedRules.size > 0) {
        setRules((previous) => previous.map((rule) => updatedRules.get(rule.id) ?? rule));
      }

      setSelectedRuleIds(failedIds.map(Number));

      if (failedIds.length === 0) {
        message.success(
          t(enabled ? 'alerts.bulkEnableSuccess' : 'alerts.bulkDisableSuccess', {
            count: updatedRules.size,
          }),
        );
      } else if (updatedRules.size === 0) {
        message.error(
          t(enabled ? 'alerts.bulkEnableFailed' : 'alerts.bulkDisableFailed', {
            count: targetIds.length,
          }),
        );
      } else {
        message.warning(
          t(enabled ? 'alerts.bulkEnablePartial' : 'alerts.bulkDisablePartial', {
            success: updatedRules.size,
            failed: failedIds.length,
          }),
        );
      }
    } catch {
      message.error(
        t(enabled ? 'alerts.bulkEnableFailed' : 'alerts.bulkDisableFailed', {
          count: targetIds.length,
        }),
      );
    } finally {
      setBulkAction(null);
    }
  };

  const handleBulkDelete = () => {
    const targetIds = selectedRuleIds.map(Number);
    if (targetIds.length === 0 || isActionRunning) return;
    Modal.confirm({
      title: t('alerts.bulkDeleteConfirm', { count: targetIds.length }),
      okButtonProps: { danger: true },
      onOk: async () => {
        setBulkAction('delete');
        try {
          const result = await (domain === 'CLUSTER'
            ? bulkDeleteAlertRules(targetIds)
            : bulkDeleteAlertRules(targetIds, domain));
          const succeeded = new Set(result.succeededIds);
          const failedIds = Object.keys(result.failures);
          setRules((previous) => previous.filter((rule) => !succeeded.has(rule.id)));
          setSelectedRuleIds(failedIds.map(Number));
          if (failedIds.length === 0) message.success(t('alerts.bulkDeleteSuccess'));
          else
            message.warning(
              t('alerts.bulkDeletePartial', {
                success: result.succeededIds.length,
                failed: failedIds.length,
              }),
            );
        } finally {
          setBulkAction(null);
        }
      },
    });
  };

  const rowSelection: TableRowSelection<AlertRule> = {
    selectedRowKeys: selectedRuleIds,
    onChange: (keys) => setSelectedRuleIds(keys),
    getCheckboxProps: () => ({
      disabled: isActionRunning,
    }),
  };

  const columns: ColumnsType<AlertRule> = [
    {
      title: t('alerts.ruleName'),
      dataIndex: 'name',
      sorter: (a, b) => (a.name ?? '').localeCompare(b.name ?? ''),
    },
    {
      title: t('alerts.metric'),
      dataIndex: 'metric',
      sorter: (a, b) => (a.metric ?? '').localeCompare(b.metric ?? ''),
      render: (metric: string) => metricLabel(metric),
    },
    {
      title: t('alerts.threshold'),
      sorter: (a, b) => (a.threshold ?? 0) - (b.threshold ?? 0),
      render: (_, record) => formatThresholdCondition(record),
    },
    {
      title: t('alerts.duration'),
      dataIndex: 'duration',
      sorter: (a, b) => (a.duration ?? '').localeCompare(b.duration ?? ''),
    },
    {
      title: t('alerts.reminderInterval'),
      dataIndex: 'reminderInterval',
      width: 130,
      render: (value) => value ?? '30m',
    },
    {
      title: t('alerts.channels'),
      render: (_, record) => (
        <Flex gap={4} wrap="wrap">
          {(record.channels ?? []).map((ch) => (
            <Tag key={ch} color={channelColors[ch]}>
              {channelLabels[ch]}
            </Tag>
          ))}
        </Flex>
      ),
    },
    {
      title: t('common.status'),
      sorter: (a, b) => Number(a.enabled) - Number(b.enabled),
      render: (_, record) => (
        <Switch
          checked={record.enabled}
          loading={actionId === `toggle-${record.id}`}
          disabled={isActionRunning}
          onChange={(enabled) => void handleToggle(record, enabled)}
        />
      ),
    },
    {
      title: t('alerts.lastTriggered'),
      sorter: (a, b) => (a.lastTriggered ?? '').localeCompare(b.lastTriggered ?? ''),
      render: (_, record) =>
        record.lastTriggered ? (
          formatDateTime(record.lastTriggered)
        ) : (
          <span style={{ color: '#999' }}>{t('alerts.neverTriggered')}</span>
        ),
    },
    {
      title: '运行态',
      width: 130,
      render: (_, record) => {
        const states = runtime.filter((state) => state.ruleId === record.id);
        if (!states.length) return <span style={{ color: '#999' }}>未采集</span>;
        const firing = states.filter((state) => state.status === 'FIRING').length;
        const pending = states.filter((state) => state.status === 'PENDING').length;
        return (
          <Tag color={firing ? 'error' : pending ? 'warning' : 'default'}>
            {firing ? `触发 ${firing}` : pending ? `待定 ${pending}` : states[0].status}
          </Tag>
        );
      },
    },
    {
      title: t('common.actions'),
      render: (_, record) => (
        <Flex gap={8}>
          <Button
            size="small"
            icon={<Pencil size={14} />}
            disabled={isActionRunning}
            style={{ borderColor: '#1890ff', color: '#1890ff' }}
            onClick={() => openEditModal(record)}
          >
            {t('common.edit')}
          </Button>
          <Button
            size="small"
            icon={<Copy size={14} />}
            disabled={isActionRunning}
            onClick={() => openDuplicateModal(record)}
          >
            复制
          </Button>
          <Popconfirm
            title={t('common.areYouSureToDelete')}
            onConfirm={() => void handleDelete(record)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Button
              size="small"
              icon={<Trash size={14} />}
              danger
              loading={actionId === `delete-${record.id}`}
              disabled={isActionRunning}
              style={{ borderColor: '#ff4d4f', color: '#ff4d4f' }}
            >
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Flex>
      ),
    },
  ];

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        ...(nativeRatioMetrics.has(values.metric) ? { thresholdUnit: '%' } : {}),
      } as Partial<AlertRule>;
      setSubmitting(true);
      if (editingRule) {
        const updated = await (domain === 'CLUSTER'
          ? updateAlertRule({ ...editingRule, ...payload })
          : updateAlertRule({ ...editingRule, ...payload }, domain));
        setRules((previous) =>
          previous.map((rule) => (rule.id === editingRule.id ? updated : rule)),
        );
        message.success('告警规则已更新');
      } else {
        const created = await (domain === 'CLUSTER'
          ? createAlertRule(payload)
          : createAlertRule(payload, domain));
        setRules((previous) => [...previous, created]);
        message.success(t('alerts.ruleCreated'));
      }
      setModalVisible(false);
      form.resetFields();
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) {
        return; // validation failure; antd already shows field-level errors
      }
      message.error('保存告警规则失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        ...(nativeRatioMetrics.has(values.metric) ? { thresholdUnit: '%' } : {}),
      } as Partial<AlertRule>;
      setTesting(true);
      const result = await (domain === 'CLUSTER'
        ? testAlertRule(payload)
        : testAlertRule(payload, domain));
      setTestResult(result);
      if (result.samples.length === 0) {
        message.warning('未采集到匹配样本，请检查实例和指标作用域');
        return;
      }
      const matched = result.samples.filter((sample) => sample.conditionMet).length;
      const valuesSummary = result.samples
        .slice(0, 3)
        .map(
          (sample) => `${sample.currentValue ?? '不可用'}${sample.conditionMet ? '（命中）' : ''}`,
        )
        .join('，');
      message.info(`采集到 ${result.samples.length} 个样本，${matched} 个命中：${valuesSummary}`);
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      message.error('规则试运行失败，请检查实例连接和指标配置');
    } finally {
      setTesting(false);
    }
  };

  const insertNotificationTemplateVariable = (variable: string) => {
    const placeholder = `\${${variable}}`;
    const input = notificationTemplateRef.current?.resizableTextArea?.textArea;
    const currentValue = String(form.getFieldValue('notificationTemplate') ?? '');
    const selectionStart = input?.selectionStart ?? currentValue.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;
    const nextValue =
      currentValue.slice(0, selectionStart) + placeholder + currentValue.slice(selectionEnd);

    form.setFieldValue('notificationTemplate', nextValue);
    input?.focus();
    input?.setSelectionRange(
      selectionStart + placeholder.length,
      selectionStart + placeholder.length,
    );
  };

  return (
    <div style={{ padding: 24 }}>
      {/* ─── Header ─── */}
      <PageHeader
        title={t(domain === 'BUSINESS' ? 'alerts.businessTitle' : 'alerts.title')}
        subtitle={t(domain === 'BUSINESS' ? 'alerts.businessSubtitle' : 'alerts.subtitle')}
        extra={
          <Flex gap={16}>
            <Flex align="center" gap={4}>
              <span style={{ fontSize: 14, color: '#999' }}>{t('alerts.totalRules')}</span>
              <span style={{ fontSize: 18, fontWeight: 600, color: '#3b82f6' }}>
                {rules.length}
              </span>
            </Flex>
            <Flex align="center" gap={4}>
              <span style={{ fontSize: 14, color: '#999' }}>{t('alerts.enabled')}</span>
              <span style={{ fontSize: 18, fontWeight: 600, color: '#14b8a6' }}>
                {enabledCount}
              </span>
            </Flex>
            <Flex align="center" gap={4}>
              <span style={{ fontSize: 14, color: '#999' }}>{t('alerts.triggered24h')}</span>
              <span style={{ fontSize: 18, fontWeight: 600, color: '#8b5cf6' }}>
                {triggered24h}
              </span>
            </Flex>
            <Button
              icon={<DownloadSimple />}
              disabled={isActionRunning}
              loading={transferringRules}
              onClick={() => void handleExportRules()}
            >
              {t('common.export')}
            </Button>
            <Button
              icon={<UploadSimple />}
              disabled={isActionRunning || transferringRules}
              onClick={() => importInputRef.current?.click()}
            >
              {t('common.import')}
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => void handleImportRules(event)}
            />
            <Button
              type="primary"
              icon={<Plus />}
              disabled={isActionRunning}
              onClick={openCreateModal}
            >
              {t('alerts.newRule')}
            </Button>
          </Flex>
        }
      />

      {/* ─── Table ─── */}
      <Card styles={{ body: { padding: 0 } }}>
        <Flex
          align="center"
          justify="space-between"
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <span style={{ color: token.colorTextSecondary }}>
            {t('alerts.selectedRules', { count: selectedCount })}
          </span>
          <Flex gap={8}>
            <Button
              size="small"
              disabled={!hasSelectedRules || isActionRunning}
              loading={bulkAction === 'enable'}
              onClick={() => void handleBulkToggle(true)}
            >
              {t('alerts.bulkEnable')}
            </Button>
            <Button
              size="small"
              disabled={!hasSelectedRules || isActionRunning}
              loading={bulkAction === 'disable'}
              onClick={() => void handleBulkToggle(false)}
            >
              {t('alerts.bulkDisable')}
            </Button>
            <Button
              danger
              size="small"
              disabled={!hasSelectedRules || isActionRunning}
              loading={bulkAction === 'delete'}
              onClick={handleBulkDelete}
            >
              {t('alerts.bulkDelete')}
            </Button>
          </Flex>
        </Flex>
        <Table<AlertRule>
          columns={columns}
          dataSource={rules}
          rowKey="id"
          size="small"
          loading={loading}
          rowSelection={rowSelection}
          pagination={false}
          scroll={{ x: tableScrollX(columns, { selection: true }) }}
        />
      </Card>

      <Modal
        title={editingRule ? t('common.edit') : t('alerts.newRule')}
        open={modalVisible}
        onOk={handleSubmit}
        confirmLoading={submitting}
        onCancel={() => {
          metricRequestVersion.current += 1;
          setModalVisible(false);
          setEditingRule(null);
          setTestResult(null);
          setSelectedInstanceId(undefined);
          setMetricOptions([]);
          setMetricLoading(false);
          form.resetFields();
        }}
        okText={editingRule ? t('common.edit') : t('common.create')}
        cancelText={t('common.cancel')}
        footer={
          <Flex justify="flex-end" gap={8}>
            <Button onClick={() => void handleTest()} loading={testing} disabled={submitting}>
              试运行
            </Button>
            <Button
              onClick={() => {
                metricRequestVersion.current += 1;
                setModalVisible(false);
                setEditingRule(null);
                setTestResult(null);
                setSelectedInstanceId(undefined);
                setMetricOptions([]);
                setMetricLoading(false);
                form.resetFields();
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button type="primary" onClick={() => void handleSubmit()} loading={submitting}>
              {editingRule ? t('common.edit') : t('common.create')}
            </Button>
          </Flex>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('alerts.ruleName')}
            rules={[{ required: true, message: '请输入规则名称' }]}
          >
            <Input placeholder="请输入规则名称" />
          </Form.Item>

          {!editingLegacyRule && (
            <Form.Item
              name="instanceId"
              label={t('alerts.instance')}
              rules={[{ required: true, message: '请选择 RocketMQ 实例' }]}
              extra="原生采集规则必须绑定一个受管 RocketMQ 实例。"
            >
              <Select
                placeholder="请选择 RocketMQ 实例"
                options={instances.map((instance) => ({
                  value: instance.name,
                  label: `${instance.name}${instance.vendor && instance.vendor !== 'APACHE' ? ` (${instance.vendor})` : ''}`,
                }))}
                onChange={(instanceId) => {
                  setSelectedInstanceId(instanceId);
                  void loadMetricCapabilities(instanceId);
                }}
              />
            </Form.Item>
          )}

          {editingLegacyRule ? (
            <Form.Item
              name="metric"
              label={t('alerts.metric')}
              rules={[{ required: true, message: '请输入监控指标' }]}
              extra="历史 Prometheus 规则保留原始指标表达式，不要求绑定 Studio 实例。"
            >
              <Input placeholder="例如 rocketmq_consumer_lag_messages" />
            </Form.Item>
          ) : (
            <Form.Item
              name="metric"
              label={t('alerts.metric')}
              rules={[{ required: true, message: '请选择监控指标' }]}
            >
              <Select
                placeholder={metricLoading ? '正在加载监控指标' : '请选择监控指标'}
                options={metricOptions.map((metric) => ({
                  label: metricLabel(metric.key, metric.label),
                  value: metric.key,
                }))}
                disabled={!selectedInstanceId || metricLoading}
                loading={metricLoading}
                onChange={(metric) => {
                  if (
                    form.getFieldValue('operator') === 'UNAVAILABLE' &&
                    !supportsUnavailableOperator(metric)
                  ) {
                    form.setFieldValue('operator', '>');
                  }
                }}
              />
            </Form.Item>
          )}

          {domain === 'BUSINESS' && (
            <>
              <Form.Item
                name="consumerGroup"
                label="消费组（可选）"
                extra="留空时，对该实例中的所有消费组分别评估规则。"
              >
                <Input placeholder="例如 order-consumer" />
              </Form.Item>
              <Form.Item
                name="topic"
                label="Topic（可选）"
                extra="仅适用于 Topic backlog 指标；留空时匹配所有 Topic。"
              >
                <Input placeholder="例如 order-topic" />
              </Form.Item>
            </>
          )}

          {domain === 'CLUSTER' && (
            <>
              <Form.Item
                name="clusterName"
                label="集群（可选）"
                extra="留空或填写 * 时匹配该实例中的所有集群。"
              >
                <Input placeholder="例如 DefaultCluster" />
              </Form.Item>
              <Form.Item
                name="brokerName"
                label="Broker（可选）"
                extra="留空或填写 * 时匹配所选集群中的所有 Broker。"
              >
                <Input placeholder="例如 broker-a" />
              </Form.Item>
            </>
          )}

          <Form.Item label={t('alerts.threshold')}>
            <Flex gap={8}>
              <Form.Item
                name="operator"
                noStyle
                rules={[{ required: true, message: '请选择运算符' }]}
              >
                <Select
                  aria-label="运算符"
                  placeholder="运算符"
                  style={{ width: 100 }}
                  options={[
                    { label: '>', value: '>' },
                    { label: '<', value: '<' },
                    { label: '>=', value: '>=' },
                    { label: '<=', value: '<=' },
                    {
                      label: '不可用',
                      value: 'UNAVAILABLE',
                      disabled: !supportsUnavailableCondition,
                    },
                  ]}
                  onChange={(operator) => {
                    if (operator === 'UNAVAILABLE') form.setFieldValue('threshold', 0);
                  }}
                />
              </Form.Item>
              {selectedOperator !== 'UNAVAILABLE' && (
                <Form.Item
                  name="threshold"
                  noStyle
                  rules={[{ required: true, message: '请输入阈值' }]}
                >
                  <InputNumber
                    placeholder="阈值"
                    style={{ flex: 1 }}
                    addonAfter={selectedMetricIsRatio ? '%' : undefined}
                    min={selectedMetricIsRatio ? 0 : undefined}
                    max={selectedMetricIsRatio ? 100 : undefined}
                    precision={selectedMetricIsRatio ? 2 : undefined}
                  />
                </Form.Item>
              )}
            </Flex>
            {selectedOperator === 'UNAVAILABLE' && '采集到指标不可用状态时触发。'}
            {selectedOperator !== 'UNAVAILABLE' && selectedMetricIsRatio && (
              <span>比例指标以百分比填写，例如 85 表示 85%。</span>
            )}
          </Form.Item>

          <Form.Item
            name="duration"
            label={t('alerts.duration')}
            rules={[{ required: true, message: '请选择持续时间' }]}
          >
            <Select
              placeholder="请选择持续时间"
              options={durationOptions.map((d) => ({ label: d, value: d }))}
            />
          </Form.Item>
          <Form.Item
            name="reminderInterval"
            label={t('alerts.reminderInterval')}
            initialValue="30m"
          >
            <Select options={reminderIntervalOptions.map((value) => ({ label: value, value }))} />
          </Form.Item>

          <Flex gap={8}>
            <Form.Item name="aggregation" label="窗口聚合" initialValue="LAST" style={{ flex: 1 }}>
              <Select
                options={['LAST', 'MAX', 'MIN', 'AVG', 'SUM'].map((value) => ({
                  label: value,
                  value,
                }))}
              />
            </Form.Item>
            <Form.Item name="windowSeconds" label="窗口秒数" initialValue={0} style={{ flex: 1 }}>
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Flex>

          <Form.Item
            name="consecutiveSamples"
            label="连续采样次数"
            initialValue={1}
            rules={[{ required: true, message: '请输入连续采样次数' }]}
          >
            <InputNumber min={1} precision={0} style={{ width: '100%' }} />
          </Form.Item>

          {testResult && testResult.samples.length > 0 && (
            <Table
              title={() => '规则试运行结果'}
              rowKey={({ labels, currentValue, availability }) =>
                `${JSON.stringify(labels)}-${currentValue}-${availability}`
              }
              size="small"
              pagination={false}
              dataSource={testResult.samples}
              columns={[
                {
                  title: '标签',
                  dataIndex: 'labels',
                  render: (labels: Record<string, string>) =>
                    Object.entries(labels)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(', '),
                },
                {
                  title: '采集状态',
                  dataIndex: 'availability',
                  render: (availability: string) => (
                    <Tag color={availability === 'AVAILABLE' ? 'green' : 'orange'}>
                      {availability}
                    </Tag>
                  ),
                },
                {
                  title: '当前值',
                  dataIndex: 'currentValue',
                  render: (value: number | null) => value ?? '不可用',
                },
                {
                  title: '阈值命中',
                  dataIndex: 'conditionMet',
                  render: (matched: boolean) => (
                    <Tag color={matched ? 'red' : 'green'}>{matched ? '命中' : '未命中'}</Tag>
                  ),
                },
              ]}
            />
          )}

          <Form.Item
            name="channels"
            label={t('alerts.channels')}
            rules={[{ required: true, message: '请选择通知渠道' }]}
          >
            <Checkbox.Group
              options={[
                { label: 'DingTalk', value: 'dingtalk' },
                { label: 'Email', value: 'email' },
                { label: 'SMS', value: 'sms' },
              ]}
            />
          </Form.Item>

          <Form.Item name="description" label="规则描述">
            <TextArea placeholder="请输入规则描述" rows={3} />
          </Form.Item>
          <Form.Item
            name="notificationTemplate"
            label={t('alerts.notificationTemplate')}
            extra={
              <div style={{ paddingTop: 24 }}>
                <div style={{ marginBottom: 8 }}>{t('alerts.notificationTemplateVariables')}</div>
                <Flex gap={6} wrap="wrap">
                  {notificationTemplateVariables.map((variable) => (
                    <Tag
                      key={variable}
                      role="button"
                      tabIndex={0}
                      style={{ cursor: 'pointer' }}
                      onClick={() => insertNotificationTemplateVariable(variable)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          insertNotificationTemplateVariable(variable);
                        }
                      }}
                    >
                      {`$\{${variable}}`}
                    </Tag>
                  ))}
                </Flex>
              </div>
            }
          >
            <TextArea
              ref={notificationTemplateRef}
              placeholder="[${level}] ${title} - ${description}\nLabels: ${labels}"
              rows={4}
              maxLength={4000}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AlertsPage;
