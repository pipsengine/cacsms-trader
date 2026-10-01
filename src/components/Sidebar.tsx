import { useEffect, useMemo, useState } from 'react';
import {
  Aperture,
  BadgeCheck,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronsLeft,
  ChevronsRight,
  CircuitBoard,
  Coins,
  Cpu,
  Crosshair,
  Globe2,
  History,
  LayoutDashboard,
  LineChart,
  PauseCircle,
  PlayCircle,
  Radar,
  ScanSearch,
  ServerCog,
  ShieldAlert,
  SlidersHorizontal,
  Spline,
  Telescope,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { useTrading } from '../context/TradingContext';
import { useAutonomyState } from '../features/workflow-engine/services/autonomyStore';

type NavItem = { label: string; icon: LucideIcon; section?: string; sectionIcon?: LucideIcon; pageKey?: string };

export const nav: NavItem[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Workflow Engine', icon: CircuitBoard },
  { label: 'Market Data', icon: LineChart, section: 'MARKET INTELLIGENCE', sectionIcon: Globe2 },
  { label: 'Currency & XAU Strength', icon: Coins },
  { label: 'Strength Matrix', icon: BrainCircuit },
  { label: 'Historical Regime', icon: History },
  { label: 'Market Scanner', icon: Radar },
  { label: 'Economic Intelligence', icon: CalendarDays },
  { label: 'HTF Market Vision', icon: Telescope, section: 'MARKET VISION', sectionIcon: Aperture },
  { label: 'Channel Analysis', icon: Spline },
  { label: 'Structural Direction', icon: Waypoints },
  { label: 'H1 Confirmation', icon: BadgeCheck },
  { label: 'Trading Opportunities', icon: ScanSearch, section: 'TRADING', sectionIcon: Bot },
  { label: 'Risk & Authorization', pageKey: 'Opportunities & Risk', icon: ShieldAlert },
  { label: 'Execution & Positions', icon: BriefcaseBusiness },
  { label: 'Performance & Learning', icon: ChartNoAxesCombined, section: 'ANALYTICS', sectionIcon: Crosshair },
  { label: 'System Control', icon: SlidersHorizontal, section: 'SYSTEM', sectionIcon: Cpu },
  { label: 'MT5 Connection', icon: ServerCog },
];

const STORAGE_KEY = 'cacsms.sidebar.collapsed';

export default function Sidebar({
  page,
  setPage,
  collapsed,
  onCollapsedChange,
}: {
  page: string;
  setPage: (p: string) => void;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
}) {
  const trading = useTrading();
  const autonomy = useAutonomyState();
  const positions = trading?.positions ?? [];
  const auto = trading?.auto;
  const setAuto = trading?.setAuto;
  const riskUsed = trading?.riskUsed ?? 0;
  const openCount = useMemo(() => positions.filter((x) => x.status === 'ACTIVE').length, [positions]);
  if (!trading || !setAuto) return null;
  const bridgeUp = Boolean(autonomy?.ok && autonomy.orchestrator?.status);
  const engineLabel = !autonomy
    ? 'CHECKING ENGINE'
    : !bridgeUp
      ? 'ENGINE OFFLINE'
      : !auto
        ? 'NEW TRADES PAUSED'
        : autonomy?.orchestrator?.status === 'HEALTHY'
          ? 'AUTONOMOUS ON'
          : 'ENGINE DEGRADED';
  const engineOn = bridgeUp && Boolean(auto) && autonomy?.orchestrator?.status === 'HEALTHY';
  const engineHint = !bridgeUp
    ? 'Bridge stopped. Run npm run mt5:bridge'
    : !auto
      ? 'Analysis continues. New orders are paused.'
      : openCount
        ? 'MT5 positions synced'
        : 'No open positions';

  return (
    <aside className={'sidebar' + (collapsed ? ' collapsed' : '')} aria-label="Primary navigation">
      <div className="sidebar-top">
        <div className="brand" title="Cacsms Trader">
          <span className="brand-mark">
            <BrainCircuit size={22} strokeWidth={1.75} />
          </span>
          {!collapsed && (
            <div className="brand-copy">
              <b>CACSMS TRADER</b>
              <small>Autonomous Trading Intelligence</small>
            </div>
          )}
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => onCollapsedChange(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronsRight size={16} strokeWidth={2} /> : <ChevronsLeft size={16} strokeWidth={2} />}
        </button>
      </div>

      <nav>
        {nav.map((item) => (
          <div key={item.label} className="nav-block">
            {item.section && (
              <div className="nav-label" title={item.section}>
                {item.sectionIcon && <item.sectionIcon size={12} strokeWidth={2} />}
                {!collapsed && <span>{item.section}</span>}
              </div>
            )}
            <button
              type="button"
              onClick={() => setPage(item.pageKey ?? item.label)}
              className={page === (item.pageKey ?? item.label) ? 'selected' : ''}
              title={item.label}
              aria-current={page === (item.pageKey ?? item.label) ? 'page' : undefined}
            >
              <item.icon size={18} strokeWidth={1.85} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          </div>
        ))}
      </nav>

      <div className={'engine-box' + (collapsed ? ' compact' : '')}>
        {collapsed ? (
          <>
            <div className={'engine-compact ' + (engineOn ? 'on' : 'off')} title={engineLabel}>
              <span className={engineOn ? 'dot on' : 'dot'} />
              {engineOn ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
            </div>
            <button
              type="button"
              className={'icon-action ' + (auto ? 'danger' : 'primary')}
              title={bridgeUp ? (auto ? 'Pause New Trades' : 'Resume Trading') : 'Start the MT5 bridge before changing trading'}
              disabled={!bridgeUp}
              onClick={() => setAuto(!auto)}
            >
              {auto ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
            </button>
          </>
        ) : (
          <>
            <div className="engine-title">
              <span className={engineOn ? 'dot on' : 'dot'} />
              <b>{engineLabel}</b>
            </div>
            <small>{engineHint}</small>
            <div className="engine-stats">
              <span>
                Open <b>{openCount}</b>
              </span>
              <span>
                Risk <b>{riskUsed.toFixed(2)}%</b>
              </span>
            </div>
            <button type="button" className={auto ? 'danger' : 'primary'} disabled={!bridgeUp} title={bridgeUp ? '' : 'The bridge must be running before this control can reach the engine'} onClick={() => setAuto(!auto)}>
              {auto ? 'Pause New Trades' : 'Resume Trading'}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

/** Persist preference helper used by App. */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // Phones get the icon rail regardless of the stored preference; a full sidebar would leave no room for content.
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  return [collapsed || narrow, setCollapsed] as const;
}

const NARROW_QUERY = '(max-width: 760px)';
