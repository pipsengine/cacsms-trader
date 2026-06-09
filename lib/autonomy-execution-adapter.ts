import { randomUUID } from 'node:crypto';
import type { AutonomousDecisionOutput, AutonomyConfig, AutonomyMode } from '@/lib/autonomy-types';
import { dispatchExecutionCommand, ExecutionPolicyBlockedError, ExecutionRiskBlockedError } from '@/lib/execution-dispatch';
import { getExecutionKillSwitchStatus } from '@/lib/execution-kill-switch';
import { getExecutionPolicyStatus, isExecutionEnabled } from '@/lib/execution-policy';
import { listTerminalSnapshots } from '@/lib/mt5-heartbeat-store';
import { queryPostgres } from '@/lib/postgres';

export type AutonomyExecutionChecklist = {
  ready: boolean;
  blockers: string[];
  mode: AutonomyMode;
  terminalId: string | null;
  sandboxOnly: boolean;
};

export type AutonomyExecutionDispatchResult = {
  ok: boolean;
  status: 'blocked' | 'dispatched' | 'failed' | 'already_dispatched';
  decisionLogId: string;
  commandId?: string;
  terminalId?: string;
  blockers: string[];
  error?: string;
};

function envBool(name: string, fallback = false): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function executionModeAllowsAutoDispatch(mode: AutonomyMode): boolean {
  return mode === 'full_auto';
}

function executionModeAllowsManualDispatch(mode: AutonomyMode): boolean {
  return mode === 'full_auto' || mode === 'assisted_trade';
}

