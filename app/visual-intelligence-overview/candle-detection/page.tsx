'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  BarChart3,
  Bot,
  BrainCircuit,
  CandlestickChart,
  Cpu,
  Flame,
  Gauge,
  GitBranch,
  Layers3,
  LineChart,
  Menu,
  Network,
  Radar,
  Radio,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { TraderSidebar } from '@/components/trader-sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type Tone = 'navy' | 'blue' | 'purple' | 'emerald' | 'orange' | 'rose' | 'slate';

const headerSignals = [
  { label: 'Pair/Symbol', value: 'XAUUSD candle stream', tone: 'navy' as Tone },
  { label: 'Market Status', value: 'Live detection', tone: 'emerald' as Tone },
  { label: 'AI Confidence', value: '92.8%', tone: 'blue' as Tone },
  { label: 'Trend Direction', value: 'Impulse bullish', tone: 'emerald' as Tone },
  { label: 'Volatility', value: 'Expansion', tone: 'orange' as Tone },
  { label: 'Session State', value: 'NY overlap', tone: 'purple' as Tone },
  { label: 'Processing', value: '312 candles/s', tone: 'blue' as Tone },
  { label: 'Institutional', value: 'Absorption seen', tone: 'emerald' as Tone },
  { label: 'Retail', value: 'Late breakout buys', tone: 'orange' as Tone },
  { label: 'AI Decision', value: 'Classify / wait', tone: 'purple' as Tone },
];

const detectionStages = [
  { label: 'Candle body extraction', model: 'OpenCV contour detector', progress: 97, confidence: 96, tone: 'blue' as Tone },
  { label: 'Wick geometry analysis', model: 'CNN wick/body classifier', progress: 92, confidence: 91, tone: 'emerald' as Tone },
  { label: 'Pattern classification', model: 'ViT candle pattern head', progress: 88, confidence: 89, tone: 'purple' as Tone },
  { label: 'Sequence reasoning', model: 'Temporal transformer', progress: 83, confidence: 86, tone: 'orange' as Tone },
  { label: 'Intent detection', model: 'Institutional footprint agent', progress: 79, confidence: 82, tone: 'emerald' as Tone },
  { label: 'RL validation', model: 'Reinforcement safety policy', progress: 72, confidence: 77, tone: 'slate' as Tone },
];

const candleTypes = [
  { label: 'Bullish candles', count: 186, confidence: 95, tone: 'emerald' as Tone },
  { label: 'Bearish candles', count: 142, confidence: 91, tone: 'rose' as Tone },
  { label: 'Doji', count: 37, confidence: 84, tone: 'slate' as Tone },
  { label: 'Hammer', count: 22, confidence: 88, tone: 'blue' as Tone },
  { label: 'Shooting star', count: 18, confidence: 82, tone: 'orange' as Tone },
  { label: 'Engulfing', count: 31, confidence: 90, tone: 'purple' as Tone },
  { label: 'Pin bars', count: 44, confidence: 87, tone: 'blue' as Tone },
  { label: 'Marubozu', count: 16, confidence: 81, tone: 'emerald' as Tone },
  { label: 'Inside bars', count: 28, confidence: 85, tone: 'slate' as Tone },
  { label: 'Outside bars', count: 21, confidence: 83, tone: 'orange' as Tone },
  { label: 'Institutional candles', count: 12, confidence: 92, tone: 'emerald' as Tone },
  { label: 'Manipulation candles', count: 9, confidence: 78, tone: 'rose' as Tone },
];

const candleSeries = [
  { t: '10:00', price: 2342, momentum: 58, volatility: 43 },
  { t: '10:05', price: 2345, momentum: 63, volatility: 48 },
  { t: '10:10', price: 2341, momentum: 52, volatility: 55 },
  { t: '10:15', price: 2349, momentum: 69, volatility: 61 },
  { t: '10:20', price: 2354, momentum: 76, volatility: 66 },
  { t: '10:25', price: 2351, momentum: 71, volatility: 72 },
  { t: '10:30', price: 2359, momentum: 84, volatility: 78 },
  { t: '10:35', price: 2363, momentum: 89, volatility: 82 },
  { t: '10:40', price: 2358, momentum: 78, volatility: 85 },
  { t: '10:45', price: 2367, momentum: 93, volatility: 88 },
];

