import {
  AUTONOMY_TIMEFRAME_SEQUENCE,
  PIPELINE_STAGES,
  type PipelineStageId,
  type PipelineStageStatus,
} from './autonomous-pipeline';
import { ensureAutonomySchema, ensureFocusSymbolsConfigured } from './autonomy-store';
import { advancePipelineAnalysis } from './autonomous-pipeline-analysis';
import { getPipelineExecutionStatus, getPipelineRiskStatus } from './autonomous-pipeline-risk-execution';
import { getMacroPipelineStatus } from './macro-intelligence-store';
import { syncMt5CaptureAcks } from './mt5-capture-ingest';
import { getLatestPairSelection, runAutonomousPairSelection } from './pair-selector';
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

export async function getAutonomousPipelineStatus(symbol = 'AUTO'): Promise<AutonomousPipelineStatus> {
  await ensureAutonomySchema();
  await ensureFocusSymbolsConfigured();
  const requestedSymbol = symbol.toUpperCase();
  let latestSelection = await getLatestPairSelection();
  const normalizedSymbol = requestedSymbol === 'AUTO'
    ? (latestSelection?.selectedSymbol ?? 'XAUUSD')
    : requestedSymbol;

  const bridge = await fetchBridgeSummary();
  if (!latestSelection && bridge.connected > 0) {
    try {
      latestSelection = await runAutonomousPairSelection();
    } catch {
      // pair scan will retry on next status refresh or scheduler tick
    }
  }

  try {
    await syncMt5CaptureAcks({ symbol: normalizedSymbol, limit: 12 });
  } catch {
    // capture ingest retries on the next status refresh
  }

  try {
    await advancePipelineAnalysis(normalizedSymbol);
  } catch {
    // downstream analysis retries on the next status refresh
  }

  const [session, captureCounts, mtf, vision, macro, decisions, risk, execution, autonomyConfig, jobs] = await Promise.all([
    getLatestPipelineSession(normalizedSymbol),
    getCaptureCoverage(normalizedSymbol),
    getMtfStatus(normalizedSymbol),
    getVisionStatus(normalizedSymbol),
    getMacroPipelineStatus(normalizedSymbol),
    getSignalStatus(normalizedSymbol),
    getPipelineRiskStatus(normalizedSymbol),
    getPipelineExecutionStatus(normalizedSymbol),
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
        const tradablePick = latestSelection.candidates.some((candidate) => candidate.tradable);
        const isActiveSymbol = latestSelection.selectedSymbol === normalizedSymbol;
        const detail =
          latestSelection.source === 'config_fallback' && !tradablePick
            ? `Pair scan complete — ${latestSelection.selectedSymbol} active as fallback (watchlist ranked; no pair passed liquidity filters this cycle).`
            : `Latest autonomous pick: ${latestSelection.selectedSymbol} (${top?.compositeScore ?? 0} score, ${latestSelection.session} session).`;
        return {
          status: isActiveSymbol ? 'completed' : 'in_progress',
          detail,
          progress: isActiveSymbol ? 100 : 70,
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
      const sessionStored = AUTONOMY_TIMEFRAME_SEQUENCE.filter((tf) => timeframeCapture[tf] === 'stored').length;
      const commanded = AUTONOMY_TIMEFRAME_SEQUENCE.filter(
        (tf) => timeframeCapture[tf] && timeframeCapture[tf] !== 'stored',
      ).length;
      if (captured === AUTONOMY_TIMEFRAME_SEQUENCE.length) {
        return { status: 'completed', detail: 'All top-down timeframes captured.', progress: 100, metrics: captureCounts };
      }
      if (commanded > 0 || sessionStored > 0 || session?.current_stage === 'top-down-capture') {
        return {
          status: 'in_progress',
          detail: `Capture in progress (${captured}/${AUTONOMY_TIMEFRAME_SEQUENCE.length} stored, ${commanded} awaiting ingest).`,
          progress: Math.round(((captured + sessionStored * 0.25 + commanded * 0.15) / AUTONOMY_TIMEFRAME_SEQUENCE.length) * 100),
          metrics: { ...captureCounts, timeframeCapture, sessionStored, commanded },
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
    'macro-intelligence': () => macro,
    'signal-generation': () => decisions,
    'risk-gate': () => risk,
    'execution': () => execution,
    'trade-monitoring': () => {
      const openOrders = Number(execution.metrics.openOrders ?? 0);
      const trackedOpen = Number(execution.metrics.trackedOpen ?? 0);
      const terminalOpen = Number(execution.metrics.terminalOpen ?? 0);
      const hasOpen = openOrders > 0;
      const liveCount = terminalOpen > 0 ? terminalOpen : trackedOpen;
      const detail = hasOpen
        ? trackedOpen === liveCount
          ? `${liveCount} open position(s) under live monitor.`
          : `${liveCount} open on terminal · ${trackedOpen} tracked in monitor registry.`
        : 'No open positions to monitor.';
      return {
        status: hasOpen ? 'in_progress' : execution.status === 'completed' ? 'in_progress' : 'not_started',
        detail,
        progress: hasOpen ? Math.min(100, trackedOpen > 0 ? 70 : 35) : 0,
        metrics: execution.metrics,
      };
    },
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
  const captureCoverage = await queryPostgres(
    `SELECT COUNT(DISTINCT upper(timeframe))::int AS count
     FROM chart_captures
     WHERE upper(symbol) = $1`,
    [symbol],
  );
  const capturedTimeframes = Number(captureCoverage.rows[0]?.count ?? 0);
  if (capturedTimeframes >= AUTONOMY_TIMEFRAME_SEQUENCE.length) {
    return { status: 'in_progress' as const, detail: 'Top-down captures ready — MTF fusion running on next pipeline tick.', progress: 20, metrics: { snapshots, capturedTimeframes } };
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

async function getSignalStatus(symbol: string) {
  const result = await queryPostgres(
    `SELECT decision, confidence_score, setup_readiness_score, risk_score, final_bias,
            reason_for_decision, reason_against_decision, recommended_next_action, created_at
     FROM autonomous_decision_logs
     WHERE upper(symbol) = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [symbol],
  );
  if (!result.rows[0]) {
    return { status: 'not_started' as const, detail: 'No autonomous decisions generated yet.', progress: 0, metrics: {} };
  }
  const row = result.rows[0];
  const decision = String(row.decision);
  const confidence = Number(row.confidence_score ?? 0);
  const readiness = Number(row.setup_readiness_score ?? 0);
  const risk = Number(row.risk_score ?? 0);
  const metrics = {
    decision,
    confidence,
    readiness,
    risk,
    bias: String(row.final_bias ?? 'neutral'),
    reasonAgainst: String(row.reason_against_decision ?? ''),
    nextAction: String(row.recommended_next_action ?? ''),
  };
  const detail = `${decision} at ${Math.round(confidence)}% confidence, ${Math.round(readiness)}% setup readiness, ${Math.round(risk)}% risk. ${String(row.reason_against_decision ?? '')}`;
  if (decision === 'BUY' || decision === 'SELL') {
    return { status: 'completed' as const, detail: `Latest autonomous signal: ${detail}`, progress: 100, metrics };
  }
  return { status: 'in_progress' as const, detail: `Latest autonomous signal: ${detail}`, progress: 60, metrics };
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
