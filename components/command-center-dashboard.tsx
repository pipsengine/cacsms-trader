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
  Menu,
  Network,
  PlayCircle,
  RefreshCw,
  Radio,
  Square,
  ShieldAlert,
  Target,
  TrendingUp,
  Workflow,
  Zap,
} from 'lucide-react';

import { PairSelectionLivePanel } from '@/components/pair-selection-live-panel';
import { TraderSidebar } from '@/components/trader-sidebar';
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
  };
};

type DashboardTick = {
  sequence: number;
  tickAt: string;
  bridge: { online: boolean; connected: number; degraded: number; disconnected: number };
  trading: OverviewPayload['trading'];
  propFirm: OverviewPayload['propFirm'];
};

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
      active: false,
      startedAt: null,
      stoppedAt: null,
      minOpenPositions: 1,
      maxEntriesPerCycle: 3,
      targetDescription: 'Press Start to begin institutional continuous trading.',
      lastMaintenance: null,
    },
  };
}

export function CommandCenterDashboard() {
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
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

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

  const toggleContinuousTrading = useCallback(async (action: 'start' | 'stop') => {
    setSessionBusy(true);
    setSessionMessage(null);
    try {
      const response = await fetch('/api/command-center/continuous-trading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(String(payload.error ?? `Unable to ${action} continuous trading.`));
      }
      setSessionMessage(String(payload.message ?? (action === 'start' ? 'Trading started.' : 'Trading stopped.')));
      await loadOverview(true);
    } catch (toggleError) {
      setSessionMessage(toggleError instanceof Error ? toggleError.message : `Unable to ${action} continuous trading.`);
    } finally {
      setSessionBusy(false);
    }
  }, [loadOverview]);

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
    <div className="flex h-screen overflow-hidden bg-white">
      <TraderSidebar
        bridgeOnline={overview?.pipeline.bridgeOnline ?? false}
        mobileOpen={mobileSidebarOpen}
        onMobileOpenChange={setMobileSidebarOpen}
      />

      <div className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
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
              {overview?.continuousTrading.active ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={sessionBusy}
                  onClick={() => void toggleContinuousTrading('stop')}
                >
                  <Square className="mr-2 h-4 w-4" />
                  {sessionBusy ? 'Stopping…' : 'Stop trading'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={sessionBusy}
                  onClick={() => void toggleContinuousTrading('start')}
                >
                  <PlayCircle className="mr-2 h-4 w-4" />
                  {sessionBusy ? 'Starting…' : 'Start trading'}
                </Button>
              )}
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                  overview?.continuousTrading.active ? toneBadge('emerald') : toneBadge('slate'),
                )}
              >
                <Activity className={cn('h-3 w-3', overview?.continuousTrading.active && 'animate-pulse')} />
                {overview?.continuousTrading.active ? 'Session live' : 'Session stopped'}
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

        <main className="flex-1 overflow-y-auto bg-white p-4 md:p-6">
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
                  toneCard(overview.continuousTrading.active ? 'emerald' : 'slate'),
                )}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className={cn('text-[11px] font-bold uppercase tracking-[0.18em]', toneMuted(overview.continuousTrading.active ? 'emerald' : 'slate'))}>
                      Institutional continuous trading
                    </p>
                    <p className={cn('text-lg font-semibold', toneTitle(overview.continuousTrading.active ? 'emerald' : 'slate'))}>
                      {overview.continuousTrading.active ? 'Session running' : 'Session stopped'}
                    </p>
                    <p className={cn('text-sm', toneBody(overview.continuousTrading.active ? 'emerald' : 'slate'))}>
                      {overview.continuousTrading.targetDescription}
                    </p>
                    {sessionMessage ? (
                      <p className="mt-2 text-xs font-medium text-slate-700">{sessionMessage}</p>
                    ) : null}
                    <p className={cn('mt-2 text-xs', toneMuted(overview.continuousTrading.active ? 'emerald' : 'slate'))}>
                      Min open positions: {overview.continuousTrading.minOpenPositions}
                      {' · '}
                      Max entries/cycle: {overview.continuousTrading.maxEntriesPerCycle}
                      {' · '}
                      Open now: {overview.trading.openPositions}
                      {' · '}
                      Slots left: {overview.risk.remainingOpenPositions}
                      {' · '}
                      Daily budget left: ${overview.risk.remainingDailyLossAmount?.toFixed(2) ?? '—'}
                    </p>
                    {overview.continuousTrading.lastMaintenance?.at ? (
                      <p className={cn('mt-1 text-xs', toneMuted(overview.continuousTrading.active ? 'emerald' : 'slate'))}>
                        Last refill: {overview.continuousTrading.lastMaintenance.dispatchesAttempted} dispatch(es)
                        {overview.continuousTrading.lastMaintenance.targets.length > 0
                          ? ` · ${overview.continuousTrading.lastMaintenance.targets.join(', ')}`
                          : ''}
                        {' · '}
                        {formatRelativeTime(overview.continuousTrading.lastMaintenance.at, clockNow)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {overview.continuousTrading.active ? (
                      <Button variant="destructive" disabled={sessionBusy} onClick={() => void toggleContinuousTrading('stop')}>
                        <Square className="mr-2 h-4 w-4" />
                        {sessionBusy ? 'Stopping…' : 'Stop trading'}
                      </Button>
                    ) : (
                      <Button
                        className="bg-emerald-600 hover:bg-emerald-700"
                        disabled={sessionBusy}
                        onClick={() => void toggleContinuousTrading('start')}
                      >
                        <PlayCircle className="mr-2 h-4 w-4" />
                        {sessionBusy ? 'Starting…' : 'Start trading'}
                      </Button>
                    )}
                  </div>
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
    </div>
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
