import type { TradingAccountClass } from './execution-account-context';
import { getDecisionThresholds, shouldUseDemoFusionOverrides } from './autonomy-account-profiles';
import type { VisionDecision } from './visual-intelligence-types';

export type FinalMarketDecision = VisionDecision | 'MONITOR';
export type MarketBias = 'bullish' | 'bearish' | 'neutral' | 'mixed';

export interface FusionSignal {
  name: string;
  weight: number;
  bias: MarketBias;
  confidence: number;
  confirmsEntry: boolean;
  narrative: string;
}

export interface VisualMarketInterpretationResult {
  dominantTimeframe: string;
  finalMarketBias: MarketBias;
  institutionalInterpretation: string;
  liquidityObjective: string;
  marketPhase: string;
  setupReadinessScore: number;
  finalDecision: FinalMarketDecision;
  confidenceScore: number;
  entryReadiness: string;
  invalidationCondition: string;
  riskWarning: string;
  fullNarrative: string;
  timeframeStates: Array<{ timeframe: string; bias: MarketBias; controlScore: number; confirmsEntry: boolean; narrative: string }>;
  decisionScores: Record<string, number>;
  auditTrail: Array<{ stage: string; finding: string; score: number }>;
  signals: FusionSignal[];
}

export const marketInterpretationWeights = {
  higherTimeframeBias: 0.25,
  marketStructure: 0.2,
  liquidityCondition: 0.15,
  orderBlockQuality: 0.1,
  supportResistanceReaction: 0.1,
  candleBehaviour: 0.08,
  visualAnomalies: 0.05,
  patternContext: 0.04,
  segmentationMarketPhase: 0.03,
};

