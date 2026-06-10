import {
  computeMaxTradesPerDayFromSymbols,
  isContinuousTradingEnabled,
  isSymbolBasedTradeLimitEnabled,
  loadPropFirmRiskRulesFromEnv,
  resolveActiveTradingSymbolCount,
  resolveExecutionRiskLimits,
  resolveLiveOpenPositionCount,
} from '@/lib/execution-risk-limits';
import { queryPostgres } from '@/lib/postgres';

export const EXECUTION_RISK_DAILY_TRADE_LIMIT_ENABLED_KEY = 'execution_risk_daily_trade_limit_enabled';
export const EXECUTION_RISK_MAX_TRADES_PER_DAY_KEY = 'execution_risk_max_trades_per_day';
export const EXECUTION_RISK_TRADES_PER_SYMBOL_KEY = 'execution_risk_trades_per_symbol_per_day';

export type ExecutionRiskSettings = {
  dailyTradeLimitEnabled: boolean;
  maxTradesPerDay: number;
  tradesPerSymbolPerDay: number;
  symbolBasedTradeLimit: boolean;
  activeSymbolCount: number;
  activeSymbols: string[];
  maxOpenPositions: number;
  openPositions: number;
  remainingOpenPositions: number;
  remainingTradesToday: number | null;
  envDailyTradeLimitEnabled: boolean;
  envMaxTradesPerDay: number;
  tradesOpenedToday: number;
  openExposureDrawdownFraction: number;
  dailyDrawdownBudgetUsd: number;
  openExposureBudgetUsd: number;
  riskPerPositionUsd: number;
  propFirmReferenceEquity: number;
  propFirmSizingEquity: number;
  remainingDailyLossAmount: number;
  continuousTradingEnabled: boolean;
  updatedAt: string | null;
  source: {
    dailyTradeLimitEnabled: 'database' | 'environment';
    maxTradesPerDay: 'computed' | 'database' | 'environment';
    maxOpenPositions: 'drawdown_budget';
    tradesPerSymbolPerDay: 'database' | 'environment';
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

async function loadApproximateRiskState() {
  const rules = loadPropFirmRiskRulesFromEnv();
  let equity = 0;
  let balance = 0;
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787'}/terminals`, {
      cache: 'no-store',
    });
    if (response.ok) {
      const payload = await response.json();
      const terminals = Array.isArray(payload.terminals) ? payload.terminals : [];
      for (const terminal of terminals) {
        equity += Number(terminal.equity ?? 0);
        balance += Number(terminal.balance ?? terminal.equity ?? 0);
      }
    }
  } catch {
    // use database fallback below
  }
  if (equity <= 0) {
    try {
      const result = await queryPostgres(`SELECT COALESCE(SUM(equity), 0) AS equity, COALESCE(SUM(balance), 0) AS balance FROM trading_accounts`);
      equity = Number((result.rows[0] as { equity?: number })?.equity ?? 0);
      balance = Number((result.rows[0] as { balance?: number })?.balance ?? equity);
    } catch {
      equity = 6000;
      balance = 6000;
    }
  }
  const openTrades = await resolveLiveOpenPositionCount();
  const tradesOpenedToday = await countTradesOpenedToday();
  return {
    startingEquityToday: equity,
    currentEquity: equity,
    peakEquityAllTime: equity,
    currentBalance: balance,
    tradesOpenedToday,
    openTrades,
    consecutiveLosses: 0,
    monthlyProfitPercent: 0,
    killSwitchActive: false,
    highImpactNewsBlocked: false,
  };
}

async function ensureContinuousRiskSettingsAligned(
  enabledSetting: { value: string },
): Promise<void> {
  if (!isContinuousTradingEnabled()) return;
  if (enabledSetting.value !== 'true') return;
  await writeSetting(EXECUTION_RISK_DAILY_TRADE_LIMIT_ENABLED_KEY, 'false');
}

