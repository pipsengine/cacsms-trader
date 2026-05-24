'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  Aperture,
  Bot,
  BrainCircuit,
  Camera,
  CheckCircle2,
  Clock3,
  Crop,
  Cpu,
  Eye,
  FileImage,
  Gauge,
  GitBranch,
  Grid2X2,
  ImageUp,
  Layers3,
  Menu,
  MonitorUp,
  PanelTop,
  Radio,
  ScanEye,
  ServerCog,
  Smartphone,
  Sparkles,
  TerminalSquare,
  Timer,
  UploadCloud,
  Wand2,
  Wifi,
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
  { label: 'Pair/Symbol', value: 'XAUUSD capture grid', tone: 'navy' as Tone },
  { label: 'Market Status', value: 'Capture active', tone: 'emerald' as Tone },
  { label: 'AI Confidence', value: '94.2%', tone: 'blue' as Tone },
  { label: 'Trend Direction', value: 'Frame neutral', tone: 'purple' as Tone },
  { label: 'Volatility', value: 'Normalizing', tone: 'orange' as Tone },
  { label: 'Session State', value: 'London close prep', tone: 'emerald' as Tone },
  { label: 'Processing', value: '42 img/min', tone: 'blue' as Tone },
  { label: 'Institutional', value: 'Clean feed', tone: 'emerald' as Tone },
  { label: 'Retail', value: 'Mixed uploads', tone: 'orange' as Tone },
  { label: 'AI Decision', value: 'Accept / enhance', tone: 'purple' as Tone },
];

const captureSources = [
  { name: 'TradingView', icon: PanelTop, state: 'browser tab capture', quality: 96, throughput: '14/min', tone: 'blue' as Tone },
  { name: 'MT5', icon: TerminalSquare, state: 'EA screenshot bridge', quality: 93, throughput: '11/min', tone: 'emerald' as Tone },
  { name: 'MT4', icon: MonitorUp, state: 'legacy window watcher', quality: 89, throughput: '6/min', tone: 'purple' as Tone },
  { name: 'Web terminals', icon: Wifi, state: 'DOM viewport sampler', quality: 84, throughput: '5/min', tone: 'orange' as Tone },
  { name: 'Broker platforms', icon: Grid2X2, state: 'multi-window detector', quality: 81, throughput: '3/min', tone: 'slate' as Tone },
  { name: 'Mobile screenshots', icon: Smartphone, state: 'uploaded image queue', quality: 78, throughput: '3/min', tone: 'rose' as Tone },
];

const pipelineStages = [
  { label: 'Source acquisition', detail: 'TradingView, MT4/MT5, broker windows, uploads', progress: 97, tone: 'blue' as Tone },
  { label: 'Smart focus detection', detail: 'Active chart viewport and monitor bounds', progress: 91, tone: 'emerald' as Tone },
  { label: 'AI capture validation', detail: 'Blur, occlusion, cursor, modal and scale checks', progress: 88, tone: 'purple' as Tone },
  { label: 'OCR extraction', detail: 'Symbol, timeframe, price axis, indicator labels', progress: 84, tone: 'orange' as Tone },
  { label: 'Enhancement', detail: 'Noise removal, contrast lift, resolution normalization', progress: 86, tone: 'blue' as Tone },
  { label: 'Auto-crop and publish', detail: 'Chart-only crop pushed into stream ingestion', progress: 79, tone: 'emerald' as Tone },
];

const liveFeeds = [
  { source: 'TradingView Chrome #2', symbol: 'XAUUSD', timeframe: 'M5', score: 98, status: 'validated', tone: 'emerald' as Tone },
  { source: 'MT5 VPS-Lagos-01', symbol: 'EURUSD', timeframe: 'M15', score: 94, status: 'normalized', tone: 'blue' as Tone },
  { source: 'Broker Web London', symbol: 'GBPUSD', timeframe: 'M1', score: 82, status: 'cropping', tone: 'orange' as Tone },
  { source: 'Mobile Upload Queue', symbol: 'USDJPY', timeframe: 'H1', score: 76, status: 'de-noising', tone: 'purple' as Tone },
  { source: 'Multi-monitor Desk B', symbol: 'NAS100', timeframe: 'M5', score: 88, status: 'OCR pass', tone: 'emerald' as Tone },
  { source: 'MT4 Archive Feed', symbol: 'USDCAD', timeframe: 'H4', score: 69, status: 'needs retry', tone: 'rose' as Tone },
];

