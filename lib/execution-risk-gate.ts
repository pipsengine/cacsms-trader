import { evaluatePropFirmRisk } from '@/packages/risk-core';
import type { PropFirmRiskRules, RiskDecision, RiskState } from '@/packages/shared-types';
import { appendExecutionEvent } from '@/lib/execution-bridge-store';
import { isExecutionKillSwitchActive } from '@/lib/execution-kill-switch';
import {
  countTradesOpenedTodayForSymbol,
  isSymbolBasedTradeLimitEnabled,
  loadPropFirmRiskRulesFromEnv,
  resolveExecutionRiskLimits,
  resolveLiveOpenPositionCount,
} from '@/lib/execution-risk-limits';
import { getExecutionRiskSettings } from '@/lib/execution-risk-settings';
import { getOpenPositionSymbols } from '@/lib/open-position-symbols';
import { queryPostgres } from '@/lib/postgres';
import { hasValidStopTargets, isStopLossRequired } from '@/lib/autonomous-stop-targets';
import { findCorrelatedOpenSymbol } from '@/lib/symbol-correlation';

export class ExecutionRiskBlockedError extends Error {
  readonly decision: RiskDecision;
  readonly accountNumber: string;

  constructor(decision: RiskDecision, accountNumber: string) {
    super(decision.message);
    this.name = 'ExecutionRiskBlockedError';
    this.decision = decision;
    this.accountNumber = accountNumber;
  }
}

export function isExecutionRiskGatedCommandType(type: string): boolean {
  const normalized = String(type ?? '').trim().toUpperCase().replaceAll('-', '_');
  return normalized === 'PLACE_ORDER' || normalized === 'PLACEORDER';
}

export type ExecutionRiskGateInput = {
  terminalId: string;
  commandId?: string;
  intentId?: string;
  symbol?: string;
  side?: string;
  entryPrice?: number;
  requestedLots: number;
  rewardRiskRatio?: number;
  stopLoss?: number;
  takeProfit?: number;
  sandboxMode?: boolean;
  environment?: string;
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

export { loadPropFirmRiskRulesFromEnv } from '@/lib/execution-risk-limits';

export async function loadPropFirmRiskRules(): Promise<PropFirmRiskRules> {
  const base = loadPropFirmRiskRulesFromEnv();
  const settings = await getExecutionRiskSettings();
  return {
    ...base,
    dailyTradeLimitEnabled: settings.dailyTradeLimitEnabled,
    maxTradesPerDay: settings.maxTradesPerDay,
    maxOpenTrades: settings.maxOpenPositions,
  };
}

function resolveRewardRiskRatio(input: ExecutionRiskGateInput, rules: PropFirmRiskRules): number {
  if (Number.isFinite(input.rewardRiskRatio) && Number(input.rewardRiskRatio) > 0) {
    return Number(input.rewardRiskRatio);
  }

  const stopLoss = Number(input.stopLoss ?? 0);
  const takeProfit = Number(input.takeProfit ?? 0);
  if (stopLoss > 0 && takeProfit > 0) {
    return Number((takeProfit / stopLoss).toFixed(4));
  }

  if (!isStopLossRequired() && input.sandboxMode && stopLoss === 0 && takeProfit === 0) {
    return rules.minRewardRiskRatio;
  }

  return 0;
}

async function resolveAccountNumber(terminalId: string): Promise<string> {
  const fromTerminal = await queryPostgres(
    `SELECT account_number FROM mt5_terminals WHERE terminal_id = $1 LIMIT 1`,
    [terminalId],
  );
  const accountNumber = String(fromTerminal.rows[0]?.account_number ?? '').trim();
  if (accountNumber) return accountNumber;

  const fromBridge = await fetch(`${process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787'}/terminals`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) return '';
    const payload = await response.json().catch(() => ({}));
    const terminal = (Array.isArray((payload as any)?.terminals) ? (payload as any).terminals : []).find(
      (row: any) => String(row?.terminalId ?? '') === terminalId,
    );
    return String(terminal?.accountNumber ?? '').trim();
  }).catch(() => '');

  if (!fromBridge) {
    throw new Error(`Unable to resolve account number for terminal ${terminalId}.`);
  }
  return fromBridge;
}

