# Workflow Engine feature matrix

| Capability | UI | Runtime | Production adapter |
|---|---|---|---|
| Stage 1: Market Data & Feed | Implemented | Live from market fixtures + world model | Connected |
| Stage 2: Currency & XAU Strength | Implemented | Strength matrix + differentials | Connected |
| Stage 3: Historical Regime | Implemented | World-model regime persistence | Connected |
| Stage 4: Pair Discovery & Ranking | Implemented | Full 29-instrument universe | Connected |
| Stage 5: HTF Market Vision | Implemented | D1/H8 channel state | Connected |
| Stage 6: Structural Direction | Implemented | Macro + HTF fusion | Connected |
| Stage 7: H1 Confirmation | Implemented | H1 phase / BOS / CHoCH | Connected |
| Stage 8: Opportunity & Risk | Implemented | `qualifyRisk` + portfolio heat | Connected |
| Stage 9: Execution & Position Management | Implemented | Fail-closed + TradingContext | Connected |
| Stage 10: Learning, Audit & Feedback | Implemented | `decisionAudit` + event bus | Connected |
| 29-instrument trace | Implemented | `allPairs` + world model | Connected |
| Orchestrator | Implemented | `routeEvent` / `executionGate` | Connected |
| Market World Model | Implemented | `createWorldState` cache | Connected |
| Event stream | Implemented | Shared `eventBus` | Connected |
| Execution permission | Implemented | Fail-closed via gateway + gates | Connected |