export function fuseVisualMarketInterpretation(input: {
  symbol: string;
  timeframe: string;
  signals: FusionSignal[];
  timeframeStates: VisualMarketInterpretationResult['timeframeStates'];
  previousDecision?: FinalMarketDecision | null;
  accountClass?: TradingAccountClass;
  ltfScalpMode?: boolean;
  mtfScalpOnly?: boolean;
}): VisualMarketInterpretationResult {
  const signals = normalizeSignals(input.signals);
  const timeframeStates = input.timeframeStates.length ? input.timeframeStates : [{
    timeframe: input.timeframe,
    bias: 'neutral' as MarketBias,
    controlScore: 0,
    confirmsEntry: false,
    narrative: 'No timeframe control state is available yet.',
  }];
  const dominant = [...timeframeStates].sort((left, right) => right.controlScore - left.controlScore)[0];
  const bull = directionalScore(signals, 'bullish');
  const bear = directionalScore(signals, 'bearish');
  const neutral = directionalScore(signals, 'neutral') + directionalScore(signals, 'mixed') * 0.5;
  const finalMarketBias = resolveBias(bull, bear, neutral);
  const htfRanging = detectVisualHtfRanging(timeframeStates, inferMarketPhase(signals));
  const ltfScalpMode = input.ltfScalpMode === true || input.mtfScalpOnly === true || htfRanging;
  const ltfExecutionBias = resolveVisualLtfBias(timeframeStates);
  const htfSignal = signalByName(signals, 'Higher timeframe bias');
  const mtfPullbackConfirm = Boolean(htfSignal?.confirmsEntry);
  const accountClass = input.accountClass ?? 'demo';
  const demoMode = shouldUseDemoFusionOverrides(accountClass);
  const thresholds = getDecisionThresholds(accountClass);
  const confidenceBoost = demoMode && mtfPullbackConfirm ? 14 : 0;
  const confidenceScore = Math.round(clamp((Math.max(bull, bear, neutral) / totalWeight(signals)) * 100 + confidenceBoost, 0, 100));
  const lowerConfirms = timeframeStates.some((state) => ['H1', 'M15', 'M5', 'M1'].includes(state.timeframe) && state.confirmsEntry && ['bullish', 'bearish'].includes(state.bias))
    || (ltfScalpMode && ltfExecutionBias !== 'neutral')
    || mtfPullbackConfirm;
  const htfClear = ['bullish', 'bearish'].includes(finalMarketBias) && dominant.controlScore >= (demoMode ? 32 : 45);
  const anomalyRisk = signalByName(signals, 'Visual anomalies')?.narrative.toLowerCase().includes('critical')
    || (!demoMode && (signalByName(signals, 'Visual anomalies')?.confidence ?? 0) < 0.45);
  const liquidityThreshold = demoMode ? 0.25 : 0.45;
  const liquidityClear = (signalByName(signals, 'Liquidity condition')?.confidence ?? 0) >= liquidityThreshold
    || (demoMode && mtfPullbackConfirm);
  const scalpReadinessThreshold = Math.max(24, Math.round(thresholds.visualReadiness * (ltfScalpMode ? 0.82 : 1)));
  const setupReadinessScore = Math.round(clamp(
    confidenceScore * 0.45
    + (lowerConfirms ? (ltfScalpMode ? 28 : 22) : 4)
    + (liquidityClear ? 14 : 0)
    + (anomalyRisk ? -20 : 8)
    + (demoMode && mtfPullbackConfirm ? 20 : 0)
    + (ltfScalpMode && lowerConfirms ? 8 : 0),
    0,
    100,
  ));
  let finalDecision = decide({
    finalMarketBias,
    htfClear,
    lowerConfirms,
    anomalyRisk,
    liquidityClear,
    setupReadinessScore,
    readinessThreshold: scalpReadinessThreshold,
    ltfScalpMode,
    ltfExecutionBias,
  });
  if (demoMode && mtfPullbackConfirm && finalMarketBias === 'bullish' && ['AVOID', 'MONITOR', 'WAIT'].includes(finalDecision)) {
    finalDecision = setupReadinessScore >= thresholds.visualReadiness ? 'BUY' : 'MONITOR';
  } else if (demoMode && mtfPullbackConfirm && finalMarketBias === 'bearish' && ['AVOID', 'MONITOR', 'WAIT'].includes(finalDecision)) {
    finalDecision = setupReadinessScore >= thresholds.visualReadiness ? 'SELL' : 'MONITOR';
  }
  const marketPhase = inferMarketPhase(signals);
  const liquidityObjective = inferLiquidityObjective(signals);
  const institutionalInterpretation = inferInstitutional(signals, finalMarketBias, marketPhase);
  const entryReadiness = entryReadinessText(finalDecision, lowerConfirms, setupReadinessScore, ltfScalpMode);
  const invalidationCondition = invalidationText(finalDecision, finalMarketBias);
  const riskWarning = riskText(finalDecision, anomalyRisk, liquidityClear, confidenceScore);
  const decisionScores = {
    bullishScore: Math.round(bull * 100),
    bearishScore: Math.round(bear * 100),
    neutralScore: Math.round(neutral * 100),
    setupReadinessScore,
    confidenceScore,
  };
  const auditTrail = [
    { stage: 'Output collection', finding: `Collected ${signals.filter((signal) => signal.confidence > 0).length} visual intelligence signal groups.`, score: confidenceScore },
    { stage: 'Timeframe control', finding: `${dominant.timeframe} is controlling with ${Math.round(dominant.controlScore)} control score.`, score: Math.round(dominant.controlScore) },
    { stage: 'Liquidity and manipulation', finding: `${liquidityObjective} ${anomalyRisk ? 'Anomaly risk is elevated.' : 'No critical anomaly conflict is dominating.'}`, score: Math.round((signalByName(signals, 'Liquidity condition')?.confidence ?? 0) * 100) },
    { stage: 'Final decision', finding: `${finalDecision} selected from weighted visual fusion${ltfScalpMode ? ' (HTF range → LTF scalp mode)' : ''}.`, score: setupReadinessScore },
  ];

  return {
    dominantTimeframe: dominant.timeframe,
    finalMarketBias,
    institutionalInterpretation,
    liquidityObjective,
    marketPhase,
    setupReadinessScore,
    finalDecision,
    confidenceScore,
    entryReadiness,
    invalidationCondition,
    riskWarning,
    fullNarrative: [
      `${input.symbol} final visual interpretation: ${finalMarketBias} bias with ${dominant.timeframe} as the dominant timeframe.`,
      institutionalInterpretation,
      `Liquidity objective: ${liquidityObjective}`,
      `Market phase: ${marketPhase}. Entry readiness: ${entryReadiness}`,
      `Final action: ${finalDecision}. ${riskWarning}`,
      input.previousDecision && input.previousDecision !== finalDecision ? `Previous interpretation was ${input.previousDecision}; the model has updated to ${finalDecision}.` : '',
    ].filter(Boolean).join('\n\n'),
    timeframeStates,
    decisionScores,
    auditTrail,
    signals,
  };
}

