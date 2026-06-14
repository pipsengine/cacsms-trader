import type { DashboardTone } from '@/lib/dashboard-card-tones';
import { STRATEGY_GROUP_SLUGS } from '@/lib/strategy-routes';
import { SIDEBAR_STRATEGY_GROUPS, strategySlug } from '@/lib/strategies/sidebar-index';

import type { StrategyDefinition, StrategyParameterDefinition } from './types';

export interface StrategyGroupMeta {
  slug: string;
  label: string;
  tone: DashboardTone;
  description: string;
  plannedCount: number;
}

const TIMEFRAME_PARAM: StrategyParameterDefinition = {
  key: 'timeframe',
  label: 'Timeframe',
  type: 'timeframe',
  defaultValue: 'H1',
  options: [
    { value: 'M15', label: 'M15' },
    { value: 'H1', label: 'H1' },
    { value: 'H4', label: 'H4' },
    { value: 'D1', label: 'D1' },
  ],
};

const SYMBOL_PARAM: StrategyParameterDefinition = {
  key: 'symbol',
  label: 'Symbol',
  type: 'symbol',
  defaultValue: 'EURUSD',
};

function def(partial: StrategyDefinition): StrategyDefinition {
  return partial;
}

const GROUP_TONE_BY_SLUG: Record<string, DashboardTone> = {
  'trend-following-strategies': 'violet',
  'breakout-trading-strategies': 'orange',
  'scalping-strategies': 'cyan',
  'day-trading-strategies': 'blue',
  'swing-trading-strategies': 'purple',
  'position-trading-strategies': 'slate',
  'price-action-strategies': 'emerald',
  'indicator-based-strategies': 'blue',
  'mean-reversion-strategies': 'amber',
  'momentum-trading-strategies': 'rose',
  'reversal-trading-strategies': 'rose',
  'range-trading-strategies': 'amber',
  'smart-money-and-institutional-strategies': 'violet',
  'quantitative-and-algorithmic-strategies': 'slate',
  'fundamental-trading-strategies': 'emerald',
  'news-trading-strategies': 'orange',
  'correlation-and-intermarket-strategies': 'cyan',
  'volatility-based-strategies': 'purple',
  'hedging-strategies': 'slate',
  'arbitrage-strategies': 'blue',
  'session-based-strategies': 'orange',
  'pattern-trading-strategies': 'purple',
  'candlestick-trading-strategies': 'amber',
  'risk-management-strategies': 'rose',
  'advanced-professional-and-institutional-models': 'violet',
  'hybrid-strategies': 'cyan',
};

const GROUP_DESCRIPTION_BY_SLUG: Record<string, string> = {
  'trend-following-strategies': 'Ride sustained directional flow with moving averages, MACD, and SuperTrend.',
  'breakout-trading-strategies': 'Session boxes, range expansion, and volatility break models.',
  'scalping-strategies': 'Micro-structure execution on low timeframes.',
  'day-trading-strategies': 'Intraday bias, VWAP, and session momentum frameworks.',
  'swing-trading-strategies': 'Multi-day structure, Fibonacci, and harmonic swings.',
  'position-trading-strategies': 'Macro trend and carry models for longer horizons.',
  'price-action-strategies': 'Structure, supply/demand, and institutional candle models.',
  'indicator-based-strategies': 'RSI, MACD, Bollinger, and oscillator confluence engines.',
  'mean-reversion-strategies': 'Statistical snap-back and range fade systems.',
  'momentum-trading-strategies': 'Impulse continuation and relative strength models.',
  'reversal-trading-strategies': 'Exhaustion, divergence, and pattern reversal engines.',
  'range-trading-strategies': 'Horizontal range and oscillator-bound strategies.',
  'smart-money-and-institutional-strategies': 'SMC, order blocks, liquidity, and ICT-style models.',
  'quantitative-and-algorithmic-strategies': 'ML, stat-arb, and systematic execution frameworks.',
  'fundamental-trading-strategies': 'Rates, CPI, GDP, and policy-driven bias models.',
  'news-trading-strategies': 'Event volatility and headline impulse systems.',
  'correlation-and-intermarket-strategies': 'Cross-asset and DXY correlation frameworks.',
  'volatility-based-strategies': 'ATR expansion, compression, and implied vol models.',
  'hedging-strategies': 'Portfolio protection and correlation hedge engines.',
  'arbitrage-strategies': 'Triangular, latency, and cross-venue arbitrage.',
  'session-based-strategies': 'Asia, London, New York session models.',
  'pattern-trading-strategies': 'Harmonic and classical continuation/reversal patterns.',
  'candlestick-trading-strategies': 'Single and multi-candle rejection models.',
  'risk-management-strategies': 'Sizing, drawdown, and equity curve governance.',
  'advanced-professional-and-institutional-models': 'Wyckoff, market profile, and flow analysis.',
  'hybrid-strategies': 'Multi-model fusion and AI-assisted strategy stacks.',
};

