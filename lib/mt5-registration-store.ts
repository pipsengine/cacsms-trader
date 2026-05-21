import { createHash } from 'node:crypto';
import { queryPostgres } from '@/lib/postgres';

type RegistrationPayload = {
  terminalId?: unknown;
  terminalName?: unknown;
  computerId?: unknown;
  computerName?: unknown;
  accountNumber?: unknown;
  brokerName?: unknown;
  serverName?: unknown;
  mt5Build?: unknown;
  eaVersion?: unknown;
  terminalType?: unknown;
  environment?: unknown;
  region?: unknown;
  authenticationKey?: unknown;
  vpsId?: unknown;
  priority?: unknown;
  tags?: unknown;
  capabilities?: unknown;
  notes?: unknown;
};

type DbRegistrationRow = {
  terminal_id: string;
  terminal_name: string;
  computer_id: string;
  computer_name: string;
  account_number: string;
  broker_name: string;
  server_name: string;
  mt5_build: number;
  ea_version: string;
  terminal_type: string;
  environment: string;
  region: string;
  vps_id: string | null;
  priority: number;
  tags: string[];
  capabilities: string[];
  notes: string;
  approval_status: string;
  registered_at: Date | string;
  updated_at: Date | string;
};

export type TerminalRegistrationView = {
  terminalId: string;
  terminalName: string;
  computerId: string;
  computerName: string;
  accountNumber: string;
  brokerName: string;
  serverName: string;
  mt5Build: number;
  eaVersion: string;
  terminalType: string;
  environment: string;
  region: string;
  priority: number;
  vpsId: string;
  tags: string[];
  capabilities: string[];
  notes: string;
  approvalStatus: string;
  registeredAt: string;
  updatedAt: string;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).slice(0, 30);
  }
  if (typeof value === 'string') {
    return value.split(',').map(text).filter(Boolean).slice(0, 30);
  }
  return [];
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function tokenHash(value: unknown): string | null {
  const token = text(value);
  if (!token) return null;
  return createHash('sha256').update(token).digest('hex');
}

