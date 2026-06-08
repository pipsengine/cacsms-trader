import {
  AUTONOMY_TIMEFRAME_SEQUENCE,
  PIPELINE_STAGES,
  type PipelineStageId,
  type PipelineStageStatus,
} from './autonomous-pipeline';
import { ensureAutonomySchema } from './autonomy-store';
import { getLatestPairSelection } from './pair-selector';
import { getLatestPipelineSession, listPipelineEvents } from './top-down-orchestrator';
import { queryPostgres } from './postgres';

export interface PipelineStageStatusView {
  id: PipelineStageId;
  order: number;
  label: string;
  shortLabel: string;
  description: string;
  status: PipelineStageStatus;
  detail: string;
  progress: number;
  updatedAt: string | null;
  metrics: Record<string, unknown>;
}

export interface AutonomousPipelineStatus {
  mode: string;
  activeSymbol: string;
  pairSelection: {
    selectedSymbol: string;
    selectedAt: string | null;
    source: string;
    session: string;
    candidates: Array<{ symbol: string; compositeScore: number; tradable: boolean; rank: number }>;
  } | null;
  bridgeOnline: boolean;
  connectedTerminals: number;
  overallStatus: PipelineStageStatus;
  overallProgress: number;
  currentStage: PipelineStageId;
  sessionId: string | null;
  stages: PipelineStageStatusView[];
  recentEvents: Array<{
    stageId: string;
    eventType: string;
    message: string;
    createdAt: string;
  }>;
  generatedAt: string;
}

