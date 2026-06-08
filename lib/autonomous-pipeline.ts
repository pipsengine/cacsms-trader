import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BrainCircuit,
  Camera,
  CandlestickChart,
  Crosshair,
  Globe2,
  Layers3,
  MonitorCheck,
  Network,
  Radar,
  ShieldCheck,
  Target,
  Zap,
} from 'lucide-react';

export type PipelineStageStatus = 'not_started' | 'in_progress' | 'completed';

export type PipelineStageId =
  | 'terminal-connectivity'
  | 'pair-selection'
  | 'chart-navigation'
  | 'top-down-capture'
  | 'visual-detection'
  | 'mtf-fusion'
  | 'cacsms-vision'
  | 'macro-intelligence'
  | 'signal-generation'
  | 'risk-gate'
  | 'execution'
  | 'trade-monitoring'
  | 'unattended-operations';

export interface PipelineStageDefinition {
  id: PipelineStageId;
  order: number;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  /** Canonical implemented tool for this stage (matches sidebar destination). */
  primaryHref: string;
  primaryLabel: string;
  /** Optional extra tools shown on the pipeline dashboard only — no sidebar duplication. */
  relatedTools?: Array<{ label: string; href: string }>;
}

export const PIPELINE_STAGE_STATUS_META: Record<
  PipelineStageStatus,
  { label: string; bg: string; text: string; border: string; dot: string; ring: string }
> = {
  not_started: {
    label: 'Not Started',
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-200',
    dot: 'bg-slate-400',
    ring: 'ring-slate-200',
  },
  in_progress: {
    label: 'In Progress',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
    ring: 'ring-amber-200',
  },
  completed: {
    label: 'Completed',
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
    ring: 'ring-emerald-200',
  },
};

export const AUTONOMY_TIMEFRAME_SEQUENCE = ['W', 'D', 'H4', 'H1', 'M15'] as const;

