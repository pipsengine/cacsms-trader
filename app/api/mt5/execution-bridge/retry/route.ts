export const runtime = 'nodejs';

import crypto from 'node:crypto';
import { upsertExecutionCommand } from '@/lib/execution-bridge-store';
import { queryPostgres } from '@/lib/postgres';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

function bridgeSecretHeader(): Record<string, string> {
  const secret = process.env.MT5_BRIDGE_SHARED_SECRET ?? '';
  return secret ? { 'X-Cacsms-Secret': secret } : {};
}

function assertLocalOnly(request: Request) {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env !== 'development' && String(process.env.CACSMS_ENABLE_EXECUTION_BRIDGE_TOOL ?? '').toLowerCase() !== 'true') {
    throw new Error('Execution Bridge tool is disabled outside development.');
  }

  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host') ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  if (forwardedFor || forwardedHost || forwardedProto) {
    throw new Error('Execution Bridge tool requires local machine access.');
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalOnly(request);
    const body = (await request.json()) as any;
    const commandId = String(body.commandId ?? '').trim();
    if (!commandId) throw new Error('commandId is required.');

    const existing = await queryPostgres(`SELECT * FROM execution_commands WHERE command_id = $1`, [commandId]);
    const row = existing.rows[0] as any;
    if (!row) return Response.json({ ok: false, error: 'Command not found.' }, { status: 404 });

    const newCommandId = `retry-${crypto.randomUUID()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();

    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const enrichedPayload = { ...payload, retryOfCommandId: commandId };

    const { command } = await upsertExecutionCommand({
      commandId: newCommandId,
      terminalId: String(row.terminal_id),
      type: String(row.type),
      payload: enrichedPayload,
      createdAt: now.toISOString(),
      expiresAt,
      environment: String(row.environment ?? 'DEMO') as any,
      sandboxMode: Boolean(row.sandbox_mode),
      maxAttempts: Number(row.max_attempts ?? 3),
    });

    const forward = await fetch(`${bridgeUrl()}/commands/enqueue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...bridgeSecretHeader(),
      },
      body: JSON.stringify({
        commandId: command.commandId,
        terminalId: command.terminalId,
        type: command.type,
        payload: command.payload,
        createdAt: command.createdAt,
        expiresAt: command.expiresAt,
      }),
    });
    if (!forward.ok) {
      const message = await forward.text();
      await queryPostgres(
        `UPDATE execution_commands SET last_error = $2, last_updated_at = now() WHERE command_id = $1`,
        [command.commandId, message || `Bridge enqueue failed with HTTP ${forward.status}`],
      );
      return Response.json({ ok: false, error: message || `Bridge enqueue failed with HTTP ${forward.status}`, command }, { status: 502 });
    }

    const bridgePayload = await forward.json().catch(() => ({}));
    return Response.json({ ok: true, command, bridge: bridgePayload }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to retry command.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
