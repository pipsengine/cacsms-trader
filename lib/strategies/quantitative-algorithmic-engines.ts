import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { adx, atr, bollinger, ema, macd, rsi } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rollingZScore(closes: number[], period: number): Array<number | null> {
  const series: Array<number | null> = Array.from({ length: closes.length }, () => null);
  for (let index = period - 1; index < closes.length; index += 1) {
    const window = closes.slice(index - period + 1, index + 1);
    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    series[index] = stdDev === 0 ? 0 : (closes[index]! - mean) / stdDev;
  }
  return series;
}

function barReturns(candles: StrategyPriceCandle[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const prev = candles[index - 1]!.close;
    returns.push(prev === 0 ? 0 : (candles[index]!.close - prev) / prev);
  }
  return returns;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function compositeTrendScore(
  candles: StrategyPriceCandle[],
  fastPeriod: number,
  slowPeriod: number,
  rsiPeriod: number,
): { bullScore: number; bearScore: number; bias: StrategyBias } {
  const closes = candles.map((item) => item.close);
  const last = closes.length - 1;
  const fast = ema(closes, fastPeriod)[last];
  const slow = ema(closes, slowPeriod)[last];
  const rsiNow = rsi(closes, rsiPeriod)[last];
  const priorClose = closes[last - 3];
  const roc = priorClose != null && priorClose !== 0 ? ((closes[last]! - priorClose) / priorClose) * 100 : 0;
  let bullScore = 0;
  let bearScore = 0;
  if (fast != null && slow != null && fast > slow) bullScore += 1;
  if (fast != null && slow != null && fast < slow) bearScore += 1;
  if (rsiNow != null && rsiNow > 52) bullScore += 1;
  if (rsiNow != null && rsiNow < 48) bearScore += 1;
  if (roc > 0.04) bullScore += 1;
  if (roc < -0.04) bearScore += 1;
  const bias: StrategyBias = bullScore > bearScore ? 'bullish' : bearScore > bullScore ? 'bearish' : 'neutral';
  return { bullScore, bearScore, bias };
}

export const evaluateAlgorithmicTradingEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(5, parseNumber(config.fastPeriod, 12));
  const slowPeriod = Math.max(fastPeriod + 2, parseNumber(config.slowPeriod, 26));
  const rsiPeriod = Math.max(7, parseNumber(config.rsiPeriod, 14));
  const minScore = parseNumber(config.minScore, 2);
  const { bullScore: baseBull, bearScore: baseBear, bias: scoreBias } = compositeTrendScore(candles, fastPeriod, slowPeriod, rsiPeriod);
  const { histogram } = macd(candles.map((item) => item.close));
  const hist = histogram[histogram.length - 1];
  let bullScore = baseBull;
  let bearScore = baseBear;
  if (hist != null && hist > 0) bullScore += 1;
  if (hist != null && hist < 0) bearScore += 1;
  let bias: StrategyBias = scoreBias;
  let decision: StrategySignalSide = 'wait';
  if (bullScore >= minScore && bullScore > bearScore) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearScore >= minScore && bearScore > bullScore) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'algorithmic-trading',
    context,
    config: { ...config, fastPeriod, slowPeriod, rsiPeriod, minScore },
    candles,
    decision,
    bias,
    confidence: 30 + Math.max(bullScore, bearScore) * 10 + (decision !== 'wait' ? 22 : 0),
    reasons: [
      'Algorithmic trading — fused EMA + RSI + ROC + MACD systematic score',
      `Bull score ${bullScore} / bear score ${bearScore} (min ${minScore})`,
      decision === 'buy' ? 'Systematic long signal threshold met' : decision === 'sell' ? 'Systematic short signal threshold met' : 'Composite score below execution threshold',
    ],
    metrics: { bullScore, bearScore, macdHist: hist != null ? Number(hist.toFixed(6)) : null },
  });
};

