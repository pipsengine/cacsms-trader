'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Gauge,
  GitCompareArrows,
  GitPullRequestArrow,
  Layers3,
  Menu,
  Network,
  Radio,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import { TraderSidebar } from '@/components/trader-sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type Tone = 'navy' | 'blue' | 'purple' | 'emerald' | 'orange' | 'rose' | 'slate';
type Timeframe = 'W' | 'D' | 'H4' | 'H1' | 'M15';

interface Snapshot {
  id?: string;
  symbol: string;
  timeframe: Timeframe;
  trendDirection: string;
  marketStructure: string;
  lastBosDirection: string | null;
  lastChochDirection: string | null;
  liquidityStatus: string;
  orderBlockStatus: string;
  supportResistanceReaction: string;
  candleMomentum: string;
  volatilityCondition: string;
  aiConfidenceScore: number;
  bias: 'Bullish' | 'Bearish' | 'Neutral' | 'Ranging';
  decisionState: 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
  metadata?: Record<string, unknown>;
}

interface Alignment {
  id?: string;
  leftTimeframe: Timeframe;
  rightTimeframe: Timeframe;
  alignmentState: 'aligned_bullish' | 'aligned_bearish' | 'conflict' | 'neutral_ranging' | 'institutional_setup_forming';
  alignmentScore: number;
  explanationText: string;
}

interface Conflict {
  id?: string;
  conflictType: string;
  higherTimeframe: Timeframe;
  lowerTimeframe: Timeframe;
  severityScore: number;
  description: string;
  recommendedResolution: string;
}

interface Decision {
  finalDecision: string;
  finalBias: string;
  confidenceScore: number;
  controllingTimeframe: Timeframe | 'none';
  lowerTimeframeConfirmation: string;
  scalpOnly: boolean;
  marketNarrative: string;
}

interface MtfResult {
  symbol: string;
  snapshots: Snapshot[];
  alignments: Alignment[];
  conflicts: Conflict[];
  decision: Decision;
}

const timeframes: Timeframe[] = ['W', 'D', 'H4', 'H1', 'M15'];

export default function MultiTimeframeComparisonPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [querySymbol, setQuerySymbol] = useState('XAUUSD');
  const [result, setResult] = useState<MtfResult | null>(null);
  const [events, setEvents] = useState<Array<{ type: string; message: string; time: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState('');

  const loadAnalysis = useCallback(async (nextSymbol: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/visual-analysis/multi-timeframe/${encodeURIComponent(nextSymbol)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Unable to load multi-timeframe analysis.');
      setResult(payload.result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load multi-timeframe analysis.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const tick = () => setNow(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Lagos',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date()));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`/api/visual-analysis/multi-timeframe/${encodeURIComponent(querySymbol)}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => {
        if (!active) return;
        if (payload.ok) setResult(payload.result);
        else setError(payload.error ?? 'Unable to load multi-timeframe analysis.');
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Unable to load multi-timeframe analysis.');
      });
    return () => {
      active = false;
    };
  }, [querySymbol]);

  useEffect(() => {
    const source = new EventSource('/api/visual-intelligence/stream');
    source.onmessage = (message) => {
      const event = safeJson(message.data) as { eventType?: string; payload?: Record<string, unknown>; createdAt?: string } | null;
      if (!event?.eventType?.startsWith('mtf.')) return;
      const text = event.eventType === 'mtf.final.decision'
        ? `Final decision updated: ${String(event.payload?.finalDecision ?? 'WAIT')}`
        : event.eventType.replace(/\./g, ' ');
      setEvents((items) => [
        { type: event.eventType, message: text, time: event.createdAt ? new Date(event.createdAt).toLocaleTimeString() : new Date().toLocaleTimeString() },
        ...items,
      ].slice(0, 16));
    };
    return () => source.close();
  }, []);

  const snapshots = useMemo(() => timeframes.map((timeframe) => result?.snapshots.find((item) => item.timeframe === timeframe) ?? emptySnapshot(querySymbol, timeframe)), [querySymbol, result]);
  const decision = result?.decision ?? emptyDecision();
  const coverage = snapshots.filter((item) => item.aiConfidenceScore > 0).length;

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/visual-analysis/multi-timeframe/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: querySymbol }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Unable to run analysis.');
      setResult(payload.result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to run analysis.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-950 font-sans">
      <TraderSidebar bridgeOnline mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="shrink-0 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm shadow-slate-900/5 backdrop-blur md:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="Open navigation"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 lg:hidden"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold text-slate-950 md:text-xl">Multi-Timeframe Comparison</h1>
                <p className="truncate text-xs font-mono text-blue-700">W / D / H4 / H1 / M15 institutional alignment, conflict detection and decision intelligence</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={symbol}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setQuerySymbol(symbol.trim().toUpperCase() || 'XAUUSD');
                }}
                className="h-10 w-32 rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm font-semibold outline-none ring-blue-100 focus:ring-4"
                aria-label="Symbol"
              />
              <Button variant="outline" className="gap-2" onClick={() => setQuerySymbol(symbol.trim().toUpperCase() || 'XAUUSD')}>
                <GitCompareArrows className="h-4 w-4" />
                Load
              </Button>
              <Button className="gap-2 bg-blue-700 text-white hover:bg-blue-800" onClick={runAnalysis} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Analyze
              </Button>
              <HeaderChip icon={Radio} label="Frames" value={`${coverage}/5 live`} tone={coverage === 5 ? 'emerald' : coverage ? 'orange' : 'slate'} />
              <HeaderChip icon={Activity} label="WAT" value={now || '--:--:--'} tone="navy" />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5 xl:grid-cols-10">
            <SignalTile label="Pair/Symbol" value={querySymbol} tone="navy" />
            <SignalTile label="Market Status" value={coverage ? 'MTF analysis loaded' : 'Awaiting backend data'} tone={coverage ? 'emerald' : 'slate'} />
            <SignalTile label="AI Confidence" value={`${Math.round(decision.confidenceScore * 100)}%`} tone="blue" />
            <SignalTile label="Controlling TF" value={decision.controllingTimeframe} tone="purple" />
            <SignalTile label="Final Bias" value={decision.finalBias} tone={biasToneText(decision.finalBias)} />
            <SignalTile label="Decision" value={decision.finalDecision} tone={decisionTone(decision.finalDecision)} />
            <SignalTile label="Scalp Only" value={decision.scalpOnly ? 'Yes' : 'No'} tone={decision.scalpOnly ? 'orange' : 'emerald'} />
            <SignalTile label="Conflicts" value={`${result?.conflicts.length ?? 0}`} tone={(result?.conflicts.length ?? 0) ? 'orange' : 'emerald'} />
            <SignalTile label="Matrix" value={`${result?.alignments.length ?? 0}/4`} tone="blue" />
            <SignalTile label="AI State" value={loading ? 'Processing' : 'Monitoring'} tone={loading ? 'orange' : 'purple'} />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
          <div className="p-4 md:p-5">
            {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              {snapshots.map((snapshot) => (
                <TimeframeCard key={snapshot.timeframe} snapshot={snapshot} />
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
              <section className="space-y-4">
                <Card className="border-slate-200 shadow-lg shadow-slate-900/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Network className="h-4 w-4 text-blue-700" />
                      Timeframe Alignment Matrix
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {(result?.alignments ?? defaultAlignments(querySymbol)).map((alignment) => (
                      <AlignmentCell key={`${alignment.leftTimeframe}-${alignment.rightTimeframe}`} alignment={alignment} />
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-slate-200 shadow-lg shadow-slate-900/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <BrainCircuit className="h-4 w-4 text-purple-700" />
                      AI Market Narrative
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-slate-800">
                      {decision.marketNarrative}
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                      <MetricCard label="Final Decision" value={decision.finalDecision} tone={decisionTone(decision.finalDecision)} />
                      <MetricCard label="Controller" value={decision.controllingTimeframe} tone="purple" />
                      <MetricCard label="Confidence" value={`${Math.round(decision.confidenceScore * 100)}%`} tone="blue" />
                    </div>
                  </CardContent>
                </Card>
              </section>

              <aside className="space-y-4">
                <Card className="border-slate-200 shadow-lg shadow-slate-900/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="h-4 w-4 text-orange-600" />
                      Conflict Log
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[260px]">
                      <div className="space-y-2 pr-3">
                        {(result?.conflicts.length ? result.conflicts : []).map((conflict) => (
                          <div key={conflict.id ?? `${conflict.higherTimeframe}-${conflict.lowerTimeframe}`} className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-mono text-xs font-semibold text-orange-800">{conflict.higherTimeframe} vs {conflict.lowerTimeframe}</span>
                              <span className="font-mono text-xs text-orange-700">{Math.round(conflict.severityScore * 100)}%</span>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-slate-700">{conflict.description}</p>
                            <p className="mt-1 text-xs leading-5 text-slate-500">{conflict.recommendedResolution}</p>
                          </div>
                        ))}
                        {!result?.conflicts.length ? (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">
                            No persisted timeframe conflicts for {querySymbol}. Run analysis after W/D/H4/H1/M15 captures are available.
                          </div>
                        ) : null}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 shadow-lg shadow-slate-900/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Activity className="h-4 w-4 text-emerald-700" />
                      MTF Event Stream
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[210px]">
                      <div className="space-y-2 pr-3">
                        {events.map((event) => (
                          <div key={`${event.time}-${event.type}-${event.message}`} className="rounded-lg border border-slate-200 bg-white p-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate font-mono text-[11px] font-semibold text-blue-700">{event.type}</span>
                              <span className="font-mono text-[10px] text-slate-400">{event.time}</span>
                            </div>
                            <p className="mt-1 truncate text-xs text-slate-600">{event.message}</p>
                          </div>
                        ))}
                        {!events.length ? <div className="text-xs leading-5 text-slate-500">Listening for `mtf.*` backend events.</div> : null}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </aside>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function TimeframeCard({ snapshot }: { snapshot: Snapshot }) {
  const tone = biasTone(snapshot.bias);
  return (
    <Card className={cn('border shadow-lg shadow-slate-900/5', toneBorder(tone), toneBg(tone))}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-2xl font-bold text-slate-950">{snapshot.timeframe}</div>
            <div className={cn('mt-1 text-xs font-semibold', toneText(tone))}>{snapshot.bias}</div>
          </div>
          <div className={cn('rounded-lg border bg-white/70 px-2 py-1 text-right', toneBorder(decisionTone(snapshot.decisionState)))}>
            <div className="text-[10px] text-slate-500">Decision</div>
            <div className={cn('font-mono text-xs font-bold', toneText(decisionTone(snapshot.decisionState)))}>{snapshot.decisionState}</div>
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-600">
            <span>AI confidence</span>
            <span className="font-mono font-semibold">{Math.round(snapshot.aiConfidenceScore * 100)}%</span>
          </div>
          <Progress value={snapshot.aiConfidenceScore * 100} className="mt-1 h-1.5 bg-white/70 [&_[data-slot=progress-indicator]]:bg-blue-600" />
        </div>
        <div className="mt-3 grid gap-2 text-xs">
          <InfoRow label="Trend" value={snapshot.trendDirection} />
          <InfoRow label="Structure" value={snapshot.marketStructure} />
          <InfoRow label="BOS" value={snapshot.lastBosDirection ?? 'none'} />
          <InfoRow label="CHOCH" value={snapshot.lastChochDirection ?? 'none'} />
          <InfoRow label="Liquidity" value={snapshot.liquidityStatus} />
          <InfoRow label="Order block" value={snapshot.orderBlockStatus} />
          <InfoRow label="S/R" value={snapshot.supportResistanceReaction} />
          <InfoRow label="Momentum" value={snapshot.candleMomentum} />
          <InfoRow label="Volatility" value={snapshot.volatilityCondition} />
        </div>
      </CardContent>
    </Card>
  );
}

function AlignmentCell({ alignment }: { alignment: Alignment }) {
  const tone = alignmentTone(alignment.alignmentState);
  return (
    <motion.div
      className={cn('rounded-lg border p-3 shadow-sm shadow-slate-900/5', toneBorder(tone), toneBg(tone))}
      animate={{ opacity: [0.88, 1, 0.88] }}
      transition={{ duration: 2.4, repeat: Infinity }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LiveDot tone={tone} />
          <span className="font-mono text-sm font-bold text-slate-950">{alignment.leftTimeframe} vs {alignment.rightTimeframe}</span>
        </div>
        <span className={cn('font-mono text-xs font-semibold', toneText(tone))}>{Math.round(alignment.alignmentScore * 100)}%</span>
      </div>
      <div className={cn('mt-2 text-xs font-semibold', toneText(tone))}>{alignment.alignmentState.replace(/_/g, ' ')}</div>
      <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-600">{alignment.explanationText}</p>
    </motion.div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[86px_minmax(0,1fr)] gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="truncate font-mono text-[11px] font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function HeaderChip(props: { icon: LucideIcon; label: string; value: string; tone: Tone }) {
  const Icon = props.icon;
  return (
    <div className={cn('flex h-10 items-center gap-2 rounded-lg border px-3', toneBorder(props.tone), toneBg(props.tone))}>
      <Icon className={cn('h-4 w-4', toneText(props.tone))} />
      <div>
        <div className="text-[10px] text-slate-500">{props.label}</div>
        <div className="font-mono text-xs font-semibold text-slate-900">{props.value}</div>
      </div>
    </div>
  );
}

function SignalTile(props: { label: string; value: string; tone: Tone }) {
  return (
    <div className={cn('min-w-0 rounded-lg border px-2.5 py-2 shadow-sm shadow-slate-900/5', toneBorder(props.tone), toneBg(props.tone))}>
      <div className="truncate text-[10px] text-slate-500">{props.label}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <LiveDot tone={props.tone} />
        <span className="truncate font-mono text-[11px] font-semibold text-slate-950">{props.value}</span>
      </div>
    </div>
  );
}

function MetricCard(props: { label: string; value: string; tone: Tone }) {
  return (
    <div className={cn('rounded-lg border p-3 shadow-sm shadow-slate-900/5', toneBorder(props.tone), toneBg(props.tone))}>
      <div className="text-[11px] text-slate-500">{props.label}</div>
      <div className="mt-1 truncate font-mono text-lg font-semibold text-slate-950">{props.value}</div>
    </div>
  );
}

function LiveDot(props: { tone: Tone }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      <motion.span
        className={cn('absolute inline-flex h-full w-full rounded-full opacity-50', toneDot(props.tone))}
        animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 1.8, repeat: Infinity }}
      />
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', toneDot(props.tone))} />
    </span>
  );
}

function emptySnapshot(symbol: string, timeframe: Timeframe): Snapshot {
  return {
    symbol,
    timeframe,
    trendDirection: 'unavailable',
    marketStructure: 'no_backend_chart_data',
    lastBosDirection: null,
    lastChochDirection: null,
    liquidityStatus: 'unavailable',
    orderBlockStatus: 'unavailable',
    supportResistanceReaction: 'unavailable',
    candleMomentum: 'unavailable',
    volatilityCondition: 'unavailable',
    aiConfidenceScore: 0,
    bias: 'Neutral',
    decisionState: 'WAIT',
  };
}

function emptyDecision(): Decision {
  return {
    finalDecision: 'WAIT',
    finalBias: 'No multi-timeframe backend analysis available',
    confidenceScore: 0,
    controllingTimeframe: 'none',
    lowerTimeframeConfirmation: 'No lower timeframe confirmation.',
    scalpOnly: false,
    marketNarrative: 'Run analysis after W, D, H4, H1 and M15 chart captures or candle payloads are available.',
  };
}

function defaultAlignments(symbol: string): Alignment[] {
  return [
    ['W', 'D'],
    ['D', 'H4'],
    ['H4', 'H1'],
    ['H1', 'M15'],
  ].map(([left, right]) => ({
    leftTimeframe: left as Timeframe,
    rightTimeframe: right as Timeframe,
    alignmentState: 'neutral_ranging',
    alignmentScore: 0,
    explanationText: `No persisted ${symbol} backend alignment for ${left} vs ${right}.`,
  }));
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function biasTone(bias: string): Tone {
  if (bias === 'Bullish') return 'emerald';
  if (bias === 'Bearish') return 'rose';
  if (bias === 'Ranging') return 'blue';
  return 'slate';
}

function biasToneText(value: string): Tone {
  const text = value.toLowerCase();
  if (text.includes('bull')) return 'emerald';
  if (text.includes('bear')) return 'rose';
  if (text.includes('liquidity') || text.includes('setup')) return 'purple';
  return 'blue';
}

function decisionTone(decision: string): Tone {
  const text = decision.toLowerCase();
  if (text.includes('buy')) return 'emerald';
  if (text.includes('sell')) return 'rose';
  if (text.includes('avoid')) return 'orange';
  return 'blue';
}

function alignmentTone(state: Alignment['alignmentState']): Tone {
  if (state === 'aligned_bullish') return 'emerald';
  if (state === 'aligned_bearish') return 'rose';
  if (state === 'conflict') return 'orange';
  if (state === 'institutional_setup_forming') return 'purple';
  return 'blue';
}

function toneBorder(tone: Tone): string {
  return {
    navy: 'border-slate-300',
    blue: 'border-blue-200',
    purple: 'border-purple-200',
    emerald: 'border-emerald-200',
    orange: 'border-orange-200',
    rose: 'border-rose-200',
    slate: 'border-slate-200',
  }[tone];
}

function toneBg(tone: Tone): string {
  return {
    navy: 'bg-slate-50',
    blue: 'bg-blue-50',
    purple: 'bg-purple-50',
    emerald: 'bg-emerald-50',
    orange: 'bg-orange-50',
    rose: 'bg-rose-50',
    slate: 'bg-slate-50',
  }[tone];
}

function toneText(tone: Tone): string {
  return {
    navy: 'text-slate-800',
    blue: 'text-blue-700',
    purple: 'text-purple-700',
    emerald: 'text-emerald-700',
    orange: 'text-orange-700',
    rose: 'text-rose-700',
    slate: 'text-slate-600',
  }[tone];
}

function toneDot(tone: Tone): string {
  return {
    navy: 'bg-slate-700',
    blue: 'bg-blue-600',
    purple: 'bg-purple-600',
    emerald: 'bg-emerald-500',
    orange: 'bg-orange-500',
    rose: 'bg-rose-500',
    slate: 'bg-slate-500',
  }[tone];
}
