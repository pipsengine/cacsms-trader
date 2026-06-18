import { queryPostgres } from '@/lib/postgres';
import {
  GLOBAL_SUPER_ADMIN_PROTECTED_ERROR,
  isGlobalSuperAdminUser,
} from '@/lib/platform-auth/global-super-admin';
import type {
  PlatformAdminOverview,
  PlatformAuditEntry,
  PlatformMt5Config,
  PlatformPermissions,
  PlatformRole,
  PlatformTradingConfig,
  PlatformUserPublic,
  PlatformUserStatus,
} from '@/lib/platform-auth/types';

type DbUserRow = {
  id: string;
  username: string | null;
  email: string;
  display_name: string;
  password_hash: string;
  role: PlatformRole;
  status: PlatformUserStatus;
  is_system_protected: boolean;
  managed_by_user_id: string | null;
  permissions: PlatformPermissions | string;
  last_login_at: Date | string | null;
  password_changed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

let tablesReady: Promise<void> | null = null;

export async function ensurePlatformAuthTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await queryPostgres(`
        CREATE TABLE IF NOT EXISTS platform_users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL DEFAULT '',
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'trader',
          status TEXT NOT NULL DEFAULT 'active',
          managed_by_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
          permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
          last_login_at TIMESTAMPTZ,
          password_changed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await queryPostgres(`
        ALTER TABLE platform_users
          ADD COLUMN IF NOT EXISTS username TEXT,
          ADD COLUMN IF NOT EXISTS is_system_protected BOOLEAN NOT NULL DEFAULT false;
      `);
      await queryPostgres(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_users_username_lower
          ON platform_users (LOWER(username))
          WHERE username IS NOT NULL;
      `);
      await queryPostgres(`
        CREATE OR REPLACE FUNCTION protect_system_platform_users()
        RETURNS TRIGGER AS $$
        BEGIN
          IF OLD.is_system_protected THEN
            IF TG_OP = 'DELETE' THEN
              RAISE EXCEPTION 'System-protected user cannot be deleted';
            ELSIF TG_OP = 'UPDATE' THEN
              NEW.is_system_protected := true;
              NEW.role := 'super_admin';
              IF NEW.status IS DISTINCT FROM 'active' THEN
                NEW.status := 'active';
              END IF;
              NEW.username := OLD.username;
            END IF;
          END IF;
          IF TG_OP = 'DELETE' THEN
            RETURN OLD;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await queryPostgres(`
        DROP TRIGGER IF EXISTS trg_protect_system_platform_users ON platform_users;
      `);
      await queryPostgres(`
        CREATE TRIGGER trg_protect_system_platform_users
          BEFORE UPDATE OR DELETE ON platform_users
          FOR EACH ROW
          EXECUTE FUNCTION protect_system_platform_users();
      `);
    })();
  }
  await tablesReady;
}

function parsePermissions(value: PlatformPermissions | string): PlatformPermissions {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as PlatformPermissions;
    } catch {
      return {};
    }
  }
  return value ?? {};
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapUser(row: DbUserRow): PlatformUserPublic {
  return {
    id: row.id,
    username: row.username ?? null,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    isSystemProtected: Boolean(row.is_system_protected),
    managedByUserId: row.managed_by_user_id,
    permissions: parsePermissions(row.permissions),
    lastLoginAt: toIso(row.last_login_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

export async function countPlatformUsers(): Promise<number> {
  await ensurePlatformAuthTables();
  const result = await queryPostgres('SELECT COUNT(*)::int AS count FROM platform_users');
  return Number(result.rows[0]?.count ?? 0);
}

export async function getUserByEmail(email: string): Promise<(PlatformUserPublic & { passwordHash: string }) | null> {
  await ensurePlatformAuthTables();
  const result = await queryPostgres(
    'SELECT * FROM platform_users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email.trim()],
  );
  const row = result.rows[0] as DbUserRow | undefined;
  if (!row) return null;
  return { ...mapUser(row), passwordHash: row.password_hash };
}

export async function getUserByUsername(username: string): Promise<(PlatformUserPublic & { passwordHash: string }) | null> {
  await ensurePlatformAuthTables();
  const result = await queryPostgres(
    'SELECT * FROM platform_users WHERE LOWER(username) = LOWER($1) LIMIT 1',
    [username.trim()],
  );
  const row = result.rows[0] as DbUserRow | undefined;
  if (!row) return null;
  return { ...mapUser(row), passwordHash: row.password_hash };
}

export async function getUserByLoginIdentifier(
  identifier: string,
): Promise<(PlatformUserPublic & { passwordHash: string }) | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) {
    return getUserByEmail(trimmed);
  }
  return getUserByUsername(trimmed);
}

export async function getUserById(id: string): Promise<PlatformUserPublic | null> {
  await ensurePlatformAuthTables();
  const result = await queryPostgres('SELECT * FROM platform_users WHERE id = $1 LIMIT 1', [id]);
  const row = result.rows[0] as DbUserRow | undefined;
  return row ? mapUser(row) : null;
}

export async function listPlatformUsers(): Promise<PlatformUserPublic[]> {
  await ensurePlatformAuthTables();
  const result = await queryPostgres('SELECT * FROM platform_users ORDER BY created_at ASC');
  return (result.rows as DbUserRow[]).map(mapUser);
}

export type CreateUserInput = {
  email: string;
  displayName: string;
  passwordHash: string;
  role: PlatformRole;
  status?: PlatformUserStatus;
  managedByUserId?: string | null;
  permissions?: PlatformPermissions;
  username?: string | null;
  isSystemProtected?: boolean;
  id?: string;
};

export async function createPlatformUser(input: CreateUserInput): Promise<PlatformUserPublic> {
  await ensurePlatformAuthTables();
  const result = await queryPostgres(
    `INSERT INTO platform_users (
       id, username, email, display_name, password_hash, role, status,
       managed_by_user_id, permissions, is_system_protected, password_changed_at
     )
     VALUES (
       COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, now()
     )
     RETURNING *`,
    [
      input.id ?? null,
      input.username?.trim() ?? null,
      input.email.trim().toLowerCase(),
      input.displayName.trim(),
      input.passwordHash,
      input.role,
      input.status ?? 'active',
      input.managedByUserId ?? null,
      JSON.stringify(input.permissions ?? {}),
      input.isSystemProtected ?? false,
    ],
  );
  const user = mapUser(result.rows[0] as DbUserRow);
  await ensureDefaultConfigs(user.id);
  return user;
}

export async function updatePlatformUser(
  id: string,
  patch: Partial<{
    displayName: string;
    role: PlatformRole;
    status: PlatformUserStatus;
    managedByUserId: string | null;
    permissions: PlatformPermissions;
    passwordHash: string;
  }>,
): Promise<PlatformUserPublic | null> {
  await ensurePlatformAuthTables();

  const existing = await getUserById(id);
  if (!existing) return null;

  if (isGlobalSuperAdminUser(existing)) {
    if (patch.role !== undefined && patch.role !== 'super_admin') {
      throw new Error(GLOBAL_SUPER_ADMIN_PROTECTED_ERROR);
    }
    if (patch.status !== undefined && patch.status !== 'active') {
      throw new Error(GLOBAL_SUPER_ADMIN_PROTECTED_ERROR);
    }
    if (patch.managedByUserId !== undefined && patch.managedByUserId !== existing.managedByUserId) {
      throw new Error(GLOBAL_SUPER_ADMIN_PROTECTED_ERROR);
    }
    if (patch.permissions !== undefined) {
      throw new Error(GLOBAL_SUPER_ADMIN_PROTECTED_ERROR);
    }
  }

  const fields: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  let index = 1;

  if (patch.displayName !== undefined) {
    fields.push(`display_name = $${index++}`);
    values.push(patch.displayName.trim());
  }
  if (patch.role !== undefined) {
    fields.push(`role = $${index++}`);
    values.push(patch.role);
  }
  if (patch.status !== undefined) {
    fields.push(`status = $${index++}`);
    values.push(patch.status);
  }
  if (patch.managedByUserId !== undefined) {
    fields.push(`managed_by_user_id = $${index++}`);
    values.push(patch.managedByUserId);
  }
  if (patch.permissions !== undefined) {
    fields.push(`permissions = $${index++}::jsonb`);
    values.push(JSON.stringify(patch.permissions));
  }
  if (patch.passwordHash !== undefined) {
    fields.push(`password_hash = $${index++}`);
    values.push(patch.passwordHash);
    fields.push('password_changed_at = now()');
  }

  if (fields.length === 0) return getUserById(id);

  fields.push('updated_at = now()');
  values.push(id);

  const result = await queryPostgres(
    `UPDATE platform_users SET ${fields.join(', ')} WHERE id = $${index} RETURNING *`,
    values,
  );
  const row = result.rows[0] as DbUserRow | undefined;
  return row ? mapUser(row) : null;
}

export async function deletePlatformUser(id: string): Promise<void> {
  await ensurePlatformAuthTables();
  const user = await getUserById(id);
  if (!user) return;
  if (isGlobalSuperAdminUser(user)) {
    throw new Error(GLOBAL_SUPER_ADMIN_PROTECTED_ERROR);
  }
  await queryPostgres('DELETE FROM platform_users WHERE id = $1 AND is_system_protected = false', [id]);
}

export async function touchUserLogin(userId: string): Promise<void> {
  await queryPostgres('UPDATE platform_users SET last_login_at = now(), updated_at = now() WHERE id = $1', [userId]);
}

async function ensureDefaultConfigs(userId: string): Promise<void> {
  await queryPostgres(
    `INSERT INTO platform_user_mt5_config (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  await queryPostgres(
    `INSERT INTO platform_user_trading_config (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

export async function getMt5Config(userId: string): Promise<PlatformMt5Config> {
  await ensurePlatformAuthTables();
  await ensureDefaultConfigs(userId);
  const result = await queryPostgres('SELECT * FROM platform_user_mt5_config WHERE user_id = $1', [userId]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return {
    brokerName: String(row?.broker_name ?? ''),
    accountNumber: String(row?.account_number ?? ''),
    serverName: String(row?.server_name ?? ''),
    terminalId: row?.terminal_id ? String(row.terminal_id) : null,
    symbol: String(row?.symbol ?? 'XAUUSD'),
    hasPassword: Boolean(row?.encrypted_password),
    hasInvestorPassword: Boolean(row?.encrypted_investor_password),
    connectionStatus: String(row?.connection_status ?? 'disconnected'),
    lastConnectedAt: toIso(row?.last_connected_at as Date | string | null),
    updatedAt: toIso(row?.updated_at as Date | string) ?? new Date().toISOString(),
  };
}

export async function updateMt5Config(
  userId: string,
  patch: Partial<{
    brokerName: string;
    accountNumber: string;
    serverName: string;
    terminalId: string | null;
    symbol: string;
    encryptedPassword: string | null;
    encryptedInvestorPassword: string | null;
    connectionStatus: string;
    lastConnectedAt: string | null;
  }>,
): Promise<PlatformMt5Config> {
  await ensureDefaultConfigs(userId);
  const fields: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  let index = 1;

  const map: Array<[keyof typeof patch, string]> = [
    ['brokerName', 'broker_name'],
    ['accountNumber', 'account_number'],
    ['serverName', 'server_name'],
    ['terminalId', 'terminal_id'],
    ['symbol', 'symbol'],
    ['encryptedPassword', 'encrypted_password'],
    ['encryptedInvestorPassword', 'encrypted_investor_password'],
    ['connectionStatus', 'connection_status'],
    ['lastConnectedAt', 'last_connected_at'],
  ];

  for (const [key, column] of map) {
    if (patch[key] !== undefined) {
      fields.push(`${column} = $${index++}`);
      values.push(patch[key]);
    }
  }

  fields.push('updated_at = now()');
  values.push(userId);

  await queryPostgres(
    `UPDATE platform_user_mt5_config SET ${fields.join(', ')} WHERE user_id = $${index}`,
    values,
  );
  return getMt5Config(userId);
}

export async function getTradingConfig(userId: string): Promise<PlatformTradingConfig> {
  await ensurePlatformAuthTables();
  await ensureDefaultConfigs(userId);
  const result = await queryPostgres('SELECT * FROM platform_user_trading_config WHERE user_id = $1', [userId]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return {
    tradingEnabled: Boolean(row?.trading_enabled),
    lotSize: Number(row?.lot_size ?? 0.01),
    riskPerTradePercent: Number(row?.risk_per_trade_percent ?? 0.5),
    dailyDrawdownPercent: Number(row?.daily_drawdown_percent ?? 4),
    maxOpenTrades: Number(row?.max_open_trades ?? 3),
    basketLimit: Number(row?.basket_limit ?? 3),
    profitLockEnabled: Boolean(row?.profit_lock_enabled ?? true),
    profitLockPercent: Number(row?.profit_lock_percent ?? 50),
    goldEngineEnabled: Boolean(row?.gold_engine_enabled),
    updatedAt: toIso(row?.updated_at as Date | string) ?? new Date().toISOString(),
  };
}

export async function updateTradingConfig(
  userId: string,
  patch: Partial<PlatformTradingConfig>,
): Promise<PlatformTradingConfig> {
  await ensureDefaultConfigs(userId);
  const fields: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  let index = 1;

  const map: Array<[keyof PlatformTradingConfig, string]> = [
    ['tradingEnabled', 'trading_enabled'],
    ['lotSize', 'lot_size'],
    ['riskPerTradePercent', 'risk_per_trade_percent'],
    ['dailyDrawdownPercent', 'daily_drawdown_percent'],
    ['maxOpenTrades', 'max_open_trades'],
    ['basketLimit', 'basket_limit'],
    ['profitLockEnabled', 'profit_lock_enabled'],
    ['profitLockPercent', 'profit_lock_percent'],
    ['goldEngineEnabled', 'gold_engine_enabled'],
  ];

  for (const [key, column] of map) {
    if (patch[key] !== undefined) {
      fields.push(`${column} = $${index++}`);
      values.push(patch[key]);
    }
  }

  fields.push('updated_at = now()');
  values.push(userId);

  await queryPostgres(
    `UPDATE platform_user_trading_config SET ${fields.join(', ')} WHERE user_id = $${index}`,
    values,
  );
  return getTradingConfig(userId);
}

export async function insertAuditLog(input: {
  actorUserId?: string | null;
  targetUserId?: string | null;
  category: string;
  action: string;
  detail?: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<void> {
  await ensurePlatformAuthTables();
  await queryPostgres(
    `INSERT INTO platform_audit_log (actor_user_id, target_user_id, category, action, detail, ip_address)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      input.actorUserId ?? null,
      input.targetUserId ?? null,
      input.category,
      input.action,
      JSON.stringify(input.detail ?? {}),
      input.ipAddress ?? null,
    ],
  );
}

export async function listAuditLog(limit = 100): Promise<PlatformAuditEntry[]> {
  await ensurePlatformAuthTables();
  const result = await queryPostgres(
    `SELECT a.*, actor.email AS actor_email, target.email AS target_email
     FROM platform_audit_log a
     LEFT JOIN platform_users actor ON actor.id = a.actor_user_id
     LEFT JOIN platform_users target ON target.id = a.target_user_id
     ORDER BY a.created_at DESC
     LIMIT $1`,
    [limit],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    actorEmail: row.actor_email ? String(row.actor_email) : null,
    targetUserId: row.target_user_id ? String(row.target_user_id) : null,
    targetEmail: row.target_email ? String(row.target_email) : null,
    category: String(row.category),
    action: String(row.action),
    detail: (row.detail ?? {}) as Record<string, unknown>,
    ipAddress: row.ip_address ? String(row.ip_address) : null,
    createdAt: toIso(row.created_at as Date | string) ?? new Date().toISOString(),
  }));
}