export async function getExecutionRiskSettings(): Promise<ExecutionRiskSettings> {
  const [enabledSetting, maxSetting, perSymbolSetting, tradesOpenedToday, symbolUniverse] = await Promise.all([
    readSetting(EXECUTION_RISK_DAILY_TRADE_LIMIT_ENABLED_KEY),
    readSetting(EXECUTION_RISK_MAX_TRADES_PER_DAY_KEY),
    readSetting(EXECUTION_RISK_TRADES_PER_SYMBOL_KEY),
    countTradesOpenedToday(),
    resolveActiveTradingSymbolCount(),
  ]);

  await ensureContinuousRiskSettingsAligned(enabledSetting);

  const envDailyTradeLimitEnabled = envBool('RISK_DAILY_TRADE_LIMIT_ENABLED', false);
  const envMaxTradesPerDay = clampMaxTrades(envNumber('RISK_MAX_TRADES_PER_DAY', 5));
  const envTradesPerSymbol = Math.max(1, Math.round(envNumber('RISK_TRADES_PER_SYMBOL_PER_DAY', 1)));
  const symbolBasedTradeLimit = isSymbolBasedTradeLimitEnabled();

  const hasDbEnabled = enabledSetting.value !== '';
  const hasDbMax = maxSetting.value !== '';
  const hasDbPerSymbol = perSymbolSetting.value !== '';

  const storedDailyTradeLimitEnabled = hasDbEnabled ? enabledSetting.value === 'true' : envDailyTradeLimitEnabled;
  const continuousTradingEnabled = isContinuousTradingEnabled();
  const dailyTradeLimitEnabled = continuousTradingEnabled ? false : storedDailyTradeLimitEnabled;
  const tradesPerSymbolPerDay = hasDbPerSymbol
    ? Math.max(1, Math.round(Number(perSymbolSetting.value)))
    : envTradesPerSymbol;
  const manualMaxTradesPerDay = hasDbMax ? clampMaxTrades(Number(maxSetting.value)) : envMaxTradesPerDay;
  const computedMaxTradesPerDay = computeMaxTradesPerDayFromSymbols(symbolUniverse.count, tradesPerSymbolPerDay);
  const maxTradesPerDay = symbolBasedTradeLimit ? computedMaxTradesPerDay : manualMaxTradesPerDay;

  const rules = loadPropFirmRiskRulesFromEnv();
  const state = await loadApproximateRiskState();
  state.tradesOpenedToday = tradesOpenedToday;
  const limits = await resolveExecutionRiskLimits(
    { ...rules, dailyTradeLimitEnabled, maxTradesPerDay },
    state,
  );

  return {
    dailyTradeLimitEnabled,
    maxTradesPerDay: limits.maxTradesPerDay,
    tradesPerSymbolPerDay: limits.tradesPerSymbolPerDay,
    symbolBasedTradeLimit: limits.symbolBasedTradeLimit,
    activeSymbolCount: limits.activeSymbolCount,
    activeSymbols: limits.activeSymbols,
    maxOpenPositions: limits.maxOpenPositions,
    openPositions: limits.openPositions,
    remainingOpenPositions: limits.remainingOpenPositions,
    envDailyTradeLimitEnabled,
    envMaxTradesPerDay,
    tradesOpenedToday,
    remainingTradesToday: dailyTradeLimitEnabled
      ? Math.max(0, limits.maxTradesPerDay - tradesOpenedToday)
      : null,
    openExposureDrawdownFraction: limits.openExposureDrawdownFraction,
    dailyDrawdownBudgetUsd: limits.dailyDrawdownBudgetUsd,
    openExposureBudgetUsd: limits.openExposureBudgetUsd,
    riskPerPositionUsd: limits.riskPerPositionUsd,
    propFirmReferenceEquity: limits.propFirmReferenceEquity,
    propFirmSizingEquity: limits.propFirmSizingEquity,
    remainingDailyLossAmount: limits.remainingDailyLossAmount,
    continuousTradingEnabled: limits.continuousTradingEnabled || continuousTradingEnabled,
    updatedAt: perSymbolSetting.updatedAt ?? maxSetting.updatedAt ?? enabledSetting.updatedAt,
    source: {
      dailyTradeLimitEnabled: hasDbEnabled ? 'database' : 'environment',
      maxTradesPerDay: symbolBasedTradeLimit ? 'computed' : hasDbMax ? 'database' : 'environment',
      maxOpenPositions: 'drawdown_budget',
      tradesPerSymbolPerDay: hasDbPerSymbol ? 'database' : 'environment',
    },
  };
}

export async function updateExecutionRiskSettings(input: {
  dailyTradeLimitEnabled?: boolean;
  maxTradesPerDay?: number;
  tradesPerSymbolPerDay?: number;
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

  if (input.tradesPerSymbolPerDay != null) {
    await writeSetting(
      EXECUTION_RISK_TRADES_PER_SYMBOL_KEY,
      String(Math.max(1, Math.min(20, Math.round(input.tradesPerSymbolPerDay)))),
    );
  }

  return getExecutionRiskSettings();
}
