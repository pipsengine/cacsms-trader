export const runtime = 'nodejs';

import { getAutonomyConfig } from '@/lib/autonomy-store';
import { dispatchAutonomyDecision } from '@/lib/autonomy-execution-adapter';
import { queryPostgres } from '@/lib/postgres';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      decisionLogId?: string;
      volumeLots?: number;
    };
    const decisionLogId = String(body.decisionLogId ?? '').trim();
    if (!decisionLogId) {
      return Response.json({ ok: false, error: 'decisionLogId is required.' }, { status: 400 });
    }

    const result = await queryPostgres(`SELECT * FROM autonomous_decision_logs WHERE id = $1 LIMIT 1`, [decisionLogId]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return Response.json({ ok: false, error: 'Decision log not found.' }, { status: 404 });
    }

    const decision = {
      symbol: String(row.symbol),
      timeframe: String(row.timeframe),
      dominantTimeframe: String(row.dominant_timeframe),
      finalBias: String(row.final_bias),
      setupType: String(row.setup_type),
      setupReadinessScore: Number(row.setup_readiness_score ?? 0),
      confidenceScore: Number(row.confidence_score ?? 0),
      riskScore: Number(row.risk_score ?? 0),
      decision: String(row.decision) as 'BUY' | 'SELL' | 'WAIT' | 'AVOID' | 'MONITOR',
      entryZone: (row.entry_zone_json as Record<string, unknown>) ?? {},
      stopLoss: row.stop_loss == null ? null : Number(row.stop_loss),
      takeProfitLevels: Array.isArray(row.take_profit_levels_json)
        ? (row.take_profit_levels_json as number[])
        : [],
      invalidationLevel: row.invalidation_level == null ? null : Number(row.invalidation_level),
      reasonForDecision: String(row.reason_for_decision ?? ''),
      reasonAgainstDecision: String(row.reason_against_decision ?? ''),
      macroRiskWarning: String(row.macro_risk_warning ?? ''),
      liquidityWarning: String(row.liquidity_warning ?? ''),
      anomalyWarning: String(row.anomaly_warning ?? ''),
      recommendedNextAction: String(row.recommended_next_action ?? ''),
    };

    const config = await getAutonomyConfig();
    const dispatch = await dispatchAutonomyDecision({
      decisionLogId,
      decision,
      config,
      manual: true,
      volumeLots: Number(body.volumeLots ?? 0) || undefined,
    });

    return Response.json({ ok: dispatch.ok, dispatch }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to dispatch autonomy decision.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