export const evaluateQuantitativeTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const zThreshold = parseNumber(config.zThreshold, 1.2);
  const momentumPeriod = Math.max(5, parseNumber(config.momentumPeriod, 10));
  const closes = candles.map((item) => item.close);
  const zScores = rollingZScore(closes, lookback);
  const last = closes.length - 1;
  const z = zScores[last];
  const momentum = closes[last - momentumPeriod] != null && closes[last - momentumPeriod] !== 0
    ? ((closes[last]! - closes[last - momentumPeriod]!) / closes[last - momentumPeriod]!) * 100
    : 0;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (z != null && z <= -zThreshold && momentum > -0.05) {
    bias = 'bullish';
    decision = 'buy';
  } else if (z != null && z >= zThreshold && momentum < 0.05) {
    bias = 'bearish';
    decision = 'sell';
  } else if (z != null && z < 0) {
    bias = 'bullish';
  } else if (z != null && z > 0) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'quantitative-trading',
    context,
    config: { ...config, lookback, zThreshold, momentumPeriod },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 0) + (z != null ? Math.min(18, Math.abs(z) * 8) : 0),
    reasons: [
      'Quantitative trading — z-score mean reversion with momentum filter',
      z != null ? `Z-score ${z.toFixed(2)} (threshold ±${zThreshold})` : 'Z-score unavailable',
      `Momentum ${momentum.toFixed(2)}% over ${momentumPeriod} bars`,
      decision === 'buy' ? 'Statistically cheap with non-negative momentum — long' : decision === 'sell' ? 'Statistically rich with non-positive momentum — short' : 'No quant factor alignment',
    ],
    metrics: {
      zScore: z != null ? Number(z.toFixed(3)) : null,
      momentumPct: Number(momentum.toFixed(3)),
    },
  });
};

export const evaluateHighFrequencyTradingHftEngine: StrategyEngine = (candles, config, context) => {
  const alignBars = Math.max(3, parseNumber(config.alignBars, 5));
  const fastPeriod = Math.max(3, parseNumber(config.fastPeriod, 5));
  const minAlign = parseNumber(config.minAlign, 0.65);
  const window = candles.slice(-alignBars);
  const upBars = window.filter((item) => item.close > item.open).length;
  const downBars = window.filter((item) => item.close < item.open).length;
  const alignUp = upBars / window.length;
  const alignDown = downBars / window.length;
  const closes = candles.map((item) => item.close);
  const fast = ema(closes, fastPeriod)[closes.length - 1];
  const close = closes[closes.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (alignUp >= minAlign && fast != null && close > fast) {
    bias = 'bullish';
    decision = 'buy';
  } else if (alignDown >= minAlign && fast != null && close < fast) {
    bias = 'bearish';
    decision = 'sell';
  } else if (alignUp > alignDown) {
    bias = 'bullish';
  } else if (alignDown > alignUp) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'high-frequency-trading-hft',
    context,
    config: { ...config, alignBars, fastPeriod, minAlign },
    candles,
    decision,
    bias,
    confidence: 28 + (decision !== 'wait' ? 34 : 6) + Math.round(Math.max(alignUp, alignDown) * 20),
    reasons: [
      `HFT proxy — ${alignBars}-bar micro alignment + EMA(${fastPeriod}) filter`,
      `Up alignment ${(alignUp * 100).toFixed(0)}% / down ${(alignDown * 100).toFixed(0)}%`,
      decision === 'buy' ? 'Microstructure aligned bullish — HFT long' : decision === 'sell' ? 'Microstructure aligned bearish — HFT short' : 'Micro structure not aligned for HFT entry',
    ],
    metrics: {
      alignUpPct: Number((alignUp * 100).toFixed(1)),
      alignDownPct: Number((alignDown * 100).toFixed(1)),
    },
  });
};

export const evaluateStatisticalArbitrageEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(5, parseNumber(config.fastPeriod, 10));
  const slowPeriod = Math.max(fastPeriod + 5, parseNumber(config.slowPeriod, 30));
  const zThreshold = parseNumber(config.zThreshold, 1.5);
  const closes = candles.map((item) => item.close);
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const spreads: number[] = [];
  for (let index = 0; index < closes.length; index += 1) {
    const f = fast[index];
    const s = slow[index];
    spreads.push(f != null && s != null ? f - s : 0);
  }
  const zScores = rollingZScore(spreads, slowPeriod);
  const last = closes.length - 1;
  const spreadZ = zScores[last];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (spreadZ != null && spreadZ <= -zThreshold) {
    bias = 'bullish';
    decision = 'buy';
  } else if (spreadZ != null && spreadZ >= zThreshold) {
    bias = 'bearish';
    decision = 'sell';
  } else if (spreadZ != null && spreadZ < 0) {
    bias = 'bullish';
  } else if (spreadZ != null && spreadZ > 0) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'statistical-arbitrage',
    context,
    config: { ...config, fastPeriod, slowPeriod, zThreshold },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 0) + (spreadZ != null ? Math.min(16, Math.abs(spreadZ) * 8) : 0),
    reasons: [
      'Statistical arbitrage — EMA spread z-score reversion (single-symbol proxy)',
      spreadZ != null ? `Spread z-score ${spreadZ.toFixed(2)} (threshold ±${zThreshold})` : 'Spread z-score unavailable',
      decision === 'buy' ? 'Spread compressed below mean — convergence long' : decision === 'sell' ? 'Spread extended above mean — convergence short' : 'Spread near equilibrium',
    ],
    metrics: {
      spreadZ: spreadZ != null ? Number(spreadZ.toFixed(3)) : null,
      fastEma: fast[last] != null ? Number(fast[last]!.toFixed(5)) : null,
      slowEma: slow[last] != null ? Number(slow[last]!.toFixed(5)) : null,
    },
  });
};

function mlFeatureVector(candles: StrategyPriceCandle[], rsiPeriod: number, adxPeriod: number) {
  const closes = candles.map((item) => item.close);
  const last = closes.length - 1;
  const rsiNow = rsi(closes, rsiPeriod)[last];
  const { histogram } = macd(closes);
  const hist = histogram[last];
  const adxValue = adx(candles, adxPeriod).adx[last];
  const rsiFeature = rsiNow != null ? (rsiNow - 50) / 50 : 0;
  const macdFeature = hist != null ? Math.tanh(hist * 1000) : 0;
  const adxFeature = adxValue != null ? (adxValue - 25) / 25 : 0;
  const rocBase = closes[last - 5];
  const rocFeature = rocBase != null && rocBase !== 0 ? Math.tanh(((closes[last]! - rocBase) / rocBase) * 20) : 0;
  return { rsiFeature, macdFeature, adxFeature, rocFeature, rsiNow, hist, adxValue };
}

export const evaluateMachineLearningTradingEngine: StrategyEngine = (candles, config, context) => {
  const rsiPeriod = Math.max(7, parseNumber(config.rsiPeriod, 14));
  const adxPeriod = Math.max(7, parseNumber(config.adxPeriod, 14));
  const threshold = parseNumber(config.threshold, 0.35);
  const { rsiFeature, macdFeature, adxFeature, rocFeature, rsiNow, hist, adxValue } = mlFeatureVector(candles, rsiPeriod, adxPeriod);
  const score = rsiFeature * 0.3 + macdFeature * 0.3 + adxFeature * 0.2 + rocFeature * 0.2;
  let bias: StrategyBias = score > 0.05 ? 'bullish' : score < -0.05 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (score >= threshold) decision = 'buy';
  if (score <= -threshold) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'machine-learning-trading',
    context,
    config: { ...config, rsiPeriod, adxPeriod, threshold },
    candles,
    decision,
    bias,
    confidence: 32 + (decision !== 'wait' ? 30 : 0) + Math.min(22, Math.abs(score) * 40),
    reasons: [
      'Machine learning trading — weighted feature classifier (RSI, MACD, ADX, ROC)',
      `Model score ${score.toFixed(3)} (threshold ±${threshold})`,
      rsiNow != null ? `RSI ${rsiNow.toFixed(1)} · MACD hist ${hist?.toFixed(6) ?? 'n/a'} · ADX ${adxValue?.toFixed(1) ?? 'n/a'}` : 'Features partially unavailable',
      decision === 'buy' ? 'ML classifier long signal' : decision === 'sell' ? 'ML classifier short signal' : 'Classifier score below threshold',
    ],
    metrics: { modelScore: Number(score.toFixed(4)) },
  });
};

