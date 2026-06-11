import { getRemainingDailyLossAmount } from '@/packages/risk-core';
import type { PropFirmRiskRules, RiskState } from '@/packages/shared-types';

import { getOpenPositionMetrics } from './execution-open-positions';
import { SYSTEM_FOCUS_SYMBOL_COUNT } from './focus-symbols';
import { getLatestPairSelection } from './pair-selector';
import { queryPostgres } from './postgres';

export function loadPropFirmRiskRulesFromEnv(): PropFirmRiskRules {
  const minRewardRiskRatio = envNumber('RISK_MIN_REWARD_RISK_RATIO', 2);
  return {
    dailyDrawdownPercent: envNumber('RISK_DAILY_DRAWDOWN_PERCENT', 4),
    maxDrawdownPercent: envNumber('RISK_MAX_DRAWDOWN_PERCENT', 8),
    riskPerTradePercent: envNumber('RISK_PER_TRADE_PERCENT', 0.5),
    dailyTradeLimitEnabled: envBool('RISK_DAILY_TRADE_LIMIT_ENABLED', false),
    maxTradesPerDay: envNumber('RISK_MAX_TRADES_PER_DAY', 5),
    maxOpenTrades: envNumber('RISK_MAX_OPEN_TRADES', 3),
    maxLotSize: envNumber('RISK_MAX_LOT_SIZE', 1),
    maxCurrencyExposurePercent: envNumber('RISK_MAX_CURRENCY_EXPOSURE_PERCENT', 100),
    maxCorrelatedExposurePercent: envNumber('RISK_MAX_CORRELATED_EXPOSURE_PERCENT', 100),
    minRewardRiskRatio,
    stopAfterConsecutiveLosses: envNumber('RISK_STOP_AFTER_CONSECUTIVE_LOSSES', 2),
    stopTradingAfterDailyTargetHit: envBool('RISK_STOP_AFTER_DAILY_TARGET_HIT', false),
    monthlyProfitTargetPercent: envNumber('RISK_MONTHLY_PROFIT_TARGET_PERCENT', 100),
    newsBlackoutMinutesBefore: envNumber('RISK_NEWS_BLACKOUT_MINUTES_BEFORE', 0),
    newsBlackoutMinutesAfter: envNumber('RISK_NEWS_BLACKOUT_MINUTES_AFTER', 0),
  };
}

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

/** Trade continuously until daily drawdown is exhausted (skip overall DD / consecutive-loss / trade-count stops). */
export function isContinuousTradingEnabled(): boolean {
  return envBool('RISK_CONTINUOUS_TRADING_ENABLED', true);
}

/**
 * Prop-firm account size used for drawdown envelopes (e.g. $100k challenge).
 * Falls back to peak equity when unset.
 */
export function resolvePropFirmReferenceEquity(state: RiskState): number {
  const configured = envNumber('RISK_PROP_FIRM_REFERENCE_EQUITY', 0);
  if (configured > 0) return configured;
  return Math.max(state.peakEquityAllTime, state.startingEquityToday, state.currentEquity, 1);
}

/** Lot-sizing equity = reference × max overall drawdown % (prop-firm loss envelope). */
export function resolvePropFirmSizingEquity(state: RiskState, rules: PropFirmRiskRules): number {
  const reference = resolvePropFirmReferenceEquity(state);
  return reference * (rules.maxDrawdownPercent / 100);
}

/** Share of the daily drawdown budget allocated to concurrent open exposure (default 50%). */
export function getOpenExposureDrawdownFraction(): number {
  const value = envNumber('RISK_OPEN_EXPOSURE_DRAWDOWN_FRACTION', 0.5);
  return Math.min(1, Math.max(0.1, value));
}

export function getTradesPerSymbolPerDay(): number {
  return Math.max(1, Math.min(20, Math.round(envNumber('RISK_TRADES_PER_SYMBOL_PER_DAY', 1))));
}

export function isSymbolBasedTradeLimitEnabled(): boolean {
  if (isContinuousTradingEnabled()) return false;
  return envBool('RISK_SYMBOL_BASED_TRADE_LIMIT', true);
}

