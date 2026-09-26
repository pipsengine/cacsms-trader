import React, { useState } from 'react';
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

const pages: Record<string, React.ComponentType> = {
  Overview,
  'Workflow Engine': WorkflowEnginePage,
  'Market Data': MarketData,
  'Currency & XAU Strength': Strength,
  'Historical Regime': Regime,
  'Market Scanner': Scanner,
  'HTF Market Vision': Vision,
  'Structural Direction': Direction,
  'H1 Confirmation': H1,
  'Opportunities & Risk': Risk,
  'Execution & Positions': Execution,
  'Performance & Learning': Performance,
  'System Control': SystemControl,
  'MT5 Connection': MT5ConnectionPage,
};

export default function App() {
  const [page, setPage] = useState('Overview');
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const P = pages[page] || Overview;

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
