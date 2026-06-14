import { runAutonomousOverviewEvaluations } from '@/lib/strategies/run-strategy-evaluation';

export async function GET(): Promise<Response> {
  try {
    const overview = await runAutonomousOverviewEvaluations();
    return Response.json({ ok: true, ...overview }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load autonomous strategy overview.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