const captureTimeline = [
  { time: '20:52', accepted: 38, rejected: 4, enhanced: 31 },
  { time: '20:53', accepted: 44, rejected: 3, enhanced: 36 },
  { time: '20:54', accepted: 41, rejected: 5, enhanced: 35 },
  { time: '20:55', accepted: 47, rejected: 2, enhanced: 39 },
  { time: '20:56', accepted: 43, rejected: 6, enhanced: 37 },
  { time: '20:57', accepted: 52, rejected: 3, enhanced: 46 },
  { time: '20:58', accepted: 49, rejected: 4, enhanced: 42 },
  { time: '20:59', accepted: 57, rejected: 2, enhanced: 51 },
];

const qualityTrend = [
  { t: '00', score: 78, latency: 42 },
  { t: '05', score: 82, latency: 39 },
  { t: '10', score: 86, latency: 36 },
  { t: '15', score: 84, latency: 41 },
  { t: '20', score: 89, latency: 33 },
  { t: '25', score: 92, latency: 31 },
  { t: '30', score: 94, latency: 29 },
  { t: '35', score: 93, latency: 28 },
];

const extractedFields = [
  { label: 'Symbol recognition', value: 'XAUUSD', confidence: 99, tone: 'emerald' as Tone },
  { label: 'Timeframe recognition', value: 'M5', confidence: 97, tone: 'blue' as Tone },
  { label: 'Session recognition', value: 'London close', confidence: 91, tone: 'purple' as Tone },
  { label: 'Indicator extraction', value: 'EMA 20 / RSI', confidence: 86, tone: 'orange' as Tone },
  { label: 'Chart crop bounds', value: '1456 x 820', confidence: 95, tone: 'emerald' as Tone },
];

const correctionRules = [
  { label: 'Blur correction', value: 92, tone: 'blue' as Tone },
  { label: 'Noise removal', value: 88, tone: 'emerald' as Tone },
  { label: 'Axis alignment', value: 84, tone: 'purple' as Tone },
  { label: 'Watermark suppression', value: 73, tone: 'orange' as Tone },
  { label: 'Mobile rotation fix', value: 79, tone: 'rose' as Tone },
];

const gpuBars = [
  { label: 'OCR', value: 62, color: '#2563eb' },
  { label: 'Crop', value: 71, color: '#10b981' },
  { label: 'Denoise', value: 58, color: '#7c3aed' },
  { label: 'Enhance', value: 67, color: '#f97316' },
  { label: 'Normalize', value: 74, color: '#0f172a' },
];

const consoleEvents = [
  { time: '20:59:44', type: 'CAPTURE', message: 'TradingView tab frame captured at 2560x1440 and queued for OCR', tone: 'blue' as Tone },
  { time: '20:59:42', type: 'OCR', message: 'Symbol XAUUSD and timeframe M5 confirmed with 99% confidence', tone: 'emerald' as Tone },
  { time: '20:59:39', type: 'CROP', message: 'Auto-crop removed toolbar, watchlist and order panel from broker viewport', tone: 'purple' as Tone },
  { time: '20:59:35', type: 'GPU', message: 'Enhancement batch finished in 28ms p95 across 42 images/minute', tone: 'orange' as Tone },
  { time: '20:59:31', type: 'RETRY', message: 'Mobile screenshot rotated and resubmitted after focus validation warning', tone: 'rose' as Tone },
  { time: '20:59:26', type: 'STREAM', message: 'Normalized image published to visual-capture:xauusd:m5', tone: 'navy' as Tone },
];

