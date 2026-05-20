'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Gauge, Globe2, Laptop2, Network, PlugZap, Router, Server, ShieldAlert, TerminalSquare, Wrench } from 'lucide-react';
import { Mt5OpsShell } from '@/components/mt5-ops-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type EnqueueState = { status: 'idle' | 'submitting' | 'ok' | 'error'; message: string };

export function TerminalOperationsClientPage(props: { page: string }) {
  const page = props.page;
  const meta = resolveMeta(page);

  return (
    <Mt5OpsShell title="Terminal Operations" subtitle={meta.subtitle}>
      {(state) => {
        if (page === 'connected-terminals') {
          return <ConnectedTerminals terminals={state.terminals} />;
        }
        if (page === 'terminal-registration') {
          return <TerminalRegistration terminals={state.terminals} registrations={state.registrations} />;
        }
        if (page === 'terminal-heartbeat') {
          return <TerminalHeartbeat terminals={state.terminals} />;
        }
        if (page === 'terminal-health-monitoring') {
          return <TerminalHealth terminals={state.terminals} />;
        }
        if (page === 'mt5-synchronization') {
          return <Mt5Synchronization terminals={state.terminals} />;
        }
        if (page === 'mt5-execution-bridge') {
          return <Mt5ExecutionBridge terminals={state.terminals} commands={state.commands} recentAcks={state.recentAcks} commandSummary={state.commandSummary} />;
        }
        if (page === 'live-latency-monitoring') {
          return <LatencyMonitoring terminals={state.terminals} />;
        }
        if (page === 'multi-computer-support') {
          return <MultiComputerSupport terminals={state.terminals} registrations={state.registrations} />;
        }
        if (page === 'account-routing') {
          return <AccountRouting terminals={state.terminals} routing={state.routing} />;
        }
        if (page === 'vps-management') {
          return <VpsManagement vps={state.vps} />;
        }
        if (page === 'ea-deployment') {
          return <EaDeployment />;
        }

        return (
          <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 py-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600" /> Unknown page
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 text-sm text-slate-600 font-mono">{page}</CardContent>
          </Card>
        );
      }}
    </Mt5OpsShell>
  );
}

function resolveMeta(page: string): { subtitle: string } {
  const mapping: Record<string, string> = {
    'connected-terminals': 'Connected terminals',
    'terminal-registration': 'Terminal registration',
    'terminal-heartbeat': 'Terminal heartbeat',
    'terminal-health-monitoring': 'Terminal health monitoring',
    'mt5-synchronization': 'MT5 synchronization',
    'mt5-execution-bridge': 'MT5 execution bridge',
    'live-latency-monitoring': 'Live latency monitoring',
    'multi-computer-support': 'Multi-computer support',
    'account-routing': 'Account routing',
    'vps-management': 'VPS management',
    'ea-deployment': 'EA deployment',
  };
  return { subtitle: mapping[page] ?? page };
}

function ConnectedTerminals({ terminals }: { terminals: any[] }) {
  const connected = terminals.filter((terminal) => terminal.status === 'connected');
  const degraded = terminals.filter((terminal) => terminal.status === 'degraded');
  const disconnected = terminals.filter((terminal) => terminal.status === 'disconnected');

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard icon={TerminalSquare} title="Connected" value={String(connected.length)} tone="teal" />
        <SummaryCard icon={ShieldAlert} title="Degraded" value={String(degraded.length)} tone="amber" />
        <SummaryCard icon={AlertTriangle} title="Disconnected" value={String(disconnected.length)} tone="rose" />
      </div>

      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Network className="w-4 h-4 text-indigo-700" /> Terminals
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[520px]">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500">Account</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">Latency</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">Stability</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">Seq</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terminals.length === 0 ? (
                  <TableRow className="border-slate-100 hover:bg-transparent">
                    <TableCell colSpan={6} className="h-40 text-center text-sm text-slate-500">
                      Waiting for terminal heartbeat.
                    </TableCell>
                  </TableRow>
                ) : terminals.map((terminal) => (
                  <TableRow key={terminal.terminalId} className="border-slate-100 hover:bg-slate-50">
                    <TableCell className="font-mono text-xs text-slate-700">{terminal.terminalId}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-950">{terminal.brokerName || 'Unknown broker'}</span>
                        <span className="text-xs text-slate-500">{terminal.serverName} / {terminal.accountNumber}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusPill status={terminal.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.latencyMs}ms</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.stabilityScore ?? 0}%</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.sequence ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </>
  );
}

