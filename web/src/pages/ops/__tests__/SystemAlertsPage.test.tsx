/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0.
 */

import { App } from 'antd';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../../../i18n/LangContext';
import {
  acknowledgeAlert,
  createAlertSilence,
  listAlertSilences,
  listSystemAlertsPage,
} from '../../../services/opsService';
import SystemAlertsPage from '../systemAlerts';

vi.mock('../../../services/opsService', () => ({
  acknowledgeAlert: vi.fn(),
  clearAcknowledgedAlerts: vi.fn(),
  listSystemAlertsPage: vi.fn(),
  getCollectorStatus: vi.fn().mockResolvedValue({ collectionEnabled: false }),
  listAlertDeliveries: vi.fn().mockResolvedValue([]),
  listAlertSilences: vi.fn(),
  createAlertSilence: vi.fn(),
  deleteAlertSilence: vi.fn(),
}));

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

const renderPage = () =>
  render(
    <App>
      <LangProvider>
        <SystemAlertsPage />
      </LangProvider>
    </App>,
  );

describe('SystemAlertsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listSystemAlertsPage).mockResolvedValue({
      items: [
        {
          id: 1,
          level: 'error',
          title: 'Broker unavailable',
          description: 'broker a',
          time: '2026-08-10 01:00',
          acknowledged: false,
        },
        {
          id: 2,
          level: 'warning',
          title: 'Consumer lag',
          description: 'consumer b',
          time: '2026-08-10 01:01',
          acknowledged: false,
        },
      ],
      total: 2,
      page: 1,
      size: 20,
    });
    vi.mocked(listAlertSilences).mockResolvedValue([]);
  });

  it('renders an alert with an unknown backend level', async () => {
    vi.mocked(listSystemAlertsPage).mockReset();
    vi.mocked(listSystemAlertsPage).mockResolvedValue({
      items: [
        {
          id: 3,
          level: 'critical',
          title: 'Critical broker condition',
          description: 'A newer backend emitted this level',
          time: '2026-08-10 01:00',
          acknowledged: false,
        },
      ],
      total: 1,
      page: 1,
      size: 20,
    });

    renderPage();

    expect(await screen.findByText('Critical broker condition')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByText('A newer backend emitted this level')).toBeInTheDocument();
  });

  it('filters backend alert levels case-insensitively', async () => {
    vi.mocked(listSystemAlertsPage).mockReset();
    vi.mocked(listSystemAlertsPage)
      .mockResolvedValueOnce({
        items: [
          {
            id: 4,
            level: 'Error',
            title: 'Mixed-case error',
            description: 'error',
            time: '2026-08-10 01:00',
            acknowledged: false,
          },
          {
            id: 5,
            level: 'WARNING',
            title: 'Mixed-case warning',
            description: 'warning',
            time: '2026-08-10 01:01',
            acknowledged: false,
          },
        ],
        total: 2,
        page: 1,
        size: 20,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 4,
            level: 'Error',
            title: 'Mixed-case error',
            description: 'error',
            time: '2026-08-10 01:00',
            acknowledged: false,
          },
        ],
        total: 1,
        page: 1,
        size: 20,
      });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Mixed-case error');

    await user.click(screen.getByRole('button', { name: /严重/ }));

    await waitFor(() => {
      expect(screen.getByText('Mixed-case error')).toBeInTheDocument();
      expect(screen.queryByText('Mixed-case warning')).not.toBeInTheDocument();
    });
  });

  it('tracks simultaneous acknowledgements independently', async () => {
    vi.mocked(acknowledgeAlert).mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Broker unavailable');
    const acknowledgeButtons = screen.getAllByRole('button', { name: /^确认$/ });
    await user.click(acknowledgeButtons[0]);
    await user.click(acknowledgeButtons[1]);

    await waitFor(() => {
      expect(acknowledgeAlert).toHaveBeenCalledWith(1);
      expect(acknowledgeAlert).toHaveBeenCalledWith(2);
      expect(acknowledgeButtons[0]).toHaveClass('ant-btn-loading');
      expect(acknowledgeButtons[1]).toHaveClass('ant-btn-loading');
    });
  });

  it('shows maintenance windows and creates a scoped silence', async () => {
    vi.mocked(listAlertSilences).mockResolvedValue([
      {
        id: 9,
        domain: 'CLUSTER',
        instanceId: 'local',
        startsAt: '2026-08-10T01:00',
        endsAt: '2026-08-10T02:00',
        createdBy: 'admin',
      },
    ]);
    vi.mocked(createAlertSilence).mockResolvedValue({
      id: 10,
      domain: 'BUSINESS',
      startsAt: '2026-08-11T01:00',
      endsAt: '2026-08-11T02:00',
      createdBy: 'admin',
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '维护窗口' }));
    expect(await screen.findByText(/CLUSTER.*local/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('规则 ID'), '42');
    await user.type(screen.getByLabelText('标签范围'), 'brokerName=broker-a,topic=orders');
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-08-11T01:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-08-11T02:00' } });
    await user.click(screen.getByRole('button', { name: /创\s*建/ }));

    await waitFor(() => {
      expect(createAlertSilence).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'BUSINESS',
          ruleId: 42,
          labels: { brokerName: 'broker-a', topic: 'orders' },
          startsAt: '2026-08-11T01:00',
          endsAt: '2026-08-11T02:00',
        }),
      );
    });
  });
});