export async function getAutonomousPipelineStatus(symbol = 'XAUUSD'): Promise<AutonomousPipelineStatus> {
  await ensureAutonomySchema();
  const requestedSymbol = symbol.toUpperCase();
  const latestSelection = await getLatestPairSelection();
  const normalizedSymbol = requestedSymbol === 'AUTO'
    ? (latestSelection?.selectedSymbol ?? 'XAUUSD')
    : requestedSymbol;

  const [bridge, session, captureCounts, mtf, vision, decisions, risk, execution, autonomyConfig, jobs] = await Promise.all([
    fetchBridgeSummary(),
    getLatestPipelineSession(normalizedSymbol),
    getCaptureCoverage(normalizedSymbol),
    getMtfStatus(normalizedSymbol),
    getVisionStatus(normalizedSymbol),
    getSignalStatus(normalizedSymbol),
    getRiskStatus(),
    getExecutionStatus(),
    getAutonomyConfigRow(),
    getRunningJobs(),
  ]);

  const sessionStageMap = objectValue(session?.stage_status_json);
  const timeframeCapture = objectValue(session?.timeframe_capture_json);
  const events = session ? await listPipelineEvents(String(session.id), 12) : [];

  const stageEvaluators: Record<PipelineStageId, () => { status: PipelineStageStatus; detail: string; progress: number; metrics: Record<string, unknown> }> = {
    'terminal-connectivity': () => {
      if (!bridge.online) return { status: 'not_started', detail: 'MT5 bridge is offline.', progress: 0, metrics: bridge };
      if (bridge.connected === 0) return { status: 'in_progress', detail: 'Bridge online — waiting for terminal heartbeat.', progress: 40, metrics: bridge };
      return { status: 'completed', detail: `${bridge.connected} terminal(s) connected.`, progress: 100, metrics: bridge };
    },
    'pair-selection': () => {
      const sessionStatus = stringValue(sessionStageMap['pair-selection']);
      if (latestSelection?.selectedSymbol === normalizedSymbol && sessionStatus === 'completed') {
        return {
          status: 'completed',
          detail: `${normalizedSymbol} selected by market intelligence and macro alignment.`,
          progress: 100,
          metrics: { selection: latestSelection },
        };
      }
      if (latestSelection) {
        const top = latestSelection.candidates.find((candidate) => candidate.symbol === latestSelection.selectedSymbol);
        return {
          status: latestSelection.selectedSymbol === normalizedSymbol ? 'completed' : 'in_progress',
          detail: `Latest autonomous pick: ${latestSelection.selectedSymbol} (${top?.compositeScore ?? 0} score, ${latestSelection.session} session).`,
          progress: latestSelection.selectedSymbol === normalizedSymbol ? 100 : 70,
          metrics: { selection: latestSelection },
        };
      }
      if (bridge.connected > 0) {
        return { status: 'in_progress', detail: 'Terminal connected — awaiting first autonomous pair scan.', progress: 25, metrics: {} };
      }
      return { status: 'not_started', detail: 'Requires terminal connectivity before pair selection.', progress: 0, metrics: {} };
    },
    'chart-navigation': () => {
      const sessionStatus = stringValue(sessionStageMap['chart-navigation']);
      if (sessionStatus === 'completed') return { status: 'completed', detail: 'Chart navigation commands completed for active session.', progress: 100, metrics: { sessionId: session?.id ?? null } };
      if (sessionStatus === 'in_progress' || session?.current_stage === 'chart-navigation') {
        return { status: 'in_progress', detail: 'MT5 chart navigation session is active.', progress: 55, metrics: { sessionId: session?.id ?? null } };
      }
      if (bridge.connected > 0) return { status: 'in_progress', detail: 'Terminal ready — navigation session not started.', progress: 20, metrics: {} };
      return { status: 'not_started', detail: 'Requires connected terminal before chart navigation.', progress: 0, metrics: {} };
    },
    'top-down-capture': () => {
      const captured = AUTONOMY_TIMEFRAME_SEQUENCE.filter((tf) => captureCounts.timeframes[tf] > 0).length;
      const queued = AUTONOMY_TIMEFRAME_SEQUENCE.filter((tf) => timeframeCapture[tf]).length;
      if (captured === AUTONOMY_TIMEFRAME_SEQUENCE.length) {
        return { status: 'completed', detail: 'All top-down timeframes captured.', progress: 100, metrics: captureCounts };
      }
      if (queued > 0 || session?.current_stage === 'top-down-capture') {
        return {
          status: 'in_progress',
          detail: `Capture in progress (${captured}/${AUTONOMY_TIMEFRAME_SEQUENCE.length} stored, ${queued} commanded).`,
          progress: Math.round(((captured + queued * 0.5) / AUTONOMY_TIMEFRAME_SEQUENCE.length) * 100),
          metrics: { ...captureCounts, timeframeCapture },
        };
      }
      if (captured > 0) {
        return { status: 'in_progress', detail: `${captured}/${AUTONOMY_TIMEFRAME_SEQUENCE.length} timeframe captures available.`, progress: Math.round((captured / AUTONOMY_TIMEFRAME_SEQUENCE.length) * 100), metrics: captureCounts };
      }
      return { status: 'not_started', detail: 'No top-down captures for active symbol yet.', progress: 0, metrics: captureCounts };
    },
    'visual-detection': () => {
      if (captureCounts.reconstructed === 0) return { status: 'not_started', detail: 'Waiting for chart captures with reconstructed candles.', progress: 0, metrics: captureCounts };
      if (captureCounts.reconstructed < captureCounts.totalCaptures) {
        return { status: 'in_progress', detail: 'Visual detectors running on available captures.', progress: 60, metrics: captureCounts };
      }
      return { status: 'completed', detail: 'Visual detection available across captured charts.', progress: 100, metrics: captureCounts };
    },
    'mtf-fusion': () => mtf,
    'cacsms-vision': () => vision,
    'macro-intelligence': () => getMacroStatus(),
    'signal-generation': () => decisions,
    'risk-gate': () => risk,
    'execution': () => execution,
    'trade-monitoring': () => ({
      status: execution.metrics.openOrders > 0 ? 'in_progress' : execution.status === 'completed' ? 'in_progress' : 'not_started',
      detail: execution.metrics.openOrders > 0 ? `${execution.metrics.openOrders} open order(s) require monitoring.` : 'No open positions to monitor.',
      progress: execution.metrics.openOrders > 0 ? 50 : 0,
      metrics: execution.metrics,
    }),
    'unattended-operations': () => {
      const running = jobs.running > 0;
      const emergency = autonomyConfig.emergencyStopped;
      if (emergency) return { status: 'not_started', detail: 'Autonomy emergency stop is active.', progress: 0, metrics: { jobs, emergency } };
      if (running) return { status: 'in_progress', detail: `${jobs.running} autonomous job(s) running.`, progress: 70, metrics: jobs };
      if (jobs.completedToday > 0) return { status: 'completed', detail: 'Autonomy scheduler completed recent cycle.', progress: 100, metrics: jobs };
      return { status: 'in_progress', detail: 'Autonomy runtime active — awaiting next scheduled tick.', progress: 40, metrics: jobs };
    },
  };

  const stages: PipelineStageStatusView[] = PIPELINE_STAGES.map((stage) => {
    const evaluated = stageEvaluators[stage.id]();
    const sessionOverride = sessionStageMap[stage.id];
    const status =
      sessionOverride === 'completed'
        ? 'completed'
        : sessionOverride === 'in_progress'
          ? evaluated.status === 'not_started'
            ? 'in_progress'
            : evaluated.status
          : evaluated.status;
    return {
      id: stage.id,
      order: stage.order,
      label: stage.label,
      shortLabel: stage.shortLabel,
      description: stage.description,
      status,
      detail: evaluated.detail,
      progress: evaluated.progress,
      updatedAt: session?.updated_at ? String(session.updated_at) : null,
      metrics: evaluated.metrics,
    };
  });

  const completedCount = stages.filter((stage) => stage.status === 'completed').length;
  const inProgressStage = stages.find((stage) => stage.status === 'in_progress') ?? stages.find((stage) => stage.status === 'not_started');
  const overallProgress = Math.round(stages.reduce((sum, stage) => sum + stage.progress, 0) / stages.length);
  const overallStatus: PipelineStageStatus =
    completedCount === stages.length ? 'completed' : completedCount > 0 || jobs.running > 0 ? 'in_progress' : 'not_started';

  return {
    mode: stringValue(autonomyConfig.mode, 'full_auto'),
    activeSymbol: normalizedSymbol,
    pairSelection: latestSelection
      ? {
          selectedSymbol: latestSelection.selectedSymbol,
          selectedAt: latestSelection.selectedAt,
          source: latestSelection.source,
          session: latestSelection.session,
          candidates: latestSelection.candidates.map((candidate) => ({
            symbol: candidate.symbol,
            compositeScore: candidate.compositeScore,
            tradable: candidate.tradable,
            rank: candidate.rank,
          })),
        }
      : null,
    bridgeOnline: bridge.online,
    connectedTerminals: bridge.connected,
    overallStatus,
    overallProgress,
    currentStage: (inProgressStage?.id ?? 'terminal-connectivity') as PipelineStageId,
    sessionId: session?.id ? String(session.id) : null,
    stages,
    recentEvents: events.map((row) => ({
      stageId: String(row.stage_id),
      eventType: String(row.event_type),
      message: String(row.message),
      createdAt: String(row.created_at),
    })),
    generatedAt: new Date().toISOString(),
  };
}

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBridgeSummary(): Promise<{ online: boolean; connected: number; degraded: number; disconnected: number }> {
  try {
    const response = await fetchWithTimeout(`${process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787'}/health`);
    if (!response.ok) return { online: false, connected: 0, degraded: 0, disconnected: 0 };
    const payload = await response.json();
    return {
      online: Boolean(payload.ok),
      connected: Number(payload.connectedTerminalCount ?? 0),
      degraded: Number(payload.degradedTerminalCount ?? 0),
      disconnected: Number(payload.disconnectedTerminalCount ?? 0),
    };
  } catch {
    return { online: false, connected: 0, degraded: 0, disconnected: 0 };
  }
}

