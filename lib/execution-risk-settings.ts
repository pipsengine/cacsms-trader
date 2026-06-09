import { queryPostgres } from '@/lib/postgres';

export const EXECUTION_RISK_DAILY_TRADE_LIMIT_ENABLED_KEY = 'execution_risk_daily_trade_limit_enabled';
export const EXECUTION_RISK_MAX_TRADES_PER_DAY_KEY = 'execution_risk_max_trades_per_day';

export type ExecutionRiskSettings = {
  dailyTradeLimitEnabled: boolean;
  maxTradesPerDay: number;
  envDailyTradeLimitEnabled: boolean;
  envMaxTradesPerDay: number;
  tradesOpenedToday: number;
  remainingTradesToday: number | null;
  updatedAt: string | null;
  source: {
    dailyTradeLimitEnabled: 'database' | 'environment';
    maxTradesPerDay: 'database' | 'environment';
  };
};

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envBool(name: string, fallback = false): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

async function readSetting(key: string): Promise<{ value: string; updatedAt: string | null }> {
  try {
    const result = await queryPostgres(
      `
        SELECT value, updated_at::text AS updated_at
        FROM mt5_bridge_settings
        WHERE key = $1
        LIMIT 1
      `,
      [key],
    );
    const row = result.rows[0] as { value?: string; updated_at?: string } | undefined;
    return {
      value: String(row?.value ?? '').trim(),
      updatedAt: row?.updated_at ?? null,
    };
  } catch {
    return { value: '', updatedAt: null };
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  await queryPostgres(
    `
      INSERT INTO mt5_bridge_settings (key, value, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
    `,
    [key, value],
  );
}

async function countTradesOpenedToday(): Promise<number> {
  try {
    const result = await queryPostgres(
      `
        SELECT COUNT(*)::int AS count
        FROM execution_commands
        WHERE lifecycle_state = 'EXECUTED'
          AND upper(replace(type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')
          AND created_at >= date_trunc('day', now())
      `,
    );
    return Number((result.rows[0] as { count?: number })?.count ?? 0);
  } catch {
    return 0;
  }
}

function clampMaxTrades(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(999, Math.max(1, Math.round(value)));
}

export async function getExecutionRiskSettings(): Promise<ExecutionRiskSettings> {
  const [enabledSetting, maxSetting, tradesOpenedToday] = await Promise.all([
    readSetting(EXECUTION_RISK_DAILY_TRADE_LIMIT_ENABLED_KEY),
    readSetting(EXECUTION_RISK_MAX_TRADES_PER_DAY_KEY),
    countTradesOpenedToday(),
  ]);

  const envDailyTradeLimitEnabled = envBool('RISK_DAILY_TRADE_LIMIT_ENABLED', false);
  const envMaxTradesPerDay = clampMaxTrades(envNumber('RISK_MAX_TRADES_PER_DAY', 5));

  const hasDbEnabled = enabledSetting.value !== '';
  const hasDbMax = maxSetting.value !== '';

  const dailyTradeLimitEnabled = hasDbEnabled ? enabledSetting.value === 'true' : envDailyTradeLimitEnabled;
  const maxTradesPerDay = hasDbMax ? clampMaxTrades(Number(maxSetting.value)) : envMaxTradesPerDay;

  return {
    dailyTradeLimitEnabled,
    maxTradesPerDay,
    envDailyTradeLimitEnabled,
    envMaxTradesPerDay,
    tradesOpenedToday,
    remainingTradesToday: dailyTradeLimitEnabled
      ? Math.max(0, maxTradesPerDay - tradesOpenedToday)
      : null,
    updatedAt: maxSetting.updatedAt ?? enabledSetting.updatedAt,
    source: {
      dailyTradeLimitEnabled: hasDbEnabled ? 'database' : 'environment',
      maxTradesPerDay: hasDbMax ? 'database' : 'environment',
    },
  };
}

export async function updateExecutionRiskSettings(input: {
  dailyTradeLimitEnabled?: boolean;
  maxTradesPerDay?: number;
}): Promise<ExecutionRiskSettings> {
  if (typeof input.dailyTradeLimitEnabled === 'boolean') {
    await writeSetting(
      EXECUTION_RISK_DAILY_TRADE_LIMIT_ENABLED_KEY,
      input.dailyTradeLimitEnabled ? 'true' : 'false',
    );
  }

  if (input.maxTradesPerDay != null) {
    await writeSetting(
      EXECUTION_RISK_MAX_TRADES_PER_DAY_KEY,
      String(clampMaxTrades(input.maxTradesPerDay)),
    );
  }

  return getExecutionRiskSettings();
}
