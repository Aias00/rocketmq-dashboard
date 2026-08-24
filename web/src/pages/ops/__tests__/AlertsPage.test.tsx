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

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import type { AlertRule, NativeAlertMetricInfo } from '../../../api/ops';
import { LangProvider } from '../../../i18n/LangContext';
import { LANGUAGE_STORAGE_KEY } from '../../../i18n/languagePreference';
import { formatDateTime } from '../../../utils/format';
import AlertsPage, { supportsUnavailableOperator } from '../alerts';
import { listInstances } from '../../../services/instanceService';
import {
  bulkDeleteAlertRules,
  bulkToggleAlertRules,
  exportAlertRulesTransfer,
  importAlertRulesTransfer,
  listAlertRules,
  listNativeAlertMetrics,
  toggleAlertRule,
} from '../../../services/opsService';

vi.mock('../../../services/instanceService', () => ({
  listInstances: vi.fn(),
}));

vi.mock('../../../services/opsService', () => ({
  createAlertRule: vi.fn(),
  deleteAlertRule: vi.fn(),
  listAlertRules: vi.fn(),
  listNativeAlertMetrics: vi.fn(),
  toggleAlertRule: vi.fn(),
  bulkToggleAlertRules: vi.fn(),
  bulkDeleteAlertRules: vi.fn(),
  exportAlertRulesTransfer: vi.fn(),
  importAlertRulesTransfer: vi.fn(),
  updateAlertRule: vi.fn(),
}));

const alertRules: AlertRule[] = [
  {
    id: 1,
    name: 'Broker disk usage',
    metric: '磁盘使用率',
    operator: '>',
    threshold: 85,
    thresholdUnit: '%',
    duration: '5分钟',
    channels: ['email'],
    enabled: false,
    lastTriggered: null,
    description: 'disk usage',
  },
  {
    id: 2,
    name: 'Consumer lag',
    metric: '消费堆积量',
    operator: '>',
    threshold: 1000,
    thresholdUnit: '条',
    duration: '15分钟',
    channels: ['dingtalk'],
    enabled: false,
    lastTriggered: null,
    description: 'consumer lag',
  },
  {
    id: 3,
    name: 'NameServer unavailable',
    metric: 'nameserver.availability',
    operator: 'UNAVAILABLE',
    threshold: 0,
    thresholdUnit: null,
    duration: '1分钟',
    channels: ['email'],
    enabled: true,
    lastTriggered: null,
    description: 'nameserver unavailable',
  },
];

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function cloneRule(rule: AlertRule): AlertRule {
  return {
    ...rule,
    channels: [...rule.channels],
  };
}

function renderPage(domain?: 'BUSINESS' | 'CLUSTER') {
  return render(
    <App>
      <LangProvider>
        <AlertsPage domain={domain} />
      </LangProvider>
    </App>,
  );
}

function getRuleRow(ruleName: string) {
  const row = screen.getByText(ruleName).closest('tr');
  if (!row) throw new Error(`Row not found: ${ruleName}`);
  return row;
}

function getSelectOption(label: string) {
  const option = screen
    .getAllByText(label)
    .find((element) => element.classList.contains('ant-select-item-option-content'));
  if (!option) throw new Error(`Select option not found: ${label}`);
  return option;
}

