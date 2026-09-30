const BASE = (import.meta.env.VITE_MT5_BRIDGE_URL as string | undefined)?.replace(/\/$/, '') || '/mt5-bridge';

export interface NotificationPolicies {
  [eventType: string]: boolean;
}

export interface NotificationStatus {
  ok: boolean;
  health: string;
  sender?: string;
  recipient?: string;
  masterEnabled?: boolean;
  fxEnabled?: boolean;
  xauEnabled?: boolean;
  policies?: NotificationPolicies;
  pending?: number;
  sentToday?: number;
  failedToday?: number;
  deadLetter?: number;
  lastSuccess?: string | null;
  lastError?: string | null;
  message?: string;
  smtp?: {
    host?: string;
    port?: number;
    user?: string;
    fromEmail?: string;
    fromName?: string;
    secure?: boolean;
    configured?: boolean;
    deliveryMode?: string;
  };
}

export interface SmtpAccountInput {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpFromEmail: string;
  smtpFromName: string;
  smtpAppPassword?: string;
}

export interface NotificationRow {
  notificationId?: string;
  candidateId?: string | null;
  symbol?: string | null;
  titLevel?: string | null;
  eventType?: string;
  recipient?: string;
  status?: string;
  subject?: string;
  createdAt?: string | null;
  sentAt?: string | null;
  lastError?: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = (await res.json()) as T;
  return body;
}

export function fetchNotificationStatus(): Promise<NotificationStatus> {
  return request('/notifications/status');
}

export function saveNotificationSettings(body: Partial<NotificationStatus> & Partial<SmtpAccountInput> & { policies?: NotificationPolicies }): Promise<NotificationStatus> {
  return request('/notifications/settings', { method: 'POST', body: JSON.stringify(body) });
}

export function sendTestEmail(): Promise<NotificationStatus> {
  return request('/notifications/test', { method: 'POST', body: '{}' });
}

export function fetchNotificationHistory(status = 'ALL', candidateId?: string): Promise<{ ok: boolean; notifications: NotificationRow[] }> {
  const query = new URLSearchParams({ status, limit: '40' });
  if (candidateId) query.set('candidateId', candidateId);
  return request(`/notifications/history?${query.toString()}`);
}

export function formatNotificationTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(parsed) + ' WAT';
}

export const EVENT_LABEL: Record<string, string> = {
  CHANNEL_BREAK_APPROACH: 'Near Breakout',
  CHANNEL_BREAK_DETECTED: 'Break Detected',
  CHANNEL_BREAK_CONFIRMED: 'Break Confirmed',
  CHANNEL_BREAK_FAILED: 'Break Failed',
  CHANNEL_RETEST_STARTED: 'Retest Started',
  CHANNEL_RETEST_HELD: 'Retest Held',
  CHANNEL_RETEST_FAILED: 'Retest Failed',
  CHANNEL_BREAK_CONTINUATION: 'Break Continuation',
  P1_ZONE_REACHED: 'P1 Zone Reached',
  P1_REACTION_DETECTED: 'P1 Reaction',
  P1_READY_FOR_RISK: 'P1 Ready for Risk',
  P2_BREAK_DETECTED: 'P2 Break Detected',
  P2_WAIT_RETEST: 'P2 Wait Retest',
  P2_READY_FOR_RISK: 'P2 Ready for Risk',
  P1_AUTHORIZED: 'P1 Authorized',
  P2_AUTHORIZED: 'P2 Authorized',
  ORDER_SUBMITTED: 'Order Submitted',
  ORDER_FILLED: 'Order Filled',
  ORDER_REJECTED: 'Order Rejected',
  POSITION_CLOSED: 'Position Closed',
  MT5_DISCONNECTED: 'MT5 Disconnected',
  MARKET_DATA_STALE: 'Market Data Stale',
  CALENDAR_FEED_STALE: 'Economic Feed Stale',
  NOTIFICATION_TEST: 'Test',
};