export const evaluateAiBasedTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const minConfidence = parseNumber(config.minConfidence, 0.55);
  const closes = candles.map((item) => item.close);
  const z = rollingZScore(closes, lookback)[closes.length - 1];
  const { bullScore, bearScore } = compositeTrendScore(candles, 12, 26, 14);
  const trendNorm = (bullScore - bearScore) / 4;
  const reversionNorm = z != null ? -z / 3 : 0;
  const ensemble = sigmoid(trendNorm * 1.2 + reversionNorm * 0.8);
  const confidence = Math.abs(ensemble - 0.5) * 2;
  let bias: StrategyBias = ensemble > 0.52 ? 'bullish' : ensemble < 0.48 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (confidence >= minConfidence && ensemble >= 0.58) decision = 'buy';
  if (confidence >= minConfidence && ensemble <= 0.42) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'ai-based-trading',
    context,
    config: { ...config, lookback, minConfidence },
    candles,
    decision,
    bias,
    confidence: 30 + Math.round(confidence * 40) + (decision !== 'wait' ? 18 : 0),
    reasons: [
      'AI-based trading — ensemble of trend + mean-reversion factors',
      `Ensemble probability ${(ensemble * 100).toFixed(1)}% · confidence ${(confidence * 100).toFixed(0)}%`,
      z != null ? `Z-score reversion input ${z.toFixed(2)}` : 'Z-score unavailable',
      decision === 'buy' ? 'AI ensemble bullish with sufficient confidence' : decision === 'sell' ? 'AI ensemble bearish with sufficient confidence' : 'Ensemble confidence below threshold',
    ],
    metrics: {
      ensemblePct: Number((ensemble * 100).toFixed(1)),
      confidencePct: Number((confidence * 100).toFixed(1)),
    },
  });
};

export const evaluateNeuralNetworkTradingEngine: StrategyEngine = (candles, config, context) => {
  const hiddenScale = parseNumber(config.hiddenScale, 1.4);
  const threshold = parseNumber(config.threshold, 0.12);
  const { rsiFeature, macdFeature, adxFeature, rocFeature } = mlFeatureVector(candles, 14, 14);
  const hidden1 = Math.tanh(rsiFeature * hiddenScale + macdFeature * 0.8);
  const hidden2 = Math.tanh(adxFeature * hiddenScale + rocFeature * 0.9);
  const output = Math.tanh(hidden1 * 0.6 + hidden2 * 0.6);
  let bias: StrategyBias = output > 0.05 ? 'bullish' : output < -0.05 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (output >= threshold) decision = 'buy';
  if (output <= -threshold) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'neural-network-trading',
    context,
    config: { ...config, hiddenScale, threshold },
    candles,
    decision,
    bias,
    confidence: 32 + (decision !== 'wait' ? 30 : 0) + Math.min(22, Math.abs(output) * 50),
    reasons: [
      'Neural network trading — two-layer tanh feature network proxy',
      `Network output ${output.toFixed(3)} (threshold ±${threshold})`,
      `Hidden activations h1=${hidden1.toFixed(3)} h2=${hidden2.toFixed(3)}`,
      decision === 'buy' ? 'Neural net bullish activation — long' : decision === 'sell' ? 'Neural net bearish activation — short' : 'Network output below activation threshold',
    ],
    metrics: {
      networkOutput: Number(output.toFixed(4)),
      hidden1: Number(hidden1.toFixed(4)),
      hidden2: Number(hidden2.toFixed(4)),
    },
  });
};

