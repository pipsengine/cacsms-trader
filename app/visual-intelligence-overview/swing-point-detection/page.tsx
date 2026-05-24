'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  BarChart3,
  Bot,
  BrainCircuit,
  Cpu,
  Gauge,
  GitBranch,
  Layers3,
  LineChart,
  Menu,
  Network,
  Radar,
  Radio,
  Route,
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
  { label: 'Pair/Symbol', value: 'XAUUSD swing map', tone: 'navy' as Tone },
  { label: 'Market Status', value: 'Structure live', tone: 'emerald' as Tone },
  { label: 'AI Confidence', value: '93.1%', tone: 'blue' as Tone },
  { label: 'Trend Direction', value: 'Higher-low sequence', tone: 'emerald' as Tone },
  { label: 'Volatility', value: 'Impulse cooling', tone: 'orange' as Tone },
  { label: 'Session State', value: 'NY continuation', tone: 'purple' as Tone },
  { label: 'Processing', value: '148 pivots', tone: 'blue' as Tone },
  { label: 'Institutional', value: 'Demand defended', tone: 'emerald' as Tone },
  { label: 'Retail', value: 'Sweep vulnerable', tone: 'orange' as Tone },
  { label: 'AI Decision', value: 'Map / confirm', tone: 'purple' as Tone },
];

const workflowStages = [
  { label: 'Swing high detection', model: 'Fractal pivot vision model', progress: 96, confidence: 94, tone: 'blue' as Tone },
  { label: 'Swing low detection', model: 'OpenCV trough extractor', progress: 93, confidence: 92, tone: 'emerald' as Tone },
  { label: 'Major pivot ranking', model: 'Quant structure scorer', progress: 88, confidence: 89, tone: 'purple' as Tone },
  { label: 'Liquidity sweep scan', model: 'Smart money wick analyzer', progress: 84, confidence: 86, tone: 'orange' as Tone },
  { label: 'Structural shift logic', model: 'BOS / CHOCH sequence agent', progress: 80, confidence: 83, tone: 'rose' as Tone },
  { label: 'MTF structure sync', model: 'Temporal pivot transformer', progress: 76, confidence: 81, tone: 'slate' as Tone },
];

const pivotFamilies = [
  { label: 'Swing highs', count: 42, confidence: 95, tone: 'rose' as Tone },
  { label: 'Swing lows', count: 39, confidence: 94, tone: 'emerald' as Tone },
  { label: 'Major pivots', count: 14, confidence: 90, tone: 'purple' as Tone },
  { label: 'Minor pivots', count: 73, confidence: 86, tone: 'blue' as Tone },
  { label: 'Liquidity sweeps', count: 11, confidence: 88, tone: 'orange' as Tone },
  { label: 'Turning points', count: 8, confidence: 82, tone: 'emerald' as Tone },
  { label: 'Structural shifts', count: 6, confidence: 84, tone: 'navy' as Tone },
  { label: 'Breakout pivots', count: 9, confidence: 81, tone: 'blue' as Tone },
  { label: 'False break pivots', count: 5, confidence: 77, tone: 'rose' as Tone },
];

const structureSeries = [
  { t: '09:00', price: 2326, strength: 44, liquidity: 36 },
  { t: '09:15', price: 2338, strength: 58, liquidity: 42 },
  { t: '09:30', price: 2329, strength: 49, liquidity: 61 },
  { t: '09:45', price: 2346, strength: 67, liquidity: 54 },
  { t: '10:00', price: 2339, strength: 63, liquidity: 69 },
  { t: '10:15', price: 2354, strength: 78, liquidity: 66 },
  { t: '10:30', price: 2348, strength: 73, liquidity: 82 },
  { t: '10:45', price: 2362, strength: 88, liquidity: 76 },
  { t: '11:00', price: 2356, strength: 81, liquidity: 91 },
  { t: '11:15', price: 2368, strength: 93, liquidity: 84 },
];

