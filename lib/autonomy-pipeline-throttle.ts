import type { TradingAccountClass } from '@/lib/execution-account-context';
import { getAutonomyThresholdProfile } from '@/lib/autonomy-account-profiles';
import { isContinuousTradingEnabled, resolveLiveOpenPositionCount } from '@/lib/execution-risk-limits';
import { getOpenPositionSymbols } from '@/lib/open-position-symbols';
import { goldSerialTradingEnabled } from '@/lib/gold-trading-engine';
import { queryPostgres } from '@/lib/postgres';

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Continuous session with open slots below the institutional floor — relax cooldowns and daily caps. */
export async function shouldRelaxContinuousTradingLimits(): Promise<boolean> {
  if (!isContinuousTradingEnabled()) return false;
  const { isContinuousTradingSessionActive } = await import('./continuous-trading-session');
  if (!(await isContinuousTradingSessionActive())) return false;
  const openCount = await resolveLiveOpenPositionCount();
  if (goldSerialTradingEnabled() && openCount > 0) return false;
  const minOpen = envNumber('CACSMS_MIN_OPEN_POSITIONS', goldSerialTradingEnabled() ? 0 : 3);
  return openCount < minOpen;
}

function continuousDispatchCooldownMs(): number {
  const minutes = envNumber('CACSMS_CONTINUOUS_DISPATCH_COOLDOWN_MINUTES', 3);
  return Math.max(1, minutes) * 60_000;
}

export async function shouldRefreshPipelineMtf(symbol: string, accountClass: TradingAccountClass): Promise<boolean> {
  if (await shouldRelaxContinuousTradingLimits()) return true;
  const cooldownMinutes = getAutonomyThresholdProfile(accountClass).mtfRefreshCooldownMinutes;
  const result = await queryPostgres(
    `SELECT
       (SELECT MAX(captured_at) FROM chart_captures WHERE upper(symbol) = $1) AS capture_at,
       (SELECT MAX(created_at) FROM timeframe_analysis_snapshots WHERE upper(symbol) = $1) AS mtf_at`,
    [symbol.toUpperCase()],
  );
  const captureAt = result.rows[0]?.capture_at ? new Date(String(result.rows[0].capture_at)).getTime() : 0;
  const mtfAt = result.rows[0]?.mtf_at ? new Date(String(result.rows[0].mtf_at)).getTime() : 0;
  if (!mtfAt) return true;
  if (captureAt > mtfAt) return true;
  return Date.now() - mtfAt > cooldownMinutes * 60_000;
}

export async function shouldRefreshPipelineInterpretation(symbol: string, timeframe: string, accountClass: TradingAccountClass): Promise<boolean> {
  if (await shouldRelaxContinuousTradingLimits()) return true;
  const cooldownMinutes = getAutonomyThresholdProfile(accountClass).signalCooldownMinutes;
  const result = await queryPostgres(
    `SELECT created_at FROM visual_market_interpretations
     WHERE upper(symbol) = $1 AND upper(timeframe) = $2
     ORDER BY created_at DESC LIMIT 1`,
    [symbol.toUpperCase(), timeframe.toUpperCase()],
  );
  if (!result.rows[0]) return true;
  const createdAt = new Date(String(result.rows[0].created_at)).getTime();
  return Date.now() - createdAt > cooldownMinutes * 60_000;
}

export async function shouldGeneratePipelineSignal(symbol: string, accountClass: TradingAccountClass): Promise<boolean> {
  if (await shouldRelaxContinuousTradingLimits()) return true;
  const profile = getAutonomyThresholdProfile(accountClass);
  const result = await queryPostgres(
    `SELECT
       (SELECT created_at FROM visual_market_interpretations
        WHERE upper(symbol) = $1
        ORDER BY created_at DESC LIMIT 1) AS interpretation_at,
       (SELECT created_at FROM multi_timeframe_decisions
        WHERE upper(symbol) = $1
        ORDER BY created_at DESC LIMIT 1) AS mtf_at,
       (SELECT decision FROM autonomous_decision_logs
        WHERE upper(symbol) = $1
        ORDER BY created_at DESC LIMIT 1) AS last_decision,
       (SELECT created_at FROM autonomous_decision_logs
        WHERE upper(symbol) = $1
        ORDER BY created_at DESC LIMIT 1) AS decision_at,
       (SELECT final_decision FROM visual_market_interpretations
        WHERE upper(symbol) = $1
        ORDER BY created_at DESC LIMIT 1) AS interpretation_decision`,
    [symbol.toUpperCase()],
  );
  const row = result.rows[0];
  if (!row?.decision_at) return true;

  const interpretationAt = row.interpretation_at ? new Date(String(row.interpretation_at)).getTime() : 0;
  const mtfAt = row.mtf_at ? new Date(String(row.mtf_at)).getTime() : 0;
  const decisionAt = new Date(String(row.decision_at)).getTime();
  const cooldownMs = profile.signalCooldownMinutes * 60_000;
  const inputsNewer = interpretationAt > decisionAt || mtfAt > decisionAt;
  const decisionChanged = String(row.interpretation_decision ?? '') !== String(row.last_decision ?? '');
  const cooldownElapsed = Date.now() - decisionAt > cooldownMs;

  return inputsNewer && (decisionChanged || cooldownElapsed);
}

export async function shouldDispatchPipelineExecution(
  decisionLogId: string,
  accountClass: TradingAccountClass,
  symbol?: string,
): Promise<boolean> {
  const existing = await queryPostgres(
    `SELECT status, created_at
     FROM autonomy_execution_dispatches
     WHERE decision_log_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [decisionLogId],
  );
  if (existing.rows[0]) return false;

  const normalizedSymbol = symbol?.toUpperCase() ?? null;
  const relaxed = await shouldRelaxContinuousTradingLimits();

  if (goldSerialTradingEnabled()) {
    const openCount = await resolveLiveOpenPositionCount();
    if (openCount > 0) return false;
  }

  if (relaxed && normalizedSymbol) {
    const openSymbols = await getOpenPositionSymbols();
    if (!openSymbols.includes(normalizedSymbol)) {
      const recent = await queryPostgres(
        `SELECT created_at
         FROM autonomy_execution_dispatches
         WHERE status IN ('dispatched', 'queued', 'failed')
           AND upper(symbol) = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [normalizedSymbol],
      );
      if (!recent.rows[0]) return true;
      const lastDispatchAt = new Date(String(recent.rows[0].created_at)).getTime();
      return Date.now() - lastDispatchAt > continuousDispatchCooldownMs();
    }
  }

  if (relaxed) return true;

  const profile = getAutonomyThresholdProfile(accountClass);
  const recent = normalizedSymbol
    ? await queryPostgres(
        `SELECT created_at
         FROM autonomy_execution_dispatches
         WHERE status IN ('dispatched', 'queued')
           AND upper(symbol) = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [normalizedSymbol],
      )
    : await queryPostgres(
        `SELECT created_at
         FROM autonomy_execution_dispatches
         WHERE status IN ('dispatched', 'queued')
         ORDER BY created_at DESC
         LIMIT 1`,
      );
  if (!recent.rows[0]) return true;
  const lastDispatchAt = new Date(String(recent.rows[0].created_at)).getTime();
  return Date.now() - lastDispatchAt > profile.dispatchCooldownMinutes * 60_000;
}
