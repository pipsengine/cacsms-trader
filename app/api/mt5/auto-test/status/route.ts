import { reconcileBridgeExecutionState } from '@/lib/execution-bridge-store';
import { fetchBridgeTerminalOperations, getAutoExecutionTestStatus, tickAutoExecutionTestRunner } from '@/lib/auto-execution-test-runner';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    await reconcileBridgeExecutionState().catch(() => null);
    const bridge = await fetchBridgeTerminalOperations();
    await tickAutoExecutionTestRunner(bridge).catch(() => null);
    const status = await getAutoExecutionTestStatus(bridge);
    return Response.json(status, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load auto test status.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
