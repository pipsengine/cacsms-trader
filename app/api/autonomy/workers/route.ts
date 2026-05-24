export const runtime = 'nodejs';

import { listWorkers } from '@/lib/autonomy-store';

export async function GET(): Promise<Response> {
  try {
    return Response.json({ ok: true, workers: await listWorkers() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load autonomy workers.' }, { status: 500 });
  }
}
