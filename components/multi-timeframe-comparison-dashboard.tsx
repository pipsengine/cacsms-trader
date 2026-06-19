'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Camera,
  CheckCircle2,
  GitCompareArrows,
  Layers3,
  Menu,
  Network,
  Play,
  RefreshCw,
  ShieldAlert,
  Target,
  type LucideIcon,
} from 'lucide-react';

import { DashboardPageFrame } from '@/components/dashboard-page-frame';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SYSTEM_FOCUS_SYMBOL_LABELS, SYSTEM_FOCUS_SYMBOLS } from '@/lib/focus-symbols';
import {
  type DashboardTone,
  toneBadge,
  toneBody,
  toneCard,
  toneCardHeader,
  toneInsetSurface,
  toneMetric,
  toneMuted,
  toneProgress,
  toneTitle,
} from '@/lib/dashboard-card-tones';
import { cn } from '@/lib/utils';

const MTF_TIMEFRAMES = ['MN', 'W', 'D', 'H4', 'H1', 'M15'] as const;
type Timeframe = (typeof MTF_TIMEFRAMES)[number];

type Snapshot = {
  id?: string;
  symbol: string;
  timeframe: Timeframe;
  chartCaptureId?: string | null;
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
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

type Alignment = {
  id?: string;
  leftTimeframe: Timeframe;
  rightTimeframe: Timeframe;
  alignmentState: 'aligned_bullish' | 'aligned_bearish' | 'conflict' | 'neutral_ranging' | 'institutional_setup_forming';
  alignmentScore: number;
  trendMatch: boolean;
  structureMatch: boolean;
  liquidityMatch: boolean;
  orderBlockMatch: boolean;
  supportResistanceMatch: boolean;
  explanationText: string;
};

type Conflict = {
  id?: string;
  conflictType: string;
  higherTimeframe: Timeframe;
  lowerTimeframe: Timeframe;
  severityScore: number;
  description: string;
  recommendedResolution: string;
};

type Decision = {
  finalDecision: string;
  finalBias: string;
  confidenceScore: number;
  controllingTimeframe: Timeframe | 'none';
  lowerTimeframeConfirmation: string;
  scalpOnly: boolean;
  marketNarrative: string;
  createdAt?: string;
};

type MtfResult = {
  symbol: string;
  snapshots: Snapshot[];
  alignments: Alignment[];
  conflicts: Conflict[];
  decision: Decision;
};

type Readiness = {
  timeframe: Timeframe;
  captureId: string | null;
  capturedAt: string | null;
  candleCount: number;
  analyzed: boolean;
  analyzedAt: string | null;
  readyForAnalysis: boolean;
};

type StreamEvent = {
  type: string;
  message: string;
  time: string;
};

function isAnalyzedSnapshot(snapshot: Snapshot | undefined): snapshot is Snapshot {
  return Boolean(
    snapshot
    && snapshot.aiConfidenceScore > 0
    && snapshot.marketStructure !== 'no_backend_chart_data',
  );
}

export function MultiTimeframeComparisonDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [result, setResult] = useState<MtfResult | null>(null);
  const [readiness, setReadiness] = useState<Readiness[]>([]);
  const [coverage, setCoverage] = useState<Record<string, number>>({});
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => new Date());

  const snapshotByTf = useMemo(
    () => new Map((result?.snapshots ?? []).map((item) => [item.timeframe, item])),
    [result],
  );
  const readinessByTf = useMemo(
    () => new Map(readiness.map((item) => [item.timeframe, item])),
    [readiness],
  );
  const readyCount = readiness.filter((item) => item.readyForAnalysis).length;
  const analyzedCount = readiness.filter((item) => item.analyzed).length;
  const canAnalyze = readyCount > 0;
  const decision = result?.decision ?? null;

  const loadRegistry = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [analysisResponse, coverageResponse, bridgeResponse] = await Promise.all([
        fetch(`/api/visual-analysis/multi-timeframe/${encodeURIComponent(symbol)}`, { cache: 'no-store' }),
        fetch(`/api/visual-analysis/multi-timeframe/coverage?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' }),
        fetch('/api/mt5/status', { cache: 'no-store' }),
      ]);
      const analysisPayload = await analysisResponse.json();
      const coveragePayload = await coverageResponse.json();
      if (!analysisResponse.ok || !analysisPayload.ok) {
        if (analysisResponse.status !== 404 && analysisPayload.error) {
          throw new Error(String(analysisPayload.error));
        }
        setResult(null);
      } else {
        setResult(analysisPayload.result ?? null);
      }
      if (coveragePayload.ok) {
        setCoverage(coveragePayload.coverage as Record<string, number>);
        setReadiness(Array.isArray(coveragePayload.readiness) ? coveragePayload.readiness as Readiness[] : []);
      }
      const bridgePayload = await bridgeResponse.json().catch(() => null);
      setBridgeOnline(Boolean(bridgePayload?.ok));
      setLastSyncAt(new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load multi-timeframe analysis.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [symbol]);

  const runAnalysis = useCallback(async () => {
    if (!canAnalyze) return;
    setRunningAnalysis(true);
    setError(null);
    try {
      const response = await fetch('/api/visual-analysis/multi-timeframe/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(String(payload.error ?? 'Multi-timeframe analysis failed.'));
      }
      setResult(payload.result as MtfResult);
      await loadRegistry(false);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Multi-timeframe analysis failed.');
    } finally {
      setRunningAnalysis(false);
    }
  }, [canAnalyze, loadRegistry, symbol]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadRegistry(true);
    const interval = window.setInterval(() => void loadRegistry(false), 15000);
    return () => window.clearInterval(interval);
  }, [loadRegistry]);

  useEffect(() => {
    const source = new EventSource('/api/visual-intelligence/stream');
    source.onmessage = (message) => {
      const event = safeJson(message.data) as {
        eventType?: string;
        payload?: Record<string, unknown>;
        createdAt?: string;
      } | null;
      if (!event?.eventType?.startsWith('mtf.')) return;
      const eventSymbol = String(event.payload?.symbol ?? '').toUpperCase();
      if (eventSymbol && eventSymbol !== symbol.toUpperCase()) return;
      const text = event.eventType === 'mtf.final.decision'
        ? `Final decision: ${String(event.payload?.finalDecision ?? 'WAIT')}`
        : event.eventType.replace(/\./g, ' ');
      setEvents((items) => [
        {
          type: event.eventType ?? 'mtf.event',
          message: text,
          time: event.createdAt ? new Date(event.createdAt).toLocaleTimeString() : new Date().toLocaleTimeString(),
        },
        ...items,
      ].slice(0, 20));
      if (event.eventType === 'mtf.final.decision' || event.eventType === 'mtf.analysis.started') {
        void loadRegistry(false);
      }
    };
    return () => source.close();
  }, [loadRegistry, symbol]);

  return (
    <DashboardPageFrame
      bridgeOnline={bridgeOnline}
      mobileOpen={mobileSidebarOpen}
      onMobileOpenChange={setMobileSidebarOpen}
    >
      <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white px-4 py-4 md:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button size="icon" variant="outline" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700">Institutional alignment</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">Multi-Timeframe Comparison</h1>
                <p className="truncate text-xs font-mono text-slate-500">
                  W / D / H4 / H1 / M15 · synced {formatRelativeTime(lastSyncAt, clockNow)}{refreshing ? ' · updating…' : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"
              >
                {SYSTEM_FOCUS_SYMBOLS.map((item) => (
                  <option key={item} value={item}>
                    {SYSTEM_FOCUS_SYMBOL_LABELS[item]} ({item})
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" onClick={() => void loadRegistry(false)} disabled={loading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', (loading || refreshing) && 'animate-spin')} />
                Refresh
              </Button>
              <Button size="sm" onClick={() => void runAnalysis()} disabled={!canAnalyze || runningAnalysis}>
                <Play className={cn('mr-2 h-4 w-4', runningAnalysis && 'animate-pulse')} />
                {runningAnalysis ? 'Analyzing…' : 'Run MTF fusion'}
              </Button>
              <Link
                href="/visual-intelligence-overview/chart-screenshot-capture"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}
              >
                <Camera className="h-4 w-4" />
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

          <section className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <MetricCard tone="blue" icon={Layers3} label="Ready frames" value={`${readyCount}/5`} detail={`${analyzedCount} analyzed with persisted snapshots`} />
            <MetricCard tone="slate" icon={GitCompareArrows} label="Symbol" value={symbol} detail={coverage[symbol] ? `${coverage[symbol]} TF in registry` : 'No persisted MTF yet'} />
            <MetricCard tone="purple" icon={BrainCircuit} label="Decision" value={decision?.finalDecision ?? '—'} detail={decision ? decision.finalBias : 'Run analysis after captures'} />
            <MetricCard tone="emerald" icon={Target} label="Confidence" value={decision ? `${Math.round(decision.confidenceScore * 100)}%` : '—'} detail={decision?.controllingTimeframe ? `Controller: ${decision.controllingTimeframe}` : 'No controller'} />
            <MetricCard tone={(result?.conflicts.length ?? 0) > 0 ? 'amber' : 'emerald'} icon={ShieldAlert} label="Conflicts" value={String(result?.conflicts.length ?? 0)} detail={`${result?.alignments.length ?? 0}/4 alignment pairs`} />
            <MetricCard tone={decision?.scalpOnly ? 'orange' : 'slate'} icon={Activity} label="Scalp only" value={decision?.scalpOnly ? 'Yes' : 'No'} detail={decision?.lowerTimeframeConfirmation?.slice(0, 48) ?? 'Awaiting fusion'} />
          </section>

          {!canAnalyze && !loading ? (
            <Card className="mb-4 border-blue-200 bg-blue-50">
              <CardContent className="flex items-start gap-3 p-4 text-sm text-blue-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  No timeframe has enough reconstructed candles (minimum 12 per frame). Capture charts on W, D, H4, H1 and M15, run candle detection, then run MTF fusion.
                </span>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <section className="space-y-4">
              <Panel icon={Layers3} title="Top-down timeframe readiness" tone="blue">
                <div className="grid grid-cols-5 gap-2">
                  {MTF_TIMEFRAMES.map((timeframe) => {
                    const item = readinessByTf.get(timeframe);
                    const snapshot = snapshotByTf.get(timeframe);
                    const analyzed = Boolean(item?.analyzed && isAnalyzedSnapshot(snapshot));
                    const ready = Boolean(item?.readyForAnalysis);
                    const rowTone: DashboardTone = analyzed ? 'emerald' : ready ? 'amber' : 'slate';
                    return (
                      <div key={timeframe} className={cn('rounded-xl border p-3 text-center shadow-sm', toneMetric(rowTone))}>
                        <p className={cn('font-mono text-lg font-bold', toneTitle(rowTone))}>{timeframe}</p>
                        <p className={cn('mt-1 text-[10px] font-bold uppercase', toneMuted(rowTone))}>
                          {analyzed ? 'Fused' : ready ? `${item?.candleCount ?? 0} candles` : item?.captureId ? 'Needs candles' : 'No capture'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </Panel>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                {MTF_TIMEFRAMES.map((timeframe) => (
                  <TimeframeCard
                    key={timeframe}
                    timeframe={timeframe}
                    snapshot={snapshotByTf.get(timeframe)}
                    readiness={readinessByTf.get(timeframe)}
                  />
                ))}
              </div>

              <Panel icon={Network} title="Timeframe alignment matrix" tone="purple">
                {!result?.alignments.length ? (
                  <p className={cn('text-sm font-medium', toneBody('purple'))}>
                    No persisted alignment scores for {symbol}. Run MTF fusion after at least one timeframe is ready.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {result.alignments.map((alignment) => (
                      <AlignmentCell key={`${alignment.leftTimeframe}-${alignment.rightTimeframe}`} alignment={alignment} />
                    ))}
                  </div>
                )}
              </Panel>

              <Panel icon={BrainCircuit} title="Institutional decision narrative" tone="cyan">
                {!decision ? (
                  <p className={cn('text-sm font-medium', toneBody('cyan'))}>
                    No fused decision stored for {symbol}. Run analysis when captures and reconstructed candles are available.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <p className={cn('rounded-lg border px-4 py-3 text-sm leading-6', toneInsetSurface('cyan'), toneBody('cyan'))}>
                      {decision.marketNarrative}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <InfoChip tone="cyan" label="Final decision" value={decision.finalDecision} />
                      <InfoChip tone="cyan" label="Controlling TF" value={String(decision.controllingTimeframe)} />
                      <InfoChip tone="cyan" label="Confidence" value={`${Math.round(decision.confidenceScore * 100)}%`} />
                    </div>
                    <p className={cn('text-xs leading-5', toneMuted('cyan'))}>{decision.lowerTimeframeConfirmation}</p>
                  </div>
                )}
              </Panel>
            </section>

            <aside className="space-y-4">
              <Panel icon={ShieldAlert} title="Conflict log" tone="orange">
                <ScrollArea className="h-[280px] pr-3">
                  <div className="space-y-2">
                    {(result?.conflicts ?? []).map((conflict) => (
                      <div key={conflict.id ?? `${conflict.higherTimeframe}-${conflict.lowerTimeframe}-${conflict.conflictType}`} className={cn('rounded-lg border p-3', toneInsetSurface('orange'))}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('font-mono text-xs font-bold', toneTitle('orange'))}>
                            {conflict.higherTimeframe} vs {conflict.lowerTimeframe}
                          </span>
                          <span className={cn('font-mono text-xs', toneMuted('orange'))}>{Math.round(conflict.severityScore * 100)}%</span>
                        </div>
                        <p className={cn('mt-2 text-xs leading-5', toneBody('orange'))}>{conflict.description}</p>
                        <p className={cn('mt-1 text-[11px] leading-5', toneMuted('orange'))}>{conflict.recommendedResolution}</p>
                      </div>
                    ))}
                    {!result?.conflicts.length ? (
                      <p className={cn('text-sm font-medium', toneBody('emerald'))}>
                        {analyzedCount > 0 ? 'No active timeframe conflicts detected.' : 'Conflicts appear after MTF fusion runs.'}
                      </p>
                    ) : null}
                  </div>
                </ScrollArea>
              </Panel>

              <Panel icon={Activity} title="MTF event stream" tone="emerald">
                <ScrollArea className="h-[220px] pr-3">
                  <div className="space-y-2">
                    {events.map((event) => (
                      <div key={`${event.time}-${event.type}`} className={cn('rounded-lg border px-3 py-2', toneInsetSurface('emerald'))}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('truncate font-mono text-[11px] font-bold', toneTitle('emerald'))}>{event.type}</span>
                          <span className={cn('font-mono text-[10px]', toneMuted('emerald'))}>{event.time}</span>
                        </div>
                        <p className={cn('mt-1 text-xs', toneBody('emerald'))}>{event.message}</p>
                      </div>
                    ))}
                    {!events.length ? (
                      <p className={cn('text-sm font-medium', toneBody('emerald'))}>Listening for live `mtf.*` events from the analysis engine.</p>
                    ) : null}
                  </div>
                </ScrollArea>
              </Panel>

              <Panel icon={CheckCircle2} title="Fusion checklist" tone="slate">
                <div className="space-y-2 text-sm">
                  <ChecklistRow ok={readyCount > 0} label="At least one timeframe has ≥12 reconstructed candles" />
                  <ChecklistRow ok={analyzedCount > 0} label="Persisted MTF snapshots in database" />
                  <ChecklistRow ok={Boolean(result?.alignments.length)} label="Alignment matrix computed" />
                  <ChecklistRow ok={Boolean(decision)} label="Final institutional decision recorded" />
                </div>
              </Panel>

              <Panel icon={ArrowRight} title="Pipeline links" tone="slate">
                <div className="space-y-2 text-sm">
                  <QuickLink href="/visual-intelligence-overview/structure-analysis" label="Structure analysis" />
                  <QuickLink href="/visual-intelligence-overview/candle-detection" label="Candle detection" />
                  <QuickLink href="/autonomous-pipeline" label="Autonomous pipeline" />
                </div>
              </Panel>
            </aside>
          </div>
        </main>
      </div>
    </DashboardPageFrame>
  );
}

function TimeframeCard(props: {
  timeframe: Timeframe;
  snapshot?: Snapshot;
  readiness?: Readiness;
}) {
  if (!props.readiness?.captureId) {
    return (
      <Card className={cn('overflow-hidden', toneCard('slate'))}>
        <CardContent className="p-4">
          <p className={cn('font-mono text-2xl font-bold', toneTitle('slate'))}>{props.timeframe}</p>
          <p className={cn('mt-2 text-xs font-medium', toneBody('slate'))}>No chart capture</p>
          <p className={cn('mt-1 text-[11px]', toneMuted('slate'))}>Capture this timeframe before running fusion.</p>
        </CardContent>
      </Card>
    );
  }

  if (!props.readiness.readyForAnalysis || !isAnalyzedSnapshot(props.snapshot)) {
    const tone: DashboardTone = props.readiness.readyForAnalysis ? 'amber' : 'slate';
    return (
      <Card className={cn('overflow-hidden', toneCard(tone))}>
        <CardContent className="p-4">
          <p className={cn('font-mono text-2xl font-bold', toneTitle(tone))}>{props.timeframe}</p>
          <p className={cn('mt-2 text-xs font-medium', toneBody(tone))}>
            {props.readiness.readyForAnalysis ? 'Ready — not fused yet' : `${props.readiness.candleCount}/12 candles`}
          </p>
          <p className={cn('mt-1 text-[11px]', toneMuted(tone))}>
            {props.readiness.readyForAnalysis
              ? 'Run MTF fusion to populate this frame.'
              : 'Run candle detection on the capture first.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const snapshot = props.snapshot;
  const tone = biasTone(snapshot.bias);
  return (
    <Card className={cn('overflow-hidden', toneCard(tone))}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={cn('font-mono text-2xl font-bold', toneTitle(tone))}>{snapshot.timeframe}</p>
            <span className={cn('mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', toneBadge(tone))}>
              {snapshot.bias}
            </span>
          </div>
          <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', toneBadge(decisionTone(snapshot.decisionState)))}>
            {snapshot.decisionState}
          </span>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className={toneMuted(tone)}>AI confidence</span>
            <span className={cn('font-mono font-bold', toneTitle(tone))}>{Math.round(snapshot.aiConfidenceScore * 100)}%</span>
          </div>
          <Progress value={snapshot.aiConfidenceScore * 100} className={cn('h-2', toneProgress(tone))} />
        </div>
        <div className="mt-3 space-y-1.5 text-xs">
          <InfoRow tone={tone} label="Trend" value={snapshot.trendDirection} />
          <InfoRow tone={tone} label="Structure" value={snapshot.marketStructure} />
          <InfoRow tone={tone} label="BOS" value={snapshot.lastBosDirection ?? 'none'} />
          <InfoRow tone={tone} label="CHOCH" value={snapshot.lastChochDirection ?? 'none'} />
          <InfoRow tone={tone} label="Liquidity" value={snapshot.liquidityStatus} />
          <InfoRow tone={tone} label="Order block" value={snapshot.orderBlockStatus} />
          <InfoRow tone={tone} label="S/R" value={snapshot.supportResistanceReaction} />
          <InfoRow tone={tone} label="Momentum" value={snapshot.candleMomentum} />
          <InfoRow tone={tone} label="Volatility" value={snapshot.volatilityCondition} />
        </div>
        {snapshot.createdAt ? (
          <p className={cn('mt-3 text-[10px]', toneMuted(tone))}>Fused {new Date(snapshot.createdAt).toLocaleString()}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AlignmentCell({ alignment }: { alignment: Alignment }) {
  const tone = alignmentTone(alignment.alignmentState);
  return (
    <div className={cn('rounded-lg border p-3 shadow-sm', toneMetric(tone))}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('font-mono text-sm font-bold', toneTitle(tone))}>
          {alignment.leftTimeframe} vs {alignment.rightTimeframe}
        </span>
        <span className={cn('font-mono text-xs font-bold', toneTitle(tone))}>{Math.round(alignment.alignmentScore * 100)}%</span>
      </div>
      <p className={cn('mt-2 text-xs font-semibold uppercase', toneMuted(tone))}>{alignment.alignmentState.replace(/_/g, ' ')}</p>
      <p className={cn('mt-2 text-xs leading-5', toneBody(tone))}>{alignment.explanationText}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {alignment.trendMatch ? <MatchChip label="Trend" tone={tone} /> : null}
        {alignment.structureMatch ? <MatchChip label="Structure" tone={tone} /> : null}
        {alignment.liquidityMatch ? <MatchChip label="Liquidity" tone={tone} /> : null}
        {alignment.orderBlockMatch ? <MatchChip label="OB" tone={tone} /> : null}
        {alignment.supportResistanceMatch ? <MatchChip label="S/R" tone={tone} /> : null}
      </div>
    </div>
  );
}

function MatchChip(props: { label: string; tone: DashboardTone }) {
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase', toneBadge(props.tone))}>
      {props.label}
    </span>
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

function InfoChip(props: { tone: DashboardTone; label: string; value: string }) {
  return (
    <div className={cn('rounded-lg border px-3 py-2', toneInsetSurface(props.tone))}>
      <p className={cn('text-[10px] font-bold uppercase', toneMuted(props.tone))}>{props.label}</p>
      <p className={cn('mt-1 font-mono text-sm font-semibold', toneTitle(props.tone))}>{props.value}</p>
    </div>
  );
}

function InfoRow(props: { tone: DashboardTone; label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <span className={toneMuted(props.tone)}>{props.label}</span>
      <span className={cn('truncate font-mono text-[11px] font-semibold', toneTitle(props.tone))}>{props.value}</span>
    </div>
  );
}

function ChecklistRow(props: { ok: boolean; label: string }) {
  return (
    <div className="flex items-start gap-2">
      {props.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
      <span className={props.ok ? 'text-slate-800' : 'text-slate-500'}>{props.label}</span>
    </div>
  );
}

function QuickLink(props: { href: string; label: string }) {
  return (
    <Link href={props.href} className={cn('flex items-center justify-between rounded-lg border px-3 py-2 hover:opacity-90', toneInsetSurface('slate'), toneBody('slate'))}>
      <span>{props.label}</span>
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function biasTone(bias: string): DashboardTone {
  if (bias === 'Bullish') return 'emerald';
  if (bias === 'Bearish') return 'rose';
  if (bias === 'Ranging') return 'blue';
  return 'slate';
}

function decisionTone(decision: string): DashboardTone {
  const text = decision.toLowerCase();
  if (text.includes('buy')) return 'emerald';
  if (text.includes('sell')) return 'rose';
  if (text.includes('avoid')) return 'amber';
  return 'slate';
}

function alignmentTone(state: Alignment['alignmentState']): DashboardTone {
  if (state === 'aligned_bullish') return 'emerald';
  if (state === 'aligned_bearish') return 'rose';
  if (state === 'conflict') return 'amber';
  if (state === 'institutional_setup_forming') return 'purple';
  return 'blue';
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
