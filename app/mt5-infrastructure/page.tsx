'use client';

import { Activity, AlertTriangle, CheckCircle2, Gauge, Server, TerminalSquare } from 'lucide-react';
import { useMt5OpsState } from '@/components/mt5-ops-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export default function Mt5InfrastructureOverviewPage() {
  const state = useMt5OpsState();
  const connected = state.terminals.filter((terminal) => terminal.status === 'connected');
  const degraded = state.terminals.filter((terminal) => terminal.status === 'degraded');
  const disconnected = state.terminals.filter((terminal) => terminal.status === 'disconnected');
  const avgLatency = connected.length
    ? Math.round(connected.reduce((sum, terminal) => sum + (terminal.averageLatencyMs ?? terminal.latencyMs ?? 0), 0) / connected.length)
    : 0;
  const lowestStability = connected.length
    ? Math.min(...connected.map((terminal) => terminal.stabilityScore ?? 0))
    : 0;
  const queued = state.commandSummary?.queued ?? 0;
  const inflight = state.commandSummary?.leased ?? 0;
  const acks = state.commandSummary?.acknowledged ?? 0;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
                    <TerminalSquare className="w-3 h-3 text-indigo-700" /> Terminals
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-mono text-slate-950">{state.terminals.length}</div>
                  <p className="text-xs text-slate-500 mt-2">
                    {connected.length} connected / {degraded.length} degraded / {disconnected.length} disconnected
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
                    <Gauge className="w-3 h-3 text-teal-600" /> Latency
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-mono text-slate-950">{avgLatency}ms</div>
                  <p className="text-xs text-slate-500 mt-2">Avg latency across connected terminals.</p>
                </CardContent>
              </Card>

              <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-3 h-3 text-violet-600" /> Stability
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-mono text-slate-950">{lowestStability}%</div>
                  <p className="text-xs text-slate-500 mt-2">Lowest stability score (connected).</p>
                </CardContent>
              </Card>

              <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
                    <Server className="w-3 h-3 text-slate-600" /> Command Queue
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-mono text-slate-950">{queued}</div>
                  <p className="text-xs text-slate-500 mt-2">{inflight} in-flight / {acks} acked</p>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
              <CardHeader className="border-b border-slate-200 py-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  {state.bridgeOnline ? (
                    <CheckCircle2 className="w-4 h-4 text-teal-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                  )}
                  Infrastructure Readiness
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid gap-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">Bridge connectivity</span>
                    <span className={cn("font-mono text-xs", state.bridgeOnline ? "text-teal-700" : "text-rose-700")}>
                      {state.bridgeOnline ? "ONLINE" : "OFFLINE"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">Connected terminals</span>
                    <span className="font-mono text-xs text-slate-700">{connected.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">Registrations</span>
                    <span className="font-mono text-xs text-slate-700">{state.registrations.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">Routing entries</span>
                    <span className="font-mono text-xs text-slate-700">{state.routing.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">VPS entries</span>
                    <span className="font-mono text-xs text-slate-700">{state.vps.length}</span>
                  </div>
                  <div className="pt-1">
                    <Progress value={Math.min(100, (state.bridgeOnline ? 30 : 0) + Math.min(40, connected.length * 10) + Math.min(30, state.registrations.length * 5))} className="h-2 bg-slate-100" />
                    <div className="mt-2 text-[11px] text-slate-500 font-mono">
                      Refreshed {state.refreshedAt ? new Date(state.refreshedAt).toLocaleTimeString('en-US', { hour12: false }) : '--:--:--'}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
    </>
  );
}
