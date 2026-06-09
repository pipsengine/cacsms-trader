import { getAutonomousPipelineStatus, type AutonomousPipelineStatus } from './autonomous-pipeline-store';
import { getBridgeExecutionMetrics } from './autonomous-pipeline-risk-execution';
import { getAutonomyStatus } from './autonomy-store';
import { getExecutionKillSwitchStatus } from './execution-kill-switch';
import { getCommandCenterTick } from './command-center-tick';
import { getExecutionRiskSettings } from './execution-risk-settings';
import type { PropFirmComplianceView } from './prop-firm-profiles';
import { checkPostgresConnection } from './postgres';
import { queryPostgres } from './postgres';

const TOP_DOWN_TIMEFRAMES = ['W', 'D', 'H4', 'H1', 'M15'] as const;

export type SystemHealthLevel = 'healthy' | 'degraded' | 'critical';

export type HealthCheckStatus = 'ok' | 'warn' | 'error';

export interface CommandCenterOverview {
  generatedAt: string;
  systemHealth: {
    level: SystemHealthLevel;
    summary: string;
    checks: Array<{ id: string; label: string; status: HealthCheckStatus; detail: string }>;
  };
  pipeline: AutonomousPipelineStatus;
  trading: {
    totalEquity: number;
    totalBalance: number;
    connectedTerminals: number;
    degradedTerminals: number;
    openPositions: number;
    terminalOpen: number;
    trackedOpen: number;
    executedToday: number;
    queuedCommands: number;
    terminals: Array<{
      terminalId: string;
      accountNumber: string;
      brokerName: string;
      status: string;
      equity: number;
      balance: number;
      openOrders: number;
      heartbeatAgeMs: number | null;
    }>;
    openPositionDetails: Array<{
      ticket: string;
      symbol: string | null;
      side: string | null;
      volumeLots: number | null;
      profitLoss: number;
    }>;
  };
  risk: {
    dailyTradeLimitEnabled: boolean;
    maxTradesPerDay: number;
    tradesPerSymbolPerDay: number;
    activeSymbolCount: number;
    symbolBasedTradeLimit: boolean;
    maxOpenPositions: number;
    openPositions: number;
    remainingOpenPositions: number;
    tradesOpenedToday: number;
    remainingTradesToday: number | null;
    killSwitch: {
      active: boolean;
      reason: string | null;
      operator: string | null;
      source: string;
    };
  };
  autonomy: {
    mode: string;
    runningJobs: number;
    queuedJobs: number;
    openAlerts: number;
    recentFailures: number;
    nextRunAt: string | null;
    latestJobs: Array<{
      id: string;
      workerName: string;
      status: string;
      symbol: string | null;
      createdAt: string;
    }>;
  };
  intelligence: {
    activeSymbol: string;
    latestDecision: {
      decision: string;
      confidenceScore: number;
      finalBias: string;
      timeframe: string;
      reasonForDecision: string;
      createdAt: string;
    } | null;
    visionConfidence: number | null;
    captureTotal: number;
    topDownCoverage: Record<string, boolean>;
    topDownComplete: boolean;
  };
  macro: {
    upcomingHighImpact: Array<{
      id: string;
      title: string;
      currency: string;
      impactLevel: string;
      utcEventTime: string;
    }>;
    activeHighImpactWindow: number;
  };
  database: {
    ok: boolean;
    latencyMs: number | null;
    databaseName: string | null;
  };
  recentActivity: Array<{
    source: 'pipeline' | 'autonomy' | 'execution';
    message: string;
    time: string;
    meta?: string;
  }>;
  propFirm: PropFirmComplianceView;
  live: {
    tickSequence: number;
    tickAt: string;
  };
}

function currenciesFromSymbol(symbol: string): string[] {
  const normalized = symbol.toUpperCase();
  if (normalized.length === 6) return [normalized.slice(0, 3), normalized.slice(3)];
  if (normalized.startsWith('XAU')) return ['USD', 'XAU'];
  if (normalized.startsWith('XAG')) return ['USD', 'XAG'];
  return ['USD'];
}