function normalizeSignals(signals: FusionSignal[]) {
  return Object.entries(marketInterpretationWeights).map(([key, weight]) => {
    const name = labelForKey(key);
    const signal = signals.find((item) => item.name === name);
    return signal ?? {
      name,
      weight,
      bias: 'neutral' as MarketBias,
      confidence: 0,
      confirmsEntry: false,
      narrative: `${name} is not available yet.`,
    };
  });
}

function labelForKey(key: string) {
  return {
    higherTimeframeBias: 'Higher timeframe bias',
    marketStructure: 'Market structure',
    liquidityCondition: 'Liquidity condition',
    orderBlockQuality: 'Order block quality',
    supportResistanceReaction: 'Support/resistance reaction',
    candleBehaviour: 'Candle behaviour',
    visualAnomalies: 'Visual anomalies',
    patternContext: 'Pattern context',
    segmentationMarketPhase: 'Segmentation/market phase',
  }[key] ?? key;
}

function directionalScore(signals: FusionSignal[], bias: MarketBias) {
  return signals.reduce((sum, signal) => sum + (signal.bias === bias ? signal.weight * signal.confidence : 0), 0);
}

function totalWeight(signals: FusionSignal[]) {
  return signals.reduce((sum, signal) => sum + signal.weight, 0) || 1;
}

function resolveBias(bull: number, bear: number, neutral: number): MarketBias {
  if (Math.abs(bull - bear) < 0.04) return neutral > 0.08 ? 'mixed' : 'neutral';
  return bull > bear ? 'bullish' : 'bearish';
}

function decide(input: {
  finalMarketBias: MarketBias;
  htfClear: boolean;
  lowerConfirms: boolean;
  anomalyRisk: boolean;
  liquidityClear: boolean;
  setupReadinessScore: number;
  readinessThreshold: number;
  ltfScalpMode?: boolean;
  ltfExecutionBias?: MarketBias;
}): FinalMarketDecision {
  if (input.anomalyRisk || !input.liquidityClear) return 'AVOID';
  if (input.ltfScalpMode && input.lowerConfirms && input.ltfExecutionBias && ['bullish', 'bearish'].includes(input.ltfExecutionBias)) {
    if (input.setupReadinessScore < input.readinessThreshold) return 'MONITOR';
    return input.ltfExecutionBias === 'bullish' ? 'BUY' : 'SELL';
  }
  if (!input.htfClear) return 'MONITOR';
  if (!input.lowerConfirms) return 'WAIT';
  const readinessThreshold = input.readinessThreshold;
  if (input.setupReadinessScore < readinessThreshold) return 'MONITOR';
  return input.finalMarketBias === 'bullish' ? 'BUY' : input.finalMarketBias === 'bearish' ? 'SELL' : 'WAIT';
}

function detectVisualHtfRanging(
  timeframeStates: VisualMarketInterpretationResult['timeframeStates'],
  marketPhase: string,
): boolean {
  const htfStates = timeframeStates.filter((state) => ['H4', 'H1'].includes(state.timeframe));
  const htfRanging = htfStates.some((state) => state.bias === 'neutral' || state.bias === 'mixed' || /range|ranging|consolidat|compress|sideways|balance|chop/i.test(state.narrative));
  return htfRanging || /consolidation|compression|range|sideways|balanced|mean reversion/i.test(marketPhase.toLowerCase());
}

