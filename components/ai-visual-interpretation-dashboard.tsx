'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  GitBranch,
  Landmark,
  Layers3,
  LineChart,
  Menu,
  Network,
  Play,
  Radar,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import { CaptureChartPreview } from '@/components/capture-chart-preview';
import { DashboardPageFrame } from '@/components/dashboard-page-frame';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { resolveCaptureDisplayUrl } from '@/lib/capture-display';
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
import { SYSTEM_FOCUS_SYMBOL_LABELS, SYSTEM_FOCUS_SYMBOLS } from '@/lib/focus-symbols';
import type { ReconstructedCandle } from '@/lib/visual-intelligence-types';
import { cn } from '@/lib/utils';

const TIMEFRAMES = ['W', 'D', 'H4', 'H1', 'M15'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
type Decision = 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
type Bias = 'bullish' | 'bearish' | 'neutral' | 'mixed';

type Interpretation = {
  id: string;
  captureId: string;
  symbol: string;
  timeframe: string;
  imageUrl: string | null;
  title: string;
  fullExplanation: string;
  dominantBias: Bias;
  institutionalBehavior: string;
  institutionalNarrative: string;
  retailTrapWarning: string;
  liquidityNarrative: string;
  marketStructureNarrative: string;
  confidenceScore: number;
  marketClarityScore: number;
  setupQualityScore: number;
  decision: Decision;
  entryLogic: string;
  invalidationLogic: string;
  riskWarning: string;
  dominantStory: string;
  higherTimeframeContext: string;
  trapRiskScore?: number;
  signalEntropy?: number;
  algorithmStack?: string[];
  rankedStructures: Array<{ label: string; score: number; narrative: string }>;
  reasoningTimeline: Array<{ stage: string; summary: string; score: number; practitionerNote?: string }>;
  components: Array<{ name: string; weight: number; bias: Bias; score: number; confidence: number; summary: string; evidence: string[] }>;
  createdAt: string;
};

type Readiness = {
  timeframe: Timeframe;
  captureId: string | null;
  hasCapture: boolean;
  interpretationCount: number;
  readyForInterpretation: boolean;
};

export function AiVisualInterpretationDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('H1');
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [readiness, setReadiness] = useState<Readiness[]>([]);
  const [candles, setCandles] = useState<ReconstructedCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const [tickSequence, setTickSequence] = useState(0);
  const [clockNow, setClockNow] = useState(() => new Date());

  const activeReadiness = readiness.find((item) => item.timeframe === timeframe);
  const canRun = Boolean(activeReadiness?.readyForInterpretation);
  const displayImage = interpretation?.imageUrl ?? '';
  const chartImage = resolveCaptureDisplayUrl({ imageUrl: displayImage }) ?? '';

  const loadCaptureBundle = useCallback(async (captureId: string) => {
    try {
      const response = await fetch(`/api/visual-intelligence/captures/${encodeURIComponent(captureId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setCandles([]);
        return;
      }
      setCandles(Array.isArray(payload.analysis?.candles) ? payload.analysis.candles as ReconstructedCandle[] : []);
    } catch {
      setCandles([]);
    }
  }, []);

  const loadRegistry = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [latestResponse, coverageResponse, tickResponse] = await Promise.all([
        fetch(`/api/visual-analysis/interpretation/${encodeURIComponent(symbol)}/${encodeURIComponent(timeframe)}/latest`, { cache: 'no-store' }),
        fetch(`/api/visual-analysis/interpretation/coverage?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' }),
        fetch('/api/dashboard/tick', { cache: 'no-store' }),
      ]);
      const coveragePayload = await coverageResponse.json();
      if (coveragePayload.ok) {
        setReadiness(Array.isArray(coveragePayload.readiness) ? coveragePayload.readiness as Readiness[] : []);
      }
      if (latestResponse.ok) {
        const latestPayload = await latestResponse.json();
        const record = latestPayload.interpretation as Interpretation;
        setInterpretation(record);
        if (record.captureId) void loadCaptureBundle(record.captureId);
      } else {
        setInterpretation(null);
        const tfReady = coveragePayload.readiness?.find((item: Readiness) => item.timeframe === timeframe);
        if (tfReady?.captureId) void loadCaptureBundle(tfReady.captureId);
      }
      const tickPayload = await tickResponse.json().catch(() => null);
      if (tickPayload?.ok && tickPayload.tick) {
        setLastTickAt(String(tickPayload.tick.tickAt));
        setTickSequence(Number(tickPayload.tick.sequence) || 0);
        setBridgeOnline(Boolean(tickPayload.tick.bridge?.online));
      }
      setLastSyncAt(new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load AI visual interpretation.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadCaptureBundle, symbol, timeframe]);

  const runInterpretation = useCallback(async (regenerate = false) => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(regenerate ? '/api/visual-analysis/interpretation/regenerate' : '/api/visual-analysis/interpretation/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe, captureId: activeReadiness?.captureId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(String(payload.error ?? 'Interpretation failed.'));
      }
      const record = payload.interpretation as Interpretation;
      setInterpretation(record);
      if (record.captureId) await loadCaptureBundle(record.captureId);
      await loadRegistry(false);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Interpretation failed.');
    } finally {
      setRunning(false);
    }
  }, [activeReadiness?.captureId, canRun, loadCaptureBundle, loadRegistry, symbol, timeframe]);

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
        if (!event.eventType?.startsWith('interpretation.')) return;
        const eventSymbol = String(event.payload?.symbol ?? '').toUpperCase();
        if (eventSymbol && eventSymbol !== symbol.toUpperCase()) return;
        void loadRegistry(false);
      } catch {
        // ignore malformed stream chunks
      }
    };
    return () => source.close();
  }, [loadRegistry, symbol]);

  const decisionTone = toneForDecision(interpretation?.decision);
  const biasTone = toneForBias(interpretation?.dominantBias);
  const readyCount = readiness.filter((item) => item.readyForInterpretation).length;
  const interpretedCount = readiness.filter((item) => item.interpretationCount > 0).length;

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
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-purple-700">Hybrid visual reasoner</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">AI Visual Interpretation</h1>
                <p className="truncate text-xs font-mono text-slate-500">
                  WAT {formatWatClock(clockNow)} · Tick #{tickSequence || '—'} {formatRelativeTime(lastTickAt, clockNow)}
                  {' · '}Synced {formatRelativeTime(lastSyncAt, clockNow)}{refreshing ? ' · updating…' : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm">
                {SYSTEM_FOCUS_SYMBOLS.map((item) => (
                  <option key={item} value={item}>{SYSTEM_FOCUS_SYMBOL_LABELS[item]} ({item})</option>
                ))}
              </select>
              <Button variant="outline" size="sm" onClick={() => void loadRegistry(false)} disabled={loading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', (loading || refreshing) && 'animate-spin')} />
                Refresh
              </Button>
              <Button size="sm" onClick={() => void runInterpretation(Boolean(interpretation))} disabled={!canRun || running}>
                <Play className={cn('mr-2 h-4 w-4', running && 'animate-pulse')} />
                {running ? 'Reasoning…' : interpretation ? 'Regenerate' : 'Run interpretation'}
              </Button>
              <Link href="/visual-intelligence-overview/chart-screenshot-capture" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <LineChart className="h-4 w-4" />
                Captures
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

          <Panel icon={Network} title="Top-down interpretation ladder (W → M15)" tone="purple">
            <div className="grid gap-2 md:grid-cols-5">
              {TIMEFRAMES.map((tf) => {
                const item = readiness.find((entry) => entry.timeframe === tf);
                const active = timeframe === tf;
                const rowTone: DashboardTone = active ? 'violet' : item?.interpretationCount ? 'emerald' : item?.hasCapture ? 'blue' : 'slate';
                return (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setTimeframe(tf)}
                    className={cn('rounded-lg border px-3 py-3 text-left', toneMetric(rowTone))}
                  >
                    <p className={cn('font-mono text-lg font-bold', toneTitle(rowTone))}>{tf}</p>
                    <p className={cn('mt-1 text-[10px] font-bold uppercase', toneMuted(rowTone))}>
                      {item?.interpretationCount ? 'Interpreted' : item?.hasCapture ? 'Capture ready' : 'No capture'}
                    </p>
                    <p className={cn('mt-2 text-[11px]', toneBody(rowTone))}>
                      {item?.interpretationCount ?? 0} interpretations
                    </p>
                  </button>
                );
              })}
            </div>
            <p className={cn('mt-3 text-xs', toneMuted('purple'))}>
              {readyCount}/5 frames have captures · {interpretedCount}/5 have persisted AI interpretations
            </p>
          </Panel>

          <section className="mb-4 mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <MetricCard tone="purple" icon={BrainCircuit} label="Decision" value={interpretation?.decision ?? '—'} detail={interpretation?.dominantStory ?? 'Run interpretation'} />
            <MetricCard tone={biasTone} icon={interpretation?.dominantBias === 'bearish' ? TrendingDown : TrendingUp} label="Bias" value={interpretation?.dominantBias ?? '—'} detail={interpretation?.institutionalBehavior ?? 'Pending'} />
            <MetricCard tone="emerald" icon={Target} label="Confidence" value={interpretation ? `${Math.round(interpretation.confidenceScore)}%` : '—'} detail="Bayesian fusion score" />
            <MetricCard tone="blue" icon={Radar} label="Clarity" value={interpretation ? `${Math.round(interpretation.marketClarityScore)}%` : '—'} detail="Cross-signal agreement" />
            <MetricCard tone={(interpretation?.trapRiskScore ?? 0) > 55 ? 'amber' : 'slate'} icon={ShieldAlert} label="Trap risk" value={interpretation ? `${interpretation.trapRiskScore ?? 0}%` : '—'} detail="Liquidity trap algorithm" />
            <MetricCard tone={(interpretation?.signalEntropy ?? 0) > 50 ? 'rose' : 'cyan'} icon={Activity} label="Entropy" value={interpretation ? `${interpretation.signalEntropy ?? 0}%` : '—'} detail="Signal disagreement index" />
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
            <section className="space-y-4">
              <Panel icon={LineChart} title={`Chart workspace · ${timeframe}`} tone="blue">
                <ChartWorkspace imageUrl={chartImage} candles={candles} interpretation={interpretation} loading={loading} />
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                <NarrativeCard icon={BrainCircuit} title="AI interpretation summary" tone="blue" text={interpretation?.fullExplanation ?? 'Select a timeframe with a capture, then run interpretation to fuse structure, liquidity, order blocks, and MTF context.'} />
                <NarrativeCard icon={GitBranch} title="Market structure narrative" tone="purple" text={interpretation?.marketStructureNarrative ?? 'Structure narrative pending analysis.'} />
                <NarrativeCard icon={Landmark} title="Institutional activity" tone="emerald" text={interpretation?.institutionalNarrative ?? 'Institutional behaviour inferred after signal fusion.'} />
                <NarrativeCard icon={ShieldAlert} title="Retail trap risk" tone="amber" text={interpretation?.retailTrapWarning ?? 'Trap-risk scan runs on liquidity and sweep evidence.'} />
                <NarrativeCard icon={Radar} title="Liquidity narrative" tone="blue" text={interpretation?.liquidityNarrative ?? 'Liquidity narrative pending.'} />
                <NarrativeCard icon={AlertTriangle} title="Risk warning" tone="rose" text={interpretation?.riskWarning ?? 'Risk warning generated during decision synthesis.'} />
              </div>

              <Panel icon={Sparkles} title="Institutional reasoning timeline" tone="cyan">
                <div className="grid gap-3 md:grid-cols-2">
                  {(interpretation?.reasoningTimeline ?? []).map((item) => (
                    <div key={item.stage} className={cn('rounded-lg border p-3', toneInsetSurface('cyan'))}>
                      <div className="flex items-center justify-between gap-3">
                        <p className={cn('text-sm font-semibold', toneTitle('cyan'))}>{item.stage}</p>
                        <span className={cn('font-mono text-xs', toneMuted('cyan'))}>{item.score}</span>
                      </div>
                      <p className={cn('mt-2 text-xs leading-5', toneBody('cyan'))}>{item.summary}</p>
                      {item.practitionerNote ? (
                        <p className={cn('mt-2 text-[11px] italic leading-5', toneMuted('cyan'))}>{item.practitionerNote}</p>
                      ) : null}
                    </div>
                  ))}
                  {!interpretation?.reasoningTimeline?.length ? (
                    <p className={cn('text-sm', toneBody('cyan'))}>Reasoning timeline appears after interpretation runs.</p>
                  ) : null}
                </div>
              </Panel>

              {interpretation?.algorithmStack?.length ? (
                <Panel icon={Layers3} title="Algorithm stack" tone="slate">
                  <ul className="space-y-1 text-sm text-slate-600">
                    {interpretation.algorithmStack.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}
            </section>

            <aside className="space-y-4">
              <DecisionCard interpretation={interpretation} tone={decisionTone} />
              <MeterCard interpretation={interpretation} />
              <Panel icon={GitBranch} title="Signal components" tone="blue">
                <ScrollArea className="h-[320px] pr-3">
                  <div className="space-y-2">
                    {(interpretation?.components ?? []).map((item) => (
                      <div key={item.name} className={cn('rounded-lg border p-3', toneInsetSurface('blue'))}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={cn('text-xs font-bold', toneTitle('blue'))}>{item.name}</p>
                          <span className={cn('font-mono text-xs', toneMuted('blue'))}>{Math.round(item.score * 100)}%</span>
                        </div>
                        <p className={cn('mt-1 text-xs leading-5', toneBody('blue'))}>{item.summary}</p>
                      </div>
                    ))}
                    {!interpretation?.components?.length ? (
                      <p className={cn('text-sm', toneBody('blue'))}>Weighted components appear after interpretation.</p>
                    ) : null}
                  </div>
                </ScrollArea>
              </Panel>
              <Panel icon={Layers3} title="Higher timeframe context" tone="purple">
                <p className={cn('text-sm leading-6', toneBody('purple'))}>{interpretation?.higherTimeframeContext ?? 'MTF and visual-delta context pending.'}</p>
              </Panel>
            </aside>
          </div>
        </main>
      </div>
    </DashboardPageFrame>
  );
}

function ChartWorkspace(props: { imageUrl: string; candles: ReconstructedCandle[]; interpretation: Interpretation | null; loading: boolean }) {
  if (props.imageUrl) {
    return (
      <div className="relative min-h-[420px] overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
        <img src={props.imageUrl} alt="Analyzed chart" className="h-full min-h-[420px] w-full object-cover" />
        <OverlayChip className="left-[8%] top-[12%]" label={props.interpretation?.dominantBias ?? 'bias'} />
        <OverlayChip className="right-[8%] top-[18%]" label={props.interpretation?.institutionalBehavior ?? 'institutional'} />
        <OverlayChip className="left-[14%] bottom-[14%]" label={props.interpretation?.decision ?? 'decision'} />
      </div>
    );
  }
  if (props.candles.length > 0) {
    return <CaptureChartPreview candles={props.candles} label="Reconstructed chart" aspectClassName="min-h-[420px]" />;
  }
  return (
    <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
      {props.loading ? 'Loading capture intelligence…' : 'No chart preview available for this timeframe'}
    </div>
  );
}

function OverlayChip(props: { className: string; label: string }) {
  return (
    <div className={cn('absolute rounded-lg border border-blue-200 bg-blue-50/90 px-3 py-1.5 text-xs font-semibold text-blue-800 shadow-sm', props.className)}>
      {props.label}
    </div>
  );
}

function DecisionCard({ interpretation, tone }: { interpretation: Interpretation | null; tone: DashboardTone }) {
  return (
    <Card className={cn('overflow-hidden', toneCard(tone))}>
      <CardHeader className={cn('border-b', toneCardHeader(tone))}>
        <CardTitle className={cn('flex items-center gap-2 text-base', toneTitle(tone))}>
          <Target className="h-5 w-5" /> Trade decision
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <p className="font-mono text-4xl font-semibold text-slate-950">{interpretation?.decision ?? '—'}</p>
        <p className={cn('mt-3 text-sm leading-6', toneBody(tone))}>{interpretation?.entryLogic ?? 'Entry logic pending interpretation.'}</p>
        <div className={cn('mt-4 rounded-lg border p-3 text-xs leading-5', toneInsetSurface(tone), toneMuted(tone))}>
          {interpretation?.invalidationLogic ?? 'Invalidation logic pending.'}
        </div>
      </CardContent>
    </Card>
  );
}

function MeterCard({ interpretation }: { interpretation: Interpretation | null }) {
  return (
    <Card className={cn('overflow-hidden', toneCard('emerald'))}>
      <CardHeader className={cn('border-b', toneCardHeader('emerald'))}>
        <CardTitle className={cn('flex items-center gap-2 text-base', toneTitle('emerald'))}>
          <Activity className="h-5 w-5" /> Confidence meters
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <Meter label="Confidence" value={interpretation?.confidenceScore ?? 0} tone="emerald" />
        <Meter label="Market clarity" value={interpretation?.marketClarityScore ?? 0} tone="blue" />
        <Meter label="Setup quality" value={interpretation?.setupQualityScore ?? 0} tone="purple" />
      </CardContent>
    </Card>
  );
}

function Meter(props: { label: string; value: number; tone: DashboardTone }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className={toneMuted(props.tone)}>{props.label}</span>
        <span className={cn('font-mono font-semibold', toneTitle(props.tone))}>{Math.round(props.value)}%</span>
      </div>
      <Progress value={props.value} className={cn('h-2', toneProgress(props.tone))} />
    </div>
  );
}