export const STRATEGY_GROUP_META: StrategyGroupMeta[] = SIDEBAR_STRATEGY_GROUPS.map((group) => ({
  slug: group.slug,
  label: group.label.replace(/ Strategies$/, '').replace(/ Models$/, ''),
  tone: GROUP_TONE_BY_SLUG[group.slug] ?? 'slate',
  description: GROUP_DESCRIPTION_BY_SLUG[group.slug] ?? `${group.label} institutional models.`,
  plannedCount: group.strategies.length,
}));

export const ACTIVE_STRATEGY_DEFINITIONS: StrategyDefinition[] = [
  def({
    id: 'moving-average-crossover',
    group: 'trend-following-strategies',
    label: 'Moving Average Crossover',
    family: 'trend_following',
    description: 'Institutional trend engine using fast/slow moving average crossover with spread-weighted confidence.',
    algorithm: 'Dual MA crossover + spread confidence weighting',
    status: 'active',
    tone: 'violet',
    minCandles: 30,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'fastPeriod', label: 'Fast period', type: 'number', defaultValue: 9, min: 2, max: 100 },
      { key: 'slowPeriod', label: 'Slow period', type: 'number', defaultValue: 21, min: 5, max: 400 },
      { key: 'maType', label: 'MA type', type: 'select', defaultValue: 'ema', options: [{ value: 'ema', label: 'EMA' }, { value: 'sma', label: 'SMA' }] },
    ],
    rules: [
      'Buy when fast MA crosses above slow MA or fast remains above slow.',
      'Sell when fast MA crosses below slow MA or fast remains below slow.',
      'Confidence increases with MA spread and fresh crossover recency.',
    ],
  }),
  def({
    id: 'ema-pullback-strategy',
    group: 'trend-following-strategies',
    label: 'EMA Pullback Strategy',
    family: 'trend_following',
    description: 'Trend-filtered pullback entries when price retests a dynamic EMA value zone.',
    algorithm: 'Dual EMA trend filter + tolerance-band pullback confirmation',
    status: 'active',
    tone: 'violet',
    minCandles: 60,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'trendPeriod', label: 'Trend EMA', type: 'number', defaultValue: 50, min: 20, max: 200 },
      { key: 'pullbackPeriod', label: 'Pullback EMA', type: 'number', defaultValue: 21, min: 5, max: 100 },
      { key: 'tolerancePct', label: 'Tolerance %', type: 'number', defaultValue: 0.15, min: 0.05, max: 1 },
    ],
    rules: [
      'Only long when price is above trend EMA; only short when below.',
      'Enter when price retests pullback EMA within tolerance and resumes trend direction.',
    ],
  }),
  def({
    id: 'trendline-breakout',
    group: 'trend-following-strategies',
    label: 'Trendline Breakout',
    family: 'trend_following',
    description: 'Institutional swing-validated trendline break detection with RANSAC geometry and break-quality scoring.',
    algorithm: 'Vision trendline engine (swing RANSAC + break/retest events)',
    status: 'active',
    tone: 'violet',
    minCandles: 40,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'minValidity', label: 'Min validity', type: 'number', defaultValue: 0.45, min: 0.3, max: 0.9 },
      { key: 'breakLookback', label: 'Break lookback bars', type: 'number', defaultValue: 3, min: 1, max: 10 },
      { key: 'bufferPct', label: 'Break buffer %', type: 'number', defaultValue: 0.03, min: 0.01, max: 0.2 },
    ],
    rules: [
      'Detect support/resistance trendlines from validated swing points.',
      'Buy on bullish trendline break; sell on bearish trendline break with quality threshold.',
      'High break probability on dominant line without fresh break → wait for confirmation.',
    ],
  }),
  def({
    id: 'higher-highs-and-higher-lows',
    group: 'trend-following-strategies',
    label: 'Higher Highs & Higher Lows',
    family: 'trend_following',
    description: 'Classic market-structure trend model using institutional swing-point HH/HL and LH/LL sequence validation.',
    algorithm: 'Swing fractal detection + HH/HL vs LH/LL structure scoring',
    status: 'active',
    tone: 'violet',
    minCandles: 40,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'swingDepth', label: 'Swing depth', type: 'number', defaultValue: 5, min: 2, max: 12 },
      { key: 'minStrength', label: 'Min swing strength', type: 'number', defaultValue: 0.35, min: 0.2, max: 0.8 },
    ],
    rules: [
      'Bullish trend: latest swing high above prior high AND latest swing low above prior low.',
      'Bearish trend: lower high and lower low sequence confirmed.',
      'Mixed structure (BOS without full sequence) → wait or bias-only signal.',
    ],
  }),
  def({
    id: 'trend-continuation-pattern-strategy',
    group: 'trend-following-strategies',
    label: 'Trend Continuation Pattern Strategy',
    family: 'trend_following',
    description: 'Institutional flag, pennant, and compression continuation model using impulse-leg validation and breakout confirmation.',
    algorithm: 'Impulse leg + consolidation compression + trend-aligned breakout scoring',
    status: 'active',
    tone: 'violet',
    minCandles: 55,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'trendPeriod', label: 'Trend EMA', type: 'number', defaultValue: 50, min: 20, max: 200 },
      { key: 'impulseLookback', label: 'Impulse lookback', type: 'number', defaultValue: 24, min: 12, max: 60 },
      { key: 'patternBars', label: 'Pattern bars', type: 'number', defaultValue: 12, min: 6, max: 30 },
      { key: 'compressionThreshold', label: 'Compression ratio', type: 'number', defaultValue: 0.72, min: 0.35, max: 1 },
      { key: 'breakoutBufferPct', label: 'Breakout buffer %', type: 'number', defaultValue: 0.03, min: 0.005, max: 0.25 },
    ],
    rules: [
      'Confirm a dominant trend from EMA slope and price position.',
      'Require a recent impulse leg before the consolidation pattern.',
      'Score flag, pennant, or tight-range compression while price digests the impulse.',
      'Trade only when price closes beyond the pattern boundary in the trend direction.',
    ],
  }),
  def({
    id: 'dynamic-support-and-resistance-trend-trading',
    group: 'trend-following-strategies',
    label: 'Dynamic Support & Resistance Trend Trading',
    family: 'trend_following',
    description: 'Institutional trend-following retest model using dynamic EMA value bands and defended support/resistance zones.',
    algorithm: 'EMA trend channel + institutional S/R zone retest + rejection scoring',
    status: 'active',
    tone: 'violet',
    minCandles: 60,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'trendPeriod', label: 'Trend EMA', type: 'number', defaultValue: 50, min: 20, max: 200 },
      { key: 'valuePeriod', label: 'Value EMA', type: 'number', defaultValue: 21, min: 8, max: 100 },
      { key: 'zoneLookback', label: 'Zone lookback', type: 'number', defaultValue: 80, min: 30, max: 160 },
      { key: 'atrTolerance', label: 'ATR tolerance', type: 'number', defaultValue: 0.65, min: 0.2, max: 1.5 },
      { key: 'minZoneStrength', label: 'Min zone strength', type: 'number', defaultValue: 0.38, min: 0.2, max: 0.8 },
    ],
    rules: [
      'Define trend from EMA slope and price location.',
      'Map institutional support/resistance clusters from recent reaction points.',
      'Buy only when bullish trend retests defended support or dynamic EMA value.',
      'Sell only when bearish trend retests defended resistance or dynamic EMA value.',
      'Require candle rejection away from the retested zone before producing an entry signal.',
    ],
  }),
  def({
    id: 'fibonacci-trend-continuation',
    group: 'trend-following-strategies',
    label: 'Fibonacci Trend Continuation',
    family: 'trend_following',
    description: 'Institutional continuation model using EMA trend regime, impulse swing anchors, and Fibonacci retracement reaction zones.',
    algorithm: 'EMA trend filter + impulse swing Fibonacci retracement + rejection confirmation',
    status: 'active',
    tone: 'violet',
    minCandles: 70,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'trendPeriod', label: 'Trend EMA', type: 'number', defaultValue: 50, min: 20, max: 200 },
      { key: 'swingLookback', label: 'Swing lookback', type: 'number', defaultValue: 55, min: 30, max: 140 },
      { key: 'minRetracement', label: 'Min retracement', type: 'number', defaultValue: 0.382, min: 0.236, max: 0.5 },
      { key: 'maxRetracement', label: 'Max retracement', type: 'number', defaultValue: 0.618, min: 0.5, max: 0.786 },
      { key: 'toleranceAtr', label: 'ATR tolerance', type: 'number', defaultValue: 0.25, min: 0.05, max: 0.75 },
    ],
    rules: [
      'Establish dominant direction from EMA slope and price position.',
      'Anchor Fibonacci levels to the latest institutional impulse swing.',
      'Buy bullish trends only inside the 38.2%-61.8% retracement value pocket.',
      'Sell bearish trends only inside the mirrored retracement value pocket.',
      'Require wick/body rejection or value-zone reclaim before producing a continuation signal.',
    ],
  }),
  def({
    id: 'macd-trend-strategy',
    group: 'trend-following-strategies',
    label: 'MACD Trend Strategy',
    family: 'trend_following',
    description: 'MACD line / signal crossover with histogram momentum confirmation.',
    algorithm: 'MACD crossover + histogram expansion scoring',
    status: 'active',
    tone: 'violet',
    minCandles: 40,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'fastPeriod', label: 'Fast EMA', type: 'number', defaultValue: 12, min: 5, max: 50 },
      { key: 'slowPeriod', label: 'Slow EMA', type: 'number', defaultValue: 26, min: 10, max: 100 },
      { key: 'signalPeriod', label: 'Signal', type: 'number', defaultValue: 9, min: 3, max: 30 },
    ],
    rules: [
      'Buy on bullish MACD/signal crossover or positive histogram bias.',
      'Sell on bearish crossover or negative histogram bias.',
    ],
  }),
  def({
    id: 'supertrend-strategy',
    group: 'trend-following-strategies',
    label: 'SuperTrend Strategy',
    family: 'trend_following',
    description: 'ATR-adaptive trailing trend regime with flip detection.',
    algorithm: 'ATR SuperTrend band + regime flip events',
    status: 'active',
    tone: 'violet',
    minCandles: 30,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'period', label: 'ATR period', type: 'number', defaultValue: 10, min: 5, max: 50 },
      { key: 'multiplier', label: 'Multiplier', type: 'number', defaultValue: 2, min: 1, max: 6 },
    ],
    rules: [
      'Stay long while SuperTrend is bullish; short while bearish.',
      'Fresh flips generate highest-confidence entries.',
    ],
  }),
  def({
    id: 'ichimoku-trend-strategy',
    group: 'trend-following-strategies',
    label: 'Ichimoku Trend Strategy',
    family: 'trend_following',
    description: 'Multi-layer Ichimoku cloud regime with Tenkan/Kijun crossover and Chikou confirmation.',
    algorithm: 'Ichimoku cloud position + TK cross + lagging span alignment',
    status: 'active',
    tone: 'violet',
    minCandles: 80,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'tenkanPeriod', label: 'Tenkan period', type: 'number', defaultValue: 9, min: 5, max: 20 },
      { key: 'kijunPeriod', label: 'Kijun period', type: 'number', defaultValue: 26, min: 15, max: 40 },
      { key: 'senkouBPeriod', label: 'Senkou B period', type: 'number', defaultValue: 52, min: 30, max: 80 },
    ],
    rules: [
      'Trade long when price is above the cloud with Tenkan above Kijun.',
      'Trade short when price is below the cloud with Tenkan below Kijun.',
      'Fresh TK crosses inside the prevailing cloud regime boost confidence.',
    ],
  }),
  def({
    id: 'rsi-strategy',
    group: 'indicator-based-strategies',
    label: 'RSI Strategy',
    family: 'indicator',
    description: 'RSI band rejection with momentum bias scoring.',
    algorithm: 'RSI(14) oversold/overbought rejection + midline bias',
    status: 'active',
    tone: 'blue',
    minCandles: 30,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'period', label: 'RSI period', type: 'number', defaultValue: 14, min: 5, max: 50 },
      { key: 'oversold', label: 'Oversold', type: 'number', defaultValue: 30, min: 10, max: 40 },
      { key: 'overbought', label: 'Overbought', type: 'number', defaultValue: 70, min: 60, max: 90 },
    ],
    rules: [
      'Buy when RSI crosses back above oversold.',
      'Sell when RSI crosses back below overbought.',
    ],
  }),
  def({
    id: 'london-breakout',
    group: 'breakout-trading-strategies',
    label: 'London Breakout',
    family: 'breakout',
    description: 'Session range box breakout with institutional buffer validation.',
    algorithm: 'Rolling session high/low box + buffer breakout',
    status: 'active',
    tone: 'orange',
    minCandles: 30,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'lookback', label: 'Range lookback', type: 'number', defaultValue: 24, min: 12, max: 96 },
      { key: 'bufferPct', label: 'Buffer %', type: 'number', defaultValue: 0.05, min: 0.01, max: 0.5 },
    ],
    rules: [
      'Define session range from lookback window.',
      'Buy above range high; sell below range low.',
    ],
  }),
  def({
    id: 'bollinger-band-squeeze-breakout',
    group: 'breakout-trading-strategies',
    label: 'Bollinger Band Squeeze Breakout',
    family: 'breakout',
    description: 'Volatility compression followed by band expansion breakout.',
    algorithm: 'Bollinger bandwidth squeeze detection + band pierce',
    status: 'active',
    tone: 'orange',
    minCandles: 40,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'period', label: 'Period', type: 'number', defaultValue: 20, min: 10, max: 50 },
      { key: 'stdDev', label: 'Std dev', type: 'number', defaultValue: 2, min: 1, max: 3 },
      { key: 'squeezeThreshold', label: 'Squeeze %', type: 'number', defaultValue: 1.2, min: 0.5, max: 3 },
    ],
    rules: [
      'Detect squeeze when bandwidth falls below threshold.',
      'Trade expansion breaks above upper or below lower band.',
    ],
  }),
  def({
    id: 'order-block-trading',
    group: 'smart-money-and-institutional-strategies',
    label: 'Order Block Trading',
    family: 'smart_money',
    description: 'Displacement-based order block identification with mitigation retest entries.',
    algorithm: 'ATR displacement candle + block zone retest',
    status: 'active',
    tone: 'violet',
    minCandles: 50,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'lookback', label: 'Lookback bars', type: 'number', defaultValue: 40, min: 20, max: 120 },
      { key: 'displacementMultiple', label: 'Displacement × ATR', type: 'number', defaultValue: 1.6, min: 1, max: 4 },
    ],
    rules: [
      'Identify displacement candle forming institutional block.',
      'Enter on mitigation retest of block zone in trend direction.',
    ],
  }),
  def({
    id: 'adx-trend-strategy',
    group: 'trend-following-strategies',
    label: 'ADX Trend Strategy',
    family: 'trend_following',
    description: 'Directional movement index trend-strength filter with +DI / -DI dominance.',
    algorithm: 'ADX(14) strength gate + DI spread institutional trend filter',
    status: 'active',
    tone: 'violet',
    minCandles: 40,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'period', label: 'ADX period', type: 'number', defaultValue: 14, min: 7, max: 30 },
      { key: 'threshold', label: 'Trend threshold', type: 'number', defaultValue: 25, min: 15, max: 40 },
    ],
    rules: [
      'Only trade when ADX exceeds trend threshold (strong directional regime).',
      'Buy when +DI dominates -DI; sell when -DI dominates +DI.',
    ],
  }),
  def({
    id: '200-ema-trend-strategy',
    group: 'trend-following-strategies',
    label: '200 EMA Trend Strategy',
    family: 'trend_following',
    description: 'Institutional long-horizon trend filter using 200-period EMA slope and price position.',
    algorithm: 'EMA(200) slope + price position institutional bias',
    status: 'active',
    tone: 'violet',
    minCandles: 105,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'period', label: 'EMA period', type: 'number', defaultValue: 200, min: 100, max: 300 },
      { key: 'slopeLookback', label: 'Slope lookback', type: 'number', defaultValue: 5, min: 2, max: 20 },
    ],
    rules: [
      'Long bias when price is above rising EMA; short when below falling EMA.',
      'Wait when price hugs flat EMA — no institutional edge.',
    ],
  }),
  def({
    id: 'multi-timeframe-trend-confirmation',
    group: 'trend-following-strategies',
    label: 'Multi-Timeframe Trend Confirmation',
    family: 'trend_following',
    description: 'Top-down institutional trend alignment across W/D/H4/H1/M15 with conflict filtering.',
    algorithm: 'Vision MTF stack alignment + controlling timeframe decision synthesis',
    status: 'active',
    tone: 'violet',
    minCandles: 12,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'minAlignedTimeframes', label: 'Min aligned TFs', type: 'number', defaultValue: 3, min: 2, max: 5 },
    ],
    rules: [
      'Require W/D/H4 bullish control before long entries; mirror for shorts.',
      'H1 and M15 must confirm lower-timeframe continuation or pullback completion.',
      'Scalp-only when H4/H1/M15 align against W/D control.',
    ],
  }),
  def({
    id: 'asian-session-breakout',
    group: 'breakout-trading-strategies',
    label: 'Asian Session Breakout',
    family: 'breakout',
    description: 'Asian consolidation box with London-style expansion breakout validation.',
    algorithm: 'First-third session range box + expansion buffer breakout',
    status: 'active',
    tone: 'orange',
    minCandles: 36,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'lookback', label: 'Session lookback', type: 'number', defaultValue: 36, min: 18, max: 96 },
      { key: 'bufferPct', label: 'Buffer %', type: 'number', defaultValue: 0.04, min: 0.01, max: 0.5 },
    ],
    rules: [
      'Define Asian range from earliest third of lookback window.',
      'Buy above range high; sell below range low with buffer confirmation.',
    ],
  }),
  def({
    id: 'opening-range-breakout-orb',
    group: 'breakout-trading-strategies',
    label: 'Opening Range Breakout (ORB)',
    family: 'breakout',
    description: 'Opening range box from first N bars with directional expansion entries.',
    algorithm: 'ORB box from first N bars + close-confirmed breakout',
    status: 'active',
    tone: 'orange',
    minCandles: 30,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'lookback', label: 'Window bars', type: 'number', defaultValue: 24, min: 12, max: 72 },
      { key: 'orbBars', label: 'ORB bars', type: 'number', defaultValue: 6, min: 3, max: 12 },
      { key: 'bufferPct', label: 'Buffer %', type: 'number', defaultValue: 0.03, min: 0.01, max: 0.3 },
    ],
    rules: [
      'Build opening range from first ORB bars inside lookback window.',
      'Enter on confirmed close outside range with buffer.',
    ],
  }),
  def({
    id: 'fair-value-gap-fvg',
    group: 'price-action-strategies',
    label: 'Fair Value Gap (FVG)',
    family: 'price_action',
    description: 'ICT-style fair value gap detection with mitigation retest entries.',
    algorithm: '3-candle imbalance gap + mitigation retest scoring',
    status: 'active',
    tone: 'emerald',
    minCandles: 40,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'lookback', label: 'Lookback bars', type: 'number', defaultValue: 60, min: 20, max: 150 },
      { key: 'minGapPct', label: 'Min gap %', type: 'number', defaultValue: 0.02, min: 0.005, max: 0.2 },
    ],
    rules: [
      'Detect bullish/bearish FVG when middle candle leaves an imbalance zone.',
      'Enter on mitigation retest into active gap in trend direction.',
    ],
  }),
  def({
    id: 'pin-bar-strategy',
    group: 'price-action-strategies',
    label: 'Pin Bar Strategy',
    family: 'price_action',
    description: 'Institutional rejection candle with wick-to-body ratio and close-location scoring.',
    algorithm: 'Pin bar wick rejection + close location in range',
    status: 'active',
    tone: 'emerald',
    minCandles: 20,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'wickRatio', label: 'Min wick ratio', type: 'number', defaultValue: 2, min: 1.5, max: 4 },
      { key: 'bodyMaxPct', label: 'Max body %', type: 'number', defaultValue: 35, min: 10, max: 50 },
    ],
    rules: [
      'Bullish pin: long lower wick with close in upper third of range.',
      'Bearish pin: long upper wick with close in lower third of range.',
    ],
  }),
  def({
    id: 'break-and-retest',
    group: 'price-action-strategies',
    label: 'Break and Retest',
    family: 'price_action',
    description: 'Structure level break followed by institutional retest confirmation.',
    algorithm: 'Swing level break + retest hold/reject scoring',
    status: 'active',
    tone: 'emerald',
    minCandles: 40,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'lookback', label: 'Structure lookback', type: 'number', defaultValue: 40, min: 20, max: 120 },
      { key: 'retestTolerancePct', label: 'Retest tolerance %', type: 'number', defaultValue: 0.08, min: 0.02, max: 0.3 },
    ],
    rules: [
      'Identify recent swing high/low as institutional structure level.',
      'Enter when price breaks level then retests and holds/rejects.',
    ],
  }),
  def({
    id: 'bollinger-mean-reversion',
    group: 'mean-reversion-strategies',
    label: 'Bollinger Mean Reversion',
    family: 'mean_reversion',
    description: 'Band-touch mean reversion with midline target bias in non-trending regimes.',
    algorithm: 'Bollinger band touch + RSI confluence reversion',
    status: 'active',
    tone: 'amber',
    minCandles: 40,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'period', label: 'Band period', type: 'number', defaultValue: 20, min: 10, max: 50 },
      { key: 'stdDev', label: 'Std dev', type: 'number', defaultValue: 2, min: 1, max: 3 },
      { key: 'rsiPeriod', label: 'RSI period', type: 'number', defaultValue: 14, min: 5, max: 30 },
    ],
    rules: [
      'Buy near lower band when RSI confirms oversold and bandwidth is moderate.',
      'Sell near upper band when RSI confirms overbought.',
    ],
  }),
  def({
    id: 'liquidity-grab-strategy',
    group: 'smart-money-and-institutional-strategies',
    label: 'Liquidity Grab Strategy',
    family: 'smart_money',
    description: 'Stop-hunt liquidity sweep above/below recent extremes with reversal confirmation.',
    algorithm: 'Equal highs/lows sweep + close-back-inside reversal',
    status: 'active',
    tone: 'violet',
    minCandles: 40,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'lookback', label: 'Liquidity lookback', type: 'number', defaultValue: 30, min: 15, max: 80 },
      { key: 'sweepBufferPct', label: 'Sweep buffer %', type: 'number', defaultValue: 0.02, min: 0.005, max: 0.15 },
    ],
    rules: [
      'Detect sweep above recent high then close back below — bearish grab.',
      'Detect sweep below recent low then close back above — bullish grab.',
    ],
  }),
  def({
    id: 'stochastic-strategy',
    group: 'indicator-based-strategies',
    label: 'Stochastic Strategy',
    family: 'indicator',
    description: 'Stochastic %K / %D crossover with oversold/overbought zone filtering.',
    algorithm: 'Stochastic(14,3) cross + zone rejection scoring',
    status: 'active',
    tone: 'blue',
    minCandles: 30,
    parameters: [
      SYMBOL_PARAM,
      TIMEFRAME_PARAM,
      { key: 'kPeriod', label: '%K period', type: 'number', defaultValue: 14, min: 5, max: 30 },
      { key: 'dPeriod', label: '%D period', type: 'number', defaultValue: 3, min: 2, max: 10 },
      { key: 'oversold', label: 'Oversold', type: 'number', defaultValue: 20, min: 5, max: 30 },
      { key: 'overbought', label: 'Overbought', type: 'number', defaultValue: 80, min: 70, max: 95 },
    ],
    rules: [
      'Buy on bullish %K/%D cross from oversold zone.',
      'Sell on bearish cross from overbought zone.',
    ],
  }),
];

