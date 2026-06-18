'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Camera,
  CheckCircle2,
  Clock,
  Crosshair,
  Eye,
  Globe2,
  LayoutDashboard,
  Lock,
  Menu,
  Network,
  PlayCircle,
  RefreshCw,
  Radio,
  Shield,
  Square,
  ShieldAlert,
  Target,
  TrendingUp,
  Workflow,
  Zap,
  MonitorCheck,
} from 'lucide-react';

import { useContinuousTradingSession } from '@/components/continuous-trading-session-provider';
import { PairSelectionLivePanel } from '@/components/pair-selection-live-panel';
import { DashboardPageFrame } from '@/components/dashboard-page-frame';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PIPELINE_STAGE_STATUS_META } from '@/lib/autonomous-pipeline';
import {
  PROP_FIRM_RULE_CATEGORY_TONE,
  type PropFirmRuleCategory,
  type PropFirmRuleStatus,
} from '@/lib/prop-firm-types';
import {
  type DashboardTone,
  toneBadge,
  toneBody,
  toneCard,
  toneCardHeader,
  toneInsetSurface,
  toneMetric,
  toneMuted,
  toneProgress,
  toneTitle,
} from '@/lib/dashboard-card-tones';
import { cn } from '@/lib/utils';

type OverviewPayload = {
  generatedAt: string;
  systemHealth: {
    level: 'healthy' | 'degraded' | 'critical';
    summary: string;
    checks: Array<{ id: string; label: string; status: 'ok' | 'warn' | 'error'; detail: string }>;
  };
  pipeline: {
    mode: string;
    activeSymbol: string;
    pairSelection: {
      selectedSymbol: string;
      selectedAt: string | null;
      source: string;
      session: string;
    } | null;
    bridgeOnline: boolean;
    connectedTerminals: number;
    overallStatus: string;
    overallProgress: number;
    currentStage: string;
    stages: Array<{
      id: string;
      order: number;
      shortLabel: string;
      label: string;
      status: 'not_started' | 'in_progress' | 'completed';
      progress: number;
      detail: string;
    }>;
  };
  trading: {
    totalEquity: number;
    totalBalance: number;
    connectedTerminals: number;
    degradedTerminals: number;
    openPositions: number;
    terminalOpen: number;
    trackedOpen: number;
    executedToday: number;
    queuedCommands: number;
    terminals: Array<{
      terminalId: string;
      accountNumber: string;
      brokerName: string;
      status: string;
      equity: number;
      balance: number;
      openOrders: number;
      heartbeatAgeMs: number | null;
    }>;
    openPositionDetails: Array<{
      ticket: string;
      symbol: string | null;
      side: string | null;
      volumeLots: number | null;
      profitLoss: number;
    }>;
  };
  risk: {
    continuousTradingEnabled?: boolean;
    remainingDailyLossAmount?: number;
    propFirmSizingEquity?: number;
    dailyTradeLimitEnabled: boolean;
    maxTradesPerDay: number;
    tradesPerSymbolPerDay: number;
    activeSymbolCount: number;
    symbolBasedTradeLimit: boolean;
    maxOpenPositions: number;
    openPositions: number;
    remainingOpenPositions: number;
    tradesOpenedToday: number;
    remainingTradesToday: number | null;
    killSwitch: { active: boolean; reason: string | null; operator: string | null; source: string };
  };
  autonomy: {
    mode: string;
    runningJobs: number;
    queuedJobs: number;
    openAlerts: number;
    recentFailures: number;
    nextRunAt: string | null;
    latestJobs: Array<{ id: string; workerName: string; status: string; symbol: string | null; createdAt: string }>;
  };
  intelligence: {
    activeSymbol: string;
    latestDecision: {
      decision: string;
      confidenceScore: number;
      finalBias: string;
      timeframe: string;
      reasonForDecision: string;
      createdAt: string;
    } | null;
    visionConfidence: number | null;
    captureTotal: number;
    topDownCoverage: Record<string, boolean>;
    topDownComplete: boolean;
  };
  macro: {
    upcomingHighImpact: Array<{ id: string; title: string; currency: string; impactLevel: string; utcEventTime: string }>;
    activeHighImpactWindow: number;
  };
  database: { ok: boolean; latencyMs: number | null; databaseName: string | null };
  recentActivity: Array<{ source: string; message: string; time: string; meta?: string }>;
  propFirm: {
    firmName: string;
    rewardNote: string;
    phaseLabel: string;
    profitTargetPercent: number;
    profitProgressPercent: number;
    dailyDrawdownPercent: number;
    dailyDrawdownLimitPercent: number;
    maxDrawdownPercent: number;
    maxDrawdownLimitPercent: number;
    tradingDaysCompleted: number;
    minimumTradingDays: number;
    reducedTradingDays: number;
    newsTradingAllowed: boolean;
    firstWithdrawalDays: number;
    remainingDailyLossAmount: number;
    riskAllowed: boolean;
    riskMessage: string;
    rules: Array<{
      category: PropFirmRuleCategory;
      label: string;
      limit: string;
      current: string;
      status: PropFirmRuleStatus;
      progressPercent?: number;
    }>;
  };
  live: { tickSequence: number; tickAt: string };
  continuousTrading: {
    active: boolean;
    startedAt: string | null;
    stoppedAt: string | null;
    minOpenPositions: number;
    maxEntriesPerCycle: number;
    targetDescription: string;
    lastMaintenance: {
      at: string | null;
      trigger: string | null;
      targets: string[];
      dispatchesAttempted: number;
      openCount: number | null;
    } | null;
    periodPnl: {
      todayUsd: number;
      weekUsd: number;
      monthUsd: number;
      timezone: string;
    };
  };
  tradeProtection: {
    monitorEnabled: boolean;
    monitorTickMs: number;
    summary: {
      basketCount: number;
      totalFloatingUsd: number;
      highestLockedUsd: number;
      anyReversal: boolean;
    };
    eaLocalBasketLock: boolean;
    eaBasketProtectionEnabled: boolean;
    baskets: Array<{
      basketId: string;
      symbol: string;
      side: string;
      legCount: number;
      floatingProfitUsd: number;
      peakProfitUsd: number;
      lockedProfitUsd: number;
      activationUsd: number;
      nextTierTriggerUsd: number | null;
      nextTierLockUsd: number | null;
      tierLabel: string | null;
      givebackToCloseUsd: number;
      drawdownFromPeakUsd: number;
      protectionSource: 'ea' | 'server';
      eaManaged: boolean;
      closeArmed: boolean;
      status: 'inactive' | 'armed' | 'locked' | 'reversal' | 'closing';
      statusLabel: string;
      statusDetail: string;
      reversalDetected: boolean;
      brokerStopLoss: number | null;
      brokerTakeProfit: number | null;
      legs: Array<{
        ticket: string;
        profitLoss: number;
        stopLoss: number | null;
        takeProfit: number | null;
        breakEvenApplied: boolean;
        profitLockApplied: boolean;
        lastLockedSl: number | null;
      }>;
    }>;
    orphanLegs: Array<{
      ticket: string;
      symbol: string;
      side: string;
      profitLoss: number;
      trailingPoints: number;
      breakEvenApplied: boolean;
      profitLockApplied: boolean;
      lastLockedSl: number | null;
      stopLoss: number | null;
      takeProfit: number | null;
      lastAction: string | null;
    }>;
  };
};

type DashboardTick = {
  sequence: number;
  tickAt: string;
  bridge: { online: boolean; connected: number; degraded: number; disconnected: number };
  trading: OverviewPayload['trading'];
  propFirm: OverviewPayload['propFirm'];
  continuousTrading?: OverviewPayload['continuousTrading'];
};

const BASKET_STATUS_TONE: Record<
  OverviewPayload['tradeProtection']['baskets'][number]['status'],
  DashboardTone
