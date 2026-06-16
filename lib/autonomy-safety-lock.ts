import { activateExecutionKillSwitch, deactivateExecutionKillSwitch, getExecutionKillSwitchStatus } from '@/lib/execution-kill-switch';
import { countUnprotectedOpenPositions, listOpenPositions } from '@/lib/execution-open-positions';
import { markTimeouts } from '@/lib/execution-bridge-store';
import { isContinuousTradingEnabled } from '@/lib/execution-risk-limits';
import { getLatestPairSelection } from '@/lib/pair-selector';
import { parsePairCurrencies } from '@/lib/pair-selector-utils';
import { queryPostgres } from '@/lib/postgres';
import { classifySector } from '@/lib/mt5-symbol-telemetry';

export type AutonomySafetyLockStatus = {
  locked: boolean;
  hardLocked: boolean;
  blockers: string[];
  warnings: string[];
  metrics: {
    accountNumber: string | null;
    currentEquity: number;
    startingEquityToday: number;
    dailyPnl: number;
    dailyLossBudget: number;
    dailyLossUsedPercent: number;
    openPositions: number;
    unprotectedOpenPositions: number;
    pendingOpeningCommands: number;
    staleOpeningCommands: number;
  };
};

type SafetyInput = {
  symbol?: string | null;
  terminalId?: string | null;
  accountNumber?: string | null;
  autoActivateKillSwitch?: boolean;
};

type AccountRow = {
  account_number?: string;
  equity?: string | number;
  balance?: string | number;
  starting_equity_today?: string | number;
};

function envBool(name: string, fallback = false): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function enabled(): boolean {
  return envBool('CACSMS_AUTONOMY_SAFETY_LOCK_ENABLED', true);
}

function dailyDrawdownPercent(): number {
  return Math.max(0.1, envNumber('RISK_DAILY_DRAWDOWN_PERCENT', 4));
}

function dailyLossLockFraction(): number {
  return Math.min(1, Math.max(0.1, envNumber('CACSMS_SAFETY_DAILY_LOSS_LOCK_FRACTION', 0.8)));
}

function dailyProfitLockUsd(): number {
  return Math.max(0, envNumber('CACSMS_SAFETY_DAILY_PROFIT_LOCK_USD', 0));
}

function maxOpenPerSymbol(): number {
  return Math.max(1, Math.round(envNumber('CACSMS_SAFETY_MAX_OPEN_PER_SYMBOL', envNumber('RISK_MAX_OPEN_POSITIONS_PER_SYMBOL', 2))));
}

function maxOpenPerCurrency(): number {
  return Math.max(1, Math.round(envNumber('CACSMS_SAFETY_MAX_OPEN_PER_CURRENCY', 8)));
}

function maxOpenPerAssetClass(): number {
  return Math.max(1, Math.round(envNumber('CACSMS_SAFETY_MAX_OPEN_PER_ASSET_CLASS', 12)));
}

function maxPendingOpeningCommands(): number {
  return Math.max(0, Math.round(envNumber('CACSMS_SAFETY_MAX_PENDING_OPENING_COMMANDS', 5)));
}

function staleCommandMinutes(): number {
  return Math.max(1, envNumber('CACSMS_SAFETY_STALE_COMMAND_MINUTES', 3));
}

async function resolveAccount(input: SafetyInput): Promise<AccountRow | null> {
  if (input.accountNumber) {
    const result = await queryPostgres(
      `SELECT account_number, equity, balance, starting_equity_today FROM trading_accounts WHERE account_number = $1 LIMIT 1`,
      [input.accountNumber],
    ).catch(() => ({ rows: [] as AccountRow[] }));
    return (result.rows[0] as AccountRow | undefined) ?? null;
  }

  if (input.terminalId) {
    const result = await queryPostgres(
      `
        SELECT a.account_number, a.equity, a.balance, a.starting_equity_today
        FROM mt5_terminals t
        JOIN trading_accounts a ON a.account_number = t.account_number
        WHERE t.terminal_id = $1
        LIMIT 1
      `,
      [input.terminalId],
    ).catch(() => ({ rows: [] as AccountRow[] }));
    return (result.rows[0] as AccountRow | undefined) ?? null;
  }

  const result = await queryPostgres(
    `SELECT account_number, equity, balance, starting_equity_today FROM trading_accounts ORDER BY updated_at DESC LIMIT 1`,
  ).catch(() => ({ rows: [] as AccountRow[] }));
  return (result.rows[0] as AccountRow | undefined) ?? null;
}

