'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart2, CheckCircle2, Clock, Gauge, Menu, Network, Radio, Server, ShieldAlert, Target, TerminalSquare } from 'lucide-react';
import { TraderSidebar } from "@/components/trader-sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface BridgeTerminal {
  terminalId: string;
  computerName?: string;
  accountNumber: string;
  brokerName: string;
  serverName: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  openOrders: number;
  status: "connected" | "degraded" | "disconnected";
  heartbeatAgeMs: number;
  latencyMs: number;
  averageLatencyMs?: number;
  jitterMs?: number;
  stabilityScore?: number;
  missedSequenceCount?: number;
  sequence?: number;
  heartbeatIntervalSeconds?: number;
  receivedAt: string;
  mt5ServerTime: string;
}

interface BridgeEvent {
  type: string;
  message: string;
  time: string;
}

interface TerminalRegistrationView {
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
}

interface AccountRouteView {
  accountNumber: string;
  preferredTerminalIds: string[];
  failoverStrategy: "priority" | "stability";
  minStabilityScore: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  selectedTerminalId?: string;
  selectedReason?: string;
  candidates?: Array<{
    terminalId: string;
    status: string;
    stabilityScore: number;
    latencyMs: number;
    priority: number;
    computerId: string;
  }>;
}

interface VpsView {
  vpsId: string;
  label: string;
  provider: string;
  region: string;
  ipAddress: string;
  status: "online" | "offline" | "degraded" | "unknown";
  notes: string;
  registeredAt: string;
  updatedAt: string;
}

interface CommandAckView {
  commandId: string;
  terminalId: string;
  status: string;
  ticket?: string;
  brokerMessage?: string;
  executedPrice?: number | null;
  executedVolumeLots?: number | null;
  latencyMs: number;
  receivedAt: string;
}

interface CommandSummaryView {
  total: number;
  queued: number;
  leased: number;
  acknowledged: number;
  expired: number;
  dead: number;
  recentAcks: CommandAckView[];
}

interface BridgeCommandView {
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
}

interface TerminalOperationsPayload {
  ok: boolean;
  terminals: BridgeTerminal[];
  events: BridgeEvent[];
  registrations?: TerminalRegistrationView[];
  routing?: AccountRouteView[];
  vps?: VpsView[];
  commands?: {
    summary: CommandSummaryView;
    commands: BridgeCommandView[];
    recentAcks: CommandAckView[];
  };
}

const bridgeUrl = process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? "http://localhost:8787";

