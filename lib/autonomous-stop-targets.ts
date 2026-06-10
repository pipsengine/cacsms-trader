import { resolveConnectedTerminalId } from '@/lib/autonomy-execution-adapter';
import { loadPropFirmRiskRulesFromEnv } from '@/lib/execution-risk-gate';
import { resolveLatestCaptureId } from '@/lib/capture-analysis-bootstrap';
import { telemetryForSymbol } from '@/lib/mt5-symbol-telemetry';
import { getSwingDetections } from '@/lib/swing-point-store';
import { getSupportResistanceAnalysis } from '@/lib/support-resistance-store';
import { queryPostgres } from '@/lib/postgres';
import type { ReconstructedCandle } from '@/lib/visual-intelligence-types';

export type AutonomousTradeSide = 'BUY' | 'SELL';

export type AutonomousStopTargetResult = {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  takeProfitLevels: number[];
  invalidationLevel: number;
  stopPips: number;
  rewardRiskRatio: number;
  method: 'structure' | 'swing' | 'atr' | 'pip_default';
};

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envBool(name: string, fallback = true): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

export function isStopLossRequired(): boolean {
  return envBool('CACSMS_REQUIRE_STOP_LOSS', true);
}

export function pipSizeForSymbol(symbol: string): number {
  const normalized = symbol.toUpperCase();
  if (normalized.includes('XAU') || normalized.includes('GOLD')) return 0.1;
  if (normalized.includes('JPY')) return 0.01;
  return 0.0001;
}

export function defaultStopPips(symbol: string, timeframe: string): number {
  const normalized = symbol.toUpperCase();
  const tf = timeframe.toUpperCase();
  if (normalized.includes('XAU')) {
    if (tf === 'M15') return envNumber('CACSMS_DEFAULT_STOP_PIPS_XAU_M15', 120);
    if (tf === 'H1') return envNumber('CACSMS_DEFAULT_STOP_PIPS_XAU_H1', 220);
    return envNumber('CACSMS_DEFAULT_STOP_PIPS_XAU', 180);
  }
  return envNumber('CACSMS_DEFAULT_STOP_PIPS_FX', 25);
}

function roundPrice(symbol: string, price: number): number {
  const normalized = symbol.toUpperCase();
  const digits = normalized.includes('XAU') || normalized.includes('GOLD')
    ? 2
    : normalized.includes('JPY')
      ? 3
      : 5;
  return Number(price.toFixed(digits));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeAtr(candles: ReconstructedCandle[], period = 14): number {
  const ranges = candles
    .map((candle) => Number(candle.highPrice) - Number(candle.lowPrice))
    .filter((value) => value > 0);
  if (!ranges.length) return 0;
  return average(ranges.slice(-period)) || average(ranges);
}

function stopPipsFromDistance(symbol: string, entryPrice: number, stopLoss: number): number {
  const distance = Math.abs(entryPrice - stopLoss);
  const normalized = symbol.toUpperCase();
  if (normalized.includes('XAU') || normalized.includes('GOLD')) {
    return Math.max(20, Math.round(distance * 10));
  }
  const pipSize = pipSizeForSymbol(symbol);
  return Math.max(8, Math.round(distance / pipSize));
}

async function loadRecentCandles(symbol: string, timeframe: string, limit = 60): Promise<ReconstructedCandle[]> {
  const captureId = await resolveLatestCaptureId(symbol, timeframe);
  if (!captureId) return [];
  const result = await queryPostgres(
    `
      SELECT open_price, high_price, low_price, close_price, candle_index
      FROM reconstructed_candles
      WHERE chart_capture_id = $1
      ORDER BY candle_index DESC
      LIMIT $2
    `,
    [captureId, limit],
  );
  return result.rows
    .map((row) => ({
      candleIndex: Number((row as { candle_index?: number }).candle_index ?? 0),
      openPrice: Number((row as { open_price?: number }).open_price ?? 0),
      highPrice: Number((row as { high_price?: number }).high_price ?? 0),
      lowPrice: Number((row as { low_price?: number }).low_price ?? 0),
      closePrice: Number((row as { close_price?: number }).close_price ?? 0),
      pixelX: 0,
      pixelYOpen: 0,
      pixelYHigh: 0,
      pixelYLow: 0,
      pixelYClose: 0,
      direction: 'neutral' as const,
      confidence: 1,
    }))
    .filter((candle) => candle.highPrice > 0 && candle.lowPrice > 0)
    .sort((a, b) => a.candleIndex - b.candleIndex);
}

async function resolveLiveEntryPrice(symbol: string, side: AutonomousTradeSide): Promise<number | null> {
  const terminalId = await resolveConnectedTerminalId();
  if (!terminalId) return null;
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787'}/terminals`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const terminals = Array.isArray(payload.terminals) ? payload.terminals : [];
    const terminal = terminals.find((row: { terminalId?: string }) => String(row?.terminalId ?? '') === terminalId);
    if (!terminal) return null;
    const row = telemetryForSymbol(terminal, symbol);
    if (!row) return null;
    const price = side === 'BUY' ? row.ask : row.bid;
    if (price > 0) return price;
    const mid = row.bid > 0 && row.ask > 0 ? (row.bid + row.ask) / 2 : 0;
    return mid > 0 ? mid : null;
  } catch {
    return null;
  }
}

