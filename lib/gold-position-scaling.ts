import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import {
  goldMaxConcurrentPositions,
  goldMaxTradesPerDay,
  goldReentryCooldownMinutes,
  goldSerialTradingEnabled,
  goldStackMinConfidence,
  goldStackMinReadiness,
  isGoldSymbol,
} from '@/lib/gold-trading-engine';
import { getOpenPositionExposureForSymbol, listOpenPositions } from '@/lib/execution-open-positions';
import { countTradesOpenedTodayForSymbol } from '@/lib/execution-risk-limits';
import { queryPostgres } from '@/lib/postgres';

export type GoldStackEvaluation = {
  allowed: boolean;
  blockers: string[];
  openCount: number;
  sameSideCount: number;
  pendingCount: number;
  tradesToday: number;
  isStack: boolean;
  isReentry: boolean;
  serialMode: boolean;
};

async function countPendingOpeningCommands(symbol?: string): Promise<number> {
  const params: string[] = [];
  const conditions = [
    `upper(replace(c.type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')`,
    `c.lifecycle_state IN ('QUEUED', 'ROUTING', 'SENT', 'ACKNOWLEDGED')`,
  ];
  if (symbol) {
    params.push(symbol.toUpperCase());
    conditions.push(`upper(c.symbol) = $${params.length}`);
  }
  const result = await queryPostgres(
    `SELECT COUNT(*)::int AS pending FROM execution_commands c WHERE ${conditions.join(' AND ')}`,
    params,
  ).catch(() => ({ rows: [{ pending: 0 }] }));
  return Number(result.rows[0]?.pending ?? 0);
}

export async function evaluateGoldPositionScaling(input: {
  decision: Pick<
    AutonomousDecisionOutput,
    'symbol' | 'decision' | 'confidenceScore' | 'setupReadinessScore' | 'setupType' | 'selectedStrategyId'
  >;
  terminalId?: string | null;
}): Promise<GoldStackEvaluation> {
  if (!isGoldSymbol(input.decision.symbol)) {
    return {
      allowed: true,
      blockers: [],
      openCount: 0,
      sameSideCount: 0,
      pendingCount: 0,
      tradesToday: 0,
      isStack: false,
      isReentry: false,
      serialMode: false,
    };
  }

  const symbol = input.decision.symbol.toUpperCase();
  const side = input.decision.decision;
  const blockers: string[] = [];
  const serialMode = goldSerialTradingEnabled();

  const exposure = await getOpenPositionExposureForSymbol(symbol).catch(() => ({ count: 0, volumeLots: 0 }));
  const positions = await listOpenPositions({ limit: 50 }).catch(() => []);
  const accountOpenCount = positions.length;
  const openCount = serialMode ? accountOpenCount : exposure.count;
  const sameSideCount = positions.filter(
    (p) => p.symbol?.toUpperCase() === symbol && String(p.side ?? '').toUpperCase() === side,
  ).length;
  const pendingCount = await countPendingOpeningCommands(serialMode ? undefined : symbol);
  const tradesToday = await countTradesOpenedTodayForSymbol(symbol).catch(() => 0);
  const maxConcurrent = goldMaxConcurrentPositions();
  const maxDaily = goldMaxTradesPerDay();

  if (serialMode) {
    if (accountOpenCount > 0) {
      const openSymbols = [...new Set(positions.map((p) => String(p.symbol ?? '').toUpperCase()).filter(Boolean))];
      blockers.push(
        `Gold serial mode — close or complete the current trade before opening another (${accountOpenCount} open: ${openSymbols.join(', ')}).`,
      );
    }
    if (pendingCount > 0) {
      blockers.push(
        `Gold serial mode — ${pendingCount} pending opening command(s) must complete or cancel before a new entry.`,
      );
    }
  } else if (openCount >= maxConcurrent) {
    blockers.push(`Gold max concurrent positions reached (${openCount}/${maxConcurrent}).`);
  }

  if (tradesToday >= maxDaily) {
    blockers.push(`Gold daily trade limit reached (${tradesToday}/${maxDaily}).`);
  }

  const isStack = !serialMode && openCount > 0 && sameSideCount > 0;
  const isReentry = openCount === 0 && pendingCount === 0 && tradesToday > 0;

  if (isStack) {
    if (input.decision.confidenceScore < goldStackMinConfidence()) {
      blockers.push(
        `Stack requires confidence >= ${goldStackMinConfidence()}% (current ${input.decision.confidenceScore}%).`,
      );
    }
    if (input.decision.setupReadinessScore < goldStackMinReadiness()) {
      blockers.push(
        `Stack requires setup readiness >= ${goldStackMinReadiness()}% (current ${input.decision.setupReadinessScore}%).`,
      );
    }
    const duplicate = await hasRecentDuplicateGoldSignal({
      symbol,
      side,
      setupType: input.decision.setupType,
      strategyId: input.decision.selectedStrategyId ?? null,
      withinMinutes: 5,
    });
    if (duplicate) {
      blockers.push('Duplicate Gold stack blocked — same strategy/setup signal fired within 5 minutes without new confirmation.');
    }
  }

  if (isReentry) {
    const cooledDown = await isGoldReentryCooldownClear(symbol, side);
    if (!cooledDown) {
      blockers.push(
        `Gold re-entry cooldown active (${goldReentryCooldownMinutes()} min) — wait for retracement to institutional level.`,
      );
    }
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    openCount,
    sameSideCount,
    pendingCount,
    tradesToday,
    isStack,
    isReentry,
    serialMode,
  };
}

async function hasRecentDuplicateGoldSignal(input: {
  symbol: string;
  side: string;
  setupType: string;
  strategyId: string | null;
  withinMinutes: number;
}): Promise<boolean> {
  const result = await queryPostgres(
    `
      SELECT 1
      FROM autonomous_decision_logs
      WHERE upper(symbol) = $1
        AND decision = $2
        AND setup_type = $3
        AND COALESCE(strategy_id, '') = COALESCE($4, '')
        AND created_at > now() - ($5 || ' minutes')::interval
      LIMIT 1
    `,
    [input.symbol.toUpperCase(), input.side, input.setupType, input.strategyId, String(input.withinMinutes)],
  ).catch(() => ({ rows: [] }));
  return Boolean(result.rows[0]);
}

async function isGoldReentryCooldownClear(symbol: string, side: string): Promise<boolean> {
  const cooldownMin = goldReentryCooldownMinutes();
  const result = await queryPostgres(
    `
      SELECT MAX(COALESCE(o.reviewed_at, o.created_at)) AS last_close
      FROM autonomous_outcome_tracking o
      JOIN autonomous_decision_logs d ON d.id = o.decision_log_id
      WHERE upper(d.symbol) = $1
        AND d.decision = $2
        AND o.outcome_status <> 'pending'
    `,
    [symbol.toUpperCase(), side],
  ).catch(() => ({ rows: [{ last_close: null }] }));
  const lastClose = result.rows[0]?.last_close;
  if (!lastClose) return true;
  const ageMs = Date.now() - new Date(String(lastClose)).getTime();
  return ageMs >= cooldownMin * 60 * 1000;
}
