export const runtime = 'nodejs';

import { copyEaFiles, enginePolicyFromEnv, assertPolicy, sanitizeEaDeploymentConfig } from '@/services/ea-deployment/ea-deployment-engine';
import crypto from 'node:crypto';
import { appendEaDeploymentLogs, createEaDeploymentRun, upsertEaDeploymentConfig } from '@/lib/ea-deployment-store';

export async function POST(request: Request): Promise<Response> {
  try {
    const policy = enginePolicyFromEnv();
    assertPolicy(policy, request.headers);
    const payload = await request.json();
    const config = sanitizeEaDeploymentConfig(payload.config);
    const result = await copyEaFiles(policy, config, Boolean(payload.force));
    const persisted = await persistRunSafe({
      runId: crypto.randomUUID(),
      config,
      method: 'COPY',
      status: result.verification?.status ?? (result.ok ? 'SUCCESS' : 'FAILED'),
      message: result.message ?? '',
      verification: result.verification,
      logs: result.logs ?? [],
    });
    if (!persisted.ok) {
      result.logs = [
        ...(result.logs ?? []),
        {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          severity: 'WARNING',
          action: 'persist_warning',
          message: persisted.error ?? 'Unable to persist EA deployment run to PostgreSQL.',
        },
      ];
    }
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to copy EA files.' },
      { status: 400 },
    );
  }
}

async function persistRunSafe(input: {
  runId: string;
  config: any;
  method: 'SYMLINK' | 'COPY';
  status: string;
  message: string;
  verification: any;
  logs: any[];
}): Promise<{ ok: true } | { ok: false; error?: string }> {
  try {
    const configRow = await upsertEaDeploymentConfig(input.config);
    await createEaDeploymentRun({
      runId: input.runId,
      configId: (configRow as any).id,
      method: input.method,
      status: input.status,
      message: input.message,
      verification: input.verification,
    });
    await appendEaDeploymentLogs(input.runId, input.logs);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Database write failed.' };
  }
}
