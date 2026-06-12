import { ensureStrategyBacktestingSchema, runWalkForwardTest } from '@/lib/strategy-backtesting';
import { queryPostgres } from '@/lib/postgres';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    await ensureStrategyBacktestingSchema();
    const url = new URL(request.url);
    const strategyId = url.searchParams.get('strategyId');
    const symbol = url.searchParams.get('symbol');
    const result = await queryPostgres(
      `
        SELECT id, strategy_id, symbol, timeframe, status, metrics_json, promotion_json, created_at
        FROM strategy_walk_forward_runs
        WHERE ($1::text IS NULL OR strategy_id = $1)
          AND ($2::text IS NULL OR upper(symbol) = upper($2))
        ORDER BY created_at DESC
        LIMIT 30
      `,
      [strategyId, symbol],
    );
    return Response.json({ ok: true, runs: result.rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load walk-forward runs.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runWalkForwardTest({
      strategyId: String(body.strategyId ?? 'autonomous-fusion-replay'),
      symbol: String(body.symbol ?? 'SP500'),
      timeframe: String(body.timeframe ?? 'M15'),
      from: typeof body.from === 'string' ? body.from : null,
      to: typeof body.to === 'string' ? body.to : null,
      fastPeriod: Number(body.fastPeriod ?? 9),
      slowPeriod: Number(body.slowPeriod ?? 21),
      riskRewardRatio: Number(body.riskRewardRatio ?? 2),
      stopAtrMultiplier: Number(body.stopAtrMultiplier ?? 1.2),
      spreadPoints: Number(body.spreadPoints ?? 20),
      commissionPerLot: Number(body.commissionPerLot ?? 7),
      slippagePoints: Number(body.slippagePoints ?? 2),
      trainWindow: Number(body.trainWindow ?? 160),
      validationWindow: Number(body.validationWindow ?? 60),
      maxWindows: Number(body.maxWindows ?? 5),
      limit: Number(body.limit ?? 1500),
    });
    return Response.json({ ok: true, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to run walk-forward test.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
