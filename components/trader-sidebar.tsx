'use client';

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Bot,
  BrainCircuit,
  CandlestickChart,
  ChevronRight,
  Eye,
  FlaskConical,
  Globe2,
  Landmark,
  LayoutDashboard,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Settings2,
  ShieldCheck,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type NodeKind = "workspace" | "metric" | "engine" | "control" | "integration" | "report";

interface NavigationItem {
  id: string;
  label: string;
  kind?: NodeKind;
  children?: NavigationItem[];
}

interface NavigationModule extends NavigationItem {
  icon: LucideIcon;
  children: NavigationItem[];
}

interface SidebarPreferences {
  collapsed: boolean;
  openModules: string[];
  openGroups: string[];
  activePage: string;
}

interface TraderSidebarProps {
  bridgeOnline: boolean;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

const preferenceKey = "cacsms-trader-sidebar-preferences";
const executiveModuleId = "executive-command-center";
const defaultActivePage = "executive-overview";

const navigationModules: NavigationModule[] = [
  navModule("Executive Command Center", LayoutDashboard, [
    page("Executive overview"),
    page("Master operational control center", "control"),
    group("Account & Performance", [
      "Live account status",
      "Total account equity",
      "Equity & balance",
      "Real-time floating P/L",
      "Daily / weekly / monthly performance",
      "Portfolio exposure overview",
    ], "metric"),
    group("Risk & Compliance", [
      "Risk exposure overview",
      "Risk engine status",
      "Economic risk overview",
      "Drawdown protection status",
      "Prop-firm compliance status",
      "Emergency system alerts",
    ], "metric"),
    group("Execution & Infrastructure", [
      "Connected MT5 terminals",
      "Broker health overview",
      "Trade execution status",
      "Execution latency overview",
      "Server infrastructure health",
      "Infrastructure alerts",
    ], "metric"),
    group("AI & Market Intelligence", [
      "AI market confidence index",
      "AI operational status",
      "Market sentiment overview",
      "Institutional liquidity overview",
      "Smart money activity tracker",
      "AI anomaly detection",
    ], "engine"),
    group("Clocks & Sessions", [
      "Nigeria live clock",
      "MT5 server clock",
      "UTC/GMT clock",
      "Session clock tracker",
      "Market opening countdown",
      "Active trading sessions",
    ], "metric"),
    group("Feeds & Alerts", [
      "Real-time execution feed",
      "Trade lifecycle feed",
      "News volatility warning center",
      "Global system health",
      "Active positions overview",
      "Active strategy overview",
      "Portfolio heatmap",
      "Trade opportunity scanner",
      "Top-performing strategies",
      "Worst-performing strategies",
    ], "report"),
  ]),
  navModule("Global Markets Intelligence", Globe2, [
    page("Market intelligence overview"),
    group("Markets & Watchlists", [
      "Forex market scanner",
      "AI pair selector",
      "Major currency pairs",
      "Minor currency pairs",
      "Exotic pairs",
      "Gold market monitor",
      "Silver market monitor",
      "Indices market monitor",
      "Commodities monitor",
      "Crypto market monitor",
      "Watchlist",
    ]),
    group("Sessions & Conditions", [
      "Market scanner",
      "Session detector",
      "London session intelligence",
      "New York session intelligence",
      "Asian session intelligence",
      "Sydney session intelligence",
      "Session overlap analysis",
      "Volatility scanner",
      "Liquidity scanner",
      "Market condition scorer",
      "Trend/range classifier",
      "Market regime analysis",
    ], "engine"),
    group("Execution Quality Signals", [
      "Spread monitor",
      "Slippage monitor",
      "Correlation matrix",
      "Momentum detector",
      "Real-time tick analysis",
      "Multi-timeframe scanner",
      "Pair ranking engine",
      "Session volatility forecast",
    ], "metric"),
    group("Institutional Intelligence", [
      "Institutional order-flow analysis",
      "Market imbalance tracker",
      "Volume anomaly detection",
      "Smart money tracker",
      "Liquidity pool mapping",
      "Market inefficiency scanner",
      "Pair strength meter",
      "Currency strength dashboard",
      "Heatmap intelligence",
      "High-probability setup scanner",
      "AI market state interpretation",
      "Institutional accumulation detector",
      "Institutional distribution detector",
      "Risk-on/risk-off analysis",
      "Cross-market correlation analysis",
      "Intermarket intelligence",
      "Market manipulation detector",
      "Fake breakout detector",
      "Trap movement detector",
      "Global macro market intelligence",
    ], "engine"),
  ]),
  navModule("Institutional Trade Operations Center", CandlestickChart, [
    page("Trade operations overview"),
    group("Positions & Orders", [
      "Open positions manager",
      "Pending order manager",
      "Position execution center",
      "Smart order routing",
      "Order preparation engine",
      "Order validation engine",
      "Order history center",
      "Execution queue manager",
    ], "control"),
    group("Execution Intelligence", [
      "Institutional execution engine",
      "Multi-broker execution routing",
      "Lot size intelligence",
      "Dynamic stop-loss calculation",
      "Dynamic take-profit calculation",
      "AI execution optimization",
      "Smart order batching",
      "Smart execution retry logic",
      "Failover execution routing",
      "Autonomous execution intelligence",
    ], "engine"),
    group("Trade Management", [
      "Partial close management",
      "Break-even automation",
      "Trailing stop intelligence",
      "Position scaling engine",
      "Position pyramiding logic",
      "Multi-target execution management",
      "Emergency close engine",
      "Auto-hedging engine",
      "Trade timeout engine",
    ], "control"),
    group("Monitoring & Integrity", [
      "Trade synchronization engine",
      "Trade lifecycle monitoring",
      "Execution latency tracker",
      "Slippage protection system",
      "Trade conflict prevention",
      "Position exposure monitor",
      "Real-time P/L tracker",
      "Live execution feed",
      "Broker execution monitoring",
      "Order recovery system",
      "Execution audit logs",
      "Transaction synchronization",
      "Trade consistency validation",
      "Duplicate trade prevention",
      "High-frequency execution monitor",
    ], "metric"),
    group("MT5 Bridge", [
      "MT5 execution bridge",
      "EA communication engine",
      "Institutional trade journal",
    ], "integration"),
  ]),
  navModule("Institutional Strategy Intelligence", BrainCircuit, [
    page("Strategy intelligence overview"),
    group("Strategy Families", [
      "Smart Money Concepts (SMC)",
      "ICT Strategies",
      "Price Action Intelligence",
      "Trend Intelligence",
      "Mean Reversion Intelligence",
      "Breakout Intelligence",
      "Scalping Intelligence",
      "Swing Trading Intelligence",
      "Intraday Intelligence",
      "High-frequency strategy models",
      "News-aware strategies",
    ], "engine"),
    group("Strategy Control", [
      "AI strategy selector",
      "Autonomous strategy rotation",
      "Strategy scoring engine",
      "Strategy confidence engine",
      "Strategy optimization engine",
      "Strategy adaptation engine",
      "Strategy risk profiler",
      "Multi-strategy orchestration",
    ], "control"),
    group("Research & Evolution", [
      "Strategy behavioral analysis",
      "Strategy correlation analysis",
      "Strategy performance monitor",
      "AI reinforcement learning",
      "Adaptive market intelligence",
      "Market regime adaptation",
      "Autonomous strategy evolution",
      "Historical strategy comparison",
      "Institutional strategy framework",
      "Hybrid AI strategy intelligence",
    ], "engine"),
  ]),
  navModule("AI & Autonomous Intelligence Core", Bot, [
    page("AI command overview"),
    group("Decision Intelligence", [
      "AI decision engine",
      "Market prediction intelligence",
      "Pattern memory systems",
      "Behavioral market intelligence",
      "Sentiment analysis engine",
      "AI confidence scoring",
      "Autonomous decision orchestration",
      "Market state interpretation",
      "AI trade recommendations",
      "Fully autonomous trading intelligence",
    ], "engine"),
    group("Learning Systems", [
      "Reinforcement learning systems",
      "Deep learning models",
      "Neural network engines",
      "Adaptive learning systems",
      "AI pattern clustering",
      "Historical pattern recognition",
      "Strategy reinforcement engine",
      "AI retraining pipelines",
      "Self-improving intelligence systems",
    ], "engine"),
    group("Prediction & Simulation", [
      "Predictive volatility modeling",
      "Predictive liquidity modeling",
      "AI scenario simulation",
      "AI simulation environments",
      "Institutional AI analytics",
      "AI optimization intelligence",
      "Autonomous market adaptation",
    ], "engine"),
    group("Safety & Governance", [
      "Explainable AI dashboard",
      "AI trust score engine",
      "AI safety engine",
      "AI hallucination prevention",
      "AI execution validator",
      "AI self-health monitoring",
      "AI drift detection",
      "AI performance auditing",
      "AI bias detection",
      "AI model orchestration",
      "Autonomous intelligence governance",
      "Institutional AI models",
      "AI anomaly detection",
    ], "control"),
  ]),
  navModule("Computer Vision & Visual Intelligence", Eye, [
    page("Visual intelligence overview"),
    group("Chart Capture & Detection", [
      "Chart screenshot capture",
      "Candle detection",
      "Swing point detection",
      "Pattern recognition",
      "Trendline detection",
      "Channel detection",
      "Support/resistance mapping",
      "Order block detection",
      "Liquidity zone detection",
      "Structure analysis",
    ], "engine"),
    group("Visual Analysis", [
      "Multi-timeframe comparison",
      "Image comparison engine",
      "AI visual interpretation",
      "Visual anomaly detection",
      "AI chart segmentation",
      "Visual market interpretation",
    ], "engine"),
    group("Visualizations", [
      "Market structure visualization",
      "Smart money visualization",
      "Heatmap visualization",
      "Liquidity visualization",
    ], "report"),
  ]),
  navModule("Risk Governance & Prop Firm Compliance", ShieldCheck, [
    page("Risk governance overview"),
    group("Core Risk Rules", [
      "Risk dashboard",
      "Daily drawdown limit",
      "Maximum drawdown limit",
      "Monthly profit target",
      "Risk per trade",
      "Maximum trades per day",
      "Maximum open exposure",
      "Correlation protection",
      "Margin protection",
      "Equity protection",
      "Capital preservation logic",
      "Exposure analysis",
      "Account protection",
      "Emergency kill switch",
    ], "control"),
    group("Prop Firm Compliance", [
      "FTMO compliance",
      "FundingPips compliance",
      "The5ers compliance",
      "Consistency rules",
      "News trading restrictions",
      "Trading session restrictions",
      "Violation alerts",
      "Challenge tracker",
      "Compliance monitoring",
    ], "control"),
    group("Institutional Protection", [
      "Black swan protection",
      "Risk stress testing",
      "Portfolio risk analysis",
      "Cross-account exposure analysis",
      "Currency exposure controls",
      "Trade lockout systems",
      "Institutional risk governance",
    ], "engine"),
  ]),
  navModule("Economic, News & Sentiment Intelligence", Landmark, [
    page("Macro intelligence overview"),
    group("Economic Data", [
      "Economic calendar",
      "COT report synchronization",
      "Interest rate history",
      "Inflation data",
      "Employment data",
      "GDP events",
      "CPI/NFP events",
      "Central bank calendar",
      "Central bank speech analysis",
    ], "integration"),
    group("News & Volatility", [
      "News volatility filter",
      "News impact scoring",
      "Event blackout windows",
      "Volatility forecasting",
      "Reuters/Bloomberg integrations",
      "ForexFactory integrations",
    ], "engine"),
    group("Sentiment & Fundamentals", [
      "Fundamental bias scoring",
      "USD strength analysis",
      "Gold correlation analysis",
      "Bond yield analysis",
      "Macro sentiment engine",
      "AI sentiment analysis",
      "Fear & greed intelligence",
      "Global macroeconomic intelligence",
    ], "engine"),
  ]),
  navModule("MT5 Infrastructure & Broker Connectivity", Network, [
    page("Infrastructure overview"),
    group("Terminal Operations", [
      "Connected terminals",
      "Terminal registration",
      "Terminal heartbeat",
      "Terminal health monitoring",
      "MT5 synchronization",
      "MT5 execution bridge",
      "Live latency monitoring",
      "Multi-computer support",
      "Account routing",
      "VPS management",
      "EA deployment",
    ], "integration"),
    group("Broker & Failover", [
      "Broker connection manager",
      "Broker health monitoring",
      "Failover execution",
      "Reconnection engine",
      "Infrastructure failover",
      "Trade synchronization recovery",
      "Cloud failover systems",
      "Self-healing infrastructure engine",
    ], "engine"),
    group("Observability", [
      "Terminal logs",
      "Infrastructure diagnostics",
      "WebSocket monitoring",
      "API monitoring",
      "Database monitoring",
      "Queue monitoring",
      "Service health monitoring",
      "Infrastructure alerts",
      "Real-time diagnostics",
      "Logging & observability",
    ], "metric"),
  ]),
  navModule("Analytics, Research & Simulation Labs", FlaskConical, [
    page("Analytics lab overview"),
    group("Performance Analytics", [
      "Performance analytics",
      "Win/loss ratio",
      "Drawdown analytics",
      "Risk-reward analysis",
      "Session performance",
      "Pair performance",
      "Strategy analytics",
      "Profit curve",
      "Equity curve",
      "Trading behavior analysis",
      "AI performance metrics",
      "Statistical reporting",
      "Sharpe/Sortino analysis",
    ], "report"),
    group("Testing & Simulation", [
      "Historical testing",
      "Tick replay",
      "Monte Carlo simulation",
      "Walk-forward testing",
      "Strategy optimization",
      "AI simulation",
      "Forward testing",
      "Scenario analysis",
      "Stress testing",
      "Paper trading systems",
    ], "engine"),
    group("Research Systems", [
      "Historical data management",
      "Quantitative analysis",
      "Probability forecasting",
      "Statistical arbitrage",
      "Volatility modeling",
      "Research notebooks",
      "Strategy experimentation labs",
      "AI experimentation labs",
      "Sandbox environments",
      "Institutional forecasting systems",
      "Quantitative intelligence center",
    ], "engine"),
  ]),
  navModule("Portfolio, Reporting & Behavioral Intelligence", PieChart, [
    page("Portfolio overview"),
    group("Portfolio & Journal", [
      "Portfolio management",
      "Multi-asset portfolio tracking",
      "Trade journal",
      "AI notes",
      "Trade screenshots",
      "Entry analysis",
      "Exit analysis",
      "Setup history",
      "Trading insights",
    ], "workspace"),
    group("Behavioral Intelligence", [
      "Emotional tracking",
      "Trading mistakes analysis",
      "Performance reflections",
      "Learning records",
      "Behavioral intelligence",
      "Decision transparency center",
    ], "report"),
    group("Reporting", [
      "Daily reports",
      "Weekly reports",
      "Monthly reports",
      "Risk reports",
      "Performance reports",
      "Strategy reports",
      "AI reports",
      "Tax reports",
      "Account statements",
      "Export center",
      "Institutional reporting systems",
    ], "report"),
  ]),
  navModule("Alerts, Security & Governance", Bell, [
    page("Governance overview"),
    group("Alerts & Notifications", [
      "Trade alerts",
      "Risk alerts",
      "Drawdown alerts",
      "Profit target alerts",
      "Economic news alerts",
      "MT5 alerts",
      "AI alerts",
      "System alerts",
      "Email notifications",
      "Telegram notifications",
      "Push notifications",
      "Incident management",
    ], "control"),
    group("Identity & Access", [
      "Users",
      "Roles & permissions",
      "Security management",
      "Audit logs",
      "API key management",
      "Access control",
      "Authentication logs",
      "Infrastructure access monitoring",
    ], "control"),
    group("Governance Systems", [
      "Compliance management",
      "Encryption systems",
      "Secrets management",
      "Governance controls",
      "Regulatory intelligence",
      "Legal compliance",
      "Institutional governance systems",
    ], "control"),
  ]),
  navModule("System Administration & Global Settings", Settings2, [
    page("System preferences"),
    group("Configuration", [
      "General settings",
      "Trading settings",
      "Nigeria timezone configuration",
      "Appearance settings",
      "Notification settings",
      "MT5 configuration",
      "Broker configuration",
      "AI configuration",
      "Risk configuration",
      "Economic data configuration",
      "Configuration management",
    ], "control"),
    group("Integrations & Deployment", [
      "API integrations",
      "Backup & recovery",
      "Environment configuration",
      "Deployment configuration",
      "CI/CD management",
      "Developer APIs",
      "Workflow automation",
      "Scheduling systems",
    ], "integration"),
    group("Data & Orchestration", [
      "Documentation center",
      "Data synchronization hub",
      "Historical data warehouse",
      "Tick data management",
      "Global orchestration center",
    ], "engine"),
  ]),
];

const defaultPreferences: SidebarPreferences = {
  collapsed: false,
  openModules: [executiveModuleId],
  openGroups: [],
  activePage: defaultActivePage,
};

export function TraderSidebar({ bridgeOnline, mobileOpen, onMobileOpenChange }: TraderSidebarProps) {
  const [mounted, setMounted] = useState(false);
  const [preferences, setPreferences] = useState<SidebarPreferences>(defaultPreferences);

  useEffect(() => {
    let nextPreferences = defaultPreferences;
    const stored = window.localStorage.getItem(preferenceKey);

    if (stored) {
      try {
        nextPreferences = { ...defaultPreferences, ...JSON.parse(stored) };
      } catch {
        nextPreferences = defaultPreferences;
      }
    }

    queueMicrotask(() => {
      setPreferences(nextPreferences);
      setMounted(true);
    });
  }, []);

  useEffect(() => {
    if (mounted) {
      window.localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    }
  }, [mounted, preferences]);

  const activeModuleIds = useMemo(() => {
    return new Set(navigationModules.filter((item) => hasActiveChild(item, preferences.activePage)).map((item) => item.id));
  }, [preferences.activePage]);

  const setPreference = (patch: Partial<SidebarPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  };

  const toggleModule = (moduleId: string) => {
    setPreferences((current) => ({
      ...current,
      openModules: toggleValue(current.openModules, moduleId),
    }));
  };

  const toggleGroup = (groupId: string) => {
    setPreferences((current) => ({
      ...current,
      openGroups: toggleValue(current.openGroups, groupId),
    }));
  };

  const selectPage = (pageId: string) => {
    setPreference({ activePage: pageId });
    onMobileOpenChange(false);
  };

  return (
    <>
      <SidebarShell
        activeModuleIds={activeModuleIds}
        activePage={preferences.activePage}
        bridgeOnline={bridgeOnline}
        collapsed={preferences.collapsed}
        onCollapseChange={(collapsed) => setPreference({ collapsed })}
        onPageSelect={selectPage}
        onToggleGroup={toggleGroup}
        onToggleModule={toggleModule}
        openGroups={preferences.openGroups}
        openModules={preferences.openModules}
      />

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-950/35"
            onClick={() => onMobileOpenChange(false)}
          />
          <div className="relative flex h-full w-[min(88vw,380px)] flex-col bg-white shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <Brand />
              <button
                type="button"
                aria-label="Close navigation"
                className="grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-950"
                onClick={() => onMobileOpenChange(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavigationTree
              activeModuleIds={activeModuleIds}
              activePage={preferences.activePage}
              collapsed={false}
              onPageSelect={selectPage}
              onToggleGroup={toggleGroup}
              onToggleModule={toggleModule}
              openGroups={preferences.openGroups}
              openModules={preferences.openModules}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function SidebarShell(props: {
  activeModuleIds: Set<string>;
  activePage: string;
  bridgeOnline: boolean;
  collapsed: boolean;
  onCollapseChange: (collapsed: boolean) => void;
  onPageSelect: (pageId: string) => void;
  onToggleGroup: (groupId: string) => void;
  onToggleModule: (moduleId: string) => void;
  openGroups: string[];
  openModules: string[];
}) {
  return (
    <aside className={cn(
      "hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 lg:flex",
      props.collapsed ? "w-20" : "w-84",
    )}>
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
        {props.collapsed ? (
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-700 text-white shadow-sm shadow-indigo-900/20">
            <Zap className="h-5 w-5" />
          </div>
        ) : (
          <Brand />
        )}
        <button
          type="button"
          aria-label={props.collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-950"
          onClick={() => props.onCollapseChange(!props.collapsed)}
        >
          {props.collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <NavigationTree {...props} />

      <div className="border-t border-slate-200 p-3">
        <div className={cn(
          "flex items-center gap-3 rounded-lg border px-3 py-3",
          props.bridgeOnline ? "border-teal-200 bg-teal-50 text-teal-800" : "border-rose-200 bg-rose-50 text-rose-700",
          props.collapsed && "justify-center px-0",
        )}>
          <div className={cn("h-2.5 w-2.5 shrink-0 rounded-full", props.bridgeOnline ? "bg-teal-500" : "bg-rose-500")} />
          {!props.collapsed ? (
            <div>
              <div className="text-xs font-semibold">{props.bridgeOnline ? "Bridge Online" : "Bridge Offline"}</div>
              <div className="text-[11px] opacity-75">MT5 connection status</div>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function NavigationTree(props: {
  activeModuleIds: Set<string>;
  activePage: string;
  collapsed: boolean;
  onPageSelect: (pageId: string) => void;
  onToggleGroup: (groupId: string) => void;
  onToggleModule: (moduleId: string) => void;
  openGroups: string[];
  openModules: string[];
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <nav className={cn("py-3", props.collapsed ? "px-2" : "px-3")}>
        {!props.collapsed ? (
          <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">System Modules</div>
        ) : null}

        <div className="space-y-1">
          {navigationModules.map((item) => (
            <ModuleItem key={item.id} item={item} {...props} />
          ))}
        </div>
      </nav>
    </ScrollArea>
  );
}

function ModuleItem(props: {
  activeModuleIds: Set<string>;
  activePage: string;
  collapsed: boolean;
  item: NavigationModule;
  onPageSelect: (pageId: string) => void;
  onToggleGroup: (groupId: string) => void;
  onToggleModule: (moduleId: string) => void;
  openGroups: string[];
  openModules: string[];
}) {
  const { item } = props;
  const Icon = item.icon;
  const isOpen = props.openModules.includes(item.id);
  const isActiveModule = props.activeModuleIds.has(item.id);

  return (
    <div>
      <button
        type="button"
        title={props.collapsed ? item.label : undefined}
        className={cn(
          "flex h-10 w-full items-center rounded-md text-sm font-medium transition-colors",
          props.collapsed ? "justify-center px-0" : "gap-3 px-3 text-left",
          isActiveModule
            ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
        )}
        onClick={() => props.collapsed ? props.onPageSelect(firstLeafId(item)) : props.onToggleModule(item.id)}
      >
        <Icon className={cn("h-4 w-4 shrink-0", isActiveModule ? "text-blue-700" : "text-slate-400")} />
        {!props.collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-90")} />
          </>
        ) : null}
      </button>

      {!props.collapsed && isOpen ? (
        <div className="mt-1 space-y-0.5 border-l border-slate-200 pl-3 ml-5">
          {item.children.map((child) => (
            child.children ? (
              <GroupItem
                key={child.id}
                activePage={props.activePage}
                item={child}
                onPageSelect={props.onPageSelect}
                onToggleGroup={props.onToggleGroup}
                openGroups={props.openGroups}
              />
            ) : (
              <PageItem key={child.id} item={child} active={props.activePage === child.id} onSelect={props.onPageSelect} />
            )
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GroupItem(props: {
  activePage: string;
  item: NavigationItem;
  onPageSelect: (pageId: string) => void;
  onToggleGroup: (groupId: string) => void;
  openGroups: string[];
}) {
  const isOpen = props.openGroups.includes(props.item.id);
  const isActiveGroup = hasActiveChild(props.item, props.activePage);

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-semibold transition-colors",
          isActiveGroup ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
        )}
        onClick={() => props.onToggleGroup(props.item.id)}
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} />
        <span className="truncate">{props.item.label}</span>
      </button>
      {isOpen ? (
        <div className="ml-4 border-l border-slate-100 pl-2">
          {props.item.children?.map((child) => (
            <PageItem key={child.id} item={child} active={props.activePage === child.id} onSelect={props.onPageSelect} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PageItem({ active, item, onSelect }: { active: boolean; item: NavigationItem; onSelect: (pageId: string) => void }) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs leading-4 transition-colors",
        active ? "bg-blue-600 text-white shadow-sm shadow-blue-900/15" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
      )}
      onClick={() => onSelect(item.id)}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-white" : kindDotClass(item.kind))} />
      <span className="line-clamp-2">{item.label}</span>
    </button>
  );
}

function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-700 text-white shadow-sm shadow-indigo-900/20">
        <Zap className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight text-slate-950">Cacsms Trader</h1>
        <p className="truncate text-xs font-medium text-slate-500">Autonomous Forex System</p>
      </div>
    </div>
  );
}

function navModule(label: string, icon: LucideIcon, children: NavigationItem[]): NavigationModule {
  return {
    id: slug(label),
    label,
    icon,
    children,
  };
}

function page(label: string, kind: NodeKind = "workspace"): NavigationItem {
  return {
    id: slug(label),
    label,
    kind,
  };
}

function group(label: string, children: string[], kind: NodeKind = "workspace"): NavigationItem {
  return {
    id: slug(label),
    label,
    kind,
    children: children.map((child) => page(child, kind)),
  };
}

function hasActiveChild(item: NavigationItem, activePage: string): boolean {
  return item.id === activePage || Boolean(item.children?.some((child) => hasActiveChild(child, activePage)));
}

function firstLeafId(item: NavigationItem): string {
  const firstChild = item.children?.[0];
  if (!firstChild) return item.id;
  return firstLeafId(firstChild);
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function kindDotClass(kind: NodeKind = "workspace"): string {
  const classes: Record<NodeKind, string> = {
    workspace: "bg-slate-300",
    metric: "bg-teal-400",
    engine: "bg-violet-400",
    control: "bg-amber-400",
    integration: "bg-indigo-400",
    report: "bg-sky-400",
  };

  return classes[kind];
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
