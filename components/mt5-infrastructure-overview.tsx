'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Gauge,
  Link2,
  Network,
  PlugZap,
  Radio,
  RefreshCw,
  Server,
  TerminalSquare,
  Workflow,
  Wrench,
} from 'lucide-react';

import { useMt5OpsState } from '@/components/mt5-ops-shell';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type EaDeploymentSummary = {
  projectEaVersion: string;
  verification: {
    status: string;
    message: string;
    eaEx5Exists: boolean;
    eaMq5Exists: boolean;
    filesCount: number;
  } | null;
  config: {
    targetFolderName: string;
    deploymentMethod: string;
  } | null;
};

const QUICK_LINKS = [
  {
    href: '/mt5-infrastructure/terminal-operations/connected-terminals',
    label: 'Connected terminals',
    detail: 'Fleet table, filters, and tick sync',
    icon: Network,
  },
  {
    href: '/mt5-infrastructure/terminal-operations/terminal-heartbeat',
    label: 'Terminal heartbeat',
    detail: 'Live pulse and drift monitoring',
    icon: Radio,
  },
  {
    href: '/mt5-infrastructure/terminal-operations/ea-communication-engine',
    label: 'EA communication',
    detail: 'Command stream and acknowledgements',
    icon: PlugZap,
  },
  {
    href: '/mt5-infrastructure/terminal-operations/mt5-execution-bridge',
    label: 'Execution bridge',
    detail: 'Order queue and dispatch lifecycle',
    icon: Server,
  },
  {
    href: '/mt5-infrastructure/terminal-operations/ea-deployment-link',
    label: 'EA deployment',
    detail: 'Copy CacsmsTraderEA into MT5',
    icon: Link2,
  },
  {
    href: '/mt5-infrastructure/terminal-operations/live-latency-monitoring',
    label: 'Latency monitoring',
    detail: 'EWMA, jitter, and stability scores',
    icon: Gauge,
  },
  {
    href: '/mt5-infrastructure/terminal-operations/terminal-registration',
    label: 'Terminal registration',
    detail: 'Approve and manage registrations',
    icon: TerminalSquare,
  },
  {
    href: '/autonomous-pipeline',
    label: 'Pipeline command center',
    detail: 'Autonomous trading pipeline stages',
    icon: Workflow,
  },
] as const;

