# Cacsms Trader – Workflow Engine integration module

This package is **page-only**. It does not replace the running repo.

## 1. Copy
Copy this folder under your existing feature/page directory, e.g. `src/features/workflow-engine/`.

## 2. Route
Import `WorkflowEnginePage` and register `/workflow-engine`.

## 3. Sidebar
Add **Workflow Engine** immediately below **Overview**. Do not replace the existing sidebar.

## 4. Adapter
The included `demoWorkflowAdapter` makes every control and real-time panel testable immediately. For production, implement `WorkflowEngineAdapter` against Cacsms Trader's existing Market World Model/event bus. The page never needs to know broker details.

Required adapter operations: snapshot, pause, resume, reevaluate, retry, setExecution.

## 5. Fail closed
Keep execution disabled until your existing broker gateway and risk permissions are wired. The demo runtime reports SIMULATION mode.

## Functional coverage
- 10-stage live pipeline
- Stage selection and inspection
- Confidence, latency, freshness, processed/failure counters
- 29-instrument end-to-end trace/search/filter
- Per-symbol re-evaluation
- Orchestrator health and queue/throughput
- Market World Model inspection
- Event/audit stream and severity filter
- Runtime/SLA telemetry
- Pause/resume, refresh, retry and execution permission control
- Responsive professional dark trading UI
