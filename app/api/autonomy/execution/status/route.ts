export const runtime = 'nodejs';

import { getAutonomyConfig } from '@/lib/autonomy-store';
import { resolveExecutionAccountContext } from '@/lib/execution-account-context';
import {
  evaluateAutonomyExecutionChecklist,
  listAutonomyExecutionDispatches,
  resolveConnectedTerminalId,
} from '@/lib/autonomy-execution-adapter';
import { getExecutionPolicyStatus } from '@/lib/execution-policy';
import { queryPostgres } from '@/lib/postgres';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const decisionLogId = url.searchParams.get('decisionLogId');
    const config = await getAutonomyConfig();
    const [policy, terminalId, dispatches, accountContext] = await Promise.all([
      getExecutionPolicyStatus(),
      resolveConnectedTerminalId(),
      listAutonomyExecutionDispatches(25),
      resolveExecutionAccountContext(),
    ]);

    let checklist = null;
    if (decisionLogId) {
      const result = await queryPostgres(`SELECT * FROM autonomous_decision_logs WHERE id = $1 LIMIT 1`, [decisionLogId]);
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (row) {
        checklist = await evaluateAutonomyExecutionChecklist({
          decision: {
            symbol: String(row.symbol),
            timeframe: String(row.timeframe ?? 'M15'),
            tradingStyle: typeof row.trading_style === 'string'
              ? (row.trading_style as 'scalp' | 'intraday' | 'day_trade' | 'swing' | 'position')
              : undefined,
            setupType: String(row.setup_type ?? 'autonomous_fusion'),
            decision: String(row.decision) as 'BUY' | 'SELL' | 'WAIT' | 'AVOID' | 'MONITOR',
            confidenceScore: Number(row.confidence_score ?? 0),
            setupReadinessScore: Number(row.setup_readiness_score ?? 0),
            riskScore: Number(row.risk_score ?? 0),
            stopLoss: row.stop_loss == null ? null : Number(row.stop_loss),
            takeProfitLevels: Array.isArray(row.take_profit_levels_json)
              ? (row.take_profit_levels_json as number[])
              : [],
            macroRiskWarning: String(row.macro_risk_warning ?? ''),
          },
          config,
          manual: true,
        });
      }
    }

    return Response.json(
      {
        ok: true,
        config: {
          tradeExecutionMode: config.tradeExecutionMode,
          confidenceThreshold: config.confidenceThreshold,
          riskThreshold: config.riskThreshold,
        },
        policy,
        terminalId,
        autonomyExecutionEnabled: String(process.env.CACSMS_ENABLE_AUTONOMY_EXECUTION ?? '').toLowerCase() === 'true',
        liveExecutionEnabled: String(process.env.CACSMS_ENABLE_LIVE_EXECUTION ?? '').toLowerCase() === 'true',
        accountContext,
        dispatches,
        checklist,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load autonomy execution status.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
