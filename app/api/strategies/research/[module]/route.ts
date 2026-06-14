import { isResearchEvolutionSlug } from '@/lib/strategies/research-evolution-modules';
import { runResearchEvolutionModule } from '@/lib/strategies/run-research-evolution';

export async function GET(
  _request: Request,
  context: { params: Promise<{ module: string }> },
): Promise<Response> {
  const { module } = await context.params;
  if (!isResearchEvolutionSlug(module)) {
    return Response.json(
      { ok: false, error: `Unknown research & evolution module: ${module}` },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const payload = await runResearchEvolutionModule(module);
    return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to run research module.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
