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

import { useEffect, useState, type Key } from 'react';
import { Plus, Pencil, Trash } from '@phosphor-icons/react';
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
import type { AlertRule, AlertRuleDomain, AlertRuleTestResult } from '../../api/ops';
import {
  createAlertRule,
  bulkDeleteAlertRules,
  bulkToggleAlertRules,
  deleteAlertRule,
  listAlertRules,
  listNativeAlertMetrics,
  toggleAlertRule,
  testAlertRule,
  updateAlertRule,
} from '../../services/opsService';
import { tableScrollX } from '../../utils/table';
const { TextArea } = Input;

const channelColors: Record<string, string> = {
  dingtalk: 'blue',
  email: 'green',
  sms: 'orange',
};

const clusterMetricOptions = [
  { label: 'NameServer availability', value: 'nameserver.availability' },
  { label: 'Broker availability', value: 'broker.availability' },
  { label: 'Broker disk usage ratio', value: 'broker.disk.usage_ratio' },
];

const businessMetricOptions = [
  { label: 'Consumer lag total', value: 'consumer.lag.total' },
  { label: 'Consumer lag max queue', value: 'consumer.lag.max_queue' },
  { label: 'DLQ message count', value: 'dlq.message.count' },
];

const durationOptions = ['1m', '5m', '15m', '30m'];

interface AlertsPageProps {
  domain?: AlertRuleDomain;
}

const AlertsPage = ({ domain = 'CLUSTER' }: AlertsPageProps) => {
  const { t } = useLang();
  const { token } = theme.useToken();
  const [rules, setRules] = useState<AlertRule[]>([]);
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
  const [metricOptions, setMetricOptions] = useState(
    domain === 'BUSINESS' ? businessMetricOptions : clusterMetricOptions,
  );

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

    return () => {
      cancelled = true;
    };
  }, [domain]);

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
    form.resetFields();
    setModalVisible(true);
  };

  const loadMetricCapabilities = async (instanceId?: string) => {
    if (!instanceId?.trim()) return;
    try {
      const metrics = await listNativeAlertMetrics(instanceId.trim(), domain);
      setMetricOptions(metrics.map((metric) => ({ label: metric.label, value: metric.key })));
      form.setFieldValue('metric', undefined);
      if (metrics.length === 0) message.warning('该实例暂不支持原生告警指标');
    } catch {
      message.error('告警指标能力加载失败，请检查 Studio 实例');
    }
  };

  const openEditModal = (rule: AlertRule) => {
    setEditingRule(rule);
    form.setFieldsValue(rule);
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
    },
    {
      title: t('alerts.threshold'),
      sorter: (a, b) => (a.threshold ?? 0) - (b.threshold ?? 0),
      render: (_, record) => `${record.operator} ${record.threshold}${record.thresholdUnit}`,
    },
    {
      title: t('alerts.duration'),
      dataIndex: 'duration',
      sorter: (a, b) => (a.duration ?? '').localeCompare(b.duration ?? ''),
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
          record.lastTriggered
        ) : (
          <span style={{ color: '#999' }}>{t('alerts.neverTriggered')}</span>
        ),
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
      const payload = values as Partial<AlertRule>;
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
      const values = (await form.validateFields()) as Partial<AlertRule>;
      setTesting(true);
      const result = await (domain === 'CLUSTER'
        ? testAlertRule(values)
        : testAlertRule(values, domain));
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
          setModalVisible(false);
          setEditingRule(null);
          setTestResult(null);
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
                setModalVisible(false);
                setEditingRule(null);
                setTestResult(null);
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

          <Form.Item
            name="metric"
            label={t('alerts.metric')}
            rules={[{ required: true, message: '请选择监控指标' }]}
          >
            <Select placeholder="请选择监控指标" options={metricOptions} />
          </Form.Item>

          <Form.Item label={t('alerts.threshold')}>
            <Flex gap={8}>
              <Form.Item
                name="operator"
                noStyle
                rules={[{ required: true, message: '请选择运算符' }]}
              >
                <Select
                  placeholder="运算符"
                  style={{ width: 100 }}
                  options={[
                    { label: '>', value: '>' },
                    { label: '<', value: '<' },
                    { label: '>=', value: '>=' },
                    { label: '<=', value: '<=' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="threshold"
                noStyle
                rules={[{ required: true, message: '请输入阈值' }]}
              >
                <InputNumber placeholder="阈值" style={{ flex: 1 }} />
              </Form.Item>
            </Flex>
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
            name="instanceId"
            label="Studio 实例"
            rules={[{ required: true, message: '请输入 Studio 实例 ID' }]}
            extra="原生采集规则必须绑定一个 Studio 实例。"
          >
            <Input
              placeholder="例如 local"
              onBlur={(event) => void loadMetricCapabilities(event.target.value)}
            />
          </Form.Item>

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
                { label: 'SMS', value: 'sms' },
              ]}
            />
          </Form.Item>

          <Form.Item name="description" label="规则描述">
            <TextArea placeholder="请输入规则描述" rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AlertsPage;
