import { getTradingStyleProfile, TRADING_STYLE_PROFILES } from '@/lib/trading-styles/registry';
import type { TradingStyleId } from '@/lib/trading-styles/types';
import { queryPostgres } from '@/lib/postgres';
import { randomUUID } from 'crypto';

export type StrategyGovernanceStatus = {
  strategyId: string;
  tradingStyle: TradingStyleId | null;
  enabled: boolean;
  eligible: boolean;
  blockers: string[];
  metrics: StrategyPerformanceMetrics;
};

export type StrategyPerformanceMetrics = {
  sampleSize: number;
  wins: number;
  losses: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number | null;
  averageR: number;
  maxLossR: number;
};

const schemaSql = `
CREATE TABLE IF NOT EXISTS strategy_governance_overrides (
  strategy_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS strategy_governance_snapshots (
  id UUID PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  trading_style TEXT,
  sample_size INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  win_rate NUMERIC(10,4) NOT NULL,
  expectancy_r NUMERIC(10,4) NOT NULL,
  profit_factor NUMERIC(10,4),
  average_r NUMERIC(10,4) NOT NULL,
  max_loss_r NUMERIC(10,4) NOT NULL,
  eligible BOOLEAN NOT NULL,
  blockers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategy_governance_snapshots_strategy_idx
  ON strategy_governance_snapshots(strategy_id, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

function envBool(name: string, fallback = true): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function governanceEnabled(): boolean {
  return envBool('CACSMS_STRATEGY_GOVERNANCE_ENABLED', true);
}

function minSamples(): number {
  return Math.max(1, Math.round(envNumber('CACSMS_STRATEGY_MIN_SAMPLES', 12)));
}

function minExpectancyR(): number {
  return envNumber('CACSMS_STRATEGY_MIN_EXPECTANCY_R', -0.05);
}

function minWinRate(): number {
  return Math.min(1, Math.max(0, envNumber('CACSMS_STRATEGY_MIN_WIN_RATE', 0.32)));
}

function lookbackDays(): number {
  return Math.max(1, Math.round(envNumber('CACSMS_STRATEGY_LOOKBACK_DAYS', 45)));
}

export async function ensureStrategyGovernanceSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = queryPostgres(schemaSql).then(() => undefined);
  }
  return schemaReady;
}

export function normalizeStrategyId(input: {
  tradingStyle?: string | null;
  timeframe?: string | null;
  setupType?: string | null;
}): string {
  const style = String(input.tradingStyle ?? 'core').trim().toLowerCase() || 'core';
  const timeframe = String(input.timeframe ?? 'multi').trim().toUpperCase() || 'MULTI';
  const setup = String(input.setupType ?? 'autonomous_fusion')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'autonomous_fusion';
  return `${style}:${timeframe}:${setup}`;
}

function styleFromStrategyId(strategyId: string): TradingStyleId | null {
  const style = strategyId.split(':')[0] as TradingStyleId;
  return TRADING_STYLE_PROFILES[style] ? style : null;
}

function emptyMetrics(): StrategyPerformanceMetrics {
  return {
    sampleSize: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    expectancyR: 0,
    profitFactor: null,
    averageR: 0,
    maxLossR: 0,
  };
}

async function loadOverride(strategyId: string): Promise<{ enabled: boolean; reason: string | null }> {
  await ensureStrategyGovernanceSchema();
  const result = await queryPostgres(
    `SELECT enabled, reason FROM strategy_governance_overrides WHERE strategy_id = $1 LIMIT 1`,
    [strategyId],
  ).catch(() => ({ rows: [] as Array<{ enabled?: boolean; reason?: string }> }));
  const row = result.rows[0];
  return {
    enabled: row?.enabled !== false,
    reason: row?.reason ? String(row.reason) : null,
  };
}

export async function getStrategyPerformance(strategyId: string): Promise<StrategyPerformanceMetrics> {
  await ensureStrategyGovernanceSchema();
  const result = await queryPostgres(
    `
      SELECT
        COUNT(*)::int AS sample_size,
        COUNT(*) FILTER (WHERE o.pnl_r_multiple > 0)::int AS wins,
        COUNT(*) FILTER (WHERE o.pnl_r_multiple < 0)::int AS losses,
        COALESCE(AVG(o.pnl_r_multiple), 0)::numeric AS average_r,
        COALESCE(SUM(o.pnl_r_multiple) FILTER (WHERE o.pnl_r_multiple > 0), 0)::numeric AS gross_win_r,
        ABS(COALESCE(SUM(o.pnl_r_multiple) FILTER (WHERE o.pnl_r_multiple < 0), 0))::numeric AS gross_loss_r,
        COALESCE(MIN(o.pnl_r_multiple), 0)::numeric AS max_loss_r
      FROM autonomous_outcome_tracking o
      JOIN autonomous_decision_logs d ON d.id = o.decision_log_id
      WHERE COALESCE(d.strategy_id, '') = $1
        AND o.pnl_r_multiple IS NOT NULL
        AND o.created_at >= now() - ($2 || ' days')::interval
    `,
    [strategyId, String(lookbackDays())],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  const row = result.rows[0];
  if (!row) return emptyMetrics();
  const sampleSize = Number(row.sample_size ?? 0);
  const wins = Number(row.wins ?? 0);
  const losses = Number(row.losses ?? 0);
  const grossWinR = Number(row.gross_win_r ?? 0);
  const grossLossR = Number(row.gross_loss_r ?? 0);
  const averageR = Number(row.average_r ?? 0);
  return {
    sampleSize,
    wins,
    losses,
    winRate: sampleSize > 0 ? Number((wins / sampleSize).toFixed(4)) : 0,
    expectancyR: Number(averageR.toFixed(4)),
    profitFactor: grossLossR > 0 ? Number((grossWinR / grossLossR).toFixed(4)) : grossWinR > 0 ? null : 0,
    averageR: Number(averageR.toFixed(4)),
    maxLossR: Number(row.max_loss_r ?? 0),
  };
}

export async function evaluateStrategyGovernance(input: {
  strategyId: string;
  tradingStyle?: string | null;
  marketRegime?: string | null;
  decision?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
}): Promise<StrategyGovernanceStatus> {
  await ensureStrategyGovernanceSchema();
  const strategyId = input.strategyId;
  const tradingStyle = (input.tradingStyle as TradingStyleId | undefined) ?? styleFromStrategyId(strategyId);
  const blockers: string[] = [];

  if (!governanceEnabled()) {
    return {
      strategyId,
      tradingStyle: tradingStyle ?? null,
      enabled: true,
      eligible: true,
      blockers: [],
      metrics: emptyMetrics(),
    };
  }

  const override = await loadOverride(strategyId);
  if (!override.enabled) {
    blockers.push(`Strategy ${strategyId} is disabled${override.reason ? `: ${override.reason}` : '.'}`);
  }

  const requiresPromotion = envBool('CACSMS_REQUIRE_STRATEGY_PROMOTION', true);
  const actionable = ['BUY', 'SELL'].includes(String(input.decision ?? '').toUpperCase());
  if (requiresPromotion && actionable) {
    const symbol = String(input.symbol ?? '').trim().toUpperCase();
    const timeframe = String(input.timeframe ?? '').trim().toUpperCase();
    if (!symbol || !timeframe) {
      blockers.push('Strategy promotion check requires symbol and timeframe before live execution.');
    } else {
      const { getLatestPromotionReview } = await import('@/lib/strategy-backtesting');
      const promotion = await getLatestPromotionReview(strategyId, symbol, timeframe).catch(() => null);
      if (!promotion) {
        blockers.push(`Strategy ${strategyId} has no passing backtest/walk-forward promotion review for ${symbol} ${timeframe}.`);
      } else if (!promotion.eligible) {
        blockers.push(`Strategy ${strategyId} is not promoted for ${symbol} ${timeframe}: ${promotion.blockers.join('; ') || 'promotion gates failed'}.`);
      }
    }
  }

  const metrics = await getStrategyPerformance(strategyId);
  if (metrics.sampleSize >= minSamples()) {
    if (metrics.expectancyR < minExpectancyR()) {
      blockers.push(`Strategy expectancy ${metrics.expectancyR}R is below minimum ${minExpectancyR()}R.`);
    }
    if (metrics.winRate < minWinRate()) {
      blockers.push(`Strategy win rate ${(metrics.winRate * 100).toFixed(1)}% is below minimum ${(minWinRate() * 100).toFixed(1)}%.`);
    }
  }

  if (tradingStyle && TRADING_STYLE_PROFILES[tradingStyle]) {
    const profile = getTradingStyleProfile(tradingStyle);
    const regime = String(input.marketRegime ?? '').toLowerCase();
    if (profile.id === 'scalp' && /weekly|position|macro/.test(regime)) {
      blockers.push('Scalp strategy is not eligible in macro/position regime.');
    }
    if (profile.id === 'position' && /micro|scalp/.test(regime)) {
      blockers.push('Position strategy is not eligible in micro/scalp regime.');
    }
  }

  const eligible = blockers.length === 0;
  await snapshotStrategyGovernance({
    strategyId,
    tradingStyle: tradingStyle ?? null,
    metrics,
    eligible,
    blockers,
  }).catch(() => null);

  return {
    strategyId,
    tradingStyle: tradingStyle ?? null,
    enabled: override.enabled,
    eligible,
    blockers,
    metrics,
  };
}

async function snapshotStrategyGovernance(input: {
  strategyId: string;
  tradingStyle: string | null;
  metrics: StrategyPerformanceMetrics;
  eligible: boolean;
  blockers: string[];
}) {
  await queryPostgres(
    `
      INSERT INTO strategy_governance_snapshots (
        id, strategy_id, trading_style, sample_size, wins, losses, win_rate, expectancy_r,
        profit_factor, average_r, max_loss_r, eligible, blockers_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
    `,
    [
      randomUUID(),
      input.strategyId,
      input.tradingStyle,
      input.metrics.sampleSize,
      input.metrics.wins,
      input.metrics.losses,
      input.metrics.winRate,
      input.metrics.expectancyR,
      input.metrics.profitFactor,
      input.metrics.averageR,
      input.metrics.maxLossR,
      input.eligible,
      JSON.stringify(input.blockers),
    ],
  );
}

export async function listStrategyGovernance(): Promise<StrategyGovernanceStatus[]> {
  await ensureStrategyGovernanceSchema();
  const strategyRows = await queryPostgres(
    `
      SELECT DISTINCT COALESCE(strategy_id, '') AS strategy_id, trading_style
      FROM autonomous_decision_logs
      WHERE COALESCE(strategy_id, '') <> ''
      ORDER BY strategy_id
      LIMIT 200
    `,
  ).catch(() => ({ rows: [] as Array<{ strategy_id?: string; trading_style?: string }> }));

  const seeded = new Set<string>();
  const rows = [...strategyRows.rows];
  for (const style of Object.keys(TRADING_STYLE_PROFILES) as TradingStyleId[]) {
    const profile = getTradingStyleProfile(style);
    const id = normalizeStrategyId({
      tradingStyle: style,
      timeframe: profile.entryTimeframe,
      setupType: 'autonomous_fusion',
    });
    if (!rows.some((row) => String(row.strategy_id) === id)) rows.push({ strategy_id: id, trading_style: style });
  }

  const statuses: StrategyGovernanceStatus[] = [];
  for (const row of rows) {
    const strategyId = String(row.strategy_id ?? '').trim();
    if (!strategyId || seeded.has(strategyId)) continue;
    seeded.add(strategyId);
    const tradingStyle = typeof row.trading_style === 'string'
      ? row.trading_style
      : styleFromStrategyId(strategyId);
    statuses.push(await evaluateStrategyGovernance({
      strategyId,
      tradingStyle,
    }));
  }
  return statuses;
}
