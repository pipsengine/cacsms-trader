import { analyzeCandles } from './candle-detection-engine';
import { analyzeLiquidityZones } from './liquidity-zone-engine';
import { analyzeOrderBlocks } from './order-block-detection-engine';
import { analyzeMarketStructure } from './structure-analysis-engine';
import { analyzeSupportResistance } from './support-resistance-engine';
import type { ReconstructedCandle, VisionCandleInput, VisionDecision } from './visual-intelligence-types';
import { normalizeInputCandles } from './candle-detection-engine';

export const MTF_TIMEFRAMES = ['W', 'D', 'H4', 'H1', 'M15'] as const;
export type MtfTimeframe = typeof MTF_TIMEFRAMES[number];
export type MtfBias = 'Bullish' | 'Bearish' | 'Neutral' | 'Ranging';
export type MtfDecision = 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
export type AlignmentColorState = 'aligned_bullish' | 'aligned_bearish' | 'conflict' | 'neutral_ranging' | 'institutional_setup_forming';

export interface TimeframeAnalysisSnapshot {
  id?: string;
  symbol: string;
  timeframe: MtfTimeframe;
  chartCaptureId?: string | null;
  trendDirection: string;
  marketStructure: string;
  lastBosDirection: string | null;
  lastChochDirection: string | null;
  liquidityStatus: string;
  orderBlockStatus: string;
  supportResistanceReaction: string;
  candleMomentum: string;
  volatilityCondition: string;
  aiConfidenceScore: number;
  bias: MtfBias;
  decisionState: MtfDecision;
  structure: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface TimeframeAlignmentScore {
  id?: string;
  symbol: string;
  leftTimeframe: MtfTimeframe;
  rightTimeframe: MtfTimeframe;
  alignmentState: AlignmentColorState;
  alignmentScore: number;
  trendMatch: boolean;
  structureMatch: boolean;
  liquidityMatch: boolean;
  orderBlockMatch: boolean;
  supportResistanceMatch: boolean;
  explanationText: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface TimeframeConflictLog {
  id?: string;
  symbol: string;
  conflictType: string;
  higherTimeframe: MtfTimeframe;
  lowerTimeframe: MtfTimeframe;
  severityScore: number;
  description: string;
  recommendedResolution: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface MultiTimeframeDecision {
  id?: string;
  symbol: string;
  finalDecision: MtfDecision | 'BUY opportunity' | 'SELL opportunity';
  finalBias: string;
  confidenceScore: number;
  controllingTimeframe: MtfTimeframe | 'none';
  lowerTimeframeConfirmation: string;
  scalpOnly: boolean;
  marketNarrative: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface MultiTimeframeAnalysisResult {
  symbol: string;
  snapshots: TimeframeAnalysisSnapshot[];
  alignments: TimeframeAlignmentScore[];
  conflicts: TimeframeConflictLog[];
  decision: MultiTimeframeDecision;
}

export type MtfCandleInput = Partial<Record<MtfTimeframe, VisionCandleInput[]>>;

const weights: Record<MtfTimeframe, number> = { W: 0.3, D: 0.25, H4: 0.2, H1: 0.15, M15: 0.1 };

export function normalizeMtfCandles(input: VisionCandleInput[]): ReconstructedCandle[] {
  return normalizeInputCandles(input);
}

export function analyzeMultiTimeframe(symbol: string, candleMap: Partial<Record<MtfTimeframe, ReconstructedCandle[]>>, captureMap: Partial<Record<MtfTimeframe, string | null>> = {}): MultiTimeframeAnalysisResult {
  const snapshots = MTF_TIMEFRAMES.map((timeframe) => {
    const candles = candleMap[timeframe] ?? [];
    return candles.length >= 12
      ? analyzeOneTimeframe(symbol, timeframe, candles, captureMap[timeframe] ?? null)
      : unavailableSnapshot(symbol, timeframe, captureMap[timeframe] ?? null);
  });
  const alignments = buildAlignments(symbol, snapshots);
  const conflicts = buildConflicts(symbol, snapshots, alignments);
  const decision = buildDecision(symbol, snapshots, alignments, conflicts);
  return { symbol, snapshots, alignments, conflicts, decision };
}

function analyzeOneTimeframe(symbol: string, timeframe: MtfTimeframe, candles: ReconstructedCandle[], chartCaptureId: string | null): TimeframeAnalysisSnapshot {
  const structure = analyzeMarketStructure(candles, timeframe);
  const liquidity = analyzeLiquidityZones(candles);
  const orderBlocks = analyzeOrderBlocks(candles);
  const supportResistance = analyzeSupportResistance(candles);
  const candleBehavior = analyzeCandles(candles);
  const context = buildContext(candles);
  const bias = biasFrom(structure.finalBias.institutionalBias, context.trendDirection);
  const decisionState = decisionFrom(structure.finalBias.tradeDecision, bias, structure.finalBias.retailTrapRisk);
  const lastBos = structure.bos.at(-1);
  const lastChoch = structure.choch.at(-1);
  return {
    symbol,
    timeframe,
    chartCaptureId,
    trendDirection: context.trendDirection,
    marketStructure: structure.output.currentStructure,
    lastBosDirection: lastBos?.direction ?? null,
    lastChochDirection: lastChoch?.direction ?? null,
    liquidityStatus: liquidity.summary.dominantLiquidity,
    orderBlockStatus: orderBlocks.summary.dominantBlock,
    supportResistanceReaction: supportResistance.summary.dominantZone,
    candleMomentum: candleBehavior.summary.dominantDirection,
    volatilityCondition: context.volatilityCondition,
    aiConfidenceScore: structure.finalBias.confidenceScore,
    bias,
    decisionState,
    structure: {
      phase: structure.phase,
      finalBias: structure.finalBias,
      bosCount: structure.bos.length,
      chochCount: structure.choch.length,
      mssCount: structure.mss.length,
    },
    metadata: {
      candleCount: candles.length,
      liquiditySummary: liquidity.summary,
      orderBlockSummary: orderBlocks.summary,
      supportResistanceSummary: supportResistance.summary,
      candleSummary: candleBehavior.summary,
      hierarchyWeight: weights[timeframe],
    },
  };
}

function buildAlignments(symbol: string, snapshots: TimeframeAnalysisSnapshot[]): TimeframeAlignmentScore[] {
  const pairs: Array<[MtfTimeframe, MtfTimeframe]> = [['W', 'D'], ['D', 'H4'], ['H4', 'H1'], ['H1', 'M15']];
  return pairs.map(([left, right]) => {
    const a = snapshotFor(snapshots, left);
    const b = snapshotFor(snapshots, right);
    const trendMatch = directional(a.bias) === directional(b.bias) && directional(a.bias) !== 'neutral';
    const structureMatch = sameDirection(a.lastBosDirection, b.lastBosDirection) || sameDirection(a.marketStructure, b.marketStructure);
    const liquidityMatch = liquidityDirection(a.liquidityStatus) === liquidityDirection(b.liquidityStatus);
    const orderBlockMatch = directional(a.orderBlockStatus) === directional(b.orderBlockStatus);
    const supportResistanceMatch = directional(a.supportResistanceReaction) === directional(b.supportResistanceReaction);
    const score = clamp([
      trendMatch ? 0.34 : 0,
      structureMatch ? 0.22 : 0,
      liquidityMatch ? 0.16 : 0,
      orderBlockMatch ? 0.14 : 0,
      supportResistanceMatch ? 0.14 : 0,
    ].reduce((sum, value) => sum + value, 0), 0, 1);
    const state = alignmentState(a, b, score);
    return {
      symbol,
      leftTimeframe: left,
      rightTimeframe: right,
      alignmentState: state,
      alignmentScore: score,
      trendMatch,
      structureMatch,
      liquidityMatch,
      orderBlockMatch,
      supportResistanceMatch,
      explanationText: `${left} and ${right} are ${state.replace(/_/g, ' ')} with ${Math.round(score * 100)}% agreement across trend, structure, liquidity, order blocks and S/R reaction.`,
      metadata: { leftBias: a.bias, rightBias: b.bias, leftDecision: a.decisionState, rightDecision: b.decisionState },
    };
  });
}

function buildConflicts(symbol: string, snapshots: TimeframeAnalysisSnapshot[], alignments: TimeframeAlignmentScore[]): TimeframeConflictLog[] {
  const conflicts: TimeframeConflictLog[] = [];
  const higher = snapshots.filter((item) => ['W', 'D', 'H4'].includes(item.timeframe));
  const lower = snapshots.filter((item) => ['H1', 'M15'].includes(item.timeframe));
  const wBias = directional(snapshotFor(snapshots, 'W').bias);
  const dBias = directional(snapshotFor(snapshots, 'D').bias);

  for (const high of higher) {
    for (const low of lower) {
      const highDir = directional(high.bias);
      const lowDir = directional(low.bias);
      if (highDir === 'neutral' || lowDir === 'neutral' || highDir === lowDir) continue;
      if (['AVOID', 'WAIT'].includes(high.decisionState) || ['AVOID', 'WAIT'].includes(low.decisionState)) continue;
      if (
        wBias === 'bullish' && dBias === 'bullish' && highDir === 'bearish' && lowDir === 'bullish'
        && ['H4', 'H1'].includes(high.timeframe)
      ) {
        continue;
      }
      if (
        wBias === 'bearish' && dBias === 'bearish' && highDir === 'bullish' && lowDir === 'bearish'
        && ['H4', 'H1'].includes(high.timeframe)
      ) {
        continue;
      }
      const severity = clamp(weights[high.timeframe] + weights[low.timeframe] + high.aiConfidenceScore * 0.2 + low.aiConfidenceScore * 0.12, 0, 1);
      conflicts.push({
        symbol,
        conflictType: 'higher_lower_timeframe_bias_conflict',
        higherTimeframe: high.timeframe,
        lowerTimeframe: low.timeframe,
        severityScore: severity,
        description: `${high.timeframe} is ${high.bias} while ${low.timeframe} is ${low.bias}.`,
        recommendedResolution: highDir === 'bullish' ? 'Wait for lower timeframe bearish correction to complete before buy confirmation.' : 'Wait for lower timeframe bullish correction to complete before sell confirmation.',
        metadata: { high, low },
      });
    }
  }
  for (const alignment of alignments.filter((item) => item.alignmentState === 'conflict')) {
    conflicts.push({
      symbol,
      conflictType: 'adjacent_timeframe_alignment_conflict',
      higherTimeframe: alignment.leftTimeframe,
      lowerTimeframe: alignment.rightTimeframe,
      severityScore: clamp(1 - alignment.alignmentScore, 0, 1),
      description: alignment.explanationText,
      recommendedResolution: 'Do not treat lower timeframe signal as executable until adjacent timeframe alignment improves.',
      metadata: { alignment },
    });
  }
  return conflicts.sort((a, b) => b.severityScore - a.severityScore).slice(0, 8);
}

function buildDecision(symbol: string, snapshots: TimeframeAnalysisSnapshot[], alignments: TimeframeAlignmentScore[], conflicts: TimeframeConflictLog[]): MultiTimeframeDecision {
  const weightedBull = weightedBias(snapshots, 'bullish');
  const weightedBear = weightedBias(snapshots, 'bearish');
  const higher = ['W', 'D', 'H4'].map((tf) => snapshotFor(snapshots, tf as MtfTimeframe));
  const lower = ['H1', 'M15'].map((tf) => snapshotFor(snapshots, tf as MtfTimeframe));
  const higherBullish = higher.every((item) => directional(item.bias) === 'bullish');
  const higherBearish = higher.every((item) => directional(item.bias) === 'bearish');
  const lowerBullish = lower.every((item) => directional(item.bias) === 'bullish' || item.decisionState === 'BUY');
  const lowerBearish = lower.every((item) => directional(item.bias) === 'bearish' || item.decisionState === 'SELL');
  const h4H1M15Bull = ['H4', 'H1', 'M15'].every((tf) => directional(snapshotFor(snapshots, tf as MtfTimeframe).bias) === 'bullish');
  const h4H1M15Bear = ['H4', 'H1', 'M15'].every((tf) => directional(snapshotFor(snapshots, tf as MtfTimeframe).bias) === 'bearish');
  const wSnapshot = snapshotFor(snapshots, 'W');
  const dSnapshot = snapshotFor(snapshots, 'D');
  const h4Snapshot = snapshotFor(snapshots, 'H4');
  const h1Snapshot = snapshotFor(snapshots, 'H1');
  const m15Snapshot = snapshotFor(snapshots, 'M15');
  const wDir = directional(wSnapshot.bias);
  const dDir = directional(dSnapshot.bias);
  const h4Dir = directional(h4Snapshot.bias);
  const h1Dir = directional(h1Snapshot.bias);
  const m15Dir = directional(m15Snapshot.bias);
  const wdConflict = wDir !== 'neutral' && dDir !== wDir;
  const wdBullish = wDir === 'bullish' && dDir === 'bullish';
  const wdBearish = wDir === 'bearish' && dDir === 'bearish';
  const controlling = controllingTimeframe(snapshots);
  const averageAlignment = average(alignments.map((item) => item.alignmentScore));
  const conflictSeverity = conflicts[0]?.severityScore ?? 0;
  let finalDecision: MultiTimeframeDecision['finalDecision'] = 'WAIT';
  let finalBias = weightedBull > weightedBear ? 'Bullish multi-timeframe bias' : weightedBear > weightedBull ? 'Bearish multi-timeframe bias' : 'Neutral/ranging multi-timeframe bias';
  let scalpOnly = false;
  let lowerConfirmation = 'No lower timeframe confirmation.';

  if (higherBullish && lowerBullish) {
    finalDecision = 'BUY opportunity';
    lowerConfirmation = 'H1 and M15 confirm bullish entry context inside W/D/H4 bullish control.';
  } else if (higherBearish && lowerBearish) {
    finalDecision = 'SELL opportunity';
    lowerConfirmation = 'H1 and M15 confirm bearish entry context inside W/D/H4 bearish control.';
  } else if (higherBullish && lower.some((item) => directional(item.bias) === 'bearish')) {
    finalDecision = 'WAIT';
    lowerConfirmation = 'Lower timeframe bearish correction is active inside higher timeframe bullish bias.';
  } else if (higherBearish && lower.some((item) => directional(item.bias) === 'bullish')) {
    finalDecision = 'WAIT';
    lowerConfirmation = 'Lower timeframe bullish correction is active inside higher timeframe bearish bias.';
  } else if (wdBullish && h4Dir === 'bearish' && m15Dir === 'bullish' && (h1Dir === 'bearish' || h1Dir === 'neutral' || h1Snapshot.decisionState === 'WAIT')) {
    finalDecision = 'BUY opportunity';
    lowerConfirmation = 'W/D bullish control with H4 corrective bearish leg completing; M15 bullish reclaim confirms institutional pullback entry.';
  } else if (wdBearish && h4Dir === 'bullish' && m15Dir === 'bearish' && (h1Dir === 'bullish' || h1Dir === 'neutral' || h1Snapshot.decisionState === 'WAIT')) {
    finalDecision = 'SELL opportunity';
    lowerConfirmation = 'W/D bearish control with H4 corrective bullish leg completing; M15 bearish reclaim confirms institutional pullback entry.';
  } else if ((h4H1M15Bull || h4H1M15Bear) && wdConflict) {
    finalDecision = h4H1M15Bull ? 'BUY' : 'SELL';
    scalpOnly = true;
    lowerConfirmation = 'M15 aligns with H1 and H4 but conflicts with W/D control; short-term scalp only.';
  } else if ((isHtfRangingSnapshot(h4Snapshot) || isHtfRangingSnapshot(h1Snapshot)) && m15Dir === 'bullish') {
    finalDecision = 'BUY';
    scalpOnly = true;
    lowerConfirmation = 'H4/H1 ranging or non-directional — M15 bullish scalp opportunity inside the range.';
  } else if ((isHtfRangingSnapshot(h4Snapshot) || isHtfRangingSnapshot(h1Snapshot)) && m15Dir === 'bearish') {
    finalDecision = 'SELL';
    scalpOnly = true;
    lowerConfirmation = 'H4/H1 ranging or non-directional — M15 bearish scalp opportunity inside the range.';
  } else if (h4Dir === 'neutral' && h1Dir === 'neutral' && (m15Dir === 'bullish' || m15Dir === 'bearish')) {
    finalDecision = m15Dir === 'bullish' ? 'BUY' : 'SELL';
    scalpOnly = true;
    lowerConfirmation = 'H4 and H1 are balanced/ranging — execute tactical M15 scalp only.';
  } else if (conflictSeverity > 0.58) {
    finalDecision = conflictSeverity > 0.75 ? 'AVOID' : 'WAIT';
    lowerConfirmation = 'Timeframe conflict prevents institutional confirmation.';
  }

  const confidence = clamp((Math.max(weightedBull, weightedBear) * 0.44 + averageAlignment * 0.36 + (1 - conflictSeverity) * 0.2), 0, 0.98);
  const marketNarrative = `${controlling} controls the market with ${finalBias}. ${lowerConfirmation} Alignment average is ${Math.round(averageAlignment * 100)}%; strongest conflict severity is ${Math.round(conflictSeverity * 100)}%. Final decision: ${finalDecision}.`;
  return {
    symbol,
    finalDecision,
    finalBias,
    confidenceScore: confidence,
    controllingTimeframe: controlling,
    lowerTimeframeConfirmation: lowerConfirmation,
    scalpOnly,
    marketNarrative,
    metadata: { weightedBull, weightedBear, averageAlignment, conflictSeverity },
  };
}

function unavailableSnapshot(symbol: string, timeframe: MtfTimeframe, chartCaptureId: string | null): TimeframeAnalysisSnapshot {
  return {
    symbol,
    timeframe,
    chartCaptureId,
    trendDirection: 'unavailable',
    marketStructure: 'no_backend_chart_data',
    lastBosDirection: null,
    lastChochDirection: null,
    liquidityStatus: 'unavailable',
    orderBlockStatus: 'unavailable',
    supportResistanceReaction: 'unavailable',
    candleMomentum: 'unavailable',
    volatilityCondition: 'unavailable',
    aiConfidenceScore: 0,
    bias: 'Neutral',
    decisionState: 'WAIT',
    structure: {},
    metadata: { reason: 'No candles or existing capture data available for this timeframe.' },
  };
}

function buildContext(candles: ReconstructedCandle[]) {
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const bodies = candles.map((candle) => Math.abs(candle.closePrice - candle.openPrice));
  const atr = average(ranges.slice(-14)) || average(ranges) || 1;
  const recentRange = average(ranges.slice(-8));
  const baseline = average(ranges) || atr;
  const first = candles[0];
  const last = candles.at(-1)!;
  return {
    trendDirection: last.closePrice > first.openPrice ? 'bullish' : last.closePrice < first.openPrice ? 'bearish' : 'neutral',
    volatilityCondition: recentRange > baseline * 1.2 ? 'expansion' : recentRange < baseline * 0.82 ? 'compression' : 'normal',
    displacement: clamp(Math.max(...bodies.slice(-8)) / Math.max(0.0001, atr), 0, 1),
  };
}

function biasFrom(institutionalBias: string, trend: string): MtfBias {
  const text = institutionalBias.toLowerCase();
  if (text.includes('bullish') || trend === 'bullish') return 'Bullish';
  if (text.includes('bearish') || trend === 'bearish') return 'Bearish';
  if (text.includes('range')) return 'Ranging';
  return 'Neutral';
}

function decisionFrom(decision: VisionDecision, bias: MtfBias, trapRisk: number): MtfDecision {
  if (trapRisk >= 0.78) return 'AVOID';
  if (decision === 'BUY' || decision === 'SELL' || decision === 'AVOID') return decision;
  if (bias === 'Bullish' || bias === 'Bearish') return 'WAIT';
  return 'WAIT';
}

function alignmentState(a: TimeframeAnalysisSnapshot, b: TimeframeAnalysisSnapshot, score: number): AlignmentColorState {
  const dirA = directional(a.bias);
  const dirB = directional(b.bias);
  if (dirA === 'bullish' && dirB === 'bullish' && score >= 0.5) return 'aligned_bullish';
  if (dirA === 'bearish' && dirB === 'bearish' && score >= 0.5) return 'aligned_bearish';
  if ((a.decisionState === 'WAIT' || b.decisionState === 'WAIT') && score >= 0.42 && dirA !== dirB) return 'institutional_setup_forming';
  if (dirA === 'neutral' || dirB === 'neutral') return 'neutral_ranging';
  return score < 0.5 ? 'conflict' : 'institutional_setup_forming';
}

function snapshotFor(snapshots: TimeframeAnalysisSnapshot[], timeframe: MtfTimeframe): TimeframeAnalysisSnapshot {
  return snapshots.find((item) => item.timeframe === timeframe) ?? unavailableSnapshot('UNKNOWN', timeframe, null);
}

function directional(value: string): 'bullish' | 'bearish' | 'neutral' {
  const text = value.toLowerCase();
  if (text.includes('ranging') || text.includes('range-bound') || text.includes('sideways')) return 'neutral';
  if (/\bbuy[_\s-]?side[_\s-]?(sweep|liquidity|stop|pool)/.test(text)) return 'bearish';
  if (/\bsell[_\s-]?side[_\s-]?(sweep|liquidity|stop|pool)/.test(text)) return 'bullish';
  if (/\b(bull|buy|long|demand|accumulation)\b/.test(text)) return 'bullish';
  if (/\b(bear|sell|short|supply|distribution)\b/.test(text)) return 'bearish';
  return 'neutral';
}

function isHtfRangingSnapshot(snapshot: TimeframeAnalysisSnapshot): boolean {
  if (directional(snapshot.bias) === 'neutral') return true;
  const text = `${snapshot.marketStructure} ${snapshot.trendDirection} ${snapshot.volatilityCondition}`.toLowerCase();
  return /range|ranging|consolidat|compress|sideways|balance|chop/.test(text);
}

function sameDirection(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const left = directional(a);
  const right = directional(b);
  return left !== 'neutral' && left === right;
}

function liquidityDirection(value: string): string {
  const text = value.toLowerCase();
  if (text.includes('buy_side')) return 'buy_side';
  if (text.includes('sell_side')) return 'sell_side';
  return 'neutral';
}

function weightedBias(snapshots: TimeframeAnalysisSnapshot[], direction: 'bullish' | 'bearish'): number {
  return snapshots.reduce((sum, item) => sum + (directional(item.bias) === direction ? weights[item.timeframe] * Math.max(item.aiConfidenceScore, 0.25) : 0), 0);
}

function controllingTimeframe(snapshots: TimeframeAnalysisSnapshot[]): MtfTimeframe | 'none' {
  const candidates = snapshots.filter((item) => item.aiConfidenceScore > 0);
  if (!candidates.length) return 'none';
  return candidates.sort((a, b) => weights[b.timeframe] * b.aiConfidenceScore - weights[a.timeframe] * a.aiConfidenceScore)[0].timeframe;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
