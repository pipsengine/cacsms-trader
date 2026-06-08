import { evaluatePropFirmRisk } from '@/packages/risk-core';
import type { PropFirmRiskRules, RiskDecision, RiskState } from '@/packages/shared-types';
import { appendExecutionEvent } from '@/lib/execution-bridge-store';
import { queryPostgres } from '@/lib/postgres';

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

export function loadPropFirmRiskRulesFromEnv(): PropFirmRiskRules {
  const minRewardRiskRatio = envNumber('RISK_MIN_REWARD_RISK_RATIO', 2);
  return {
    dailyDrawdownPercent: envNumber('RISK_DAILY_DRAWDOWN_PERCENT', 4),
    maxDrawdownPercent: envNumber('RISK_MAX_DRAWDOWN_PERCENT', 8),
    riskPerTradePercent: envNumber('RISK_PER_TRADE_PERCENT', 0.5),
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

function resolveRewardRiskRatio(input: ExecutionRiskGateInput, rules: PropFirmRiskRules): number {
  if (Number.isFinite(input.rewardRiskRatio) && Number(input.rewardRiskRatio) > 0) {
    return Number(input.rewardRiskRatio);
  }

  const stopLoss = Number(input.stopLoss ?? 0);
  const takeProfit = Number(input.takeProfit ?? 0);
  if (stopLoss > 0 && takeProfit > 0) {
    return Number((takeProfit / stopLoss).toFixed(4));
  }

  if (input.sandboxMode && stopLoss === 0 && takeProfit === 0) {
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

  const consecutiveLosses = await countConsecutiveLosses(accountNumber);

  return {
    startingEquityToday: startingEquityToday > 0 ? startingEquityToday : equity,
    currentEquity: equity,
    peakEquityAllTime: peakEquityAllTime > 0 ? peakEquityAllTime : equity,
    currentBalance: balance,
    tradesOpenedToday,
    openTrades: Number(account?.open_trade_count ?? 0),
    consecutiveLosses,
    monthlyProfitPercent: 0,
    killSwitchActive: envBool('CACSMS_KILL_SWITCH', false),
    highImpactNewsBlocked: envBool('CACSMS_NEWS_BLACKOUT', false),
  };
}

async function countConsecutiveLosses(accountNumber: string): Promise<number> {
  const result = await queryPostgres(
    `
      SELECT c.lifecycle_state, c.ack_status
      FROM execution_commands c
      JOIN mt5_terminals t ON t.terminal_id = c.terminal_id
      WHERE t.account_number = $1
        AND c.lifecycle_state IN ('EXECUTED', 'FAILED', 'TIMEOUT', 'CANCELLED')
      ORDER BY c.created_at DESC
      LIMIT 10
    `,
    [accountNumber],
  );

  let losses = 0;
  for (const row of result.rows as Array<{ lifecycle_state?: string; ack_status?: string }>) {
    const lifecycle = String(row.lifecycle_state ?? '').toUpperCase();
    const ack = String(row.ack_status ?? '').toLowerCase();
    const isLoss = lifecycle === 'FAILED' || lifecycle === 'TIMEOUT' || lifecycle === 'CANCELLED' || ack === 'failed' || ack === 'rejected';
    if (!isLoss) break;
    losses += 1;
  }
  return losses;
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
  const rules = loadPropFirmRiskRulesFromEnv();
  const accountNumber = await resolveAccountNumber(input.terminalId);
  const state = await loadRiskState(accountNumber);
  const rewardRiskRatio = resolveRewardRiskRatio(input, rules);
  const decision = evaluatePropFirmRisk({
    rules,
    state,
    requestedLots: input.requestedLots,
    rewardRiskRatio,
  });

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
