'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Camera,
  CheckCircle2,
  Cpu,
  FileImage,
  Flame,
  GitCompareArrows,
  Layers3,
  Menu,
  Radio,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';

import { TraderSidebar } from '@/components/trader-sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type Tone = 'navy' | 'blue' | 'purple' | 'emerald' | 'orange' | 'rose' | 'slate';
type Timeframe = 'W' | 'D' | 'H4' | 'H1' | 'M15';
type Mode = 'side-by-side' | 'slider' | 'heatmap';

interface CaptureRecord {
  id: string;
  symbol: string;
  timeframe: string;
  imageUrl: string;
  captureType: string;
  capturedAt: string;
  processingStatus: string;
  sourcePlatform: string;
  metadata?: Record<string, unknown>;
}

interface ComparisonResult {
  comparisonId: string;
  result: {
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
  };
  events?: Array<{ eventType: string; severityScore: number; description: string }>;
}

const timeframes: Timeframe[] = ['W', 'D', 'H4', 'H1', 'M15'];

async function submitComparison(input: {
  symbol: string;
  timeframe: Timeframe;
  previousCapture: CaptureRecord;
  currentCapture: CaptureRecord;
}): Promise<ComparisonResult> {
  const response = await fetch('/api/visual-analysis/image-comparison/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: input.symbol,
      timeframe: input.timeframe,
      previousImageUrl: input.previousCapture.imageUrl,
      currentImageUrl: input.currentCapture.imageUrl,
      previousCaptureId: input.previousCapture.id,
      currentCaptureId: input.currentCapture.id,
    }),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error ?? 'Unable to compare images.');
  return { comparisonId: payload.comparisonId, result: payload.result };
}