export const PIPELINE_STAGES: PipelineStageDefinition[] = [
  {
    id: 'terminal-connectivity',
    order: 1,
    label: 'Terminal Connectivity',
    shortLabel: 'Connectivity',
    description: 'MT5 bridge online, terminal heartbeat fresh, and demo terminal ready for autonomous control.',
    icon: Network,
    primaryHref: '/mt5-infrastructure/terminal-operations/connected-terminals',
    primaryLabel: 'Connected terminals',
    relatedTools: [
      { label: 'Terminal heartbeat', href: '/mt5-infrastructure/terminal-operations/terminal-heartbeat' },
      { label: 'Latency monitoring', href: '/mt5-infrastructure/terminal-operations/live-latency-monitoring' },
    ],
  },
  {
    id: 'pair-selection',
    order: 2,
    label: 'Autonomous Pair Selection',
    shortLabel: 'Pair Select',
    description: 'Market intelligence ranks watchlist pairs by spread, session, liquidity, and macro alignment before chart navigation.',
    icon: Crosshair,
    primaryHref: '/autonomous-pipeline#pair-selection',
    primaryLabel: 'Pair selection monitor',
    relatedTools: [
      { label: 'Fundamental bias scoring', href: '/economic-news-and-sentiment-intelligence/fundamental-bias-scoring' },
    ],
  },
  {
    id: 'chart-navigation',
    order: 3,
    label: 'MT5 Chart Navigation',
    shortLabel: 'Navigation',
    description: 'Server commands MT5 to open the symbol and step through higher-to-lower timeframes without human input.',
    icon: CandlestickChart,
    primaryHref: '/mt5-infrastructure/terminal-operations/ea-communication-engine',
    primaryLabel: 'EA communication engine',
    relatedTools: [
      { label: 'Pipeline session control', href: '/autonomous-pipeline#chart-navigation' },
    ],
  },
  {
    id: 'top-down-capture',
    order: 4,
    label: 'Top-Down Chart Capture',
    shortLabel: 'Capture',
    description: 'Sequential capture session across W → D → H4 → H1 → M15 on the active symbol.',
    icon: Camera,
    primaryHref: '/visual-intelligence-overview/chart-screenshot-capture',
    primaryLabel: 'Chart screenshot capture',
    relatedTools: [
      { label: 'Start capture session', href: '/autonomous-pipeline#top-down-capture' },
    ],
  },
  {
    id: 'visual-detection',
    order: 5,
    label: 'Visual Detection',
    shortLabel: 'Detection',
    description: 'Detector chain runs on each captured timeframe: candles, swings, patterns, structure, liquidity.',
    icon: Radar,
    primaryHref: '/visual-intelligence-overview',
    primaryLabel: 'Visual intelligence overview',
  },
  {
    id: 'mtf-fusion',
    order: 6,
    label: 'Multi-Timeframe Fusion',
    shortLabel: 'MTF Fusion',
    description: 'Top-down alignment, conflict resolution, and controlling timeframe selection.',
    icon: Layers3,
    primaryHref: '/visual-intelligence-overview/multi-timeframe-comparison',
    primaryLabel: 'Multi-timeframe comparison',
  },
  {
    id: 'cacsms-vision',
    order: 7,
    label: 'Cacsms Vision Analysis',
    shortLabel: 'Vision',
    description: 'Fused institutional interpretation, liquidity map, and execution readiness scoring.',
    icon: BrainCircuit,
    primaryHref: '/cacsms-vision',
    primaryLabel: 'Cacsms Vision intelligence room',
  },
  {
    id: 'macro-intelligence',
    order: 8,
    label: 'Macro Intelligence',
    shortLabel: 'Macro',
    description: 'Economic calendar, COT, rates, and news blackout fused into trade context.',
    icon: Globe2,
    primaryHref: '/economic-news-and-sentiment-intelligence/economic-calendar',
    primaryLabel: 'Economic calendar',
    relatedTools: [
      { label: 'COT positioning', href: '/economic-news-and-sentiment-intelligence/cot-institutional-positioning' },
      { label: 'Interest rates', href: '/economic-news-and-sentiment-intelligence/monetary-policy-and-interest-rates' },
      { label: 'News blackout', href: '/economic-news-and-sentiment-intelligence/news-risk-and-blackout-windows' },
    ],
  },
  {
    id: 'signal-generation',
    order: 9,
    label: 'Signal Generation',
    shortLabel: 'Signals',
    description: 'Autonomous BUY/SELL/MONITOR decisions from fused visual and macro evidence.',
    icon: Target,
    primaryHref: '/cacsms-vision',
    primaryLabel: 'Trade opportunity radar',
  },
  {
    id: 'risk-gate',
    order: 10,
    label: 'Risk Gate',
    shortLabel: 'Risk',
    description: 'Prop-firm guardrails, kill switch, drawdown limits, and news blackout enforcement.',
    icon: ShieldCheck,
    primaryHref: '/economic-news-and-sentiment-intelligence/news-risk-and-blackout-windows',
    primaryLabel: 'News risk & blackout windows',
    relatedTools: [
      { label: 'Pipeline risk status', href: '/autonomous-pipeline#risk-gate' },
    ],
  },
  {
    id: 'execution',
    order: 11,
    label: 'Execution',
    shortLabel: 'Execution',
    description: 'Approved intents converted to MT5 commands with acknowledgment and audit trail.',
    icon: Zap,
    primaryHref: '/mt5-infrastructure/terminal-operations/mt5-execution-bridge',
    primaryLabel: 'MT5 execution bridge',
    relatedTools: [
      { label: 'Execution audit journal', href: '/mt5-infrastructure/terminal-operations/execution-audit-journal' },
    ],
  },
  {
    id: 'trade-monitoring',
    order: 12,
    label: 'Trade Monitoring',
    shortLabel: 'Monitoring',
    description: 'Live position lifecycle: break-even, trail, partial close, and emergency exit.',
    icon: BarChart3,
    primaryHref: '/mt5-infrastructure/terminal-operations/execution-audit-journal',
    primaryLabel: 'Execution audit journal',
  },
  {
    id: 'unattended-operations',
    order: 13,
    label: 'Unattended Operations',
    shortLabel: 'Operations',
    description: '24/7 scheduler, failure recovery, watchdog, and autonomous session continuity.',
    icon: MonitorCheck,
    primaryHref: '/autonomous-pipeline#unattended-operations',
    primaryLabel: 'Pipeline operations monitor',
    relatedTools: [
      { label: 'EA deployment', href: '/mt5-infrastructure/terminal-operations/ea-deployment' },
    ],
  },
];

export function pipelineStageById(id: PipelineStageId): PipelineStageDefinition | undefined {
  return PIPELINE_STAGES.find((stage) => stage.id === id);
}
