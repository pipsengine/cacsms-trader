export const runtime = 'nodejs';

import { emergencyStopAutonomy } from '@/lib/autonomy-store';

export async function POST(): Promise<Response> {
  return Response.json({ ok: true, ...(await emergencyStopAutonomy('Cacsms Vision pause requested.')) }, { headers: { 'Cache-Control': 'no-store' } });
}