export default function Dashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [ngaTime, setNgaTime] = useState<string>('');
  const [terminals, setTerminals] = useState<BridgeTerminal[]>([]);
  const [events, setEvents] = useState<BridgeEvent[]>([]);
  const [registrations, setRegistrations] = useState<TerminalRegistrationView[]>([]);
  const [routes, setRoutes] = useState<AccountRouteView[]>([]);
  const [vps, setVps] = useState<VpsView[]>([]);
  const [commands, setCommands] = useState<BridgeCommandView[]>([]);
  const [recentAcks, setRecentAcks] = useState<CommandAckView[]>([]);
  const [commandSummary, setCommandSummary] = useState<CommandSummaryView | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [lastBridgeError, setLastBridgeError] = useState<string>('');
  const [enqueueState, setEnqueueState] = useState<{ status: "idle" | "submitting" | "ok" | "error"; message: string }>({
    status: "idle",
    message: "",
  });
  const [enqueueForm, setEnqueueForm] = useState({
    terminalId: "",
    symbol: "XAUUSD",
    side: "buy" as "buy" | "sell",
    volumeLots: "0.01",
    stopLoss: "0",
    takeProfit: "0",
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

    const loadBridgeState = async () => {
      try {
        const response = await fetch(`/api/mt5/terminal-operations`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Bridge returned HTTP ${response.status}`);
        }

        const payload = (await response.json()) as TerminalOperationsPayload;
        if (!cancelled) {
          setTerminals(payload.terminals ?? []);
          setEvents(payload.events ?? []);
          setRegistrations(payload.registrations ?? []);
          setRoutes(payload.routing ?? []);
          setVps(payload.vps ?? []);
          setCommands(payload.commands?.commands ?? []);
          setRecentAcks(payload.commands?.recentAcks ?? []);
          setCommandSummary(payload.commands?.summary ?? null);
          setBridgeOnline(true);
          setLastBridgeError('');
        }
      } catch (error) {
        if (!cancelled) {
          setBridgeOnline(false);
          setLastBridgeError(error instanceof Error ? error.message : 'MT5 bridge unavailable');
        }
      }
    };

    loadBridgeState();
    const interval = setInterval(loadBridgeState, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const connectedTerminals = terminals.filter((terminal) => terminal.status === "connected");
  const primaryTerminal = connectedTerminals[0] ?? terminals[0];
  const totalEquity = connectedTerminals.reduce((sum, terminal) => sum + terminal.equity, 0);
  const totalOpenOrders = connectedTerminals.reduce((sum, terminal) => sum + terminal.openOrders, 0);

  const dashboardEvents = useMemo(() => {
    if (events.length > 0) {
      return events;
    }

    return [{
      type: bridgeOnline ? "INFO" : "WARN",
      message: bridgeOnline
        ? "MT5 bridge is running. Waiting for demo account terminal heartbeat."
        : `MT5 bridge is not reachable at ${bridgeUrl}${lastBridgeError ? `: ${lastBridgeError}` : ''}`,
      time: "",
    }];
  }, [bridgeOnline, events, lastBridgeError]);

  const selectedEnqueueTerminalId = enqueueForm.terminalId || connectedTerminals[0]?.terminalId || "";

  const enqueuePlaceOrder = async () => {
    setEnqueueState({ status: "submitting", message: "" });
    try {
      const terminalId = selectedEnqueueTerminalId.trim();
      if (!terminalId) {
        throw new Error("Select a terminal.");
      }

      const volumeLots = Number(enqueueForm.volumeLots);
      const stopLoss = Number(enqueueForm.stopLoss);
      const takeProfit = Number(enqueueForm.takeProfit);
      if (!Number.isFinite(volumeLots) || volumeLots <= 0) {
        throw new Error("Volume must be a positive number.");
      }
      if (!Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)) {
        throw new Error("SL/TP must be numeric values.");
      }

      const commandId = `${terminalId}-${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();

      const response = await fetch("/api/mt5/commands/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId,
          terminalId,
          type: "place_order",
          createdAt,
          expiresAt,
          payload: {
            symbol: enqueueForm.symbol.trim(),
            side: enqueueForm.side,
            orderKind: "market",
            volumeLots,
            stopLoss,
            takeProfit,
          },
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Enqueue failed with HTTP ${response.status}`);
      }
      setEnqueueState({ status: "ok", message: "Command enqueued." });
    } catch (error) {
      setEnqueueState({ status: "error", message: error instanceof Error ? error.message : "Failed to enqueue command." });
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-900 font-sans">
      <TraderSidebar
        bridgeOnline={bridgeOnline}
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
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">Trading Operations</h2>
            <p className="text-xs text-indigo-700 font-mono">Broker Demo Account Readiness</p>
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

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-indigo-50 border border-indigo-100 text-indigo-800 shadow-xs">
            <Gauge className="w-4 h-4" />
            <span className="hidden md:inline text-xs font-semibold tracking-wide">DEMO ACCOUNT MODE</span>
          </div>

          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-md border shadow-xs",
            bridgeOnline ? "bg-teal-50 border-teal-200 text-teal-800" : "bg-rose-50 border-rose-200 text-rose-700"
          )}>
            <div className={cn("w-2 h-2 rounded-full", bridgeOnline ? "bg-teal-500 animate-pulse" : "bg-rose-500")} />
            <span className="hidden md:inline text-xs font-semibold tracking-wide">{bridgeOnline ? "BRIDGE ONLINE" : "BRIDGE OFFLINE"}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto bg-white p-4 md:p-6 lg:p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
                <Target className="w-3 h-3 text-indigo-700" /> Demo Equity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-mono text-slate-950">
                {connectedTerminals.length > 0 ? formatMoney(totalEquity) : "No terminal"}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                {primaryTerminal ? `${primaryTerminal.brokerName} / ${primaryTerminal.accountNumber}` : "Attach the EA to a broker demo account."}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-3 h-3 text-amber-600" /> Daily Drawdown Guard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between mb-2">
                <span className="text-2xl font-mono text-slate-950">0.0% <span className="text-sm text-slate-500">/ 4.0%</span></span>
              </div>
              <Progress value={0} className="h-1 bg-amber-100" />
              <p className="text-[10px] text-slate-500 mt-2 font-mono">NO ORDER ROUTING UNTIL RISK GATE IS ACTIVE</p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-3 h-3 text-teal-600" /> Bridge State
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-mono text-slate-950">{bridgeOnline ? "Ready" : "Offline"}</div>
              <p className="text-xs text-slate-500 mt-2 truncate">{bridgeUrl}</p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
                <BarChart2 className="w-3 h-3 text-violet-600" /> Open Orders
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-mono text-slate-950">{totalOpenOrders}</div>
              <p className="text-xs text-slate-500 mt-2">Reported by connected demo terminals.</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 bg-white border-slate-200 shadow-sm shadow-slate-900/5 flex flex-col">
            <Tabs defaultValue="accounts" className="flex flex-col flex-1">
              <CardHeader className="border-b border-slate-200 py-4 shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TerminalSquare className="w-4 h-4 text-indigo-700" /> Demo Account Operations
                  </CardTitle>
                  <TabsList className="bg-slate-100 border border-slate-200 h-8">
                    <TabsTrigger value="accounts" className="text-xs data-[state=active]:bg-white data-[state=active]:text-indigo-800">Accounts</TabsTrigger>
                    <TabsTrigger value="orders" className="text-xs data-[state=active]:bg-white data-[state=active]:text-indigo-800">Orders</TabsTrigger>
                  </TabsList>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 relative min-h-[300px]">
                <TabsContent value="accounts" className="m-0 border-none p-0 outline-none h-full absolute inset-0">
                  <ScrollArea className="h-full">
                    <Table>
                      <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                        <TableRow className="border-slate-200 hover:bg-transparent">
                          <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                          <TableHead className="text-xs font-mono text-slate-500">Broker</TableHead>
                          <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                          <TableHead className="text-xs font-mono text-slate-500 text-right">Latency</TableHead>
                          <TableHead className="text-xs font-mono text-slate-500 text-right">Equity</TableHead>
                          <TableHead className="text-xs font-mono text-slate-500 text-right">Free Margin</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {terminals.length === 0 ? (
                          <TableRow className="border-slate-100 hover:bg-transparent">
                            <TableCell colSpan={6} className="h-40 text-center text-sm text-slate-500">
                              Waiting for a broker demo account heartbeat from MT5.
                            </TableCell>
                          </TableRow>
                        ) : terminals.map((terminal) => (
                          <TableRow key={terminal.terminalId} className="border-slate-100 hover:bg-slate-50">
                            <TableCell className="font-mono text-xs text-slate-700">{terminal.terminalId}</TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-semibold text-slate-950">{terminal.brokerName || "Unknown broker"}</span>
                                <span className="text-xs text-slate-500">{terminal.serverName} / {terminal.accountNumber}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className={cn(
                                "inline-flex rounded-md border px-2 py-1 text-[11px] font-semibold capitalize",
                                terminal.status === "connected" && "border-teal-200 bg-teal-50 text-teal-700",
                                terminal.status === "degraded" && "border-amber-200 bg-amber-50 text-amber-700",
                                terminal.status === "disconnected" && "border-rose-200 bg-rose-50 text-rose-700",
                              )}>
                                {terminal.status}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.latencyMs}ms</TableCell>
                            <TableCell className="text-right font-mono text-xs text-slate-700">{formatMoney(terminal.equity)}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-slate-700">{formatMoney(terminal.freeMargin)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="orders" className="m-0 border-none p-0 outline-none h-full absolute inset-0">
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Card className="border-slate-200 shadow-none">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider">Queued</CardTitle>
                          </CardHeader>
                          <CardContent className="text-2xl font-mono text-slate-950">
                            {commandSummary?.queued ?? 0}
                          </CardContent>
                        </Card>
                        <Card className="border-slate-200 shadow-none">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider">In Flight</CardTitle>
                          </CardHeader>
                          <CardContent className="text-2xl font-mono text-slate-950">
                            {commandSummary?.leased ?? 0}
                          </CardContent>
                        </Card>
                        <Card className="border-slate-200 shadow-none">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider">Acknowledged</CardTitle>
                          </CardHeader>
                          <CardContent className="text-2xl font-mono text-slate-950">
                            {commandSummary?.acknowledged ?? 0}
                          </CardContent>
                        </Card>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-slate-950">Enqueue Demo Order</div>
                          <div className={cn(
                            "text-xs font-mono",
                            enqueueState.status === "ok" && "text-teal-700",
                            enqueueState.status === "error" && "text-rose-700",
                            enqueueState.status === "submitting" && "text-slate-500",
                          )}>
                            {enqueueState.message}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 text-sm">
                          <select
                            className="md:col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                            value={selectedEnqueueTerminalId}
                            onChange={(e) => setEnqueueForm((current) => ({ ...current, terminalId: e.target.value }))}
                          >
                            <option value="">Select terminal</option>
                            {connectedTerminals.map((terminal) => (
                              <option key={terminal.terminalId} value={terminal.terminalId}>{terminal.terminalId}</option>
                            ))}
                          </select>
                          <input
                            className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                            value={enqueueForm.symbol}
                            onChange={(e) => setEnqueueForm((current) => ({ ...current, symbol: e.target.value }))}
                          />
                          <select
                            className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                            value={enqueueForm.side}
                            onChange={(e) => setEnqueueForm((current) => ({ ...current, side: e.target.value as "buy" | "sell" }))}
                          >
                            <option value="buy">buy</option>
                            <option value="sell">sell</option>
                          </select>
                          <input
                            className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                            value={enqueueForm.volumeLots}
                            onChange={(e) => setEnqueueForm((current) => ({ ...current, volumeLots: e.target.value }))}
                          />
                          <button
                            type="button"
                            className={cn(
                              "h-9 rounded-md border px-3 text-xs font-semibold",
                              enqueueState.status === "submitting"
                                ? "border-slate-200 bg-slate-100 text-slate-400"
                                : "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100",
                            )}
                            disabled={enqueueState.status === "submitting"}
                            onClick={enqueuePlaceOrder}
                          >
                            Enqueue
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="w-16 text-slate-500 font-mono">SL</span>
                            <input
                              className="h-9 flex-1 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                              value={enqueueForm.stopLoss}
                              onChange={(e) => setEnqueueForm((current) => ({ ...current, stopLoss: e.target.value }))}
                            />
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="w-16 text-slate-500 font-mono">TP</span>
                            <input
                              className="h-9 flex-1 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                              value={enqueueForm.takeProfit}
                              onChange={(e) => setEnqueueForm((current) => ({ ...current, takeProfit: e.target.value }))}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                          <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-950">Recent Acknowledgements</div>
                          <Table>
                            <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                              <TableRow className="border-slate-200 hover:bg-transparent">
                                <TableHead className="text-xs font-mono text-slate-500">Time</TableHead>
                                <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                                <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                                <TableHead className="text-xs font-mono text-slate-500">Ticket</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {recentAcks.length === 0 ? (
                                <TableRow className="border-slate-100 hover:bg-transparent">
                                  <TableCell colSpan={4} className="h-28 text-center text-sm text-slate-500">
                                    No acknowledgements yet.
                                  </TableCell>
                                </TableRow>
                              ) : recentAcks.slice(0, 15).map((ack) => (
                                <TableRow key={ack.commandId} className="border-slate-100 hover:bg-slate-50">
                                  <TableCell className="font-mono text-xs text-slate-700">{formatTime(ack.receivedAt)}</TableCell>
                                  <TableCell className="font-mono text-xs text-slate-700">{ack.terminalId}</TableCell>
                                  <TableCell className="font-mono text-xs text-slate-700">{ack.status}</TableCell>
                                  <TableCell className="font-mono text-xs text-slate-700">{ack.ticket ?? ""}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                          <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-950">Command Queue</div>
                          <Table>
                            <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                              <TableRow className="border-slate-200 hover:bg-transparent">
                                <TableHead className="text-xs font-mono text-slate-500">Created</TableHead>
                                <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                                <TableHead className="text-xs font-mono text-slate-500">Type</TableHead>
                                <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {commands.length === 0 ? (
                                <TableRow className="border-slate-100 hover:bg-transparent">
                                  <TableCell colSpan={4} className="h-28 text-center text-sm text-slate-500">
                                    No commands enqueued yet.
                                  </TableCell>
                                </TableRow>
                              ) : commands.slice(0, 20).map((command) => (
                                <TableRow key={command.commandId} className="border-slate-100 hover:bg-slate-50">
                                  <TableCell className="font-mono text-xs text-slate-700">{formatTime(command.createdAt)}</TableCell>
                                  <TableCell className="font-mono text-xs text-slate-700">{command.terminalId}</TableCell>
                                  <TableCell className="font-mono text-xs text-slate-700">{command.type}</TableCell>
                                  <TableCell className="font-mono text-xs text-slate-700">{command.status} / {command.attempt}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </div>
                  </ScrollArea>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 py-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Radio className="w-4 h-4 text-teal-600" /> Market Scanner
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[300px] flex items-center justify-center px-6 text-center text-sm text-slate-500">
              Market scanning will activate after demo MT5 market data and risk-gated strategy services are connected.
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 py-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Network className="w-4 h-4 text-violet-600" /> Multi-Terminal Manager
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid gap-3">
                {terminals.length === 0 ? (
                  <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">
                    No MT5 demo terminal registered yet.
                  </div>
                ) : terminals.map((terminal) => (
                  <div key={terminal.terminalId} className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white">
                    <div className="flex items-center gap-3">
                      {terminal.status === 'connected' ? (
                        <CheckCircle2 className="w-5 h-5 text-teal-600" />
                      ) : (
                        <AlertTriangle className={cn("w-5 h-5", terminal.status === "degraded" ? "text-amber-600" : "text-rose-600")} />
                      )}
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-950">{terminal.terminalId}</span>
                        <span className="text-xs text-slate-500">
                          {terminal.brokerName || "Unknown broker"}{terminal.computerName ? ` / ${terminal.computerName}` : ""}{terminal.accountNumber ? ` / ${terminal.accountNumber}` : ""}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className={cn(
                        "text-xs font-mono",
                        terminal.status === "connected" && "text-teal-600",
                        terminal.status === "degraded" && "text-amber-600",
                        terminal.status === "disconnected" && "text-rose-600",
                      )}>
                        {terminal.status === "disconnected" ? "DISCONNECTED" : `${Math.round(terminal.heartbeatAgeMs)}ms age / ${terminal.latencyMs}ms latency`}
                      </span>
                      <span className="text-xs font-mono text-slate-500">
                        Stability {terminal.stabilityScore ?? 0}% / Seq {terminal.sequence ?? 0}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5 font-mono">
            <CardHeader className="border-b border-slate-200 py-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Server className="w-4 h-4 text-slate-500" /> Bridge Logs
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="px-4 py-2 text-[11px] text-slate-500 border-b border-slate-100 bg-slate-50 flex justify-between">
                <span>Registrations {registrations.length} / Routing {routes.length} / VPS {vps.length}</span>
                <span>Commands {commandSummary?.total ?? 0}</span>
              </div>
              <ScrollArea className="h-[200px]">
                <div className="flex flex-col">
                  {dashboardEvents.map((event, idx) => (
                    <div key={`${event.time}-${idx}`} className="flex gap-4 p-2 px-4 text-xs border-b border-slate-100 hover:bg-slate-50">
                      <span className="text-slate-500 shrink-0">{formatTime(event.time)}</span>
                      <span className={cn(
                        "w-20 shrink-0 font-bold",
                        event.type === 'HEARTBEAT' ? 'text-teal-600' :
                        event.type === 'ERROR' || event.type === 'WARN' ? 'text-rose-600' :
                        'text-indigo-700'
                      )}>{event.type}</span>
                      <span className="text-slate-700">{event.message}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </div>
  );
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
