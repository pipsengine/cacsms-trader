import { randomUUID } from 'node:crypto';

import { queryPostgres } from '@/lib/postgres';
import { loadPropFirmRiskRulesFromEnv } from '@/lib/execution-risk-limits';

type Side = 'BUY' | 'SELL';
type Decision = Side | 'MONITOR' | 'WAIT' | 'HOLD';
type RunMode = 'backtest' | 'walk_forward' | 'paper_forward';

export interface BacktestConfig {
  strategyId: string;
  symbol: string;
  timeframe: string;
  from?: string | null;
  to?: string | null;
  fastPeriod?: number;
  slowPeriod?: number;
  riskRewardRatio?: number;
  stopAtrMultiplier?: number;
  spreadPoints?: number;
  commissionPerLot?: number;
  slippagePoints?: number;
  pointValue?: number;
  riskPerTradeR?: number;
  startingEquity?: number;
  maxBarsInTrade?: number;
  sessionFilter?: boolean;
  newsBlackoutFilter?: boolean;
  decisionReplay?: boolean;
  limit?: number;
}

export interface BacktestTrade {
  id: string;
  entryIndex: number;
  exitIndex: number;
  entryTime: string;
  exitTime: string;
  side: Side;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  pnlR: number;
  pnlAmount: number;
  exitReason: 'take_profit' | 'stop_loss' | 'opposite_signal' | 'timeout' | 'end_of_sample';
  feesAmount: number;
}

export interface BacktestMetrics {
  sampleSize: number;
  wins: number;
  losses: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number | null;
  averageR: number;
  maxDrawdownR: number;
  maxDrawdownPercent: number;
  netProfitR: number;
  netProfitAmount: number;
  sharpeLike: number;
}

export interface BacktestRunResult {
  runId: string;
  mode: RunMode;
  strategyId: string;
  symbol: string;
  timeframe: string;
  status: 'completed' | 'insufficient_data' | 'failed';
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  config: Required<Omit<BacktestConfig, 'from' | 'to'>> & { from: string | null; to: string | null };
  promotion: PromotionReview;
}

export interface WalkForwardResult {
  runId: string;
  strategyId: string;
  symbol: string;
  timeframe: string;
  status: 'completed' | 'insufficient_data' | 'failed';
  windows: Array<{
    window: number;
    train: BacktestRunResult;
    validation: BacktestRunResult;
    selectedConfig: Record<string, unknown>;
  }>;
  aggregateValidation: BacktestMetrics;
  promotion: PromotionReview;
}

export interface PromotionReview {
  eligible: boolean;
  blockers: string[];
  metrics: BacktestMetrics;
  minimums: {
    sampleSize: number;
    expectancyR: number;
    profitFactor: number;
    maxDrawdownR: number;
    validationWindows: number;
  };
}

type ReplayCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  captureId: string;
  captureTime: string;
};