async function getCaptureSummary(symbol: string) {
  const captures = await queryPostgres(
    `SELECT upper(timeframe) AS timeframe, COUNT(*)::int AS count
     FROM chart_captures
     WHERE upper(symbol) = $1
     GROUP BY upper(timeframe)`,
    [symbol],
  );
  const timeframes: Record<string, boolean> = {};
  for (const timeframe of TOP_DOWN_TIMEFRAMES) timeframes[timeframe] = false;
  for (const row of captures.rows) {
    const tf = String(row.timeframe);
    if (Number(row.count) > 0) timeframes[tf] = true;
  }
  const total = await queryPostgres('SELECT COUNT(*)::int AS count FROM chart_captures WHERE upper(symbol) = $1', [symbol]);
  return {
    topDownCoverage: timeframes,
    topDownComplete: TOP_DOWN_TIMEFRAMES.every((timeframe) => timeframes[timeframe]),
    captureTotal: Number(total.rows[0]?.count ?? 0),
  };
}

async function getLatestDecisionForSymbol(symbol: string) {
  const result = await queryPostgres(
    `SELECT decision, confidence_score, final_bias, timeframe, reason_for_decision, created_at::text AS created_at
     FROM autonomous_decision_logs
     WHERE upper(symbol) = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [symbol],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    decision: String(row.decision),
    confidenceScore: Number(row.confidence_score ?? 0),
    finalBias: String(row.final_bias),
    timeframe: String(row.timeframe),
    reasonForDecision: String(row.reason_for_decision),
    createdAt: String(row.created_at),
  };
}

async function getVisionConfidence(symbol: string): Promise<number | null> {
  const result = await queryPostgres(
    `SELECT confidence_score
     FROM cacsms_vision_analysis
     WHERE upper(symbol) = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [symbol],
  );
  const value = result.rows[0]?.confidence_score;
  return value == null ? null : Number(value);
}

async function getUpcomingHighImpactEvents(currencies: string[]) {
  const result = await queryPostgres(
    `SELECT id, title, currency, impact_level, utc_event_time::text AS utc_event_time
     FROM economic_events
     WHERE upper(impact_level) IN ('HIGH', 'CRITICAL')
       AND utc_event_time >= now()
       AND utc_event_time <= now() + interval '48 hours'
       AND upper(currency) = ANY($1::text[])
     ORDER BY utc_event_time ASC
     LIMIT 5`,
    [currencies.map((item) => item.toUpperCase())],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    currency: String(row.currency),
    impactLevel: String(row.impact_level),
    utcEventTime: String(row.utc_event_time),
  }));
}

async function getActiveHighImpactWindow(currencies: string[]): Promise<number> {
  const result = await queryPostgres(
    `SELECT COUNT(*)::int AS count
     FROM economic_events
     WHERE upper(impact_level) IN ('HIGH', 'CRITICAL')
       AND utc_event_time >= now() - interval '30 minutes'
       AND utc_event_time <= now() + interval '30 minutes'
       AND upper(currency) = ANY($1::text[])`,
    [currencies.map((item) => item.toUpperCase())],
  );
  return Number(result.rows[0]?.count ?? 0);
}

