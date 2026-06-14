import { getContinuousRefillDecisionThresholds, getDecisionThresholds } from './autonomy-account-profiles';
import { getTradingStyleProfile } from './trading-styles/registry';
import { shouldBypassNewsBlackout } from './trading-session-policy';
import { mapBookSideToAutonomy } from '@/lib/strategies/strategy-book-scoring';
import type { AutonomousDecisionInput, AutonomousDecisionOutput, AutonomyDecision } from './autonomy-types';

function resolveStyleRefillThresholds(input: { accountClass?: string; tradingStyle?: AutonomousDecisionInput['tradingStyle'] }) {
  const base = getContinuousRefillDecisionThresholds((input.accountClass ?? 'demo') as 'demo');
  if (!input.tradingStyle) return base;
  const profile = getTradingStyleProfile(input.tradingStyle);
  return {
    confidence: Math.min(base.confidence, profile.confidenceFloor),
    readiness: Math.min(base.readiness, profile.readinessFloor),
    visualReadiness: Math.min(base.visualReadiness, profile.readinessFloor + 8),
  };
}

export function buildAutonomousDecision(input: AutonomousDecisionInput): AutonomousDecisionOutput {
  const visual = input.visual ?? {};
  const macro = input.macro ?? {};
  const execution = input.execution ?? {};
  const confidenceScore = clamp(Number(visual.confidenceScore ?? 0), 0, 100);
  const setupReadinessScore = clamp(Number(visual.setupReadinessScore ?? 0), 0, 100);
  const economicRisk = clamp(Number(macro.economicRiskScore ?? 0), 0, 100);
  const spreadRisk = 100 - clamp(Number(execution.spreadScore ?? 75), 0, 100);
  const dataRisk = 100 - clamp(Number(execution.dataQualityScore ?? 65), 0, 100);
  const captureRisk = 100 - clamp(Number(execution.captureQualityScore ?? 65), 0, 100);
  const riskScore = Math.round(clamp(economicRisk * 0.35 + spreadRisk * 0.25 + dataRisk * 0.2 + captureRisk * 0.2, 0, 100));
  const finalBias = normalizeBias(visual.finalMarketBias);
  const baseDecision = normalizeDecision(visual.finalDecision);
  const blockers = collectBlockers({ confidenceScore, setupReadinessScore, riskScore, input });
  const strategyFusion = fuseStrategyBook({
    visualDecision: baseDecision,
    visualBias: finalBias,
    visualConfidence: confidenceScore,
    visualReadiness: setupReadinessScore,
    strategyBook: input.strategyBook ?? null,
    refillMode: Boolean(input.refillMode),
  });
  const decision = downgradeDecision(
    strategyFusion.decision,
    strategyFusion.bias,
    [...blockers, ...strategyFusion.blockers],
    Boolean(input.refillMode),
  );
  const fusedConfidence = strategyFusion.confidenceScore;
  const fusedReadiness = strategyFusion.setupReadinessScore;
  const setupType = strategyFusion.setupType ?? inferSetupType(String(visual.marketPhase ?? ''), String(visual.liquidityObjective ?? ''));

  return {
    symbol: input.symbol.toUpperCase(),
    timeframe: input.timeframe.toUpperCase(),
    tradingStyle: input.tradingStyle,
    dominantTimeframe: input.dominantTimeframe ?? input.timeframe.toUpperCase(),
    finalBias: strategyFusion.bias,
    setupType,
    setupReadinessScore: Math.round(fusedReadiness),
    confidenceScore: Math.round(fusedConfidence),
    riskScore,
    decision,
    entryZone: buildEntryZone(decision, visual.entryReadiness),
    stopLoss: null,
    takeProfitLevels: [],
    invalidationLevel: null,
    reasonForDecision: strategyFusion.reasonForDecision,
    reasonAgainstDecision: blockers.length || strategyFusion.blockers.length
      ? [...blockers, ...strategyFusion.blockers].join(' ')
      : 'No hard autonomous blocker is active from the available evidence.',
    macroRiskWarning: macro.warning ?? (economicRisk >= 65 ? 'Macro risk is elevated near high-impact conditions.' : 'No high-impact macro blocker is available from current data.'),
    liquidityWarning: visual.liquidityObjective ?? 'Liquidity context is not available; the system will not force an execution signal.',
    anomalyWarning: visual.riskWarning ?? 'No visual anomaly warning is available from the latest result.',
    recommendedNextAction: nextAction(decision),
    selectedStrategyId: strategyFusion.selectedStrategyId,
    selectedStrategyLabel: strategyFusion.selectedStrategyLabel,
    strategyBookScore: strategyFusion.strategyBookScore,
    strategyBookConsensus: strategyFusion.strategyBookConsensus,
  };
}

