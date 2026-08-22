import client from './client';

// Matches mock/alerts.ts (inferred from data)
export interface AlertRule {
  id: number;
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  thresholdUnit: string;
  duration: string;
  channels: string[];
  enabled: boolean;
  lastTriggered: string | null;
  description: string;
  instanceId?: string;
  consumerGroup?: string;
  consecutiveSamples?: number;
}

export interface AlertRuleBulkResult {
  succeededIds: number[];
  failures: Record<string, string>;
  updatedRules: AlertRule[];
}

export interface AlertRuleTestResult {
  samples: Array<{
    labels: Record<string, string>;
    availability: string;
    currentValue: number | null;
    conditionMet: boolean;
  }>;
}

// Matches mock/dashboard.ts systemAlerts
export interface SystemAlert {
  id: number;
  level: string;
  title: string;
  description: string;
  time: string;
  acknowledged: boolean;
  domain?: 'BUSINESS' | 'CLUSTER' | null;
  ruleId?: number | null;
  fingerprint?: string | null;
  transition?: 'FIRING' | 'RESOLVED' | null;
  instanceId?: string | null;
  currentValue?: number | null;
}

export interface CollectorStatus {
  collectionEnabled: boolean;
  collectionInterval: string;
  clusterCollectorCount: number;
  businessCollectorCount: number;
}

export interface SystemAlertQuery {
  level?: string;
  domain?: 'BUSINESS' | 'CLUSTER';
  instanceId?: string;
  transition?: string;
  page?: number;
  pageSize?: number;
}

export interface NotificationDelivery {
  channel: string;
  status: 'PENDING' | 'SENDING' | 'DELIVERED' | 'RETRY_WAIT' | 'FAILED';
  attemptCount: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  deliveredAt?: string | null;
}

export interface AlertSilence {
  id: number;
  domain?: 'BUSINESS' | 'CLUSTER' | null;
  ruleId?: number | null;
  instanceId?: string | null;
  startsAt: string;
  endsAt: string;
  reason?: string | null;
  createdBy: string;
}

export type CreateAlertSilence = Omit<AlertSilence, 'id' | 'createdBy'>;

// Matches mock/audit.ts (inferred from data)
export interface AuditRecord {
  id: number;
  timestamp: string;
  operator: string;
  operationType: string;
  resourceType: string;
  target: string;
  clusterId: string;
  detail: string;
  result: string;
  errorMessage: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  operationType?: string;
  resourceType?: string;
  clusterId?: string;
  startDate?: string;
  endDate?: string;
  result?: string;
}

// ─── Alert Rules ────────────────────────────────────────────────
export async function listAlertRules() {
  const res = await client.get<{ data: AlertRule[] }>('/cluster-alert-rules');
  return res.data.data;
}

export async function createAlertRule(data: Partial<AlertRule>) {
  const res = await client.post<{ data: AlertRule }>('/cluster-alert-rules/create', data);
  return res.data.data;
}

export async function updateAlertRule(data: AlertRule) {
  const res = await client.post<{ data: AlertRule }>('/cluster-alert-rules/update', data);
  return res.data.data;
}

export async function toggleAlertRule(id: number, enabled: boolean) {
  const res = await client.post<{ data: AlertRule }>('/cluster-alert-rules/toggle', {
    id,
    enabled,
  });
  return res.data.data;
}

export async function deleteAlertRule(id: number) {
  await client.post('/cluster-alert-rules/delete', { id });
}

export async function bulkToggleAlertRules(ids: number[], enabled: boolean) {
  const res = await client.post<{ data: AlertRuleBulkResult }>('/cluster-alert-rules/bulk-toggle', {
    ids,
    enabled,
  });
  return res.data.data;
}

export async function bulkDeleteAlertRules(ids: number[]) {
  const res = await client.post<{ data: AlertRuleBulkResult }>('/cluster-alert-rules/bulk-delete', {
    ids,
  });
  return res.data.data;
}

export async function testAlertRule(data: Partial<AlertRule>) {
  const res = await client.post<{ data: AlertRuleTestResult }>('/cluster-alert-rules/test', data);
  return res.data.data;
}

// ─── System Alerts ──────────────────────────────────────────────
export async function listSystemAlerts(params?: SystemAlertQuery) {
  const res = await client.get<{ data: SystemAlert[] }>('/system-alerts', { params });
  return res.data.data;
}

export async function listSystemAlertsPage(params: SystemAlertQuery = {}) {
  const res = await client.get<{ data: PageResult<SystemAlert> }>('/system-alerts/page', {
    params,
  });
  return res.data.data;
}

export async function getCollectorStatus() {
  const res = await client.get<{ data: CollectorStatus }>('/alert-collector-status');
  return res.data.data;
}

export async function acknowledgeAlert(id: number) {
  await client.post('/system-alerts/acknowledge', { id });
}

export async function clearAcknowledgedAlerts() {
  const res = await client.post<{ data: { cleared: number } }>('/system-alerts/clear-acknowledged');
  return res.data.data;
}

export async function listAlertDeliveries(id: number) {
  const res = await client.get<{ data: NotificationDelivery[] }>(`/system-alerts/${id}/deliveries`);
  return res.data.data;
}

export async function listAlertSilences() {
  const res = await client.get<{ data: AlertSilence[] }>('/alert-silences');
  return res.data.data;
}

export async function createAlertSilence(data: CreateAlertSilence) {
  const res = await client.post<{ data: AlertSilence }>('/alert-silences', data);
  return res.data.data;
}

export async function deleteAlertSilence(id: number) {
  await client.delete(`/alert-silences/${id}`);
}

// ─── Audit Logs ─────────────────────────────────────────────────
export async function listAuditRecords(params?: AuditQuery) {
  const res = await client.get<{ data: PageResult<AuditRecord> }>('/audit-logs', {
    params,
  });
  return res.data.data;
}

export async function cleanupAuditLogs(beforeDays: number) {
  const res = await client.post<{ data: { deleted: number } }>('/audit-logs/cleanup', {
    beforeDays,
  });
  return res.data.data;
}

// ─── NameServer Operations ──────────────────────────────────────
export interface OpsHomeData {
  configurationAvailable: boolean;
  unavailableReason?: string;
  namesvrAddrList: string[];
  useVIPChannel: boolean;
  useTLS: boolean;
  currentNamesrv: string;
}

export async function queryOpsHomePage(): Promise<OpsHomeData> {
  const res = await client.get<{ data: OpsHomeData }>('/ops/homePage');
  return res.data.data;
}

export async function updateNameSvrAddr(namesrvAddr: string): Promise<void> {
  await client.post('/ops/updateNameSvrAddr', { namesrvAddr });
}

export async function addNameSvrAddr(namesrvAddr: string): Promise<void> {
  await client.post('/ops/addNameSvrAddr', { namesrvAddr });
}

export async function deleteNameSvrAddr(namesrvAddr: string): Promise<void> {
  await client.post('/ops/deleteNameSvrAddr', { namesrvAddr });
}

export async function updateIsVIPChannel(useVIPChannel: boolean): Promise<void> {
  await client.post('/ops/updateIsVIPChannel', { useVIPChannel });
}

export async function updateUseTLS(useTLS: boolean): Promise<void> {
  await client.post('/ops/updateUseTLS', { useTLS });
}
