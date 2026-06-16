import { generateAutonomousSignal } from '@/lib/autonomy-store';
import {
  GOLD_SYMBOL,
  goldMaxEntriesPerCycle,
  goldPreferredStyles,
  goldSerialTradingEnabled,
  isGoldOnlyTradingEngine,
} from '@/lib/gold-trading-engine';
import { getLatestPairSelection } from '@/lib/pair-selector';
import { queryPostgres } from '@/lib/postgres';
import type { MultiStyleCycleResult, TradingStyleId } from './types';
import { getEnabledTradingStyles, TRADING_STYLE_PROFILES } from './registry';
import { buildStyleFitnessMatrix, pickStyleCandidates } from './style-selector';

export async function runMultiStyleTradingCycle(input: {
  maxTotalEntries: number;
  symbols?: string[];
}): Promise<MultiStyleCycleResult> {
  const styles = getEnabledTradingStyles().filter((style) =>
    !isGoldOnlyTradingEngine() || goldPreferredStyles().includes(style.id),
  );
  const selection = await getLatestPairSelection();
  const symbolPool = isGoldOnlyTradingEngine()
    ? [GOLD_SYMBOL]
    : input.symbols?.length
      ? input.symbols
      : selection?.eligibleSymbols?.length
        ? selection.eligibleSymbols
        : selection?.qualifiedSymbols ?? [];

  const matrix = await buildStyleFitnessMatrix(symbolPool.slice(0, isGoldOnlyTradingEngine() ? 1 : 28));
  const maxEntries = isGoldOnlyTradingEngine()
    ? Math.min(input.maxTotalEntries, goldMaxEntriesPerCycle())
    : input.maxTotalEntries;
  const candidates = pickStyleCandidates(matrix, maxEntries, {
    allowGoldStacking: isGoldOnlyTradingEngine() && !goldSerialTradingEnabled(),
  });

  const byStyle: MultiStyleCycleResult['byStyle'] = {};
  for (const style of styles) {
    byStyle[style.id] = { attempted: 0, actionable: 0, symbols: [] };
  }

  let dispatchesAttempted = 0;
  let actionableDispatches = 0;

  for (const candidate of candidates) {
    try {
      const { recoverPendingPipelineCaptures, syncMt5CaptureAcks } = await import('@/lib/mt5-capture-ingest');
      const { analyzeVisualMarketInterpretation } = await import('@/lib/visual-market-interpretation-store');
      await recoverPendingPipelineCaptures(candidate.symbol).catch(() => 0);
      await syncMt5CaptureAcks({ symbol: candidate.symbol, limit: 12 }).catch(() => null);
      await analyzeVisualMarketInterpretation({
        symbol: candidate.symbol,
        timeframe: candidate.entryTimeframe === 'M5' ? 'M15' : candidate.entryTimeframe,
      }).catch(() => null);

      const signal = await generateAutonomousSignal(candidate.symbol, candidate.entryTimeframe, {
        refillMode: true,
        tradingStyle: candidate.styleId,
      });

      dispatchesAttempted += 1;
      byStyle[candidate.styleId].attempted += 1;
      byStyle[candidate.styleId].symbols.push(candidate.symbol);

      if (['BUY', 'SELL'].includes(signal.decision)) {
        actionableDispatches += 1;
        byStyle[candidate.styleId].actionable += 1;
      }
    } catch {
      // continue with next style/symbol candidate
    }
  }

  const result: MultiStyleCycleResult = {
    stylesEnabled: styles.map((style) => style.id),
    candidatesEvaluated: candidates.length,
    dispatchesAttempted,
    actionableDispatches,
    byStyle,
    at: new Date().toISOString(),
    detail: actionableDispatches > 0
      ? isGoldOnlyTradingEngine()
        ? `Gold engine placed ${actionableDispatches} actionable XAU/USD signal(s) across ${styles.map((s) => s.label).join(', ')}.`
        : `Multi-style cycle placed ${actionableDispatches} actionable signal(s) across ${styles.map((s) => s.label).join(', ')}.`
      : dispatchesAttempted > 0
        ? `Multi-style cycle scanned ${dispatchesAttempted} candidate(s) — awaiting BUY/SELL confirmation.`
        : 'No eligible multi-style candidates this cycle.',
  };

  await queryPostgres(
    `
      INSERT INTO mt5_bridge_settings (key, value, updated_at)
      VALUES ('multi_style_trading_last_run', $1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [JSON.stringify(result)],
  ).catch(() => null);

  return result;
}

export async function getMultiStyleTradingSnapshot(): Promise<MultiStyleCycleResult | null> {
  try {
    const row = await queryPostgres(
      `SELECT value FROM mt5_bridge_settings WHERE key = 'multi_style_trading_last_run' LIMIT 1`,
    );
    const raw = String(row.rows[0]?.value ?? '').trim();
    if (!raw) return null;
    return JSON.parse(raw) as MultiStyleCycleResult;
  } catch {
    return null;
  }
}

export function listTradingStyleCapabilities(): Array<{
  id: TradingStyleId;
  label: string;
  entryTimeframe: string;
  maxHoldHours: number;
  algorithms: string[];
  enabled: boolean;
}> {
  const enabled = new Set(getEnabledTradingStyles().map((style) => style.id));
  return (Object.keys(TRADING_STYLE_PROFILES) as TradingStyleId[]).map((id) => ({
    id,
    label: TRADING_STYLE_PROFILES[id].label,
    entryTimeframe: TRADING_STYLE_PROFILES[id].entryTimeframe,
    maxHoldHours: TRADING_STYLE_PROFILES[id].maxHoldHours,
    algorithms: TRADING_STYLE_PROFILES[id].algorithms,
    enabled: enabled.has(id),
  }));
}
