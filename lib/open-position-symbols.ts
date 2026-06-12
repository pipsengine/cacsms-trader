import { getOpenPositionMetrics, listOpenPositions } from './execution-open-positions';
import { resolveTerminalOpenPositionCount } from './open-position-count';

type BridgeTerminal = {
  symbol?: string | null;
  openPositions?: number | null;
  openOrders?: number | null;
  margin?: number | null;
  equity?: number | null;
  balance?: number | null;
  openPositionSnapshots?: unknown;
};

function symbolsFromSnapshots(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const symbols: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const symbol = String((item as { symbol?: string }).symbol ?? '').toUpperCase().trim();
    if (symbol) symbols.push(symbol);
  }
  return symbols;
}

/** Distinct symbols with live open exposure (registry synced to terminal, then EA snapshots). */
export async function getOpenPositionSymbols(filter?: { terminalId?: string; accountNumber?: string }): Promise<string[]> {
  await getOpenPositionMetrics(filter).catch(() => null);

  const symbols = new Set<string>();

  try {
      const positions = await listOpenPositions({ ...filter, limit: 100 });
    for (const position of positions) {
      if (position.symbol) symbols.add(position.symbol.toUpperCase());
    }
  } catch {
    // registry may be unavailable on first run
  }

  if (symbols.size === 0) {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787'}/terminals`, {
        cache: 'no-store',
      });
      if (response.ok) {
        const payload = await response.json();
        const terminals = Array.isArray(payload.terminals) ? payload.terminals as BridgeTerminal[] : [];
        for (const terminal of terminals) {
          for (const symbol of symbolsFromSnapshots(terminal.openPositionSnapshots)) {
            symbols.add(symbol);
          }
        }
        if (symbols.size === 0) {
          for (const terminal of terminals) {
            const openCount = resolveTerminalOpenPositionCount({
              openPositions: terminal.openPositions,
              openOrders: terminal.openOrders,
              margin: terminal.margin,
              equity: terminal.equity,
              balance: terminal.balance,
            });
            if (openCount > 0 && terminal.symbol) {
              symbols.add(String(terminal.symbol).toUpperCase());
            }
          }
        }
      }
    } catch {
      // bridge unavailable
    }
  }

  return [...symbols];
}
