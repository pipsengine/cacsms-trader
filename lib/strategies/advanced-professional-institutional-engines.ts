import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { atr, ema, rsi } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rocPct(candles: StrategyPriceCandle[], bars: number): number {
  const closes = candles.map((item) => item.close);
  const last = closes.length - 1;
  const start = closes[Math.max(0, last - bars)]!;
  return start !== 0 ? ((closes[last]! - start) / start) * 100 : 0;
}

function valueAreaProxy(candles: StrategyPriceCandle[], lookback: number): { poc: number; vah: number; val: number } {
  const window = candles.slice(-lookback);
  const closes = window.map((item) => item.close);
  const poc = closes.reduce((sum, value) => sum + value, 0) / Math.max(closes.length, 1);
  const vah = Math.max(...window.map((item) => item.high));
  const val = Math.min(...window.map((item) => item.low));
  return { poc, vah, val };
}

function trendMomentumFusion(candles: StrategyPriceCandle[], trendBars: number, momentumBars: number): {
  bias: StrategyBias;
  decision: StrategySignalSide;
  trendRoc: number;
  momentum: number;
} {
  const closes = candles.map((item) => item.close);
  const trendMa = ema(closes, trendBars)[closes.length - 1];
  const last = candles[candles.length - 1]!;
  const trendRoc = rocPct(candles, trendBars);
  const momentum = rocPct(candles, momentumBars);
  let bias: StrategyBias = trendRoc > 0 && momentum > 0 ? 'bullish' : trendRoc < 0 && momentum < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (trendRoc > 0 && momentum > 0 && last.close > (trendMa ?? last.close) && last.close > last.open) decision = 'buy';
  if (trendRoc < 0 && momentum < 0 && last.close < (trendMa ?? last.close) && last.close < last.open) decision = 'sell';
  return { bias, decision, trendRoc, momentum };
}

export const evaluateWyckoffTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(30, parseNumber(config.lookback, 55));
  const window = candles.slice(-lookback);
  const { early, mid, late } = { early: window.slice(0, Math.floor(window.length / 3)), mid: window.slice(Math.floor(window.length / 3), Math.floor(window.length * 2 / 3)), late: window.slice(Math.floor(window.length * 2 / 3)) };
  const rangeMid = window.reduce((sum, item) => sum + item.close, 0) / window.length;
  const spring = Math.min(...mid.map((item) => item.low)) < Math.min(...early.map((item) => item.low)) && late.at(-1)!.close > rangeMid;
  const upthrust = Math.max(...mid.map((item) => item.high)) > Math.max(...early.map((item) => item.high)) && late.at(-1)!.close < rangeMid;
  const last = candles[candles.length - 1]!;
  const decision: StrategySignalSide = spring && last.close > last.open ? 'buy' : upthrust && last.close < last.open ? 'sell' : 'wait';
  return buildEvaluationResult({
    strategyId: 'wyckoff-trading',
    context,
    config: { ...config, lookback },
    candles,
    decision,
    bias: spring ? 'bullish' : upthrust ? 'bearish' : 'neutral',
    confidence: 34 + (decision !== 'wait' ? 32 : spring || upthrust ? 10 : 0),
    reasons: ['Wyckoff trading — spring/upthrust accumulation/distribution proxy', spring ? 'Spring detected above range mid' : upthrust ? 'Upthrust detected below range mid' : 'No Wyckoff event', decision !== 'wait' ? 'Wyckoff phase entry' : 'Awaiting Wyckoff trigger'],
    metrics: { spring: spring ? 1 : 0, upthrust: upthrust ? 1 : 0 },
  });
};

export const evaluateMarketProfileTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(24, parseNumber(config.lookback, 48));
  const { poc, vah, val } = valueAreaProxy(candles, lookback);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = last.close > poc ? 'bullish' : last.close < poc ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (last.close > vah && last.close > last.open) decision = 'buy';
  if (last.close < val && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'market-profile-trading',
    context,
    config: { ...config, lookback },
    candles,
    decision,
    bias,
    confidence: 33 + (decision !== 'wait' ? 30 : 0),
    reasons: ['Market profile — POC/VAH/VAL proxy from price distribution', `POC ${poc.toFixed(5)} · VAH ${vah.toFixed(5)} · VAL ${val.toFixed(5)}`, decision === 'buy' ? 'Above value area long' : decision === 'sell' ? 'Below value area short' : 'Inside value area'],
    metrics: { poc: Number(poc.toFixed(5)), vah: Number(vah.toFixed(5)), val: Number(val.toFixed(5)) },
  });
};

