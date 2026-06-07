export const runtime = 'nodejs';

import {
  enginePolicyFromEnv,
  assertPolicy,
  verifyDeployment,
  getDeploymentRuntime,
  sanitizeEaDeploymentConfig,
  resolveProjectEaVersion,
} from '@/services/ea-deployment/ea-deployment-engine';
import { getLatestEaDeploymentSnapshot } from '@/lib/ea-deployment-store';

export async function GET(request: Request): Promise<Response> {
  try {
    const policy = enginePolicyFromEnv();
    assertPolicy(policy, request.headers);

    const snapshot = await safeSnapshot();
    const config = snapshot.config ? sanitizeEaDeploymentConfig(snapshot.config) : null;
    const verification = config
      ? await verifyDeployment(config, policy, config.deploymentMethod)
      : snapshot.verification;
    const projectEaVersion = await resolveProjectEaVersion();
    const bridge = await fetchBridgeHealth();

    return Response.json(
      {
        ok: true,
        toolEnabled: policy.enabled,
        runtime: getDeploymentRuntime(),
        projectEaVersion,
        config,
        verification,
        logs: snapshot.logs ?? [],
        run: snapshot.run
          ? {
              runId: snapshot.run.run_id,
              method: snapshot.run.deployment_method,
              status: snapshot.run.status,
              message: snapshot.run.message,
              createdAt: snapshot.run.created_at,
            }
          : null,
        bridge,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load EA deployment summary.' },
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

async function fetchBridgeHealth() {
  const bridgeUrl = process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://127.0.0.1:8787';
  try {
    const response = await fetch(`${bridgeUrl}/health`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) {
      return { online: false, terminalCount: 0, connectedCount: 0, degradedCount: 0, disconnectedCount: 0 };
    }
    return {
      online: Boolean(payload.ok),
      terminalCount: Number(payload.terminalCount ?? 0),
      connectedCount: Number(payload.connectedTerminalCount ?? 0),
      degradedCount: Number(payload.degradedTerminalCount ?? 0),
      disconnectedCount: Number(payload.disconnectedTerminalCount ?? 0),
    };
  } catch {
    return { online: false, terminalCount: 0, connectedCount: 0, degradedCount: 0, disconnectedCount: 0 };
  }
}