function deriveSystemHealth(input: {
  databaseOk: boolean;
  bridgeOnline: boolean;
  killSwitchActive: boolean;
  openAlerts: number;
  recentFailures: number;
  pipelineProgress: number;
  connectedTerminals: number;
}): { level: SystemHealthLevel; summary: string; checks: CommandCenterOverview['systemHealth']['checks'] } {
  const checks: CommandCenterOverview['systemHealth']['checks'] = [
    {
      id: 'database',
      label: 'PostgreSQL',
      status: input.databaseOk ? 'ok' : 'error',
      detail: input.databaseOk ? 'Database reachable' : 'Database connection failed',
    },
    {
      id: 'bridge',
      label: 'MT5 bridge',
      status: input.bridgeOnline ? 'ok' : 'error',
      detail: input.bridgeOnline ? 'Bridge online' : 'Bridge offline — execution path unavailable',
    },
    {
      id: 'terminals',
      label: 'Terminals',
      status: input.connectedTerminals > 0 ? 'ok' : input.bridgeOnline ? 'warn' : 'error',
      detail:
        input.connectedTerminals > 0
          ? `${input.connectedTerminals} terminal(s) connected`
          : 'No connected terminals',
    },
    {
      id: 'kill-switch',
      label: 'Kill switch',
      status: input.killSwitchActive ? 'error' : 'ok',
      detail: input.killSwitchActive ? 'Execution halted by kill switch' : 'Execution allowed',
    },
    {
      id: 'autonomy',
      label: 'Autonomy alerts',
      status: input.openAlerts > 0 || input.recentFailures > 0 ? 'warn' : 'ok',
      detail:
        input.openAlerts > 0 || input.recentFailures > 0
          ? `${input.openAlerts} open alert(s), ${input.recentFailures} recent failure(s)`
          : 'No open autonomy alerts',
    },
    {
      id: 'pipeline',
      label: 'Pipeline',
      status: input.pipelineProgress >= 80 ? 'ok' : input.pipelineProgress > 0 ? 'warn' : 'warn',
      detail: `${input.pipelineProgress}% overall progress`,
    },
  ];

  const hasError = checks.some((check) => check.status === 'error');
  const hasWarn = checks.some((check) => check.status === 'warn');

  let level: SystemHealthLevel = 'healthy';
  let summary = 'All core systems operational';

  if (hasError || input.killSwitchActive) {
    level = 'critical';
    summary = input.killSwitchActive
      ? 'Execution blocked — kill switch active'
      : !input.databaseOk
        ? 'Database unavailable'
        : !input.bridgeOnline
          ? 'MT5 bridge offline'
          : 'Critical system check failed';
  } else if (hasWarn || input.pipelineProgress < 40) {
    level = 'degraded';
    summary =
      input.connectedTerminals === 0
        ? 'Pipeline running but no MT5 terminals connected'
        : input.pipelineProgress < 40
          ? 'Pipeline early-stage — intelligence gathering in progress'
          : 'Some subsystems need attention';
  }

  return { level, summary, checks };
}