export async function resolveConnectedTerminalId(): Promise<string | null> {
  const bridgeUrl = process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
  try {
    const response = await fetch(`${bridgeUrl}/terminal-operations`, { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      const terminals = Array.isArray(payload.terminals) ? payload.terminals : [];
      const connected = terminals.filter((terminal: { connectionStatus?: string }) => terminal.connectionStatus === 'connected');
      const withExecution = connected.find((terminal: { enableExecution?: boolean }) => terminal.enableExecution);
      const chosen = withExecution ?? connected[0];
      if (chosen?.terminalId) return String(chosen.terminalId);
    }
  } catch {
    // fall through to postgres snapshots
  }

  const terminals = await listTerminalSnapshots();
  const connected = terminals.filter((terminal) => terminal.status === 'connected');
  return connected[0]?.terminalId ?? null;
}

export async function evaluateAutonomyExecutionChecklist(input: {
  decision: Pick<
    AutonomousDecisionOutput,
    'symbol' | 'decision' | 'confidenceScore' | 'setupReadinessScore' | 'riskScore' | 'stopLoss' | 'takeProfitLevels' | 'macroRiskWarning'
  >;
  config: Pick<AutonomyConfig, 'tradeExecutionMode' | 'confidenceThreshold' | 'riskThreshold'>;
  manual?: boolean;
}): Promise<AutonomyExecutionChecklist> {
  const blockers: string[] = [];
  const mode = input.config.tradeExecutionMode;
  const manual = Boolean(input.manual);

  if (!isExecutionEnabled()) {
    blockers.push('CACSMS_ENABLE_EXECUTION is false.');
  }

  if (!envBool('CACSMS_ENABLE_AUTONOMY_EXECUTION', false) && !manual) {
    blockers.push('Autonomous execution is disabled. Set CACSMS_ENABLE_AUTONOMY_EXECUTION=true or dispatch manually.');
  }

  if (manual && !executionModeAllowsManualDispatch(mode)) {
    blockers.push(`tradeExecutionMode=${mode} does not allow manual execution dispatch.`);
  }

  if (!manual && !executionModeAllowsAutoDispatch(mode)) {
    blockers.push(`tradeExecutionMode=${mode} does not allow automatic execution dispatch.`);
  }

  if (!['BUY', 'SELL'].includes(input.decision.decision)) {
    blockers.push(`Decision ${input.decision.decision} is not executable.`);
  }

  if (input.decision.confidenceScore < input.config.confidenceThreshold) {
    blockers.push(`Confidence ${input.decision.confidenceScore}% is below threshold ${input.config.confidenceThreshold}%.`);
  }

  if (input.decision.setupReadinessScore < 55) {
    blockers.push(`Setup readiness ${input.decision.setupReadinessScore}% is below minimum 55%.`);
  }

  if (input.decision.riskScore > input.config.riskThreshold) {
    blockers.push(`Risk score ${input.decision.riskScore}% exceeds threshold ${input.config.riskThreshold}%.`);
  }

  const killSwitch = await getExecutionKillSwitchStatus();
  if (killSwitch.active) {
    blockers.push(killSwitch.reason ?? 'Execution kill switch is active.');
  }

  const policy = await getExecutionPolicyStatus();
  if (policy.killSwitchActive) {
    blockers.push('Execution policy kill switch is active.');
  }

  const emergency = await queryPostgres(
    `SELECT emergency_stopped FROM autonomous_system_health WHERE health_key = 'autonomy' LIMIT 1`,
  ).catch(() => ({ rows: [] as Array<{ emergency_stopped?: boolean }> }));
  if (Boolean(emergency.rows[0]?.emergency_stopped)) {
    blockers.push('Autonomy emergency stop is active.');
  }

  const terminalId = await resolveConnectedTerminalId();
  if (!terminalId) {
    blockers.push('No connected MT5 terminal is available.');
  }

  const highImpact = await queryPostgres(
    `
      SELECT COUNT(*)::int AS count
      FROM economic_events
      WHERE impact = 'High'
        AND event_time BETWEEN now() - interval '30 minutes' AND now() + interval '30 minutes'
    `,
  ).catch(() => ({ rows: [{ count: 0 }] }));
  if (Number(highImpact.rows[0]?.count ?? 0) > 0) {
    blockers.push('High-impact economic event blackout window is active.');
  }

  if (input.decision.macroRiskWarning && /blackout|blocked|avoid/i.test(input.decision.macroRiskWarning)) {
    blockers.push(input.decision.macroRiskWarning);
  }

  return {
    ready: blockers.length === 0,
    blockers,
    mode,
    terminalId,
    sandboxOnly: true,
  };
}

async function persistDispatchRecord(input: {
  decisionLogId: string;
  commandId?: string | null;
  terminalId?: string | null;
  symbol: string;
  side: string;
  status: 'blocked' | 'queued' | 'dispatched' | 'failed';
  blockers: string[];
  payload?: Record<string, unknown>;
}): Promise<void> {
  await queryPostgres(
    `
      INSERT INTO autonomy_execution_dispatches (
        id,
        decision_log_id,
        command_id,
        terminal_id,
        symbol,
        side,
        status,
        blockers_json,
        payload_json,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,now())
      ON CONFLICT (decision_log_id) DO UPDATE SET
        command_id = COALESCE(EXCLUDED.command_id, autonomy_execution_dispatches.command_id),
        terminal_id = COALESCE(EXCLUDED.terminal_id, autonomy_execution_dispatches.terminal_id),
        status = EXCLUDED.status,
        blockers_json = EXCLUDED.blockers_json,
        payload_json = EXCLUDED.payload_json,
        updated_at = now()
    `,
    [
      randomUUID(),
      input.decisionLogId,
      input.commandId ?? null,
      input.terminalId ?? null,
      input.symbol,
      input.side,
      input.status,
      JSON.stringify(input.blockers),
      JSON.stringify(input.payload ?? {}),
    ],
  ).catch(() => null);
}

async function hasExistingDispatch(decisionLogId: string): Promise<boolean> {
  const result = await queryPostgres(
    `
      SELECT status
      FROM autonomy_execution_dispatches
      WHERE decision_log_id = $1
        AND status IN ('queued', 'dispatched')
      LIMIT 1
    `,
    [decisionLogId],
  ).catch(() => ({ rows: [] as Array<{ status?: string }> }));
  return result.rows.length > 0;
}

export async function dispatchAutonomyDecision(input: {
  decisionLogId: string;
  decision: AutonomousDecisionOutput;
  config: AutonomyConfig;
  manual?: boolean;
  volumeLots?: number;
}): Promise<AutonomyExecutionDispatchResult> {
  if (await hasExistingDispatch(input.decisionLogId)) {
    return {
      ok: false,
      status: 'already_dispatched',
      decisionLogId: input.decisionLogId,
      blockers: ['Decision was already dispatched to execution.'],
    };
  }

  const checklist = await evaluateAutonomyExecutionChecklist({
    decision: input.decision,
    config: input.config,
    manual: input.manual,
  });

  if (!checklist.ready || !checklist.terminalId) {
    await persistDispatchRecord({
      decisionLogId: input.decisionLogId,
      terminalId: checklist.terminalId,
      symbol: input.decision.symbol,
      side: input.decision.decision,
      status: 'blocked',
      blockers: checklist.blockers,
      payload: { manual: Boolean(input.manual), mode: checklist.mode },
    });
    return {
      ok: false,
      status: 'blocked',
      decisionLogId: input.decisionLogId,
      blockers: checklist.blockers,
    };
  }

  const side = input.decision.decision === 'SELL' ? 'SELL' : 'BUY';
  const volumeLots = Number(input.volumeLots ?? envNumber('CACSMS_AUTONOMY_DEFAULT_LOTS', 0.01));
  const stopLoss = Number(input.decision.stopLoss ?? 0);
  const takeProfit = Number(input.decision.takeProfitLevels?.[0] ?? 0);
  const commandId = `autonomy-${input.decisionLogId.slice(0, 8)}-${randomUUID()}`;
  const dedupeKey = `AUTONOMY:${input.decisionLogId}:${input.decision.symbol}:${side}:${volumeLots}`;

  try {
    const result = await dispatchExecutionCommand({
      commandId,
      terminalId: checklist.terminalId,
      type: 'place_order',
      payload: {
        source: 'AUTONOMY_EXECUTION_ADAPTER',
        decisionLogId: input.decisionLogId,
        intentId: input.decisionLogId,
        symbol: input.decision.symbol,
        side,
        orderType: 'MARKET',
        volume: volumeLots,
        volumeLots,
        sl: stopLoss,
        tp: takeProfit,
        stopLoss,
        takeProfit,
        comment: `Cacsms autonomy ${side} ${input.decision.symbol}`,
        mode: 'SANDBOX',
        environment: 'DEMO',
        timeframe: input.decision.timeframe,
        confidenceScore: input.decision.confidenceScore,
        setupReadinessScore: input.decision.setupReadinessScore,
      },
      environment: 'DEMO',
      sandboxMode: true,
      dedupeKey,
      intentId: input.decisionLogId,
      source: 'AUTONOMY_EXECUTION_ADAPTER',
    });

    await persistDispatchRecord({
      decisionLogId: input.decisionLogId,
      commandId: result.command.commandId,
      terminalId: checklist.terminalId,
      symbol: input.decision.symbol,
      side,
      status: 'dispatched',
      blockers: [],
      payload: {
        manual: Boolean(input.manual),
        lifecycleState: result.command.lifecycleState,
        deduped: result.deduped ?? false,
      },
    });

    return {
      ok: true,
      status: 'dispatched',
      decisionLogId: input.decisionLogId,
      commandId: result.command.commandId,
      terminalId: checklist.terminalId,
      blockers: [],
    };
  } catch (error) {
    const blockers = [
      error instanceof ExecutionPolicyBlockedError || error instanceof ExecutionRiskBlockedError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Autonomy execution dispatch failed.',
    ];
    await persistDispatchRecord({
      decisionLogId: input.decisionLogId,
      terminalId: checklist.terminalId,
      symbol: input.decision.symbol,
      side,
      status: 'failed',
      blockers,
      payload: { manual: Boolean(input.manual) },
    });
    return {
      ok: false,
      status: 'failed',
      decisionLogId: input.decisionLogId,
      terminalId: checklist.terminalId,
      blockers,
      error: blockers[0],
    };
  }
}

export async function maybeAutoDispatchAutonomyDecision(input: {
  decisionLogId: string;
  decision: AutonomousDecisionOutput;
  config: AutonomyConfig;
}): Promise<AutonomyExecutionDispatchResult | null> {
  if (!['BUY', 'SELL'].includes(input.decision.decision)) return null;
  if (!executionModeAllowsAutoDispatch(input.config.tradeExecutionMode)) return null;
  if (!envBool('CACSMS_ENABLE_AUTONOMY_EXECUTION', false)) return null;
  return dispatchAutonomyDecision({
    decisionLogId: input.decisionLogId,
    decision: input.decision,
    config: input.config,
    manual: false,
  });
}

export async function listAutonomyExecutionDispatches(limit = 50) {
  const result = await queryPostgres(
    `
      SELECT *
      FROM autonomy_execution_dispatches
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [Math.min(200, Math.max(1, limit))],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));

  return result.rows.map((row) => ({
    id: String(row.id),
    decisionLogId: String(row.decision_log_id),
    commandId: row.command_id ? String(row.command_id) : null,
    terminalId: row.terminal_id ? String(row.terminal_id) : null,
    symbol: String(row.symbol),
    side: String(row.side),
    status: String(row.status),
    blockers: Array.isArray(row.blockers_json) ? row.blockers_json : [],
    payload: (row.payload_json as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }));
}
