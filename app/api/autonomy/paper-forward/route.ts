import { createPaperForwardOrder, ensureStrategyBacktestingSchema } from '@/lib/strategy-backtesting';
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
        SELECT *
        FROM strategy_paper_forward_orders
        WHERE ($1::text IS NULL OR strategy_id = $1)
          AND ($2::text IS NULL OR upper(symbol) = upper($2))
        ORDER BY created_at DESC
        LIMIT 50
      `,
      [strategyId, symbol],
    );
    return Response.json({ ok: true, orders: result.rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load paper-forward orders.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const order = await createPaperForwardOrder({
      symbol: String(body.symbol ?? 'SP500'),
      timeframe: String(body.timeframe ?? 'M15'),
      strategyId: typeof body.strategyId === 'string' ? body.strategyId : undefined,
      decisionLogId: typeof body.decisionLogId === 'string' ? body.decisionLogId : undefined,
    });
    return Response.json({ ok: true, order }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to create paper-forward order.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
