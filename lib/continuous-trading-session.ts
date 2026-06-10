import { resumeAutonomy, emergencyStopAutonomy } from '@/lib/autonomy-store';
import { deactivateExecutionKillSwitch, activateExecutionKillSwitch } from '@/lib/execution-kill-switch';
import { queryPostgres } from '@/lib/postgres';

export const CONTINUOUS_TRADING_SESSION_KEY = 'continuous_trading_session_active';
export const CONTINUOUS_TRADING_SESSION_STARTED_AT_KEY = 'continuous_trading_session_started_at';
export const CONTINUOUS_TRADING_SESSION_STOPPED_AT_KEY = 'continuous_trading_session_stopped_at';

export type ContinuousTradingSessionStatus = {
  active: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  operator: string | null;
};

async function readSetting(key: string): Promise<string> {
  try {
    const result = await queryPostgres(
      `SELECT value FROM mt5_bridge_settings WHERE key = $1 LIMIT 1`,
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
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [key, value],
  );
}

export async function getContinuousTradingSessionStatus(): Promise<ContinuousTradingSessionStatus> {
  const [activeRaw, startedAt, stoppedAt] = await Promise.all([
    readSetting(CONTINUOUS_TRADING_SESSION_KEY),
    readSetting(CONTINUOUS_TRADING_SESSION_STARTED_AT_KEY),
    readSetting(CONTINUOUS_TRADING_SESSION_STOPPED_AT_KEY),
  ]);
  return {
    active: activeRaw === 'true',
    startedAt: startedAt || null,
    stoppedAt: stoppedAt || null,
    operator: null,
  };
}

export async function isContinuousTradingSessionActive(): Promise<boolean> {
  return (await getContinuousTradingSessionStatus()).active;
}

export async function startContinuousTradingSession(input?: {
  operator?: string;
}): Promise<ContinuousTradingSessionStatus> {
  const operator = String(input?.operator ?? 'command_center').trim();
  const startedAt = new Date().toISOString();

  await writeSetting(CONTINUOUS_TRADING_SESSION_KEY, 'true');
  await writeSetting(CONTINUOUS_TRADING_SESSION_STARTED_AT_KEY, startedAt);
  await writeSetting(CONTINUOUS_TRADING_SESSION_STOPPED_AT_KEY, '');

  await deactivateExecutionKillSwitch({
    reason: 'Continuous trading session started from command center.',
    operator,
  });
  await resumeAutonomy();

  try {
    const { advanceAutonomousPipeline } = await import('./autonomous-pipeline-store');
    await advanceAutonomousPipeline('AUTO');
    const { maintainInstitutionalPositions } = await import('./institutional-position-maintenance');
    await maintainInstitutionalPositions('session_start');
  } catch {
    // first cycle retries on scheduler tick
  }

  return getContinuousTradingSessionStatus();
}

export async function stopContinuousTradingSession(input?: {
  operator?: string;
  reason?: string;
}): Promise<ContinuousTradingSessionStatus> {
  const operator = String(input?.operator ?? 'command_center').trim();
  const reason = String(input?.reason ?? 'Continuous trading stopped from command center.').trim();
  const stoppedAt = new Date().toISOString();

  await writeSetting(CONTINUOUS_TRADING_SESSION_KEY, 'false');
  await writeSetting(CONTINUOUS_TRADING_SESSION_STOPPED_AT_KEY, stoppedAt);

  await activateExecutionKillSwitch({ reason, operator });
  await emergencyStopAutonomy(reason);

  return getContinuousTradingSessionStatus();
}
