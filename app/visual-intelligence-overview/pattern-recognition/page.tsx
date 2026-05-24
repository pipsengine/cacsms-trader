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
  History,
  Layers3,
  LineChart,
  Menu,
  Network,
  Play,
  Radar,
  Radio,
  ShieldCheck,
  Sparkles,
  Target,
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
  { label: 'Pair/Symbol', value: 'XAUUSD pattern grid', tone: 'navy' as Tone },
  { label: 'Market Status', value: 'Pattern scan live', tone: 'emerald' as Tone },
  { label: 'AI Confidence', value: '89.7%', tone: 'blue' as Tone },
  { label: 'Trend Direction', value: 'Bull flag forming', tone: 'emerald' as Tone },
  { label: 'Volatility', value: 'Compressed', tone: 'orange' as Tone },
  { label: 'Session State', value: 'NY continuation', tone: 'purple' as Tone },
  { label: 'Processing', value: '26 patterns', tone: 'blue' as Tone },
  { label: 'Institutional', value: 'Accumulation', tone: 'emerald' as Tone },
  { label: 'Retail', value: 'Breakout chase', tone: 'orange' as Tone },
  { label: 'AI Decision', value: 'Forecast / wait', tone: 'purple' as Tone },
];

const workflowStages = [
  { label: 'Pattern segmentation', model: 'OpenCV swing geometry', progress: 94, confidence: 91, tone: 'blue' as Tone },
  { label: 'Formation classifier', model: 'CNN + ViT pattern ensemble', progress: 88, confidence: 89, tone: 'emerald' as Tone },
  { label: 'Incomplete pattern reasoning', model: 'Temporal sequence transformer', progress: 84, confidence: 86, tone: 'purple' as Tone },
  { label: 'Breakout probability', model: 'Historical similarity engine', progress: 81, confidence: 83, tone: 'orange' as Tone },
  { label: 'Trap detection', model: 'Smart money manipulation agent', progress: 77, confidence: 80, tone: 'rose' as Tone },
  { label: 'Institutional interpretation', model: 'Wyckoff / ICT reasoning layer', progress: 73, confidence: 78, tone: 'slate' as Tone },
];

const patternCatalog = [
  { label: 'Head and shoulders', count: 6, confidence: 81, tone: 'orange' as Tone },
  { label: 'Double tops', count: 11, confidence: 86, tone: 'rose' as Tone },
  { label: 'Double bottoms', count: 14, confidence: 88, tone: 'emerald' as Tone },
  { label: 'Triangles', count: 19, confidence: 91, tone: 'blue' as Tone },
  { label: 'Flags', count: 22, confidence: 92, tone: 'emerald' as Tone },
  { label: 'Pennants', count: 12, confidence: 84, tone: 'purple' as Tone },
  { label: 'Wedges', count: 9, confidence: 79, tone: 'orange' as Tone },
  { label: 'Channels', count: 17, confidence: 87, tone: 'blue' as Tone },
  { label: 'Harmonics', count: 7, confidence: 76, tone: 'purple' as Tone },
  { label: 'Wyckoff structures', count: 5, confidence: 82, tone: 'emerald' as Tone },
  { label: 'ICT patterns', count: 13, confidence: 85, tone: 'navy' as Tone },
  { label: 'Smart money structures', count: 16, confidence: 90, tone: 'emerald' as Tone },
];

const evolutionSeries = [
  { t: '09:00', price: 2328, probability: 42, trap: 28 },
  { t: '09:20', price: 2335, probability: 48, trap: 31 },
  { t: '09:40', price: 2331, probability: 52, trap: 39 },
  { t: '10:00', price: 2344, probability: 61, trap: 34 },
  { t: '10:20', price: 2340, probability: 66, trap: 41 },
  { t: '10:40', price: 2352, probability: 73, trap: 37 },
  { t: '11:00', price: 2350, probability: 76, trap: 44 },
  { t: '11:20', price: 2361, probability: 82, trap: 38 },
];

const probabilityMap = [
  92, 86, 74, 61, 52, 43,
  84, 91, 79, 67, 58, 49,
  73, 82, 88, 94, 71, 54,
  62, 75, 83, 89, 96, 68,
  55, 64, 78, 85, 91, 76,
];

const forecastNodes = [
  { label: 'Bull flag continuation', probability: 82, detail: 'Compression after impulse with shallow pullback.', tone: 'emerald' as Tone },
  { label: 'Liquidity trap breakout', probability: 38, detail: 'Retail momentum is rising above local structure.', tone: 'orange' as Tone },
  { label: 'Wyckoff re-accumulation', probability: 64, detail: 'Range behavior resembles phase D markup preparation.', tone: 'purple' as Tone },
  { label: 'ICT displacement leg', probability: 71, detail: 'Potential FVG expansion if M5 closes above internal high.', tone: 'blue' as Tone },
];

