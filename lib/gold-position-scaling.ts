import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import {
  goldMaxConcurrentPositions,
  goldMaxSetupExposure,
  goldMaxTradesPerDay,
  goldSerialTradingEnabled,
  goldStackMinConfidence,
  goldStackMinReadiness,
  goldBatchEntryEnabled,
  goldEntryLegCount,
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

async function countPendingOpeningCommands(symbol?: string, side?: string): Promise<number> {
  const params: string[] = [];
  const conditions = [
    `upper(replace(c.type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')`,
    `c.lifecycle_state IN ('QUEUED', 'ROUTING', 'SENT', 'ACKNOWLEDGED')`,
  ];
  if (symbol) {
    params.push(symbol.toUpperCase());
    conditions.push(`upper(c.symbol) = $${params.length}`);
  }
  if (side) {
    params.push(side.toUpperCase());
    conditions.push(`upper(coalesce(c.side, c.payload->>'side', '')) = $${params.length}`);
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

  await import('@/lib/gold-pending-order-cleanup').then((m) => m.cleanupGoldPendingOrders()).catch(() => 0);

  const exposure = await getOpenPositionExposureForSymbol(symbol).catch(() => ({ count: 0, volumeLots: 0 }));
  const positions = await listOpenPositions({ limit: 50 }).catch(() => []);
  const accountOpenCount = positions.length;
  const openCount = serialMode ? accountOpenCount : exposure.count;
  const sameSideCount = positions.filter(
    (p) => p.symbol?.toUpperCase() === symbol && String(p.side ?? '').toUpperCase() === side,
  ).length;
  const oppositeSide = side === 'BUY' ? 'SELL' : 'BUY';
  const oppositeSideCount = positions.filter(
    (p) => p.symbol?.toUpperCase() === symbol && String(p.side ?? '').toUpperCase() === oppositeSide,
  ).length;
  const pendingCount = await countPendingOpeningCommands(serialMode ? undefined : symbol);
  const pendingOppositeCount = await countPendingOpeningCommands(symbol, oppositeSide);
  const tradesToday = await countTradesOpenedTodayForSymbol(symbol).catch(() => 0);
  const maxConcurrent = goldMaxConcurrentPositions();
  const maxDaily = goldMaxTradesPerDay();

  if (!serialMode && (oppositeSideCount > 0 || pendingOppositeCount > 0)) {
    blockers.push(
      `Gold hedge blocked — close ${oppositeSideCount > 0 ? `${oppositeSideCount} open ${oppositeSide}` : ''}${oppositeSideCount > 0 && pendingOppositeCount > 0 ? ' and ' : ''}${pendingOppositeCount > 0 ? `${pendingOppositeCount} pending ${oppositeSide}` : ''} on ${symbol} before opening ${side}.`,
    );
    return {
      allowed: false,
      blockers,
      openCount,
      sameSideCount,
      pendingCount,
      tradesToday,
      isStack: false,
      isReentry: false,
      serialMode,
    };
  }

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
  } else {
    const batchLegs = goldBatchEntryEnabled() ? goldEntryLegCount() : 1;
    const projectedOpen = openCount + pendingCount + (openCount === 0 && sameSideCount === 0 ? batchLegs : 1);
    if (projectedOpen > maxConcurrent) {
      blockers.push(`Gold max concurrent positions would be exceeded (${projectedOpen}/${maxConcurrent}).`);
    }
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
      blockers.push(`Gold setup active — ${sameSideCount} ${side} leg(s) open; additional ${side} entries paused (duplicate signal within 5 minutes).`);
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

/** Downgrade fresh BUY/SELL signals when Gold legs are already open. */
export async function gateGoldDecisionForOpenPositions(input: {
  symbol: string;
  decision: string;
}): Promise<{
  decision: 'MONITOR';
  reasonForDecision: string;
  reasonAgainstDecision: string;
} | null> {
  if (!isGoldSymbol(input.symbol)) return null;
  if (input.decision !== 'BUY' && input.decision !== 'SELL') return null;

  const symbol = input.symbol.toUpperCase();
  const side = input.decision;
  const oppositeSide = side === 'BUY' ? 'SELL' : 'BUY';
  const positions = await listOpenPositions({ limit: 50 }).catch(() => []);
  const goldPositions = positions.filter((p) => p.symbol?.toUpperCase() === symbol);
  if (goldPositions.length === 0) return null;

  const sameSidePositions = goldPositions.filter((p) => String(p.side ?? '').toUpperCase() === side);
  const oppositeSidePositions = goldPositions.filter((p) => String(p.side ?? '').toUpperCase() === oppositeSide);
  const sides = new Set(goldPositions.map((p) => String(p.side ?? '').toUpperCase()).filter(Boolean));

  if (sides.size > 1) {
    return {
      decision: 'MONITOR',
      reasonForDecision: `Hedged ${symbol} exposure (${goldPositions.length} mixed legs) — monitoring until flat.`,
      reasonAgainstDecision: 'New entries blocked while both BUY and SELL legs are open.',
    };
  }

  if (oppositeSidePositions.length > 0) {
    return {
      decision: 'MONITOR',
      reasonForDecision: `Open ${oppositeSide} on ${symbol} — reverse ${side} blocked until opposite legs close.`,
      reasonAgainstDecision: `Close ${oppositeSidePositions.length} ${oppositeSide} leg(s) before opening ${side}.`,
    };
  }

  if (sameSidePositions.length > 0) {
    const maxSetup = goldMaxSetupExposure();
    if (sameSidePositions.length >= maxSetup) {
      return {
        decision: 'MONITOR',
        reasonForDecision: `Setup exposure full (${sameSidePositions.length}/${maxSetup} ${side} legs on ${symbol}).`,
        reasonAgainstDecision: 'Trade monitor managing open legs.',
      };
    }
    return {
      decision: 'MONITOR',
      reasonForDecision: `${sameSidePositions.length} ${side} leg(s) open on ${symbol} — monitoring existing setup.`,
      reasonAgainstDecision: 'Additional batch entries suppressed while legs are active.',
    };
  }

  return null;
}
