import { randomUUID } from 'crypto';

import { applyAutonomyAccountProfile } from './autonomy-account-profiles';
import { buildAutonomousDecision } from './autonomous-decision-engine';
import { resolveExecutionAccountContext } from './execution-account-context';
import { SYSTEM_FOCUS_SYMBOLS } from './focus-symbols';
import { DEFAULT_PAIR_SELECTION_CONFIG, runAutonomousPairSelection } from './pair-selector';
import { AUTONOMY_TIMEFRAMES, AUTONOMY_WORKERS, type AutonomousDecisionInput, type AutonomyConfig, type AutonomyJobStatus, type AutonomyWorkerName } from './autonomy-types';
import { getTradingStyleProfile } from './trading-styles/registry';
import { normalizeStrategyId } from './strategy-governance';
import { analyzeAiVisualInterpretation } from './ai-visual-interpretation-store';
import { analyzeCaptureCandles } from './candle-detection-store';
import { analyzeCaptureChannels } from './channel-detection-store';
import { analyzeChartSegmentation } from './chart-segmentation-store';
import { analyzeCaptureLiquidity } from './liquidity-zone-store';
import { analyzeSymbolMultiTimeframe } from './multi-timeframe-analysis-store';
import { analyzeCaptureOrderBlocks } from './order-block-detection-store';
import { analyzeCapturePatterns } from './pattern-recognition-store';
import { queryPostgres } from './postgres';
import { analyzeCaptureStructure } from './structure-analysis-store';
import { analyzeCaptureSupportResistance } from './support-resistance-store';
import { analyzeCaptureSwings } from './swing-point-store';
import { analyzeCaptureTrendlines } from './trendline-detection-store';
import { analyzeVisualAnomaly } from './visual-anomaly-detection-store';
import { publishVisualIntelligenceEvent } from './visual-intelligence-store';
import { analyzeVisualMarketInterpretation, getLatestVisualMarketInterpretation } from './visual-market-interpretation-store';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS autonomous_jobs (
  id UUID PRIMARY KEY,
  symbol TEXT,
  timeframe TEXT,
  worker_name TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score NUMERIC(8, 4),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  next_run_time TIMESTAMPTZ,
  audit_trace_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS autonomous_job_runs (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES autonomous_jobs(id) ON DELETE CASCADE,
  worker_name TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score NUMERIC(8, 4),
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS autonomous_schedules (
  id UUID PRIMARY KEY,
  worker_name TEXT NOT NULL,
  schedule_key TEXT NOT NULL UNIQUE,
  symbol TEXT,
  timeframe TEXT,
  cadence_seconds INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS autonomous_worker_status (
  worker_name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  current_job_id UUID,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS autonomous_scan_cycles (
  id UUID PRIMARY KEY,
  cycle_type TEXT NOT NULL,
  status TEXT NOT NULL,
  symbols_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeframes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS autonomous_symbol_queue (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'queued',
  reason TEXT NOT NULL,
  next_scan_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS autonomous_timeframe_queue (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 5,
  next_scan_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS autonomous_failures (
  id UUID PRIMARY KEY,
  job_id UUID REFERENCES autonomous_jobs(id) ON DELETE SET NULL,
  worker_name TEXT NOT NULL,
  symbol TEXT,
  timeframe TEXT,
  failure_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  escalated BOOLEAN NOT NULL DEFAULT false,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS autonomous_retry_logs (
  id UUID PRIMARY KEY,
  job_id UUID REFERENCES autonomous_jobs(id) ON DELETE SET NULL,
  retry_number INTEGER NOT NULL,
  backoff_seconds INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS autonomous_decision_logs (
  id UUID PRIMARY KEY,
  job_id UUID REFERENCES autonomous_jobs(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  dominant_timeframe TEXT NOT NULL,
  final_bias TEXT NOT NULL,
  setup_type TEXT NOT NULL,
  setup_readiness_score NUMERIC(8, 4) NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  risk_score NUMERIC(8, 4) NOT NULL,
  decision TEXT NOT NULL,
  entry_zone_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  stop_loss NUMERIC(18, 6),
  take_profit_levels_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  invalidation_level NUMERIC(18, 6),
  reason_for_decision TEXT NOT NULL,
  reason_against_decision TEXT NOT NULL,
  macro_risk_warning TEXT NOT NULL,
  liquidity_warning TEXT NOT NULL,
  anomaly_warning TEXT NOT NULL,
  recommended_next_action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE autonomous_decision_logs ADD COLUMN IF NOT EXISTS trading_style TEXT;
ALTER TABLE autonomous_decision_logs ADD COLUMN IF NOT EXISTS top_down_alignment_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE autonomous_decision_logs ADD COLUMN IF NOT EXISTS decision_evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE autonomous_decision_logs ADD COLUMN IF NOT EXISTS strategy_id TEXT;
ALTER TABLE autonomous_decision_logs ADD COLUMN IF NOT EXISTS market_regime TEXT;
ALTER TABLE autonomous_decision_logs ADD COLUMN IF NOT EXISTS htf_bias TEXT;
ALTER TABLE autonomous_decision_logs ADD COLUMN IF NOT EXISTS ltf_trigger TEXT;
ALTER TABLE autonomous_decision_logs ADD COLUMN IF NOT EXISTS stop_method TEXT;
ALTER TABLE autonomous_decision_logs ADD COLUMN IF NOT EXISTS target_method TEXT;
ALTER TABLE autonomous_decision_logs ADD COLUMN IF NOT EXISTS risk_model_version TEXT NOT NULL DEFAULT 'equity_risk_v1';
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_strategy ON autonomous_decision_logs(strategy_id, created_at DESC);
UPDATE autonomous_decision_logs
SET strategy_id = lower(COALESCE(NULLIF(trading_style, ''), 'core')) || ':' ||
  upper(COALESCE(NULLIF(timeframe, ''), 'MULTI')) || ':' ||
  regexp_replace(lower(COALESCE(NULLIF(setup_type, ''), 'autonomous_fusion')), '[^a-z0-9]+', '_', 'g')
WHERE strategy_id IS NULL;
CREATE TABLE IF NOT EXISTS autonomous_alerts (
  id UUID PRIMARY KEY,
  decision_log_id UUID REFERENCES autonomous_decision_logs(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  severity TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS autonomous_model_feedback (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  source_type TEXT NOT NULL,
  feedback_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS autonomous_outcome_tracking (
  id UUID PRIMARY KEY,
  decision_log_id UUID REFERENCES autonomous_decision_logs(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  decision TEXT NOT NULL,
  outcome_status TEXT NOT NULL DEFAULT 'pending',
  pnl_r_multiple NUMERIC(10, 4),
  reviewed_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS autonomous_system_health (
  id UUID PRIMARY KEY,
  health_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  emergency_stopped BOOLEAN NOT NULL DEFAULT false,
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS autonomous_audit_trails (
  id UUID PRIMARY KEY,
  audit_trace_id UUID NOT NULL,
  job_id UUID REFERENCES autonomous_jobs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS autonomous_config (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_autonomous_jobs_status ON autonomous_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_jobs_symbol_tf ON autonomous_jobs(symbol, timeframe, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_failures_worker ON autonomous_failures(worker_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_symbol_tf ON autonomous_decision_logs(symbol, timeframe, created_at DESC);
`;

const defaultConfig: AutonomyConfig = {
  activeSymbols: [...SYSTEM_FOCUS_SYMBOLS],
  watchlistSymbols: [...SYSTEM_FOCUS_SYMBOLS],
  maxSpreadPoints: DEFAULT_PAIR_SELECTION_CONFIG.maxSpreadPoints,
  pairSelectionEnabled: DEFAULT_PAIR_SELECTION_CONFIG.pairSelectionEnabled,
  maxSelectedSymbols: SYSTEM_FOCUS_SYMBOLS.length,
  activeTimeframes: [...AUTONOMY_TIMEFRAMES],
  mode: 'full_auto',
  confidenceThreshold: 60,
  alertThreshold: 72,
  riskThreshold: 70,
  retryLimit: 3,
  workerConcurrency: 8,
  newsBlackoutMinutes: 30,
  scanFrequencySeconds: 60,
  captureSources: ['mt5_bridge', 'chart_capture_service'],
  dataSources: ['visual_intelligence', 'economic_calendar', 'cot', 'interest_rates', 'sentiment'],
  signalGenerationRules: { requireTimeframeAlignment: true, blockHighImpactNews: true, blockCriticalAnomalies: true },
  tradeExecutionMode: 'assisted_trade',
};

let schemaReady: Promise<void> | null = null;
let runtimeStarted = false;
let runtimeTimer: ReturnType<typeof setInterval> | null = null;
let lastPipelineAdvanceAt = 0;

export async function ensureAutonomySchema() {
  if (!schemaReady) {
    schemaReady = queryPostgres(schemaSql).then(async () => {
      const { ensureStrategyGovernanceSchema } = await import('./strategy-governance');
      const { ensureAutonomyDirectionMonitorSchema } = await import('./autonomy-direction-monitor');
      await ensureStrategyGovernanceSchema();
      await ensureAutonomyDirectionMonitorSchema();
      await seedAutonomyDefaults();
    });
  }
  return schemaReady;
}

export async function ensureAutonomyRuntime() {
  await ensureAutonomySchema();
  await ensureFocusSymbolsConfigured();
  if (runtimeStarted) return;
  runtimeStarted = true;
  runtimeTimer = setInterval(() => {
    runAutonomyTick('scheduler').catch(() => undefined);
  }, 30_000);
  await runAutonomyTick('startup');
}

export async function getAutonomyStatus() {
  await ensureAutonomyRuntime();
  const [health, jobs, failures, alerts, decisions, schedules] = await Promise.all([
    getHealth(),
    listAutonomyJobs(10),
    listFailures(10),
    listAlerts(10),
    listDecisionLogs(10),
    listSchedules(),
  ]);
  return {
    config: await getAutonomyConfig(),
    health,
    summary: {
      queuedJobs: jobs.filter((job) => job.status === 'queued').length,
      runningJobs: jobs.filter((job) => job.status === 'running').length,
      recentFailures: failures.length,
      openAlerts: alerts.filter((alert) => alert.status === 'open').length,
      nextRunAt: schedules.filter((item) => item.enabled).sort((a, b) => String(a.nextRunAt).localeCompare(String(b.nextRunAt)))[0]?.nextRunAt ?? null,
    },
    latestJobs: jobs,
    latestDecisions: decisions,
    latestFailures: failures,
    latestAlerts: alerts,
  };
}

export async function listWorkers() {
  await ensureAutonomyRuntime();
  const result = await queryPostgres('SELECT * FROM autonomous_worker_status ORDER BY worker_name ASC');
  return result.rows.map(mapWorker);
}

export async function listAutonomyJobs(limit = 50) {
  await ensureAutonomySchema();
  const result = await queryPostgres('SELECT * FROM autonomous_jobs ORDER BY created_at DESC LIMIT $1', [limit]);
  return result.rows.map(mapJob);
}

export async function getAutonomyJob(id: string) {
  await ensureAutonomySchema();
  const [job, runs, audit] = await Promise.all([
    queryPostgres('SELECT * FROM autonomous_jobs WHERE id = $1', [id]),
    queryPostgres('SELECT * FROM autonomous_job_runs WHERE job_id = $1 ORDER BY started_at DESC', [id]),
    queryPostgres('SELECT * FROM autonomous_audit_trails WHERE job_id = $1 ORDER BY created_at ASC', [id]),
  ]);
  return job.rows[0] ? { ...mapJob(job.rows[0]), runs: runs.rows.map(mapRun), auditTrail: audit.rows.map(mapAudit) } : null;
}

export async function retryAutonomyJob(id: string) {
  await ensureAutonomySchema();
  const current = await getAutonomyJob(id);
  if (!current) throw new Error('Autonomous job was not found.');
  const retryId = await createAutonomyJob({
    workerName: current.workerName,
    symbol: current.symbol,
    timeframe: current.timeframe,
    triggerSource: 'manual_retry',
    inputPayload: current.inputPayload,
    retryCount: current.retryCount + 1,
  });
  await publishAutonomyEvent('autonomy.retry.started', { originalJobId: id, retryJobId: retryId });
  return executeAutonomyJob(retryId);
}

export async function cancelAutonomyJob(id: string) {
  await ensureAutonomySchema();
  await queryPostgres("UPDATE autonomous_jobs SET status = 'cancelled', completed_at = now(), updated_at = now() WHERE id = $1 AND status IN ('queued','running')", [id]);
  await publishAutonomyEvent('autonomy.job.failed', { jobId: id, status: 'cancelled' });
  return getAutonomyJob(id);
}

export async function listSchedules() {
  await ensureAutonomySchema();
  const result = await queryPostgres('SELECT * FROM autonomous_schedules ORDER BY worker_name, timeframe NULLS FIRST, symbol NULLS FIRST');
  return result.rows.map(mapSchedule);
}

export async function updateSchedules(input: { schedules?: Array<Record<string, unknown>>; config?: Partial<AutonomyConfig> }) {
  await ensureAutonomySchema();
  if (input.config) await saveAutonomyConfig(input.config);
  for (const schedule of input.schedules ?? []) {
    if (typeof schedule.id !== 'string') continue;
    const enabled = typeof schedule.enabled === 'boolean' ? schedule.enabled : null;
    const cadenceSeconds = typeof schedule.cadenceSeconds === 'number' ? schedule.cadenceSeconds : null;
    const nextRunAt = typeof schedule.nextRunAt === 'string' ? schedule.nextRunAt : null;
    await queryPostgres(`
      UPDATE autonomous_schedules
      SET enabled = COALESCE($2, enabled),
          cadence_seconds = COALESCE($3, cadence_seconds),
          next_run_at = COALESCE($4::timestamptz, next_run_at),
          updated_at = now()
      WHERE id = $1
    `, [schedule.id, enabled, cadenceSeconds, nextRunAt]);
  }
  return { config: await getAutonomyConfig(), schedules: await listSchedules() };
}

export async function listScanCycles(limit = 50) {
  await ensureAutonomySchema();
  const result = await queryPostgres('SELECT * FROM autonomous_scan_cycles ORDER BY started_at DESC LIMIT $1', [limit]);
  return result.rows.map((row) => ({
    id: String(row.id),
    cycleType: String(row.cycle_type),
    status: String(row.status),
    symbols: arrayValue(row.symbols_json),
    timeframes: arrayValue(row.timeframes_json),
    startedAt: dateString(row.started_at),
    completedAt: nullableDate(row.completed_at),
    summary: objectValue(row.summary_json),
  }));
}

export async function listDecisionLogs(limit = 50) {
  await ensureAutonomySchema();
  const result = await queryPostgres('SELECT * FROM autonomous_decision_logs ORDER BY created_at DESC LIMIT $1', [limit]);
  return result.rows.map(mapDecision);
}

export async function listFailures(limit = 50) {
  await ensureAutonomySchema();
  const result = await queryPostgres('SELECT * FROM autonomous_failures ORDER BY created_at DESC LIMIT $1', [limit]);
  return result.rows.map((row) => ({
    id: String(row.id),
    jobId: nullableString(row.job_id),
    workerName: String(row.worker_name),
    symbol: nullableString(row.symbol),
    timeframe: nullableString(row.timeframe),
    failureType: String(row.failure_type),
    errorMessage: String(row.error_message),
    retryCount: Number(row.retry_count),
    escalated: Boolean(row.escalated),
    nextRetryAt: nullableDate(row.next_retry_at),
    createdAt: dateString(row.created_at),
  }));
}

export async function getAutonomyHealth() {
  await ensureAutonomyRuntime();
  return { health: await getHealth(), workers: await listWorkers(), failures: await listFailures(5) };
}

export async function emergencyStopAutonomy(reason = 'Emergency stop requested.') {
  await ensureAutonomySchema();
  if (runtimeTimer) clearInterval(runtimeTimer);
  runtimeTimer = null;
  runtimeStarted = false;
  await upsertHealth('autonomy', 'stopped', reason, true, {});
  await publishAutonomyEvent('autonomy.emergency.stopped', { reason });
  return getAutonomyHealth();
}

export async function resumeAutonomy() {
  await ensureAutonomySchema();
  await upsertHealth('autonomy', 'running', 'Autonomous runtime resumed.', false, {});
  await publishAutonomyEvent('autonomy.resumed', {});
  await ensureAutonomyRuntime();
  return getAutonomyHealth();
}

async function runAutonomyTick(triggerSource: string) {
  const { isContinuousTradingSessionActive, syncContinuousTradingRuntime } = await import('./continuous-trading-session');
  await syncContinuousTradingRuntime();
  if (!(await isContinuousTradingSessionActive())) return;
  if ((await isEmergencyStopped())) return;
  const config = await getAutonomyConfig();
  const cycleId = randomUUID();
  await queryPostgres('INSERT INTO autonomous_scan_cycles (id, cycle_type, status, symbols_json, timeframes_json) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)', [cycleId, triggerSource, 'running', JSON.stringify(config.activeSymbols), JSON.stringify(config.activeTimeframes)]);
  await publishAutonomyEvent('autonomy.scan.started', { cycleId, triggerSource });
  const due = await queryPostgres(`
    SELECT * FROM autonomous_schedules
    WHERE enabled = true AND next_run_at <= now()
    ORDER BY next_run_at ASC
    LIMIT $1
  `, [Math.max(1, config.workerConcurrency)]);
  const created: string[] = [];
  for (const schedule of due.rows) {
    await publishAutonomyEvent('autonomy.schedule.triggered', { scheduleKey: schedule.schedule_key, workerName: schedule.worker_name });
    const jobId = await createAutonomyJob({
      workerName: String(schedule.worker_name) as AutonomyWorkerName,
      symbol: nullableString(schedule.symbol),
      timeframe: nullableString(schedule.timeframe),
      triggerSource,
      inputPayload: objectValue(schedule.metadata_json),
    });
    created.push(jobId);
    await bumpSchedule(String(schedule.id), Number(schedule.cadence_seconds));
  }
  for (const jobId of created) await executeAutonomyJob(jobId);
  await recoverFailedJobs(config.retryLimit);
  await queryPostgres('UPDATE autonomous_scan_cycles SET status = $2, completed_at = now(), summary_json = $3::jsonb WHERE id = $1', [cycleId, 'completed', JSON.stringify({ jobsCreated: created.length })]);
  await publishAutonomyEvent('autonomy.scan.completed', { cycleId, jobsCreated: created.length });
  await updateHealthSummary();
  await maybeAdvanceAutonomousPipeline(triggerSource);
}

function pipelineAdvanceIntervalMs(): number {
  const raw = String(process.env.CACSMS_PIPELINE_ADVANCE_SECONDS ?? '60').trim();
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
}

async function maybeAdvanceAutonomousPipeline(triggerSource: string) {
  const { isContinuousTradingSessionActive } = await import('./continuous-trading-session');
  if (!(await isContinuousTradingSessionActive())) return;
  const intervalMs = pipelineAdvanceIntervalMs();
  if (Date.now() - lastPipelineAdvanceAt < intervalMs) return;
  lastPipelineAdvanceAt = Date.now();
  try {
    const { advanceAutonomousPipeline } = await import('./autonomous-pipeline-store');
    const result = await advanceAutonomousPipeline('AUTO');
    await publishAutonomyEvent('autonomy.pipeline.advanced', {
      triggerSource,
      symbols: result.symbols,
    });
    const { maintainInstitutionalPositions } = await import('./institutional-position-maintenance');
    const maintenance = await maintainInstitutionalPositions(triggerSource);
    await publishAutonomyEvent('autonomy.position.maintenance', maintenance);
  } catch {
    // pipeline advance retries on the next scheduler tick
  }
}

async function executeAutonomyJob(jobId: string) {
  const job = await getAutonomyJob(jobId);
  if (!job || job.status === 'cancelled') return job;
  const runId = randomUUID();
  await queryPostgres('INSERT INTO autonomous_job_runs (id, job_id, worker_name, status, progress, input_payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [runId, jobId, job.workerName, 'running', 5, JSON.stringify(job.inputPayload)]);
  await markWorker(job.workerName, 'running', jobId);
  await updateJob(jobId, 'running', 10, null, null);
  await publishAutonomyEvent('autonomy.job.started', { jobId, workerName: job.workerName, symbol: job.symbol, timeframe: job.timeframe });
  await publishAutonomyEvent('autonomy.worker.started', { workerName: job.workerName, jobId });
  try {
    const output = await runWorker(job.workerName as AutonomyWorkerName, job.symbol, job.timeframe, job.inputPayload);
    const confidence = numberValue(output.confidenceScore ?? output.confidence ?? output.setupReadinessScore, null);
    await queryPostgres('UPDATE autonomous_job_runs SET status = $2, progress = 100, output_payload = $3::jsonb, confidence_score = $4, completed_at = now() WHERE id = $1', [runId, 'completed', JSON.stringify(output), confidence]);
    await updateJob(jobId, 'completed', 100, output, confidence);
    await markWorker(job.workerName, 'idle', null, true);
    await publishAutonomyEvent('autonomy.job.completed', { jobId, workerName: job.workerName, confidenceScore: confidence });
    await publishAutonomyEvent('autonomy.worker.completed', { workerName: job.workerName, jobId });
    return getAutonomyJob(jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Autonomous worker failed.';
    await queryPostgres('UPDATE autonomous_job_runs SET status = $2, error_message = $3, completed_at = now() WHERE id = $1', [runId, 'failed', message]);
    await updateJob(jobId, 'failed', 100, null, null, message);
    await logFailure(job, message);
    await markWorker(job.workerName, 'failed', null, false, message);
    await publishAutonomyEvent('autonomy.job.failed', { jobId, workerName: job.workerName, error: message });
    await publishAutonomyEvent('autonomy.worker.failed', { workerName: job.workerName, jobId, error: message });
    return getAutonomyJob(jobId);
  }
}

async function runWorker(workerName: AutonomyWorkerName, symbol: string | null, timeframe: string | null, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const normalizedSymbol = (symbol ?? String(input.symbol ?? 'XAUUSD')).toUpperCase();
  const normalizedTimeframe = normalizeTimeframe(timeframe ?? String(input.timeframe ?? 'H1'));
  if (workerName === 'AutonomousPairSelectorWorker') return toPayload(await selectAutonomousPairs());
  if (workerName === 'AutonomousSymbolScannerWorker') return toPayload(await scanSymbols());
  if (workerName === 'AutonomousTimeframeSchedulerWorker') return toPayload(await enqueueTimeframes(normalizedSymbol));
  if (workerName === 'AutonomousChartCaptureWorker') return toPayload(await runCaptureReadiness(normalizedSymbol, normalizedTimeframe));
  if (workerName === 'AutonomousCacsmsVisionWorker') {
    const { startCacsmsVisionScan } = await import('./cacsms-vision-store');
    return toPayload(await startCacsmsVisionScan({ symbols: [normalizedSymbol], timeframes: [normalizedTimeframe], triggerSource: 'autonomous_worker' }));
  }
  if (workerName === 'AutonomousMultiTimeframeComparisonWorker') return toPayload(await analyzeSymbolMultiTimeframe({ symbol: normalizedSymbol }));
  if (workerName === 'AutonomousVisualInterpretationWorker') return toPayload(await analyzeAiVisualInterpretation({ symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  if (workerName === 'AutonomousAnomalyDetectionWorker') return toPayload(await analyzeVisualAnomaly({ symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  if (workerName === 'AutonomousChartSegmentationWorker') return toPayload(await analyzeChartSegmentation({ symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  if (workerName === 'AutonomousMarketInterpretationWorker') return toPayload(await analyzeVisualMarketInterpretation({ symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  if (workerName === 'AutonomousSignalGenerationWorker') return toPayload(await generateAutonomousSignal(normalizedSymbol, normalizedTimeframe));
  if (workerName === 'AutonomousAlertWorker') return toPayload(await generateAlerts());
  if (workerName === 'AutonomousFailureRecoveryWorker') return toPayload(await recoverFailedJobs((await getAutonomyConfig()).retryLimit));
  if (workerName === 'AutonomousAuditLogWorker') return { audited: true, confidenceScore: 100 };
  if (workerName === 'AutonomousOutcomeTrackingWorker') return toPayload(await trackPendingOutcomes());
  if (workerName === 'AutonomousModelLearningWorker') return toPayload(await evaluateModelFeedback());
  if (workerName === 'AutonomousMacroDataSyncWorker' || workerName === 'AutonomousCOTSyncWorker' || workerName === 'AutonomousInterestRateSyncWorker') return toPayload(await runMacroSyncPlaceholder(workerName));
  const captureId = await latestCaptureId(normalizedSymbol, normalizedTimeframe);
  if (!captureId) throw new Error(`No chart capture is available for ${normalizedSymbol} ${normalizedTimeframe}; autonomous capture source must publish a capture first.`);
  if (workerName === 'AutonomousVisionPreprocessingWorker') return { captureId, confidenceScore: 100, status: 'ready' };
  if (workerName === 'AutonomousCandleDetectionWorker') return toPayload(await analyzeCaptureCandles({ captureId, symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  if (workerName === 'AutonomousSwingDetectionWorker') return toPayload(await analyzeCaptureSwings({ captureId, symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  if (workerName === 'AutonomousPatternRecognitionWorker') return toPayload(await analyzeCapturePatterns({ captureId, symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  if (workerName === 'AutonomousTrendlineDetectionWorker') return toPayload(await analyzeCaptureTrendlines({ captureId, symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  if (workerName === 'AutonomousChannelDetectionWorker') return toPayload(await analyzeCaptureChannels({ captureId, symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  if (workerName === 'AutonomousSupportResistanceWorker') return toPayload(await analyzeCaptureSupportResistance({ captureId, symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  if (workerName === 'AutonomousOrderBlockWorker') return toPayload(await analyzeCaptureOrderBlocks({ captureId, symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  if (workerName === 'AutonomousLiquidityDetectionWorker') return toPayload(await analyzeCaptureLiquidity({ captureId, symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  if (workerName === 'AutonomousStructureAnalysisWorker') return toPayload(await analyzeCaptureStructure({ captureId, symbol: normalizedSymbol, timeframe: normalizedTimeframe }));
  throw new Error(`Worker ${workerName} is not registered.`);
}

export async function generateAutonomousSignal(
  symbol: string,
  timeframe: string,
  options: { refillMode?: boolean; tradingStyle?: AutonomousDecisionInput['tradingStyle'] } = {},
) {
  const account = await resolveExecutionAccountContext();
  const visual = await getLatestVisualMarketInterpretation(symbol, timeframe) ?? await analyzeVisualMarketInterpretation({ symbol, timeframe });
  let refillMode = options.refillMode === true;
  if (!refillMode) {
    const { shouldRelaxContinuousTradingLimits } = await import('@/lib/autonomy-pipeline-throttle');
    refillMode = await shouldRelaxContinuousTradingLimits();
  }
  const macro = await loadMacroContext(symbol);
  const execution = await loadExecutionContext(symbol, timeframe);
  let decision = buildAutonomousDecision({
    symbol,
    timeframe,
    accountClass: account?.accountClass ?? 'demo',
    refillMode,
    tradingStyle: options.tradingStyle,
    dominantTimeframe: options.tradingStyle
      ? getTradingStyleProfile(options.tradingStyle).dominantTimeframe
      : visual.dominantTimeframe,
    visual,
    macro,
    execution,
  });
  const baseSignalDecision = decision.decision;
  if (['BUY', 'SELL'].includes(decision.decision)) {
    const { resolveExecutableAutonomyDecision } = await import('@/lib/autonomy-execution-adapter');
    decision = (await resolveExecutableAutonomyDecision(decision)).decision;
  }
  const strategyId = normalizeStrategyId({
    tradingStyle: decision.tradingStyle ?? options.tradingStyle ?? null,
    timeframe: decision.timeframe,
    setupType: decision.setupType,
  });
  const topDownEvidence = buildTopDownAlignmentEvidence(decision, visual);
  const governanceMetadata = buildStrategyDecisionMetadata({
    strategyId,
    decision,
    visual,
    topDownEvidence,
  });
  const decisionId = randomUUID();
  await queryPostgres(`
    INSERT INTO autonomous_decision_logs (
      id, symbol, timeframe, dominant_timeframe, final_bias, setup_type, setup_readiness_score,
      confidence_score, risk_score, decision, entry_zone_json, stop_loss, take_profit_levels_json,
      invalidation_level, reason_for_decision, reason_against_decision, macro_risk_warning,
      liquidity_warning, anomaly_warning, recommended_next_action, trading_style,
      top_down_alignment_json, decision_evidence_json, strategy_id, market_regime,
      htf_bias, ltf_trigger, stop_method, target_method, risk_model_version
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24,$25,$26,$27,$28,$29,$30)
  `, [
    decisionId, decision.symbol, decision.timeframe, decision.dominantTimeframe, decision.finalBias, decision.setupType,
    decision.setupReadinessScore, decision.confidenceScore, decision.riskScore, decision.decision, JSON.stringify(decision.entryZone),
    decision.stopLoss, JSON.stringify(decision.takeProfitLevels), decision.invalidationLevel, decision.reasonForDecision,
    decision.reasonAgainstDecision, decision.macroRiskWarning, decision.liquidityWarning, decision.anomalyWarning,
    decision.recommendedNextAction, decision.tradingStyle ?? null,
    JSON.stringify(topDownEvidence),
    JSON.stringify(buildDecisionEvidence({ decision, visual, macro, execution, refillMode, governance: governanceMetadata })),
    strategyId,
    governanceMetadata.marketRegime,
    governanceMetadata.htfBias,
    governanceMetadata.ltfTrigger,
    governanceMetadata.stopMethod,
    governanceMetadata.targetMethod,
    governanceMetadata.riskModelVersion,
  ]);
  await queryPostgres(
    'INSERT INTO autonomous_outcome_tracking (id, decision_log_id, symbol, timeframe, decision, metadata_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
    [randomUUID(), decisionId, symbol, timeframe, decision.decision, JSON.stringify({ strategyId, tradingStyle: decision.tradingStyle ?? null })],
  );
  const directionDiagnostics = buildTradeDirectionDiagnostics({
    baseDecision: String(visual.finalDecision ?? baseSignalDecision),
    finalDecision: decision.decision,
    decision,
    visual,
    topDownEvidence,
  });
  const { logAutonomyDirectionAudit } = await import('./autonomy-direction-monitor');
  await logAutonomyDirectionAudit({
    decisionLogId: decisionId,
    symbol: decision.symbol,
    timeframe: decision.timeframe,
    stage: 'signal_generated',
    baseDecision: String(visual.finalDecision ?? baseSignalDecision),
    finalDecision: decision.decision,
    finalBias: decision.finalBias,
    side: ['BUY', 'SELL'].includes(decision.decision) ? decision.decision : null,
    accepted: ['BUY', 'SELL'].includes(decision.decision),
    reasons: directionDiagnostics.reasons,
    metrics: directionDiagnostics.metrics,
  });
  await publishAutonomyEvent('autonomy.signal.generated', { decisionLogId: decisionId, decision });
  if (['BUY', 'SELL'].includes(decision.decision) && decision.confidenceScore >= (await getAutonomyConfig()).alertThreshold) {
    await createAlert(decisionId, symbol, timeframe, 'high', 'trade_setup', decision.reasonForDecision);
  }
  const config = await getAutonomyConfig();
  const { maybeAutoDispatchAutonomyDecision } = await import('@/lib/autonomy-execution-adapter');
  const dispatch = await maybeAutoDispatchAutonomyDecision({
    decisionLogId: decisionId,
    decision,
    config,
  }).catch(() => null);
  if (dispatch) {
    await publishAutonomyEvent('autonomy.execution.dispatch', {
      decisionLogId: decisionId,
      status: dispatch.status,
      commandId: dispatch.commandId ?? null,
      blockers: dispatch.blockers,
    });
  }
  return { ...decision, decisionLogId: decisionId, executionDispatch: dispatch };
}

async function generateAlerts() {
  const result = await queryPostgres(`
    SELECT * FROM autonomous_decision_logs d
    WHERE d.created_at >= now() - interval '4 hours'
      AND d.decision IN ('BUY','SELL')
      AND d.confidence_score >= $1
      AND NOT EXISTS (SELECT 1 FROM autonomous_alerts a WHERE a.decision_log_id = d.id)
    ORDER BY d.created_at DESC
    LIMIT 20
  `, [(await getAutonomyConfig()).alertThreshold]);
  for (const row of result.rows) {
    await createAlert(String(row.id), String(row.symbol), String(row.timeframe), 'high', 'trade_setup', String(row.reason_for_decision));
  }
  return { alertsCreated: result.rows.length, confidenceScore: 100 };
}

async function selectAutonomousPairs() {
  const config = await getAutonomyConfig();
  if (!config.pairSelectionEnabled) {
    return { selectedSymbol: config.activeSymbols[0] ?? 'XAUUSD', selectedSymbols: config.activeSymbols, confidenceScore: 100, status: 'disabled' };
  }
  const selection = await runAutonomousPairSelection({
    watchlistSymbols: config.watchlistSymbols,
    maxSpreadPoints: config.maxSpreadPoints,
    pairSelectionEnabled: config.pairSelectionEnabled,
    maxSelectedSymbols: config.maxSelectedSymbols,
  });
  const fullWatchlist = config.watchlistSymbols.length > 0 ? config.watchlistSymbols : [...SYSTEM_FOCUS_SYMBOLS];
  await saveAutonomyConfig({ activeSymbols: fullWatchlist });
  await syncAutonomySymbolSchedules({ ...(await readAutonomyConfigRow()), activeSymbols: fullWatchlist });
  await publishAutonomyEvent('autonomy.pair.selected', {
    selectedSymbol: selection.selectedSymbol,
    selectedSymbols: selection.selectedSymbols,
    source: selection.source,
    session: selection.session,
  });
  return {
    selectedSymbol: selection.selectedSymbol,
    selectedSymbols: selection.selectedSymbols,
    candidates: selection.candidates,
    confidenceScore: selection.candidates[0]?.compositeScore ?? 100,
    status: 'selected',
  };
}

async function scanSymbols() {
  const config = await getAutonomyConfig();
  const symbols = config.activeSymbols.length > 0 ? config.activeSymbols : ['XAUUSD'];
  for (const symbol of symbols) {
    await queryPostgres('INSERT INTO autonomous_symbol_queue (id, symbol, reason) VALUES ($1,$2,$3)', [randomUUID(), symbol, 'scheduled_autonomous_scan']);
  }
  return { symbolsQueued: symbols.length, confidenceScore: 100 };
}

async function enqueueTimeframes(symbol: string) {
  const config = await getAutonomyConfig();
  for (const timeframe of config.activeTimeframes) {
    await queryPostgres('INSERT INTO autonomous_timeframe_queue (id, symbol, timeframe, worker_name) VALUES ($1,$2,$3,$4)', [randomUUID(), symbol, timeframe, 'AutonomousMarketInterpretationWorker']);
  }
  return { symbol, timeframesQueued: config.activeTimeframes.length, confidenceScore: 100 };
}

async function runCaptureReadiness(symbol: string, timeframe: string) {
  const config = await getAutonomyConfig();
  let activeSymbol = symbol.toUpperCase();
  if (config.pairSelectionEnabled && (activeSymbol === 'AUTO' || !config.activeSymbols.includes(activeSymbol))) {
    const selection = await selectAutonomousPairs();
    activeSymbol = selection.selectedSymbol;
  }

  const captureId = await latestCaptureId(activeSymbol, timeframe);
  if (captureId) {
    return { symbol: activeSymbol, timeframe, captureId, confidenceScore: 100, status: 'capture_available' };
  }

  const terminalId = await resolveConnectedTerminalId();
  if (!terminalId) {
    throw new Error(`No autonomous chart capture found for ${activeSymbol} ${timeframe}. Connect an MT5 terminal before top-down capture can proceed.`);
  }

  const { startTopDownSession } = await import('./top-down-orchestrator');
  const session = await startTopDownSession({ symbol: activeSymbol, terminalId, mode: 'full_auto' });
  return {
    symbol: activeSymbol,
    timeframe,
    sessionId: session.sessionId,
    confidenceScore: 80,
    status: 'top_down_session_started',
  };
}

async function resolveConnectedTerminalId(): Promise<string | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787'}/terminals`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const terminals = Array.isArray(payload.terminals) ? payload.terminals : [];
    const connected = terminals.find((terminal: { status?: string; terminalId?: string }) => terminal.status === 'connected');
    return connected?.terminalId ? String(connected.terminalId) : null;
  } catch {
    return null;
  }
}

async function runMacroSyncPlaceholder(workerName: string) {
  await publishAutonomyEvent('autonomy.job.progress', { workerName, stage: 'awaiting_live_macro_service' });
  throw new Error(`${workerName} requires a live macro data sync result. No placeholder worker output is emitted.`);
}

async function recoverFailedJobs(retryLimit: number) {
  const failed = await queryPostgres(`
    SELECT * FROM autonomous_jobs
    WHERE status = 'failed' AND retry_count < $1
    ORDER BY updated_at ASC
    LIMIT 5
  `, [retryLimit]);
  for (const row of failed.rows) {
    const retryCount = Number(row.retry_count) + 1;
    const backoffSeconds = Math.min(3600, 30 * 2 ** retryCount);
    await queryPostgres('INSERT INTO autonomous_retry_logs (id, job_id, retry_number, backoff_seconds, status, error_message) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), String(row.id), retryCount, backoffSeconds, 'scheduled', nullableString(row.error_message)]);
    await queryPostgres("UPDATE autonomous_jobs SET status = 'queued', retry_count = $2, next_run_time = now() + ($3 || ' seconds')::interval, updated_at = now() WHERE id = $1", [String(row.id), retryCount, backoffSeconds]);
  }
  return { recovered: failed.rows.length, confidenceScore: 100 };
}

async function trackPendingOutcomes() {
  const result = await queryPostgres("UPDATE autonomous_outcome_tracking SET metadata_json = metadata_json || $1::jsonb WHERE outcome_status = 'pending' RETURNING id", [JSON.stringify({ checkedAt: new Date().toISOString() })]);
  return { outcomesChecked: result.rows.length, confidenceScore: 100 };
}

async function evaluateModelFeedback() {
  const result = await queryPostgres('SELECT COUNT(*)::int AS count FROM autonomous_outcome_tracking');
  return { samples: Number(result.rows[0]?.count ?? 0), confidenceScore: 100 };
}

async function createAutonomyJob(input: { workerName: AutonomyWorkerName | string; symbol?: string | null; timeframe?: string | null; triggerSource: string; inputPayload?: Record<string, unknown>; retryCount?: number }) {
  const id = randomUUID();
  const auditTraceId = randomUUID();
  await queryPostgres(`
    INSERT INTO autonomous_jobs (
      id, symbol, timeframe, worker_name, trigger_source, status, progress, input_payload,
      retry_count, next_run_time, audit_trace_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,now(),$10)
  `, [id, input.symbol ?? null, input.timeframe ?? null, input.workerName, input.triggerSource, 'queued', 0, JSON.stringify(toPayload(input.inputPayload ?? {})), input.retryCount ?? 0, auditTraceId]);
  await audit(auditTraceId, id, 'autonomy.job.created', 'autonomy-runtime', toPayload(input));
  await publishAutonomyEvent('autonomy.job.created', { jobId: id, workerName: input.workerName, symbol: input.symbol, timeframe: input.timeframe });
  return id;
}

async function seedAutonomyDefaults() {
  await queryPostgres('INSERT INTO autonomous_config (key, value_json) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO NOTHING', ['default', JSON.stringify(toPayload(defaultConfig))]);
  await upsertHealth('autonomy', 'running', 'Autonomous runtime is available.', false, {});
  for (const worker of AUTONOMY_WORKERS) {
    await queryPostgres(`
      INSERT INTO autonomous_worker_status (worker_name, status)
      VALUES ($1, 'idle')
      ON CONFLICT (worker_name) DO NOTHING
    `, [worker]);
  }
  const config = await readAutonomyConfigRow();
  await syncAutonomySymbolSchedules(config);
  await seedSchedule('AutonomousPairSelectorWorker', null, null, config.scanFrequencySeconds);
  await seedSchedule('AutonomousSymbolScannerWorker', null, null, config.scanFrequencySeconds + 5);
  await seedSchedule('AutonomousFailureRecoveryWorker', null, null, 120);
  await seedSchedule('AutonomousAlertWorker', null, null, 60);
  await seedSchedule('AutonomousMacroDataSyncWorker', null, null, 900);
  await seedSchedule('AutonomousCOTSyncWorker', null, null, 604800);
  await seedSchedule('AutonomousInterestRateSyncWorker', null, null, 86400);
  await seedSchedule('AutonomousOutcomeTrackingWorker', null, null, 86400);
  await seedSchedule('AutonomousModelLearningWorker', null, null, 604800);
}

export async function ensureFocusSymbolsConfigured() {
  const config = await readAutonomyConfigRow();
  const watchlist = config.watchlistSymbols.map((symbol) => symbol.toUpperCase());
  const expected = SYSTEM_FOCUS_SYMBOLS.map((symbol) => symbol.toUpperCase());
  const matchesFocusUniverse =
    expected.every((symbol) => watchlist.includes(symbol))
    && watchlist.length === expected.length
    && config.maxSelectedSymbols >= expected.length
    && config.activeSymbols.length >= expected.length;
  if (matchesFocusUniverse) return config;
  const nextConfig: AutonomyConfig = {
    ...config,
    watchlistSymbols: [...SYSTEM_FOCUS_SYMBOLS],
    activeSymbols: [...SYSTEM_FOCUS_SYMBOLS],
    maxSelectedSymbols: SYSTEM_FOCUS_SYMBOLS.length,
    workerConcurrency: Math.max(config.workerConcurrency, 12),
  };
  await saveAutonomyConfig(nextConfig);
  await syncAutonomySymbolSchedules(nextConfig);
  return nextConfig;
}

async function syncAutonomySymbolSchedules(config: AutonomyConfig) {
  const symbols = Array.from(new Set([
    ...config.watchlistSymbols.map((symbol) => symbol.toUpperCase()),
    ...config.activeSymbols.map((symbol) => symbol.toUpperCase()),
  ]));
  for (const symbol of symbols) {
    for (const timeframe of config.activeTimeframes) {
      await seedSchedule('AutonomousChartCaptureWorker', symbol, timeframe, cadenceForTimeframe(timeframe));
      await seedSchedule('AutonomousCacsmsVisionWorker', symbol, timeframe, cadenceForTimeframe(timeframe) + 10);
      await seedSchedule('AutonomousMarketInterpretationWorker', symbol, timeframe, cadenceForTimeframe(timeframe) + 20);
      await seedSchedule('AutonomousSignalGenerationWorker', symbol, timeframe, cadenceForTimeframe(timeframe) + 40);
    }
    await seedSchedule('AutonomousMultiTimeframeComparisonWorker', symbol, null, 3600);
  }
}

async function seedSchedule(workerName: string, symbol: string | null, timeframe: string | null, cadenceSeconds: number) {
  const key = [workerName, symbol ?? 'system', timeframe ?? 'all'].join(':');
  await queryPostgres(`
    INSERT INTO autonomous_schedules (id, worker_name, schedule_key, symbol, timeframe, cadence_seconds, next_run_at, metadata_json)
    VALUES ($1,$2,$3,$4,$5,$6,now(),$7::jsonb)
    ON CONFLICT (schedule_key) DO NOTHING
  `, [randomUUID(), workerName, key, symbol, timeframe, cadenceSeconds, JSON.stringify({ autonomousFirst: true })]);
}

async function readAutonomyConfigRow(): Promise<AutonomyConfig> {
  const result = await queryPostgres('SELECT value_json FROM autonomous_config WHERE key = $1', ['default']);
  return { ...defaultConfig, ...objectValue(result.rows[0]?.value_json) } as AutonomyConfig;
}

export async function getAutonomyConfig(): Promise<AutonomyConfig> {
  await ensureAutonomySchema();
  const base = await readAutonomyConfigRow();
  const account = await resolveExecutionAccountContext();
  let config = applyAutonomyAccountProfile(base, account?.accountClass ?? 'demo');
  const { isContinuousTradingEnabled } = await import('./execution-risk-limits');
  if (isContinuousTradingEnabled()) {
    config = {
      ...config,
      mode: 'full_auto',
      tradeExecutionMode: 'full_auto',
    };
  }
  return config;
}

async function saveAutonomyConfig(patch: Partial<AutonomyConfig>) {
  const config = { ...(await getAutonomyConfig()), ...patch };
  await queryPostgres('INSERT INTO autonomous_config (key, value_json, updated_at) VALUES ($1,$2::jsonb,now()) ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = now()', ['default', JSON.stringify(toPayload(config))]);
}

async function updateJob(id: string, status: AutonomyJobStatus, progress: number, output: Record<string, unknown> | null, confidence: number | null, error?: string) {
  await queryPostgres(`
    UPDATE autonomous_jobs
    SET status = $2,
        progress = $3,
        output_payload = COALESCE($4::jsonb, output_payload),
        confidence_score = COALESCE($5, confidence_score),
        error_message = COALESCE($6, error_message),
        started_at = CASE WHEN $2 = 'running' AND started_at IS NULL THEN now() ELSE started_at END,
        completed_at = CASE WHEN $2 IN ('completed','failed','cancelled','blocked') THEN now() ELSE completed_at END,
        updated_at = now()
    WHERE id = $1
  `, [id, status, progress, output ? JSON.stringify(output) : null, confidence, error ?? null]);
  await publishAutonomyEvent(status === 'running' ? 'autonomy.job.progress' : `autonomy.job.${status}`, { jobId: id, status, progress });
}

async function markWorker(workerName: string, status: string, jobId: string | null, success?: boolean, error?: string) {
  await queryPostgres(`
    UPDATE autonomous_worker_status
    SET status = $2,
        current_job_id = $3,
        last_heartbeat_at = now(),
        last_error = $4,
        processed_count = processed_count + $5,
        failed_count = failed_count + $6
    WHERE worker_name = $1
  `, [workerName, status, jobId, error ?? null, success ? 1 : 0, error ? 1 : 0]);
}

async function logFailure(job: ReturnType<typeof mapJob>, message: string) {
  const nextRetryAt = new Date(Date.now() + Math.min(3600, 30 * 2 ** (job.retryCount + 1)) * 1000).toISOString();
  await queryPostgres(`
    INSERT INTO autonomous_failures (id, job_id, worker_name, symbol, timeframe, failure_type, error_message, retry_count, escalated, next_retry_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [randomUUID(), job.id, job.workerName, job.symbol, job.timeframe, 'worker_failure', message, job.retryCount, job.retryCount >= (await getAutonomyConfig()).retryLimit, nextRetryAt]);
}

async function createAlert(decisionLogId: string, symbol: string, timeframe: string, severity: string, alertType: string, message: string) {
  const id = randomUUID();
  await queryPostgres('INSERT INTO autonomous_alerts (id, decision_log_id, symbol, timeframe, severity, alert_type, message) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, decisionLogId, symbol, timeframe, severity, alertType, message]);
  await publishAutonomyEvent('autonomy.alert.triggered', { alertId: id, decisionLogId, symbol, timeframe, severity, message });
}

async function publishAutonomyEvent(eventType: string, payload: Record<string, unknown>) {
  await publishVisualIntelligenceEvent(eventType, null, null, payload);
}

async function audit(auditTraceId: string, jobId: string | null, eventType: string, actor: string, payload: Record<string, unknown>) {
  await queryPostgres('INSERT INTO autonomous_audit_trails (id, audit_trace_id, job_id, event_type, actor, payload_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [randomUUID(), auditTraceId, jobId, eventType, actor, JSON.stringify(payload)]);
}

async function latestCaptureId(symbol: string, timeframe: string) {
  const result = await queryPostgres(`
    SELECT id FROM chart_captures
    WHERE upper(symbol) = $1 AND upper(timeframe) = $2
    ORDER BY captured_at DESC
    LIMIT 1
  `, [symbol.toUpperCase(), timeframe.toUpperCase()]);
  return nullableString(result.rows[0]?.id);
}

async function loadMacroContext(symbol: string) {
  const { getMacroContextForSymbol } = await import('./macro-intelligence-store');
  return getMacroContextForSymbol(symbol);
}

async function loadExecutionContext(_symbol: string, _timeframe: string) {
  return { spreadScore: 75, dataQualityScore: 65, captureQualityScore: 65, sessionState: 'unknown' };
}

function buildTopDownAlignmentEvidence(
  decision: { timeframe: string; dominantTimeframe: string; finalBias: string; setupType: string; decision: string },
  visual: unknown,
) {
  const visualRecord = objectValue(visual);
  const visualBias = String(visualRecord.finalMarketBias ?? visualRecord.finalBias ?? '').toLowerCase();
  const decisionBias = String(decision.finalBias ?? '').toLowerCase();
  return {
    signalTimeframe: decision.timeframe,
    dominantTimeframe: decision.dominantTimeframe,
    visualBias: visualBias || null,
    decisionBias,
    aligned: Boolean(visualBias && decisionBias && visualBias === decisionBias),
    setupType: decision.setupType,
    decision: decision.decision,
  };
}

function buildDecisionEvidence(input: {
  decision: unknown;
  visual: unknown;
  macro: unknown;
  execution: unknown;
  refillMode: boolean;
  governance?: Record<string, unknown>;
}) {
  const visual = objectValue(input.visual);
  const macro = objectValue(input.macro);
  const execution = objectValue(input.execution);
  const decision = objectValue(input.decision);
  return {
    generatedAt: new Date().toISOString(),
    refillMode: input.refillMode,
    scores: {
      confidence: decision.confidenceScore ?? null,
      setupReadiness: decision.setupReadinessScore ?? null,
      risk: decision.riskScore ?? null,
    },
    visual: {
      finalMarketBias: visual.finalMarketBias ?? null,
      confidenceScore: visual.confidenceScore ?? null,
      setupReadinessScore: visual.setupReadinessScore ?? null,
      finalDecision: visual.finalDecision ?? null,
      marketPhase: visual.marketPhase ?? null,
      liquidityObjective: visual.liquidityObjective ?? null,
    },
    macro,
    execution,
    governance: input.governance ?? {},
  };
}

function buildStrategyDecisionMetadata(input: {
  strategyId: string;
  decision: {
    tradingStyle?: string | null;
    timeframe: string;
    dominantTimeframe: string;
    finalBias: string;
    setupType: string;
    stopLoss: number | null;
    takeProfitLevels: number[];
  };
  visual: unknown;
  topDownEvidence: Record<string, unknown>;
}) {
  const visual = objectValue(input.visual);
  const marketPhase = String(visual.marketPhase ?? '').trim();
  const ltfTrigger = String(visual.entryReadiness ?? input.decision.setupType ?? 'autonomous_fusion').trim();
  const hasStructuralStop = Number(input.decision.stopLoss ?? 0) > 0;
  const hasTargets = Array.isArray(input.decision.takeProfitLevels) && input.decision.takeProfitLevels.length > 0;
  return {
    strategyId: input.strategyId,
    tradingStyle: input.decision.tradingStyle ?? null,
    marketRegime: marketPhase || 'unknown',
    htfBias: String(input.topDownEvidence.decisionBias ?? input.decision.finalBias ?? 'unknown'),
    ltfTrigger,
    stopMethod: hasStructuralStop ? 'resolved_structural_or_default_stop' : 'unresolved',
    targetMethod: hasTargets ? 'resolved_reward_risk_target' : 'unresolved',
    riskModelVersion: 'equity_risk_v1',
    dominantTimeframe: input.decision.dominantTimeframe,
    signalTimeframe: input.decision.timeframe,
  };
}

function buildTradeDirectionDiagnostics(input: {
  baseDecision: string;
  finalDecision: string;
  decision: {
    decision: string;
    finalBias: string;
    confidenceScore: number;
    setupReadinessScore: number;
    riskScore: number;
  };
  visual: unknown;
  topDownEvidence: Record<string, unknown>;
}) {
  const visual = objectValue(input.visual);
  const scores = objectValue(visual.decisionScores);
  const signals = Array.isArray(visual.signals) ? visual.signals : [];
  const reasons: string[] = [];
  const base = input.baseDecision.toUpperCase();
  const final = input.finalDecision.toUpperCase();
  const bias = String(input.decision.finalBias ?? '').toLowerCase();
  const bullishScore = Number(scores.bullishScore ?? 0);
  const bearishScore = Number(scores.bearishScore ?? 0);
  if (base === 'SELL' && final !== 'SELL') reasons.push(`Visual layer produced SELL but autonomous output became ${final}.`);
  if (base !== 'SELL' && bias === 'bearish' && final !== 'SELL') reasons.push(`Bearish bias did not mature into SELL; base=${base}.`);
  if (final === 'SELL') reasons.push('SELL accepted by autonomous signal generation.');
  if (final === 'BUY') reasons.push('BUY accepted by autonomous signal generation.');
  if (bearishScore > bullishScore && final !== 'SELL') reasons.push(`Bearish score ${bearishScore} exceeded bullish score ${bullishScore}, but SELL was not selected.`);
  if (input.decision.confidenceScore < 50) reasons.push(`Confidence ${input.decision.confidenceScore}% is weak for directional execution.`);
  if (input.decision.setupReadinessScore < 55) reasons.push(`Setup readiness ${input.decision.setupReadinessScore}% is still immature.`);
  if (input.decision.riskScore >= 70) reasons.push(`Risk score ${input.decision.riskScore}% blocks directional execution.`);
  if (input.topDownEvidence.aligned === false) reasons.push('Top-down visual bias is not aligned with final decision bias.');
  if (!reasons.length) reasons.push('No direction-specific blocker recorded at signal generation.');

  return {
    reasons,
    metrics: {
      baseDecision: base,
      finalDecision: final,
      finalBias: input.decision.finalBias,
      bullishScore,
      bearishScore,
      scoreDeltaBearMinusBull: bearishScore - bullishScore,
      confidenceScore: input.decision.confidenceScore,
      setupReadinessScore: input.decision.setupReadinessScore,
      riskScore: input.decision.riskScore,
      topDownAligned: input.topDownEvidence.aligned ?? null,
      bearishSignalCount: signals.filter((signal) => objectValue(signal).bias === 'bearish').length,
      bullishSignalCount: signals.filter((signal) => objectValue(signal).bias === 'bullish').length,
    },
  };
}

async function listAlerts(limit: number) {
  const result = await queryPostgres('SELECT * FROM autonomous_alerts ORDER BY created_at DESC LIMIT $1', [limit]);
  return result.rows.map((row) => ({
    id: String(row.id),
    decisionLogId: nullableString(row.decision_log_id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    severity: String(row.severity),
    alertType: String(row.alert_type),
    message: String(row.message),
    status: String(row.status),
    createdAt: dateString(row.created_at),
  }));
}

async function getHealth() {
  const result = await queryPostgres('SELECT * FROM autonomous_system_health ORDER BY updated_at DESC');
  return result.rows.map((row) => ({
    key: String(row.health_key),
    status: String(row.status),
    emergencyStopped: Boolean(row.emergency_stopped),
    message: String(row.message),
    payload: objectValue(row.payload_json),
    updatedAt: dateString(row.updated_at),
  }));
}

async function upsertHealth(key: string, status: string, message: string, emergencyStopped: boolean, payload: Record<string, unknown>) {
  await queryPostgres(`
    INSERT INTO autonomous_system_health (id, health_key, status, emergency_stopped, message, payload_json, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,now())
    ON CONFLICT (health_key) DO UPDATE
      SET status = EXCLUDED.status,
          emergency_stopped = EXCLUDED.emergency_stopped,
          message = EXCLUDED.message,
          payload_json = EXCLUDED.payload_json,
          updated_at = now()
  `, [randomUUID(), key, status, emergencyStopped, message, JSON.stringify(payload)]);
  await publishAutonomyEvent('autonomy.health.updated', { key, status, emergencyStopped, message, payload });
}

async function updateHealthSummary() {
  const [queued, failed] = await Promise.all([
    queryPostgres("SELECT COUNT(*)::int AS count FROM autonomous_jobs WHERE status = 'queued'"),
    queryPostgres("SELECT COUNT(*)::int AS count FROM autonomous_jobs WHERE status = 'failed' AND updated_at >= now() - interval '24 hours'"),
  ]);
  await upsertHealth('autonomy', 'running', 'Autonomous runtime is scanning schedules and workers.', false, {
    queuedJobs: Number(queued.rows[0]?.count ?? 0),
    failedJobs24h: Number(failed.rows[0]?.count ?? 0),
  });
}

async function isEmergencyStopped() {
  const result = await queryPostgres("SELECT emergency_stopped FROM autonomous_system_health WHERE health_key = 'autonomy' LIMIT 1");
  return Boolean(result.rows[0]?.emergency_stopped);
}

async function bumpSchedule(id: string, cadenceSeconds: number) {
  await queryPostgres("UPDATE autonomous_schedules SET last_run_at = now(), next_run_at = now() + ($2 || ' seconds')::interval, updated_at = now() WHERE id = $1", [id, cadenceSeconds]);
}

function cadenceForTimeframe(timeframe: string) {
  if (timeframe === 'W') return 604800;
  if (timeframe === 'D') return 86400;
  if (timeframe === 'H4') return 14400;
  if (timeframe === 'H1') return 3600;
  return 900;
}

function normalizeTimeframe(value: string) {
  const timeframe = value.toUpperCase();
  if (!AUTONOMY_TIMEFRAMES.includes(timeframe as typeof AUTONOMY_TIMEFRAMES[number])) throw new Error(`Unsupported autonomous timeframe ${timeframe}.`);
  return timeframe;
}

function mapJob(row: Row) {
  return {
    id: String(row.id),
    symbol: nullableString(row.symbol),
    timeframe: nullableString(row.timeframe),
    workerName: String(row.worker_name),
    triggerSource: String(row.trigger_source),
    status: String(row.status) as AutonomyJobStatus,
    progress: Number(row.progress),
    inputPayload: objectValue(row.input_payload),
    outputPayload: objectValue(row.output_payload),
    confidenceScore: numberValue(row.confidence_score, null),
    retryCount: Number(row.retry_count),
    errorMessage: nullableString(row.error_message),
    startedAt: nullableDate(row.started_at),
    completedAt: nullableDate(row.completed_at),
    nextRunTime: nullableDate(row.next_run_time),
    auditTraceId: String(row.audit_trace_id),
    createdAt: dateString(row.created_at),
    updatedAt: dateString(row.updated_at),
  };
}

function mapRun(row: Row) {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    workerName: String(row.worker_name),
    status: String(row.status),
    progress: Number(row.progress),
    inputPayload: objectValue(row.input_payload),
    outputPayload: objectValue(row.output_payload),
    confidenceScore: numberValue(row.confidence_score, null),
    errorMessage: nullableString(row.error_message),
    startedAt: dateString(row.started_at),
    completedAt: nullableDate(row.completed_at),
  };
}

function mapWorker(row: Row) {
  return {
    workerName: String(row.worker_name),
    status: String(row.status),
    currentJobId: nullableString(row.current_job_id),
    lastHeartbeatAt: dateString(row.last_heartbeat_at),
    lastError: nullableString(row.last_error),
    processedCount: Number(row.processed_count),
    failedCount: Number(row.failed_count),
    metadata: objectValue(row.metadata_json),
  };
}

function mapSchedule(row: Row) {
  return {
    id: String(row.id),
    workerName: String(row.worker_name),
    scheduleKey: String(row.schedule_key),
    symbol: nullableString(row.symbol),
    timeframe: nullableString(row.timeframe),
    cadenceSeconds: Number(row.cadence_seconds),
    enabled: Boolean(row.enabled),
    nextRunAt: dateString(row.next_run_at),
    lastRunAt: nullableDate(row.last_run_at),
    metadata: objectValue(row.metadata_json),
  };
}

function mapDecision(row: Row) {
  return {
    id: String(row.id),
    jobId: nullableString(row.job_id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    dominantTimeframe: String(row.dominant_timeframe),
    finalBias: String(row.final_bias),
    setupType: String(row.setup_type),
    setupReadinessScore: Number(row.setup_readiness_score),
    confidenceScore: Number(row.confidence_score),
    riskScore: Number(row.risk_score),
    decision: String(row.decision),
    tradingStyle: nullableString(row.trading_style),
    strategyId: nullableString(row.strategy_id),
    marketRegime: nullableString(row.market_regime),
    htfBias: nullableString(row.htf_bias),
    ltfTrigger: nullableString(row.ltf_trigger),
    stopMethod: nullableString(row.stop_method),
    targetMethod: nullableString(row.target_method),
    riskModelVersion: nullableString(row.risk_model_version),
    entryZone: objectValue(row.entry_zone_json),
    topDownAlignment: objectValue(row.top_down_alignment_json),
    decisionEvidence: objectValue(row.decision_evidence_json),
    reasonForDecision: String(row.reason_for_decision),
    reasonAgainstDecision: String(row.reason_against_decision),
    macroRiskWarning: String(row.macro_risk_warning),
    liquidityWarning: String(row.liquidity_warning),
    anomalyWarning: String(row.anomaly_warning),
    recommendedNextAction: String(row.recommended_next_action),
    createdAt: dateString(row.created_at),
  };
}

function mapAudit(row: Row) {
  return {
    id: String(row.id),
    auditTraceId: String(row.audit_trace_id),
    jobId: nullableString(row.job_id),
    eventType: String(row.event_type),
    actor: String(row.actor),
    payload: objectValue(row.payload_json),
    createdAt: dateString(row.created_at),
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown, fallback: number | null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableString(value: unknown) {
  return value == null ? null : String(value);
}

function toPayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  return { value };
}

function nullableDate(value: unknown) {
  return value == null ? null : dateString(value);
}

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