export async function getAdminOverview(): Promise<PlatformAdminOverview> {
  await ensurePlatformAuthTables();
  const users = await listPlatformUsers();
  const mt5Rows = await queryPostgres('SELECT user_id, connection_status, account_number, broker_name FROM platform_user_mt5_config');
  const tradingRows = await queryPostgres('SELECT user_id, trading_enabled, gold_engine_enabled FROM platform_user_trading_config');

  const mt5Map = new Map(mt5Rows.rows.map((r) => [String(r.user_id), r]));
  const tradingMap = new Map(tradingRows.rows.map((r) => [String(r.user_id), r]));

  const userSummaries = users.map((user) => {
    const mt5 = mt5Map.get(user.id);
    const trading = tradingMap.get(user.id);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      isSystemProtected: user.isSystemProtected,
      mt5Connected: String(mt5?.connection_status ?? '') === 'connected',
      tradingEnabled: Boolean(trading?.trading_enabled),
      goldEngineEnabled: Boolean(trading?.gold_engine_enabled),
      accountNumber: mt5?.account_number ? String(mt5.account_number) : null,
      brokerName: mt5?.broker_name ? String(mt5.broker_name) : null,
    };
  });

  return {
    totalUsers: users.length,
    activeUsers: users.filter((u) => u.status === 'active').length,
    connectedMt5: userSummaries.filter((u) => u.mt5Connected).length,
    tradingEnginesActive: userSummaries.filter((u) => u.goldEngineEnabled).length,
    activeBaskets: 0,
    dailyPnl: 0,
    riskExposure: userSummaries.filter((u) => u.tradingEnabled).length,
    users: userSummaries,
  };
}

