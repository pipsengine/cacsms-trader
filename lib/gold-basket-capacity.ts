import { evaluateAutonomySafetyLock } from '@/lib/autonomy-safety-lock';
import { syncOpenPositionRegistry } from '@/lib/execution-open-positions';
import { getExecutionRiskSettings } from '@/lib/execution-risk-settings';
import {
  GOLD_SYMBOL,
  goldDailyLimitsEnabled,
  goldMaxBasketsPerDay,
  goldMaxConcurrentBaskets,
  goldMaxConcurrentPositions,
  goldMaxDailyLegs,
  goldMaxEntryLegCount,
  goldMinEntryLegCount,
  isGoldOnlyTradingEngine,
  isGoldSymbol,
  resolveGoldEntryLegCount,
} from '@/lib/gold-trading-engine';
import { groupOpenPositions } from '@/lib/position-group-management';
import { queryPostgres } from '@/lib/postgres';
import { TRADING_PNL_TIMEZONE } from '@/lib/trading-period-pnl';

export type BasketCapacityState = 'open' | 'basket_suspended' | 'hard_stop';

export type BasketCapacitySnapshot = {
  state: BasketCapacityState;
  stateLabel: string;
  basketsOpenedToday: number;
  maxBasketsPerDay: number;
  concurrentBaskets: number;
  maxConcurrentBaskets: number;
  openLegs: number;
  pendingLegs: number;
  dailyLegsOpened: number;
  maxDailyLegs: number;
  maxConcurrentLegs: number;
  dynamicMaxLegsPerBasket: number;
  remainingDailyLossUsd: number;
  blockers: string[];
};

export type BasketCapacityEvaluation = {
  allowed: boolean;
  state: BasketCapacityState;
  blockers: string[];
  snapshot: BasketCapacitySnapshot;
};

function dayStartSql(): string {
  return `(date_trunc('day', (now() AT TIME ZONE '${TRADING_PNL_TIMEZONE}')::date))::timestamp AT TIME ZONE '${TRADING_PNL_TIMEZONE}'`;
}

const BASKET_ACCOUNTING_RESET_KEY = 'gold_basket_accounting_reset';

type BasketAccountingResetRecord = {
  resetAt: string;
  accountNumber: string | null;
  reason: string;
  timezone: string;
};

