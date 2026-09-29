import React, { useEffect, useState } from 'react';
import Sidebar, { useSidebarCollapsed } from './components/Sidebar';
import Topbar from './components/Topbar';
import { TradingProvider } from './context/TradingContext';
import {
  Overview,
  MarketData,
  Strength,
  Regime,
  Scanner,
  Vision,
  Direction,
  H1,
  Risk,
  Execution,
  Performance,
  SystemControl,
} from './pages/pages';
import { WorkflowEnginePage } from './features/workflow-engine';
import { MT5ConnectionPage } from './features/mt5-connection';
import { ChannelAnalysisPage } from './features/channel-analysis';
import { EconomicIntelligencePage } from './features/economic-intelligence';

const slug = (label: string) => label.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const pages: Record<string, React.ComponentType> = {
  Overview,
  'Workflow Engine': WorkflowEnginePage,
  'Market Data': MarketData,
  'Currency & XAU Strength': Strength,
  'Historical Regime': Regime,
  'Market Scanner': Scanner,
  'Economic Intelligence': EconomicIntelligencePage,
  'HTF Market Vision': Vision,
  'Channel Analysis': ChannelAnalysisPage,
  'Structural Direction': Direction,
  'H1 Confirmation': H1,
  'Opportunities & Risk': Risk,
  'Execution & Positions': Execution,
  'Performance & Learning': Performance,
  'System Control': SystemControl,
  'MT5 Connection': MT5ConnectionPage,
};

const pageBySlug = Object.fromEntries(Object.keys(pages).map((label) => [slug(label), label]));

function pageFromHash(): string {
  const raw = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  if (pages[raw]) return raw;
  return pageBySlug[raw] || 'Overview';
}

export default function App() {
  const [page, setPageState] = useState(pageFromHash);
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const P = pages[page] || Overview;

  const setPage = (next: string) => {
    const label = pages[next] ? next : 'Overview';
    setPageState(label);
    const hash = `#/${slug(label)}`;
    if (window.location.hash !== hash) history.pushState(null, '', hash);
  };

  useEffect(() => {
    const hash = `#/${slug(page)}`;
    if (window.location.hash !== hash) history.replaceState(null, '', hash);
    const onHash = () => setPageState(pageFromHash());
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, [page]);

  return (
    <TradingProvider>
      <div className={'app' + (collapsed ? ' nav-collapsed' : '')}>
        <Sidebar page={page} setPage={setPage} collapsed={collapsed} onCollapsedChange={setCollapsed} />
        <div className="main">
          <Topbar />
          <main>
            <P />
          </main>
        </div>
      </div>
    </TradingProvider>
  );
}
