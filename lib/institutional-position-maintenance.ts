import {
  GOLD_SYMBOL,
  goldMaxConcurrentPositions,
  goldMaxEntriesPerCycle,
  goldSerialTradingEnabled,
  isGoldOnlyTradingEngine,
} from '@/lib/gold-trading-engine';
import { getExecutionRiskSettings } from '@/lib/execution-risk-settings';
import { getOpenPositionSymbols } from '@/lib/open-position-symbols';
import { getLatestPairSelection, runAutonomousPairSelection, shouldRefreshPairSelection } from '@/lib/pair-selector';
import { queryPostgres } from '@/lib/postgres';
import { is24HourTradingEnabled } from '@/lib/trading-session-policy';
import { evaluateAutonomySafetyLock } from '@/lib/autonomy-safety-lock';
import { basketCapacityBlocksNewEntries, getBasketCapacitySnapshot, logBasketCapacityBlock } from '@/lib/gold-basket-capacity';

import { runMultiStyleTradingCycle } from '@/lib/trading-styles/multi-style-orchestrator';

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
  if (is24HourTradingEnabled() || session !== 'closed') boost += 4;
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

  const { assertRuntimeTradingAllowed } = await import('@/lib/platform-auth/runtime-guard');
  const runtimeGuard = await assertRuntimeTradingAllowed();
  if (!runtimeGuard.allowed) {
    return {
      status: 'paused',
      slotsTargeted: 0,
      symbolsProcessed: [],
      dispatchesAttempted: 0,
      detail: runtimeGuard.reason ?? 'Platform trading disabled for session operator.',
    };
  }

  const risk = await getExecutionRiskSettings();
  const safety = await evaluateAutonomySafetyLock({ autoActivateKillSwitch: true });
  if (safety.locked) {
    return {
      status: 'paused',
      slotsTargeted: 0,
      symbolsProcessed: [],
      dispatchesAttempted: 0,
      detail: `Autonomy safety lock active: ${safety.blockers.join(' ')}`,
    };
  }

  if ((risk.remainingDailyLossAmount ?? 0) <= 0) {
    return {
      status: 'daily_limit',
      slotsTargeted: 0,
      symbolsProcessed: [],
      dispatchesAttempted: 0,
      detail: 'Daily drawdown budget exhausted.',
    };
  }

  const capacity = await getBasketCapacitySnapshot();
  if (basketCapacityBlocksNewEntries(capacity)) {
    await logBasketCapacityBlock({
      source: 'institutional_refill',
      blockers: capacity.blockers,
      snapshot: capacity,
    });
    return {
      status: 'capacity_full',
      slotsTargeted: 0,
      symbolsProcessed: [],
      dispatchesAttempted: 0,
      detail: capacity.blockers.join(' ') || capacity.stateLabel,
    };
  }

  const minOpen = isGoldOnlyTradingEngine()
    ? goldSerialTradingEnabled()
      ? 0
      : Math.min(envNumber('CACSMS_MIN_OPEN_POSITIONS', 2), goldMaxConcurrentPositions())
    : envNumber('CACSMS_MIN_OPEN_POSITIONS', 3);
  const perCycleCap = isGoldOnlyTradingEngine()
    ? goldMaxEntriesPerCycle()
    : envNumber('CACSMS_MAX_ENTRIES_PER_CYCLE', 5);
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

  if (goldSerialTradingEnabled() && openCount > 0) {
    return {
      status: 'capacity_full',
      slotsTargeted: 0,
      symbolsProcessed: [],
      dispatchesAttempted: 0,
      detail: `Gold serial mode — ${openCount} trade(s) still open; waiting for close before next entry.`,
    };
  }

  const cachedSelection = await getLatestPairSelection();
  const selection = cachedSelection && !shouldRefreshPairSelection(cachedSelection)
    ? cachedSelection
    : await runAutonomousPairSelection();
  const openSymbols = await getOpenPositionSymbols();

  const ranked = selection.candidates
    .filter((candidate) => candidate.tradable)
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

  const poolSize = isGoldOnlyTradingEngine()
    ? Math.max(targetEntries * 2, goldMaxConcurrentPositions())
    : Math.max(targetEntries * 4, selection.eligibleSymbols.length, 28);
  const targets: string[] = [];

  if (isGoldOnlyTradingEngine()) {
    const xauOpen = openSymbols.filter((symbol) => symbol.includes('XAU')).length;
    const maxStack = goldMaxConcurrentPositions();
    const slotsForGold = goldSerialTradingEnabled()
      ? openCount > 0
        ? 0
        : Math.min(1, targetEntries)
      : Math.min(targetEntries, Math.max(0, maxStack - xauOpen));
    for (let i = 0; i < slotsForGold; i += 1) {
      targets.push(GOLD_SYMBOL);
    }
  } else {
    const seedSymbols = [
      ...selection.eligibleSymbols,
      ...selection.qualifiedSymbols,
      ...ranked.map((candidate) => candidate.symbol),
    ].map((symbol) => symbol.toUpperCase());

    for (const symbol of [...new Set(seedSymbols)]) {
      if (targets.length >= poolSize) break;
      if (openSymbols.includes(symbol)) continue;
      targets.push(symbol);
    }

    for (const candidate of ranked) {
      if (targets.length >= poolSize) break;
      if (targets.includes(candidate.symbol) || openSymbols.includes(candidate.symbol)) continue;
      targets.push(candidate.symbol);
    }
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

  const multiStyle = await runMultiStyleTradingCycle({
    maxTotalEntries: targetEntries,
    symbols: targets,
  });
  const dispatchesAttempted = multiStyle.dispatchesAttempted;
  const actionableDispatches = multiStyle.actionableDispatches;
  const processedSymbols = Object.values(multiStyle.byStyle).flatMap((row) => row.symbols);

  await queryPostgres(
    `
      INSERT INTO mt5_bridge_settings (key, value, updated_at)
      VALUES ('institutional_position_maintenance_last_run', $1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [JSON.stringify({
      trigger,
      targets: processedSymbols,
      dispatchesAttempted,
      actionableDispatches,
      openCount,
      multiStyle,
      at: new Date().toISOString(),
    })],
  ).catch(() => null);

  return {
    status: actionableDispatches > 0 ? 'refilled' : dispatchesAttempted > 0 ? 'skipped' : 'skipped',
    slotsTargeted: targetEntries,
    symbolsProcessed: processedSymbols,
    dispatchesAttempted,
    detail: multiStyle.detail,
  };
}
