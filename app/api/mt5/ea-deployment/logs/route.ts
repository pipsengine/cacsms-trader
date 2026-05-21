export const runtime = 'nodejs';

import { enginePolicyFromEnv, assertPolicy } from '@/services/ea-deployment/ea-deployment-engine';
import { getLatestEaDeploymentSnapshot } from '@/lib/ea-deployment-store';

export async function GET(request: Request): Promise<Response> {
  try {
    const policy = enginePolicyFromEnv();
    assertPolicy(policy, request.headers);
    const snapshot = await safeSnapshot();
    return Response.json({ ok: true, logs: snapshot.logs ?? [] }, { status: 200 });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load logs.' },
      { status: 403 },
    );
  }
}

async function safeSnapshot() {
  try {
    return await getLatestEaDeploymentSnapshot();
  } catch {
    return { config: null, run: null, logs: [], verification: null };
  }
}
