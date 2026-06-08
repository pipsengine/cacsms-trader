import { randomUUID } from 'crypto';

import { MarketIntelligenceEngine } from '@/services/market-intelligence-engine';
import type { TickSnapshot, TradingSession } from '@/packages/shared-types';
import { queryPostgres } from './postgres';

export const DEFAULT_WATCHLIST = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY'] as const;

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
  maxSelectedSymbols: 1,
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

  const candidates: PairSelectionCandidate[] = marketScans
    .map((scan) => {
      const tick = ticks.find((item) => item.symbol === scan.symbol);
      const spreadOk = tick ? tick.spreadPoints <= resolved.maxSpreadPoints : false;
      const available = Boolean(tick);
      const macroScore = macroScores[scan.symbol] ?? 50;
      const macroPenalty = macroScore < 35 ? -15 : macroScore > 65 ? 8 : 0;
      const compositeScore = clampScore(
        scan.setupScore * 0.45
        + scan.liquidityScore * 0.3
        + macroScore * 0.15
        + (session === 'closed' ? 0 : 10)
        + macroPenalty,
      );
      const tradable = scan.tradable && spreadOk && available;
      const reasons = [
        ...scan.reasons,
        available ? `Spread ${tick?.spreadPoints ?? 'n/a'} pts` : 'No live terminal telemetry',
        `Macro alignment ${macroScore}`,
        tradable ? 'Eligible for autonomous pipeline' : 'Filtered by spread, liquidity, or macro risk',
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

  const selected = candidates.filter((candidate) => candidate.tradable).slice(0, Math.max(1, resolved.maxSelectedSymbols));
  const fallback = watchlist[0] ?? 'XAUUSD';
  const selectedSymbols = selected.length > 0 ? selected.map((item) => item.symbol) : [fallback];
  const selectedSymbol = selectedSymbols[0] ?? fallback;

  const result: PairSelectionResult = {
    id: randomUUID(),
    selectedSymbol,
    selectedSymbols,
    candidates,
    session,
    selectedAt: now.toISOString(),
    source: selected.length > 0 ? 'autonomous_scan' : 'config_fallback',
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
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      result.id,
      result.selectedSymbol,
      result.selectedSymbols,
      JSON.parse(JSON.stringify(result.candidates)),
      result.session,
      result.source,
      top?.compositeScore ?? null,
      top?.reasons ?? [],
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
    return terminals.find((terminal) => terminal.status === 'connected') ?? terminals[0] ?? null;
  } catch {
    return null;
  }
}

function buildTickSnapshots(watchlist: string[], terminal: BridgeTerminal | null, maxSpreadPoints: number): TickSnapshot[] {
  const now = new Date().toISOString();
  const telemetry: Record<string, { available: boolean | null; spreadPoints: number | null }> = {
    EURUSD: { available: terminal?.eurusdAvailable ?? null, spreadPoints: terminal?.eurusdSpreadPoints ?? null },
    XAUUSD: { available: terminal?.xauusdAvailable ?? null, spreadPoints: terminal?.xauusdSpreadPoints ?? null },
    GBPUSD: { available: terminal?.gbpusdAvailable ?? null, spreadPoints: terminal?.gbpusdSpreadPoints ?? null },
    USDJPY: { available: terminal?.usdjpyAvailable ?? null, spreadPoints: terminal?.usdjpySpreadPoints ?? null },
  };

  return watchlist.map((symbol) => {
    const item = telemetry[symbol];
    const available = item?.available !== false;
    const spreadPoints = Number.isFinite(Number(item?.spreadPoints))
      ? Number(item?.spreadPoints)
      : available
        ? maxSpreadPoints
        : maxSpreadPoints + 50;
    return {
      symbol,
      bid: 0,
      ask: 0,
      spreadPoints,
      serverTime: now,
      receivedAt: now,
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
