import type { AutonomousEntryPlan } from '@/lib/autonomous-entry-planner';
import { defaultStopPips, pipSizeForSymbol, type AutonomousTradeSide } from '@/lib/autonomous-stop-targets';
import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import { getCandleAnalysis } from '@/lib/candle-detection-store';
import { resolveLatestCaptureId } from '@/lib/capture-analysis-bootstrap';
import { resolveGoldDynamicRewardRisk } from '@/lib/gold-dynamic-reward-risk';
import { loadGoldStructureEntryAnchors } from '@/lib/gold-structure-anchors';
import { getLiquidityAnalysis } from '@/lib/liquidity-zone-store';
import { getOrderBlockAnalysis } from '@/lib/order-block-detection-store';
import { isGoldSymbol } from '@/lib/gold-trading-engine';
import { queryPostgres } from '@/lib/postgres';
import { getLatestVisualAnomaly } from '@/lib/visual-anomaly-detection-store';
import { analyzeVisualAnomalies } from '@/lib/visual-anomaly-detection-engine';
import type { ReconstructedCandle } from '@/lib/visual-intelligence-types';

export type EntryOptimizationScores = {
  expectedDrawdownSafety: number;
  entryEfficiency: number;
  liquidityLocation: number;
  retracementQuality: number;
  rewardRiskPotential: number;
  htfExtremeDistance: number;
  institutionalZoneProximity: number;
  expansionCandleProtection: number;
  composite: number;
};

export type HtfCandleContext = {
  timeframe: string;
  candleHigh: number;
  candleLow: number;
  candleOpen: number;
  candleClose: number;
  pricePosition: number;
  isBullish: boolean;
  isBearish: boolean;
  rangeAtrMultiple: number;
  nearHigh: boolean;
  nearLow: boolean;
};