function required(value: unknown, label: string): string {
  const normalized = text(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

export function normalizeRegistrationPayload(payload: RegistrationPayload) {
  const terminalId = required(payload.terminalId, 'terminalId');
  const accountNumber = required(payload.accountNumber, 'accountNumber');
  const brokerName = required(payload.brokerName, 'brokerName');
  const serverName = required(payload.serverName, 'serverName');
  const computerName = text(payload.computerName);
  const computerId = text(payload.computerId) || computerName || terminalId;
  const mt5Build = numberValue(payload.mt5Build, 0);

  if (!Number.isFinite(mt5Build) || mt5Build < 3900) {
    throw new Error('MT5 build must be 3900 or newer.');
  }

  return {
    terminalId,
    terminalName: text(payload.terminalName) || terminalId,
    computerId,
    computerName,
    accountNumber,
    brokerName,
    serverName,
    mt5Build,
    eaVersion: required(payload.eaVersion, 'eaVersion'),
    terminalType: text(payload.terminalType) || 'live-trading',
    environment: text(payload.environment) || 'demo',
    region: text(payload.region) || 'LD4',
    authenticationKeyHash: tokenHash(payload.authenticationKey),
    vpsId: text(payload.vpsId),
    priority: numberValue(payload.priority, 50),
    tags: textList(payload.tags),
    capabilities: textList(payload.capabilities),
    notes: text(payload.notes),
  };
}

export async function upsertTerminalRegistration(payload: RegistrationPayload) {
  const registration = normalizeRegistrationPayload(payload);
  const vpsId = registration.vpsId || `computer-${registration.computerId}`;

  await queryPostgres(
    `
      INSERT INTO mt5_broker_accounts (account_number, broker_name, server_name, verified_at, updated_at)
      VALUES ($1, $2, $3, now(), now())
      ON CONFLICT (account_number) DO UPDATE SET
        broker_name = EXCLUDED.broker_name,
        server_name = EXCLUDED.server_name,
        verified_at = now(),
        updated_at = now()
    `,
    [registration.accountNumber, registration.brokerName, registration.serverName],
  );

  await queryPostgres(
    `
      INSERT INTO mt5_vps_nodes (vps_id, computer_name, region, fingerprint, status, updated_at)
      VALUES ($1, $2, $3, $4, 'registered', now())
      ON CONFLICT (vps_id) DO UPDATE SET
        computer_name = EXCLUDED.computer_name,
        region = EXCLUDED.region,
        fingerprint = EXCLUDED.fingerprint,
        updated_at = now()
    `,
    [vpsId, registration.computerName || vpsId, registration.region, registration.computerId],
  );

  const result = await queryPostgres(
    `
      INSERT INTO mt5_terminal_registrations (
        terminal_id,
        terminal_name,
        computer_id,
        computer_name,
        account_number,
        broker_name,
        server_name,
        mt5_build,
        ea_version,
        terminal_type,
        environment,
        region,
        vps_id,
        priority,
        tags,
        capabilities,
        notes,
        token_hash,
        approval_status,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'pending_heartbeat', now())
      ON CONFLICT (terminal_id) DO UPDATE SET
        terminal_name = EXCLUDED.terminal_name,
        computer_id = EXCLUDED.computer_id,
        computer_name = EXCLUDED.computer_name,
        account_number = EXCLUDED.account_number,
        broker_name = EXCLUDED.broker_name,
        server_name = EXCLUDED.server_name,
        mt5_build = EXCLUDED.mt5_build,
        ea_version = EXCLUDED.ea_version,
        terminal_type = EXCLUDED.terminal_type,
        environment = EXCLUDED.environment,
        region = EXCLUDED.region,
        vps_id = EXCLUDED.vps_id,
        priority = EXCLUDED.priority,
        tags = EXCLUDED.tags,
        capabilities = EXCLUDED.capabilities,
        notes = EXCLUDED.notes,
        token_hash = COALESCE(EXCLUDED.token_hash, mt5_terminal_registrations.token_hash),
        updated_at = now()
      RETURNING *
    `,
    [
      registration.terminalId,
      registration.terminalName,
      registration.computerId,
      registration.computerName,
      registration.accountNumber,
      registration.brokerName,
      registration.serverName,
      registration.mt5Build,
      registration.eaVersion,
      registration.terminalType,
      registration.environment,
      registration.region,
      vpsId,
      registration.priority,
      registration.tags,
      registration.capabilities,
      registration.notes,
      registration.authenticationKeyHash,
    ],
  );

  await recordRegistrationAttempt(registration.terminalId, 'registered', 'Registration stored in PostgreSQL.');
  return mapRegistration(result.rows[0] as DbRegistrationRow);
}

export async function recordRegistrationAttempt(
  terminalId: string,
  status: string,
  message: string,
  errorCode = '',
) {
  await queryPostgres(
    `
      INSERT INTO mt5_registration_attempts (terminal_id, status, error_code, message)
      VALUES ($1, $2, $3, $4)
    `,
    [terminalId, status, errorCode, message],
  );
}

export async function listTerminalRegistrations(): Promise<TerminalRegistrationView[]> {
  const result = await queryPostgres(`
    SELECT *
    FROM mt5_terminal_registrations
    ORDER BY updated_at DESC, terminal_id ASC
  `);

  return result.rows.map((row) => mapRegistration(row as DbRegistrationRow));
}

export function mergeRegistrations(
  bridgeRegistrations: unknown[] = [],
  databaseRegistrations: TerminalRegistrationView[] = [],
) {
  const byTerminalId = new Map<string, Record<string, unknown>>();

  for (const registration of bridgeRegistrations) {
    const item = registration as Record<string, unknown>;
    const terminalId = text(item.terminalId);
    if (terminalId) byTerminalId.set(terminalId, item);
  }

  for (const registration of databaseRegistrations) {
    const existing = byTerminalId.get(registration.terminalId) ?? {};
    byTerminalId.set(registration.terminalId, {
      ...existing,
      ...registration,
    });
  }

  return Array.from(byTerminalId.values()).sort((a, b) => {
    const aUpdated = Date.parse(text(a.updatedAt));
    const bUpdated = Date.parse(text(b.updatedAt));
    return (Number.isFinite(bUpdated) ? bUpdated : 0) - (Number.isFinite(aUpdated) ? aUpdated : 0);
  });
}

function mapRegistration(row: DbRegistrationRow): TerminalRegistrationView {
  return {
    terminalId: row.terminal_id,
    terminalName: row.terminal_name,
    computerId: row.computer_id,
    computerName: row.computer_name,
    accountNumber: row.account_number,
    brokerName: row.broker_name,
    serverName: row.server_name,
    mt5Build: Number(row.mt5_build),
    eaVersion: row.ea_version,
    terminalType: row.terminal_type,
    environment: row.environment,
    region: row.region,
    priority: Number(row.priority),
    vpsId: row.vps_id ?? '',
    tags: row.tags ?? [],
    capabilities: row.capabilities ?? [],
    notes: row.notes ?? '',
    approvalStatus: row.approval_status,
    registeredAt: new Date(row.registered_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
