import type { StrategyPriceCandle } from './strategy-candle-loader';
import { strategyCandlesToReconstructed } from './strategy-candle-adapter';
import { analyzeTrendlines, type TrendlineDetection } from '@/lib/trendline-detection-engine';
import { analyzeSwingPoints } from '@/lib/swing-point-engine';
import {
  analyzeMultiTimeframe,
  MTF_TIMEFRAMES,
  type MtfTimeframe,
} from '@/lib/multi-timeframe-analysis-engine';
import {
  adx,
  atr,
  bollinger,
  crossover,
  ema,
  macd,
  rsi,
  sma,
  stochastic,
  supertrend,
  ichimoku,
} from './indicators';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyEngineContext,
  type StrategyEvaluationResult,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';

const DEFAULTS = {
  symbol: 'EURUSD',
  timeframe: 'H1',
};

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function contextFromConfig(config: Record<string, unknown>): StrategyEngineContext {
  return {
    symbol: String(config.symbol ?? DEFAULTS.symbol).toUpperCase(),
    timeframe: String(config.timeframe ?? DEFAULTS.timeframe).toUpperCase() as StrategyEngineContext['timeframe'],
  };
}

export const evaluateMovingAverageCrossoverEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(2, parseNumber(config.fastPeriod, 9));
  const slowPeriod = Math.max(fastPeriod + 1, parseNumber(config.slowPeriod, 21));
  const maType = String(config.maType ?? 'ema').toLowerCase() === 'sma' ? 'sma' : 'ema';
  const closes = candles.map((item) => item.close);
  const fastSeries = maType === 'sma' ? sma(closes, fastPeriod) : ema(closes, fastPeriod);
  const slowSeries = maType === 'sma' ? sma(closes, slowPeriod) : ema(closes, slowPeriod);
  const last = closes.length - 1;
  const fastMa = fastSeries[last];
  const slowMa = slowSeries[last];
  const signal = crossover(
    fastSeries[last - 1] ?? null,
    fastMa,
    slowSeries[last - 1] ?? null,
    slowMa,
  );
  const bias = fastMa != null && slowMa != null
    ? fastMa > slowMa ? 'bullish' : fastMa < slowMa ? 'bearish' : 'neutral'
    : 'neutral';
  const spreadPct = fastMa != null && slowMa != null && slowMa !== 0
    ? Math.abs((fastMa - slowMa) / slowMa) * 100
    : 0;
  const decision = signal === 'bullish_cross' || (signal === 'none' && bias === 'bullish')
    ? 'buy'
    : signal === 'bearish_cross' || (signal === 'none' && bias === 'bearish')
      ? 'sell'
      : 'wait';

  return buildEvaluationResult({
    strategyId: 'moving-average-crossover',
    context,
    config: { ...config, fastPeriod, slowPeriod, maType },
    candles,
    decision,
    bias,
    confidence: 42 + (signal !== 'none' ? 24 : 0) + Math.min(20, spreadPct * 400),
    reasons: [
      `${maType.toUpperCase()}(${fastPeriod}) vs ${maType.toUpperCase()}(${slowPeriod}) institutional crossover scan`,
      bias === 'bullish' ? 'Fast average above slow — trend continuation bias' : bias === 'bearish' ? 'Fast average below slow — distribution bias' : 'Averages converging — wait for expansion',
      signal !== 'none' ? `Fresh ${signal.replace('_', ' ')} on latest bar` : 'No fresh crossover on latest bar',
    ],
    metrics: {
      fastMa: fastMa != null ? Number(fastMa.toFixed(5)) : null,
      slowMa: slowMa != null ? Number(slowMa.toFixed(5)) : null,
      spread: fastMa != null && slowMa != null ? Number((fastMa - slowMa).toFixed(5)) : null,
    },
    events: signal !== 'none'
      ? [{ label: signal.replace('_', ' '), detail: `Close ${closes[last]?.toFixed(5)}`, tone: signal === 'bullish_cross' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateEmaPullbackEngine: StrategyEngine = (candles, config, context) => {
  const trendPeriod = Math.max(20, parseNumber(config.trendPeriod, 50));
  const pullbackPeriod = Math.max(5, parseNumber(config.pullbackPeriod, 21));
  const tolerancePct = parseNumber(config.tolerancePct, 0.15);
  const closes = candles.map((item) => item.close);
  const trendEma = ema(closes, trendPeriod);
  const pullbackEma = ema(closes, pullbackPeriod);
  const last = closes.length - 1;
  const close = closes[last];
  const trend = trendEma[last];
  const pullback = pullbackEma[last];
  const atrSeries = atr(candles, 14);
  const atrNow = atrSeries[last];

  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (trend != null && pullback != null) {
    bias = close > trend ? 'bullish' : close < trend ? 'bearish' : 'neutral';
    const distancePct = Math.abs((close - pullback) / close) * 100;
    const touchedPullback = distancePct <= tolerancePct;
    if (bias === 'bullish' && touchedPullback && close >= pullback) decision = 'buy';
    if (bias === 'bearish' && touchedPullback && close <= pullback) decision = 'sell';
  }

  const confidence = 38
    + (decision !== 'wait' ? 28 : 0)
    + (atrNow != null ? Math.min(15, (atrNow / close) * 10_000) : 0);

  return buildEvaluationResult({
    strategyId: 'ema-pullback-strategy',
    context,
    config: { ...config, trendPeriod, pullbackPeriod, tolerancePct },
    candles,
    decision,
    bias,
    confidence,
    reasons: [
      `Institutional EMA pullback model: EMA(${trendPeriod}) trend filter + EMA(${pullbackPeriod}) value zone`,
      bias === 'bullish' ? 'Price above trend EMA — only long pullbacks considered' : bias === 'bearish' ? 'Price below trend EMA — only short pullbacks considered' : 'No dominant higher-timeframe trend',
      decision === 'buy' ? 'Price reclaimed pullback EMA from above — continuation long' : decision === 'sell' ? 'Price rejected pullback EMA from below — continuation short' : 'Pullback not confirmed within tolerance band',
    ],
    metrics: {
      trendEma: trend != null ? Number(trend.toFixed(5)) : null,
      pullbackEma: pullback != null ? Number(pullback.toFixed(5)) : null,
      atr: atrNow != null ? Number(atrNow.toFixed(5)) : null,
    },
  });
};

export const evaluateMacdTrendEngine: StrategyEngine = (candles, config, context) => {
  const closes = candles.map((item) => item.close);
  const fastPeriod = Math.max(5, parseNumber(config.fastPeriod, 12));
  const slowPeriod = Math.max(fastPeriod + 1, parseNumber(config.slowPeriod, 26));
  const signalPeriod = Math.max(3, parseNumber(config.signalPeriod, 9));
  const { macd: macdLine, signal, histogram } = macd(closes, fastPeriod, slowPeriod, signalPeriod);
  const last = closes.length - 1;
  const cross = crossover(macdLine[last - 1], macdLine[last], signal[last - 1], signal[last]);
  const hist = histogram[last];
  const bias = hist != null ? hist > 0 ? 'bullish' : hist < 0 ? 'bearish' : 'neutral' : 'neutral';
  const decision = cross === 'bullish_cross' ? 'buy' : cross === 'bearish_cross' ? 'sell' : bias === 'bullish' ? 'buy' : bias === 'bearish' ? 'sell' : 'wait';

  return buildEvaluationResult({
    strategyId: 'macd-trend-strategy',
    context,
    config: { ...config, fastPeriod, slowPeriod, signalPeriod },
    candles,
    decision,
    bias,
    confidence: 40 + (cross !== 'none' ? 25 : 0) + Math.min(20, Math.abs(hist ?? 0) * 10_000),
    reasons: [
      `MACD(${fastPeriod},${slowPeriod},${signalPeriod}) institutional momentum model`,
      cross !== 'none' ? `Signal line ${cross.replace('_', ' ')} detected` : 'No fresh MACD signal crossover',
      hist != null && hist > 0 ? 'Histogram expansion supports bullish momentum' : hist != null && hist < 0 ? 'Histogram compression supports bearish momentum' : 'Histogram neutral',
    ],
    metrics: {
      macd: macdLine[last] != null ? Number(macdLine[last]!.toFixed(6)) : null,
      signal: signal[last] != null ? Number(signal[last]!.toFixed(6)) : null,
      histogram: hist != null ? Number(hist.toFixed(6)) : null,
    },
    events: cross !== 'none'
      ? [{ label: cross.replace('_', ' '), detail: 'MACD / signal crossover', tone: cross === 'bullish_cross' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateIchimokuTrendEngine: StrategyEngine = (candles, config, context) => {
  const tenkanPeriod = Math.max(5, parseNumber(config.tenkanPeriod, 9));
  const kijunPeriod = Math.max(tenkanPeriod + 1, parseNumber(config.kijunPeriod, 26));
  const senkouBPeriod = Math.max(kijunPeriod + 1, parseNumber(config.senkouBPeriod, 52));
  const displacement = 26;
  const { tenkan, kijun, senkouA, senkouB } = ichimoku(candles, tenkanPeriod, kijunPeriod, senkouBPeriod, displacement);
  const last = candles.length - 1;
  const close = candles[last].close;
  const spanA = senkouA[last];
  const spanB = senkouB[last];
  const tenkanNow = tenkan[last];
  const kijunNow = kijun[last];
  const cloudTop = spanA != null && spanB != null ? Math.max(spanA, spanB) : null;
  const cloudBottom = spanA != null && spanB != null ? Math.min(spanA, spanB) : null;
  const aboveCloud = cloudTop != null && close > cloudTop;
  const belowCloud = cloudBottom != null && close < cloudBottom;
  const inCloud = !aboveCloud && !belowCloud;
  const cloudBullish = spanA != null && spanB != null && spanA > spanB;
  const cloudBearish = spanA != null && spanB != null && spanA < spanB;
  const tkCross = crossover(tenkan[last - 1], tenkanNow, kijun[last - 1], kijunNow);
  const tenkanAboveKijun = tenkanNow != null && kijunNow != null && tenkanNow > kijunNow;
  const chikouBullish = last >= displacement && close > candles[last - displacement].close;
  const chikouBearish = last >= displacement && close < candles[last - displacement].close;

  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (aboveCloud && tenkanAboveKijun) bias = 'bullish';
  else if (belowCloud && !tenkanAboveKijun && tenkanNow != null && kijunNow != null) bias = 'bearish';
  else if (aboveCloud) bias = 'bullish';
  else if (belowCloud) bias = 'bearish';
  else if (tenkanAboveKijun) bias = 'bullish';
  else if (tenkanNow != null && kijunNow != null && tenkanNow < kijunNow) bias = 'bearish';

  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (tkCross === 'bullish_cross' && (aboveCloud || cloudBullish)) decision = 'buy';
  else if (tkCross === 'bearish_cross' && (belowCloud || cloudBearish)) decision = 'sell';
  else if (aboveCloud && tenkanAboveKijun && cloudBullish) decision = 'buy';
  else if (belowCloud && !tenkanAboveKijun && cloudBearish) decision = 'sell';
  else if (aboveCloud && tenkanAboveKijun) decision = 'buy';
  else if (belowCloud && tenkanNow != null && kijunNow != null && tenkanNow < kijunNow) decision = 'sell';
  else if (inCloud) decision = 'wait';

  const alignmentScore = [
    aboveCloud || belowCloud,
    tenkanAboveKijun || (tenkanNow != null && kijunNow != null && tenkanNow < kijunNow),
    cloudBullish || cloudBearish,
    chikouBullish || chikouBearish,
  ].filter(Boolean).length;

  const events = tkCross !== 'none'
    ? [{ label: tkCross.replace('_', ' '), detail: 'Tenkan / Kijun crossover', tone: tkCross === 'bullish_cross' ? 'emerald' as const : 'rose' as const, barIndex: last }]
    : [];

  return buildEvaluationResult({
    strategyId: 'ichimoku-trend-strategy',
    context,
    config: { ...config, tenkanPeriod, kijunPeriod, senkouBPeriod, displacement },
    candles,
    decision,
    bias,
    confidence: 38 + alignmentScore * 12 + (tkCross !== 'none' ? 16 : 0),
    reasons: [
      `Ichimoku(${tenkanPeriod},${kijunPeriod},${senkouBPeriod}) institutional cloud model`,
      aboveCloud
        ? 'Price above Kumo — bullish regime'
        : belowCloud
          ? 'Price below Kumo — bearish regime'
          : 'Price inside cloud — transitional / wait',
      tkCross !== 'none'
        ? `Tenkan/Kijun ${tkCross.replace('_', ' ')} on latest bar`
        : tenkanAboveKijun
          ? 'Tenkan above Kijun — bullish momentum'
          : tenkanNow != null && kijunNow != null && tenkanNow < kijunNow
            ? 'Tenkan below Kijun — bearish momentum'
            : 'TK lines converging',
      chikouBullish
        ? 'Chikou span above price 26 bars ago — bullish confirmation'
        : chikouBearish
          ? 'Chikou span below price 26 bars ago — bearish confirmation'
          : 'Chikou confirmation neutral',
    ],
    metrics: {
      tenkan: tenkanNow != null ? Number(tenkanNow.toFixed(5)) : null,
      kijun: kijunNow != null ? Number(kijunNow.toFixed(5)) : null,
      senkouA: spanA != null ? Number(spanA.toFixed(5)) : null,
      senkouB: spanB != null ? Number(spanB.toFixed(5)) : null,
      cloudPosition: aboveCloud ? 'above' : belowCloud ? 'below' : 'inside',
      tkCross: tkCross === 'none' ? null : tkCross,
    },
    events,
  });
};

export const evaluateSupertrendEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(5, parseNumber(config.period, 10));
  const multiplier = parseNumber(config.multiplier, 2);
  const { trend, value } = supertrend(candles, period, multiplier);
  const last = candles.length - 1;
  const currentTrend = trend[last];
  const prevTrend = trend[last - 1];
  const flipped = currentTrend != null && prevTrend != null && currentTrend !== prevTrend;
  const bias = currentTrend === 'bullish' ? 'bullish' : currentTrend === 'bearish' ? 'bearish' : 'neutral';
  const decision = flipped
    ? currentTrend === 'bullish' ? 'buy' : 'sell'
    : bias === 'bullish' ? 'buy' : bias === 'bearish' ? 'sell' : 'wait';

  return buildEvaluationResult({
    strategyId: 'supertrend-strategy',
    context,
    config: { ...config, period, multiplier },
    candles,
    decision,
    bias,
    confidence: 44 + (flipped ? 28 : 12),
    reasons: [
      `ATR-adaptive SuperTrend(${period}, ${multiplier}) institutional trail`,
      flipped ? `Trend flip to ${currentTrend} on latest bar` : `Trend remains ${currentTrend ?? 'undefined'}`,
      `SuperTrend value ${value[last]?.toFixed(5) ?? '—'} vs close ${candles[last].close.toFixed(5)}`,
    ],
    metrics: {
      supertrend: value[last] != null ? Number(value[last]!.toFixed(5)) : null,
      trend: currentTrend ?? null,
    },
    events: flipped
      ? [{ label: `${currentTrend} flip`, detail: 'SuperTrend regime change', tone: currentTrend === 'bullish' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateRsiEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(5, parseNumber(config.period, 14));
  const oversold = parseNumber(config.oversold, 30);
  const overbought = parseNumber(config.overbought, 70);
  const closes = candles.map((item) => item.close);
  const rsiSeries = rsi(closes, period);
  const last = closes.length - 1;
  const value = rsiSeries[last];
  const prev = rsiSeries[last - 1];
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (value != null) {
    if (value >= 55) bias = 'bullish';
    else if (value <= 45) bias = 'bearish';
    if (prev != null && prev <= oversold && value > oversold) decision = 'buy';
    if (prev != null && prev >= overbought && value < overbought) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'rsi-strategy',
    context,
    config: { ...config, period, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 0) + (value != null ? Math.min(20, Math.abs(value - 50) / 2) : 0),
    reasons: [
      `RSI(${period}) mean-reversion / momentum hybrid`,
      value != null ? `Current RSI ${value.toFixed(1)} (${oversold}/${overbought} bands)` : 'Insufficient RSI history',
      decision === 'buy' ? 'Bullish reversal from oversold' : decision === 'sell' ? 'Bearish reversal from overbought' : 'No band rejection signal',
    ],
    metrics: { rsi: value != null ? Number(value.toFixed(2)) : null },
  });
};

export const evaluateLondonBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(12, parseNumber(config.lookback, 24));
  const bufferPct = parseNumber(config.bufferPct, 0.05);
  const window = candles.slice(-lookback);
  const sessionHigh = Math.max(...window.map((item) => item.high));
  const sessionLow = Math.min(...window.map((item) => item.low));
  const last = candles[candles.length - 1];
  const buffer = last.close * (bufferPct / 100);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (last.close > sessionHigh - buffer) {
    bias = 'bullish';
    if (last.close > sessionHigh) decision = 'buy';
  } else if (last.close < sessionLow + buffer) {
    bias = 'bearish';
    if (last.close < sessionLow) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'london-breakout',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 40 + (decision !== 'wait' ? 32 : 8),
    reasons: [
      `Session range breakout over last ${lookback} bars (London-style institutional box)`,
      `Range high ${sessionHigh.toFixed(5)} / low ${sessionLow.toFixed(5)}`,
      decision === 'buy' ? 'Close broke above session high with buffer' : decision === 'sell' ? 'Close broke below session low with buffer' : 'Price inside session range — no breakout confirmation',
    ],
    metrics: {
      sessionHigh: Number(sessionHigh.toFixed(5)),
      sessionLow: Number(sessionLow.toFixed(5)),
      range: Number((sessionHigh - sessionLow).toFixed(5)),
    },
  });
};

export const evaluateBollingerSqueezeEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 20));
  const stdDev = parseNumber(config.stdDev, 2);
  const squeezeThreshold = parseNumber(config.squeezeThreshold, 1.2);
  const closes = candles.map((item) => item.close);
  const bands = bollinger(closes, period, stdDev);
  const last = closes.length - 1;
  const bandwidth = bands.bandwidth[last];
  const upper = bands.upper[last];
  const lower = bands.lower[last];
  const close = closes[last];
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  const squeezed = bandwidth != null && bandwidth <= squeezeThreshold;
  if (!squeezed && upper != null && lower != null) {
    if (close > upper) {
      bias = 'bullish';
      decision = 'buy';
    } else if (close < lower) {
      bias = 'bearish';
      decision = 'sell';
    }
  }

  return buildEvaluationResult({
    strategyId: 'bollinger-band-squeeze-breakout',
    context,
    config: { ...config, period, stdDev, squeezeThreshold },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 35 : 0) + (squeezed ? 10 : 0),
    reasons: [
      `Bollinger(${period}, ${stdDev}) volatility compression → expansion model`,
      bandwidth != null ? `Bandwidth ${bandwidth.toFixed(2)}% vs squeeze threshold ${squeezeThreshold}%` : 'Bandwidth unavailable',
      squeezed ? 'Volatility squeeze active — awaiting expansion break' : decision !== 'wait' ? 'Expansion breakout confirmed' : 'No squeeze breakout on latest bar',
    ],
    metrics: {
      bandwidth: bandwidth != null ? Number(bandwidth.toFixed(3)) : null,
      upper: upper != null ? Number(upper.toFixed(5)) : null,
      lower: lower != null ? Number(lower.toFixed(5)) : null,
    },
  });
};

export const evaluateOrderBlockEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const displacementMultiple = parseNumber(config.displacementMultiple, 1.6);
  const atrSeries = atr(candles, 14);
  const last = candles.length - 1;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  let blockHigh: number | null = null;
  let blockLow: number | null = null;

  for (let index = last - 3; index >= Math.max(2, last - lookback); index -= 1) {
    const atrNow = atrSeries[index] ?? 0;
    const body = Math.abs(candles[index].close - candles[index].open);
    const displacement = body >= atrNow * displacementMultiple;
    if (!displacement) continue;
    const bullish = candles[index].close > candles[index].open;
    const bearish = candles[index].close < candles[index].open;
    if (bullish) {
      blockLow = Math.min(candles[index].open, candles[index].close);
      blockHigh = candles[index].high;
      bias = 'bullish';
      if (candles[last].low <= blockHigh && candles[last].close > blockLow) decision = 'buy';
      break;
    }
    if (bearish) {
      blockHigh = Math.max(candles[index].open, candles[index].close);
      blockLow = candles[index].low;
      bias = 'bearish';
      if (candles[last].high >= blockLow && candles[last].close < blockHigh) decision = 'sell';
      break;
    }
  }

  return buildEvaluationResult({
    strategyId: 'order-block-trading',
    context,
    config: { ...config, lookback, displacementMultiple },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 36 : 0) + (blockHigh != null ? 12 : 0),
    reasons: [
      'Smart-money order block model using displacement candle + mitigation retest',
      blockHigh != null && blockLow != null ? `Active block zone ${blockLow.toFixed(5)} – ${blockHigh.toFixed(5)}` : 'No qualifying displacement block in lookback window',
      decision === 'buy' ? 'Bullish mitigation into demand block' : decision === 'sell' ? 'Bearish mitigation into supply block' : 'Awaiting block retest',
    ],
    metrics: {
      blockHigh: blockHigh != null ? Number(blockHigh.toFixed(5)) : null,
      blockLow: blockLow != null ? Number(blockLow.toFixed(5)) : null,
    },
  });
};

export const evaluateAdxTrendEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(7, parseNumber(config.period, 14));
  const threshold = parseNumber(config.threshold, 25);
  const { adx: adxSeries, plusDi, minusDi } = adx(candles, period);
  const last = candles.length - 1;
  const adxValue = adxSeries[last];
  const pdi = plusDi[last];
  const mdi = minusDi[last];
  const strongTrend = adxValue != null && adxValue >= threshold;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (pdi != null && mdi != null) {
    bias = pdi > mdi ? 'bullish' : pdi < mdi ? 'bearish' : 'neutral';
    if (strongTrend && bias === 'bullish') decision = 'buy';
    if (strongTrend && bias === 'bearish') decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'adx-trend-strategy',
    context,
    config: { ...config, period, threshold },
    candles,
    decision,
    bias,
    confidence: 34 + (strongTrend ? 28 : 0) + (adxValue != null ? Math.min(24, adxValue / 2) : 0),
    reasons: [
      `ADX(${period}) institutional trend-strength filter (threshold ${threshold})`,
      adxValue != null ? `ADX ${adxValue.toFixed(1)} — ${strongTrend ? 'directional regime active' : 'weak / ranging regime'}` : 'ADX unavailable',
      pdi != null && mdi != null ? `+DI ${pdi.toFixed(1)} vs -DI ${mdi.toFixed(1)}` : 'Directional index unavailable',
    ],
    metrics: {
      adx: adxValue != null ? Number(adxValue.toFixed(2)) : null,
      plusDi: pdi != null ? Number(pdi.toFixed(2)) : null,
      minusDi: mdi != null ? Number(mdi.toFixed(2)) : null,
    },
  });
};

export const evaluate200EmaTrendEngine: StrategyEngine = (candles, config, context) => {
  const targetPeriod = Math.max(100, parseNumber(config.period, 200));
  const slopeLookback = Math.max(2, parseNumber(config.slopeLookback, 5));
  const closes = candles.map((item) => item.close);
  const maxPeriod = Math.max(50, closes.length - slopeLookback - 1);
  const period = Math.min(targetPeriod, maxPeriod);
  const usingProxy = period < targetPeriod;
  const emaSeries = ema(closes, period);
  const last = closes.length - 1;
  const emaNow = emaSeries[last];
  const emaPrev = emaSeries[last - slopeLookback];
  const emaPrior = emaSeries[last - 1];
  const close = closes[last];
  const prevClose = closes[last - 1];
  const priceCross = crossover(prevClose, close, emaPrior, emaNow);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (emaNow != null && emaPrev != null) {
    const rising = emaNow > emaPrev;
    const falling = emaNow < emaPrev;
    if (close > emaNow && rising) {
      bias = 'bullish';
      decision = 'buy';
    } else if (close < emaNow && falling) {
      bias = 'bearish';
      decision = 'sell';
    } else if (close > emaNow) {
      bias = 'bullish';
      decision = priceCross === 'bullish_cross' ? 'buy' : 'wait';
    } else if (close < emaNow) {
      bias = 'bearish';
      decision = priceCross === 'bearish_cross' ? 'sell' : 'wait';
    }
  }

  const slopePct = emaNow != null && emaPrev != null && emaPrev !== 0
    ? ((emaNow - emaPrev) / emaPrev) * 100
    : 0;

  return buildEvaluationResult({
    strategyId: '200-ema-trend-strategy',
    context,
    config: { ...config, period, targetPeriod, slopeLookback, usingProxy },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 30 : 8) + (priceCross !== 'none' ? 12 : 0) + (emaNow != null ? Math.min(18, Math.abs((close - emaNow) / close) * 5000) : 0),
    reasons: [
      usingProxy
        ? `EMA(${period}) proxy active — ${closes.length} bars in capture; full EMA(${targetPeriod}) needs wider history`
        : `Institutional EMA(${period}) long-horizon trend filter`,
      emaNow != null && emaPrev != null ? `EMA slope ${emaNow > emaPrev ? 'rising' : emaNow < emaPrev ? 'falling' : 'flat'} (${slopePct.toFixed(3)}%)` : 'EMA slope unavailable',
      close > (emaNow ?? close) ? 'Price above EMA — institutional bid support' : 'Price below EMA — institutional offer pressure',
      priceCross !== 'none' ? `Price ${priceCross.replace('_', ' ')} EMA on latest bar` : 'No fresh price/EMA crossover',
    ],
    metrics: {
      ema: emaNow != null ? Number(emaNow.toFixed(5)) : null,
      effectivePeriod: period,
      targetPeriod,
      distancePct: emaNow != null ? Number((Math.abs((close - emaNow) / close) * 100).toFixed(3)) : null,
      slopePct: Number(slopePct.toFixed(4)),
    },
    events: priceCross !== 'none'
      ? [{ label: priceCross.replace('_', ' '), detail: `Price / EMA(${period}) crossover`, tone: priceCross === 'bullish_cross' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateAsianSessionBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(18, parseNumber(config.lookback, 36));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const window = candles.slice(-lookback);
  const asianEnd = Math.max(3, Math.floor(window.length / 3));
  const asianWindow = window.slice(0, asianEnd);
  const sessionHigh = Math.max(...asianWindow.map((item) => item.high));
  const sessionLow = Math.min(...asianWindow.map((item) => item.low));
  const last = candles[candles.length - 1];
  const buffer = last.close * (bufferPct / 100);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (last.close > sessionHigh - buffer) {
    bias = 'bullish';
    if (last.close > sessionHigh) decision = 'buy';
  } else if (last.close < sessionLow + buffer) {
    bias = 'bearish';
    if (last.close < sessionLow) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'asian-session-breakout',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 34 : 6),
    reasons: [
      `Asian session box from first ${asianEnd} bars of ${lookback}-bar window`,
      `Range high ${sessionHigh.toFixed(5)} / low ${sessionLow.toFixed(5)}`,
      decision === 'buy' ? 'Expansion above Asian high confirmed' : decision === 'sell' ? 'Expansion below Asian low confirmed' : 'Price inside Asian range',
    ],
    metrics: {
      sessionHigh: Number(sessionHigh.toFixed(5)),
      sessionLow: Number(sessionLow.toFixed(5)),
      asianBars: asianEnd,
    },
  });
};

export const evaluateOpeningRangeBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(12, parseNumber(config.lookback, 24));
  const orbBars = Math.max(3, parseNumber(config.orbBars, 6));
  const bufferPct = parseNumber(config.bufferPct, 0.03);
  const window = candles.slice(-lookback);
  const orbWindow = window.slice(0, Math.min(orbBars, window.length));
  const orbHigh = Math.max(...orbWindow.map((item) => item.high));
  const orbLow = Math.min(...orbWindow.map((item) => item.low));
  const last = candles[candles.length - 1];
  const buffer = last.close * (bufferPct / 100);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  if (last.close > orbHigh + buffer) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close < orbLow - buffer) {
    bias = 'bearish';
    decision = 'sell';
  } else if (last.close > orbHigh - buffer) {
    bias = 'bullish';
  } else if (last.close < orbLow + buffer) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'opening-range-breakout-orb',
    context,
    config: { ...config, lookback, orbBars, bufferPct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 36 : 10),
    reasons: [
      `Opening range built from first ${orbWindow.length} bars`,
      `ORB high ${orbHigh.toFixed(5)} / low ${orbLow.toFixed(5)}`,
      decision === 'buy' ? 'Close confirmed above ORB high' : decision === 'sell' ? 'Close confirmed below ORB low' : 'Price inside opening range',
    ],
    metrics: {
      orbHigh: Number(orbHigh.toFixed(5)),
      orbLow: Number(orbLow.toFixed(5)),
      orbBars: orbWindow.length,
    },
  });
};