const schemaSql = `
CREATE TABLE IF NOT EXISTS strategy_backtest_runs (
  id UUID PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  from_at TIMESTAMPTZ,
  to_at TIMESTAMPTZ,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  promotion_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategy_backtest_runs_strategy_idx
  ON strategy_backtest_runs(strategy_id, symbol, timeframe, created_at DESC);

CREATE TABLE IF NOT EXISTS strategy_backtest_trades (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES strategy_backtest_runs(id) ON DELETE CASCADE,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_time TIMESTAMPTZ NOT NULL,
  exit_time TIMESTAMPTZ NOT NULL,
  entry_price NUMERIC(18,6) NOT NULL,
  exit_price NUMERIC(18,6) NOT NULL,
  stop_loss NUMERIC(18,6) NOT NULL,
  take_profit NUMERIC(18,6) NOT NULL,
  pnl_r NUMERIC(12,6) NOT NULL,
  pnl_amount NUMERIC(18,6) NOT NULL,
  fees_amount NUMERIC(18,6) NOT NULL,
  exit_reason TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategy_backtest_trades_run_idx
  ON strategy_backtest_trades(run_id, entry_time);

CREATE TABLE IF NOT EXISTS strategy_walk_forward_runs (
  id UUID PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  status TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  promotion_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_walk_forward_windows (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES strategy_walk_forward_runs(id) ON DELETE CASCADE,
  window_index INTEGER NOT NULL,
  train_run_id UUID REFERENCES strategy_backtest_runs(id) ON DELETE SET NULL,
  validation_run_id UUID REFERENCES strategy_backtest_runs(id) ON DELETE SET NULL,
  selected_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_paper_forward_orders (
  id UUID PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  decision TEXT NOT NULL,
  side TEXT,
  virtual_entry NUMERIC(18,6),
  virtual_stop NUMERIC(18,6),
  virtual_target NUMERIC(18,6),
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_decision_log_id UUID,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS strategy_paper_forward_orders_strategy_idx
  ON strategy_paper_forward_orders(strategy_id, symbol, status, created_at DESC);

CREATE TABLE IF NOT EXISTS strategy_promotion_reviews (
  id UUID PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  source_run_id UUID,
  source_type TEXT NOT NULL,
  eligible BOOLEAN NOT NULL,
  blockers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  minimums_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategy_promotion_reviews_strategy_idx
  ON strategy_promotion_reviews(strategy_id, symbol, timeframe, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureStrategyBacktestingSchema(): Promise<void> {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envBool(name: string, fallback = false): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'y';
}

function normalizeConfig(input: BacktestConfig): BacktestRunResult['config'] {
  const riskRules = loadPropFirmRiskRulesFromEnv();
  const fastPeriod = Math.max(2, Math.min(100, Math.round(Number(input.fastPeriod ?? 9))));
  const slowPeriod = Math.max(fastPeriod + 1, Math.min(300, Math.round(Number(input.slowPeriod ?? 21))));
  return {
    strategyId: String(input.strategyId || 'autonomous-fusion-replay').trim(),
    symbol: String(input.symbol || 'SP500').toUpperCase(),
    timeframe: String(input.timeframe || 'M15').toUpperCase(),
    from: input.from ?? null,
    to: input.to ?? null,
    fastPeriod,
    slowPeriod,
    riskRewardRatio: Math.max(0.5, Number(input.riskRewardRatio ?? riskRules.minRewardRiskRatio ?? 2)),
    stopAtrMultiplier: Math.max(0.2, Number(input.stopAtrMultiplier ?? 1.2)),
    spreadPoints: Math.max(0, Number(input.spreadPoints ?? envNumber('CACSMS_BACKTEST_SPREAD_POINTS', 20))),
    commissionPerLot: Math.max(0, Number(input.commissionPerLot ?? envNumber('CACSMS_BACKTEST_COMMISSION_PER_LOT', 7))),
    slippagePoints: Math.max(0, Number(input.slippagePoints ?? envNumber('CACSMS_BACKTEST_SLIPPAGE_POINTS', 2))),
    pointValue: Math.max(0.000001, Number(input.pointValue ?? envNumber('CACSMS_BACKTEST_POINT_VALUE', 0.01))),
    riskPerTradeR: Math.max(0.1, Number(input.riskPerTradeR ?? 1)),
    startingEquity: Math.max(100, Number(input.startingEquity ?? envNumber('CACSMS_BACKTEST_STARTING_EQUITY', 10000))),
    maxBarsInTrade: Math.max(1, Math.round(Number(input.maxBarsInTrade ?? 24))),
    sessionFilter: input.sessionFilter ?? envBool('CACSMS_BACKTEST_SESSION_FILTER', true),
    newsBlackoutFilter: input.newsBlackoutFilter ?? envBool('CACSMS_BACKTEST_NEWS_FILTER', true),
    decisionReplay: input.decisionReplay ?? false,
    limit: Math.max(60, Math.min(5000, Math.round(Number(input.limit ?? 1200)))),
  };
}

export async function runStrategyBacktest(input: BacktestConfig): Promise<BacktestRunResult> {
  await ensureStrategyBacktestingSchema();
  const config = normalizeConfig(input);
  const candles = await loadReplayCandles(config);
  if (candles.length < config.slowPeriod + 10) {
    return persistBacktestRun({
      mode: 'backtest',
      status: 'insufficient_data',
      config,
      trades: [],
      metrics: emptyMetrics(),
    });
  }

  const decisionByTime = config.decisionReplay
    ? await loadDecisionReplay(config)
    : new Map<string, Decision>();
  const trades = simulateTrades(candles, config, decisionByTime);
  const metrics = calculateMetrics(trades, config.startingEquity);
  return persistBacktestRun({
    mode: 'backtest',
    status: 'completed',
    config,
    trades,
    metrics,
  });
}

export async function runWalkForwardTest(input: BacktestConfig & {
  trainWindow?: number;
  validationWindow?: number;
  maxWindows?: number;
}): Promise<WalkForwardResult> {
  await ensureStrategyBacktestingSchema();
  const base = normalizeConfig(input);
  const candles = await loadReplayCandles(base);
  const trainWindow = Math.max(base.slowPeriod + 20, Math.round(Number(input.trainWindow ?? 160)));
  const validationWindow = Math.max(30, Math.round(Number(input.validationWindow ?? 60)));
  const maxWindows = Math.max(1, Math.min(12, Math.round(Number(input.maxWindows ?? 5))));
  const totalNeeded = trainWindow + validationWindow;
  const runId = randomUUID();

  if (candles.length < totalNeeded) {
    const metrics = emptyMetrics();
    const promotion = reviewPromotion(metrics, 0);
    await persistWalkForwardRun({ runId, status: 'insufficient_data', base, metrics, promotion, windows: [] });
    return { runId, strategyId: base.strategyId, symbol: base.symbol, timeframe: base.timeframe, status: 'insufficient_data', windows: [], aggregateValidation: metrics, promotion };
  }

  const windows: WalkForwardResult['windows'] = [];
  const step = validationWindow;
  const candidates = buildParameterCandidates(base);
  for (let start = 0; start + totalNeeded <= candles.length && windows.length < maxWindows; start += step) {
    const trainCandles = candles.slice(start, start + trainWindow);
    const validationCandles = candles.slice(start + trainWindow, start + trainWindow + validationWindow);
    let bestConfig = base;
    let bestMetrics = emptyMetrics();

    for (const candidate of candidates) {
      const trades = simulateTrades(trainCandles, candidate, new Map());
      const metrics = calculateMetrics(trades, candidate.startingEquity);
      if (scoreMetrics(metrics) > scoreMetrics(bestMetrics)) {
        bestConfig = candidate;
        bestMetrics = metrics;
      }
    }

    const train = await persistBacktestRun({
      mode: 'walk_forward',
      status: 'completed',
      config: { ...bestConfig, from: trainCandles[0]?.time ?? base.from, to: trainCandles.at(-1)?.time ?? base.to },
      trades: simulateTrades(trainCandles, bestConfig, new Map()),
      metrics: bestMetrics,
    });
    const validationTrades = simulateTrades(validationCandles, bestConfig, new Map());
    const validation = await persistBacktestRun({
      mode: 'walk_forward',
      status: 'completed',
      config: { ...bestConfig, from: validationCandles[0]?.time ?? base.from, to: validationCandles.at(-1)?.time ?? base.to },
      trades: validationTrades,
      metrics: calculateMetrics(validationTrades, bestConfig.startingEquity),
    });
    windows.push({
      window: windows.length + 1,
      train,
      validation,
      selectedConfig: {
        fastPeriod: bestConfig.fastPeriod,
        slowPeriod: bestConfig.slowPeriod,
        stopAtrMultiplier: bestConfig.stopAtrMultiplier,
        riskRewardRatio: bestConfig.riskRewardRatio,
      },
    });
  }

  const aggregateValidation = calculateMetrics(windows.flatMap((window) => window.validation.trades), base.startingEquity);
  const promotion = reviewPromotion(aggregateValidation, windows.length);
  await persistWalkForwardRun({ runId, status: 'completed', base, metrics: aggregateValidation, promotion, windows });
  await persistPromotionReview({
    strategyId: base.strategyId,
    symbol: base.symbol,
    timeframe: base.timeframe,
    sourceRunId: runId,
    sourceType: 'walk_forward',
    promotion,
  });
  return { runId, strategyId: base.strategyId, symbol: base.symbol, timeframe: base.timeframe, status: 'completed', windows, aggregateValidation, promotion };
}

export async function createPaperForwardOrder(input: {
  symbol: string;
  timeframe?: string;
  strategyId?: string;
  decisionLogId?: string;
}): Promise<Record<string, unknown>> {
  await ensureStrategyBacktestingSchema();
  const symbol = String(input.symbol || 'SP500').toUpperCase();
  const timeframe = String(input.timeframe || 'M15').toUpperCase();
  const latest = await queryPostgres(
    `
      SELECT id, strategy_id, decision, stop_loss, take_profit_levels_json, entry_zone_json, confidence_score, setup_readiness_score, created_at
      FROM autonomous_decision_logs
      WHERE upper(symbol) = $1
        AND upper(timeframe) = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [symbol, timeframe],
  );
  const decision = latest.rows[0];
  const decisionId = typeof decision?.id === 'string'
    ? decision.id
    : typeof input.decisionLogId === 'string'
      ? input.decisionLogId
      : null;
  const candles = await loadReplayCandles({
    ...normalizeConfig({
      strategyId: input.strategyId ?? String(decision?.strategy_id ?? 'paper-forward'),
      symbol,
      timeframe,
      limit: 200,
    }),
    symbol,
    timeframe,
  });
  const last = candles.at(-1);
  const side = normalizeDecision(decision?.decision);
  const strategyId = String(input.strategyId ?? decision?.strategy_id ?? 'paper-forward');
  const promotion = await getLatestPromotionReview(strategyId, symbol, timeframe);
  const blocked = !promotion?.eligible;
  const reason = !decision
    ? 'No autonomous decision is available for paper-forward replay.'
    : side === 'MONITOR' || side === 'WAIT' || side === 'HOLD'
      ? `Latest decision is ${side}; virtual order is monitoring only.`
      : blocked
        ? `Paper-forward only: strategy is not promoted for live execution${promotion?.blockers?.length ? ` (${promotion.blockers.join('; ')})` : ''}.`
        : 'Strategy is promoted; virtual order created as live-readiness shadow trade.';
  const entry = Number(last?.close ?? 0);
  const atr = calculateAtr(candles.slice(-40), 14) || Math.max(entry * 0.001, 1);
  const stop = side === 'SELL' ? entry + atr : entry - atr;
  const target = side === 'SELL' ? entry - atr * 2 : entry + atr * 2;
  const id = randomUUID();
  await queryPostgres(
    `
      INSERT INTO strategy_paper_forward_orders (
        id, strategy_id, symbol, timeframe, decision, side, virtual_entry, virtual_stop,
        virtual_target, status, reason, source_decision_log_id, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
    `,
    [
      id,
      strategyId,
      symbol,
      timeframe,
      String(decision?.decision ?? 'NONE'),
      side === 'BUY' || side === 'SELL' ? side : null,
      entry || null,
      entry ? stop : null,
      entry ? target : null,
      side === 'BUY' || side === 'SELL' ? 'open_virtual' : 'monitoring',
      reason,
      decisionId,
      JSON.stringify({ promotion, confidence: decision?.confidence_score ?? null, readiness: decision?.setup_readiness_score ?? null }),
    ],
  );
  return { id, strategyId, symbol, timeframe, side, entry, stop, target, status: side === 'BUY' || side === 'SELL' ? 'open_virtual' : 'monitoring', reason, promotion };
}

