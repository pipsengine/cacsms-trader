import { getPairSelectionFeed } from '@/lib/pair-selection-feed';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? 25);
    const feed = await getPairSelectionFeed(limit);
    return Response.json({ ok: true, feed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load pair selection feed.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
