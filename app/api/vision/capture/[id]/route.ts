export const runtime = 'nodejs';

import { deleteCaptureRecord, getCaptureRecord } from '@/lib/chart-capture-intelligence';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const capture = await getCaptureRecord(id);
    if (!capture) {
      return Response.json({ ok: false, error: 'Capture not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: true, capture }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load capture.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const result = await deleteCaptureRecord(id);
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to delete capture.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
