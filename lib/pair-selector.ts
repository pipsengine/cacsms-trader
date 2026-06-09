import { randomUUID } from 'crypto';

import { MarketIntelligenceEngine } from '@/services/market-intelligence-engine';
import type { TickSnapshot, TradingSession } from '@/packages/shared-types';
import { SYSTEM_FOCUS_SYMBOLS, SYSTEM_FOCUS_SYMBOL_COUNT } from './focus-symbols';
import { extractSymbolTelemetry, symbolTelemetryMap } from './mt5-symbol-telemetry';
import { queryPostgres } from './postgres';

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
  session: TradingSession;
  reasons: string[];
  rank: number;
}

export interface PairSelectionResult {
  id: string;
  selectedSymbol: string;
  selectedSymbols: string[];
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

export async function runAutonomousPairSelection(
  config: Partial<PairSelectionConfig> = {},
): Promise<PairSelectionResult> {
  await ensurePairSelectionSchema();
  const resolved = { ...DEFAULT_PAIR_SELECTION_CONFIG, ...config };
  const watchlist = resolved.watchlistSymbols.map((symbol) => symbol.toUpperCase());
  const terminal = await fetchBestConnectedTerminal();
  const ticks = buildTickSnapshots(watchlist, terminal, resolved.maxSpreadPoints);
  const macroScores = await loadPairMacroScores(watchlist);
  const now = new Date();
  const session = engine.detectSession(now);

  const eligibleSymbols = engine.selectPairs({ symbols: watchlist, ticks, candlesBySymbol: {}, now });
  const marketScans = engine.scan({ symbols: eligibleSymbols.length > 0 ? eligibleSymbols : watchlist, ticks, candlesBySymbol: {}, now });
  const telemetry = symbolTelemetryMap(terminal);

  const candidates: PairSelectionCandidate[] = marketScans
    .map((scan) => {
      const tick = ticks.find((item) => item.symbol === scan.symbol);
      const telemetryRow = telemetry.get(scan.symbol);
      const spreadOk = tick ? tick.spreadPoints <= resolved.maxSpreadPoints : false;
      const available = Boolean(telemetryRow?.available);
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
      const tradable = scan.tradable && tradableTelemetry;
      const reasons = [
        ...scan.reasons,
        telemetryRow
          ? `${telemetryRow.brokerSymbol} spread ${telemetryRow.spreadPoints ?? 'n/a'} pts, tick age ${telemetryRow.tickAgeSeconds}s`
          : 'No live terminal telemetry',
        telemetryRow?.stale ? 'Stale tick feed' : 'Tick feed fresh',
        `Macro alignment ${macroScore}`,
        tradable ? 'Eligible for autonomous pipeline' : 'Filtered by spread, liquidity, session, or macro risk',
      ];
      return {
        symbol: scan.symbol,
        marketScore: scan.setupScore,
        setupScore: scan.setupScore,
        liquidityScore: scan.liquidityScore,
        macroScore,
        compositeScore,
        tradable,
        session: scan.session,
        reasons,
        rank: 0,
      };
    })
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  const fullUniverse = resolved.maxSelectedSymbols >= watchlist.length;
  const rankedTradable = candidates.filter((candidate) => candidate.tradable).slice(0, Math.max(1, resolved.maxSelectedSymbols));
  const fallback = watchlist[0] ?? 'XAUUSD';
  const selectedSymbols = fullUniverse
    ? watchlist
    : rankedTradable.length > 0
      ? rankedTradable.map((item) => item.symbol)
      : [fallback];
  const selectedSymbol = candidates.find((item) => item.tradable)?.symbol ?? selectedSymbols[0] ?? fallback;

  const result: PairSelectionResult = {
    id: randomUUID(),
    selectedSymbol,
    selectedSymbols,
    candidates,
    session,
    selectedAt: now.toISOString(),
    source: fullUniverse || rankedTradable.length > 0 ? 'autonomous_scan' : 'config_fallback',
  };

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
  const candidates = Array.isArray(row.candidates_json) ? row.candidates_json as PairSelectionCandidate[] : [];
  return {
    id: String(row.id),
    selectedSymbol: String(row.selected_symbol),
    selectedSymbols: Array.isArray(row.selected_symbols_json) ? row.selected_symbols_json.map(String) : [String(row.selected_symbol)],
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
      JSON.stringify(top?.reasons ?? []),
    ],
  );
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

function parsePairCurrencies(symbol: string): [string, string] {
  const normalized = symbol.toUpperCase();
  if (normalized.startsWith('XAU')) return ['XAU', normalized.slice(3)];
  if (normalized.startsWith('BTC')) return ['BTC', normalized.slice(3)];
  if (['US30', 'NASDAQ100', 'SP500', 'NAS100', 'SPX500'].includes(normalized)) return [normalized, 'USD'];
  if (normalized.length >= 6) return [normalized.slice(0, 3), normalized.slice(3)];
  return [normalized.slice(0, 3), normalized.slice(3)];
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

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
