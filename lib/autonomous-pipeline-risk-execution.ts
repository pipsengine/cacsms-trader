import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import { hydrateAutonomousDecisionFromRow, isRetryableExecutionBlocker, isTerminalExecutionBlocker } from '@/lib/autonomy-decision-hydration';
import { resolveAutonomousVolumeLots } from './autonomy-lot-sizing';
import { shouldDispatchPipelineExecution } from './autonomy-pipeline-throttle';
import {
  dispatchAutonomyDecision,
  evaluateAutonomyExecutionChecklist,
  resolveConnectedTerminalId,
  resolveExecutableAutonomyDecision,
} from './autonomy-execution-adapter';
import { getAutonomyConfig } from './autonomy-store';
import { resolveExecutionAccountContext } from './execution-account-context';
import { evaluateExecutionRiskGate } from './execution-risk-gate';
import { getOpenPositionMetrics } from './execution-open-positions';
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
        recommended_next_action,
        trading_style,
        strategy_id,
        market_regime,
        htf_bias,
        ltf_trigger,
        decision_evidence_json
      FROM autonomous_decision_logs
      WHERE upper(symbol) = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [symbol.toUpperCase()],
  );
  const row = result.rows[0];
  if (!row) return null;
  return hydrateAutonomousDecisionFromRow(row);
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
    const code = String(row?.code ?? '');
    const actionable = decision.decision === 'BUY' || decision.decision === 'SELL';
    if (
      !allowed
      && (
        code === 'consecutive_loss_limit'
        || code === 'stop_loss_required'
        || code === 'invalid_stop_loss'
        || (!actionable && code !== 'signal_not_actionable')
      )
    ) {
      await queryPostgres('DELETE FROM risk_decisions WHERE intent_id = $1', [decision.decisionLogId]);
    } else {
      return {
        status: allowed ? 'completed' : 'blocked',
        detail: String(row?.message ?? 'Risk evaluation already recorded.'),
        metrics: {
          decisionLogId: decision.decisionLogId,
          allowed,
          code,
          decision: decision.decision,
        },
      };
    }
  }

  const account = await resolveExecutionAccountContext(terminalId);
  if (!account) {
    return {
      status: 'failed',
      detail: 'Risk gate blocked — unable to resolve account context.',
      metrics: { decisionLogId: decision.decisionLogId },
    };
  }

  const { decision: executableDecision, stopTargets } = await resolveExecutableAutonomyDecision(decision);
  if (stopTargets && executableDecision.stopLoss) {
    await queryPostgres(
      `
        UPDATE autonomous_decision_logs
        SET stop_loss = $2,
            take_profit_levels_json = $3::jsonb,
            invalidation_level = $4
        WHERE id = $1
          AND (stop_loss IS NULL OR stop_loss <= 0)
      `,
      [
        decision.decisionLogId,
        executableDecision.stopLoss,
        JSON.stringify(executableDecision.takeProfitLevels ?? [stopTargets.takeProfit]),
        executableDecision.invalidationLevel ?? stopTargets.invalidationLevel,
      ],
    ).catch(() => null);
  }
  const sized = resolveAutonomousVolumeLots({
    decision: executableDecision,
    account,
    entryPrice: stopTargets?.entryPrice,
  });

  const evaluation = await evaluateExecutionRiskGate({
    terminalId,
    intentId: decision.decisionLogId,
    commandId: `pipeline-risk-${decision.decisionLogId.slice(0, 8)}`,
    symbol: executableDecision.symbol,
    side: executableDecision.decision,
    entryPrice: stopTargets?.entryPrice,
    requestedLots: sized.lots,
    stopLoss: stopTargets?.stopLoss ?? 0,
    takeProfit: stopTargets?.takeProfit ?? 0,
    rewardRiskRatio: stopTargets?.rewardRiskRatio,
    sandboxMode: account.sandboxMode,
    environment: account.environment,
  });

  const actionable = decision.decision === 'BUY' || decision.decision === 'SELL';
  const status = evaluation.decision.allowed ? 'completed' : 'blocked';
  const detail = actionable
    ? evaluation.decision.message
    : evaluation.decision.code === 'signal_not_actionable'
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
    const blockers = Array.isArray(row?.blockers_json) ? row.blockers_json.map(String) : [];
    const stopLossBlocker = blockers.some((item) => /stop loss/i.test(item));
    const retryableBlocker = isRetryableExecutionBlocker(blockers);
    if (dispatchStatus === 'blocked' && (stopLossBlocker || retryableBlocker)) {
      await queryPostgres(
        'DELETE FROM autonomy_execution_dispatches WHERE decision_log_id = $1 AND status = $2',
        [decision.decisionLogId, 'blocked'],
      ).catch(() => null);
    } else if (dispatchStatus === 'dispatched' || dispatchStatus === 'queued') {
      return {
        status: 'dispatched',
        detail: `Execution dispatch already recorded (${dispatchStatus}).`,
        metrics: {
          decisionLogId: decision.decisionLogId,
          commandId: row?.command_id ? String(row.command_id) : null,
          blockers,
        },
      };
    } else if (dispatchStatus === 'blocked') {
      return {
        status: 'blocked',
        detail: `Execution blocked: ${blockers.join(' ') || dispatchStatus}`,
        metrics: {
          decisionLogId: decision.decisionLogId,
          commandId: row?.command_id ? String(row.command_id) : null,
          blockers,
        },
      };
    }
  }

  const riskApproval = await queryPostgres(
    'SELECT allowed FROM risk_decisions WHERE intent_id = $1 ORDER BY created_at DESC LIMIT 1',
    [decision.decisionLogId],
  );
  if (!Boolean(riskApproval.rows[0]?.allowed)) {
    return {
      status: 'blocked',
      detail: 'Execution waiting for risk gate approval.',
      metrics: { decisionLogId: decision.decisionLogId },
    };
  }

  if (!(await shouldDispatchPipelineExecution(decision.decisionLogId, accountClass, decision.symbol))) {
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

  if (summary.riskGate === 'completed') {
    try {
      const execution = await advancePipelineExecution(symbol, decision, sessionId);
      summary.execution = execution.status;
    } catch (error) {
      summary.execution = 'failed';
      summary.errors.push(error instanceof Error ? error.message : 'Execution dispatch failed.');
    }
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
  const code = String(row.code ?? '');
  const cleared = allowed && code === 'signal_not_actionable';
  return {
    status: allowed ? 'completed' as const : 'in_progress' as const,
    detail: cleared
      ? String(row.message)
      : `${allowed ? 'Risk approved' : 'Risk blocked'} for ${decision.decision}: ${String(row.message)}`,
    progress: allowed ? (actionable ? 100 : 90) : 55,
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
        const executed = bridge.acked > 0 || bridge.executedToday > 0;
        return {
          status: executed ? 'completed' as const : 'in_progress' as const,
          detail: executed
            ? `${Math.max(bridge.acked, bridge.executedToday)} command(s) acknowledged by terminal.`
            : `Command ${String(row.command_id ?? '')} queued for terminal.`,
          progress: executed ? 100 : 55,
          metrics: { ...bridge, commandId: row.command_id ? String(row.command_id) : null, blockers },
        };
      }
      if (status === 'blocked') {
        const liveChecklist = await evaluateAutonomyExecutionChecklist({
          decision,
          config: await getAutonomyConfig(),
          manual: false,
        }).catch(() => null);
        const liveBlockers = liveChecklist?.blockers?.length
          ? liveChecklist.blockers
          : blockers.map(String);
        if (isTerminalExecutionBlocker(liveBlockers)) {
          return {
            status: 'completed' as const,
            detail: `Managing open ${decision.decision} setup — ${liveBlockers[0] ?? 'entry deferred while legs are active.'}`,
            progress: 100,
            metrics: { ...bridge, blockers: liveBlockers, dispatchStatus: status, deferred: true },
          };
        }
        return {
          status: 'in_progress' as const,
          detail: liveChecklist?.ready
            ? `Execution re-check passed for ${decision.decision}; dispatch will retry on next cycle.`
            : `Execution blocked for ${decision.decision}: ${liveBlockers.join(' ') || status}`,
          progress: liveChecklist?.ready ? 45 : 25,
          metrics: { ...bridge, blockers: liveBlockers, dispatchStatus: status },
        };
      }
      return {
        status: 'in_progress' as const,
        detail: `Execution status ${status} for ${decision.decision}.`,
        progress: 20,
        metrics: { ...bridge, blockers: blockers.map(String), dispatchStatus: status },
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

  if (bridge.acked > 0 || bridge.executedToday > 0) {
    const count = Math.max(bridge.acked, bridge.executedToday);
    return {
      status: 'completed' as const,
      detail: `${count} command(s) acknowledged by terminal${bridge.executedToday > 0 ? ` · ${bridge.executedToday} today` : ''}.`,
      progress: 100,
      metrics: bridge,
    };
  }
  if (bridge.queued > 0) {
    return { status: 'in_progress' as const, detail: `${bridge.queued} command(s) queued for terminal.`, progress: 55, metrics: bridge };
  }
  return { status: 'not_started' as const, detail: 'No execution commands in queue.', progress: 0, metrics: bridge };
}

async function getPersistedExecutionMetrics() {
  try {
    const result = await queryPostgres(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE lifecycle_state IN ('EXECUTED', 'ACKNOWLEDGED')
          )::int AS acked,
          COUNT(*) FILTER (
            WHERE lifecycle_state IN ('QUEUED', 'ROUTING', 'SENT')
          )::int AS queued,
          COUNT(*) FILTER (
            WHERE lifecycle_state = 'EXECUTED'
              AND created_at >= date_trunc('day', now())
          )::int AS executed_today
        FROM execution_commands
        WHERE upper(replace(type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')
      `,
    );
    const row = result.rows[0] as { acked?: number; queued?: number; executed_today?: number } | undefined;
    return {
      acked: Number(row?.acked ?? 0),
      queued: Number(row?.queued ?? 0),
      executedToday: Number(row?.executed_today ?? 0),
    };
  } catch {
    return { acked: 0, queued: 0, executedToday: 0 };
  }
}

export async function getBridgeExecutionMetrics() {
  const openPositionMetrics = await getOpenPositionMetrics().catch(() => ({
    trackedOpen: 0,
    terminalOpen: 0,
    openOrders: 0,
    positions: [] as Array<{
      ticket: string;
      symbol: string | null;
      side: string | null;
      volumeLots: number | null;
      profitLoss: number;
    }>,
  }));

  const persisted = await getPersistedExecutionMetrics();
  let bridgeQueued = 0;
  let bridgeAcked = 0;

  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787'}/commands`, { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      const commands = Array.isArray(payload.commands) ? payload.commands : [];
      bridgeAcked = commands.filter((item: { status?: string }) => item.status === 'acknowledged').length;
      bridgeQueued = commands.filter((item: { status?: string }) => item.status === 'queued' || item.status === 'leased').length;
    }
  } catch {
    // fall back to persisted metrics only
  }

  return {
    acked: Math.max(persisted.acked, bridgeAcked),
    queued: Math.max(persisted.queued, bridgeQueued),
    executedToday: persisted.executedToday,
    openOrders: openPositionMetrics.openOrders,
    trackedOpen: openPositionMetrics.trackedOpen,
    terminalOpen: openPositionMetrics.terminalOpen,
    openPositions: openPositionMetrics.positions.map((position) => ({
      ticket: position.ticket,
      symbol: position.symbol,
      side: position.side,
      volumeLots: position.volumeLots,
      profitLoss: position.profitLoss,
    })),
  };
}
