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
  LineChart as LineChartIcon,
  Menu,
  Network,
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
  LineChart,
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
  { label: 'Pair/Symbol', value: 'XAUUSD OB map', tone: 'navy' as Tone },
  { label: 'Market Status', value: 'Blocks live', tone: 'emerald' as Tone },
  { label: 'AI Confidence', value: '93.8%', tone: 'blue' as Tone },
  { label: 'Trend Direction', value: 'Bullish OB defended', tone: 'emerald' as Tone },
  { label: 'Volatility', value: 'Mitigation phase', tone: 'orange' as Tone },
  { label: 'Session State', value: 'NY smart money', tone: 'purple' as Tone },
  { label: 'Processing', value: '84 blocks/s', tone: 'blue' as Tone },
  { label: 'Institutional', value: 'Accumulation seen', tone: 'emerald' as Tone },
  { label: 'Retail', value: 'Breaker chase risk', tone: 'orange' as Tone },
  { label: 'AI Decision', value: 'Mitigate / hold', tone: 'purple' as Tone },
];

const workflowStages = [
  { label: 'Bullish order block scan', model: 'OpenCV displacement and origin detector', progress: 97, confidence: 95, tone: 'emerald' as Tone },
  { label: 'Bearish order block scan', model: 'Supply impulse CNN classifier', progress: 94, confidence: 92, tone: 'orange' as Tone },
  { label: 'Mitigation block logic', model: 'ICT mitigation sequence transformer', progress: 91, confidence: 90, tone: 'blue' as Tone },
  { label: 'Breaker block detection', model: 'Market structure invalidation agent', progress: 88, confidence: 87, tone: 'purple' as Tone },
  { label: 'Rejection block scoring', model: 'Wick rejection and absorption model', progress: 84, confidence: 86, tone: 'rose' as Tone },
  { label: 'Institutional positioning', model: 'Smart money accumulation engine', progress: 81, confidence: 84, tone: 'slate' as Tone },
];

const zoneFamilies = [
  { label: 'Bullish order blocks', count: 9, confidence: 95, tone: 'emerald' as Tone },
  { label: 'Bearish order blocks', count: 6, confidence: 92, tone: 'orange' as Tone },
  { label: 'Mitigation blocks', count: 7, confidence: 90, tone: 'blue' as Tone },
  { label: 'Breaker blocks', count: 4, confidence: 87, tone: 'purple' as Tone },
  { label: 'Rejection blocks', count: 5, confidence: 86, tone: 'rose' as Tone },
  { label: 'Positioning blocks', count: 8, confidence: 84, tone: 'navy' as Tone },
];

const reactionSeries = [
  { t: '09:00', price: 2330, bullishBlock: 2322, bearishBlock: 2368, mitigation: 38, liquidity: 35 },
  { t: '09:15', price: 2336, bullishBlock: 2324, bearishBlock: 2370, mitigation: 47, liquidity: 39 },
  { t: '09:30', price: 2341, bullishBlock: 2327, bearishBlock: 2372, mitigation: 58, liquidity: 44 },
  { t: '09:45', price: 2334, bullishBlock: 2329, bearishBlock: 2374, mitigation: 71, liquidity: 41 },
  { t: '10:00', price: 2348, bullishBlock: 2332, bearishBlock: 2376, mitigation: 78, liquidity: 49 },
  { t: '10:15', price: 2355, bullishBlock: 2335, bearishBlock: 2378, mitigation: 86, liquidity: 57 },
  { t: '10:30', price: 2350, bullishBlock: 2338, bearishBlock: 2380, mitigation: 91, liquidity: 61 },
  { t: '10:45', price: 2361, bullishBlock: 2341, bearishBlock: 2382, mitigation: 88, liquidity: 68 },
  { t: '11:00', price: 2368, bullishBlock: 2344, bearishBlock: 2384, mitigation: 82, liquidity: 74 },
  { t: '11:15', price: 2363, bullishBlock: 2347, bearishBlock: 2386, mitigation: 93, liquidity: 69 },
];

