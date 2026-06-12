import { ensureStrategyBacktestingSchema, getLatestPromotionReview } from '@/lib/strategy-backtesting';
import { queryPostgres } from '@/lib/postgres';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    await ensureStrategyBacktestingSchema();
    const url = new URL(request.url);
    const strategyId = String(url.searchParams.get('strategyId') ?? '').trim();
    const symbol = String(url.searchParams.get('symbol') ?? 'SP500').toUpperCase();
    const timeframe = String(url.searchParams.get('timeframe') ?? 'M15').toUpperCase();
    if (strategyId) {
      return Response.json(
        { ok: true, review: await getLatestPromotionReview(strategyId, symbol, timeframe) },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const result = await queryPostgres(
      `
        SELECT DISTINCT ON (strategy_id, symbol, timeframe)
          strategy_id, symbol, timeframe, eligible, blockers_json, metrics_json, minimums_json, source_type, created_at
        FROM strategy_promotion_reviews
        ORDER BY strategy_id, symbol, timeframe, created_at DESC
        LIMIT 100
      `,
    );
    return Response.json({ ok: true, reviews: result.rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load promotion reviews.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
