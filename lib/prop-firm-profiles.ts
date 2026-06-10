import { evaluatePropFirmRisk, getRemainingDailyLossAmount, getTotalDrawdownPercent } from '@/packages/risk-core';
import { isContinuousTradingEnabled } from './execution-risk-limits';
import type { PropFirmRiskRules, RiskState } from '@/packages/shared-types';
import { queryPostgres } from './postgres';

export type {
  PropFirmComplianceView,
  PropFirmRuleCategory,
  PropFirmRuleRow,
  PropFirmRuleStatus,
} from './prop-firm-types';
export { FUNDEDNEXT_CHALLENGE_PROFILE, PROP_FIRM_RULE_CATEGORY_TONE } from './prop-firm-types';

import {
  FUNDEDNEXT_CHALLENGE_PROFILE,
  type PropFirmComplianceView,
  type PropFirmRuleRow,
  type PropFirmRuleStatus,
} from './prop-firm-types';

function statusFromUsage(usedPercent: number, limitPercent: number, warnRatio = 0.7): PropFirmRuleStatus {
  if (usedPercent >= limitPercent) return 'error';
  if (usedPercent >= limitPercent * warnRatio) return 'warn';
  return 'ok';
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

async function loadPrimaryAccountState(accountNumber: string | null): Promise<{
  accountNumber: string | null;
  state: RiskState;
  initialBalance: number;
  tradingDaysCompleted: number;
}> {
  if (!accountNumber) {
    return {
      accountNumber: null,
      state: {
        startingEquityToday: 0,
        currentEquity: 0,
        peakEquityAllTime: 0,
        currentBalance: 0,
        tradesOpenedToday: 0,
        openTrades: 0,
        consecutiveLosses: 0,
        monthlyProfitPercent: 0,
        killSwitchActive: false,
        highImpactNewsBlocked: false,
      },
      initialBalance: 0,
      tradingDaysCompleted: 0,
    };
  }

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
  const initialBalance = peakEquityAllTime > 0 ? peakEquityAllTime : balance;

  const [tradesTodayResult, tradingDaysResult] = await Promise.all([
    queryPostgres(
      `
        SELECT COUNT(*)::int AS count
        FROM execution_commands c
        JOIN mt5_terminals t ON t.terminal_id = c.terminal_id
        WHERE t.account_number = $1
          AND c.lifecycle_state = 'EXECUTED'
          AND c.created_at >= date_trunc('day', now())
      `,
      [accountNumber],
    ),
    queryPostgres(
      `
        SELECT COUNT(DISTINCT date_trunc('day', c.created_at))::int AS days
        FROM execution_commands c
        JOIN mt5_terminals t ON t.terminal_id = c.terminal_id
        WHERE t.account_number = $1
          AND c.lifecycle_state = 'EXECUTED'
      `,
      [accountNumber],
    ),
  ]);

  const state: RiskState = {
    startingEquityToday: startingEquityToday > 0 ? startingEquityToday : equity,
    currentEquity: equity,
    peakEquityAllTime: peakEquityAllTime > 0 ? peakEquityAllTime : equity,
    currentBalance: balance,
    tradesOpenedToday: Number((tradesTodayResult.rows[0] as { count?: number })?.count ?? 0),
    openTrades: Number(account?.open_trade_count ?? 0),
    consecutiveLosses: 0,
    monthlyProfitPercent: 0,
    killSwitchActive: false,
    highImpactNewsBlocked: false,
  };

  return {
    accountNumber,
    state,
    initialBalance,
    tradingDaysCompleted: Number((tradingDaysResult.rows[0] as { days?: number })?.days ?? 0),
  };
}

export async function buildFundedNextCompliance(input: {
  accountNumber: string | null;
  liveEquity?: number;
  liveBalance?: number;
  liveOpenTrades?: number;
}): Promise<PropFirmComplianceView> {
  const profile = FUNDEDNEXT_CHALLENGE_PROFILE;
  const loaded = await loadPrimaryAccountState(input.accountNumber);

  const state: RiskState = {
    ...loaded.state,
    currentEquity: input.liveEquity != null && input.liveEquity > 0 ? input.liveEquity : loaded.state.currentEquity,
    currentBalance: input.liveBalance != null && input.liveBalance > 0 ? input.liveBalance : loaded.state.currentBalance,
    openTrades: input.liveOpenTrades != null ? input.liveOpenTrades : loaded.state.openTrades,
  };

  const initialBalance = loaded.initialBalance > 0 ? loaded.initialBalance : state.currentBalance;
  const profitProgressPercent =
    initialBalance > 0
      ? Number((((state.currentEquity - initialBalance) / initialBalance) * 100).toFixed(2))
      : 0;

  const phaseLabel = profitProgressPercent < profile.phase1ProfitTargetPercent ? 'Phase 1' : 'Phase 2';
  const profitTargetPercent =
    phaseLabel === 'Phase 1' ? profile.phase1ProfitTargetPercent : profile.phase2ProfitTargetPercent;

  const dailyDrawdownPercent =
    state.startingEquityToday > 0
      ? Number((((Math.max(0, state.startingEquityToday - state.currentEquity)) / state.startingEquityToday) * 100).toFixed(2))
      : 0;

  const maxDrawdownPercent =
    initialBalance > 0
      ? Number((((Math.max(0, initialBalance - state.currentEquity)) / initialBalance) * 100).toFixed(2))
      : getTotalDrawdownPercent(state);

  const rulesConfig: PropFirmRiskRules = {
    dailyDrawdownPercent: profile.dailyLossLimitPercent,
    maxDrawdownPercent: profile.maxLossLimitPercent,
    riskPerTradePercent: 1,
    dailyTradeLimitEnabled: false,
    maxTradesPerDay: 999,
    maxOpenTrades: 999,
    maxLotSize: 999,
    maxCurrencyExposurePercent: 100,
    maxCorrelatedExposurePercent: 100,
    minRewardRiskRatio: 1,
    stopAfterConsecutiveLosses: 99,
    stopTradingAfterDailyTargetHit: false,
    monthlyProfitTargetPercent: 100,
    newsBlackoutMinutesBefore: 0,
    newsBlackoutMinutesAfter: 0,
  };

  const riskDecision = evaluatePropFirmRisk({
    rules: rulesConfig,
    state,
    requestedLots: 0.01,
    rewardRiskRatio: 2,
    continuousTradingEnabled: isContinuousTradingEnabled(),
  });

  const remainingDailyLossAmount = getRemainingDailyLossAmount(rulesConfig, state);

  const rules: PropFirmRuleRow[] = [
    {
      category: 'profit_phase_1',
      label: 'Phase 1 profit target',
      limit: formatPercent(profile.phase1ProfitTargetPercent),
      current: formatPercent(Math.max(0, profitProgressPercent)),
      status: profitProgressPercent >= profile.phase1ProfitTargetPercent ? 'ok' : 'warn',
      progressPercent: Math.min(100, (Math.max(0, profitProgressPercent) / profile.phase1ProfitTargetPercent) * 100),
    },
    {
      category: 'profit_phase_2',
      label: 'Phase 2 profit target',
      limit: formatPercent(profile.phase2ProfitTargetPercent),
      current: formatPercent(Math.max(0, profitProgressPercent - profile.phase1ProfitTargetPercent)),
      status:
        profitProgressPercent >= profile.phase1ProfitTargetPercent + profile.phase2ProfitTargetPercent
          ? 'ok'
          : profitProgressPercent >= profile.phase1ProfitTargetPercent
            ? 'warn'
            : 'ok',
      progressPercent: Math.min(
        100,
        (Math.max(0, profitProgressPercent - profile.phase1ProfitTargetPercent) / profile.phase2ProfitTargetPercent) * 100,
      ),
    },
    {
      category: 'max_loss',
      label: 'Maximum loss limit',
      limit: formatPercent(profile.maxLossLimitPercent),
      current: formatPercent(maxDrawdownPercent),
      status: statusFromUsage(maxDrawdownPercent, profile.maxLossLimitPercent),
      progressPercent: Math.min(100, (maxDrawdownPercent / profile.maxLossLimitPercent) * 100),
    },
    {
      category: 'daily_loss',
      label: 'Daily loss limit',
      limit: formatPercent(profile.dailyLossLimitPercent),
      current: formatPercent(dailyDrawdownPercent),
      status: statusFromUsage(dailyDrawdownPercent, profile.dailyLossLimitPercent),
      progressPercent: Math.min(100, (dailyDrawdownPercent / profile.dailyLossLimitPercent) * 100),
    },
    {
      category: 'trading_days',
      label: 'Minimum trading days',
      limit: `${profile.minimumTradingDays} days`,
      current: `${loaded.tradingDaysCompleted} days`,
      status: loaded.tradingDaysCompleted >= profile.minimumTradingDays ? 'ok' : 'warn',
      progressPercent: Math.min(100, (loaded.tradingDaysCompleted / profile.minimumTradingDays) * 100),
    },
    {
      category: 'reduced_days',
      label: '3 days reduced',
      limit: `${profile.reducedTradingDays} days`,
      current: `${loaded.tradingDaysCompleted} days`,
      status: loaded.tradingDaysCompleted >= profile.reducedTradingDays ? 'ok' : 'warn',
      progressPercent: Math.min(100, (loaded.tradingDaysCompleted / profile.reducedTradingDays) * 100),
    },
    {
      category: 'news_trading',
      label: 'News trading',
      limit: profile.newsTradingAllowed ? 'Allowed' : 'Blocked',
      current: profile.newsTradingAllowed ? 'Yes' : 'No',
      status: 'ok',
    },
    {
      category: 'withdrawal',
      label: 'First withdrawal',
      limit: `${profile.firstWithdrawalDays} days`,
      current: '—',
      status: 'ok',
    },
    {
      category: 'daily_buffer',
      label: 'Remaining daily loss buffer',
      limit: formatMoney(state.startingEquityToday * (profile.dailyLossLimitPercent / 100)),
      current: formatMoney(remainingDailyLossAmount),
      status: remainingDailyLossAmount <= 0 ? 'error' : remainingDailyLossAmount < state.startingEquityToday * 0.01 ? 'warn' : 'ok',
    },
  ];

  return {
    firmName: profile.firmName,
    rewardNote: profile.rewardNote,
    phaseLabel,
    profitTargetPercent,
    profitProgressPercent: Math.max(0, profitProgressPercent),
    dailyDrawdownPercent,
    dailyDrawdownLimitPercent: profile.dailyLossLimitPercent,
    maxDrawdownPercent,
    maxDrawdownLimitPercent: profile.maxLossLimitPercent,
    tradingDaysCompleted: loaded.tradingDaysCompleted,
    minimumTradingDays: profile.minimumTradingDays,
    reducedTradingDays: profile.reducedTradingDays,
    newsTradingAllowed: profile.newsTradingAllowed,
    firstWithdrawalDays: profile.firstWithdrawalDays,
    remainingDailyLossAmount,
    riskAllowed: riskDecision.allowed,
    riskMessage: riskDecision.message,
    rules,
  };
}
