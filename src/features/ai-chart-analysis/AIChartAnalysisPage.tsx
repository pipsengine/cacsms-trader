import { useEffect, useRef, useState } from 'react';

import { useTrading } from '../../context/TradingContext';

import { fetchChannelInstruments } from './aiChartClient';

import { startAiChartStore, setAiChartSymbol } from './aiChartStore';

import { startAutonomyStore } from '../workflow-engine/services/autonomyStore';

import { ProductionV4Workspace } from './production-v4/ProductionV4Workspace';

import './v4-compositor/aca-v4-embedded.css';

export function AIChartAnalysisPage() {
  useEffect(() => startAiChartStore(), []);
  useEffect(() => startAutonomyStore(), []);

  const { selected: globalSymbol } = useTrading();
  const [symbols, setSymbols] = useState<string[]>(['XAUUSD']);
  const syncedGlobal = useRef(false);

  useEffect(() => {
    fetchChannelInstruments()
      .then(setSymbols)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (syncedGlobal.current || !globalSymbol || !symbols.includes(globalSymbol)) return;
    syncedGlobal.current = true;
    setAiChartSymbol(globalSymbol);
  }, [globalSymbol, symbols]);

  return (
    <div className="aca-v4-page aca-v4-root">
      <ProductionV4Workspace symbols={symbols} />
    </div>
  );
}

export default AIChartAnalysisPage;
