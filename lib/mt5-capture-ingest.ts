import { AUTONOMY_TIMEFRAME_SEQUENCE } from './autonomous-pipeline';
import {
  institutionalTimeframeDbAliases,
  isPlausibleMacroTimeframeCapture,
  normalizeInstitutionalTimeframe,
} from './institutional-timeframe-normalize';
import { captureChartOnTerminal } from './mt5-chart-control';
import { resolveMt5BridgeSharedSecret } from './mt5-bridge-secret';
import {
  ensurePipelineSchema,
  finalizeTopDownCaptureStage,
  getLatestPipelineSession,
  updateTimeframeCaptureState,
} from './top-down-orchestrator';
import { queryPostgres } from './postgres';
import { createCaptureAndRunAnalysis } from './visual-intelligence-store';
import type { VisionCandleInput } from './visual-intelligence-types';

interface BridgeCaptureCommand {
  commandId: string;
  terminalId: string;
  type: string;
  payload: {
    symbol?: string;
    canonicalSymbol?: string;
    brokerSymbol?: string;
    timeframe?: string;
    sessionId?: string;
    barCount?: number;
  };
  status: string;
  createdAt?: string;
  lastAckAt?: string;
  ack?: {
    status?: string;
    brokerMessage?: string;
  };
}

interface ParsedCaptureAck {
  symbol: string;
  timeframe: string;
  bars: VisionCandleInput[];
}

export interface CaptureIngestSummary {
  scanned: number;
  ingested: number;
  skipped: number;
  errors: string[];
}

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

export function mt5PeriodToTimeframe(period: string): string {
  return normalizeInstitutionalTimeframe(period);
}

function parseCaptureAck(brokerMessage: string): ParsedCaptureAck | null {
  if (!brokerMessage.trim()) return null;
  try {
    const payload = JSON.parse(brokerMessage) as {
      symbol?: string;
      timeframe?: string;
      bars?: Array<{
        time?: string;
        open?: number;
        high?: number;
        low?: number;
        close?: number;
        volume?: number;
      }>;
    };
    const symbol = String(payload.symbol ?? '').trim().toUpperCase();
    const timeframe = mt5PeriodToTimeframe(String(payload.timeframe ?? ''));
    const bars = Array.isArray(payload.bars)
      ? payload.bars
          .map((bar) => ({
            timestamp: bar.time ? String(bar.time) : undefined,
            open: Number(bar.open),
            high: Number(bar.high),
            low: Number(bar.low),
            close: Number(bar.close),
            volume: Number(bar.volume ?? 0),
          }))
          .filter((bar) => Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close))
      : [];
    if (!symbol || !timeframe || bars.length === 0) return null;
    return { symbol, timeframe, bars };
  } catch {
    return null;
  }
}

async function isCommandIngested(commandId: string): Promise<boolean> {
  const result = await queryPostgres(
    `SELECT id FROM chart_captures
     WHERE metadata_json->>'mt5CommandId' = $1
     LIMIT 1`,
    [commandId],
  );
  return Boolean(result.rows[0]);
}

async function fetchBridgeCaptureCommands(symbol?: string, status?: string): Promise<BridgeCaptureCommand[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await fetch(`${bridgeUrl()}/commands${query}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Bridge commands unavailable (${response.status}).`);
  }
  const payload = await response.json() as { commands?: BridgeCaptureCommand[] };
  const commands = Array.isArray(payload.commands) ? payload.commands : [];
  return commands
    .filter((command) => command.type === 'CAPTURE_CHART')
    .filter((command) => {
      if (!symbol) return true;
      const commandSymbol = String(command.payload?.symbol ?? '').toUpperCase();
      const canonicalSymbol = String(command.payload?.canonicalSymbol ?? '').toUpperCase();
      return commandSymbol === symbol.toUpperCase() || canonicalSymbol === symbol.toUpperCase();
    })
    .sort((left, right) => Date.parse(left.lastAckAt ?? left.createdAt ?? '') - Date.parse(right.lastAckAt ?? right.createdAt ?? ''));
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function hasStoredCapture(symbol: string, timeframe: string): Promise<string | null> {
  const canonical = normalizeInstitutionalTimeframe(timeframe);
  const aliases = institutionalTimeframeDbAliases(canonical);
  const result = await queryPostgres(
    `SELECT id, upper(timeframe) AS timeframe
     FROM chart_captures
     WHERE upper(symbol) = $1 AND upper(timeframe) = ANY($2::text[])
     ORDER BY captured_at DESC
     LIMIT 8`,
    [symbol.toUpperCase(), aliases],
  );
  for (const row of result.rows) {
    const captureId = String(row.id ?? '');
    if (!captureId) continue;
    if (canonical === 'MN' || canonical === 'W') {
      const meta = objectValue(
        (await queryPostgres('SELECT metadata_json FROM chart_captures WHERE id = $1 LIMIT 1', [captureId])).rows[0]?.metadata_json,
      );
      const firstBarTime = String(meta.firstBarTime ?? '');
      const lastBarTime = String(meta.lastBarTime ?? '');
      if (firstBarTime && lastBarTime) {
        if (!isPlausibleMacroTimeframeCapture(canonical, [{ timestamp: firstBarTime }, { timestamp: lastBarTime }])) {
          continue;
        }
      } else if (normalizeInstitutionalTimeframe(String(row.timeframe)) === canonical) {
        // Legacy MN1 rows captured before EA monthly support — force fresh macro capture.
        continue;
      }
    }
    return captureId;
  }
  return null;
}

