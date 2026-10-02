import { demoAutonomousSnapshot } from './v4-compositor/demoSnapshot';
import { V4ProductionWorkspace } from './v4-compositor/V4ProductionWorkspace';
import './v4-compositor/aca-v4-embedded.css';

/** Static reference mock — open via #/ai-chart-mock (v4 compositor + demo snapshot). */
export function AIChartMockPage() {
  return (
    <div className="aca-v4-page aca-v4-root" style={{ minHeight: 'calc(100vh - 80px)' }}>
      <V4ProductionWorkspace symbols={['XAUUSD']} mockSnapshot={demoAutonomousSnapshot} />
    </div>
  );
}