export const evaluateFairValueGapEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 60));
  const minGapPct = parseNumber(config.minGapPct, 0.02);
  const last = candles.length - 1;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';
  let gapHigh: number | null = null;
  let gapLow: number | null = null;

  for (let index = last - 2; index >= Math.max(2, last - lookback); index -= 1) {
    const left = candles[index - 1];
    const middle = candles[index];
    const right = candles[index + 1];
    const bullishGap = right.low > left.high;
    const bearishGap = right.high < left.low;
    const gapSize = bullishGap
      ? ((right.low - left.high) / middle.close) * 100
      : bearishGap
        ? ((left.low - right.high) / middle.close) * 100
        : 0;
    if (gapSize < minGapPct) continue;

    if (bullishGap) {
      gapLow = left.high;
      gapHigh = right.low;
      bias = 'bullish';
      const lastCandle = candles[last];
      if (lastCandle.low <= gapHigh && lastCandle.close > gapLow) decision = 'buy';
      break;
    }
    if (bearishGap) {
      gapHigh = left.low;
      gapLow = right.high;
      bias = 'bearish';
      const lastCandle = candles[last];
      if (lastCandle.high >= gapLow && lastCandle.close < gapHigh) decision = 'sell';
      break;
    }
  }

  return buildEvaluationResult({
    strategyId: 'fair-value-gap-fvg',
    context,
    config: { ...config, lookback, minGapPct },
    candles,
    decision,
    bias,
    confidence: 32 + (decision !== 'wait' ? 38 : 0) + (gapHigh != null ? 14 : 0),
    reasons: [
      'ICT-style fair value gap (3-candle imbalance) detection',
      gapHigh != null && gapLow != null ? `Active FVG zone ${gapLow.toFixed(5)} – ${gapHigh.toFixed(5)}` : 'No qualifying FVG in lookback window',
      decision === 'buy' ? 'Bullish mitigation into demand gap' : decision === 'sell' ? 'Bearish mitigation into supply gap' : 'Awaiting gap retest',
    ],
    metrics: {
      gapHigh: gapHigh != null ? Number(gapHigh.toFixed(5)) : null,
      gapLow: gapLow != null ? Number(gapLow.toFixed(5)) : null,
    },
  });
};