function hasPendingBridgeCapture(
  commands: BridgeCaptureCommand[],
  sessionId: string,
  timeframe: string,
): boolean {
  return commands.some((command) => {
    const commandSessionId = String(command.payload?.sessionId ?? '');
    const commandTimeframe = mt5PeriodToTimeframe(String(command.payload?.timeframe ?? ''));
    const pending = command.status === 'queued' || command.status === 'leased' || command.status === 'acknowledged';
    return pending && commandSessionId === sessionId && commandTimeframe === timeframe;
  });
}

export async function recoverPendingPipelineCaptures(symbol: string): Promise<number> {
  await ensurePipelineSchema();
  const session = await getLatestPipelineSession(symbol);
  if (!session) return 0;

  const sessionId = String(session.id);
  const terminalId = String(session.terminal_id ?? '').trim();
  const activeSymbol = String(session.symbol ?? symbol).toUpperCase();
  if (!terminalId) return 0;

  const captureMap = objectValue(session.timeframe_capture_json);
  const bridgeCommands = await fetchBridgeCaptureCommands(activeSymbol);
  let requeued = 0;

  for (const timeframe of AUTONOMY_TIMEFRAME_SEQUENCE) {
    const existingCaptureId = await hasStoredCapture(activeSymbol, timeframe);
    if (existingCaptureId) {
      await updateTimeframeCaptureState(sessionId, timeframe, 'stored', existingCaptureId);
      continue;
    }

    if (captureMap[timeframe] === 'stored') {
      await updateTimeframeCaptureState(sessionId, timeframe, 'awaiting_recapture');
    }

    if (hasPendingBridgeCapture(bridgeCommands, sessionId, timeframe)) continue;

    try {
      await captureChartOnTerminal(terminalId, activeSymbol, timeframe, sessionId);
      await updateTimeframeCaptureState(sessionId, timeframe, 'command_queued');
      requeued += 1;
    } catch {
      // enqueue retries on the next sync tick
    }
  }

  return requeued;
}

async function ingestCaptureCommand(command: BridgeCaptureCommand): Promise<string | null> {
  const ackStatus = String(command.ack?.status ?? '').toLowerCase();
  if (ackStatus !== 'accepted') return null;

  const parsed = parseCaptureAck(String(command.ack?.brokerMessage ?? ''));
  if (!parsed) {
    throw new Error(`Unable to parse capture ack for command ${command.commandId}.`);
  }
  if (!isPlausibleMacroTimeframeCapture(parsed.timeframe, parsed.bars)) {
    throw new Error(`Rejected ${parsed.timeframe} capture for ${parsed.symbol}: bar spacing is not macro timeframe (re-queue after EA monthly support).`);
  }

  const result = await createCaptureAndRunAnalysis({
    symbol: String(command.payload.canonicalSymbol ?? parsed.symbol).toUpperCase(),
    timeframe: normalizeInstitutionalTimeframe(parsed.timeframe),
    sourcePlatform: 'mt5',
    captureType: 'broker_snapshot',
    jobType: 'mt5_top_down_capture',
    metadata: {
      mt5CommandId: command.commandId,
      terminalId: command.terminalId,
      sessionId: command.payload.sessionId ?? null,
      brokerSymbol: command.payload.brokerSymbol ?? parsed.symbol,
      bridgeTimeframe: command.payload.timeframe ?? null,
      barCount: parsed.bars.length,
      firstBarTime: parsed.bars[0]?.timestamp ?? null,
      lastBarTime: parsed.bars[parsed.bars.length - 1]?.timestamp ?? null,
      ingestionSource: 'mt5_capture_ack',
    },
    candles: parsed.bars,
  });

  const sessionId = String(command.payload.sessionId ?? '').trim();
  if (sessionId) {
    await ensurePipelineSchema();
    await updateTimeframeCaptureState(sessionId, parsed.timeframe, 'stored', result.capture.id);
    await finalizeTopDownCaptureStage(sessionId);
  }

  return result.capture.id;
}

export async function syncMt5CaptureAcks(input: { symbol?: string; limit?: number } = {}): Promise<CaptureIngestSummary> {
  const summary: CaptureIngestSummary = { scanned: 0, ingested: 0, skipped: 0, errors: [] };
  await resolveMt5BridgeSharedSecret();
  if (input.symbol) {
    try {
      await recoverPendingPipelineCaptures(input.symbol);
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : 'Capture recovery failed.');
    }
  }
  const commands = await fetchBridgeCaptureCommands(input.symbol, 'acknowledged');
  summary.scanned = commands.length;

  const limit = Math.max(1, Math.min(input.limit ?? 12, 50));
  let processed = 0;

  for (const command of commands) {
    if (processed >= limit) break;
    processed += 1;

    try {
      if (await isCommandIngested(command.commandId)) {
        summary.skipped += 1;
        const sessionId = String(command.payload.sessionId ?? '').trim();
        const timeframe = mt5PeriodToTimeframe(String(command.payload.timeframe ?? ''));
        if (sessionId && AUTONOMY_TIMEFRAME_SEQUENCE.includes(timeframe as (typeof AUTONOMY_TIMEFRAME_SEQUENCE)[number])) {
          await ensurePipelineSchema();
          await updateTimeframeCaptureState(sessionId, timeframe, 'stored');
          await finalizeTopDownCaptureStage(sessionId);
        }
        continue;
      }

      const captureId = await ingestCaptureCommand(command);
      if (captureId) summary.ingested += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : `Failed to ingest ${command.commandId}.`);
    }
  }

  return summary;
}