async function countPendingOpeningCommands(filter: { terminalId?: string | null; accountNumber?: string | null }) {
  const params: string[] = [];
  const conditions = [
    `upper(replace(c.type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')`,
    `c.lifecycle_state IN ('QUEUED', 'ROUTING', 'SENT', 'ACKNOWLEDGED')`,
  ];
  if (filter.terminalId) {
    params.push(filter.terminalId);
    conditions.push(`c.terminal_id = $${params.length}`);
  }
  if (filter.accountNumber) {
    params.push(filter.accountNumber);
    conditions.push(`EXISTS (
      SELECT 1 FROM mt5_terminals t
      WHERE t.terminal_id = c.terminal_id
        AND t.account_number = $${params.length}
    )`);
  }
  const staleMinutes = staleCommandMinutes();
  const conditionalMinutes = Math.max(30, Math.round(envNumber('CACSMS_CONDITIONAL_ENTRY_MAX_MINUTES', 360)));
  const result = await queryPostgres(
    `
      SELECT
        COUNT(*)::int AS pending,
        COUNT(*) FILTER (
          WHERE c.created_at < now() - ($${params.length + 1} || ' minutes')::interval
            AND COALESCE(c.broker_message, '') <> 'conditional_entry_waiting_for_retracement_confirmation'
        )::int AS stale,
        COUNT(*) FILTER (
          WHERE COALESCE(c.broker_message, '') = 'conditional_entry_waiting_for_retracement_confirmation'
            AND c.created_at < now() - ($${params.length + 2} || ' minutes')::interval
        )::int AS expired_conditional
      FROM execution_commands c
      WHERE ${conditions.join(' AND ')}
    `,
    [...params, String(staleMinutes), String(conditionalMinutes)],
  ).catch(() => ({ rows: [{ pending: 0, stale: 0, expired_conditional: 0 }] }));
  const row = result.rows[0] as { pending?: number; stale?: number; expired_conditional?: number };
  const expiredConditional = Number(row?.expired_conditional ?? 0);
  return {
    pending: Math.max(0, Number(row?.pending ?? 0) - expiredConditional),
    stale: Number(row?.stale ?? 0),
  };
}

function addExposureBlockers(input: {
  targetSymbol: string;
  positions: Awaited<ReturnType<typeof listOpenPositions>>;
  blockers: string[];
}) {
  const target = input.targetSymbol.toUpperCase();
  const perSymbol = new Map<string, number>();
  const perCurrency = new Map<string, number>();
  const perAsset = new Map<string, number>();

  for (const position of input.positions) {
    const symbol = String(position.symbol ?? '').toUpperCase();
    if (!symbol) continue;
    perSymbol.set(symbol, (perSymbol.get(symbol) ?? 0) + 1);
    perAsset.set(classifySector(symbol), (perAsset.get(classifySector(symbol)) ?? 0) + 1);
    for (const currency of parsePairCurrencies(symbol)) {
      if (!currency) continue;
      perCurrency.set(currency, (perCurrency.get(currency) ?? 0) + 1);
    }
  }

  const [base, quote] = parsePairCurrencies(target);
  const assetClass = classifySector(target);
  if ((perSymbol.get(target) ?? 0) >= maxOpenPerSymbol()) {
    input.blockers.push(`${target} exposure cap reached (${perSymbol.get(target)}/${maxOpenPerSymbol()}).`);
  }
  for (const currency of [base, quote]) {
    if (!currency) continue;
    const count = perCurrency.get(currency) ?? 0;
    if (count >= maxOpenPerCurrency()) {
      input.blockers.push(`${currency} currency exposure cap reached (${count}/${maxOpenPerCurrency()}).`);
    }
  }
  const assetCount = perAsset.get(assetClass) ?? 0;
  if (assetCount >= maxOpenPerAssetClass()) {
    input.blockers.push(`${assetClass} asset-class exposure cap reached (${assetCount}/${maxOpenPerAssetClass()}).`);
  }
}

async function addTradabilityBlockers(symbol: string, blockers: string[], warnings: string[]) {
  const latest = await getLatestPairSelection().catch(() => null);
  if (!latest) {
    warnings.push('No pair-selection scan is available; autonomy is using conservative execution checks only.');
    return;
  }
  const candidate = latest.candidates.find((item) => item.symbol.toUpperCase() === symbol.toUpperCase());
  if (!candidate) {
    blockers.push(`${symbol} is missing from the latest pair-selection scan.`);
    return;
  }
  const continuousMode = latest.continuousTradingEnabled || isContinuousTradingEnabled();
  if (!candidate.tradable || candidate.blocked || (!continuousMode && !candidate.eligibleForNewEntry)) {
    const reason = candidate.blockReason || candidate.reasons.join('; ') || 'not tradable';
    blockers.push(`${symbol} is not eligible for autonomous execution: ${reason}.`);
  }
}