export const evaluatePinBarEngine: StrategyEngine = (candles, config, context) => {
  const wickRatio = parseNumber(config.wickRatio, 2);
  const bodyMaxPct = parseNumber(config.bodyMaxPct, 35);
  const last = candles.length - 1;
  const candle = candles[last];
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const bodyPct = range === 0 ? 0 : (body / range) * 100;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  const bullishPin = bodyPct <= bodyMaxPct && lowerWick >= body * wickRatio && upperWick <= body;
  const bearishPin = bodyPct <= bodyMaxPct && upperWick >= body * wickRatio && lowerWick <= body;
  if (bullishPin) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishPin) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'pin-bar-strategy',
    context,
    config: { ...config, wickRatio, bodyMaxPct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 36 : 0) + Math.min(16, (Math.max(upperWick, lowerWick) / (range || 1)) * 100),
    reasons: [
      `Pin bar rejection model (wick ≥ ${wickRatio}× body, body ≤ ${bodyMaxPct}% of range)`,
      bullishPin ? 'Bullish pin bar — long lower wick rejection' : bearishPin ? 'Bearish pin bar — long upper wick rejection' : 'Latest bar is not a qualifying pin bar',
      `Range ${range.toFixed(5)} / body ${body.toFixed(5)}`,
    ],
    metrics: {
      upperWick: Number(upperWick.toFixed(5)),
      lowerWick: Number(lowerWick.toFixed(5)),
      bodyPct: Number(bodyPct.toFixed(1)),
    },
    events: decision !== 'wait'
      ? [{ label: decision === 'buy' ? 'bullish pin' : 'bearish pin', detail: 'Institutional rejection candle', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateBreakAndRetestEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const retestTolerancePct = parseNumber(config.retestTolerancePct, 0.08);
  const last = candles.length - 1;
  const window = candles.slice(-lookback, -1);
  const swingHigh = Math.max(...window.map((item) => item.high));
  const swingLow = Math.min(...window.map((item) => item.low));
  const close = candles[last].close;
  const tolerance = close * (retestTolerancePct / 100);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  const brokeAbove = window.some((item) => item.close > swingHigh) && close > swingHigh - tolerance;
  const brokeBelow = window.some((item) => item.close < swingLow) && close < swingLow + tolerance;
  const retestHoldAbove = brokeAbove && Math.abs(close - swingHigh) <= tolerance && close >= swingHigh;
  const retestRejectBelow = brokeBelow && Math.abs(close - swingLow) <= tolerance && close <= swingLow;

  if (retestHoldAbove) {
    bias = 'bullish';
    decision = 'buy';
  } else if (retestRejectBelow) {
    bias = 'bearish';
    decision = 'sell';
  } else if (close > swingHigh) {
    bias = 'bullish';
  } else if (close < swingLow) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'break-and-retest',
    context,
    config: { ...config, lookback, retestTolerancePct },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 35 : 8),
    reasons: [
      `Structure break + retest over ${lookback} bars`,
      `Swing high ${swingHigh.toFixed(5)} / low ${swingLow.toFixed(5)}`,
      decision === 'buy' ? 'Break above structure with successful retest hold' : decision === 'sell' ? 'Break below structure with retest rejection' : 'No confirmed break-and-retest on latest bar',
    ],
    metrics: {
      swingHigh: Number(swingHigh.toFixed(5)),
      swingLow: Number(swingLow.toFixed(5)),
    },
  });
};

export const evaluateBollingerMeanReversionEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 20));
  const stdDev = parseNumber(config.stdDev, 2);
  const rsiPeriod = Math.max(5, parseNumber(config.rsiPeriod, 14));
  const closes = candles.map((item) => item.close);
  const bands = bollinger(closes, period, stdDev);
  const rsiSeries = rsi(closes, rsiPeriod);
  const last = closes.length - 1;
  const close = closes[last];
  const upper = bands.upper[last];
  const lower = bands.lower[last];
  const middle = bands.middle[last];
  const rsiValue = rsiSeries[last];
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  if (lower != null && close <= lower && rsiValue != null && rsiValue <= 40) {
    bias = 'bullish';
    decision = 'buy';
  } else if (upper != null && close >= upper && rsiValue != null && rsiValue >= 60) {
    bias = 'bearish';
    decision = 'sell';
  } else if (middle != null) {
    bias = close > middle ? 'bullish' : close < middle ? 'bearish' : 'neutral';
  }

  return buildEvaluationResult({
    strategyId: 'bollinger-mean-reversion',
    context,
    config: { ...config, period, stdDev, rsiPeriod },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 0) + (rsiValue != null ? Math.min(18, Math.abs(rsiValue - 50) / 2) : 0),
    reasons: [
      `Bollinger(${period}, ${stdDev}) + RSI(${rsiPeriod}) mean reversion confluence`,
      rsiValue != null ? `RSI ${rsiValue.toFixed(1)}` : 'RSI unavailable',
      decision === 'buy' ? 'Price at lower band with oversold RSI — snap-back long' : decision === 'sell' ? 'Price at upper band with overbought RSI — fade short' : 'No band extreme reversion signal',
    ],
    metrics: {
      upper: upper != null ? Number(upper.toFixed(5)) : null,
      lower: lower != null ? Number(lower.toFixed(5)) : null,
      rsi: rsiValue != null ? Number(rsiValue.toFixed(2)) : null,
    },
  });
};

export const evaluateLiquidityGrabEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const sweepBufferPct = parseNumber(config.sweepBufferPct, 0.02);
  const window = candles.slice(-lookback - 1, -1);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex];
  const recentHigh = Math.max(...window.map((item) => item.high));
  const recentLow = Math.min(...window.map((item) => item.low));
  const sweepBuffer = last.close * (sweepBufferPct / 100);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  const bearishGrab = last.high > recentHigh + sweepBuffer && last.close < recentHigh;
  const bullishGrab = last.low < recentLow - sweepBuffer && last.close > recentLow;
  if (bullishGrab) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishGrab) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'liquidity-grab-strategy',
    context,
    config: { ...config, lookback, sweepBufferPct },
    candles,
    decision,
    bias,
    confidence: 33 + (decision !== 'wait' ? 38 : 0),
    reasons: [
      `Liquidity grab / stop hunt over ${lookback} bars`,
      `Recent high ${recentHigh.toFixed(5)} / low ${recentLow.toFixed(5)}`,
      bullishGrab ? 'Sweep below lows with close back inside — bullish grab' : bearishGrab ? 'Sweep above highs with close back inside — bearish grab' : 'No liquidity grab on latest bar',
    ],
    metrics: {
      recentHigh: Number(recentHigh.toFixed(5)),
      recentLow: Number(recentLow.toFixed(5)),
    },
    events: decision !== 'wait'
      ? [{ label: 'liquidity grab', detail: decision === 'buy' ? 'Buy-side liquidity sweep reversal' : 'Sell-side liquidity sweep reversal', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: lastIndex }]
      : [],
  });
};