async function getCaptureCoverage(symbol: string) {
  const captures = await queryPostgres(
    `SELECT upper(timeframe) AS timeframe, COUNT(*)::int AS count
     FROM chart_captures
     WHERE upper(symbol) = $1
     GROUP BY upper(timeframe)`,
    [symbol],
  );
  const timeframes: Record<string, number> = {};
  for (const row of captures.rows) timeframes[String(row.timeframe)] = Number(row.count);

  const reconstructed = await queryPostgres(
    `SELECT COUNT(DISTINCT rc.chart_capture_id)::int AS count
     FROM reconstructed_candles rc
     JOIN chart_captures cc ON cc.id = rc.chart_capture_id
     WHERE upper(cc.symbol) = $1`,
    [symbol],
  );

  const total = await queryPostgres('SELECT COUNT(*)::int AS count FROM chart_captures WHERE upper(symbol) = $1', [symbol]);
  return {
    timeframes,
    reconstructed: Number(reconstructed.rows[0]?.count ?? 0),
    totalCaptures: Number(total.rows[0]?.count ?? 0),
  };
}

async function getMtfStatus(symbol: string) {
  const result = await queryPostgres(
    'SELECT COUNT(*)::int AS snapshots FROM timeframe_analysis_snapshots WHERE upper(symbol) = $1',
    [symbol],
  );
  const snapshots = Number(result.rows[0]?.snapshots ?? 0);
  if (snapshots >= AUTONOMY_TIMEFRAME_SEQUENCE.length) {
    return { status: 'completed' as const, detail: 'Multi-timeframe fusion complete.', progress: 100, metrics: { snapshots } };
  }
  if (snapshots > 0) {
    return { status: 'in_progress' as const, detail: `${snapshots}/${AUTONOMY_TIMEFRAME_SEQUENCE.length} timeframe snapshots analyzed.`, progress: Math.round((snapshots / AUTONOMY_TIMEFRAME_SEQUENCE.length) * 100), metrics: { snapshots } };
  }
  return { status: 'not_started' as const, detail: 'Waiting for top-down captures before MTF fusion.', progress: 0, metrics: { snapshots } };
}