function structureStopLevel(input: {
  side: AutonomousTradeSide;
  entryPrice: number;
  swings: Array<{ swingKind: string; priceLevel: number }>;
  supports: number[];
  resistances: number[];
  atr: number;
  pipSize: number;
  minStopDistance: number;
}): { stopLoss: number; method: AutonomousStopTargetResult['method'] } {
  const buffer = Math.max(input.pipSize * 2, input.atr * 0.15);
  if (input.side === 'BUY') {
    const swingLow = input.swings
      .filter((swing) => swing.swingKind === 'low' && swing.priceLevel < input.entryPrice)
      .sort((a, b) => b.priceLevel - a.priceLevel)[0]?.priceLevel;
    const support = input.supports
      .filter((level) => level < input.entryPrice)
      .sort((a, b) => b - a)[0];
    const anchor = swingLow ?? support ?? (input.entryPrice - Math.max(input.minStopDistance, input.atr * envNumber('CACSMS_ATR_STOP_MULTIPLIER', 1.2)));
    const stopLoss = anchor - buffer;
    return {
      stopLoss,
      method: swingLow ? 'swing' : support ? 'structure' : input.atr > 0 ? 'atr' : 'pip_default',
    };
  }

  const swingHigh = input.swings
    .filter((swing) => swing.swingKind === 'high' && swing.priceLevel > input.entryPrice)
    .sort((a, b) => a.priceLevel - b.priceLevel)[0]?.priceLevel;
  const resistance = input.resistances
    .filter((level) => level > input.entryPrice)
    .sort((a, b) => a - b)[0];
  const anchor = swingHigh ?? resistance ?? (input.entryPrice + Math.max(input.minStopDistance, input.atr * envNumber('CACSMS_ATR_STOP_MULTIPLIER', 1.2)));
  const stopLoss = anchor + buffer;
  return {
    stopLoss,
    method: swingHigh ? 'swing' : resistance ? 'structure' : input.atr > 0 ? 'atr' : 'pip_default',
  };
}

function validateStopTargets(input: {
  symbol: string;
  side: AutonomousTradeSide;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  minRewardRiskRatio: number;
  minStopDistance: number;
}): string | null {
  if (input.stopLoss <= 0) return 'Stop loss is required.';
  const stopDistance = Math.abs(input.entryPrice - input.stopLoss);
  if (stopDistance < input.minStopDistance) {
    return `Stop distance ${stopDistance.toFixed(5)} is below minimum ${input.minStopDistance.toFixed(5)}.`;
  }
  if (input.side === 'BUY') {
    if (input.stopLoss >= input.entryPrice) return 'Buy stop loss must be below entry.';
    if (input.takeProfit > 0 && input.takeProfit <= input.entryPrice) return 'Buy take profit must be above entry.';
  } else {
    if (input.stopLoss <= input.entryPrice) return 'Sell stop loss must be above entry.';
    if (input.takeProfit > 0 && input.takeProfit >= input.entryPrice) return 'Sell take profit must be below entry.';
  }
  if (input.takeProfit > 0 && stopDistance > 0) {
    const rewardDistance = Math.abs(input.takeProfit - input.entryPrice);
    const rr = rewardDistance / stopDistance;
    if (rr + 1e-9 < input.minRewardRiskRatio) {
      return `Reward/risk ${rr.toFixed(2)} is below minimum ${input.minRewardRiskRatio}.`;
    }
  }
  return null;
}