function resolveVisualLtfBias(
  timeframeStates: VisualMarketInterpretationResult['timeframeStates'],
): MarketBias {
  for (const timeframe of ['M15', 'M5', 'M1', 'H1']) {
    const state = timeframeStates.find((item) => item.timeframe === timeframe);
    if (!state) continue;
    if (state.bias === 'bullish' || state.bias === 'bearish') return state.bias;
  }
  return 'neutral';
}

function inferMarketPhase(signals: FusionSignal[]) {
  const text = signals.map((signal) => signal.narrative).join(' ').toLowerCase();
  if (text.includes('expansion') || text.includes('breakout')) return 'expansion';
  if (text.includes('manipulation') || text.includes('sweep')) return 'manipulation / liquidity sweep';
  if (text.includes('compression') || text.includes('consolidation')) return 'consolidation / compression';
  if (text.includes('reversal')) return 'reversal attempt';
  return 'trend evaluation';
}

function inferLiquidityObjective(signals: FusionSignal[]) {
  const text = signalByName(signals, 'Liquidity condition')?.narrative ?? '';
  if (!text || text.includes('not available')) return 'Liquidity objective is unclear.';
  return text;
}

function inferInstitutional(signals: FusionSignal[], bias: MarketBias, phase: string) {
  const ob = signalByName(signals, 'Order block quality')?.narrative ?? '';
  if (phase.includes('sweep')) return `Institutions appear active around liquidity engineering. ${ob}`;
  if (bias === 'bullish') return `Institutional bias leans accumulation/demand. ${ob}`;
  if (bias === 'bearish') return `Institutional bias leans distribution/supply. ${ob}`;
  return `Institutional activity is not decisive yet. ${ob}`;
}

function entryReadinessText(decision: FinalMarketDecision, lowerConfirms: boolean, score: number, ltfScalpMode = false) {
  if (decision === 'BUY' || decision === 'SELL') {
    return ltfScalpMode
      ? `LTF scalp entry ready on M15/M5 with readiness ${score}% — HTF is ranging so execution uses lower-timeframe structure only.`
      : `Entry is ready only if execution confirms risk controls; readiness score ${score}%.`;
  }
  if (lowerConfirms) {
    return ltfScalpMode
      ? `Lower timeframe scalp confirmation exists, but overall readiness remains ${score}%.`
      : `Lower timeframe confirmation exists, but overall readiness remains ${score}%.`;
  }
  return `Entry is not ready; lower timeframe confirmation is missing and readiness is ${score}%.`;
}

function invalidationText(decision: FinalMarketDecision, bias: MarketBias) {
  if (decision === 'BUY') return 'Invalidate BUY if price accepts below the latest defended demand/support and breaks the confirming structure low.';
  if (decision === 'SELL') return 'Invalidate SELL if price accepts above the latest defended supply/resistance and breaks the confirming structure high.';
  return `Invalidate the current ${bias} interpretation if the controlling timeframe flips or anomaly/liquidity context contradicts the setup.`;
}

function riskText(decision: FinalMarketDecision, anomalyRisk: boolean, liquidityClear: boolean, confidence: number) {
  if (anomalyRisk) return 'Risk warning: visual anomaly risk is high enough to block execution.';
  if (!liquidityClear) return 'Risk warning: liquidity objective is unclear, so execution should be avoided.';
  if (decision === 'WAIT' || decision === 'MONITOR') return 'Risk warning: setup is still forming; wait for maturity before execution.';
  if (confidence < 70) return 'Risk warning: confidence is moderate, use reduced risk and strict invalidation.';
  return 'Risk warning: execute only within the account risk model and after spread/latency checks.';
}

function signalByName(signals: FusionSignal[], name: string) {
  return signals.find((signal) => signal.name === name);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
