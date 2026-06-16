import { getContinuousRefillDecisionThresholds, getDecisionThresholds } from './autonomy-account-profiles';
import { isRangeOrientedContext } from './gold-trade-context';
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
  const regimeClassification = classifyRegime({ visual, macro, execution, riskScore });
  const strategyFusion = fuseStrategyBook({
    visualDecision: baseDecision,
    visualBias: finalBias,
    visualConfidence: confidenceScore,
    visualReadiness: setupReadinessScore,
    strategyBook: input.strategyBook ?? null,
    refillMode: Boolean(input.refillMode),
  });
  const fusedConfidence = strategyFusion.confidenceScore;
  const fusedReadiness = strategyFusion.setupReadinessScore;
  const setupType = strategyFusion.setupType ?? inferSetupType(String(visual.marketPhase ?? ''), String(visual.liquidityObjective ?? ''));
  const decision = downgradeDecision(
    strategyFusion.decision,
    strategyFusion.bias,
    [...blockers, ...strategyFusion.blockers],
    Boolean(input.refillMode),
    regimeClassification.primary,
  );
  const institutionalPlan = buildInstitutionalPlan({
    visual,
    decision,
    finalBias: strategyFusion.bias,
    strategyBook: input.strategyBook ?? null,
    regime: regimeClassification.primary,
    selectedStrategyId: strategyFusion.selectedStrategyId,
    setupType,
  });
  const conflictAdjustedDecision = applyInstitutionalConflictPolicy(decision, institutionalPlan);
  const signalScore = scoreSignalModel({
    decision: conflictAdjustedDecision,
    confidenceScore: fusedConfidence,
    readinessScore: fusedReadiness,
    riskScore,
    strategyBook: input.strategyBook ?? null,
    regime: regimeClassification.primary,
  });
  const capitalAllocation = allocateCapital({
    decision: conflictAdjustedDecision,
    confidenceScore: fusedConfidence,
    readinessScore: fusedReadiness,
    riskScore,
    signalScore,
    regime: regimeClassification.primary,
    institutionalPlan,
  });
  const institutionalBlocker = conflictAdjustedDecision !== decision
    ? `Top-down conflict policy downgraded ${decision} to ${conflictAdjustedDecision}.`
    : capitalAllocation.riskTier === 'blocked'
      ? capitalAllocation.rationale
      : '';
  const finalDecision = capitalAllocation.riskTier === 'blocked' && (conflictAdjustedDecision === 'BUY' || conflictAdjustedDecision === 'SELL')
    ? 'MONITOR'
    : conflictAdjustedDecision;
  const reasonAgainstDecision = [
    blockers.length || strategyFusion.blockers.length
      ? [...blockers, ...strategyFusion.blockers].join(' ')
      : 'No hard autonomous blocker is active from the available evidence.',
    institutionalBlocker,
  ].filter(Boolean).join(' ');

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
    decision: finalDecision,
    entryZone: buildEntryZone(finalDecision, visual.entryReadiness),
    stopLoss: null,
    takeProfitLevels: [],
    invalidationLevel: null,
    reasonForDecision: `${strategyFusion.reasonForDecision} Regime=${regimeClassification.primary}; allocation=${capitalAllocation.riskTier}; expectedR=${signalScore.expectedR}.`,
    reasonAgainstDecision,
    macroRiskWarning: macro.warning ?? (economicRisk >= 65 ? 'Macro risk is elevated near high-impact conditions.' : 'No high-impact macro blocker is available from current data.'),
    liquidityWarning: visual.liquidityObjective ?? 'Liquidity context is not available; the system will not force an execution signal.',
    anomalyWarning: visual.riskWarning ?? 'No visual anomaly warning is available from the latest result.',
    recommendedNextAction: nextAction(finalDecision),
    selectedStrategyId: strategyFusion.selectedStrategyId,
    selectedStrategyLabel: strategyFusion.selectedStrategyLabel,
    strategyBookScore: strategyFusion.strategyBookScore,
    strategyBookConsensus: strategyFusion.strategyBookConsensus,
    institutionalPlan,
    regimeClassification,
    capitalAllocation,
    signalScore,
  };
}

type RegimeTag = NonNullable<AutonomousDecisionOutput['regimeClassification']>['primary'];

