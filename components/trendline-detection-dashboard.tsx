'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  GitBranch,
  Layers3,
  Menu,
  Play,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
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
  imageUrl?: string;
  processingStatus: string;
  capturedAt: string;
};

type TrendlineDetection = {
  id?: string;
  trendlineKind: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  startCandleIndex: number;
  endCandleIndex: number;
  startPrice: number;
  endPrice: number;
  slopeState: string;
  touchCount: number;
  validityScore: number;
  respectScore: number;
  spacingScore: number;
  breakProbability: number;
  retestProbability: number;
  trapRisk: number;
  breakStatus: string;
  retestStatus: string;
  aiExplanation: string;
  metadata: Record<string, unknown>;
};

type TrendlineBreakEvent = {
  id?: string;
  trendlineId?: string;
  candleIndex: number;
  breakDirection: string;
  breakQualityScore: number;
  falseBreakProbability: number;
  liquidityGrabScore: number;
  explanationText: string;
};

type TrendlineRetestEvent = {
  id?: string;
  trendlineId?: string;
  candleIndex: number;
  retestQualityScore: number;
  continuationProbability: number;
  rejectionScore: number;
  explanationText: string;
};

type TrendlineAnalysis = {
  captureId: string;
  trendlines: TrendlineDetection[];
  breaks: TrendlineBreakEvent[];
  retests: TrendlineRetestEvent[];
  summary: {
    dominantTrendline: string;
    directionalBias: string;
    confidence: number;
    explanation: string;
  };
};

function directionTone(direction: string): DashboardTone {
  const normalized = direction.toLowerCase();
  if (normalized === 'bullish') return 'emerald';
  if (normalized === 'bearish') return 'rose';
  return 'slate';
}

function biasTone(bias: string): DashboardTone {
  const normalized = bias.toUpperCase();
  if (normalized.includes('BUY')) return 'emerald';
  if (normalized.includes('SELL')) return 'rose';
  return 'slate';
}

function formatKindLabel(kind: string): string {
  return kind.replace(/_/g, ' ');
}