export const evaluateVolumeProfileTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(24, parseNumber(config.lookback, 48));
  const window = candles.slice(-lookback);
  const weighted = window.map((item) => ({ close: item.close, weight: item.high - item.low }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const vwap = totalWeight > 0 ? weighted.reduce((sum, item) => sum + item.close * item.weight, 0) / totalWeight : window.at(-1)!.close;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = last.close > vwap ? 'bullish' : last.close < vwap ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (last.close > vwap * 1.0005 && last.close > last.open) decision = 'buy';
  if (last.close < vwap * 0.9995 && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'volume-profile-trading',
    context,
    config: { ...config, lookback },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 30 : 0),
    reasons: ['Volume profile — range-weighted VWAP proxy', `VWAP ${vwap.toFixed(5)}`, decision !== 'wait' ? 'Volume profile edge entry' : 'At volume profile fair value'],
    metrics: { vwap: Number(vwap.toFixed(5)) },
  });
};

export const evaluateAuctionMarketTheoryEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const { poc, vah, val } = valueAreaProxy(candles, lookback);
  const last = candles[candles.length - 1]!;
  const acceptingAbove = last.close > poc && last.low > poc * 0.999;
  const acceptingBelow = last.close < poc && last.high < poc * 1.001;
  const decision: StrategySignalSide = acceptingAbove && last.close > last.open ? 'buy' : acceptingBelow && last.close < last.open ? 'sell' : 'wait';
  return buildEvaluationResult({
    strategyId: 'auction-market-theory',
    context,
    config: { ...config, lookback },
    candles,
    decision,
    bias: acceptingAbove ? 'bullish' : acceptingBelow ? 'bearish' : 'neutral',
    confidence: 33 + (decision !== 'wait' ? 32 : 0),
    reasons: ['Auction market theory — acceptance/rejection at POC', `POC ${poc.toFixed(5)}`, decision === 'buy' ? 'Acceptance above POC' : decision === 'sell' ? 'Acceptance below POC' : 'Two-sided auction — wait'],
    metrics: { poc: Number(poc.toFixed(5)), vah: Number(vah.toFixed(5)), val: Number(val.toFixed(5)) },
  });
};

export const evaluateOrderBookTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(12, parseNumber(config.lookback, 24));
  const imbalanceThreshold = parseNumber(config.imbalanceThreshold, 0.55);
  const window = candles.slice(-lookback);
  let buyPressure = 0;
  let sellPressure = 0;
  for (const candle of window) {
    const range = candle.high - candle.low;
    if (range <= 0) continue;
    buyPressure += (candle.close - candle.low) / range;
    sellPressure += (candle.high - candle.close) / range;
  }
  const total = buyPressure + sellPressure;
  const imbalance = total > 0 ? buyPressure / total : 0.5;
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (imbalance >= imbalanceThreshold && last.close > last.open) decision = 'buy';
  if (imbalance <= 1 - imbalanceThreshold && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'order-book-trading',
    context,
    config: { ...config, lookback, imbalanceThreshold },
    candles,
    decision,
    bias: imbalance >= 0.5 ? 'bullish' : 'bearish',
    confidence: 35 + (decision !== 'wait' ? 28 : 0),
    reasons: ['Order book trading — close location value as bid/ask imbalance proxy', `Buy pressure ${(imbalance * 100).toFixed(0)}%`, decision !== 'wait' ? 'Order book imbalance entry' : 'Balanced book'],
    metrics: { buyPressurePct: Number((imbalance * 100).toFixed(1)) },
  });
};

