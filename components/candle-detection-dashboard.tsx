'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Camera,
  CandlestickChart,
  FlaskConical,
  Layers3,
  Menu,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react';

import { DashboardPageFrame } from '@/components/dashboard-page-frame';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
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

const TOP_DOWN_TIMEFRAMES = ['MN', 'W', 'D', 'H4', 'H1', 'M15'] as const;

type CaptureRecord = {
  id: string;
  symbol: string;
  timeframe: string;
  sourcePlatform: string;
  imageUrl: string;
  processingStatus: string;
  capturedAt: string;
};

type ReconstructedCandle = {
  candleIndex: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  direction: string;
  confidence: number;
};

type CandleClassification = {
  id?: string;
  candleIndex: number;
  detectedCandleType: string;
  direction: string;
  tradingMeaning: string;
  implication: string;
  supportsDecision: 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
  bodyStrengthScore: number;
  wickRejectionScore: number;
  momentumScore: number;
  manipulationScore: number;
  institutionalDisplacementScore: number;
  candleReliabilityScore: number;
  finalConfidenceScore: number;
  riskWarning: string;
  explanationText: string;
  geometry: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

type CandleSequence = {
  sequenceStartIndex: number;
  sequenceEndIndex: number;
  detectedSequenceType: string;
  phaseState: string;
  momentumState: string;
  implication: string;
  supportsDecision: 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
  confidence: number;
  riskWarning: string;
  explanationText: string;
  metadata: Record<string, unknown>;
};

type CandleAnalysis = {
  captureId: string;
  classifications: CandleClassification[];
  sequences: CandleSequence[];
  summary: {
    dominantType: string;
    dominantDirection: string;
    recommendedDecision: 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
    confidence: number;
    explanation: string;
  };
};

type CaptureBundle = {
  capture: CaptureRecord;
  candles: ReconstructedCandle[];
};

export function CandleDetectionDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [coverage, setCoverage] = useState<Record<string, number>>({});
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [captureBundle, setCaptureBundle] = useState<CaptureBundle | null>(null);
  const [analysis, setAnalysis] = useState<CandleAnalysis | null>(null);
  const [selectedCandleIndex, setSelectedCandleIndex] = useState<number | null>(null);
  const [symbol, setSymbol] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => new Date());

  const symbols = useMemo(() => Array.from(new Set(captures.map((item) => item.symbol))).sort(), [captures]);
  const filteredCaptures = useMemo(
    () => (symbol === 'ALL' ? captures : captures.filter((item) => item.symbol === symbol)),
    [captures, symbol],
  );
  const analyzedCount = useMemo(
    () => filteredCaptures.filter((item) => (coverage[item.id] ?? 0) > 0).length,
    [filteredCaptures, coverage],
  );
  const activeSymbol = symbol === 'ALL' ? (symbols[0] ?? '—') : symbol;

  const timeframeCoverage = useMemo(() => {
    const scoped = captures.filter((item) => item.symbol === activeSymbol);
    const present = new Set(scoped.map((item) => item.timeframe));
    return TOP_DOWN_TIMEFRAMES.map((timeframe) => ({
      timeframe,
      present: present.has(timeframe),
      capture: scoped.find((item) => item.timeframe === timeframe) ?? null,
      analyzed: Boolean(scoped.find((item) => item.timeframe === timeframe && (coverage[item.id] ?? 0) > 0)),
    }));
  }, [activeSymbol, captures, coverage]);

  const selectedCapture = filteredCaptures.find((item) => item.id === selectedCaptureId)
    ?? captures.find((item) => item.id === selectedCaptureId)
    ?? null;

  const selectedClassification = useMemo(
    () => analysis?.classifications.find((item) => item.candleIndex === selectedCandleIndex) ?? analysis?.classifications.at(-1) ?? null,
    [analysis, selectedCandleIndex],
  );

  const patternBreakdown = useMemo(() => {
    if (!analysis) return [];
    const counts = new Map<string, number>();
    for (const item of analysis.classifications) {
      counts.set(item.detectedCandleType, (counts.get(item.detectedCandleType) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [analysis]);

  const manipulationCount = useMemo(
    () => analysis?.classifications.filter((item) => item.manipulationScore >= 0.62).length ?? 0,
    [analysis],
  );

  const loadRegistry = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [capturesResponse, coverageResponse, bridgeResponse] = await Promise.all([
        fetch('/api/visual-intelligence/captures?limit=100', { cache: 'no-store' }),
        fetch('/api/vision/candles/coverage', { cache: 'no-store' }),
        fetch('/api/mt5/status', { cache: 'no-store' }),
      ]);
      const capturesPayload = await capturesResponse.json();
      const coveragePayload = await coverageResponse.json();
      if (!capturesPayload.ok) throw new Error(String(capturesPayload.error ?? 'Unable to load chart captures.'));
      const list = Array.isArray(capturesPayload.captures) ? (capturesPayload.captures as CaptureRecord[]) : [];
      setCaptures(list);
      setCoverage(coveragePayload.ok ? (coveragePayload.coverage as Record<string, number>) : {});
      setSelectedCaptureId((current) => {
        if (current && list.some((item) => item.id === current)) return current;
        const scoped = symbol === 'ALL' ? list : list.filter((item) => item.symbol === symbol);
        return scoped[0]?.id ?? list[0]?.id ?? null;
      });
      const bridgePayload = await bridgeResponse.json().catch(() => null);
      setBridgeOnline(Boolean(bridgePayload?.ok));
      setLastSyncAt(new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load candle detection registry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [symbol]);

  const loadCaptureBundle = useCallback(async (captureId: string) => {
    try {
      const response = await fetch(`/api/visual-intelligence/captures/${encodeURIComponent(captureId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setCaptureBundle(null);
        return;
      }
      const bundle = payload.analysis as { capture: CaptureRecord; candles: ReconstructedCandle[] };
      setCaptureBundle({ capture: bundle.capture, candles: bundle.candles ?? [] });
    } catch {
      setCaptureBundle(null);
    }
  }, []);

  const loadAnalysis = useCallback(async (captureId: string) => {
    setAnalysisLoading(true);
    try {
      const response = await fetch(`/api/vision/candles/${encodeURIComponent(captureId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setAnalysis(null);
        return;
      }
      const next = payload.analysis as CandleAnalysis;
      setAnalysis(next);
      setSelectedCandleIndex((current) => {
        if (current != null && next.classifications.some((item) => item.candleIndex === current)) return current;
        return next.classifications.at(-1)?.candleIndex ?? null;
      });
    } catch {
      setAnalysis(null);
    } finally {
      setAnalysisLoading(false);
    }
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!selectedCapture) return;
    setRunningAnalysis(true);
    setError(null);
    try {
      const response = await fetch('/api/vision/candles/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captureId: selectedCapture.id,
          symbol: selectedCapture.symbol,
          timeframe: selectedCapture.timeframe,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(String(payload.error ?? 'Candle analysis failed.'));
      }
      await Promise.all([
        loadAnalysis(selectedCapture.id),
        loadRegistry(false),
        loadCaptureBundle(selectedCapture.id),
      ]);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Candle analysis failed.');
    } finally {
      setRunningAnalysis(false);
    }
  }, [selectedCapture, loadAnalysis, loadRegistry, loadCaptureBundle]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadRegistry(true);
    const interval = window.setInterval(() => void loadRegistry(false), 5000);
    return () => window.clearInterval(interval);
  }, [loadRegistry]);

  useEffect(() => {
    if (!selectedCaptureId) {
      setAnalysis(null);
      setCaptureBundle(null);
      return;
    }
    void loadCaptureBundle(selectedCaptureId);
    void loadAnalysis(selectedCaptureId);
  }, [selectedCaptureId, loadCaptureBundle, loadAnalysis]);

  const chartCandles = captureBundle?.candles ?? [];
  const confidencePct = Math.round((analysis?.summary.confidence ?? 0) * 100);

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
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700">OHLC reconstruction</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">Candle Detection</h1>
                <p className="truncate text-xs font-mono text-slate-500">
                  Synced {formatRelativeTime(lastSyncAt, clockNow)}{refreshing ? ' · updating…' : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"
              >
                <option value="ALL">All symbols</option>
                {symbols.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
              <Button variant="outline" size="sm" onClick={() => void loadRegistry(false)} disabled={loading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', (loading || refreshing) && 'animate-spin')} />
                Refresh
              </Button>
              <Button
                size="sm"
                onClick={() => void runAnalysis()}
                disabled={!selectedCapture || runningAnalysis || chartCandles.length === 0}
              >
                <Play className={cn('mr-2 h-4 w-4', runningAnalysis && 'animate-pulse')} />
                {runningAnalysis ? 'Analyzing…' : 'Run detection'}
              </Button>
              <Link href="/visual-intelligence-overview/chart-screenshot-capture" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
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
            <MetricCard tone="amber" icon={CandlestickChart} label="Classified" value={String(analysis?.classifications.length ?? 0)} detail={`${analyzedCount}/${filteredCaptures.length} captures analyzed`} />
            <MetricCard tone="violet" icon={Layers3} label="Sequences" value={String(analysis?.sequences.length ?? 0)} detail="Multi-candle phase windows" />
            <MetricCard tone="blue" icon={Target} label="Decision" value={analysis?.summary.recommendedDecision ?? 'WAIT'} detail={analysis?.summary.dominantType ?? 'No analysis yet'} />
            <MetricCard tone="emerald" icon={Sparkles} label="Confidence" value={`${confidencePct}%`} detail={analysis?.summary.dominantDirection ?? 'neutral'} />
            <MetricCard tone={manipulationCount > 0 ? 'rose' : 'slate'} icon={ShieldAlert} label="Manipulation" value={String(manipulationCount)} detail="High-risk candle signatures" />
            <MetricCard tone="cyan" icon={FlaskConical} label="Reconstructed" value={String(chartCandles.length)} detail="OHLC candles from chart pixels" />
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <section className="space-y-4">
              <Panel icon={BarChart3} title="Classified candle chart" tone="amber">
                {analysisLoading ? (
                  <p className={cn('text-sm font-medium', toneBody('amber'))}>Loading candle analysis…</p>
                ) : chartCandles.length === 0 ? (
                  <p className={cn('text-sm font-medium', toneBody('amber'))}>
                    No reconstructed candles for this capture. Run chart capture analysis first, then run detection.
                  </p>
                ) : (
                  <CandlestickChartView
                    candles={chartCandles}
                    classifications={analysis?.classifications ?? []}
                    selectedIndex={selectedCandleIndex}
                    onSelect={setSelectedCandleIndex}
                  />
                )}
              </Panel>

              <Panel icon={Activity} title="Classification registry" tone="blue">
                {analysisLoading ? (
                  <p className={cn('text-sm font-medium', toneBody('blue'))}>Loading classifications…</p>
                ) : !analysis || analysis.classifications.length === 0 ? (
                  <p className={cn('text-sm font-medium', toneBody('blue'))}>
                    No candle classifications stored yet. Select a capture with reconstructed OHLC and run detection.
                  </p>
                ) : (
                  <ScrollArea className="h-[360px] pr-3">
                    <div className="space-y-2">
                      {[...analysis.classifications].reverse().map((item) => {
                        const active = selectedCandleIndex === item.candleIndex;
                        const rowTone: DashboardTone = decisionTone(item.supportsDecision);
                        return (
                          <button
                            key={item.candleIndex}
                            type="button"
                            onClick={() => setSelectedCandleIndex(item.candleIndex)}
                            className={cn(
                              'w-full rounded-lg border px-3 py-2 text-left shadow-sm transition-opacity',
                              active ? toneMetric('violet') : toneMetric(rowTone),
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className={cn('font-mono text-sm font-bold', toneTitle(active ? 'violet' : rowTone))}>
                                #{item.candleIndex} · {item.detectedCandleType}
                              </p>
                              <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', toneBadge(rowTone))}>
                                {item.supportsDecision}
                              </span>
                            </div>
                            <p className={cn('mt-1 text-xs', toneMuted(active ? 'violet' : rowTone))}>
                              {item.implication} · {Math.round(item.finalConfidenceScore * 100)}% confidence
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </Panel>

              <Panel icon={Layers3} title="Sequence analysis" tone="purple">
                {!analysis || analysis.sequences.length === 0 ? (
                  <p className={cn('text-sm font-medium', toneBody('purple'))}>Sequence windows appear after detection runs on reconstructed candles.</p>
                ) : (
                  <div className="space-y-3">
                    {analysis.sequences.map((sequence) => (
                      <div key={`${sequence.sequenceStartIndex}-${sequence.sequenceEndIndex}`} className={cn('rounded-lg border p-3', toneInsetSurface('purple'))}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className={cn('font-mono text-sm font-bold', toneTitle('purple'))}>
                            {sequence.sequenceStartIndex}–{sequence.sequenceEndIndex} · {sequence.detectedSequenceType}
                          </p>
                          <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', toneBadge(decisionTone(sequence.supportsDecision)))}>
                            {sequence.supportsDecision}
                          </span>
                        </div>
                        <p className={cn('mt-2 text-xs leading-5', toneBody('purple'))}>{sequence.explanationText}</p>
                        <p className={cn('mt-2 text-[11px]', toneMuted('purple'))}>
                          Phase {sequence.phaseState} · Momentum {sequence.momentumState} · {Math.round(sequence.confidence * 100)}% confidence
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </section>

            <aside className="space-y-4">
              <Panel icon={Camera} title="Capture registry" tone="cyan">
                {loading ? (
                  <p className={cn('text-sm font-medium', toneBody('cyan'))}>Loading captures…</p>
                ) : filteredCaptures.length === 0 ? (
                  <p className={cn('text-sm font-medium', toneBody('cyan'))}>No chart captures available yet.</p>
                ) : (
                  <div className="space-y-2">
                    {filteredCaptures.map((capture) => {
                      const analyzed = (coverage[capture.id] ?? 0) > 0;
                      const itemTone: DashboardTone = selectedCaptureId === capture.id ? 'violet' : analyzed ? 'emerald' : 'slate';
                      return (
                        <button
                          key={capture.id}
                          type="button"
                          onClick={() => setSelectedCaptureId(capture.id)}
                          className={cn('flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left shadow-sm', toneMetric(itemTone))}
                        >
                          <div>
                            <p className={cn('font-mono text-sm font-bold', toneTitle(itemTone))}>{capture.symbol} · {capture.timeframe}</p>
                            <p className={cn('text-[11px]', toneMuted(itemTone))}>
                              {analyzed ? `${coverage[capture.id]} classified` : 'Not analyzed'} · {capture.processingStatus}
                            </p>
                          </div>
                          <p className={cn('font-mono text-[10px]', toneBody(itemTone))}>{formatRelativeTime(capture.capturedAt, clockNow)}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Panel>

              <Panel icon={Sparkles} title={`Top-down · ${activeSymbol}`} tone="emerald">
                <div className="grid grid-cols-5 gap-2">
                  {timeframeCoverage.map((item) => {
                    const rowTone: DashboardTone = item.analyzed ? 'emerald' : item.present ? 'amber' : 'slate';
                    return (
                      <button
                        key={item.timeframe}
                        type="button"
                        disabled={!item.capture}
                        onClick={() => item.capture && setSelectedCaptureId(item.capture.id)}
                        className={cn('rounded-xl border p-2 text-center shadow-sm', toneMetric(rowTone), !item.capture && 'cursor-default opacity-80')}
                      >
                        <p className={cn('font-mono text-sm font-bold', toneTitle(rowTone))}>{item.timeframe}</p>
                        <p className={cn('mt-1 text-[9px] font-bold uppercase', toneMuted(rowTone))}>
                          {item.analyzed ? 'Detected' : item.present ? 'Captured' : 'Missing'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </Panel>

              <Panel icon={Target} title="Selected candle intelligence" tone="orange">
                {!selectedClassification ? (
                  <p className={cn('text-sm font-medium', toneBody('orange'))}>Select a candle from the chart or registry to inspect algorithm scores.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <InfoChip tone="orange" label="Type" value={selectedClassification.detectedCandleType} />
                      <InfoChip tone="orange" label="Decision" value={selectedClassification.supportsDecision} />
                      <InfoChip tone="orange" label="Direction" value={selectedClassification.direction} />
                      <InfoChip tone="orange" label="Implication" value={selectedClassification.implication} />
                    </div>
                    <ScoreBar tone="orange" label="Body strength" value={selectedClassification.bodyStrengthScore} />
                    <ScoreBar tone="orange" label="Wick rejection" value={selectedClassification.wickRejectionScore} />
                    <ScoreBar tone="orange" label="Momentum" value={selectedClassification.momentumScore} />
                    <ScoreBar tone="orange" label="Displacement" value={selectedClassification.institutionalDisplacementScore} />
                    <ScoreBar tone="rose" label="Manipulation" value={selectedClassification.manipulationScore} />
                    <ScoreBar tone="emerald" label="Reliability" value={selectedClassification.candleReliabilityScore} />
                    <p className={cn('rounded-lg border px-3 py-2 text-xs leading-5', toneInsetSurface('orange'), toneBody('orange'))}>
                      {selectedClassification.tradingMeaning}
                    </p>
                    <p className={cn('text-[11px] leading-5', toneMuted('orange'))}>{selectedClassification.riskWarning}</p>
                  </div>
                )}
              </Panel>

              <Panel icon={FlaskConical} title="Pattern breakdown" tone="violet">
                {patternBreakdown.length === 0 ? (
                  <p className={cn('text-sm font-medium', toneBody('violet'))}>Run detection to populate pattern frequency.</p>
                ) : (
                  <div className="space-y-2">
                    {patternBreakdown.map(([pattern, count]) => (
                      <div key={pattern} className={cn('flex items-center justify-between rounded-lg border px-3 py-2', toneInsetSurface('violet'))}>
                        <span className={cn('text-sm font-medium', toneBody('violet'))}>{pattern}</span>
                        <span className={cn('font-mono text-sm font-bold', toneTitle('violet'))}>{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel icon={ArrowRight} title="Pipeline links" tone="slate">
                <div className="space-y-2 text-sm">
                  <QuickLink tone="slate" href="/visual-intelligence-overview/swing-point-detection" label="Swing point detection" />
                  <QuickLink tone="slate" href="/visual-intelligence-overview/structure-analysis" label="Structure analysis" />
                  <QuickLink tone="slate" href="/cacsms-vision" label="Cacsms Vision intelligence room" />
                </div>
              </Panel>
            </aside>
          </div>
        </main>
      </div>
    </DashboardPageFrame>
  );
}

function CandlestickChartView(props: {
  candles: ReconstructedCandle[];
  classifications: CandleClassification[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const width = 760;
  const height = 280;
  const padding = { top: 16, right: 16, bottom: 24, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const prices = props.candles.flatMap((item) => [item.highPrice, item.lowPrice]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = Math.max(0.0001, maxPrice - minPrice);
  const candleWidth = Math.max(4, Math.min(14, plotWidth / Math.max(1, props.candles.length) - 2));

  const classificationByIndex = useMemo(() => {
    const map = new Map<number, CandleClassification>();
    for (const item of props.classifications) map.set(item.candleIndex, item);
    return map;
  }, [props.classifications]);

  const yForPrice = (price: number) => padding.top + ((maxPrice - price) / priceRange) * plotHeight;
  const xForIndex = (index: number) => padding.left + (index + 0.5) * (plotWidth / props.candles.length);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-full rounded-lg border border-amber-200 bg-white/90">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const price = minPrice + priceRange * (1 - ratio);
          const y = padding.top + plotHeight * ratio;
          return (
            <g key={ratio}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={8} y={y + 4} fontSize="10" fill="#64748b">{price.toFixed(price < 10 ? 4 : 2)}</text>
            </g>
          );
        })}
        {props.candles.map((candle) => {
          const classification = classificationByIndex.get(candle.candleIndex);
          const x = xForIndex(candle.candleIndex);
          const openY = yForPrice(candle.openPrice);
          const closeY = yForPrice(candle.closePrice);
          const highY = yForPrice(candle.highPrice);
          const lowY = yForPrice(candle.lowPrice);
          const bullish = candle.closePrice >= candle.openPrice;
          const selected = props.selectedIndex === candle.candleIndex;
          const color = classificationColor(classification?.detectedCandleType, bullish);
          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(2, Math.abs(closeY - openY));

          return (
            <g
              key={candle.candleIndex}
              className="cursor-pointer"
              onClick={() => props.onSelect(candle.candleIndex)}
            >
              <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth={selected ? 2.5 : 1.5} />
              <rect
                x={x - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                fill={color}
                stroke={selected ? '#4c1d95' : color}
                strokeWidth={selected ? 2 : 0}
                opacity={selected ? 1 : 0.92}
              />
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-[11px] text-slate-500">
        Algorithms: color segmentation, contour filtering, wick/body ratio classifier, Wilder ATR context, multi-candle sequence scan (morning/evening star, soldiers/crows, tweezer, harami, engulfing).
      </p>
    </div>
  );
}

function classificationColor(type: string | undefined, bullish: boolean): string {
  if (!type) return bullish ? '#059669' : '#e11d48';
  if (type.includes('manipulation') || type.includes('stop-hunt')) return '#d97706';
  if (['morning star', 'three white soldiers', 'tweezer bottom', 'hammer', 'bullish'].some((item) => type.includes(item))) return '#059669';
  if (['evening star', 'three black crows', 'tweezer top', 'shooting star', 'bearish'].some((item) => type.includes(item))) return '#e11d48';
  if (type.includes('doji') || type.includes('harami') || type.includes('inside')) return '#64748b';
  if (type.includes('pin') || type.includes('rejection')) return '#7c3aed';
  return bullish ? '#059669' : '#e11d48';
}

function decisionTone(decision: CandleClassification['supportsDecision']): DashboardTone {
  if (decision === 'BUY') return 'emerald';
  if (decision === 'SELL') return 'rose';
  if (decision === 'AVOID') return 'amber';
  return 'slate';
}

function Panel(props: { icon: typeof Camera; title: string; tone: DashboardTone; children: ReactNode }) {
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

function MetricCard(props: {
  tone: DashboardTone;
  icon: typeof Camera;
  label: string;
  value: string;
  detail: string;
}) {
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

function ScoreBar(props: { tone: DashboardTone; label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className={cn('font-semibold', toneMuted(props.tone))}>{props.label}</span>
        <span className={cn('font-mono font-bold', toneTitle(props.tone))}>{Math.round(props.value * 100)}%</span>
      </div>
      <Progress value={props.value * 100} className={cn('h-2', toneProgress(props.tone))} />
    </div>
  );
}

function QuickLink(props: { tone: DashboardTone; href: string; label: string }) {
  return (
    <Link href={props.href} className={cn('flex items-center justify-between rounded-lg border px-3 py-2 hover:opacity-90', toneInsetSurface(props.tone), toneBody(props.tone))}>
      <span>{props.label}</span>
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
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
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}
