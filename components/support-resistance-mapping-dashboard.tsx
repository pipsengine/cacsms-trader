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

const TOP_DOWN_TIMEFRAMES = ['W', 'D', 'H4', 'H1', 'M15'] as const;

type CaptureRecord = {
  id: string;
  symbol: string;
  timeframe: string;
  sourcePlatform: string;
  imageUrl?: string;
  processingStatus: string;
  capturedAt: string;
};

type SupportResistanceZone = {
  id?: string;
  zoneType: 'support' | 'resistance' | 'dynamic' | 'psychological';
  zoneLow: number;
  zoneHigh: number;
  midpointPrice: number;
  touchCount: number;
  weightedTouchScore: number;
  freshnessScore: number;
  wickRejectionScore: number;
  breakProbability: number;
  retestProbability: number;
  liquidityAttractionScore: number;
  psychologicalScore: number;
  institutionalDefenseScore: number;
  strengthScore: number;
  brokenRole: string;
  recommendedAction: 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
  aiExplanation: string;
  metadata: Record<string, unknown>;
};

type SupportResistanceLiquidity = {
  id?: string;
  zoneId?: string;
  liquiditySide: 'buy_side' | 'sell_side';
  priceLevel: number;
  stopPoolScore: number;
  attractionScore: number;
  sweepProbability: number;
  reversalProbability: number;
  explanationText: string;
};

