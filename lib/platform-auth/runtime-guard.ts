import { GLOBAL_SUPER_ADMIN_ID } from '@/lib/platform-auth/global-super-admin';
import { isPlatformTradingEnabledForUser, resolvePlatformTradingContext } from '@/lib/platform-auth/trading-context';
import { queryPostgres } from '@/lib/postgres';

export const CONTINUOUS_TRADING_USER_ID_KEY = 'continuous_trading_session_user_id';

async function readSetting(key: string): Promise<string> {
  try {
    const result = await queryPostgres(
      'SELECT value FROM mt5_bridge_settings WHERE key = $1 LIMIT 1',
      [key],
    );
    return String(result.rows[0]?.value ?? '').trim();
  } catch {
    return '';
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  await queryPostgres(
    `INSERT INTO mt5_bridge_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

export async function setContinuousTradingUserId(userId: string | null): Promise<void> {
  await writeSetting(CONTINUOUS_TRADING_USER_ID_KEY, userId ?? '');
}

export async function getContinuousTradingUserId(): Promise<string | null> {
  const value = await readSetting(CONTINUOUS_TRADING_USER_ID_KEY);
  return value || null;
}

export async function resolveRuntimeTradingUserId(): Promise<string> {
  const scoped = await getContinuousTradingUserId();
  if (scoped) return scoped;
  return GLOBAL_SUPER_ADMIN_ID;
}

export type RuntimeTradingGuardResult = {
  allowed: boolean;
  userId: string;
  reason?: string;
};

export async function evaluateRuntimeTradingGuard(): Promise<RuntimeTradingGuardResult> {
  const userId = await resolveRuntimeTradingUserId();
  const enabled = await isPlatformTradingEnabledForUser(userId);
  if (!enabled) {
    const context = await resolvePlatformTradingContext(userId);
    const reason = !context
      ? 'No active platform trading context for the continuous session operator.'
      : !context.trading.tradingEnabled
        ? 'Trading is disabled for the continuous session operator.'
        : 'Gold engine is disabled for the continuous session operator.';
    return { allowed: false, userId, reason };
  }
  return { allowed: true, userId };
}

export async function assertRuntimeTradingAllowed(): Promise<RuntimeTradingGuardResult> {
  return evaluateRuntimeTradingGuard();
}
