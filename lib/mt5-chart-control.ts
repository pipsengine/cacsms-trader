import { randomUUID } from 'crypto';

import { extractSymbolTelemetry } from './mt5-symbol-telemetry';
import { resolveMt5BridgeSharedSecret } from './mt5-bridge-secret';

const CHART_COMMAND_TYPES = new Set(['open_chart', 'set_timeframe', 'capture_chart', 'close_chart']);

export type Mt5ChartCommandType = 'open_chart' | 'set_timeframe' | 'capture_chart' | 'close_chart';

export interface Mt5ChartCommandPayload {
  symbol: string;
  canonicalSymbol?: string;
  brokerSymbol?: string;
  timeframe?: string;
  sessionId?: string;
  chartId?: number;
  barCount?: number;
}

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

async function bridgeSecret(): Promise<string> {
  return resolveMt5BridgeSharedSecret();
}

async function resolveBrokerSymbol(terminalId: string, symbol: string): Promise<{ canonicalSymbol: string; brokerSymbol: string }> {
  const canonicalSymbol = symbol.toUpperCase();
  try {
    const response = await fetch(`${bridgeUrl()}/terminals`, { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      const terminals = Array.isArray(payload.terminals) ? payload.terminals : [];
      const terminal = terminals.find((item: { terminalId?: string }) => String(item.terminalId ?? '') === terminalId) ?? terminals[0];
      const telemetry = extractSymbolTelemetry(terminal);
      const row = telemetry.find((item) => item.symbol.toUpperCase() === canonicalSymbol);
      const brokerSymbol = String(row?.brokerSymbol ?? '').trim();
      if (row?.available && brokerSymbol) return { canonicalSymbol, brokerSymbol };
    }
  } catch {
    // Fall back to the canonical symbol when the bridge is temporarily unavailable.
  }
  return { canonicalSymbol, brokerSymbol: canonicalSymbol };
}

export function timeframeToMt5Period(timeframe: string): string {
  const normalized = timeframe.toUpperCase();
  const mapping: Record<string, string> = {
    M1: 'PERIOD_M1',
    M5: 'PERIOD_M5',
    M15: 'PERIOD_M15',
    M30: 'PERIOD_M30',
    H1: 'PERIOD_H1',
    H4: 'PERIOD_H4',
    D: 'PERIOD_D1',
    W: 'PERIOD_W1',
    MN: 'PERIOD_MN1',
  };
  return mapping[normalized] ?? `PERIOD_${normalized}`;
}

export async function enqueueMt5ChartCommand(input: {
  terminalId: string;
  type: Mt5ChartCommandType;
  payload: Mt5ChartCommandPayload;
  commandId?: string;
}): Promise<{ commandId: string; type: string }> {
  if (!CHART_COMMAND_TYPES.has(input.type)) {
    throw new Error(`Unsupported chart command type: ${input.type}`);
  }

  const commandId = input.commandId ?? randomUUID();
  const secret = await bridgeSecret();
  const response = await fetch(`${bridgeUrl()}/commands/enqueue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cacsms-Secret': secret,
    },
    body: JSON.stringify({
      commandId,
      terminalId: input.terminalId,
      type: input.type,
      payload: input.payload,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chart command enqueue failed (${response.status}): ${text}`);
  }

  return { commandId, type: input.type };
}

export async function openChartOnTerminal(terminalId: string, symbol: string, sessionId?: string) {
  const resolved = await resolveBrokerSymbol(terminalId, symbol);
  return enqueueMt5ChartCommand({
    terminalId,
    type: 'open_chart',
    payload: { symbol: resolved.brokerSymbol, canonicalSymbol: resolved.canonicalSymbol, brokerSymbol: resolved.brokerSymbol, sessionId },
  });
}

export async function setChartTimeframe(terminalId: string, symbol: string, timeframe: string, sessionId?: string) {
  const resolved = await resolveBrokerSymbol(terminalId, symbol);
  return enqueueMt5ChartCommand({
    terminalId,
    type: 'set_timeframe',
    payload: {
      symbol: resolved.brokerSymbol,
      canonicalSymbol: resolved.canonicalSymbol,
      brokerSymbol: resolved.brokerSymbol,
      timeframe: timeframeToMt5Period(timeframe),
      sessionId,
    },
  });
}

export async function captureChartOnTerminal(terminalId: string, symbol: string, timeframe: string, sessionId?: string) {
  const resolved = await resolveBrokerSymbol(terminalId, symbol);
  return enqueueMt5ChartCommand({
    terminalId,
    type: 'capture_chart',
    payload: {
      symbol: resolved.brokerSymbol,
      canonicalSymbol: resolved.canonicalSymbol,
      brokerSymbol: resolved.brokerSymbol,
      timeframe: timeframeToMt5Period(timeframe),
      sessionId,
      barCount: 120,
    },
  });
}