/**
 * Max concurrent open positions from 50% of the daily drawdown budget divided by risk-per-position.
 * Example: 4% daily DD on $6k = $240 → $120 open budget ÷ $30/trade (0.5%) = 4 slots.
 */
export function computeMaxOpenPositions(rules: PropFirmRiskRules, state: RiskState): number {
  const sizingEquity = resolvePropFirmSizingEquity(state, rules);
  const dailyLossBudget = state.startingEquityToday * (rules.dailyDrawdownPercent / 100);
  const openExposureBudget = dailyLossBudget * getOpenExposureDrawdownFraction();
  const riskPerPosition = sizingEquity * (rules.riskPerTradePercent / 100);
  const envCap = envNumber('RISK_MAX_OPEN_TRADES', 0);
  const computed = riskPerPosition > 0
    ? Math.floor(openExposureBudget / riskPerPosition)
    : 1;
  const resolved = Math.max(1, Math.min(50, computed));
  if (envCap > 0 && !isContinuousTradingEnabled()) return Math.min(resolved, envCap);
  return resolved;
}

export function computeMaxTradesPerDayFromSymbols(symbolCount: number, tradesPerSymbol = getTradesPerSymbolPerDay()): number {
  return Math.max(1, Math.round(Math.max(1, symbolCount) * tradesPerSymbol));
}

export async function resolveActiveTradingSymbolCount(): Promise<{
  count: number;
  symbols: string[];
  source: 'pair_selection' | 'autonomy_config' | 'focus_universe';
}> {
  try {
    const selection = await getLatestPairSelection();
    const qualified = (selection?.qualifiedSymbols ?? selection?.eligibleSymbols ?? [])
      .map((symbol) => symbol.toUpperCase())
      .filter(Boolean);
    if (qualified.length > 0) {
      return { count: qualified.length, symbols: qualified, source: 'pair_selection' };
    }
    const selected = (selection?.selectedSymbols ?? []).map((symbol) => symbol.toUpperCase()).filter(Boolean);
    if (selected.length > 0) {
      return { count: selected.length, symbols: selected, source: 'pair_selection' };
    }
  } catch {
    // fall through
  }

  try {
    const { getAutonomyConfig } = await import('./autonomy-store');
    const config = await getAutonomyConfig();
    const active = (config.activeSymbols ?? []).map((symbol) => symbol.toUpperCase()).filter(Boolean);
    if (active.length > 0) {
      return { count: active.length, symbols: active, source: 'autonomy_config' };
    }
  } catch {
    // fall through
  }

  return { count: SYSTEM_FOCUS_SYMBOL_COUNT, symbols: [], source: 'focus_universe' };
}

export async function countTradesOpenedTodayForSymbol(symbol: string, accountNumber?: string): Promise<number> {
  const normalized = symbol.toUpperCase();
  try {
    const params: Array<string> = [normalized];
    const accountFilter = accountNumber
      ? (params.push(accountNumber), `AND t.account_number = $2`)
      : '';
    const result = await queryPostgres(
      `
        SELECT COUNT(*)::int AS count
        FROM execution_commands c
        ${accountNumber ? 'JOIN mt5_terminals t ON t.terminal_id = c.terminal_id' : ''}
        WHERE upper(c.symbol) = $1
          AND c.lifecycle_state = 'EXECUTED'
          AND upper(replace(c.type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')
          AND c.created_at >= date_trunc('day', now())
          ${accountFilter}
      `,
      params,
    );
    return Number((result.rows[0] as { count?: number })?.count ?? 0);
  } catch {
    return 0;
  }
}

