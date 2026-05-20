'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart2, BrainCircuit, CheckCircle2, Clock, Gauge, LayoutDashboard, Network, Radio, Route, Server, Settings2, ShieldAlert, Target, TerminalSquare, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface BridgeTerminal {
  terminalId: string;
  accountNumber: string;
  brokerName: string;
  serverName: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  openOrders: number;
  status: "connected" | "disconnected";
  heartbeatAgeMs: number;
  latencyMs: number;
  receivedAt: string;
  mt5ServerTime: string;
}

interface BridgeEvent {
  type: string;
  message: string;
  time: string;
}

interface BridgePayload {
  terminals: BridgeTerminal[];
  events: BridgeEvent[];
}

const bridgeUrl = process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? "http://localhost:8787";

const sidebarSections = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Demo Accounts", icon: TerminalSquare },
  { label: "Risk Gate", icon: ShieldAlert },
  { label: "Market Scanner", icon: Radio },
  { label: "Strategies", icon: BrainCircuit },
  { label: "Order Router", icon: Route },
  { label: "Terminals", icon: Network },
  { label: "Analytics", icon: BarChart2 },
  { label: "Settings", icon: Settings2 },
];

export default function Dashboard() {
  const [ngaTime, setNgaTime] = useState<string>('');
  const [terminals, setTerminals] = useState<BridgeTerminal[]>([]);
  const [events, setEvents] = useState<BridgeEvent[]>([]);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [lastBridgeError, setLastBridgeError] = useState<string>('');

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
        const response = await fetch(`${bridgeUrl}/terminals`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Bridge returned HTTP ${response.status}`);
        }

        const payload = (await response.json()) as BridgePayload;
        if (!cancelled) {
          setTerminals(payload.terminals ?? []);
          setEvents(payload.events ?? []);
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

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-900 font-sans">
      <aside className="hidden lg:flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-200">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-700 text-white shadow-sm shadow-indigo-900/20">
            <Zap className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-slate-950">Cacsms Trader</h1>
            <p className="truncate text-xs font-medium text-slate-500">Autonomous Forex System</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4">
          <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Functions</div>
          <div className="space-y-1">
            {sidebarSections.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  key={item.label}
                  type="button"
                  className={cn(
                    "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors",
                    item.active
                      ? "bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-100"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                  )}
                >
                  <Icon className={cn("h-4 w-4", item.active ? "text-indigo-700" : "text-slate-400")} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className={cn(
            "flex items-center gap-3 rounded-lg border px-3 py-3",
            bridgeOnline ? "border-teal-200 bg-teal-50 text-teal-800" : "border-rose-200 bg-rose-50 text-rose-700"
          )}>
            <div className={cn("h-2.5 w-2.5 rounded-full", bridgeOnline ? "bg-teal-500" : "bg-rose-500")} />
            <div>
              <div className="text-xs font-semibold">{bridgeOnline ? "Bridge Online" : "Bridge Offline"}</div>
              <div className="text-[11px] opacity-75">MT5 connection status</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-white">
      <header className="flex items-center justify-between px-4 py-3 md:px-6 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex bg-indigo-50 p-2 rounded-lg border border-indigo-100 lg:hidden">
            <Zap className="h-5 w-5 text-indigo-700" />
          </div>
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
                          <TableHead className="text-xs font-mono text-slate-500 text-right">Balance</TableHead>
                          <TableHead className="text-xs font-mono text-slate-500 text-right">Equity</TableHead>
                          <TableHead className="text-xs font-mono text-slate-500 text-right">Free Margin</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {terminals.length === 0 ? (
                          <TableRow className="border-slate-100 hover:bg-transparent">
                            <TableCell colSpan={5} className="h-40 text-center text-sm text-slate-500">
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
                            <TableCell className="text-right font-mono text-xs text-slate-700">{formatMoney(terminal.balance)}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-slate-700">{formatMoney(terminal.equity)}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-slate-700">{formatMoney(terminal.freeMargin)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="orders" className="m-0 border-none p-0 outline-none h-full absolute inset-0">
                  <div className="h-full flex items-center justify-center px-6 text-center text-sm text-slate-500">
                    Live order routing is intentionally disabled until the risk gate, command queue, and execution acknowledgment loop are complete.
                  </div>
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
                        <AlertTriangle className="w-5 h-5 text-rose-600" />
                      )}
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-950">{terminal.terminalId}</span>
                        <span className="text-xs text-slate-500">{terminal.brokerName || "Unknown broker"}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className={cn("text-xs font-mono", terminal.status === 'connected' ? "text-teal-600" : "text-rose-600")}>
                        {terminal.status === 'connected' ? `${Math.round(terminal.heartbeatAgeMs)}ms heartbeat age` : 'DISCONNECTED'}
                      </span>
                      <span className="text-xs font-mono text-slate-500">{formatMoney(terminal.balance)}</span>
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
