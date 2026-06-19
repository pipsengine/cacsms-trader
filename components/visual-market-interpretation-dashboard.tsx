'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  BrainCircuit,
  CheckCircle2,
  GitBranch,
  Landmark,
  LineChart,
  Menu,
  Radar,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import { DashboardPageFrame } from '@/components/dashboard-page-frame';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  type DashboardTone,
  toneBody,
  toneCard,
  toneCardHeader,
  toneInsetSurface,
  toneMetric,
  toneMuted,
  toneProgress,
  toneTitle,
} from '@/lib/dashboard-card-tones';
import { SYSTEM_FOCUS_SYMBOL_LABELS } from '@/lib/focus-symbols';
import { cn } from '@/lib/utils';

const TIMEFRAMES = ['MN', 'W', 'D', 'H4', 'H1', 'M15'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
type Decision = 'BUY' | 'SELL' | 'WAIT' | 'AVOID' | 'MONITOR';
type Bias = 'bullish' | 'bearish' | 'neutral' | 'mixed';

type Interpretation = {
  id: string;
  symbol: string;
  timeframe: string;
  dominantTimeframe: string;
  finalMarketBias: Bias;
  institutionalInterpretation: string;
  liquidityObjective: string;
  marketPhase: string;
  setupReadinessScore: number;
  finalDecision: Decision;
  confidenceScore: number;
  entryReadiness: string;
  invalidationCondition: string;
  riskWarning: string;
  fullNarrative: string;
  retailTrapWarning?: string;
  previousInterpretation: Record<string, unknown>;
  timeframeStates: Array<{ timeframe: string; bias: Bias; controlScore: number; confirmsEntry: boolean; narrative: string }>;
  decisionScores: Record<string, number>;
  auditTrail: Array<{ stage: string; finding: string; score: number }>;
  signals: Array<{ name: string; weight: number; bias: Bias; confidence: number; confirmsEntry: boolean; narrative: string }>;
  createdAt?: string;
  updatedAt?: string;
};

type TimeframeReadiness = {
  timeframe: Timeframe;
  captureId: string | null;
  candleCount: number;
  hasCapture: boolean;
  hasMtfSnapshot: boolean;
  hasAiInterpretation: boolean;
  hasAnomalyScan: boolean;
  hasSegmentation: boolean;
  readyForFusion: boolean;
};

type Readiness = {
  symbol: string;
  signalTimeframe: Timeframe;
  interpretationCount: number;
  latestInterpretationAt: string | null;
  finalDecision: string | null;
  setupReadinessScore: number;
  confidenceScore: number;
  dominantTimeframe: string | null;
  timeframes: TimeframeReadiness[];
};

type AutonomyStatus = {
  summary?: {
    queuedJobs: number;
    runningJobs: number;
    recentFailures: number;
    openAlerts: number;
    nextRunAt: string | null;
  };
  health?: Array<{ status: string; emergencyStopped: boolean; message: string }>;
};

export function VisualMarketInterpretationDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [pipelineMode, setPipelineMode] = useState('full_auto');
  const [activeSymbols, setActiveSymbols] = useState<string[]>(['XAUUSD']);
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [autonomy, setAutonomy] = useState<AutonomyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const [tickSequence, setTickSequence] = useState(0);
  const [clockNow, setClockNow] = useState(() => new Date());

  const signalTimeframe = readiness?.signalTimeframe ?? interpretation?.timeframe ?? 'M15';
  const decisionTone = toneForDecision(interpretation?.finalDecision);
  const biasTone = toneForBias(interpretation?.finalMarketBias);

  const tfStates = useMemo(() => {
    const map = new Map((interpretation?.timeframeStates ?? []).map((state) => [state.timeframe, state]));
    return TIMEFRAMES.map((item) => map.get(item) ?? {
      timeframe: item,
      bias: 'neutral' as Bias,
      controlScore: 0,
      confirmsEntry: false,
      narrative: 'Awaiting autonomous fusion inputs.',
    });
  }, [interpretation]);

  const loadRegistry = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const pipelineResponse = await fetch('/api/autonomous-pipeline/status?advance=false&symbol=AUTO', { cache: 'no-store' });
      const pipelinePayload = await pipelineResponse.json().catch(() => null);
      const pipelineSymbol = String(
        pipelinePayload?.status?.activeSymbol
        ?? pipelinePayload?.status?.pairSelection?.selectedSymbol
        ?? symbol,
      ).toUpperCase();
      const pipelineSymbols = Array.isArray(pipelinePayload?.status?.activeSymbols)
        ? pipelinePayload.status.activeSymbols.map((item: string) => String(item).toUpperCase())
        : [pipelineSymbol];
      setSymbol(pipelineSymbol);
      setActiveSymbols(pipelineSymbols);
      setPipelineMode(String(pipelinePayload?.status?.mode ?? 'full_auto'));
      if (pipelinePayload?.status?.bridgeOnline != null) {
        setBridgeOnline(Boolean(pipelinePayload.status.bridgeOnline));
      }

      const [coverageResponse, latestResponse, autonomyResponse, tickResponse] = await Promise.all([
        fetch(`/api/visual-analysis/market-interpretation/coverage?symbol=${encodeURIComponent(pipelineSymbol)}`, { cache: 'no-store' }),
        fetch(`/api/visual-analysis/market-interpretation/${encodeURIComponent(pipelineSymbol)}`, { cache: 'no-store' }),
        fetch('/api/autonomy/status', { cache: 'no-store' }),
        fetch('/api/dashboard/tick', { cache: 'no-store' }),
      ]);

      const coveragePayload = await coverageResponse.json();
      if (coveragePayload.ok) {
        setReadiness(coveragePayload.readiness as Readiness);
      }

      if (latestResponse.ok) {
        const latestPayload = await latestResponse.json();
        setInterpretation(latestPayload.interpretation as Interpretation);
      } else {
        setInterpretation(null);
      }

      const autonomyPayload = await autonomyResponse.json().catch(() => null);
      if (autonomyPayload?.ok) {
        setAutonomy(autonomyPayload.status as AutonomyStatus);
      }

      const tickPayload = await tickResponse.json().catch(() => null);
      if (tickPayload?.ok && tickPayload.tick) {
        setLastTickAt(String(tickPayload.tick.tickAt));
        setTickSequence(Number(tickPayload.tick.sequence) || 0);
        setBridgeOnline(Boolean(tickPayload.tick.bridge?.online));
      }
      setLastSyncAt(new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load visual market interpretation.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [symbol]);

  useEffect(() => {
    void loadRegistry(true);
    const interval = window.setInterval(() => void loadRegistry(false), 15000);
    return () => window.clearInterval(interval);
  }, [loadRegistry]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const source = new EventSource('/api/visual-intelligence/stream');
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { eventType?: string; payload?: Record<string, unknown> };
        if (!event.eventType?.startsWith('market.interpretation.')) return;
        const eventSymbol = String(event.payload?.symbol ?? '').toUpperCase();
        if (eventSymbol && eventSymbol !== symbol.toUpperCase()) return;
        void loadRegistry(false);
      } catch {
        // ignore malformed stream chunks
      }
    };
    return () => source.close();
  }, [loadRegistry, symbol]);

  const fusionReadyCount = readiness?.timeframes.filter((item) => item.readyForFusion).length ?? 0;

  return (
    <DashboardPageFrame bridgeOnline={bridgeOnline} mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen}>
      <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white px-4 py-4 md:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button size="icon" variant="outline" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-700">Final visual decision layer</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">Visual Market Interpretation</h1>
                <p className="truncate text-xs font-mono text-slate-500">
                  WAT {formatWatClock(clockNow)} · Tick #{tickSequence || '—'} {formatRelativeTime(lastTickAt, clockNow)}
                  {' · '}Synced {formatRelativeTime(lastSyncAt, clockNow)}{refreshing ? ' · updating…' : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-violet-700">Autonomous monitor</p>
                <p className="font-mono text-xs font-semibold text-slate-900">
                  {SYSTEM_FOCUS_SYMBOL_LABELS[symbol as keyof typeof SYSTEM_FOCUS_SYMBOL_LABELS] ?? symbol} ({symbol}) · {signalTimeframe}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <p className="flex items-center gap-1.5 font-semibold text-slate-800">
                  <Bot className="h-3.5 w-3.5" />
                  {pipelineMode.replaceAll('_', ' ')}
                </p>
                <p className="mt-1 font-mono">{activeSymbols.slice(0, 4).join(', ') || symbol}</p>
              </div>
              <Link href="/autonomous-pipeline" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <Activity className="h-4 w-4" />
                Pipeline
              </Link>
              <Link href="/visual-intelligence-overview/ai-visual-interpretation" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <BrainCircuit className="h-4 w-4" />
                Visual AI
              </Link>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-white p-4 md:p-6">
          {error ? (
            <Card className="mb-4 border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </CardContent>
            </Card>
          ) : null}

          <section className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard tone={decisionTone} icon={Target} label="Decision" value={interpretation?.finalDecision ?? '—'} detail={interpretation?.entryReadiness ?? 'Awaiting pipeline fusion'} />
            <MetricCard tone={biasTone} icon={interpretation?.finalMarketBias === 'bearish' ? TrendingDown : TrendingUp} label="Bias" value={interpretation?.finalMarketBias ?? '—'} detail={interpretation?.dominantTimeframe ? `${interpretation.dominantTimeframe} controls` : 'Pending'} />
            <MetricCard tone="emerald" icon={Activity} label="Readiness" value={interpretation ? `${Math.round(interpretation.setupReadinessScore)}%` : '—'} detail="Setup readiness score" />
            <MetricCard tone="blue" icon={Radar} label="Confidence" value={interpretation ? `${Math.round(interpretation.confidenceScore)}%` : '—'} detail={`${fusionReadyCount}/6 frames fusion-ready`} />
          </section>

          <Panel icon={GitBranch} title="Autonomous fusion ladder (W → M15)" tone="violet">
            <div className="grid gap-2 md:grid-cols-5">
              {TIMEFRAMES.map((tf) => {
                const item = readiness?.timeframes.find((entry) => entry.timeframe === tf);
                const active = interpretation?.dominantTimeframe === tf || signalTimeframe === tf;
                const rowTone: DashboardTone = active
                  ? 'violet'
                  : item?.readyForFusion
                    ? 'emerald'
                    : item?.hasCapture
                      ? 'blue'
                      : 'slate';
                const modules = [
                  item?.hasMtfSnapshot ? 'MTF' : null,
                  item?.hasAiInterpretation ? 'AI' : null,
                  item?.hasSegmentation ? 'SEG' : null,
                  item?.hasAnomalyScan ? 'ANOM' : null,
                ].filter(Boolean).join(' · ');
                return (
                  <div key={tf} className={cn('rounded-lg border px-3 py-3', toneMetric(rowTone))}>
                    <p className={cn('font-mono text-lg font-bold', toneTitle(rowTone))}>{tf}</p>
                    <p className={cn('mt-1 text-[10px] font-bold uppercase', toneMuted(rowTone))}>
                      {!item?.hasCapture ? 'Awaiting capture' : !item.readyForFusion ? 'Building inputs' : 'Fusion ready'}
                    </p>
                    <p className={cn('mt-2 text-[11px]', toneBody(rowTone))}>
                      {modules || '—'} · {item?.candleCount ?? 0} candles
                    </p>
                  </div>
                );
              })}
            </div>
            <p className={cn('mt-3 text-xs', toneMuted('violet'))}>
              Pipeline fuses visual outputs on {signalTimeframe} · latest {formatRelativeTime(readiness?.latestInterpretationAt ?? null, clockNow)}
            </p>
          </Panel>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_410px]">
            <section className="space-y-4">
              <Card className={cn('shadow-sm', toneCard('blue'))}>
                <CardHeader className={cn('border-b', toneCardHeader('blue'))}>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BrainCircuit className="h-5 w-5 text-blue-600" /> Market interpretation summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <p className="whitespace-pre-line text-sm leading-6 text-slate-600">
                    {interpretation?.fullNarrative ?? 'Awaiting autonomous pipeline fusion once visual-analysis inputs are ready.'}
                  </p>
                </CardContent>
              </Card>

              <Card className={cn('shadow-sm', toneCard('purple'))}>
                <CardHeader className={cn('border-b', toneCardHeader('purple'))}>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <GitBranch className="h-5 w-5 text-purple-600" /> Five-timeframe control panel
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 p-4 md:grid-cols-5">
                  {tfStates.map((state) => (
                    <div
                      key={state.timeframe}
                      className={cn(
                        'rounded-lg border p-3',
                        toneInsetSurface(toneForBias(state.bias)),
                        state.timeframe === interpretation?.dominantTimeframe && 'ring-2 ring-blue-500',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-lg font-semibold text-slate-950">{state.timeframe}</p>
                        {state.confirmsEntry ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}
                      </div>
                      <p className={cn('mt-1 text-xs font-semibold uppercase', toneTitle(toneForBias(state.bias)))}>{state.bias}</p>
                      <Progress value={state.controlScore} className={cn('mt-3 h-1.5', toneProgress('blue'))} />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <NarrativeCard icon={GitBranch} title="Dominant timeframe" tone="blue" text={`${interpretation?.dominantTimeframe ?? '—'} is controlling the final visual decision context. Lower timeframe evidence is treated as entry confirmation only when it aligns with this control state.`} />
                <NarrativeCard icon={Landmark} title="Institutional bias" tone={biasTone} text={interpretation?.institutionalInterpretation ?? 'Institutional bias pending pipeline fusion.'} />
                <NarrativeCard icon={Sparkles} title="Retail behaviour" tone="orange" text={interpretation?.retailTrapWarning ?? interpretation?.signals.find((signal) => signal.name === 'Liquidity condition')?.narrative ?? 'Retail behaviour pending liquidity and trap context.'} />
                <NarrativeCard icon={Radar} title="Liquidity roadmap" tone="blue" text={interpretation?.liquidityObjective ?? 'Liquidity objective pending.'} />
                <NarrativeCard icon={GitBranch} title="Market phase map" tone="purple" text={interpretation?.marketPhase ?? 'Market phase pending.'} />
                <NarrativeCard icon={ShieldAlert} title="Risk and invalidation" tone="rose" text={`${interpretation?.riskWarning ?? 'Risk pending.'}\n\n${interpretation?.invalidationCondition ?? ''}`} />
                <NarrativeCard icon={BrainCircuit} title="Previous interpretation comparison" tone="slate" text={previousText(interpretation)} />
              </div>
            </section>

            <aside className="space-y-4">
              <AutonomyCard status={autonomy} />
              <DecisionCard interpretation={interpretation} tone={decisionTone} />
              <ReadinessCard interpretation={interpretation} />

              <Card className={cn('shadow-sm', toneCard('blue'))}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-5 w-5 text-blue-600" /> Confidence breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(interpretation?.signals ?? []).map((signal) => (
                    <Meter key={signal.name} label={signal.name} value={signal.confidence * 100} tone={toneForBias(signal.bias)} />
                  ))}
                  {!interpretation?.signals.length ? <p className="text-sm text-slate-500">No confidence breakdown available yet.</p> : null}
                </CardContent>
              </Card>

              <Card className={cn('shadow-sm', toneCard('purple'))}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-5 w-5 text-purple-600" /> Decision audit trail
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[330px] pr-3">
                    <div className="space-y-3">
                      {(interpretation?.auditTrail ?? []).map((item) => (
                        <div key={item.stage} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-950">{item.stage}</p>
                            <span className="font-mono text-xs text-blue-700">{Math.round(item.score)}</span>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-slate-600">{item.finding}</p>
                        </div>
                      ))}
                      {!interpretation?.auditTrail.length ? <p className="text-sm text-slate-500">No decision audit trail generated yet.</p> : null}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </aside>
          </div>
        </main>
      </div>
    </DashboardPageFrame>
  );
}

