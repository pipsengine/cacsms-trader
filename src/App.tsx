import React, { useEffect, useState } from 'react';
import Sidebar, { useSidebarCollapsed } from './components/Sidebar';
import Topbar from './components/Topbar';
import { TradingProvider } from './context/TradingContext';
import {
  Overview,
  MarketData,
  Strength,
  IntelligenceStrengthMatrix,
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
import { TradingOpportunitiesPage } from './features/trading-opportunities';
import { AIChartAnalysisPage } from './features/ai-chart-analysis';
import { AIChartMockPage } from './features/ai-chart-analysis/AIChartMockPage';
import { AIAnalysisLibraryPage } from './features/ai-analysis-library/AIAnalysisLibraryPage';

const slug = (label: string) => label.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const pages: Record<string, React.ComponentType> = {
  Overview,
  'Workflow Engine': WorkflowEnginePage,
  'Market Data': MarketData,
  'Currency & XAU Strength': Strength,
  'Strength Matrix': IntelligenceStrengthMatrix,
  'Historical Regime': Regime,
  'Market Scanner': Scanner,
  'Economic Intelligence': EconomicIntelligencePage,
  'AI Chart Analysis': AIChartAnalysisPage,
  'AI Analysis Library': AIAnalysisLibraryPage,
  'HTF Market Vision': Vision,
  'Channel Analysis': ChannelAnalysisPage,
  'Structural Direction': Direction,
  'H1 Confirmation': H1,
  'Trading Opportunities': TradingOpportunitiesPage,
  'Opportunities & Risk': Risk,
  'Execution & Positions': Execution,
  'Performance & Learning': Performance,
  'System Control': SystemControl,
  'MT5 Connection': MT5ConnectionPage,
};

const pageBySlug = Object.fromEntries(Object.keys(pages).map((label) => [slug(label), label]));

function pageFromHash(): string {
  const raw = decodeURIComponent(window.location.hash.replace(/^#\/?/, '')).split('?')[0];
  if (pages[raw]) return raw;
  if (raw === 'risk-and-authorization') return 'Opportunities & Risk';
  if (raw === 'trading-opportunities') return 'Trading Opportunities';
  if (raw === 'ai-chart-mock') return '__ai_chart_mock__';
  return pageBySlug[raw] || 'Overview';
}

export default function App() {
  const [page, setPageState] = useState(pageFromHash);
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const P = page === '__ai_chart_mock__' ? AIChartMockPage : pages[page] || Overview;

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
