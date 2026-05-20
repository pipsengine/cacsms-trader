import type { TerminalHealth } from "../../../packages/shared-types";
import { TerminalRegistry } from "./terminal-registry";

export interface TerminalRegistration {
  terminalId: string;
  computerId: string;
  accountNumber: string;
  brokerName: string;
  serverName: string;
  priority: number;
  registeredAt: string;
}

export class MultiTerminalMt5Manager {
  private readonly registrations = new Map<string, TerminalRegistration>();

  constructor(private readonly registry: TerminalRegistry) {}

  registerTerminal(registration: TerminalRegistration): void {
    this.registrations.set(registration.terminalId, registration);
  }

  listRegistrations(): TerminalRegistration[] {
    return Array.from(this.registrations.values()).sort((a, b) => a.priority - b.priority);
  }

  getTerminalHeartbeatStatus(now = new Date()): TerminalHealth[] {
    return this.registry.listTerminalHealth(now);
  }

  getTerminalHealthStatus(terminalId: string, now = new Date()): TerminalHealth {
    return this.registry.getTerminalHealth(terminalId, now);
  }

  listComputerSupport(): string[] {
    return Array.from(new Set(this.listRegistrations().map((registration) => registration.computerId)));
  }

  routeAccount(accountNumber: string, now = new Date()): TerminalRegistration | undefined {
    const healthByTerminal = new Map(this.registry.listTerminalHealth(now).map((health) => [health.terminalId, health]));
    return this.listRegistrations().find((registration) => {
      const health = healthByTerminal.get(registration.terminalId);
      return registration.accountNumber === accountNumber && health?.status === "connected";
    });
  }

  selectFailoverTerminal(accountNumber: string, failedTerminalId: string, now = new Date()): TerminalRegistration | undefined {
    const healthByTerminal = new Map(this.registry.listTerminalHealth(now).map((health) => [health.terminalId, health]));
    return this.listRegistrations().find((registration) => {
      const health = healthByTerminal.get(registration.terminalId);
      return registration.accountNumber === accountNumber
        && registration.terminalId !== failedTerminalId
        && health?.status === "connected";
    });
  }
}
