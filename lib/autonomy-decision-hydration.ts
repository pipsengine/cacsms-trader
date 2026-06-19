import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';

type DecisionRow = Record<string, unknown>;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nullableString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function numberValue(value: unknown, fallback: number | null = null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const REGIME_TAGS = ['trend', 'range', 'expansion', 'compression', 'reversal', 'high-volatility', 'news-risk'] as const;
type RegimeTag = typeof REGIME_TAGS[number];

function normalizeRegimeTag(value: unknown): RegimeTag {
  const text = String(value ?? '').toLowerCase();
  return REGIME_TAGS.find((tag) => tag === text) ?? 'range';
}

/** Reconstruct full autonomous decision context from a DB row + evidence JSON. */
export function hydrateAutonomousDecisionFromRow(row: DecisionRow): AutonomousDecisionOutput & { decisionLogId: string } {
  const evidence = objectValue(row.decision_evidence_json);
  const scores = objectValue(evidence.scores);
  const storedSignal = objectValue(scores.signalScore);
  const storedPlan = objectValue(evidence.institutionalPlan);
  const storedRegime = objectValue(evidence.regimeClassification);
  const storedAllocation = objectValue(evidence.capitalAllocation);
  const marketRegime = String(row.market_regime ?? storedRegime.primary ?? 'range').trim();

  const regimeTags = Array.isArray(storedRegime.tags)
    ? storedRegime.tags.map((tag) => normalizeRegimeTag(tag))
    : [normalizeRegimeTag(marketRegime)];

  const institutionalPlan = Object.keys(storedPlan).length > 0
    ? storedPlan as NonNullable<AutonomousDecisionOutput['institutionalPlan']>
    : {
        sequence: [],
        htfBias: String(row.htf_bias ?? 'neutral'),
        ltfBias: String(row.ltf_trigger ?? 'neutral'),
        conflict: false,
        countertrendAllowed: false,
        rangingContextActive: normalizeRegimeTag(marketRegime) === 'range'
          || normalizeRegimeTag(marketRegime) === 'compression'
          || regimeTags.includes('range')
          || regimeTags.includes('compression'),
        conflictPolicy: 'Reconstructed from stored decision metadata.',
      };

  const signalScore = Object.keys(storedSignal).length > 0
    ? {
        expectedR: Number(storedSignal.expectedR ?? 0),
        probabilityScore: Number(storedSignal.probabilityScore ?? 0),
        riskScore: Number(storedSignal.riskScore ?? row.risk_score ?? 0),
        confidenceSource: String(storedSignal.confidenceSource ?? 'stored_decision'),
        modelVersion: String(storedSignal.modelVersion ?? 'stored_decision_v1'),
      }
    : undefined;

  const capitalAllocation = Object.keys(storedAllocation).length > 0
    ? storedAllocation as NonNullable<AutonomousDecisionOutput['capitalAllocation']>
    : undefined;

  return {
    decisionLogId: String(row.id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    dominantTimeframe: String(row.dominant_timeframe ?? row.timeframe),
    tradingStyle: nullableString(row.trading_style) as AutonomousDecisionOutput['tradingStyle'],
    finalBias: String(row.final_bias ?? 'neutral'),
    setupType: String(row.setup_type ?? 'market structure assessment'),
    setupReadinessScore: Number(row.setup_readiness_score ?? 0),
    confidenceScore: Number(row.confidence_score ?? 0),
    riskScore: Number(row.risk_score ?? 0),
    decision: String(row.decision) as AutonomousDecisionOutput['decision'],
    entryZone: (row.entry_zone_json as AutonomousDecisionOutput['entryZone']) ?? { status: 'not_ready', narrative: '' },
    stopLoss: row.stop_loss == null ? null : Number(row.stop_loss),
    takeProfitLevels: Array.isArray(row.take_profit_levels_json) ? row.take_profit_levels_json.map(Number) : [],
    invalidationLevel: row.invalidation_level == null ? null : Number(row.invalidation_level),
    reasonForDecision: String(row.reason_for_decision ?? ''),
    reasonAgainstDecision: String(row.reason_against_decision ?? ''),
    macroRiskWarning: String(row.macro_risk_warning ?? ''),
    liquidityWarning: String(row.liquidity_warning ?? ''),
    anomalyWarning: String(row.anomaly_warning ?? ''),
    recommendedNextAction: String(row.recommended_next_action ?? ''),
    selectedStrategyId: nullableString(row.strategy_id),
    selectedStrategyLabel: nullableString(evidence.selectedStrategyLabel),
    strategyBookScore: numberValue(scores.strategyBookScore),
    strategyBookConsensus: nullableString(objectValue(evidence.strategyBook).bookDecision),
    institutionalPlan,
    regimeClassification: {
      primary: normalizeRegimeTag(storedRegime.primary ?? marketRegime),
      tags: regimeTags,
      confidence: Number(storedRegime.confidence ?? 0),
      source: String(storedRegime.source ?? 'stored_decision'),
    },
    capitalAllocation,
    signalScore,
  };
}

export function isRetryableExecutionBlocker(blockers: string[]): boolean {
  return blockers.some((item) =>
    /stop loss|take profit|HTF bias|Gold minimum|Reward:risk|Expected R|institutional quality|Entry optimization|expansion candle|retracement confirmation|M15 execution|intermediate structure|top-down|macro trend|daily trade limit/i.test(item),
  );
}

export function isTerminalExecutionBlocker(blockers: string[]): boolean {
  return blockers.some((item) =>
    /hedge blocked|setup active|setup exposure full|max setup exposure|max concurrent|Gold setup in progress|already open on/i.test(item),
  );
}
