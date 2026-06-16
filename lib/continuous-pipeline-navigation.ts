import { AUTONOMY_TIMEFRAME_SEQUENCE } from './autonomous-pipeline';
import { resolveConnectedTerminalId } from './autonomy-execution-adapter';
import { getTopDownCaptureSymbols } from './focus-symbols';
import { enforceGoldPipelineSymbol, isGoldOnlyTradingEngine } from './gold-trading-engine';
import { isContinuousTradingEnabled } from './execution-risk-limits';
import type { PairSelectionResult } from './pair-selector';
import { getLatestPipelineSession, startTopDownSession } from './top-down-orchestrator';
import { queryPostgres } from './postgres';

function captureCoverageMaxAgeHours(): number {
  const raw = String(process.env.CACSMS_CAPTURE_COVERAGE_MAX_AGE_HOURS ?? '4').trim();
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 4;
}

async function hasFreshCaptureCoverage(symbol: string): Promise<boolean> {
  const maxAgeHours = captureCoverageMaxAgeHours();
  const result = await queryPostgres(
    `SELECT COUNT(DISTINCT upper(timeframe))::int AS count
     FROM chart_captures
     WHERE upper(symbol) = $1
       AND captured_at > now() - ($2::text || ' hours')::interval`,
    [symbol.toUpperCase(), String(maxAgeHours)],
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
  if (isGoldOnlyTradingEngine()) {
    return [...getTopDownCaptureSymbols()];
  }
  if (!selection) return [...getTopDownCaptureSymbols()];
  if (isContinuousTradingEnabled() && selection.eligibleSymbols.length > 0) {
    return selection.eligibleSymbols
      .map((symbol) => enforceGoldPipelineSymbol(symbol))
      .filter((symbol, index, list) => list.indexOf(symbol) === index);
  }
  const qualified = (selection.qualifiedSymbols ?? [])
    .map((symbol) => symbol.toUpperCase())
    .filter(Boolean);
  if (qualified.length > 0) return qualified;
  if (selection.eligibleSymbols.length > 0) return selection.eligibleSymbols.map((symbol) => symbol.toUpperCase());
  return selection.candidates
    .filter((candidate) => candidate.tradable)
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

  const perCycle = Math.max(1, Math.min(5, input.maxSessionsPerCycle ?? 3));

  for (const symbol of eligible) {
    if (started.length >= perCycle) break;

    if (await hasFreshCaptureCoverage(symbol)) {
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
