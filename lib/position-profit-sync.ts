import { extractSymbolTelemetry, symbolTelemetryMap } from './mt5-symbol-telemetry';
import {
  listOpenPositions,
  updatePositionLiveMetrics,
  type ExecutionOpenPosition,
} from './execution-open-positions';
import {
  mergePositionManagementMetadata,
  parsePositionManagementMetadata,
} from './position-management-state';
import { getPositionManagementConfig } from './trade-monitor-config';

export type TerminalPositionSnapshot = {
  ticket: string;
  symbol: string;
  side: 'buy' | 'sell';
  volumeLots: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  profitLoss: number;
};

type BridgeTerminal = {
  terminalId?: string;
  symbolTelemetry?: unknown;
  openPositionSnapshots?: unknown;
  equity?: number;
  balance?: number;
};

function defaultRiskPoints(symbol: string): number {
  const config = getPositionManagementConfig();
  const normalized = symbol.toUpperCase();
  if (normalized.startsWith('XAU') || normalized.startsWith('XAG')) return config.defaultRiskPointsGold;
  if (['US30', 'NASDAQ100', 'NAS100', 'SP500', 'SPX500', 'US500'].includes(normalized)) {
    return config.defaultRiskPointsIndex;
  }
  return config.defaultRiskPointsForex;
}

function normalizeSnapshots(raw: unknown): TerminalPositionSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const ticket = String(row.ticket ?? '').trim();
      const symbol = String(row.symbol ?? '').toUpperCase().trim();
      if (!ticket || !symbol) return null;
      return {
        ticket,
        symbol,
        side: String(row.side ?? 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy',
        volumeLots: Number(row.volumeLots ?? row.volume ?? 0.01),
        entryPrice: Number(row.entryPrice ?? row.entry ?? 0),
        currentPrice: Number(row.currentPrice ?? row.price ?? row.entryPrice ?? 0),
        stopLoss: Number(row.stopLoss ?? row.sl ?? 0),
        takeProfit: Number(row.takeProfit ?? row.tp ?? 0),
        profitLoss: Number(row.profitLoss ?? row.profit ?? 0),
      } satisfies TerminalPositionSnapshot;
    })
    .filter((item): item is TerminalPositionSnapshot => Boolean(item));
}

function estimateProfitLoss(input: {
  side: 'buy' | 'sell';
  entryPrice: number;
  markPrice: number;
  volumeLots: number;
  point: number;
  symbol: string;
}): number {
  if (!input.entryPrice || !input.markPrice || !input.point) return 0;
  const points = input.side === 'buy'
    ? (input.markPrice - input.entryPrice) / input.point
    : (input.entryPrice - input.markPrice) / input.point;

  const normalized = input.symbol.toUpperCase();
  let pipValuePerLot = 10;
  if (normalized.startsWith('XAU')) pipValuePerLot = 1;
  if (normalized.startsWith('BTC')) pipValuePerLot = 1;
  if (['US30', 'NASDAQ100', 'NAS100', 'SP500'].includes(normalized)) pipValuePerLot = 1;

  const pips = points / (normalized.startsWith('XAU') ? 10 : normalized.length >= 6 ? 10 : 1);
  return pips * pipValuePerLot * Math.max(0.01, input.volumeLots);
}

function resolveMarkPrice(side: 'buy' | 'sell', bid: number, ask: number): number {
  if (side === 'buy') return bid > 0 ? bid : ask;
  return ask > 0 ? ask : bid;
}

function computeFavorablePoints(input: {
  side: 'buy' | 'sell';
  entryPrice: number;
  markPrice: number;
  point: number;
}): number {
  if (!input.point || !input.entryPrice || !input.markPrice) return 0;
  const raw = input.side === 'buy'
    ? (input.markPrice - input.entryPrice) / input.point
    : (input.entryPrice - input.markPrice) / input.point;
  return Math.max(0, raw);
}

function resolveRiskPoints(position: ExecutionOpenPosition, point: number): number {
  const entry = Number(position.entryPrice ?? 0);
  const stop = Number(position.stopLoss ?? 0);
  if (entry > 0 && stop > 0 && Math.abs(entry - stop) > point) {
    return Math.abs(entry - stop) / point;
  }
  return defaultRiskPoints(position.symbol ?? 'EURUSD');
}