> = {
  inactive: 'slate',
  armed: 'amber',
  locked: 'emerald',
  reversal: 'rose',
  closing: 'rose',
};

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${value.toFixed(2)}`;
}

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';
  return value.toFixed(2);
}

function floatingTone(value: number): DashboardTone {
  if (value >= 20) return 'emerald';
  if (value > 0.5) return 'cyan';
  if (value <= -0.5) return 'rose';
  return 'amber';
}

function protectionTone(overview: OverviewPayload['tradeProtection']): DashboardTone {
  if (overview.summary.anyReversal) return 'rose';
  if (overview.summary.highestLockedUsd > 0) return 'emerald';
  if (overview.eaBasketProtectionEnabled) return 'cyan';
  return 'slate';
}

function closeConditionTone(
  basket: OverviewPayload['tradeProtection']['baskets'][number],
): DashboardTone {
  if (basket.closeArmed || basket.status === 'reversal' || basket.status === 'closing') return 'rose';
  if (basket.lockedProfitUsd > 0 && basket.givebackToCloseUsd <= 5) return 'amber';
  if (basket.lockedProfitUsd > 0) return 'emerald';
  return 'slate';
}

function lockTierTone(lockedUsd: number): DashboardTone {
  if (lockedUsd >= 80) return 'emerald';
  if (lockedUsd >= 40) return 'cyan';
  if (lockedUsd > 0) return 'violet';
  return 'amber';
}

const HEALTH_TONE: Record<OverviewPayload['systemHealth']['level'], DashboardTone> = {
  healthy: 'emerald',
  degraded: 'amber',
  critical: 'rose',
};

const QUICK_LINKS = [
  { label: 'Pipeline', href: '/autonomous-pipeline', icon: Workflow },
  { label: 'Vision room', href: '/cacsms-vision', icon: BrainCircuit },
  { label: 'Chart capture', href: '/visual-intelligence-overview/chart-screenshot-capture', icon: Camera },
  { label: 'MT5 ops', href: '/mt5-infrastructure/terminal-operations/connected-terminals', icon: Network },
  { label: 'Calendar', href: '/economic-news-and-sentiment-intelligence/economic-calendar', icon: Globe2 },
  { label: 'Visual intel', href: '/visual-intelligence-overview', icon: Eye },
] as const;

const TOP_DOWN_TIMEFRAMES = ['W', 'D', 'H4', 'H1', 'M15'] as const;

type MarketSessionStatus = {
  open: boolean;
  label: string;
  detail: string;
  tone: DashboardTone;
};

function createBootstrapOverviewFromTick(tick: DashboardTick): OverviewPayload {
  return {
    generatedAt: tick.tickAt,
    systemHealth: {
      level: tick.bridge.online ? 'healthy' : 'degraded',
      summary: 'Live trading data loaded — fetching full system snapshot…',
      checks: [],
    },
    pipeline: {
      mode: 'full_auto',
      activeSymbol: 'AUTO',
      pairSelection: null,
      bridgeOnline: tick.bridge.online,
      connectedTerminals: tick.bridge.connected,
      overallStatus: 'in_progress',
      overallProgress: 0,
      currentStage: 'terminal-connectivity',
      stages: [],
    },
    trading: {
      totalEquity: tick.trading.totalEquity,
      totalBalance: tick.trading.totalBalance,
      connectedTerminals: tick.trading.connectedTerminals,
      degradedTerminals: tick.trading.degradedTerminals,
      openPositions: tick.trading.openPositions,
      terminalOpen: tick.trading.terminalOpen,
      trackedOpen: tick.trading.trackedOpen,
      executedToday: 0,
      queuedCommands: 0,
      terminals: tick.trading.terminals.slice(0, 6).map((terminal) => ({
        terminalId: terminal.terminalId,
        accountNumber: terminal.accountNumber,
        brokerName: terminal.brokerName,
        status: terminal.status,
        equity: terminal.equity,
        balance: terminal.balance,
        openOrders: terminal.openOrders,
        heartbeatAgeMs: terminal.heartbeatAgeMs,
      })),
      openPositionDetails: tick.trading.openPositionDetails,
    },
    risk: {
      continuousTradingEnabled: true,
      remainingDailyLossAmount: 0,
      propFirmSizingEquity: 0,
      dailyTradeLimitEnabled: false,
      maxTradesPerDay: 0,
      tradesPerSymbolPerDay: 1,
      activeSymbolCount: 0,
      symbolBasedTradeLimit: true,
      maxOpenPositions: 0,
      openPositions: 0,
      remainingOpenPositions: 0,
      tradesOpenedToday: 0,
      remainingTradesToday: null,
      killSwitch: { active: false, reason: null, operator: null, source: 'none' },
    },
    autonomy: {
      mode: 'full_auto',
      runningJobs: 0,
      queuedJobs: 0,
      openAlerts: 0,
      recentFailures: 0,
      nextRunAt: null,
      latestJobs: [],
    },
    intelligence: {
      activeSymbol: 'AUTO',
      latestDecision: null,
      visionConfidence: null,
      captureTotal: 0,
      topDownCoverage: {},
      topDownComplete: false,
    },
    macro: { upcomingHighImpact: [], activeHighImpactWindow: 0 },
    database: { ok: true, latencyMs: null, databaseName: null },
    recentActivity: [],
    propFirm: tick.propFirm,
    live: { tickSequence: tick.sequence, tickAt: tick.tickAt },
    continuousTrading: {
      active: tick.continuousTrading?.active ?? false,
      startedAt: tick.continuousTrading?.startedAt ?? null,
      stoppedAt: tick.continuousTrading?.stoppedAt ?? null,
      minOpenPositions: 1,
      maxEntriesPerCycle: 3,
      targetDescription: 'Loading continuous trading session…',
      lastMaintenance: null,
      periodPnl: {
        todayUsd: tick.continuousTrading?.periodPnl?.todayUsd ?? 0,
        weekUsd: tick.continuousTrading?.periodPnl?.weekUsd ?? 0,
        monthUsd: tick.continuousTrading?.periodPnl?.monthUsd ?? 0,
        timezone: 'Africa/Lagos',
      },
    },
    tradeProtection: {
      monitorEnabled: true,
      monitorTickMs: 2000,
      eaLocalBasketLock: true,
      eaBasketProtectionEnabled: false,
      summary: { basketCount: 0, totalFloatingUsd: 0, highestLockedUsd: 0, anyReversal: false },
      baskets: [],
      orphanLegs: [],
    },
  };
}

export function CommandCenterDashboard() {
  const tradingSession = useContinuousTradingSession();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const [tickSequence, setTickSequence] = useState(0);
  const [streamConnected, setStreamConnected] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  const sessionActive = tradingSession.loaded
    ? tradingSession.active
    : (overview?.continuousTrading.active ?? false);
  const sessionBusy = tradingSession.busy;
  const sessionMessage = tradingSession.message;
  const marketStatus = useMemo(() => getMarketSessionStatus(clockNow), [clockNow]);

  const applyTick = useCallback((tick: DashboardTick) => {
    setTickSequence(tick.sequence);
    setLastTickAt(tick.tickAt);
    setOverview((current) => {
      const base = current ?? createBootstrapOverviewFromTick(tick);
      return {
        ...base,
        pipeline: {
          ...base.pipeline,
          bridgeOnline: tick.bridge.online,
          connectedTerminals: tick.bridge.connected,
        },
        trading: {
          ...base.trading,
          totalEquity: tick.trading.totalEquity,
          totalBalance: tick.trading.totalBalance,
          connectedTerminals: tick.trading.connectedTerminals,
          degradedTerminals: tick.trading.degradedTerminals,
          openPositions: tick.trading.openPositions,
          terminalOpen: tick.trading.terminalOpen,
          trackedOpen: tick.trading.trackedOpen,
          terminals: tick.trading.terminals.slice(0, 6).map((terminal) => ({
            terminalId: terminal.terminalId,
            accountNumber: terminal.accountNumber,
            brokerName: terminal.brokerName,
            status: terminal.status,
            equity: terminal.equity,
            balance: terminal.balance,
            openOrders: terminal.openOrders,
            heartbeatAgeMs: terminal.heartbeatAgeMs,
          })),
          openPositionDetails: tick.trading.openPositionDetails,
        },
        propFirm: tick.propFirm,
        live: { tickSequence: tick.sequence, tickAt: tick.tickAt },
        continuousTrading: tick.continuousTrading
          ? {
            ...base.continuousTrading,
            active: tick.continuousTrading.active,
            startedAt: tick.continuousTrading.startedAt,
            stoppedAt: tick.continuousTrading.stoppedAt,
            periodPnl: tick.continuousTrading.periodPnl
              ? {
                ...base.continuousTrading.periodPnl,
                ...tick.continuousTrading.periodPnl,
              }
              : base.continuousTrading.periodPnl,
            targetDescription: tick.continuousTrading.active
              ? 'Institutional refill active — maintains uncorrelated open exposure until daily drawdown limit.'
              : 'Stopped — press Start on the command center to resume autonomous trading.',
          }
          : base.continuousTrading,
      };
    });
  }, []);

  const loadOverview = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const response = await fetch('/api/dashboard/overview', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(String(payload.error ?? 'Unable to load system overview.'));
      }
      setOverview(payload.overview as OverviewPayload);
      setLastSyncAt(new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load system overview.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/dashboard/tick', { cache: 'no-store' });
        const payload = await response.json();
        if (!cancelled && response.ok && payload.ok) {
          applyTick(payload.tick as DashboardTick);
        }
      } catch {
        // overview fetch will still run
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    void loadOverview(true);
    const interval = window.setInterval(() => void loadOverview(true), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [applyTick, loadOverview]);

  useEffect(() => {
    let source: EventSource | null = null;
    let pollTimer: number | null = null;
    let closed = false;

    const handleTickPayload = (payload: DashboardTick) => {
      if (!closed) applyTick(payload);
    };

    const startPollingFallback = () => {
      if (pollTimer != null) return;
      pollTimer = window.setInterval(async () => {
        try {
          const response = await fetch('/api/dashboard/tick', { cache: 'no-store' });
          const payload = await response.json();
          if (response.ok && payload.ok) handleTickPayload(payload.tick as DashboardTick);
        } catch {
          // keep polling
        }
      }, 1000);
    };

    try {
      source = new EventSource('/api/dashboard/overview/stream');
      source.addEventListener('open', () => {
        setStreamConnected(true);
        if (pollTimer != null) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
      });
      source.addEventListener('tick', (event) => {
        try {
          handleTickPayload(JSON.parse(event.data) as DashboardTick);
        } catch {
          // ignore malformed tick
        }
      });
      source.addEventListener('error', () => {
        setStreamConnected(false);
        source?.close();
        source = null;
        startPollingFallback();
      });
    } catch {
      startPollingFallback();
    }

    return () => {
      closed = true;
      source?.close();
      if (pollTimer != null) window.clearInterval(pollTimer);
    };
  }, [applyTick]);

  const healthTone = overview ? HEALTH_TONE[overview.systemHealth.level] : 'slate';
  const currentStage = useMemo(
    () => overview?.pipeline.stages.find((stage) => stage.id === overview.pipeline.currentStage) ?? null,
    [overview],
  );

  const decisionTone: DashboardTone = useMemo(() => {
    const decision = overview?.intelligence.latestDecision?.decision?.toUpperCase() ?? '';
    if (decision.includes('BUY')) return 'emerald';
    if (decision.includes('SELL')) return 'rose';
    if (decision.includes('WAIT') || decision.includes('MONITOR')) return 'amber';
    return 'slate';
  }, [overview]);

  const equityTone: DashboardTone = useMemo(() => {
    if (!overview) return 'cyan';
    const equity = overview.trading.totalEquity;
    const balance = overview.trading.totalBalance;
    const delta = equity - balance;
    if (Math.abs(delta) < 0.5) return 'cyan';
    return delta > 0 ? 'emerald' : 'rose';
  }, [overview]);

  const equityDetail = useMemo(() => {
    if (!overview) return '—';
    const equity = overview.trading.totalEquity;
    const balance = overview.trading.totalBalance;
    const delta = equity - balance;
    const floating =
      Math.abs(delta) < 0.5
        ? 'flat'
        : `${delta > 0 ? '+' : ''}${formatMoney(delta)} floating`;
    return `Balance ${formatMoney(balance)} · ${floating}`;
  }, [overview]);

  return (
    <DashboardPageFrame
      bridgeOnline={overview?.pipeline.bridgeOnline ?? false}
      mobileOpen={mobileSidebarOpen}
      onMobileOpenChange={setMobileSidebarOpen}
    >
      <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white px-4 py-4 md:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button size="icon" variant="outline" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700">Executive command center</p>
                <h1 className="truncate text-xl font-semibold text-slate-950">System overview</h1>
                <p className="truncate text-xs font-mono text-slate-500">
                  WAT {formatWatClock(clockNow)}
                  {' · '}
                  {streamConnected ? 'Live tick' : 'Polling tick'} #{tickSequence || overview?.live.tickSequence || 0}
                  {' · '}
                  {formatRelativeTime(lastTickAt ?? overview?.live.tickAt ?? lastSyncAt, clockNow)}
                  {refreshing ? ' · snapshot updating…' : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {sessionActive ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={sessionBusy}
                  onClick={() => void tradingSession.stop()}
                >
                  <Square className="mr-2 h-4 w-4" />
                  {sessionBusy ? 'Stopping…' : 'Stop trading'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={sessionBusy}
                  onClick={() => void tradingSession.start()}
                >
                  <PlayCircle className="mr-2 h-4 w-4" />
                  {sessionBusy ? 'Starting…' : 'Start trading'}
                </Button>
              )}
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                  sessionActive ? toneBadge('emerald') : toneBadge('slate'),
                )}
              >
                <Activity className={cn('h-3 w-3', sessionActive && 'animate-pulse')} />
                {sessionActive ? 'Session live' : tradingSession.loaded ? 'Session stopped' : 'Checking session…'}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                  streamConnected ? toneBadge('emerald') : toneBadge('amber'),
                )}
              >
                <Radio className={cn('h-3 w-3', streamConnected && 'animate-pulse')} />
                {streamConnected ? 'SSE live' : 'Tick poll'}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                  toneBadge(marketStatus.tone),
                )}
                title={marketStatus.detail}
              >
                <Clock className={cn('h-3 w-3', marketStatus.open && 'animate-pulse')} />
                {marketStatus.label}
                <span className="hidden font-medium opacity-80 2xl:inline">{marketStatus.detail}</span>
              </span>
              <Button variant="outline" size="sm" onClick={() => void loadOverview(false)} disabled={loading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', (loading || refreshing) && 'animate-spin')} />
                Refresh
              </Button>
              {QUICK_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}
                >
                  <link.icon className="h-4 w-4" />
                  <span className="hidden 2xl:inline">{link.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-white p-4 md:p-6">
          {error ? (
            <Card className="mb-4 border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </CardContent>
            </Card>
          ) : null}

          {loading && !overview ? (
            <p className="text-sm text-slate-600">Loading live trading snapshot…</p>
          ) : overview ? (
            <>
              <section
                className={cn(
                  'mb-4 rounded-2xl border p-4 shadow-sm',
                  toneCard(sessionActive ? 'emerald' : 'slate'),
                )}
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className={cn('text-[11px] font-bold uppercase tracking-[0.18em]', toneMuted(sessionActive ? 'emerald' : 'slate'))}>
                        Institutional continuous trading
                      </p>
                      <p className={cn('text-lg font-semibold', toneTitle(sessionActive ? 'emerald' : 'slate'))}>
                        {sessionActive ? 'Session running' : tradingSession.loaded ? 'Session stopped' : 'Checking session…'}
                      </p>
                      <p className={cn('text-sm', toneBody(sessionActive ? 'emerald' : 'slate'))}>
                        {overview.continuousTrading.targetDescription}
                      </p>
                      {sessionMessage ? (
                        <p className="mt-2 text-xs font-medium text-slate-700">{sessionMessage}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {sessionActive ? (
                        <Button variant="destructive" disabled={sessionBusy} onClick={() => void tradingSession.stop()}>
                          <Square className="mr-2 h-4 w-4" />
                          {sessionBusy ? 'Stopping…' : 'Stop trading'}
                        </Button>
                      ) : (
                        <Button
                          className="bg-emerald-600 hover:bg-emerald-700"
                          disabled={sessionBusy}
                          onClick={() => void tradingSession.start()}
                        >
                          <PlayCircle className="mr-2 h-4 w-4" />
                          {sessionBusy ? 'Starting…' : 'Start trading'}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Card className={cn('border shadow-none', toneCard(floatingTone(overview.tradeProtection.summary.totalFloatingUsd)))}>
                      <CardHeader className={cn('pb-2 pt-3', toneCardHeader(floatingTone(overview.tradeProtection.summary.totalFloatingUsd)))}>
                        <CardTitle className={cn('text-xs font-semibold uppercase tracking-wide', toneTitle(floatingTone(overview.tradeProtection.summary.totalFloatingUsd)))}>Exposure</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 pb-3 text-sm">
                        <p><span className="text-slate-600">Open now</span> <span className="font-semibold">{overview.trading.openPositions}</span></p>
                        <p><span className="text-slate-600">Slots left</span> <span className="font-semibold">{overview.risk.remainingOpenPositions}</span></p>
                        <p><span className="text-slate-600">Floating P/L</span> <span className={cn('font-semibold', toneTitle(floatingTone(overview.tradeProtection.summary.totalFloatingUsd)))}>{formatUsd(overview.tradeProtection.summary.totalFloatingUsd)}</span></p>
                        <p><span className="text-slate-600">Daily budget</span> <span className="font-semibold">{formatUsd(overview.risk.remainingDailyLossAmount)}</span></p>
                      </CardContent>
                    </Card>

                    <Card className={cn('border shadow-none', toneCard(floatingTone(overview.continuousTrading.periodPnl.todayUsd)))}>
                      <CardHeader className={cn('pb-2 pt-3', toneCardHeader(floatingTone(overview.continuousTrading.periodPnl.todayUsd)))}>
                        <CardTitle className={cn('flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', toneTitle(floatingTone(overview.continuousTrading.periodPnl.todayUsd)))}>
                          <TrendingUp className="h-3.5 w-3.5" />
                          Total P/L
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 pb-3 text-sm">
                        <p>
                          <span className={toneMuted(floatingTone(overview.continuousTrading.periodPnl.todayUsd))}>Today</span>{' '}
                          <span className={cn('font-semibold', toneTitle(floatingTone(overview.continuousTrading.periodPnl.todayUsd)))}>
                            {formatUsd(overview.continuousTrading.periodPnl.todayUsd)}
                          </span>
                        </p>
                        <p>
                          <span className={toneMuted(floatingTone(overview.continuousTrading.periodPnl.weekUsd))}>This week</span>{' '}
                          <span className={cn('font-semibold', toneTitle(floatingTone(overview.continuousTrading.periodPnl.weekUsd)))}>
                            {formatUsd(overview.continuousTrading.periodPnl.weekUsd)}
                          </span>
                        </p>
                        <p>
                          <span className={toneMuted(floatingTone(overview.continuousTrading.periodPnl.monthUsd))}>This month</span>{' '}
                          <span className={cn('font-semibold', toneTitle(floatingTone(overview.continuousTrading.periodPnl.monthUsd)))}>
                            {formatUsd(overview.continuousTrading.periodPnl.monthUsd)}
                          </span>
                        </p>
                      </CardContent>
                    </Card>

                    <Card className={cn('border shadow-none', toneCard(sessionActive ? 'blue' : 'slate'))}>
                      <CardHeader className={cn('pb-2 pt-3', toneCardHeader(sessionActive ? 'blue' : 'slate'))}>
                        <CardTitle className={cn('text-xs font-semibold uppercase tracking-wide', toneTitle(sessionActive ? 'blue' : 'slate'))}>Refill policy</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 pb-3 text-sm">
                        <p><span className="text-slate-600">Min open</span> <span className="font-semibold">{overview.continuousTrading.minOpenPositions}</span></p>
                        <p><span className="text-slate-600">Max entries/cycle</span> <span className="font-semibold">{overview.continuousTrading.maxEntriesPerCycle}</span></p>
                        {overview.continuousTrading.lastMaintenance?.at ? (
                          <p className="text-xs text-slate-700">
                            Last refill {overview.continuousTrading.lastMaintenance.dispatchesAttempted} dispatch(es)
                            {overview.continuousTrading.lastMaintenance.targets.length > 0
                              ? ` · ${overview.continuousTrading.lastMaintenance.targets.join(', ')}`
                              : ''}
                            {' · '}
                            {formatRelativeTime(overview.continuousTrading.lastMaintenance.at, clockNow)}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-600">No refill cycle recorded yet.</p>
                        )}
                      </CardContent>
                    </Card>

                    <Card className={cn('border shadow-none', toneCard(overview.tradeProtection.monitorEnabled ? 'cyan' : 'slate'))}>
                      <CardHeader className={cn('pb-2 pt-3', toneCardHeader(overview.tradeProtection.monitorEnabled ? 'cyan' : 'slate'))}>
                        <CardTitle className={cn('flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', toneTitle(overview.tradeProtection.monitorEnabled ? 'cyan' : 'slate'))}>
                          <MonitorCheck className="h-3.5 w-3.5" />
                          Trade monitor
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 pb-3 text-sm">
                        <p>
                          <span className="text-slate-600">Status</span>{' '}
                          <span className="font-semibold">{overview.tradeProtection.monitorEnabled ? 'Active' : 'Off'}</span>
                        </p>
                        <p><span className="text-slate-600">Tick interval</span> <span className="font-semibold">{overview.tradeProtection.monitorTickMs}ms</span></p>
                        <p><span className="text-slate-600">Tracked baskets</span> <span className="font-semibold">{overview.tradeProtection.summary.basketCount}</span></p>
                        <p><span className="text-slate-600">Highest lock</span> <span className="font-semibold">{formatUsd(overview.tradeProtection.summary.highestLockedUsd)}</span></p>
                      </CardContent>
                    </Card>

                    <Card className={cn('border shadow-none', toneCard(protectionTone(overview.tradeProtection)))}>
                      <CardHeader className={cn('pb-2 pt-3', toneCardHeader(protectionTone(overview.tradeProtection)))}>
                        <CardTitle className={cn('flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', toneTitle(protectionTone(overview.tradeProtection)))}>
                          <Shield className="h-3.5 w-3.5" />
                          EA protection
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 pb-3 text-sm">
                        <p>
                          <span className="text-slate-600">OnTick lock</span>{' '}
                          <span className="font-semibold">{overview.tradeProtection.eaBasketProtectionEnabled ? 'Live in EA' : 'Awaiting EA v001.007'}</span>
                        </p>
                        <p>
                          <span className="text-slate-600">Close authority</span>{' '}
                          <span className="font-semibold">{overview.tradeProtection.eaLocalBasketLock ? 'EA OnTick' : 'Server monitor'}</span>
                        </p>
                        <p><span className="text-slate-600">Open legs</span> <span className="font-semibold">{overview.trading.trackedOpen || overview.trading.openPositions}</span></p>
                        <p><span className="text-slate-600">Server telemetry</span> <span className="font-semibold">{overview.tradeProtection.monitorEnabled ? 'Active' : 'Off'}</span></p>
                      </CardContent>
                    </Card>

                    <Card className={cn(
                      'border shadow-none',
                      toneCard(overview.tradeProtection.summary.highestLockedUsd > 0 ? 'emerald' : 'violet'),
                    )}>
                      <CardHeader className={cn('pb-2 pt-3', toneCardHeader(overview.tradeProtection.summary.highestLockedUsd > 0 ? 'emerald' : 'violet'))}>
                        <CardTitle className={cn('flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', toneTitle(overview.tradeProtection.summary.highestLockedUsd > 0 ? 'emerald' : 'violet'))}>
                          <Lock className="h-3.5 w-3.5" />
                          Basket lock tiers
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 pb-3 text-xs">
                        <p className="font-medium text-slate-800">$20 → $20 · $50 → $40 · $100 → $80</p>
                        <p className="text-slate-600">EA closes all legs on the same tick when floating profit hits the locked floor. Server monitor is telemetry-only.</p>
                      </CardContent>
                    </Card>
                  </div>

                  {overview.tradeProtection.baskets.length > 0 ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {overview.tradeProtection.baskets.map((basket) => {
                        const basketTone = BASKET_STATUS_TONE[basket.status];
                        return (
                          <Card key={basket.basketId} className={cn('border shadow-none', toneCard(basketTone))}>
                            <CardHeader className={cn('pb-2', toneCardHeader(basketTone))}>
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <CardTitle className={cn('text-sm font-semibold', toneTitle(basketTone))}>
                                    {basket.symbol} {basket.side.toUpperCase()} basket · {basket.legCount} legs
                                  </CardTitle>
                                  <p className={cn('mt-0.5 text-xs', toneMuted(basketTone))}>{basket.statusDetail}</p>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', toneBadge(basketTone))}>
                                    {basket.statusLabel}
                                  </span>
                                  {basket.eaManaged ? (
                                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', toneBadge('cyan'))}>
                                      EA OnTick
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="grid gap-3 sm:grid-cols-2">
                              <div className={cn('rounded-xl border p-3', toneInsetSurface(floatingTone(basket.floatingProfitUsd)))}>
                                <p className={cn('mb-2 text-[10px] font-bold uppercase tracking-wide', toneTitle(floatingTone(basket.floatingProfitUsd)))}>
                                  Profit state
                                </p>
                                <div className="space-y-1 text-sm">
                                  <p><span className={toneMuted(floatingTone(basket.floatingProfitUsd))}>Floating</span> <span className={cn('font-semibold', toneTitle(floatingTone(basket.floatingProfitUsd)))}>{formatUsd(basket.floatingProfitUsd)}</span></p>
                                  <p><span className={toneMuted(floatingTone(basket.floatingProfitUsd))}>Peak</span> <span className={cn('font-semibold', toneTitle('emerald'))}>{formatUsd(basket.peakProfitUsd)}</span></p>
                                  <p><span className={toneMuted(floatingTone(basket.floatingProfitUsd))}>Drawdown</span> <span className={cn('font-semibold', toneTitle(basket.drawdownFromPeakUsd > 5 ? 'amber' : 'slate'))}>{formatUsd(basket.drawdownFromPeakUsd)}</span></p>
                                </div>
                              </div>

                              <div className={cn('rounded-xl border p-3', toneInsetSurface(lockTierTone(basket.lockedProfitUsd)))}>
                                <p className={cn('mb-2 text-[10px] font-bold uppercase tracking-wide', toneTitle(lockTierTone(basket.lockedProfitUsd)))}>
                                  Lock & tiers
                                </p>
                                <div className="space-y-1 text-sm">
                                  <p><span className={toneMuted(lockTierTone(basket.lockedProfitUsd))}>Locked floor</span> <span className={cn('font-semibold', toneTitle(basket.lockedProfitUsd > 0 ? 'emerald' : 'slate'))}>{formatUsd(basket.lockedProfitUsd)}</span></p>
                                  {basket.tierLabel ? (
                                    <p><span className={toneMuted(lockTierTone(basket.lockedProfitUsd))}>Active tier</span> <span className="font-semibold">{basket.tierLabel}</span></p>
                                  ) : null}
                                  {basket.nextTierTriggerUsd != null ? (
                                    <p className={cn('text-xs', toneBody(lockTierTone(basket.lockedProfitUsd)))}>
                                      Next at {formatUsd(basket.nextTierTriggerUsd)} → lock {formatUsd(basket.nextTierLockUsd)}
                                    </p>
                                  ) : (
                                    <p className={cn('text-xs', toneMuted(lockTierTone(basket.lockedProfitUsd)))}>Max tier reached</p>
                                  )}
                                </div>
                              </div>

                              <div className={cn('rounded-xl border p-3', toneInsetSurface(closeConditionTone(basket)))}>
                                <p className={cn('mb-2 text-[10px] font-bold uppercase tracking-wide', toneTitle(closeConditionTone(basket)))}>
                                  Close condition
                                </p>
                                <div className="space-y-1 text-sm">
                                  <p>
                                    <span className={toneMuted(closeConditionTone(basket))}>Status</span>{' '}
                                    <span className={cn('font-semibold', toneTitle(closeConditionTone(basket)))}>
                                      {basket.closeArmed ? 'Armed — close on this tick' : basket.lockedProfitUsd > 0 ? 'Protected' : 'Watching'}
                                    </span>
                                  </p>
                                  <p><span className={toneMuted(closeConditionTone(basket))}>Cushion</span> <span className={cn('font-semibold', toneTitle(basket.givebackToCloseUsd <= 5 && basket.lockedProfitUsd > 0 ? 'rose' : 'slate'))}>{formatUsd(basket.givebackToCloseUsd)}</span></p>
                                  <p className={cn('text-xs', toneBody(closeConditionTone(basket)))}>
                                    {basket.lockedProfitUsd > 0
                                      ? `EA closes all ${basket.legCount} legs when floating ≤ ${formatUsd(basket.lockedProfitUsd)}.`
                                      : `Lock activates when combined floating profit reaches ${formatUsd(basket.activationUsd)}.`}
                                  </p>
                                </div>
                              </div>

                              <div className={cn('rounded-xl border p-3', toneInsetSurface('slate'))}>
                                <p className={cn('mb-2 text-[10px] font-bold uppercase tracking-wide', toneTitle('slate'))}>
                                  Broker levels
                                </p>
                                <div className="space-y-1 text-sm">
                                  <p><span className={toneMuted('slate')}>S/L</span> <span className="font-semibold">{formatPrice(basket.brokerStopLoss)}</span></p>
                                  <p><span className={toneMuted('slate')}>T/P</span> <span className="font-semibold">{formatPrice(basket.brokerTakeProfit)}</span></p>
                                  <p className={cn('text-xs', toneMuted('slate'))}>Basket lock uses USD close-all, not S/L moves.</p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  ) : overview.trading.openPositions > 0 ? (
                    <Card className={cn('border shadow-none', toneInsetSurface('amber'))}>
                      <CardContent className="p-3 text-sm text-amber-900">
                        {overview.trading.openPositions} open leg(s) not grouped as a Gold basket yet — profit lock applies when ≥2 same-side legs share a basket ID or batch entry.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid gap-3 lg:grid-cols-2">
                      <Card className={cn('border shadow-none', toneCard('slate'))}>
                        <CardHeader className={cn('pb-2 pt-3', toneCardHeader('slate'))}>
                          <CardTitle className={cn('text-xs font-semibold uppercase tracking-wide', toneTitle('slate'))}>Basket protection</CardTitle>
                        </CardHeader>
                        <CardContent className="pb-3 text-sm text-slate-700">
                          No active Gold basket — combined profit lock arms when ≥2 same-side legs are open on XAUUSD.
                        </CardContent>
                      </Card>
                      <Card className={cn('border shadow-none', toneCard('slate'))}>
                        <CardHeader className={cn('pb-2 pt-3', toneCardHeader('slate'))}>
                          <CardTitle className={cn('text-xs font-semibold uppercase tracking-wide', toneTitle('slate'))}>Per-leg trailing</CardTitle>
                        </CardHeader>
                        <CardContent className="pb-3 text-sm text-slate-700">
                          No open legs under monitor — break-even, trail, and profit-lock SL apply when positions are live.
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {overview.tradeProtection.orphanLegs.length > 0 ? (
                    <Card className="border border-slate-200 shadow-none">
                      <CardHeader className="pb-2 pt-3">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">Per-leg protection & trailing</CardTitle>
                      </CardHeader>
                      <CardContent className="overflow-x-auto pb-3">
                        <table className="w-full min-w-[640px] text-left text-xs">
                          <thead>
                            <tr className="border-b text-slate-500">
                              <th className="py-1 pr-3 font-medium">Ticket</th>
                              <th className="py-1 pr-3 font-medium">Symbol</th>
                              <th className="py-1 pr-3 font-medium">P/L</th>
                              <th className="py-1 pr-3 font-medium">S/L</th>
                              <th className="py-1 pr-3 font-medium">T/P</th>
                              <th className="py-1 pr-3 font-medium">Trail pts</th>
                              <th className="py-1 pr-3 font-medium">BE</th>
                              <th className="py-1 font-medium">Lock SL</th>
                            </tr>
                          </thead>
                          <tbody>
                            {overview.tradeProtection.orphanLegs.map((leg) => (
                              <tr key={leg.ticket} className="border-b border-slate-100">
                                <td className="py-1.5 pr-3 font-mono">{leg.ticket}</td>
                                <td className="py-1.5 pr-3">{leg.symbol} {leg.side.toUpperCase()}</td>
                                <td className="py-1.5 pr-3 font-semibold">{formatUsd(leg.profitLoss)}</td>
                                <td className="py-1.5 pr-3">{formatPrice(leg.stopLoss)}</td>
                                <td className="py-1.5 pr-3">{formatPrice(leg.takeProfit)}</td>
                                <td className="py-1.5 pr-3">{leg.trailingPoints}</td>
                                <td className="py-1.5 pr-3">{leg.breakEvenApplied ? 'Yes' : 'No'}</td>
                                <td className="py-1.5">{formatPrice(leg.lastLockedSl)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              </section>

              <section className={cn('mb-4 rounded-2xl border p-4 shadow-sm', toneCard(healthTone))}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start gap-3">
                    <div className={cn('rounded-xl border p-2.5', toneMetric(healthTone))}>
                      {overview.systemHealth.level === 'healthy' ? (
                        <CheckCircle2 className={cn('h-6 w-6', toneTitle(healthTone))} />
                      ) : (
                        <ShieldAlert className={cn('h-6 w-6', toneTitle(healthTone))} />
                      )}
                    </div>
                    <div>
                      <p className={cn('text-[11px] font-bold uppercase tracking-[0.18em]', toneMuted(healthTone))}>System health</p>
                      <p className={cn('text-lg font-semibold capitalize', toneTitle(healthTone))}>{overview.systemHealth.level}</p>
                      <p className={cn('text-sm', toneBody(healthTone))}>{overview.systemHealth.summary}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {overview.systemHealth.checks.map((check) => (
                      <span
                        key={check.id}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                          check.status === 'ok'
                            ? toneBadge('emerald')
                            : check.status === 'warn'
                              ? toneBadge('amber')
                              : toneBadge('rose'),
                        )}
                        title={check.detail}
                      >
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            check.status === 'ok' ? 'bg-emerald-500' : check.status === 'warn' ? 'bg-amber-500' : 'bg-rose-500',
                          )}
                        />
                        {check.label}
                      </span>
                    ))}
                  </div>
                </div>
              </section>

              <section className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
                <MetricCard
                  tone={overview.pipeline.bridgeOnline ? 'emerald' : 'rose'}
                  icon={Network}
                  label="MT5 bridge"
                  value={overview.pipeline.bridgeOnline ? 'Online' : 'Offline'}
                  detail={`${overview.trading.connectedTerminals} connected · ${overview.trading.degradedTerminals} degraded · tick #${tickSequence || overview.live.tickSequence}`}
                  live
                />
                <MetricCard
                  tone="blue"
                  icon={Workflow}
                  label="Pipeline"
                  value={`${overview.pipeline.overallProgress}%`}
                  detail={currentStage ? `${currentStage.shortLabel} — ${currentStage.detail.slice(0, 48)}` : 'Awaiting stage data'}
                />
                <MetricCard
                  tone="violet"
                  icon={Crosshair}
                  label="Active pair"
                  value={overview.intelligence.activeSymbol}
                  detail={
                    overview.pipeline.pairSelection
                      ? `${overview.pipeline.pairSelection.session} · ${overview.pipeline.pairSelection.source}`
                      : 'Pair selection pending'
                  }
                />
                <MetricCard
                  tone={equityTone}
                  icon={TrendingUp}
                  label="Demo equity"
                  value={formatMoney(overview.trading.totalEquity)}
                  detail={equityDetail}
                  live
                />
                <MetricCard
                  tone={overview.risk.remainingOpenPositions > 0 ? 'emerald' : 'amber'}
                  icon={Target}
                  label="Open positions"
                  value={`${overview.risk.openPositions}/${overview.risk.maxOpenPositions}`}
                  detail={`Drawdown-based capacity · ${overview.risk.remainingOpenPositions} slot(s) left`}
                  live
                />
                <MetricCard
                  tone="orange"
                  icon={Zap}
                  label="Executed today"
                  value={String(overview.trading.executedToday)}
                  detail={
                    overview.risk.dailyTradeLimitEnabled
                      ? overview.risk.symbolBasedTradeLimit
                        ? `${overview.risk.remainingTradesToday ?? 0} left · ${overview.risk.tradesPerSymbolPerDay}/symbol × ${overview.risk.activeSymbolCount} symbols`
                        : `${overview.risk.remainingTradesToday ?? 0} remaining of ${overview.risk.maxTradesPerDay}`
                      : 'Daily limit disabled'
                  }
                />
                <MetricCard
                  tone={decisionTone}
                  icon={BrainCircuit}
                  label="Latest decision"
                  value={overview.intelligence.latestDecision?.decision ?? '—'}
                  detail={
                    overview.intelligence.latestDecision
                      ? `${Math.round(overview.intelligence.latestDecision.confidenceScore)}% conf · ${overview.intelligence.latestDecision.timeframe}`
                      : 'No decision logged yet'
                  }
                />
                <MetricCard
                  tone={overview.intelligence.topDownComplete ? 'emerald' : 'amber'}
                  icon={Camera}
                  label="Top-down capture"
                  value={overview.intelligence.topDownComplete ? 'Complete' : 'Partial'}
                  detail={`${overview.intelligence.captureTotal} captures · ${TOP_DOWN_TIMEFRAMES.filter((tf) => overview.intelligence.topDownCoverage[tf]).length}/5 frames`}
                />
              </section>

              <section className="mb-4">
                <Panel icon={LayoutDashboard} title="Autonomous pipeline — 13 stages" tone="blue" actionHref="/autonomous-pipeline">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className={cn('text-sm font-medium', toneBody('blue'))}>
                        Mode <span className="font-mono uppercase">{overview.pipeline.mode}</span>
                        {' · '}
                        Current <span className="font-semibold">{currentStage?.label ?? overview.pipeline.currentStage}</span>
                      </p>
                      <p className={cn('text-xs', toneMuted('blue'))}>
                        {overview.autonomy.runningJobs} job(s) running · {overview.autonomy.queuedJobs} queued
                        {overview.autonomy.nextRunAt ? ` · next run ${formatRelativeTime(overview.autonomy.nextRunAt, clockNow, true)}` : ''}
                      </p>
                    </div>
                    <div className="min-w-[200px]">
                      <div className="mb-1 flex justify-between text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                        <span>Overall</span>
                        <span>{overview.pipeline.overallProgress}%</span>
                      </div>
                      <Progress value={overview.pipeline.overallProgress} className={cn('h-2', toneProgress('blue'))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
                    {overview.pipeline.stages.map((stage) => {
                      const meta = PIPELINE_STAGE_STATUS_META[stage.status];
                      return (
                        <Link
                          key={stage.id}
                          href={`/autonomous-pipeline#${stage.id}`}
                          className={cn(
                            'rounded-xl border p-2.5 text-left shadow-sm transition hover:shadow-md',
                            meta.bg,
                            meta.border,
                          )}
                          title={stage.detail}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />
                            <span className={cn('truncate text-[10px] font-bold uppercase tracking-wide', meta.text)}>
                              {stage.shortLabel}
                            </span>
                          </div>
                          <p className={cn('mt-1 text-[10px] font-medium leading-tight', meta.text)}>{stage.progress}%</p>
                        </Link>
                      );
                    })}
                  </div>
                </Panel>
              </section>

              <section className="mb-4">
                <PairSelectionLivePanel />
              </section>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
                <section className="space-y-4">
                  <Panel icon={TrendingUp} title="Trading operations" tone="emerald" actionHref="/mt5-infrastructure/terminal-operations/connected-terminals">
                    <div className="mb-3 grid gap-2 sm:grid-cols-3">
                      <InsetMetric tone="emerald" label="Queued commands" value={String(overview.trading.queuedCommands)} />
                      <InsetMetric
                        tone={overview.risk.killSwitch.active ? 'rose' : 'emerald'}
                        label="Kill switch"
                        value={overview.risk.killSwitch.active ? 'ACTIVE' : 'Off'}
                      />
                      <InsetMetric
                        tone={overview.database.ok ? 'emerald' : 'rose'}
                        label="Database"
                        value={overview.database.ok ? `${overview.database.latencyMs ?? '—'}ms` : 'Down'}
                      />
                    </div>
                    {overview.trading.terminals.length === 0 ? (
                      <p className={cn('text-sm', toneBody('emerald'))}>No terminal heartbeats recorded yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {overview.trading.terminals.map((terminal) => {
                          const terminalTone: DashboardTone =
                            terminal.status === 'connected' ? 'emerald' : terminal.status === 'degraded' ? 'amber' : 'rose';
                          return (
                            <div key={terminal.terminalId} className={cn('rounded-xl border p-3', toneInsetSurface(terminalTone))}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className={cn('text-sm font-semibold', toneTitle(terminalTone))}>
                                    {terminal.brokerName} · {terminal.accountNumber}
                                  </p>
                                  <p className={cn('text-xs', toneMuted(terminalTone))}>
                                    {terminal.status} · equity {formatMoney(terminal.equity)} · {terminal.openOrders} open
                                  </p>
                                </div>
                                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', toneBadge(terminalTone))}>
                                  {terminal.heartbeatAgeMs != null ? `${Math.round(terminal.heartbeatAgeMs / 1000)}s ago` : '—'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {overview.trading.openPositionDetails.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        <p className={cn('text-xs font-bold uppercase tracking-wide', toneMuted('emerald'))}>Open positions</p>
                        {overview.trading.openPositionDetails.map((position) => (
                          <div key={position.ticket} className={cn('rounded-lg border px-3 py-2 text-sm', toneMetric('emerald'))}>
                            <span className="font-semibold">{position.symbol ?? '—'}</span>
                            {' '}
                            {position.side ?? ''} {position.volumeLots ?? '—'} lots
                            {' · '}
                            P/L {formatMoney(position.profitLoss)}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Panel>

                  <Panel icon={BrainCircuit} title={`Intelligence · ${overview.intelligence.activeSymbol}`} tone="violet" actionHref="/cacsms-vision">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className={cn('rounded-xl border p-4', toneMetric(decisionTone))}>
                        <p className={cn('text-[11px] font-bold uppercase tracking-wide', toneMuted(decisionTone))}>Autonomous decision</p>
                        <p className={cn('mt-1 text-2xl font-bold', toneTitle(decisionTone))}>
                          {overview.intelligence.latestDecision?.decision ?? 'WAIT'}
                        </p>
                        <p className={cn('mt-1 text-sm', toneBody(decisionTone))}>
                          Bias {overview.intelligence.latestDecision?.finalBias ?? '—'}
                          {' · '}
                          Vision {overview.intelligence.visionConfidence != null ? `${Math.round(overview.intelligence.visionConfidence)}%` : '—'}
                        </p>
                        {overview.intelligence.latestDecision ? (
                          <p className={cn('mt-2 text-xs leading-relaxed', toneMuted(decisionTone))}>
                            {overview.intelligence.latestDecision.reasonForDecision}
                          </p>
                        ) : null}
                      </div>
                      <div className={cn('rounded-xl border p-4', toneMetric('cyan'))}>
                        <p className={cn('text-[11px] font-bold uppercase tracking-wide', toneMuted('cyan'))}>Top-down coverage</p>
                        <div className="mt-2 grid grid-cols-5 gap-1.5">
                          {TOP_DOWN_TIMEFRAMES.map((timeframe) => {
                            const present = overview.intelligence.topDownCoverage[timeframe];
                            const tfTone: DashboardTone = present ? 'emerald' : 'slate';
                            return (
                              <div key={timeframe} className={cn('rounded-lg border p-2 text-center', toneMetric(tfTone))}>
                                <p className={cn('font-mono text-sm font-bold', toneTitle(tfTone))}>{timeframe}</p>
                                <p className={cn('text-[9px] font-bold uppercase', toneMuted(tfTone))}>{present ? 'OK' : '—'}</p>
                              </div>
                            );
                          })}
                        </div>
                        <Link
                          href="/visual-intelligence-overview/chart-screenshot-capture"
                          className={cn('mt-3 inline-flex items-center gap-1 text-xs font-semibold', toneTitle('cyan'))}
                        >
                          Open capture dashboard <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  </Panel>

                  <Panel icon={Globe2} title="Macro & prop firm rules" tone="orange" actionHref="/economic-news-and-sentiment-intelligence/economic-calendar">
                    <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <InsetMetric
                        tone={overview.macro.activeHighImpactWindow > 0 ? 'rose' : 'emerald'}
                        label="High-impact window"
                        value={overview.macro.activeHighImpactWindow > 0 ? `${overview.macro.activeHighImpactWindow} active` : 'Clear'}
                      />
                      <InsetMetric
                        tone={overview.risk.dailyTradeLimitEnabled ? 'amber' : 'slate'}
                        label="Daily trades"
                        value={
                          overview.risk.dailyTradeLimitEnabled
                            ? `${overview.risk.tradesOpenedToday}/${overview.risk.maxTradesPerDay}`
                            : 'Disabled'
                        }
                      />
                      <InsetMetric
                        tone={overview.risk.remainingOpenPositions > 0 ? 'emerald' : 'rose'}
                        label="Open capacity"
                        value={`${overview.risk.openPositions}/${overview.risk.maxOpenPositions}`}
                      />
                      <InsetMetric
                        tone={overview.propFirm.riskAllowed ? 'emerald' : 'rose'}
                        label={overview.propFirm.firmName}
                        value={overview.propFirm.phaseLabel}
                      />
                      <InsetMetric
                        tone={overview.propFirm.profitProgressPercent >= overview.propFirm.profitTargetPercent ? 'emerald' : 'blue'}
                        label="Profit progress"
                        value={`${overview.propFirm.profitProgressPercent.toFixed(2)}%`}
                      />
                    </div>

                    <div className={cn('mb-4 rounded-xl border p-4', toneInsetSurface('orange'))}>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className={cn('text-sm font-bold', toneTitle('orange'))}>{overview.propFirm.firmName}</p>
                          <p className={cn('text-xs', toneMuted('orange'))}>{overview.propFirm.rewardNote}</p>
                        </div>
                        <span
                          className={cn(
                            'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase',
                            overview.propFirm.riskAllowed ? toneBadge('emerald') : toneBadge('rose'),
                          )}
                        >
                          {overview.propFirm.riskAllowed ? 'Within rules' : 'Rule breach'}
                        </span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {overview.propFirm.rules.map((rule) => {
                          const categoryTone = PROP_FIRM_RULE_CATEGORY_TONE[rule.category] as DashboardTone;
                          const statusTone: DashboardTone =
                            rule.status === 'error' ? 'rose' : rule.status === 'warn' ? 'amber' : 'emerald';
                          const progressTone: DashboardTone =
                            rule.status === 'error' ? 'rose' : rule.status === 'warn' ? 'amber' : categoryTone;
                          return (
                            <div
                              key={rule.label}
                              className={cn(
                                'overflow-hidden rounded-xl border shadow-sm',
                                toneCard(categoryTone),
                                rule.status === 'error' && 'ring-2 ring-rose-300/80',
                                rule.status === 'warn' && 'ring-2 ring-amber-300/70',
                              )}
                            >
                              <div className={cn('flex items-start justify-between gap-2 border-b px-3 py-2', toneCardHeader(categoryTone))}>
                                <p className={cn('text-xs font-bold uppercase tracking-wide', toneTitle(categoryTone))}>{rule.label}</p>
                                <span className={cn('rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase', toneBadge(statusTone))}>
                                  {rule.status}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 p-3 text-xs">
                                <div className={cn('rounded-lg border p-2', toneMetric(categoryTone))}>
                                  <p className={cn('font-semibold', toneMuted(categoryTone))}>Limit</p>
                                  <p className={cn('font-mono font-bold', toneTitle(categoryTone))}>{rule.limit}</p>
                                </div>
                                <div className={cn('rounded-lg border p-2', toneInsetSurface(categoryTone))}>
                                  <p className={cn('font-semibold', toneMuted(categoryTone))}>Current</p>
                                  <p className={cn('font-mono font-bold', toneTitle(categoryTone))}>{rule.current}</p>
                                </div>
                              </div>
                              {rule.progressPercent != null ? (
                                <div className="px-3 pb-3">
                                  <div className="mb-1 flex justify-between text-[10px] font-semibold uppercase tracking-wide">
                                    <span className={toneMuted(categoryTone)}>Usage</span>
                                    <span className={toneTitle(progressTone)}>{Math.round(rule.progressPercent)}%</span>
                                  </div>
                                  <Progress value={Math.min(100, rule.progressPercent)} className={cn('h-2', toneProgress(progressTone))} />
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      <p className={cn('mt-3 text-xs', toneMuted('orange'))}>{overview.propFirm.riskMessage}</p>
                    </div>

                    {overview.macro.upcomingHighImpact.length === 0 ? (
                      <p className={cn('text-sm', toneBody('orange'))}>No high-impact events in the next 48 hours for active currencies.</p>
                    ) : (
                      <div className="space-y-2">
                        {overview.macro.upcomingHighImpact.map((event) => (
                          <div key={event.id} className={cn('rounded-xl border p-3', toneInsetSurface('orange'))}>
                            <p className={cn('text-sm font-semibold', toneTitle('orange'))}>{event.title}</p>
                            <p className={cn('text-xs', toneMuted('orange'))}>
                              {event.currency} · {event.impactLevel} · {formatWatClock(new Date(event.utcEventTime))}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </section>

                <section className="space-y-4">
                  <Panel icon={Activity} title="Live activity feed" tone="slate">
                    <ScrollArea className="h-[320px] pr-3">
                      {overview.recentActivity.length === 0 ? (
                        <p className={cn('text-sm', toneBody('slate'))}>No recent pipeline or autonomy events.</p>
                      ) : (
                        <div className="space-y-2">
                          {overview.recentActivity.map((item, index) => {
                            const sourceTone: DashboardTone =
                              item.source === 'execution' ? 'emerald' : item.source === 'autonomy' ? 'violet' : 'blue';
                            return (
                              <div key={`${item.time}-${index}`} className={cn('rounded-xl border p-3', toneInsetSurface(sourceTone))}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', toneBadge(sourceTone))}>
                                    {item.source}
                                  </span>
                                  <span className={cn('font-mono text-[10px]', toneMuted(sourceTone))}>
                                    {formatRelativeTime(item.time, clockNow)}
                                  </span>
                                </div>
                                <p className={cn('mt-2 text-sm leading-relaxed', toneBody(sourceTone))}>{item.message}</p>
                                {item.meta ? <p className={cn('mt-1 font-mono text-[10px]', toneMuted(sourceTone))}>{item.meta}</p> : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </ScrollArea>
                  </Panel>

                  <Panel icon={Zap} title="Autonomy jobs" tone="purple" actionHref="/autonomous-pipeline">
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      <InsetMetric tone="purple" label="Running" value={String(overview.autonomy.runningJobs)} />
                      <InsetMetric tone="amber" label="Alerts" value={String(overview.autonomy.openAlerts)} />
                    </div>
                    {overview.autonomy.latestJobs.length === 0 ? (
                      <p className={cn('text-sm', toneBody('purple'))}>No autonomy jobs queued yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {overview.autonomy.latestJobs.map((job) => {
                          const jobTone: DashboardTone =
                            job.status === 'completed' ? 'emerald' : job.status === 'failed' ? 'rose' : job.status === 'running' ? 'amber' : 'slate';
                          return (
                            <div key={job.id} className={cn('rounded-xl border p-3', toneInsetSurface(jobTone))}>
                              <div className="flex items-center justify-between gap-2">
                                <p className={cn('text-sm font-semibold', toneTitle(jobTone))}>{job.workerName}</p>
                                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', toneBadge(jobTone))}>
                                  {job.status}
                                </span>
                              </div>
                              <p className={cn('text-xs', toneMuted(jobTone))}>
                                {job.symbol ?? '—'} · {formatRelativeTime(job.createdAt, clockNow)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Panel>

                  <Panel icon={Clock} title="Infrastructure snapshot" tone="slate">
                    <div className="space-y-2 text-sm">
                      <Row label="Database" value={overview.database.databaseName ?? '—'} />
                      <Row label="DB latency" value={overview.database.latencyMs != null ? `${overview.database.latencyMs}ms` : '—'} />
                      <Row label="Bridge" value={overview.pipeline.bridgeOnline ? 'Online' : 'Offline'} />
                      <Row label="Terminals" value={String(overview.pipeline.connectedTerminals)} />
                      <Row label="Autonomy mode" value={overview.autonomy.mode} />
                      {overview.risk.killSwitch.active && overview.risk.killSwitch.reason ? (
                        <p className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                          Kill switch: {overview.risk.killSwitch.reason}
                        </p>
                      ) : null}
                    </div>
                  </Panel>
                </section>
              </div>
            </>
          ) : null}
        </main>
      </div>
    </DashboardPageFrame>
  );
}

function MetricCard({
  tone,
  icon: Icon,
  label,
  value,
  detail,
  live = false,
}: {
  tone: DashboardTone;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  live?: boolean;
}) {
  return (
    <Card className={cn('overflow-hidden', toneCard(tone))}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className={cn('text-[11px] font-bold uppercase tracking-wide', toneMuted(tone))}>{label}</p>
              {live ? (
                <span className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase', toneBadge('emerald'))}>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  Live
                </span>
              ) : null}
            </div>
            <p className={cn('mt-1 truncate text-xl font-bold', toneTitle(tone))}>{value}</p>
            <p className={cn('mt-1 text-xs leading-snug', toneMuted(tone))}>{detail}</p>
          </div>
          <div className={cn('rounded-lg border p-2', toneMetric(tone))}>
            <Icon className={cn('h-4 w-4', toneTitle(tone))} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Panel({
  icon: Icon,
  title,
  tone,
  actionHref,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tone: DashboardTone;
  actionHref?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('overflow-hidden', toneCard(tone))}>
      <CardHeader className={cn('flex flex-row items-center justify-between space-y-0 border-b py-3', toneCardHeader(tone))}>
        <CardTitle className={cn('flex items-center gap-2 text-sm font-semibold', toneTitle(tone))}>
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
        {actionHref ? (
          <Link href={actionHref} className={cn('inline-flex items-center gap-1 text-xs font-semibold', toneMuted(tone))}>
            Open <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

function InsetMetric({ tone, label, value }: { tone: DashboardTone; label: string; value: string }) {
  return (
    <div className={cn('rounded-xl border p-3', toneMetric(tone))}>
      <p className={cn('text-[10px] font-bold uppercase tracking-wide', toneMuted(tone))}>{label}</p>
      <p className={cn('mt-1 text-lg font-bold', toneTitle(tone))}>{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-xs font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function formatWatClock(value: Date): string {
  return value.toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getMarketSessionStatus(now: Date): MarketSessionStatus {
  const ny = getTimeParts(now, 'America/New_York');
  const minutes = ny.hour * 60 + ny.minute;
  const boundaryMinutes = 17 * 60;
  const open =
    (ny.weekday > 0 && ny.weekday < 5) ||
    (ny.weekday === 0 && minutes >= boundaryMinutes) ||
    (ny.weekday === 5 && minutes < boundaryMinutes);
  const boundary = nextMarketBoundary(now, open, ny.weekday, minutes, boundaryMinutes);

  return {
    open,
    label: open ? 'Market open' : 'Market closed',
    detail: `${open ? 'closes' : 'opens'} ${formatWatDateTime(boundary)}`,
    tone: open ? 'emerald' : 'rose',
  };
}

function nextMarketBoundary(now: Date, open: boolean, nyWeekday: number, nyMinutes: number, boundaryMinutes: number): Date {
  const nyMidnightUtc = new Date(now.getTime() - nyMinutes * 60_000);
  let daysUntilBoundary = 0;
  if (open) {
    daysUntilBoundary = nyWeekday <= 5 ? 5 - nyWeekday : 6;
  } else if (nyWeekday === 0 && nyMinutes < boundaryMinutes) {
    daysUntilBoundary = 0;
  } else {
    daysUntilBoundary = (7 - nyWeekday) % 7;
  }
  return new Date(nyMidnightUtc.getTime() + daysUntilBoundary * 86_400_000 + boundaryMinutes * 60_000);
}

function getTimeParts(value: Date, timeZone: string): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(value);
  const weekdayText = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayText);
  return {
    weekday: weekday >= 0 ? weekday : 0,
    hour: Number(parts.find((part) => part.type === 'hour')?.value ?? 0),
    minute: Number(parts.find((part) => part.type === 'minute')?.value ?? 0),
  };
}

function formatWatDateTime(value: Date): string {
  return value.toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatRelativeTime(value: string | null | undefined, now: Date, future = false): string {
  if (!value) return 'never';
  const target = Date.parse(value);
  if (!Number.isFinite(target)) return '—';
  const deltaMs = future ? target - now.getTime() : now.getTime() - target;
  const abs = Math.abs(deltaMs);
  if (abs < 5000) return future ? 'soon' : 'just now';
  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(abs / 3_600_000);
  if (hours < 48) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(abs / 86_400_000);
  return future ? `in ${days}d` : `${days}d ago`;
}