const candleBars = [
  { open: 2340, close: 2346, high: 2349, low: 2338, type: 'bullish', confidence: 94 },
  { open: 2346, close: 2342, high: 2348, low: 2340, type: 'bearish', confidence: 88 },
  { open: 2342, close: 2343, high: 2351, low: 2337, type: 'doji', confidence: 82 },
  { open: 2343, close: 2353, high: 2355, low: 2341, type: 'engulfing', confidence: 91 },
  { open: 2353, close: 2359, high: 2362, low: 2351, type: 'institutional', confidence: 93 },
  { open: 2359, close: 2356, high: 2366, low: 2354, type: 'shooting star', confidence: 84 },
  { open: 2356, close: 2364, high: 2367, low: 2353, type: 'liquidity', confidence: 89 },
  { open: 2364, close: 2361, high: 2365, low: 2355, type: 'pin bar', confidence: 86 },
  { open: 2361, close: 2370, high: 2372, low: 2360, type: 'marubozu', confidence: 90 },
  { open: 2370, close: 2363, high: 2374, low: 2358, type: 'manipulation', confidence: 79 },
];

const heatmapCells = [
  93, 87, 72, 61, 55, 44, 36,
  82, 91, 78, 64, 58, 49, 41,
  74, 69, 88, 92, 73, 56, 47,
  62, 71, 84, 96, 89, 67, 52,
  57, 64, 76, 83, 94, 81, 63,
];

const sequenceEvents = [
  { label: 'Impulse continuation', value: 93, detail: 'Marubozu after engulfing confirms aggressive participation.', tone: 'emerald' as Tone },
  { label: 'Liquidity sweep risk', value: 78, detail: 'Upper wick expansion suggests stop-run near local highs.', tone: 'orange' as Tone },
  { label: 'Retail trap probability', value: 41, detail: 'Late breakout chasing increased after large bullish body.', tone: 'rose' as Tone },
  { label: 'Institutional absorption', value: 86, detail: 'Bearish response was shallow into prior demand candle.', tone: 'purple' as Tone },
];

const mtfSync = [
  { tf: 'M1', state: 'micro impulse', score: 88, tone: 'blue' as Tone },
  { tf: 'M5', state: 'bullish sequence', score: 93, tone: 'emerald' as Tone },
  { tf: 'M15', state: 'liquidity sweep', score: 81, tone: 'orange' as Tone },
  { tf: 'H1', state: 'institutional demand', score: 84, tone: 'purple' as Tone },
];

const performanceRows = [
  { label: 'CNN candle precision', value: 94, color: '#2563eb' },
  { label: 'Pattern recall', value: 89, color: '#10b981' },
  { label: 'Sequence agreement', value: 86, color: '#7c3aed' },
  { label: 'Manipulation filter', value: 78, color: '#f97316' },
  { label: 'RL validation', value: 74, color: '#0f172a' },
];

const consoleEvents = [
  { time: '21:45:18', type: 'CNN', message: 'Detected institutional bullish candle with 93% confidence on XAUUSD M5', tone: 'emerald' as Tone },
  { time: '21:45:16', type: 'SEQ', message: 'Temporal model promoted engulfing-plus-marubozu continuation sequence', tone: 'purple' as Tone },
  { time: '21:45:13', type: 'OPENCV', message: 'Wick/body segmentation completed across 312 candles per second', tone: 'blue' as Tone },
  { time: '21:45:10', type: 'INTENT', message: 'Manipulation candle probability rose near buy-side liquidity pocket', tone: 'orange' as Tone },
  { time: '21:45:07', type: 'RL', message: 'Reinforcement policy rejected immediate entry due to sweep risk', tone: 'rose' as Tone },
  { time: '21:45:04', type: 'MTF', message: 'M1/M5/M15 candle synchronization aligned to H1 demand context', tone: 'navy' as Tone },
];

