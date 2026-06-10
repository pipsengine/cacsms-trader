'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Menu,
  PlayCircle,
  RefreshCw,
  ScanSearch,
  Square,
  Workflow,
} from 'lucide-react';

import { AutonomousPipelineStageCard } from '@/components/autonomous-pipeline-stage-card';
import { PairSelectionLivePanel } from '@/components/pair-selection-live-panel';
import { ExecutionRiskSettingsPanel } from '@/components/execution-risk-settings-panel';
import { TraderSidebar } from '@/components/trader-sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  PIPELINE_STAGES,
  PIPELINE_STAGE_STATUS_META,
  type PipelineStageStatus,
} from '@/lib/autonomous-pipeline';
import { SYSTEM_FOCUS_SYMBOL_LABELS, SYSTEM_FOCUS_SYMBOLS } from '@/lib/focus-symbols';
import { cn } from '@/lib/utils';

interface PipelineStatusPayload {
  mode: string;
  activeSymbol: string;
  pairSelection: {
    selectedSymbol: string;
    selectedAt: string | null;
    source: string;
    session: string;
    openPositionSymbols?: string[];
    candidates: Array<{ symbol: string; compositeScore: number; tradable: boolean; rank: number }>;
  } | null;
  bridgeOnline: boolean;
  connectedTerminals: number;
  overallStatus: PipelineStageStatus;
  overallProgress: number;
  currentStage: string;
  sessionId: string | null;
  stages: Array<{
    id: string;
    order: number;
    label: string;
    shortLabel: string;
    description: string;
    status: PipelineStageStatus;
    detail: string;
    progress: number;
  }>;
  recentEvents: Array<{
    stageId: string;
    eventType: string;
    message: string;
    createdAt: string;
  }>;
  generatedAt: string;
  continuousSession?: {
    active: boolean;
    startedAt: string | null;
    stoppedAt: string | null;
  };
  symbolUniverse?: {
    mode: 'full_universe' | 'selection' | 'single';
    symbols: string[];
    scannedCount: number;
    tradableCount: number;
  };
  maintenance?: {
    at: string | null;
    trigger: string | null;
    targets: string[];
    dispatchesAttempted: number;
    openCount: number | null;
  } | null;
}

interface BridgeTerminal {
  terminalId: string;
  status: string;
}

