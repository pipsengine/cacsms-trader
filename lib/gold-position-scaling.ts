import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import {
  goldMaxConcurrentPositions,
  goldMaxSetupExposure,
  goldMaxTradesPerDay,
  goldSerialTradingEnabled,
  goldStackMinConfidence,
  goldStackMinReadiness,
  isGoldSymbol,
} from '@/lib/gold-trading-engine';
import { validateGoldInstitutionalReentry } from '@/lib/gold-reentry-validator';
import { resolveGoldLivePrice } from '@/lib/gold-execution-quality';
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
    | 'symbol'
    | 'decision'
    | 'confidenceScore'
    | 'setupReadinessScore'
    | 'setupType'
    | 'selectedStrategyId'
    | 'stopLoss'
    | 'takeProfitLevels'
    | 'timeframe'
    | 'signalScore'
  >;
  terminalId?: string | null;
  currentPrice?: number | null;
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

  await import('@/lib/gold-pending-order-cleanup').then((m) => m.cleanupGoldSerialPendingOrders()).catch(() => 0);

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
    const setupLegs = sameSideCount + (serialMode ? 0 : pendingCount);
    if (setupLegs >= goldMaxSetupExposure()) {
      blockers.push(`Gold max setup exposure reached (${setupLegs}/${goldMaxSetupExposure()} legs on this opportunity).`);
    }
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
    const livePrice = input.currentPrice ?? (await resolveGoldLivePrice(symbol));
    const stopLoss = Number(input.decision.stopLoss ?? 0);
    const takeProfit = Number(input.decision.takeProfitLevels?.[0] ?? 0);
    const expectedR = input.decision.signalScore?.expectedR ?? 0;
    let rewardRiskRatio = expectedR > 0 ? expectedR : 2;
    if (livePrice && stopLoss > 0 && takeProfit > 0) {
      const risk = Math.abs(livePrice - stopLoss);
      const reward = Math.abs(takeProfit - livePrice);
      if (risk > 0) rewardRiskRatio = Number((reward / risk).toFixed(4));
    }
    const reentry = await validateGoldInstitutionalReentry({
      symbol,
      side: side as 'BUY' | 'SELL',
      currentPrice: livePrice ?? 0,
      stopLoss,
      rewardRiskRatio,
      timeframe: input.decision.timeframe ?? 'M15',
    }).catch(() => ({ allowed: false, blockers: ['Re-entry validation failed.'] }));
    if (!livePrice || livePrice <= 0) {
      blockers.push('Gold re-entry blocked — live price unavailable for institutional level confirmation.');
    }
    blockers.push(...reentry.blockers);
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