export const evaluateSentimentAiTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(10, parseNumber(config.lookback, 20));
  const momentumThreshold = parseNumber(config.momentumThreshold, 0.08);
  const returns = barReturns(candles.slice(-lookback - 1));
  const positive = returns.filter((value) => value > 0).length;
  const sentiment = returns.length > 0 ? (positive / returns.length) * 2 - 1 : 0;
  const atrSeries = atr(candles, 14);
  const last = candles.length - 1;
  const atrNow = atrSeries[last] ?? 0;
  const atrPrev = atrSeries[last - lookback] ?? atrNow;
  const volExpansion = atrPrev > 0 ? (atrNow - atrPrev) / atrPrev : 0;
  const score = sentiment * 0.7 + Math.tanh(volExpansion * 3) * 0.3;
  let bias: StrategyBias = score > 0.1 ? 'bullish' : score < -0.1 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (score >= momentumThreshold) decision = 'buy';
  if (score <= -momentumThreshold) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'sentiment-ai-trading',
    context,
    config: { ...config, lookback, momentumThreshold },
    candles,
    decision,
    bias,
    confidence: 32 + (decision !== 'wait' ? 30 : 0) + Math.min(20, Math.abs(score) * 40),
    reasons: [
      'Sentiment AI — return polarity + volatility expansion sentiment proxy',
      `Sentiment score ${score.toFixed(3)} (${(sentiment * 100).toFixed(0)}% bullish bars)`,
      `Volatility expansion ${(volExpansion * 100).toFixed(1)}%`,
      decision === 'buy' ? 'Positive AI sentiment with expansion — long' : decision === 'sell' ? 'Negative AI sentiment — short' : 'Sentiment neutral',
    ],
    metrics: {
      sentimentScore: Number(score.toFixed(4)),
      bullishBarPct: Number(((sentiment + 1) / 2 * 100).toFixed(1)),
    },
  });
};

export const evaluateReinforcementLearningTradingEngine: StrategyEngine = (candles, config, context) => {
  const episodeBars = Math.max(8, parseNumber(config.episodeBars, 16));
  const rewardThreshold = parseNumber(config.rewardThreshold, 0.15);
  const returns = barReturns(candles.slice(-episodeBars - 1));
  const cumulativeReward = returns.reduce((sum, value) => sum + value, 0);
  const recentReward = returns.slice(-4).reduce((sum, value) => sum + value, 0);
  const policyScore = cumulativeReward * 0.6 + recentReward * 0.4;
  let bias: StrategyBias = policyScore > 0 ? 'bullish' : policyScore < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (policyScore >= rewardThreshold) decision = 'buy';
  if (policyScore <= -rewardThreshold) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'reinforcement-learning-trading',
    context,
    config: { ...config, episodeBars, rewardThreshold },
    candles,
    decision,
    bias,
    confidence: 30 + (decision !== 'wait' ? 32 : 0) + Math.min(22, Math.abs(policyScore) * 80),
    reasons: [
      `Reinforcement learning — ${episodeBars}-bar cumulative reward policy proxy`,
      `Policy score ${policyScore.toFixed(4)} (threshold ±${rewardThreshold})`,
      `Episode reward ${(cumulativeReward * 100).toFixed(2)}% · recent ${(recentReward * 100).toFixed(2)}%`,
      decision === 'buy' ? 'RL policy favors long action' : decision === 'sell' ? 'RL policy favors short action' : 'Policy reward below action threshold',
    ],
    metrics: {
      policyScore: Number(policyScore.toFixed(5)),
      cumulativeRewardPct: Number((cumulativeReward * 100).toFixed(3)),
    },
  });
};

export const evaluateGridAlgorithmsEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(25, parseNumber(config.lookback, 50));
  const gridLevels = Math.max(4, parseNumber(config.gridLevels, 8));
  const edgePct = parseNumber(config.edgePct, 12);
  const window = candles.slice(-lookback, -1);
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const step = Math.max((rangeHigh - rangeLow) / gridLevels, 0.00001);
  const last = candles[candles.length - 1]!;
  const positionPct = ((last.close - rangeLow) / (rangeHigh - rangeLow)) * 100;
  const nearestGrid = rangeLow + Math.round((last.close - rangeLow) / step) * step;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (positionPct <= edgePct && last.close >= nearestGrid - step * 0.1) {
    bias = 'bullish';
    decision = 'buy';
  } else if (positionPct >= 100 - edgePct && last.close <= nearestGrid + step * 0.1) {
    bias = 'bearish';
    decision = 'sell';
  } else if (positionPct < 50) {
    bias = 'bullish';
  } else {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'grid-algorithms',
    context,
    config: { ...config, lookback, gridLevels, edgePct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 30 : 6),
    reasons: [
      `Grid algorithm — ${gridLevels}-level range grid with edge execution`,
      `Range ${rangeLow.toFixed(5)} – ${rangeHigh.toFixed(5)} · step ${step.toFixed(5)}`,
      `Price at ${positionPct.toFixed(0)}% · nearest grid ${nearestGrid.toFixed(5)}`,
      decision === 'buy' ? 'Grid buy at lower lattice band' : decision === 'sell' ? 'Grid sell at upper lattice band' : 'Mid-grid — no lattice entry',
    ],
    metrics: {
      gridLevels,
      step: Number(step.toFixed(5)),
      positionPct: Number(positionPct.toFixed(1)),
    },
  });
};

export const evaluateMartingaleSystemsEngine: StrategyEngine = (candles, config, context) => {
  const lossStreak = Math.max(2, parseNumber(config.lossStreak, 3));
  const reversionZ = parseNumber(config.reversionZ, 1.0);
  const closes = candles.map((item) => item.close);
  let consecutiveDown = 0;
  for (let index = closes.length - 1; index >= 1; index -= 1) {
    if (closes[index]! < closes[index - 1]!) consecutiveDown += 1;
    else break;
  }
  const z = rollingZScore(closes, 30)[closes.length - 1];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (consecutiveDown >= lossStreak && z != null && z <= -reversionZ) {
    bias = 'bullish';
    decision = 'buy';
  } else if (consecutiveDown >= lossStreak) {
    bias = 'bullish';
  } else {
    const consecutiveUp = (() => {
      let count = 0;
      for (let index = closes.length - 1; index >= 1; index -= 1) {
        if (closes[index]! > closes[index - 1]!) count += 1;
        else break;
      }
      return count;
    })();
    if (consecutiveUp >= lossStreak && z != null && z >= reversionZ) {
      bias = 'bearish';
      decision = 'sell';
    } else if (consecutiveUp >= lossStreak) {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'martingale-systems',
    context,
    config: { ...config, lossStreak, reversionZ },
    candles,
    decision,
    bias,
    confidence: 32 + (decision !== 'wait' ? 34 : 0) + Math.min(14, consecutiveDown * 3),
    reasons: [
      'Martingale systems — loss-streak mean reversion entry (signal-only proxy)',
      `Consecutive down closes ${consecutiveDown} (trigger ${lossStreak})`,
      z != null ? `Z-score ${z.toFixed(2)} vs reversion threshold -${reversionZ}` : 'Z-score unavailable',
      decision === 'buy' ? 'Loss streak + statistical stretch — counter-trend long' : decision === 'sell' ? 'Win streak stretch — counter-trend short' : 'No martingale reversion trigger',
    ],
    metrics: {
      consecutiveDown,
      zScore: z != null ? Number(z.toFixed(3)) : null,
    },
  });
};

