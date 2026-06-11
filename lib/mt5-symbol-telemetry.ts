import { SYSTEM_FOCUS_SYMBOLS, type SystemFocusSymbol } from './focus-symbols';

export interface Mt5SymbolTelemetrySnapshot {
  symbol: string;
  brokerSymbol: string;
  available: boolean;
  tradable: boolean;
  sessionOpen: boolean;
  bid: number;
  ask: number;
  spreadPoints: number | null;
  digits: number;
  point: number;
  tickAgeSeconds: number;
  volume: number;
  sector: string;
  stale: boolean;
  lastError: number;
  receivedAt?: string;
}

export interface Mt5TelemetrySummary {
  tracked: number;
  available: number;
  tradable: number;
  sessionOpen: number;
  stale: number;
  avgSpreadPoints: number | null;
  version?: number;
}

export const MT5_SYMBOL_ALIAS_CANDIDATES: Record<SystemFocusSymbol, string[]> = {
  EURUSD: ['EURUSD', 'EURUSDm'],
  GBPUSD: ['GBPUSD', 'GBPUSDm'],
  EURGBP: ['EURGBP', 'EURGBPm'],
  EURJPY: ['EURJPY', 'EURJPYm'],
  GBPJPY: ['GBPJPY', 'GBPJPYm'],
  USDJPY: ['USDJPY', 'USDJPYm'],
  USDCAD: ['USDCAD', 'USDCADm'],
  USDCHF: ['USDCHF', 'USDCHFm'],
  AUDUSD: ['AUDUSD', 'AUDUSDm'],
  NZDUSD: ['NZDUSD', 'NZDUSDm'],
  AUDJPY: ['AUDJPY', 'AUDJPYm'],
  EURAUD: ['EURAUD', 'EURAUDm'],
  EURCAD: ['EURCAD', 'EURCADm'],
  EURCHF: ['EURCHF', 'EURCHFm'],
  EURNZD: ['EURNZD', 'EURNZDm'],
  GBPAUD: ['GBPAUD', 'GBPAUDm'],
  GBPCAD: ['GBPCAD', 'GBPCADm'],
  AUDNZD: ['AUDNZD', 'AUDNZDm'],
  CADJPY: ['CADJPY', 'CADJPYm'],
  CHFJPY: ['CHFJPY', 'CHFJPYm'],
  NZDJPY: ['NZDJPY', 'NZDJPYm'],
  XAUUSD: ['XAUUSD', 'XAUUSDm', 'GOLD'],
  XAGUSD: ['XAGUSD', 'XAGUSDm', 'SILVER'],
  BTCUSD: ['BTCUSD', 'BTCUSDm'],
  US30: ['US30', 'DJ30', 'US30Cash', 'DowJones30'],
  UK100: ['UK100', 'FTSE100', 'UK100Cash'],
  NASDAQ100: ['NASDAQ100', 'NAS100', 'USTEC', 'US100'],
  SP500: ['SP500', 'SPX500', 'US500', 'SP500m'],
};

const STALE_TICK_AGE_SECONDS = 120;

type TerminalLike = {
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

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTelemetryRow(row: Record<string, unknown>): Mt5SymbolTelemetrySnapshot | null {
  const symbol = String(row.symbol ?? '').toUpperCase().trim();
  if (!symbol) return null;
  const tickAgeSeconds = numberOrNull(row.tickAgeSeconds) ?? -1;
  const spreadPoints = numberOrNull(row.spreadPoints);
  const bid = numberOrNull(row.bid) ?? 0;
  const ask = numberOrNull(row.ask) ?? 0;
  const available = Boolean(row.available);
  const tradable = Boolean(row.tradable);
  const sessionOpen = Boolean(row.sessionOpen);
  const stale = tickAgeSeconds < 0 ? !available : tickAgeSeconds > STALE_TICK_AGE_SECONDS;
  return {
    symbol,
    brokerSymbol: String(row.brokerSymbol ?? symbol),
    available,
    tradable,
    sessionOpen,
    bid,
    ask,
    spreadPoints,
    digits: numberOrNull(row.digits) ?? 0,
    point: numberOrNull(row.point) ?? 0,
    tickAgeSeconds,
    volume: numberOrNull(row.volume) ?? 0,
    sector: String(row.sector ?? classifySector(symbol)),
    stale,
    lastError: numberOrNull(row.lastError) ?? 0,
    receivedAt: typeof row.receivedAt === 'string' ? row.receivedAt : undefined,
  };
}

export function classifySector(symbol: string): string {
  const normalized = symbol.toUpperCase();
  if (normalized.startsWith('XAU')) return 'metals';
  if (normalized.startsWith('BTC')) return 'crypto';
  if (['US30', 'NASDAQ100', 'NAS100', 'SP500', 'SPX500', 'US500', 'UK100', 'FTSE100'].includes(normalized)) return 'indices';
  if (normalized.startsWith('XAG')) return 'metals';
  return 'forex';
}

export function extractSymbolTelemetry(terminal: TerminalLike | null | undefined): Mt5SymbolTelemetrySnapshot[] {
  if (!terminal) return [];
  const raw = terminal.symbolTelemetry;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .map((row) => (row && typeof row === 'object' ? normalizeTelemetryRow(row as Record<string, unknown>) : null))
      .filter((row): row is Mt5SymbolTelemetrySnapshot => row !== null);
  }
  return legacyTelemetryRows(terminal);
}

