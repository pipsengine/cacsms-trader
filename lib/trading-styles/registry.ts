import type { TradingStyleId, TradingStyleProfile } from './types';

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const TRADING_STYLE_PROFILES: Record<TradingStyleId, TradingStyleProfile> = {
  scalp: {
    id: 'scalp',
    label: 'Scalping',
    category: 'ultra_short',
    description: 'Ultra-short liquidity sweeps and micro-structure momentum on M5 with H1 institutional bias.',
    entryTimeframe: 'M5',
    dominantTimeframe: 'M5',
    biasTimeframes: ['M15', 'H1'],
    maxHoldHours: 1,
    minRewardRisk: 1.2,
    riskPerTradePercent: envNumber('CACSMS_SCALP_RISK_PERCENT', 0.2),
    maxSpreadPoints: envNumber('CACSMS_SCALP_MAX_SPREAD', 22),
    scanPriority: 5,
    maxEntriesPerCycle: envNumber('CACSMS_SCALP_MAX_ENTRIES', 2),
    confidenceFloor: envNumber('CACSMS_SCALP_CONFIDENCE_FLOOR', 32),
    readinessFloor: envNumber('CACSMS_SCALP_READINESS_FLOOR', 28),
    stopAtrMultiplier: 0.8,
    algorithms: ['liquidity_sweep', 'micro_structure', 'ema_momentum', 'order_block_retest'],
  },
  intraday: {
    id: 'intraday',
    label: 'Intraday',
    category: 'short',
    description: 'Short-horizon structure trades on M15 with H1/H4 alignment and session liquidity.',
    entryTimeframe: 'M15',
    dominantTimeframe: 'M15',
    biasTimeframes: ['H1', 'H4'],
    maxHoldHours: 4,
    minRewardRisk: 1.5,
    riskPerTradePercent: envNumber('CACSMS_INTRADAY_RISK_PERCENT', 0.35),
    maxSpreadPoints: envNumber('CACSMS_INTRADAY_MAX_SPREAD', 35),
    scanPriority: 4,
    maxEntriesPerCycle: envNumber('CACSMS_INTRADAY_MAX_ENTRIES', 2),
    confidenceFloor: envNumber('CACSMS_INTRADAY_CONFIDENCE_FLOOR', 35),
    readinessFloor: envNumber('CACSMS_INTRADAY_READINESS_FLOOR', 30),
    stopAtrMultiplier: 1.1,
    algorithms: ['mtf_confluence', 'structure_break', 'liquidity_void_fill', 'session_momentum'],
  },
  day_trade: {
    id: 'day_trade',
    label: 'Day Trading',
    category: 'session',
    description: 'Session-bound trades opened and closed within the same major session using M15/H1 fusion.',
    entryTimeframe: 'M15',
    dominantTimeframe: 'H1',
    biasTimeframes: ['H1', 'H4', 'D'],
    maxHoldHours: 10,
    minRewardRisk: 1.8,
    riskPerTradePercent: envNumber('CACSMS_DAY_TRADE_RISK_PERCENT', 0.45),
    maxSpreadPoints: envNumber('CACSMS_DAY_TRADE_MAX_SPREAD', 40),
    scanPriority: 3,
    maxEntriesPerCycle: envNumber('CACSMS_DAY_TRADE_MAX_ENTRIES', 2),
    confidenceFloor: envNumber('CACSMS_DAY_TRADE_CONFIDENCE_FLOOR', 38),
    readinessFloor: envNumber('CACSMS_DAY_TRADE_READINESS_FLOOR', 32),
    stopAtrMultiplier: 1.4,
    algorithms: ['opening_range_expansion', 'session_trend_continuation', 'vwap_reclaim', 'mtf_confluence'],
  },
  swing: {
    id: 'swing',
    label: 'Swing Trading',
    category: 'medium',
    description: 'Multi-day swing positions on H4 structure with H1 trigger and daily bias filter.',
    entryTimeframe: 'H4',
    dominantTimeframe: 'H4',
    biasTimeframes: ['D', 'H4', 'H1'],
    maxHoldHours: 240,
    minRewardRisk: 2,
    riskPerTradePercent: envNumber('CACSMS_SWING_RISK_PERCENT', 0.5),
    maxSpreadPoints: envNumber('CACSMS_SWING_MAX_SPREAD', 50),
    scanPriority: 2,
    maxEntriesPerCycle: envNumber('CACSMS_SWING_MAX_ENTRIES', 2),
    confidenceFloor: envNumber('CACSMS_SWING_CONFIDENCE_FLOOR', 42),
    readinessFloor: envNumber('CACSMS_SWING_READINESS_FLOOR', 38),
    stopAtrMultiplier: 2,
    algorithms: ['swing_structure', 'fibonacci_retracement', 'order_block_swing', 'mtf_confluence'],
  },
  position: {
    id: 'position',
    label: 'Position Trading',
    category: 'long',
    description: 'Macro-driven position trades on daily/weekly bias with COT and rates alignment.',
    entryTimeframe: 'D',
    dominantTimeframe: 'D',
    biasTimeframes: ['W', 'D', 'H4'],
    maxHoldHours: 24 * 21,
    minRewardRisk: 2.5,
    riskPerTradePercent: envNumber('CACSMS_POSITION_RISK_PERCENT', 0.35),
    maxSpreadPoints: envNumber('CACSMS_POSITION_MAX_SPREAD', 60),
    scanPriority: 1,
    maxEntriesPerCycle: envNumber('CACSMS_POSITION_MAX_ENTRIES', 1),
    confidenceFloor: envNumber('CACSMS_POSITION_CONFIDENCE_FLOOR', 45),
    readinessFloor: envNumber('CACSMS_POSITION_READINESS_FLOOR', 40),
    stopAtrMultiplier: 2.8,
    algorithms: ['macro_trend', 'cot_alignment', 'rates_differential', 'weekly_structure'],
  },
};

export function getTradingStyleProfile(styleId: TradingStyleId): TradingStyleProfile {
  return TRADING_STYLE_PROFILES[styleId];
}

export function getEnabledTradingStyles(): TradingStyleProfile[] {
  const raw = String(process.env.CACSMS_ENABLED_TRADING_STYLES ?? '').trim();
  const defaultStyles: TradingStyleId[] = ['scalp', 'intraday', 'day_trade', 'swing', 'position'];
  const enabled = raw
    ? raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) as TradingStyleId[]
    : defaultStyles;
  return enabled
    .filter((id) => TRADING_STYLE_PROFILES[id])
    .map((id) => TRADING_STYLE_PROFILES[id])
    .sort((a, b) => b.scanPriority - a.scanPriority);
}