function AutonomyCard({ status }: { status: AutonomyStatus | null }) {
  const emergencyStopped = status?.health?.some((item) => item.emergencyStopped) ?? false;
  return (
    <Card className={cn('shadow-sm', toneCard(emergencyStopped ? 'rose' : 'emerald'))}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className={cn('h-5 w-5', emergencyStopped ? 'text-rose-600' : 'text-emerald-600')} /> Autonomous runtime
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm">
        <MiniStat label="Running jobs" value={String(status?.summary?.runningJobs ?? 0)} />
        <MiniStat label="Queued jobs" value={String(status?.summary?.queuedJobs ?? 0)} />
        <MiniStat label="Open alerts" value={String(status?.summary?.openAlerts ?? 0)} />
        <MiniStat label="Failures" value={String(status?.summary?.recentFailures ?? 0)} />
        <div className="col-span-2 rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Next autonomous run</p>
          <p className="mt-1 truncate font-mono text-xs font-semibold text-slate-900">{status?.summary?.nextRunAt ?? 'syncing'}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function DecisionCard({ interpretation, tone }: { interpretation: Interpretation | null; tone: DashboardTone }) {
  return (
    <Card className={cn('shadow-sm', toneCard(tone))}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className={cn('h-5 w-5', toneTitle(tone))} /> Trade action recommendation
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-4xl font-semibold text-slate-950">{interpretation?.finalDecision ?? '--'}</p>
        <p className="mt-3 text-sm leading-6 text-slate-700">{interpretation?.entryReadiness ?? 'Entry readiness pending pipeline fusion.'}</p>
      </CardContent>
    </Card>
  );
}

function ReadinessCard({ interpretation }: { interpretation: Interpretation | null }) {
  return (
    <Card className={cn('shadow-sm', toneCard('emerald'))}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-5 w-5 text-emerald-600" /> Setup readiness score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Meter label="Setup readiness" value={interpretation?.setupReadinessScore ?? 0} tone="emerald" />
        <Meter label="Confidence" value={interpretation?.confidenceScore ?? 0} tone="blue" />
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600">{interpretation?.riskWarning ?? 'Risk state pending.'}</div>
      </CardContent>
    </Card>
  );
}

function NarrativeCard(props: { icon: LucideIcon; title: string; tone: DashboardTone; text: string }) {
  const Icon = props.icon;
  return (
    <Card className={cn('shadow-sm', toneCard('slate'))}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={cn('h-5 w-5', toneTitle(props.tone))} /> {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-line text-sm leading-6 text-slate-600">{props.text}</p>
      </CardContent>
    </Card>
  );
}

function Panel(props: { icon: LucideIcon; title: string; tone: DashboardTone; children: ReactNode }) {
  const Icon = props.icon;
  return (
    <Card className={cn('shadow-sm', toneCard(props.tone))}>
      <CardHeader className={cn('border-b', toneCardHeader(props.tone))}>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-5 w-5" />
          {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">{props.children}</CardContent>
    </Card>
  );
}

function MetricCard(props: { icon: LucideIcon; label: string; value: string; detail: string; tone: DashboardTone }) {
  const Icon = props.icon;
  return (
    <Card className={cn('shadow-sm', toneCard(props.tone))}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', toneTitle(props.tone))} />
          <p className={cn('text-xs font-semibold uppercase tracking-wide', toneMuted(props.tone))}>{props.label}</p>
        </div>
        <p className={cn('mt-2 font-mono text-2xl font-bold', toneTitle(props.tone))}>{props.value}</p>
        <p className={cn('mt-1 text-xs', toneBody(props.tone))}>{props.detail}</p>
      </CardContent>
    </Card>
  );
}

function Meter(props: { label: string; value: number; tone: DashboardTone }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-600">{props.label}</span>
        <span className={cn('font-mono font-semibold', toneTitle(props.tone))}>{Math.round(props.value)}%</span>
      </div>
      <Progress value={props.value} className={cn('h-2 bg-slate-100', toneProgress(props.tone))} />
    </div>
  );
}

function previousText(interpretation: Interpretation | null) {
  const previous = interpretation?.previousInterpretation;
  if (!previous || !Object.keys(previous).length) return 'No previous interpretation is available for comparison yet.';
  return `Previous decision: ${String(previous.decision ?? '--')}. Previous confidence: ${String(previous.confidence ?? '--')}. Created at: ${String(previous.createdAt ?? '--')}.`;
}

function toneForDecision(decision?: string): DashboardTone {
  if (decision === 'BUY') return 'emerald';
  if (decision === 'SELL') return 'rose';
  if (decision === 'AVOID') return 'orange';
  if (decision === 'MONITOR') return 'purple';
  return 'blue';
}

function toneForBias(bias?: string): DashboardTone {
  if (bias === 'bullish') return 'emerald';
  if (bias === 'bearish') return 'rose';
  if (bias === 'mixed') return 'orange';
  return 'blue';
}

function formatWatClock(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function formatRelativeTime(value: string | null, now: Date) {
  if (!value) return '—';
  const delta = Math.max(0, now.getTime() - new Date(value).getTime());
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
}
