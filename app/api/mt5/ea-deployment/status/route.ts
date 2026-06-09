export const runtime = 'nodejs';

import { enginePolicyFromEnv, assertPolicy, verifyDeployment, getDeploymentRuntime, sanitizeEaDeploymentConfig } from '@/services/ea-deployment/ea-deployment-engine';
import { getLatestEaDeploymentSnapshot, upsertEaDeploymentConfig } from '@/lib/ea-deployment-store';

export async function GET(request: Request): Promise<Response> {
  try {
    const policy = enginePolicyFromEnv();
    assertPolicy(policy, request.headers);

    const snapshot = await safeSnapshot();
    const rawConfig = snapshot.config;
    const config = rawConfig ? sanitizeEaDeploymentConfig(rawConfig) : null;
    if (config && rawConfig && rawConfig.targetFolderName !== config.targetFolderName) {
      await upsertEaDeploymentConfig(config);
    }
    const verification = config ? await verifyDeployment(config, policy, config.deploymentMethod) : null;

    return Response.json(
      {
        ok: true,
        config,
        verification,
        logs: snapshot.logs ?? [],
        runtime: getDeploymentRuntime(),
      },
      { status: 200 },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load status.' },
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
