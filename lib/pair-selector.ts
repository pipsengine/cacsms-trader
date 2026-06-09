import { randomUUID } from 'crypto';

import { MarketIntelligenceEngine } from '@/services/market-intelligence-engine';
import type { TickSnapshot, TradingSession } from '@/packages/shared-types';
import { SYSTEM_FOCUS_SYMBOLS, SYSTEM_FOCUS_SYMBOL_COUNT } from './focus-symbols';
import { countTradesOpenedTodayForSymbol } from './execution-risk-limits';
import { getExecutionRiskSettings } from './execution-risk-settings';
import { extractSymbolTelemetry, symbolTelemetryMap } from './mt5-symbol-telemetry';
import { getOpenPositionSymbols } from './open-position-symbols';
import { logPairSelectionEvent } from './pair-selection-audit';
import { clampScore, parsePairCurrencies } from './pair-selector-utils';
import { findCorrelatedOpenSymbol } from './symbol-correlation';
import { queryPostgres } from './postgres';

export const PAIR_SELECTION_REFRESH_MS = Number(process.env.PAIR_SELECTION_REFRESH_MS ?? 5 * 60 * 1000);

export const DEFAULT_WATCHLIST = [...SYSTEM_FOCUS_SYMBOLS];

export interface PairSelectionConfig {
  watchlistSymbols: string[];
  maxSpreadPoints: number;
  pairSelectionEnabled: boolean;
  maxSelectedSymbols: number;
}

export const DEFAULT_PAIR_SELECTION_CONFIG: PairSelectionConfig = {
  watchlistSymbols: [...DEFAULT_WATCHLIST],
  maxSpreadPoints: 35,
  pairSelectionEnabled: true,
  maxSelectedSymbols: SYSTEM_FOCUS_SYMBOL_COUNT,
};

export interface PairSelectionCandidate {
  symbol: string;
  marketScore: number;
  setupScore: number;
  liquidityScore: number;
  macroScore: number;
  compositeScore: number;
  tradable: boolean;
  eligibleForNewEntry: boolean;
  blocked: boolean;
  blockReason: string | null;
  session: TradingSession;
  reasons: string[];
  rank: number;
}

export interface PairSelectionResult {
  id: string;
  selectedSymbol: string;
  selectedSymbols: string[];
  eligibleSymbols: string[];
  qualifiedSymbols: string[];
  openPositionSymbols: string[];
  dailyLimitReached: boolean;
  scanSummary: string;
  candidates: PairSelectionCandidate[];
  session: TradingSession;
  selectedAt: string;
  source: 'autonomous_scan' | 'manual_override' | 'config_fallback';
}

type BridgeTerminal = {
  terminalId?: string;
  status?: string;
  symbolTelemetry?: unknown;
  telemetrySummary?: unknown;
  eurusdAvailable?: boolean | null;
  xauusdAvailable?: boolean | null;
  gbpusdAvailable?: boolean | null;
  usdjpyAvailable?: boolean | null;
  eurusdSpreadPoints?: number | null;
  xauusdSpreadPoints?: number | null;
  gbpusdSpreadPoints?: number | null;
  usdjpySpreadPoints?: number | null;
};

