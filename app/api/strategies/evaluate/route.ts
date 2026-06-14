import { runStrategyEvaluation } from '@/lib/strategies/run-strategy-evaluation';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const strategyId = String(body.strategyId ?? '').trim();
    const autonomous = body.autonomous === true;

    const payload = await runStrategyEvaluation({
      strategyId,
      autonomous,
      body: autonomous ? undefined : body,
    });

    return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const enriched = error as Error & { captureId?: string | null; capturedAt?: string | null; status?: number };
    return Response.json(
      {
        ok: false,
        error: enriched.message ?? 'Unable to evaluate strategy.',
        captureId: enriched.captureId ?? null,
        capturedAt: enriched.capturedAt ?? null,
      },
      { status: enriched.status ?? 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
