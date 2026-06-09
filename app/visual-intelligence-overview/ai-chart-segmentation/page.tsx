'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Blocks,
  BrainCircuit,
  CheckCircle2,
  GitBranch,
  Layers3,
  Menu,
  RefreshCw,
  Sparkles,
  Target,
  TimerReset,
  type LucideIcon,
} from 'lucide-react';

import { TraderSidebar } from '@/components/trader-sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type Timeframe = 'W' | 'D' | 'H4' | 'H1' | 'M15';
type Tone = 'blue' | 'emerald' | 'orange' | 'purple' | 'rose' | 'slate' | 'amber';

interface Segment {
  id: string;
  startCandleIndex: number;
  endCandleIndex: number;
  priceLow: number;
  priceHigh: number;
  segmentType: string;
  confidenceScore: number;
  marketMeaning: string;
  institutionalInterpretation: string;
  tradingRelevance: string;
  volatilityRegime: string;
  structureRegime: string;
  explanation: string;
}

interface SegmentationReport {
  capture: { id: string; symbol: string; timeframe: string; imageUrl: string };
  segments: Segment[];
  explanation: string;
  modelVersion: string;
  createdAt: string | null;
}

const timeframes: Timeframe[] = ['W', 'D', 'H4', 'H1', 'M15'];
const legend = [
  'Accumulation', 'Manipulation', 'Expansion', 'Distribution', 'Consolidation', 'Pullback', 'Trend continuation',
  'Reversal attempt', 'Liquidity sweep zone', 'Order block reaction zone', 'Support/resistance reaction zone',
  'Volatility compression zone', 'Breakout zone', 'Retest zone',
];

