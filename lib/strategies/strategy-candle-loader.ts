import { queryPostgres } from '@/lib/postgres';

export type StrategyPriceCandle = {
  close: number;
  open: number;
  high: number;
  low: number;
  candleIndex: number;
};

export async function loadStrategyCandles(input: {
  symbol: string;
  timeframe: string;
  limit?: number;
}): Promise<{ candles: StrategyPriceCandle[]; captureId: string | null; capturedAt: string | null }> {
  const limit = Math.max(30, Math.min(500, input.limit ?? 120));
  const capture = await queryPostgres(
    `
      SELECT id, captured_at
      FROM chart_captures
      WHERE upper(symbol) = $1
        AND upper(timeframe) = $2
      ORDER BY captured_at DESC
      LIMIT 1
    `,
    [input.symbol.toUpperCase(), input.timeframe.toUpperCase()],
  );

  const captureId = capture.rows[0]?.id ? String(capture.rows[0].id) : null;
  if (!captureId) {
    return { candles: [], captureId: null, capturedAt: null };
  }

  const candles = await queryPostgres(
    `
      SELECT candle_index, open_price, high_price, low_price, close_price
      FROM reconstructed_candles
      WHERE chart_capture_id = $1
      ORDER BY candle_index ASC
      LIMIT $2
    `,
    [captureId, limit],
  );

  return {
    captureId,
    capturedAt: capture.rows[0]?.captured_at ? String(capture.rows[0].captured_at) : null,
    candles: candles.rows.map((row) => ({
      candleIndex: Number(row.candle_index),
      open: Number(row.open_price),
      high: Number(row.high_price),
      low: Number(row.low_price),
      close: Number(row.close_price),
    })),
  };
}
