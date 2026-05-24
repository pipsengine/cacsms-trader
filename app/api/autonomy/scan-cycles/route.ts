export const runtime = 'nodejs';

import { listScanCycles } from '@/lib/autonomy-store';

export async function GET(): Promise<Response> {
  try {
    return Response.json({ ok: true, scanCycles: await listScanCycles() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load scan cycles.' }, { status: 500 });
  }
}