export default function AiChartSegmentationPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('H1');
  const [report, setReport] = useState<SegmentationReport | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState('');

  const selected = report?.segments.find((segment) => segment.id === selectedId) ?? report?.segments[0] ?? null;
  const phaseCounts = useMemo(() => {
    const groups = new Map<string, number>();
    for (const segment of report?.segments ?? []) groups.set(segment.segmentType, (groups.get(segment.segmentType) ?? 0) + 1);
    return Array.from(groups.entries()).slice(0, 4);
  }, [report]);

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
    let active = true;
    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const latest = await fetch(`/api/visual-analysis/segmentation/${encodeURIComponent(symbol)}/${timeframe}/latest`, { cache: 'no-store' });
        if (latest.ok) {
          const payload = await latest.json();
          if (active) {
            setReport(payload.report);
            setSelectedId(payload.report.segments?.[0]?.id ?? '');
          }
          return;
        }
        const analyzed = await fetch('/api/visual-analysis/segmentation/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, timeframe }),
        });
        const payload = await analyzed.json();
        if (!payload.ok) throw new Error(payload.error ?? 'Unable to segment chart.');
        if (active) {
          setReport(payload.report);
          setSelectedId(payload.report.segments?.[0]?.id ?? '');
        }
      } catch (caught) {
        if (active) {
          setReport(null);
          setError(caught instanceof Error ? caught.message : 'Unable to load chart segmentation.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    loadReport();
    return () => {
      active = false;
    };
  }, [symbol, timeframe]);

  async function runSegmentation() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/visual-analysis/segmentation/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Unable to segment chart.');
      setReport(payload.report);
      setSelectedId(payload.report.segments?.[0]?.id ?? '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to segment chart.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-950">
      <TraderSidebar bridgeOnline mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />

      <main className="min-w-0 flex-1 overflow-y-auto bg-white">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur md:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button size="icon" variant="outline" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold md:text-xl">AI Chart Segmentation</h1>
                <p className="truncate text-xs font-mono text-blue-700">Market-region segmentation, regime clustering and semantic chart zoning</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <HeaderChip icon={Layers3} label="Segments" value={String(report?.segments.length ?? 0)} tone="blue" />
              <HeaderChip icon={BrainCircuit} label="Model" value={report?.modelVersion ?? 'hybrid'} tone="purple" />
              <HeaderChip icon={Activity} label="Selected" value={selected?.segmentType ?? 'none'} tone={toneForType(selected?.segmentType)} />
              <HeaderChip icon={TimerReset} label="WAT" value={now || '--:--:--'} tone="slate" />
            </div>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto]">
            <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold shadow-sm outline-none focus:border-blue-400" aria-label="Symbol" />
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {timeframes.map((item) => (
                <button key={item} type="button" onClick={() => setTimeframe(item)} className={cn('h-8 flex-1 rounded-md text-xs font-semibold transition', timeframe === item ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900')}>
                  {item}
                </button>
              ))}
            </div>
            <Button onClick={runSegmentation} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Segment
            </Button>
          </div>
        </header>

        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="space-y-4">
            {error ? (
              <Card className="border-rose-200 bg-rose-50">
                <CardContent className="flex items-center gap-2 p-4 text-sm font-semibold text-rose-700">
                  <AlertTriangle className="h-4 w-4" /> {error}
                </CardContent>
              </Card>
            ) : null}

            <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-200">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Blocks className="h-5 w-5 text-blue-600" /> Chart Preview With Colored Segmentation Overlays
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ChartPreview report={report} selectedId={selected?.id ?? ''} onSelect={setSelectedId} />
              </CardContent>
            </Card>

            <div className="grid gap-3 md:grid-cols-4">
              {phaseCounts.map(([type, count]) => (
                <PhaseCard key={type} type={type} count={count} tone={toneForType(type)} />
              ))}
              {!phaseCounts.length ? <PhaseCard type="Awaiting segmentation" count={0} tone="slate" /> : null}
            </div>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-200">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-5 w-5 text-purple-600" /> AI Segment Explanation
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <p className="text-sm leading-6 text-slate-600">{report?.explanation ?? 'No segmentation explanation generated yet.'}</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-200">
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-5 w-5 text-emerald-600" /> Segment Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="flex min-h-20 items-stretch gap-1 overflow-x-auto">
                  {(report?.segments ?? []).map((segment) => (
                    <button
                      key={segment.id}
                      type="button"
                      onClick={() => setSelectedId(segment.id)}
                      className={cn('min-w-32 rounded-lg border p-3 text-left text-xs transition', toneBorder(toneForType(segment.segmentType)), toneBg(toneForType(segment.segmentType)), selected?.id === segment.id && 'ring-2 ring-blue-500')}
                    >
                      <p className="font-semibold text-slate-950">{segment.segmentType}</p>
                      <p className="mt-1 font-mono text-slate-600">{segment.startCandleIndex}-{segment.endCandleIndex}</p>
                    </button>
                  ))}
                  {!report?.segments.length ? <p className="text-sm text-slate-500">No segment timeline available.</p> : null}
                </div>
              </CardContent>
            </Card>
          </section>

          <aside className="space-y-4">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers3 className="h-5 w-5 text-blue-600" /> Segment List Panel
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[330px] pr-3">
                  <div className="space-y-2">
                    {(report?.segments ?? []).map((segment) => (
                      <button key={segment.id} type="button" onClick={() => setSelectedId(segment.id)} className={cn('w-full rounded-lg border p-3 text-left transition', selected?.id === segment.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-50')}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-950">{segment.segmentType}</p>
                          <span className="font-mono text-xs text-blue-700">{Math.round(segment.confidenceScore * 100)}%</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">Candles {segment.startCandleIndex}-{segment.endCandleIndex}</p>
                      </button>
                    ))}
                    {!report?.segments.length ? <p className="text-sm text-slate-500">No segments available yet.</p> : null}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <SelectedSegmentCard segment={selected} />

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Target className="h-5 w-5 text-orange-600" /> Segment Type Legend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {legend.map((item) => (
                    <div key={item} className={cn('rounded-md border px-2 py-2 text-xs font-semibold', toneBorder(toneForType(item)), toneBg(toneForType(item)), toneText(toneForType(item)))}>
                      {item}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}

function ChartPreview({ report, selectedId, onSelect }: { report: SegmentationReport | null; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="relative min-h-[460px] overflow-hidden bg-slate-100">
      {report?.capture.imageUrl ? <img src={report.capture.imageUrl} alt="Segmented chart" className="h-full min-h-[460px] w-full object-cover" /> : (
        <div className="flex min-h-[460px] items-center justify-center text-sm font-mono text-slate-400">No segmented chart capture available</div>
      )}
      {(report?.segments ?? []).map((segment, index) => {
        const width = 100 / Math.max(1, report?.segments.length ?? 1);
        const left = index * width;
        return (
          <button
            key={segment.id}
            type="button"
            onClick={() => onSelect(segment.id)}
            className={cn('absolute inset-y-0 border-x px-2 text-left transition hover:bg-white/20', selectedId === segment.id ? 'bg-white/35 ring-2 ring-blue-500' : overlayBg(toneForType(segment.segmentType)))}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            <span className="absolute bottom-3 left-2 right-2 rounded-md bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-900 shadow-sm">{segment.segmentType}</span>
          </button>
        );
      })}
    </div>
  );
}

function SelectedSegmentCard({ segment }: { segment: Segment | null }) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BrainCircuit className="h-5 w-5 text-purple-600" /> Selected Segment Detail
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="font-mono text-2xl font-semibold text-slate-950">{segment?.segmentType ?? '--'}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">{segment?.marketMeaning ?? 'Select a segment to inspect market meaning.'}</p>
        </div>
        <Meter label="Segment confidence" value={(segment?.confidenceScore ?? 0) * 100} tone={toneForType(segment?.segmentType)} />
        <Detail label="Price range" value={segment ? `${segment.priceLow.toFixed(2)} - ${segment.priceHigh.toFixed(2)}` : '--'} />
        <Detail label="Volatility regime" value={segment?.volatilityRegime ?? '--'} />
        <Detail label="Structure regime" value={segment?.structureRegime ?? '--'} />
        <Detail label="Institutional interpretation" value={segment?.institutionalInterpretation ?? '--'} />
        <Detail label="Trading relevance" value={segment?.tradingRelevance ?? '--'} />
      </CardContent>
    </Card>
  );
}

function PhaseCard(props: { type: string; count: number; tone: Tone }) {
  return (
    <Card className={cn('border shadow-sm', toneBorder(props.tone), toneBg(props.tone))}>
      <CardContent className="p-4">
        <p className="text-xs font-semibold text-slate-600">{props.type}</p>
        <p className={cn('mt-2 font-mono text-3xl font-semibold', toneText(props.tone))}>{props.count}</p>
      </CardContent>
    </Card>
  );
}

function Meter(props: { label: string; value: number; tone: Tone }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-600">{props.label}</span>
        <span className={cn('font-mono font-semibold', toneText(props.tone))}>{Math.round(props.value)}%</span>
      </div>
      <Progress value={props.value} className="h-2 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600" />
    </div>
  );
}

function Detail(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{props.label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{props.value}</p>
    </div>
  );
}

function HeaderChip(props: { icon: LucideIcon; label: string; value: string; tone: Tone }) {
  const Icon = props.icon;
  return (
    <div className={cn('rounded-lg border px-3 py-2 shadow-sm', toneBorder(props.tone), toneBg(props.tone))}>
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

function toneForType(type?: string): Tone {
  if (!type) return 'slate';
  if (type.includes('Accumulation') || type.includes('Trend')) return 'emerald';
  if (type.includes('Manipulation') || type.includes('Liquidity')) return 'purple';
  if (type.includes('Expansion') || type.includes('Breakout')) return 'blue';
  if (type.includes('Distribution') || type.includes('Reversal')) return 'rose';
  if (type.includes('Compression') || type.includes('Pullback') || type.includes('Retest')) return 'amber';
  return 'orange';
}

function overlayBg(tone: Tone) {
  return {
    blue: 'bg-blue-500/18',
    emerald: 'bg-emerald-500/18',
    orange: 'bg-orange-500/18',
    purple: 'bg-purple-500/18',
    rose: 'bg-rose-500/18',
    slate: 'bg-slate-500/18',
    amber: 'bg-amber-500/18',
  }[tone];
}

function toneBorder(tone: Tone) {
  return {
    blue: 'border-blue-200',
    emerald: 'border-emerald-200',
    orange: 'border-orange-200',
    purple: 'border-purple-200',
    rose: 'border-rose-200',
    slate: 'border-slate-200',
    amber: 'border-amber-200',
  }[tone];
}

function toneBg(tone: Tone) {
  return {
    blue: 'bg-blue-50',
    emerald: 'bg-emerald-50',
    orange: 'bg-orange-50',
    purple: 'bg-purple-50',
    rose: 'bg-rose-50',
    slate: 'bg-slate-50',
    amber: 'bg-amber-50',
  }[tone];
}

function toneText(tone: Tone) {
  return {
    blue: 'text-blue-700',
    emerald: 'text-emerald-700',
    orange: 'text-orange-700',
    purple: 'text-purple-700',
    rose: 'text-rose-700',
    slate: 'text-slate-700',
    amber: 'text-amber-700',
  }[tone];
}
