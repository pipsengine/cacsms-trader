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
    const [swings, sr, orderBlocks] = await Promise.all([
      getSwingDetections(captureId).catch(() => []),
      getSupportResistanceAnalysis(captureId).catch(() => null),
      getOrderBlockAnalysis(captureId).catch(() => null),
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
  const marketFraction = hybridMarketFraction();

  return {
    mode: marketFraction > 0 ? 'hybrid_market_limit' : 'retracement_limit',
    side: input.side,
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
    ],
    method: selected?.source ?? 'atr_retracement_fallback',
    reasons: [
      `Pending ${input.side} limit selected at retracement source ${selected?.source ?? 'ATR fallback'}.`,
      `Entry waits for retracement instead of chasing current price ${roundPrice(symbol, currentPrice)}.`,
      `Cancel setup if retracement exceeds ${roundPrice(symbol, input.side === 'BUY' ? pendingEntry - maxRetracement * 0.45 : pendingEntry + maxRetracement * 0.45)}.`,
    ],
    metrics: {
      atr: roundPrice(symbol, atr),
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