async function fetchBridgeTerminals(): Promise<BridgeTerminal[]> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787'}/terminals`, {
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.terminals) ? payload.terminals as BridgeTerminal[] : [];
  } catch {
    return [];
  }
}

async function reconcileTerminalOpenPositions(
  terminals: BridgeTerminal[],
  positions: ExecutionOpenPosition[],
): Promise<number> {
  const { trackOpenPositionFromFill, markPositionClosed } = await import('./execution-open-positions');
  let reconciled = 0;

  for (const terminal of terminals) {
    const terminalId = String(terminal.terminalId ?? '').trim();
    if (!terminalId) continue;

    const snapshots = normalizeSnapshots(terminal.openPositionSnapshots);
    const trackedForTerminal = positions.filter((position) => position.terminalId === terminalId);
    const snapshotTickets = new Set(snapshots.map((snapshot) => snapshot.ticket));

    for (const snapshot of snapshots) {
      if (trackedForTerminal.some((position) => position.ticket === snapshot.ticket)) continue;
      await trackOpenPositionFromFill({
        terminalId,
        commandId: `heartbeat-sync-${snapshot.ticket}`,
        ticket: snapshot.ticket,
        symbol: snapshot.symbol,
        side: snapshot.side.toUpperCase(),
        volumeLots: snapshot.volumeLots,
        entryPrice: snapshot.entryPrice,
        stopLoss: snapshot.stopLoss || null,
        takeProfit: snapshot.takeProfit || null,
        metadata: { source: 'HEARTBEAT_RECONCILE' },
      });
      reconciled += 1;
    }

    for (const position of trackedForTerminal) {
      if (snapshotTickets.has(position.ticket)) continue;
      await markPositionClosed({ terminalId, ticket: position.ticket, partial: false });
      reconciled += 1;
    }
  }

  return reconciled;
}

export async function syncOpenPositionLiveMetrics(): Promise<{ updated: number; terminalSnapshots: number; reconciled: number }> {
  const terminals = await fetchBridgeTerminals();
  let positions = await listOpenPositions({ limit: 100 });
  const reconciled = await reconcileTerminalOpenPositions(terminals, positions);
  if (reconciled > 0) {
    positions = await listOpenPositions({ limit: 100 });
  }
  let updated = 0;
  let terminalSnapshots = 0;

  for (const position of positions) {
    const terminal = terminals.find((item) => String(item.terminalId ?? '') === position.terminalId);
    const snapshots = normalizeSnapshots(terminal?.openPositionSnapshots);
    const snapshot = snapshots.find((item) => item.ticket === position.ticket);
    const telemetry = symbolTelemetryMap(terminal ?? null);
    const symbol = String(position.symbol ?? snapshot?.symbol ?? 'EURUSD').toUpperCase();
    const telemetryRow = telemetry.get(symbol) ?? extractSymbolTelemetry(terminal).find((row) => row.symbol === symbol);
    const point = Number(telemetryRow?.point ?? 0.00001) || 0.00001;
    const side = String(position.side ?? snapshot?.side ?? 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';

    const markPrice = snapshot?.currentPrice
      ?? resolveMarkPrice(side, Number(telemetryRow?.bid ?? 0), Number(telemetryRow?.ask ?? 0));
    const entryPrice = Number(position.entryPrice ?? snapshot?.entryPrice ?? markPrice);
    const volumeLots = Number(position.volumeLots ?? snapshot?.volumeLots ?? 0.01);
    const profitLoss = snapshot
      ? snapshot.profitLoss
      : estimateProfitLoss({
        side,
        entryPrice,
        markPrice,
        volumeLots,
        point,
        symbol,
      });

    if (snapshot) terminalSnapshots += 1;

    const favorablePoints = computeFavorablePoints({ side, entryPrice, markPrice, point });
    const riskPoints = resolveRiskPoints(position, point);
    const rMultiple = riskPoints > 0 ? favorablePoints / riskPoints : 0;
    const metadata = mergePositionManagementMetadata(parsePositionManagementMetadata(position.metadata), {
      profitLoss,
      favorablePoints,
      rMultiple,
      nowIso: new Date().toISOString(),
    });

    await updatePositionLiveMetrics({
      id: position.id,
      currentPrice: markPrice,
      profitLoss,
      stopLoss: snapshot?.stopLoss || position.stopLoss,
      metadata,
    });
    updated += 1;
  }

  return { updated, terminalSnapshots, reconciled };
}