const pivotPoints = [
  { label: 'SH', x: '17%', y: '27%', tone: 'rose' as Tone, strength: 88 },
  { label: 'SL', x: '27%', y: '66%', tone: 'emerald' as Tone, strength: 82 },
  { label: 'HH', x: '42%', y: '21%', tone: 'blue' as Tone, strength: 91 },
  { label: 'HL', x: '55%', y: '59%', tone: 'emerald' as Tone, strength: 86 },
  { label: 'BOS', x: '72%', y: '24%', tone: 'purple' as Tone, strength: 84 },
  { label: 'Sweep', x: '84%', y: '70%', tone: 'orange' as Tone, strength: 78 },
];

const heatmapCells = [
  91, 85, 73, 64, 52, 46,
  82, 89, 77, 68, 57, 49,
  71, 76, 88, 94, 73, 55,
  62, 70, 81, 87, 92, 69,
  54, 63, 74, 83, 90, 78,
];

const mtfRows = [
  { tf: 'M1', state: 'minor pivots rising', score: 84, tone: 'blue' as Tone },
  { tf: 'M5', state: 'higher-low defended', score: 93, tone: 'emerald' as Tone },
  { tf: 'M15', state: 'sweep into demand', score: 86, tone: 'orange' as Tone },
  { tf: 'H1', state: 'bullish structural bias', score: 88, tone: 'purple' as Tone },
];

const reasoningRows = [
  { label: 'Institutional defense', value: 91, detail: 'Higher low formed after liquidity draw into prior demand.', tone: 'emerald' as Tone },
  { label: 'False breakout risk', value: 39, detail: 'Breakout pivot needs body close above swing high.', tone: 'orange' as Tone },
  { label: 'Market turning point', value: 72, detail: 'Momentum shift is visible, but major pivot requires confirmation.', tone: 'purple' as Tone },
  { label: 'Liquidity attraction', value: 86, detail: 'Nearest buy-side liquidity rests above the active swing high.', tone: 'blue' as Tone },
];

const performanceRows = [
  { label: 'Pivot precision', value: 93, color: '#2563eb' },
  { label: 'Sweep recall', value: 87, color: '#f97316' },
  { label: 'BOS agreement', value: 84, color: '#7c3aed' },
  { label: 'False break filter', value: 79, color: '#e11d48' },
  { label: 'MTF sync', value: 91, color: '#10b981' },
];

const consoleEvents = [
  { time: '04:34:18', type: 'PIVOT', message: 'Major swing high confirmed at 2368.20 with 91% structural strength', tone: 'blue' as Tone },
  { time: '04:34:15', type: 'SWEEP', message: 'Liquidity sweep detected below minor low before higher-low recovery', tone: 'orange' as Tone },
  { time: '04:34:11', type: 'BOS', message: 'Break of structure candidate waiting for M5 body close confirmation', tone: 'purple' as Tone },
  { time: '04:34:08', type: 'MTF', message: 'M1/M5/M15 pivots synchronized with H1 bullish structure map', tone: 'emerald' as Tone },
  { time: '04:34:04', type: 'FALSE', message: 'False breakout pivot risk reduced after demand zone defended', tone: 'rose' as Tone },
  { time: '04:34:01', type: 'NARR', message: 'AI narrative updated: institutional higher-low defense remains active', tone: 'navy' as Tone },
];

export default function SwingPointDetectionPage() {
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
      pivots: Math.round(148 + wave * 9),
      gpu: Math.round(70 + Math.abs(wave) * 9),
      latency: Math.round(21 + Math.abs(Math.cos(pulse / 9)) * 5),
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
                <h1 className="truncate text-lg font-semibold text-slate-950 md:text-xl">Swing Point Detection</h1>
                <p className="truncate text-xs font-mono text-blue-700">Dynamic pivots, liquidity sweeps, structural shifts and institutional market-turn reasoning</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 xl:flex">
              <HeaderChip icon={Radio} label="Stream" value={`${live.pivots} pivots`} tone="emerald" />
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
            <SwingWorkflowSidebar confidence={live.confidence} />
            <SwingWorkspace />
            <SwingIntelligencePanel />
          </div>
          <SwingConsole />
        </main>
      </div>
    </div>
  );
}

