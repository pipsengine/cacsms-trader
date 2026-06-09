import type { AutonomousDecisionOutput } from './autonomy-types';
import { resolveAutonomousVolumeLots } from './autonomy-lot-sizing';
import { shouldDispatchPipelineExecution } from './autonomy-pipeline-throttle';
import {
  dispatchAutonomyDecision,
  evaluateAutonomyExecutionChecklist,
  resolveConnectedTerminalId,
} from './autonomy-execution-adapter';
import { getAutonomyConfig } from './autonomy-store';
import { resolveExecutionAccountContext } from './execution-account-context';
import { evaluateExecutionRiskGate } from './execution-risk-gate';
import { queryPostgres } from './postgres';
import { completePipelineStage } from './top-down-orchestrator';

export interface PipelineRiskExecutionSummary {
  riskGate: 'skipped' | 'completed' | 'blocked' | 'failed';
  execution: 'skipped' | 'dispatched' | 'blocked' | 'failed' | 'not_actionable';
  errors: string[];
}

type StoredDecision = AutonomousDecisionOutput & { decisionLogId: string };

async function loadLatestDecision(symbol: string): Promise<StoredDecision | null> {
  const result = await queryPostgres(
    `
      SELECT
        id,
        symbol,
        timeframe,
        dominant_timeframe,
        final_bias,
        setup_type,
        setup_readiness_score,
        confidence_score,
        risk_score,
        decision,
        entry_zone_json,
        stop_loss,
        take_profit_levels_json,
        invalidation_level,
        reason_for_decision,
        reason_against_decision,
        macro_risk_warning,
        liquidity_warning,
        anomaly_warning,
        recommended_next_action
      FROM autonomous_decision_logs
      WHERE upper(symbol) = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [symbol.toUpperCase()],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    decisionLogId: String(row.id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    dominantTimeframe: String(row.dominant_timeframe ?? row.timeframe),
    finalBias: String(row.final_bias ?? 'neutral'),
    setupType: String(row.setup_type ?? 'market structure assessment'),
    setupReadinessScore: Number(row.setup_readiness_score ?? 0),
    confidenceScore: Number(row.confidence_score ?? 0),
    riskScore: Number(row.risk_score ?? 0),
    decision: String(row.decision) as AutonomousDecisionOutput['decision'],
    entryZone: (row.entry_zone_json as AutonomousDecisionOutput['entryZone']) ?? { status: 'not_ready', narrative: '' },
    stopLoss: row.stop_loss == null ? null : Number(row.stop_loss),
    takeProfitLevels: Array.isArray(row.take_profit_levels_json) ? row.take_profit_levels_json.map(Number) : [],
    invalidationLevel: row.invalidation_level == null ? null : Number(row.invalidation_level),
    reasonForDecision: String(row.reason_for_decision ?? ''),
    reasonAgainstDecision: String(row.reason_against_decision ?? ''),
    macroRiskWarning: String(row.macro_risk_warning ?? ''),
    liquidityWarning: String(row.liquidity_warning ?? ''),
    anomalyWarning: String(row.anomaly_warning ?? ''),
    recommendedNextAction: String(row.recommended_next_action ?? ''),
  };
}

async function hasRiskEvaluation(decisionLogId: string): Promise<boolean> {
  const result = await queryPostgres(
    'SELECT 1 FROM risk_decisions WHERE intent_id = $1 LIMIT 1',
    [decisionLogId],
  );
  return result.rows.length > 0;
}

async function hasExecutionDispatch(decisionLogId: string): Promise<boolean> {
  const result = await queryPostgres(
    'SELECT 1 FROM autonomy_execution_dispatches WHERE decision_log_id = $1 LIMIT 1',
    [decisionLogId],
  );
  return result.rows.length > 0;
}

export async function advancePipelineRiskGate(
  symbol: string,
  decision: StoredDecision,
  sessionId?: string | null,
): Promise<{ status: PipelineRiskExecutionSummary['riskGate']; detail: string; metrics: Record<string, unknown> }> {
  const terminalId = await resolveConnectedTerminalId();
  if (!terminalId) {
    return {
      status: 'failed',
      detail: 'Risk gate blocked — no connected terminal.',
      metrics: { decisionLogId: decision.decisionLogId },
    };
  }

  if (await hasRiskEvaluation(decision.decisionLogId)) {
    const existing = await queryPostgres(
      'SELECT allowed, code, message FROM risk_decisions WHERE intent_id = $1 ORDER BY created_at DESC LIMIT 1',
      [decision.decisionLogId],
    );
    const row = existing.rows[0];
    const allowed = Boolean(row?.allowed);
    return {
      status: allowed ? 'completed' : 'blocked',
      detail: String(row?.message ?? 'Risk evaluation already recorded.'),
      metrics: {
        decisionLogId: decision.decisionLogId,
        allowed,
        code: String(row?.code ?? ''),
        decision: decision.decision,
      },
    };
  }

  const account = await resolveExecutionAccountContext(terminalId);
  if (!account) {
    return {
      status: 'failed',
      detail: 'Risk gate blocked — unable to resolve account context.',
      metrics: { decisionLogId: decision.decisionLogId },
    };
  }

  const sized = resolveAutonomousVolumeLots({
    decision,
    account,
  });

  const evaluation = await evaluateExecutionRiskGate({
    terminalId,
    intentId: decision.decisionLogId,
    commandId: `pipeline-risk-${decision.decisionLogId.slice(0, 8)}`,
    requestedLots: sized.lots,
    sandboxMode: account.sandboxMode,
    environment: account.environment,
  });

  const actionable = decision.decision === 'BUY' || decision.decision === 'SELL';
  const status = evaluation.decision.allowed
    ? (actionable ? 'completed' : 'completed')
    : 'blocked';
  const detail = actionable
    ? evaluation.decision.message
    : `${evaluation.decision.message} Signal is ${decision.decision}; execution remains gated until BUY/SELL.`;

  if (sessionId && evaluation.decision.allowed) {
    await completePipelineStage(sessionId, 'risk-gate', 100, {
      eventType: 'risk.gate.evaluated',
      message: detail,
      payload: {
        decisionLogId: decision.decisionLogId,
        allowed: evaluation.decision.allowed,
        code: evaluation.decision.code,
        decision: decision.decision,
      },
    });
  }

  return {
    status,
    detail,
    metrics: {
      decisionLogId: decision.decisionLogId,
      allowed: evaluation.decision.allowed,
      code: evaluation.decision.code,
      decision: decision.decision,
      accountNumber: evaluation.accountNumber,
    },
  };
}

export async function advancePipelineExecution(
  symbol: string,
  decision: StoredDecision,
  sessionId?: string | null,
): Promise<{ status: PipelineRiskExecutionSummary['execution']; detail: string; metrics: Record<string, unknown> }> {
  const account = await resolveExecutionAccountContext();
  const accountClass = account?.accountClass ?? 'demo';

  if (!['BUY', 'SELL'].includes(decision.decision)) {
    const checklist = await evaluateAutonomyExecutionChecklist({
      decision,
      config: await getAutonomyConfig(),
      manual: false,
    });
    const detail = `Signal is ${decision.decision}; execution dispatch skipped. ${checklist.blockers[0] ?? 'Awaiting actionable BUY/SELL signal.'}`;
    return {
      status: 'not_actionable',
      detail,
      metrics: { decisionLogId: decision.decisionLogId, decision: decision.decision, blockers: checklist.blockers },
    };
  }

  if (await hasExecutionDispatch(decision.decisionLogId)) {
    const existing = await queryPostgres(
      'SELECT status, blockers_json, command_id FROM autonomy_execution_dispatches WHERE decision_log_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [decision.decisionLogId],
    );
    const row = existing.rows[0];
    const dispatchStatus = String(row?.status ?? 'blocked');
    return {
      status: dispatchStatus === 'dispatched' || dispatchStatus === 'queued' ? 'dispatched' : 'blocked',
      detail: `Execution dispatch already recorded (${dispatchStatus}).`,
      metrics: {
        decisionLogId: decision.decisionLogId,
        commandId: row?.command_id ? String(row.command_id) : null,
        blockers: Array.isArray(row?.blockers_json) ? row.blockers_json : [],
      },
    };
  }

  if (!(await shouldDispatchPipelineExecution(decision.decisionLogId, accountClass))) {
    return {
      status: 'not_actionable',
      detail: 'Execution dispatch cooldown active or decision already dispatched.',
      metrics: { decisionLogId: decision.decisionLogId, accountClass },
    };
  }

  const config = await getAutonomyConfig();
  const dispatch = await dispatchAutonomyDecision({
    decisionLogId: decision.decisionLogId,
    decision,
    config,
    manual: false,
  });

  const progress = dispatch.status === 'dispatched' ? 55 : dispatch.status === 'blocked' ? 30 : 20;
  const detail = dispatch.status === 'dispatched'
    ? `Execution command ${dispatch.commandId ?? 'queued'} dispatched to terminal.`
    : `Execution blocked: ${dispatch.blockers.join(' ') || dispatch.error || 'Unknown blocker.'}`;

  if (sessionId && dispatch.status === 'dispatched') {
    await completePipelineStage(sessionId, 'execution', progress, {
      eventType: 'execution.dispatched',
      message: detail,
      payload: {
        decisionLogId: decision.decisionLogId,
        status: dispatch.status,
        commandId: dispatch.commandId ?? null,
        blockers: dispatch.blockers,
      },
    });
  }

  return {
    status: dispatch.status === 'dispatched' ? 'dispatched' : dispatch.status === 'blocked' ? 'blocked' : 'failed',
    detail,
    metrics: {
      decisionLogId: decision.decisionLogId,
      commandId: dispatch.commandId ?? null,
      blockers: dispatch.blockers,
      status: dispatch.status,
    },
  };
}

export async function advancePipelineRiskAndExecution(
  symbol: string,
  sessionId?: string | null,
): Promise<PipelineRiskExecutionSummary> {
  const summary: PipelineRiskExecutionSummary = {
    riskGate: 'skipped',
    execution: 'skipped',
    errors: [],
  };

  const decision = await loadLatestDecision(symbol);
  if (!decision) {
    return summary;
  }

  try {
    const risk = await advancePipelineRiskGate(symbol, decision, sessionId);
    summary.riskGate = risk.status;
  } catch (error) {
    summary.riskGate = 'failed';
    summary.errors.push(error instanceof Error ? error.message : 'Risk gate evaluation failed.');
  }

  try {
    const execution = await advancePipelineExecution(symbol, decision, sessionId);
    summary.execution = execution.status;
  } catch (error) {
    summary.execution = 'failed';
    summary.errors.push(error instanceof Error ? error.message : 'Execution dispatch failed.');
  }

  return summary;
}

export async function getPipelineRiskStatus(symbol: string) {
  const decision = await loadLatestDecision(symbol);
  if (!decision) {
    return { status: 'not_started' as const, detail: 'Awaiting autonomous signal before risk evaluation.', progress: 0, metrics: {} };
  }

  const result = await queryPostgres(
    'SELECT allowed, code, message, created_at FROM risk_decisions WHERE intent_id = $1 ORDER BY created_at DESC LIMIT 1',
    [decision.decisionLogId],
  );
  if (!result.rows[0]) {
    return {
      status: 'in_progress' as const,
      detail: `Risk gate pending for ${decision.decision} signal.`,
      progress: 40,
      metrics: { decision: decision.decision, decisionLogId: decision.decisionLogId },
    };
  }

  const row = result.rows[0];
  const allowed = Boolean(row.allowed);
  const actionable = decision.decision === 'BUY' || decision.decision === 'SELL';
  return {
    status: allowed ? 'completed' as const : 'in_progress' as const,
    detail: `${allowed ? 'Risk approved' : 'Risk blocked'} for ${decision.decision}: ${String(row.message)}`,
    progress: allowed ? (actionable ? 100 : 85) : 55,
    metrics: {
      decision: decision.decision,
      decisionLogId: decision.decisionLogId,
      allowed,
      code: String(row.code),
    },
  };
}

export async function getPipelineExecutionStatus(symbol: string) {
  const decision = await loadLatestDecision(symbol);
  const bridge = await getBridgeExecutionMetrics();

  if (decision) {
    const dispatch = await queryPostgres(
      'SELECT status, command_id, blockers_json, updated_at FROM autonomy_execution_dispatches WHERE decision_log_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [decision.decisionLogId],
    );
    const row = dispatch.rows[0];
    if (row) {
      const status = String(row.status);
      const blockers = Array.isArray(row.blockers_json) ? row.blockers_json : [];
      if (status === 'dispatched' || status === 'queued') {
        return {
          status: bridge.acked > 0 ? 'completed' as const : 'in_progress' as const,
          detail: bridge.acked > 0
            ? `${bridge.acked} command(s) acknowledged by terminal.`
            : `Command ${String(row.command_id ?? '')} queued for terminal.`,
          progress: bridge.acked > 0 ? 100 : 55,
          metrics: { ...bridge, commandId: row.command_id ? String(row.command_id) : null, blockers },
        };
      }
      return {
        status: 'in_progress' as const,
        detail: `Execution blocked for ${decision.decision}: ${blockers.join(' ') || status}`,
        progress: 25,
        metrics: { ...bridge, blockers, dispatchStatus: status },
      };
    }

    if (!['BUY', 'SELL'].includes(decision.decision)) {
      return {
        status: 'not_started' as const,
        detail: `Awaiting BUY/SELL signal (current: ${decision.decision}).`,
        progress: 10,
        metrics: { ...bridge, decision: decision.decision },
      };
    }
  }

  if (bridge.acked > 0) {
    return { status: 'completed' as const, detail: `${bridge.acked} command(s) acknowledged by terminal.`, progress: 100, metrics: bridge };
  }
  if (bridge.queued > 0) {
    return { status: 'in_progress' as const, detail: `${bridge.queued} command(s) queued for terminal.`, progress: 55, metrics: bridge };
  }
  return { status: 'not_started' as const, detail: 'No execution commands in queue.', progress: 0, metrics: bridge };
}

async function getBridgeExecutionMetrics() {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787'}/commands`, { cache: 'no-store' });
    if (!response.ok) throw new Error('bridge commands unavailable');
    const payload = await response.json();
    const commands = Array.isArray(payload.commands) ? payload.commands : [];
    return {
      acked: commands.filter((item: { status?: string }) => item.status === 'acknowledged').length,
      queued: commands.filter((item: { status?: string }) => item.status === 'queued' || item.status === 'leased').length,
      openOrders: Number(payload.openOrders ?? 0),
    };
  } catch {
    return { acked: 0, queued: 0, openOrders: 0 };
  }
}