export default function AutonomousPipelinePage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('AUTO');
  const [status, setStatus] = useState<PipelineStatusPayload | null>(null);
  const [terminals, setTerminals] = useState<BridgeTerminal[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const advanceInFlight = useRef(false);

  const stageDefinitions = useMemo(
    () =>
      PIPELINE_STAGES.map((stage) => {
        const live = status?.stages.find((item) => item.id === stage.id);
        return {
          ...stage,
          status: live?.status ?? 'not_started',
          detail: live?.detail ?? 'Waiting for pipeline status.',
          progress: live?.progress ?? 0,
        };
      }),
    [status],
  );

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const [statusResponse, terminalsResponse] = await Promise.all([
        fetch(`/api/autonomous-pipeline/status?symbol=${encodeURIComponent(symbol)}&advance=false`, { cache: 'no-store', signal: controller.signal }),
        fetch('/api/mt5/terminals', { cache: 'no-store', signal: controller.signal }),
      ]);
      const statusPayload = await statusResponse.json();
      const terminalsPayload = await terminalsResponse.json();
      if (!statusPayload.ok) throw new Error(statusPayload.error ?? 'Unable to load pipeline status.');
      setStatus(statusPayload.status);
      setTerminals(Array.isArray(terminalsPayload.terminals) ? terminalsPayload.terminals : []);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to load pipeline status.';
      setError(message.includes('abort') ? 'Pipeline status timed out. Refresh to try again.' : message);
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    loadStatus();
    const interval = window.setInterval(loadStatus, 15_000);
    return () => window.clearInterval(interval);
  }, [loadStatus]);

  useEffect(() => {
    const runAdvance = async () => {
      if (advanceInFlight.current) return;
      advanceInFlight.current = true;
      try {
        await fetch('/api/autonomous-pipeline/advance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol }),
          cache: 'no-store',
        });
        await loadStatus();
      } catch {
        // advance retries on the next tick
      } finally {
        advanceInFlight.current = false;
      }
    };

    void runAdvance();
    const interval = window.setInterval(runAdvance, 45_000);
    return () => window.clearInterval(interval);
  }, [symbol, loadStatus]);

  const resetPipeline = async () => {
    setResetting(true);
    setError(null);
    try {
      const response = await fetch('/api/autonomous-pipeline/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Unable to reset pipeline.');
      setStatus(payload.status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reset pipeline.');
    } finally {
      setResetting(false);
      await loadStatus();
    }
  };

  const startSession = async () => {
    const connected = terminals.find((terminal) => terminal.status === 'connected');
    if (!connected) {
      setError('No connected MT5 terminal. Attach the EA to a demo chart first.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const response = await fetch('/api/autonomous-pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, terminalId: connected.terminalId }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Unable to start top-down session.');
      setStatus(payload.status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to start top-down session.');
    } finally {
      setStarting(false);
      await loadStatus();
    }
  };

  const overallMeta = PIPELINE_STAGE_STATUS_META[status?.overallStatus ?? 'not_started'];

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <TraderSidebar
        bridgeOnline={Boolean(status?.bridgeOnline)}
        mobileOpen={mobileSidebarOpen}
        onMobileOpenChange={setMobileSidebarOpen}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-20 shrink-0 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex items-center justify-between gap-4 px-4 py-4 lg:px-8">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div>
                <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500">Autonomous Trading Pipeline</p>
                <h1 className="text-xl font-semibold text-slate-950">Pipeline Command Center</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="AUTO">Auto (all {SYSTEM_FOCUS_SYMBOLS.length} focus symbols)</option>
                {SYSTEM_FOCUS_SYMBOLS.map((focusSymbol) => (
                  <option key={focusSymbol} value={focusSymbol}>
                    {SYSTEM_FOCUS_SYMBOL_LABELS[focusSymbol]} ({focusSymbol})
                  </option>
                ))}
              </select>
              <Button variant="outline" onClick={loadStatus} disabled={loading || resetting}>
                <RefreshCw className={cn('mr-2 h-4 w-4', (loading || resetting) && 'animate-spin')} />
                Refresh
              </Button>
              <Button variant="outline" onClick={resetPipeline} disabled={resetting || loading}>
                {resetting ? 'Resetting…' : 'Reset pipeline'}
              </Button>
              <Button onClick={startSession} disabled={starting}>
                <PlayCircle className="mr-2 h-4 w-4" />
                {starting ? 'Starting…' : 'Start Top-Down Session'}
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 space-y-6 overflow-auto bg-white px-4 py-6 lg:px-8">
          {error ? (
            <Card className="border-rose-200 bg-rose-50">
              <CardContent className="py-4 text-sm text-rose-700">{error}</CardContent>
            </Card>
          ) : null}

          {status && !status.continuousSession?.active ? (
            <Card className="border-amber-200 bg-amber-50 shadow-sm">
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-amber-950">Continuous trading session is stopped</p>
                  <p className="mt-1 text-xs text-amber-800">
                    Pipeline scans and new entries are paused until you start the session from the command center home page.
                  </p>
                </div>
                <Link
                  href="/"
                  className={cn(
                    'inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700',
                  )}
                >
                  <PlayCircle className="h-4 w-4" />
                  Start on home page
                </Link>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-xs font-normal uppercase tracking-wider text-slate-500">
                  <Workflow className="h-3.5 w-3.5 text-violet-600" />
                  Overall pipeline
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <span className={cn('h-2.5 w-2.5 rounded-full', overallMeta.dot)} />
                  <span className={cn('text-sm font-medium', overallMeta.text)}>{overallMeta.label}</span>
                </div>
                <p className="mt-2 text-2xl font-mono text-slate-950">{status?.overallProgress ?? 0}%</p>
                <Progress value={status?.overallProgress ?? 0} className="mt-3 h-2" />
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-normal uppercase tracking-wider text-slate-500">Mode</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-mono uppercase text-slate-950">{status?.mode ?? 'full_auto'}</p>
                <p className="mt-2 text-xs text-slate-500">Fully autonomous — no human input required.</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-normal uppercase tracking-wider text-slate-500">Selected pair</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-mono text-slate-950">{status?.activeSymbol ?? '—'}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {symbol === 'AUTO'
                    ? `Autonomous pick${status?.pairSelection?.session ? ` · ${status.pairSelection.session} session` : ''}`
                    : 'Manual override'}
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-normal uppercase tracking-wider text-slate-500">MT5 bridge</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-mono text-slate-950">{status?.connectedTerminals ?? 0}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {status?.bridgeOnline ? 'Bridge online' : 'Bridge offline'} / connected terminals
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-xs font-normal uppercase tracking-wider text-slate-500">
                  <Activity className="h-3.5 w-3.5 text-teal-600" />
                  Active stage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium text-slate-900">
                  {stageDefinitions.find((stage) => stage.id === status?.currentStage)?.label ?? 'Terminal Connectivity'}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Session: {status?.sessionId ? `${status.sessionId.slice(0, 8)}…` : 'none'}
                </p>
              </CardContent>
            </Card>
          </div>

          <PairSelectionLivePanel />

          {status?.symbolUniverse ? (
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <ScanSearch className="h-4 w-4 text-blue-600" />
                  Symbol universe scan
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    {status.symbolUniverse.mode === 'full_universe' ? '16-symbol institutional' : status.symbolUniverse.mode}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-slate-600">
                  {status.symbolUniverse.scannedCount} ranked
                  {' · '}
                  {status.symbolUniverse.tradableCount} tradable
                  {' · '}
                  {status.symbolUniverse.symbols.length} advancing through pipeline this cycle
                  {status.maintenance?.at
                    ? ` · last refill ${status.maintenance.dispatchesAttempted} dispatch(es)`
                    : ''}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                  {SYSTEM_FOCUS_SYMBOLS.map((focusSymbol) => {
                    const candidate = status.pairSelection?.candidates.find((item) => item.symbol === focusSymbol);
                    const inUniverse = status.symbolUniverse?.symbols.includes(focusSymbol);
                    const isSelected = status.pairSelection?.selectedSymbol === focusSymbol;
                    const isOpen = status.pairSelection?.openPositionSymbols?.includes(focusSymbol);
                    return (
                      <div
                        key={focusSymbol}
                        className={cn(
                          'rounded-md border px-2 py-2 text-center',
                          isSelected
                            ? 'border-emerald-300 bg-emerald-50'
                            : isOpen
                              ? 'border-blue-200 bg-blue-50'
                              : candidate?.tradable
                                ? 'border-violet-200 bg-violet-50'
                                : inUniverse
                                  ? 'border-slate-200 bg-slate-50'
                                  : 'border-slate-100 bg-white opacity-60',
                        )}
                      >
                        <p className="font-mono text-xs font-semibold text-slate-900">{focusSymbol}</p>
                        <p className="mt-1 text-[10px] text-slate-500">
                          {isSelected ? 'Selected' : isOpen ? 'Open' : candidate?.tradable ? `Score ${candidate.compositeScore}` : candidate ? 'Filtered' : inUniverse ? 'Queued' : '—'}
                        </p>
                      </div>
                    );
                  })}
                </div>
                {status.continuousSession?.active ? (
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
                    <Activity className="h-3 w-3 animate-pulse" />
                    Session live — scheduler refills uncorrelated positions every ~60s until daily drawdown limit.
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700">
                    <Square className="h-3 w-3" />
                    Session stopped — scans visible but new entries blocked.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}

          <ExecutionRiskSettingsPanel />

          {status?.pairSelection?.candidates?.length ? (
            <Card id="pair-selection" className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-slate-900">Pair selection ranking</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {status.pairSelection.candidates.map((candidate) => (
                    <div
                      key={candidate.symbol}
                      className={cn(
                        'rounded-md border px-3 py-2',
                        candidate.symbol === status.pairSelection?.selectedSymbol
                          ? 'border-emerald-200 bg-emerald-50'
                          : 'border-slate-200 bg-slate-50',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-sm font-medium text-slate-900">{candidate.symbol}</p>
                        <p className="font-mono text-xs text-slate-500">#{candidate.rank}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">Score {candidate.compositeScore}</p>
                      <p className="text-[11px] text-slate-500">{candidate.tradable ? 'Tradable' : 'Filtered'}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {(['not_started', 'in_progress', 'completed'] as PipelineStageStatus[]).map((item) => {
              const meta = PIPELINE_STAGE_STATUS_META[item];
              const count = stageDefinitions.filter((stage) => stage.status === item).length;
              return (
                <div key={item} className={cn('rounded-lg border px-3 py-2', meta.border, meta.bg)}>
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
                    <span className={cn('text-xs font-medium', meta.text)}>{meta.label}</span>
                  </div>
                  <p className="mt-1 font-mono text-lg text-slate-900">{count}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {stageDefinitions.map((stage) => (
              <AutonomousPipelineStageCard
                key={stage.id}
                id={stage.id}
                order={stage.order}
                label={stage.label}
                description={stage.description}
                status={stage.status}
                detail={stage.detail}
                progress={stage.progress}
                icon={stage.icon}
                primaryHref={stage.primaryHref}
                primaryLabel={stage.primaryLabel}
                relatedTools={stage.relatedTools}
              />
            ))}
          </div>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-slate-900">Recent pipeline events</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-56 pr-3">
                <div className="space-y-3">
                  {(status?.recentEvents ?? []).length === 0 ? (
                    <p className="text-sm text-slate-500">No pipeline events yet. Start a top-down session to begin.</p>
                  ) : (
                    status?.recentEvents.map((event, index) => (
                      <div key={`${event.createdAt}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-mono uppercase text-slate-500">{event.stageId}</p>
                          <p className="text-[11px] text-slate-400">{new Date(event.createdAt).toLocaleString()}</p>
                        </div>
                        <p className="mt-1 text-sm text-slate-700">{event.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
