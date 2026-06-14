'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Camera,
  CheckCircle2,
  Circle,
  Eye,
  Layers3,
  Menu,
  Radar,
  RefreshCw,
  Sparkles,
  Workflow,
} from 'lucide-react';

import { DashboardPageFrame } from '@/components/dashboard-page-frame';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const TOP_DOWN_TIMEFRAMES = ['W', 'D', 'H4', 'H1', 'M15'] as const;

type CaptureRecord = {
  id: string;
  symbol: string;
  timeframe: string;
  sourcePlatform: string;
  captureType: string;
  capturedAt: string;
  processingStatus: string;
  metadata?: Record<string, unknown>;
};

type VisionEvent = {
  id: string;
  eventType: string;
  chartCaptureId: string | null;
  jobId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

type VisionState = {
  captures: CaptureRecord[];
  events: VisionEvent[];
  capabilities: {
    ingestion: string[];
    detections: string[];
    decisions: string[];
    persistence: boolean;
    realTimeEvents: boolean;
  };
};

const DETECTION_LINKS = [
  { href: '/visual-intelligence-overview/chart-screenshot-capture', label: 'Chart screenshot capture', detail: 'Ingest and inspect broker snapshots' },
  { href: '/visual-intelligence-overview/candle-detection', label: 'Candle detection', detail: 'Reconstructed OHLC from chart pixels' },
  { href: '/visual-intelligence-overview/swing-point-detection', label: 'Swing point detection', detail: 'Swing highs and lows hierarchy' },
  { href: '/visual-intelligence-overview/pattern-recognition', label: 'Pattern recognition', detail: 'Chart pattern candidates' },
  { href: '/visual-intelligence-overview/trendline-detection', label: 'Trendline detection', detail: 'Trendlines, breaks, and retests' },
  { href: '/visual-intelligence-overview/channel-detection', label: 'Channel detection', detail: 'Parallel channel boundaries' },
  { href: '/visual-intelligence-overview/support-resistance-mapping', label: 'Support/resistance mapping', detail: 'S/R zones and reactions' },
  { href: '/visual-intelligence-overview/order-block-detection', label: 'Order block detection', detail: 'Institutional order blocks' },
  { href: '/visual-intelligence-overview/liquidity-zone-detection', label: 'Liquidity zone detection', detail: 'Liquidity pools and sweeps' },
  { href: '/visual-intelligence-overview/structure-analysis', label: 'Structure analysis', detail: 'BOS, CHOCH, and market phase' },
] as const;

const ANALYSIS_LINKS = [
  { href: '/visual-intelligence-overview/multi-timeframe-comparison', label: 'Multi-timeframe comparison', detail: 'Top-down alignment and fusion' },
  { href: '/visual-intelligence-overview/image-comparison-engine', label: 'Image comparison engine', detail: 'Before/after chart similarity' },
  { href: '/visual-intelligence-overview/ai-visual-interpretation', label: 'AI visual interpretation', detail: 'Narrative chart reading' },
  { href: '/visual-intelligence-overview/visual-anomaly-detection', label: 'Visual anomaly detection', detail: 'Unusual structure or liquidity' },
  { href: '/visual-intelligence-overview/ai-chart-segmentation', label: 'AI chart segmentation', detail: 'Chart area decomposition' },
  { href: '/visual-intelligence-overview/visual-market-interpretation', label: 'Visual market interpretation', detail: 'Final visual decision layer' },
] as const;

export function VisualIntelligenceOverviewDashboard() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [state, setState] = useState<VisionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stateResponse, bridgeResponse] = await Promise.all([
        fetch('/api/visual-intelligence/state', { cache: 'no-store' }),
        fetch('/api/mt5/status', { cache: 'no-store' }),
      ]);
      const payload = await stateResponse.json();
      if (!stateResponse.ok || !payload.ok) {
        throw new Error(String(payload.error ?? 'Unable to load visual intelligence state.'));
      }
      setState({
        captures: Array.isArray(payload.captures) ? payload.captures : [],
        events: Array.isArray(payload.events) ? payload.events : [],
        capabilities: payload.capabilities ?? {
          ingestion: [],
          detections: [],
          decisions: [],
          persistence: false,
          realTimeEvents: false,
        },
      });
      const bridgePayload = await bridgeResponse.json().catch(() => null);
      setBridgeOnline(Boolean(bridgePayload?.ok && bridgePayload?.bridge?.ok));
      setRefreshedAt(new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load visual intelligence state.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const captures = state?.captures ?? [];
  const events = state?.events ?? [];

  const completed = useMemo(
    () => captures.filter((capture) => capture.processingStatus === 'completed').length,
    [captures],
  );
  const inFlight = useMemo(
    () => captures.filter((capture) => !['completed', 'failed'].includes(capture.processingStatus)).length,
    [captures],
  );
  const symbols = useMemo(() => new Set(captures.map((capture) => capture.symbol).filter(Boolean)), [captures]);
  const latestCapture = captures[0] ?? null;
  const activeSymbol = latestCapture?.symbol ?? '—';
  const activeSessionId = String(latestCapture?.metadata?.sessionId ?? '').trim();

  const timeframeCoverage = useMemo(() => {
    const scoped = captures.filter((capture) => capture.symbol === activeSymbol);
    const present = new Set(scoped.map((capture) => capture.timeframe));
    return TOP_DOWN_TIMEFRAMES.map((timeframe) => ({
      timeframe,
      present: present.has(timeframe),
    }));
  }, [activeSymbol, captures]);

  const topDownComplete = timeframeCoverage.every((item) => item.present);
  const completionRate = captures.length ? Math.round((completed / captures.length) * 100) : 0;
  const hasMtfEvents = events.some((event) => event.eventType.startsWith('mtf.'));
  const readinessScore = Math.round(
    ([
      captures.length > 0,
      topDownComplete,
      completed > 0,
      hasMtfEvents,
      bridgeOnline,
    ].filter(Boolean).length
      / 5)
      * 100,
  );

  const readinessChecks = useMemo(
    () => [
      {
        id: 'captures',
        label: 'Chart captures ingested',
        passed: captures.length > 0,
        href: '/visual-intelligence-overview/chart-screenshot-capture',
        hint: captures.length > 0 ? `${captures.length} capture(s) in registry.` : 'Run a top-down capture session from the pipeline.',
      },
      {
        id: 'topdown',
        label: 'Top-down timeframe stack',
        passed: topDownComplete,
        href: '/autonomous-pipeline#top-down-capture',
        hint: topDownComplete
          ? `${activeSymbol} has W → D → H4 → H1 → M15 coverage.`
          : `Missing frames for ${activeSymbol}. Start top-down session.`,
      },
      {
        id: 'processing',
        label: 'Detection pipeline completed',
        passed: completed > 0 && inFlight === 0,
        href: '/visual-intelligence-overview/candle-detection',
        hint: inFlight > 0
          ? `${inFlight} capture(s) still processing.`
          : completed > 0
            ? `${completionRate}% of captures completed.`
            : 'No completed analysis yet.',
      },
      {
        id: 'mtf',
        label: 'Multi-timeframe fusion',
        passed: hasMtfEvents,
        href: '/visual-intelligence-overview/multi-timeframe-comparison',
        hint: hasMtfEvents ? 'MTF alignment events recorded.' : 'Run MTF comparison after capture stack completes.',
      },
      {
        id: 'bridge',
        label: 'MT5 capture bridge',
        passed: bridgeOnline,
        href: '/mt5-infrastructure',
        hint: bridgeOnline ? 'Bridge online for chart capture commands.' : 'MT5 bridge offline — captures may stall.',
      },
    ],
    [activeSymbol, bridgeOnline, captures.length, completed, completionRate, hasMtfEvents, inFlight, topDownComplete],
  );

  const recentEvents = [...events].reverse().slice(0, 8);

  return (
    <DashboardPageFrame bridgeOnline={bridgeOnline} mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 md:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button type="button" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation">
                <Menu className="h-5 w-5 text-slate-700" />
              </button>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-700">Computer Vision</p>
                <h1 className="text-xl font-semibold text-slate-950">Visual Intelligence Overview</h1>
                <p className="text-sm text-slate-500">Live capture registry, detector chain status, and module navigation</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {refreshedAt ? (
                <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-mono text-slate-600 sm:inline">
                  Updated {new Date(refreshedAt).toLocaleTimeString('en-US', { hour12: false })}
                </span>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </Button>
              <Link
                href="/cacsms-vision"
                className={cn(buttonVariants({ size: 'sm' }), 'inline-flex items-center gap-1.5')}
              >
                <BrainCircuit className="h-4 w-4" />
                Vision room
              </Link>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain space-y-6 bg-white p-4 md:p-6">
          {error ? (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </CardContent>
            </Card>
          ) : null}

          <section
            className={cn(
              'rounded-2xl border p-5 shadow-sm',
              captures.length > 0
                ? 'border-violet-200 bg-gradient-to-r from-violet-50 via-white to-white'
                : 'border-amber-200 bg-gradient-to-r from-amber-50 via-white to-white',
            )}
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-violet-200 bg-violet-100 text-violet-800">
                  <Eye className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                    {captures.length > 0 ? 'Visual pipeline active' : 'Awaiting chart captures'}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-slate-600">
                    {captures.length > 0
                      ? `Tracking ${captures.length} capture(s) across ${symbols.size} symbol(s). Active symbol ${activeSymbol}${activeSessionId ? ` · session ${activeSessionId.slice(0, 8)}…` : ''}.`
                      : 'No captures in the registry yet. Start a top-down capture from the autonomous pipeline or ingest a chart screenshot.'}
                  </p>
                </div>
              </div>
              <Link
                href="/autonomous-pipeline#top-down-capture"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5 self-start')}
              >
                <Camera className="h-4 w-4" />
                Pipeline capture stage
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <MetricCard icon={Camera} label="Captures" value={String(captures.length)} detail={`${completed} completed · ${inFlight} in-flight`} tone="violet" />
            <MetricCard icon={Radar} label="Symbols" value={String(symbols.size)} detail={`Active: ${activeSymbol}`} tone="indigo" />
            <MetricCard icon={Layers3} label="Top-down stack" value={topDownComplete ? 'Complete' : 'Partial'} detail={`${timeframeCoverage.filter((item) => item.present).length}/${TOP_DOWN_TIMEFRAMES.length} frames`} tone={topDownComplete ? 'teal' : 'amber'} />
            <MetricCard icon={Activity} label="Completion" value={`${completionRate}%`} detail="Processing success rate" tone="teal" />
            <MetricCard icon={Sparkles} label="Events" value={String(events.length)} detail="Real-time vision events" tone="slate" />
            <MetricCard icon={Workflow} label="Readiness" value={`${readinessScore}%`} detail={readinessScore >= 80 ? 'Pipeline ready' : 'Setup in progress'} tone={readinessScore >= 80 ? 'teal' : 'amber'} />
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
              <CardHeader className="border-b border-slate-200 py-4">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <CheckCircle2 className="h-4 w-4 text-teal-600" />
                  Visual pipeline readiness
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                    <span>Setup progress</span>
                    <span className="font-mono">{readinessScore}%</span>
                  </div>
                  <Progress value={readinessScore} className="h-2 bg-slate-100" />
                </div>
                <div className="space-y-2">
                  {readinessChecks.map((check) => (
                    <Link
                      key={check.id}
                      href={check.href}
                      className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 transition-colors hover:bg-slate-50"
                    >
                      <div className="flex items-start gap-2.5">
                        {check.passed ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                        ) : (
                          <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                        )}
                        <div>
                          <p className="text-sm font-medium text-slate-900">{check.label}</p>
                          <p className="text-xs text-slate-500">{check.hint}</p>
                        </div>
                      </div>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
              <CardHeader className="border-b border-slate-200 py-4">
                <CardTitle className="text-sm font-semibold">Top-down coverage · {activeSymbol}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                <div className="grid grid-cols-5 gap-2">
                  {timeframeCoverage.map((item) => (
                    <div
                      key={item.timeframe}
                      className={cn(
                        'rounded-lg border px-2 py-3 text-center',
                        item.present ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-slate-200 bg-slate-50 text-slate-500',
                      )}
                    >
                      <div className="font-mono text-sm font-semibold">{item.timeframe}</div>
                      <div className="mt-1 text-[10px] uppercase">{item.present ? 'Captured' : 'Missing'}</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  Detector chain: {state?.capabilities.detections.slice(0, 4).join(', ')}
                  {(state?.capabilities.detections.length ?? 0) > 4 ? '…' : ''}
                </p>
              </CardContent>
            </Card>
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
              <CardHeader className="border-b border-slate-200 py-4">
                <CardTitle className="text-sm font-semibold">Chart capture &amp; detection</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
                {DETECTION_LINKS.map((link) => (
                  <ModuleLink key={link.href} href={link.href} label={link.label} detail={link.detail} />
                ))}
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
              <CardHeader className="border-b border-slate-200 py-4">
                <CardTitle className="text-sm font-semibold">Visual analysis</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
                {ANALYSIS_LINKS.map((link) => (
                  <ModuleLink key={link.href} href={link.href} label={link.label} detail={link.detail} />
                ))}
              </CardContent>
            </Card>
          </section>

          <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
            <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
              <CardHeader className="flex flex-row items-center justify-between border-b border-slate-200 py-4">
                <CardTitle className="text-sm font-semibold">Recent captures</CardTitle>
                <Link href="/visual-intelligence-overview/chart-screenshot-capture" className="text-xs font-medium text-violet-700 hover:underline">
                  Open capture module
                </Link>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200 hover:bg-transparent">
                      <TableHead className="text-[11px] uppercase text-slate-500">Symbol</TableHead>
                      <TableHead className="text-[11px] uppercase text-slate-500">TF</TableHead>
                      <TableHead className="text-[11px] uppercase text-slate-500">Status</TableHead>
                      <TableHead className="text-[11px] uppercase text-slate-500">Source</TableHead>
                      <TableHead className="text-right text-[11px] uppercase text-slate-500">Captured</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {captures.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={5} className="h-28 text-center text-sm text-slate-500">
                          No captures yet. Run top-down capture from the autonomous pipeline.
                        </TableCell>
                      </TableRow>
                    ) : (
                      captures.slice(0, 10).map((capture) => (
                        <TableRow key={capture.id} className="border-slate-100">
                          <TableCell className="font-mono text-xs text-slate-800">{capture.symbol}</TableCell>
                          <TableCell className="font-mono text-xs text-slate-700">{capture.timeframe}</TableCell>
                          <TableCell>
                            <StatusBadge status={capture.processingStatus} />
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">{capture.sourcePlatform || capture.captureType}</TableCell>
                          <TableCell className="text-right font-mono text-[11px] text-slate-500">
                            {new Date(capture.capturedAt).toLocaleTimeString('en-US', { hour12: false })}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
              <CardHeader className="border-b border-slate-200 py-4">
                <CardTitle className="text-sm font-semibold">Recent vision events</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-4">
                {recentEvents.length === 0 ? (
                  <p className="text-sm text-slate-500">No events yet.</p>
                ) : (
                  recentEvents.map((event) => (
                    <div key={event.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] uppercase text-violet-700">{formatEventType(event.eventType)}</span>
                        <span className="font-mono text-[10px] text-slate-400">
                          {new Date(event.createdAt).toLocaleTimeString('en-US', { hour12: false })}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-700">{describeEvent(event)}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </section>
        </main>
      </div>
    </DashboardPageFrame>
  );
}

function ModuleLink(props: { href: string; label: string; detail: string }) {
  return (
    <Link
      href={props.href}
      className="rounded-lg border border-slate-200 p-3 transition-colors hover:border-violet-200 hover:bg-violet-50/40"
    >
      <div className="text-sm font-medium text-slate-900">{props.label}</div>
      <p className="mt-1 text-xs text-slate-500">{props.detail}</p>
    </Link>
  );
}

function MetricCard(props: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  tone: 'violet' | 'indigo' | 'teal' | 'amber' | 'slate';
}) {
  const Icon = props.icon;
  const toneClass = {
    violet: 'text-violet-600',
    indigo: 'text-indigo-700',
    teal: 'text-teal-600',
    amber: 'text-amber-600',
    slate: 'text-slate-600',
  }[props.tone];

  return (
    <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-normal uppercase tracking-wider text-slate-500">
          <Icon className={cn('h-3.5 w-3.5', toneClass)} />
          {props.label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-mono text-2xl text-slate-950">{props.value}</div>
        <p className="mt-2 text-xs text-slate-500">{props.detail}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge(props: { status: string }) {
  const normalized = props.status.toLowerCase();
  return (
    <span
      className={cn(
        'inline-flex rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase',
        normalized === 'completed' && 'border-teal-200 bg-teal-50 text-teal-800',
        (normalized === 'queued' || normalized === 'processing') && 'border-amber-200 bg-amber-50 text-amber-800',
        normalized === 'failed' && 'border-rose-200 bg-rose-50 text-rose-800',
        !['completed', 'queued', 'processing', 'failed'].includes(normalized) && 'border-slate-200 bg-slate-50 text-slate-700',
      )}
    >
      {props.status}
    </span>
  );
}

function formatEventType(eventType: string): string {
  return eventType.replace(/\./g, ' · ');
}

function describeEvent(event: VisionEvent): string {
  const payload = event.payload ?? {};
  if (typeof payload.symbol === 'string' && typeof payload.timeframe === 'string') {
    const decision = typeof payload.decisionState === 'string' ? ` · ${payload.decisionState}` : '';
    const bias = typeof payload.bias === 'string' ? ` · ${payload.bias}` : '';
    return `${payload.symbol} ${payload.timeframe}${bias}${decision}`;
  }
  if (Array.isArray(payload.alignments)) {
    return `${payload.symbol ?? 'Symbol'} MTF alignment updated (${payload.alignments.length} pairs)`;
  }
  if (typeof payload.message === 'string') return payload.message;
  return event.chartCaptureId ? `Capture ${event.chartCaptureId.slice(0, 8)}…` : 'Vision pipeline event';
}