export function TrendlineDetectionDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [coverage, setCoverage] = useState<Record<string, number>>({});
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [selectedTrendlineId, setSelectedTrendlineId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<TrendlineAnalysis | null>(null);
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

  const selectedTrendline = useMemo(() => {
    if (!analysis) return null;
    if (selectedTrendlineId) {
      return analysis.trendlines.find((item) => item.id === selectedTrendlineId) ?? analysis.trendlines[0] ?? null;
    }
    return analysis.trendlines[0] ?? null;
  }, [analysis, selectedTrendlineId]);

  const kindBreakdown = useMemo(() => {
    if (!analysis) return [];
    const counts = new Map<string, number>();
    for (const item of analysis.trendlines) {
      counts.set(item.trendlineKind, (counts.get(item.trendlineKind) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [analysis]);

  const selectedBreaks = useMemo(
    () => analysis?.breaks.filter((item) => !selectedTrendline?.id || item.trendlineId === selectedTrendline.id) ?? [],
    [analysis, selectedTrendline],
  );

  const selectedRetests = useMemo(
    () => analysis?.retests.filter((item) => !selectedTrendline?.id || item.trendlineId === selectedTrendline.id) ?? [],
    [analysis, selectedTrendline],
  );

  const loadRegistry = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [capturesResponse, coverageResponse, bridgeResponse] = await Promise.all([
        fetch('/api/visual-intelligence/captures?limit=100', { cache: 'no-store' }),
        fetch('/api/vision/trendlines/coverage', { cache: 'no-store' }),
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
      setError(loadError instanceof Error ? loadError.message : 'Unable to load trendline detection registry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [symbol]);

  const loadAnalysis = useCallback(async (captureId: string) => {
    setAnalysisLoading(true);
    try {
      const response = await fetch(`/api/vision/trendlines/${encodeURIComponent(captureId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setAnalysis(null);
        return;
      }
      const next = payload.analysis as TrendlineAnalysis;
      setAnalysis(next);
      setSelectedTrendlineId((current) => {
        if (current && next.trendlines.some((item) => item.id === current)) return current;
        return next.trendlines[0]?.id ?? null;
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
      const response = await fetch('/api/vision/trendlines/analyze', {
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
        throw new Error(String(payload.error ?? 'Trendline detection analysis failed.'));
      }
      await Promise.all([
        loadAnalysis(selectedCapture.id),
        loadRegistry(false),
      ]);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Trendline detection analysis failed.');
    } finally {
      setRunningAnalysis(false);
    }
  }, [selectedCapture, loadAnalysis, loadRegistry]);

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
      return;
    }
    void loadAnalysis(selectedCaptureId);
  }, [selectedCaptureId, loadAnalysis]);

  const summaryTone = biasTone(analysis?.summary.directionalBias ?? 'WAIT');
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700">RANSAC + swing projection</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">Trendline Detection</h1>
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
              <Button size="sm" onClick={() => void runAnalysis()} disabled={!selectedCapture || runningAnalysis}>
                <Play className={cn('mr-2 h-4 w-4', runningAnalysis && 'animate-pulse')} />
                {runningAnalysis ? 'Detecting…' : 'Run detection'}
              </Button>
              <Link href="/visual-intelligence-overview/swing-point-detection" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <TrendingUp className="h-4 w-4" />
                Swings
              </Link>
            </div>
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4 md:p-6">
            {error ? (
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </CardContent>
              </Card>
            ) : null}

            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Captures tracked" value={String(filteredCaptures.length)} tone="blue" detail={`${analyzedCount} with trendline output`} />
              <MetricCard label="Dominant line" value={analysis ? formatKindLabel(analysis.summary.dominantTrendline) : '—'} tone="blue" detail={selectedCapture ? `${selectedCapture.symbol} ${selectedCapture.timeframe}` : 'Select a capture'} />
              <MetricCard label="Directional bias" value={analysis?.summary.directionalBias ?? '—'} tone={summaryTone} detail={selectedTrendline ? `${selectedTrendline.direction} · ${selectedTrendline.slopeState}` : 'Awaiting analysis'} />
              <MetricCard label="Validity" value={analysis ? `${confidencePct}%` : '—'} tone="emerald" detail={analysis?.summary.explanation?.slice(0, 72) ?? 'Awaiting analysis'} />
            </section>

            <section className={cn('rounded-2xl border p-4', toneCard('blue'))}>
              <p className={cn('text-[11px] font-bold uppercase tracking-[0.18em]', toneMuted('blue'))}>Top-down coverage · {activeSymbol}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {timeframeCoverage.map((row) => (
                  <button
                    key={row.timeframe}
                    type="button"
                    disabled={!row.capture}
                    onClick={() => row.capture && setSelectedCaptureId(row.capture.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                      row.capture?.id === selectedCaptureId
                        ? toneBadge('blue')
                        : row.analyzed
                          ? toneBadge('emerald')
                          : row.present
                            ? toneBadge('amber')
                            : toneBadge('slate'),
                    )}
                  >
                    {row.timeframe}{row.analyzed ? ' · detected' : row.present ? ' · captured' : ' · missing'}
                  </button>
                ))}
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
              <Card className={toneCard('slate')}>
                <CardHeader className={toneCardHeader('slate')}>
                  <CardTitle className="text-sm">Chart captures</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-4 pt-0">
                  {loading ? (
                    <p className="text-sm text-slate-500">Loading captures…</p>
                  ) : filteredCaptures.length === 0 ? (
                    <p className="text-sm text-slate-500">No captures available. Run chart capture first.</p>
                  ) : (
                    filteredCaptures.map((capture) => (
                      <button
                        key={capture.id}
                        type="button"
                        onClick={() => setSelectedCaptureId(capture.id)}
                        className={cn(
                          'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                          selectedCaptureId === capture.id
                            ? 'border-blue-200 bg-blue-50 text-blue-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{capture.symbol} · {capture.timeframe}</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', (coverage[capture.id] ?? 0) > 0 ? toneBadge('emerald') : toneBadge('slate'))}>
                            {(coverage[capture.id] ?? 0) > 0 ? `${coverage[capture.id]} lines` : 'pending'}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{formatRelativeTime(capture.capturedAt, clockNow)}</div>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card className={toneCard(summaryTone)}>
                  <CardHeader className={toneCardHeader(summaryTone)}>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <GitBranch className="h-4 w-4" />
                      Trendline intelligence summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-0">
                    {!selectedCapture ? (
                      <p className="text-sm text-slate-500">Select a capture to inspect trendline detection output.</p>
                    ) : analysisLoading ? (
                      <p className="text-sm text-slate-500">Loading trendline analysis…</p>
                    ) : !analysis || analysis.trendlines.length === 0 ? (
                      <div className="space-y-3">
                        <p className={cn('text-sm', toneBody(summaryTone))}>
                          No stored trendlines for {selectedCapture.symbol} {selectedCapture.timeframe}. Run detection to project swing-based support and resistance diagonals.
                        </p>
                        <Button size="sm" onClick={() => void runAnalysis()} disabled={runningAnalysis}>
                          <Play className="mr-2 h-4 w-4" />
                          Run detection
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className={cn('text-sm', toneBody(summaryTone))}>{analysis.summary.explanation}</p>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <MiniStat label="Trendlines" value={String(analysis.trendlines.length)} />
                          <MiniStat label="Break events" value={String(analysis.breaks.length)} />
                          <MiniStat label="Retest events" value={String(analysis.retests.length)} />
                          <MiniStat label="Kinds" value={String(kindBreakdown.length)} />
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {selectedTrendline ? (
                  <Card className={toneCard(directionTone(selectedTrendline.direction))}>
                    <CardHeader className={toneCardHeader(directionTone(selectedTrendline.direction))}>
                      <CardTitle className="text-sm">Selected line probabilities</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-2 lg:grid-cols-3">
                      <ScoreBar label="Validity" value={selectedTrendline.validityScore} tone="emerald" />
                      <ScoreBar label="Respect" value={selectedTrendline.respectScore} tone="blue" />
                      <ScoreBar label="Spacing" value={selectedTrendline.spacingScore} tone="purple" />
                      <ScoreBar label="Break probability" value={selectedTrendline.breakProbability} tone="rose" />
                      <ScoreBar label="Retest probability" value={selectedTrendline.retestProbability} tone="amber" />
                      <ScoreBar label="Trap risk" value={selectedTrendline.trapRisk} tone="orange" />
                    </CardContent>
                  </Card>
                ) : null}

                {analysis?.trendlines.length ? (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Card>
                      <CardHeader className="py-4">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <GitBranch className="h-4 w-4 text-blue-600" />
                          Detected trendlines
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 p-4 pt-0">
                        {analysis.trendlines.map((line) => {
                          const tone = directionTone(line.direction);
                          return (
                            <button
                              key={line.id ?? `${line.trendlineKind}-${line.startCandleIndex}`}
                              type="button"
                              onClick={() => setSelectedTrendlineId(line.id ?? null)}
                              className={cn(
                                'w-full rounded-lg border p-3 text-left transition-colors',
                                selectedTrendline?.id === line.id
                                  ? toneCard(tone)
                                  : 'border-slate-200 bg-white hover:bg-slate-50',
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium capitalize text-slate-900">{formatKindLabel(line.trendlineKind)}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {line.direction} · {line.slopeState} · {line.touchCount} touches
                                  </p>
                                </div>
                                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(tone))}>
                                  {line.breakStatus}
                                </span>
                              </div>
                              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
                                <span>Valid {Math.round(line.validityScore * 100)}%</span>
                                <span>Break {Math.round(line.breakProbability * 100)}%</span>
                                <span>Retest {Math.round(line.retestProbability * 100)}%</span>
                              </div>
                            </button>
                          );
                        })}
                      </CardContent>
                    </Card>

                    <Card className={toneCard(selectedTrendline ? directionTone(selectedTrendline.direction) : 'slate')}>
                      <CardHeader className={toneCardHeader(selectedTrendline ? directionTone(selectedTrendline.direction) : 'slate')}>
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Target className="h-4 w-4" />
                          Line detail
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 p-4 pt-0">
                        {!selectedTrendline ? (
                          <p className="text-sm text-slate-500">Select a trendline row to inspect geometry and status.</p>
                        ) : (
                          <>
                            <p className={cn('text-lg font-semibold capitalize', toneTitle(directionTone(selectedTrendline.direction)))}>
                              {formatKindLabel(selectedTrendline.trendlineKind)}
                            </p>
                            <p className={cn('text-sm', toneBody(directionTone(selectedTrendline.direction)))}>
                              {selectedTrendline.aiExplanation}
                            </p>
                            <div className={cn('rounded-lg border p-3 text-xs', toneInsetSurface(directionTone(selectedTrendline.direction)))}>
                              <div>Candles {selectedTrendline.startCandleIndex} → {selectedTrendline.endCandleIndex}</div>
                              <div className="mt-1">
                                Price {selectedTrendline.startPrice.toFixed(selectedTrendline.startPrice < 10 ? 4 : 2)} → {selectedTrendline.endPrice.toFixed(selectedTrendline.endPrice < 10 ? 4 : 2)}
                              </div>
                              <div className="mt-1">
                                Break {selectedTrendline.breakStatus} · Retest {selectedTrendline.retestStatus}
                              </div>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ) : null}

                {selectedBreaks.length ? (
                  <Card>
                    <CardHeader className="py-4">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <TrendingDown className="h-4 w-4 text-rose-600" />
                        Break events
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 p-4 pt-0">
                      {selectedBreaks.slice(0, 8).map((item) => (
                        <div key={item.id ?? `${item.candleIndex}-${item.breakDirection}`} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium">Candle #{item.candleIndex} · {item.breakDirection}</p>
                            <span className="text-xs text-slate-500">{Math.round(item.breakQualityScore * 100)}% quality</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">{item.explanationText}</p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            False break {Math.round(item.falseBreakProbability * 100)}% · Liquidity grab {Math.round(item.liquidityGrabScore * 100)}%
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                {selectedRetests.length ? (
                  <Card>
                    <CardHeader className="py-4">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                        Retest events
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 p-4 pt-0">
                      {selectedRetests.slice(0, 8).map((item) => (
                        <div key={item.id ?? `${item.candleIndex}-retest`} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium">Candle #{item.candleIndex}</p>
                            <span className="text-xs text-slate-500">{Math.round(item.continuationProbability * 100)}% continuation</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">{item.explanationText}</p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Quality {Math.round(item.retestQualityScore * 100)}% · Rejection {Math.round(item.rejectionScore * 100)}%
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                {kindBreakdown.length ? (
                  <Card>
                    <CardHeader className="py-4">
                      <CardTitle className="text-sm">Kind breakdown</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 p-4 pt-0">
                      {kindBreakdown.map(([kind, count]) => (
                        <div key={kind} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
                          <p className="font-medium capitalize">{formatKindLabel(kind)}</p>
                          <span className="font-mono text-xs text-slate-600">{count}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href="/visual-intelligence-overview" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                Overview
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/visual-intelligence-overview/pattern-recognition" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <Layers3 className="h-4 w-4" />
                Patterns
              </Link>
            </div>
          </div>
        </ScrollArea>
      </div>
    </DashboardPageFrame>
  );
}

function MetricCard(props: { label: string; value: string; detail: string; tone: DashboardTone }) {
  return (
    <div className={cn('rounded-2xl border p-4 shadow-sm', toneCard(props.tone))}>
      <p className={cn('text-[11px] font-bold uppercase tracking-[0.18em]', toneMuted(props.tone))}>{props.label}</p>
      <p className={cn('mt-2 text-2xl font-semibold', toneTitle(props.tone))}>{props.value}</p>
      <p className={cn('mt-1 text-xs', toneBody(props.tone))}>{props.detail}</p>
    </div>
  );
}

function MiniStat(props: { label: string; value: string }) {
  return (
    <div className={cn('rounded-md border px-3 py-2', toneInsetSurface('slate'))}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{props.label}</div>
      <div className="mt-1 font-mono text-sm text-slate-900">{props.value}</div>
    </div>
  );
}

function ScoreBar(props: { label: string; value: number; tone: DashboardTone }) {
  const pct = Math.round(Math.max(0, Math.min(1, props.value)) * 100);
  return (
    <div className={cn('rounded-lg border p-3', toneInsetSurface(props.tone))}>
      <div className="flex items-center justify-between text-xs">
        <span className={toneMuted(props.tone)}>{props.label}</span>
        <span className={cn('font-semibold', toneTitle(props.tone))}>{pct}%</span>
      </div>
      <Progress value={pct} className={cn('mt-2 h-2', toneProgress(props.tone))} />
    </div>
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