describe('AlertsPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'zh');
    vi.mocked(listAlertRules).mockResolvedValue(alertRules.map(cloneRule));
    vi.mocked(listNativeAlertMetrics).mockResolvedValue([]);
    vi.mocked(listInstances).mockResolvedValue([
      {
        id: 1,
        name: 'local',
        remark: null,
        type: 'DIRECT',
        endpoint: 'localhost:9876',
        vendor: 'APACHE',
        topicCount: 0,
        consumerGroupCount: 0,
        gmtCreate: '',
        gmtModified: '',
      },
    ]);
    vi.mocked(toggleAlertRule).mockImplementation(async (id, enabled) => {
      const rule = alertRules.find((item) => item.id === id);
      if (!rule) throw new Error(`Rule not found: ${id}`);
      return { ...cloneRule(rule), enabled };
    });
    vi.mocked(bulkToggleAlertRules).mockImplementation(async (ids, enabled) => ({
      succeededIds: ids,
      failures: {},
      updatedRules: ids.map((id) => ({
        ...cloneRule(alertRules.find((item) => item.id === id)!),
        enabled,
      })),
    }));
    vi.mocked(bulkDeleteAlertRules).mockResolvedValue({
      succeededIds: [],
      failures: {},
      updatedRules: [],
    });
  });

  it('renders unavailable conditions without placeholder threshold values', async () => {
    renderPage();

    expect(await screen.findByText('NameServer unavailable')).toBeInTheDocument();
    expect(screen.getByText('指标不可用时触发')).toBeInTheDocument();
    expect(screen.queryByText('UNAVAILABLE 0null')).not.toBeInTheDocument();
  });

  it('formats the last triggered timestamp instead of rendering the raw ISO value', async () => {
    const lastTriggered = '2026-08-23T10:35:38.590731';
    vi.mocked(listAlertRules).mockResolvedValue([{ ...cloneRule(alertRules[0]), lastTriggered }]);

    renderPage();

    expect(await screen.findByText(formatDateTime(lastTriggered))).toBeInTheDocument();
    expect(screen.queryByText(lastTriggered)).not.toBeInTheDocument();
  });

  it('allows the unavailable operator only for availability metrics', () => {
    expect(supportsUnavailableOperator('nameserver.availability')).toBe(true);
    expect(supportsUnavailableOperator('broker.availability')).toBe(true);
    expect(supportsUnavailableOperator('broker.disk.usage_ratio')).toBe(false);
    expect(supportsUnavailableOperator('consumer.lag.total')).toBe(false);
  });

  it('bulk enables selected alert rules and clears the selection after success', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Broker disk usage');
    await user.click(within(getRuleRow('Broker disk usage')).getByRole('checkbox'));
    await user.click(within(getRuleRow('Consumer lag')).getByRole('checkbox'));

    await user.click(screen.getByRole('button', { name: '批量启用' }));

    await waitFor(() => {
      expect(bulkToggleAlertRules).toHaveBeenCalledTimes(1);
    });
    expect(bulkToggleAlertRules).toHaveBeenCalledWith([1, 2], true);
    expect(await screen.findByText('已启用 2 条告警规则')).toBeInTheDocument();
    expect(within(getRuleRow('Broker disk usage')).getByRole('switch')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(getRuleRow('Consumer lag')).getByRole('switch')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(getRuleRow('Broker disk usage')).getByRole('checkbox')).not.toBeChecked();
    expect(within(getRuleRow('Consumer lag')).getByRole('checkbox')).not.toBeChecked();
  });

  it('uses the business rule API and loads only business metrics for the selected instance', async () => {
    vi.mocked(listNativeAlertMetrics).mockResolvedValue([
      {
        key: 'consumer.lag.total',
        label: 'Consumer lag total',
        thresholdUnit: 'messages',
        supportsConsumerGroup: true,
      },
    ]);
    const user = userEvent.setup();
    renderPage('BUSINESS');

    expect(await screen.findByRole('heading', { name: '业务告警' })).toBeInTheDocument();
    await screen.findByText('Broker disk usage');
    expect(listAlertRules).toHaveBeenCalledWith('BUSINESS');
    await user.click(screen.getByRole('button', { name: '新建规则' }));
    expect(screen.getByRole('combobox', { name: '监控指标' })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'RocketMQ 实例' }));
    await screen.findByRole('option', { name: 'local' });
    await user.click(getSelectOption('local'));
    await waitFor(() => expect(listNativeAlertMetrics).toHaveBeenCalledWith('local', 'BUSINESS'));
    expect(screen.getByRole('textbox', { name: '消费组（可选）' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: '监控指标' }));

    expect(await screen.findByText('消费积压总量')).toBeInTheDocument();
    expect(screen.queryByText('Broker 磁盘使用率')).not.toBeInTheDocument();
  });

  it('refreshes metric options from the selected instance capabilities', async () => {
    vi.mocked(listNativeAlertMetrics).mockResolvedValue([
      {
        key: 'consumer.lag.total',
        label: 'Consumer lag total',
        thresholdUnit: 'messages',
        supportsConsumerGroup: true,
      },
    ]);
    const user = userEvent.setup();
    renderPage('BUSINESS');
    await user.click(await screen.findByRole('button', { name: '新建规则' }));
    await user.click(screen.getByRole('combobox', { name: 'RocketMQ 实例' }));
    await screen.findByRole('option', { name: 'local' });
    await user.click(getSelectOption('local'));

    await waitFor(() => expect(listNativeAlertMetrics).toHaveBeenCalledWith('local', 'BUSINESS'));
  });

  it('preserves the existing metric while opening the edit dialog', async () => {
    vi.mocked(listAlertRules).mockResolvedValue([
      {
        ...cloneRule(alertRules[0]),
        instanceId: 'local',
        metric: 'broker.disk.usage_ratio',
      },
    ]);
    vi.mocked(listNativeAlertMetrics).mockResolvedValue([
      {
        key: 'broker.disk.usage_ratio',
        label: 'Broker disk usage ratio',
        thresholdUnit: 'ratio',
        supportsConsumerGroup: false,
      },
    ]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Broker disk usage');
    await user.click(within(getRuleRow('Broker disk usage')).getByRole('button', { name: '编辑' }));
    await waitFor(() => expect(listNativeAlertMetrics).toHaveBeenCalledWith('local', 'CLUSTER'));

    expect((await screen.findAllByText('Broker 磁盘使用率')).length).toBeGreaterThan(1);
  });

  it('edits a legacy business rule without requiring a Studio instance', async () => {
    vi.mocked(listAlertRules).mockResolvedValue([
      {
        id: 99,
        name: 'Legacy disk usage',
        metric: 'rocketmq_disk_use_ratio',
        operator: '>',
        threshold: 80,
        thresholdUnit: '%',
        duration: '1m',
        channels: ['dingtalk'],
        enabled: true,
        lastTriggered: null,
        description: '',
      },
    ]);
    const user = userEvent.setup();
    renderPage('BUSINESS');

    await screen.findByText('Legacy disk usage');
    await user.click(within(getRuleRow('Legacy disk usage')).getByRole('button', { name: '编辑' }));

    expect(await screen.findByRole('textbox', { name: '监控指标' })).toHaveValue(
      'rocketmq_disk_use_ratio',
    );
    expect(screen.queryByRole('combobox', { name: 'RocketMQ 实例' })).not.toBeInTheDocument();
    expect(
      screen.getByText('历史 Prometheus 规则保留原始指标表达式，不要求绑定 Studio 实例。'),
    ).toBeInTheDocument();
  });

  it('uses English metric labels when English is selected', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    vi.mocked(listNativeAlertMetrics).mockResolvedValue([
      {
        key: 'broker.availability',
        label: 'Broker availability',
        thresholdUnit: '',
        supportsConsumerGroup: false,
      },
    ]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'New Rule' }));
    await user.click(screen.getByRole('combobox', { name: 'RocketMQ Instance' }));
    await screen.findByRole('option', { name: 'local' });
    await user.click(getSelectOption('local'));
    await user.click(screen.getByRole('combobox', { name: 'Metric' }));

    expect(await screen.findByText('Broker availability')).toBeInTheDocument();
  });

  it('renders notification template variables below the character counter as separate tokens', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '新建规则' }));

    expect(screen.getByText('可用变量')).toBeInTheDocument();
    expect(screen.getByText('${ruleName}')).toBeInTheDocument();
    expect(screen.getByText('${thresholdUnit}')).toBeInTheDocument();
  });

  it('exposes optional cluster and broker scopes for cluster rules', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '新建规则' }));

    expect(screen.getByRole('textbox', { name: '集群（可选）' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Broker（可选）' })).toBeInTheDocument();
  });

  it('keeps metrics from the most recently selected instance', async () => {
    let resolveLocal: (metrics: NativeAlertMetricInfo[]) => void;
    let resolveRemote: (metrics: NativeAlertMetricInfo[]) => void;
    const localMetrics = new Promise<NativeAlertMetricInfo[]>((resolve) => {
      resolveLocal = resolve;
    });
    const remoteMetrics = new Promise<NativeAlertMetricInfo[]>((resolve) => {
      resolveRemote = resolve;
    });
    vi.mocked(listInstances).mockResolvedValue([
      {
        id: 1,
        name: 'local',
        remark: null,
        type: 'DIRECT',
        endpoint: 'localhost:9876',
        vendor: 'APACHE',
        topicCount: 0,
        consumerGroupCount: 0,
        gmtCreate: '',
        gmtModified: '',
      },
      {
        id: 2,
        name: 'remote',
        remark: null,
        type: 'DIRECT',
        endpoint: 'remote:9876',
        vendor: 'APACHE',
        topicCount: 0,
        consumerGroupCount: 0,
        gmtCreate: '',
        gmtModified: '',
      },
    ]);
    vi.mocked(listNativeAlertMetrics).mockImplementation((instanceId) =>
      instanceId === 'local' ? localMetrics : remoteMetrics,
    );
    const user = userEvent.setup();
    renderPage('BUSINESS');

    await user.click(await screen.findByRole('button', { name: '新建规则' }));
    await user.click(screen.getByRole('combobox', { name: 'RocketMQ 实例' }));
    await screen.findByRole('option', { name: 'local' });
    await user.click(getSelectOption('local'));
    await user.click(screen.getByRole('combobox', { name: 'RocketMQ 实例' }));
    await screen.findByRole('option', { name: 'remote' });
    await user.click(getSelectOption('remote'));

    resolveRemote!([
      {
        key: 'consumer.lag.total',
        label: 'Remote consumer lag',
        thresholdUnit: 'messages',
        supportsConsumerGroup: true,
      },
    ]);
    await user.click(screen.getByRole('combobox', { name: '监控指标' }));
    expect(await screen.findByText('消费积压总量')).toBeInTheDocument();

    resolveLocal!([
      {
        key: 'dlq.message.count',
        label: 'Local DLQ count',
        thresholdUnit: 'messages',
        supportsConsumerGroup: true,
      },
    ]);
    await waitFor(() => expect(screen.queryByText('死信队列消息数')).not.toBeInTheDocument());
  });

  it('keeps only failed alert rules selected after a partial bulk failure', async () => {
    vi.mocked(listAlertRules).mockResolvedValue(
      alertRules.map((rule) => ({ ...cloneRule(rule), enabled: true })),
    );
    vi.mocked(bulkToggleAlertRules).mockResolvedValue({
      succeededIds: [1],
      failures: { '2': 'network error' },
      updatedRules: [{ ...cloneRule(alertRules[0]), enabled: false }],
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Broker disk usage');
    await user.click(within(getRuleRow('Broker disk usage')).getByRole('checkbox'));
    await user.click(within(getRuleRow('Consumer lag')).getByRole('checkbox'));

    await user.click(screen.getByRole('button', { name: '批量禁用' }));

    await waitFor(() => {
      expect(bulkToggleAlertRules).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('已禁用 1 条告警规则，1 条失败')).toBeInTheDocument();
    expect(within(getRuleRow('Broker disk usage')).getByRole('switch')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(within(getRuleRow('Consumer lag')).getByRole('switch')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(getRuleRow('Broker disk usage')).getByRole('checkbox')).not.toBeChecked();
    expect(within(getRuleRow('Consumer lag')).getByRole('checkbox')).toBeChecked();
  });

  it('keeps all selected alert rules selected when the bulk action fails', async () => {
    vi.mocked(bulkToggleAlertRules).mockRejectedValue(new Error('network error'));

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Broker disk usage');
    await user.click(within(getRuleRow('Broker disk usage')).getByRole('checkbox'));
    await user.click(within(getRuleRow('Consumer lag')).getByRole('checkbox'));

    await user.click(screen.getByRole('button', { name: '批量启用' }));

    expect(await screen.findByText('2 条告警规则启用失败')).toBeInTheDocument();
    expect(within(getRuleRow('Broker disk usage')).getByRole('checkbox')).toBeChecked();
    expect(within(getRuleRow('Consumer lag')).getByRole('checkbox')).toBeChecked();
    expect(within(getRuleRow('Broker disk usage')).getByRole('switch')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(within(getRuleRow('Consumer lag')).getByRole('switch')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('disables other alert rule mutations while a bulk action is running', async () => {
    let resolveToggle:
      | ((result: {
          succeededIds: number[];
          failures: Record<string, string>;
          updatedRules: AlertRule[];
        }) => void)
      | undefined;
    vi.mocked(bulkToggleAlertRules).mockReturnValue(
      new Promise((resolve) => {
        resolveToggle = resolve;
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Broker disk usage');
    await user.click(within(getRuleRow('Broker disk usage')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '批量启用' }));

    await waitFor(() => {
      expect(bulkToggleAlertRules).toHaveBeenCalledWith([1], true);
    });
    expect(screen.getByRole('button', { name: '新建规则' })).toBeDisabled();
    expect(within(getRuleRow('Broker disk usage')).getByRole('switch')).toBeDisabled();
    expect(
      within(getRuleRow('Broker disk usage')).getByRole('button', { name: '编辑' }),
    ).toBeDisabled();
    expect(
      within(getRuleRow('Broker disk usage')).getByRole('button', { name: '删除' }),
    ).toBeDisabled();

    resolveToggle?.({
      succeededIds: [1],
      failures: {},
      updatedRules: [{ ...cloneRule(alertRules[0]), enabled: true }],
    });
    expect(await screen.findByText('已启用 1 条告警规则')).toBeInTheDocument();
  });

  it('bulk deletes selected rules after confirmation', async () => {
    vi.mocked(bulkDeleteAlertRules).mockResolvedValue({
      succeededIds: [1, 2],
      failures: {},
      updatedRules: [],
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Broker disk usage');
    await user.click(within(getRuleRow('Broker disk usage')).getByRole('checkbox'));
    await user.click(within(getRuleRow('Consumer lag')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '批量删除' }));
    await user.click(await screen.findByRole('button', { name: 'OK' }));

    await waitFor(() => expect(bulkDeleteAlertRules).toHaveBeenCalledWith([1, 2]));
    expect(screen.queryByText('Broker disk usage')).not.toBeInTheDocument();
    expect(await screen.findByText('所选告警规则已删除')).toBeInTheDocument();
  });
});