export async function getLatestPromotionReview(strategyId: string, symbol: string, timeframe: string): Promise<(PromotionReview & { createdAt: string }) | null> {
  await ensureStrategyBacktestingSchema();
  const result = await queryPostgres(
    `
      SELECT eligible, blockers_json, metrics_json, minimums_json, created_at
      FROM strategy_promotion_reviews
      WHERE strategy_id = $1 AND upper(symbol) = $2 AND upper(timeframe) = $3
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [strategyId, symbol.toUpperCase(), timeframe.toUpperCase()],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    eligible: row.eligible === true,
    blockers: Array.isArray(row.blockers_json) ? row.blockers_json.map(String) : [],
    metrics: metricsFromJson(row.metrics_json),
    minimums: minimumsFromJson(row.minimums_json),
    createdAt: String(row.created_at),
  };
}

async function loadReplayCandles(config: BacktestRunResult['config']): Promise<ReplayCandle[]> {
  const params: Array<string | number | null> = [config.symbol, config.timeframe, config.limit];
  const filters = ['upper(cc.symbol) = $1', 'upper(cc.timeframe) = $2'];
  if (config.from) {
    params.push(config.from);
    filters.push(`cc.captured_at >= $${params.length}`);
  }
  if (config.to) {
    params.push(config.to);
    filters.push(`cc.captured_at <= $${params.length}`);
  }

  const result = await queryPostgres(
    `
      WITH selected_captures AS (
        SELECT id, captured_at
        FROM chart_captures cc
        WHERE ${filters.join(' AND ')}
        ORDER BY captured_at DESC
        LIMIT 80
      ),
      indexed AS (
        SELECT
          sc.id AS capture_id,
          sc.captured_at,
          rc.candle_index,
          rc.open_price,
          rc.high_price,
          rc.low_price,
          rc.close_price,
          max(rc.candle_index) OVER (PARTITION BY sc.id) AS max_index
        FROM selected_captures sc
        JOIN reconstructed_candles rc ON rc.chart_capture_id = sc.id
      )
      SELECT *
      FROM indexed
      ORDER BY captured_at ASC, candle_index ASC
      LIMIT $3
    `,
    params,
  );
  const intervalMs = timeframeMs(config.timeframe);
  const byKey = new Map<string, ReplayCandle>();
  for (const row of result.rows) {
    const captureTimeMs = Date.parse(String(row.captured_at));
    const indexOffset = Number(row.max_index ?? row.candle_index) - Number(row.candle_index);
    const time = new Date(captureTimeMs - indexOffset * intervalMs).toISOString();
    const key = `${time}:${Number(row.open_price).toFixed(6)}:${Number(row.close_price).toFixed(6)}`;
    byKey.set(key, {
      time,
      open: Number(row.open_price),
      high: Number(row.high_price),
      low: Number(row.low_price),
      close: Number(row.close_price),
      captureId: String(row.capture_id),
      captureTime: String(row.captured_at),
    });
  }
  return Array.from(byKey.values()).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

async function loadDecisionReplay(config: BacktestRunResult['config']): Promise<Map<string, Decision>> {
  const result = await queryPostgres(
    `
      SELECT created_at, decision
      FROM autonomous_decision_logs
      WHERE upper(symbol) = $1
        AND upper(timeframe) = $2
        AND ($3::timestamptz IS NULL OR created_at >= $3::timestamptz)
        AND ($4::timestamptz IS NULL OR created_at <= $4::timestamptz)
      ORDER BY created_at ASC
      LIMIT 1000
    `,
    [config.symbol, config.timeframe, config.from, config.to],
  );
  const out = new Map<string, Decision>();
  for (const row of result.rows) out.set(String(row.created_at), normalizeDecision(row.decision));
  return out;
}

function simulateTrades(candles: ReplayCandle[], config: BacktestRunResult['config'], decisions: Map<string, Decision>): BacktestTrade[] {
  const closes = candles.map((candle) => candle.close);
  const fast = ema(closes, config.fastPeriod);
  const slow = ema(closes, config.slowPeriod);
  const trades: BacktestTrade[] = [];
  let position: {
    side: Side;
    entryIndex: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    riskPerUnit: number;
  } | null = null;

  for (let index = Math.max(config.slowPeriod, 2); index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    if (config.sessionFilter && !isSessionAllowed(candle.time)) continue;
    if (config.newsBlackoutFilter && isSyntheticNewsBlackout(candle.time)) continue;

    const signal = signalAt(index, fast, slow, decisions, candle.time);
    if (position) {
      const exit = resolveExit(position, candle, index, signal, config);
      if (exit) {
        trades.push(exit);
        position = null;
      }
    }
    if (!position && (signal === 'BUY' || signal === 'SELL')) {
      const atr = calculateAtr(candles.slice(Math.max(0, index - 30), index + 1), 14) || Math.abs(candle.close * 0.002);
      const spread = config.spreadPoints * config.pointValue;
      const slippage = config.slippagePoints * config.pointValue;
      const entryPrice = signal === 'BUY' ? candle.close + spread / 2 + slippage : candle.close - spread / 2 - slippage;
      const stopDistance = Math.max(atr * config.stopAtrMultiplier, spread + slippage + config.pointValue);
      const stopLoss = signal === 'BUY' ? entryPrice - stopDistance : entryPrice + stopDistance;
      const takeProfit = signal === 'BUY'
        ? entryPrice + stopDistance * config.riskRewardRatio
        : entryPrice - stopDistance * config.riskRewardRatio;
      position = {
        side: signal,
        entryIndex: index,
        entryPrice,
        stopLoss,
        takeProfit,
        riskPerUnit: stopDistance,
      };
    }
  }

  if (position && candles.at(-1)) {
    trades.push(closePosition(position, candles.at(-1)!, candles.length - 1, 'end_of_sample', config));
  }
  return trades;
}

function resolveExit(
  position: NonNullable<ReturnType<typeof openPositionType>>,
  candle: ReplayCandle,
  index: number,
  signal: Decision,
  config: BacktestRunResult['config'],
): BacktestTrade | null {
  if (position.side === 'BUY') {
    if (candle.low <= position.stopLoss) return closePosition(position, { ...candle, close: position.stopLoss }, index, 'stop_loss', config);
    if (candle.high >= position.takeProfit) return closePosition(position, { ...candle, close: position.takeProfit }, index, 'take_profit', config);
    if (signal === 'SELL') return closePosition(position, candle, index, 'opposite_signal', config);
  } else {
    if (candle.high >= position.stopLoss) return closePosition(position, { ...candle, close: position.stopLoss }, index, 'stop_loss', config);
    if (candle.low <= position.takeProfit) return closePosition(position, { ...candle, close: position.takeProfit }, index, 'take_profit', config);
    if (signal === 'BUY') return closePosition(position, candle, index, 'opposite_signal', config);
  }
  if (index - position.entryIndex >= config.maxBarsInTrade) return closePosition(position, candle, index, 'timeout', config);
  return null;
}

function openPositionType() {
  return null as unknown as {
    side: Side;
    entryIndex: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    riskPerUnit: number;
  };
}

function closePosition(
  position: NonNullable<ReturnType<typeof openPositionType>>,
  candle: ReplayCandle,
  exitIndex: number,
  exitReason: BacktestTrade['exitReason'],
  config: BacktestRunResult['config'],
): BacktestTrade {
  const slippage = config.slippagePoints * config.pointValue;
  const exitPrice = position.side === 'BUY' ? candle.close - slippage : candle.close + slippage;
  const grossR = position.side === 'BUY'
    ? (exitPrice - position.entryPrice) / position.riskPerUnit
    : (position.entryPrice - exitPrice) / position.riskPerUnit;
  const feesR = (config.commissionPerLot / 100) / Math.max(1, config.startingEquity * 0.0001);
  const pnlR = Number((grossR - feesR).toFixed(4));
  const pnlAmount = pnlR * (config.startingEquity * 0.01 * config.riskPerTradeR);
  return {
    id: randomUUID(),
    entryIndex: position.entryIndex,
    exitIndex,
    entryTime: candleTimeAt(position.entryIndex, candle, config.timeframe, exitIndex),
    exitTime: candle.time,
    side: position.side,
    entryPrice: Number(position.entryPrice.toFixed(6)),
    exitPrice: Number(exitPrice.toFixed(6)),
    stopLoss: Number(position.stopLoss.toFixed(6)),
    takeProfit: Number(position.takeProfit.toFixed(6)),
    pnlR,
    pnlAmount: Number(pnlAmount.toFixed(2)),
    exitReason,
    feesAmount: Number((feesR * config.startingEquity * 0.0001).toFixed(4)),
  };
}

function candleTimeAt(entryIndex: number, exitCandle: ReplayCandle, timeframe: string, exitIndex: number): string {
  return new Date(Date.parse(exitCandle.time) - Math.max(0, exitIndex - entryIndex) * timeframeMs(timeframe)).toISOString();
}

function signalAt(index: number, fast: Array<number | null>, slow: Array<number | null>, decisions: Map<string, Decision>, candleTime: string): Decision {
  if (decisions.size > 0) {
    let latest: Decision = 'WAIT';
    for (const [time, decision] of decisions) {
      if (Date.parse(time) <= Date.parse(candleTime)) latest = decision;
    }
    return latest;
  }
  const fp = fast[index - 1];
  const sp = slow[index - 1];
  const fc = fast[index];
  const sc = slow[index];
  if (fp == null || sp == null || fc == null || sc == null) return 'WAIT';
  if (fp <= sp && fc > sc) return 'BUY';
  if (fp >= sp && fc < sc) return 'SELL';
  return 'WAIT';
}

function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: values.length }, () => null);
  if (values.length < period) return out;
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = current;
  const multiplier = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    current = (values[index] - current) * multiplier + current;
    out[index] = current;
  }
  return out;
}

function calculateAtr(candles: Array<Pick<ReplayCandle, 'high' | 'low' | 'close'>>, period: number): number {
  if (candles.length < 2) return 0;
  const ranges: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const prev = candles[index - 1];
    const curr = candles[index];
    ranges.push(Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close)));
  }
  const slice = ranges.slice(-period);
  return slice.length ? slice.reduce((sum, value) => sum + value, 0) / slice.length : 0;
}

function isSessionAllowed(iso: string): boolean {
  const hour = new Date(iso).getUTCHours();
  return hour >= 6 && hour <= 21;
}

function isSyntheticNewsBlackout(iso: string): boolean {
  const date = new Date(iso);
  const minute = date.getUTCMinutes();
  return minute >= 28 && minute <= 32;
}

function calculateMetrics(trades: BacktestTrade[], startingEquity: number): BacktestMetrics {
  const sampleSize = trades.length;
  const wins = trades.filter((trade) => trade.pnlR > 0).length;
  const losses = trades.filter((trade) => trade.pnlR < 0).length;
  const grossWin = trades.filter((trade) => trade.pnlR > 0).reduce((sum, trade) => sum + trade.pnlR, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.pnlR < 0).reduce((sum, trade) => sum + trade.pnlR, 0));
  const netProfitR = trades.reduce((sum, trade) => sum + trade.pnlR, 0);
  const averageR = sampleSize ? netProfitR / sampleSize : 0;
  let equityR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  for (const trade of trades) {
    equityR += trade.pnlR;
    peakR = Math.max(peakR, equityR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - equityR);
  }
  const variance = sampleSize
    ? trades.reduce((sum, trade) => sum + Math.pow(trade.pnlR - averageR, 2), 0) / sampleSize
    : 0;
  const std = Math.sqrt(variance);
  return {
    sampleSize,
    wins,
    losses,
    winRate: sampleSize ? Number((wins / sampleSize).toFixed(4)) : 0,
    expectancyR: Number(averageR.toFixed(4)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(4)) : grossWin > 0 ? null : 0,
    averageR: Number(averageR.toFixed(4)),
    maxDrawdownR: Number(maxDrawdownR.toFixed(4)),
    maxDrawdownPercent: Number(((maxDrawdownR * startingEquity * 0.01) / startingEquity * 100).toFixed(2)),
    netProfitR: Number(netProfitR.toFixed(4)),
    netProfitAmount: Number(trades.reduce((sum, trade) => sum + trade.pnlAmount, 0).toFixed(2)),
    sharpeLike: std > 0 ? Number((averageR / std).toFixed(4)) : 0,
  };
}

function emptyMetrics(): BacktestMetrics {
  return {
    sampleSize: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    expectancyR: 0,
    profitFactor: 0,
    averageR: 0,
    maxDrawdownR: 0,
    maxDrawdownPercent: 0,
    netProfitR: 0,
    netProfitAmount: 0,
    sharpeLike: 0,
  };
}

function reviewPromotion(metrics: BacktestMetrics, validationWindows = 0): PromotionReview {
  const minimums = {
    sampleSize: Math.max(5, Math.round(envNumber('CACSMS_PROMOTION_MIN_SAMPLE_SIZE', 20))),
    expectancyR: envNumber('CACSMS_PROMOTION_MIN_EXPECTANCY_R', 0.05),
    profitFactor: envNumber('CACSMS_PROMOTION_MIN_PROFIT_FACTOR', 1.1),
    maxDrawdownR: envNumber('CACSMS_PROMOTION_MAX_DRAWDOWN_R', 8),
    validationWindows: Math.max(0, Math.round(envNumber('CACSMS_PROMOTION_MIN_WALK_WINDOWS', 2))),
  };
  const blockers: string[] = [];
  if (metrics.sampleSize < minimums.sampleSize) blockers.push(`Sample size ${metrics.sampleSize} is below minimum ${minimums.sampleSize}.`);
  if (metrics.expectancyR < minimums.expectancyR) blockers.push(`Expectancy ${metrics.expectancyR}R is below minimum ${minimums.expectancyR}R.`);
  if ((metrics.profitFactor ?? 0) < minimums.profitFactor) blockers.push(`Profit factor ${metrics.profitFactor ?? 0} is below minimum ${minimums.profitFactor}.`);
  if (metrics.maxDrawdownR > minimums.maxDrawdownR) blockers.push(`Max drawdown ${metrics.maxDrawdownR}R exceeds maximum ${minimums.maxDrawdownR}R.`);
  if (validationWindows < minimums.validationWindows) blockers.push(`Validation windows ${validationWindows} is below minimum ${minimums.validationWindows}.`);
  return { eligible: blockers.length === 0, blockers, metrics, minimums };
}

async function persistBacktestRun(input: {
  mode: RunMode;
  status: BacktestRunResult['status'];
  config: BacktestRunResult['config'];
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
}): Promise<BacktestRunResult> {
  const runId = randomUUID();
  const promotion = reviewPromotion(input.metrics, input.mode === 'walk_forward' ? 1 : 0);
  await queryPostgres(
    `
      INSERT INTO strategy_backtest_runs (
        id, strategy_id, symbol, timeframe, mode, status, from_at, to_at, config_json, metrics_json, promotion_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb)
    `,
    [
      runId,
      input.config.strategyId,
      input.config.symbol,
      input.config.timeframe,
      input.mode,
      input.status,
      input.config.from,
      input.config.to,
      JSON.stringify(input.config),
      JSON.stringify(input.metrics),
      JSON.stringify(promotion),
    ],
  );
  for (const trade of input.trades) {
    await queryPostgres(
      `
        INSERT INTO strategy_backtest_trades (
          id, run_id, strategy_id, symbol, timeframe, side, entry_time, exit_time,
          entry_price, exit_price, stop_loss, take_profit, pnl_r, pnl_amount,
          fees_amount, exit_reason, metadata_json
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
      `,
      [
        trade.id,
        runId,
        input.config.strategyId,
        input.config.symbol,
        input.config.timeframe,
        trade.side,
        trade.entryTime,
        trade.exitTime,
        trade.entryPrice,
        trade.exitPrice,
        trade.stopLoss,
        trade.takeProfit,
        trade.pnlR,
        trade.pnlAmount,
        trade.feesAmount,
        trade.exitReason,
        JSON.stringify({ entryIndex: trade.entryIndex, exitIndex: trade.exitIndex }),
      ],
    );
  }
  await persistPromotionReview({
    strategyId: input.config.strategyId,
    symbol: input.config.symbol,
    timeframe: input.config.timeframe,
    sourceRunId: runId,
    sourceType: input.mode,
    promotion,
  });
  return {
    runId,
    mode: input.mode,
    strategyId: input.config.strategyId,
    symbol: input.config.symbol,
    timeframe: input.config.timeframe,
    status: input.status,
    metrics: input.metrics,
    trades: input.trades,
    config: input.config,
    promotion,
  };
}

async function persistWalkForwardRun(input: {
  runId: string;
  status: WalkForwardResult['status'];
  base: BacktestRunResult['config'];
  metrics: BacktestMetrics;
  promotion: PromotionReview;
  windows: WalkForwardResult['windows'];
}) {
  await queryPostgres(
    `
      INSERT INTO strategy_walk_forward_runs (
        id, strategy_id, symbol, timeframe, status, config_json, metrics_json, promotion_json
      )
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)
    `,
    [input.runId, input.base.strategyId, input.base.symbol, input.base.timeframe, input.status, JSON.stringify(input.base), JSON.stringify(input.metrics), JSON.stringify(input.promotion)],
  );
  for (const window of input.windows) {
    await queryPostgres(
      `
        INSERT INTO strategy_walk_forward_windows (
          id, run_id, window_index, train_run_id, validation_run_id, selected_config_json, metrics_json
        )
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
      `,
      [randomUUID(), input.runId, window.window, window.train.runId, window.validation.runId, JSON.stringify(window.selectedConfig), JSON.stringify(window.validation.metrics)],
    );
  }
}

async function persistPromotionReview(input: {
  strategyId: string;
  symbol: string;
  timeframe: string;
  sourceRunId: string;
  sourceType: string;
  promotion: PromotionReview;
}) {
  await queryPostgres(
    `
      INSERT INTO strategy_promotion_reviews (
        id, strategy_id, symbol, timeframe, source_run_id, source_type, eligible,
        blockers_json, metrics_json, minimums_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)
    `,
    [
      randomUUID(),
      input.strategyId,
      input.symbol,
      input.timeframe,
      input.sourceRunId,
      input.sourceType,
      input.promotion.eligible,
      JSON.stringify(input.promotion.blockers),
      JSON.stringify(input.promotion.metrics),
      JSON.stringify(input.promotion.minimums),
    ],
  );
}

function buildParameterCandidates(base: BacktestRunResult['config']): BacktestRunResult['config'][] {
  const candidates: BacktestRunResult['config'][] = [];
  for (const fast of [base.fastPeriod, Math.max(2, base.fastPeriod - 2), base.fastPeriod + 2]) {
    for (const slow of [base.slowPeriod, Math.max(fast + 1, base.slowPeriod - 4), base.slowPeriod + 4]) {
      candidates.push({ ...base, fastPeriod: fast, slowPeriod: Math.max(fast + 1, slow) });
    }
  }
  return candidates;
}

function scoreMetrics(metrics: BacktestMetrics): number {
  return metrics.expectancyR * 100 + (metrics.profitFactor ?? 0) * 10 - metrics.maxDrawdownR * 3 + metrics.sampleSize * 0.05;
}

function normalizeDecision(value: unknown): Decision {
  const text = String(value ?? '').toUpperCase();
  if (text === 'BUY' || text === 'SELL' || text === 'MONITOR' || text === 'WAIT' || text === 'HOLD') return text;
  return 'WAIT';
}

function timeframeMs(timeframe: string): number {
  const normalized = timeframe.toUpperCase();
  if (normalized === 'M1') return 60_000;
  if (normalized === 'M5') return 5 * 60_000;
  if (normalized === 'M15') return 15 * 60_000;
  if (normalized === 'M30') return 30 * 60_000;
  if (normalized === 'H1') return 60 * 60_000;
  if (normalized === 'H4') return 4 * 60 * 60_000;
  if (normalized === 'D' || normalized === 'D1') return 24 * 60 * 60_000;
  if (normalized === 'W' || normalized === 'W1') return 7 * 24 * 60 * 60_000;
  return 15 * 60_000;
}

function metricsFromJson(value: unknown): BacktestMetrics {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    sampleSize: Number(row.sampleSize ?? 0),
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    winRate: Number(row.winRate ?? 0),
    expectancyR: Number(row.expectancyR ?? 0),
    profitFactor: row.profitFactor == null ? null : Number(row.profitFactor),
    averageR: Number(row.averageR ?? 0),
    maxDrawdownR: Number(row.maxDrawdownR ?? 0),
    maxDrawdownPercent: Number(row.maxDrawdownPercent ?? 0),
    netProfitR: Number(row.netProfitR ?? 0),
    netProfitAmount: Number(row.netProfitAmount ?? 0),
    sharpeLike: Number(row.sharpeLike ?? 0),
  };
}

function minimumsFromJson(value: unknown): PromotionReview['minimums'] {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    sampleSize: Number(row.sampleSize ?? 20),
    expectancyR: Number(row.expectancyR ?? 0.05),
    profitFactor: Number(row.profitFactor ?? 1.1),
    maxDrawdownR: Number(row.maxDrawdownR ?? 8),
    validationWindows: Number(row.validationWindows ?? 2),
  };
}
