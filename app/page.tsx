'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart2, CheckCircle2, Clock, Network, Radio, Server, ShieldAlert, Target, TerminalSquare, Zap } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
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
      time: new Date().toISOString(),
    }];
  }, [bridgeOnline, events, lastBridgeError]);

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-gray-100 font-sans overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-black/50 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex bg-blue-600/20 p-2 rounded-lg border border-blue-500/30">
            <Zap className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">Cacsms Trader</h1>
            <p className="text-xs text-blue-400 font-mono">Broker Demo Account Readiness</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-white/5 border border-white/10">
            <Clock className="w-4 h-4 text-gray-400" />
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-500 leading-none uppercase tracking-wider">Nigeria (WAT)</span>
              <span className="text-sm font-mono tracking-widest text-gray-200">{ngaTime}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-300">
            <div className="w-2 h-2 rounded-full bg-blue-300" />
            <span className="text-xs font-semibold tracking-wide">DEMO ACCOUNT MODE</span>
          </div>

          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded border",
            bridgeOnline ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "bg-red-500/10 border-red-500/20 text-red-300"
          )}>
            <div className={cn("w-2 h-2 rounded-full", bridgeOnline ? "bg-emerald-300 animate-pulse" : "bg-red-300")} />
            <span className="text-xs font-semibold tracking-wide">{bridgeOnline ? "BRIDGE ONLINE" : "BRIDGE OFFLINE"}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-6 lg:p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-[#111111] border-white/10 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-gray-400 font-normal uppercase tracking-wider flex items-center gap-2">
                <Target className="w-3 h-3" /> Demo Equity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-mono text-white">
                {connectedTerminals.length > 0 ? formatMoney(totalEquity) : "No terminal"}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {primaryTerminal ? `${primaryTerminal.brokerName} / ${primaryTerminal.accountNumber}` : "Attach the EA to a broker demo account."}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-[#111111] border-white/10 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-gray-400 font-normal uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-3 h-3" /> Daily Drawdown Guard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between mb-2">
                <span className="text-2xl font-mono text-white">0.0% <span className="text-sm text-gray-500">/ 4.0%</span></span>
              </div>
              <Progress value={0} className="h-1 bg-white/10" />
              <p className="text-[10px] text-gray-500 mt-2 font-mono">NO ORDER ROUTING UNTIL RISK GATE IS ACTIVE</p>
            </CardContent>
          </Card>

          <Card className="bg-[#111111] border-white/10 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-gray-400 font-normal uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-3 h-3" /> Bridge State
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-mono text-white">{bridgeOnline ? "Ready" : "Offline"}</div>
              <p className="text-xs text-gray-500 mt-2 truncate">{bridgeUrl}</p>
            </CardContent>
          </Card>

          <Card className="bg-[#111111] border-white/10 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-gray-400 font-normal uppercase tracking-wider flex items-center gap-2">
                <BarChart2 className="w-3 h-3" /> Open Orders
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-mono text-white">{totalOpenOrders}</div>
              <p className="text-xs text-gray-500 mt-2">Reported by connected demo terminals.</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 bg-[#111111] border-white/10 shadow-none flex flex-col">
            <Tabs defaultValue="accounts" className="flex flex-col flex-1">
              <CardHeader className="border-b border-white/5 py-4 shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TerminalSquare className="w-4 h-4 text-blue-400" /> Demo Account Operations
                  </CardTitle>
                  <TabsList className="bg-black/50 border border-white/10 h-8">
                    <TabsTrigger value="accounts" className="text-xs data-[state=active]:bg-blue-600">Accounts</TabsTrigger>
                    <TabsTrigger value="orders" className="text-xs data-[state=active]:bg-blue-600">Orders</TabsTrigger>
                  </TabsList>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 relative min-h-[300px]">
                <TabsContent value="accounts" className="m-0 border-none p-0 outline-none h-full absolute inset-0">
                  <ScrollArea className="h-full">
                    <Table>
                      <TableHeader className="bg-white/5 sticky top-0 backdrop-blur-sm z-10">
                        <TableRow className="border-white/10 hover:bg-transparent">
                          <TableHead className="text-xs font-mono text-gray-400">Terminal</TableHead>
                          <TableHead className="text-xs font-mono text-gray-400">Broker</TableHead>
                          <TableHead className="text-xs font-mono text-gray-400 text-right">Balance</TableHead>
                          <TableHead className="text-xs font-mono text-gray-400 text-right">Equity</TableHead>
                          <TableHead className="text-xs font-mono text-gray-400 text-right">Free Margin</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {terminals.length === 0 ? (
                          <TableRow className="border-white/5 hover:bg-transparent">
                            <TableCell colSpan={5} className="h-40 text-center text-sm text-gray-500">
                              Waiting for a broker demo account heartbeat from MT5.
                            </TableCell>
                          </TableRow>
                        ) : terminals.map((terminal) => (
                          <TableRow key={terminal.terminalId} className="border-white/5 hover:bg-white/5">
                            <TableCell className="font-mono text-xs text-gray-300">{terminal.terminalId}</TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-semibold text-white">{terminal.brokerName || "Unknown broker"}</span>
                                <span className="text-xs text-gray-500">{terminal.serverName} / {terminal.accountNumber}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-gray-300">{formatMoney(terminal.balance)}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-gray-300">{formatMoney(terminal.equity)}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-gray-300">{formatMoney(terminal.freeMargin)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="orders" className="m-0 border-none p-0 outline-none h-full absolute inset-0">
                  <div className="h-full flex items-center justify-center px-6 text-center text-sm text-gray-500">
                    Live order routing is intentionally disabled until the risk gate, command queue, and execution acknowledgment loop are complete.
                  </div>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>

          <Card className="bg-[#111111] border-white/10 shadow-none">
            <CardHeader className="border-b border-white/5 py-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-400" /> Market Scanner
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[300px] flex items-center justify-center px-6 text-center text-sm text-gray-500">
              Market scanning will activate after demo MT5 market data and risk-gated strategy services are connected.
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-[#111111] border-white/10 shadow-none">
            <CardHeader className="border-b border-white/5 py-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Network className="w-4 h-4 text-violet-400" /> Multi-Terminal Manager
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid gap-3">
                {terminals.length === 0 ? (
                  <div className="p-4 rounded-lg border border-white/5 bg-black/20 text-sm text-gray-500">
                    No MT5 demo terminal registered yet.
                  </div>
                ) : terminals.map((terminal) => (
                  <div key={terminal.terminalId} className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-black/20">
                    <div className="flex items-center gap-3">
                      {terminal.status === 'connected' ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                      )}
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-white">{terminal.terminalId}</span>
                        <span className="text-xs text-gray-500">{terminal.brokerName || "Unknown broker"}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className={cn("text-xs font-mono", terminal.status === 'connected' ? "text-emerald-400" : "text-red-400")}>
                        {terminal.status === 'connected' ? `${Math.round(terminal.heartbeatAgeMs)}ms heartbeat age` : 'DISCONNECTED'}
                      </span>
                      <span className="text-xs font-mono text-gray-400">{formatMoney(terminal.balance)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#111111] border-white/10 shadow-none font-mono">
            <CardHeader className="border-b border-white/5 py-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Server className="w-4 h-4 text-gray-400" /> Bridge Logs
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[200px]">
                <div className="flex flex-col">
                  {dashboardEvents.map((event, idx) => (
                    <div key={`${event.time}-${idx}`} className="flex gap-4 p-2 px-4 text-xs border-b border-white/5 hover:bg-white/5">
                      <span className="text-gray-500 shrink-0">{formatTime(event.time)}</span>
                      <span className={cn(
                        "w-20 shrink-0 font-bold",
                        event.type === 'HEARTBEAT' ? 'text-emerald-400' :
                        event.type === 'ERROR' || event.type === 'WARN' ? 'text-red-400' :
                        'text-blue-400'
                      )}>{event.type}</span>
                      <span className="text-gray-300">{event.message}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
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
