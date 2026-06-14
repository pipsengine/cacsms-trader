import { MTF_TIMEFRAMES, type MtfTimeframe } from '@/lib/multi-timeframe-analysis-engine';
import { queryPostgres } from '@/lib/postgres';

import type { StrategyPriceCandle } from './strategy-candle-loader';

export async function loadMultiTimeframeStrategyCandles(
  symbol: string,
  limit = 120,
): Promise<{
  candleMap: Partial<Record<MtfTimeframe, StrategyPriceCandle[]>>;
  captureIds: Partial<Record<MtfTimeframe, string | null>>;
  capturedAt: string | null;
  primaryCaptureId: string | null;
}> {
  const candleMap: Partial<Record<MtfTimeframe, StrategyPriceCandle[]>> = {};
  const captureIds: Partial<Record<MtfTimeframe, string | null>> = {};
  let capturedAt: string | null = null;
  let primaryCaptureId: string | null = null;
  const candleLimit = Math.max(12, Math.min(500, limit));

  await Promise.all(MTF_TIMEFRAMES.map(async (timeframe) => {
    const capture = await queryPostgres(
      `
        SELECT id, captured_at
        FROM chart_captures
        WHERE upper(symbol) = $1
          AND upper(timeframe) = $2
        ORDER BY captured_at DESC
        LIMIT 1
      `,
      [symbol.toUpperCase(), timeframe.toUpperCase()],
    );

    const captureId = capture.rows[0]?.id ? String(capture.rows[0].id) : null;
    captureIds[timeframe] = captureId;
    if (!captureId) {
      candleMap[timeframe] = [];
      return;
    }

    if (!primaryCaptureId && timeframe === 'H4') {
      primaryCaptureId = captureId;
      capturedAt = capture.rows[0]?.captured_at ? String(capture.rows[0].captured_at) : null;
    }
    if (!capturedAt && capture.rows[0]?.captured_at) {
      capturedAt = String(capture.rows[0].captured_at);
    }

    const candles = await queryPostgres(
      `
        SELECT candle_index, open_price, high_price, low_price, close_price
        FROM reconstructed_candles
        WHERE chart_capture_id = $1
        ORDER BY candle_index ASC
        LIMIT $2
      `,
      [captureId, candleLimit],
    );

    candleMap[timeframe] = candles.rows.map((row) => ({
      candleIndex: Number(row.candle_index),
      open: Number(row.open_price),
      high: Number(row.high_price),
      low: Number(row.low_price),
      close: Number(row.close_price),
    }));
  }));

  if (!primaryCaptureId) {
    primaryCaptureId = captureIds.H4 ?? captureIds.H1 ?? captureIds.D ?? null;
  }

  return { candleMap, captureIds, capturedAt, primaryCaptureId };
}

export function countLoadedMtfTimeframes(candleMap: Partial<Record<MtfTimeframe, StrategyPriceCandle[]>>, minBars = 12): number {
  return MTF_TIMEFRAMES.filter((timeframe) => (candleMap[timeframe]?.length ?? 0) >= minBars).length;
}