async function loadRiskState(accountNumber: string): Promise<RiskState> {
  const accountResult = await queryPostgres(
    `
      SELECT
        balance,
        equity,
        starting_equity_today,
        peak_equity_all_time,
        open_trade_count
      FROM trading_accounts
      WHERE account_number = $1
      LIMIT 1
    `,
    [accountNumber],
  );
  const account = accountResult.rows[0] as {
    balance?: string | number;
    equity?: string | number;
    starting_equity_today?: string | number;
    peak_equity_all_time?: string | number;
    open_trade_count?: number;
  } | undefined;

  const equity = Number(account?.equity ?? 0);
  const balance = Number(account?.balance ?? equity);
  const startingEquityToday = Number(account?.starting_equity_today ?? equity);
  const peakEquityAllTime = Math.max(Number(account?.peak_equity_all_time ?? equity), equity);

  const tradesTodayResult = await queryPostgres(
    `
      SELECT COUNT(*)::int AS count
      FROM execution_commands c
      JOIN mt5_terminals t ON t.terminal_id = c.terminal_id
      WHERE t.account_number = $1
        AND c.lifecycle_state = 'EXECUTED'
        AND c.created_at >= date_trunc('day', now())
    `,
    [accountNumber],
  );
  const tradesOpenedToday = Number((tradesTodayResult.rows[0] as { count?: number })?.count ?? 0);
  const liveOpenTrades = await resolveLiveOpenPositionCount();
  const consecutiveLosses = await countConsecutiveLosses(accountNumber);

  return {
    startingEquityToday: startingEquityToday > 0 ? startingEquityToday : equity,
    currentEquity: equity,
    peakEquityAllTime: peakEquityAllTime > 0 ? peakEquityAllTime : equity,
    currentBalance: balance,
    tradesOpenedToday,
    openTrades: Math.max(Number(account?.open_trade_count ?? 0), liveOpenTrades),
    consecutiveLosses,
    monthlyProfitPercent: 0,
    killSwitchActive: (await isExecutionKillSwitchActive()) || envBool('CACSMS_KILL_SWITCH', false),
    highImpactNewsBlocked: envBool('CACSMS_NEWS_BLACKOUT', false),
  };
}

async function countConsecutiveLosses(accountNumber: string): Promise<number> {
  const closedTrades = await queryPostgres(
    `
      SELECT p.profit_loss
      FROM execution_open_positions p
      JOIN mt5_terminals t ON t.terminal_id = p.terminal_id
      WHERE t.account_number = $1
        AND p.status = 'closed'
        AND p.closed_at IS NOT NULL
      ORDER BY p.closed_at DESC
      LIMIT 10
    `,
    [accountNumber],
  );

  if (closedTrades.rows.length > 0) {
    let losses = 0;
    for (const row of closedTrades.rows as Array<{ profit_loss?: number }>) {
      const pnl = Number(row.profit_loss ?? 0);
      if (pnl < -0.01) {
        losses += 1;
        continue;
      }
      break;
    }
    return losses;
  }

  return 0;
}