function fuseStrategyBook(input: {
  visualDecision: AutonomyDecision;
  visualBias: string;
  visualConfidence: number;
  visualReadiness: number;
  strategyBook: AutonomousDecisionInput['strategyBook'];
  refillMode: boolean;
}): {
  decision: AutonomyDecision;
  bias: string;
  confidenceScore: number;
  setupReadinessScore: number;
  setupType?: string;
  blockers: string[];
  reasonForDecision: string;
  selectedStrategyId: string | null;
  selectedStrategyLabel: string | null;
  strategyBookScore: number | null;
  strategyBookConsensus: string | null;
} {
  const book = input.strategyBook;
  if (!book || book.healthyCount < 5 || !book.bestStrategy) {
    return {
      decision: input.visualDecision,
      bias: input.visualBias,
      confidenceScore: input.visualConfidence,
      setupReadinessScore: input.visualReadiness,
      blockers: [],
      reasonForDecision: reasonFor(input.visualDecision, input.visualBias, input.visualReadiness, input.visualConfidence),
      selectedStrategyId: null,
      selectedStrategyLabel: null,
      strategyBookScore: null,
      strategyBookConsensus: book?.bookDecision ?? null,
    };
  }

  const leader = book.bestStrategy;
  const bookSide = mapBookSideToAutonomy(leader.decision);
  const bookBias = leader.decision === 'buy' ? 'bullish' : leader.decision === 'sell' ? 'bearish' : input.visualBias;
  const blockers: string[] = [];
  const visualSide = input.visualDecision === 'BUY' || input.visualDecision === 'SELL' ? input.visualDecision : null;

  let decision: AutonomyDecision = input.visualDecision;
  if (leader.score >= 55 && bookSide !== 'WAIT') {
    if (!visualSide || visualSide === bookSide || input.visualDecision === 'WAIT' || input.visualDecision === 'MONITOR') {
      decision = bookSide;
    } else if (leader.score >= 72 && book.healthyCount >= 12) {
      decision = input.refillMode ? bookSide : 'MONITOR';
      if (decision === 'MONITOR') {
        blockers.push(`Visual ${visualSide} conflicts with strategy book leader ${leader.label} (${bookSide}).`);
      }
    } else {
      decision = 'MONITOR';
      blockers.push(`Visual ${visualSide} conflicts with strategy book leader ${leader.label} (${bookSide}).`);
    }
  } else if (book.bookDecision === 'neutral' && leader.score < 45) {
    if (input.visualDecision === 'BUY' || input.visualDecision === 'SELL') {
      decision = input.refillMode ? input.visualDecision : 'MONITOR';
      blockers.push('Strategy book lacks actionable consensus for this symbol.');
    }
  }

  const confidenceScore = Math.round(
    clamp(input.visualConfidence * 0.4 + leader.score * 0.45 + leader.confidence * 0.15, 0, 100),
  );
  const setupReadinessScore = Math.round(
    clamp(input.visualReadiness * 0.45 + leader.score * 0.55, 0, 100),
  );
  const setupType = `${leader.label} (${leader.id})`;
  const winRateText = leader.winRate != null && leader.sampleSize >= 3
    ? ` · ${(leader.winRate * 100).toFixed(1)}% win rate`
    : '';
  const reasonForDecision = `${decision} selected using strategy book leader ${leader.label} (${leader.score}/100${winRateText}) fused with visual confidence ${Math.round(input.visualConfidence)}. ${book.reasons[0] ?? ''}`.trim();

  return {
    decision,
    bias: bookBias,
    confidenceScore,
    setupReadinessScore,
    setupType,
    blockers,
    reasonForDecision,
    selectedStrategyId: leader.id,
    selectedStrategyLabel: leader.label,
    strategyBookScore: leader.score,
    strategyBookConsensus: book.bookDecision,
  };
}

