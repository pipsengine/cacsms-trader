'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Binary,
  Bot,
  BrainCircuit,
  CandlestickChart,
  Cpu,
  DatabaseZap,
  Eye,
  Gauge,
  GitBranch,
  Layers3,
  LineChart,
  Menu,
  Network,
  Radar,
  Radio,
  ScanLine,
  ServerCog,
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
  { label: 'Pair/Symbol', value: 'XAUUSD / FX Majors', tone: 'navy' as Tone },
  { label: 'Market Status', value: 'London-NY overlap', tone: 'emerald' as Tone },
  { label: 'AI Confidence', value: '91.4%', tone: 'blue' as Tone },
  { label: 'Trend Direction', value: 'Bullish impulse', tone: 'emerald' as Tone },
  { label: 'Volatility', value: 'Elevated', tone: 'orange' as Tone },
  { label: 'Session State', value: 'High liquidity', tone: 'purple' as Tone },
  { label: 'Processing', value: '18 streams', tone: 'blue' as Tone },
  { label: 'Institutional', value: '+72 demand', tone: 'emerald' as Tone },
  { label: 'Retail', value: '-18 crowded', tone: 'orange' as Tone },
  { label: 'AI Decision', value: 'Observe / prepare', tone: 'purple' as Tone },
];

const workflowStages = [
  { label: 'Chart capture', model: 'MT5 screenshot bus', progress: 96, confidence: 94, tone: 'blue' as Tone },
  { label: 'Candle segmentation', model: 'OpenCV + CNN detector', progress: 88, confidence: 91, tone: 'emerald' as Tone },
  { label: 'Structure mapping', model: 'Swing graph transformer', progress: 82, confidence: 87, tone: 'purple' as Tone },
  { label: 'Liquidity zones', model: 'YOLOv9 zone detector', progress: 79, confidence: 84, tone: 'orange' as Tone },
  { label: 'Pattern reasoning', model: 'ViT pattern ensemble', progress: 73, confidence: 81, tone: 'blue' as Tone },
  { label: 'RL policy review', model: 'Trade safety agent', progress: 68, confidence: 76, tone: 'slate' as Tone },
];

const activeModels = [
  { name: 'YOLOv9 Liquidity', state: 'GPU inferencing', load: 74, latency: '22ms', tone: 'emerald' as Tone },
  { name: 'ViT Chart Encoder', state: 'Sequence attention', load: 67, latency: '31ms', tone: 'purple' as Tone },
  { name: 'OpenCV Edge Grid', state: 'Candle contours', load: 58, latency: '11ms', tone: 'blue' as Tone },
  { name: 'LSTM Regime Net', state: 'Temporal forecast', load: 63, latency: '18ms', tone: 'orange' as Tone },
];

const symbolAnalyses = [
  { symbol: 'XAUUSD', tf: 'M1-M15-H1', confidence: 94, state: 'Liquidity sweep detected', tone: 'emerald' as Tone },
  { symbol: 'EURUSD', tf: 'M5-M30-H4', confidence: 86, state: 'Compression breakout watch', tone: 'blue' as Tone },
  { symbol: 'GBPUSD', tf: 'M1-M5-H1', confidence: 78, state: 'Retail trap risk', tone: 'orange' as Tone },
  { symbol: 'USDJPY', tf: 'M15-H1-H4', confidence: 81, state: 'Institutional continuation', tone: 'purple' as Tone },
  { symbol: 'NAS100', tf: 'M5-M15-H1', confidence: 74, state: 'Volatility expansion', tone: 'rose' as Tone },
];

const chartSeries = [
  { t: '09:00', price: 2324, confidence: 66, liquidity: 42 },
  { t: '09:15', price: 2329, confidence: 70, liquidity: 48 },
  { t: '09:30', price: 2326, confidence: 69, liquidity: 61 },
  { t: '09:45', price: 2335, confidence: 78, liquidity: 58 },
  { t: '10:00', price: 2341, confidence: 82, liquidity: 73 },
  { t: '10:15', price: 2338, confidence: 79, liquidity: 68 },
  { t: '10:30', price: 2348, confidence: 88, liquidity: 79 },
  { t: '10:45', price: 2352, confidence: 91, liquidity: 84 },
  { t: '11:00', price: 2350, confidence: 89, liquidity: 76 },
  { t: '11:15', price: 2357, confidence: 93, liquidity: 88 },
];