const pairSelectionSchemaSql = `
CREATE TABLE IF NOT EXISTS autonomous_pair_selections (
  id UUID PRIMARY KEY,
  selected_symbol TEXT NOT NULL,
  selected_symbols_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  candidates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  session TEXT,
  source TEXT NOT NULL DEFAULT 'autonomous_scan',
  composite_score NUMERIC(8, 4),
  reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_autonomous_pair_selections_created ON autonomous_pair_selections(created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

const engine = new MarketIntelligenceEngine();

export async function ensurePairSelectionSchema() {
  if (!schemaReady) {
    schemaReady = queryPostgres(pairSelectionSchemaSql).then(() => undefined);
  }
  return schemaReady;
}

export function shouldRefreshPairSelection(latest: PairSelectionResult | null): boolean {
  if (!latest) return true;
  return Date.now() - new Date(latest.selectedAt).getTime() >= PAIR_SELECTION_REFRESH_MS;
}

export async function maybeRefreshPairSelection(
  latest: PairSelectionResult | null,
): Promise<PairSelectionResult | null> {
  if (!shouldRefreshPairSelection(latest)) return latest;
  return runAutonomousPairSelection();
}

export async function runAutonomousPairSelection(
  config: Partial<PairSelectionConfig> = {},
): Promise<PairSelectionResult> {
  await ensurePairSelectionSchema();
  const resolved = { ...DEFAULT_PAIR_SELECTION_CONFIG, ...config };
  const watchlist = resolved.watchlistSymbols.map((symbol) => symbol.toUpperCase());
  const [terminal, openPositionSymbols, riskSettings] = await Promise.all([
    fetchBestConnectedTerminal(),
    getOpenPositionSymbols(),
    getExecutionRiskSettings(),
  ]);
  const dailyLimitReached = Boolean(
    riskSettings.dailyTradeLimitEnabled && (riskSettings.remainingTradesToday ?? 0) <= 0,
  );
  const openPositionLimitReached = riskSettings.remainingOpenPositions <= 0;
  const maxNewEntries = dailyLimitReached || openPositionLimitReached
    ? 0
    : riskSettings.dailyTradeLimitEnabled
      ? Math.min(
        resolved.maxSelectedSymbols,
        riskSettings.remainingTradesToday ?? resolved.maxSelectedSymbols,
        riskSettings.remainingOpenPositions,
      )
      : Math.min(resolved.maxSelectedSymbols, riskSettings.remainingOpenPositions);

  const ticks = buildTickSnapshots(watchlist, terminal, resolved.maxSpreadPoints);
  const macroScores = await loadPairMacroScores(watchlist);
  const now = new Date();
  const session = engine.detectSession(now);
  const selectionId = randomUUID();

  await logPairSelectionEvent({
    eventType: 'scan_started',
    message: `Pair scan started — ${watchlist.length} symbols on watchlist`,
    reasons: [
      openPositionSymbols.length > 0 ? `Open exposure: ${openPositionSymbols.join(', ')}` : 'No open positions',
      dailyLimitReached
        ? `Daily trade limit reached (${riskSettings.tradesOpenedToday}/${riskSettings.maxTradesPerDay} across ${riskSettings.activeSymbolCount} symbols)`
        : openPositionLimitReached
          ? `Open position capacity reached (${riskSettings.openPositions}/${riskSettings.maxOpenPositions} drawdown-based slots)`
          : `Up to ${maxNewEntries} new symbol(s) · ${riskSettings.remainingOpenPositions} open slots · ${riskSettings.tradesPerSymbolPerDay} trade(s)/symbol/day`,
    ],
    metadata: { watchlist, openPositionSymbols, dailyLimitReached },
    selectionId,
  });

  const eligibleSymbols = engine.selectPairs({ symbols: watchlist, ticks, candlesBySymbol: {}, now });
  const marketScans = engine.scan({ symbols: eligibleSymbols.length > 0 ? eligibleSymbols : watchlist, ticks, candlesBySymbol: {}, now });
  const telemetry = symbolTelemetryMap(terminal);

  const candidates: PairSelectionCandidate[] = marketScans
    .map((scan) => {
      const tick = ticks.find((item) => item.symbol === scan.symbol);
      const telemetryRow = telemetry.get(scan.symbol);
      const spreadOk = tick ? tick.spreadPoints <= resolved.maxSpreadPoints : false;
      const tradableTelemetry = Boolean(
        telemetryRow?.available
        && telemetryRow.tradable
        && telemetryRow.sessionOpen
        && !telemetryRow.stale
        && spreadOk,
      );
      const macroScore = macroScores[scan.symbol] ?? 50;
      const macroPenalty = macroScore < 35 ? -15 : macroScore > 65 ? 8 : 0;
      const compositeScore = clampScore(
        scan.setupScore * 0.45
        + scan.liquidityScore * 0.3
        + macroScore * 0.15
        + (session === 'closed' ? 0 : 10)
        + macroPenalty,
      );
      const liquidityQualified = scan.liquidityScore >= 45 && tradableTelemetry && scan.session !== 'closed';
      const tradable = (scan.tradable || liquidityQualified) && tradableTelemetry && scan.condition !== 'illiquid';
      const reasons = [
        ...scan.reasons,
        telemetryRow
          ? `${telemetryRow.brokerSymbol} spread ${telemetryRow.spreadPoints ?? 'n/a'} pts, tick age ${telemetryRow.tickAgeSeconds}s`
          : 'No live terminal telemetry',
        telemetryRow?.stale ? 'Stale tick feed' : 'Tick feed fresh',
        `Macro alignment ${macroScore}`,
        tradable
          ? scan.tradable
            ? 'Passes spread, liquidity, and session filters'
            : 'Qualified via live telemetry (awaiting candle context for full setup score)'
          : 'Filtered by spread, liquidity, session, or macro risk',
      ];
      return {
        symbol: scan.symbol,
        marketScore: scan.setupScore,
        setupScore: scan.setupScore,
        liquidityScore: scan.liquidityScore,
        macroScore,
        compositeScore,
        tradable,
        eligibleForNewEntry: tradable,
        blocked: false,
        blockReason: null,
        session: scan.session,
        reasons,
        rank: 0,
      };
    })
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  for (const candidate of candidates) {
    if (!candidate.tradable) {
      await logPairSelectionEvent({
        eventType: 'symbol_filtered',
        symbol: candidate.symbol,
        selected: false,
        message: `${candidate.symbol} filtered — score ${candidate.compositeScore}`,
        reasons: candidate.reasons.slice(-3),
        metadata: { compositeScore: candidate.compositeScore, rank: candidate.rank },
        selectionId,
      });
      continue;
    }

    const correlatedWith = findCorrelatedOpenSymbol(candidate.symbol, openPositionSymbols);
    if (correlatedWith) {
      candidate.blocked = true;
      candidate.blockReason = `Correlated with open ${correlatedWith}`;
      candidate.eligibleForNewEntry = false;
      candidate.reasons.push(`Blocked: shares currency exposure with open ${correlatedWith}`);
      await logPairSelectionEvent({
        eventType: 'symbol_blocked_correlation',
        symbol: candidate.symbol,
        selected: false,
        message: `${candidate.symbol} blocked — correlated with open ${correlatedWith}`,
        reasons: candidate.reasons.slice(-3),
        metadata: { correlatedWith, compositeScore: candidate.compositeScore },
        selectionId,
      });
      continue;
    }

    if (openPositionSymbols.includes(candidate.symbol)) {
      candidate.eligibleForNewEntry = false;
      candidate.reasons.push('Open position already active — monitoring only, not a new entry target');
      await logPairSelectionEvent({
        eventType: 'symbol_rejected',
        symbol: candidate.symbol,
        selected: false,
        message: `${candidate.symbol} skipped for new entry — position already open`,
        reasons: candidate.reasons.slice(-3),
        metadata: { compositeScore: candidate.compositeScore },
        selectionId,
      });
      continue;
    }

    const symbolTradesToday = await countTradesOpenedTodayForSymbol(candidate.symbol);
    if (
      riskSettings.dailyTradeLimitEnabled
      && riskSettings.symbolBasedTradeLimit
      && symbolTradesToday >= riskSettings.tradesPerSymbolPerDay
    ) {
      candidate.blocked = true;
      candidate.blockReason = `Symbol daily trade limit reached (${symbolTradesToday}/${riskSettings.tradesPerSymbolPerDay})`;
      candidate.eligibleForNewEntry = false;
      candidate.reasons.push(`Blocked: ${candidate.symbol} already traded ${symbolTradesToday} time(s) today`);
      await logPairSelectionEvent({
        eventType: 'symbol_blocked_limit',
        symbol: candidate.symbol,
        selected: false,
        message: `${candidate.symbol} blocked — per-symbol daily limit reached`,
        reasons: candidate.reasons.slice(-3),
        metadata: { symbolTradesToday, tradesPerSymbolPerDay: riskSettings.tradesPerSymbolPerDay },
        selectionId,
      });
      continue;
    }

    if (dailyLimitReached) {
      candidate.blocked = true;
      candidate.blockReason = 'Daily trade limit reached';
      candidate.eligibleForNewEntry = false;
      candidate.reasons.push(`Blocked: daily trade limit reached (${riskSettings.tradesOpenedToday}/${riskSettings.maxTradesPerDay})`);
      await logPairSelectionEvent({
        eventType: 'symbol_blocked_limit',
        symbol: candidate.symbol,
        selected: false,
        message: `${candidate.symbol} blocked — daily trade limit reached`,
        reasons: candidate.reasons.slice(-3),
        metadata: { tradesOpenedToday: riskSettings.tradesOpenedToday, maxTradesPerDay: riskSettings.maxTradesPerDay },
        selectionId,
      });
      continue;
    }
  }

  const qualifiedSymbolsList = candidates
    .filter((candidate) => candidate.tradable && !candidate.blocked)
    .map((candidate) => candidate.symbol);
  const eligibleForEntry = candidates.filter((candidate) => candidate.eligibleForNewEntry);
  const newOrderTargets = eligibleForEntry.slice(0, Math.max(0, maxNewEntries));
  const fallback = watchlist[0] ?? 'XAUUSD';
  const eligibleSymbolsList = newOrderTargets.map((item) => item.symbol);
  const selectedSymbols = [...new Set([...qualifiedSymbolsList, ...openPositionSymbols])];
  const selectedSymbol = newOrderTargets[0]?.symbol
    ?? qualifiedSymbolsList[0]
    ?? openPositionSymbols[0]
    ?? candidates.find((item) => item.tradable)?.symbol
    ?? fallback;

  for (const candidate of candidates.filter((item) => qualifiedSymbolsList.includes(item.symbol))) {
    await logPairSelectionEvent({
      eventType: 'symbol_selected',
      symbol: candidate.symbol,
      selected: true,
      message: `${candidate.symbol} selected — score ${candidate.compositeScore} (${candidate.session} session)`,
      reasons: candidate.reasons.slice(-4),
      metadata: { compositeScore: candidate.compositeScore, rank: candidate.rank },
      selectionId,
    });
  }

  const scanSummary = qualifiedSymbolsList.length > 0
    ? `${qualifiedSymbolsList.length} qualified symbol(s): ${qualifiedSymbolsList.join(', ')}`
      + (newOrderTargets.length > 0
        ? ` · ${newOrderTargets.length} ready for new entry`
        : openPositionLimitReached
          ? ' · open position capacity full — pipeline scan only'
          : dailyLimitReached
            ? ' · daily trade limit reached'
            : '')
    : openPositionSymbols.length > 0
      ? `No new qualified symbols — monitoring ${openPositionSymbols.join(', ')}.`
      : 'No tradable symbols passed filters this cycle.';

  const result: PairSelectionResult = {
    id: selectionId,
    selectedSymbol,
    selectedSymbols: selectedSymbols.length > 0 ? selectedSymbols : [fallback],
    eligibleSymbols: eligibleSymbolsList,
    qualifiedSymbols: qualifiedSymbolsList,
    openPositionSymbols,
    dailyLimitReached,
    scanSummary,
    candidates,
    session,
    selectedAt: now.toISOString(),
    source: qualifiedSymbolsList.length > 0 ? 'autonomous_scan' : openPositionSymbols.length > 0 ? 'autonomous_scan' : 'config_fallback',
  };

  await logPairSelectionEvent({
    eventType: 'scan_completed',
    symbol: selectedSymbol,
    selected: qualifiedSymbolsList.length > 0,
    message: scanSummary,
    reasons: [
      `Primary pick: ${selectedSymbol}`,
      `Pipeline symbols: ${result.selectedSymbols.join(', ')}`,
    ],
    metadata: {
      eligibleSymbols: eligibleSymbolsList,
      qualifiedSymbols: qualifiedSymbolsList,
      openPositionSymbols,
      dailyLimitReached,
    },
    selectionId,
  });

  await persistPairSelection(result);
  return result;
}

export async function getLatestPairSelection(): Promise<PairSelectionResult | null> {
  await ensurePairSelectionSchema();
  const result = await queryPostgres(
    'SELECT * FROM autonomous_pair_selections ORDER BY created_at DESC LIMIT 1',
  );
  const row = result.rows[0];
  if (!row) return null;
  const candidates = (Array.isArray(row.candidates_json) ? row.candidates_json as PairSelectionCandidate[] : []).map(
    (candidate) => ({
      ...candidate,
      eligibleForNewEntry: candidate.eligibleForNewEntry ?? candidate.tradable,
      blocked: candidate.blocked ?? false,
      blockReason: candidate.blockReason ?? null,
    }),
  );
  const selectedSymbols = Array.isArray(row.selected_symbols_json) ? row.selected_symbols_json.map(String) : [String(row.selected_symbol)];
  const metadata = parseSelectionMetadata(row.reasons_json);
  return {
    id: String(row.id),
    selectedSymbol: String(row.selected_symbol),
    selectedSymbols,
    eligibleSymbols: metadata.eligibleSymbols.length > 0
      ? metadata.eligibleSymbols
      : candidates.filter((candidate) => candidate.eligibleForNewEntry).map((candidate) => candidate.symbol),
    qualifiedSymbols: metadata.qualifiedSymbols.length > 0
      ? metadata.qualifiedSymbols
      : candidates.filter((candidate) => candidate.tradable && !candidate.blocked).map((candidate) => candidate.symbol),
    openPositionSymbols: metadata.openPositionSymbols,
    dailyLimitReached: metadata.dailyLimitReached,
    scanSummary: metadata.scanSummary ?? `Latest scan: ${selectedSymbols.join(', ')}`,
    candidates,
    session: String(row.session ?? 'closed') as TradingSession,
    selectedAt: String(row.created_at),
    source: String(row.source) as PairSelectionResult['source'],
  };
}

export async function persistPairSelection(result: PairSelectionResult) {
  await ensurePairSelectionSchema();
  const top = result.candidates.find((candidate) => candidate.symbol === result.selectedSymbol);
  await queryPostgres(
    `INSERT INTO autonomous_pair_selections (
      id, selected_symbol, selected_symbols_json, candidates_json, session, source, composite_score, reasons_json
    ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8::jsonb)`,
    [
      result.id,
      result.selectedSymbol,
      JSON.stringify(result.selectedSymbols),
      JSON.stringify(result.candidates),
      result.session,
      result.source,
      top?.compositeScore ?? null,
      JSON.stringify({
        topReasons: top?.reasons ?? [],
        scanSummary: result.scanSummary,
        eligibleSymbols: result.eligibleSymbols,
        qualifiedSymbols: result.qualifiedSymbols,
        openPositionSymbols: result.openPositionSymbols,
        dailyLimitReached: result.dailyLimitReached,
      }),
    ],
  );
}

function parseSelectionMetadata(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      scanSummary: null as string | null,
      eligibleSymbols: [] as string[],
      qualifiedSymbols: [] as string[],
      openPositionSymbols: [] as string[],
      dailyLimitReached: false,
    };
  }
  const meta = raw as Record<string, unknown>;
  return {
    scanSummary: meta.scanSummary ? String(meta.scanSummary) : null,
    eligibleSymbols: Array.isArray(meta.eligibleSymbols) ? meta.eligibleSymbols.map(String) : [],
    qualifiedSymbols: Array.isArray(meta.qualifiedSymbols) ? meta.qualifiedSymbols.map(String) : [],
    openPositionSymbols: Array.isArray(meta.openPositionSymbols) ? meta.openPositionSymbols.map(String) : [],
    dailyLimitReached: Boolean(meta.dailyLimitReached),
  };
}

async function fetchBestConnectedTerminal(): Promise<BridgeTerminal | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787'}/terminals`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const terminals = Array.isArray(payload.terminals) ? payload.terminals as BridgeTerminal[] : [];
    const connected = terminals.filter(
      (terminal) => terminal.status === 'connected' || (terminal as { connectionStatus?: string }).connectionStatus === 'connected',
    );
    return connected[0] ?? terminals[0] ?? null;
  } catch {
    return null;
  }
}

