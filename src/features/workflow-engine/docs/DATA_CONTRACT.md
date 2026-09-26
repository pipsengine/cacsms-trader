# Data contract
The page consumes `WorkflowSnapshot`. Each refresh is an atomic view of stage runtime, 29 instrument traces, events, world-model records and engine health. Production should prefer the repo event bus/WebSocket subscription; polling is a safe fallback. Stage outputs must carry timestamps and confidence. The orchestrator should reject stale upstream state before execution.