export async function getCommandCenterOverview(): Promise<CommandCenterOverview> {
  const pipeline = await getAutonomousPipelineStatus('AUTO', { advance: false, runPairSelectionIfMissing: false });
  const activeSymbol = pipeline.pairSelection?.selectedSymbol ?? pipeline.activeSymbol ?? 'XAUUSD';
  const currencies = currenciesFromSymbol(activeSymbol);

  const [
    tick,
    riskSettings,
    killSwitch,
    autonomy,
    databaseResult,
    captureSummary,
    latestDecision,
    visionConfidence,
    upcomingHighImpact,
    activeHighImpactWindow,
  ] = await Promise.all([
    getCommandCenterTick({ syncHeartbeats: true, includePositionDetails: true }),
    getExecutionRiskSettings(),
    getExecutionKillSwitchStatus(),
    getAutonomyStatus(),
    checkPostgresConnection().then((value) => ({ ok: true, value })).catch(() => ({ ok: false, value: null })),
    getCaptureSummary(activeSymbol),
    getLatestDecisionForSymbol(activeSymbol),
    getVisionConfidence(activeSymbol),
    getUpcomingHighImpactEvents(currencies).catch(() => []),
    getActiveHighImpactWindow(currencies).catch(() => 0),
  ]);

  const bridgeOnline = tick.bridge.online || pipeline.bridgeOnline;
  const connectedTerminals = Math.max(tick.bridge.connected, pipeline.connectedTerminals);

  const systemHealth = deriveSystemHealth({
    databaseOk: databaseResult.ok,
    bridgeOnline,
    killSwitchActive: killSwitch.active,
    openAlerts: autonomy.summary.openAlerts,
    recentFailures: autonomy.summary.recentFailures,
    pipelineProgress: pipeline.overallProgress,
    connectedTerminals,
  });

  const recentActivity: CommandCenterOverview['recentActivity'] = [
    ...pipeline.recentEvents.slice(0, 8).map((event) => ({
      source: 'pipeline' as const,
      message: event.message,
      time: event.createdAt,
      meta: event.stageId,
    })),
    ...autonomy.latestDecisions.slice(0, 4).map((decision) => ({
      source: 'autonomy' as const,
      message: `${decision.symbol} ${decision.decision} — ${decision.reasonForDecision.slice(0, 120)}`,
      time: decision.createdAt,
      meta: decision.timeframe,
    })),
  ]
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, 12);

  const execution = await getBridgeExecutionMetrics();

  if (execution.executedToday > 0 || tick.trading.openPositions > 0) {
    recentActivity.unshift({
      source: 'execution',
      message: `${execution.executedToday} order(s) executed today · ${tick.trading.openPositions} open position(s)`,
      time: tick.tickAt,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    systemHealth,
    pipeline: {
      ...pipeline,
      bridgeOnline,
      connectedTerminals,
    },
    trading: {
      totalEquity: tick.trading.totalEquity,
      totalBalance: tick.trading.totalBalance,
      connectedTerminals: tick.trading.connectedTerminals,
      degradedTerminals: tick.trading.degradedTerminals,
      openPositions: tick.trading.openPositions,
      terminalOpen: tick.trading.terminalOpen,
      trackedOpen: tick.trading.trackedOpen,
      executedToday: execution.executedToday,
      queuedCommands: execution.queued,
      terminals: tick.trading.terminals.slice(0, 6).map((terminal) => ({
        terminalId: terminal.terminalId,
        accountNumber: terminal.accountNumber,
        brokerName: terminal.brokerName,
        status: terminal.status,
        equity: terminal.equity,
        balance: terminal.balance,
        openOrders: terminal.openOrders,
        heartbeatAgeMs: terminal.heartbeatAgeMs,
      })),
      openPositionDetails: tick.trading.openPositionDetails,
    },
    risk: {
      dailyTradeLimitEnabled: riskSettings.dailyTradeLimitEnabled,
      maxTradesPerDay: riskSettings.maxTradesPerDay,
      tradesPerSymbolPerDay: riskSettings.tradesPerSymbolPerDay,
      activeSymbolCount: riskSettings.activeSymbolCount,
      symbolBasedTradeLimit: riskSettings.symbolBasedTradeLimit,
      maxOpenPositions: riskSettings.maxOpenPositions,
      openPositions: riskSettings.openPositions,
      remainingOpenPositions: riskSettings.remainingOpenPositions,
      tradesOpenedToday: riskSettings.tradesOpenedToday,
      remainingTradesToday: riskSettings.remainingTradesToday,
      killSwitch: {
        active: killSwitch.active,
        reason: killSwitch.reason,
        operator: killSwitch.operator,
        source: killSwitch.source,
      },
    },
    autonomy: {
      mode: autonomy.config.mode,
      runningJobs: autonomy.summary.runningJobs,
      queuedJobs: autonomy.summary.queuedJobs,
      openAlerts: autonomy.summary.openAlerts,
      recentFailures: autonomy.summary.recentFailures,
      nextRunAt: autonomy.summary.nextRunAt,
      latestJobs: autonomy.latestJobs.slice(0, 5).map((job) => ({
        id: job.id,
        workerName: job.workerName,
        status: job.status,
        symbol: job.symbol,
        createdAt: job.createdAt,
      })),
    },
    intelligence: {
      activeSymbol,
      latestDecision,
      visionConfidence,
      captureTotal: captureSummary.captureTotal,
      topDownCoverage: captureSummary.topDownCoverage,
      topDownComplete: captureSummary.topDownComplete,
    },
    macro: {
      upcomingHighImpact,
      activeHighImpactWindow,
    },
    database: {
      ok: databaseResult.ok,
      latencyMs: databaseResult.value?.latencyMs ?? null,
      databaseName:
        databaseResult.value && 'database_name' in databaseResult.value
          ? String((databaseResult.value as Record<string, unknown>).database_name)
          : null,
    },
    recentActivity,
    propFirm: tick.propFirm,
    live: {
      tickSequence: tick.sequence,
      tickAt: tick.tickAt,
    },
  };
}