function buildTickSnapshots(watchlist: string[], terminal: BridgeTerminal | null, maxSpreadPoints: number): TickSnapshot[] {
  const now = new Date().toISOString();
  const telemetryRows = extractSymbolTelemetry(terminal);
  const telemetry = new Map(telemetryRows.map((row) => [row.symbol, row]));
  return watchlist.map((symbol) => {
    const row = telemetry.get(symbol);
    const available = row?.available ?? false;
    const tradable = row ? row.tradable && row.sessionOpen && !row.stale : false;
    const spreadPoints = Number.isFinite(Number(row?.spreadPoints))
      ? Number(row?.spreadPoints)
      : available
        ? maxSpreadPoints
        : maxSpreadPoints + 50;
    return {
      symbol,
      bid: row?.bid ?? 0,
      ask: row?.ask ?? 0,
      spreadPoints: tradable ? spreadPoints : maxSpreadPoints + 25,
      serverTime: now,
      receivedAt: row?.receivedAt ?? now,
    };
  });
}

async function loadPairMacroScores(symbols: string[]): Promise<Record<string, number>> {
  const scores: Record<string, number> = {};
  try {
    const rates = await queryPostgres(`
      SELECT DISTINCT ON (currency) currency, bias, rate_change, surprise
      FROM central_bank_rate_history
      ORDER BY currency, release_date DESC, fetched_at DESC
    `);
    const biasByCurrency = new Map<string, number>();
    for (const row of rates.rows) {
      biasByCurrency.set(String(row.currency), biasToScore(String(row.bias), row.rate_change, row.surprise));
    }

    const events = await queryPostgres(`
      SELECT currency, COUNT(*)::int AS high_impact_count
      FROM economic_events
      WHERE impact_level = 'High'
        AND utc_event_time >= now() - interval '30 minutes'
        AND utc_event_time <= now() + interval '30 minutes'
      GROUP BY currency
    `);
    const riskByCurrency = new Map<string, number>();
    for (const row of events.rows) {
      riskByCurrency.set(String(row.currency), Number(row.high_impact_count ?? 0));
    }

    for (const symbol of symbols) {
      const [base, quote] = parsePairCurrencies(symbol);
      const baseScore = currencyMacroScore(base, biasByCurrency, riskByCurrency);
      const quoteScore = currencyMacroScore(quote, biasByCurrency, riskByCurrency);
      scores[symbol] = clampScore(50 + (baseScore - quoteScore) * 0.35);
    }
  } catch {
    for (const symbol of symbols) scores[symbol] = 50;
  }
  return scores;
}

function currencyMacroScore(
  currency: string,
  biasByCurrency: Map<string, number>,
  riskByCurrency: Map<string, number>,
): number {
  if (currency === 'XAU') return 52;
  const bias = biasByCurrency.get(currency) ?? 50;
  const riskHits = riskByCurrency.get(currency) ?? 0;
  return clampScore(bias - riskHits * 12);
}

function biasToScore(bias: string | null, rateChange: unknown, surprise: unknown): number {
  const normalized = String(bias ?? '').toLowerCase();
  let score = 50;
  if (normalized.includes('hawk')) score += 15;
  if (normalized.includes('dove')) score -= 15;
  const change = Number(rateChange);
  if (Number.isFinite(change)) score += Math.max(-10, Math.min(10, change * 25));
  const surpriseValue = Number(surprise);
  if (Number.isFinite(surpriseValue)) score += Math.max(-6, Math.min(6, surpriseValue * 8));
  return clampScore(score);
}

