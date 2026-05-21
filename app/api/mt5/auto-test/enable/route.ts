import { enableAutoExecutionTestRunner } from '@/lib/auto-execution-test-runner';

export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  try {
    const result = await enableAutoExecutionTestRunner();
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to enable auto test.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