const heatmapCells = [
  92, 88, 76, 64, 51, 43,
  84, 79, 68, 57, 46, 35,
  73, 69, 62, 55, 49, 41,
  66, 71, 86, 93, 78, 52,
  58, 63, 74, 82, 91, 69,
  45, 52, 61, 70, 84, 96,
];

const decisionNodes = [
  { label: 'Vision', value: 91, x: '18%', y: '26%', tone: 'blue' as Tone },
  { label: 'Structure', value: 87, x: '42%', y: '18%', tone: 'purple' as Tone },
  { label: 'Liquidity', value: 84, x: '67%', y: '34%', tone: 'emerald' as Tone },
  { label: 'Risk', value: 76, x: '34%', y: '64%', tone: 'orange' as Tone },
  { label: 'Policy', value: 81, x: '73%', y: '72%', tone: 'navy' as Tone },
];

const inferenceEvents = [
  { time: '11:21:08', type: 'VISION', message: 'YOLOv9 mapped buy-side liquidity cluster above 2358.20', tone: 'emerald' as Tone },
  { time: '11:21:07', type: 'STRUCTURE', message: 'BOS candidate promoted after M5 candle body confirmation', tone: 'purple' as Tone },
  { time: '11:21:05', type: 'GPU', message: 'Batch inference completed across 18 active charts in 31ms p95', tone: 'blue' as Tone },
  { time: '11:21:03', type: 'WS', message: 'Chart event stream synchronized to visual-intel:xauusd:m5', tone: 'navy' as Tone },
  { time: '11:21:01', type: 'RISK', message: 'Retail long crowding increased; trap probability revised to 38%', tone: 'orange' as Tone },
  { time: '11:20:58', type: 'LEARN', message: 'Historical pattern memory updated with London sweep sequence', tone: 'emerald' as Tone },
  { time: '11:20:54', type: 'OCR', message: 'Axis labels and session markers verified from captured chart frame', tone: 'slate' as Tone },
];

const patternEvents = [
  { label: 'Liquidity mapping', value: 128, delta: '+14%', tone: 'emerald' as Tone },
  { label: 'Structure shifts', value: 36, delta: '+7%', tone: 'purple' as Tone },
  { label: 'Pattern recognition', value: 214, delta: '+23%', tone: 'blue' as Tone },
  { label: 'Signal pipelines', value: 17, delta: 'stable', tone: 'orange' as Tone },
];

const performanceRows = [
  { label: 'Vision precision', value: 93, color: '#2563eb' },
  { label: 'Zone recall', value: 88, color: '#10b981' },
  { label: 'Pattern F1', value: 84, color: '#7c3aed' },
  { label: 'False alert filter', value: 79, color: '#f97316' },
  { label: 'RL agreement', value: 72, color: '#0f172a' },
];

const agentReasoning = [
  { agent: 'Vision Agent', call: 'Validated impulse leg and rejected two weak wick-only zones.', confidence: 91, tone: 'blue' as Tone },
  { agent: 'Institutional Agent', call: 'Demand footprint aligns with prior session imbalance.', confidence: 86, tone: 'emerald' as Tone },
  { agent: 'Retail Behavior Agent', call: 'Crowding is building above midpoint; breakout chase risk remains elevated.', confidence: 78, tone: 'orange' as Tone },
  { agent: 'Risk Governor', call: 'No execution authorization until H1 structure and spread quality agree.', confidence: 81, tone: 'purple' as Tone },
];

