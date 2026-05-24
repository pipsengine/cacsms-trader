export const runtime = 'nodejs';

import { getVisionAuditLogs } from '@/lib/cacsms-vision-store';

export async function GET(): Promise<Response> {
  try {
    return Response.json({ ok: true, auditLogs: await getVisionAuditLogs() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load audit logs.' }, { status: 500 });
  }
}