function classifyRegime(input: {
  visual: NonNullable<AutonomousDecisionInput['visual']>;
  macro: NonNullable<AutonomousDecisionInput['macro']>;
  execution: NonNullable<AutonomousDecisionInput['execution']>;
  riskScore: number;
}): NonNullable<AutonomousDecisionOutput['regimeClassification']> {
  const text = [
    input.visual.marketPhase,
    input.visual.liquidityObjective,
    input.visual.riskWarning,
    input.macro.warning,
    input.execution.sessionState,
  ].map((item) => String(item ?? '').toLowerCase()).join(' ');
  const tags = new Set<RegimeTag>();
  if (/news|high-impact|blackout|event|cpi|nfp|rate/.test(text)) tags.add('news-risk');
  if (/high.vol|volatile|spike|slippage|wide spread/.test(text) || input.riskScore >= 70) tags.add('high-volatility');
  if (/reversal|choch|change of character|failure swing/.test(text)) tags.add('reversal');
  if (/compression|coil|squeeze|consolidat/.test(text)) tags.add('compression');
  if (/expansion|breakout|displacement|impulse/.test(text)) tags.add('expansion');
  if (/range|sideways|balanced|mean reversion/.test(text)) tags.add('range');
  if (/trend|continuation|bos|higher high|lower low/.test(text)) tags.add('trend');
  if (tags.size === 0) tags.add('range');
  const priority: RegimeTag[] = ['news-risk', 'high-volatility', 'reversal', 'expansion', 'compression', 'trend', 'range'];
  const primary = priority.find((tag) => tags.has(tag)) ?? 'range';
  return {
    primary,
    tags: Array.from(tags),
    confidence: primary === 'range' && tags.size === 1 ? 45 : Math.min(90, 52 + tags.size * 9 + (input.riskScore >= 70 ? 10 : 0)),
    source: 'visual market phase + liquidity text + macro warning + execution risk',
  };
}

function buildInstitutionalPlan(input: {
  visual: NonNullable<AutonomousDecisionInput['visual']>;
  decision: AutonomyDecision;
  finalBias: string;
  strategyBook: AutonomousDecisionInput['strategyBook'];
  regime: RegimeTag;
  selectedStrategyId: string | null;
  setupType: string;
}): NonNullable<AutonomousDecisionOutput['institutionalPlan']> {
  const states = Array.isArray((input.visual as Record<string, unknown>).timeframeStates)
    ? (input.visual as Record<string, unknown>).timeframeStates as Array<Record<string, unknown>>
    : [];
  const stateFor = (timeframe: string) => states.find((state) => String(state.timeframe ?? '').toUpperCase() === timeframe);
  const fallbackBias = normalizeBias(input.visual.finalMarketBias ?? input.finalBias);
  const stage = (
    label: NonNullable<AutonomousDecisionOutput['institutionalPlan']>['sequence'][number]['stage'],
    timeframe: string,
    wantedBias: string,
    defaultNarrative: string,
  ) => {
    const state = stateFor(timeframe);
    const bias = normalizeBias(state?.bias ?? wantedBias);
    const score = clamp(Number(state?.controlScore ?? input.visual.confidenceScore ?? 0), 0, 100);
    const missing = !state && timeframe !== 'execution';
    return {
      stage: label,
      timeframe,
      bias: missing ? 'unknown' : bias,
      status: missing ? 'missing' as const : bias === wantedBias ? 'aligned' as const : 'conflict' as const,
      score: Math.round(score),
      narrative: String(state?.narrative ?? defaultNarrative),
    };
  };
  const wdBias = normalizeBias(stateFor('W')?.bias ?? stateFor('D')?.bias ?? fallbackBias);
  const h4Bias = normalizeBias(stateFor('H4')?.bias ?? fallbackBias);
  const h1Bias = normalizeBias(stateFor('H1')?.bias ?? fallbackBias);
  const m15Bias = normalizeDecisionSide(input.decision) ?? normalizeBias(stateFor('M15')?.bias ?? fallbackBias);
  const htfBias = wdBias === 'neutral' || wdBias === 'mixed' ? h4Bias : wdBias;
  const ltfBias = m15Bias === 'neutral' || m15Bias === 'mixed' ? h1Bias : m15Bias;
  const conflict = isDirectional(htfBias) && isDirectional(ltfBias) && htfBias !== ltfBias;
  const leader = input.strategyBook?.bestStrategy;
  const rangingContextActive = isRangeOrientedContext({
    selectedStrategyId: input.selectedStrategyId,
    setupType: input.setupType,
    regimeClassification: { primary: input.regime, tags: [input.regime], confidence: 0, source: 'plan' },
  }) || !isDirectional(htfBias);
  const countertrendAllowed = Boolean(
    conflict
    && leader
    && leader.score >= 72
    && leader.sampleSize >= 20
    && Number(leader.winRate ?? 0) >= 0.52,
  );
  return {
    sequence: [
      stage('W/D bias', wdBias === 'neutral' ? 'D' : 'W', htfBias, 'Weekly/daily directional bias inferred from latest visual fusion.'),
      stage('H4 structure', 'H4', htfBias, 'H4 structure must support the higher-timeframe story.'),
      stage('H1 setup', 'H1', ltfBias, 'H1 setup waits for structure and liquidity alignment.'),
      stage('M15 trigger', 'M15', ltfBias, 'M15 trigger is the execution timeframe confirmation.'),
      {
        stage: 'execution confirmation',
        timeframe: 'execution',
        bias: normalizeDecisionSide(input.decision) ?? 'neutral',
        status: input.decision === 'BUY' || input.decision === 'SELL' ? 'confirmed' : 'pending',
        score: Math.round(Number(input.visual.setupReadinessScore ?? 0)),
        narrative: String(input.visual.entryReadiness ?? 'Execution waits for confirmed trigger, risk approval, and broker readiness.'),
      },
    ],
    htfBias,
    ltfBias,
    conflict,
    countertrendAllowed,
    rangingContextActive,
    conflictPolicy: conflict
      ? countertrendAllowed
        ? rangingContextActive && !conflict
          ? 'HTF is non-directional or range regime — range/mean-reversion strategies may execute without HTF side alignment.'
          : 'HTF/LTF conflict accepted only because the selected strategy has promoted countertrend evidence.'
        : 'No trade: HTF and LTF disagree and no tested countertrend strategy qualifies.'
      : rangingContextActive
        ? 'Non-directional HTF or range regime — directional side match is not required.'
        : 'Top-down path is aligned or non-directional; normal risk gates apply.',
  };
}