function collectBlockers(input: { confidenceScore: number; setupReadinessScore: number; riskScore: number; input: AutonomousDecisionInput }) {
  const blockers: string[] = [];
  const text = `${input.input.visual?.riskWarning ?? ''} ${input.input.visual?.liquidityObjective ?? ''}`.toLowerCase();
  const thresholds = input.input.refillMode
    ? resolveStyleRefillThresholds(input.input)
    : getDecisionThresholds(input.input.accountClass ?? 'demo');
  const confidenceThreshold = thresholds.confidence;
  const readinessThreshold = thresholds.readiness;
  if (input.confidenceScore < confidenceThreshold) blockers.push('Confidence is below autonomous signal threshold.');
  if (input.setupReadinessScore < readinessThreshold) blockers.push('Setup readiness is not mature.');
  if (input.riskScore >= 70) blockers.push('Risk score is too high for autonomous escalation.');
  if (text.includes('critical') || text.includes('unclear')) blockers.push('Visual anomaly or liquidity clarity blocks execution.');
  if (
    !shouldBypassNewsBlackout()
    && !input.input.refillMode
    && input.input.macro?.warning?.toLowerCase().includes('high-impact')
  ) {
    blockers.push('High-impact macro risk is active.');
  }
  return blockers;
}

function downgradeDecision(
  decision: AutonomyDecision,
  bias: string,
  blockers: string[],
  refillMode = false,
): AutonomyDecision {
  const hardBlock = blockers.some((item) =>
    item.includes('Risk score')
    || (!shouldBypassNewsBlackout() && item.includes('High-impact'))
    || item.includes('critical'),
  );
  if (refillMode && (decision === 'BUY' || decision === 'SELL') && !hardBlock) {
    return decision;
  }
  if (hardBlock) return 'AVOID';
  if (blockers.length) return 'MONITOR';
  if (decision === 'BUY' && (bias === 'bullish' || (refillMode && bias === 'mixed'))) return 'BUY';
  if (decision === 'SELL' && (bias === 'bearish' || (refillMode && bias === 'mixed'))) return 'SELL';
  if (decision === 'WAIT' || decision === 'AVOID' || decision === 'MONITOR') return decision;
  return 'WAIT';
}

function normalizeDecision(value: unknown): AutonomyDecision {
  const text = String(value ?? '').toUpperCase();
  if (['BUY', 'SELL', 'WAIT', 'AVOID', 'MONITOR'].includes(text)) return text as AutonomyDecision;
  return 'MONITOR';
}

function normalizeBias(value: unknown) {
  const text = String(value ?? 'neutral').toLowerCase();
  if (text.includes('bull')) return 'bullish';
  if (text.includes('bear')) return 'bearish';
  if (text.includes('mixed')) return 'mixed';
  return 'neutral';
}

function inferSetupType(phase: string, liquidity: string) {
  const text = `${phase} ${liquidity}`.toLowerCase();
  if (text.includes('sweep') || text.includes('trap')) return 'liquidity sweep confirmation';
  if (text.includes('expansion') || text.includes('breakout')) return 'expansion continuation';
  if (text.includes('compression') || text.includes('consolidation')) return 'compression breakout watch';
  if (text.includes('reversal')) return 'reversal attempt';
  return 'market structure assessment';
}

function buildEntryZone(decision: AutonomyDecision, entryReadiness: unknown) {
  return { status: decision === 'BUY' || decision === 'SELL' ? 'conditional' : 'not_ready', narrative: String(entryReadiness ?? 'Entry zone waits for confirmed visual and risk alignment.') };
}

function reasonFor(decision: AutonomyDecision, bias: string, readiness: number, confidence: number) {
  return `${decision} selected with ${bias} bias, ${Math.round(readiness)} setup readiness, and ${Math.round(confidence)} confidence after autonomous fusion.`;
}

function nextAction(decision: AutonomyDecision) {
  if (decision === 'BUY' || decision === 'SELL') return 'Generate alert and prepare assisted trade plan under configured risk controls.';
  if (decision === 'WAIT') return 'Wait for lower-timeframe confirmation at candle close.';
  if (decision === 'AVOID') return 'Block signal generation until risk or data quality improves.';
  return 'Continue monitoring and rerun the autonomous stack on the next scheduled candle.';
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