export async function countTradesOpenedTodayBySymbol(accountNumber?: string): Promise<Record<string, number>> {
  try {
    const params: string[] = [];
    const accountFilter = accountNumber
      ? (params.push(accountNumber), `AND t.account_number = $1`)
      : '';
    const result = await queryPostgres(
      `
        SELECT upper(c.symbol) AS symbol, COUNT(*)::int AS count
        FROM execution_commands c
        ${accountNumber ? 'JOIN mt5_terminals t ON t.terminal_id = c.terminal_id' : ''}
        WHERE c.lifecycle_state = 'EXECUTED'
          AND upper(replace(c.type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')
          AND c.symbol IS NOT NULL
          AND btrim(c.symbol) <> ''
          AND c.created_at >= date_trunc('day', now())
          ${accountFilter}
        GROUP BY upper(c.symbol)
      `,
      params,
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[String((row as { symbol?: string }).symbol ?? '').toUpperCase()] = Number((row as { count?: number }).count ?? 0);
    }
    return counts;
  } catch {
    return {};
  }
}

export async function resolveLiveOpenPositionCount(): Promise<number> {
  const metrics = await getOpenPositionMetrics().catch(() => ({
    trackedOpen: 0,
    terminalOpen: 0,
    openOrders: 0,
    positions: [],
  }));
  return Math.max(metrics.trackedOpen, metrics.terminalOpen, metrics.openOrders, metrics.positions.length);
}

export interface ResolvedExecutionRiskLimits {
  maxOpenPositions: number;
  openPositions: number;
  remainingOpenPositions: number;
  activeSymbolCount: number;
  activeSymbols: string[];
  symbolSource: 'pair_selection' | 'autonomy_config' | 'focus_universe';
  tradesPerSymbolPerDay: number;
  maxTradesPerDay: number;
  symbolBasedTradeLimit: boolean;
  openExposureDrawdownFraction: number;
  dailyDrawdownBudgetUsd: number;
  openExposureBudgetUsd: number;
  riskPerPositionUsd: number;
  propFirmReferenceEquity: number;
  propFirmSizingEquity: number;
  remainingDailyLossAmount: number;
  continuousTradingEnabled: boolean;
}

export async function resolveExecutionRiskLimits(
  rules: PropFirmRiskRules,
  state: RiskState,
): Promise<ResolvedExecutionRiskLimits> {
  const symbolUniverse = await resolveActiveTradingSymbolCount();
  const tradesPerSymbolPerDay = getTradesPerSymbolPerDay();
  const symbolBasedTradeLimit = isSymbolBasedTradeLimitEnabled();
  const referenceEquity = resolvePropFirmReferenceEquity(state);
  const sizingEquity = resolvePropFirmSizingEquity(state, rules);
  const dailyDrawdownBudgetUsd = state.startingEquityToday * (rules.dailyDrawdownPercent / 100);
  const openExposureBudgetUsd = dailyDrawdownBudgetUsd * getOpenExposureDrawdownFraction();
  const riskPerPositionUsd = sizingEquity * (rules.riskPerTradePercent / 100);
  const maxOpenPositions = computeMaxOpenPositions(rules, state);
  const openPositions = await resolveLiveOpenPositionCount();
  const maxTradesPerDay = symbolBasedTradeLimit
    ? computeMaxTradesPerDayFromSymbols(symbolUniverse.count, tradesPerSymbolPerDay)
    : rules.maxTradesPerDay;

  return {
    maxOpenPositions,
    openPositions,
    remainingOpenPositions: Math.max(0, maxOpenPositions - openPositions),
    activeSymbolCount: symbolUniverse.count,
    activeSymbols: symbolUniverse.symbols,
    symbolSource: symbolUniverse.source,
    tradesPerSymbolPerDay,
    maxTradesPerDay,
    symbolBasedTradeLimit,
    openExposureDrawdownFraction: getOpenExposureDrawdownFraction(),
    dailyDrawdownBudgetUsd: Number(dailyDrawdownBudgetUsd.toFixed(2)),
    openExposureBudgetUsd: Number(openExposureBudgetUsd.toFixed(2)),
    riskPerPositionUsd: Number(riskPerPositionUsd.toFixed(2)),
    propFirmReferenceEquity: Number(referenceEquity.toFixed(2)),
    propFirmSizingEquity: Number(sizingEquity.toFixed(2)),
    remainingDailyLossAmount: getRemainingDailyLossAmount(rules, state),
    continuousTradingEnabled: isContinuousTradingEnabled(),
  };
}
