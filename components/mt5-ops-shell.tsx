'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Clock, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TraderSidebar } from '@/components/trader-sidebar';

type BridgeTerminal = {
  terminalId: string;
  computerName?: string;
  computerId?: string;
  accountNumber: string;
  brokerName: string;
  serverName: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  openOrders: number;
  status: 'connected' | 'degraded' | 'disconnected';
  heartbeatAgeMs: number;
  latencyMs: number;
  averageLatencyMs?: number;
  jitterMs?: number;
  ewmaLatencyMs?: number;
  stabilityScore?: number;
  missedSequenceCount?: number;
  sequence?: number;
  heartbeatIntervalSeconds?: number;
  receivedAt: string;
  mt5ServerTime: string;
  terminalTime?: string;
  nigeriaTime?: string;
  timeDriftMs?: number | null;
  terminalTimeDriftMs?: number | null;
  nigeriaTimeDriftMs?: number | null;
};

type BridgeEvent = {
  type: string;
  message: string;
  time: string;
};

type TerminalRegistrationView = {
  terminalId: string;
  computerId: string;
  computerName: string;
  accountNumber: string;
  brokerName: string;
  serverName: string;
  priority: number;
  vpsId: string;
  tags: string[];
  capabilities: string[];
  notes: string;
  registeredAt: string;
  updatedAt: string;
};

type AccountRouteView = {
  accountNumber: string;
  preferredTerminalIds: string[];
  failoverStrategy: 'priority' | 'stability';
  minStabilityScore: number;
  createdAt: string;
  updatedAt: string;
};

type VpsView = {
  vpsId: string;
  label: string;
  provider: string;
  region: string;
  ipAddress: string;
  status: 'online' | 'offline' | 'degraded' | 'unknown';
  notes: string;
  registeredAt: string;
  updatedAt: string;
};

type CommandAckView = {
  commandId: string;
  terminalId: string;
  status: string;
  ticket?: string;
  brokerMessage?: string;
  executedPrice?: number | null;
  executedVolumeLots?: number | null;
  latencyMs: number;
  receivedAt: string;
};

type BridgeCommandView = {
  commandId: string;
  terminalId: string;
  type: string;
  payload: unknown;
  createdAt: string;
  expiresAt: string;
  status: string;
  attempt: number;
  leasedAt: string;
  leasedUntil: string;
  lastDispatchedAt: string;
  lastAckAt: string;
  ack: CommandAckView | null;
  error: string;
};

type TerminalOperationsPayload = {
  ok: boolean;
  bridgeOnline?: boolean;
  terminals: BridgeTerminal[];
  registrations?: TerminalRegistrationView[];
  routing?: AccountRouteView[];
  vps?: VpsView[];
  commands?: {
    summary: CommandSummary;
    commands: BridgeCommandView[];
    recentAcks: CommandAckView[];
  };
  events: BridgeEvent[];
};

type CommandSummary = {
  total: number;
  queued: number;
  leased: number;
  acknowledged: number;
  expired: number;
  dead: number;
  recentAcks: CommandAckView[];
};

export type Mt5OpsState = {
  bridgeOnline: boolean;
  lastError: string;
  terminals: BridgeTerminal[];
  registrations: TerminalRegistrationView[];
  routing: AccountRouteView[];
  vps: VpsView[];
  commands: BridgeCommandView[];
  recentAcks: CommandAckView[];
  commandSummary: CommandSummary | null;
  events: BridgeEvent[];
  refreshedAt: string;
};

const Mt5OpsStateContext = createContext<Mt5OpsState | null>(null);

export function useMt5OpsState(): Mt5OpsState {
  const state = useContext(Mt5OpsStateContext);
  if (!state) {
    throw new Error('useMt5OpsState must be used inside Mt5OpsShell');
  }
  return state;
}

export function Mt5OpsShell(props: {
  title: string;
  subtitle: string;
  children: ReactNode | ((state: Mt5OpsState) => ReactNode);
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [ngaTime, setNgaTime] = useState<string>('');
  const [state, setState] = useState<Mt5OpsState>({
    bridgeOnline: false,
    lastError: '',
    terminals: [],
    registrations: [],
    routing: [],
    vps: [],
    commands: [],
    recentAcks: [],
    commandSummary: null,
    events: [],
    refreshedAt: '',
  });

  useEffect(() => {
    const updateTime = () => {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      setNgaTime(formatter.format(new Date()));
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch('/api/mt5/terminal-operations', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Bridge returned HTTP ${response.status}`);
        }

        const payload = (await response.json()) as TerminalOperationsPayload;
        if (cancelled) return;

        setState({
          bridgeOnline: payload.bridgeOnline ?? true,
          lastError: '',
          terminals: payload.terminals ?? [],
          registrations: payload.registrations ?? [],
          routing: payload.routing ?? [],
          vps: payload.vps ?? [],
          commands: payload.commands?.commands ?? [],
          recentAcks: payload.commands?.recentAcks ?? [],
          commandSummary: payload.commands?.summary ?? null,
          events: payload.events ?? [],
          refreshedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          bridgeOnline: false,
          lastError: error instanceof Error ? error.message : 'MT5 bridge unavailable',
          refreshedAt: new Date().toISOString(),
        }));
      }
    };

    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const headline = useMemo(() => {
    return state.bridgeOnline ? props.subtitle : `Bridge offline${state.lastError ? `: ${state.lastError}` : ''}`;
  }, [props.subtitle, state.bridgeOnline, state.lastError]);

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-900 font-sans">
      <TraderSidebar
        bridgeOnline={state.bridgeOnline}
        mobileOpen={mobileSidebarOpen}
        onMobileOpenChange={setMobileSidebarOpen}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex items-center justify-between px-4 py-3 md:px-6 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="Open navigation"
              className="grid h-10 w-10 place-items-center rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-700 lg:hidden"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-950">{props.title}</h2>
              <p className="text-xs text-indigo-700 font-mono">{headline}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-50 border border-slate-200 shadow-xs">
              <Clock className="w-4 h-4 text-slate-500" />
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 leading-none uppercase tracking-wider">Nigeria (WAT)</span>
                <span className="text-sm font-mono tracking-widest text-slate-700">{ngaTime}</span>
              </div>
            </div>

            <div className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md border shadow-xs",
              state.bridgeOnline ? "bg-teal-50 border-teal-200 text-teal-800" : "bg-rose-50 border-rose-200 text-rose-700",
            )}>
              <div className={cn("w-2 h-2 rounded-full", state.bridgeOnline ? "bg-teal-500 animate-pulse" : "bg-rose-500")} />
              <span className="hidden md:inline text-xs font-semibold tracking-wide">{state.bridgeOnline ? "BRIDGE ONLINE" : "BRIDGE OFFLINE"}</span>
            </div>
          </div>
        </header>

        <Mt5OpsStateContext.Provider value={state}>
          <div className="flex-1 overflow-auto bg-white p-4 md:p-6 lg:p-8 space-y-6">
            {typeof props.children === 'function' ? props.children(state) : props.children}
          </div>
        </Mt5OpsStateContext.Provider>
      </div>
    </div>
  );
}