export const evaluateFootprintChartsEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(10, parseNumber(config.lookback, 20));
  const deltaThreshold = parseNumber(config.deltaThreshold, 0.12);
  const window = candles.slice(-lookback);
  let delta = 0;
  for (const candle of window) {
    delta += candle.close - candle.open;
  }
  const avgRange = window.reduce((sum, item) => sum + (item.high - item.low), 0) / Math.max(window.length, 1);
  const normDelta = avgRange > 0 ? delta / (avgRange * window.length) : 0;
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (normDelta >= deltaThreshold && last.close > last.open) decision = 'buy';
  if (normDelta <= -deltaThreshold && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'footprint-charts',
    context,
    config: { ...config, lookback, deltaThreshold },
    candles,
    decision,
    bias: normDelta > 0 ? 'bullish' : normDelta < 0 ? 'bearish' : 'neutral',
    confidence: 34 + (decision !== 'wait' ? 30 : 0),
    reasons: ['Footprint charts — cumulative bar delta proxy', `Normalized delta ${normDelta.toFixed(3)}`, decision !== 'wait' ? 'Footprint delta entry' : 'Neutral delta'],
    metrics: { normDelta: Number(normDelta.toFixed(4)) },
  });
};

export const evaluateLiquidityEngineeringEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const sweepPct = parseNumber(config.sweepPct, 0.06);
  const window = candles.slice(-lookback, -1);
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (sweepPct / 100);
  let decision: StrategySignalSide = 'wait';
  if (last.low < rangeLow - buffer && last.close > rangeLow) decision = 'buy';
  if (last.high > rangeHigh + buffer && last.close < rangeHigh) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'liquidity-engineering',
    context,
    config: { ...config, lookback, sweepPct },
    candles,
    decision,
    bias: decision === 'buy' ? 'bullish' : decision === 'sell' ? 'bearish' : 'neutral',
    confidence: 36 + (decision !== 'wait' ? 32 : 0),
    reasons: ['Liquidity engineering — sweep and reclaim of range liquidity', `Range ${rangeLow.toFixed(5)} – ${rangeHigh.toFixed(5)}`, decision === 'buy' ? 'Buy-side sweep reversal' : decision === 'sell' ? 'Sell-side sweep reversal' : 'No liquidity sweep'],
    metrics: { rangeHigh: Number(rangeHigh.toFixed(5)), rangeLow: Number(rangeLow.toFixed(5)) },
  });
};

export const evaluateQuantMacroTradingEngine: StrategyEngine = (candles, config, context) => {
  const slowBars = Math.max(40, parseNumber(config.slowBars, 70));
  const fastBars = Math.max(15, parseNumber(config.fastBars, 25));
  const minMacroPct = parseNumber(config.minMacroPct, 0.5);
  const slowRoc = rocPct(candles, slowBars);
  const fastRoc = rocPct(candles, fastBars);
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (slowRoc >= minMacroPct && fastRoc > 0 && last.close > last.open) decision = 'buy';
  if (slowRoc <= -minMacroPct && fastRoc < 0 && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'quant-macro-trading',
    context,
    config: { ...config, slowBars, fastBars, minMacroPct },
    candles,
    decision,
    bias: slowRoc > 0 ? 'bullish' : slowRoc < 0 ? 'bearish' : 'neutral',
    confidence: 34 + (decision !== 'wait' ? 30 : 0),
    reasons: ['Quant macro trading — slow macro ROC + fast confirmation', `Slow ${slowRoc.toFixed(2)}% · fast ${fastRoc.toFixed(2)}%`, decision !== 'wait' ? 'Macro quant entry' : 'Macro alignment insufficient'],
    metrics: { slowRocPct: Number(slowRoc.toFixed(3)), fastRocPct: Number(fastRoc.toFixed(3)) },
  });
};

