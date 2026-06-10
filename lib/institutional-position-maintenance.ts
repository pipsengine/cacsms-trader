import { generateAutonomousSignal } from '@/lib/autonomy-store';
import { getExecutionRiskSettings } from '@/lib/execution-risk-settings';
import { getOpenPositionSymbols } from '@/lib/open-position-symbols';
import { runAutonomousPairSelection } from '@/lib/pair-selector';
import { findCorrelatedOpenSymbol } from '@/lib/symbol-correlation';
import { queryPostgres } from '@/lib/postgres';

const SIGNAL_TIMEFRAME = 'M15';

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export type InstitutionalMaintenanceResult = {
  status: 'paused' | 'daily_limit' | 'capacity_full' | 'no_candidates' | 'refilled' | 'skipped';
  slotsTargeted: number;
  symbolsProcessed: string[];
  dispatchesAttempted: number;
  detail: string;
};

function institutionalRankBoost(symbol: string, macroScore: number, liquidityScore: number, session: string): number {
  let boost = 0;
  if (macroScore >= 60) boost += 6;
  if (macroScore <= 35) boost -= 8;
  if (liquidityScore >= 75) boost += 5;
  if (session === 'london' || session === 'new_york' || session === 'overlap') boost += 4;
  if (symbol.includes('XAU')) boost += 2;
  return boost;
}

async function countOpenPositions(): Promise<number> {
  const symbols = await getOpenPositionSymbols();
  return symbols.length;
}

export type InstitutionalMaintenanceSnapshot = {
  at: string | null;
  trigger: string | null;
  targets: string[];
  dispatchesAttempted: number;
  openCount: number | null;
};

export async function getLastInstitutionalMaintenanceSnapshot(): Promise<InstitutionalMaintenanceSnapshot | null> {
  try {
    const result = await queryPostgres(
      `SELECT value FROM mt5_bridge_settings WHERE key = 'institutional_position_maintenance_last_run' LIMIT 1`,
    );
    const raw = String(result.rows[0]?.value ?? '').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      at?: string;
      trigger?: string;
      targets?: string[];
      dispatchesAttempted?: number;
      openCount?: number;
    };
    return {
      at: parsed.at ?? null,
      trigger: parsed.trigger ?? null,
      targets: Array.isArray(parsed.targets) ? parsed.targets.map(String) : [],
      dispatchesAttempted: Number(parsed.dispatchesAttempted ?? 0),
      openCount: parsed.openCount == null ? null : Number(parsed.openCount),
    };
  } catch {
    return null;
  }
}

export async function maintainInstitutionalPositions(trigger = 'scheduler'): Promise<InstitutionalMaintenanceResult> {
  const { isContinuousTradingSessionActive } = await import('./continuous-trading-session');
  if (!(await isContinuousTradingSessionActive())) {
    return {
      status: 'paused',
      slotsTargeted: 0,
      symbolsProcessed: [],
      dispatchesAttempted: 0,
      detail: 'Continuous trading session is stopped.',
    };
  }

  const risk = await getExecutionRiskSettings();
  if ((risk.remainingDailyLossAmount ?? 0) <= 0) {
    return {
      status: 'daily_limit',
      slotsTargeted: 0,
      symbolsProcessed: [],
      dispatchesAttempted: 0,
      detail: 'Daily drawdown budget exhausted.',
    };
  }

  const minOpen = envNumber('CACSMS_MIN_OPEN_POSITIONS', 1);
  const perCycleCap = envNumber('CACSMS_MAX_ENTRIES_PER_CYCLE', 3);
  const openCount = await countOpenPositions();
  const slotsToFill = Math.max(0, risk.remainingOpenPositions);
  const deficit = Math.max(0, minOpen - openCount);
  const targetEntries = slotsToFill <= 0 && deficit <= 0
    ? 0
    : Math.min(perCycleCap, Math.max(deficit, slotsToFill));

  if (targetEntries <= 0) {
    return {
      status: 'capacity_full',
      slotsTargeted: 0,
      symbolsProcessed: [],
      dispatchesAttempted: 0,
      detail: `Open capacity full (${openCount}/${risk.maxOpenPositions}).`,
    };
  }

  const selection = await runAutonomousPairSelection();
  const openSymbols = await getOpenPositionSymbols();
  const exposureSymbols = [...openSymbols];

  const ranked = selection.candidates
    .filter((candidate) => candidate.tradable && !candidate.blocked)
    .map((candidate) => ({
      ...candidate,
      institutionalScore: candidate.compositeScore + institutionalRankBoost(
        candidate.symbol,
        candidate.macroScore,
        candidate.liquidityScore,
        candidate.session,
      ),
    }))
    .sort((a, b) => b.institutionalScore - a.institutionalScore);

  const targets: string[] = [];
  for (const candidate of ranked) {
    if (targets.length >= targetEntries) break;
    if (openSymbols.includes(candidate.symbol)) continue;
    const correlatedWith = findCorrelatedOpenSymbol(candidate.symbol, exposureSymbols, { excludeSameSymbol: true });
    if (correlatedWith) continue;
    targets.push(candidate.symbol);
    exposureSymbols.push(candidate.symbol);
  }

  if (targets.length === 0) {
    return {
      status: 'no_candidates',
      slotsTargeted: targetEntries,
      symbolsProcessed: [],
      dispatchesAttempted: 0,
      detail: 'No uncorrelated institutional candidates available this cycle.',
    };
  }

  let dispatchesAttempted = 0;
  for (const symbol of targets) {
    try {
      await generateAutonomousSignal(symbol, SIGNAL_TIMEFRAME);
      dispatchesAttempted += 1;
    } catch {
      // try next symbol in the batch
    }
  }

  await queryPostgres(
    `
      INSERT INTO mt5_bridge_settings (key, value, updated_at)
      VALUES ('institutional_position_maintenance_last_run', $1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [JSON.stringify({ trigger, targets, dispatchesAttempted, openCount, at: new Date().toISOString() })],
  ).catch(() => null);

  return {
    status: dispatchesAttempted > 0 ? 'refilled' : 'skipped',
    slotsTargeted: targetEntries,
    symbolsProcessed: targets,
    dispatchesAttempted,
    detail: dispatchesAttempted > 0
      ? `Institutional refill cycle processed ${dispatchesAttempted} symbol(s): ${targets.join(', ')}.`
      : `Candidates found (${targets.join(', ')}) but no actionable dispatches this cycle.`,
  };
}
