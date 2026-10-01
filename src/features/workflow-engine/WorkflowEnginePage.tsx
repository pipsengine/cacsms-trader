import { useEffect, useMemo, useState } from 'react';
import { useTrading } from '../../context/TradingContext';
import { pipelineFocusSymbol } from '../market-scanner/services/scannerStage';
import { useScannerStore } from '../market-scanner/services/scannerStore';
import './styles/workflow-engine.css';
import { useWorkflowEngine } from './hooks/useWorkflowEngine';
import type { WorkflowEngineAdapter } from './services/workflowEngineAdapter';
import { WorkflowHeader } from './components/WorkflowHeader';
import { KpiStrip } from './components/KpiStrip';
import { StagePipeline } from './components/StagePipeline';
import { StageInspector } from './components/StageInspector';
import { InstrumentTraceTable } from './components/InstrumentTraceTable';
import { OrchestratorPanel } from './components/OrchestratorPanel';
import { DecisionQueue } from './components/DecisionQueue';
import { OpportunityFrameworkPanel } from './components/OpportunityFrameworkPanel';
import { startFrameworkStore } from './services/frameworkStore';
import { WorldModelPanel } from './components/WorldModelPanel';
import { EventStream } from './components/EventStream';
import { RuntimeHealth } from './components/RuntimeHealth';
import { ConfirmDialog, type ConfirmSpec } from './components/ConfirmDialog';
import { clock } from './utils/format';

/** Monitoring / control surface only: the pipeline runs on the bridge's central engine whether or not this page is open. */
export default function WorkflowEnginePage({ adapter }: { adapter?: WorkflowEngineAdapter }) {
  const w = useWorkflowEngine(adapter);
  const { selected: chartSymbol } = useTrading();
  const scan = useScannerStore();
  const leaderSymbol = useMemo(() => pipelineFocusSymbol() ?? chartSymbol, [scan.state, chartSymbol]);
  const [selected, setSelected] = useState(1);
  const [pinnedWorld, setPinnedWorld] = useState<string | null>(null);
  /** Stage cards follow the pinned instrument; otherwise the chart symbol, then the Stage 4 leader. */
  const pipelineSymbol = pinnedWorld ?? chartSymbol ?? leaderSymbol;
  const worldSymbol = pinnedWorld ?? leaderSymbol;
  useEffect(() => startFrameworkStore(), []);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  if (!w.data) return <div className={`wf-shell ${w.error ? 'wf-error' : 'wf-loading'}`}>{w.error ?? 'Reading the central engine state…'}</div>;

  const d = w.data;
  const stage = d.stages.find((x) => x.id === selected) ?? d.stages[0];
  const focus = (symbol: string) => {
    setExpanded(symbol);
    setPinnedWorld(symbol);
  };

  return (
    <div className="wf-shell">
      <div className="wf-body">
      <WorkflowHeader d={d} busy={w.busy} onReconcile={() => void w.reconcile()} onControl={(cmd, reason) => void w.control(cmd, reason)} confirm={setConfirm} />
      {w.error && <div className="alert">Snapshot failed: {w.error}</div>}
      {!d.engine.bridgeReachable && <div className="alert">MT5 bridge is not running, so every stage is OFFLINE and nothing on screen is live. Open a terminal in the project folder and run npm run mt5:bridge. Leave that window open. If the website is closed as well, run npm run dev instead.</div>}
      {d.engine.analysisPaused && <div className="alert info">Analysis is PAUSED on the central engine: Stages 2–8 hold their triggers, Stage 9 blocks new entries and keeps managing open positions.</div>}
      {w.busy && <div className="notice busy">{w.busy} in progress…</div>}
      {!w.busy && w.notice && (
        <div className={`notice ${w.notice.ok ? 'ok' : 'bad'}`} onClick={w.clearNotice}>
          {w.notice.ok ? '✓' : '✗'} {w.notice.message} <small>{clock(new Date(w.notice.at).toISOString())} · click to dismiss</small>
        </div>
      )}
      <KpiStrip d={d} />
      <StagePipeline stages={d.stages} selected={selected} focus={pipelineSymbol} leader={leaderSymbol} onSelect={setSelected} />
      <div className="two">
        <StageInspector stage={stage} busy={Boolean(w.busy)} onRerun={() => void w.rerunStage(stage.id)} />
        <OrchestratorPanel d={d} />
      </div>
      <DecisionQueue rows={d.queue} onSelect={focus} />
      <OpportunityFrameworkPanel focus={worldSymbol} onPinSymbol={(s) => setPinnedWorld(s)} />
      <InstrumentTraceTable rows={d.instruments} busy={w.busy} onReevaluate={(s) => void w.reevaluate(s)} expanded={expanded} onExpand={setExpanded} />
      <div className="two">
        <WorldModelPanel rows={d.world} symbol={worldSymbol} onSymbol={setPinnedWorld} />
        <EventStream events={d.events} symbols={d.instruments.map((x) => x.symbol)} />
      </div>
      <RuntimeHealth stages={d.stages} onSelect={setSelected} />
      <footer className="wf-foot">
        <span>Cacsms Trader · Workflow Engine</span>
        <span>Event driven · fail closed · the page never executes</span>
        <span>Snapshot {clock(d.generatedAt)}</span>
      </footer>
      </div>
      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