const historicalRows = [
  { label: 'Bull flags', value: 74, color: '#10b981' },
  { label: 'Triangles', value: 68, color: '#2563eb' },
  { label: 'Double bottoms', value: 63, color: '#7c3aed' },
  { label: 'Wyckoff setups', value: 58, color: '#f97316' },
  { label: 'Trap filters', value: 81, color: '#0f172a' },
];

const similarityMatches = [
  { id: 'XAU-M5-2026-0418', match: 94, outcome: '+1.8R continuation', tone: 'emerald' as Tone },
  { id: 'EUR-H1-2026-0327', match: 88, outcome: 'False break, retest win', tone: 'blue' as Tone },
  { id: 'NAS-M15-2026-0214', match: 83, outcome: 'Liquidity grab before markup', tone: 'purple' as Tone },
  { id: 'GBP-M5-2026-0109', match: 79, outcome: 'Trap breakout failure', tone: 'orange' as Tone },
];

const consoleEvents = [
  { time: '22:42:18', type: 'PATTERN', message: 'Bull flag candidate promoted to 82% breakout probability on XAUUSD M5', tone: 'emerald' as Tone },
  { time: '22:42:14', type: 'EVOLVE', message: 'Incomplete triangle invalidated after impulse leg expanded beyond apex tolerance', tone: 'blue' as Tone },
  { time: '22:42:11', type: 'HIST', message: 'Historical similarity engine matched 4 prior continuation structures above 79%', tone: 'purple' as Tone },
  { time: '22:42:07', type: 'TRAP', message: 'Manipulation risk reduced after liquidity sweep failed to close below demand', tone: 'orange' as Tone },
  { time: '22:42:03', type: 'ICT', message: 'Potential displacement leg waiting for fair value gap confirmation', tone: 'navy' as Tone },
  { time: '22:41:58', type: 'WYCKOFF', message: 'Re-accumulation interpretation remains active while range low holds', tone: 'emerald' as Tone },
];

export default function PatternRecognitionPage() {
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
      patterns: Math.round(26 + wave * 3),
      gpu: Math.round(72 + Math.abs(wave) * 8),
      latency: Math.round(26 + Math.abs(Math.cos(pulse / 9)) * 5),
      confidence: Math.round(89 + Math.sin(pulse / 10) * 3),
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
                <h1 className="truncate text-lg font-semibold text-slate-950 md:text-xl">Pattern Recognition Engine</h1>
                <p className="truncate text-xs font-mono text-blue-700">Evolving formations, breakout probabilities, historical similarity and institutional interpretation</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 xl:flex">
              <HeaderChip icon={Radio} label="Stream" value={`${live.patterns} patterns`} tone="emerald" />
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
            <PatternWorkflowSidebar confidence={live.confidence} />
            <PatternWorkspace />
            <PatternIntelligencePanel />
          </div>
          <PatternConsole />
        </main>
      </div>
    </div>
  );
}

function PatternWorkflowSidebar(props: { confidence: number }) {
  return (
    <aside className="border-r border-slate-200 bg-white/90">
      <div className="space-y-4 p-4">
        <SectionTitle icon={GitBranch} title="Pattern AI Pipeline" detail="Formation detection, evolution scoring and probability reasoning" />

        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="AI confidence" value={`${props.confidence}%`} tone="blue" />
          <MetricCard label="Pattern families" value="12" tone="emerald" />
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
              Incomplete Pattern Logic
            </div>
            <p className="mt-2 text-xs leading-5 text-emerald-900">
              The engine scores partially formed structures and updates probabilities as new pivots, breaks and retests arrive.
            </p>
          </CardContent>
        </Card>
      </div>
    </aside>
  );
}