function TerminalRegistration({ terminals, registrations }: { terminals: any[]; registrations: any[] }) {
  const [form, setForm] = useState({
    terminalId: '',
    computerId: '',
    computerName: '',
    accountNumber: '',
    brokerName: '',
    serverName: '',
    priority: '50',
    vpsId: '',
    tags: '',
    capabilities: '',
    notes: '',
  });
  const [submit, setSubmit] = useState<EnqueueState>({ status: 'idle', message: '' });

  const connected = terminals.filter((terminal) => terminal.status === 'connected');
  const selectedTerminalId = form.terminalId || connected[0]?.terminalId || '';

  const onPrefill = (terminalId: string) => {
    const terminal = terminals.find((t) => t.terminalId === terminalId);
    if (!terminal) return;
    setForm((current) => ({
      ...current,
      terminalId,
      computerId: terminal.computerId ?? '',
      computerName: terminal.computerName ?? '',
      accountNumber: terminal.accountNumber ?? '',
      brokerName: terminal.brokerName ?? '',
      serverName: terminal.serverName ?? '',
    }));
  };

  const onSubmit = async () => {
    setSubmit({ status: 'submitting', message: '' });
    try {
      const priority = Number(form.priority);
      if (!Number.isFinite(priority)) {
        throw new Error('Priority must be numeric.');
      }

      const payload = {
        terminalId: selectedTerminalId.trim(),
        computerId: form.computerId.trim(),
        computerName: form.computerName.trim(),
        accountNumber: form.accountNumber.trim(),
        brokerName: form.brokerName.trim(),
        serverName: form.serverName.trim(),
        priority,
        vpsId: form.vpsId.trim(),
        tags: form.tags.split(',').map((v) => v.trim()).filter(Boolean),
        capabilities: form.capabilities.split(',').map((v) => v.trim()).filter(Boolean),
        notes: form.notes.trim(),
      };
      if (!payload.terminalId) throw new Error('TerminalId is required.');

      const response = await fetch('/api/mt5/terminals/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Register failed with HTTP ${response.status}`);
      }
      setSubmit({ status: 'ok', message: 'Registration saved.' });
    } catch (error) {
      setSubmit({ status: 'error', message: error instanceof Error ? error.message : 'Failed to register terminal.' });
    }
  };

  return (
    <>
      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Wrench className="w-4 h-4 text-indigo-700" /> Register / Update Terminal
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
              value={selectedTerminalId}
              onChange={(e) => onPrefill(e.target.value)}
            >
              <option value="">Select terminal</option>
              {terminals.map((terminal) => (
                <option key={terminal.terminalId} value={terminal.terminalId}>{terminal.terminalId}</option>
              ))}
            </select>
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={form.priority} onChange={(e) => setForm((c) => ({ ...c, priority: e.target.value }))} />
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="vpsId" value={form.vpsId} onChange={(e) => setForm((c) => ({ ...c, vpsId: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="computerId" value={form.computerId} onChange={(e) => setForm((c) => ({ ...c, computerId: e.target.value }))} />
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="computerName" value={form.computerName} onChange={(e) => setForm((c) => ({ ...c, computerName: e.target.value }))} />
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="accountNumber" value={form.accountNumber} onChange={(e) => setForm((c) => ({ ...c, accountNumber: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="brokerName" value={form.brokerName} onChange={(e) => setForm((c) => ({ ...c, brokerName: e.target.value }))} />
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="serverName" value={form.serverName} onChange={(e) => setForm((c) => ({ ...c, serverName: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="tags (comma separated)" value={form.tags} onChange={(e) => setForm((c) => ({ ...c, tags: e.target.value }))} />
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="capabilities (comma separated)" value={form.capabilities} onChange={(e) => setForm((c) => ({ ...c, capabilities: e.target.value }))} />
          </div>
          <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="notes" value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} />
          <div className="flex items-center justify-between">
            <div className={cn(
              'text-xs font-mono',
              submit.status === 'ok' && 'text-teal-700',
              submit.status === 'error' && 'text-rose-700',
              submit.status === 'submitting' && 'text-slate-500',
            )}>
              {submit.message}
            </div>
            <button
              type="button"
              className={cn(
                'h-9 rounded-md border px-3 text-xs font-semibold',
                submit.status === 'submitting'
                  ? 'border-slate-200 bg-slate-100 text-slate-400'
                  : 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100',
              )}
              disabled={submit.status === 'submitting'}
              onClick={onSubmit}
            >
              Save
            </button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Router className="w-4 h-4 text-violet-700" /> Registrations
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[520px]">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500">Computer</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500">Account</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">Priority</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500">VPS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registrations.length === 0 ? (
                  <TableRow className="border-slate-100 hover:bg-transparent">
                    <TableCell colSpan={5} className="h-40 text-center text-sm text-slate-500">
                      No terminal registrations yet.
                    </TableCell>
                  </TableRow>
                ) : registrations.map((r) => (
                  <TableRow key={r.terminalId} className="border-slate-100 hover:bg-slate-50">
                    <TableCell className="font-mono text-xs text-slate-700">{r.terminalId}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">{r.computerId || r.computerName}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">{r.accountNumber}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{r.priority}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">{r.vpsId}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </>
  );
}

function TerminalHeartbeat({ terminals }: { terminals: any[] }) {
  const [terminalId, setTerminalId] = useState('');
  const selectedTerminalId = terminalId || terminals[0]?.terminalId || '';
  const [details, setDetails] = useState<{ status: 'idle' | 'loading' | 'ok' | 'error'; payload: any | null; message: string }>({
    status: 'idle',
    payload: null,
    message: '',
  });

  const load = async (id: string) => {
    setDetails({ status: 'loading', payload: null, message: '' });
    try {
      if (!id) throw new Error('Select a terminal.');
      const response = await fetch(`/api/mt5/terminals/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `HTTP ${response.status}`);
      }
      const payload = await response.json();
      setDetails({ status: 'ok', payload, message: '' });
    } catch (error) {
      setDetails({ status: 'error', payload: null, message: error instanceof Error ? error.message : 'Failed to load terminal heartbeat.' });
    }
  };

  const history = details.payload?.history ?? [];
  const terminal = details.payload?.terminal ?? null;

  return (
    <>
      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <PlugZap className="w-4 h-4 text-indigo-700" /> Heartbeat Stream
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs md:w-[360px]"
              value={selectedTerminalId}
              onChange={(e) => setTerminalId(e.target.value)}
            >
              <option value="">Select terminal</option>
              {terminals.map((t) => (
                <option key={t.terminalId} value={t.terminalId}>{t.terminalId}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <div className={cn(
                'text-xs font-mono',
                details.status === 'error' && 'text-rose-700',
                details.status === 'loading' && 'text-slate-500',
              )}>
                {details.message}
              </div>
              <button
                type="button"
                className={cn(
                  'h-9 rounded-md border px-3 text-xs font-semibold',
                  details.status === 'loading'
                    ? 'border-slate-200 bg-slate-100 text-slate-400'
                    : 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100',
                )}
                disabled={details.status === 'loading'}
                onClick={() => load(selectedTerminalId)}
              >
                Load
              </button>
            </div>
          </div>
          {terminal ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <SummaryCard icon={TerminalSquare} title="Status" value={terminal.status} tone={terminal.status === 'connected' ? 'teal' : terminal.status === 'degraded' ? 'amber' : 'rose'} />
              <SummaryCard icon={Gauge} title="Latency" value={`${terminal.latencyMs}ms`} tone="indigo" />
              <SummaryCard icon={Globe2} title="Server Time" value={terminal.mt5ServerTime ? String(terminal.mt5ServerTime).slice(11, 19) : '--:--:--'} tone="violet" />
              <SummaryCard icon={Network} title="Heartbeat Age" value={`${Math.round(terminal.heartbeatAgeMs)}ms`} tone="slate" />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Network className="w-4 h-4 text-violet-700" /> Recent Heartbeats
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[520px]">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="text-xs font-mono text-slate-500">Received</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">Latency</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">Equity</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">Orders</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">Seq</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.length === 0 ? (
                  <TableRow className="border-slate-100 hover:bg-transparent">
                    <TableCell colSpan={5} className="h-40 text-center text-sm text-slate-500">
                      Load a terminal to view heartbeat history.
                    </TableCell>
                  </TableRow>
                ) : history.map((row: any) => (
                  <TableRow key={`${row.receivedAt}-${row.sequence}`} className="border-slate-100 hover:bg-slate-50">
                    <TableCell className="font-mono text-xs text-slate-700">{formatTime(row.receivedAt)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{row.latencyMs}ms</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{formatMoney(row.equity)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{row.openOrders}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{row.sequence}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </>
  );
}

function TerminalHealth({ terminals }: { terminals: any[] }) {
  const sorted = [...terminals].sort((a, b) => (b.stabilityScore ?? 0) - (a.stabilityScore ?? 0));
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600" /> Terminal Health Monitoring
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[620px]">
          <Table>
            <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
              <TableRow className="border-slate-200 hover:bg-transparent">
                <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                <TableHead className="text-xs font-mono text-slate-500 text-right">Stability</TableHead>
                <TableHead className="text-xs font-mono text-slate-500 text-right">Avg</TableHead>
                <TableHead className="text-xs font-mono text-slate-500 text-right">Jitter</TableHead>
                <TableHead className="text-xs font-mono text-slate-500 text-right">Missed Seq</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow className="border-slate-100 hover:bg-transparent">
                  <TableCell colSpan={6} className="h-40 text-center text-sm text-slate-500">
                    Waiting for terminal heartbeat.
                  </TableCell>
                </TableRow>
              ) : sorted.map((t) => (
                <TableRow key={t.terminalId} className="border-slate-100 hover:bg-slate-50">
                  <TableCell className="font-mono text-xs text-slate-700">{t.terminalId}</TableCell>
                  <TableCell><StatusPill status={t.status} /></TableCell>
                  <TableCell className="text-right font-mono text-xs text-slate-700">{t.stabilityScore ?? 0}%</TableCell>
                  <TableCell className="text-right font-mono text-xs text-slate-700">{(t.averageLatencyMs ?? 0)}ms</TableCell>
                  <TableCell className="text-right font-mono text-xs text-slate-700">{(t.jitterMs ?? 0)}ms</TableCell>
                  <TableCell className="text-right font-mono text-xs text-slate-700">{t.missedSequenceCount ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function Mt5Synchronization({ terminals }: { terminals: any[] }) {
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Globe2 className="w-4 h-4 text-indigo-700" /> Time Synchronization
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[620px]">
          <Table>
            <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
              <TableRow className="border-slate-200 hover:bg-transparent">
                <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                <TableHead className="text-xs font-mono text-slate-500 text-right">MT5 Drift</TableHead>
                <TableHead className="text-xs font-mono text-slate-500 text-right">Local Drift</TableHead>
                <TableHead className="text-xs font-mono text-slate-500 text-right">Nigeria Drift</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {terminals.length === 0 ? (
                <TableRow className="border-slate-100 hover:bg-transparent">
                  <TableCell colSpan={5} className="h-40 text-center text-sm text-slate-500">
                    Waiting for terminal heartbeat.
                  </TableCell>
                </TableRow>
              ) : terminals.map((t) => (
                <TableRow key={t.terminalId} className="border-slate-100 hover:bg-slate-50">
                  <TableCell className="font-mono text-xs text-slate-700">{t.terminalId}</TableCell>
                  <TableCell><StatusPill status={t.status} /></TableCell>
                  <TableCell className="text-right font-mono text-xs text-slate-700">{formatDrift(t.timeDriftMs)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-slate-700">{formatDrift(t.terminalTimeDriftMs)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-slate-700">{formatDrift(t.nigeriaTimeDriftMs)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function LatencyMonitoring({ terminals }: { terminals: any[] }) {
  const connected = terminals.filter((t) => t.status !== 'disconnected');
  const worst = connected.length ? Math.max(...connected.map((t) => t.ewmaLatencyMs ?? t.latencyMs ?? 0)) : 0;
  const avg = connected.length ? Math.round(connected.reduce((s, t) => s + (t.ewmaLatencyMs ?? t.latencyMs ?? 0), 0) / connected.length) : 0;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard icon={Gauge} title="EWMA Avg" value={`${avg}ms`} tone="teal" />
        <SummaryCard icon={Gauge} title="Worst EWMA" value={`${worst}ms`} tone="amber" />
        <SummaryCard icon={Network} title="Active Terminals" value={String(connected.length)} tone="indigo" />
      </div>

      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Gauge className="w-4 h-4 text-teal-600" /> Live Latency Monitoring
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[620px]">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">Instant</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">EWMA</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">Avg</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">Jitter</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terminals.length === 0 ? (
                  <TableRow className="border-slate-100 hover:bg-transparent">
                    <TableCell colSpan={6} className="h-40 text-center text-sm text-slate-500">
                      Waiting for terminal heartbeat.
                    </TableCell>
                  </TableRow>
                ) : terminals.map((t) => (
                  <TableRow key={t.terminalId} className="border-slate-100 hover:bg-slate-50">
                    <TableCell className="font-mono text-xs text-slate-700">{t.terminalId}</TableCell>
                    <TableCell><StatusPill status={t.status} /></TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{t.latencyMs}ms</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{t.ewmaLatencyMs ?? 0}ms</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{t.averageLatencyMs ?? 0}ms</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{t.jitterMs ?? 0}ms</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </>
  );
}

function MultiComputerSupport({ terminals, registrations }: { terminals: any[]; registrations: any[] }) {
  const computers = useMemo(() => {
    const byComputer = new Map<string, { computerId: string; terminals: any[]; registrations: any[] }>();
    for (const terminal of terminals) {
      const computerId = String(terminal.computerId ?? terminal.computerName ?? 'unknown');
      const entry = byComputer.get(computerId) ?? { computerId, terminals: [], registrations: [] };
      entry.terminals.push(terminal);
      byComputer.set(computerId, entry);
    }
    for (const reg of registrations) {
      const computerId = String(reg.computerId ?? reg.computerName ?? 'unknown');
      const entry = byComputer.get(computerId) ?? { computerId, terminals: [], registrations: [] };
      entry.registrations.push(reg);
      byComputer.set(computerId, entry);
    }
    return Array.from(byComputer.values()).sort((a, b) => b.terminals.length - a.terminals.length);
  }, [registrations, terminals]);

  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Laptop2 className="w-4 h-4 text-indigo-700" /> Multi-Computer Support
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {computers.length === 0 ? (
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">
            No computers detected yet.
          </div>
        ) : computers.map((computer) => {
          const connected = computer.terminals.filter((t) => t.status === 'connected').length;
          const degraded = computer.terminals.filter((t) => t.status === 'degraded').length;
          const disconnected = computer.terminals.filter((t) => t.status === 'disconnected').length;
          return (
            <div key={computer.computerId} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-950 truncate">{computer.computerId}</div>
                  <div className="text-xs text-slate-500 font-mono">
                    {computer.terminals.length} terminals / {computer.registrations.length} registrations
                  </div>
                </div>
                <div className="text-xs font-mono text-slate-700">
                  {connected} connected / {degraded} degraded / {disconnected} disconnected
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {computer.terminals.map((t) => (
                  <div key={t.terminalId} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="font-mono text-xs text-slate-700">{t.terminalId}</div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={t.status} />
                      <span className="font-mono text-xs text-slate-600">{t.latencyMs}ms</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function AccountRouting({ terminals, routing }: { terminals: any[]; routing: any[] }) {
  const [form, setForm] = useState({
    accountNumber: '',
    preferredTerminalIds: '',
    failoverStrategy: 'priority' as 'priority' | 'stability',
    minStabilityScore: '0',
  });
  const [submit, setSubmit] = useState<EnqueueState>({ status: 'idle', message: '' });

  const onSubmit = async () => {
    setSubmit({ status: 'submitting', message: '' });
    try {
      const accountNumber = form.accountNumber.trim();
      if (!accountNumber) throw new Error('Account number is required.');
      const minStabilityScore = Number(form.minStabilityScore);
      if (!Number.isFinite(minStabilityScore)) throw new Error('minStabilityScore must be numeric.');
      const preferredTerminalIds = form.preferredTerminalIds.split(',').map((v) => v.trim()).filter(Boolean);

      const response = await fetch(`/api/mt5/routing/accounts/${encodeURIComponent(accountNumber)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredTerminalIds,
          strategy: form.failoverStrategy,
          minStabilityScore,
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Routing update failed with HTTP ${response.status}`);
      }
      setSubmit({ status: 'ok', message: 'Routing saved.' });
    } catch (error) {
      setSubmit({ status: 'error', message: error instanceof Error ? error.message : 'Failed to save routing.' });
    }
  };

  return (
    <>
      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Router className="w-4 h-4 text-indigo-700" /> Account Routing Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="accountNumber" value={form.accountNumber} onChange={(e) => setForm((c) => ({ ...c, accountNumber: e.target.value }))} />
            <select className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={form.failoverStrategy} onChange={(e) => setForm((c) => ({ ...c, failoverStrategy: e.target.value as any }))}>
              <option value="priority">priority</option>
              <option value="stability">stability</option>
            </select>
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="minStabilityScore" value={form.minStabilityScore} onChange={(e) => setForm((c) => ({ ...c, minStabilityScore: e.target.value }))} />
            <button
              type="button"
              className={cn(
                'h-9 rounded-md border px-3 text-xs font-semibold',
                submit.status === 'submitting'
                  ? 'border-slate-200 bg-slate-100 text-slate-400'
                  : 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100',
              )}
              disabled={submit.status === 'submitting'}
              onClick={onSubmit}
            >
              Save
            </button>
          </div>
          <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="preferredTerminalIds (comma separated) or blank for auto" value={form.preferredTerminalIds} onChange={(e) => setForm((c) => ({ ...c, preferredTerminalIds: e.target.value }))} />
          <div className={cn(
            'text-xs font-mono',
            submit.status === 'ok' && 'text-teal-700',
            submit.status === 'error' && 'text-rose-700',
            submit.status === 'submitting' && 'text-slate-500',
          )}>
            {submit.message}
          </div>
          <div className="text-xs text-slate-500">
            Connected terminals available: {terminals.filter((t) => t.status === 'connected').map((t) => t.terminalId).join(', ') || 'none'}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Network className="w-4 h-4 text-violet-700" /> Routing Entries
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[620px]">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="text-xs font-mono text-slate-500">Account</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500">Strategy</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500">Preferred</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500 text-right">Min Stability</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routing.length === 0 ? (
                  <TableRow className="border-slate-100 hover:bg-transparent">
                    <TableCell colSpan={4} className="h-40 text-center text-sm text-slate-500">
                      No routing entries yet.
                    </TableCell>
                  </TableRow>
                ) : routing.map((r) => (
                  <TableRow key={r.accountNumber} className="border-slate-100 hover:bg-slate-50">
                    <TableCell className="font-mono text-xs text-slate-700">{r.accountNumber}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">{r.failoverStrategy}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">{(r.preferredTerminalIds ?? []).join(', ') || 'auto'}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">{r.minStabilityScore ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </>
  );
}

function VpsManagement({ vps }: { vps: any[] }) {
  const [form, setForm] = useState({
    vpsId: '',
    label: '',
    provider: '',
    region: '',
    ipAddress: '',
    status: 'unknown',
    notes: '',
  });
  const [submit, setSubmit] = useState<EnqueueState>({ status: 'idle', message: '' });

  const onSubmit = async () => {
    setSubmit({ status: 'submitting', message: '' });
    try {
      if (!form.vpsId.trim()) throw new Error('vpsId is required.');
      const response = await fetch('/api/mt5/vps/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vpsId: form.vpsId.trim(),
          label: form.label.trim(),
          provider: form.provider.trim(),
          region: form.region.trim(),
          ipAddress: form.ipAddress.trim(),
          status: form.status,
          notes: form.notes.trim(),
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `VPS register failed with HTTP ${response.status}`);
      }
      setSubmit({ status: 'ok', message: 'VPS saved.' });
    } catch (error) {
      setSubmit({ status: 'error', message: error instanceof Error ? error.message : 'Failed to save VPS.' });
    }
  };

  return (
    <>
      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Server className="w-4 h-4 text-indigo-700" /> VPS Registry
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="vpsId" value={form.vpsId} onChange={(e) => setForm((c) => ({ ...c, vpsId: e.target.value }))} />
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="label" value={form.label} onChange={(e) => setForm((c) => ({ ...c, label: e.target.value }))} />
            <select className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={form.status} onChange={(e) => setForm((c) => ({ ...c, status: e.target.value }))}>
              <option value="unknown">unknown</option>
              <option value="online">online</option>
              <option value="degraded">degraded</option>
              <option value="offline">offline</option>
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="provider" value={form.provider} onChange={(e) => setForm((c) => ({ ...c, provider: e.target.value }))} />
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="region" value={form.region} onChange={(e) => setForm((c) => ({ ...c, region: e.target.value }))} />
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="ipAddress" value={form.ipAddress} onChange={(e) => setForm((c) => ({ ...c, ipAddress: e.target.value }))} />
          </div>
          <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="notes" value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} />
          <div className="flex items-center justify-between">
            <div className={cn(
              'text-xs font-mono',
              submit.status === 'ok' && 'text-teal-700',
              submit.status === 'error' && 'text-rose-700',
              submit.status === 'submitting' && 'text-slate-500',
            )}>
              {submit.message}
            </div>
            <button
              type="button"
              className={cn(
                'h-9 rounded-md border px-3 text-xs font-semibold',
                submit.status === 'submitting'
                  ? 'border-slate-200 bg-slate-100 text-slate-400'
                  : 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100',
              )}
              disabled={submit.status === 'submitting'}
              onClick={onSubmit}
            >
              Save
            </button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Server className="w-4 h-4 text-violet-700" /> VPS List
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[620px]">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="text-xs font-mono text-slate-500">VPS</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500">Provider</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500">Region</TableHead>
                  <TableHead className="text-xs font-mono text-slate-500">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vps.length === 0 ? (
                  <TableRow className="border-slate-100 hover:bg-transparent">
                    <TableCell colSpan={5} className="h-40 text-center text-sm text-slate-500">
                      No VPS entries yet.
                    </TableCell>
                  </TableRow>
                ) : vps.map((v) => (
                  <TableRow key={v.vpsId} className="border-slate-100 hover:bg-slate-50">
                    <TableCell className="font-mono text-xs text-slate-700">{v.vpsId} {v.label ? `(${v.label})` : ''}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">{v.status}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">{v.provider}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">{v.region}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">{v.ipAddress}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </>
  );
}

function Mt5ExecutionBridge(props: { terminals: any[]; commands: any[]; recentAcks: any[]; commandSummary: any }) {
  const connected = props.terminals.filter((t) => t.status === 'connected');
  const [enqueue, setEnqueue] = useState({
    terminalId: '',
    symbol: 'XAUUSD',
    side: 'buy' as 'buy' | 'sell',
    volumeLots: '0.01',
    stopLoss: '0',
    takeProfit: '0',
  });
  const [submit, setSubmit] = useState<EnqueueState>({ status: 'idle', message: '' });
  const selectedTerminalId = enqueue.terminalId || connected[0]?.terminalId || '';

  const onEnqueue = async () => {
    setSubmit({ status: 'submitting', message: '' });
    try {
      const volumeLots = Number(enqueue.volumeLots);
      const stopLoss = Number(enqueue.stopLoss);
      const takeProfit = Number(enqueue.takeProfit);
      if (!selectedTerminalId) throw new Error('Select a terminal.');
      if (!Number.isFinite(volumeLots) || volumeLots <= 0) throw new Error('Volume must be a positive number.');
      if (!Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)) throw new Error('SL/TP must be numeric values.');
      const response = await fetch('/api/mt5/commands/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandId: `${selectedTerminalId}-${crypto.randomUUID()}`,
          terminalId: selectedTerminalId,
          type: 'place_order',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          payload: {
            symbol: enqueue.symbol.trim(),
            side: enqueue.side,
            orderKind: 'market',
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
      setSubmit({ status: 'ok', message: 'Command enqueued.' });
    } catch (error) {
      setSubmit({ status: 'error', message: error instanceof Error ? error.message : 'Failed to enqueue command.' });
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard icon={Server} title="Queued" value={String(props.commandSummary?.queued ?? 0)} tone="indigo" />
        <SummaryCard icon={PlugZap} title="In Flight" value={String(props.commandSummary?.leased ?? 0)} tone="amber" />
        <SummaryCard icon={CheckCircle2} title="Acked" value={String(props.commandSummary?.acknowledged ?? 0)} tone="teal" />
      </div>

      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Server className="w-4 h-4 text-indigo-700" /> Enqueue Command
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <select
              className="md:col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
              value={selectedTerminalId}
              onChange={(e) => setEnqueue((c) => ({ ...c, terminalId: e.target.value }))}
            >
              <option value="">Select terminal</option>
              {connected.map((t) => (
                <option key={t.terminalId} value={t.terminalId}>{t.terminalId}</option>
              ))}
            </select>
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={enqueue.symbol} onChange={(e) => setEnqueue((c) => ({ ...c, symbol: e.target.value }))} />
            <select className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={enqueue.side} onChange={(e) => setEnqueue((c) => ({ ...c, side: e.target.value as any }))}>
              <option value="buy">buy</option>
              <option value="sell">sell</option>
            </select>
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={enqueue.volumeLots} onChange={(e) => setEnqueue((c) => ({ ...c, volumeLots: e.target.value }))} />
            <button
              type="button"
              className={cn(
                'h-9 rounded-md border px-3 text-xs font-semibold',
                submit.status === 'submitting'
                  ? 'border-slate-200 bg-slate-100 text-slate-400'
                  : 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100',
              )}
              disabled={submit.status === 'submitting'}
              onClick={onEnqueue}
            >
              Enqueue
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="stopLoss" value={enqueue.stopLoss} onChange={(e) => setEnqueue((c) => ({ ...c, stopLoss: e.target.value }))} />
            <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="takeProfit" value={enqueue.takeProfit} onChange={(e) => setEnqueue((c) => ({ ...c, takeProfit: e.target.value }))} />
          </div>
          <div className={cn(
            'text-xs font-mono',
            submit.status === 'ok' && 'text-teal-700',
            submit.status === 'error' && 'text-rose-700',
            submit.status === 'submitting' && 'text-slate-500',
          )}>
            {submit.message}
          </div>
          <div className="text-xs text-slate-500 font-mono">
            Execution requires the EA input EnableExecution=true. Otherwise the EA will ACK as rejected.
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600" /> Recent Acknowledgements
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[520px]">
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
                  {props.recentAcks.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={4} className="h-40 text-center text-sm text-slate-500">
                        No acknowledgements yet.
                      </TableCell>
                    </TableRow>
                  ) : props.recentAcks.slice(0, 25).map((ack) => (
                    <TableRow key={ack.commandId} className="border-slate-100 hover:bg-slate-50">
                      <TableCell className="font-mono text-xs text-slate-700">{formatTime(ack.receivedAt)}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{ack.terminalId}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{ack.status}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{ack.ticket ?? ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-700" /> Command Queue
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[520px]">
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
                  {props.commands.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={4} className="h-40 text-center text-sm text-slate-500">
                        No commands enqueued yet.
                      </TableCell>
                    </TableRow>
                  ) : props.commands.slice(0, 40).map((command) => (
                    <TableRow key={command.commandId} className="border-slate-100 hover:bg-slate-50">
                      <TableCell className="font-mono text-xs text-slate-700">{formatTime(command.createdAt)}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{command.terminalId}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{command.type}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{command.status} / {command.attempt}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function EaDeployment() {
  const bridgeUrl = process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://127.0.0.1:8787';
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <TerminalSquare className="w-4 h-4 text-indigo-700" /> EA Deployment
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        <div className="text-sm text-slate-700">
          Compile and attach the EA in MetaEditor, then configure the inputs for your terminal.
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700 space-y-1">
          <div>EA file: mt5/experts/CacsmsTraderEA/CacsmsTraderEA.mq5</div>
          <div>BridgeUrl: {bridgeUrl}</div>
          <div>TerminalId: &lt;unique per terminal&gt;</div>
          <div>BridgeSecret: &lt;matches MT5_BRIDGE_SHARED_SECRET&gt;</div>
          <div>HeartbeatSeconds: 5</div>
          <div>CommandPollSeconds: 2</div>
          <div>EnableExecution: false (set true for demo execution)</div>
        </div>
        <div className="text-xs text-slate-500">
          In MT5, add the BridgeUrl domain to Tools → Options → Expert Advisors → Allow WebRequest for listed URL.
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCard(props: { icon: any; title: string; value: string; tone: 'teal' | 'amber' | 'rose' | 'indigo' | 'violet' | 'slate' }) {
  const Icon = props.icon;
  const tone = props.tone;
  const toneClasses: Record<string, string> = {
    teal: 'text-teal-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
    indigo: 'text-indigo-700',
    violet: 'text-violet-700',
    slate: 'text-slate-700',
  };
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
          <Icon className={cn('w-3 h-3', toneClasses[tone])} /> {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-mono text-slate-950">{props.value}</div>
      </CardContent>
    </Card>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn(
      'inline-flex rounded-md border px-2 py-1 text-[11px] font-semibold capitalize',
      status === 'connected' && 'border-teal-200 bg-teal-50 text-teal-700',
      status === 'degraded' && 'border-amber-200 bg-amber-50 text-amber-700',
      status === 'disconnected' && 'border-rose-200 bg-rose-50 text-rose-700',
    )}>
      {status}
    </span>
  );
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDrift(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  const ms = Number(value);
  const sign = ms >= 0 ? '+' : '-';
  return `${sign}${Math.abs(ms)}ms`;
}

