import { loadGoldStructureEntryAnchors } from '@/lib/gold-structure-anchors';
import { planAutonomousRetracementEntry } from '@/lib/autonomous-entry-planner';
import { goldReentryCooldownMinutes, GOLD_SYMBOL } from '@/lib/gold-trading-engine';
import { queryPostgres } from '@/lib/postgres';
import type { AutonomousTradeSide } from '@/lib/autonomous-stop-targets';

export type GoldReentryValidation = {
  allowed: boolean;
  blockers: string[];
  isFreshSetup: boolean;
  atInstitutionalLevel: boolean;
};

async function lastCloseTime(symbol: string, side: string): Promise<Date | null> {
  const result = await queryPostgres(
    `
      SELECT MAX(COALESCE(o.reviewed_at, o.created_at)) AS last_close
      FROM autonomous_outcome_tracking o
      JOIN autonomous_decision_logs d ON d.id = o.decision_log_id
      WHERE upper(d.symbol) = $1
        AND d.decision = $2
        AND o.outcome_status <> 'pending'
    `,
    [symbol.toUpperCase(), side.toUpperCase()],
  ).catch(() => ({ rows: [{ last_close: null }] }));
  const raw = result.rows[0]?.last_close;
  return raw ? new Date(String(raw)) : null;
}

async function hasFreshStructureEventSince(symbol: string, side: string, since: Date | null): Promise<boolean> {
  const captureResult = await queryPostgres(
    `SELECT id FROM chart_captures WHERE upper(symbol) = $1 ORDER BY captured_at DESC LIMIT 1`,
    [symbol.toUpperCase()],
  ).catch(() => ({ rows: [] }));
  const captureId = String(captureResult.rows[0]?.id ?? '');
  if (!captureId) return false;

  const direction = side.toUpperCase() === 'BUY' ? 'bullish' : 'bearish';
  const params: (string | number)[] = [captureId, direction];
  let timeFilter = '';
  if (since) {
    params.push(since.toISOString());
    timeFilter = `AND created_at > $3::timestamptz`;
  }

  const events = await queryPostgres(
    `
      SELECT 1 FROM structure_events
      WHERE chart_capture_id = $1
        AND lower(direction) = $2
        AND event_type IN ('BOS', 'CHOCH')
        AND validation_score >= 0.45
        ${timeFilter}
      LIMIT 1
    `,
    params,
  ).catch(() => ({ rows: [] }));

  return Boolean(events.rows[0]);
}

export async function validateGoldInstitutionalReentry(input: {
  symbol: string;
  side: AutonomousTradeSide;
  currentPrice: number;
  stopLoss: number;
  rewardRiskRatio: number;
  timeframe?: string;
}): Promise<GoldReentryValidation> {
  const symbol = input.symbol.toUpperCase();
  const side = input.side;
  const blockers: string[] = [];

  if (symbol !== GOLD_SYMBOL && !symbol.startsWith('XAU')) {
    return { allowed: true, blockers: [], isFreshSetup: true, atInstitutionalLevel: true };
  }

  const lastClose = await lastCloseTime(symbol, side);
  if (lastClose) {
    const cooldownMs = goldReentryCooldownMinutes() * 60_000;
    if (Date.now() - lastClose.getTime() < cooldownMs) {
      blockers.push(
        `Gold re-entry cooldown active (${goldReentryCooldownMinutes()} min since last ${side} close).`,
      );
    }
  }

  const freshSetup = await hasFreshStructureEventSince(symbol, side, lastClose);
  if (lastClose && !freshSetup) {
    blockers.push('Re-entry requires fresh BOS/CHoCH confirmation after the prior close.');
  }

  const plan = await planAutonomousRetracementEntry({
    symbol,
    timeframe: input.timeframe ?? 'M15',
    side,
    currentPrice: input.currentPrice,
    stopLoss: input.stopLoss,
    rewardRiskRatio: input.rewardRiskRatio,
  });

  let atInstitutionalLevel = false;
  if (plan) {
    const inZone = input.currentPrice >= plan.zoneLow && input.currentPrice <= plan.zoneHigh;
    const nearZone =
      Math.abs(input.currentPrice - plan.pendingEntryPrice) <=
      Math.max(Math.abs(plan.zoneHigh - plan.zoneLow) * 1.5, 0.5);
    atInstitutionalLevel = inZone || nearZone;
  }

  const anchors = await loadGoldStructureEntryAnchors({
    symbol,
    timeframe: input.timeframe ?? 'M15',
    side,
  });
  if (!atInstitutionalLevel && anchors.length > 0) {
    atInstitutionalLevel = anchors.some(
      (a) => Math.abs(input.currentPrice - a.price) <= Math.max(input.currentPrice * 0.0015, 1.2),
    );
  }

  if (lastClose && !atInstitutionalLevel) {
    blockers.push('Re-entry blocked — price has not retraced to a valid institutional level (OB/FVG/structure).');
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    isFreshSetup: freshSetup || !lastClose,
    atInstitutionalLevel,
  };
}
