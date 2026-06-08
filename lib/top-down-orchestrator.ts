import { randomUUID } from 'crypto';

import { AUTONOMY_TIMEFRAME_SEQUENCE } from './autonomous-pipeline';
import { captureChartOnTerminal, openChartOnTerminal, setChartTimeframe } from './mt5-chart-control';
import { queryPostgres } from './postgres';

type SessionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked';

const pipelineSchemaSql = `
CREATE TABLE IF NOT EXISTS autonomous_pipeline_sessions (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  terminal_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  current_stage TEXT NOT NULL DEFAULT 'terminal-connectivity',
  current_timeframe TEXT,
  mode TEXT NOT NULL DEFAULT 'full_auto',
  progress INTEGER NOT NULL DEFAULT 0,
  stage_status_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeframe_capture_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS autonomous_pipeline_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID REFERENCES autonomous_pipeline_sessions(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_autonomous_pipeline_sessions_status ON autonomous_pipeline_sessions(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_pipeline_events_session ON autonomous_pipeline_events(session_id, created_at DESC);
`;

let pipelineSchemaReady: Promise<void> | null = null;

export async function ensurePipelineSchema() {
  if (!pipelineSchemaReady) {
    pipelineSchemaReady = queryPostgres(pipelineSchemaSql).then(() => undefined);
  }
  return pipelineSchemaReady;
}

export async function startTopDownSession(input: {
  symbol: string;
  terminalId: string;
  mode?: string;
}): Promise<{ sessionId: string; status: SessionStatus }> {
  await ensurePipelineSchema();
  const sessionId = randomUUID();
  const symbol = input.symbol.toUpperCase();
  const stageStatus = Object.fromEntries(
    [
      'terminal-connectivity',
      'pair-selection',
      'chart-navigation',
      'top-down-capture',
      'visual-detection',
      'mtf-fusion',
      'cacsms-vision',
      'macro-intelligence',
      'signal-generation',
      'risk-gate',
      'execution',
      'trade-monitoring',
      'unattended-operations',
    ].map((stage) => [stage, 'not_started']),
  );

  await queryPostgres(
    `INSERT INTO autonomous_pipeline_sessions (
      id, symbol, terminal_id, status, current_stage, mode, progress, stage_status_json, timeframe_capture_json, started_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
    [sessionId, symbol, input.terminalId, 'running', 'chart-navigation', input.mode ?? 'full_auto', 5, stageStatus, {},],
  );

  await logPipelineEvent(sessionId, 'chart-navigation', 'session.started', `Top-down session started for ${symbol}.`, {
    symbol,
    terminalId: input.terminalId,
  });

  try {
    await updateSessionStage(sessionId, 'terminal-connectivity', 'completed', 10);
    await updateSessionStage(sessionId, 'pair-selection', 'completed', 12);
    await updateSessionStage(sessionId, 'chart-navigation', 'in_progress', 15);

    await openChartOnTerminal(input.terminalId, symbol, sessionId);
    await logPipelineEvent(sessionId, 'chart-navigation', 'command.open_chart', `Opened chart for ${symbol}.`, { symbol });

    for (let index = 0; index < AUTONOMY_TIMEFRAME_SEQUENCE.length; index += 1) {
      const timeframe = AUTONOMY_TIMEFRAME_SEQUENCE[index];
      await updateSession(sessionId, {
        currentStage: 'top-down-capture',
        currentTimeframe: timeframe,
        progress: 20 + index * 12,
      });
      await updateSessionStage(sessionId, 'top-down-capture', 'in_progress', 20 + index * 12);

      await setChartTimeframe(input.terminalId, symbol, timeframe, sessionId);
      await captureChartOnTerminal(input.terminalId, symbol, timeframe, sessionId);
      await markTimeframeCaptured(sessionId, timeframe, 'command_queued');
      await logPipelineEvent(sessionId, 'top-down-capture', 'command.capture_chart', `Capture queued for ${symbol} ${timeframe}.`, {
        symbol,
        timeframe,
      });
    }

    await updateSessionStage(sessionId, 'chart-navigation', 'completed', 80);
    await updateSessionStage(sessionId, 'top-down-capture', 'in_progress', 82);
    await updateSession(sessionId, { status: 'running', currentStage: 'visual-detection', progress: 85 });

    return { sessionId, status: 'running' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Top-down session failed.';
    await queryPostgres(
      'UPDATE autonomous_pipeline_sessions SET status = $2, error_message = $3, updated_at = now() WHERE id = $1',
      [sessionId, 'failed', message],
    );
    await logPipelineEvent(sessionId, 'chart-navigation', 'session.failed', message, {});
    throw error;
  }
}

export async function getLatestPipelineSession(symbol?: string) {
  await ensurePipelineSchema();
  const params: string[] = [];
  const where = symbol ? 'WHERE upper(symbol) = $1' : '';
  if (symbol) params.push(symbol.toUpperCase());
  const result = await queryPostgres(
    `SELECT * FROM autonomous_pipeline_sessions ${where} ORDER BY created_at DESC LIMIT 1`,
    params,
  );
  return result.rows[0] ?? null;
}

export async function listPipelineEvents(sessionId: string, limit = 30) {
  await ensurePipelineSchema();
  const result = await queryPostgres(
    'SELECT * FROM autonomous_pipeline_events WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2',
    [sessionId, limit],
  );
  return result.rows;
}

async function updateSession(
  sessionId: string,
  patch: { status?: SessionStatus; currentStage?: string; currentTimeframe?: string | null; progress?: number },
) {
  await queryPostgres(
    `UPDATE autonomous_pipeline_sessions
     SET status = COALESCE($2, status),
         current_stage = COALESCE($3, current_stage),
         current_timeframe = COALESCE($4, current_timeframe),
         progress = COALESCE($5, progress),
         updated_at = now()
     WHERE id = $1`,
    [sessionId, patch.status ?? null, patch.currentStage ?? null, patch.currentTimeframe ?? null, patch.progress ?? null],
  );
}

async function updateSessionStage(sessionId: string, stageId: string, status: string, progress: number) {
  const current = await queryPostgres('SELECT stage_status_json FROM autonomous_pipeline_sessions WHERE id = $1', [sessionId]);
  const stageStatus = { ...objectValue(current.rows[0]?.stage_status_json), [stageId]: status };
  await queryPostgres(
    'UPDATE autonomous_pipeline_sessions SET stage_status_json = $2, progress = $3, updated_at = now() WHERE id = $1',
    [sessionId, stageStatus, progress],
  );
}

async function markTimeframeCaptured(sessionId: string, timeframe: string, state: string) {
  const current = await queryPostgres('SELECT timeframe_capture_json FROM autonomous_pipeline_sessions WHERE id = $1', [sessionId]);
  const captureMap = { ...objectValue(current.rows[0]?.timeframe_capture_json), [timeframe]: state };
  await queryPostgres(
    'UPDATE autonomous_pipeline_sessions SET timeframe_capture_json = $2, updated_at = now() WHERE id = $1',
    [sessionId, captureMap],
  );
}

async function logPipelineEvent(
  sessionId: string,
  stageId: string,
  eventType: string,
  message: string,
  payload: Record<string, unknown>,
) {
  await queryPostgres(
    'INSERT INTO autonomous_pipeline_events (session_id, stage_id, event_type, message, payload_json) VALUES ($1,$2,$3,$4,$5)',
    [sessionId, stageId, eventType, message, payload],
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
