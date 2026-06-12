import { randomUUID } from 'crypto';
import { queryPostgres } from '@/lib/postgres';

type DirectionAuditInput = {
  decisionLogId?: string | null;
  symbol: string;
  timeframe: string;
  stage: 'signal_generated' | 'execution_blocked' | 'execution_failed' | 'execution_dispatched';
  baseDecision?: string | null;
  finalDecision: string;
  finalBias?: string | null;
  side?: string | null;
  accepted: boolean;
  reasons?: string[];
  metrics?: Record<string, unknown>;
};

const schemaSql = `
CREATE TABLE IF NOT EXISTS autonomy_trade_direction_audit (
  id UUID PRIMARY KEY,
  decision_log_id UUID,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  stage TEXT NOT NULL,
  base_decision TEXT,
  final_decision TEXT NOT NULL,
  final_bias TEXT,
  side TEXT,
  accepted BOOLEAN NOT NULL,
  reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_autonomy_direction_audit_created
  ON autonomy_trade_direction_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autonomy_direction_audit_side_stage
  ON autonomy_trade_direction_audit(side, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autonomy_direction_audit_decision
  ON autonomy_trade_direction_audit(decision_log_id);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureAutonomyDirectionMonitorSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = queryPostgres(schemaSql).then(() => undefined);
  }
  return schemaReady;
}

export async function logAutonomyDirectionAudit(input: DirectionAuditInput): Promise<void> {
  await ensureAutonomyDirectionMonitorSchema();
  await queryPostgres(
    `
      INSERT INTO autonomy_trade_direction_audit (
        id, decision_log_id, symbol, timeframe, stage, base_decision, final_decision,
        final_bias, side, accepted, reasons_json, metrics_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
    `,
    [
      randomUUID(),
      input.decisionLogId ?? null,
      input.symbol.toUpperCase(),
      input.timeframe.toUpperCase(),
      input.stage,
      input.baseDecision ?? null,
      input.finalDecision,
      input.finalBias ?? null,
      input.side ?? executableSide(input.finalDecision),
      input.accepted,
      JSON.stringify(input.reasons ?? []),
      JSON.stringify(input.metrics ?? {}),
    ],
  ).catch(() => undefined);
}

export async function getAutonomyDirectionMetrics(hours = 24) {
  await ensureAutonomyDirectionMonitorSchema();
  const windowHours = Math.max(1, Math.min(720, Math.round(hours)));
  const [decisions, dispatches, blockers, audit] = await Promise.all([
    queryPostgres(
      `
        SELECT decision, COUNT(*)::int AS count
        FROM autonomous_decision_logs
        WHERE created_at >= now() - ($1 || ' hours')::interval
        GROUP BY decision
        ORDER BY decision
      `,
      [String(windowHours)],
    ),
    queryPostgres(
      `
        SELECT side, status, COUNT(*)::int AS count
        FROM autonomy_execution_dispatches
        WHERE created_at >= now() - ($1 || ' hours')::interval
        GROUP BY side, status
        ORDER BY side, status
      `,
      [String(windowHours)],
    ),
    queryPostgres(
      `
        SELECT reason, COUNT(*)::int AS count
        FROM (
          SELECT jsonb_array_elements_text(blockers_json) AS reason
          FROM autonomy_execution_dispatches
          WHERE side = 'SELL'
            AND created_at >= now() - ($1 || ' hours')::interval
        ) reasons
        GROUP BY reason
        ORDER BY count DESC
        LIMIT 10
      `,
      [String(windowHours)],
    ),
    queryPostgres(
      `
        SELECT stage, side, accepted, COUNT(*)::int AS count
        FROM autonomy_trade_direction_audit
        WHERE created_at >= now() - ($1 || ' hours')::interval
        GROUP BY stage, side, accepted
        ORDER BY stage, side, accepted
      `,
      [String(windowHours)],
    ),
  ]);

  const decisionCounts = countMap(decisions.rows, 'decision');
  const buySignals = Number(decisionCounts.BUY ?? 0);
  const sellSignals = Number(decisionCounts.SELL ?? 0);
  return {
    windowHours,
    generated: {
      ...decisionCounts,
      buyToSellRatio: ratio(buySignals, sellSignals),
    },
    dispatches: dispatches.rows.map((row) => ({
      side: String(row.side ?? ''),
      status: String(row.status ?? ''),
      count: Number(row.count ?? 0),
    })),
    sellRejectionReasons: blockers.rows.map((row) => ({
      reason: String(row.reason ?? ''),
      count: Number(row.count ?? 0),
    })),
    auditStages: audit.rows.map((row) => ({
      stage: String(row.stage ?? ''),
      side: row.side == null ? null : String(row.side),
      accepted: Boolean(row.accepted),
      count: Number(row.count ?? 0),
    })),
  };
}

function countMap(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
  const output: Record<string, number> = {};
  for (const row of rows) output[String(row[key] ?? '')] = Number(row.count ?? 0);
  return output;
}

function ratio(left: number, right: number): number | null {
  if (right <= 0) return left > 0 ? null : 1;
  return Number((left / right).toFixed(4));
}

function executableSide(decision: string): string | null {
  const normalized = decision.toUpperCase();
  return normalized === 'BUY' || normalized === 'SELL' ? normalized : null;
}
