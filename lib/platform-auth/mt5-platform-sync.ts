import { queryPostgres } from '@/lib/postgres';
import { ensurePlatformAuthTables } from '@/lib/platform-auth/store';
import { GLOBAL_SUPER_ADMIN_ID } from '@/lib/platform-auth/global-super-admin';

type HeartbeatPayload = {
  terminalId?: string | null;
  accountNumber?: string | null;
  symbol?: string | null;
};

async function resolveUserForHeartbeat(terminalId: string, accountNumber: string): Promise<{
  userId: string;
  tradingAccountId: string | null;
}> {
  if (terminalId) {
    const byTerminal = await queryPostgres(
      `SELECT id, user_id FROM platform_trading_account_links
       WHERE terminal_id = $1 ORDER BY is_primary DESC, updated_at DESC LIMIT 1`,
      [terminalId],
    ).catch(() => ({ rows: [] as Array<{ id: string; user_id: string }> }));
    if (byTerminal.rows[0]) {
      return { userId: String(byTerminal.rows[0].user_id), tradingAccountId: String(byTerminal.rows[0].id) };
    }
  }

  if (accountNumber) {
    const byAccount = await queryPostgres(
      `SELECT id, user_id FROM platform_trading_account_links
       WHERE account_number = $1 ORDER BY is_primary DESC, updated_at DESC LIMIT 1`,
      [accountNumber],
    ).catch(() => ({ rows: [] as Array<{ id: string; user_id: string }> }));
    if (byAccount.rows[0]) {
      return { userId: String(byAccount.rows[0].user_id), tradingAccountId: String(byAccount.rows[0].id) };
    }

    const mt5Config = await queryPostgres(
      'SELECT user_id FROM platform_user_mt5_config WHERE account_number = $1 LIMIT 1',
      [accountNumber],
    ).catch(() => ({ rows: [] as Array<{ user_id: string }> }));
    if (mt5Config.rows[0]) {
      return { userId: String(mt5Config.rows[0].user_id), tradingAccountId: null };
    }
  }

  return { userId: GLOBAL_SUPER_ADMIN_ID, tradingAccountId: null };
}

export async function syncPlatformMt5FromHeartbeat(payload: HeartbeatPayload): Promise<void> {
  const terminalId = String(payload.terminalId ?? '').trim();
  const accountNumber = String(payload.accountNumber ?? '').trim();
  if (!terminalId && !accountNumber) return;

  await ensurePlatformAuthTables();
  const { userId, tradingAccountId } = await resolveUserForHeartbeat(terminalId, accountNumber);
  const status = 'connected';
  const symbol = String(payload.symbol ?? 'XAUUSD').trim() || 'XAUUSD';

  if (terminalId) {
    await queryPostgres(
      `INSERT INTO platform_ea_instances (
         user_id, trading_account_id, terminal_id, symbol, ea_name, status, last_heartbeat_at
       ) VALUES ($1, $2, $3, $4, 'CacsmsTraderEA', $5, now())
       ON CONFLICT (user_id, terminal_id) DO UPDATE SET
         status = EXCLUDED.status,
         last_heartbeat_at = now(),
         updated_at = now(),
         trading_account_id = COALESCE(EXCLUDED.trading_account_id, platform_ea_instances.trading_account_id),
         symbol = EXCLUDED.symbol`,
      [userId, tradingAccountId, terminalId, symbol, status],
    ).catch(() => undefined);
  }

  await queryPostgres(
    `UPDATE platform_user_mt5_config
     SET connection_status = $2, terminal_id = COALESCE($3, terminal_id), updated_at = now()
     WHERE user_id = $1`,
    [userId, status, terminalId || null],
  ).catch(() => undefined);

  if (accountNumber || terminalId) {
    await queryPostgres(
      `UPDATE platform_trading_account_links
       SET connection_status = $2,
           terminal_id = COALESCE($3, terminal_id),
           updated_at = now()
       WHERE user_id = $1
         AND ($4 = '' OR account_number = $4 OR terminal_id = $3)`,
      [userId, status, terminalId || null, accountNumber],
    ).catch(() => undefined);
  }
}

export async function resolvePlatformMt5Password(userId: string): Promise<string | null> {
  const { decryptSecret } = await import('@/lib/platform-auth/crypto');
  const result = await queryPostgres(
    'SELECT mt5_password_encrypted FROM platform_user_mt5_config WHERE user_id = $1 LIMIT 1',
    [userId],
  ).catch(() => ({ rows: [] as Array<{ mt5_password_encrypted: string | null }> }));

  const encrypted = result.rows[0]?.mt5_password_encrypted;
  if (!encrypted) return null;
  try {
    return decryptSecret(userId, String(encrypted));
  } catch {
    return null;
  }
}
