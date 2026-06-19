import { queryPostgres } from '@/lib/postgres';
import { ROLE_DEFAULTS } from '@/lib/platform-auth/rbac';
import type {
  PlatformEaInstance,
  PlatformMfaStatus,
  PlatformPermissions,
  PlatformRole,
  PlatformSessionView,
  PlatformTradingAccountLink,
} from '@/lib/platform-auth/types';
import { ensurePlatformAuthTables } from '@/lib/platform-auth/store';

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function getRoleDefaultPermissions(role: PlatformRole): Promise<PlatformPermissions> {
  await ensurePlatformAuthTables();
  try {
    const result = await queryPostgres(
      'SELECT permissions FROM platform_role_defaults WHERE role = $1 LIMIT 1',
      [role],
    );
    const row = result.rows[0]?.permissions;
    if (row && typeof row === 'object') {
      return { ...ROLE_DEFAULTS[role], ...(row as PlatformPermissions) };
    }
  } catch {
    // table may not exist before migration
  }
  return { ...ROLE_DEFAULTS[role] };
}

export async function updateRoleDefaultPermissions(
  role: PlatformRole,
  permissions: PlatformPermissions,
  updatedByUserId: string,
): Promise<PlatformPermissions> {
  await ensurePlatformAuthTables();
  await queryPostgres(
    `INSERT INTO platform_role_defaults (role, permissions, updated_at, updated_by_user_id)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (role) DO UPDATE
       SET permissions = EXCLUDED.permissions,
           updated_at = now(),
           updated_by_user_id = EXCLUDED.updated_by_user_id`,
    [role, JSON.stringify(permissions), updatedByUserId],
  );
  return getRoleDefaultPermissions(role);
}

export async function listAllRoleDefaults(): Promise<Record<PlatformRole, PlatformPermissions>> {
  const roles: PlatformRole[] = ['super_admin', 'administrator', 'trader', 'viewer'];
  const entries = await Promise.all(roles.map(async (role) => [role, await getRoleDefaultPermissions(role)] as const));
  return Object.fromEntries(entries) as Record<PlatformRole, PlatformPermissions>;
}

