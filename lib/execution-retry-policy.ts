import crypto from 'node:crypto';
import { appendExecutionEvent } from '@/lib/execution-bridge-store';
import { dispatchExecutionCommand } from '@/lib/execution-dispatch';
import { getCommandTimeoutPolicy, normalizeExecutionCommandType } from '@/lib/execution-policy';
import { queryPostgres } from '@/lib/postgres';

export async function processEligibleExecutionRetries(limit = 10): Promise<number> {
  const result = await queryPostgres(
    `
      SELECT *
      FROM execution_commands
      WHERE lifecycle_state = 'TIMEOUT'
        AND attempt_count < max_attempts
        AND created_at > (now() - interval '2 hours')
      ORDER BY last_updated_at ASC
      LIMIT $1
    `,
    [Math.min(50, Math.max(1, limit))],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));

  let retried = 0;
  for (const row of result.rows) {
    const commandType = normalizeExecutionCommandType(String(row.type ?? ''));
    const policy = getCommandTimeoutPolicy(commandType);
    const attemptCount = Number(row.attempt_count ?? 0);
    if (attemptCount >= policy.maxAutoRetries) continue;

    const originalCommandId = String(row.command_id);
    const retryCommandId = `retry-${crypto.randomUUID()}`;
    const payload = {
      ...((row.payload as Record<string, unknown>) ?? {}),
      retryOfCommandId: originalCommandId,
      autoRetry: true,
    };

    try {
      const { command } = await dispatchExecutionCommand({
        commandId: retryCommandId,
        terminalId: String(row.terminal_id),
        type: commandType,
        payload,
        environment: String(row.environment ?? 'DEMO') as any,
        sandboxMode: Boolean(row.sandbox_mode),
        maxAttempts: Number(row.max_attempts ?? 3),
        skipRiskGate: commandType !== 'place_order',
        source: 'AUTO_RETRY',
      });

      await queryPostgres(
        `
          UPDATE execution_commands
          SET attempt_count = attempt_count + 1,
              last_updated_at = now()
          WHERE command_id = $1
        `,
        [originalCommandId],
      ).catch(() => null);

      await appendExecutionEvent({
        commandId: originalCommandId,
        terminalId: String(row.terminal_id),
        lifecycleState: 'TIMEOUT',
        eventType: 'AUTO_RETRY',
        severity: 'WARNING',
        message: `Auto-retry dispatched as ${command.commandId}.`,
        payload: { retryCommandId: command.commandId, attempt: attemptCount + 1 },
      }).catch(() => null);

      retried += 1;
    } catch {
      // skip failed retries
    }
  }

  return retried;
}

export async function runExecutionMaintenance(): Promise<{
  timeouts: number;
  retried: number;
  reconciled: number;
  tradeMonitor: { evaluated: number; actions: number; dispatched: number };
}> {
  const { markTimeouts, reconcileBridgeExecutionState } = await import('@/lib/execution-bridge-store');
  const { runTradeMonitorTick } = await import('@/lib/trade-monitor-runtime');

  const reconciled = await reconcileBridgeExecutionState().catch(() => 0);
  const timeouts = await markTimeouts().catch(() => 0);
  const retried = await processEligibleExecutionRetries().catch(() => 0);
  const tradeMonitor = await runTradeMonitorTick().catch(() => ({ evaluated: 0, actions: 0, dispatched: 0 }));

  return { timeouts, retried, reconciled, tradeMonitor };
}