const zoneLabels = [
  { label: 'Bearish OB', x: '69%', y: '16%', tone: 'orange' as Tone, score: 92 },
  { label: 'Liquidity interaction', x: '86%', y: '40%', tone: 'rose' as Tone, score: 87 },
  { label: 'Mitigation block', x: '43%', y: '50%', tone: 'blue' as Tone, score: 90 },
  { label: 'Bullish OB', x: '38%', y: '72%', tone: 'emerald' as Tone, score: 95 },
];

const heatmapCells = [
  42, 54, 67, 79, 88, 94,
  49, 61, 73, 82, 91, 87,
  55, 68, 80, 89, 84, 76,
  64, 78, 91, 95, 86, 72,
  58, 71, 83, 90, 79, 66,
];

const scoringRows = [
  { label: 'Block quality', value: 95, detail: 'Bullish order block formed after displacement and defended mitigation.', tone: 'emerald' as Tone },
  { label: 'Mitigation probability', value: 82, detail: 'Price is likely to revisit the origin block before continuation.', tone: 'blue' as Tone },
  { label: 'Breaker risk', value: 39, detail: 'Bearish breaker risk stays contained until upper liquidity is swept.', tone: 'orange' as Tone },
  { label: 'Positioning quality', value: 91, detail: 'Institutional accumulation aligns with historical respect behavior.', tone: 'purple' as Tone },
];

const mtfRows = [
  { tf: 'M1', state: 'micro mitigation reaction active', score: 86, tone: 'blue' as Tone },
  { tf: 'M5', state: 'bullish order block defended', score: 95, tone: 'emerald' as Tone },
  { tf: 'M15', state: 'breaker block invalidation watched', score: 87, tone: 'purple' as Tone },
  { tf: 'H1', state: 'bearish supply block overhead', score: 88, tone: 'orange' as Tone },
];

const modelQuality = [
  { label: 'Block precision', value: 95, color: '#10b981' },
  { label: 'Mitigation recall', value: 82, color: '#2563eb' },
  { label: 'Breaker filter', value: 88, color: '#f97316' },
  { label: 'Liquidity mapping', value: 87, color: '#e11d48' },
  { label: 'Institutional logic', value: 91, color: '#7c3aed' },
];

const consoleEvents = [
  { time: '05:11:21', type: 'BULL_OB', message: 'Bullish order block confirmed at 2332-2338 with 95% quality score', tone: 'emerald' as Tone },
  { time: '05:11:17', type: 'BEAR_OB', message: 'Bearish supply block mapped above active price with 92% reaction density', tone: 'orange' as Tone },
  { time: '05:11:13', type: 'MITIGATE', message: 'Mitigation block detected after displacement and controlled retrace', tone: 'blue' as Tone },
  { time: '05:11:09', type: 'LIQUID', message: 'Liquidity interaction map shows buy-side pool above breaker threshold', tone: 'rose' as Tone },
  { time: '05:11:05', type: 'POSITION', message: 'Institutional positioning engine updated accumulation bias', tone: 'purple' as Tone },
  { time: '05:11:01', type: 'MODEL', message: 'Mitigation probability raised while breaker risk remains controlled', tone: 'navy' as Tone },
];

export default function OrderBlockDetectionPage() {
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
      blocks: Math.round(84 + wave * 10),
      gpu: Math.round(75 + Math.abs(wave) * 8),
      latency: Math.round(21 + Math.abs(Math.cos(pulse / 9)) * 6),
      confidence: Math.round(94 + Math.sin(pulse / 10) * 3),
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
                <h1 className="truncate text-lg font-semibold text-slate-950 md:text-xl">Order Block Detection</h1>
                <p className="truncate text-xs font-mono text-blue-700">Smart money order blocks, mitigation logic, breaker validation and institutional positioning intelligence</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 xl:flex">
              <HeaderChip icon={Radio} label="Stream" value={`${live.blocks} blocks/s`} tone="emerald" />
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
            <OrderBlockWorkflow confidence={live.confidence} />
            <OrderBlockWorkspace />
            <OrderBlockIntelligence />
          </div>
          <OrderBlockConsole />
        </main>
      </div>
    </div>
  );
}

