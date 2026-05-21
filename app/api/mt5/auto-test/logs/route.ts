import { getAutoExecutionTestStatus } from '@/lib/auto-execution-test-runner';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    const status = await getAutoExecutionTestStatus();
    return Response.json({ ok: true, runId: status.runId, logs: status.logs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load auto test logs.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
