'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  FileImage,
  Flame,
  GitCompareArrows,
  History,
  Layers3,
  Menu,
  Network,
  Play,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';

import { CaptureChartPreview } from '@/components/capture-chart-preview';
import { DashboardPageFrame } from '@/components/dashboard-page-frame';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { resolveCaptureDisplayUrl } from '@/lib/capture-display';
import { SYSTEM_FOCUS_SYMBOL_LABELS, SYSTEM_FOCUS_SYMBOLS } from '@/lib/focus-symbols';
import type { ReconstructedCandle } from '@/lib/visual-intelligence-types';
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

const TIMEFRAMES = ['MN', 'W', 'D', 'H4', 'H1', 'M15'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
type ViewMode = 'side-by-side' | 'slider' | 'heatmap';

type CaptureRecord = {
  id: string;
  symbol: string;
  timeframe: string;
  imageUrl: string;
  captureType: string;
  capturedAt: string;
  processingStatus: string;
  sourcePlatform: string;
  metadata?: Record<string, unknown>;
};

type ComparisonResultData = {
  comparisonScore: number;
  similarityPercentage: number;
  visualChangeConfidence: number;
  changedBias: string;
  finalInterpretation: string;
  changedStructures: Array<Record<string, unknown>>;
  newZones: Array<Record<string, unknown>>;
  invalidatedZones: Array<Record<string, unknown>>;
  heatmapUrl: string;
  differenceBlocks: Array<Record<string, unknown>>;
  aiExplanation: string;
  marketChangeTimeline: Array<Record<string, unknown>>;
  institutionalInterpretation: string;
  recommendation: string;
  confidence: number;
  metadata?: Record<string, unknown>;
  previousImageUrl?: string | null;
  currentImageUrl?: string | null;
};

type ComparisonRecord = {
  comparisonId: string;
  symbol: string;
  timeframe: string;
  status: string;
  completedAt?: string | null;
  processingTimeMs?: number | null;
  result: ComparisonResultData | null;
};

type StreamEvent = { type: string; message: string; time: string };

type TopDownTimeframeResult = {
  timeframe: Timeframe;
  ready: boolean;
  previousCaptureId: string | null;
  currentCaptureId: string | null;
  comparisonId: string | null;
  result: ComparisonResultData | null;
  bias: 'bullish' | 'bearish' | 'neutral';
  interpretation: string;
  changeScore: number;
};

type InstitutionalReasoningStep = {
  step: number;
  phase: string;
  insight: string;
  practitionerNote: string;
};

type TopDownDecision = {
  symbol: string;
  finalDecision: string;
  finalBias: string;
  confidence: number;
  controllingTimeframe: Timeframe | 'none';
  lowerTimeframeConfirmation: string;
  scalpOnly: boolean;
  institutionalNarrative: string;
  recommendation: string;
  reasoningSteps: InstitutionalReasoningStep[];
  alignments: Array<{
    leftTimeframe: Timeframe;
    rightTimeframe: Timeframe;
    alignmentState: string;
    alignmentScore: number;
    explanationText: string;
  }>;
  conflicts: Array<{
    higherTimeframe: Timeframe;
    lowerTimeframe: Timeframe;
    severityScore: number;
    description: string;
    recommendedResolution: string;
  }>;
  timeframeResults: TopDownTimeframeResult[];
};

function normalizeHistoryEntry(entry: ComparisonRecord): ComparisonRecord {
  return {
    comparisonId: entry.comparisonId,
    symbol: entry.symbol,
    timeframe: entry.timeframe,
    status: entry.status,
    completedAt: entry.completedAt ?? null,
    processingTimeMs: entry.processingTimeMs ?? null,
    result: entry.result,
  };
}

function formatDeltaItem(item: Record<string, unknown>): { title: string; detail: string } {
  const type = String(item.type ?? item.eventType ?? 'change');
  if (item.price != null) {
    return {
      title: type.replace(/_/g, ' '),
      detail: `Price ${String(item.price)}${item.previousPrice != null ? ` (was ${String(item.previousPrice)})` : ''}`,
    };
  }
  if (item.direction != null) {
    return {
      title: type.replace(/_/g, ' '),
      detail: `${String(item.direction)}${item.momentumShift != null ? ` · shift ${String(item.momentumShift)}` : ''}`,
    };
  }
  if (item.description != null) return { title: type.replace(/_/g, ' '), detail: String(item.description) };
  return { title: type.replace(/_/g, ' '), detail: Object.keys(item).length ? JSON.stringify(item) : 'Structural delta detected' };
}

export function ImageComparisonEngineDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('H1');
  const [mode, setMode] = useState<ViewMode>('side-by-side');
  const [slider, setSlider] = useState(52);
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [previousCaptureId, setPreviousCaptureId] = useState<string>('');
  const [currentCaptureId, setCurrentCaptureId] = useState<string>('');
  const [comparison, setComparison] = useState<ComparisonRecord | null>(null);
  const [history, setHistory] = useState<ComparisonRecord[]>([]);
  const [coverage, setCoverage] = useState<Record<string, number>>({});
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningComparison, setRunningComparison] = useState(false);
  const [runningTopDown, setRunningTopDown] = useState(false);
  const [topDownDecision, setTopDownDecision] = useState<TopDownDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const [tickSequence, setTickSequence] = useState(0);
  const [captureCandles, setCaptureCandles] = useState<Record<string, ReconstructedCandle[]>>({});
  const [clockNow, setClockNow] = useState(() => new Date());

  const scopedCaptures = useMemo(
    () => captures
      .filter((item) => item.symbol.toUpperCase() === symbol.toUpperCase() && item.timeframe.toUpperCase() === timeframe.toUpperCase())
      .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()),
    [captures, symbol, timeframe],
  );
  const previousCapture = scopedCaptures.find((item) => item.id === previousCaptureId) ?? null;
  const currentCapture = scopedCaptures.find((item) => item.id === currentCaptureId) ?? null;
  const result = comparison?.result ?? null;
  const canCompare = Boolean(previousCapture && currentCapture && previousCapture.id !== currentCapture.id);
  const previousCandles = previousCaptureId ? (captureCandles[previousCaptureId] ?? []) : [];
  const currentCandles = currentCaptureId ? (captureCandles[currentCaptureId] ?? []) : [];
  const hasPreviousPreview = Boolean(resolveCaptureDisplayUrl(previousCapture ?? {}) || previousCandles.length > 0);
  const hasCurrentPreview = Boolean(resolveCaptureDisplayUrl(currentCapture ?? {}) || currentCandles.length > 0);

  const symbolCaptures = useMemo(
    () => captures
      .filter((item) => item.symbol.toUpperCase() === symbol.toUpperCase())
      .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()),
    [captures, symbol],
  );

  const timeframeCoverage = useMemo(
    () => TIMEFRAMES.map((tf) => {
      const scoped = symbolCaptures.filter((item) => item.timeframe.toUpperCase() === tf);
      const topDown = topDownDecision?.timeframeResults.find((item) => item.timeframe === tf) ?? null;
      return {
        timeframe: tf,
        captureCount: scoped.length,
        ready: scoped.length >= 2,
        analyzed: Boolean(topDown?.comparisonId && topDown.result),
        interpretation: topDown?.interpretation ?? '—',
        bias: topDown?.bias ?? 'neutral',
        changeScore: topDown?.changeScore ?? 0,
      };
    }),
    [symbolCaptures, topDownDecision],
  );

  const topDownReadyCount = timeframeCoverage.filter((item) => item.ready).length;
  const topDownAnalyzedCount = timeframeCoverage.filter((item) => item.analyzed).length;
  const topDownComplete = topDownReadyCount === TIMEFRAMES.length;
  const activeTopDownResult = topDownDecision?.timeframeResults.find((item) => item.timeframe === timeframe) ?? null;
  const displayResult = result ?? activeTopDownResult?.result ?? null;

  const loadCaptureCandles = useCallback(async (captureId: string) => {
    if (!captureId) return;
    try {
      const response = await fetch(`/api/visual-intelligence/captures/${encodeURIComponent(captureId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) return;
      const candles = Array.isArray(payload.analysis?.candles) ? payload.analysis.candles as ReconstructedCandle[] : [];
      setCaptureCandles((current) => ({ ...current, [captureId]: candles }));
    } catch {
      // Preview candles are best-effort; comparison can still run server-side.
    }
  }, []);

  const loadTick = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard/tick', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.tick) return;
      setLastTickAt(String(payload.tick.tickAt));
      setTickSequence(Number(payload.tick.sequence) || 0);
      setBridgeOnline(Boolean(payload.tick.bridge?.online));
    } catch {
      // Tick polling is best-effort.
    }
  }, []);

  const loadRegistry = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [capturesResponse, historyResponse, coverageResponse, topDownResponse, bridgeResponse] = await Promise.all([
        fetch('/api/visual-intelligence/captures?limit=300', { cache: 'no-store' }),
        fetch(`/api/visual-analysis/image-comparison/${encodeURIComponent(symbol)}/${encodeURIComponent(timeframe)}/history`, { cache: 'no-store' }),
        fetch('/api/visual-analysis/image-comparison/coverage', { cache: 'no-store' }),
        fetch(`/api/visual-analysis/image-comparison/top-down/${encodeURIComponent(symbol)}`, { cache: 'no-store' }),
        fetch('/api/mt5/status', { cache: 'no-store' }),
      ]);
      const capturesPayload = await capturesResponse.json();
      const historyPayload = await historyResponse.json();
      const coveragePayload = await coverageResponse.json();
      if (!capturesPayload.ok) throw new Error(String(capturesPayload.error ?? 'Unable to load captures.'));
      const list = Array.isArray(capturesPayload.captures) ? capturesPayload.captures as CaptureRecord[] : [];
      setCaptures(list);
      setCoverage(coveragePayload.ok ? coveragePayload.coverage as Record<string, number> : {});
      const historyList = historyPayload.ok && Array.isArray(historyPayload.history)
        ? (historyPayload.history as ComparisonRecord[]).map(normalizeHistoryEntry).filter((item) => item.result)
        : [];
      setHistory(historyList);
      const topDownPayload = await topDownResponse.json().catch(() => null);
      if (topDownPayload?.ok && topDownPayload.decision) {
        setTopDownDecision(topDownPayload.decision as TopDownDecision);
      }
      if (initial && historyList[0]) {
        setComparison(historyList[0]);
      } else if (initial && topDownPayload?.ok) {
        const active = (topDownPayload.decision as TopDownDecision).timeframeResults.find((item) => item.timeframe === timeframe && item.result);
        if (active?.comparisonId && active.result) {
          setComparison({
            comparisonId: active.comparisonId,
            symbol: symbol.toUpperCase(),
            timeframe,
            status: 'completed',
            result: active.result,
          });
        }
      }
      const bridgePayload = await bridgeResponse.json().catch(() => null);
      setBridgeOnline(Boolean(bridgePayload?.ok));
      setLastSyncAt(new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load comparison registry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    if (scopedCaptures.length >= 2) {
      setCurrentCaptureId((current) => (scopedCaptures.some((item) => item.id === current) ? current : scopedCaptures[0].id));
      setPreviousCaptureId((current) => {
        if (scopedCaptures.some((item) => item.id === current) && current !== scopedCaptures[0]?.id) return current;
        return scopedCaptures[1]?.id ?? '';
      });
    } else if (scopedCaptures.length === 1) {
      setCurrentCaptureId(scopedCaptures[0].id);
      setPreviousCaptureId('');
    } else {
      setCurrentCaptureId('');
      setPreviousCaptureId('');
    }
  }, [scopedCaptures]);

  useEffect(() => {
    setComparison(null);
    void loadRegistry(true);
    const interval = window.setInterval(() => void loadRegistry(false), 15000);
    return () => window.clearInterval(interval);
  }, [loadRegistry]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadTick();
    const interval = window.setInterval(() => void loadTick(), 5000);
    return () => window.clearInterval(interval);
  }, [loadTick]);

  useEffect(() => {
    const ids = [previousCaptureId, currentCaptureId].filter(Boolean);
    for (const captureId of ids) void loadCaptureCandles(captureId);
  }, [currentCaptureId, loadCaptureCandles, previousCaptureId, scopedCaptures]);

  useEffect(() => {
    const source = new EventSource('/api/visual-intelligence/stream');
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { eventType?: string; payload?: Record<string, unknown>; createdAt?: string };
        if (!event.eventType) return;
        const isComparison = event.eventType.startsWith('comparison.');
        const isCapture = event.eventType.startsWith('capture.');
        const isTopDown = event.eventType.startsWith('comparison.topdown.');
        if (!isComparison && !isCapture && !isTopDown) return;

        const eventSymbol = String(event.payload?.symbol ?? event.payload?.detectedSymbol ?? '').toUpperCase();
        if (eventSymbol && eventSymbol !== symbol.toUpperCase()) return;

        const time = event.createdAt ? new Date(event.createdAt).toLocaleTimeString() : new Date().toLocaleTimeString();
        if (isComparison) {
          setEvents((items) => [{
            type: event.eventType ?? 'comparison.event',
            message: event.eventType === 'comparison.completed'
              ? `Completed: ${String(event.payload?.finalInterpretation ?? 'visual delta processed')}`
              : String(event.eventType).replace(/\./g, ' '),
            time,
          }, ...items].slice(0, 16));
          if (event.eventType === 'comparison.completed') void loadRegistry(false);
        }

        if (isTopDown) {
          setEvents((items) => [{
            type: event.eventType ?? 'comparison.topdown.event',
            message: event.eventType === 'comparison.topdown.completed'
              ? `Top-down decision: ${String(event.payload?.finalDecision ?? 'WAIT')}`
              : String(event.eventType).replace(/\./g, ' '),
            time,
          }, ...items].slice(0, 16));
          if (event.eventType === 'comparison.topdown.completed' || event.eventType === 'comparison.topdown.timeframe.completed') {
            void loadRegistry(false);
          }
        }

        if (isCapture) {
          setEvents((items) => [{
            type: event.eventType ?? 'capture.event',
            message: event.eventType === 'capture.completed'
              ? `New capture: ${String(event.payload?.detectedSymbol ?? symbol)} ${String(event.payload?.detectedTimeframe ?? timeframe)}`
              : String(event.eventType).replace(/\./g, ' '),
            time,
          }, ...items].slice(0, 16));
          if (event.eventType === 'capture.completed' || event.eventType === 'capture.preprocessing') {
            void loadRegistry(false);
          }
        }
      } catch {
        // ignore malformed stream chunks
      }
    };
    return () => source.close();
  }, [loadRegistry, symbol, timeframe]);

  const runComparison = useCallback(async () => {
    if (!previousCapture || !currentCapture) return;
    setRunningComparison(true);
    setError(null);
    try {
      const response = await fetch('/api/visual-analysis/image-comparison/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          previousImageUrl: previousCapture.imageUrl,
          currentImageUrl: currentCapture.imageUrl,
          previousCaptureId: previousCapture.id,
          currentCaptureId: currentCapture.id,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(String(payload.error ?? 'Image comparison failed.'));
      }
      const record: ComparisonRecord = {
        comparisonId: String(payload.comparisonId),
        symbol: symbol.toUpperCase(),
        timeframe,
        status: 'completed',
        result: payload.result as ComparisonResultData,
      };
      setComparison(record);
      setHistory((items) => [record, ...items.filter((item) => item.comparisonId !== record.comparisonId)].slice(0, 20));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Image comparison failed.');
    } finally {
      setRunningComparison(false);
    }
  }, [currentCapture, previousCapture, symbol, timeframe]);

  const runTopDownAnalysis = useCallback(async () => {
    setRunningTopDown(true);
    setError(null);
    try {
      const response = await fetch('/api/visual-analysis/image-comparison/top-down/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(String(payload.error ?? 'Top-down comparison failed.'));
      }
      const decision = payload.decision as TopDownDecision;
      setTopDownDecision(decision);
      const active = decision.timeframeResults.find((item) => item.timeframe === timeframe && item.result);
      if (active?.comparisonId && active.result) {
        setComparison({
          comparisonId: active.comparisonId,
          symbol: symbol.toUpperCase(),
          timeframe,
          status: 'completed',
          result: active.result,
        });
      }
      await loadRegistry(false);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Top-down comparison failed.');
    } finally {
      setRunningTopDown(false);
    }
  }, [loadRegistry, symbol, timeframe]);

  const selectTimeframe = useCallback((nextTimeframe: Timeframe) => {
    setTimeframe(nextTimeframe);
    const tfResult = topDownDecision?.timeframeResults.find((item) => item.timeframe === nextTimeframe);
    if (tfResult?.currentCaptureId) setCurrentCaptureId(tfResult.currentCaptureId);
    if (tfResult?.previousCaptureId) setPreviousCaptureId(tfResult.previousCaptureId);
    if (tfResult?.comparisonId && tfResult.result) {
      setComparison({
        comparisonId: tfResult.comparisonId,
        symbol: symbol.toUpperCase(),
        timeframe: nextTimeframe,
        status: 'completed',
        result: tfResult.result,
      });
    } else {
      setComparison(null);
    }
  }, [symbol, topDownDecision]);

  const previousImage = resolveCaptureDisplayUrl({
    imageUrl: previousCapture?.imageUrl ?? result?.previousImageUrl,
    metadata: previousCapture?.metadata,
  }) ?? '';
  const currentImage = resolveCaptureDisplayUrl({
    imageUrl: currentCapture?.imageUrl ?? result?.currentImageUrl,
    metadata: currentCapture?.metadata,
  }) ?? '';

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
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700">Visual delta intelligence</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">Image Comparison Engine</h1>
                <p className="truncate text-xs font-mono text-slate-500">
                  WAT {formatWatClock(clockNow)}
                  {' · '}Tick #{tickSequence || '—'} {formatRelativeTime(lastTickAt, clockNow)}
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
              <Button
                size="sm"
                onClick={() => void runTopDownAnalysis()}
                disabled={topDownReadyCount < 2 || runningTopDown}
              >
                <Network className={cn('mr-2 h-4 w-4', runningTopDown && 'animate-pulse')} />
                {runningTopDown ? 'Analyzing W→M15…' : 'Run top-down analysis'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void runComparison()} disabled={!canCompare || runningComparison}>
                <Play className={cn('mr-2 h-4 w-4', runningComparison && 'animate-pulse')} />
                {runningComparison ? 'Comparing…' : `Compare ${timeframe}`}
              </Button>
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

          {!topDownComplete && !loading ? (
            <Card className="mb-4 border-blue-200 bg-blue-50">
              <CardContent className="p-4 text-sm text-blue-900">
                Top-down stack is {topDownReadyCount}/{TIMEFRAMES.length} ready for {symbol}.
                {topDownReadyCount < 2
                  ? ' Capture at least two charts on two timeframes, then run top-down analysis.'
                  : ' Run top-down analysis to compare W→D→H4→H1→M15 and generate institutional reasoning.'}
              </CardContent>
            </Card>
          ) : null}

          <Panel icon={Network} title="Top-down chart ladder (MN → W → D → H4 → H1 → M15)" tone="violet">
            <div className="grid gap-2 md:grid-cols-5">
              {timeframeCoverage.map((item) => {
                const active = timeframe === item.timeframe;
                const rowTone: DashboardTone = active
                  ? 'violet'
                  : item.bias === 'bullish'
                    ? 'emerald'
                    : item.bias === 'bearish'
                      ? 'rose'
                      : item.ready
                        ? 'blue'
                        : 'slate';
                return (
                  <button
                    key={item.timeframe}
                    type="button"
                    onClick={() => selectTimeframe(item.timeframe)}
                    className={cn(
                      'rounded-lg border px-3 py-3 text-left transition',
                      toneMetric(rowTone),
                      !item.ready && 'opacity-80',
                    )}
                  >
                    <p className={cn('font-mono text-lg font-bold', toneTitle(rowTone))}>{item.timeframe}</p>
                    <p className={cn('mt-1 text-[10px] font-bold uppercase', toneMuted(rowTone))}>
                      {item.ready ? (item.analyzed ? 'Analyzed' : 'Ready') : 'Need 2 captures'}
                    </p>
                    <p className={cn('mt-2 text-[11px] leading-5', toneBody(rowTone))}>
                      {item.captureCount} captures
                      {item.analyzed ? ` · ${item.interpretation}` : ''}
                    </p>
                  </button>
                );
              })}
            </div>
            <p className={cn('mt-3 text-xs', toneMuted('violet'))}>
              {topDownAnalyzedCount}/{TIMEFRAMES.length} frames analyzed · controlling frame {topDownDecision?.controllingTimeframe ?? '—'}
              {topDownDecision?.scalpOnly ? ' · scalp-only posture' : ''}
            </p>
          </Panel>

          <section className="mb-4 mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <MetricCard tone="violet" icon={Network} label="Top-down decision" value={topDownDecision?.finalDecision ?? '—'} detail={topDownDecision?.finalBias ?? 'Run W→M15 analysis'} />
            <MetricCard tone="blue" icon={GitCompareArrows} label={`${timeframe} similarity`} value={displayResult ? `${displayResult.similarityPercentage.toFixed(1)}%` : '—'} detail="SSIM-style luminance similarity" />
            <MetricCard tone="orange" icon={ScanSearch} label="Change score" value={displayResult ? displayResult.comparisonScore.toFixed(1) : '—'} detail={`${timeframe} visual delta`} />
            <MetricCard tone="emerald" icon={Target} label="Confidence" value={topDownDecision ? `${Math.round(topDownDecision.confidence * 100)}%` : displayResult ? `${displayResult.visualChangeConfidence.toFixed(1)}%` : '—'} detail={displayResult?.changedBias ?? 'Awaiting analysis'} />
            <MetricCard tone="purple" icon={Layers3} label="Delta blocks" value={displayResult ? String(displayResult.differenceBlocks.length) : '—'} detail={`${topDownReadyCount}/6 frames ready`} />
            <MetricCard tone={interpretationTone(displayResult?.finalInterpretation)} icon={BrainCircuit} label={`${timeframe} read`} value={displayResult?.finalInterpretation ?? '—'} detail={topDownDecision?.recommendation ?? displayResult?.recommendation ?? 'No analysis yet'} />
          </section>

          <div className="mb-4 flex flex-wrap gap-2">
            {(['side-by-side', 'slider', 'heatmap'] as ViewMode[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs font-semibold capitalize transition',
                  mode === item ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {item.replace('-', ' ')}
              </button>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="space-y-4">
              <Panel icon={ScanSearch} title={`Before / after workspace · ${timeframe}`} tone="blue">
                <ComparisonViewer
                  previousImage={previousImage}
                  currentImage={currentImage}
                  previousCandles={previousCandles}
                  currentCandles={currentCandles}
                  hasPreviousPreview={hasPreviousPreview}
                  hasCurrentPreview={hasCurrentPreview}
                  heatmapUrl={displayResult?.heatmapUrl ?? ''}
                  mode={mode}
                  slider={slider}
                  setSlider={setSlider}
                />
                {displayResult ? (
                  <p className={cn('mt-3 text-xs', toneMuted('blue'))}>
                    {displayResult.finalInterpretation} · {displayResult.similarityPercentage.toFixed(1)}% similar · {displayResult.differenceBlocks.length} delta blocks
                  </p>
                ) : null}
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                <CaptureSelector
                  title="Previous capture"
                  captures={scopedCaptures}
                  selectedId={previousCaptureId}
                  candles={previousCandles}
                  onSelect={setPreviousCaptureId}
                  excludeId={currentCaptureId}
                  clockNow={clockNow}
                />
                <CaptureSelector
                  title="Current capture"
                  captures={scopedCaptures}
                  selectedId={currentCaptureId}
                  candles={currentCandles}
                  onSelect={setCurrentCaptureId}
                  excludeId={previousCaptureId}
                  clockNow={clockNow}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <DeltaPanel title="Changed structures" icon={Layers3} items={displayResult?.changedStructures ?? []} empty="No candle or structure change detected." tone="blue" />
                <DeltaPanel title="New zones" icon={Target} items={displayResult?.newZones ?? []} empty="No newly formed zones." tone="emerald" />
                <DeltaPanel title="Invalidated zones" icon={Flame} items={displayResult?.invalidatedZones ?? []} empty="No invalidated zones." tone="rose" />
              </div>
            </section>

            <aside className="space-y-4">
              <Panel icon={BrainCircuit} title="Institutional AI reasoning & decision" tone="cyan">
                {!topDownDecision && !displayResult ? (
                  <p className={cn('text-sm font-medium', toneBody('cyan'))}>
                    Run top-down analysis to compare all charts W→M15 and generate institutional reasoning.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {topDownDecision ? (
                      <>
                        <p className={cn('text-lg font-semibold', toneTitle(decisionTone(topDownDecision.finalDecision)))}>
                          {topDownDecision.finalDecision}
                        </p>
                        <p className={cn('text-sm leading-6', toneBody('cyan'))}>{topDownDecision.institutionalNarrative}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <InfoChip tone="cyan" label="Controlling TF" value={topDownDecision.controllingTimeframe} />
                          <InfoChip tone="cyan" label="Recommendation" value={topDownDecision.recommendation} />
                        </div>
                        <div>
                          <div className="mb-1 flex justify-between text-[11px]">
                            <span className={toneMuted('cyan')}>Institutional confidence</span>
                            <span className={cn('font-mono font-bold', toneTitle('cyan'))}>{Math.round(topDownDecision.confidence * 100)}%</span>
                          </div>
                          <Progress value={topDownDecision.confidence * 100} className={cn('h-2', toneProgress('cyan'))} />
                        </div>
                        <p className={cn('text-xs leading-5', toneMuted('cyan'))}>{topDownDecision.lowerTimeframeConfirmation}</p>
                      </>
                    ) : null}
                    {displayResult ? (
                      <div className={cn('rounded-lg border p-3', toneInsetSurface('cyan'))}>
                        <p className={cn('text-[11px] font-bold uppercase', toneMuted('cyan'))}>{timeframe} frame read</p>
                        <p className={cn('mt-1 text-sm font-semibold', toneTitle(interpretationTone(displayResult.finalInterpretation)))}>
                          {displayResult.finalInterpretation}
                        </p>
                        <p className={cn('mt-2 text-xs leading-5', toneBody('cyan'))}>{displayResult.aiExplanation}</p>
                        <p className={cn('mt-2 text-xs leading-5', toneMuted('cyan'))}>{displayResult.institutionalInterpretation}</p>
                      </div>
                    ) : null}
                    {topDownDecision?.reasoningSteps?.length ? (
                      <ScrollArea className="h-[220px] pr-3">
                        <div className="space-y-2">
                          {topDownDecision.reasoningSteps.map((step) => (
                            <div key={step.step} className={cn('rounded-lg border p-3', toneInsetSurface('cyan'))}>
                              <div className="flex items-center justify-between gap-2">
                                <span className={cn('text-xs font-bold uppercase', toneMuted('cyan'))}>Step {step.step} · {step.phase}</span>
                              </div>
                              <p className={cn('mt-1 text-xs leading-5', toneBody('cyan'))}>{step.insight}</p>
                              <p className={cn('mt-2 text-[11px] leading-5 italic', toneMuted('cyan'))}>{step.practitionerNote}</p>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    ) : null}
                  </div>
                )}
              </Panel>

              <Panel icon={ShieldAlert} title="Alignment & conflicts" tone="amber">
                {!topDownDecision ? (
                  <p className={cn('text-sm', toneBody('amber'))}>Alignment and conflict resolution appear after top-down analysis.</p>
                ) : (
                  <div className="space-y-2">
                    {topDownDecision.alignments.map((item) => (
                      <div key={`${item.leftTimeframe}-${item.rightTimeframe}`} className={cn('rounded-lg border p-3', toneInsetSurface('amber'))}>
                        <p className={cn('font-mono text-xs font-bold', toneTitle('amber'))}>
                          {item.leftTimeframe} ↔ {item.rightTimeframe} · {item.alignmentState.replace(/_/g, ' ')}
                        </p>
                        <p className={cn('mt-1 text-xs leading-5', toneBody('amber'))}>{item.explanationText}</p>
                      </div>
                    ))}
                    {topDownDecision.conflicts.map((item) => (
                      <div key={`${item.higherTimeframe}-${item.lowerTimeframe}`} className={cn('rounded-lg border p-3', toneInsetSurface('rose'))}>
                        <p className={cn('font-mono text-xs font-bold', toneTitle('rose'))}>
                          Conflict {item.higherTimeframe} vs {item.lowerTimeframe} · {Math.round(item.severityScore * 100)}%
                        </p>
                        <p className={cn('mt-1 text-xs leading-5', toneBody('rose'))}>{item.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel icon={Sparkles} title="Change timeline" tone="purple">
                <ScrollArea className="h-[200px] pr-3">
                  <div className="space-y-2">
                    {(displayResult?.marketChangeTimeline ?? []).map((item, index) => (
                      <div key={`${String(item.eventType)}-${index}`} className={cn('rounded-lg border p-3', toneInsetSurface('purple'))}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('text-sm font-semibold', toneTitle('purple'))}>{String(item.eventType ?? 'change')}</span>
                          <span className={cn('font-mono text-xs', toneMuted('purple'))}>{Number(item.severityScore ?? 0).toFixed(2)}</span>
                        </div>
                        <p className={cn('mt-1 text-xs leading-5', toneBody('purple'))}>{String(item.description ?? '')}</p>
                      </div>
                    ))}
                    {!displayResult?.marketChangeTimeline?.length ? (
                      <p className={cn('text-sm', toneBody('purple'))}>Timeline events appear after comparison completes.</p>
                    ) : null}
                  </div>
                </ScrollArea>
              </Panel>

              <Panel icon={History} title="Comparison history" tone="slate">
                <ScrollArea className="h-[220px] pr-3">
                  <div className="space-y-2">
                    {history.map((item) => (
                      <button
                        key={item.comparisonId}
                        type="button"
                        onClick={() => setComparison(item)}
                        className={cn(
                          'w-full rounded-lg border px-3 py-2 text-left',
                          comparison?.comparisonId === item.comparisonId ? toneMetric('violet') : toneMetric('slate'),
                        )}
                      >
                        <p className={cn('font-mono text-xs font-bold', toneTitle(comparison?.comparisonId === item.comparisonId ? 'violet' : 'slate'))}>
                          {item.result?.finalInterpretation ?? item.status}
                        </p>
                        <p className={cn('mt-1 text-[11px]', toneMuted('slate'))}>
                          {item.result ? `${item.result.similarityPercentage.toFixed(1)}% similar` : 'No result'}
                          {item.completedAt ? ` · ${formatRelativeTime(item.completedAt, clockNow)}` : ''}
                        </p>
                      </button>
                    ))}
                    {!history.length ? (
                      <p className={cn('text-sm', toneBody('slate'))}>No persisted comparisons for {symbol} {timeframe}.</p>
                    ) : null}
                  </div>
                </ScrollArea>
              </Panel>

              <Panel icon={Activity} title="Processing console" tone="emerald">
                <ScrollArea className="h-[160px] pr-3">
                  <div className="space-y-2">
                    {events.map((event) => (
                      <div key={`${event.time}-${event.type}`} className={cn('rounded-lg border px-3 py-2', toneInsetSurface('emerald'))}>
                        <p className={cn('text-xs font-bold', toneTitle('emerald'))}>{event.type}</p>
                        <p className={cn('text-[11px]', toneMuted('emerald'))}>{event.message} · {event.time}</p>
                      </div>
                    ))}
                    {!events.length ? <p className={cn('text-sm', toneBody('emerald'))}>Listening for `capture.*` and `comparison.*` events.</p> : null}
                  </div>
                </ScrollArea>
              </Panel>

              <Panel icon={ArrowRight} title="Pipeline links" tone="slate">
                <div className="space-y-2 text-sm">
                  <QuickLink href="/visual-intelligence-overview/chart-screenshot-capture" label="Chart screenshot capture" />
                  <QuickLink href="/visual-intelligence-overview/candle-detection" label="Candle detection" />
                  <QuickLink href="/visual-intelligence-overview/multi-timeframe-comparison" label="Multi-timeframe comparison" />
                </div>
              </Panel>
            </aside>
          </div>
        </main>
      </div>
    </DashboardPageFrame>
  );
}

function CaptureSelector(props: {
  title: string;
  captures: CaptureRecord[];
  selectedId: string;
  candles: ReconstructedCandle[];
  onSelect: (id: string) => void;
  excludeId?: string;
  clockNow: Date;
}) {
  const selected = props.captures.find((item) => item.id === props.selectedId) ?? null;
  const options = props.captures.filter((item) => item.id !== props.excludeId);
  const displayUrl = selected ? resolveCaptureDisplayUrl(selected) : null;
  return (
    <Card className={cn('overflow-hidden', toneCard('slate'))}>
      <CardHeader className={cn('border-b py-3', toneCardHeader('slate'))}>
        <CardTitle className={cn('flex items-center gap-2 text-sm font-bold', toneTitle('slate'))}>
          <FileImage className="h-4 w-4" />
          {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <select
          value={props.selectedId}
          onChange={(e) => props.onSelect(e.target.value)}
          className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
          disabled={options.length === 0}
        >
          <option value="">Select capture…</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {formatWatClock(new Date(item.capturedAt))} · {item.processingStatus} · {formatRelativeTime(item.capturedAt, props.clockNow)}
            </option>
          ))}
        </select>
        <div className="aspect-video overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {!selected ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-500">No capture selected</div>
          ) : displayUrl ? (
            <img src={displayUrl} alt={props.title} className="h-full w-full object-cover" />
          ) : props.candles.length > 0 ? (
            <CaptureChartPreview candles={props.candles} label={props.title} className="h-full border-0" aspectClassName="h-full min-h-0" />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-500">
              Loading reconstructed candles…
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonViewer(props: {
  previousImage: string;
  currentImage: string;
  previousCandles: ReconstructedCandle[];
  currentCandles: ReconstructedCandle[];
  hasPreviousPreview: boolean;
  hasCurrentPreview: boolean;
  heatmapUrl: string;
  mode: ViewMode;
  slider: number;
  setSlider: (value: number) => void;
}) {
  if (!props.hasPreviousPreview || !props.hasCurrentPreview) {
    return (
      <div className="flex aspect-[16/7] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
        Select previous and current captures to activate the comparison viewer
      </div>
    );
  }

  const previousVisual = (
    <CaptureVisual
      imageUrl={props.previousImage}
      candles={props.previousCandles}
      label="Previous chart"
      className="absolute inset-0 h-full w-full object-cover"
      fill
    />
  );
  const currentVisual = (
    <CaptureVisual
      imageUrl={props.currentImage}
      candles={props.currentCandles}
      label="Current chart"
      className="absolute inset-0 h-full w-full object-cover"
      fill
    />
  );

  if (props.mode === 'slider') {
    return (
      <div className="space-y-3">
        <div className="relative aspect-[16/7] overflow-hidden rounded-xl border border-slate-200 bg-white">
          {previousVisual}
          <div className="absolute inset-0 overflow-hidden" style={{ width: `${props.slider}%` }}>
            {currentVisual}
          </div>
          <div className="absolute top-0 h-full w-0.5 bg-blue-600 shadow" style={{ left: `${props.slider}%` }} />
        </div>
        <input type="range" min={0} max={100} value={props.slider} onChange={(e) => props.setSlider(Number(e.target.value))} className="w-full" aria-label="Comparison slider" />
      </div>
    );
  }
  if (props.mode === 'heatmap') {
    return (
      <div className="relative aspect-[16/7] overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        <CaptureVisual
          imageUrl={props.currentImage}
          candles={props.currentCandles}
          label="Current chart"
          className="h-full w-full opacity-80"
          fill
        />
        {props.heatmapUrl ? (
          <img src={props.heatmapUrl} alt="Difference heatmap" className="absolute inset-0 h-full w-full object-cover mix-blend-multiply" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/20 text-xs text-white">Run comparison to generate heatmap</div>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 md:grid-cols-2">
      <div className="relative aspect-[16/7] bg-white">
        <CaptureVisual imageUrl={props.previousImage} candles={props.previousCandles} label="Previous chart" className="h-full w-full" fill />
      </div>
      <div className="relative aspect-[16/7] bg-white">
        <CaptureVisual imageUrl={props.currentImage} candles={props.currentCandles} label="Current chart" className="h-full w-full" fill />
      </div>
    </div>
  );
}

function CaptureVisual(props: {
  imageUrl: string;
  candles: ReconstructedCandle[];
  label: string;
  className?: string;
  fill?: boolean;
}) {
  if (props.imageUrl) {
    return <img src={props.imageUrl} alt={props.label} className={props.className} />;
  }
  if (props.candles.length > 0) {
    return (
      <CaptureChartPreview
        candles={props.candles}
        label={props.label}
        className={cn('border-0', props.className)}
        aspectClassName={props.fill ? 'h-full min-h-0' : undefined}
      />
    );
  }
  return (
    <div className={cn('flex items-center justify-center bg-slate-50 text-xs text-slate-500', props.className)}>
      {props.label} unavailable
    </div>
  );
}

function DeltaPanel(props: { title: string; icon: LucideIcon; items: Array<Record<string, unknown>>; empty: string; tone: DashboardTone }) {
  const Icon = props.icon;
  return (
    <Card className={cn('overflow-hidden', toneCard(props.tone))}>
      <CardHeader className={cn('border-b py-3', toneCardHeader(props.tone))}>
        <CardTitle className={cn('flex items-center gap-2 text-sm font-bold', toneTitle(props.tone))}>
          <Icon className="h-4 w-4" />
          {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4">
        {props.items.slice(0, 5).map((item, index) => {
          const formatted = formatDeltaItem(item);
          return (
            <div key={index} className={cn('rounded-lg border p-3', toneInsetSurface(props.tone))}>
              <p className={cn('text-sm font-semibold capitalize', toneTitle(props.tone))}>{formatted.title}</p>
              <p className={cn('mt-1 text-xs leading-5', toneBody(props.tone))}>{formatted.detail}</p>
            </div>
          );
        })}
        {!props.items.length ? <p className={cn('text-sm', toneBody(props.tone))}>{props.empty}</p> : null}
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

function InfoChip(props: { tone: DashboardTone; label: string; value: string }) {
  return (
    <div className={cn('rounded-lg border px-3 py-2', toneInsetSurface(props.tone))}>
      <p className={cn('text-[10px] font-bold uppercase', toneMuted(props.tone))}>{props.label}</p>
      <p className={cn('mt-1 font-mono text-sm font-semibold', toneTitle(props.tone))}>{props.value}</p>
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

function interpretationTone(value?: string): DashboardTone {
  if (value === 'Bullish shift') return 'emerald';
  if (value === 'Bearish shift' || value === 'Setup invalidated') return 'rose';
  if (value === 'Liquidity sweep' || value === 'Manipulation detected') return 'amber';
  return 'blue';
}

function decisionTone(value?: string): DashboardTone {
  if (!value) return 'slate';
  if (value.includes('BUY')) return 'emerald';
  if (value.includes('SELL')) return 'rose';
  if (value === 'AVOID') return 'rose';
  return 'amber';
}

function formatWatClock(value: Date): string {
  return value.toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
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
