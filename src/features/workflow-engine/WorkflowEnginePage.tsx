import { useMemo, useRef, useState } from 'react';
import './styles/workflow-engine.css';
import { useWorkflowEngine } from './hooks/useWorkflowEngine';
import { createCacsmsWorkflowAdapter, type WorkflowEngineAdapter } from './services/workflowEngineAdapter';
import { WorkflowHeader } from './components/WorkflowHeader';
import { KpiStrip } from './components/KpiStrip';
import { StagePipeline } from './components/StagePipeline';
import { StageInspector } from './components/StageInspector';
import { InstrumentTraceTable } from './components/InstrumentTraceTable';
import { OrchestratorPanel } from './components/OrchestratorPanel';
import { WorldModelPanel } from './components/WorldModelPanel';
import { EventStream } from './components/EventStream';
import { RuntimeHealth } from './components/RuntimeHealth';
import { useTrading } from '../../context/TradingContext';

function useBoundAdapter(external?: WorkflowEngineAdapter): WorkflowEngineAdapter {
  const { auto, setAuto, riskLimit, positions } = useTrading();
  const bindingsRef = useRef({ auto, setAuto, riskLimit, positions });
  bindingsRef.current = { auto, setAuto, riskLimit, positions };

  return useMemo(() => {
    if (external) return external;
    return createCacsmsWorkflowAdapter({
      getAuto: () => bindingsRef.current.auto,
      setAuto: (v) => bindingsRef.current.setAuto(v),
      getRiskLimit: () => bindingsRef.current.riskLimit,
      getPositions: () => bindingsRef.current.positions,
    });
  }, [external]);
}

export default function WorkflowEnginePage({ adapter }: { adapter?: WorkflowEngineAdapter }) {
  const bound = useBoundAdapter(adapter);
  const w = useWorkflowEngine(bound);
  const [selected, setSelected] = useState(1);

  if (w.loading && !w.data) return <div className="wf-shell loading">Starting Workflow Engine…</div>;
  if (w.error && !w.data) return <div className="wf-shell error">{w.error}</div>;

  const d = w.data!;
  const stage = d.stages.find((x) => x.id === selected) || d.stages[0];

  return (
    <div className="wf-shell">
      <WorkflowHeader d={d} onPause={w.pause} onResume={w.resume} onRefresh={w.refresh} onExecution={w.setExecution} />
      {w.error && <div className="alert">Last refresh failed: {w.error}</div>}
      <KpiStrip d={d} />
      <StagePipeline stages={d.stages} selected={selected} onSelect={setSelected} />
      <div className="two">
        <StageInspector stage={stage} onRetry={() => w.retry(stage.id)} />
        <OrchestratorPanel d={d} />
      </div>
      <InstrumentTraceTable rows={d.instruments} onReevaluate={w.reevaluate} />
      <div className="two">
        <WorldModelPanel rows={d.world} />
        <EventStream events={d.events} />
      </div>
      <RuntimeHealth stages={d.stages} />
      <footer className="wf-foot">
        <span>Cacsms Trader · Workflow Engine</span>
        <span>Shared Market World Model · Event Driven · Fail Closed</span>
        <span>Last heartbeat {new Date(d.engine.lastHeartbeat).toLocaleTimeString()}</span>
      </footer>
    </div>
  );
}
