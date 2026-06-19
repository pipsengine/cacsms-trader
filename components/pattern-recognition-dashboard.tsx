'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Layers3,
  Menu,
  Play,
  RefreshCw,
  Shapes,
  Target,
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
  imageUrl?: string;
  processingStatus: string;
  capturedAt: string;
};

type PatternRecognitionResult = {
  id?: string;
  patternName: string;
  patternFamily: string;
  patternStatus: string;
  completionPercentage: number;
  breakoutDirection: string;
  breakoutProbability: number;
  failureProbability: number;
  trapProbability: number;
  retailTrapScore: number;
  institutionalInterpretation: string;
  recommendedAction: 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
  confidenceScore: number;
  similarityScore: number;
  dtwDistance: number;
  metadata: Record<string, unknown>;
};

type PatternSimilarityHistory = {
  templateName: string;
  templateFamily: string;
  similarityScore: number;
  dtwDistance: number;
  historicalSuccessRate: number;
};

type PatternProbabilitySnapshot = {
  bullishBreakoutProbability: number;
  bearishBreakoutProbability: number;
  continuationProbability: number;
  reversalProbability: number;
  accumulationProbability: number;
  distributionProbability: number;
  manipulationProbability: number;
  volatilityCompressionScore: number;
  displacementScore: number;
  liquidityLocationScore: number;
  trendContextScore: number;
};

type PatternAnalysis = {
  captureId: string;
  patterns: PatternRecognitionResult[];
  similarHistory: PatternSimilarityHistory[];
  probability: PatternProbabilitySnapshot;
  summary: {
    dominantPattern: string;
    institutionalBias: string;
    recommendedAction: string;
    confidence: number;
    explanation: string;
  };
};

function actionTone(action: string): DashboardTone {
  const normalized = action.toUpperCase();
  if (normalized === 'BUY') return 'emerald';
  if (normalized === 'SELL') return 'rose';
  if (normalized === 'AVOID') return 'amber';
  return 'slate';
}