export default function ChartScreenshotCapturePage() {
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

  const liveState = useMemo(() => {
    const wave = Math.sin(pulse / 7);
    return {
      ingestion: Math.round(42 + wave * 6),
      gpu: Math.round(69 + Math.abs(wave) * 9),
      latency: Math.round(29 + Math.abs(Math.cos(pulse / 8)) * 5),
      validation: Math.round(93 + Math.sin(pulse / 10) * 3),
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
                <h1 className="truncate text-lg font-semibold text-slate-950 md:text-xl">Chart Screenshot Capture</h1>
                <p className="truncate text-xs font-mono text-blue-700">AI capture ingestion, OCR validation, enhancement and chart normalization system</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 xl:flex">
              <HeaderChip icon={Radio} label="Stream" value={`${liveState.ingestion} img/min`} tone="emerald" />
              <HeaderChip icon={Cpu} label="GPU" value={`${liveState.gpu}% active`} tone="purple" />
              <HeaderChip icon={Gauge} label="Latency" value={`${liveState.latency}ms p95`} tone="orange" />
              <HeaderChip icon={Clock3} label="WAT" value={now || '--:--:--'} tone="navy" />
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
            <CaptureWorkflowSidebar validation={liveState.validation} />
            <CaptureWorkspace />
            <CaptureIntelligencePanel />
          </div>
          <CaptureConsole />
        </main>
      </div>
    </div>
  );
}

function CaptureWorkflowSidebar(props: { validation: number }) {
  return (
    <aside className="min-h-0 border-r border-slate-200 bg-white/90 xl:overflow-hidden">
      <div className="space-y-4 p-4">
          <SectionTitle icon={GitBranch} title="Capture Workflow" detail="Acquisition, validation, OCR and preprocessing" />

          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="Validation" value={`${props.validation}%`} tone="emerald" />
            <MetricCard label="Schedules" value="12" tone="blue" />
          </div>

          <div className="space-y-2">
            {pipelineStages.map((stage, index) => (
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
                    <div className="mt-1 text-[11px] leading-4 text-slate-500">{stage.detail}</div>
                  </div>
                  <LiveDot tone={stage.tone} />
                </div>
                <Progress value={stage.progress} className="mt-3 h-1.5 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600" />
                <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>{stage.progress}% complete</span>
                  <span className={toneText(stage.tone)}>live</span>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm shadow-slate-900/5">
            <SectionTitle icon={Timer} title="Automatic Scheduling" detail="Capture cadence by platform and timeframe" compact />
            <div className="mt-3 space-y-2">
              <ScheduleRow label="Scalping charts" value="Every 5s" tone="blue" />
              <ScheduleRow label="Intraday charts" value="Every 30s" tone="emerald" />
              <ScheduleRow label="Swing charts" value="Every 5m" tone="purple" />
              <ScheduleRow label="Upload queue" value="On arrival" tone="orange" />
            </div>
          </div>
      </div>
    </aside>
  );
}

function CaptureWorkspace() {
  return (
    <section className="min-h-0 overflow-y-auto bg-slate-50 p-4 md:p-5">
      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <OverviewStat icon={Camera} label="Real-time captures" value="42/min" detail="8 active ingestion workers" tone="blue" />
          <OverviewStat icon={CheckCircle2} label="Accepted frames" value="94.2%" detail="AI validation score" tone="emerald" />
          <OverviewStat icon={Crop} label="Auto-cropped" value="312" detail="Last 15 minutes" tone="purple" />
          <OverviewStat icon={UploadCloud} label="Upload formats" value="9" detail="PNG, JPG, WEBP, HEIC ready" tone="orange" />
        </div>

        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.25fr)_minmax(440px,0.75fr)]">
          <Card className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <Aperture className="h-4 w-4 text-blue-700" />
                  Live Screenshot Feeds
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  <SmallPill label="TradingView" tone="blue" />
                  <SmallPill label="MT5 / MT4" tone="emerald" />
                  <SmallPill label="Web terminals" tone="purple" />
                  <SmallPill label="Mobile uploads" tone="orange" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {liveFeeds.map((feed, index) => (
                  <CaptureFeedCard key={feed.source} feed={feed} index={index} />
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <ScanEye className="h-4 w-4 text-emerald-600" />
                AI Quality Scoring
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={qualityTrend} margin={{ top: 14, right: 14, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="qualityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[60, 100]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                    <Area type="monotone" dataKey="score" stroke="#059669" strokeWidth={2.5} fill="url(#qualityGradient)" />
                    <Line type="monotone" dataKey="latency" stroke="#f97316" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <LegendItem tone="emerald" label="Quality score" />
                <LegendItem tone="orange" label="Latency" />
                <LegendItem tone="blue" label="Validated" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <Card className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <BarChartIcon className="h-4 w-4 text-purple-700" />
                Capture Timeline History
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[300px] p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={captureTimeline} margin={{ top: 12, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                  <Bar dataKey="accepted" stackId="a" fill="#2563eb" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="enhanced" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="rejected" stackId="a" fill="#f97316" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Wand2 className="h-4 w-4 text-orange-600" />
                Auto-Error Correction
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {correctionRules.map((rule) => (
                <div key={rule.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">{rule.label}</span>
                    <span className={cn('font-mono text-xs', toneText(rule.tone))}>{rule.value}%</span>
                  </div>
                  <Progress value={rule.value} className="mt-2 h-1.5 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function CaptureIntelligencePanel() {
  return (
    <aside className="border-t border-slate-200 bg-white xl:col-span-2 min-[2200px]:col-span-1 min-[2200px]:border-l min-[2200px]:border-t-0">
      <div className="space-y-4 p-4">
          <SectionTitle icon={BrainCircuit} title="Capture Intelligence" detail="AI analyst-grade screenshot preparation" />

          <Card className="border-blue-200 bg-blue-50 shadow-sm shadow-slate-900/5">
            <CardHeader className="px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-blue-950">
                <Bot className="h-4 w-4" />
                AI Capture Recommendation
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="font-mono text-2xl font-semibold text-blue-950">Accept With Enhancement</div>
              <p className="mt-2 text-sm leading-6 text-blue-900">
                Chart frame is readable and aligned. Apply mild de-noising, crop non-chart panels, normalize to 1920px width, then publish to visual analysis.
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="Quality score" value="94%" tone="emerald" />
            <MetricCard label="OCR confidence" value="97%" tone="blue" />
            <MetricCard label="Crop accuracy" value="95%" tone="purple" />
            <MetricCard label="Retry risk" value="Low" tone="orange" />
          </div>

          <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <FileImage className="h-4 w-4 text-blue-700" />
                OCR and Recognition
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {extractedFields.map((field) => (
                <div key={field.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-600">{field.label}</span>
                    <span className={cn('font-mono text-xs', toneText(field.tone))}>{field.confidence}%</span>
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold text-slate-950">{field.value}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm shadow-slate-900/5">
            <CardHeader className="border-b border-slate-200 px-4 py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Cpu className="h-4 w-4 text-purple-700" />
                GPU Processing Monitor
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[210px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gpuBars} layout="vertical" margin={{ top: 6, right: 16, left: 74, bottom: 6 }}>
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis dataKey="label" type="category" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} width={72} />
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {gpuBars.map((entry) => (
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
                Distributed Processing Ready
              </div>
              <p className="mt-2 text-xs leading-5 text-emerald-900">
                Capture packets are shaped for Kafka fanout, Redis stream replay, GPU preprocessing workers and real-time chart normalization services.
              </p>
            </CardContent>
          </Card>
      </div>
    </aside>
  );
}

function CaptureConsole() {
  return (
    <section className="border-t border-slate-200 bg-slate-950 text-slate-100">
      <div className="grid min-h-[260px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-h-0 border-b border-slate-800 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4 text-emerald-300" />
              Capture Processing Console
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
              <LiveDot tone="emerald" />
              OCR logs / capture validation / normalization stream
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
            <ConsoleStat label="Ingestion topics" value="8" tone="blue" />
            <ConsoleStat label="Queued frames" value="126" tone="emerald" />
            <ConsoleStat label="OCR p95" value="24ms" tone="purple" />
            <ConsoleStat label="Retries" value="2.8%" tone="orange" />
          </div>
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="text-xs font-semibold text-slate-100">Massive ingestion posture</div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Multi-format screenshots are accepted, scored, enhanced, cropped, normalized and published as chart-ready image events for downstream AI vision services.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function CaptureFeedCard(props: { feed: (typeof liveFeeds)[number]; index: number }) {
  const Icon = captureSources[props.index % captureSources.length].icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: props.index * 0.04 }}
      className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-900/5"
    >
      <div className={cn('relative h-36 border-b', toneBorder(props.feed.tone), toneBg(props.feed.tone))}>
        <div className="absolute inset-3 rounded-md border border-white/70 bg-white/60 shadow-inner" />
        <div className="absolute inset-x-7 top-8 h-px bg-slate-300" />
        <div className="absolute inset-x-7 top-16 h-px bg-slate-300" />
        <div className="absolute inset-x-7 top-24 h-px bg-slate-300" />
        <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
          <polyline
            points="34,104 58,92 82,98 107,72 132,81 158,51 184,58 212,38 244,44"
            fill="none"
            stroke={svgStroke(props.feed.tone)}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-md border border-white/80 bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-800">
          <Icon className={cn('h-3.5 w-3.5', toneText(props.feed.tone))} />
          {props.feed.symbol} {props.feed.timeframe}
        </div>
        <div className="absolute bottom-4 right-4 rounded-md border border-white/80 bg-white/90 px-2 py-1 font-mono text-[11px] text-slate-800">
          {props.feed.score}%
        </div>
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-semibold text-slate-950">{props.feed.source}</div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-slate-500">{props.feed.status}</span>
          <span className={cn('font-mono', toneText(props.feed.tone))}>AI valid</span>
        </div>
      </div>
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

function ScheduleRow(props: { label: string; value: string; tone: Tone }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 p-2 text-xs">
      <span className="text-slate-600">{props.label}</span>
      <span className={cn('font-mono font-semibold', toneText(props.tone))}>{props.value}</span>
    </div>
  );
}

function LegendItem(props: { tone: Tone; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-2.5 w-2.5 rounded-full', toneDot(props.tone))} />
      <span className="truncate text-slate-600">{props.label}</span>
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

function BarChartIcon(props: { className?: string }) {
  return <Layers3 className={props.className} />;
}

function svgStroke(tone: Tone): string {
  return {
    navy: '#0f172a',
    blue: '#2563eb',
    purple: '#7c3aed',
    emerald: '#059669',
    orange: '#f97316',
    rose: '#e11d48',
    slate: '#475569',
  }[tone];
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
