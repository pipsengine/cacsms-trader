import {
  DEFAULT_MA_CROSSOVER_CONFIG,
  evaluateMovingAverageCrossover,
} from '@/lib/strategies/moving-average-crossover';
import { loadStrategyCandles } from '@/lib/strategies/strategy-candle-loader';
import type { MovingAverageType } from '@/lib/strategies/types';
import type { Timeframe } from '@/packages/shared-types';

function parseTimeframe(value: unknown): Timeframe {
  const text = String(value ?? 'M15').toUpperCase();
  const allowed: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];
  return allowed.includes(text as Timeframe) ? text as Timeframe : 'M15';
}

function parseMaType(value: unknown): MovingAverageType {
  return String(value ?? 'ema').toLowerCase() === 'sma' ? 'sma' : 'ema';
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const fastPeriod = Math.max(2, Math.min(200, Number(body.fastPeriod ?? DEFAULT_MA_CROSSOVER_CONFIG.fastPeriod)));
    const slowPeriod = Math.max(fastPeriod + 1, Math.min(400, Number(body.slowPeriod ?? DEFAULT_MA_CROSSOVER_CONFIG.slowPeriod)));
    const config = {
      symbol: String(body.symbol ?? DEFAULT_MA_CROSSOVER_CONFIG.symbol).toUpperCase(),
      timeframe: parseTimeframe(body.timeframe),
      fastPeriod,
      slowPeriod,
      maType: parseMaType(body.maType),
    };

    const { candles, captureId, capturedAt } = await loadStrategyCandles({
      symbol: config.symbol,
      timeframe: config.timeframe,
      limit: Math.max(slowPeriod + 20, 120),
    });

    if (candles.length < slowPeriod + 2) {
      return Response.json(
        {
          ok: false,
          error: `Not enough candle data for ${config.symbol} ${config.timeframe}. Run chart capture first (${candles.length} candles available, ${slowPeriod + 2} required).`,
          captureId,
          capturedAt,
        },
        { status: 422, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const result = evaluateMovingAverageCrossover(candles, config);
    return Response.json(
      {
        ok: true,
        result,
        captureId,
        capturedAt,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to evaluate moving average crossover.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
