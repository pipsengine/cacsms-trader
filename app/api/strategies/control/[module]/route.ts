import { isStrategyControlSlug } from '@/lib/strategies/strategy-control-modules';
import { runStrategyControlModule } from '@/lib/strategies/run-strategy-control';

export async function GET(
  _request: Request,
  context: { params: Promise<{ module: string }> },
): Promise<Response> {
  const { module } = await context.params;
  if (!isStrategyControlSlug(module)) {
    return Response.json(
      { ok: false, error: `Unknown strategy control module: ${module}` },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const payload = await runStrategyControlModule(module);
    return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to run strategy control module.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