export default function ImageComparisonEnginePage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('H1');
  const [mode, setMode] = useState<Mode>('side-by-side');
  const [slider, setSlider] = useState(52);
  const [previousCapture, setPreviousCapture] = useState<CaptureRecord | null>(null);
  const [currentCapture, setCurrentCapture] = useState<CaptureRecord | null>(null);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [history, setHistory] = useState<ComparisonResult[]>([]);
  const [events, setEvents] = useState<Array<{ type: string; message: string; time: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [syncingCaptures, setSyncingCaptures] = useState(true);
  const [comparedPair, setComparedPair] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState('');

  const result = comparison?.result ?? null;
  const previousImage = previousCapture?.imageUrl ?? '';
  const currentImage = currentCapture?.imageUrl ?? '';
  const activePairKey = previousCapture && currentCapture ? `${previousCapture.id}:${currentCapture.id}` : '';
  const canCompare = Boolean(previousCapture && currentCapture) && !loading;

  const headline = useMemo(() => {
    if (!result) return 'Awaiting chart pair';
    return `${result.finalInterpretation} / ${result.similarityPercentage.toFixed(1)}% similar`;
  }, [result]);

  useEffect(() => {
    const tick = () => setNow(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Lagos',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date()));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch(`/api/visual-analysis/image-comparison/${encodeURIComponent(symbol)}/${timeframe}/history`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => {
        if (payload.ok) setHistory(payload.history ?? []);
      })
      .catch(() => undefined);
  }, [symbol, timeframe]);

  useEffect(() => {
    let active = true;

    async function syncCapturePair() {
      setSyncingCaptures(true);
      try {
        const response = await fetch('/api/visual-intelligence/captures?limit=100', { cache: 'no-store' });
        const payload = await response.json();
        if (!payload.ok) throw new Error(payload.error ?? 'Unable to load autonomous captures.');
        if (!active) return;

        const matchingCaptures = (payload.captures ?? [])
          .filter((capture: CaptureRecord) => (
            capture.symbol.toUpperCase() === symbol.toUpperCase()
            && capture.timeframe.toUpperCase() === timeframe.toUpperCase()
            && capture.imageUrl
          ))
          .sort((left: CaptureRecord, right: CaptureRecord) => new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime());

        setCurrentCapture(matchingCaptures[0] ?? null);
        setPreviousCapture(matchingCaptures[1] ?? null);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Unable to load autonomous captures.');
      } finally {
        if (active) setSyncingCaptures(false);
      }
    }

    syncCapturePair();
    const interval = window.setInterval(syncCapturePair, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    const source = new EventSource('/api/visual-intelligence/stream');
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { eventType?: string; payload?: Record<string, unknown> };
        if (!event.eventType?.startsWith('comparison.')) return;
        setEvents((items) => [{
          type: event.eventType ?? 'comparison.event',
          message: event.eventType === 'comparison.completed'
            ? `Completed: ${String(event.payload?.finalInterpretation ?? 'visual delta processed')}`
            : String(event.payload?.timeframe ?? timeframe),
          time: new Date().toLocaleTimeString(),
        }, ...items].slice(0, 8));
      } catch {
        // Keep the live console resilient to non-JSON keepalive chunks.
      }
    };
    return () => source.close();
  }, [timeframe]);

  async function runComparison() {
    if (!previousCapture || !currentCapture) return;
    const pairKey = `${previousCapture.id}:${currentCapture.id}`;
    setLoading(true);
    setError(null);
    try {
      const nextComparison = await submitComparison({ symbol, timeframe, previousCapture, currentCapture });
      setComparison(nextComparison);
      setComparedPair(pairKey);
      setHistory((items) => [nextComparison, ...items.filter((item) => item.comparisonId !== nextComparison.comparisonId)].slice(0, 12));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to compare images.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!previousCapture || !currentCapture || loading || !activePairKey || comparedPair === activePairKey) return;
    const pairKey = activePairKey;
    const previous = previousCapture;
    const current = currentCapture;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const nextComparison = await submitComparison({ symbol, timeframe, previousCapture: previous, currentCapture: current });
        setComparison(nextComparison);
        setComparedPair(pairKey);
        setHistory((items) => [nextComparison, ...items.filter((item) => item.comparisonId !== nextComparison.comparisonId)].slice(0, 12));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to compare images.');
      } finally {
        setLoading(false);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [activePairKey, comparedPair, currentCapture, loading, previousCapture, symbol, timeframe]);

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-950">
      <TraderSidebar bridgeOnline mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 lg:hidden">
            <Button size="icon" variant="outline" onClick={() => setMobileSidebarOpen(true)}><Menu className="h-4 w-4" /></Button>
            <div>
              <p className="text-sm font-semibold">Image Comparison Engine</p>
              <p className="text-xs text-slate-500">Visual delta intelligence</p>
            </div>
          </div>

          <div className="grid gap-3 px-5 py-4 xl:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-950 md:text-xl">Image Comparison Engine</h1>
              <p className="truncate text-xs font-mono text-blue-700">Before/after screenshots, structural delta maps, liquidity movement and AI interpretation</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <HeaderChip icon={Radio} label="Stream" value="capture.live" tone="emerald" />
              <HeaderChip icon={Cpu} label="Engine" value="SSIM / ORB-ready" tone="purple" />
              <HeaderChip icon={Camera} label="Capture Pair" value={activePairKey ? 'locked' : syncingCaptures ? 'syncing' : 'waiting'} tone="orange" />
              <HeaderChip icon={Activity} label="WAT" value={now || '--:--:--'} tone="navy" />
            </div>
          </div>

          <div className="grid gap-2 px-5 pb-4 md:grid-cols-[160px_160px_1fr_auto]">
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold shadow-sm outline-none focus:border-blue-400"
              aria-label="Symbol"
            />
            <select
              value={timeframe}
              onChange={(event) => setTimeframe(event.target.value as Timeframe)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold shadow-sm outline-none focus:border-blue-400"
              aria-label="Timeframe"
            >
              {timeframes.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {(['side-by-side', 'slider', 'heatmap'] as Mode[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setMode(item)}
                  className={cn('flex-1 rounded-md px-3 py-2 text-xs font-semibold capitalize transition', mode === item ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900')}
                >
                  {item.replace('-', ' ')}
                </button>
              ))}
            </div>
            <Button onClick={runComparison} disabled={!canCompare}>
              {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <GitCompareArrows className="mr-2 h-4 w-4" />}
              Compare Now
            </Button>
          </div>
        </div>

        <div className="grid gap-4 p-5 xl:grid-cols-[1fr_360px]">
          <section className="space-y-4">
            {error && (
              <Card className="border-rose-200 bg-rose-50">
                <CardContent className="flex items-center gap-2 p-4 text-sm font-semibold text-rose-700">
                  <AlertTriangle className="h-4 w-4" /> {error}
                </CardContent>
              </Card>
            )}

            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ScanSearch className="h-5 w-5 text-blue-600" /> Before / After Visual Workspace
                  </CardTitle>
                  <div className="text-xs font-mono text-slate-500">{headline}</div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ComparisonViewer
                  previousImage={previousImage}
                  currentImage={currentImage}
                  heatmapUrl={result?.heatmapUrl ?? ''}
                  mode={mode}
                  slider={slider}
                  setSlider={setSlider}
                />
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <CaptureCard title="Previous Capture" capture={previousCapture} syncing={syncingCaptures} />
              <CaptureCard title="Current Capture" capture={currentCapture} syncing={syncingCaptures} />
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <MetricCard label="Similarity" value={result ? `${result.similarityPercentage.toFixed(1)}%` : '--'} tone="blue" />
              <MetricCard label="Change Score" value={result ? `${result.comparisonScore.toFixed(1)}` : '--'} tone="orange" />
              <MetricCard label="Confidence" value={result ? `${result.visualChangeConfidence.toFixed(1)}%` : '--'} tone="emerald" />
              <MetricCard label="Blocks" value={result ? String(result.differenceBlocks.length) : '--'} tone="purple" />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <DeltaList title="Changed Structures" icon={Layers3} items={result?.changedStructures ?? []} empty="No candle or structure change confirmed yet." />
              <DeltaList title="New Zones" icon={Target} items={result?.newZones ?? []} empty="No newly formed zones detected." />
              <DeltaList title="Invalidated Zones" icon={Flame} items={result?.invalidatedZones ?? []} empty="No disappeared or invalidated zones detected." />
            </div>
          </section>

          <aside className="space-y-4">
            <Card className="border-blue-100 bg-blue-50/70 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-slate-900">
                  <BrainCircuit className="h-5 w-5 text-blue-600" /> AI Change Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-2xl font-semibold text-slate-950">{result?.finalInterpretation ?? 'No comparison yet'}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{result?.aiExplanation ?? 'Upload previous and current chart screenshots for the same symbol and timeframe to generate visual delta intelligence.'}</p>
                </div>
                <SignalTile label="Changed Bias" value={result?.changedBias ?? 'Pending'} tone={interpretationTone(result?.finalInterpretation)} />
                <SignalTile label="Recommendation" value={result?.recommendation ?? 'Await image pair'} tone="navy" />
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-5 w-5 text-purple-600" /> Market Change Timeline
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[260px] pr-3">
                  <div className="space-y-3">
                    {(result?.marketChangeTimeline ?? []).map((item, index) => (
                      <div key={`${String(item.eventType)}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">{String(item.eventType ?? 'change')}</p>
                          <span className="font-mono text-xs text-blue-700">{Number(item.severityScore ?? 0).toFixed(2)}</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-600">{String(item.description ?? '')}</p>
                      </div>
                    ))}
                    {!result?.marketChangeTimeline?.length && <p className="text-sm text-slate-500">No comparison timeline generated yet.</p>}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" /> Institutional Interpretation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-6 text-slate-600">
                <p>{result?.institutionalInterpretation ?? 'The engine will explain whether structure is unchanged, shifting, sweeping liquidity, manipulating traders, or invalidating the prior setup.'}</p>
                <Progress value={result ? result.confidence * 100 : 0} />
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-5 w-5 text-orange-600" /> Processing Console
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[180px] pr-3">
                  <div className="space-y-2">
                    {events.map((event, index) => (
                      <div key={`${event.time}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="text-xs font-semibold text-slate-900">{event.type}</p>
                        <p className="text-xs text-slate-500">{event.message} / {event.time}</p>
                      </div>
                    ))}
                    {!events.length && <p className="text-sm text-slate-500">Live comparison events will appear here.</p>}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}

function CaptureCard({ title, capture, syncing }: { title: string; capture: CaptureRecord | null; syncing: boolean }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex min-w-0 items-center gap-2">
            <FileImage className="h-5 w-5 shrink-0 text-blue-600" /> {title}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
            {syncing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Auto
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          {capture ? `${capture.symbol} / ${capture.timeframe} / ${formatCaptureTime(capture.capturedAt)}` : 'Waiting for the MT5/browser capture pipeline to provide this frame.'}
        </div>
        <div className="aspect-video overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {capture?.imageUrl ? <img src={capture.imageUrl} alt={title} className="h-full w-full object-cover" /> : (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs font-mono text-slate-400">
              No autonomous capture available yet
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatCaptureTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function ComparisonViewer(props: {
  previousImage: string;
  currentImage: string;
  heatmapUrl: string;
  mode: Mode;
  slider: number;
  setSlider: (value: number) => void;
}) {
  const { previousImage, currentImage, heatmapUrl, mode, slider, setSlider } = props;
  if (!previousImage || !currentImage) {
    return <div className="flex aspect-[16/7] items-center justify-center bg-slate-50 text-sm font-mono text-slate-400">Upload two chart screenshots to activate comparison viewer</div>;
  }
  if (mode === 'slider') {
    return (
      <div className="space-y-3 bg-slate-50 p-4">
        <div className="relative aspect-[16/7] overflow-hidden rounded-xl border border-slate-200 bg-white">
          <img src={previousImage} alt="Previous chart" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 overflow-hidden" style={{ width: `${slider}%` }}>
            <img src={currentImage} alt="Current chart" className="absolute inset-0 h-full w-full object-cover" />
          </div>
          <div className="absolute top-0 h-full w-0.5 bg-blue-600 shadow" style={{ left: `${slider}%` }} />
        </div>
        <input type="range" min={0} max={100} value={slider} onChange={(event) => setSlider(Number(event.target.value))} className="w-full" aria-label="Comparison slider" />
      </div>
    );
  }
  if (mode === 'heatmap') {
    return (
      <div className="relative aspect-[16/7] overflow-hidden bg-slate-50">
        <img src={currentImage} alt="Current chart" className="h-full w-full object-cover opacity-70" />
        {heatmapUrl && <img src={heatmapUrl} alt="Difference heatmap" className="absolute inset-0 h-full w-full object-cover mix-blend-multiply" />}
      </div>
    );
  }
  return (
    <div className="grid gap-px bg-slate-200 md:grid-cols-2">
      <img src={previousImage} alt="Previous chart" className="aspect-[16/7] w-full bg-white object-cover" />
      <img src={currentImage} alt="Current chart" className="aspect-[16/7] w-full bg-white object-cover" />
    </div>
  );
}

function DeltaList({ title, icon: Icon, items, empty }: { title: string; icon: LucideIcon; items: Array<Record<string, unknown>>; empty: string }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 text-blue-600" /> {title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {items.slice(0, 5).map((item, index) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">{String(item.type ?? item.eventType ?? 'zone')}</p>
              <p className="mt-1 text-xs font-mono text-slate-500">{JSON.stringify(item).slice(0, 96)}</p>
            </div>
          ))}
          {!items.length && <p className="text-sm text-slate-500">{empty}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function HeaderChip(props: { icon: LucideIcon; label: string; value: string; tone: Tone }) {
  const Icon = props.icon;
  return (
    <div className={cn('rounded-xl border px-3 py-2 shadow-sm', toneBorder(props.tone), toneBg(props.tone))}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', toneText(props.tone))} />
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500">{props.label}</p>
          <p className="truncate font-mono text-xs font-semibold text-slate-950">{props.value}</p>
        </div>
      </div>
    </div>
  );
}

function MetricCard(props: { label: string; value: string; tone: Tone }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn('rounded-xl border p-4 shadow-sm', toneBorder(props.tone), toneBg(props.tone))}>
      <p className="text-xs text-slate-500">{props.label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{props.value}</p>
    </motion.div>
  );
}

function SignalTile(props: { label: string; value: string; tone: Tone }) {
  return (
    <div className={cn('rounded-xl border p-3', toneBorder(props.tone), toneBg(props.tone))}>
      <p className="text-xs text-slate-500">{props.label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{props.value}</p>
    </div>
  );
}

function interpretationTone(value?: string): Tone {
  if (value === 'Bullish shift') return 'emerald';
  if (value === 'Bearish shift' || value === 'Setup invalidated') return 'rose';
  if (value === 'Liquidity sweep' || value === 'Manipulation detected') return 'orange';
  return 'blue';
}

function toneBorder(tone: Tone) {
  return {
    navy: 'border-slate-300',
    blue: 'border-blue-200',
    purple: 'border-purple-200',
    emerald: 'border-emerald-200',
    orange: 'border-orange-200',
    rose: 'border-rose-200',
    slate: 'border-slate-200',
  }[tone];
}

function toneBg(tone: Tone) {
  return {
    navy: 'bg-slate-50',
    blue: 'bg-blue-50',
    purple: 'bg-purple-50',
    emerald: 'bg-emerald-50',
    orange: 'bg-orange-50',
    rose: 'bg-rose-50',
    slate: 'bg-slate-50',
  }[tone];
}

function toneText(tone: Tone) {
  return {
    navy: 'text-slate-700',
    blue: 'text-blue-600',
    purple: 'text-purple-600',
    emerald: 'text-emerald-600',
    orange: 'text-orange-600',
    rose: 'text-rose-600',
    slate: 'text-slate-600',
  }[tone];
}