export function extractTelemetrySummary(terminal: TerminalLike | null | undefined): Mt5TelemetrySummary | null {
  if (!terminal?.telemetrySummary || typeof terminal.telemetrySummary !== 'object') return null;
  const summary = terminal.telemetrySummary as Record<string, unknown>;
  return {
    tracked: Number(summary.tracked ?? 0),
    available: Number(summary.available ?? 0),
    tradable: Number(summary.tradable ?? 0),
    sessionOpen: Number(summary.sessionOpen ?? 0),
    stale: Number(summary.stale ?? 0),
    avgSpreadPoints: numberOrNull(summary.avgSpreadPoints),
    version: numberOrNull(summary.version) ?? undefined,
  };
}

function legacyTelemetryRows(terminal: TerminalLike): Mt5SymbolTelemetrySnapshot[] {
  const legacy: Array<{ symbol: string; available: boolean | null | undefined; spread: number | null | undefined }> = [
    { symbol: 'EURUSD', available: terminal.eurusdAvailable, spread: terminal.eurusdSpreadPoints },
    { symbol: 'XAUUSD', available: terminal.xauusdAvailable, spread: terminal.xauusdSpreadPoints },
    { symbol: 'GBPUSD', available: terminal.gbpusdAvailable, spread: terminal.gbpusdSpreadPoints },
    { symbol: 'USDJPY', available: terminal.usdjpyAvailable, spread: terminal.usdjpySpreadPoints },
  ];
  return legacy
    .filter((item) => item.available != null || item.spread != null)
    .map((item) => ({
      symbol: item.symbol,
      brokerSymbol: item.symbol,
      available: Boolean(item.available),
      tradable: Boolean(item.available),
      sessionOpen: Boolean(item.available),
      bid: 0,
      ask: 0,
      spreadPoints: numberOrNull(item.spread),
      digits: 0,
      point: 0,
      tickAgeSeconds: -1,
      volume: 0,
      sector: classifySector(item.symbol),
      stale: false,
      lastError: 0,
    }));
}

export function symbolTelemetryMap(terminal: TerminalLike | null | undefined): Map<string, Mt5SymbolTelemetrySnapshot> {
  const map = new Map<string, Mt5SymbolTelemetrySnapshot>();
  for (const row of extractSymbolTelemetry(terminal)) {
    map.set(row.symbol, row);
  }
  return map;
}

export function telemetryForSymbol(
  terminal: TerminalLike | null | undefined,
  symbol: string,
): Mt5SymbolTelemetrySnapshot | null {
  return symbolTelemetryMap(terminal).get(symbol.toUpperCase()) ?? null;
}

export function isSymbolTradableTelemetry(
  snapshot: Mt5SymbolTelemetrySnapshot | null,
  maxSpreadPoints: number,
): boolean {
  if (!snapshot) return false;
  if (!snapshot.available || !snapshot.tradable || !snapshot.sessionOpen) return false;
  if (snapshot.stale) return false;
  if (snapshot.spreadPoints == null) return false;
  return snapshot.spreadPoints <= maxSpreadPoints;
}

export function rankedTradableSymbols(
  terminal: TerminalLike | null | undefined,
  watchlist: string[] = [...SYSTEM_FOCUS_SYMBOLS],
  maxSpreadPoints = 35,
): Mt5SymbolTelemetrySnapshot[] {
  const map = symbolTelemetryMap(terminal);
  return watchlist
    .map((symbol) => map.get(symbol.toUpperCase()) ?? null)
    .filter((snapshot): snapshot is Mt5SymbolTelemetrySnapshot => isSymbolTradableTelemetry(snapshot, maxSpreadPoints))
    .sort((left, right) => (left.spreadPoints ?? 999) - (right.spreadPoints ?? 999));
}