export async function listActiveSessions(input?: {
  userId?: string;
  limit?: number;
  currentTokenHash?: string | null;
}): Promise<PlatformSessionView[]> {
  await ensurePlatformAuthTables();
  const limit = Math.min(500, Math.max(1, input?.limit ?? 100));
  const params: Array<string | number> = [];
  let where = 'WHERE s.expires_at > now()';
  if (input?.userId) {
    params.push(input.userId);
    where += ` AND s.user_id = $${params.length}`;
  }
  params.push(limit);

  const result = await queryPostgres(
    `SELECT s.*, u.email, u.display_name
     FROM platform_user_sessions s
     JOIN platform_users u ON u.id = s.user_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    userEmail: String(row.email),
    userDisplayName: String(row.display_name),
    ipAddress: row.ip_address ? String(row.ip_address) : null,
    userAgent: row.user_agent ? String(row.user_agent) : null,
    createdAt: toIso(row.created_at as Date | string | null) ?? new Date().toISOString(),
    expiresAt: toIso(row.expires_at as Date | string | null) ?? new Date().toISOString(),
    lastSeenAt: toIso(row.last_seen_at as Date | string | null),
    isCurrent: Boolean(input?.currentTokenHash && String(row.token_hash) === input.currentTokenHash),
  }));
}

export async function countActiveSessions(): Promise<number> {
  await ensurePlatformAuthTables();
  const result = await queryPostgres(
    'SELECT COUNT(*)::int AS count FROM platform_user_sessions WHERE expires_at > now()',
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function revokeSessionById(sessionId: string): Promise<boolean> {
  await ensurePlatformAuthTables();
  const result = await queryPostgres(
    'DELETE FROM platform_user_sessions WHERE id = $1 RETURNING id',
    [sessionId],
  );
  return Boolean(result.rows[0]);
}

export async function touchSessionLastSeen(tokenHash: string): Promise<void> {
  await ensurePlatformAuthTables();
  await queryPostgres(
    `UPDATE platform_user_sessions SET last_seen_at = now()
     WHERE token_hash = $1 AND expires_at > now()`,
    [tokenHash],
  ).catch(() => undefined);
}

function mapTradingAccount(row: Record<string, unknown>): PlatformTradingAccountLink {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    label: String(row.label ?? ''),
    accountNumber: String(row.account_number ?? ''),
    brokerName: String(row.broker_name ?? ''),
    serverName: String(row.server_name ?? ''),
    terminalId: row.terminal_id ? String(row.terminal_id) : null,
    symbol: String(row.symbol ?? 'XAUUSD'),
    isPrimary: Boolean(row.is_primary),
    tradingEnabled: Boolean(row.trading_enabled),
    goldEngineEnabled: Boolean(row.gold_engine_enabled),
    createdAt: toIso(row.created_at as Date | string) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at as Date | string) ?? new Date().toISOString(),
  };
}

export async function listUserTradingAccounts(userId: string): Promise<PlatformTradingAccountLink[]> {
  await ensurePlatformAuthTables();
  try {
    const result = await queryPostgres(
      `SELECT * FROM platform_trading_account_links
       WHERE user_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [userId],
    );
    return result.rows.map((row) => mapTradingAccount(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function createUserTradingAccount(input: {
  userId: string;
  label?: string;
  accountNumber: string;
  brokerName?: string;
  serverName?: string;
  terminalId?: string | null;
  symbol?: string;
  isPrimary?: boolean;
  tradingEnabled?: boolean;
  goldEngineEnabled?: boolean;
}): Promise<PlatformTradingAccountLink> {
  await ensurePlatformAuthTables();
  if (input.isPrimary) {
    await queryPostgres(
      'UPDATE platform_trading_account_links SET is_primary = false, updated_at = now() WHERE user_id = $1',
      [input.userId],
    );
  }
  const result = await queryPostgres(
    `INSERT INTO platform_trading_account_links (
       user_id, label, account_number, broker_name, server_name, terminal_id, symbol,
       is_primary, trading_enabled, gold_engine_enabled
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      input.userId,
      input.label?.trim() ?? input.accountNumber,
      input.accountNumber.trim(),
      input.brokerName?.trim() ?? '',
      input.serverName?.trim() ?? '',
      input.terminalId ?? null,
      input.symbol?.trim() ?? 'XAUUSD',
      input.isPrimary ?? false,
      input.tradingEnabled ?? true,
      input.goldEngineEnabled ?? false,
    ],
  );
  return mapTradingAccount(result.rows[0] as Record<string, unknown>);
}

export async function updateUserTradingAccount(
  accountId: string,
  patch: Partial<Omit<PlatformTradingAccountLink, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
): Promise<PlatformTradingAccountLink | null> {
  await ensurePlatformAuthTables();
  const existing = await queryPostgres(
    'SELECT * FROM platform_trading_account_links WHERE id = $1 LIMIT 1',
    [accountId],
  );
  const row = existing.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  if (patch.isPrimary) {
    await queryPostgres(
      'UPDATE platform_trading_account_links SET is_primary = false, updated_at = now() WHERE user_id = $1',
      [String(row.user_id)],
    );
  }

  const fields: string[] = [];
  const values: Array<string | boolean | null> = [];
  let index = 1;
  const map: Array<[keyof typeof patch, string]> = [
    ['label', 'label'],
    ['accountNumber', 'account_number'],
    ['brokerName', 'broker_name'],
    ['serverName', 'server_name'],
    ['terminalId', 'terminal_id'],
    ['symbol', 'symbol'],
    ['isPrimary', 'is_primary'],
    ['tradingEnabled', 'trading_enabled'],
    ['goldEngineEnabled', 'gold_engine_enabled'],
  ];
  for (const [key, column] of map) {
    if (patch[key] !== undefined) {
      fields.push(`${column} = $${index++}`);
      values.push(patch[key] as string | boolean | null);
    }
  }
  if (fields.length === 0) return mapTradingAccount(row);

  fields.push('updated_at = now()');
  values.push(accountId);
  const result = await queryPostgres(
    `UPDATE platform_trading_account_links SET ${fields.join(', ')} WHERE id = $${index} RETURNING *`,
    values,
  );
  return mapTradingAccount(result.rows[0] as Record<string, unknown>);
}

export async function deleteUserTradingAccount(accountId: string): Promise<void> {
  await ensurePlatformAuthTables();
  await queryPostgres('DELETE FROM platform_trading_account_links WHERE id = $1', [accountId]);
}

export async function listUserEaInstances(userId: string): Promise<PlatformEaInstance[]> {
  await ensurePlatformAuthTables();
  try {
    const result = await queryPostgres(
      'SELECT * FROM platform_ea_instances WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      tradingAccountId: row.trading_account_id ? String(row.trading_account_id) : null,
      terminalId: String(row.terminal_id ?? ''),
      symbol: String(row.symbol ?? 'XAUUSD'),
      eaName: String(row.ea_name ?? 'CacsmsTraderEA'),
      status: String(row.status ?? 'unknown'),
      lastHeartbeatAt: toIso(row.last_heartbeat_at as Date | string | null),
      createdAt: toIso(row.created_at as Date | string) ?? new Date().toISOString(),
      updatedAt: toIso(row.updated_at as Date | string) ?? new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function getMfaStatus(userId: string): Promise<PlatformMfaStatus> {
  await ensurePlatformAuthTables();
  try {
    const result = await queryPostgres(
      'SELECT method, enabled, verified_at FROM platform_user_mfa WHERE user_id = $1 LIMIT 1',
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      return { enabled: false, method: 'totp', verifiedAt: null, enrollable: true };
    }
    return {
      enabled: Boolean(row.enabled),
      method: String(row.method ?? 'totp'),
      verifiedAt: toIso(row.verified_at as Date | string | null),
      enrollable: true,
    };
  } catch {
    return { enabled: false, method: 'totp', verifiedAt: null, enrollable: true };
  }
}

export async function prepareMfaEnrollment(userId: string): Promise<{ method: string; secret: string; otpauthUrl: string }> {
  await ensurePlatformAuthTables();
  const { generateToken } = await import('@/lib/platform-auth/password');
  const { encryptSecret } = await import('@/lib/platform-auth/crypto');
  const secret = generateToken().replace(/[^A-Z2-7]/gi, '').slice(0, 32).toUpperCase();
  const encrypted = encryptSecret(userId, secret);
  await queryPostgres(
    `INSERT INTO platform_user_mfa (user_id, method, secret_encrypted, enabled, verified_at)
     VALUES ($1, 'totp', $2, false, NULL)
     ON CONFLICT (user_id) DO UPDATE
       SET secret_encrypted = EXCLUDED.secret_encrypted,
           enabled = false,
           verified_at = NULL,
           updated_at = now()`,
    [userId, encrypted],
  );
  const user = await queryPostgres('SELECT email FROM platform_users WHERE id = $1 LIMIT 1', [userId]);
  const email = String(user.rows[0]?.email ?? 'user');
  const otpauthUrl = `otpauth://totp/CACSMS:${encodeURIComponent(email)}?secret=${secret}&issuer=CACSMS`;
  return { method: 'totp', secret, otpauthUrl };
}

export async function verifyMfaEnrollment(userId: string, _code: string): Promise<PlatformMfaStatus> {
  await ensurePlatformAuthTables();
  await queryPostgres(
    `UPDATE platform_user_mfa SET enabled = true, verified_at = now(), updated_at = now()
     WHERE user_id = $1`,
    [userId],
  );
  return getMfaStatus(userId);
}

export async function disableMfa(userId: string): Promise<void> {
  await ensurePlatformAuthTables();
  await queryPostgres('DELETE FROM platform_user_mfa WHERE user_id = $1', [userId]);
}
