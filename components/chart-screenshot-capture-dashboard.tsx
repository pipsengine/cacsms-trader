'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Camera,
  DatabaseZap,
  Layers3,
  Menu,
  Radar,
  RefreshCw,
  Workflow,
} from 'lucide-react';

import { TraderSidebar } from '@/components/trader-sidebar';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  type DashboardTone,
  toneBody,
  toneCard,
  toneCardHeader,
  toneInsetSurface,
  toneMetric,
  toneMuted,
  toneTitle,
} from '@/lib/dashboard-card-tones';
import { cn } from '@/lib/utils';

const TOP_DOWN_TIMEFRAMES = ['W', 'D', 'H4', 'H1', 'M15'] as const;

type CaptureRecord = {
  id: string;
  symbol: string;
  timeframe: string;
  sourcePlatform: string;
  imageUrl: string;
  captureType: string;
  capturedAt: string;
  processingStatus: string;
  metadata?: Record<string, unknown>;
};

type CaptureAnalysis = {
  capture: CaptureRecord;
  jobs: Array<Record<string, unknown>>;
  candles: Array<Record<string, unknown>>;
  detections: Array<Record<string, unknown>>;
  decision: Record<string, unknown> | null;
};

export function ChartScreenshotCaptureDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<CaptureAnalysis | null>(null);
  const [symbol, setSymbol] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => new Date());

  const symbols = useMemo(() => Array.from(new Set(captures.map((item) => item.symbol))).sort(), [captures]);
  const filteredCaptures = useMemo(
    () => (symbol === 'ALL' ? captures : captures.filter((item) => item.symbol === symbol)),
    [captures, symbol],
  );

  const completed = useMemo(
    () => filteredCaptures.filter((item) => item.processingStatus === 'completed').length,
    [filteredCaptures],
  );
  const inFlight = useMemo(
    () => filteredCaptures.filter((item) => !['completed', 'failed'].includes(item.processingStatus)).length,
    [filteredCaptures],
  );
  const failed = useMemo(
    () => filteredCaptures.filter((item) => item.processingStatus === 'failed').length,
    [filteredCaptures],
  );
  const completionRate = filteredCaptures.length ? Math.round((completed / filteredCaptures.length) * 100) : 0;
  const activeSymbol = symbol === 'ALL' ? (symbols[0] ?? '—') : symbol;

  const timeframeCoverage = useMemo(() => {
    const scoped = captures.filter((item) => item.symbol === activeSymbol);
    const present = new Set(scoped.map((item) => item.timeframe));
    return TOP_DOWN_TIMEFRAMES.map((timeframe) => ({
      timeframe,
      present: present.has(timeframe),
      capture: scoped.find((item) => item.timeframe === timeframe) ?? null,
    }));
  }, [activeSymbol, captures]);

  const topDownComplete = timeframeCoverage.every((item) => item.present);

  const loadCaptures = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [capturesResponse, bridgeResponse] = await Promise.all([
        fetch('/api/visual-intelligence/captures?limit=100', { cache: 'no-store' }),
        fetch('/api/mt5/status', { cache: 'no-store' }),
      ]);
      const payload = await capturesResponse.json();
      if (!payload.ok) throw new Error(String(payload.error ?? 'Unable to load chart captures.'));
      const list = Array.isArray(payload.captures) ? (payload.captures as CaptureRecord[]) : [];
      setCaptures(list);
      setSelectedCaptureId((current) => {
        if (current && list.some((item) => item.id === current)) return current;
        const scoped = symbol === 'ALL' ? list : list.filter((item) => item.symbol === symbol);
        return scoped[0]?.id ?? list[0]?.id ?? null;
      });
      const bridgePayload = await bridgeResponse.json().catch(() => null);
      setBridgeOnline(Boolean(bridgePayload?.ok));
      setLastSyncAt(new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load chart captures.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [symbol]);

  const loadAnalysis = useCallback(async (captureId: string) => {
    setAnalysisLoading(true);
    try {
      const response = await fetch(`/api/visual-intelligence/captures/${encodeURIComponent(captureId)}`, { cache: 'no-store' });
      const payload = await response.json();
      setAnalysis(response.ok && payload.ok ? (payload.analysis as CaptureAnalysis) : null);
    } catch {
      setAnalysis(null);
    } finally {
      setAnalysisLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadCaptures(true);
    const interval = window.setInterval(() => void loadCaptures(false), 5000);
    return () => window.clearInterval(interval);
  }, [loadCaptures]);

  useEffect(() => {
    if (selectedCaptureId) void loadAnalysis(selectedCaptureId);
    else setAnalysis(null);
  }, [selectedCaptureId, loadAnalysis]);

  const selectedCapture = filteredCaptures.find((item) => item.id === selectedCaptureId)
    ?? captures.find((item) => item.id === selectedCaptureId)
    ?? null;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <TraderSidebar
        bridgeOnline={bridgeOnline}
        mobileOpen={mobileSidebarOpen}
        onMobileOpenChange={setMobileSidebarOpen}
      />

      <div className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white px-4 py-4 md:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button size="icon" variant="outline" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-700">Top-down capture</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">Chart Screenshot Capture</h1>
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
              <Button variant="outline" size="sm" onClick={() => void loadCaptures(false)} disabled={loading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', (loading || refreshing) && 'animate-spin')} />
                Refresh
              </Button>
              <Link href="/autonomous-pipeline#top-down-capture" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <Workflow className="h-4 w-4" />
                Pipeline
              </Link>
              <Link href="/cacsms-vision" className={cn(buttonVariants({ size: 'sm' }), 'inline-flex items-center gap-1.5')}>
                <BrainCircuit className="h-4 w-4" />
                Vision room
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

          <section className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <MetricCard tone="violet" icon={Camera} label="Captures" value={String(filteredCaptures.length)} detail={`${completed} completed · ${inFlight} in-flight`} />
            <MetricCard tone="emerald" icon={Activity} label="Completion" value={`${completionRate}%`} detail="Processing success rate" />
            <MetricCard tone="blue" icon={Radar} label="Symbols" value={String(symbols.length)} detail={`Viewing ${activeSymbol}`} />
            <MetricCard tone={topDownComplete ? 'emerald' : 'amber'} icon={Layers3} label="Top-down" value={topDownComplete ? 'Complete' : 'Partial'} detail={`${timeframeCoverage.filter((item) => item.present).length}/${TOP_DOWN_TIMEFRAMES.length} frames`} />
            <MetricCard tone={failed > 0 ? 'rose' : 'slate'} icon={DatabaseZap} label="Failures" value={String(failed)} detail="Failed capture jobs" />
            <MetricCard tone={bridgeOnline ? 'emerald' : 'rose'} icon={Workflow} label="MT5 bridge" value={bridgeOnline ? 'Online' : 'Offline'} detail="Chart capture command path" />
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <section className="space-y-4">
              <Panel icon={Layers3} title={`Top-down coverage · ${activeSymbol}`} tone="cyan">
                <div className="grid grid-cols-5 gap-2">
                  {timeframeCoverage.map((item) => {
                    const rowTone: DashboardTone = item.present ? 'emerald' : 'slate';
                    return (
                      <button
                        key={item.timeframe}
                        type="button"
                        disabled={!item.capture}
                        onClick={() => item.capture && setSelectedCaptureId(item.capture.id)}
                        className={cn(
                          'rounded-xl border p-3 text-center shadow-sm transition-opacity',
                          toneMetric(rowTone),
                          !item.capture && 'cursor-default opacity-80',
                        )}
                      >
                        <p className={cn('font-mono text-lg font-bold', toneTitle(rowTone))}>{item.timeframe}</p>
                        <p className={cn('mt-1 text-[10px] font-bold uppercase', toneMuted(rowTone))}>{item.present ? 'Captured' : 'Missing'}</p>
                      </button>
                    );
                  })}
                </div>
              </Panel>

              <Panel icon={Camera} title="Capture registry" tone="blue">
                {loading ? (
                  <p className={cn('text-sm font-medium', toneBody('blue'))}>Loading captures…</p>
                ) : filteredCaptures.length === 0 ? (
                  <p className={cn('text-sm font-medium', toneBody('blue'))}>
                    No chart captures yet. Run the autonomous pipeline top-down capture stage or attach the EA for MT5 screenshots.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filteredCaptures.map((capture) => {
                      const itemTone: DashboardTone = selectedCaptureId === capture.id ? 'violet' : 'slate';
                      return (
                      <button
                        key={capture.id}
                        type="button"
                        onClick={() => setSelectedCaptureId(capture.id)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left shadow-sm transition-opacity',
                          toneMetric(itemTone),
                        )}
                      >
                        <div>
                          <p className={cn('font-mono text-sm font-bold', toneTitle(itemTone))}>{capture.symbol} · {capture.timeframe}</p>
                          <p className={cn('text-[11px]', toneMuted(itemTone))}>{capture.sourcePlatform} · {capture.processingStatus}</p>
                        </div>
                        <div className="text-right">
                          <p className={cn('font-mono text-[11px] font-bold', toneBody(itemTone))}>{formatRelativeTime(capture.capturedAt, clockNow)}</p>
                          <p className={cn('font-mono text-[10px]', toneMuted(itemTone))}>{formatWatClock(new Date(capture.capturedAt))}</p>
                        </div>
                      </button>
                    );
                    })}
                  </div>
                )}
              </Panel>
            </section>

            <aside className="space-y-4">
              <Panel icon={Radar} title="Selected capture" tone="purple">
                {!selectedCapture ? (
                  <p className={cn('text-sm font-medium', toneBody('purple'))}>Select a capture to inspect metadata and analysis chain output.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <InfoChip tone="purple" label="Symbol" value={selectedCapture.symbol} />
                      <InfoChip tone="purple" label="Timeframe" value={selectedCapture.timeframe} />
                      <InfoChip tone="purple" label="Status" value={selectedCapture.processingStatus} />
                      <InfoChip tone="purple" label="Source" value={selectedCapture.sourcePlatform} />
                    </div>
                    <p className={cn('rounded-lg border px-3 py-2 font-mono text-[11px]', toneInsetSurface('purple'), toneBody('purple'))}>
                      {selectedCapture.imageUrl}
                    </p>
                    <p className={cn('text-xs leading-5', toneMuted('purple'))}>
                      Terminal {String(selectedCapture.metadata?.terminalId ?? '—')} · Session {String(selectedCapture.metadata?.sessionId ?? '—').slice(0, 8)}…
                    </p>
                  </div>
                )}
              </Panel>

              <Panel icon={Activity} title="Analysis chain" tone="emerald">
                {analysisLoading ? (
                  <p className={cn('text-sm font-medium', toneBody('emerald'))}>Loading analysis…</p>
                ) : !analysis ? (
                  <p className={cn('text-sm font-medium', toneBody('emerald'))}>No stored analysis bundle for this capture yet.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <InfoChip tone="emerald" label="Jobs" value={String(analysis.jobs.length)} />
                      <InfoChip tone="emerald" label="Candles" value={String(analysis.candles.length)} />
                      <InfoChip tone="emerald" label="Detections" value={String(analysis.detections.length)} />
                      <InfoChip tone="emerald" label="Decision" value={analysis.decision ? 'Yes' : 'No'} />
                    </div>
                    <ScrollArea className={cn('h-[280px] rounded-lg border pr-3', toneInsetSurface('emerald'))}>
                      <pre className={cn('p-3 text-[10px] leading-5', toneBody('emerald'))}>{JSON.stringify(analysis, null, 2)}</pre>
                    </ScrollArea>
                  </div>
                )}
              </Panel>

              <Panel icon={ArrowRight} title="Next steps" tone="amber">
                <div className="space-y-2 text-sm">
                  <QuickLink tone="amber" href="/visual-intelligence-overview/candle-detection" label="Candle detection" />
                  <QuickLink tone="amber" href="/visual-intelligence-overview/multi-timeframe-comparison" label="Multi-timeframe comparison" />
                  <QuickLink tone="amber" href="/cacsms-vision" label="Cacsms Vision intelligence room" />
                </div>
              </Panel>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
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

function QuickLink(props: { tone: DashboardTone; href: string; label: string }) {
  return (
    <Link href={props.href} className={cn('flex items-center justify-between rounded-lg border px-3 py-2 hover:opacity-90', toneInsetSurface(props.tone), toneBody(props.tone))}>
      <span>{props.label}</span>
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

function formatWatClock(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value);
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
