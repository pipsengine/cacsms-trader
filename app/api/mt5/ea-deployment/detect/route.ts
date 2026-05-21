export const runtime = 'nodejs';

import { detectMt5DataFolders, enginePolicyFromEnv, assertPolicy } from '@/services/ea-deployment/ea-deployment-engine';

export async function POST(request: Request): Promise<Response> {
  try {
    const policy = enginePolicyFromEnv();
    assertPolicy(policy, request.headers);
    const result = await detectMt5DataFolders(policy);
    return Response.json(result, { status: 200 });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to detect MT5 folders.' },
      { status: 403 },
    );
  }
}

