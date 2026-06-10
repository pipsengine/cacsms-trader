'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Blocks,
  Bot,
  BrainCircuit,
  GitBranch,
  Layers3,
  LineChart,
  Menu,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';

import { TraderSidebar } from '@/components/trader-sidebar';
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
import { SYSTEM_FOCUS_SYMBOL_LABELS } from '@/lib/focus-symbols';
import type { ReconstructedCandle } from '@/lib/visual-intelligence-types';
import { cn } from '@/lib/utils';

const TIMEFRAMES = ['W', 'D', 'H4', 'H1', 'M15'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

type Segment = {
  id: string;
  startCandleIndex: number;
  endCandleIndex: number;
  priceLow: number;
  priceHigh: number;
  segmentType: string;
  confidenceScore: number;
  marketMeaning: string;
  institutionalInterpretation: string;
  tradingRelevance: string;
  volatilityRegime: string;
  structureRegime: string;
  explanation: string;
};

type SegmentationReport = {
  capture: { id: string; symbol: string; timeframe: string; imageUrl: string; metadata?: Record<string, unknown> };
  segments: Segment[];
  explanation: string;
  modelVersion: string;
  createdAt: string | null;
};

type Readiness = {
  timeframe: Timeframe;
  captureId: string | null;
  capturedAt: string | null;
  candleCount: number;
  hasCapture: boolean;
  segmentCount: number;
  latestSegmentAt: string | null;
  readyForSegmentation: boolean;
};

const LEGEND = [
  'Accumulation', 'Manipulation', 'Expansion', 'Distribution', 'Consolidation', 'Pullback', 'Trend continuation',
  'Reversal attempt', 'Liquidity sweep zone', 'Order block reaction zone', 'Support/resistance reaction zone',
  'Volatility compression zone', 'Breakout zone', 'Retest zone',
];

function resolveAutonomousTimeframe(readiness: Readiness[]): Timeframe {
  const priority: Timeframe[] = ['M15', 'H1', 'H4', 'D', 'W'];
  const segmented = readiness
    .filter((item) => item.segmentCount > 0)
    .sort((left, right) => right.segmentCount - left.segmentCount || priority.indexOf(left.timeframe) - priority.indexOf(right.timeframe));
  if (segmented[0]) return segmented[0].timeframe;
  const ready = readiness
    .filter((item) => item.readyForSegmentation)
    .sort((left, right) => priority.indexOf(left.timeframe) - priority.indexOf(right.timeframe));
  if (ready[0]) return ready[0].timeframe;
  return 'H1';
}

export function AiChartSegmentationDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [pipelineMode, setPipelineMode] = useState('full_auto');
  const [activeSymbols, setActiveSymbols] = useState<string[]>(['XAUUSD']);
  const [report, setReport] = useState<SegmentationReport | null>(null);
  const [readiness, setReadiness] = useState<Readiness[]>([]);
  const [candles, setCandles] = useState<ReconstructedCandle[]>([]);
  const [captureImageUrl, setCaptureImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const [tickSequence, setTickSequence] = useState(0);
  const [clockNow, setClockNow] = useState(() => new Date());
  const [focusedSegmentId, setFocusedSegmentId] = useState('');

  const timeframe = useMemo(() => resolveAutonomousTimeframe(readiness), [readiness]);
  const selected = useMemo(() => {
    const segments = report?.segments ?? [];
    if (!segments.length) return null;
    return segments.find((item) => item.id === focusedSegmentId)
      ?? segments.reduce((best, item) => item.confidenceScore > best.confidenceScore ? item : best, segments[0]);
  }, [focusedSegmentId, report?.segments]);

  const phaseCounts = useMemo(() => {
    const groups = new Map<string, number>();
    for (const segment of report?.segments ?? []) {
      groups.set(segment.segmentType, (groups.get(segment.segmentType) ?? 0) + 1);
    }
    return Array.from(groups.entries()).slice(0, 4);
  }, [report]);

  const chartImage = resolveCaptureDisplayUrl({
    imageUrl: captureImageUrl ?? report?.capture.imageUrl,
    metadata: report?.capture.metadata,
  }) ?? '';

  const loadCaptureBundle = useCallback(async (captureId: string) => {
    try {
      const response = await fetch(`/api/visual-intelligence/captures/${encodeURIComponent(captureId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setCandles([]);
        setCaptureImageUrl(null);
        return;
      }
      const capture = payload.analysis?.capture as { imageUrl?: string; metadata?: Record<string, unknown> } | undefined;
      setCandles(Array.isArray(payload.analysis?.candles) ? payload.analysis.candles as ReconstructedCandle[] : []);
      setCaptureImageUrl(resolveCaptureDisplayUrl({ imageUrl: capture?.imageUrl, metadata: capture?.metadata }));
    } catch {
      setCandles([]);
      setCaptureImageUrl(null);
    }
  }, []);

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

      const [coverageResponse, tickResponse] = await Promise.all([
        fetch(`/api/visual-analysis/segmentation/coverage?symbol=${encodeURIComponent(pipelineSymbol)}`, { cache: 'no-store' }),
        fetch('/api/dashboard/tick', { cache: 'no-store' }),
      ]);

      const coveragePayload = await coverageResponse.json();
      const nextReadiness = coveragePayload.ok && Array.isArray(coveragePayload.readiness)
        ? coveragePayload.readiness as Readiness[]
        : [];
      setReadiness(nextReadiness);
      const autonomousTimeframe = resolveAutonomousTimeframe(nextReadiness);

      const latestResponse = await fetch(
        `/api/visual-analysis/segmentation/${encodeURIComponent(pipelineSymbol)}/${encodeURIComponent(autonomousTimeframe)}/latest`,
        { cache: 'no-store' },
      );
      if (latestResponse.ok) {
        const latestPayload = await latestResponse.json();
        const nextReport = latestPayload.report as SegmentationReport;
        setReport(nextReport);
        setFocusedSegmentId(nextReport.segments?.[0]?.id ?? '');
        if (nextReport.capture?.id) await loadCaptureBundle(nextReport.capture.id);
      } else {
        setReport(null);
        setFocusedSegmentId('');
        const tfReady = nextReadiness.find((item) => item.timeframe === autonomousTimeframe);
        if (tfReady?.captureId) await loadCaptureBundle(tfReady.captureId);
      }

      const tickPayload = await tickResponse.json().catch(() => null);
      if (tickPayload?.ok && tickPayload.tick) {
        setLastTickAt(String(tickPayload.tick.tickAt));
        setTickSequence(Number(tickPayload.tick.sequence) || 0);
        setBridgeOnline(Boolean(tickPayload.tick.bridge?.online));
      }
      setLastSyncAt(new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load chart segmentation.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadCaptureBundle, symbol]);

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
        if (!event.eventType?.startsWith('segmentation.')) return;
        const eventSymbol = String(event.payload?.symbol ?? '').toUpperCase();
        if (eventSymbol && eventSymbol !== symbol.toUpperCase()) return;
        void loadRegistry(false);
      } catch {
        // ignore malformed stream chunks
      }
    };
    return () => source.close();
  }, [loadRegistry, symbol]);

  const segmentedCount = readiness.filter((item) => item.segmentCount > 0).length;
  const readyCount = readiness.filter((item) => item.readyForSegmentation).length;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <TraderSidebar bridgeOnline={bridgeOnline} mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />

      <div className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white px-4 py-4 md:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button size="icon" variant="outline" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700">Semantic chart zoning</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">AI Chart Segmentation</h1>
                <p className="truncate text-xs font-mono text-slate-500">
                  WAT {formatWatClock(clockNow)} · Tick #{tickSequence || '—'} {formatRelativeTime(lastTickAt, clockNow)}
                  {' · '}Synced {formatRelativeTime(lastSyncAt, clockNow)}{refreshing ? ' · updating…' : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Autonomous monitor</p>
                <p className="font-mono text-xs font-semibold text-slate-900">
                  {SYSTEM_FOCUS_SYMBOL_LABELS[symbol as keyof typeof SYSTEM_FOCUS_SYMBOL_LABELS] ?? symbol} ({symbol}) · {timeframe}
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
              <Link href="/visual-intelligence-overview/chart-screenshot-capture" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <LineChart className="h-4 w-4" />
                Captures
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-white p-4 md:p-6">
          {error ? (
            <Card className="mb-4 border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </CardContent>
            </Card>
          ) : null}

          <Panel icon={Layers3} title="Autonomous segmentation ladder (W → M15)" tone="blue">
            <div className="grid gap-2 md:grid-cols-5">
              {TIMEFRAMES.map((tf) => {
                const item = readiness.find((entry) => entry.timeframe === tf);
                const active = timeframe === tf;
                const rowTone: DashboardTone = active
                  ? 'blue'
                  : item?.segmentCount
                    ? 'emerald'
                    : item?.readyForSegmentation
                      ? 'violet'
                      : 'slate';
                return (
                  <div key={tf} className={cn('rounded-lg border px-3 py-3', toneMetric(rowTone))}>
                    <p className={cn('font-mono text-lg font-bold', toneTitle(rowTone))}>{tf}</p>
                    <p className={cn('mt-1 text-[10px] font-bold uppercase', toneMuted(rowTone))}>
                      {!item?.hasCapture ? 'Awaiting capture' : !item.readyForSegmentation ? 'Awaiting candles' : item.segmentCount ? 'Segmented' : 'Queued'}
                    </p>
                    <p className={cn('mt-2 text-[11px]', toneBody(rowTone))}>
                      {item?.segmentCount ?? 0} segments · {item?.candleCount ?? 0} candles
                    </p>
                  </div>
                );
              })}
            </div>
            <p className={cn('mt-3 text-xs', toneMuted('blue'))}>
              Pipeline bootstraps segmentation on new captures · {segmentedCount}/5 segmented · {readyCount}/5 ready · focus {timeframe} · {report?.segments.length ?? 0} active segments
            </p>
          </Panel>

          <section className="mb-4 mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard tone="blue" icon={Layers3} label="Segments" value={String(report?.segments.length ?? 0)} detail="Detected market regions" />
            <MetricCard tone="purple" icon={BrainCircuit} label="Model" value={report?.modelVersion ?? 'hybrid'} detail="Regime clustering engine" />
            <MetricCard tone={toneForType(selected?.segmentType)} icon={Blocks} label="Focus segment" value={selected?.segmentType ?? '—'} detail={selected ? `${Math.round(selected.confidenceScore * 100)}% confidence` : 'Awaiting pipeline'} />
            <MetricCard tone="emerald" icon={GitBranch} label="Phase mix" value={String(phaseCounts.length)} detail="Distinct segment types" />
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
            <section className="space-y-4">
              <Card className={cn('overflow-hidden shadow-sm', toneCard('blue'))}>
                <CardHeader className={cn('border-b', toneCardHeader('blue'))}>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Blocks className="h-5 w-5 text-blue-600" /> Chart preview with segmentation overlays
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <SegmentationChartPreview
                    imageUrl={chartImage}
                    candles={candles}
                    segments={report?.segments ?? []}
                    selectedId={selected?.id ?? ''}
                    onFocus={setFocusedSegmentId}
                  />
                </CardContent>
              </Card>

              <div className="grid gap-3 md:grid-cols-4">
                {phaseCounts.map(([type, count]) => (
                  <PhaseCard key={type} type={type} count={count} tone={toneForType(type)} />
                ))}
                {!phaseCounts.length ? <PhaseCard type="Awaiting segmentation" count={0} tone="slate" /> : null}
              </div>

              <Card className={cn('shadow-sm', toneCard('purple'))}>
                <CardHeader className={cn('border-b', toneCardHeader('purple'))}>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-5 w-5 text-purple-600" /> AI segment explanation
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <p className="text-sm leading-6 text-slate-600">{report?.explanation ?? 'Awaiting autonomous pipeline segmentation once capture candles are ready.'}</p>
                </CardContent>
              </Card>

              <Card className={cn('shadow-sm', toneCard('emerald'))}>
                <CardHeader className={cn('border-b', toneCardHeader('emerald'))}>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <GitBranch className="h-5 w-5 text-emerald-600" /> Segment timeline
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="flex min-h-20 items-stretch gap-1 overflow-x-auto">
                    {(report?.segments ?? []).map((segment) => (
                      <button
                        key={segment.id}
                        type="button"
                        onClick={() => setFocusedSegmentId(segment.id)}
                        className={cn(
                          'min-w-32 rounded-lg border p-3 text-left text-xs transition',
                          toneInsetSurface(toneForType(segment.segmentType)),
                          selected?.id === segment.id && 'ring-2 ring-blue-500',
                        )}
                      >
                        <p className="font-semibold text-slate-950">{segment.segmentType}</p>
                        <p className="mt-1 font-mono text-slate-600">{segment.startCandleIndex}-{segment.endCandleIndex}</p>
                      </button>
                    ))}
                    {!report?.segments.length ? <p className="text-sm text-slate-500">No segment timeline available yet.</p> : null}
                  </div>
                </CardContent>
              </Card>
            </section>

            <aside className="space-y-4">
              <Card className={cn('shadow-sm', toneCard('blue'))}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Layers3 className="h-5 w-5 text-blue-600" /> Segment list
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[330px] pr-3">
                    <div className="space-y-2">
                      {(report?.segments ?? []).map((segment) => (
                        <button
                          key={segment.id}
                          type="button"
                          onClick={() => setFocusedSegmentId(segment.id)}
                          className={cn(
                            'w-full rounded-lg border p-3 text-left transition',
                            selected?.id === segment.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-50',
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-950">{segment.segmentType}</p>
                            <span className="font-mono text-xs text-blue-700">{Math.round(segment.confidenceScore * 100)}%</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">Candles {segment.startCandleIndex}-{segment.endCandleIndex}</p>
                        </button>
                      ))}
                      {!report?.segments.length ? <p className="text-sm text-slate-500">No segments available yet.</p> : null}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <SelectedSegmentCard segment={selected} />

              <Card className={cn('shadow-sm', toneCard('orange'))}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Target className="h-5 w-5 text-orange-600" /> Segment type legend
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2">
                    {LEGEND.map((item) => (
                      <div key={item} className={cn('rounded-md border px-2 py-2 text-xs font-semibold', toneInsetSurface(toneForType(item)))}>
                        {item}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

function SegmentationChartPreview(props: {
  imageUrl: string;
  candles: ReconstructedCandle[];
  segments: Segment[];
  selectedId: string;
  onFocus: (id: string) => void;
}) {
  const width = 760;
  const height = 320;
  const padding = { top: 16, right: 16, bottom: 24, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const candleCount = Math.max(1, props.candles.length);
  const prices = props.candles.flatMap((item) => [item.highPrice, item.lowPrice]);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 1;
  const priceRange = Math.max(0.0001, maxPrice - minPrice);
  const yForPrice = (price: number) => padding.top + ((maxPrice - price) / priceRange) * plotHeight;
  const xForIndex = (index: number) => padding.left + (index + 0.5) * (plotWidth / candleCount);

  if (props.imageUrl) {
    return (
      <div className="relative min-h-[320px] overflow-hidden bg-slate-100">
        <img src={props.imageUrl} alt="Segmented chart capture" className="h-full min-h-[320px] w-full object-cover" />
        {props.segments.map((segment) => {
          const left = (segment.startCandleIndex / Math.max(1, candleCount - 1)) * 100;
          const right = (segment.endCandleIndex / Math.max(1, candleCount - 1)) * 100;
          const widthPct = Math.max(4, right - left + (100 / candleCount));
          return (
            <button
              key={segment.id}
              type="button"
              onClick={() => props.onFocus(segment.id)}
              className={cn('absolute inset-y-0 border-x transition hover:bg-white/20', overlayBg(toneForType(segment.segmentType)), props.selectedId === segment.id && 'ring-2 ring-blue-500')}
              style={{ left: `${left}%`, width: `${widthPct}%` }}
            >
              <span className="absolute bottom-3 left-2 right-2 rounded-md bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-900 shadow-sm">{segment.segmentType}</span>
            </button>
          );
        })}
      </div>
    );
  }

  if (!props.candles.length) {
    return (
      <div className="flex min-h-[320px] items-center justify-center bg-slate-50 text-sm text-slate-500">
        Awaiting capture candles for segmentation preview
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-b-lg border-t border-slate-200 bg-white">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full min-h-[320px] w-full">
        {props.segments.map((segment) => {
          const x1 = xForIndex(segment.startCandleIndex) - plotWidth / candleCount / 2;
          const x2 = xForIndex(segment.endCandleIndex) + plotWidth / candleCount / 2;
          return (
            <rect
              key={segment.id}
              x={x1}
              y={padding.top}
              width={Math.max(8, x2 - x1)}
              height={plotHeight}
              fill={overlayFill(toneForType(segment.segmentType))}
              stroke={props.selectedId === segment.id ? '#2563eb' : 'transparent'}
              strokeWidth={2}
              onClick={() => props.onFocus(segment.id)}
            />
          );
        })}
        {props.candles.map((candle) => {
          const x = xForIndex(candle.candleIndex);
          const openY = yForPrice(candle.openPrice);
          const closeY = yForPrice(candle.closePrice);
          const highY = yForPrice(candle.highPrice);
          const lowY = yForPrice(candle.lowPrice);
          const bullish = candle.closePrice >= candle.openPrice;
          const color = bullish ? '#059669' : '#e11d48';
          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(2, Math.abs(closeY - openY));
          const candleWidth = Math.max(3, Math.min(10, plotWidth / candleCount - 2));
          return (
            <g key={candle.candleIndex}>
              <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1.5" />
              <rect x={x - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} fill={color} opacity={0.92} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SelectedSegmentCard({ segment }: { segment: Segment | null }) {
  return (
    <Card className={cn('shadow-sm', toneCard('purple'))}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BrainCircuit className="h-5 w-5 text-purple-600" /> Focus segment detail
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="font-mono text-2xl font-semibold text-slate-950">{segment?.segmentType ?? '--'}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">{segment?.marketMeaning ?? 'Pipeline will surface the highest-confidence segment automatically.'}</p>
        </div>
        <Meter label="Segment confidence" value={(segment?.confidenceScore ?? 0) * 100} tone={toneForType(segment?.segmentType)} />
        <Detail label="Price range" value={segment ? `${segment.priceLow.toFixed(2)} - ${segment.priceHigh.toFixed(2)}` : '--'} />
        <Detail label="Volatility regime" value={segment?.volatilityRegime ?? '--'} />
        <Detail label="Structure regime" value={segment?.structureRegime ?? '--'} />
        <Detail label="Institutional interpretation" value={segment?.institutionalInterpretation ?? '--'} />
        <Detail label="Trading relevance" value={segment?.tradingRelevance ?? '--'} />
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
        <p className={cn('mt-2 truncate font-mono text-2xl font-bold', toneTitle(props.tone))}>{props.value}</p>
        <p className={cn('mt-1 text-xs', toneBody(props.tone))}>{props.detail}</p>
      </CardContent>
    </Card>
  );
}

function PhaseCard(props: { type: string; count: number; tone: DashboardTone }) {
  return (
    <Card className={cn('shadow-sm', toneCard(props.tone))}>
      <CardContent className="p-4">
        <p className={cn('text-xs font-semibold', toneMuted(props.tone))}>{props.type}</p>
        <p className={cn('mt-2 font-mono text-3xl font-semibold', toneTitle(props.tone))}>{props.count}</p>
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

function Detail(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{props.label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{props.value}</p>
    </div>
  );
}

function toneForType(type?: string): DashboardTone {
  if (!type) return 'slate';
  if (type.includes('Accumulation') || type.includes('Trend')) return 'emerald';
  if (type.includes('Manipulation') || type.includes('Liquidity')) return 'purple';
  if (type.includes('Expansion') || type.includes('Breakout')) return 'blue';
  if (type.includes('Distribution') || type.includes('Reversal')) return 'rose';
  if (type.includes('Compression') || type.includes('Pullback') || type.includes('Retest')) return 'amber';
  return 'orange';
}

function overlayBg(tone: DashboardTone) {
  return {
    blue: 'bg-blue-500/18',
    emerald: 'bg-emerald-500/18',
    orange: 'bg-orange-500/18',
    purple: 'bg-purple-500/18',
    rose: 'bg-rose-500/18',
    slate: 'bg-slate-500/18',
    amber: 'bg-amber-500/18',
    violet: 'bg-violet-500/18',
    cyan: 'bg-cyan-500/18',
  }[tone];
}

function overlayFill(tone: DashboardTone) {
  return {
    blue: 'rgba(59,130,246,0.16)',
    emerald: 'rgba(16,185,129,0.16)',
    orange: 'rgba(249,115,22,0.16)',
    purple: 'rgba(168,85,247,0.16)',
    rose: 'rgba(244,63,94,0.16)',
    slate: 'rgba(100,116,139,0.12)',
    amber: 'rgba(245,158,11,0.16)',
    violet: 'rgba(139,92,246,0.16)',
    cyan: 'rgba(6,182,212,0.16)',
  }[tone];
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
