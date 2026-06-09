import { listOpenPositions } from './execution-open-positions';
import { resolveTerminalOpenPositionCount } from './open-position-count';

type BridgeTerminal = {
  symbol?: string | null;
  openPositions?: number | null;
  openOrders?: number | null;
  margin?: number | null;
  equity?: number | null;
  balance?: number | null;
};

/** Distinct symbols with open exposure (DB registry, then recent fills, then active chart symbol). */
export async function getOpenPositionSymbols(): Promise<string[]> {
  const symbols = new Set<string>();

  try {
    const positions = await listOpenPositions({ limit: 100 });
    for (const position of positions) {
      if (position.symbol) symbols.add(position.symbol.toUpperCase());
    }
  } catch {
    // registry may be empty on first run
  }

  if (symbols.size === 0) {
    try {
      const { queryPostgres } = await import('./postgres');
      const result = await queryPostgres(
        `
          SELECT DISTINCT upper(symbol) AS symbol
          FROM execution_commands
          WHERE lifecycle_state = 'EXECUTED'
            AND upper(replace(type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')
            AND symbol IS NOT NULL
            AND btrim(symbol) <> ''
            AND created_at >= now() - interval '3 days'
          ORDER BY symbol
        `,
      );
      for (const row of result.rows) {
        const symbol = String((row as { symbol?: string }).symbol ?? '').toUpperCase();
        if (symbol) symbols.add(symbol);
      }
    } catch {
      // fall through to bridge hint
    }
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
    } catch {
      // no bridge symbols available
    }
  }

  return [...symbols];
}
