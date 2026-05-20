import type { TerminalConnectionStatus, TerminalHeartbeat, TerminalHealth } from "../../../packages/shared-types";

export interface TerminalRegistryOptions {
  heartbeatTimeoutMs: number;
  degradedLatencyMs: number;
}

export class TerminalRegistry {
  private readonly heartbeats = new Map<string, TerminalHeartbeat>();

  constructor(private readonly options: TerminalRegistryOptions) {}

  upsertHeartbeat(heartbeat: TerminalHeartbeat): TerminalHealth {
    this.heartbeats.set(heartbeat.terminalId, heartbeat);
    return this.getTerminalHealth(heartbeat.terminalId, new Date(heartbeat.receivedAt));
  }

  getTerminalHealth(terminalId: string, now = new Date()): TerminalHealth {
    const heartbeat = this.heartbeats.get(terminalId);

    if (!heartbeat) {
      return {
        terminalId,
        status: "disconnected",
        latencyMs: 0,
        lastHeartbeatAt: "",
        heartbeatAgeMs: Number.POSITIVE_INFINITY,
        accountNumber: "",
        brokerName: "",
        serverName: "",
      };
    }

    const heartbeatAgeMs = Math.max(0, now.getTime() - new Date(heartbeat.receivedAt).getTime());

    return {
      terminalId,
      status: this.resolveStatus(heartbeat, heartbeatAgeMs),
      latencyMs: heartbeat.latencyMs,
      lastHeartbeatAt: heartbeat.receivedAt,
      heartbeatAgeMs,
      accountNumber: heartbeat.account.accountNumber,
      brokerName: heartbeat.account.brokerName,
      serverName: heartbeat.account.serverName,
    };
  }

  listTerminalHealth(now = new Date()): TerminalHealth[] {
    return Array.from(this.heartbeats.keys()).map((terminalId) => this.getTerminalHealth(terminalId, now));
  }

  private resolveStatus(heartbeat: TerminalHeartbeat, heartbeatAgeMs: number): TerminalConnectionStatus {
    if (heartbeatAgeMs > this.options.heartbeatTimeoutMs || heartbeat.connectionStatus === "disconnected") {
      return "disconnected";
    }

    if (heartbeat.latencyMs > this.options.degradedLatencyMs || heartbeat.connectionStatus === "degraded") {
      return "degraded";
    }

    return "connected";
  }
}
