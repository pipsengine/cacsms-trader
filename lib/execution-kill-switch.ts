import { appendExecutionEvent } from '@/lib/execution-bridge-store';
import { queryPostgres } from '@/lib/postgres';

export const EXECUTION_KILL_SWITCH_KEY = 'execution_kill_switch_active';
export const EXECUTION_KILL_SWITCH_REASON_KEY = 'execution_kill_switch_reason';
export const EXECUTION_KILL_SWITCH_OPERATOR_KEY = 'execution_kill_switch_operator';

export type ExecutionKillSwitchStatus = {
  active: boolean;
  source: 'database' | 'environment' | 'none';
  reason: string | null;
  operator: string | null;
  updatedAt: string | null;
};

function envKillSwitchActive(): boolean {
  const raw = String(process.env.CACSMS_KILL_SWITCH ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

async function readSetting(key: string): Promise<string> {
  try {
    const result = await queryPostgres(
      `
        SELECT value
        FROM mt5_bridge_settings
        WHERE key = $1
        LIMIT 1
      `,
      [key],
    );
    return String(result.rows[0]?.value ?? '').trim();
  } catch {
    return '';
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  await queryPostgres(
    `
      INSERT INTO mt5_bridge_settings (key, value, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
    `,
    [key, value],
  );
}

export async function getExecutionKillSwitchStatus(): Promise<ExecutionKillSwitchStatus> {
  try {
    const result = await queryPostgres(
      `
        SELECT key, value, updated_at::text AS updated_at
        FROM mt5_bridge_settings
        WHERE key = ANY($1::text[])
      `,
      [[EXECUTION_KILL_SWITCH_KEY, EXECUTION_KILL_SWITCH_REASON_KEY, EXECUTION_KILL_SWITCH_OPERATOR_KEY]],
    );
    const byKey = new Map(
      result.rows.map((row) => {
        const typed = row as { key: string; value: string; updated_at?: string };
        return [typed.key, typed] as const;
      }),
    );
    const activeRow = byKey.get(EXECUTION_KILL_SWITCH_KEY);
    const active = String(activeRow?.value ?? '').toLowerCase() === 'true';
    if (active) {
      return {
        active: true,
        source: 'database',
        reason: String(byKey.get(EXECUTION_KILL_SWITCH_REASON_KEY)?.value ?? '').trim() || null,
        operator: String(byKey.get(EXECUTION_KILL_SWITCH_OPERATOR_KEY)?.value ?? '').trim() || null,
        updatedAt: activeRow?.updated_at ?? null,
      };
    }
  } catch {
    // fall through to environment
  }

  if (envKillSwitchActive()) {
    return {
      active: true,
      source: 'environment',
      reason: 'CACSMS_KILL_SWITCH environment variable is active.',
      operator: null,
      updatedAt: null,
    };
  }

  return {
    active: false,
    source: 'none',
    reason: null,
    operator: null,
    updatedAt: null,
  };
}

export async function isExecutionKillSwitchActive(): Promise<boolean> {
  const status = await getExecutionKillSwitchStatus();
  return status.active;
}

export async function activateExecutionKillSwitch(input: {
  reason?: string;
  operator?: string;
  commandId?: string;
  terminalId?: string;
}): Promise<ExecutionKillSwitchStatus> {
  const reason = String(input.reason ?? 'Execution kill switch activated by operator.').trim();
  const operator = String(input.operator ?? 'operator').trim();

  await writeSetting(EXECUTION_KILL_SWITCH_KEY, 'true');
  await writeSetting(EXECUTION_KILL_SWITCH_REASON_KEY, reason);
  await writeSetting(EXECUTION_KILL_SWITCH_OPERATOR_KEY, operator);

  await appendExecutionEvent({
    commandId: input.commandId ?? `kill-switch-${Date.now()}`,
    terminalId: input.terminalId ?? 'system',
    lifecycleState: 'CANCELLED',
    eventType: 'KILL_SWITCH_ACTIVATED',
    severity: 'WARNING',
    message: reason,
    payload: { operator, source: 'api' },
  }).catch(() => null);

  return getExecutionKillSwitchStatus();
}

export async function deactivateExecutionKillSwitch(input?: {
  reason?: string;
  operator?: string;
  commandId?: string;
  terminalId?: string;
}): Promise<ExecutionKillSwitchStatus> {
  const reason = String(input?.reason ?? 'Execution kill switch cleared by operator.').trim();
  const operator = String(input?.operator ?? 'operator').trim();

  await writeSetting(EXECUTION_KILL_SWITCH_KEY, 'false');
  await writeSetting(EXECUTION_KILL_SWITCH_REASON_KEY, reason);
  await writeSetting(EXECUTION_KILL_SWITCH_OPERATOR_KEY, operator);

  await appendExecutionEvent({
    commandId: input?.commandId ?? `kill-switch-${Date.now()}`,
    terminalId: input?.terminalId ?? 'system',
    lifecycleState: 'QUEUED',
    eventType: 'KILL_SWITCH_CLEARED',
    severity: 'INFO',
    message: reason,
    payload: { operator, source: 'api' },
  }).catch(() => null);

  return getExecutionKillSwitchStatus();
}
