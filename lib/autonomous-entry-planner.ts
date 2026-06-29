import { getLiquidityAnalysis } from '@/lib/liquidity-zone-store';
import { resolveLatestCaptureId } from '@/lib/capture-analysis-bootstrap';
import { loadGoldStructureEntryAnchors } from '@/lib/gold-structure-anchors';
import { getOrderBlockAnalysis } from '@/lib/order-block-detection-store';
import { getSupportResistanceAnalysis } from '@/lib/support-resistance-store';
import { getSwingDetections } from '@/lib/swing-point-store';
import { queryPostgres } from '@/lib/postgres';
import type { ReconstructedCandle } from '@/lib/visual-intelligence-types';
import { defaultStopPips, pipSizeForSymbol, type AutonomousTradeSide } from '@/lib/autonomous-stop-targets';

export type AutonomousEntryPlan = {
  mode: 'retracement_limit' | 'hybrid_market_limit' | 'market_fallback';
  side: AutonomousTradeSide;
  directionBias: 'strong_buy' | 'buy' | 'sell' | 'strong_sell';
  entryTimingDecision: 'market_order' | 'buy_limit' | 'sell_limit' | 'wait' | 'no_trade';
  orderTypeRecommendation: 'MARKET' | 'BUY_LIMIT' | 'SELL_LIMIT' | 'WAIT' | 'NO_TRADE';
  currentPrice: number;
  pendingEntryPrice: number;
  zoneLow: number;
  zoneHigh: number;
  stopLoss: number;
  takeProfit: number;
  rewardRiskRatio: number;
  marketFraction: number;
  limitFraction: number;
  maxRetracementPrice: number;
  cancelIfPriceBeyond: number;
  confirmationRequired: string[];
  method: string;
  reasons: string[];
  stageScores: {
    marketDirection: number;
    marketQuality: number;
    priceLocation: number;
    candleBehaviour: number;
    pullbackConfidence: number;
    riskQuality: number;
  };
  metrics: Record<string, number | string | boolean | null>;
};