function OrderBlockWorkflow(props: { confidence: number }) {
  return (
    <aside className="border-r border-slate-200 bg-white/90">
      <div className="space-y-4 p-4">
        <SectionTitle icon={GitBranch} title="Order Block AI Pipeline" detail="Block extraction, mitigation reasoning, liquidity interaction and positioning inference" />

        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="AI confidence" value={`${props.confidence}%`} tone="blue" />
          <MetricCard label="Block classes" value="7" tone="emerald" />
        </div>

        <div className="space-y-2">
          {workflowStages.map((stage, index) => (
            <motion.div
              key={stage.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.04 }}
              className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm shadow-slate-900/5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-950">{stage.label}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{stage.model}</div>
                </div>
                <LiveDot tone={stage.tone} />
              </div>
              <Progress value={stage.progress} className="mt-3 h-1.5 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600" />
              <div className="mt-2 flex items-center justify-between font-mono text-[11px]">
                <span className="text-slate-500">{stage.progress}% processed</span>
                <span className={toneText(stage.tone)}>{stage.confidence}% conf</span>
              </div>
            </motion.div>
          ))}
        </div>

        <Card className="border-emerald-200 bg-emerald-50 shadow-sm shadow-slate-900/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
              <Sparkles className="h-4 w-4" />
              Smart Money Block Logic
            </div>
            <p className="mt-2 text-xs leading-5 text-emerald-900">
              Blocks are ranked by displacement origin, mitigation behavior, liquidity interaction, breaker invalidation and institutional positioning quality.
            </p>
          </CardContent>
        </Card>
      </div>
    </aside>
  );
}