export function Mt5InfrastructureOverview() {
  const state = useMt5OpsState();
  const [eaSummary, setEaSummary] = useState<EaDeploymentSummary | null>(null);
  const [eaLoading, setEaLoading] = useState(true);

  const loadEaSummary = useCallback(async () => {
    setEaLoading(true);
    try {
      const response = await fetch('/api/mt5/ea-deployment/summary', { cache: 'no-store' });
      const payload = await response.json();
      if (response.ok && payload.ok) {
        setEaSummary({
          projectEaVersion: payload.projectEaVersion ?? 'unknown',
          verification: payload.verification ?? null,
          config: payload.config ?? null,
        });
      }
    } catch {
      setEaSummary(null);
    } finally {
      setEaLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEaSummary();
  }, [loadEaSummary]);

  const connected = useMemo(
    () => state.terminals.filter((terminal) => terminal.status === 'connected'),
    [state.terminals],
  );
  const degraded = useMemo(
    () => state.terminals.filter((terminal) => terminal.status === 'degraded'),
    [state.terminals],
  );
  const disconnected = useMemo(
    () => state.terminals.filter((terminal) => terminal.status === 'disconnected'),
    [state.terminals],
  );

  const avgLatency = connected.length
    ? Math.round(
        connected.reduce((sum, terminal) => sum + (terminal.averageLatencyMs ?? terminal.latencyMs ?? 0), 0)
          / connected.length,
      )
    : 0;
  const lowestStability = connected.length
    ? Math.min(...connected.map((terminal) => terminal.stabilityScore ?? 0))
    : 0;
  const queued = state.commandSummary?.queued ?? 0;
  const inflight = state.commandSummary?.leased ?? 0;
  const acks = state.commandSummary?.acknowledged ?? 0;

  const eaDeployed = Boolean(eaSummary?.verification?.eaEx5Exists && eaSummary?.verification?.eaMq5Exists);
  const readinessChecks = useMemo(
    () => [
      {
        id: 'bridge',
        label: 'MT5 bridge online',
        passed: state.bridgeOnline,
        href: '/mt5-infrastructure/terminal-operations/connected-terminals',
        hint: state.bridgeOnline ? 'Bridge is accepting heartbeats.' : state.lastError || 'Start Docker stack and MT5 bridge.',
      },
      {
        id: 'terminal',
        label: 'Connected terminal',
        passed: connected.length > 0,
        href: '/mt5-infrastructure/terminal-operations/connected-terminals',
        hint: connected.length > 0 ? `${connected.length} terminal(s) online.` : 'Attach CacsmsTraderEA to a demo chart.',
      },
      {
        id: 'registration',
        label: 'Terminal registered',
        passed: state.registrations.length > 0,
        href: '/mt5-infrastructure/terminal-operations/terminal-registration',
        hint: state.registrations.length > 0
          ? `${state.registrations.length} registration(s) in database.`
          : 'Approve registration after first heartbeat.',
      },
      {
        id: 'ea',
        label: 'EA files deployed',
        passed: eaDeployed,
        href: '/mt5-infrastructure/terminal-operations/ea-deployment-link',
        hint: eaDeployed
          ? `v${eaSummary?.projectEaVersion ?? '—'} in MT5 Experts folder.`
          : 'Use Copy files in the Link Manager.',
      },
      {
        id: 'routing',
        label: 'Account routing configured',
        passed: state.routing.length > 0,
        href: '/mt5-infrastructure/terminal-operations/account-routing',
        hint: state.routing.length > 0
          ? `${state.routing.length} routing rule(s) active.`
          : 'Optional until multi-account failover is needed.',
      },
    ],
    [connected.length, eaDeployed, eaSummary?.projectEaVersion, state.bridgeOnline, state.lastError, state.registrations.length, state.routing.length],
  );

  const readinessScore = Math.round(
    (readinessChecks.filter((check) => check.passed).length / readinessChecks.length) * 100,
  );
  const requiredChecks = readinessChecks.slice(0, 4);
  const requiredPassed = requiredChecks.every((check) => check.passed);

  const recentEvents = state.events.slice(0, 8);
  const recentAcks = state.recentAcks.slice(0, 6);

  return (
    <div className="space-y-6">
      <section
        className={cn(
          'rounded-2xl border p-5 shadow-sm',
          state.bridgeOnline
            ? 'border-teal-200 bg-gradient-to-r from-teal-50 via-white to-white'
            : 'border-rose-200 bg-gradient-to-r from-rose-50 via-white to-white',
        )}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'grid h-12 w-12 shrink-0 place-items-center rounded-xl border',
                state.bridgeOnline ? 'border-teal-200 bg-teal-100 text-teal-800' : 'border-rose-200 bg-rose-100 text-rose-800',
              )}
            >
              {state.bridgeOnline ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">MT5 Infrastructure</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                {state.bridgeOnline ? 'Bridge operational' : 'Bridge unavailable'}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                {state.bridgeOnline
                  ? `Monitoring ${state.terminals.length} terminal(s) with live heartbeat, command queue, and EA deployment status.`
                  : state.lastError || 'The MT5 bridge is not reachable. Confirm Docker and the bridge service are running.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-mono text-slate-600">
              Updated {state.refreshedAt ? new Date(state.refreshedAt).toLocaleTimeString('en-US', { hour12: false }) : '—'}
            </span>
            <Button variant="outline" size="sm" onClick={() => void loadEaSummary()} disabled={eaLoading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', eaLoading && 'animate-spin')} />
              Refresh EA status
            </Button>
            <Link
              href="/mt5-infrastructure/terminal-operations/connected-terminals"
              className={cn(buttonVariants({ size: 'sm' }), 'inline-flex items-center gap-1.5')}
            >
              Open fleet view
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard icon={TerminalSquare} label="Terminals" value={String(state.terminals.length)} detail={`${connected.length} up · ${degraded.length} warn · ${disconnected.length} down`} tone="indigo" />
        <MetricCard icon={Gauge} label="Avg latency" value={`${avgLatency}ms`} detail="Across connected terminals" tone="teal" />
        <MetricCard icon={Activity} label="Stability floor" value={`${lowestStability}%`} detail="Lowest score (connected)" tone="violet" />
        <MetricCard icon={Server} label="Command queue" value={String(queued)} detail={`${inflight} in-flight · ${acks} acked`} tone="slate" />
        <MetricCard icon={Wrench} label="EA version" value={eaSummary?.projectEaVersion ?? '—'} detail={eaDeployed ? 'Deployed to MT5' : 'Not deployed'} tone={eaDeployed ? 'teal' : 'amber'} />
        <MetricCard icon={Network} label="Readiness" value={`${readinessScore}%`} detail={requiredPassed ? 'Core gates passed' : 'Action required'} tone={requiredPassed ? 'teal' : 'amber'} />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="h-4 w-4 text-teal-600" />
              Infrastructure readiness
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <span>Setup progress</span>
                <span className="font-mono">{readinessScore}%</span>
              </div>
              <Progress value={readinessScore} className="h-2 bg-slate-100" />
            </div>
            <div className="space-y-2">
              {readinessChecks.map((check) => (
                <Link
                  key={check.id}
                  href={check.href}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-start gap-2.5">
                    {check.passed ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-900">{check.label}</p>
                      <p className="text-xs text-slate-500">{check.hint}</p>
                    </div>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold">Quick navigation</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-lg border border-slate-200 p-3 transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-indigo-700" />
                    <span className="text-sm font-medium text-slate-900">{link.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{link.detail}</p>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
        <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-200 py-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Network className="h-4 w-4 text-indigo-700" />
              Live terminal fleet
            </CardTitle>
            <Link
              href="/mt5-infrastructure/terminal-operations/connected-terminals"
              className="text-xs font-medium text-indigo-700 hover:underline"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="text-[11px] uppercase text-slate-500">Terminal</TableHead>
                  <TableHead className="text-[11px] uppercase text-slate-500">Broker</TableHead>
                  <TableHead className="text-[11px] uppercase text-slate-500">Account</TableHead>
                  <TableHead className="text-[11px] uppercase text-slate-500">Status</TableHead>
                  <TableHead className="text-right text-[11px] uppercase text-slate-500">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.terminals.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="h-32 text-center text-sm text-slate-500">
                      No terminals connected yet. Deploy the EA and attach it to an MT5 chart.
                    </TableCell>
                  </TableRow>
                ) : (
                  state.terminals.slice(0, 8).map((terminal) => (
                    <TableRow key={terminal.terminalId} className="border-slate-100">
                      <TableCell className="max-w-[180px] truncate font-mono text-xs text-slate-800">
                        {terminal.terminalId}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">{terminal.brokerName || '—'}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{terminal.accountNumber || '—'}</TableCell>
                      <TableCell>
                        <StatusBadge status={terminal.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">
                        {terminal.latencyMs ?? 0}ms
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 py-4">
              <CardTitle className="text-sm font-semibold">Recent bridge events</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4">
              {recentEvents.length === 0 ? (
                <p className="text-sm text-slate-500">No events yet.</p>
              ) : (
                recentEvents.map((event, index) => (
                  <div key={`${event.time}-${index}`} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] uppercase text-slate-500">{event.type}</span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {event.time ? new Date(event.time).toLocaleTimeString('en-US', { hour12: false }) : '—'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-700">{event.message}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 py-4">
              <CardTitle className="text-sm font-semibold">Recent command acks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4">
              {recentAcks.length === 0 ? (
                <p className="text-sm text-slate-500">No acknowledgements yet.</p>
              ) : (
                recentAcks.map((ack) => (
                  <div key={`${ack.commandId}-${ack.receivedAt}`} className="rounded-md border border-slate-100 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-slate-600">{ack.terminalId}</span>
                      <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-600">
                        {ack.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-700">
                      {ack.ticket ? `Ticket ${ack.ticket}` : ack.brokerMessage || 'Ack received'}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function MetricCard(props: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  tone: 'indigo' | 'teal' | 'violet' | 'slate' | 'amber';
}) {
  const Icon = props.icon;
  const toneClass = {
    indigo: 'text-indigo-700',
    teal: 'text-teal-600',
    violet: 'text-violet-600',
    slate: 'text-slate-600',
    amber: 'text-amber-600',
  }[props.tone];

  return (
    <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-normal uppercase tracking-wider text-slate-500">
          <Icon className={cn('h-3.5 w-3.5', toneClass)} />
          {props.label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-mono text-2xl text-slate-950">{props.value}</div>
        <p className="mt-2 text-xs text-slate-500">{props.detail}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge(props: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase',
        props.status === 'connected' && 'border-teal-200 bg-teal-50 text-teal-800',
        props.status === 'degraded' && 'border-amber-200 bg-amber-50 text-amber-800',
        props.status === 'disconnected' && 'border-rose-200 bg-rose-50 text-rose-800',
        !['connected', 'degraded', 'disconnected'].includes(props.status) && 'border-slate-200 bg-slate-50 text-slate-700',
      )}
    >
      {props.status}
    </span>
  );
}