export default function CandleDetectionPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [now, setNow] = useState('');
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const tick = () => {
      setNow(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date()));
      setPulse((value) => (value + 1) % 100);
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const live = useMemo(() => {
    const wave = Math.sin(pulse / 8);
    return {
      candles: Math.round(312 + wave * 28),
      gpu: Math.round(68 + Math.abs(wave) * 11),
      latency: Math.round(18 + Math.abs(Math.cos(pulse / 9)) * 6),
      confidence: Math.round(92 + Math.sin(pulse / 10) * 3),
    };
  }, [pulse]);

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-950 font-sans">
      <TraderSidebar bridgeOnline mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen} />

      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="shrink-0 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm shadow-slate-900/5 backdrop-blur md:px-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="Open navigation"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 lg:hidden"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold text-slate-950 md:text-xl">Candle Detection</h1>
                <p className="truncate text-xs font-mono text-blue-700">CNN candle classification, psychology reading, temporal reasoning and institutional footprint detection</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 xl:flex">
              <HeaderChip icon={Radio} label="Stream" value={`${live.candles} candles/s`} tone="emerald" />
              <HeaderChip icon={Cpu} label="GPU" value={`${live.gpu}% active`} tone="purple" />
              <HeaderChip icon={Gauge} label="Latency" value={`${live.latency}ms p95`} tone="orange" />
              <HeaderChip icon={Activity} label="WAT" value={now || '--:--:--'} tone="navy" />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5 xl:grid-cols-10">
            {headerSignals.map((signal) => (
              <SignalTile key={signal.label} {...signal} />
            ))}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
          <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)] min-[2200px]:grid-cols-[300px_minmax(0,1fr)_360px]">
            <CandleWorkflowSidebar confidence={live.confidence} />
            <CandleWorkspace />
            <CandleIntelligencePanel />
          </div>
          <CandleConsole />
        </main>
      </div>
    </div>
  );
}