export async function createPasswordReset(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
  await ensurePlatformAuthTables();
  await queryPostgres(
    `INSERT INTO platform_password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
}

export async function consumePasswordReset(tokenHash: string): Promise<string | null> {
  await ensurePlatformAuthTables();
  const result = await queryPostgres(
    `UPDATE platform_password_resets
     SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [tokenHash],
  );
  const userId = result.rows[0]?.user_id;
  return userId ? String(userId) : null;
}

export async function createSession(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await ensurePlatformAuthTables();
  await queryPostgres(
    `INSERT INTO platform_user_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.userId, input.tokenHash, input.expiresAt, input.ipAddress ?? null, input.userAgent ?? null],
  );
}

export async function getSessionUserId(tokenHash: string): Promise<string | null> {
  await ensurePlatformAuthTables();
  const result = await queryPostgres(
    `SELECT user_id FROM platform_user_sessions
     WHERE token_hash = $1 AND expires_at > now()
     LIMIT 1`,
    [tokenHash],
  );
  const userId = result.rows[0]?.user_id;
  return userId ? String(userId) : null;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await ensurePlatformAuthTables();
  await queryPostgres('DELETE FROM platform_user_sessions WHERE token_hash = $1', [tokenHash]);
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await ensurePlatformAuthTables();
  await queryPostgres('DELETE FROM platform_user_sessions WHERE user_id = $1', [userId]);
}
