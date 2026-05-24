export const runtime = 'nodejs';

import { listFailures } from '@/lib/autonomy-store';

export async function GET(): Promise<Response> {
  try {
    return Response.json({ ok: true, failures: await listFailures() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load autonomy failures.' }, { status: 500 });
  }
}