function applyInstitutionalConflictPolicy(
  decision: AutonomyDecision,
  plan: NonNullable<AutonomousDecisionOutput['institutionalPlan']>,
): AutonomyDecision {
  if (
    (decision === 'BUY' || decision === 'SELL')
    && plan.conflict
    && !plan.countertrendAllowed
    && !plan.rangingContextActive
  ) {
    return 'MONITOR';
  }
  return decision;
}

function scoreSignalModel(input: {
  decision: AutonomyDecision;
  confidenceScore: number;
  readinessScore: number;
  riskScore: number;
  strategyBook: AutonomousDecisionInput['strategyBook'];
  regime: RegimeTag;
}): NonNullable<AutonomousDecisionOutput['signalScore']> {
  const leader = input.strategyBook?.bestStrategy;
  const historicalProbability = leader?.winRate != null && leader.sampleSize >= 10 ? leader.winRate * 100 : null;
  const probabilityScore = Math.round(clamp(
    (historicalProbability ?? input.confidenceScore) * 0.45
    + input.confidenceScore * 0.3
    + input.readinessScore * 0.25
    - Math.max(0, input.riskScore - 55) * 0.35,
    0,
    100,
  ));
  const regimePenalty = input.regime === 'news-risk' ? 0.45 : input.regime === 'high-volatility' ? 0.35 : input.regime === 'reversal' ? 0.15 : 0;
  const bookEdge = leader?.score ? (leader.score - 50) / 100 : 0;
  const expectedR = input.decision === 'BUY' || input.decision === 'SELL'
    ? clamp((probabilityScore / 100) * (1.4 + bookEdge) - ((100 - probabilityScore) / 100) - regimePenalty, -1, 3)
    : 0;
  return {
    expectedR: Number(expectedR.toFixed(2)),
    probabilityScore,
    riskScore: Math.round(input.riskScore),
    confidenceSource: leader
      ? `strategy_book:${leader.id}; visual_fusion; risk_model`
      : 'visual_fusion; risk_model',
    modelVersion: 'institutional_decision_v1',
  };
}