type SupportResistanceAnalysis = {
  captureId: string;
  zones: SupportResistanceZone[];
  liquidity: SupportResistanceLiquidity[];
  summary: {
    dominantZone: string;
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

function zoneTypeTone(type: string): DashboardTone {
  const normalized = type.toLowerCase();
  if (normalized === 'support') return 'emerald';
  if (normalized === 'resistance') return 'rose';
  if (normalized === 'dynamic') return 'purple';
  if (normalized === 'psychological') return 'cyan';
  return 'slate';
}

function formatPrice(value: number): string {
  return value.toFixed(value < 10 ? 4 : 2);
}

function formatZoneRange(zone: SupportResistanceZone): string {
  return `${formatPrice(zone.zoneLow)} – ${formatPrice(zone.zoneHigh)}`;
}

export function SupportResistanceMappingDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [coverage, setCoverage] = useState<Record<string, number>>({});
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SupportResistanceAnalysis | null>(null);
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

  const selectedZone = useMemo(() => {
    if (!analysis) return null;
    if (selectedZoneId) {
      return analysis.zones.find((item) => item.id === selectedZoneId) ?? analysis.zones[0] ?? null;
    }
    return analysis.zones[0] ?? null;
  }, [analysis, selectedZoneId]);

  const typeBreakdown = useMemo(() => {
    if (!analysis) return [];
    const counts = new Map<string, number>();
    for (const item of analysis.zones) {
      counts.set(item.zoneType, (counts.get(item.zoneType) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [analysis]);

  const selectedLiquidity = useMemo(
    () => analysis?.liquidity.filter((item) => !selectedZone?.id || item.zoneId === selectedZone.id) ?? [],
    [analysis, selectedZone],
  );

  const loadRegistry = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [capturesResponse, coverageResponse, bridgeResponse] = await Promise.all([
        fetch('/api/visual-intelligence/captures?limit=100', { cache: 'no-store' }),
        fetch('/api/vision/support-resistance/coverage', { cache: 'no-store' }),
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
      setError(loadError instanceof Error ? loadError.message : 'Unable to load support/resistance registry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [symbol]);

  const loadAnalysis = useCallback(async (captureId: string) => {
    setAnalysisLoading(true);
    try {
      const response = await fetch(`/api/vision/support-resistance/${encodeURIComponent(captureId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setAnalysis(null);
        return;
      }
      const next = payload.analysis as SupportResistanceAnalysis;
      setAnalysis(next);
      setSelectedZoneId((current) => {
        if (current && next.zones.some((item) => item.id === current)) return current;
        return next.zones[0]?.id ?? null;
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
      const response = await fetch('/api/vision/support-resistance/analyze', {
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
        throw new Error(String(payload.error ?? 'Support/resistance mapping failed.'));
      }
      await Promise.all([
        loadAnalysis(selectedCapture.id),
        loadRegistry(false),
      ]);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Support/resistance mapping failed.');
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-purple-700">Cluster + liquidity mapping</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">Support / Resistance Mapping</h1>
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
                {runningAnalysis ? 'Mapping…' : 'Run mapping'}
              </Button>
              <Link href="/visual-intelligence-overview/channel-detection" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <GitBranch className="h-4 w-4" />
                Channels
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
              <MetricCard label="Captures tracked" value={String(filteredCaptures.length)} tone="purple" detail={`${analyzedCount} with zone output`} />
              <MetricCard label="Dominant zone" value={analysis?.summary.dominantZone ?? '—'} tone="purple" detail={selectedCapture ? `${selectedCapture.symbol} ${selectedCapture.timeframe}` : 'Select a capture'} />
              <MetricCard label="Recommended action" value={analysis?.summary.recommendedAction ?? '—'} tone={summaryTone} detail={selectedZone ? `${selectedZone.zoneType} · ${selectedZone.brokenRole}` : 'Awaiting analysis'} />
              <MetricCard label="Strength" value={analysis ? `${confidencePct}%` : '—'} tone="emerald" detail={analysis?.summary.explanation?.slice(0, 72) ?? 'Awaiting analysis'} />
            </section>

            <section className={cn('rounded-2xl border p-4', toneCard('purple'))}>
              <p className={cn('text-[11px] font-bold uppercase tracking-[0.18em]', toneMuted('purple'))}>Top-down coverage · {activeSymbol}</p>
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
                        ? toneBadge('purple')
                        : row.analyzed
                          ? toneBadge('emerald')
                          : row.present
                            ? toneBadge('amber')
                            : toneBadge('slate'),
                    )}
                  >
                    {row.timeframe}{row.analyzed ? ' · mapped' : row.present ? ' · captured' : ' · missing'}
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
                            ? 'border-purple-200 bg-purple-50 text-purple-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{capture.symbol} · {capture.timeframe}</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', (coverage[capture.id] ?? 0) > 0 ? toneBadge('emerald') : toneBadge('slate'))}>
                            {(coverage[capture.id] ?? 0) > 0 ? `${coverage[capture.id]} zones` : 'pending'}
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
                      <Shield className="h-4 w-4" />
                      Zone intelligence summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-0">
                    {!selectedCapture ? (
                      <p className="text-sm text-slate-500">Select a capture to inspect support and resistance zones.</p>
                    ) : analysisLoading ? (
                      <p className="text-sm text-slate-500">Loading zone analysis…</p>
                    ) : !analysis || analysis.zones.length === 0 ? (
                      <div className="space-y-3">
                        <p className={cn('text-sm', toneBody(summaryTone))}>
                          No stored zones for {selectedCapture.symbol} {selectedCapture.timeframe}. Run mapping to cluster reaction points and liquidity pools.
                        </p>
                        <Button size="sm" onClick={() => void runAnalysis()} disabled={runningAnalysis}>
                          <Play className="mr-2 h-4 w-4" />
                          Run mapping
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className={cn('text-sm', toneBody(summaryTone))}>{analysis.summary.explanation}</p>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <MiniStat label="Zones" value={String(analysis.zones.length)} />
                          <MiniStat label="Liquidity pools" value={String(analysis.liquidity.length)} />
                          <MiniStat label="Types" value={String(typeBreakdown.length)} />
                          <MiniStat label="Support count" value={String(analysis.zones.filter((z) => z.zoneType === 'support').length)} />
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {selectedZone ? (
                  <Card className={toneCard(zoneTypeTone(selectedZone.zoneType))}>
                    <CardHeader className={toneCardHeader(zoneTypeTone(selectedZone.zoneType))}>
                      <CardTitle className="text-sm">Selected zone scores</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-2 lg:grid-cols-3">
                      <ScoreBar label="Strength" value={selectedZone.strengthScore} tone="emerald" />
                      <ScoreBar label="Weighted touches" value={selectedZone.weightedTouchScore} tone="purple" />
                      <ScoreBar label="Freshness" value={selectedZone.freshnessScore} tone="cyan" />
                      <ScoreBar label="Wick rejection" value={selectedZone.wickRejectionScore} tone="blue" />
                      <ScoreBar label="Institutional defense" value={selectedZone.institutionalDefenseScore} tone="violet" />
                      <ScoreBar label="Liquidity attraction" value={selectedZone.liquidityAttractionScore} tone="orange" />
                      <ScoreBar label="Break probability" value={selectedZone.breakProbability} tone="rose" />
                      <ScoreBar label="Retest probability" value={selectedZone.retestProbability} tone="amber" />
                      <ScoreBar label="Psychological" value={selectedZone.psychologicalScore} tone="slate" />
                    </CardContent>
                  </Card>
                ) : null}

                {analysis?.zones.length ? (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Card>
                      <CardHeader className="py-4">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Shield className="h-4 w-4 text-purple-600" />
                          Mapped zones
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 p-4 pt-0">
                        {analysis.zones.map((zone) => {
                          const tone = zoneTypeTone(zone.zoneType);
                          return (
                            <button
                              key={zone.id ?? `${zone.zoneType}-${zone.midpointPrice}`}
                              type="button"
                              onClick={() => setSelectedZoneId(zone.id ?? null)}
                              className={cn(
                                'w-full rounded-lg border p-3 text-left transition-colors',
                                selectedZone?.id === zone.id
                                  ? toneCard(tone)
                                  : 'border-slate-200 bg-white hover:bg-slate-50',
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium capitalize text-slate-900">{zone.zoneType}</p>
                                  <p className="mt-1 font-mono text-xs text-slate-500">{formatZoneRange(zone)}</p>
                                </div>
                                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(actionTone(zone.recommendedAction)))}>
                                  {zone.recommendedAction}
                                </span>
                              </div>
                              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
                                <span>Strength {Math.round(zone.strengthScore * 100)}%</span>
                                <span>Touches {zone.touchCount}</span>
                                <span>Break {Math.round(zone.breakProbability * 100)}%</span>
                              </div>
                            </button>
                          );
                        })}
                      </CardContent>
                    </Card>

                    <Card className={toneCard(selectedZone ? zoneTypeTone(selectedZone.zoneType) : 'slate')}>
                      <CardHeader className={toneCardHeader(selectedZone ? zoneTypeTone(selectedZone.zoneType) : 'slate')}>
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Target className="h-4 w-4" />
                          Zone detail
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 p-4 pt-0">
                        {!selectedZone ? (
                          <p className="text-sm text-slate-500">Select a zone row to inspect institutional interpretation.</p>
                        ) : (
                          <>
                            <p className={cn('text-lg font-semibold capitalize', toneTitle(zoneTypeTone(selectedZone.zoneType)))}>
                              {selectedZone.zoneType} · {formatPrice(selectedZone.midpointPrice)}
                            </p>
                            <p className={cn('text-sm', toneBody(zoneTypeTone(selectedZone.zoneType)))}>
                              {selectedZone.aiExplanation}
                            </p>
                            <div className={cn('rounded-lg border p-3 text-xs', toneInsetSurface(zoneTypeTone(selectedZone.zoneType)))}>
                              <div>Range {formatZoneRange(selectedZone)}</div>
                              <div className="mt-1">Broken role: {selectedZone.brokenRole}</div>
                              <div className="mt-1">Retest {Math.round(selectedZone.retestProbability * 100)}% · Defense {Math.round(selectedZone.institutionalDefenseScore * 100)}%</div>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ) : null}

                {selectedLiquidity.length ? (
                  <Card>
                    <CardHeader className="py-4">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <TrendingUp className="h-4 w-4 text-orange-600" />
                        Liquidity pools
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 p-4 pt-0">
                      {selectedLiquidity.slice(0, 8).map((item) => {
                        const tone = item.liquiditySide === 'buy_side' ? 'emerald' : 'rose';
                        return (
                          <div key={item.id ?? `${item.liquiditySide}-${item.priceLevel}`} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium capitalize">{item.liquiditySide.replace('_', ' ')} · {formatPrice(item.priceLevel)}</p>
                              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', toneBadge(tone))}>
                                {Math.round(item.attractionScore * 100)}% attraction
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600">{item.explanationText}</p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              Stop pool {Math.round(item.stopPoolScore * 100)}% · Sweep {Math.round(item.sweepProbability * 100)}% · Reversal {Math.round(item.reversalProbability * 100)}%
                            </p>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                ) : null}

                {typeBreakdown.length ? (
                  <Card>
                    <CardHeader className="py-4">
                      <CardTitle className="text-sm">Zone type breakdown</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 p-4 pt-0">
                      {typeBreakdown.map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
                          <p className="font-medium capitalize">{type}</p>
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
              <Link href="/visual-intelligence-overview/swing-point-detection" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <TrendingDown className="h-4 w-4" />
                Swings
              </Link>
              <Link href="/visual-intelligence-overview/channel-detection" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <Layers3 className="h-4 w-4" />
                Channels
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
