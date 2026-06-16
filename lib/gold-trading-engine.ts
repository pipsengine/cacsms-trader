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

/** When Gold-only mode is active, all pipeline/top-down work is restricted to XAUUSD. */
export function enforceGoldPipelineSymbol(symbol: string): GoldSymbol {
  if (isGoldOnlyTradingEngine()) return GOLD_SYMBOL;
  return normalizeGoldSymbol(symbol) ?? GOLD_SYMBOL;
}

export function goldBrokerAliases(): string[] {
  return [...GOLD_ALIASES];
}

/** Serial Gold trading: one trade at a time. Default off — intelligent scaling enabled. */
export function goldSerialTradingEnabled(): boolean {
  if (!isGoldOnlyTradingEngine()) return false;
  const raw = String(process.env.CACSMS_GOLD_SERIAL_TRADING ?? '').trim();
  if (raw) return envBool('CACSMS_GOLD_SERIAL_TRADING', false);
  return goldMaxConcurrentPositions() <= 1;
}

/** Intelligent multi-position scaling on high-probability Gold setups. */
export function goldIntelligentScalingEnabled(): boolean {
  return isGoldOnlyTradingEngine() && !goldSerialTradingEnabled();
}

/** Max concurrent XAUUSD positions (scaling cap). */
export function goldMaxConcurrentPositions(): number {
  return Math.max(goldMinEntryLegCount(), Math.min(10, Math.round(envNumber('CACSMS_GOLD_MAX_CONCURRENT_POSITIONS', 10))));
}

/** Minimum basket legs per Gold signal. */
export function goldMinEntryLegCount(): number {
  return Math.max(1, Math.min(10, Math.round(envNumber('CACSMS_GOLD_MIN_ENTRY_LEGS', 5))));
}

/** Maximum basket legs when conditions are strong. */
export function goldMaxEntryLegCount(): number {
  return Math.max(
    goldMinEntryLegCount(),
    Math.min(goldMaxConcurrentPositions(), Math.round(envNumber('CACSMS_GOLD_MAX_ENTRY_LEGS', 10))),
  );
}

/** Resolve leg count (5–10) from institutional quality / confidence. */
export function resolveGoldEntryLegCount(input?: { qualityScore?: number; confidenceScore?: number }): number {
  const min = goldMinEntryLegCount();
  const max = goldMaxEntryLegCount();
  const score = Math.max(input?.qualityScore ?? 0, input?.confidenceScore ?? 0);
  if (score >= 88) return max;
  if (score >= 80) return Math.min(max, Math.max(min, max - 1));
  if (score >= 72) return Math.min(max, Math.max(min, Math.ceil((min + max) / 2)));
  return min;
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

/** Min reward:risk for Gold entries — hard floor 1:2. */
export function goldMinRewardRisk(): number {
  return Math.max(2, envNumber('CACSMS_GOLD_MIN_REWARD_RISK', 2));
}

/** Default target R:R for standard Gold setups (1:3). */
export function goldTargetRewardRisk(): number {
  return Math.max(goldMinRewardRisk(), envNumber('CACSMS_GOLD_TARGET_REWARD_RISK', 3));
}

/** Target R:R for elevated / institutional Gold setups (1:4 default). */
export function goldInstitutionalTargetRewardRisk(): number {
  return Math.max(goldTargetRewardRisk(), envNumber('CACSMS_GOLD_INSTITUTIONAL_TARGET_REWARD_RISK', 4));
}

/** Maximum extended runner target R:R (1:6 cap by default). */
export function goldMaxTargetRewardRisk(): number {
  return Math.max(goldInstitutionalTargetRewardRisk(), envNumber('CACSMS_GOLD_MAX_TARGET_REWARD_RISK', 6));
}

/** Minimum institutional quality score (0–100) required to execute Gold trades. */
export function goldMinInstitutionalQuality(): number {
  return Math.max(50, Math.round(envNumber('CACSMS_GOLD_MIN_INSTITUTIONAL_QUALITY', 62)));
}

/** Max scale-in legs per setup type before requiring fresh confirmation. */
export function goldMaxSetupExposure(): number {
  return Math.max(1, Math.min(goldMaxConcurrentPositions(), Math.round(envNumber('CACSMS_GOLD_MAX_SETUP_EXPOSURE', 5))));
}

/** Parallel market legs opened together on each new Gold entry signal. */
export function goldEntryLegCount(input?: { qualityScore?: number; confidenceScore?: number }): number {
  if (input) return resolveGoldEntryLegCount(input);
  const configured = Math.round(envNumber('CACSMS_GOLD_ENTRY_LEGS', goldMinEntryLegCount()));
  return Math.max(goldMinEntryLegCount(), Math.min(goldMaxEntryLegCount(), configured));
}

/** When true, each signal dispatches `goldEntryLegCount()` market legs in one batch. */
export function goldBatchEntryEnabled(): boolean {
  if (!isGoldOnlyTradingEngine() || goldSerialTradingEnabled()) return false;
  const raw = String(process.env.CACSMS_GOLD_BATCH_ENTRY ?? '').trim().toLowerCase();
  if (raw) return raw === 'true' || raw === '1' || raw === 'yes';
  return goldEntryLegCount() > 1;
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
  intelligentScaling: boolean;
  batchEntryEnabled: boolean;
  basketManagementEnabled: boolean;
  minEntryLegCount: number;
  maxEntryLegCount: number;
  entryLegCount: number;
  minInstitutionalQuality: number;
  maxSetupExposure: number;
  maxConcurrentPositions: number;
  maxEntriesPerCycle: number;
  maxSpreadPoints: number;
  maxTradesPerDay: number;
  minRewardRisk: number;
  targetRewardRisk: number;
  institutionalTargetRewardRisk: number;
  maxTargetRewardRisk: number;
  topDownCaptureTimeframes: readonly string[];
  preferredStyles: string[];
  sessions24h: boolean;
}

import { GOLD_TOP_DOWN_CAPTURE_SEQUENCE } from '@/lib/gold-top-down-timeframes';

export function getGoldEngineStatus(): GoldEngineStatus {
  return {
    enabled: isGoldOnlyTradingEngine(),
    symbol: GOLD_SYMBOL,
    serialTrading: goldSerialTradingEnabled(),
    intelligentScaling: goldIntelligentScalingEnabled(),
    batchEntryEnabled: goldBatchEntryEnabled(),
    basketManagementEnabled: isGoldOnlyTradingEngine() && goldBatchEntryEnabled(),
    minEntryLegCount: goldMinEntryLegCount(),
    maxEntryLegCount: goldMaxEntryLegCount(),
    entryLegCount: goldEntryLegCount(),
    minInstitutionalQuality: goldMinInstitutionalQuality(),
    maxSetupExposure: goldMaxSetupExposure(),
    maxConcurrentPositions: goldMaxConcurrentPositions(),
    maxEntriesPerCycle: goldMaxEntriesPerCycle(),
    maxSpreadPoints: goldMaxSpreadPoints(),
    maxTradesPerDay: goldMaxTradesPerDay(),
    minRewardRisk: goldMinRewardRisk(),
    targetRewardRisk: goldTargetRewardRisk(),
    institutionalTargetRewardRisk: goldInstitutionalTargetRewardRisk(),
    maxTargetRewardRisk: goldMaxTargetRewardRisk(),
    topDownCaptureTimeframes: GOLD_TOP_DOWN_CAPTURE_SEQUENCE,
    preferredStyles: goldPreferredStyles(),
    sessions24h: envBool('CACSMS_24H_TRADING_ENABLED', true),
  };
}
