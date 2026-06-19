'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Layers3,
  Menu,
  Play,
  RefreshCw,
  Shield,
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

type OrderBlockDetection = {
  id?: string;
  blockType: 'bullish' | 'bearish';
  originCandleIndex: number;
  displacementCandleIndex: number;
  zoneLow: number;
  zoneHigh: number;
  invalidationLevel: number;
  mitigationStatus: 'fresh' | 'partial_mitigation' | 'full_mitigation' | 'invalidated';
  mitigationPercentage: number;
  displacementStrength: number;
  bodyDominanceScore: number;
  rangeExpansionScore: number;
  bosConfirmed: boolean;
  bosStrength: number;
  fvgConfirmed: boolean;
  fvgScore: number;
  participationProxyScore: number;
  freshnessScore: number;
  liquidityProximityScore: number;
  htfAlignmentScore: number;
  qualityScore: number;
  institutionalRelevance: string;
  recommendedAction: 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
  aiExplanation: string;
  metadata: Record<string, unknown>;
};

type OrderBlockMitigationEvent = {
  id?: string;
  orderBlockId?: string;
  candleIndex: number;
  mitigationType: string;
  penetrationPercentage: number;
  reactionScore: number;
  invalidated: boolean;
  explanationText: string;
};

type OrderBlockAnalysis = {
  captureId: string;
  orderBlocks: OrderBlockDetection[];
  mitigationEvents: OrderBlockMitigationEvent[];
  summary: {
    dominantBlock: string;
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

function blockTypeTone(type: string): DashboardTone {
  return type.toLowerCase() === 'bullish' ? 'emerald' : 'rose';
}

function mitigationTone(status: string): DashboardTone {
  const normalized = status.toLowerCase();
  if (normalized === 'fresh') return 'emerald';
  if (normalized === 'partial_mitigation') return 'amber';
  if (normalized === 'full_mitigation') return 'orange';
  if (normalized === 'invalidated') return 'rose';
  return 'slate';
}

function formatPrice(value: number): string {
  return value.toFixed(value < 10 ? 4 : 2);
}

function formatZoneRange(block: OrderBlockDetection): string {
  return `${formatPrice(block.zoneLow)} – ${formatPrice(block.zoneHigh)}`;
}

function formatMitigationStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

export function OrderBlockDetectionDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [coverage, setCoverage] = useState<Record<string, number>>({});
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<OrderBlockAnalysis | null>(null);
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

  const selectedBlock = useMemo(() => {
    if (!analysis) return null;
    if (selectedBlockId) {
      return analysis.orderBlocks.find((item) => item.id === selectedBlockId) ?? analysis.orderBlocks[0] ?? null;
    }
    return analysis.orderBlocks[0] ?? null;
  }, [analysis, selectedBlockId]);

  const activeBlocks = useMemo(
    () => analysis?.orderBlocks.filter((item) => ['fresh', 'partial_mitigation'].includes(item.mitigationStatus)) ?? [],
    [analysis],
  );

  const mitigatedBlocks = useMemo(
    () => analysis?.orderBlocks.filter((item) => ['full_mitigation', 'invalidated'].includes(item.mitigationStatus)) ?? [],
    [analysis],
  );

  const selectedMitigations = useMemo(
    () => analysis?.mitigationEvents.filter((item) => !selectedBlock?.id || item.orderBlockId === selectedBlock.id) ?? [],
    [analysis, selectedBlock],
  );

  const loadRegistry = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [capturesResponse, coverageResponse, bridgeResponse] = await Promise.all([
        fetch('/api/visual-intelligence/captures?limit=100', { cache: 'no-store' }),
        fetch('/api/vision/order-blocks/coverage', { cache: 'no-store' }),
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
      setError(loadError instanceof Error ? loadError.message : 'Unable to load order block registry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [symbol]);

  const loadAnalysis = useCallback(async (captureId: string) => {
    setAnalysisLoading(true);
    try {
      const response = await fetch(`/api/vision/order-blocks/${encodeURIComponent(captureId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setAnalysis(null);
        return;
      }
      const next = payload.analysis as OrderBlockAnalysis;
      setAnalysis(next);
      setSelectedBlockId((current) => {
        if (current && next.orderBlocks.some((item) => item.id === current)) return current;
        return next.orderBlocks[0]?.id ?? null;
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
      const response = await fetch('/api/vision/order-blocks/analyze', {
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
        throw new Error(String(payload.error ?? 'Order block detection failed.'));
      }
      await Promise.all([
        loadAnalysis(selectedCapture.id),
        loadRegistry(false),
      ]);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Order block detection failed.');
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-700">Displacement + mitigation tracking</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">Order Block Detection</h1>
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
              <Link href="/visual-intelligence-overview/support-resistance-mapping" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <Shield className="h-4 w-4" />
                S/R zones
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
              <MetricCard label="Captures tracked" value={String(filteredCaptures.length)} tone="orange" detail={`${analyzedCount} with block output`} />
              <MetricCard label="Dominant block" value={analysis?.summary.dominantBlock ?? '—'} tone="orange" detail={selectedCapture ? `${selectedCapture.symbol} ${selectedCapture.timeframe}` : 'Select a capture'} />
              <MetricCard label="Recommended action" value={analysis?.summary.recommendedAction ?? '—'} tone={summaryTone} detail={selectedBlock ? formatMitigationStatus(selectedBlock.mitigationStatus) : 'Awaiting analysis'} />
              <MetricCard label="Quality" value={analysis ? `${confidencePct}%` : '—'} tone="emerald" detail={analysis?.summary.explanation?.slice(0, 72) ?? 'Awaiting analysis'} />
            </section>

            <section className={cn('rounded-2xl border p-4', toneCard('orange'))}>
              <p className={cn('text-[11px] font-bold uppercase tracking-[0.18em]', toneMuted('orange'))}>Top-down coverage · {activeSymbol}</p>
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
                        ? toneBadge('orange')
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
                            ? 'border-orange-200 bg-orange-50 text-orange-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{capture.symbol} · {capture.timeframe}</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', (coverage[capture.id] ?? 0) > 0 ? toneBadge('emerald') : toneBadge('slate'))}>
                            {(coverage[capture.id] ?? 0) > 0 ? `${coverage[capture.id]} blocks` : 'pending'}
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
                      <Box className="h-4 w-4" />
                      Order block intelligence summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-0">
                    {!selectedCapture ? (
                      <p className="text-sm text-slate-500">Select a capture to inspect order block output.</p>
                    ) : analysisLoading ? (
                      <p className="text-sm text-slate-500">Loading order block analysis…</p>
                    ) : !analysis || analysis.orderBlocks.length === 0 ? (
                      <div className="space-y-3">
                        <p className={cn('text-sm', toneBody(summaryTone))}>
                          No stored order blocks for {selectedCapture.symbol} {selectedCapture.timeframe}. Run detection to identify displacement-origin institutional zones.
                        </p>
                        <Button size="sm" onClick={() => void runAnalysis()} disabled={runningAnalysis}>
                          <Play className="mr-2 h-4 w-4" />
                          Run detection
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className={cn('text-sm', toneBody(summaryTone))}>{analysis.summary.explanation}</p>
                        <p className={cn('text-xs', toneMuted(summaryTone))}>{analysis.summary.institutionalBias}</p>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <MiniStat label="Total blocks" value={String(analysis.orderBlocks.length)} />
                          <MiniStat label="Active" value={String(activeBlocks.length)} />
                          <MiniStat label="Mitigated" value={String(mitigatedBlocks.length)} />
                          <MiniStat label="Mitigation events" value={String(analysis.mitigationEvents.length)} />
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {selectedBlock ? (
                  <Card className={toneCard(blockTypeTone(selectedBlock.blockType))}>
                    <CardHeader className={toneCardHeader(blockTypeTone(selectedBlock.blockType))}>
                      <CardTitle className="text-sm">Selected block scores</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-2 lg:grid-cols-3">
                      <ScoreBar label="Quality" value={selectedBlock.qualityScore} tone="emerald" />
                      <ScoreBar label="Displacement" value={selectedBlock.displacementStrength} tone="orange" />
                      <ScoreBar label="Body dominance" value={selectedBlock.bodyDominanceScore} tone="purple" />
                      <ScoreBar label="Range expansion" value={selectedBlock.rangeExpansionScore} tone="violet" />
                      <ScoreBar label="Freshness" value={selectedBlock.freshnessScore} tone="cyan" />
                      <ScoreBar label="Liquidity proximity" value={selectedBlock.liquidityProximityScore} tone="blue" />
                      <ScoreBar label="HTF alignment" value={selectedBlock.htfAlignmentScore} tone="violet" />
                      <ScoreBar label="Participation proxy" value={selectedBlock.participationProxyScore} tone="slate" />
                      <ScoreBar label="Mitigation" value={selectedBlock.mitigationPercentage} tone={mitigationTone(selectedBlock.mitigationStatus)} />
                    </CardContent>
                  </Card>
                ) : null}

                {analysis?.orderBlocks.length ? (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Card>
                      <CardHeader className="py-4">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Box className="h-4 w-4 text-orange-600" />
                          Detected order blocks
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 p-4 pt-0">
                        {analysis.orderBlocks.map((block) => {
                          const tone = blockTypeTone(block.blockType);
                          return (
                            <button
                              key={block.id ?? `${block.blockType}-${block.originCandleIndex}`}
                              type="button"
                              onClick={() => setSelectedBlockId(block.id ?? null)}
                              className={cn(
                                'w-full rounded-lg border p-3 text-left transition-colors',
                                selectedBlock?.id === block.id
                                  ? toneCard(tone)
                                  : 'border-slate-200 bg-white hover:bg-slate-50',
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium capitalize text-slate-900">{block.blockType} order block</p>
                                  <p className="mt-1 font-mono text-xs text-slate-500">{formatZoneRange(block)}</p>
                                </div>
                                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(mitigationTone(block.mitigationStatus)))}>
                                  {formatMitigationStatus(block.mitigationStatus)}
                                </span>
                              </div>
                              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
                                <span>Quality {Math.round(block.qualityScore * 100)}%</span>
                                <span>BOS {block.bosConfirmed ? 'yes' : 'no'}</span>
                                <span>FVG {block.fvgConfirmed ? 'yes' : 'no'}</span>
                              </div>
                            </button>
                          );
                        })}
                      </CardContent>
                    </Card>

                    <Card className={toneCard(selectedBlock ? blockTypeTone(selectedBlock.blockType) : 'slate')}>
                      <CardHeader className={toneCardHeader(selectedBlock ? blockTypeTone(selectedBlock.blockType) : 'slate')}>
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Target className="h-4 w-4" />
                          Block detail
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 p-4 pt-0">
                        {!selectedBlock ? (
                          <p className="text-sm text-slate-500">Select an order block row to inspect institutional interpretation.</p>
                        ) : (
                          <>
                            <p className={cn('text-lg font-semibold capitalize', toneTitle(blockTypeTone(selectedBlock.blockType)))}>
                              {selectedBlock.blockType} · candle {selectedBlock.originCandleIndex}
                            </p>
                            <p className={cn('text-sm', toneBody(blockTypeTone(selectedBlock.blockType)))}>
                              {selectedBlock.aiExplanation}
                            </p>
                            <div className={cn('rounded-lg border p-3 text-xs', toneInsetSurface(blockTypeTone(selectedBlock.blockType)))}>
                              <div>Zone {formatZoneRange(selectedBlock)}</div>
                              <div className="mt-1">Invalidation {formatPrice(selectedBlock.invalidationLevel)}</div>
                              <div className="mt-1">
                                Displacement candle #{selectedBlock.displacementCandleIndex} · {selectedBlock.recommendedAction}
                              </div>
                              <div className="mt-1">
                                BOS {Math.round(selectedBlock.bosStrength * 100)}% · FVG {Math.round(selectedBlock.fvgScore * 100)}%
                              </div>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ) : null}

                {selectedMitigations.length ? (
                  <Card>
                    <CardHeader className="py-4">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <TrendingDown className="h-4 w-4 text-amber-600" />
                        Mitigation events
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 p-4 pt-0">
                      {selectedMitigations.slice(0, 8).map((item) => (
                        <div key={item.id ?? `${item.candleIndex}-${item.mitigationType}`} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium capitalize">Candle #{item.candleIndex} · {item.mitigationType.replace(/_/g, ' ')}</p>
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(item.invalidated ? 'rose' : 'amber'))}>
                              {item.invalidated ? 'invalidated' : 'active'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">{item.explanationText}</p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Penetration {Math.round(item.penetrationPercentage * 100)}% · Reaction {Math.round(item.reactionScore * 100)}%
                          </p>
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
              <Link href="/visual-intelligence-overview/liquidity-zone-detection" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <TrendingUp className="h-4 w-4" />
                Liquidity zones
              </Link>
              <Link href="/visual-intelligence-overview/support-resistance-mapping" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <Layers3 className="h-4 w-4" />
                S/R mapping
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
