import { AUTONOMY_TIMEFRAME_SEQUENCE } from './autonomous-pipeline';
import { resolveConnectedTerminalId } from './autonomy-execution-adapter';
import { isContinuousTradingEnabled } from './execution-risk-limits';
import type { PairSelectionResult } from './pair-selector';
import { getLatestPipelineSession, startTopDownSession } from './top-down-orchestrator';
import { queryPostgres } from './postgres';

async function hasFullCaptureCoverage(symbol: string): Promise<boolean> {
  const result = await queryPostgres(
    `SELECT COUNT(DISTINCT upper(timeframe))::int AS count
     FROM chart_captures
     WHERE upper(symbol) = $1`,
    [symbol.toUpperCase()],
  );
  return Number(result.rows[0]?.count ?? 0) >= AUTONOMY_TIMEFRAME_SEQUENCE.length;
}

function navigationSessionActive(session: Record<string, unknown> | null): boolean {
  if (!session) return false;
  const status = String(session.status ?? '').toLowerCase();
  if (status !== 'running') return false;
  const stageMap = session.stage_status_json && typeof session.stage_status_json === 'object'
    ? session.stage_status_json as Record<string, unknown>
    : {};
  const navStatus = String(stageMap['chart-navigation'] ?? '').toLowerCase();
  return navStatus === 'in_progress' || String(session.current_stage ?? '') === 'chart-navigation';
}

function resolveEligibleSymbols(selection: PairSelectionResult | null): string[] {
  if (!selection) return [];
  if (selection.eligibleSymbols.length > 0) return selection.eligibleSymbols.map((symbol) => symbol.toUpperCase());
  return selection.candidates
    .filter((candidate) => candidate.eligibleForNewEntry)
    .map((candidate) => candidate.symbol.toUpperCase());
}

/**
 * Continuous mode must not stall on Stage 3 — auto-start top-down navigation
 * for eligible symbols that still lack full capture coverage.
 */
export async function ensureContinuousChartNavigation(input: {
  latestSelection: PairSelectionResult | null;
  connectedTerminals: number;
  maxSessionsPerCycle?: number;
}): Promise<{ started: string[]; skipped: string[] }> {
  const started: string[] = [];
  const skipped: string[] = [];

  if (!isContinuousTradingEnabled()) return { started, skipped };
  if (input.connectedTerminals <= 0) return { started, skipped };

  const eligible = resolveEligibleSymbols(input.latestSelection);
  if (eligible.length === 0) return { started, skipped };

  const terminalId = await resolveConnectedTerminalId();
  if (!terminalId) return { started, skipped };

  const perCycle = Math.max(1, Math.min(3, input.maxSessionsPerCycle ?? 1));

  for (const symbol of eligible) {
    if (started.length >= perCycle) break;

    if (await hasFullCaptureCoverage(symbol)) {
      skipped.push(symbol);
      continue;
    }

    const session = await getLatestPipelineSession(symbol);
    if (navigationSessionActive(session as Record<string, unknown> | null)) {
      skipped.push(symbol);
      continue;
    }

    try {
      await startTopDownSession({ symbol, terminalId, mode: 'full_auto' });
      started.push(symbol);
    } catch {
      skipped.push(symbol);
    }
  }

  return { started, skipped };
}

export async function countCaptureTimeframes(symbol: string): Promise<number> {
  const result = await queryPostgres(
    `SELECT COUNT(DISTINCT upper(timeframe))::int AS count
     FROM chart_captures
     WHERE upper(symbol) = $1`,
    [symbol.toUpperCase()],
  );
  return Number(result.rows[0]?.count ?? 0);
}