async function persistRiskDecision(input: {
  accountNumber: string;
  intentId?: string;
  decision: RiskDecision;
}): Promise<void> {
  await queryPostgres(
    `
      INSERT INTO risk_decisions (
        account_number,
        intent_id,
        allowed,
        code,
        message,
        remaining_daily_loss_amount
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      input.accountNumber,
      input.intentId ?? null,
      input.decision.allowed,
      input.decision.code,
      input.decision.message,
      input.decision.remainingDailyLossAmount,
    ],
  ).catch(() => null);
}

export async function evaluateExecutionRiskGate(input: ExecutionRiskGateInput): Promise<{
  decision: RiskDecision;
  accountNumber: string;
  rules: PropFirmRiskRules;
  state: RiskState;
  rewardRiskRatio: number;
}> {
  const rules = await loadPropFirmRiskRules();
  const accountNumber = await resolveAccountNumber(input.terminalId);
  const state = await loadRiskState(accountNumber);
  const limits = await resolveExecutionRiskLimits(rules, state);
  const rewardRiskRatio = resolveRewardRiskRatio(input, rules);
  const symbol = String(input.symbol ?? '').trim().toUpperCase();
  const tradesOpenedTodayForSymbol = symbol
    ? await countTradesOpenedTodayForSymbol(symbol, accountNumber)
    : 0;

  const side = String(input.side ?? '').trim().toUpperCase();
  const stopLoss = Number(input.stopLoss ?? 0);
  const takeProfit = Number(input.takeProfit ?? 0);
  const entryPrice = Number(input.entryPrice ?? 0);

  const evaluateBaseRisk = () => evaluatePropFirmRisk({
    rules,
    state,
    requestedLots: input.requestedLots,
    rewardRiskRatio,
    symbol: symbol || undefined,
    tradesOpenedTodayForSymbol,
    tradesPerSymbolPerDay: isSymbolBasedTradeLimitEnabled() && !limits.continuousTradingEnabled
      ? limits.tradesPerSymbolPerDay
      : undefined,
    maxOpenTradesOverride: limits.maxOpenPositions,
    maxTradesPerDayOverride: limits.maxTradesPerDay,
    continuousTradingEnabled: limits.continuousTradingEnabled,
  });

  const isExecutableSide = side === 'BUY' || side === 'SELL';
  let decision: RiskDecision | undefined;
  if (symbol) {
    if (!isExecutableSide) {
      decision = {
        allowed: true,
        code: 'signal_not_actionable',
        message: `No trade required for ${side || 'non-executable'} signal; risk gate cleared.`,
        remainingDailyLossAmount: limits.remainingDailyLossAmount,
      };
    }
    const openSymbols = await getOpenPositionSymbols();
    const correlatedWith = findCorrelatedOpenSymbol(symbol, openSymbols, { excludeSameSymbol: true });
    if (!decision && correlatedWith) {
      decision = {
        allowed: false,
        code: 'correlation_protection',
        message: `${symbol} blocked — shares currency exposure with open ${correlatedWith}`,
        remainingDailyLossAmount: 0,
      };
    } else if (!decision && isStopLossRequired() && isExecutableSide && stopLoss <= 0) {
      decision = {
        allowed: false,
        code: 'stop_loss_required',
        message: `${symbol} blocked — every trade must include a stop loss.`,
        remainingDailyLossAmount: 0,
      };
    } else if (
      !decision
      &&
      isStopLossRequired()
      && (side === 'BUY' || side === 'SELL')
      && entryPrice > 0
      && !hasValidStopTargets({ side, entryPrice, stopLoss, takeProfit })
    ) {
      decision = {
        allowed: false,
        code: 'invalid_stop_loss',
        message: `${symbol} blocked — stop loss / take profit are invalid for ${side}.`,
        remainingDailyLossAmount: 0,
      };
    } else if (!decision) {
      decision = evaluateBaseRisk();
    }
  } else {
    decision = evaluateBaseRisk();
  }
  if (!decision) {
    decision = evaluateBaseRisk();
  }

  await persistRiskDecision({
    accountNumber,
    intentId: input.intentId ?? input.commandId,
    decision,
  });

  if (input.commandId) {
    await appendExecutionEvent({
      commandId: input.commandId,
      terminalId: input.terminalId,
      lifecycleState: decision.allowed ? 'QUEUED' : 'CANCELLED',
      eventType: decision.allowed ? 'RISK_APPROVED' : 'RISK_BLOCKED',
      severity: decision.allowed ? 'INFO' : 'WARNING',
      message: decision.message,
      payload: {
        code: decision.code,
        remainingDailyLossAmount: decision.remainingDailyLossAmount,
        requestedLots: input.requestedLots,
        rewardRiskRatio,
        sandboxMode: Boolean(input.sandboxMode),
        environment: input.environment ?? 'DEMO',
      },
    }).catch(() => null);
  }

  return { decision, accountNumber, rules, state, rewardRiskRatio };
}

export async function assertExecutionRiskGate(input: ExecutionRiskGateInput): Promise<RiskDecision> {
  const result = await evaluateExecutionRiskGate(input);
  if (!result.decision.allowed) {
    throw new ExecutionRiskBlockedError(result.decision, result.accountNumber);
  }
  return result.decision;
}
