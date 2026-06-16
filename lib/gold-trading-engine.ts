/**
 * XAU/USD Gold-only autonomous trading engine configuration.
 * When enabled, the system trades exclusively Gold with institutional multi-position rules.
 */
export const GOLD_SYMBOL = 'XAUUSD' as const;

export type GoldSymbol = typeof GOLD_SYMBOL;

const GOLD_ALIASES = ['XAUUSD', 'XAUUSDm', 'GOLD', 'XAU/USD'] as const;

function envBool(name: string, fallback = true): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Gold-only engine is the default operating mode. Set CACSMS_GOLD_ONLY_TRADING=false to restore multi-symbol. */
export function isGoldOnlyTradingEngine(): boolean {
  return envBool('CACSMS_GOLD_ONLY_TRADING', true);
}

export function normalizeGoldSymbol(symbol: string): GoldSymbol | null {
  const upper = String(symbol ?? '').trim().toUpperCase();
  if (upper === GOLD_SYMBOL || upper === 'GOLD' || upper.startsWith('XAUUSD')) return GOLD_SYMBOL;
  return null;
}

export function isGoldSymbol(symbol: string): boolean {
  return normalizeGoldSymbol(symbol) != null;
}

/** Active autonomous trading universe — Gold only when gold engine is enabled. */
export function getActiveTradingSymbols(): readonly string[] {
  if (isGoldOnlyTradingEngine()) return [GOLD_SYMBOL];
  return null as unknown as readonly string[];
}

export function filterToActiveTradingSymbols(symbols: string[]): string[] {
  if (!isGoldOnlyTradingEngine()) return symbols.map((s) => s.toUpperCase());
  return symbols.map((s) => normalizeGoldSymbol(s)).filter((s): s is GoldSymbol => s != null);
}

export function goldBrokerAliases(): string[] {
  return [...GOLD_ALIASES];
}

/**
 * Serial Gold trading: complete or close the current trade before opening another.
 * Default on when max concurrent positions is 1.
 */
export function goldSerialTradingEnabled(): boolean {
  if (!isGoldOnlyTradingEngine()) return false;
  const raw = String(process.env.CACSMS_GOLD_SERIAL_TRADING ?? '').trim();
  if (raw) return envBool('CACSMS_GOLD_SERIAL_TRADING', true);
  return goldMaxConcurrentPositions() <= 1;
}

/** Max concurrent XAUUSD positions (1 = serial, no stacking). */
export function goldMaxConcurrentPositions(): number {
  return Math.max(1, Math.min(8, Math.round(envNumber('CACSMS_GOLD_MAX_CONCURRENT_POSITIONS', 1))));
}

/** Max new Gold entries per maintenance cycle. */
export function goldMaxEntriesPerCycle(): number {
  const serialDefault = goldSerialTradingEnabled() ? 1 : 5;
  return Math.max(
    1,
    Math.min(8, Math.round(envNumber('CACSMS_GOLD_MAX_ENTRIES_PER_CYCLE', envNumber('CACSMS_MAX_ENTRIES_PER_CYCLE', serialDefault)))),
  );
}

/** Minimum confidence to open an additional stacked Gold position. */
export function goldStackMinConfidence(): number {
  return Math.max(50, Math.round(envNumber('CACSMS_GOLD_STACK_MIN_CONFIDENCE', 68)));
}

/** Minimum setup readiness to stack on an existing Gold opportunity. */
export function goldStackMinReadiness(): number {
  return Math.max(45, Math.round(envNumber('CACSMS_GOLD_STACK_MIN_READINESS', 62)));
}

/** Max spread (points) allowed for Gold entries. */
export function goldMaxSpreadPoints(): number {
  return Math.max(20, Math.round(envNumber('CACSMS_GOLD_MAX_SPREAD_POINTS', envNumber('CACSMS_PAIR_SELECTION_MAX_SPREAD_POINTS', 120))));
}

/** Max tick age (seconds) before Gold entry is rejected as stale. */
export function goldMaxTickAgeSeconds(): number {
  return Math.max(15, Math.round(envNumber('CACSMS_GOLD_MAX_TICK_AGE_SECONDS', 90)));
}

/** Min reward:risk for Gold entries. */
export function goldMinRewardRisk(): number {
  return Math.max(1.2, envNumber('CACSMS_GOLD_MIN_REWARD_RISK', 2));
}

/** Max trades per calendar day on Gold. */
export function goldMaxTradesPerDay(): number {
  return Math.max(1, Math.min(50, Math.round(envNumber('CACSMS_GOLD_MAX_TRADES_PER_DAY', 25))));
}

/** Cooldown minutes before re-entry on Gold after a close (unless retracement confirms). */
export function goldReentryCooldownMinutes(): number {
  return Math.max(1, Math.round(envNumber('CACSMS_GOLD_REENTRY_COOLDOWN_MINUTES', envNumber('CACSMS_CONTINUOUS_DISPATCH_COOLDOWN_MINUTES', 3))));
}

/** Sessions ranked for Gold liquidity (higher = better). */
export const GOLD_SESSION_PRIORITY: Record<string, number> = {
  overlap: 100,
  london: 90,
  new_york: 88,
  asian: 72,
  closed: 40,
};

export function goldSessionPriority(session: string): number {
  return GOLD_SESSION_PRIORITY[String(session ?? '').toLowerCase()] ?? 50;
}

/** Preferred trading styles for Gold (institutional intraday through swing). */
export function goldPreferredStyles(): string[] {
  const raw = String(process.env.CACSMS_GOLD_ENABLED_STYLES ?? 'scalp,intraday,day_trade,swing').trim();
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export interface GoldEngineStatus {
  enabled: boolean;
  symbol: GoldSymbol;
  serialTrading: boolean;
  maxConcurrentPositions: number;
  maxEntriesPerCycle: number;
  maxSpreadPoints: number;
  maxTradesPerDay: number;
  preferredStyles: string[];
  sessions24h: boolean;
}

export function getGoldEngineStatus(): GoldEngineStatus {
  return {
    enabled: isGoldOnlyTradingEngine(),
    symbol: GOLD_SYMBOL,
    serialTrading: goldSerialTradingEnabled(),
    maxConcurrentPositions: goldMaxConcurrentPositions(),
    maxEntriesPerCycle: goldMaxEntriesPerCycle(),
    maxSpreadPoints: goldMaxSpreadPoints(),
    maxTradesPerDay: goldMaxTradesPerDay(),
    preferredStyles: goldPreferredStyles(),
    sessions24h: envBool('CACSMS_24H_TRADING_ENABLED', true),
  };
}