function NarrativeCard(props: { icon: LucideIcon; title: string; tone: DashboardTone; text: string }) {
  const Icon = props.icon;
  return (
    <Card className={cn('overflow-hidden', toneCard(props.tone))}>
      <CardHeader className={cn('border-b', toneCardHeader(props.tone))}>
        <CardTitle className={cn('flex items-center gap-2 text-base', toneTitle(props.tone))}>
          <Icon className="h-5 w-5" /> {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <p className={cn('whitespace-pre-line text-sm leading-6', toneBody(props.tone))}>{props.text}</p>
      </CardContent>
    </Card>
  );
}

function Panel(props: { icon: LucideIcon; title: string; tone: DashboardTone; children: ReactNode }) {
  const Icon = props.icon;
  return (
    <Card className={cn('overflow-hidden', toneCard(props.tone))}>
      <CardHeader className={cn('border-b py-4', toneCardHeader(props.tone))}>
        <CardTitle className={cn('flex items-center gap-2 text-base font-bold', toneTitle(props.tone))}>
          <Icon className="h-5 w-5" />
          {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">{props.children}</CardContent>
    </Card>
  );
}

function MetricCard(props: { tone: DashboardTone; icon: LucideIcon; label: string; value: string; detail: string }) {
  const Icon = props.icon;
  return (
    <Card className={cn('overflow-hidden', toneCard(props.tone))}>
      <CardContent className="p-4">
        <div className={cn('flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide', toneMuted(props.tone))}>
          <Icon className="h-4 w-4" />
          {props.label}
        </div>
        <p className={cn('mt-2 font-mono text-2xl font-bold', toneTitle(props.tone))}>{props.value}</p>
        <p className={cn('mt-1 text-xs', toneBody(props.tone))}>{props.detail}</p>
      </CardContent>
    </Card>
  );
}

function toneForDecision(decision?: string): DashboardTone {
  if (decision === 'BUY') return 'emerald';
  if (decision === 'SELL') return 'rose';
  if (decision === 'AVOID') return 'amber';
  return 'blue';
}

function toneForBias(bias?: string): DashboardTone {
  if (bias === 'bullish') return 'emerald';
  if (bias === 'bearish') return 'rose';
  if (bias === 'mixed') return 'amber';
  return 'blue';
}

function formatWatClock(value: Date): string {
  return value.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatRelativeTime(value: string | null | undefined, now: Date): string {
  if (!value) return '--';
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return value;
  const diffMs = now.getTime() - target.getTime();
  const abs = Math.abs(diffMs);
  if (abs < 5000) return 'just now';
  const seconds = Math.round(abs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}