const ACTIVE_STRATEGY_IDS = new Set(ACTIVE_STRATEGY_DEFINITIONS.map((item) => item.id));

const PLANNED_STRATEGY_DEFINITIONS: StrategyDefinition[] = SIDEBAR_STRATEGY_GROUPS.flatMap((group) =>
  group.strategies.flatMap((label) => {
    const id = strategySlug(label);
    if (ACTIVE_STRATEGY_IDS.has(id)) return [];
    const tone = GROUP_TONE_BY_SLUG[group.slug] ?? 'slate';
    return [def({
      id,
      group: group.slug,
      label,
      family: group.slug.split('-')[0] ?? 'strategy',
      description: `${label} institutional model registered for deployment.`,
      algorithm: 'Unified engine slot — deployment queued',
      status: 'planned',
      tone,
      minCandles: 30,
      parameters: [SYMBOL_PARAM, TIMEFRAME_PARAM],
      rules: [
        'Strategy registered in institutional catalog.',
        'Engine deployment will activate live evaluation via unified API.',
      ],
    })];
  }),
);

export const STRATEGY_DEFINITIONS: StrategyDefinition[] = [
  ...ACTIVE_STRATEGY_DEFINITIONS,
  ...PLANNED_STRATEGY_DEFINITIONS,
];

export const STRATEGY_REGISTRY: Record<string, StrategyDefinition> = Object.fromEntries(
  STRATEGY_DEFINITIONS.map((item) => [item.id, item]),
);

export function getStrategyDefinition(strategyId: string): StrategyDefinition | null {
  return STRATEGY_REGISTRY[strategyId] ?? null;
}

export function getStrategyDefinitionByRoute(group: string, strategyId: string): StrategyDefinition | null {
  const definition = STRATEGY_REGISTRY[strategyId];
  if (!definition || definition.group !== group) return null;
  return definition;
}

export function listStrategiesByGroup(group: string): StrategyDefinition[] {
  return STRATEGY_DEFINITIONS.filter((item) => item.group === group);
}

export function getGroupMeta(group: string): StrategyGroupMeta | null {
  return STRATEGY_GROUP_META.find((item) => item.slug === group) ?? null;
}

export const ACTIVE_STRATEGIES = ACTIVE_STRATEGY_DEFINITIONS.filter((item) => item.status === 'active');

export function isKnownStrategyGroup(group: string): boolean {
  return (STRATEGY_GROUP_SLUGS as readonly string[]).includes(group);
}