export const evaluateStatisticalModelingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(25, parseNumber(config.lookback, 50));
  const zThreshold = parseNumber(config.zThreshold, 1.2);
  const closes = candles.slice(-lookback).map((item) => item.close);
  const mean = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  const std = Math.sqrt(closes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / closes.length);
  const z = std > 0 ? (closes.at(-1)! - mean) / std : 0;
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (z <= -zThreshold && last.close > last.open) decision = 'buy';
  if (z >= zThreshold && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'statistical-modeling',
    context,
    config: { ...config, lookback, zThreshold },
    candles,
    decision,
    bias: z > 0 ? 'bearish' : z < 0 ? 'bullish' : 'neutral',
    confidence: 35 + (decision !== 'wait' ? 30 : 0),
    reasons: ['Statistical modeling — z-score mean reversion', `Z-score ${z.toFixed(2)} (±${zThreshold})`, decision === 'buy' ? 'Statistical long reversion' : decision === 'sell' ? 'Statistical short reversion' : 'Within statistical band'],
    metrics: { zScore: Number(z.toFixed(3)) },
  });
};

export const evaluateAiPredictiveTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const minScore = parseNumber(config.minScore, 0.55);
  const closes = candles.map((item) => item.close);
  const rsiSeries = rsi(closes, 14);
  const rsiNow = rsiSeries[closes.length - 1] ?? 50;
  const momentum = rocPct(candles, Math.floor(lookback / 2));
  const rsiNorm = rsiNow / 100;
  const momNorm = Math.tanh(momentum / 2) * 0.5 + 0.5;
  const aiScore = rsiNorm * 0.4 + momNorm * 0.6;
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (aiScore >= minScore && last.close > last.open) decision = 'buy';
  if (aiScore <= 1 - minScore && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'ai-predictive-trading',
    context,
    config: { ...config, lookback, minScore },
    candles,
    decision,
    bias: aiScore > 0.5 ? 'bullish' : aiScore < 0.5 ? 'bearish' : 'neutral',
    confidence: 32 + (decision !== 'wait' ? 32 : 0) + Math.min(14, Math.abs(aiScore - 0.5) * 40),
    reasons: ['AI predictive trading — fused RSI/momentum score proxy', `AI score ${aiScore.toFixed(2)} (threshold ${minScore})`, decision !== 'wait' ? 'AI predictive entry' : 'AI score neutral'],
    metrics: { aiScore: Number(aiScore.toFixed(3)) },
  });
};

export const evaluateNeuralForecastingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 45));
  const horizon = Math.max(3, parseNumber(config.horizon, 6));
  const closes = candles.slice(-lookback).map((item) => item.close);
  const weights = closes.map((_, index) => Math.exp((index - closes.length + 1) / horizon));
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const forecast = weightSum > 0 ? closes.reduce((sum, value, index) => sum + value * weights[index]!, 0) / weightSum : closes.at(-1)!;
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (forecast > last.close && last.close > last.open) decision = 'buy';
  if (forecast < last.close && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'neural-forecasting',
    context,
    config: { ...config, lookback, horizon },
    candles,
    decision,
    bias: forecast > last.close ? 'bullish' : forecast < last.close ? 'bearish' : 'neutral',
    confidence: 33 + (decision !== 'wait' ? 30 : 0),
    reasons: ['Neural forecasting — exponential weighted forward proxy', `Forecast ${forecast.toFixed(5)} vs last ${last.close.toFixed(5)}`, decision !== 'wait' ? 'Forecast-aligned entry' : 'Forecast flat'],
    metrics: { forecast: Number(forecast.toFixed(5)) },
  });
};

export const evaluateInstitutionalFlowAnalysisEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const minFlow = parseNumber(config.minFlow, 0.2);
  const window = candles.slice(-lookback);
  let flow = 0;
  for (const candle of window) {
    const range = candle.high - candle.low;
    flow += range > 0 ? ((candle.close - candle.open) / range) : 0;
  }
  const avgFlow = flow / Math.max(window.length, 1);
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (avgFlow >= minFlow && last.close > last.open) decision = 'buy';
  if (avgFlow <= -minFlow && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'institutional-flow-analysis',
    context,
    config: { ...config, lookback, minFlow },
    candles,
    decision,
    bias: avgFlow > 0 ? 'bullish' : avgFlow < 0 ? 'bearish' : 'neutral',
    confidence: 34 + (decision !== 'wait' ? 30 : 0),
    reasons: ['Institutional flow analysis — directional body/range flow proxy', `Avg flow ${avgFlow.toFixed(3)}`, decision !== 'wait' ? 'Institutional flow entry' : 'Flow neutral'],
    metrics: { avgFlow: Number(avgFlow.toFixed(4)) },
  });
};

export const evaluateDarkPoolAnalysisEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const quietRatio = parseNumber(config.quietRatio, 0.65);
  const window = candles.slice(-lookback);
  const ranges = window.map((item) => item.high - item.low);
  const avgRange = ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
  const recentRange = ranges.slice(-5).reduce((sum, value) => sum + value, 0) / Math.min(5, ranges.length);
  const quiet = avgRange > 0 && recentRange / avgRange <= quietRatio;
  const drift = window.at(-1)!.close - window[0]!.close;
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (quiet && drift > 0 && last.close > last.open) decision = 'buy';
  if (quiet && drift < 0 && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'dark-pool-analysis',
    context,
    config: { ...config, lookback, quietRatio },
    candles,
    decision,
    bias: drift > 0 ? 'bullish' : drift < 0 ? 'bearish' : 'neutral',
    confidence: 33 + (decision !== 'wait' ? 32 : quiet ? 8 : 0),
    reasons: ['Dark pool analysis — quiet range + hidden drift proxy', quiet ? `Quiet tape ratio ${(recentRange / avgRange).toFixed(2)}` : 'Tape not quiet enough', decision !== 'wait' ? 'Dark pool drift entry' : 'No dark pool edge'],
    metrics: { quietRatioObserved: Number((recentRange / Math.max(avgRange, 0.00001)).toFixed(3)) },
  });
};

export const evaluateSentimentEngineTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(14, parseNumber(config.lookback, 28));
  const rsiPeriod = Math.max(7, parseNumber(config.rsiPeriod, 14));
  const closes = candles.map((item) => item.close);
  const rsiNow = rsi(closes, rsiPeriod)[closes.length - 1] ?? 50;
  const momentum = rocPct(candles, lookback);
  const sentiment = (rsiNow - 50) / 50 + momentum / 5;
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (sentiment >= 0.25 && last.close > last.open) decision = 'buy';
  if (sentiment <= -0.25 && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'sentiment-engine-trading',
    context,
    config: { ...config, lookback, rsiPeriod },
    candles,
    decision,
    bias: sentiment > 0 ? 'bullish' : sentiment < 0 ? 'bearish' : 'neutral',
    confidence: 34 + (decision !== 'wait' ? 30 : 0),
    reasons: ['Sentiment engine — RSI + momentum composite', `Sentiment ${sentiment.toFixed(2)}`, decision !== 'wait' ? 'Sentiment-aligned entry' : 'Sentiment neutral'],
    metrics: { sentiment: Number(sentiment.toFixed(3)), rsi: Number(rsiNow.toFixed(1)) },
  });
};

export const evaluateCrossAssetFlowTradingEngine: StrategyEngine = (candles, config, context) => {
  const fastBars = Math.max(8, parseNumber(config.fastBars, 14));
  const slowBars = Math.max(fastBars + 8, parseNumber(config.slowBars, 32));
  const minSpread = parseNumber(config.minSpread, 0.15);
  const fastRoc = rocPct(candles, fastBars);
  const slowRoc = rocPct(candles, slowBars);
  const spread = fastRoc - slowRoc;
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (spread >= minSpread && slowRoc > 0 && last.close > last.open) decision = 'buy';
  if (spread <= -minSpread && slowRoc < 0 && last.close < last.open) decision = 'sell';
  return buildEvaluationResult({
    strategyId: 'cross-asset-flow-trading',
    context,
    config: { ...config, fastBars, slowBars, minSpread },
    candles,
    decision,
    bias: spread > 0 ? 'bullish' : spread < 0 ? 'bearish' : 'neutral',
    confidence: 35 + (decision !== 'wait' ? 28 : 0),
    reasons: ['Cross-asset flow — fast/slow ROC spread as flow proxy', `Flow spread ${spread.toFixed(2)}%`, decision !== 'wait' ? 'Cross-asset flow entry' : 'Flow spread insufficient'],
    metrics: { flowSpreadPct: Number(spread.toFixed(3)) },
  });
};