function PatternWorkspace() {
  return (
    <section className="bg-slate-50 p-4 md:p-5">
      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <OverviewStat icon={Layers3} label="Active patterns" value="26" detail="12 families monitored" tone="blue" />
          <OverviewStat icon={TrendingUp} label="Breakout probability" value="82%" detail="Bull flag continuation" tone="emerald" />
          <OverviewStat icon={ShieldCheck} label="Trap risk" value="38%" detail="Retail chase monitored" tone="orange" />
          <OverviewStat icon={History} label="Similarity matches" value="4" detail="Above 79% historical fit" tone="purple" />
        </div>

        <Card className="overflow-hidden border-slate-200 bg-white shadow-lg shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Play className="h-4 w-4 text-blue-700" />
                Pattern Evolution Playback
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <SmallPill label="Flags" tone="emerald" />
                <SmallPill label="Triangles" tone="blue" />
                <SmallPill label="Wyckoff" tone="purple" />
                <SmallPill label="Trap filter" tone="orange" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-0 p-0 min-[1700px]:grid-cols-[minmax(0,1fr)_340px]">
            <div className="relative min-h-[520px] border-b border-slate-200 bg-white p-4 min-[1700px]:border-b-0 min-[1700px]:border-r">
              <div className="absolute inset-4 rounded-lg border border-slate-200 bg-[linear-gradient(to_right,rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.14)_1px,transparent_1px)] bg-[size:58px_42px]" />
              <div className="relative h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={evolutionSeries} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="patternPriceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[2320, 2370]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                    <Area type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={2.5} fill="url(#patternPriceGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
                <PatternLabel label="Bull flag channel" tone="emerald" className="left-[28%] top-[28%] w-[42%]" />
                <PatternLabel label="Breakout trigger" tone="blue" className="left-[63%] top-[16%] w-[24%]" />
                <PatternLabel label="Trap sweep zone" tone="orange" className="left-[16%] top-[66%] w-[30%]" />
                <PatternLabel label="Wyckoff markup path" tone="purple" className="left-[52%] top-[52%] w-[32%]" />
              </div>

              <div className="relative mt-4 grid grid-cols-1 gap-2 md:grid-cols-4">
                {forecastNodes.map((node) => (
                  <div key={node.label} className={cn('rounded-lg border p-3', toneBorder(node.tone), toneBg(node.tone))}>
                    <div className="text-[11px] text-slate-600">{node.label}</div>
                    <div className="mt-1 font-mono text-2xl font-semibold text-slate-950">{node.probability}%</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{node.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 p-4">
              <SectionTitle icon={Target} title="Pattern Classifiers" detail="Detected structures and confidence" compact />
              <div className="grid gap-2 md:grid-cols-2 min-[1700px]:grid-cols-1">
                {patternCatalog.slice(0, 9).map((pattern) => (
                  <ClassifierRow key={pattern.label} {...pattern} />
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
                AI Probability Map
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-6 gap-1">
                {probabilityMap.map((value, index) => (
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
                <LegendItem tone="emerald" label="Breakout" />
                <LegendItem tone="orange" label="Trap" />
                <LegendItem tone="blue" label="Evolving" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <LineChart className="h-4 w-4 text-blue-700" />
                Pattern Forecasting
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[285px] p-4">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsLineChart data={evolutionSeries} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[20, 100]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                  <Line type="monotone" dataKey="probability" stroke="#10b981" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="trap" stroke="#f97316" strokeWidth={2} dot={false} />
                </RechartsLineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function PatternIntelligencePanel() {
  return (
    <aside className="border-t border-slate-200 bg-white xl:col-span-2 min-[2200px]:col-span-1 min-[2200px]:border-l min-[2200px]:border-t-0">
      <div className="space-y-4 p-4">
        <SectionTitle icon={Bot} title="Pattern Intelligence" detail="Forecasting, traps, historical success and institutional interpretation" />

        <Card className="border-blue-200 bg-blue-50 shadow-sm shadow-slate-900/5">
          <CardHeader className="px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-blue-950">
              <BrainCircuit className="h-4 w-4" />
              AI Pattern Interpretation
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="font-mono text-2xl font-semibold text-blue-950">Bull Flag, Incomplete</div>
            <p className="mt-2 text-sm leading-6 text-blue-900">
              The structure is forming after displacement. Breakout probability is rising, but the model is still monitoring for a liquidity trap above the compression high.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="Breakout odds" value="82%" tone="emerald" />
          <MetricCard label="Trap risk" value="38%" tone="orange" />
          <MetricCard label="Historical fit" value="94%" tone="purple" />
          <MetricCard label="Pattern age" value="7 bars" tone="blue" />
        </div>

        <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <History className="h-4 w-4 text-purple-700" />
              Historical Similarity Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {similarityMatches.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-900">{item.id}</span>
                  <span className={cn('font-mono text-xs', toneText(item.tone))}>{item.match}%</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{item.outcome}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <BarChart3 className="h-4 w-4 text-orange-600" />
              Historical Success Rates
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[210px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historicalRows} layout="vertical" margin={{ top: 6, right: 16, left: 84, bottom: 6 }}>
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis dataKey="label" type="category" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} width={82} />
                <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {historicalRows.map((entry) => (
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
              Institutional Pattern Interpretation
            </div>
            <p className="mt-2 text-xs leading-5 text-emerald-900">
              AI reads the formation as controlled compression after displacement, consistent with accumulation before markup if the range high breaks cleanly.
            </p>
          </CardContent>
        </Card>
      </div>
    </aside>
  );
}

function PatternConsole() {
  return (
    <section className="border-t border-slate-200 bg-slate-950 text-slate-100">
      <div className="grid min-h-[260px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-h-0 border-b border-slate-800 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="h-4 w-4 text-emerald-300" />
              Pattern Recognition Console
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
              <LiveDot tone="emerald" />
              evolution / probability / historical similarity / trap detection
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
            <ConsoleStat label="Families" value="12" tone="blue" />
            <ConsoleStat label="Active patterns" value="26" tone="emerald" />
            <ConsoleStat label="Forecast p95" value="26ms" tone="purple" />
            <ConsoleStat label="Trap alerts" value="4" tone="orange" />
          </div>
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="text-xs font-semibold text-slate-100">Pattern cognition stack</div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              The engine combines visual structure detection, temporal reasoning, historical similarity and smart money interpretation for evolving patterns.
            </p>
          </div>
        </div>
      </div>
    </section>
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

function PatternLabel(props: { label: string; tone: Tone; className: string }) {
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
