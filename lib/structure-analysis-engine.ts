import { analyzeCandles, normalizeInputCandles } from './candle-detection-engine';
import { analyzeLiquidityZones } from './liquidity-zone-engine';
import { analyzeOrderBlocks } from './order-block-detection-engine';
import { analyzeSupportResistance } from './support-resistance-engine';
import { analyzeSwingPoints, type SwingDetection } from './swing-point-engine';
import type { ReconstructedCandle, VisionCandleInput, VisionDecision } from './visual-intelligence-types';

export interface StructureEvent {
  id?: string;
  chartCaptureId?: string;
  eventType: 'BOS' | 'CHOCH' | 'MSS';
  direction: 'bullish' | 'bearish';
  candleIndex: number;
  priceLevel: number;
  validationScore: number;
  displacementScore: number;
  liquidityContextScore: number;
  falseBreakRisk: number;
  explanationText: string;
  geometry: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface StructurePhaseSnapshot {
  id?: string;
  chartCaptureId?: string;
  phaseState: string;
  accumulationScore: number;
  manipulationScore: number;
  expansionScore: number;
  distributionScore: number;
  consolidationScore: number;
  continuationScore: number;
  reversalScore: number;
  explanationText: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface StructureAnalysisOutput {
  id?: string;
  chartCaptureId?: string;
  currentStructure: string;
  currentMarketPhase: string;
  institutionalBias: string;
  retailTrapRisk: number;
  confidenceScore: number;
  tradeDecision: VisionDecision;
  mssStatus: string;
  lastBos: Record<string, unknown>;
  lastChoch: Record<string, unknown>;
  multiTimeframe: Record<string, unknown>;
  reasoningText: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface StructureAnalysisResult {
  output: StructureAnalysisOutput;
  events: StructureEvent[];
  bos: StructureEvent[];
  choch: StructureEvent[];
  mss: StructureEvent[];
  phase: StructurePhaseSnapshot;
  finalBias: {
    institutionalBias: string;
    retailTrapRisk: number;
    confidenceScore: number;
    tradeDecision: VisionDecision;
    reasoningText: string;
    multiTimeframe: Record<string, unknown>;
  };
  summary: {
    currentStructure: string;
    currentMarketPhase: string;
    institutionalBias: string;
    tradeDecision: VisionDecision;
    confidence: number;
    explanation: string;
  };
}

type Context = ReturnType<typeof buildContext>;

export function normalizeStructureInputCandles(input: VisionCandleInput[]): ReconstructedCandle[] {
  return normalizeInputCandles(input);
}

export function analyzeMarketStructure(candles: ReconstructedCandle[], timeframe = 'M15'): StructureAnalysisResult {
  if (candles.length < 12) {
    const phase = emptyPhase();
    const output = emptyOutput();
    return {
      output,
      events: [],
      bos: [],
      choch: [],
      mss: [],
      phase,
      finalBias: finalBiasFrom(output),
      summary: {
        currentStructure: output.currentStructure,
        currentMarketPhase: output.currentMarketPhase,
        institutionalBias: output.institutionalBias,
        tradeDecision: output.tradeDecision,
        confidence: 0,
        explanation: output.reasoningText,
      },
    };
  }

  const context = buildContext(candles);
  const swingAnalysis = analyzeSwingPoints(candles, { timeframe, depths: [1, 2, 4, 7], zigzagPercent: 0.08 });
  const swings = swingAnalysis.swings.length ? swingAnalysis.swings : fallbackSwings(candles, context);
  const bos = detectBos(candles, swings, context);
  const choch = detectChoch(bos, swings, context);
  const liquidity = analyzeLiquidityZones(candles);
  const mss = detectMss(candles, bos, liquidity.sweeps, context);
  const phase = classifyPhase(candles, bos, choch, mss, liquidity, context);
  const candlesAi = analyzeCandles(candles);
  const orderBlocks = analyzeOrderBlocks(candles);
  const supportResistance = analyzeSupportResistance(candles);
  const finalBias = buildFinalBias({
    bos,
    choch,
    mss,
    phase,
    liquidity,
    orderBlocks,
    supportResistance,
    candleDecision: candlesAi.summary.recommendedDecision,
    context,
    timeframe,
  });
  const currentStructure = currentStructureFrom(swings, bos, choch);
  const output: StructureAnalysisOutput = {
    currentStructure,
    currentMarketPhase: phase.phaseState,
    institutionalBias: finalBias.institutionalBias,
    retailTrapRisk: finalBias.retailTrapRisk,
    confidenceScore: finalBias.confidenceScore,
    tradeDecision: finalBias.tradeDecision,
    mssStatus: mss.at(-1)?.direction ? `${mss.at(-1)?.direction}_mss_confirmed` : 'no_confirmed_mss',
    lastBos: eventSummary(bos.at(-1)),
    lastChoch: eventSummary(choch.at(-1)),
    multiTimeframe: finalBias.multiTimeframe,
    reasoningText: finalBias.reasoningText,
    metadata: {
      swingHierarchy: swingAnalysis.hierarchy,
      swingCount: swings.length,
      bosCount: bos.length,
      chochCount: choch.length,
      mssCount: mss.length,
      candleSummary: candlesAi.summary,
      orderBlockSummary: orderBlocks.summary,
      liquiditySummary: liquidity.summary,
      supportResistanceSummary: supportResistance.summary,
    },
  };
  const events = [...bos, ...choch, ...mss].sort((a, b) => a.candleIndex - b.candleIndex);
  return {
    output,
    events,
    bos,
    choch,
    mss,
    phase,
    finalBias,
    summary: {
      currentStructure,
      currentMarketPhase: phase.phaseState,
      institutionalBias: finalBias.institutionalBias,
      tradeDecision: finalBias.tradeDecision,
      confidence: finalBias.confidenceScore,
      explanation: finalBias.reasoningText,
    },
  };
}

function detectBos(candles: ReconstructedCandle[], swings: SwingDetection[], context: Context): StructureEvent[] {
  const events: StructureEvent[] = [];
  const significant = swings.filter((swing) => swing.strengthScore >= 0.42 || swing.liquidityRelevance >= 0.45);
  for (const candle of candles.slice(4)) {
    const previousSwings = significant.filter((swing) => swing.candleIndex < candle.candleIndex);
    const lastHigh = previousSwings.filter((swing) => swing.swingKind === 'high').at(-1);
    const lastLow = previousSwings.filter((swing) => swing.swingKind === 'low').at(-1);
    const displacement = candleDisplacement(candle, context);
    if (lastHigh && candle.closePrice > lastHigh.priceLevel && displacement >= 0.35) {
      events.push(buildStructureEvent('BOS', 'bullish', candle, lastHigh.priceLevel, displacement, lastHigh.liquidityRelevance, context));
    }
    if (lastLow && candle.closePrice < lastLow.priceLevel && displacement >= 0.35) {
      events.push(buildStructureEvent('BOS', 'bearish', candle, lastLow.priceLevel, displacement, lastLow.liquidityRelevance, context));
    }
  }
  return dedupeEvents(events);
}

function detectChoch(bos: StructureEvent[], swings: SwingDetection[], context: Context): StructureEvent[] {
  const events: StructureEvent[] = [];
  for (let index = 1; index < bos.length; index += 1) {
    const previous = bos[index - 1];
    const current = bos[index];
    if (previous.direction === current.direction) continue;
    const swingQuality = average(swings.filter((swing) => Math.abs(swing.candleIndex - current.candleIndex) <= 4).map((swing) => swing.strengthScore));
    const validation = clamp(current.validationScore * 0.62 + swingQuality * 0.22 + (1 - current.falseBreakRisk) * 0.16, 0, 1);
    if (validation < 0.42) continue;
    events.push({
      ...current,
      eventType: 'CHOCH',
      validationScore: validation,
      explanationText: `${current.direction} CHOCH confirmed after prior ${previous.direction} structure failed with ${percent(validation)} validation.`,
      metadata: { ...current.metadata, previousDirection: previous.direction, lowerTimeframeTransition: context.lowerTimeframeTransition },
    });
  }
  return events;
}

function detectMss(candles: ReconstructedCandle[], bos: StructureEvent[], sweeps: Array<{ candleIndex: number; sweepQualityScore: number; sweepDirection: string }>, context: Context): StructureEvent[] {
  const events: StructureEvent[] = [];
  for (const sweep of sweeps) {
    const followThrough = bos.find((event) => event.candleIndex > sweep.candleIndex && event.candleIndex <= sweep.candleIndex + 8);
    if (!followThrough) continue;
    const validation = clamp(sweep.sweepQualityScore * 0.46 + followThrough.displacementScore * 0.34 + followThrough.validationScore * 0.2, 0, 1);
    if (validation < 0.45) continue;
    const candle = candles[followThrough.candleIndex] ?? candles.at(-1)!;
    events.push({
      eventType: 'MSS',
      direction: followThrough.direction,
      candleIndex: followThrough.candleIndex,
      priceLevel: followThrough.priceLevel,
      validationScore: validation,
      displacementScore: followThrough.displacementScore,
      liquidityContextScore: sweep.sweepQualityScore,
      falseBreakRisk: clamp(1 - validation, 0, 1),
      explanationText: `${followThrough.direction} MSS confirmed after ${sweep.sweepDirection} with ${percent(validation)} validation.`,
      geometry: { candleIndex: candle.candleIndex, x: candle.pixelX, highY: candle.pixelYHigh, lowY: candle.pixelYLow },
      metadata: { sweep, followedByBos: followThrough },
    });
  }
  return events;
}

function classifyPhase(
  candles: ReconstructedCandle[],
  bos: StructureEvent[],
  choch: StructureEvent[],
  mss: StructureEvent[],
  liquidity: ReturnType<typeof analyzeLiquidityZones>,
  context: Context,
): StructurePhaseSnapshot {
  const recentBos = bos.slice(-4);
  const bullishBos = recentBos.filter((event) => event.direction === 'bullish').length;
  const bearishBos = recentBos.filter((event) => event.direction === 'bearish').length;
  const manipulation = clamp(average(liquidity.liquidityZones.map((zone) => zone.manipulationScore)) * 0.5 + liquidity.sweeps.length / 4 * 0.3 + mss.length / 4 * 0.2, 0, 1);
  const expansion = clamp(context.displacementScore * 0.52 + bos.length / 8 * 0.28 + context.volatilityExpansionScore * 0.2, 0, 1);
  const consolidation = clamp(context.compressionScore * 0.62 + (recentBos.length === 0 ? 0.22 : 0) + context.rangeBalance * 0.16, 0, 1);
  const continuation = clamp((Math.max(bullishBos, bearishBos) / 4) * 0.42 + expansion * 0.3 + (choch.length ? 0 : 0.16), 0, 1);
  const reversal = clamp(choch.length / 3 * 0.42 + mss.length / 3 * 0.36 + manipulation * 0.22, 0, 1);
  const accumulation = clamp(consolidation * 0.36 + (bullishBos >= bearishBos ? 0.16 : 0.04) + liquidity.voids.length / 6 * 0.14 + (context.trendDirection === 'bullish' ? 0.14 : 0), 0, 1);
  const distribution = clamp(consolidation * 0.36 + (bearishBos >= bullishBos ? 0.16 : 0.04) + liquidity.voids.length / 6 * 0.14 + (context.trendDirection === 'bearish' ? 0.14 : 0), 0, 1);
  const entries = { accumulation, manipulation, expansion, distribution, consolidation, continuation, reversal };
  const phaseState = Object.entries(entries).sort((a, b) => b[1] - a[1])[0][0];
  return {
    phaseState,
    accumulationScore: accumulation,
    manipulationScore: manipulation,
    expansionScore: expansion,
    distributionScore: distribution,
    consolidationScore: consolidation,
    continuationScore: continuation,
    reversalScore: reversal,
    explanationText: `Market phase classified as ${phaseState}: expansion ${percent(expansion)}, manipulation ${percent(manipulation)}, consolidation ${percent(consolidation)}, reversal ${percent(reversal)}.`,
    metadata: { recentBos, liquiditySummary: liquidity.summary, volatilityExpansion: context.volatilityExpansionScore },
  };
}

function buildFinalBias(input: {
  bos: StructureEvent[];
  choch: StructureEvent[];
  mss: StructureEvent[];
  phase: StructurePhaseSnapshot;
  liquidity: ReturnType<typeof analyzeLiquidityZones>;
  orderBlocks: ReturnType<typeof analyzeOrderBlocks>;
  supportResistance: ReturnType<typeof analyzeSupportResistance>;
  candleDecision: VisionDecision;
  context: Context;
  timeframe: string;
}) {
  const lastBos = input.bos.at(-1);
  const lastChoch = input.choch.at(-1);
  const lastMss = input.mss.at(-1);
  const directionalEvent = lastMss ?? lastChoch ?? lastBos;
  const bullishScore = scoreDecisionSide('bullish', input, directionalEvent);
  const bearishScore = scoreDecisionSide('bearish', input, directionalEvent);
  const trapRisk = clamp(average(input.liquidity.liquidityZones.map((zone) => zone.trapProbability)) * 0.48 + input.phase.manipulationScore * 0.32 + input.choch.length / 6 * 0.2, 0, 1);
  const institutionalBias = bullishScore > bearishScore + 0.12
    ? 'bullish institutional bias'
    : bearishScore > bullishScore + 0.12
      ? 'bearish institutional bias'
      : trapRisk > 0.62
        ? 'liquidity-seeking bias'
        : 'neutral/ranging bias';
  const confidenceScore = clamp(Math.max(bullishScore, bearishScore) * 0.58 + (directionalEvent?.validationScore ?? 0) * 0.22 + (1 - trapRisk) * 0.2, 0, 0.98);
  const tradeDecision = decisionFor(institutionalBias, confidenceScore, trapRisk);
  const multiTimeframe = multiTimeframeAlignment(input.timeframe, institutionalBias, input.context);
  const reasoningText = `Structure points to ${institutionalBias}: last BOS ${lastBos?.direction ?? 'none'}, last CHOCH ${lastChoch?.direction ?? 'none'}, MSS ${lastMss?.direction ?? 'none'}, phase ${input.phase.phaseState}, retail trap risk ${percent(trapRisk)}. Final decision is ${tradeDecision} with ${percent(confidenceScore)} confidence.`;
  return { institutionalBias, retailTrapRisk: trapRisk, confidenceScore, tradeDecision, reasoningText, multiTimeframe };
}

function scoreDecisionSide(direction: 'bullish' | 'bearish', input: Parameters<typeof buildFinalBias>[0], event?: StructureEvent): number {
  const eventScore = event?.direction === direction ? event.validationScore : 0;
  const obScore = average(input.orderBlocks.orderBlocks.filter((block) => block.blockType === direction).map((block) => block.qualityScore));
  const liquidityScore = average(input.liquidity.liquidityZones.filter((zone) => (
    direction === 'bullish' ? zone.liquiditySide === 'sell_side' && zone.sweepStatus === 'swept_and_rejected' : zone.liquiditySide === 'buy_side' && zone.sweepStatus === 'swept_and_rejected'
  )).map((zone) => zone.manipulationScore));
  const srScore = average(input.supportResistance.zones.filter((zone) => direction === 'bullish' ? zone.zoneType === 'support' : zone.zoneType === 'resistance').map((zone) => zone.strengthScore));
  const candleScore = input.candleDecision === (direction === 'bullish' ? 'BUY' : 'SELL') ? 0.72 : 0.35;
  const phaseScore = direction === 'bullish'
    ? Math.max(input.phase.accumulationScore, input.phase.continuationScore, input.phase.expansionScore)
    : Math.max(input.phase.distributionScore, input.phase.continuationScore, input.phase.expansionScore);
  return clamp(eventScore * 0.26 + obScore * 0.2 + liquidityScore * 0.18 + srScore * 0.14 + candleScore * 0.1 + phaseScore * 0.12, 0, 1);
}

function buildStructureEvent(eventType: 'BOS', direction: 'bullish' | 'bearish', candle: ReconstructedCandle, level: number, displacement: number, liquidity: number, context: Context): StructureEvent {
  const wickOnlyRisk = direction === 'bullish' ? clamp((candle.highPrice - candle.closePrice) / Math.max(0.0001, context.atr), 0, 1) : clamp((candle.closePrice - candle.lowPrice) / Math.max(0.0001, context.atr), 0, 1);
  const validationScore = clamp(displacement * 0.42 + Math.min(Math.abs(candle.closePrice - level) / Math.max(0.0001, context.atr), 1) * 0.32 + liquidity * 0.14 + (1 - wickOnlyRisk) * 0.12, 0, 1);
  return {
    eventType,
    direction,
    candleIndex: candle.candleIndex,
    priceLevel: round(level),
    validationScore,
    displacementScore: displacement,
    liquidityContextScore: liquidity,
    falseBreakRisk: clamp(wickOnlyRisk * 0.55 + (validationScore < 0.48 ? 0.2 : 0), 0, 1),
    explanationText: `${direction} BOS closed beyond ${round(level)} with ${percent(validationScore)} validation and ${percent(displacement)} displacement.`,
    geometry: { candleIndex: candle.candleIndex, x: candle.pixelX, highY: candle.pixelYHigh, lowY: candle.pixelYLow, level },
    metadata: { closePrice: candle.closePrice, wickOnlyRisk },
  };
}

function buildContext(candles: ReconstructedCandle[]) {
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const bodies = candles.map((candle) => Math.abs(candle.closePrice - candle.openPrice));
  const atr = average(ranges.slice(-14)) || average(ranges) || 1;
  const first = candles[0];
  const last = candles.at(-1)!;
  const recentRange = average(ranges.slice(-8));
  const baselineRange = average(ranges);
  return {
    atr,
    trendDirection: last.closePrice > first.openPrice ? 'bullish' : last.closePrice < first.openPrice ? 'bearish' : 'neutral',
    displacementScore: clamp(Math.max(...bodies.slice(-8)) / Math.max(0.0001, atr), 0, 1),
    volatilityExpansionScore: clamp(recentRange / Math.max(0.0001, baselineRange * 1.25), 0, 1),
    compressionScore: clamp(1 - recentRange / Math.max(0.0001, atr * 1.25), 0, 1),
    rangeBalance: clamp(1 - Math.abs(last.closePrice - first.openPrice) / Math.max(0.0001, baselineRange * candles.length * 0.35), 0, 1),
    lowerTimeframeTransition: 'approximated_from_visible_sequence',
  };
}

function candleDisplacement(candle: ReconstructedCandle, context: Context): number {
  const body = Math.abs(candle.closePrice - candle.openPrice);
  const range = Math.max(0.0001, candle.highPrice - candle.lowPrice);
  return clamp((body / range) * 0.45 + (range / Math.max(0.0001, context.atr * 1.4)) * 0.35 + (body / Math.max(0.0001, context.atr)) * 0.2, 0, 1);
}

function fallbackSwings(candles: ReconstructedCandle[], context: Context): SwingDetection[] {
  const step = Math.max(2, Math.floor(candles.length / 8));
  return candles.filter((_, index) => index % step === 0).map((candle, index) => {
    const high = index % 2 === 1;
    return {
      candleIndex: candle.candleIndex,
      swingKind: high ? 'high' : 'low',
      swingCategory: 'minor swing',
      priceLevel: high ? candle.highPrice : candle.lowPrice,
      pixelX: candle.pixelX,
      pixelY: high ? candle.pixelYHigh : candle.pixelYLow,
      depth: 1,
      leftStrength: 0.4,
      rightStrength: 0.4,
      atrValidationScore: 0.4,
      zigzagValidationScore: 0.4,
      rejectionScore: 0.35,
      continuationScore: 0.35,
      liquidityRelevance: 0.25,
      turningPointProbability: 0.4,
      strengthScore: clamp(context.displacementScore * 0.4 + 0.35, 0, 1),
      swept: false,
      structuralImportance: 'fallback structure point',
      aiExplanation: 'Fallback structure point generated from visible candle sequence.',
      geometry: {},
      metadata: {},
    };
  });
}

function currentStructureFrom(swings: SwingDetection[], bos: StructureEvent[], choch: StructureEvent[]): string {
  const last = choch.at(-1) ?? bos.at(-1);
  if (last) return `${last.direction}_${last.eventType.toLowerCase()}_structure`;
  const highs = swings.filter((swing) => swing.swingKind === 'high').slice(-2);
  const lows = swings.filter((swing) => swing.swingKind === 'low').slice(-2);
  if (highs.length >= 2 && lows.length >= 2) {
    if (highs[1].priceLevel > highs[0].priceLevel && lows[1].priceLevel > lows[0].priceLevel) return 'bullish_higher_high_higher_low';
    if (highs[1].priceLevel < highs[0].priceLevel && lows[1].priceLevel < lows[0].priceLevel) return 'bearish_lower_high_lower_low';
  }
  return 'range_or_developing_structure';
}

function multiTimeframeAlignment(timeframe: string, bias: string, context: Context) {
  const direction = bias.includes('bullish') ? 'bullish' : bias.includes('bearish') ? 'bearish' : 'neutral';
  const weights: Record<string, number> = { M15: 0.32, H1: 0.28, H4: 0.24, D1: 0.16 };
  return {
    sourceTimeframe: timeframe,
    inferredM15: { bias: direction, weight: weights.M15, aligned: direction === context.trendDirection || direction === 'neutral' },
    inferredH1: { bias: context.trendDirection, weight: weights.H1, aligned: direction === context.trendDirection || direction === 'neutral' },
    inferredH4: { bias: context.trendDirection, weight: weights.H4, aligned: direction === context.trendDirection || direction === 'neutral' },
    inferredD1: { bias: context.trendDirection === 'neutral' ? 'range' : context.trendDirection, weight: weights.D1, aligned: true },
    alignmentScore: direction === context.trendDirection ? 0.78 : direction === 'neutral' ? 0.52 : 0.34,
  };
}

function decisionFor(bias: string, confidence: number, trapRisk: number): VisionDecision {
  if (trapRisk >= 0.78) return 'AVOID';
  if (confidence < 0.56 || bias.includes('neutral') || bias.includes('liquidity-seeking')) return 'WAIT';
  if (bias.includes('bullish')) return 'BUY';
  if (bias.includes('bearish')) return 'SELL';
  return 'WAIT';
}

function dedupeEvents(events: StructureEvent[]): StructureEvent[] {
  const accepted: StructureEvent[] = [];
  for (const event of events.sort((a, b) => a.candleIndex - b.candleIndex || b.validationScore - a.validationScore)) {
    const duplicate = accepted.some((item) => item.eventType === event.eventType && item.direction === event.direction && Math.abs(item.candleIndex - event.candleIndex) <= 2);
    if (!duplicate) accepted.push(event);
  }
  return accepted;
}

function eventSummary(event?: StructureEvent): Record<string, unknown> {
  return event ? { direction: event.direction, candleIndex: event.candleIndex, priceLevel: event.priceLevel, validationScore: event.validationScore, explanation: event.explanationText } : {};
}

function finalBiasFrom(output: StructureAnalysisOutput) {
  return {
    institutionalBias: output.institutionalBias,
    retailTrapRisk: output.retailTrapRisk,
    confidenceScore: output.confidenceScore,
    tradeDecision: output.tradeDecision,
    reasoningText: output.reasoningText,
    multiTimeframe: output.multiTimeframe,
  };
}

function emptyOutput(): StructureAnalysisOutput {
  return {
    currentStructure: 'insufficient_data',
    currentMarketPhase: 'unknown',
    institutionalBias: 'neutral/ranging bias',
    retailTrapRisk: 0,
    confidenceScore: 0,
    tradeDecision: 'WAIT',
    mssStatus: 'no_confirmed_mss',
    lastBos: {},
    lastChoch: {},
    multiTimeframe: {},
    reasoningText: 'At least twelve candles are required for complete market structure analysis.',
    metadata: {},
  };
}

function emptyPhase(): StructurePhaseSnapshot {
  return {
    phaseState: 'unknown',
    accumulationScore: 0,
    manipulationScore: 0,
    expansionScore: 0,
    distributionScore: 0,
    consolidationScore: 0,
    continuationScore: 0,
    reversalScore: 0,
    explanationText: 'Insufficient data for phase classification.',
    metadata: {},
  };
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
