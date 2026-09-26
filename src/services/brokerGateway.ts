import { getMT5Snapshot, mt5PlaceQualifiedOrder } from '../features/mt5-connection/services/cacsmsMT5Runtime';
import { assertExecutionSafe } from '../features/mt5-connection/services/mt5ConnectionAdapter';

export type GatewayMode = 'SIMULATION' | 'PAPER' | 'LIVE';
export interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  size: number;
  sl: number;
  tp: number;
  clientOrderId: string;
  accountId?: string;
  riskPct?: number;
  entry?: number;
}
export interface OrderResult {
  accepted: boolean;
  brokerOrderId?: string;
  reason?: string;
  filledPrice?: number;
}

export class BrokerGateway {
  constructor(public mode: GatewayMode = 'SIMULATION') {}

  async validate() {
    const snap = getMT5Snapshot();
    const healthy = snap.accounts.some((a) => a.state === 'HEALTHY');
    return {
      connected: healthy,
      latencyMs: snap.health.feedLatencyMs,
      mode: this.mode,
      orderGateway: snap.health.orderGateway,
      heartbeat: snap.health.heartbeat,
    };
  }

  async placeOrder(o: OrderRequest): Promise<OrderResult> {
    if (this.mode === 'LIVE') {
      const snap = getMT5Snapshot();
      const account = snap.accounts.find((a) => a.accountClass === 'LIVE' && a.state === 'HEALTHY');
      if (!account) return { accepted: false, reason: 'No healthy LIVE MT5 account' };
      const gate = assertExecutionSafe(snap, account.id);
      if (!gate.ok) return { accepted: false, reason: gate.reason };
      return { accepted: false, reason: 'Live broker adapter bridge not configured — fail-closed' };
    }

    return mt5PlaceQualifiedOrder({
      accountId: o.accountId,
      symbol: o.symbol,
      side: o.side,
      size: o.size,
      sl: o.sl,
      tp: o.tp,
      clientOrderId: o.clientOrderId,
      riskPct: o.riskPct,
      entry: o.entry,
    });
  }

  async cancelOrder() {
    return true;
  }
}

export const brokerGateway = new BrokerGateway();