async function loadBasketAccountingReset(
  accountNumber: string | null,
): Promise<BasketAccountingResetRecord | null> {
  const result = await queryPostgres(
    `SELECT value FROM mt5_bridge_settings WHERE key = $1 LIMIT 1`,
    [BASKET_ACCOUNTING_RESET_KEY],
  ).catch(() => ({ rows: [] }));
  const raw = String(result.rows[0]?.value ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BasketAccountingResetRecord;
    if (!parsed.resetAt) return null;
    if (parsed.accountNumber && accountNumber && parsed.accountNumber !== accountNumber) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function resolveBasketAccountingCutoff(accountNumber: string | null): Promise<string> {
  const reset = await loadBasketAccountingReset(accountNumber);
  if (!reset?.resetAt) return dayStartSql();
  return `GREATEST(${dayStartSql()}, '${reset.resetAt}'::timestamptz)`;
}

export async function resetBasketDayAccounting(input: {
  accountNumber?: string | null;
  terminalId?: string | null;
  reason?: string;
} = {}): Promise<{
  resetAt: string;
  accountNumber: string | null;
  timezone: string;
  tradingAccountsReset: number;
}> {
  const accountNumber = await resolveAccountNumber(input);
  const resetAt = new Date().toISOString();
  const record: BasketAccountingResetRecord = {
    resetAt,
    accountNumber,
    reason: input.reason ?? 'manual_basket_day_reset',
    timezone: TRADING_PNL_TIMEZONE,
  };

  await queryPostgres(
    `
      INSERT INTO mt5_bridge_settings (key, value, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [BASKET_ACCOUNTING_RESET_KEY, JSON.stringify(record)],
  );

  const accounts = accountNumber
    ? await queryPostgres(
      `
        UPDATE trading_accounts
        SET starting_equity_today = GREATEST(equity, balance),
            updated_at = now()
        WHERE account_number = $1
        RETURNING account_number
      `,
      [accountNumber],
    )
    : await queryPostgres(`
        UPDATE trading_accounts
        SET starting_equity_today = GREATEST(equity, balance),
            updated_at = now()
        RETURNING account_number
      `);

  await queryPostgres(
    `
      DELETE FROM autonomy_execution_dispatches
      WHERE status = 'blocked'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(coalesce(blockers_json, '[]'::jsonb)) blocker
          WHERE blocker ~* 'basket|daily leg|drawdown budget|daily trade limit'
        )
    `,
  ).catch(() => null);

  return {
    resetAt,
    accountNumber,
    timezone: TRADING_PNL_TIMEZONE,
    tradingAccountsReset: accounts.rows.length,
  };
}

async function resolveAccountNumber(input?: { accountNumber?: string | null; terminalId?: string | null }): Promise<string | null> {
  const explicit = String(input?.accountNumber ?? '').trim();
  if (explicit) return explicit;

  if (input?.terminalId) {
    const fromTerminal = await queryPostgres(
      `SELECT account_number FROM mt5_terminals WHERE terminal_id = $1 LIMIT 1`,
      [input.terminalId],
    );
    const accountNumber = String(fromTerminal.rows[0]?.account_number ?? '').trim();
    if (accountNumber) return accountNumber;
  }

  const fallback = await queryPostgres(
    `SELECT account_number FROM trading_accounts ORDER BY updated_at DESC LIMIT 1`,
  );
  return String(fallback.rows[0]?.account_number ?? '').trim() || null;
}

async function countPendingBatchLegs(symbol = GOLD_SYMBOL): Promise<number> {
  const result = await queryPostgres(
    `
      SELECT COUNT(*)::int AS pending
      FROM execution_commands c
      WHERE upper(replace(c.type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')
        AND c.lifecycle_state IN ('QUEUED', 'ROUTING', 'SENT', 'ACKNOWLEDGED')
        AND upper(coalesce(c.symbol, c.payload->>'symbol', '')) = $1
        AND coalesce(c.payload->>'batchEntry', 'false') IN ('true', '1', 'yes')
    `,
    [symbol.toUpperCase()],
  ).catch(() => ({ rows: [{ pending: 0 }] }));
  return Number(result.rows[0]?.pending ?? 0);
}

async function countDistinctBasketsOpenedToday(accountNumber: string): Promise<number> {
  const accountingCutoff = await resolveBasketAccountingCutoff(accountNumber);
  const result = await queryPostgres(
    `
      SELECT COUNT(DISTINCT basket_key)::int AS count
      FROM (
        SELECT COALESCE(
          NULLIF(c.payload->>'basketId', ''),
          NULLIF(c.payload->>'setupGroupId', ''),
          NULLIF(c.dedupe_key, '')
        ) AS basket_key
        FROM execution_commands c
        JOIN mt5_terminals t ON t.terminal_id = c.terminal_id
        WHERE t.account_number = $1
          AND upper(coalesce(c.symbol, c.payload->>'symbol', '')) LIKE 'XAU%'
          AND upper(replace(c.type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')
          AND c.lifecycle_state IN ('EXECUTED', 'ACKNOWLEDGED')
          AND coalesce(c.payload->>'batchEntry', 'false') IN ('true', '1', 'yes')
          AND COALESCE(NULLIF(c.payload->>'legIndex', '')::int, 1) = 1
          AND c.created_at >= ${accountingCutoff}
        UNION
        SELECT COALESCE(
          NULLIF(p.metadata->>'basketId', ''),
          NULLIF(p.metadata->>'setupGroupId', ''),
          p.open_command_id
        ) AS basket_key
        FROM execution_open_positions p
        JOIN mt5_terminals t ON t.terminal_id = p.terminal_id
        WHERE t.account_number = $1
          AND upper(coalesce(p.symbol, '')) LIKE 'XAU%'
          AND p.opened_at >= ${accountingCutoff}
          AND coalesce(p.metadata->>'batchEntry', 'false') IN ('true', '1', 'yes')
          AND COALESCE(NULLIF(p.metadata->>'legIndex', '')::int, 1) = 1
      ) keys
      WHERE basket_key IS NOT NULL AND basket_key <> ''
    `,
    [accountNumber],
  ).catch(() => ({ rows: [{ count: 0 }] }));
  return Number(result.rows[0]?.count ?? 0);
}

async function countDailyLegsOpenedToday(accountNumber?: string): Promise<number> {
  const accountingCutoff = await resolveBasketAccountingCutoff(accountNumber ?? null);
  const params: string[] = [GOLD_SYMBOL.toUpperCase()];
  const accountFilter = accountNumber
    ? (params.push(accountNumber), `AND t.account_number = $2`)
    : '';
  const result = await queryPostgres(
    `
      SELECT COUNT(*)::int AS count
      FROM execution_commands c
      ${accountNumber ? 'JOIN mt5_terminals t ON t.terminal_id = c.terminal_id' : ''}
      WHERE upper(coalesce(c.symbol, c.payload->>'symbol', '')) = $1
        AND c.lifecycle_state = 'EXECUTED'
        AND upper(replace(c.type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')
        AND c.created_at >= ${accountingCutoff}
        ${accountFilter}
    `,
    params,
  ).catch(() => ({ rows: [{ count: 0 }] }));
  return Number(result.rows[0]?.count ?? 0);
}

/** Gold daily trade count — respects basket day accounting reset (Africa/Lagos). */
export async function countGoldDailyTradesOpened(accountNumber?: string | null): Promise<number> {
  return countDailyLegsOpenedToday(accountNumber ?? undefined);
}

async function countPendingBasketGroups(symbol = GOLD_SYMBOL): Promise<number> {
  const result = await queryPostgres(
    `
      SELECT COUNT(DISTINCT COALESCE(
        NULLIF(c.payload->>'basketId', ''),
        NULLIF(c.payload->>'setupGroupId', ''),
        c.command_id
      ))::int AS count
      FROM execution_commands c
      WHERE upper(replace(c.type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')
        AND c.lifecycle_state IN ('QUEUED', 'ROUTING', 'SENT', 'ACKNOWLEDGED')
        AND upper(coalesce(c.symbol, c.payload->>'symbol', '')) = $1
        AND coalesce(c.payload->>'batchEntry', 'false') IN ('true', '1', 'yes')
    `,
    [symbol.toUpperCase()],
  ).catch(() => ({ rows: [{ count: 0 }] }));
  return Number(result.rows[0]?.count ?? 0);
}

function stateLabel(state: BasketCapacityState): string {
  if (state === 'open') return 'Open — new baskets allowed';
  if (state === 'basket_suspended') return 'Suspended — no new baskets';
  return 'Hard stop — risk lock active';
}

export function resolveDynamicBasketLegCap(input?: {
  qualityScore?: number;
  confidenceScore?: number;
}): number {
  return resolveGoldEntryLegCount({
    qualityScore: input?.qualityScore,
    confidenceScore: input?.confidenceScore,
  });
}

export async function getBasketCapacitySnapshot(input: {
  accountNumber?: string | null;
  terminalId?: string | null;
  qualityScore?: number;
  confidenceScore?: number;
} = {}): Promise<BasketCapacitySnapshot> {
  const blockers: string[] = [];
  const accountNumber = await resolveAccountNumber(input);
  const risk = await getExecutionRiskSettings();
  const remainingDailyLossUsd = Number(risk.remainingDailyLossAmount ?? 0);

  let state: BasketCapacityState = 'open';
  if (remainingDailyLossUsd <= 0) {
    state = 'basket_suspended';
    blockers.push('Daily drawdown budget exhausted — new baskets suspended.');
  }

  const safety = await evaluateAutonomySafetyLock({ autoActivateKillSwitch: false });
  if (safety.locked) {
    state = 'hard_stop';
    blockers.push(...safety.blockers);
  }

  const filter = input.terminalId ? { terminalId: input.terminalId } : undefined;
  const metrics = await syncOpenPositionRegistry(filter);
  const goldPositions = metrics.positions.filter((position) => isGoldSymbol(String(position.symbol ?? '')));
  const groups = groupOpenPositions(goldPositions);
  const openLegs = goldPositions.length;
  const pendingLegs = await countPendingBatchLegs();
  const pendingBaskets = await countPendingBasketGroups();
  const concurrentBaskets = groups.length + Math.max(0, pendingBaskets - groups.length);

  const basketsOpenedToday = accountNumber
    ? await countDistinctBasketsOpenedToday(accountNumber)
    : 0;
  const dailyLegsOpened = await countDailyLegsOpenedToday(accountNumber ?? undefined).catch(() => 0);

  const maxBasketsPerDay = goldMaxBasketsPerDay();
  const maxConcurrentBaskets = goldMaxConcurrentBaskets();
  const maxDailyLegs = goldMaxDailyLegs();
  const maxConcurrentLegs = goldMaxConcurrentPositions();
  const dynamicMaxLegsPerBasket = resolveDynamicBasketLegCap(input);

  if (goldDailyLimitsEnabled() && state === 'open' && basketsOpenedToday >= maxBasketsPerDay) {
    state = 'basket_suspended';
    blockers.push(`Daily basket limit reached (${basketsOpenedToday}/${maxBasketsPerDay}).`);
  }
  if (state === 'open' && concurrentBaskets >= maxConcurrentBaskets) {
    blockers.push(`Concurrent basket limit reached (${concurrentBaskets}/${maxConcurrentBaskets}).`);
  }
  if (state === 'open' && openLegs + pendingLegs >= maxConcurrentLegs) {
    blockers.push(`Concurrent leg limit reached (${openLegs + pendingLegs}/${maxConcurrentLegs}).`);
  }
  if (goldDailyLimitsEnabled() && state === 'open' && dailyLegsOpened >= maxDailyLegs) {
    state = 'basket_suspended';
    blockers.push(`Daily leg limit reached (${dailyLegsOpened}/${maxDailyLegs}).`);
  }

  return {
    state,
    stateLabel: stateLabel(state),
    basketsOpenedToday,
    maxBasketsPerDay,
    concurrentBaskets,
    maxConcurrentBaskets,
    openLegs,
    pendingLegs,
    dailyLegsOpened,
    maxDailyLegs,
    maxConcurrentLegs,
    dynamicMaxLegsPerBasket,
    remainingDailyLossUsd,
    blockers,
  };
}

export function basketCapacityBlocksNewEntries(snapshot: BasketCapacitySnapshot): boolean {
  return snapshot.state !== 'open' || snapshot.blockers.length > 0;
}

export async function evaluateInstitutionalBasketCapacity(input: {
  accountNumber?: string | null;
  terminalId?: string | null;
  proposedLegCount?: number;
  isNewBasket?: boolean;
  qualityScore?: number;
  confidenceScore?: number;
}): Promise<BasketCapacityEvaluation> {
  if (!isGoldOnlyTradingEngine()) {
    const snapshot = await getBasketCapacitySnapshot(input);
    return { allowed: true, state: snapshot.state, blockers: [], snapshot };
  }

  const snapshot = await getBasketCapacitySnapshot(input);
  const blockers = [...snapshot.blockers];
  const proposedLegs = Math.max(
    goldMinEntryLegCount(),
    Math.min(
      input.proposedLegCount ?? resolveDynamicBasketLegCap(input),
      snapshot.dynamicMaxLegsPerBasket,
      goldMaxEntryLegCount(),
    ),
  );

  if (snapshot.state === 'hard_stop') {
    return { allowed: false, state: snapshot.state, blockers, snapshot };
  }

  if (input.isNewBasket !== false) {
    if (goldDailyLimitsEnabled() && snapshot.basketsOpenedToday >= snapshot.maxBasketsPerDay) {
      blockers.push(`Maximum baskets per day reached (${snapshot.basketsOpenedToday}/${snapshot.maxBasketsPerDay}).`);
    }
    if (snapshot.concurrentBaskets >= snapshot.maxConcurrentBaskets) {
      blockers.push(`Maximum concurrent baskets reached (${snapshot.concurrentBaskets}/${snapshot.maxConcurrentBaskets}).`);
    }
  }

  const projectedLegs = snapshot.openLegs + snapshot.pendingLegs + (input.isNewBasket === false ? 1 : proposedLegs);
  if (projectedLegs > snapshot.maxConcurrentLegs) {
    blockers.push(`Projected open legs ${projectedLegs} would exceed cap ${snapshot.maxConcurrentLegs}.`);
  }

  const projectedDailyLegs = snapshot.dailyLegsOpened + (input.isNewBasket === false ? 1 : proposedLegs);
  if (goldDailyLimitsEnabled() && projectedDailyLegs > snapshot.maxDailyLegs) {
    blockers.push(`Projected daily legs ${projectedDailyLegs} would exceed cap ${snapshot.maxDailyLegs}.`);
  }

  if (proposedLegs < goldMinEntryLegCount() && input.isNewBasket !== false) {
    blockers.push(`Basket requires at least ${goldMinEntryLegCount()} legs (proposed ${proposedLegs}).`);
  }

  const uniqueBlockers = [...new Set(blockers)];
  const allowed = snapshot.state === 'open' && uniqueBlockers.length === 0;
  return {
    allowed,
    state: snapshot.state,
    blockers: uniqueBlockers,
    snapshot,
  };
}

export async function logBasketCapacityBlock(input: {
  source: string;
  blockers: string[];
  snapshot: BasketCapacitySnapshot;
}): Promise<void> {
  const message = `[BASKET_CAPACITY] ${input.source} state=${input.snapshot.state} `
    + `baskets=${input.snapshot.basketsOpenedToday}/${input.snapshot.maxBasketsPerDay} `
    + `concurrent=${input.snapshot.concurrentBaskets}/${input.snapshot.maxConcurrentBaskets} `
    + `legs=${input.snapshot.openLegs}/${input.snapshot.maxConcurrentLegs} `
    + `dailyLegs=${input.snapshot.dailyLegsOpened}/${input.snapshot.maxDailyLegs} `
    + `blockers=${input.blockers.join(' | ') || 'none'}`;
  console.info(message);
  await queryPostgres(
    `
      INSERT INTO mt5_bridge_settings (key, value, updated_at)
      VALUES ('gold_basket_capacity_last_block', $1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [JSON.stringify({
      at: new Date().toISOString(),
      source: input.source,
      blockers: input.blockers,
      snapshot: input.snapshot,
    })],
  ).catch(() => null);
}