export async function evaluateAutonomySafetyLock(input: SafetyInput = {}): Promise<AutonomySafetyLockStatus> {
  if (!enabled()) {
    return {
      locked: false,
      hardLocked: false,
      blockers: [],
      warnings: ['Autonomy safety lock is disabled by CACSMS_AUTONOMY_SAFETY_LOCK_ENABLED=false.'],
      metrics: {
        accountNumber: input.accountNumber ?? null,
        currentEquity: 0,
        startingEquityToday: 0,
        dailyPnl: 0,
        dailyLossBudget: 0,
        dailyLossUsedPercent: 0,
        openPositions: 0,
        unprotectedOpenPositions: 0,
        pendingOpeningCommands: 0,
        staleOpeningCommands: 0,
      },
    };
  }

  const account = await resolveAccount(input);
  const accountNumber = String(account?.account_number ?? input.accountNumber ?? '').trim();
  const currentEquity = Number(account?.equity ?? account?.balance ?? 0);
  const startingEquityToday = Number(account?.starting_equity_today ?? currentEquity);
  const dailyPnl = Number((currentEquity - startingEquityToday).toFixed(2));
  const dailyLossBudget = Number((startingEquityToday * (dailyDrawdownPercent() / 100)).toFixed(2));
  const dailyLossUsed = Math.max(0, startingEquityToday - currentEquity);
  const dailyLossUsedPercent = dailyLossBudget > 0 ? Number(((dailyLossUsed / dailyLossBudget) * 100).toFixed(2)) : 0;

  const filter = {
    terminalId: input.terminalId ?? undefined,
    accountNumber: accountNumber || undefined,
  };
  await markTimeouts().catch(() => 0);
  const [positions, unprotectedOpenPositions, pending] = await Promise.all([
    listOpenPositions({ ...filter, limit: 200 }),
    countUnprotectedOpenPositions(filter),
    countPendingOpeningCommands(filter),
  ]);

  const blockers: string[] = [];
  const hardBlockers: string[] = [];
  const warnings: string[] = [];
  let hardLocked = false;

  if (currentEquity > 0 && startingEquityToday > 0 && dailyLossBudget > 0) {
    const lossLockAmount = dailyLossBudget * dailyLossLockFraction();
    if (dailyLossUsed >= lossLockAmount) {
      hardLocked = true;
      const message = `Daily loss safety lock reached: $${dailyLossUsed.toFixed(2)} used of $${dailyLossBudget.toFixed(2)} budget.`;
      blockers.push(message);
      hardBlockers.push(message);
    }
    const profitLock = dailyProfitLockUsd();
    if (profitLock > 0 && dailyPnl >= profitLock) {
      blockers.push(`Daily profit protection reached: $${dailyPnl.toFixed(2)} >= $${profitLock.toFixed(2)}. New entries paused to protect gains.`);
    }
  }

  if (unprotectedOpenPositions > 0) {
    blockers.push(`${unprotectedOpenPositions} open position(s) lack broker-side stop loss or take profit.`);
  }

  if (pending.stale > 0) {
    hardLocked = true;
    const message = `${pending.stale} stale opening command(s) require reconciliation.`;
    blockers.push(message);
    hardBlockers.push(message);
  } else if (pending.pending > maxPendingOpeningCommands()) {
    blockers.push(`Too many pending opening commands (${pending.pending}/${maxPendingOpeningCommands()}).`);
  }

  const symbol = String(input.symbol ?? '').toUpperCase().trim();
  if (symbol) {
    addExposureBlockers({ targetSymbol: symbol, positions, blockers });
    await addTradabilityBlockers(symbol, blockers, warnings);
  }

  const killSwitch = await getExecutionKillSwitchStatus();
  if (killSwitch.active) {
    const canClearOwnKillSwitch =
      envBool('CACSMS_SAFETY_AUTO_CLEAR_OWN_KILL_SWITCH', true)
      && killSwitch.operator === 'autonomy-safety-lock'
      && hardBlockers.length === 0;
    if (canClearOwnKillSwitch) {
      await deactivateExecutionKillSwitch({
        reason: 'Autonomy safety lock cleared after hard blockers resolved.',
        operator: 'autonomy-safety-lock',
      }).catch(() => null);
    } else {
      hardLocked = true;
      blockers.push(`Execution kill switch active: ${killSwitch.reason ?? 'new entries are blocked.'}`);
    }
  } else if (hardLocked && input.autoActivateKillSwitch !== false) {
    await activateExecutionKillSwitch({
      reason: hardBlockers[0] ?? blockers[0] ?? 'Autonomy safety lock activated.',
      operator: 'autonomy-safety-lock',
    }).catch(() => null);
  }

  return {
    locked: blockers.length > 0,
    hardLocked,
    blockers,
    warnings,
    metrics: {
      accountNumber: accountNumber || null,
      currentEquity,
      startingEquityToday,
      dailyPnl,
      dailyLossBudget,
      dailyLossUsedPercent,
      openPositions: positions.length,
      unprotectedOpenPositions,
      pendingOpeningCommands: pending.pending,
      staleOpeningCommands: pending.stale,
    },
  };
}
