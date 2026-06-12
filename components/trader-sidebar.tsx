'use client';

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BrainCircuit,
  ChevronRight,
  Eye,
  Landmark,
  LayoutDashboard,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { useContinuousTradingSession } from "@/components/continuous-trading-session-provider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { strategyPageHref, strategyPageIdFromPath } from "@/lib/strategy-routes";
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
const scrollPositionKey = "cacsms-trader-sidebar-scroll-position";
const executiveModuleId = "executive-command-center";
const defaultActivePage = "autonomous-pipeline-command-center";

const navigationModules: NavigationModule[] = [
  navModule("Executive Command Center", LayoutDashboard, [
    {
      id: "autonomous-pipeline-command-center",
      label: "Pipeline command center",
      kind: "control",
    },
    page("Executive overview"),
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
      "EA Communication Engine",
      "Execution Audit Journal",
      "Live latency monitoring",
      "Multi-computer support",
      "Account routing",
      "VPS management",
      "EA deployment",
      "EA Deployment Link Manager",
    ], "integration"),
  ]),
  navModule("Computer Vision & Visual Intelligence", Eye, [
    page("Visual intelligence overview"),
    page("Cacsms Vision Intelligence Room", "engine"),
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
  ]),
  navModule("Economic, News & Sentiment Intelligence", Landmark, [
    page("Macro Intelligence Overview"),
    group("Economic Calendar", [
      "Economic Calendar Overview",
      "CPI / Inflation Events",
      "NFP / Employment Events",
      "GDP / Growth Events",
      "Central Bank Meetings",
      "High-Impact Events",
    ], "integration"),
    page("COT & Institutional Positioning", "engine"),
    page("Monetary Policy & Interest Rates", "engine"),
    page("News Risk & Blackout Windows", "engine"),
    page("Fundamental Bias Scoring", "engine"),
    page("Gold & Intermarket Analysis", "engine"),
  ]),
  navModule("Institutional Strategy Intelligence", BrainCircuit, strategyNavigationItems()),
];

const defaultPreferences: SidebarPreferences = {
  collapsed: false,
  openModules: [executiveModuleId],
  openGroups: [],
  activePage: defaultActivePage,
};

function readStoredSidebarPreferences(): SidebarPreferences {
  if (typeof window === 'undefined') return defaultPreferences;
  const stored = window.localStorage.getItem(preferenceKey);
  if (!stored) return defaultPreferences;
  try {
    return { ...defaultPreferences, ...JSON.parse(stored) as SidebarPreferences };
  } catch {
    return defaultPreferences;
  }
}

function resolveSidebarPreferences(pathname: string, base: SidebarPreferences): SidebarPreferences {
  const inferredActivePage = pageIdForPathname(pathname);
  const activePage = inferredActivePage ?? base.activePage;
  const ancestors = inferredActivePage ? findNavigationAncestors(inferredActivePage) : { modules: [], groups: [] };
  return {
    ...base,
    activePage,
    openModules: mergeUnique(base.openModules, ancestors.modules),
    openGroups: mergeUnique(base.openGroups, ancestors.groups),
  };
}