export function PatternRecognitionDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [coverage, setCoverage] = useState<Record<string, number>>({});
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [selectedPatternName, setSelectedPatternName] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PatternAnalysis | null>(null);
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

  const selectedPattern = useMemo(
    () => analysis?.patterns.find((item) => item.patternName === selectedPatternName) ?? analysis?.patterns[0] ?? null,
    [analysis, selectedPatternName],
  );

  const familyBreakdown = useMemo(() => {
    if (!analysis) return [];
    const counts = new Map<string, number>();
    for (const item of analysis.patterns) {
      counts.set(item.patternFamily, (counts.get(item.patternFamily) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [analysis]);

  const loadRegistry = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [capturesResponse, coverageResponse, bridgeResponse] = await Promise.all([
        fetch('/api/visual-intelligence/captures?limit=100', { cache: 'no-store' }),
        fetch('/api/vision/patterns/coverage', { cache: 'no-store' }),
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
      setError(loadError instanceof Error ? loadError.message : 'Unable to load pattern recognition registry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [symbol]);

  const loadAnalysis = useCallback(async (captureId: string) => {
    setAnalysisLoading(true);
    try {
      const response = await fetch(`/api/vision/patterns/${encodeURIComponent(captureId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setAnalysis(null);
        return;
      }
      const next = payload.analysis as PatternAnalysis;
      setAnalysis(next);
      setSelectedPatternName((current) => {
        if (current && next.patterns.some((item) => item.patternName === current)) return current;
        return next.patterns[0]?.patternName ?? null;
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
      const response = await fetch('/api/vision/patterns/analyze', {
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
        throw new Error(String(payload.error ?? 'Pattern recognition analysis failed.'));
      }
      await Promise.all([
        loadAnalysis(selectedCapture.id),
        loadRegistry(false),
      ]);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Pattern recognition analysis failed.');
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

  const summaryTone = actionTone(analysis?.summary.recommendedAction ?? 'WAIT');
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-700">DTW + institutional templates</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">Pattern Recognition</h1>
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
                {runningAnalysis ? 'Analyzing…' : 'Run recognition'}
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
              <MetricCard label="Captures tracked" value={String(filteredCaptures.length)} tone="violet" detail={`${analyzedCount} with pattern output`} />
              <MetricCard label="Dominant pattern" value={analysis?.summary.dominantPattern ?? '—'} tone="violet" detail={selectedCapture ? `${selectedCapture.symbol} ${selectedCapture.timeframe}` : 'Select a capture'} />
              <MetricCard label="Institutional bias" value={analysis?.summary.institutionalBias ?? '—'} tone={summaryTone} detail={analysis?.summary.recommendedAction ?? 'WAIT'} />
              <MetricCard label="Confidence" value={analysis ? `${confidencePct}%` : '—'} tone="emerald" detail={analysis?.summary.explanation?.slice(0, 72) ?? 'Awaiting analysis'} />
            </section>

            <section className={cn('rounded-2xl border p-4', toneCard('violet'))}>
              <p className={cn('text-[11px] font-bold uppercase tracking-[0.18em]', toneMuted('violet'))}>Top-down coverage · {activeSymbol}</p>
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
                        ? toneBadge('violet')
                        : row.analyzed
                          ? toneBadge('emerald')
                          : row.present
                            ? toneBadge('amber')
                            : toneBadge('slate'),
                    )}
                  >
                    {row.timeframe}{row.analyzed ? ' · analyzed' : row.present ? ' · captured' : ' · missing'}
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
                            ? 'border-violet-200 bg-violet-50 text-violet-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{capture.symbol} · {capture.timeframe}</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', (coverage[capture.id] ?? 0) > 0 ? toneBadge('emerald') : toneBadge('slate'))}>
                            {(coverage[capture.id] ?? 0) > 0 ? `${coverage[capture.id]} patterns` : 'pending'}
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
                      <BrainCircuit className="h-4 w-4" />
                      Institutional pattern summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-0">
                    {!selectedCapture ? (
                      <p className="text-sm text-slate-500">Select a capture to inspect pattern recognition output.</p>
                    ) : analysisLoading ? (
                      <p className="text-sm text-slate-500">Loading pattern analysis…</p>
                    ) : !analysis || analysis.patterns.length === 0 ? (
                      <div className="space-y-3">
                        <p className={cn('text-sm', toneBody(summaryTone))}>
                          No stored patterns for {selectedCapture.symbol} {selectedCapture.timeframe}. Run recognition to classify chart structure against institutional templates.
                        </p>
                        <Button size="sm" onClick={() => void runAnalysis()} disabled={runningAnalysis}>
                          <Play className="mr-2 h-4 w-4" />
                          Run recognition
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className={cn('text-sm', toneBody(summaryTone))}>{analysis.summary.explanation}</p>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <MiniStat label="Patterns" value={String(analysis.patterns.length)} />
                          <MiniStat label="Families" value={String(familyBreakdown.length)} />
                          <MiniStat label="Top similarity" value={`${Math.round((analysis.patterns[0]?.similarityScore ?? 0) * 100)}%`} />
                          <MiniStat label="Trap risk" value={`${Math.round((selectedPattern?.trapProbability ?? 0) * 100)}%`} />
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {analysis?.probability ? (
                  <Card className={toneCard('blue')}>
                    <CardHeader className={toneCardHeader('blue')}>
                      <CardTitle className="text-sm">Probability engine</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-2 lg:grid-cols-3">
                      <ProbabilityBar label="Bullish breakout" value={analysis.probability.bullishBreakoutProbability} tone="emerald" />
                      <ProbabilityBar label="Bearish breakout" value={analysis.probability.bearishBreakoutProbability} tone="rose" />
                      <ProbabilityBar label="Continuation" value={analysis.probability.continuationProbability} tone="purple" />
                      <ProbabilityBar label="Reversal" value={analysis.probability.reversalProbability} tone="amber" />
                      <ProbabilityBar label="Accumulation" value={analysis.probability.accumulationProbability} tone="cyan" />
                      <ProbabilityBar label="Distribution" value={analysis.probability.distributionProbability} tone="orange" />
                      <ProbabilityBar label="Manipulation" value={analysis.probability.manipulationProbability} tone="rose" />
                      <ProbabilityBar label="Vol compression" value={analysis.probability.volatilityCompressionScore} tone="violet" />
                      <ProbabilityBar label="Trend context" value={analysis.probability.trendContextScore} tone="blue" />
                    </CardContent>
                  </Card>
                ) : null}

                {analysis?.patterns.length ? (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Card>
                      <CardHeader className="py-4">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Shapes className="h-4 w-4 text-violet-600" />
                          Detected patterns
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 p-4 pt-0">
                        {analysis.patterns.map((pattern) => {
                          const tone = actionTone(pattern.recommendedAction);
                          return (
                            <button
                              key={`${pattern.patternName}-${pattern.confidenceScore}`}
                              type="button"
                              onClick={() => setSelectedPatternName(pattern.patternName)}
                              className={cn(
                                'w-full rounded-lg border p-3 text-left transition-colors',
                                selectedPattern?.patternName === pattern.patternName
                                  ? toneCard(tone)
                                  : 'border-slate-200 bg-white hover:bg-slate-50',
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium capitalize text-slate-900">{pattern.patternName}</p>
                                  <p className="mt-1 text-xs text-slate-500">{pattern.patternFamily} · {pattern.patternStatus}</p>
                                </div>
                                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(tone))}>
                                  {pattern.recommendedAction}
                                </span>
                              </div>
                              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
                                <span>Conf {Math.round(pattern.confidenceScore * 100)}%</span>
                                <span>Sim {Math.round(pattern.similarityScore * 100)}%</span>
                                <span>Complete {Math.round(pattern.completionPercentage * 100)}%</span>
                              </div>
                            </button>
                          );
                        })}
                      </CardContent>
                    </Card>

                    <Card className={toneCard(selectedPattern ? actionTone(selectedPattern.recommendedAction) : 'slate')}>
                      <CardHeader className={toneCardHeader(selectedPattern ? actionTone(selectedPattern.recommendedAction) : 'slate')}>
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Target className="h-4 w-4" />
                          Pattern detail
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 p-4 pt-0">
                        {!selectedPattern ? (
                          <p className="text-sm text-slate-500">Select a pattern row to inspect institutional interpretation.</p>
                        ) : (
                          <>
                            <p className={cn('text-lg font-semibold capitalize', toneTitle(actionTone(selectedPattern.recommendedAction)))}>
                              {selectedPattern.patternName}
                            </p>
                            <p className={cn('text-sm', toneBody(actionTone(selectedPattern.recommendedAction)))}>
                              {selectedPattern.institutionalInterpretation}
                            </p>
                            <div className={cn('rounded-lg border p-3 text-xs', toneInsetSurface(actionTone(selectedPattern.recommendedAction)))}>
                              <div>Breakout direction: {selectedPattern.breakoutDirection}</div>
                              <div className="mt-1">Breakout {Math.round(selectedPattern.breakoutProbability * 100)}% · Failure {Math.round(selectedPattern.failureProbability * 100)}%</div>
                              <div className="mt-1">Retail trap {Math.round(selectedPattern.retailTrapScore * 100)}% · DTW {selectedPattern.dtwDistance.toFixed(2)}</div>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ) : null}

                {analysis?.similarHistory.length ? (
                  <Card>
                    <CardHeader className="py-4">
                      <CardTitle className="text-sm">Template similarity history</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 p-4 pt-0">
                      {analysis.similarHistory.slice(0, 8).map((row) => (
                        <div key={`${row.templateName}-${row.similarityScore}`} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
                          <div>
                            <p className="font-medium capitalize">{row.templateName}</p>
                            <p className="text-xs text-slate-500">{row.templateFamily}</p>
                          </div>
                          <div className="text-right text-xs text-slate-600">
                            <div>{Math.round(row.similarityScore * 100)}% match</div>
                            <div>{Math.round(row.historicalSuccessRate * 100)}% historical success</div>
                          </div>
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
              <Link href="/visual-intelligence-overview/candle-detection" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <Layers3 className="h-4 w-4" />
                Candles
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

function ProbabilityBar(props: { label: string; value: number; tone: DashboardTone }) {
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
