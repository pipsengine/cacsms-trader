import { fuseMacroIntelligence } from './macro-intelligence-store';
import { getLatestPairSelection } from './pair-selector';
import { queryPostgres } from './postgres';
import { ensurePipelineSchema } from './top-down-orchestrator';

export interface PipelineResetResult {
  symbol: string;
  tradingAccountsReset: number;
  riskDecisionsCleared: number;
  executionDispatchesCleared: number;
  jobsCancelled: number;
  sessionsArchived: number;
  macroRefreshed: boolean;
}

export async function resetAutonomousPipeline(symbol = 'AUTO'): Promise<PipelineResetResult> {
  await ensurePipelineSchema();
  const selection = await getLatestPairSelection();
  const activeSymbol = symbol.toUpperCase() === 'AUTO'
    ? (selection?.selectedSymbol ?? selection?.selectedSymbols?.[0] ?? 'XAUUSD').toUpperCase()
    : symbol.toUpperCase();

  const accounts = await queryPostgres(`
    UPDATE trading_accounts
    SET starting_equity_today = GREATEST(equity, balance),
        peak_equity_all_time = GREATEST(peak_equity_all_time, equity, balance),
        updated_at = now()
    RETURNING account_number
  `);

  const risk = await queryPostgres('DELETE FROM risk_decisions RETURNING id');
  const dispatches = await queryPostgres(`
    DELETE FROM autonomy_execution_dispatches
    WHERE status IN ('blocked', 'failed', 'skipped')
    RETURNING id
  `);
  const jobs = await queryPostgres(`
    UPDATE autonomous_jobs
    SET status = 'cancelled', completed_at = now(), updated_at = now()
    WHERE status IN ('queued', 'running')
    RETURNING id
  `);
  const sessions = await queryPostgres(`
    UPDATE autonomous_pipeline_sessions
    SET status = 'completed',
        completed_at = COALESCE(completed_at, now()),
        current_stage = 'unattended-operations',
        stage_status_json = '{}'::jsonb,
        updated_at = now()
    WHERE status IN ('queued', 'running')
    RETURNING id
  `);

  let macroRefreshed = false;
  try {
    await fuseMacroIntelligence(activeSymbol);
    macroRefreshed = true;
  } catch {
    macroRefreshed = false;
  }

  return {
    symbol: activeSymbol,
    tradingAccountsReset: accounts.rows.length,
    riskDecisionsCleared: risk.rows.length,
    executionDispatchesCleared: dispatches.rows.length,
    jobsCancelled: jobs.rows.length,
    sessionsArchived: sessions.rows.length,
    macroRefreshed,
  };
}