export default function VisualIntelligenceOverviewPage() {
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

  const streamingMetrics = useMemo(() => {
    const wave = Math.sin(pulse / 8);
    return {
      activeCharts: 18 + (pulse % 3),
      gpuActivity: Math.round(71 + wave * 8),
      latency: Math.round(27 + Math.abs(wave) * 6),
      sync: Math.round(94 + Math.cos(pulse / 10) * 3),
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
                <h1 className="truncate text-lg font-semibold text-slate-950 md:text-xl">Visual Intelligence Overview</h1>
                <p className="truncate text-xs font-mono text-blue-700">Computer vision, chart cognition, model orchestration and surveillance command center</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 xl:flex">
              <HeaderChip icon={Radio} label="WS Stream" value="visual-intel.live" tone="emerald" />
              <HeaderChip icon={Cpu} label="GPU" value={`${streamingMetrics.gpuActivity}% active`} tone="purple" />
              <HeaderChip icon={Gauge} label="Vision Latency" value={`${streamingMetrics.latency}ms p95`} tone="orange" />
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
          <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] min-[2200px]:grid-cols-[280px_minmax(0,1fr)_340px]">
            <WorkflowSidebar activeCharts={streamingMetrics.activeCharts} sync={streamingMetrics.sync} />
            <VisualizationWorkspace />
            <IntelligencePanel />
          </div>
          <ProcessingConsole />
        </main>
      </div>
    </div>
  );
}

function WorkflowSidebar(props: { activeCharts: number; sync: number }) {
  return (
    <aside className="min-h-0 border-r border-slate-200 bg-white/90 xl:overflow-hidden">
      <div className="space-y-4 p-4">
          <SectionTitle icon={GitBranch} title="AI Workflow Pipeline" detail="Detection stages and model progression" />

          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="Active analyses" value={String(props.activeCharts)} tone="blue" />
            <MetricCard label="MTF sync" value={`${props.sync}%`} tone="emerald" />
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

          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm shadow-slate-900/5">
            <SectionTitle icon={ServerCog} title="Active Models" detail="GPU and edge inference stack" compact />
            <div className="mt-3 space-y-2">
              {activeModels.map((model) => (
                <div key={model.name} className="rounded-md border border-slate-100 bg-slate-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-slate-800">{model.name}</span>
                    <span className={cn('font-mono text-[10px]', toneText(model.tone))}>{model.latency}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                    <span className="truncate">{model.state}</span>
                    <span className="font-mono">{model.load}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
              <Sparkles className="h-4 w-4" />
              Historical Learning
            </div>
            <p className="mt-2 text-xs leading-5 text-emerald-800">
              Pattern memory is replaying 4,812 labeled liquidity sweeps and structure breaks against the current chart stream.
            </p>
          </div>
      </div>
    </aside>
  );
}

function VisualizationWorkspace() {
  return (
    <section className="min-h-0 overflow-y-auto bg-slate-50 p-4 md:p-5">
      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <OverviewStat icon={Eye} label="Chart analyses" value="20" detail="18 active, 2 queued" tone="blue" />
          <OverviewStat icon={ScanLine} label="Detection status" value="Live" detail="12 engines running" tone="emerald" />
          <OverviewStat icon={Cpu} label="GPU inference" value="74%" detail="CUDA batch stream" tone="purple" />
          <OverviewStat icon={Network} label="Signal pipelines" value="17" detail="Kafka / Redis ready" tone="orange" />
        </div>

        <Card className="overflow-hidden border-slate-200 bg-white shadow-lg shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <CandlestickChart className="h-4 w-4 text-blue-700" />
                Live Chart Intelligence Engine
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <SmallPill label="OpenCV contours" tone="blue" />
                <SmallPill label="YOLO zones" tone="emerald" />
                <SmallPill label="ViT patterns" tone="purple" />
                <SmallPill label="RL guarded" tone="orange" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid min-h-[440px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="relative min-h-[420px] border-b border-slate-200 bg-white p-4 lg:border-b-0 lg:border-r">
                <div className="absolute inset-4 rounded-lg border border-slate-200 bg-[linear-gradient(to_right,rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.14)_1px,transparent_1px)] bg-[size:44px_34px]" />
                <div className="relative h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartSeries} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[2318, 2364]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={44} />
                      <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                      <Area type="monotone" dataKey="price" stroke="#1d4ed8" strokeWidth={2.5} fill="url(#priceGradient)" />
                    </AreaChart>
                  </ResponsiveContainer>

                  <ZoneOverlay label="Buy-side liquidity" tone="orange" className="left-[64%] top-[14%] w-[24%]" />
                  <ZoneOverlay label="Institutional demand" tone="emerald" className="left-[18%] top-[62%] w-[34%]" />
                  <ZoneOverlay label="Structure break" tone="purple" className="left-[48%] top-[38%] w-[28%]" />
                </div>

                <div className="relative mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {patternEvents.map((event) => (
                    <div key={event.label} className={cn('rounded-lg border p-3', toneBorder(event.tone), toneBg(event.tone))}>
                      <div className="text-[11px] text-slate-600">{event.label}</div>
                      <div className="mt-1 flex items-end justify-between gap-2">
                        <span className="font-mono text-xl font-semibold text-slate-950">{event.value}</span>
                        <span className={cn('font-mono text-[11px]', toneText(event.tone))}>{event.delta}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 p-4">
                <SectionTitle icon={Layers3} title="Visual Layers" detail="Heatmaps, annotations and MTF overlays" compact />
                <LayerToggle label="Candle body segmentation" value={96} tone="blue" />
                <LayerToggle label="Liquidity pool heatmap" value={88} tone="emerald" />
                <LayerToggle label="Smart money footprints" value={82} tone="purple" />
                <LayerToggle label="Retail trap markers" value={69} tone="orange" />

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-800">AI Annotations</div>
                  <div className="mt-3 space-y-2">
                    <Annotation label="BOS candidate" value="M5 close required" tone="purple" />
                    <Annotation label="Order block" value="Fresh, unmitigated" tone="emerald" />
                    <Annotation label="Volatility state" value="Expansion phase" tone="orange" />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
          <Card className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Radar className="h-4 w-4 text-emerald-600" />
                AI Confidence Heatmap
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-6 gap-1">
                {heatmapCells.map((value, index) => (
                  <motion.div
                    key={`${value}-${index}`}
                    animate={{ opacity: [0.72, 1, 0.82] }}
                    transition={{ duration: 2.2, repeat: Infinity, delay: index * 0.03 }}
                    className={cn('grid aspect-square place-items-center rounded-md border text-[11px] font-mono', heatClass(value))}
                  >
                    {value}
                  </motion.div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-slate-600">
                <LegendItem tone="emerald" label="High confidence" />
                <LegendItem tone="orange" label="Watch zone" />
                <LegendItem tone="blue" label="Developing" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <BrainCircuit className="h-4 w-4 text-purple-700" />
                AI Decision Map
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="relative h-[240px] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.11),transparent_58%)]" />
                <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
                  <line x1="18%" y1="26%" x2="42%" y2="18%" stroke="#cbd5e1" strokeWidth="2" />
                  <line x1="42%" y1="18%" x2="67%" y2="34%" stroke="#cbd5e1" strokeWidth="2" />
                  <line x1="67%" y1="34%" x2="73%" y2="72%" stroke="#cbd5e1" strokeWidth="2" />
                  <line x1="34%" y1="64%" x2="73%" y2="72%" stroke="#cbd5e1" strokeWidth="2" />
                  <line x1="18%" y1="26%" x2="34%" y2="64%" stroke="#cbd5e1" strokeWidth="2" />
                </svg>
                {decisionNodes.map((node) => (
                  <motion.div
                    key={node.label}
                    className={cn('absolute w-24 -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white p-2 text-center shadow-md shadow-slate-900/10', toneBorder(node.tone))}
                    style={{ left: node.x, top: node.y }}
                    animate={{ scale: [1, 1.035, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <div className="text-[11px] font-semibold text-slate-700">{node.label}</div>
                    <div className={cn('font-mono text-lg font-semibold', toneText(node.tone))}>{node.value}</div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function IntelligencePanel() {
  return (
    <aside className="border-t border-slate-200 bg-white xl:col-span-2 min-[2200px]:col-span-1 min-[2200px]:border-l min-[2200px]:border-t-0">
      <div className="space-y-4 p-4">
          <SectionTitle icon={Bot} title="Right Intelligence Panel" detail="Explanation, probability, risk and recommendations" />

          <Card className="border-blue-200 bg-blue-50 shadow-sm shadow-slate-900/5">
            <CardHeader className="px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-blue-950">
                <Target className="h-4 w-4" />
                AI Recommendation Center
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="font-mono text-2xl font-semibold text-blue-950">Prepare Long Bias</div>
              <p className="mt-2 text-sm leading-6 text-blue-900">
                Wait for M5 retest into the institutional demand zone. Execution remains gated until spread, volatility and H1 structure align.
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="Setup quality" value="A-" tone="emerald" />
            <MetricCard label="Trade probability" value="72%" tone="purple" />
            <MetricCard label="Vision latency" value="31ms" tone="blue" />
            <MetricCard label="Risk state" value="Guarded" tone="orange" />
          </div>

          <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Pattern Reasoning
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {agentReasoning.map((item) => (
                <div key={item.agent} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">{item.agent}</span>
                    <span className={cn('font-mono text-xs', toneText(item.tone))}>{item.confidence}%</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{item.call}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <BarChart3 className="h-4 w-4 text-orange-600" />
                Historical Model Performance
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[210px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceRows} layout="vertical" margin={{ top: 6, right: 16, left: 92, bottom: 6 }}>
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis dataKey="label" type="category" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} width={90} />
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

          <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <LineChart className="h-4 w-4 text-blue-700" />
                Real-Time Chart Intelligence Stream
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[160px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsLineChart data={chartSeries} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                  <Line type="monotone" dataKey="confidence" stroke="#2563eb" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="liquidity" stroke="#10b981" strokeWidth={2} dot={false} />
                </RechartsLineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
      </div>
    </aside>
  );
}

function ProcessingConsole() {
  return (
    <section className="border-t border-slate-200 bg-slate-950 text-slate-100">
      <div className="grid min-h-[260px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-0 border-b border-slate-800 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Binary className="h-4 w-4 text-emerald-300" />
              Bottom Processing Console
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
              <LiveDot tone="emerald" />
              inference logs / websocket events / chart stream
            </div>
          </div>
          <ScrollArea className="h-[214px]">
            <div className="divide-y divide-slate-800">
              {inferenceEvents.map((event) => (
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
            <ConsoleStat label="Kafka topics" value="12" tone="blue" />
            <ConsoleStat label="Redis streams" value="9" tone="emerald" />
            <ConsoleStat label="GPU queue" value="31ms" tone="purple" />
            <ConsoleStat label="Edge sync" value="97%" tone="orange" />
          </div>
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="text-xs font-semibold text-slate-100">Future-ready architecture</div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              WebSocket fanout, Kafka event topics, Redis stream replay, GPU inference workers and multi-agent reasoning hooks are represented as first-class dashboard systems.
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

function ZoneOverlay(props: { label: string; tone: Tone; className: string }) {
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

function LayerToggle(props: { label: string; value: number; tone: Tone }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-700">{props.label}</span>
        <span className={cn('font-mono text-xs', toneText(props.tone))}>{props.value}%</span>
      </div>
      <Progress value={props.value} className="mt-2 h-1.5 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600" />
    </div>
  );
}

function Annotation(props: { label: string; value: string; tone: Tone }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-2 text-xs">
      <span className="font-medium text-slate-700">{props.label}</span>
      <span className={cn('font-mono', toneText(props.tone))}>{props.value}</span>
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
  if (value >= 85) return 'border-emerald-300 bg-emerald-100 text-emerald-900';
  if (value >= 72) return 'border-blue-300 bg-blue-100 text-blue-900';
  if (value >= 58) return 'border-purple-300 bg-purple-100 text-purple-900';
  if (value >= 45) return 'border-orange-300 bg-orange-100 text-orange-900';
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
