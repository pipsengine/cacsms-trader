import { runModuleSummaries } from '@/lib/strategies/run-module-summaries';

export async function GET(): Promise<Response> {
  try {
    const payload = await runModuleSummaries();
    return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to run module summaries.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