type Candidate = {
  price: number;
  weight: number;
  source: string;
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

function roundPrice(symbol: string, price: number): number {
  const normalized = symbol.toUpperCase();
  const digits = normalized.includes('XAU') || normalized.includes('GOLD')
    ? 2
    : normalized.includes('JPY')
      ? 3
      : 5;
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

function computeEma(candles: ReconstructedCandle[], period: number): number | null {
  const closes = candles.map((candle) => Number(candle.closePrice)).filter((value) => value > 0);
  if (!closes.length) return null;
  const smoothing = 2 / (period + 1);
  let ema = closes[0];
  for (const close of closes.slice(1)) ema = close * smoothing + ema * (1 - smoothing);
  return ema;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function countConsecutiveDirectionalCandles(candles: ReconstructedCandle[], side: AutonomousTradeSide): number {
  let count = 0;
  for (const candle of candles.slice().reverse()) {
    const bullish = candle.closePrice > candle.openPrice;
    const bearish = candle.closePrice < candle.openPrice;
    if ((side === 'BUY' && bullish) || (side === 'SELL' && bearish)) count += 1;
    else break;
  }
  return count;
}

function analyzeLatestCandle(candles: ReconstructedCandle[], atr: number, side: AutonomousTradeSide): {
  range: number;
  body: number;
  bodyRatio: number;
  impulseAtr: number;
  wickAgainstEntryRatio: number;
  exhaustionRisk: number;
  behaviorScore: number;
} {
  const latest = candles[candles.length - 1];
  if (!latest) {
    return {
      range: 0,
      body: 0,
      bodyRatio: 0,
      impulseAtr: 0,
      wickAgainstEntryRatio: 0,
      exhaustionRisk: 0.35,
      behaviorScore: 55,
    };
  }
  const range = Math.max(0, latest.highPrice - latest.lowPrice);
  const body = Math.abs(latest.closePrice - latest.openPrice);
  const upperWick = latest.highPrice - Math.max(latest.openPrice, latest.closePrice);
  const lowerWick = Math.min(latest.openPrice, latest.closePrice) - latest.lowPrice;
  const bodyRatio = range > 0 ? body / range : 0;
  const impulseAtr = atr > 0 ? range / atr : 0;
  const wickAgainstEntryRatio = range > 0
    ? side === 'BUY' ? upperWick / range : lowerWick / range
    : 0;
  const sameDirectionImpulse =
    (side === 'BUY' && latest.closePrice > latest.openPrice)
    || (side === 'SELL' && latest.closePrice < latest.openPrice);
  const exhaustionRisk = clamp(
    (sameDirectionImpulse && impulseAtr >= 1.6 ? 0.42 : 0)
    + (bodyRatio >= 0.72 ? 0.22 : 0)
    + (wickAgainstEntryRatio >= 0.32 ? 0.18 : 0),
    0,
    1,
  );
  return {
    range,
    body,
    bodyRatio,
    impulseAtr,
    wickAgainstEntryRatio,
    exhaustionRisk,
    behaviorScore: Math.round(clamp(100 - exhaustionRisk * 78, 0, 100)),
  };
}

function computeDailyRangeConsumption(candles: ReconstructedCandle[], currentPrice: number, side: AutonomousTradeSide): number {
  const window = candles.slice(-48);
  const high = Math.max(...window.map((candle) => candle.highPrice).filter(Boolean), 0);
  const low = Math.min(...window.map((candle) => candle.lowPrice).filter(Boolean), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(low) || high <= low) return 0.5;
  const position = clamp((currentPrice - low) / (high - low), 0, 1);
  return side === 'BUY' ? position : 1 - position;
}

async function loadRecentCandles(symbol: string, timeframe: string, limit = 120): Promise<ReconstructedCandle[]> {
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

export function isRetracementEntryEnabled(): boolean {
  return envBool('CACSMS_RETRACEMENT_ENTRY_ENABLED', true);
}

export function hybridMarketFraction(): number {
  return Math.min(0.5, Math.max(0, envNumber('CACSMS_HYBRID_MARKET_FRACTION', 0.2)));
}

export async function planAutonomousRetracementEntry(input: {
  symbol: string;
  timeframe: string;
  side: AutonomousTradeSide;
  currentPrice: number;
  stopLoss: number;
  rewardRiskRatio: number;
}): Promise<AutonomousEntryPlan | null> {
  if (!isRetracementEntryEnabled()) return null;
  const symbol = input.symbol.toUpperCase();
  const timeframe = input.timeframe.toUpperCase();
  const currentPrice = Number(input.currentPrice);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  const candles = await loadRecentCandles(symbol, timeframe);
  const atr = computeAtr(candles) || defaultStopPips(symbol, timeframe) * pipSizeForSymbol(symbol);
  const minRetracement = atr * envNumber('CACSMS_MIN_RETRACEMENT_ATR', 0.18);
  const maxRetracement = atr * envNumber('CACSMS_MAX_RETRACEMENT_ATR', 1.15);
  const candidates: Candidate[] = [];

  const ema20 = computeEma(candles, 20);
  const ema50 = computeEma(candles, 50);
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const candleBehaviour = analyzeLatestCandle(candles, atr, input.side);
  const consecutiveDirectionalCandles = countConsecutiveDirectionalCandles(candles, input.side);
  const dailyRangeConsumed = computeDailyRangeConsumption(candles, currentPrice, input.side);
  const distanceFromEma20 = ema20 ? Math.abs(currentPrice - ema20) : 0;
  const distanceFromEma50 = ema50 ? Math.abs(currentPrice - ema50) : 0;
  const extensionAtr = atr > 0 ? Math.max(distanceFromEma20, distanceFromEma50) / atr : 0;
  const momentumAcceleration = latest && previous
    ? Math.abs(latest.closePrice - latest.openPrice) > Math.abs(previous.closePrice - previous.openPrice) * 1.25
    : false;
  const priceExtended =
    extensionAtr >= envNumber('CACSMS_ENTRY_EXTENSION_ATR_LIMIT', 1.15)
    || dailyRangeConsumed >= envNumber('CACSMS_ENTRY_DAILY_RANGE_CONSUMED_LIMIT', 0.78)
    || consecutiveDirectionalCandles >= envNumber('CACSMS_ENTRY_CONSECUTIVE_CANDLE_LIMIT', 4)
    || candleBehaviour.exhaustionRisk >= 0.58;
  const priceLocationScore = Math.round(clamp(
    100
    - extensionAtr * 26
    - Math.max(0, dailyRangeConsumed - 0.58) * 95
    - Math.max(0, consecutiveDirectionalCandles - 2) * 12
    - candleBehaviour.exhaustionRisk * 35,
    0,
    100,
  ));
  const marketQualityScore = Math.round(clamp(
    62
    + (ema20 && ema50
      ? input.side === 'BUY'
        ? ema20 >= ema50 ? 18 : -18
        : ema20 <= ema50 ? 18 : -18
      : 0)
    - (momentumAcceleration && priceExtended ? 14 : 0)
    - (candleBehaviour.impulseAtr >= 2.2 ? 12 : 0),
    0,
    100,
  ));
  const marketDirectionScore = Math.round(clamp(
    input.side === 'BUY'
      ? 70 + (ema20 && ema50 && ema20 >= ema50 ? 15 : 0)
      : 70 + (ema20 && ema50 && ema20 <= ema50 ? 15 : 0),
    0,
    100,
  ));
  const directionBias = input.side === 'BUY'
    ? marketDirectionScore >= 82 ? 'strong_buy' : 'buy'
    : marketDirectionScore >= 82 ? 'strong_sell' : 'sell';
  if (ema20) candidates.push({ price: ema20, weight: 0.7, source: 'ema20' });
  if (ema50) candidates.push({ price: ema50, weight: 0.55, source: 'ema50' });

  const swingHigh = Math.max(...candles.slice(-30).map((candle) => candle.highPrice).filter(Boolean), 0);
  const swingLow = Math.min(...candles.slice(-30).map((candle) => candle.lowPrice).filter(Boolean), Number.POSITIVE_INFINITY);
  if (Number.isFinite(swingLow) && swingHigh > swingLow) {
    const range = swingHigh - swingLow;
    if (input.side === 'BUY') {
      candidates.push({ price: swingHigh - range * 0.382, weight: 0.62, source: 'fib_38_2' });
      candidates.push({ price: swingHigh - range * 0.5, weight: 0.58, source: 'fib_50' });
      candidates.push({ price: swingHigh - range * 0.618, weight: 0.5, source: 'fib_61_8' });
    } else {
      candidates.push({ price: swingLow + range * 0.382, weight: 0.62, source: 'fib_38_2' });
      candidates.push({ price: swingLow + range * 0.5, weight: 0.58, source: 'fib_50' });
      candidates.push({ price: swingLow + range * 0.618, weight: 0.5, source: 'fib_61_8' });
    }
  }

  const captureId = await resolveLatestCaptureId(symbol, timeframe);
  if (captureId) {
    const [swings, sr, orderBlocks, liquidity] = await Promise.all([
      getSwingDetections(captureId).catch(() => []),
      getSupportResistanceAnalysis(captureId).catch(() => null),
      getOrderBlockAnalysis(captureId).catch(() => null),
      getLiquidityAnalysis(captureId).catch(() => null),
    ]);
    for (const swing of swings) {
      if (input.side === 'BUY' && swing.swingKind === 'low') candidates.push({ price: swing.priceLevel, weight: 0.5 + swing.strengthScore * 0.35, source: 'swing_low' });
      if (input.side === 'SELL' && swing.swingKind === 'high') candidates.push({ price: swing.priceLevel, weight: 0.5 + swing.strengthScore * 0.35, source: 'swing_high' });
    }
    for (const zone of sr?.zones ?? []) {
      if (input.side === 'BUY' && zone.recommendedAction === 'BUY') candidates.push({ price: zone.midpointPrice, weight: 0.55 + zone.strengthScore * 0.4, source: `sr_${zone.zoneType}` });
      if (input.side === 'SELL' && zone.recommendedAction === 'SELL') candidates.push({ price: zone.midpointPrice, weight: 0.55 + zone.strengthScore * 0.4, source: `sr_${zone.zoneType}` });
    }
    for (const block of orderBlocks?.orderBlocks ?? []) {
      if (input.side === 'BUY' && block.blockType === 'bullish' && block.recommendedAction !== 'AVOID') candidates.push({ price: (block.zoneLow + block.zoneHigh) / 2, weight: 0.68 + block.qualityScore * 0.5, source: 'bullish_order_block' });
      if (input.side === 'SELL' && block.blockType === 'bearish' && block.recommendedAction !== 'AVOID') candidates.push({ price: (block.zoneLow + block.zoneHigh) / 2, weight: 0.68 + block.qualityScore * 0.5, source: 'bearish_order_block' });
    }
    for (const zone of liquidity?.liquidityZones ?? []) {
      const favorable =
        (input.side === 'BUY' && zone.liquiditySide === 'sell_side')
        || (input.side === 'SELL' && zone.liquiditySide === 'buy_side');
      if (!favorable) continue;
      const sweepBonus = /sweep|reclaim/i.test(zone.sweepStatus) ? 0.12 : 0;
      candidates.push({
        price: zone.priceLevel,
        weight: 0.62 + zone.confidenceScore * 0.45 + sweepBonus,
        source: zone.sweepStatus === 'reclaimed' ? 'liquidity_reclaim' : 'liquidity_pool',
      });
    }
    for (const voidZone of liquidity?.voids ?? []) {
      const mid = (voidZone.zoneLow + voidZone.zoneHigh) / 2;
      if (input.side === 'BUY' && voidZone.voidDirection === 'bullish_void') {
        candidates.push({ price: mid, weight: 0.64 + voidZone.rebalanceProbability * 0.35, source: 'bullish_fvg_void' });
      }
      if (input.side === 'SELL' && voidZone.voidDirection === 'bearish_void') {
        candidates.push({ price: mid, weight: 0.64 + voidZone.rebalanceProbability * 0.35, source: 'bearish_fvg_void' });
      }
    }
  }

  const structureAnchors = await loadGoldStructureEntryAnchors({ symbol, timeframe, side: input.side });
  for (const anchor of structureAnchors) {
    candidates.push({ price: anchor.price, weight: anchor.weight, source: anchor.source });
  }

  const valid = candidates.filter((candidate) => {
    const distance = input.side === 'BUY'
      ? currentPrice - candidate.price
      : candidate.price - currentPrice;
    return distance >= minRetracement && distance <= maxRetracement;
  });
  const selected = valid.sort((left, right) => right.weight - left.weight)[0];
  const fallbackDistance = Math.max(minRetracement, atr * 0.38);
  const pendingEntry = selected?.price ?? (input.side === 'BUY' ? currentPrice - fallbackDistance : currentPrice + fallbackDistance);
  const retracementDistance = Math.abs(currentPrice - pendingEntry);
  if (retracementDistance > maxRetracement) return null;
  const pullbackConfidenceScore = Math.round(clamp(
    (selected ? 52 + selected.weight * 35 : 44)
    + Math.min(18, valid.length * 2.5)
    + (structureAnchors.length > 0 ? 10 : 0)
    - (priceExtended ? 0 : 8),
    0,
    100,
  ));

  const buffer = Math.max(atr * 0.22, pipSizeForSymbol(symbol) * 4);
  const stopLoss = input.side === 'BUY'
    ? Math.min(input.stopLoss, pendingEntry - buffer)
    : Math.max(input.stopLoss, pendingEntry + buffer);
  const stopDistance = Math.abs(pendingEntry - stopLoss);
  if (stopDistance <= 0) return null;
  const takeProfit = input.side === 'BUY'
    ? pendingEntry + stopDistance * input.rewardRiskRatio
    : pendingEntry - stopDistance * input.rewardRiskRatio;
  const zoneHalfWidth = Math.max(atr * 0.12, retracementDistance * 0.18);
  const zoneLow = pendingEntry - zoneHalfWidth;
  const zoneHigh = pendingEntry + zoneHalfWidth;
  const riskQualityScore = Math.round(clamp(
    55
    + Math.min(30, (input.rewardRiskRatio - 1.2) * 18)
    + (stopDistance <= maxRetracement ? 10 : -12)
    - (priceLocationScore < 45 ? 14 : 0),
    0,
    100,
  ));
  const allStagesSatisfied =
    marketDirectionScore >= envNumber('CACSMS_ENTRY_DIRECTION_MIN_SCORE', 65)
    && marketQualityScore >= envNumber('CACSMS_ENTRY_MARKET_QUALITY_MIN_SCORE', 45)
    && priceLocationScore >= envNumber('CACSMS_ENTRY_PRICE_LOCATION_MIN_SCORE', 28)
    && candleBehaviour.behaviorScore >= envNumber('CACSMS_ENTRY_CANDLE_BEHAVIOUR_MIN_SCORE', 30)
    && pullbackConfidenceScore >= envNumber('CACSMS_ENTRY_PULLBACK_CONFIDENCE_MIN_SCORE', 46)
    && riskQualityScore >= envNumber('CACSMS_ENTRY_RISK_QUALITY_MIN_SCORE', 45);
  if (!allStagesSatisfied) return null;

  const marketFraction = priceExtended ? 0 : hybridMarketFraction();
  const entryTimingDecision = input.side === 'BUY' ? 'buy_limit' : 'sell_limit';
  const orderTypeRecommendation = input.side === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT';

  return {
    mode: marketFraction > 0 ? 'hybrid_market_limit' : 'retracement_limit',
    side: input.side,
    directionBias,
    entryTimingDecision,
    orderTypeRecommendation,
    currentPrice: roundPrice(symbol, currentPrice),
    pendingEntryPrice: roundPrice(symbol, pendingEntry),
    zoneLow: roundPrice(symbol, Math.min(zoneLow, zoneHigh)),
    zoneHigh: roundPrice(symbol, Math.max(zoneLow, zoneHigh)),
    stopLoss: roundPrice(symbol, stopLoss),
    takeProfit: roundPrice(symbol, takeProfit),
    rewardRiskRatio: input.rewardRiskRatio,
    marketFraction,
    limitFraction: Number((1 - marketFraction).toFixed(4)),
    maxRetracementPrice: roundPrice(symbol, input.side === 'BUY' ? currentPrice - maxRetracement : currentPrice + maxRetracement),
    cancelIfPriceBeyond: roundPrice(symbol, input.side === 'BUY' ? pendingEntry - maxRetracement * 0.45 : pendingEntry + maxRetracement * 0.45),
    confirmationRequired: [
      input.side === 'BUY' ? 'bullish engulfing or pin-bar rejection inside entry zone' : 'bearish engulfing or pin-bar rejection inside entry zone',
      'volume or participation proxy expansion',
      'momentum resumption away from retracement zone',
      structureAnchors.length > 0 ? 'structure retest confirmation (BOS/CHoCH/FVG/OB)' : 'retracement zone confirmation',
      selected?.source?.includes('liquidity') ? 'liquidity sweep reclaim or rejection confirmation' : 'institutional zone retest',
    ],
    method: selected?.source ?? 'atr_retracement_fallback',
    reasons: [
      `${directionBias.replace('_', ' ').toUpperCase()} bias accepted; entry timing is separated from direction.`,
      priceExtended
        ? 'Price extension detected, so market chasing is disabled and the setup is routed to a limit retracement.'
        : 'Price is not materially extended; hybrid scout allocation remains available.',
      `Pending ${input.side} limit selected at retracement source ${selected?.source ?? 'ATR fallback'}.`,
      `Entry waits for retracement instead of chasing current price ${roundPrice(symbol, currentPrice)}.`,
      `Cancel setup if retracement exceeds ${roundPrice(symbol, input.side === 'BUY' ? pendingEntry - maxRetracement * 0.45 : pendingEntry + maxRetracement * 0.45)}.`,
    ],
    stageScores: {
      marketDirection: marketDirectionScore,
      marketQuality: marketQualityScore,
      priceLocation: priceLocationScore,
      candleBehaviour: candleBehaviour.behaviorScore,
      pullbackConfidence: pullbackConfidenceScore,
      riskQuality: riskQualityScore,
    },
    metrics: {
      atr: roundPrice(symbol, atr),
      atrExtension: Number(extensionAtr.toFixed(4)),
      distanceFromEma20: roundPrice(symbol, distanceFromEma20),
      distanceFromEma50: roundPrice(symbol, distanceFromEma50),
      consecutiveDirectionalCandles,
      dailyRangeConsumed: Number(dailyRangeConsumed.toFixed(4)),
      candleImpulseAtr: Number(candleBehaviour.impulseAtr.toFixed(4)),
      candleBodyRatio: Number(candleBehaviour.bodyRatio.toFixed(4)),
      candleExhaustionRisk: Number(candleBehaviour.exhaustionRisk.toFixed(4)),
      momentumAcceleration,
      priceExtended,
      retracementDistance: roundPrice(symbol, retracementDistance),
      minRetracement: roundPrice(symbol, minRetracement),
      maxRetracement: roundPrice(symbol, maxRetracement),
      candidateCount: candidates.length,
      validCandidateCount: valid.length,
      selectedWeight: selected?.weight ?? null,
      selectedSource: selected?.source ?? null,
    },
  };
}
