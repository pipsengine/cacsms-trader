# Cacsms Trader – Workflow Engine page

Monitoring and control surface for the 10-stage autonomous pipeline. The pipeline runs on the MT5 bridge's
central engine (`npm run mt5:bridge`); closing this page never stops it, and the page never manufactures a
signal or submits an order.

## Wiring
- `WorkflowEnginePage` is registered in `src/App.tsx` below **Overview**.
- `services/workflowEngineAdapter.ts` exposes `cacsmsWorkflowAdapter` (`snapshot`, `subscribe`, `reconcile`,
  `rerunStage`, `reevaluate`, `control`). There is no demo adapter.
- `services/workflowRuntime.ts` builds the snapshot from the real stage stores (history, regime, scanner, vision,
  direction, H1, risk, execution), the MT5 runtime and the event bus. `hooks/useWorkflowEngine.ts` subscribes to
  all of them; Refresh only re-reads persisted state.

## Semantics
- Operational health (HEALTHY / DEGRADED / ERROR / OFFLINE) is derived per stage from reachability, freshness,
  run status and latency against the stage's own SLA (`data/stageDefinitions.ts`).
- Pipeline state (IDLE / RUNNING / READY / WAITING / WARMING_UP / BLOCKED / STALE / INVALIDATED / PAUSED) follows
  dependencies fail-closed: a stage whose upstream is not passing shows the blocking stage, and downstream
  evidence is shown as LAST KNOWN, never as live.
- Controls go through `/execution/control` with confirmation and an audit reason:
  Pause new trades (`tradingEnabled`), Pause analysis (`analysisPaused` — Stages 2–8 hold their triggers,
  Stage 9 keeps managing positions), Execution on/off, and a type-to-confirm Emergency stop.
- Re-run stage / Re-evaluate call the bridge's own run endpoints; no gate is bypassed.

## Layout
Styles live in `styles/workflow-engine.css`, scoped under `.wf-shell`. Layout uses container queries on the page
body and panels (the app sidebar width varies independently of the viewport), so there is no horizontal scroll
from 1920 px down to mobile.