function allocateCapital(input: {
  decision: AutonomyDecision;
  confidenceScore: number;
  readinessScore: number;
  riskScore: number;
  signalScore: NonNullable<AutonomousDecisionOutput['signalScore']>;
  regime: RegimeTag;
  institutionalPlan: NonNullable<AutonomousDecisionOutput['institutionalPlan']>;
}): NonNullable<AutonomousDecisionOutput['capitalAllocation']> {
  if (input.decision !== 'BUY' && input.decision !== 'SELL') {
    return { riskMultiplier: 0, riskTier: 'blocked', rationale: 'No executable signal; capital allocation is blocked.' };
  }
  if (input.regime === 'news-risk' || input.riskScore >= 78) {
    return { riskMultiplier: 0, riskTier: 'blocked', rationale: 'News-risk or extreme risk regime blocks autonomous capital.' };
  }
  if (
    input.institutionalPlan.conflict
    && !input.institutionalPlan.countertrendAllowed
    && !input.institutionalPlan.rangingContextActive
  ) {
    return { riskMultiplier: 0, riskTier: 'blocked', rationale: input.institutionalPlan.conflictPolicy };
  }
  if (input.signalScore.expectedR >= 0.45 && input.signalScore.probabilityScore >= 68 && input.confidenceScore >= 68 && input.readinessScore >= 65) {
    return { riskMultiplier: 1, riskTier: 'full', rationale: 'Strong model score, mature setup, and acceptable risk.' };
  }
  if (input.signalScore.expectedR >= 0.1 && input.signalScore.probabilityScore >= 55 && input.riskScore < 68) {
    return { riskMultiplier: 0.5, riskTier: 'reduced', rationale: 'Positive but uncertain expectancy; reduced risk only.' };
  }
  return { riskMultiplier: 0.25, riskTier: 'minimal', rationale: 'Weak edge; minimal pilot risk only if downstream gates allow execution.' };
}

function strategyBookOverrideScore(): number {
  const raw = String(process.env.CACSMS_STRATEGY_BOOK_OVERRIDE_VISUAL_SCORE ?? '68').trim();
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(55, Math.min(100, value)) : 68;
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
  const overrideScore = strategyBookOverrideScore();
  if (leader.score >= 55 && bookSide !== 'WAIT') {
    if (!visualSide || visualSide === bookSide || input.visualDecision === 'WAIT' || input.visualDecision === 'MONITOR') {
      decision = bookSide;
    } else if (leader.score >= overrideScore) {
      // Strong institutional strategy book consensus wins over conflicting visual signal.
      decision = bookSide;
    } else if (input.refillMode) {
      decision = bookSide;
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
  const visualConflictNote = visualSide && visualSide !== bookSide && decision === bookSide
    ? ` Visual ${visualSide} overridden by strategy book leader (${bookSide}, score ${leader.score}).`
    : '';
  const reasonForDecision = `${decision} selected using strategy book leader ${leader.label} (${leader.score}/100${winRateText}) fused with visual confidence ${Math.round(input.visualConfidence)}.${visualConflictNote} ${book.reasons[0] ?? ''}`.trim();

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
  regime: RegimeTag = 'range',
): AutonomyDecision {
  const hardBlock = blockers.some((item) =>
    item.includes('Risk score')
    || (!shouldBypassNewsBlackout() && item.includes('High-impact'))
    || item.includes('critical'),
  );
  if (refillMode && (decision === 'BUY' || decision === 'SELL') && !hardBlock) {
    return decision;
  }
  const softBlockers = blockers.filter((item) =>
    !/conflicts with strategy book leader|Strategy book lacks actionable consensus/i.test(item),
  );
  if (softBlockers.length) return 'MONITOR';
  if (hardBlock) return 'AVOID';
  const rangingRegime = regime === 'range' || regime === 'compression';
  if (decision === 'BUY' && (bias === 'bullish' || (refillMode && bias === 'mixed') || (rangingRegime && bias === 'neutral'))) return 'BUY';
  if (decision === 'SELL' && (bias === 'bearish' || (refillMode && bias === 'mixed') || (rangingRegime && bias === 'neutral'))) return 'SELL';
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

function normalizeDecisionSide(value: unknown) {
  const text = String(value ?? '').toUpperCase();
  if (text === 'BUY') return 'bullish';
  if (text === 'SELL') return 'bearish';
  return null;
}

function isDirectional(value: string) {
  return value === 'bullish' || value === 'bearish';
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
