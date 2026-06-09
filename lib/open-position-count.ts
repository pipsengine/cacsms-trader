/**
 * Resolves open position count from terminal heartbeat fields.
 * EA versions before 001.005 reported OrdersTotal (pending orders) in openOrders,
 * which is 0 when only market positions are open.
 */
export function resolveTerminalOpenPositionCount(input: {
  openPositions?: number | null;
  openOrders?: number | null;
  margin?: number | null;
  equity?: number | null;
  balance?: number | null;
}): number {
  const openPositions = Math.max(0, Number(input.openPositions ?? 0));
  const openOrders = Math.max(0, Number(input.openOrders ?? 0));
  if (openPositions > 0) return openPositions;
  if (openOrders > 0) return openOrders;

  const margin = Math.max(0, Number(input.margin ?? 0));
  if (margin <= 0) return 0;

  const equity = Number(input.equity ?? 0);
  const balance = Number(input.balance ?? 0);
  const unrealized = Math.abs(equity - balance);
  if (unrealized > 0.01 || margin > 0) {
    const marginPerPosition = Math.max(1.2, margin / Math.max(1, Math.round(unrealized / 3.5)));
    return Math.max(1, Math.min(50, Math.round(margin / marginPerPosition)));
  }

  return 0;
}
