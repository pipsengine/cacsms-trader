'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  Bot,
  DatabaseZap,
  Flame,
  Gauge,
  LineChart,
  Menu,
  Radio,
  ShieldAlert,
  Siren,
  Sparkles,
  Waves,
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
import { SYSTEM_FOCUS_SYMBOL_LABELS } from '@/lib/focus-symbols';
import type { ReconstructedCandle } from '@/lib/visual-intelligence-types';
import { cn } from '@/lib/utils';

const TIMEFRAMES = ['MN', 'W', 'D', 'H4', 'H1', 'M15'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
type Severity = 'Low' | 'Medium' | 'High' | 'Critical';

type Anomaly = {
  id: string;
  anomalyType: string;
  severity: Severity;
  affectedTimeframe: string;
  affectedPriceZone: { low: number | null; high: number | null; midpoint: number | null };
  visualCoordinates: Record<string, unknown>;
  probabilityScore: number;
  tradingRiskMeaning: string;
  possibleCause: string;
  recommendedAction: string;
  resolved: boolean;
  createdAt: string;
};

type AnomalyReport = {
  job: {
    id: string;
    captureId: string | null;
    symbol: string;
    timeframe: string;
    status: string;
    modelVersion: string;
    createdAt: string;
  };
  severity: {
    lowCount: number;
    mediumCount: number;
    highCount: number;
    criticalCount: number;
    overallSeverity: Severity;
    manipulationProbability: number;
    feedQualityScore: number;
    imageIntegrityScore: number;
    volatilitySpikeScore: number;
    explanation: string;
  };
  anomalies: Anomaly[];
};

type Readiness = {
  timeframe: Timeframe;
  captureId: string | null;
  capturedAt: string | null;
  candleCount: number;
  hasCapture: boolean;
  scanCount: number;
  latestScanAt: string | null;
  latestSeverity: Severity | null;
  openAnomalyCount: number;
  readyForScan: boolean;
};

function resolveAutonomousTimeframe(readiness: Readiness[]): Timeframe {
  const priority: Timeframe[] = ['M15', 'H1', 'H4', 'D', 'W'];
  const alerted = readiness
    .filter((item) => item.openAnomalyCount > 0)
    .sort((left, right) => priority.indexOf(left.timeframe) - priority.indexOf(right.timeframe));
  if (alerted[0]) return alerted[0].timeframe;
  const scanned = readiness
    .filter((item) => item.scanCount > 0)
    .sort((left, right) => priority.indexOf(left.timeframe) - priority.indexOf(right.timeframe));
  if (scanned[0]) return scanned[0].timeframe;
  return 'H1';
}

export function VisualAnomalyDetectionDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [pipelineMode, setPipelineMode] = useState('full_auto');
  const [activeSymbols, setActiveSymbols] = useState<string[]>(['XAUUSD']);
  const [report, setReport] = useState<AnomalyReport | null>(null);
  const [history, setHistory] = useState<AnomalyReport[]>([]);
  const [readiness, setReadiness] = useState<Readiness[]>([]);
  const [candles, setCandles] = useState<ReconstructedCandle[]>([]);
  const [captureImageUrl, setCaptureImageUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ type: string; message: string; time: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const [tickSequence, setTickSequence] = useState(0);
  const [clockNow, setClockNow] = useState(() => new Date());

  const timeframe = useMemo(() => resolveAutonomousTimeframe(readiness), [readiness]);
  const openAnomalies = useMemo(() => report?.anomalies.filter((item) => !item.resolved) ?? [], [report]);
  const highlightedIndexes = useMemo(
    () => new Set(openAnomalies.map((item) => Number(item.visualCoordinates.candleIndex)).filter((value) => Number.isFinite(value))),
    [openAnomalies],
  );
  const chartImage = resolveCaptureDisplayUrl({ imageUrl: captureImageUrl ?? undefined }) ?? '';

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
      setCaptureImageUrl(resolveCaptureDisplayUrl({
        imageUrl: capture?.imageUrl,
        metadata: capture?.metadata,
      }));
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

      const [coverageResponse, historyResponse, tickResponse] = await Promise.all([
        fetch(`/api/visual-analysis/anomaly/coverage?symbol=${encodeURIComponent(pipelineSymbol)}`, { cache: 'no-store' }),
        fetch(`/api/visual-analysis/anomaly/${encodeURIComponent(pipelineSymbol)}/history?limit=12`, { cache: 'no-store' }),
        fetch('/api/dashboard/tick', { cache: 'no-store' }),
      ]);

      const coveragePayload = await coverageResponse.json();
      const nextReadiness = coveragePayload.ok && Array.isArray(coveragePayload.readiness)
        ? coveragePayload.readiness as Readiness[]
        : [];
      setReadiness(nextReadiness);
      const autonomousTimeframe = resolveAutonomousTimeframe(nextReadiness);

      const historyPayload = await historyResponse.json();
      if (historyPayload.ok) {
        setHistory(Array.isArray(historyPayload.history) ? historyPayload.history as AnomalyReport[] : []);
      }

      const focusedLatest = await fetch(
        `/api/visual-analysis/anomaly/${encodeURIComponent(pipelineSymbol)}/${encodeURIComponent(autonomousTimeframe)}/latest`,
        { cache: 'no-store' },
      );
      if (focusedLatest.ok) {
        const latestPayload = await focusedLatest.json();
        const nextReport = latestPayload.report as AnomalyReport;
        setReport(nextReport);
        if (nextReport.job.captureId) await loadCaptureBundle(nextReport.job.captureId);
      } else {
        setReport(null);
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
      setError(loadError instanceof Error ? loadError.message : 'Unable to load visual anomaly detection.');
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
        if (!event.eventType?.startsWith('anomaly.')) return;
        const eventSymbol = String(event.payload?.symbol ?? '').toUpperCase();
        if (eventSymbol && eventSymbol !== symbol.toUpperCase()) return;
        setEvents((items) => [{
          type: event.eventType ?? 'anomaly.event',
          message: String(event.payload?.anomalyType ?? event.payload?.overallSeverity ?? 'visual anomaly update'),
          time: new Date().toLocaleTimeString(),
        }, ...items].slice(0, 10));
        void loadRegistry(false);
      } catch {
        // Keep anomaly event stream resilient.
      }
    };
    return () => source.close();
  }, [loadRegistry, symbol]);

  const readyCount = readiness.filter((item) => item.readyForScan).length;
  const scannedCount = readiness.filter((item) => item.scanCount > 0).length;
  const severityTone = toneForSeverity(report?.severity.overallSeverity);

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
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-700">Feed integrity surveillance</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">Visual Anomaly Detection</h1>
                <p className="truncate text-xs font-mono text-slate-500">
                  WAT {formatWatClock(clockNow)} · Tick #{tickSequence || '—'} {formatRelativeTime(lastTickAt, clockNow)}
                  {' · '}Synced {formatRelativeTime(lastSyncAt, clockNow)}{refreshing ? ' · updating…' : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-rose-700">Autonomous monitor</p>
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

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-white p-4 md:p-6">
          {error ? (
            <Card className="mb-4 border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </CardContent>
            </Card>
          ) : null}

          <Panel icon={Siren} title="Autonomous top-down ladder (W → M15)" tone="rose">
            <div className="grid gap-2 md:grid-cols-5">
              {TIMEFRAMES.map((tf) => {
                const item = readiness.find((entry) => entry.timeframe === tf);
                const active = timeframe === tf;
                const rowTone: DashboardTone = active
                  ? 'rose'
                  : item?.openAnomalyCount
                    ? 'amber'
                    : item?.scanCount
                      ? 'emerald'
                      : item?.readyForScan
                        ? 'blue'
                        : 'slate';
                return (
                  <div
                    key={tf}
                    className={cn('rounded-lg border px-3 py-3', toneMetric(rowTone))}
                  >
                    <p className={cn('font-mono text-lg font-bold', toneTitle(rowTone))}>{tf}</p>
                    <p className={cn('mt-1 text-[10px] font-bold uppercase', toneMuted(rowTone))}>
                      {!item?.hasCapture ? 'Awaiting capture' : !item.readyForScan ? 'Awaiting candles' : item.scanCount ? 'Pipeline scanned' : 'Queued'}
                    </p>
                    <p className={cn('mt-2 text-[11px]', toneBody(rowTone))}>
                      {item?.openAnomalyCount ?? 0} open · {item?.candleCount ?? 0} candles
                    </p>
                  </div>
                );
              })}
            </div>
            <p className={cn('mt-3 text-xs', toneMuted('rose'))}>
              Pipeline bootstraps scans on new captures · {readyCount}/5 ready · {scannedCount}/5 scanned · focus {timeframe} · severity {report?.severity.overallSeverity ?? '—'}
            </p>
          </Panel>

          <section className="mb-4 mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard tone="emerald" icon={Activity} label="Low" value={String(report?.severity.lowCount ?? 0)} detail="Minor deviations" />
            <MetricCard tone="amber" icon={AlertTriangle} label="Medium" value={String(report?.severity.mediumCount ?? 0)} detail="Monitor closely" />
            <MetricCard tone="rose" icon={Flame} label="High" value={String(report?.severity.highCount ?? 0)} detail="Trade caution" />
            <MetricCard tone="slate" icon={AlertOctagon} label="Critical" value={String(report?.severity.criticalCount ?? 0)} detail="Escalate / avoid" />
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
            <section className="space-y-4">
              <Card className={cn('shadow-sm', toneCard('blue'))}>
                <CardHeader className={cn('border-b', toneCardHeader('blue'))}>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <LineChart className="h-5 w-5 text-blue-600" /> Chart context
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 p-4">
                  {chartImage ? (
                    <img src={chartImage} alt={`${symbol} ${timeframe} capture`} className="w-full rounded-lg border border-slate-200 object-cover" />
                  ) : (
                    <AnomalyChartPreview candles={candles} highlightedIndexes={highlightedIndexes} label={`${symbol} ${timeframe}`} />
                  )}
                  <p className="text-xs text-slate-500">
                    {highlightedIndexes.size > 0
                      ? `${highlightedIndexes.size} anomalous candle region(s) highlighted on reconstructed OHLC.`
                      : 'No anomalous candle coordinates in the active scan.'}
                  </p>
                </CardContent>
              </Card>

              <Card className={cn('shadow-sm', toneCard('blue'))}>
                <CardHeader className={cn('border-b', toneCardHeader('blue'))}>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BarChart3 className="h-5 w-5 text-blue-600" /> Anomaly dashboard
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <AnomalyHeatmap anomalies={openAnomalies} />
                  <div className="space-y-3">
                    <Meter label="Manipulation probability" value={(report?.severity.manipulationProbability ?? 0) * 100} tone="purple" />
                    <Meter label="Volatility spike" value={(report?.severity.volatilitySpikeScore ?? 0) * 100} tone="rose" />
                    <Meter label="Image integrity" value={(report?.severity.imageIntegrityScore ?? 1) * 100} tone="emerald" />
                    <Meter label="Feed quality" value={(report?.severity.feedQualityScore ?? 1) * 100} tone="blue" />
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <DetectorCard icon={Flame} title="Abnormal Candle Detector" tone="rose" anomaly={findAnomaly(openAnomalies, ['Abnormally large candle', 'Price displacement without normal structure'])} />
                <DetectorCard icon={Waves} title="Abnormal Wick Detector" tone="purple" anomaly={findAnomaly(openAnomalies, ['Abnormally long wick', 'Stop hunt spike', 'Liquidity sweep anomaly'])} />
                <DetectorCard icon={Activity} title="Price Gap Detector" tone="amber" anomaly={findAnomaly(openAnomalies, ['Sudden gap', 'Missing candle anomaly'])} />
                <DetectorCard icon={DatabaseZap} title="Feed Quality Detector" tone="slate" anomaly={findAnomaly(openAnomalies, ['Chart feed distortion', 'Duplicate candle anomaly', 'Missing candle anomaly'])} />
                <DetectorCard icon={ShieldAlert} title="Manipulation Alert Panel" tone="purple" anomaly={findAnomaly(openAnomalies, ['Manipulation probability elevated', 'Abnormally long wick', 'Unusual compression before expansion'])} />
                <DetectorCard icon={AlertOctagon} title="Broker/Chart Data Integrity Alert" tone="slate" anomaly={findAnomaly(openAnomalies, ['Chart feed distortion', 'Duplicate candle anomaly', 'Missing candle anomaly'])} />
              </div>

              <Card className={cn('shadow-sm', toneCard(severityTone))}>
                <CardHeader className={cn('border-b', toneCardHeader(severityTone))}>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-5 w-5 text-purple-600" /> AI explanation panel
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <p className="text-sm leading-6 text-slate-600">{report?.severity.explanation ?? 'Awaiting autonomous pipeline scan once capture candles are ready.'}</p>
                </CardContent>
              </Card>
            </section>

            <aside className="space-y-4">
              <Card className={cn('shadow-sm', toneCard('rose'))}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Siren className="h-5 w-5 text-red-600" /> Real-time anomaly feed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[360px] pr-3">
                    <div className="space-y-3">
                      {openAnomalies.map((anomaly) => (
                        <div key={anomaly.id} className={cn('rounded-lg border p-3', toneInsetSurface(toneForSeverity(anomaly.severity)))}>
                          <div>
                            <p className="text-sm font-semibold text-slate-950">{anomaly.anomalyType}</p>
                            <p className="mt-1 font-mono text-xs text-slate-500">{anomaly.affectedTimeframe} / {Math.round(anomaly.probabilityScore * 100)}%</p>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-slate-700">{anomaly.tradingRiskMeaning}</p>
                          <p className="mt-2 text-xs font-semibold text-slate-800">Action: {anomaly.recommendedAction}</p>
                        </div>
                      ))}
                      {!openAnomalies.length ? <p className="text-sm text-slate-500">No unresolved anomalies in the latest scan.</p> : null}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card className={cn('shadow-sm', toneCard('emerald'))}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Radio className="h-5 w-5 text-emerald-600" /> WebSocket events
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {events.map((event, index) => (
                      <div key={`${event.time}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="text-xs font-semibold text-slate-900">{event.type}</p>
                        <p className="text-xs text-slate-500">{event.message} / {event.time}</p>
                      </div>
                    ))}
                    {!events.length ? <p className="text-sm text-slate-500">Live anomaly events will appear here.</p> : null}
                  </div>
                </CardContent>
              </Card>

              <Card className={cn('shadow-sm', toneCard('blue'))}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Gauge className="h-5 w-5 text-blue-600" /> Symbol history
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {history.slice(0, 6).map((item) => (
                      <div key={item.job.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-900">{item.job.timeframe}</p>
                          <span className={cn('font-mono text-xs', toneTitle(toneForSeverity(item.severity.overallSeverity)))}>{item.severity.overallSeverity}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{item.anomalies.length} anomaly signal(s)</p>
                      </div>
                    ))}
                    {!history.length ? <p className="text-sm text-slate-500">No anomaly history loaded yet.</p> : null}
                  </div>
                </CardContent>
              </Card>
            </aside>
          </div>
        </main>
      </div>
    </DashboardPageFrame>
  );
}

function AnomalyChartPreview(props: { candles: ReconstructedCandle[]; highlightedIndexes: Set<number>; label: string }) {
  if (props.candles.length === 0) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
        {props.label} — sync chart captures to reconstruct candles
      </div>
    );
  }
  const decorated = props.candles.map((candle) => ({
    ...candle,
    confidence: props.highlightedIndexes.has(candle.candleIndex) ? 0.2 : candle.confidence,
  }));
  return <CaptureChartPreview candles={decorated} label={props.label} aspectClassName="aspect-video" />;
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

function AnomalyHeatmap({ anomalies }: { anomalies: Anomaly[] }) {
  const cells = Array.from({ length: 36 }, (_, index) => anomalies[index % Math.max(1, anomalies.length)]);
  return (
    <div className="grid grid-cols-6 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {cells.map((anomaly, index) => (
        <div
          key={index}
          className={cn('grid aspect-square place-items-center rounded-md border text-[10px] font-mono', anomaly ? heatClass(anomaly.severity) : 'border-emerald-200 bg-emerald-50 text-emerald-700')}
        >
          {anomaly ? Math.round(anomaly.probabilityScore * 99) : 0}
        </div>
      ))}
    </div>
  );
}

function DetectorCard(props: { icon: LucideIcon; title: string; tone: DashboardTone; anomaly?: Anomaly }) {
  const Icon = props.icon;
  const tone = props.anomaly ? toneForSeverity(props.anomaly.severity) : 'emerald';
  return (
    <Card className={cn('shadow-sm', toneCard('slate'))}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="flex items-center gap-2"><Icon className={cn('h-5 w-5', toneTitle(props.tone))} /> {props.title}</span>
          <span className={cn('rounded-md border px-2 py-1 text-[11px] font-semibold', toneMetric(tone))}>
            {props.anomaly?.severity ?? 'Normal'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-slate-600">{props.anomaly?.tradingRiskMeaning ?? 'No active anomaly detected in this detector.'}</p>
        <p className="mt-3 text-xs font-semibold text-slate-700">{props.anomaly ? `Cause: ${props.anomaly.possibleCause}` : 'Action: Ignore'}</p>
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

function findAnomaly(anomalies: Anomaly[], names: string[]) {
  return anomalies.find((item) => names.includes(item.anomalyType));
}

function toneForSeverity(severity?: Severity): DashboardTone {
  if (severity === 'Critical') return 'slate';
  if (severity === 'High') return 'rose';
  if (severity === 'Medium') return 'amber';
  return 'emerald';
}

function heatClass(severity: Severity) {
  return {
    Low: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    Medium: 'border-amber-200 bg-amber-50 text-amber-700',
    High: 'border-rose-200 bg-rose-50 text-rose-700',
    Critical: 'border-slate-800 bg-slate-950 text-white',
  }[severity];
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