export const evaluateStochasticEngine: StrategyEngine = (candles, config, context) => {
  const kPeriod = Math.max(5, parseNumber(config.kPeriod, 14));
  const dPeriod = Math.max(2, parseNumber(config.dPeriod, 3));
  const oversold = parseNumber(config.oversold, 20);
  const overbought = parseNumber(config.overbought, 80);
  const { k, d } = stochastic(candles, kPeriod, dPeriod);
  const last = candles.length - 1;
  const kNow = k[last];
  const kPrev = k[last - 1];
  const dNow = d[last];
  const dPrev = d[last - 1];
  const cross = crossover(kPrev, kNow, dPrev, dNow);
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  if (kNow != null) {
    if (kNow >= 55) bias = 'bullish';
    else if (kNow <= 45) bias = 'bearish';
    if (cross === 'bullish_cross' && kNow <= oversold + 15) decision = 'buy';
    if (cross === 'bearish_cross' && kNow >= overbought - 15) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'stochastic-strategy',
    context,
    config: { ...config, kPeriod, dPeriod, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 35 + (cross !== 'none' ? 28 : 0) + (kNow != null ? Math.min(20, Math.abs(kNow - 50) / 2) : 0),
    reasons: [
      `Stochastic(${kPeriod}, ${dPeriod}) oscillator crossover model`,
      kNow != null && dNow != null ? `%K ${kNow.toFixed(1)} / %D ${dNow.toFixed(1)} (${oversold}/${overbought} zones)` : 'Stochastic unavailable',
      cross !== 'none' ? `${cross.replace('_', ' ')} detected` : 'No fresh stochastic crossover',
    ],
    metrics: {
      k: kNow != null ? Number(kNow.toFixed(2)) : null,
      d: dNow != null ? Number(dNow.toFixed(2)) : null,
    },
    events: cross !== 'none'
      ? [{ label: cross.replace('_', ' '), detail: 'Stochastic %K / %D crossover', tone: cross === 'bullish_cross' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

function projectTrendlinePrice(line: TrendlineDetection, candleIndex: number): number {
  const slope = (line.endPrice - line.startPrice) / Math.max(1, line.endCandleIndex - line.startCandleIndex);
  return line.startPrice + slope * (candleIndex - line.startCandleIndex);
}

export const evaluateTrendlineBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const minValidity = parseNumber(config.minValidity, 0.45);
  const breakLookback = Math.max(1, parseNumber(config.breakLookback, 3));
  const bufferPct = parseNumber(config.bufferPct, 0.03);
  const reconstructed = strategyCandlesToReconstructed(candles);
  const analysis = analyzeTrendlines(reconstructed);
  const lastIndex = candles.length - 1;
  const lastCandle = candles[lastIndex]!;
  const lastBarIndex = lastCandle.candleIndex;
  const buffer = lastCandle.close * (bufferPct / 100);

  const dominant = analysis.trendlines.find((line) => line.validityScore >= minValidity) ?? analysis.trendlines[0] ?? null;
  const recentBreak = analysis.breaks
    .filter((event) => event.candleIndex >= lastBarIndex - breakLookback)
    .sort((a, b) => b.breakQualityScore - a.breakQualityScore)[0] ?? null;

  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  if (recentBreak) {
    if (recentBreak.breakDirection === 'bullish_break') {
      bias = 'bullish';
      decision = recentBreak.breakQualityScore >= 0.5 && recentBreak.falseBreakProbability <= 0.55 ? 'buy' : 'wait';
    } else if (recentBreak.breakDirection === 'bearish_break') {
      bias = 'bearish';
      decision = recentBreak.breakQualityScore >= 0.5 && recentBreak.falseBreakProbability <= 0.55 ? 'sell' : 'wait';
    }
  } else if (dominant) {
    bias = dominant.direction === 'bullish' ? 'bullish' : dominant.direction === 'bearish' ? 'bearish' : 'neutral';
    const projected = projectTrendlinePrice(dominant, lastBarIndex);
    const brokeUp = lastCandle.close > projected + buffer;
    const brokeDown = lastCandle.close < projected - buffer;
    if (dominant.breakProbability >= minValidity && brokeUp && dominant.direction !== 'bullish') {
      decision = 'buy';
      bias = 'bullish';
    } else if (dominant.breakProbability >= minValidity && brokeDown && dominant.direction !== 'bearish') {
      decision = 'sell';
      bias = 'bearish';
    } else if (analysis.summary.directionalBias === 'BUY_CONTEXT' && dominant.breakStatus === 'break_pressure_active') {
      decision = 'buy';
      bias = 'bullish';
    } else if (analysis.summary.directionalBias === 'SELL_CONTEXT' && dominant.breakStatus === 'break_pressure_active') {
      decision = 'sell';
      bias = 'bearish';
    }
  }

  const confidence = 34
    + (decision !== 'wait' ? 30 : 0)
    + (dominant ? Math.round(dominant.validityScore * 24) : 0)
    + (recentBreak ? Math.round(recentBreak.breakQualityScore * 20) : 0);

  const events = recentBreak
    ? [{
      label: recentBreak.breakDirection.replace('_', ' '),
      detail: recentBreak.explanationText,
      tone: recentBreak.breakDirection === 'bullish_break' ? 'emerald' as const : 'rose' as const,
      barIndex: recentBreak.candleIndex,
    }]
    : dominant && decision !== 'wait'
      ? [{
        label: 'trendline break',
        detail: dominant.aiExplanation,
        tone: decision === 'buy' ? 'emerald' as const : 'rose' as const,
        barIndex: lastBarIndex,
      }]
      : [];

  return buildEvaluationResult({
    strategyId: 'trendline-breakout',
    context,
    config: { ...config, minValidity, breakLookback, bufferPct },
    candles,
    decision,
    bias,
    confidence,
    reasons: [
      'Institutional trendline engine: swing RANSAC + break-quality + liquidity-trap scoring',
      dominant
        ? `Dominant ${dominant.trendlineKind.replace(/_/g, ' ')} (${dominant.direction}) validity ${(dominant.validityScore * 100).toFixed(0)}%`
        : analysis.summary.explanation,
      recentBreak
        ? `Fresh break quality ${(recentBreak.breakQualityScore * 100).toFixed(0)}% — false-break risk ${(recentBreak.falseBreakProbability * 100).toFixed(0)}%`
        : decision !== 'wait'
          ? `Close broke projected trendline with ${dominant?.breakStatus ?? 'break'} pressure`
          : dominant?.breakStatus === 'break_watch'
            ? 'Break watch active — awaiting close confirmation beyond trendline'
            : 'No confirmed trendline breakout on latest bar',
    ],
    metrics: {
      trendlines: analysis.trendlines.length,
      validity: dominant != null ? Number((dominant.validityScore * 100).toFixed(1)) : null,
      breakProbability: dominant != null ? Number((dominant.breakProbability * 100).toFixed(1)) : null,
      projectedPrice: dominant != null ? Number(projectTrendlinePrice(dominant, lastBarIndex).toFixed(5)) : null,
      touchCount: dominant?.touchCount ?? null,
    },
    events,
  });
};

export const evaluateHigherHighsHigherLowsEngine: StrategyEngine = (candles, config, context) => {
  const swingDepth = Math.max(2, parseNumber(config.swingDepth, 5));
  const minStrength = parseNumber(config.minStrength, 0.35);
  const reconstructed = strategyCandlesToReconstructed(candles);
  const analysis = analyzeSwingPoints(reconstructed, {
    depths: [2, 4, swingDepth],
    zigzagPercent: 0.08,
  });

  const usable = analysis.swings.filter((swing) => swing.strengthScore >= minStrength);
  const highs = usable.filter((swing) => swing.swingKind === 'high').slice(-3);
  const lows = usable.filter((swing) => swing.swingKind === 'low').slice(-3);
  const lastHigh = highs.at(-1);
  const prevHigh = highs.at(-2);
  const lastLow = lows.at(-1);
  const prevLow = lows.at(-2);

  const higherHigh = lastHigh != null && prevHigh != null && lastHigh.priceLevel > prevHigh.priceLevel;
  const lowerHigh = lastHigh != null && prevHigh != null && lastHigh.priceLevel < prevHigh.priceLevel;
  const higherLow = lastLow != null && prevLow != null && lastLow.priceLevel > prevLow.priceLevel;
  const lowerLow = lastLow != null && prevLow != null && lastLow.priceLevel < prevLow.priceLevel;

  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let decision: 'buy' | 'sell' | 'wait' = 'wait';

  if (higherHigh && higherLow) {
    bias = 'bullish';
    decision = 'buy';
  } else if (lowerHigh && lowerLow) {
    bias = 'bearish';
    decision = 'sell';
  } else if (higherHigh || higherLow) {
    bias = 'bullish';
  } else if (lowerHigh || lowerLow) {
    bias = 'bearish';
  } else if (analysis.summary.trendState === 'bullish') {
    bias = 'bullish';
  } else if (analysis.summary.trendState === 'bearish') {
    bias = 'bearish';
  }

  const sequenceScore = (higherHigh ? 25 : 0) + (higherLow ? 25 : 0) + (lowerHigh ? -25 : 0) + (lowerLow ? -25 : 0);
  const confidence = 32
    + (decision !== 'wait' ? 32 : 12)
    + Math.min(24, Math.abs(sequenceScore))
    + Math.round(analysis.summary.confidence * 20);

  const events = decision !== 'wait' && lastHigh != null
    ? [{
      label: decision === 'buy' ? 'bullish structure' : 'bearish structure',
      detail: `${higherHigh ? 'HH' : lowerHigh ? 'LH' : '—'} / ${higherLow ? 'HL' : lowerLow ? 'LL' : '—'} at swing ${lastHigh.candleIndex}`,
      tone: decision === 'buy' ? 'emerald' as const : 'rose' as const,
      barIndex: lastHigh.candleIndex,
    }]
    : [];

  return buildEvaluationResult({
    strategyId: 'higher-highs-and-higher-lows',
    context,
    config: { ...config, swingDepth, minStrength },
    candles,
    decision,
    bias,
    confidence,
    reasons: [
      'Institutional swing-point market structure: HH/HL bullish vs LH/LL bearish',
      lastHigh != null && prevHigh != null
        ? `Swing highs ${prevHigh.priceLevel.toFixed(5)} → ${lastHigh.priceLevel.toFixed(5)} (${higherHigh ? 'HH' : lowerHigh ? 'LH' : 'equal'})`
        : 'Insufficient validated swing highs',
      lastLow != null && prevLow != null
        ? `Swing lows ${prevLow.priceLevel.toFixed(5)} → ${lastLow.priceLevel.toFixed(5)} (${higherLow ? 'HL' : lowerLow ? 'LL' : 'equal'})`
        : 'Insufficient validated swing lows',
      decision === 'buy'
        ? 'Full bullish sequence — trend continuation long bias'
        : decision === 'sell'
          ? 'Full bearish sequence — trend continuation short bias'
          : 'Mixed structure — await HH/HL or LH/LL confirmation',
    ],
    metrics: {
      swingCount: usable.length,
      lastHigh: lastHigh != null ? Number(lastHigh.priceLevel.toFixed(5)) : null,
      lastLow: lastLow != null ? Number(lastLow.priceLevel.toFixed(5)) : null,
      trendState: analysis.summary.trendState,
      structuralBias: analysis.summary.structuralBias,
    },
    events,
  });
};

function mapMtfFinalDecision(finalDecision: string): StrategySignalSide {
  const text = finalDecision.toUpperCase();
  if (text.includes('BUY')) return 'buy';
  if (text.includes('SELL')) return 'sell';
  return 'wait';
}

function mapMtfBias(finalBias: string): StrategyBias {
  const text = finalBias.toLowerCase();
  if (text.includes('bullish')) return 'bullish';
  if (text.includes('bearish')) return 'bearish';
  return 'neutral';
}

export function buildMultiTimeframeTrendEvaluation(input: {
  symbol: string;
  candleMap: Partial<Record<MtfTimeframe, StrategyPriceCandle[]>>;
  captureMap: Partial<Record<MtfTimeframe, string | null>>;
  config: Record<string, unknown>;
  context: StrategyEngineContext;
}): StrategyEvaluationResult {
  const reconstructed: Partial<Record<MtfTimeframe, ReturnType<typeof strategyCandlesToReconstructed>>> = {};
  for (const timeframe of MTF_TIMEFRAMES) {
    const candles = input.candleMap[timeframe];
    if (candles?.length) {
      reconstructed[timeframe] = strategyCandlesToReconstructed(candles);
    }
  }

  const analysis = analyzeMultiTimeframe(input.symbol, reconstructed, input.captureMap);
  const { decision, snapshots, alignments, conflicts } = analysis;
  const signal = mapMtfFinalDecision(decision.finalDecision);
  const bias = mapMtfBias(decision.finalBias);
  const averageAlignment = alignments.length
    ? alignments.reduce((sum, item) => sum + item.alignmentScore, 0) / alignments.length
    : 0;
  const loadedTimeframes = MTF_TIMEFRAMES.filter((timeframe) => (input.candleMap[timeframe]?.length ?? 0) >= 12);
  const allCandles = loadedTimeframes.flatMap((timeframe) => input.candleMap[timeframe] ?? []);

  const events = alignments
    .filter((item) => item.alignmentState === 'aligned_bullish' || item.alignmentState === 'aligned_bearish')
    .slice(0, 6)
    .map((item) => ({
      label: `${item.leftTimeframe}/${item.rightTimeframe}`,
      detail: item.explanationText,
      tone: item.alignmentState === 'aligned_bullish' ? 'emerald' as const : 'rose' as const,
    }));

  const tfBiasMetrics = Object.fromEntries(
    snapshots.map((snapshot) => [`bias${snapshot.timeframe}`, snapshot.bias]),
  );

  return buildEvaluationResult({
    strategyId: 'multi-timeframe-trend-confirmation',
    context: input.context,
    config: {
      ...input.config,
      timeframes: loadedTimeframes.join(','),
      controllingTimeframe: decision.controllingTimeframe,
      scalpOnly: decision.scalpOnly,
    },
    candles: allCandles,
    decision: signal,
    bias,
    confidence: Math.round(decision.confidenceScore * 100),
    reasons: [
      `Multi-timeframe institutional stack — ${loadedTimeframes.length}/5 timeframes loaded`,
      decision.marketNarrative,
      decision.lowerTimeframeConfirmation,
      conflicts[0]
        ? `Conflict watch: ${conflicts[0].description}`
        : `Adjacent timeframe alignment average ${Math.round(averageAlignment * 100)}%`,
    ],
    metrics: {
      finalDecision: decision.finalDecision,
      controllingTimeframe: decision.controllingTimeframe,
      alignmentAvgPct: Number((averageAlignment * 100).toFixed(1)),
      conflictSeverity: conflicts[0] != null ? Number((conflicts[0].severityScore * 100).toFixed(1)) : 0,
      loadedTimeframes: loadedTimeframes.length,
      scalpOnly: decision.scalpOnly ? 'yes' : 'no',
      ...tfBiasMetrics,
    },
    events,
  });
}

export const STRATEGY_ENGINES: Record<string, StrategyEngine> = {
  'moving-average-crossover': evaluateMovingAverageCrossoverEngine,
  'ema-pullback-strategy': evaluateEmaPullbackEngine,
  'trendline-breakout': evaluateTrendlineBreakoutEngine,
  'higher-highs-and-higher-lows': evaluateHigherHighsHigherLowsEngine,
  'macd-trend-strategy': evaluateMacdTrendEngine,
  'ichimoku-trend-strategy': evaluateIchimokuTrendEngine,
  'supertrend-strategy': evaluateSupertrendEngine,
  'rsi-strategy': evaluateRsiEngine,
  'london-breakout': evaluateLondonBreakoutEngine,
  'bollinger-band-squeeze-breakout': evaluateBollingerSqueezeEngine,
  'order-block-trading': evaluateOrderBlockEngine,
  'adx-trend-strategy': evaluateAdxTrendEngine,
  '200-ema-trend-strategy': evaluate200EmaTrendEngine,
  'asian-session-breakout': evaluateAsianSessionBreakoutEngine,
  'opening-range-breakout-orb': evaluateOpeningRangeBreakoutEngine,
  'fair-value-gap-fvg': evaluateFairValueGapEngine,
  'pin-bar-strategy': evaluatePinBarEngine,
  'break-and-retest': evaluateBreakAndRetestEngine,
  'bollinger-mean-reversion': evaluateBollingerMeanReversionEngine,
  'liquidity-grab-strategy': evaluateLiquidityGrabEngine,
  'stochastic-strategy': evaluateStochasticEngine,
};

export function evaluateStrategyEngine(
  strategyId: string,
  candles: StrategyPriceCandle[],
  config: Record<string, unknown>,
) {
  const engine = STRATEGY_ENGINES[strategyId];
  if (!engine) {
    throw new Error(`Strategy engine not implemented: ${strategyId}`);
  }
  const context = contextFromConfig(config);
  return engine(candles, config, context);
}