async function getVisionStatus(symbol: string) {
  const result = await queryPostgres(
    `SELECT COUNT(*)::int AS count, MAX(created_at) AS latest
     FROM cacsms_vision_analysis
     WHERE upper(symbol) = $1 AND created_at > now() - interval '24 hours'`,
    [symbol],
  );
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > 0) return { status: 'completed' as const, detail: 'Recent Cacsms Vision analysis available.', progress: 100, metrics: { analyses: count } };
  const running = await queryPostgres("SELECT COUNT(*)::int AS count FROM cacsms_vision_scans WHERE status = 'running'");
  if (Number(running.rows[0]?.count ?? 0) > 0) {
    return { status: 'in_progress' as const, detail: 'Cacsms Vision scan in progress.', progress: 55, metrics: {} };
  }
  return { status: 'not_started' as const, detail: 'No recent Cacsms Vision analysis.', progress: 0, metrics: {} };
}

function getMacroStatus() {
  return { status: 'in_progress' as const, detail: 'Macro collectors active — calendar, COT, and rates pipelines available.', progress: 65, metrics: {} };
}

async function getSignalStatus(symbol: string) {
  const result = await queryPostgres(
    `SELECT decision, created_at
     FROM autonomous_decision_logs
     WHERE upper(symbol) = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [symbol],
  );
  if (!result.rows[0]) {
    return { status: 'not_started' as const, detail: 'No autonomous decisions generated yet.', progress: 0, metrics: {} };
  }
  const decision = String(result.rows[0].decision);
  if (decision === 'BUY' || decision === 'SELL') {
    return { status: 'completed' as const, detail: `Latest autonomous signal: ${decision}.`, progress: 100, metrics: { decision } };
  }
  return { status: 'in_progress' as const, detail: `Latest autonomous signal: ${decision}.`, progress: 60, metrics: { decision } };
}

async function getRiskStatus() {
  const result = await queryPostgres("SELECT COUNT(*)::int AS count FROM risk_decisions WHERE created_at > now() - interval '7 days'");
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > 0) return { status: 'completed' as const, detail: `${count} risk decision(s) in the last 7 days.`, progress: 100, metrics: { count } };
  return { status: 'in_progress' as const, detail: 'Risk gate armed — awaiting execution intents.', progress: 30, metrics: { count } };
}

async function getExecutionStatus() {
  try {
    const response = await fetchWithTimeout(`${process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787'}/commands`);
    if (!response.ok) throw new Error('bridge commands unavailable');
    const payload = await response.json();
    const commands = Array.isArray(payload.commands) ? payload.commands : [];
    const acked = commands.filter((item: { status?: string }) => item.status === 'acknowledged').length;
    const queued = commands.filter((item: { status?: string }) => item.status === 'queued' || item.status === 'leased').length;
    const openOrders = Number(payload.openOrders ?? 0);
    if (acked > 0) return { status: 'completed' as const, detail: `${acked} command(s) acknowledged by terminal.`, progress: 100, metrics: { acked, queued, openOrders } };
    if (queued > 0) return { status: 'in_progress' as const, detail: `${queued} command(s) queued for terminal.`, progress: 55, metrics: { acked, queued, openOrders } };
    return { status: 'not_started' as const, detail: 'No execution commands in queue.', progress: 0, metrics: { acked, queued, openOrders } };
  } catch {
    return { status: 'not_started' as const, detail: 'Execution bridge unavailable.', progress: 0, metrics: { acked: 0, queued: 0, openOrders: 0 } };
  }
}

async function getAutonomyConfigRow() {
  const result = await queryPostgres('SELECT value_json FROM autonomous_config WHERE key = $1', ['default']);
  const value = objectValue(result.rows[0]?.value_json);
  return {
    mode: stringValue(value.tradeExecutionMode, 'full_auto'),
    emergencyStopped: false,
  };
}

async function getRunningJobs() {
  const result = await queryPostgres(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'running')::int AS running,
      COUNT(*) FILTER (WHERE status = 'completed' AND created_at > now() - interval '24 hours')::int AS completed_today
    FROM autonomous_jobs
  `);
  return {
    running: Number(result.rows[0]?.running ?? 0),
    completedToday: Number(result.rows[0]?.completed_today ?? 0),
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, fallback = ''): string {
  return value == null || value === '' ? fallback : String(value);
}