export type EntryOptimizationResult = {
  ok: boolean;
  readyForBasket: boolean;
  deferToRetracement: boolean;
  blockMarketChase: boolean;
  continuationException: boolean;
  selectedEntryMode: 'market' | 'retracement_limit' | 'hybrid' | 'defer';
  scores: EntryOptimizationScores;
  breakdown: Record<string, number>;
  blockers: string[];
  recommendations: string[];
  optimalEntryPrice: number | null;
  expectedRetracementDepth: number | null;
  drawdownProbability: number;
  continuationProbability: number;
  htfAnalysis: { h4: HtfCandleContext | null; h1: HtfCandleContext | null };
  expansionRiskLevel: 'low' | 'moderate' | 'high' | 'critical';
};

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envBool(name: string, fallback = true): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundPrice(symbol: string, price: number): number {
  const normalized = symbol.toUpperCase();
  const digits = normalized.includes('XAU') || normalized.includes('GOLD') ? 2 : normalized.includes('JPY') ? 3 : 5;
  return Number(price.toFixed(digits));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeAtr(candles: ReconstructedCandle[], period = 14): number {
  const ranges = candles
    .map((candle) => Number(candle.highPrice) - Number(candle.lowPrice))
    .filter((value) => value > 0);
  if (!ranges.length) return 0;
  return average(ranges.slice(-period)) || average(ranges);
}

async function loadRecentCandles(symbol: string, timeframe: string, limit = 80): Promise<ReconstructedCandle[]> {
  const captureId = await resolveLatestCaptureId(symbol, timeframe);
  if (!captureId) return [];
  const result = await queryPostgres(
    `
      SELECT open_price, high_price, low_price, close_price, candle_index
      FROM reconstructed_candles
      WHERE chart_capture_id = $1
      ORDER BY candle_index DESC
      LIMIT $2
    `,
    [captureId, limit],
  );
  return result.rows
    .map((row) => ({
      candleIndex: Number((row as { candle_index?: number }).candle_index ?? 0),
      openPrice: Number((row as { open_price?: number }).open_price ?? 0),
      highPrice: Number((row as { high_price?: number }).high_price ?? 0),
      lowPrice: Number((row as { low_price?: number }).low_price ?? 0),
      closePrice: Number((row as { close_price?: number }).close_price ?? 0),
      pixelX: 0,
      pixelYOpen: 0,
      pixelYHigh: 0,
      pixelYLow: 0,
      pixelYClose: 0,
      direction: 'neutral' as const,
      confidence: 1,
    }))
    .filter((candle) => candle.highPrice > 0 && candle.lowPrice > 0)
    .sort((a, b) => a.candleIndex - b.candleIndex);
}

function analyzeHtfCandle(candles: ReconstructedCandle[], timeframe: string, currentPrice: number, atr: number): HtfCandleContext | null {
  const latest = candles[candles.length - 1];
  if (!latest) return null;
  const high = latest.highPrice;
  const low = latest.lowPrice;
  const range = high - low;
  if (range <= 0) return null;
  const position = clamp((currentPrice - low) / range, 0, 1);
  const extremePct = envNumber('CACSMS_ENTRY_HTF_EXTREME_PCT', 0.25);
  return {
    timeframe,
    candleHigh: high,
    candleLow: low,
    candleOpen: latest.openPrice,
    candleClose: latest.closePrice,
    pricePosition: Number(position.toFixed(4)),
    isBullish: latest.closePrice >= latest.openPrice,
    isBearish: latest.closePrice < latest.openPrice,
    rangeAtrMultiple: atr > 0 ? Number((range / atr).toFixed(4)) : 0,
    nearHigh: position >= 1 - extremePct,
    nearLow: position <= extremePct,
  };
}

function scoreHtfExtremeDistance(side: AutonomousTradeSide, h4: HtfCandleContext | null, h1: HtfCandleContext | null): number {
  const contexts = [h4, h1].filter(Boolean) as HtfCandleContext[];
  if (!contexts.length) return 55;
  let total = 0;
  for (const ctx of contexts) {
    if (side === 'BUY') {
      if (ctx.nearHigh) total += 12;
      else if (ctx.pricePosition <= 0.55) total += 88;
      else total += 58;
    } else {
      if (ctx.nearLow) total += 12;
      else if (ctx.pricePosition >= 0.45) total += 88;
      else total += 58;
    }
  }
  return Math.round(total / contexts.length);
}

function scoreExpansionCandleProtection(input: {
  side: AutonomousTradeSide;
  currentPrice: number;
  executionCandles: ReconstructedCandle[];
  h4: HtfCandleContext | null;
  h1: HtfCandleContext | null;
  volatilitySpikeScore: number;
}): { score: number; riskLevel: EntryOptimizationResult['expansionRiskLevel']; blockers: string[] } {
  const blockers: string[] = [];
  const atr = computeAtr(input.executionCandles) || 1;
  const latest = input.executionCandles[input.executionCandles.length - 1];
  const expansionThreshold = envNumber('CACSMS_ENTRY_EXPANSION_ATR_THRESHOLD', 2.2);
  let risk = 0;

  if (latest) {
    const range = latest.highPrice - latest.lowPrice;
    const atrMultiple = range / atr;
    const bullishExpansion = latest.closePrice >= latest.openPrice && atrMultiple >= expansionThreshold;
    const bearishExpansion = latest.closePrice < latest.openPrice && atrMultiple >= expansionThreshold;
    const position = range > 0 ? (input.currentPrice - latest.lowPrice) / range : 0.5;

    if (input.side === 'BUY' && bullishExpansion && position >= 0.72) {
      risk += 55;
      blockers.push('Expansion candle protection: avoid buying near the top of a large bullish impulse candle.');
    }
    if (input.side === 'SELL' && bearishExpansion && position <= 0.28) {
      risk += 55;
      blockers.push('Expansion candle protection: avoid selling near the bottom of a large bearish impulse candle.');
    }
  }

  for (const ctx of [input.h4, input.h1].filter(Boolean) as HtfCandleContext[]) {
    if (ctx.rangeAtrMultiple >= expansionThreshold) {
      if (input.side === 'BUY' && ctx.isBullish && ctx.nearHigh) risk += 20;
      if (input.side === 'SELL' && ctx.isBearish && ctx.nearLow) risk += 20;
    }
  }

  if (input.volatilitySpikeScore >= 0.72) risk += 18;

  const score = clamp(100 - risk, 0, 100);
  const riskLevel: EntryOptimizationResult['expansionRiskLevel'] =
    risk >= 70 ? 'critical' : risk >= 48 ? 'high' : risk >= 24 ? 'moderate' : 'low';
  return { score: Math.round(score), riskLevel, blockers };
}

function scoreLiquidityLocation(
  side: AutonomousTradeSide,
  currentPrice: number,
  liquidity: Awaited<ReturnType<typeof getLiquidityAnalysis>> | null,
  atr: number,
): number {
  if (!liquidity?.liquidityZones?.length) return 50;
  let best = 0;
  const tolerance = Math.max(atr * 0.35, currentPrice * 0.001);

  for (const zone of liquidity.liquidityZones) {
    const distance = Math.abs(currentPrice - zone.priceLevel);
    const proximity = distance <= tolerance ? 1 : clamp(1 - distance / Math.max(atr * 2, 1), 0, 0.75);
    let alignment = 0.35;
    if (side === 'BUY' && zone.liquiditySide === 'sell_side') alignment = 0.82;
    if (side === 'SELL' && zone.liquiditySide === 'buy_side') alignment = 0.82;
    if (zone.sweepStatus === 'swept' || zone.sweepStatus === 'reclaimed') alignment += 0.12;
    const score = proximity * alignment * (0.55 + zone.confidenceScore * 0.45) * 100;
    best = Math.max(best, score);
  }

  for (const sweep of liquidity.sweeps ?? []) {
    const distance = Math.abs(currentPrice - sweep.sweptPriceLevel);
    if (distance > tolerance * 1.5) continue;
    const aligned =
      (side === 'BUY' && sweep.sweepDirection === 'sell_side_sweep')
      || (side === 'SELL' && sweep.sweepDirection === 'buy_side_sweep');
    if (aligned) best = Math.max(best, 62 + sweep.sweepQualityScore * 35);
  }

  return Math.round(clamp(best, 0, 100));
}

function scoreInstitutionalZoneProximity(
  side: AutonomousTradeSide,
  currentPrice: number,
  anchors: Array<{ price: number; weight: number; source: string }>,
  orderBlocks: Awaited<ReturnType<typeof getOrderBlockAnalysis>> | null,
  atr: number,
): number {
  const zones: Array<{ price: number; weight: number }> = [...anchors.map((a) => ({ price: a.price, weight: a.weight }))];
  for (const block of orderBlocks?.orderBlocks ?? []) {
    if (side === 'BUY' && block.blockType === 'bullish') {
      zones.push({ price: (block.zoneLow + block.zoneHigh) / 2, weight: 0.7 + block.qualityScore * 0.5 });
    }
    if (side === 'SELL' && block.blockType === 'bearish') {
      zones.push({ price: (block.zoneLow + block.zoneHigh) / 2, weight: 0.7 + block.qualityScore * 0.5 });
    }
  }
  if (!zones.length) return 45;

  let best = 0;
  const maxDistance = atr * envNumber('CACSMS_ENTRY_MAX_ZONE_DISTANCE_ATR', 1.1);
  for (const zone of zones) {
    const distance = Math.abs(currentPrice - zone.price);
    const withinBand = side === 'BUY' ? currentPrice >= zone.price : currentPrice <= zone.price;
    const proximity = clamp(1 - distance / Math.max(maxDistance, 1), 0, 1);
    const directionalBonus = withinBand ? 0.18 : 0;
    best = Math.max(best, (proximity + directionalBonus) * zone.weight * 100);
  }
  return Math.round(clamp(best, 0, 100));
}

function scoreRetracementQuality(
  side: AutonomousTradeSide,
  currentPrice: number,
  entryPlan: AutonomousEntryPlan | null | undefined,
  atr: number,
): { score: number; depth: number | null } {
  if (!entryPlan) return { score: 42, depth: null };
  const depth = Math.abs(currentPrice - entryPlan.pendingEntryPrice);
  const depthAtr = atr > 0 ? depth / atr : 0;
  const sourceWeights: Record<string, number> = {
    bullish_order_block: 92,
    bearish_order_block: 92,
    bullish_fvg: 86,
    bearish_fvg: 86,
    bos_retest: 84,
    choch_retest: 86,
    swing_low: 72,
    swing_high: 72,
    fib_50: 68,
    fib_38_2: 64,
    ema20: 58,
    atr_retracement_fallback: 48,
  };
  const base = sourceWeights[entryPlan.method] ?? 55;
  const inZone = currentPrice >= entryPlan.zoneLow && currentPrice <= entryPlan.zoneHigh;
  const pendingRetrace = side === 'BUY'
    ? entryPlan.pendingEntryPrice < currentPrice
    : entryPlan.pendingEntryPrice > currentPrice;
  let score = base;
  if (inZone) score += 14;
  if (pendingRetrace && depthAtr >= 0.15 && depthAtr <= 1.1) score += 10;
  if (!pendingRetrace && depthAtr < 0.12) score -= 22;
  return { score: Math.round(clamp(score, 0, 100)), depth: roundPrice(entryPlan.side === 'BUY' ? 'XAUUSD' : 'XAUUSD', depth) };
}

function scoreExpectedDrawdownSafety(input: {
  side: AutonomousTradeSide;
  currentPrice: number;
  stopLoss: number;
  expansionScore: number;
  htfScore: number;
  atr: number;
}): { safety: number; drawdownProbability: number } {
  const stopDistance = Math.abs(input.currentPrice - input.stopLoss);
  const stopAtr = input.atr > 0 ? stopDistance / input.atr : 1;
  const immediateMaeRisk = clamp((stopAtr * 18) + (100 - input.expansionScore) * 0.35 + (100 - input.htfScore) * 0.25, 8, 92);
  const safety = Math.round(clamp(100 - immediateMaeRisk, 0, 100));
  return { safety, drawdownProbability: Number((immediateMaeRisk / 100).toFixed(4)) };
}

function scoreEntryEfficiency(
  rewardRiskPotential: number,
  retracementQuality: number,
  institutionalProximity: number,
  expansionScore: number,
): number {
  return Math.round(clamp(
    rewardRiskPotential * 0.28
    + retracementQuality * 0.28
    + institutionalProximity * 0.24
    + expansionScore * 0.2,
    0,
    100,
  ));
}

function resolveContinuationProbability(
  decision: Pick<AutonomousDecisionOutput, 'confidenceScore' | 'setupReadinessScore' | 'strategyBookScore' | 'signalScore' | 'institutionalPlan'>,
  dynamicTier: string,
): number {
  const book = decision.strategyBookScore ?? 0;
  const winProxy = decision.signalScore?.probabilityScore ?? decision.confidenceScore;
  const alignedStages = decision.institutionalPlan?.sequence.filter((s) => s.status === 'aligned' || s.status === 'confirmed').length ?? 0;
  let prob = clamp(
    decision.confidenceScore * 0.35
    + decision.setupReadinessScore * 0.25
    + winProxy * 0.2
    + book * 0.12
    + alignedStages * 4,
    0,
    100,
  );
  if (dynamicTier === 'institutional') prob += 8;
  return Number((clamp(prob, 0, 100) / 100).toFixed(4));
}

export function isEntryOptimizationEnabled(): boolean {
  return envBool('CACSMS_ENTRY_OPTIMIZATION_ENABLED', true);
}

/** Institutional entry optimization — signal establishes bias; basket deploys only after favorable risk location. */
export async function evaluateGoldInstitutionalEntryOptimization(input: {
  decision: Pick<
    AutonomousDecisionOutput,
    | 'symbol'
    | 'decision'
    | 'timeframe'
    | 'confidenceScore'
    | 'setupReadinessScore'
    | 'setupType'
    | 'reasonForDecision'
    | 'institutionalPlan'
    | 'finalBias'
    | 'strategyBookScore'
    | 'regimeClassification'
    | 'tradingStyle'
    | 'capitalAllocation'
    | 'selectedStrategyId'
    | 'signalScore'
    | 'stopLoss'
  >;
  currentPrice: number;
  stopLoss?: number | null;
  rewardRiskRatio?: number | null;
  entryPlan?: AutonomousEntryPlan | null;
}): Promise<EntryOptimizationResult> {
  const empty: EntryOptimizationResult = {
    ok: true,
    readyForBasket: true,
    deferToRetracement: false,
    blockMarketChase: false,
    continuationException: false,
    selectedEntryMode: 'market',
    scores: {
      expectedDrawdownSafety: 100,
      entryEfficiency: 100,
      liquidityLocation: 100,
      retracementQuality: 100,
      rewardRiskPotential: 100,
      htfExtremeDistance: 100,
      institutionalZoneProximity: 100,
      expansionCandleProtection: 100,
      composite: 100,
    },
    breakdown: {},
    blockers: [],
    recommendations: [],
    optimalEntryPrice: input.currentPrice,
    expectedRetracementDepth: null,
    drawdownProbability: 0,
    continuationProbability: 0,
    htfAnalysis: { h4: null, h1: null },
    expansionRiskLevel: 'low',
  };

  if (!isEntryOptimizationEnabled()) return empty;
  if (!isGoldSymbol(input.decision.symbol)) return empty;
  if (input.decision.decision !== 'BUY' && input.decision.decision !== 'SELL') return empty;

  const symbol = input.decision.symbol.toUpperCase();
  const side = input.decision.decision as AutonomousTradeSide;
  const currentPrice = Number(input.currentPrice);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return {
      ...empty,
      ok: false,
      readyForBasket: false,
      selectedEntryMode: 'defer',
      blockers: ['Entry optimization blocked — live price unavailable.'],
    };
  }

  const timeframe = String(input.decision.timeframe ?? 'M15').toUpperCase();
  const stopLoss = Number(input.stopLoss ?? input.decision.stopLoss ?? 0);
  const dynamicPlan = resolveGoldDynamicRewardRisk(input.decision);
  const continuationProbability = resolveContinuationProbability(input.decision, dynamicPlan.tier);
  const continuationThreshold = envNumber('CACSMS_ENTRY_CONTINUATION_EXCEPTION_CONFIDENCE', 88) / 100;
  const continuationException = continuationProbability >= continuationThreshold && dynamicPlan.tier !== 'standard';

  const [executionCandles, h4Candles, h1Candles, captureId] = await Promise.all([
    loadRecentCandles(symbol, timeframe),
    loadRecentCandles(symbol, 'H4'),
    loadRecentCandles(symbol, 'H1'),
    resolveLatestCaptureId(symbol, timeframe),
  ]);

  const atr = computeAtr(executionCandles) || defaultStopPips(symbol, timeframe) * pipSizeForSymbol(symbol);
  const h4Atr = computeAtr(h4Candles) || atr;
  const h1Atr = computeAtr(h1Candles) || atr;
  const h4 = analyzeHtfCandle(h4Candles, 'H4', currentPrice, h4Atr);
  const h1 = analyzeHtfCandle(h1Candles, 'H1', currentPrice, h1Atr);

  const [liquidity, orderBlocks, structureAnchors, candleAnalysis, storedAnomaly] = await Promise.all([
    captureId ? getLiquidityAnalysis(captureId).catch(() => null) : Promise.resolve(null),
    captureId ? getOrderBlockAnalysis(captureId).catch(() => null) : Promise.resolve(null),
    loadGoldStructureEntryAnchors({ symbol, timeframe, side }),
    captureId ? getCandleAnalysis(captureId).catch(() => null) : Promise.resolve(null),
    getLatestVisualAnomaly(symbol, timeframe).catch(() => null),
  ]);

  const liveAnomaly = executionCandles.length >= 8
    ? analyzeVisualAnomalies({ symbol, timeframe, candles: executionCandles })
    : null;
  const volatilitySpikeScore = Math.max(
    storedAnomaly?.severity?.volatilitySpikeScore ?? 0,
    liveAnomaly?.volatilitySpikeScore ?? 0,
  );

  const expansion = scoreExpansionCandleProtection({
    side,
    currentPrice,
    executionCandles,
    h4,
    h1,
    volatilitySpikeScore,
  });

  const htfExtremeDistance = scoreHtfExtremeDistance(side, h4, h1);
  const liquidityLocation = scoreLiquidityLocation(side, currentPrice, liquidity, atr);
  const institutionalZoneProximity = scoreInstitutionalZoneProximity(side, currentPrice, structureAnchors, orderBlocks, atr);
  const retracement = scoreRetracementQuality(side, currentPrice, input.entryPlan, atr);
  const rewardRiskPotential = Math.round(clamp(
    (input.rewardRiskRatio ?? dynamicPlan.extendedTargetR) / Math.max(dynamicPlan.floor, 2) * 55
    + dynamicPlan.setupScore * 0.45,
    0,
    100,
  ));

  const drawdown = scoreExpectedDrawdownSafety({
    side,
    currentPrice,
    stopLoss: stopLoss > 0 ? stopLoss : (side === 'BUY' ? currentPrice - atr : currentPrice + atr),
    expansionScore: expansion.score,
    htfScore: htfExtremeDistance,
    atr,
  });

  const entryEfficiency = scoreEntryEfficiency(
    rewardRiskPotential,
    retracement.score,
    institutionalZoneProximity,
    expansion.score,
  );

  const weights = {
    drawdown: 0.16,
    efficiency: 0.12,
    liquidity: 0.1,
    retracement: 0.16,
    rr: 0.1,
    htf: 0.14,
    institutional: 0.14,
    expansion: 0.08,
  };
  let composite = Math.round(
    drawdown.safety * weights.drawdown
    + entryEfficiency * weights.efficiency
    + liquidityLocation * weights.liquidity
    + retracement.score * weights.retracement
    + rewardRiskPotential * weights.rr
    + htfExtremeDistance * weights.htf
    + institutionalZoneProximity * weights.institutional
    + expansion.score * weights.expansion,
  );
  const strategyBookScore = Number(input.decision.strategyBookScore ?? 0);
  const readinessScore = Number(input.decision.setupReadinessScore ?? 0);
  if (strategyBookScore >= 95) composite = Math.min(100, composite + 8);
  else if (strategyBookScore >= 85) composite = Math.min(100, composite + 5);
  if (readinessScore >= 92) composite = Math.min(100, composite + 4);

  const minScore = envNumber('CACSMS_ENTRY_OPTIMIZATION_MIN_SCORE', 62);
  const minRetracementScore = envNumber('CACSMS_ENTRY_MIN_RETRACEMENT_SCORE', 58);
  const blockers = [...expansion.blockers];
  const recommendations: string[] = [];

  const chasingExpansion = expansion.riskLevel === 'high' || expansion.riskLevel === 'critical';
  const htfDanger = side === 'BUY'
    ? Boolean(h4?.nearHigh || h1?.nearHigh)
    : Boolean(h4?.nearLow || h1?.nearLow);
  const blockMarketChase = (chasingExpansion || htfDanger) && !continuationException;

  if (chasingExpansion && !continuationException) {
    recommendations.push('Wait for retracement into institutional zone before basket activation.');
  }
  if (htfDanger && !continuationException) {
    recommendations.push(side === 'BUY'
      ? 'Price is too close to H4/H1 candle highs — prefer pullback within bullish structure.'
      : 'Price is too close to H4/H1 candle lows — prefer pullback within bearish structure.');
  }
  if (institutionalZoneProximity < 50) {
    recommendations.push('Seek entry nearer bullish/bearish order block, FVG mitigation, or liquidity reclaim.');
  }

  const deferToRetracement = blockMarketChase
    || retracement.score < minRetracementScore
    || (composite < minScore && !continuationException);

  let selectedEntryMode: EntryOptimizationResult['selectedEntryMode'] = 'market';
  if (composite < minScore - 12 && !continuationException) {
    selectedEntryMode = 'defer';
    blockers.push(`Entry optimization composite ${composite}% below minimum ${minScore}% — setup eligible but entry location unfavorable.`);
  } else if (deferToRetracement) {
    selectedEntryMode = input.entryPlan ? 'retracement_limit' : 'defer';
    if (!input.entryPlan) {
      blockers.push('Entry optimization requires retracement confirmation but no institutional entry zone was resolved.');
    } else {
      recommendations.push(`Deploy basket at retracement limit ${input.entryPlan.pendingEntryPrice} (${input.entryPlan.method}).`);
    }
  } else if (blockMarketChase && input.entryPlan) {
    selectedEntryMode = 'hybrid';
  } else if (entryEfficiency >= 72 && expansion.score >= 68) {
    selectedEntryMode = 'market';
  }

  if (candleAnalysis?.sequences?.some((seq) => /expansion/i.test(seq.detectedSequenceType) && seq.confidence >= 0.65)) {
    if (!continuationException && retracement.score < 65) {
      recommendations.push('Recent expansion sequence detected — confirmation candle required before market entry.');
    }
  }

  let readyForBasket = blockers.length === 0
    && selectedEntryMode !== 'defer'
    && drawdown.safety >= envNumber('CACSMS_ENTRY_MIN_DRAWDOWN_SAFETY', 48);

  const minCompositeForMode = selectedEntryMode === 'retracement_limit' || selectedEntryMode === 'hybrid'
    ? minScore - 12
    : continuationException
      ? minScore - 8
      : minScore;

  if (readyForBasket && composite < minCompositeForMode) {
    readyForBasket = false;
    blockers.push(`Entry quality ${composite}% insufficient for basket deployment (minimum ${minCompositeForMode}%).`);
  }

  const scores: EntryOptimizationScores = {
    expectedDrawdownSafety: drawdown.safety,
    entryEfficiency,
    liquidityLocation,
    retracementQuality: retracement.score,
    rewardRiskPotential,
    htfExtremeDistance,
    institutionalZoneProximity,
    expansionCandleProtection: expansion.score,
    composite,
  };

  return {
    ok: readyForBasket,
    readyForBasket,
    deferToRetracement,
    blockMarketChase,
    continuationException,
    selectedEntryMode,
    scores,
    breakdown: {
      drawdownSafety: drawdown.safety,
      entryEfficiency,
      liquidityLocation,
      retracementQuality: retracement.score,
      rewardRiskPotential,
      htfExtremeDistance,
      institutionalZoneProximity,
      expansionCandleProtection: expansion.score,
      continuationProbability: Math.round(continuationProbability * 100),
      dynamicSetupScore: dynamicPlan.setupScore,
      strategyBookBoost: strategyBookScore,
      readinessBoost: readinessScore,
    },
    blockers,
    recommendations,
    optimalEntryPrice: input.entryPlan?.pendingEntryPrice ?? (deferToRetracement ? null : currentPrice),
    expectedRetracementDepth: retracement.depth,
    drawdownProbability: drawdown.drawdownProbability,
    continuationProbability,
    htfAnalysis: { h4, h1 },
    expansionRiskLevel: expansion.riskLevel,
  };
}