export const evaluateAntiMartingaleSystemsEngine: StrategyEngine = (candles, config, context) => {
  const winStreak = Math.max(2, parseNumber(config.winStreak, 3));
  const trendPeriod = Math.max(10, parseNumber(config.trendPeriod, 20));
  const closes = candles.map((item) => item.close);
  let consecutiveUp = 0;
  for (let index = closes.length - 1; index >= 1; index -= 1) {
    if (closes[index]! > closes[index - 1]!) consecutiveUp += 1;
    else break;
  }
  let consecutiveDown = 0;
  for (let index = closes.length - 1; index >= 1; index -= 1) {
    if (closes[index]! < closes[index - 1]!) consecutiveDown += 1;
    else break;
  }
  const trendEma = ema(closes, trendPeriod)[closes.length - 1];
  const close = closes[closes.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (consecutiveUp >= winStreak && trendEma != null && close > trendEma) {
    bias = 'bullish';
    decision = 'buy';
  } else if (consecutiveDown >= winStreak && trendEma != null && close < trendEma) {
    bias = 'bearish';
    decision = 'sell';
  } else if (trendEma != null && close > trendEma) {
    bias = 'bullish';
  } else if (trendEma != null && close < trendEma) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'anti-martingale-systems',
    context,
    config: { ...config, winStreak, trendPeriod },
    candles,
    decision,
    bias,
    confidence: 33 + (decision !== 'wait' ? 32 : 0) + Math.min(16, Math.max(consecutiveUp, consecutiveDown) * 4),
    reasons: [
      'Anti-martingale — pyramid with winning streak in trend direction',
      `Consecutive up ${consecutiveUp} / down ${consecutiveDown} (trigger ${winStreak})`,
      trendEma != null ? `Close ${close.toFixed(5)} vs EMA(${trendPeriod}) ${trendEma.toFixed(5)}` : 'Trend EMA unavailable',
      decision === 'buy' ? 'Win streak + trend — add long exposure signal' : decision === 'sell' ? 'Loss streak + downtrend — add short exposure signal' : 'No anti-martingale pyramid trigger',
    ],
    metrics: {
      consecutiveUp,
      consecutiveDown,
      trendEma: trendEma != null ? Number(trendEma.toFixed(5)) : null,
    },
  });
};

export const evaluateVolatilityAlgorithmsEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 20));
  const expansionThreshold = parseNumber(config.expansionThreshold, 1.15);
  const compressionThreshold = parseNumber(config.compressionThreshold, 0.85);
  const closes = candles.map((item) => item.close);
  const bands = bollinger(closes, period, 2);
  const last = closes.length - 1;
  const bandwidth = bands.bandwidth[last];
  const priorBandwidth = bands.bandwidth[last - period] ?? bandwidth;
  const atrSeries = atr(candles, period);
  const atrNow = atrSeries[last];
  const atrPrev = atrSeries[last - period] ?? atrNow;
  const bwRatio = bandwidth != null && priorBandwidth != null && priorBandwidth > 0 ? bandwidth / priorBandwidth : 1;
  const atrRatio = atrNow != null && atrPrev != null && atrPrev > 0 ? atrNow / atrPrev : 1;
  const expanding = bwRatio >= expansionThreshold || atrRatio >= expansionThreshold;
  const compressing = bwRatio <= compressionThreshold && atrRatio <= compressionThreshold;
  const close = closes[last]!;
  const upper = bands.upper[last];
  const lower = bands.lower[last];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (expanding && upper != null && close > upper) {
    bias = 'bullish';
    decision = 'buy';
  } else if (expanding && lower != null && close < lower) {
    bias = 'bearish';
    decision = 'sell';
  } else if (compressing) {
    bias = 'neutral';
  } else if (close > (upper ?? close)) {
    bias = 'bullish';
  } else if (close < (lower ?? close)) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'volatility-algorithms',
    context,
    config: { ...config, period, expansionThreshold, compressionThreshold },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 0) + (expanding ? 10 : compressing ? -4 : 4),
    reasons: [
      'Volatility algorithms — bandwidth/ATR regime expansion breakout model',
      bandwidth != null ? `Bandwidth ${bandwidth.toFixed(2)}% · ratio ${bwRatio.toFixed(2)}` : 'Bandwidth unavailable',
      expanding ? 'Volatility expanding — breakout regime' : compressing ? 'Volatility compressing — squeeze regime' : 'Normal volatility regime',
      decision === 'buy' ? 'Expansion breakout above upper band — long' : decision === 'sell' ? 'Expansion breakdown below lower band — short' : 'No volatility breakout entry',
    ],
    metrics: {
      bandwidth: bandwidth != null ? Number(bandwidth.toFixed(3)) : null,
      bwRatio: Number(bwRatio.toFixed(3)),
      atrRatio: Number(atrRatio.toFixed(3)),
    },
  });
};
