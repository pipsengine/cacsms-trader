import { listPairSelectionHistory } from '@/lib/pair-selection-audit';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const history = await listPairSelectionHistory({ limit, offset });
    return Response.json({ ok: true, history }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load pair selection history.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