function SwingWorkflowSidebar(props: { confidence: number }) {
  return (
    <aside className="border-r border-slate-200 bg-white/90">
      <div className="space-y-4 p-4">
        <SectionTitle icon={GitBranch} title="Swing AI Pipeline" detail="Pivot detection, sweep analysis and structure synchronization" />

        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="AI confidence" value={`${props.confidence}%`} tone="blue" />
          <MetricCard label="Pivot classes" value="9" tone="emerald" />
        </div>

        <div className="space-y-2">
          {workflowStages.map((stage, index) => (
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

        <Card className="border-emerald-200 bg-emerald-50 shadow-sm shadow-slate-900/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
              <Sparkles className="h-4 w-4" />
              Smart Money Structure
            </div>
            <p className="mt-2 text-xs leading-5 text-emerald-900">
              The engine weighs pivot strength by reaction speed, liquidity draw, displacement quality and multi-timeframe agreement.
            </p>
          </CardContent>
        </Card>
      </div>
    </aside>
  );
}

function SwingWorkspace() {
  return (
    <section className="bg-slate-50 p-4 md:p-5">
      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <OverviewStat icon={Route} label="Mapped pivots" value="148" detail="Major and minor structures" tone="blue" />
          <OverviewStat icon={TrendingUp} label="Swing strength" value="93%" detail="Active higher-low sequence" tone="emerald" />
          <OverviewStat icon={TrendingDown} label="Sweep pressure" value="86%" detail="Liquidity attraction above" tone="orange" />
          <OverviewStat icon={ShieldCheck} label="Structural shift" value="BOS watch" detail="M5 close required" tone="purple" />
        </div>

        <Card className="overflow-hidden border-slate-200 bg-white shadow-lg shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Layers3 className="h-4 w-4 text-blue-700" />
                Visual Pivot Overlays
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <SmallPill label="Swing highs" tone="rose" />
                <SmallPill label="Swing lows" tone="emerald" />
                <SmallPill label="BOS / CHOCH" tone="purple" />
                <SmallPill label="Sweep zones" tone="orange" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-0 p-0 min-[1700px]:grid-cols-[minmax(0,1fr)_340px]">
            <div className="relative min-h-[520px] border-b border-slate-200 bg-white p-4 min-[1700px]:border-b-0 min-[1700px]:border-r">
              <div className="absolute inset-4 rounded-lg border border-slate-200 bg-[linear-gradient(to_right,rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.14)_1px,transparent_1px)] bg-[size:58px_42px]" />
              <div className="relative h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={structureSeries} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="swingPriceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[2320, 2374]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                    <Area type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={2.5} fill="url(#swingPriceGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
                {pivotPoints.map((point) => (
                  <PivotBadge key={point.label} {...point} />
                ))}
                <StructureLabel label="Buy-side liquidity" tone="orange" className="left-[67%] top-[12%] w-[24%]" />
                <StructureLabel label="Demand defended" tone="emerald" className="left-[35%] top-[66%] w-[30%]" />
                <StructureLabel label="BOS trigger" tone="purple" className="left-[58%] top-[38%] w-[24%]" />
              </div>

              <div className="relative mt-4 grid grid-cols-1 gap-2 md:grid-cols-4">
                {reasoningRows.map((row) => (
                  <div key={row.label} className={cn('rounded-lg border p-3', toneBorder(row.tone), toneBg(row.tone))}>
                    <div className="text-[11px] text-slate-600">{row.label}</div>
                    <div className="mt-1 font-mono text-2xl font-semibold text-slate-950">{row.value}%</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{row.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 p-4">
              <SectionTitle icon={Target} title="AI Confidence Ranking" detail="Pivot families, counts and strength scores" compact />
              <div className="grid gap-2 md:grid-cols-2 min-[1700px]:grid-cols-1">
                {pivotFamilies.map((pivot) => (
                  <ClassifierRow key={pivot.label} {...pivot} />
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
                Pivot Clustering and Liquidity Map
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-6 gap-1">
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
                <LegendItem tone="emerald" label="Strong pivot" />
                <LegendItem tone="orange" label="Liquidity draw" />
                <LegendItem tone="purple" label="Structure shift" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <LineChart className="h-4 w-4 text-blue-700" />
                Structural Trend Intelligence
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[285px] p-4">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsLineChart data={structureSeries} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[20, 100]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                  <Line type="monotone" dataKey="strength" stroke="#10b981" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="liquidity" stroke="#f97316" strokeWidth={2} dot={false} />
                </RechartsLineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function SwingIntelligencePanel() {
  return (
    <aside className="border-t border-slate-200 bg-white xl:col-span-2 min-[2200px]:col-span-1 min-[2200px]:border-l min-[2200px]:border-t-0">
      <div className="space-y-4 p-4">
        <SectionTitle icon={Bot} title="Structure Intelligence" detail="Institutional reasoning, narrative and multi-timeframe structure map" />

        <Card className="border-blue-200 bg-blue-50 shadow-sm shadow-slate-900/5">
          <CardHeader className="px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-blue-950">
              <BrainCircuit className="h-4 w-4" />
              AI-Generated Market Narrative
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="font-mono text-2xl font-semibold text-blue-950">Higher-Low Defense</div>
            <p className="mt-2 text-sm leading-6 text-blue-900">
              Smart money appears to be defending demand after sweeping minor lows. The next decision point is a body close above the active swing high.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="Swing strength" value="93%" tone="emerald" />
          <MetricCard label="Liquidity draw" value="86%" tone="orange" />
          <MetricCard label="BOS probability" value="72%" tone="purple" />
          <MetricCard label="False break risk" value="39%" tone="rose" />
        </div>

        <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Network className="h-4 w-4 text-purple-700" />
              Multi-Timeframe Structure Mapping
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {mtfRows.map((item) => (
              <div key={item.tf} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-900">{item.tf}</span>
                  <span className={cn('font-mono text-xs', toneText(item.tone))}>{item.score}%</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{item.state}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <BarChart3 className="h-4 w-4 text-orange-600" />
              Structure Model Quality
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[210px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={performanceRows} layout="vertical" margin={{ top: 6, right: 16, left: 90, bottom: 6 }}>
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis dataKey="label" type="category" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} width={88} />
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
      </div>
    </aside>
  );
}

function SwingConsole() {
  return (
    <section className="border-t border-slate-200 bg-slate-950 text-slate-100">
      <div className="grid min-h-[260px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-h-0 border-b border-slate-800 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="h-4 w-4 text-emerald-300" />
              Swing Point Detection Console
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
              <LiveDot tone="emerald" />
              pivots / liquidity sweeps / structural shifts / narrative stream
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
            <ConsoleStat label="Pivot classes" value="9" tone="blue" />
            <ConsoleStat label="Mapped pivots" value="148" tone="emerald" />
            <ConsoleStat label="Shift p95" value="21ms" tone="purple" />
            <ConsoleStat label="Sweep alerts" value="11" tone="orange" />
          </div>
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="text-xs font-semibold text-slate-100">Institutional structure engine</div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Pivot mapping combines swing geometry, liquidity attraction, false breakout filtering and multi-timeframe structure reasoning.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function PivotBadge(props: { label: string; x: string; y: string; tone: Tone; strength: number }) {
  return (
    <motion.div
      className={cn('absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white px-2 py-1 text-center shadow-md shadow-slate-900/10', toneBorder(props.tone))}
      style={{ left: props.x, top: props.y }}
      animate={{ scale: [1, 1.05, 1] }}
      transition={{ duration: 2, repeat: Infinity }}
    >
      <div className={cn('font-mono text-xs font-bold', toneText(props.tone))}>{props.label}</div>
      <div className="font-mono text-[10px] text-slate-500">{props.strength}%</div>
    </motion.div>
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

function StructureLabel(props: { label: string; tone: Tone; className: string }) {
  return (
    <motion.div
      className={cn('absolute rounded-md border px-2 py-1 text-[11px] font-semibold shadow-sm backdrop-blur', toneBorder(props.tone), toneBg(props.tone), toneText(props.tone), props.className)}
      animate={{ opacity: [0.72, 1, 0.72] }}
      transition={{ duration: 2, repeat: Infinity }}
    >
      {props.label}
    </motion.div>
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
