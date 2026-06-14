import { normalizeInputCandles } from '@/lib/candle-detection-engine';
import type { ReconstructedCandle } from '@/lib/visual-intelligence-types';

import type { StrategyPriceCandle } from './strategy-candle-loader';

export function strategyCandlesToReconstructed(candles: StrategyPriceCandle[]): ReconstructedCandle[] {
  const normalized = normalizeInputCandles(candles.map((candle) => ({
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  })));

  return normalized.map((candle, index) => ({
    ...candle,
    candleIndex: candles[index]?.candleIndex ?? index,
  }));
}