export async function resolveAutonomousStopTargets(input: {
  symbol: string;
  timeframe: string;
  side: AutonomousTradeSide;
  entryPrice?: number | null;
}): Promise<AutonomousStopTargetResult | null> {
  const symbol = input.symbol.toUpperCase();
  const timeframe = input.timeframe.toUpperCase();
  const rules = loadPropFirmRiskRulesFromEnv();
  const pipSize = pipSizeForSymbol(symbol);
  const minStopDistance = defaultStopPips(symbol, timeframe) * pipSize;

  const entryPrice = input.entryPrice && input.entryPrice > 0
    ? input.entryPrice
    : await resolveLiveEntryPrice(symbol, input.side);
  const candles = await loadRecentCandles(symbol, timeframe);
  const fallbackEntry = candles.length ? Number(candles[candles.length - 1].closePrice) : 0;
  const resolvedEntry = entryPrice && entryPrice > 0 ? entryPrice : fallbackEntry;
  if (!resolvedEntry || resolvedEntry <= 0) return null;

  const atr = computeAtr(candles) || minStopDistance;
  const captureId = await resolveLatestCaptureId(symbol, timeframe);
  const swings = captureId
    ? (await getSwingDetections(captureId).catch(() => [])).map((swing) => ({
      swingKind: swing.swingKind,
      priceLevel: swing.priceLevel,
    }))
    : [];
  let supports: number[] = [];
  let resistances: number[] = [];
  if (captureId) {
    try {
      const sr = await getSupportResistanceAnalysis(captureId);
      for (const zone of sr.zones ?? []) {
        if (zone.zoneType === 'support' || zone.midpointPrice <= resolvedEntry) supports.push(zone.midpointPrice);
        if (zone.zoneType === 'resistance' || zone.midpointPrice >= resolvedEntry) resistances.push(zone.midpointPrice);
      }
    } catch {
      // optional structure context
    }
  }

  let { stopLoss, method } = structureStopLevel({
    side: input.side,
    entryPrice: resolvedEntry,
    swings,
    supports,
    resistances,
    atr,
    pipSize,
    minStopDistance,
  });

  if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
    stopLoss = input.side === 'BUY'
      ? resolvedEntry - minStopDistance
      : resolvedEntry + minStopDistance;
    method = 'pip_default';
  }

  let stopDistance = Math.abs(resolvedEntry - stopLoss);
  if (stopDistance < minStopDistance) {
    stopLoss = input.side === 'BUY'
      ? resolvedEntry - minStopDistance
      : resolvedEntry + minStopDistance;
    stopDistance = minStopDistance;
    method = 'pip_default';
  }

  const takeProfit = input.side === 'BUY'
    ? resolvedEntry + stopDistance * rules.minRewardRiskRatio
    : resolvedEntry - stopDistance * rules.minRewardRiskRatio;

  const roundedEntry = roundPrice(symbol, resolvedEntry);
  let roundedStop = roundPrice(symbol, stopLoss);
  let roundedTp = roundPrice(symbol, takeProfit);
  let validationError = validateStopTargets({
    symbol,
    side: input.side,
    entryPrice: roundedEntry,
    stopLoss: roundedStop,
    takeProfit: roundedTp,
    minRewardRiskRatio: rules.minRewardRiskRatio,
    minStopDistance,
  });

  if (validationError) {
    const widenedDistance = minStopDistance * 1.25;
    roundedStop = roundPrice(
      symbol,
      input.side === 'BUY' ? roundedEntry - widenedDistance : roundedEntry + widenedDistance,
    );
    roundedTp = roundPrice(
      symbol,
      input.side === 'BUY'
        ? roundedEntry + widenedDistance * rules.minRewardRiskRatio
        : roundedEntry - widenedDistance * rules.minRewardRiskRatio,
    );
    validationError = validateStopTargets({
      symbol,
      side: input.side,
      entryPrice: roundedEntry,
      stopLoss: roundedStop,
      takeProfit: roundedTp,
      minRewardRiskRatio: rules.minRewardRiskRatio,
      minStopDistance,
    });
    if (validationError) return null;
    method = 'pip_default';
  }

  stopDistance = Math.abs(roundedEntry - roundedStop);

  const stopPips = stopPipsFromDistance(symbol, roundedEntry, roundedStop);
  const rewardDistance = Math.abs(roundedTp - roundedEntry);
  const rewardRiskRatio = stopDistance > 0 ? Number((rewardDistance / stopDistance).toFixed(4)) : rules.minRewardRiskRatio;

  return {
    entryPrice: roundedEntry,
    stopLoss: roundedStop,
    takeProfit: roundedTp,
    takeProfitLevels: [roundedTp],
    invalidationLevel: roundedStop,
    stopPips,
    rewardRiskRatio,
    method,
  };
}

export function hasValidStopTargets(input: {
  side: AutonomousTradeSide | string;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
}): boolean {
  const side = input.side === 'SELL' ? 'SELL' : 'BUY';
  const stopLoss = Number(input.stopLoss ?? 0);
  const takeProfit = Number(input.takeProfit ?? 0);
  const entryPrice = Number(input.entryPrice ?? 0);
  if (stopLoss <= 0) return false;
  if (entryPrice > 0) {
    if (side === 'BUY' && stopLoss >= entryPrice) return false;
    if (side === 'SELL' && stopLoss <= entryPrice) return false;
    if (takeProfit > 0) {
      if (side === 'BUY' && takeProfit <= entryPrice) return false;
      if (side === 'SELL' && takeProfit >= entryPrice) return false;
    }
  }
  return true;
}