function OrderBlockWorkspace() {
  return (
    <section className="bg-slate-50 p-4 md:p-5">
      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <OverviewStat icon={Target} label="Mapped blocks" value="39" detail="Bullish, bearish and mitigation" tone="blue" />
          <OverviewStat icon={ShieldCheck} label="Block quality" value="95%" detail="Bullish OB defended" tone="emerald" />
          <OverviewStat icon={TrendingUp} label="Mitigation probability" value="82%" detail="Origin block likely revisit" tone="purple" />
          <OverviewStat icon={TrendingDown} label="Breaker risk" value="39%" detail="Invalidation risk contained" tone="orange" />
        </div>

        <Card className="overflow-hidden border-slate-200 bg-white shadow-lg shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Layers3 className="h-4 w-4 text-blue-700" />
                Institutional Order Block Map
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <SmallPill label="Bullish OB" tone="emerald" />
                <SmallPill label="Bearish OB" tone="orange" />
                <SmallPill label="Mitigation" tone="blue" />
                <SmallPill label="Breaker / liquidity" tone="rose" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-0 p-0 min-[1700px]:grid-cols-[minmax(0,1fr)_340px]">
            <div className="relative min-h-[520px] border-b border-slate-200 bg-white p-4 min-[1700px]:border-b-0 min-[1700px]:border-r">
              <div className="absolute inset-4 rounded-lg border border-slate-200 bg-[linear-gradient(to_right,rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.14)_1px,transparent_1px)] bg-[size:58px_42px]" />
              <div className="relative h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={reactionSeries} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="zonePriceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.24} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[2318, 2390]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                    <Area type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={2.5} fill="url(#zonePriceGradient)" />
                    <Line type="monotone" dataKey="bullishBlock" stroke="#10b981" strokeWidth={2.25} dot={false} />
                    <Line type="monotone" dataKey="bearishBlock" stroke="#f97316" strokeWidth={2.25} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
                {zoneLabels.map((item) => (
                  <BlockBadge key={item.label} {...item} />
                ))}
                <StructureLabel label="Institutional accumulation" tone="emerald" className="left-[30%] top-[76%] w-[34%]" />
                <StructureLabel label="Bearish distribution block" tone="orange" className="left-[64%] top-[27%] w-[27%]" />
                <StructureLabel label="Breaker liquidity" tone="rose" className="left-[76%] top-[52%] w-[23%]" />
                <StructureLabel label="Mitigation return zone" tone="blue" className="left-[34%] top-[52%] w-[30%]" />
              </div>

              <div className="relative mt-4 grid grid-cols-1 gap-2 md:grid-cols-4">
                {scoringRows.map((row) => (
                  <div key={row.label} className={cn('rounded-lg border p-3', toneBorder(row.tone), toneBg(row.tone))}>
                    <div className="text-[11px] text-slate-600">{row.label}</div>
                    <div className="mt-1 font-mono text-2xl font-semibold text-slate-950">{row.value}%</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{row.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 p-4">
              <SectionTitle icon={Target} title="Block Quality Scoring" detail="Bullish, bearish, mitigation, breaker, rejection and positioning blocks" compact />
              <div className="grid gap-2 md:grid-cols-2 min-[1700px]:grid-cols-1">
                {zoneFamilies.map((zone) => (
                  <ClassifierRow key={zone.label} {...zone} />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
          <Card className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <ScanLine className="h-4 w-4 text-emerald-600" />
                Liquidity Interaction Heatmap
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
                <LegendItem tone="emerald" label="Accumulation" />
                <LegendItem tone="orange" label="Distribution" />
                <LegendItem tone="rose" label="Liquidity" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <LineChartIcon className="h-4 w-4 text-blue-700" />
                Historical Respect Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[285px] p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={reactionSeries} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[20, 100]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                  <Line type="monotone" dataKey="mitigation" stroke="#10b981" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="liquidity" stroke="#f97316" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function OrderBlockIntelligence() {
  return (
    <aside className="border-t border-slate-200 bg-white xl:col-span-2 min-[2200px]:col-span-1 min-[2200px]:border-l min-[2200px]:border-t-0">
      <div className="space-y-4 p-4">
        <SectionTitle icon={Bot} title="Order Block Intelligence" detail="Smart money reasoning, mitigation probability, institutional positioning and liquidity logic" />

        <Card className="border-blue-200 bg-blue-50 shadow-sm shadow-slate-900/5">
          <CardHeader className="px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-blue-950">
              <BrainCircuit className="h-4 w-4" />
              AI Order Block Reading
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="font-mono text-2xl font-semibold text-blue-950">Bullish OB Defended, Mitigation Watch</div>
            <p className="mt-2 text-sm leading-6 text-blue-900">
              Smart money appears to be defending a bullish order block after displacement. Mitigation probability is elevated while breaker confirmation remains limited.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="Block quality" value="95%" tone="emerald" />
          <MetricCard label="Mitigation probability" value="82%" tone="blue" />
          <MetricCard label="Breaker risk" value="39%" tone="orange" />
          <MetricCard label="Liquidity density" value="87%" tone="rose" />
        </div>

        <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Network className="h-4 w-4 text-purple-700" />
              Multi-Timeframe Block Sync
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
              Order Block Model Quality
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[210px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modelQuality} layout="vertical" margin={{ top: 6, right: 16, left: 90, bottom: 6 }}>
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis dataKey="label" type="category" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} width={88} />
                <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {modelQuality.map((entry) => (
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

function OrderBlockConsole() {
  return (
    <section className="border-t border-slate-200 bg-slate-950 text-slate-100">
      <div className="grid min-h-[260px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-h-0 border-b border-slate-800 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="h-4 w-4 text-emerald-300" />
              Order Block Detection Console
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
              <LiveDot tone="emerald" />
              order blocks / mitigation / breakers / liquidity stream
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
            <ConsoleStat label="Block classes" value="7" tone="blue" />
            <ConsoleStat label="Mapped blocks" value="39" tone="emerald" />
            <ConsoleStat label="Vision p95" value="21ms" tone="purple" />
            <ConsoleStat label="Mitigations" value="7" tone="orange" />
          </div>
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="text-xs font-semibold text-slate-100">Institutional order block engine</div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Order block intelligence combines smart money origin blocks, mitigation probability, breaker invalidation, historical respect and liquidity interaction mapping.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function BlockBadge(props: { label: string; x: string; y: string; tone: Tone; score: number }) {
  return (
    <motion.div
      className={cn('absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white px-2 py-1 text-center shadow-md shadow-slate-900/10', toneBorder(props.tone))}
      style={{ left: props.x, top: props.y }}
      animate={{ scale: [1, 1.05, 1] }}
      transition={{ duration: 2, repeat: Infinity }}
    >
      <div className={cn('font-mono text-xs font-bold', toneText(props.tone))}>{props.label}</div>
      <div className="font-mono text-[10px] text-slate-500">{props.score}%</div>
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