export function TraderSidebar({ bridgeOnline, mobileOpen, onMobileOpenChange }: TraderSidebarProps) {
  const [preferences, setPreferences] = useState<SidebarPreferences>(defaultPreferences);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useLayoutEffect(() => {
    const stored = readStoredSidebarPreferences();
    setPreferences(resolveSidebarPreferences(pathname, stored));
    setPreferencesReady(true);
  }, [pathname]);

  useEffect(() => {
    if (preferencesReady) {
      window.localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    }
  }, [preferencesReady, preferences]);

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

  const selectPage = (pageId: string, navigate = true) => {
    const ancestors = findNavigationAncestors(pageId);

    setPreferences((current) => {
      const nextPreferences = {
        ...current,
        activePage: pageId,
        openModules: mergeUnique(current.openModules, ancestors.modules),
        openGroups: mergeUnique(current.openGroups, ancestors.groups),
      };

      window.localStorage.setItem(preferenceKey, JSON.stringify(nextPreferences));
      return nextPreferences;
    });
    onMobileOpenChange(false);
    if (!navigate) return;
    const href = hrefForPageId(pageId);
    if (href) {
      router.push(href);
    }
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

function ContinuousTradingSidebarStatus(props: {
  collapsed: boolean;
  active: boolean;
  loaded: boolean;
}) {
  const tone = !props.loaded ? "slate" : props.active ? "emerald" : "amber";
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border px-3 py-3",
      tone === "emerald" && "border-emerald-200 bg-emerald-50 text-emerald-800",
      tone === "amber" && "border-amber-200 bg-amber-50 text-amber-800",
      tone === "slate" && "border-slate-200 bg-slate-50 text-slate-700",
      props.collapsed && "justify-center px-0",
    )}>
      <div className={cn(
        "h-2.5 w-2.5 shrink-0 rounded-full",
        tone === "emerald" && "bg-emerald-500",
        tone === "amber" && "bg-amber-500",
        tone === "slate" && "bg-slate-400",
      )} />
      {!props.collapsed ? (
        <div>
          <div className="text-xs font-semibold">
            {!props.loaded ? "Trading session…" : props.active ? "Trading active" : "Trading stopped"}
          </div>
          <div className="text-[11px] opacity-75">Persists across all pages</div>
        </div>
      ) : null}
    </div>
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
  const tradingSession = useContinuousTradingSession();

  return (
    <aside className={cn(
      "sticky top-0 z-40 hidden h-screen shrink-0 self-start flex-col overflow-hidden border-r border-slate-200 bg-white transition-[width] duration-200 lg:flex",
      props.collapsed ? "w-20" : "w-80",
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

      <div className="border-t border-slate-200 p-3 space-y-2">
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
        <ContinuousTradingSidebarStatus
          collapsed={props.collapsed}
          active={tradingSession.active}
          loaded={tradingSession.loaded}
        />
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
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const restoreScrollPosition = useCallback(() => {
    const storedPosition = window.localStorage.getItem(scrollPositionKey);
    const nextScrollTop = storedPosition ? Number(storedPosition) : 0;
    if (!Number.isFinite(nextScrollTop) || nextScrollTop <= 0) return;
    if (viewportRef.current) {
      viewportRef.current.scrollTop = nextScrollTop;
    }
  }, []);

  useLayoutEffect(() => {
    restoreScrollPosition();
    const frame = window.requestAnimationFrame(restoreScrollPosition);
    return () => window.cancelAnimationFrame(frame);
  }, [props.activePage, restoreScrollPosition]);

  const rememberScrollPosition = () => {
    if (viewportRef.current) {
      window.localStorage.setItem(scrollPositionKey, String(viewportRef.current.scrollTop));
    }
  };

  return (
    <ScrollArea
      className="min-h-0 flex-1"
      viewportRef={viewportRef}
      viewportProps={{ onScroll: rememberScrollPosition }}
    >
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

function PageItem({ active, item, onSelect }: { active: boolean; item: NavigationItem; onSelect: (pageId: string, navigate?: boolean) => void }) {
  const href = hrefForPageId(item.id);
  const className = cn(
    "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs leading-4 transition-colors",
    active ? "bg-blue-600 text-white shadow-sm shadow-blue-900/15" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
  );
  const content = (
    <>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-white" : kindDotClass(item.kind))} />
      <span className="line-clamp-2">{item.label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className} onClick={() => onSelect(item.id, false)}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={className} onClick={() => onSelect(item.id)}>
      {content}
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

function strategyNavigationItems(): NavigationItem[] {
  return [
    page("Strategy intelligence overview", "engine"),
    strategyGroup("Trend Following Strategies", [
      "Moving Average Crossover",
      "EMA Pullback Strategy",
      "Trendline Breakout",
      "Higher Highs & Higher Lows",
      "MACD Trend Strategy",
      "SuperTrend Strategy",
      "ADX Trend Strategy",
      "Ichimoku Trend Strategy",
      "200 EMA Trend Strategy",
      "Multi-Timeframe Trend Confirmation",
      "Trend Continuation Pattern Strategy",
      "Dynamic Support & Resistance Trend Trading",
      "Fibonacci Trend Continuation",
      "Channel Trend Trading",
      "Trend Acceleration Strategy",
      "Institutional Trend Following",
    ]),
    strategyGroup("Breakout Trading Strategies", [
      "London Breakout",
      "Asian Session Breakout",
      "New York Breakout",
      "Opening Range Breakout (ORB)",
      "Daily High/Low Breakout",
      "Weekly Breakout",
      "Triangle Breakout",
      "Rectangle Breakout",
      "Volatility Breakout",
      "News Breakout",
      "Bollinger Band Squeeze Breakout",
      "Range Expansion Breakout",
      "Liquidity Breakout",
      "Fake Breakout Reversal",
      "Consolidation Breakout",
    ]),
    strategyGroup("Scalping Strategies", [
      "1-Minute Scalping",
      "5-Minute Scalping",
      "Tick Scalping",
      "Spread Scalping",
      "Order Flow Scalping",
      "DOM Scalping",
      "Momentum Scalping",
      "EMA Scalping",
      "VWAP Scalping",
      "RSI Scalping",
      "Stochastic Scalping",
      "Price Action Scalping",
      "Liquidity Grab Scalping",
      "News Scalping",
      "Session Scalping",
      "High Frequency Scalping",
      "Algorithmic Scalping",
    ]),
    strategyGroup("Day Trading Strategies", [
      "Intraday Trend Trading",
      "Intraday Breakout",
      "Momentum Day Trading",
      "VWAP Day Trading",
      "Opening Session Trading",
      "Mean Reversion Day Trading",
      "Gap Trading",
      "Reversal Day Trading",
      "News-Based Day Trading",
      "Correlation Day Trading",
      "Pivot Point Day Trading",
      "Range Day Trading",
      "Smart Money Day Trading",
    ]),
    strategyGroup("Swing Trading Strategies", [
      "Swing Pullback Strategy",
      "Fibonacci Swing Trading",
      "Swing Reversal Strategy",
      "Trend Swing Trading",
      "Channel Swing Trading",
      "Harmonic Swing Trading",
      "Elliott Wave Swing Trading",
      "MACD Swing Trading",
      "RSI Swing Trading",
      "Support & Resistance Swing Trading",
      "Candlestick Swing Trading",
      "Weekly Swing Trading",
      "Position Swing Trading",
    ]),
    strategyGroup("Position Trading Strategies", [
      "Macro Trend Trading",
      "Fundamental Position Trading",
      "Carry Trade Strategy",
      "Long-Term Trend Following",
      "Economic Cycle Trading",
      "Central Bank Policy Trading",
      "Interest Rate Differential Strategy",
      "Inflation-Based Position Trading",
      "Commodity Currency Position Trading",
    ]),
    strategyGroup("Price Action Strategies", [
      "Support & Resistance",
      "Supply & Demand",
      "Candlestick Trading",
      "Engulfing Pattern",
      "Pin Bar Strategy",
      "Inside Bar Strategy",
      "Fakey Pattern",
      "Break and Retest",
      "Market Structure Trading",
      "Liquidity Sweep Strategy",
      "Mitigation Block Strategy",
      "Breaker Block Strategy",
      "Fair Value Gap (FVG)",
      "Institutional Candle Trading",
      "ICT Trading Strategy",
      "BOS (Break of Structure)",
      "CHOCH (Change of Character)",
    ]),
    strategyGroup("Indicator-Based Strategies", [
      "RSI Strategy",
      "MACD Strategy",
      "Bollinger Bands Strategy",
      "Stochastic Strategy",
      "ATR Strategy",
      "ADX Strategy",
      "CCI Strategy",
      "Parabolic SAR Strategy",
      "Ichimoku Strategy",
      "Moving Average Strategy",
      "Keltner Channel Strategy",
      "Donchian Channel Strategy",
      "Momentum Indicator Strategy",
      "Williams %R Strategy",
      "TDI Strategy",
      "Alligator Indicator Strategy",
    ]),
    strategyGroup("Mean Reversion Strategies", [
      "Bollinger Mean Reversion",
      "RSI Overbought/Oversold",
      "VWAP Reversion",
      "Statistical Reversion",
      "Range Reversal",
      "Channel Reversion",
      "Z-Score Reversion",
      "Deviation Reversion",
      "Reversion Scalping",
    ]),
    strategyGroup("Momentum Trading Strategies", [
      "Momentum Breakout",
      "Volume Momentum",
      "News Momentum",
      "MACD Momentum",
      "RSI Momentum",
      "Volatility Momentum",
      "Currency Strength Momentum",
      "Relative Strength Momentum",
    ]),
    strategyGroup("Reversal Trading Strategies", [
      "Double Top / Bottom",
      "Head and Shoulders",
      "RSI Divergence",
      "MACD Divergence",
      "Exhaustion Reversal",
      "Climactic Reversal",
      "Trendline Reversal",
      "Fibonacci Reversal",
      "Harmonic Reversal",
      "Supply/Demand Reversal",
      "V-Reversal",
      "Countertrend Trading",
    ]),
    strategyGroup("Range Trading Strategies", [
      "Horizontal Range Trading",
      "Bollinger Range Strategy",
      "Oscillator Range Trading",
      "Channel Trading",
      "Support & Resistance Range",
      "Asian Session Range Trading",
      "Mean Reversion Range",
      "VWAP Range Trading",
    ]),
    strategyGroup("Smart Money & Institutional Strategies", [
      "Smart Money Concepts (SMC)",
      "ICT Methodology",
      "Order Flow Trading",
      "Footprint Trading",
      "Liquidity Trading",
      "Order Block Trading",
      "Market Maker Model",
      "Wyckoff Method",
      "Accumulation/Distribution",
      "Manipulation-Distribution",
      "Liquidity Grab Strategy",
      "Stop Hunt Strategy",
      "Institutional Candle Model",
      "Premium & Discount Zones",
      "SMT Divergence",
      "Kill Zones",
      "Judas Swing",
      "Power of 3 (PO3)",
    ]),
    strategyGroup("Quantitative & Algorithmic Strategies", [
      "Algorithmic Trading",
      "Quantitative Trading",
      "High Frequency Trading (HFT)",
      "Statistical Arbitrage",
      "Machine Learning Trading",
      "AI-Based Trading",
      "Neural Network Trading",
      "Sentiment AI Trading",
      "Reinforcement Learning Trading",
      "Grid Algorithms",
      "Martingale Systems",
      "Anti-Martingale Systems",
      "Volatility Algorithms",
    ]),
    strategyGroup("Fundamental Trading Strategies", [
      "Interest Rate Trading",
      "Central Bank Trading",
      "CPI Trading",
      "NFP Trading",
      "GDP Trading",
      "Inflation Trading",
      "Employment Data Trading",
      "Geopolitical Trading",
      "Trade Balance Trading",
      "Yield Differential Trading",
      "Monetary Policy Strategy",
      "Risk-On / Risk-Off Trading",
    ]),
    strategyGroup("News Trading Strategies", [
      "NFP Strategy",
      "FOMC Strategy",
      "CPI Strategy",
      "ECB Strategy",
      "BOE Strategy",
      "BOJ Strategy",
      "Rate Decision Trading",
      "Flash News Trading",
      "Volatility Spike Trading",
      "News Fade Strategy",
    ]),
    strategyGroup("Correlation & Intermarket Strategies", [
      "Currency Correlation Trading",
      "Gold-Forex Correlation",
      "Oil-CAD Correlation",
      "Bond-Yield Correlation",
      "Dollar Index (DXY) Strategy",
      "Risk Sentiment Correlation",
      "Equity-Forex Correlation",
    ]),
    strategyGroup("Volatility-Based Strategies", [
      "ATR Breakout",
      "Volatility Compression",
      "Volatility Expansion",
      "Bollinger Squeeze",
      "Implied Volatility Trading",
      "News Volatility Strategy",
    ]),
    strategyGroup("Hedging Strategies", [
      "Direct Hedge",
      "Multiple Currency Hedge",
      "Correlation Hedge",
      "Options Hedge",
      "Synthetic Hedge",
      "Partial Hedge",
    ], "control"),
    strategyGroup("Arbitrage Strategies", [
      "Triangular Arbitrage",
      "Latency Arbitrage",
      "Cross-Broker Arbitrage",
      "Interest Arbitrage",
      "Swap Arbitrage",
    ]),
    strategyGroup("Session-Based Strategies", [
      "Asian Session Strategy",
      "London Session Strategy",
      "New York Session Strategy",
      "London-New York Overlap",
      "Tokyo Breakout",
      "Session Momentum",
      "Session Reversal",
    ]),
    strategyGroup("Pattern Trading Strategies", [
      "Triangle Patterns",
      "Wedge Patterns",
      "Flag Patterns",
      "Pennant Patterns",
      "Cup and Handle",
      "Harmonic Patterns",
      "Butterfly Pattern",
      "Bat Pattern",
      "Crab Pattern",
      "Gartley Pattern",
      "Cypher Pattern",
    ]),
    strategyGroup("Candlestick Trading Strategies", [
      "Doji",
      "Morning Star",
      "Evening Star",
      "Hammer",
      "Shooting Star",
      "Harami",
      "Tweezer Top/Bottom",
      "Three Soldiers",
      "Three Crows",
    ]),
    strategyGroup("Risk Management Strategies", [
      "Fixed Lot Strategy",
      "Percentage Risk Model",
      "Kelly Criterion",
      "Volatility Position Sizing",
      "Dynamic Risk Allocation",
      "Equity Curve Management",
      "Portfolio Risk Balancing",
      "Drawdown Protection",
      "Daily Loss Limit Strategy",
    ], "control"),
    strategyGroup("Advanced Professional & Institutional Models", [
      "Wyckoff Trading",
      "Market Profile Trading",
      "Volume Profile Trading",
      "Auction Market Theory",
      "Order Book Trading",
      "Footprint Charts",
      "Liquidity Engineering",
      "Quant Macro Trading",
      "Statistical Modeling",
      "AI Predictive Trading",
      "Neural Forecasting",
      "Institutional Flow Analysis",
      "Dark Pool Analysis",
      "Sentiment Engine Trading",
      "Cross-Asset Flow Trading",
    ]),
    strategyGroup("Hybrid Strategies", [
      "Trend + Momentum",
      "SMC + Price Action",
      "Fundamental + Technical",
      "AI + Technical Analysis",
      "News + Liquidity",
      "Scalping + Order Flow",
      "Swing + Macro Analysis",
    ]),
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
  ];
}

function strategyGroup(label: string, children: string[], kind: NodeKind = "engine"): NavigationItem {
  return {
    id: slug(label),
    label,
    kind,
    children: children.map((child) => ({
      id: `${slug(label)}-${slug(child)}`,
      label: child,
      kind,
    })),
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

function mergeUnique(values: string[], additions: string[]): string[] {
  return Array.from(new Set([...values, ...additions]));
}

function findNavigationAncestors(pageId: string): { modules: string[]; groups: string[] } {
  for (const navModuleItem of navigationModules) {
    const groups: string[] = [];

    if (collectGroupAncestors(navModuleItem, pageId, groups)) {
      return { modules: [navModuleItem.id], groups };
    }
  }

  return { modules: [], groups: [] };
}

function collectGroupAncestors(item: NavigationItem, pageId: string, groups: string[]): boolean {
  if (item.id === pageId) {
    return true;
  }

  for (const child of item.children ?? []) {
    if (collectGroupAncestors(child, pageId, groups)) {
      if (child.children && item.id !== pageId) {
        groups.unshift(child.id);
      }
      return true;
    }
  }

  return false;
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

function hrefForPageId(pageId: string): string | null {
  if (pageId === "autonomous-pipeline-command-center") return "/autonomous-pipeline";
  if (pageId === "trading-operations") return "/";
  if (pageId === "executive-overview") return "/";
  if (pageId === "visual-intelligence-overview") return "/visual-intelligence-overview";
  if (pageId === "cacsms-vision-intelligence-room") return "/cacsms-vision";
  if (pageId === "chart-screenshot-capture") return "/visual-intelligence-overview/chart-screenshot-capture";
  if (pageId === "candle-detection") return "/visual-intelligence-overview/candle-detection";
  if (pageId === "swing-point-detection") return "/visual-intelligence-overview/swing-point-detection";
  if (pageId === "pattern-recognition") return "/visual-intelligence-overview/pattern-recognition";
  if (pageId === "trendline-detection") return "/visual-intelligence-overview/trendline-detection";
  if (pageId === "channel-detection") return "/visual-intelligence-overview/channel-detection";
  if (pageId === "support-resistance-mapping") return "/visual-intelligence-overview/support-resistance-mapping";
  if (pageId === "order-block-detection") return "/visual-intelligence-overview/order-block-detection";
  if (pageId === "liquidity-zone-detection") return "/visual-intelligence-overview/liquidity-zone-detection";
  if (pageId === "structure-analysis") return "/visual-intelligence-overview/structure-analysis";
  if (pageId === "multi-timeframe-comparison") return "/visual-intelligence-overview/multi-timeframe-comparison";
  if (pageId === "image-comparison-engine") return "/visual-intelligence-overview/image-comparison-engine";
  if (pageId === "ai-visual-interpretation") return "/visual-intelligence-overview/ai-visual-interpretation";
  if (pageId === "visual-anomaly-detection") return "/visual-intelligence-overview/visual-anomaly-detection";
  if (pageId === "ai-chart-segmentation") return "/visual-intelligence-overview/ai-chart-segmentation";
  if (pageId === "visual-market-interpretation") return "/visual-intelligence-overview/visual-market-interpretation";
  if (pageId === "macro-intelligence-overview") return "/economic-news-and-sentiment-intelligence";
  if (pageId === "economic-calendar-overview") return "/economic-news-and-sentiment-intelligence/economic-calendar";
  if (pageId === "cpi-inflation-events") return "/economic-news-and-sentiment-intelligence/cpi-inflation-events";
  if (pageId === "nfp-employment-events") return "/economic-news-and-sentiment-intelligence/nfp-employment-events";
  if (pageId === "gdp-growth-events") return "/economic-news-and-sentiment-intelligence/gdp-growth-events";
  if (pageId === "central-bank-meetings") return "/economic-news-and-sentiment-intelligence/central-bank-meetings";
  if (pageId === "high-impact-events") return "/economic-news-and-sentiment-intelligence/high-impact-events";
  if (pageId === "news-risk-and-blackout-windows") return "/economic-news-and-sentiment-intelligence/news-risk-and-blackout-windows";
  if (pageId === "fundamental-bias-scoring") return "/economic-news-and-sentiment-intelligence/fundamental-bias-scoring";
  if (pageId === "gold-and-intermarket-analysis") return "/economic-news-and-sentiment-intelligence/gold-and-intermarket-analysis";
  if (pageId === "cot-and-institutional-positioning") return "/economic-news-and-sentiment-intelligence/cot-institutional-positioning";
  if (pageId === "monetary-policy-and-interest-rates") return "/economic-news-and-sentiment-intelligence/monetary-policy-and-interest-rates";
  if (pageId === "infrastructure-overview") return "/mt5-infrastructure";
  if (pageId === "connected-terminals") return "/mt5-infrastructure/terminal-operations/connected-terminals";
  if (pageId === "terminal-registration") return "/mt5-infrastructure/terminal-operations/terminal-registration";
  if (pageId === "terminal-heartbeat") return "/mt5-infrastructure/terminal-operations/terminal-heartbeat";
  if (pageId === "terminal-health-monitoring") return "/mt5-infrastructure/terminal-operations/terminal-health-monitoring";
  if (pageId === "mt5-synchronization") return "/mt5-infrastructure/terminal-operations/mt5-synchronization";
  if (pageId === "mt5-execution-bridge") return "/mt5-infrastructure/terminal-operations/mt5-execution-bridge";
  if (pageId === "ea-communication-engine") return "/mt5-infrastructure/terminal-operations/ea-communication-engine";
  if (pageId === "execution-audit-journal") return "/mt5-infrastructure/terminal-operations/execution-audit-journal";
  if (pageId === "live-latency-monitoring") return "/mt5-infrastructure/terminal-operations/live-latency-monitoring";
  if (pageId === "multi-computer-support") return "/mt5-infrastructure/terminal-operations/multi-computer-support";
  if (pageId === "account-routing") return "/mt5-infrastructure/terminal-operations/account-routing";
  if (pageId === "vps-management") return "/mt5-infrastructure/terminal-operations/vps-management";
  if (pageId === "ea-deployment") return "/mt5-infrastructure/terminal-operations/ea-deployment";
  if (pageId === "ea-deployment-link-manager") return "/mt5-infrastructure/terminal-operations/ea-deployment-link";
  if (pageId === "strategy-intelligence-overview") return "/institutional-strategy-intelligence";
  return strategyPageHref(pageId);
}

function pageIdForPathname(pathname: string): string | null {
  if (pathname === "/autonomous-pipeline") return "autonomous-pipeline-command-center";
  if (pathname === "/") return "executive-overview";
  if (pathname === "/visual-intelligence-overview") return "visual-intelligence-overview";
  if (pathname === "/cacsms-vision") return "cacsms-vision-intelligence-room";
  if (pathname === "/visual-intelligence-overview/chart-screenshot-capture") return "chart-screenshot-capture";
  if (pathname === "/visual-intelligence-overview/candle-detection") return "candle-detection";
  if (pathname === "/visual-intelligence-overview/swing-point-detection") return "swing-point-detection";
  if (pathname === "/visual-intelligence-overview/pattern-recognition") return "pattern-recognition";
  if (pathname === "/visual-intelligence-overview/trendline-detection") return "trendline-detection";
  if (pathname === "/visual-intelligence-overview/channel-detection") return "channel-detection";
  if (pathname === "/visual-intelligence-overview/support-resistance-mapping") return "support-resistance-mapping";
  if (pathname === "/visual-intelligence-overview/order-block-detection") return "order-block-detection";
  if (pathname === "/visual-intelligence-overview/liquidity-zone-detection") return "liquidity-zone-detection";
  if (pathname === "/visual-intelligence-overview/structure-analysis") return "structure-analysis";
  if (pathname === "/visual-intelligence-overview/multi-timeframe-comparison") return "multi-timeframe-comparison";
  if (pathname === "/visual-intelligence-overview/image-comparison-engine") return "image-comparison-engine";
  if (pathname === "/visual-intelligence-overview/ai-visual-interpretation") return "ai-visual-interpretation";
  if (pathname === "/visual-intelligence-overview/visual-anomaly-detection") return "visual-anomaly-detection";
  if (pathname === "/visual-intelligence-overview/ai-chart-segmentation") return "ai-chart-segmentation";
  if (pathname === "/visual-intelligence-overview/visual-market-interpretation") return "visual-market-interpretation";
  if (pathname === "/economic-news-and-sentiment-intelligence") return "macro-intelligence-overview";
  if (pathname === "/economic-news-and-sentiment-intelligence/economic-calendar") return "economic-calendar-overview";
  if (pathname === "/economic-news-and-sentiment-intelligence/cpi-inflation-events") return "cpi-inflation-events";
  if (pathname === "/economic-news-and-sentiment-intelligence/nfp-employment-events") return "nfp-employment-events";
  if (pathname === "/economic-news-and-sentiment-intelligence/gdp-growth-events") return "gdp-growth-events";
  if (pathname === "/economic-news-and-sentiment-intelligence/central-bank-meetings") return "central-bank-meetings";
  if (pathname === "/economic-news-and-sentiment-intelligence/high-impact-events") return "high-impact-events";
  if (pathname === "/economic-news-and-sentiment-intelligence/news-risk-and-blackout-windows") return "news-risk-and-blackout-windows";
  if (pathname === "/economic-news-and-sentiment-intelligence/fundamental-bias-scoring") return "fundamental-bias-scoring";
  if (pathname === "/economic-news-and-sentiment-intelligence/gold-and-intermarket-analysis") return "gold-and-intermarket-analysis";
  if (pathname === "/economic-news-and-sentiment-intelligence/cot-institutional-positioning") return "cot-and-institutional-positioning";
  if (pathname === "/economic-news-and-sentiment-intelligence/monetary-policy-and-interest-rates") return "monetary-policy-and-interest-rates";
  if (pathname === "/mt5-infrastructure") return "infrastructure-overview";
  const match = pathname.match(/^\/mt5-infrastructure\/terminal-operations\/([^/]+)$/);
  if (match?.[1]) {
    return match[1];
  }
  if (pathname === "/institutional-strategy-intelligence") return "strategy-intelligence-overview";
  return strategyPageIdFromPath(pathname);
}