function CandleWorkflowSidebar(props: { confidence: number }) {
  return (
    <aside className="min-h-0 border-r border-slate-200 bg-white/90 xl:overflow-hidden">
      <div className="space-y-4 p-4">
          <SectionTitle icon={GitBranch} title="Candle AI Pipeline" detail="Detection stages, active models and confidence state" />

          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="AI confidence" value={`${props.confidence}%`} tone="blue" />
            <MetricCard label="Pattern heads" value="13" tone="emerald" />
          </div>

          <div className="space-y-2">
            {detectionStages.map((stage, index) => (
              <motion.div
                key={stage.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm shadow-slate-900/5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">{stage.label}</div>
                    <div className="mt-1 text-[11px] font-mono text-slate-500">{stage.model}</div>
                  </div>
                  <LiveDot tone={stage.tone} />
                </div>
                <Progress value={stage.progress} className="mt-3 h-1.5 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600" />
                <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>{stage.progress}% processed</span>
                  <span className={toneText(stage.tone)}>{stage.confidence}% conf</span>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm shadow-slate-900/5">
            <SectionTitle icon={Network} title="MTF Synchronization" detail="Candle agreement across timeframes" compact />
            <div className="mt-3 space-y-2">
              {mtfSync.map((item) => (
                <div key={item.tf} className="rounded-md border border-slate-100 bg-slate-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">{item.tf}</span>
                    <span className={cn('font-mono text-xs', toneText(item.tone))}>{item.score}%</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">{item.state}</div>
                </div>
              ))}
            </div>
          </div>
      </div>
    </aside>
  );
}

function CandleWorkspace() {
  return (
    <section className="min-h-0 overflow-y-auto bg-slate-50 p-4 md:p-5">
      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <OverviewStat icon={CandlestickChart} label="Candles classified" value="628" detail="Last 2 minutes" tone="blue" />
          <OverviewStat icon={BrainCircuit} label="Psychology read" value="Bullish intent" detail="Momentum and wick analysis" tone="emerald" />
          <OverviewStat icon={Flame} label="Manipulation risk" value="38%" detail="Upper liquidity probe" tone="orange" />
          <OverviewStat icon={ShieldCheck} label="Institutional candles" value="12" detail="Absorption and displacement" tone="purple" />
        </div>

        <Card className="overflow-hidden border-slate-200 bg-white shadow-lg shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <ScanLine className="h-4 w-4 text-blue-700" />
                Real-Time Candle Overlays
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <SmallPill label="CNN body/wick" tone="blue" />
                <SmallPill label="OpenCV contours" tone="emerald" />
                <SmallPill label="Temporal AI" tone="purple" />
                <SmallPill label="RL guarded" tone="orange" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-0 p-0 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="relative min-h-[430px] border-b border-slate-200 bg-white p-4 xl:border-b-0 xl:border-r">
              <div className="absolute inset-4 rounded-lg border border-slate-200 bg-[linear-gradient(to_right,rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.14)_1px,transparent_1px)] bg-[size:46px_34px]" />
              <div className="relative flex h-[360px] items-end justify-between gap-3 px-6 pb-8 pt-6">
                {candleBars.map((candle, index) => (
                  <Candle key={`${candle.type}-${index}`} candle={candle} index={index} />
                ))}
              </div>
              <div className="relative grid grid-cols-2 gap-2 md:grid-cols-4">
                {sequenceEvents.map((event) => (
                  <div key={event.label} className={cn('rounded-lg border p-3', toneBorder(event.tone), toneBg(event.tone))}>
                    <div className="text-[11px] text-slate-600">{event.label}</div>
                    <div className="mt-1 font-mono text-xl font-semibold text-slate-950">{event.value}%</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 p-4">
              <SectionTitle icon={Layers3} title="Candle Classifiers" detail="Detected candle families and confidence" compact />
              <div className="grid grid-cols-1 gap-2">
                {candleTypes.slice(0, 8).map((type) => (
                  <ClassifierRow key={type.label} {...type} />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
          <Card className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Radar className="h-4 w-4 text-emerald-600" />
                Candle Heatmap and Clustering
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-7 gap-1">
                {heatmapCells.map((value, index) => (
                  <motion.div
                    key={`${value}-${index}`}
                    animate={{ opacity: [0.72, 1, 0.82] }}
                    transition={{ duration: 2.2, repeat: Infinity, delay: index * 0.025 }}
                    className={cn('grid aspect-square place-items-center rounded-md border text-[11px] font-mono', heatClass(value))}
                  >
                    {value}
                  </motion.div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-slate-600">
                <LegendItem tone="emerald" label="Institutional" />
                <LegendItem tone="orange" label="Manipulation" />
                <LegendItem tone="blue" label="Momentum" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <LineChart className="h-4 w-4 text-blue-700" />
                Candle Momentum Engine
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[285px] p-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={candleSeries} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="momentumGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[30, 100]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                  <Area type="monotone" dataKey="momentum" stroke="#2563eb" strokeWidth={2.5} fill="url(#momentumGradient)" />
                  <Line type="monotone" dataKey="volatility" stroke="#f97316" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function CandleIntelligencePanel() {
  return (
    <aside className="border-t border-slate-200 bg-white xl:col-span-2 min-[2200px]:col-span-1 min-[2200px]:border-l min-[2200px]:border-t-0">
      <div className="space-y-4 p-4">
          <SectionTitle icon={Bot} title="Candle Intelligence" detail="Psychology, intent, risk and recommendation layer" />

          <Card className="border-blue-200 bg-blue-50 shadow-sm shadow-slate-900/5">
            <CardHeader className="px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-blue-950">
                <Target className="h-4 w-4" />
                AI Candle Reading
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="font-mono text-2xl font-semibold text-blue-950">Bullish Intent, Guarded</div>
              <p className="mt-2 text-sm leading-6 text-blue-900">
                Large body displacement and shallow pullback show active buying, but upper wick expansion warns of liquidity engineering near local highs.
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="Momentum" value="93%" tone="emerald" />
            <MetricCard label="Volatility" value="88%" tone="orange" />
            <MetricCard label="Intent clarity" value="86%" tone="purple" />
            <MetricCard label="Manipulation" value="38%" tone="rose" />
          </div>

          <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <BrainCircuit className="h-4 w-4 text-purple-700" />
                Sequence Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {sequenceEvents.map((item) => (
                <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">{item.label}</span>
                    <span className={cn('font-mono text-xs', toneText(item.tone))}>{item.value}%</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{item.detail}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <BarChart3 className="h-4 w-4 text-orange-600" />
                Model Performance
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[210px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceRows} layout="vertical" margin={{ top: 6, right: 16, left: 94, bottom: 6 }}>
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis dataKey="label" type="category" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} width={92} />
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {performanceRows.map((entry) => (
                      <Cell key={entry.label} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-emerald-200 bg-emerald-50 shadow-sm shadow-slate-900/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
                <Sparkles className="h-4 w-4" />
                Institutional Activity Overlay
              </div>
              <p className="mt-2 text-xs leading-5 text-emerald-900">
                Displacement candle aligns with prior demand, volume proxy and shallow bearish response. AI marks this as possible institutional absorption.
              </p>
            </CardContent>
          </Card>
      </div>
    </aside>
  );
}

function CandleConsole() {
  return (
    <section className="border-t border-slate-200 bg-slate-950 text-slate-100">
      <div className="grid min-h-[260px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-h-0 border-b border-slate-800 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="h-4 w-4 text-emerald-300" />
              Candle Detection Console
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
              <LiveDot tone="emerald" />
              CNN / OpenCV / temporal reasoning / RL validation
            </div>
          </div>
          <ScrollArea className="h-[214px]">
            <div className="divide-y divide-slate-800">
              {consoleEvents.map((event) => (
                <div key={`${event.time}-${event.message}`} className="grid grid-cols-[76px_86px_minmax(0,1fr)] gap-3 px-4 py-2 text-xs">
                  <span className="font-mono text-slate-500">{event.time}</span>
                  <span className={cn('font-mono font-semibold', darkToneText(event.tone))}>{event.type}</span>
                  <span className="truncate text-slate-300">{event.message}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="min-h-0 p-3">
          <div className="grid grid-cols-4 gap-2 lg:grid-cols-2">
            <ConsoleStat label="CNN heads" value="13" tone="blue" />
            <ConsoleStat label="Candles/s" value="312" tone="emerald" />
            <ConsoleStat label="Temporal p95" value="18ms" tone="purple" />
            <ConsoleStat label="RL rejects" value="6" tone="orange" />
          </div>
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="text-xs font-semibold text-slate-100">AI candle cognition stack</div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              CNN vision, OpenCV geometry, sequence learning, temporal reasoning and reinforcement validation produce auditable candle psychology outputs.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Candle(props: { candle: (typeof candleBars)[number]; index: number }) {
  const range = 38;
  const high = ((2376 - props.candle.high) / range) * 280;
  const low = ((2376 - props.candle.low) / range) * 280;
  const open = ((2376 - props.candle.open) / range) * 280;
  const close = ((2376 - props.candle.close) / range) * 280;
  const top = Math.min(open, close);
  const height = Math.max(Math.abs(open - close), 8);
  const bullish = props.candle.close >= props.candle.open;
  const tone: Tone = props.candle.type === 'manipulation' ? 'rose' : props.candle.type === 'institutional' || props.candle.type === 'liquidity' ? 'emerald' : bullish ? 'blue' : 'orange';

  return (
    <div className="relative h-[300px] w-12 shrink-0">
      <div className="absolute left-1/2 w-px -translate-x-1/2 bg-slate-500" style={{ top: high, height: Math.max(low - high, 18) }} />
      <motion.div
        className={cn('absolute left-1/2 w-7 -translate-x-1/2 rounded-sm border shadow-sm', toneBorder(tone), bullish ? 'bg-emerald-500' : 'bg-orange-500')}
        style={{ top, height }}
        animate={{ opacity: [0.82, 1, 0.9] }}
        transition={{ duration: 1.8, repeat: Infinity, delay: props.index * 0.05 }}
      />
      <div className="absolute top-[305px] left-1/2 w-20 -translate-x-1/2 truncate text-center text-[10px] font-mono text-slate-500">{props.candle.type}</div>
      <div className={cn('absolute -top-2 left-1/2 -translate-x-1/2 rounded-md border bg-white px-1.5 py-0.5 text-[10px] font-mono shadow-sm', toneBorder(tone), toneText(tone))}>
        {props.candle.confidence}%
      </div>
    </div>
  );
}

function HeaderChip(props: { icon: LucideIcon; label: string; value: string; tone: Tone }) {
  const Icon = props.icon;
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5', toneBorder(props.tone), toneBg(props.tone))}>
      <Icon className={cn('h-4 w-4', toneText(props.tone))} />
      <div>
        <div className="text-[10px] text-slate-500">{props.label}</div>
        <div className="font-mono text-xs font-semibold text-slate-900">{props.value}</div>
      </div>
    </div>
  );
}

function SignalTile(props: { label: string; value: string; tone: Tone }) {
  return (
    <div className={cn('min-w-0 rounded-lg border px-2.5 py-2 shadow-sm shadow-slate-900/5', toneBorder(props.tone), toneBg(props.tone))}>
      <div className="truncate text-[10px] text-slate-500">{props.label}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <LiveDot tone={props.tone} />
        <span className="truncate font-mono text-[11px] font-semibold text-slate-950">{props.value}</span>
      </div>
    </div>
  );
}

function SectionTitle(props: { icon: LucideIcon; title: string; detail: string; compact?: boolean }) {
  const Icon = props.icon;
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
        <Icon className="h-4 w-4 text-blue-700" />
        {props.title}
      </div>
      <p className={cn('text-xs leading-5 text-slate-500', props.compact ? 'mt-0.5' : 'mt-1')}>{props.detail}</p>
    </div>
  );
}

function MetricCard(props: { label: string; value: string; tone: Tone }) {
  return (
    <div className={cn('rounded-lg border p-3 shadow-sm shadow-slate-900/5', toneBorder(props.tone), toneBg(props.tone))}>
      <div className="text-[11px] text-slate-500">{props.label}</div>
      <div className="mt-1 font-mono text-xl font-semibold text-slate-950">{props.value}</div>
    </div>
  );
}

function OverviewStat(props: { icon: LucideIcon; label: string; value: string; detail: string; tone: Tone }) {
  const Icon = props.icon;
  return (
    <Card className={cn('border shadow-lg shadow-slate-900/5', toneBorder(props.tone), toneBg(props.tone))}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-600">{props.label}</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-950">{props.value}</div>
          </div>
          <div className={cn('grid h-10 w-10 place-items-center rounded-lg border bg-white/70', toneBorder(props.tone))}>
            <Icon className={cn('h-5 w-5', toneText(props.tone))} />
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-500">{props.detail}</div>
      </CardContent>
    </Card>
  );
}

function SmallPill(props: { label: string; tone: Tone }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium', toneBorder(props.tone), toneBg(props.tone), toneText(props.tone))}>
      <LiveDot tone={props.tone} />
      {props.label}
    </span>
  );
}

function ClassifierRow(props: { label: string; count: number; confidence: number; tone: Tone }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-800">{props.label}</span>
        <span className={cn('font-mono text-xs', toneText(props.tone))}>{props.confidence}%</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Progress value={props.confidence} className="h-1.5 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600" />
        <span className="w-8 text-right font-mono text-xs text-slate-500">{props.count}</span>
      </div>
    </div>
  );
}

function LegendItem(props: { tone: Tone; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-2.5 w-2.5 rounded-full', toneDot(props.tone))} />
      <span className="truncate">{props.label}</span>
    </div>
  );
}

function ConsoleStat(props: { label: string; value: string; tone: Tone }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
      <div className="text-[10px] text-slate-500">{props.label}</div>
      <div className={cn('mt-1 font-mono text-lg font-semibold', darkToneText(props.tone))}>{props.value}</div>
    </div>
  );
}

function LiveDot(props: { tone: Tone }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      <motion.span
        className={cn('absolute inline-flex h-full w-full rounded-full opacity-50', toneDot(props.tone))}
        animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 1.8, repeat: Infinity }}
      />
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', toneDot(props.tone))} />
    </span>
  );
}

function heatClass(value: number): string {
  if (value >= 86) return 'border-emerald-300 bg-emerald-100 text-emerald-900';
  if (value >= 74) return 'border-blue-300 bg-blue-100 text-blue-900';
  if (value >= 62) return 'border-purple-300 bg-purple-100 text-purple-900';
  if (value >= 50) return 'border-orange-300 bg-orange-100 text-orange-900';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function toneBorder(tone: Tone): string {
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

function toneBg(tone: Tone): string {
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

function toneText(tone: Tone): string {
  return {
    navy: 'text-slate-800',
    blue: 'text-blue-700',
    purple: 'text-purple-700',
    emerald: 'text-emerald-700',
    orange: 'text-orange-700',
    rose: 'text-rose-700',
    slate: 'text-slate-600',
  }[tone];
}

function darkToneText(tone: Tone): string {
  return {
    navy: 'text-slate-300',
    blue: 'text-blue-300',
    purple: 'text-purple-300',
    emerald: 'text-emerald-300',
    orange: 'text-orange-300',
    rose: 'text-rose-300',
    slate: 'text-slate-400',
  }[tone];
}

function toneDot(tone: Tone): string {
  return {
    navy: 'bg-slate-700',
    blue: 'bg-blue-600',
    purple: 'bg-purple-600',
    emerald: 'bg-emerald-500',
    orange: 'bg-orange-500',
    rose: 'bg-rose-500',
    slate: 'bg-slate-500',
  }[tone];
}
