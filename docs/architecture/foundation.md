# Cacsms Trader Foundation

The first production boundary is intentionally small:

1. MT5 terminals report heartbeats and account snapshots.
2. The server resolves terminal health from heartbeat freshness and latency.
3. Trade intents pass through risk-core before any execution command is queued.
4. Execution commands require terminal acknowledgment.
5. Every risk decision and execution acknowledgment is persisted for audit.

The dashboard treats missing service data as disconnected, not online. Broker demo account testing uses the local MT5 bridge at `http://localhost:8787`.

## Current Packages

- `packages/shared-types`: TypeScript contracts shared by dashboard, services, and bridge code.
- `packages/risk-core`: deterministic prop-firm checks and lot sizing.
- `packages/mt5-protocol`: MT5 command and acknowledgment envelopes.
- `services/mt5-terminal-manager`: heartbeat registry, terminal registration, account routing, and failover selection.

## Architecture Domains

The backend has a typed service foundation for every requested Cacsms Trader domain:

- Web Dashboard: `services/web-dashboard-service`
- Market Intelligence Engine: `services/market-intelligence-engine`
- Computer Vision Chart Engine: `services/computer-vision-service`
- Strategy Engine: `services/strategy-engine-service`
- Risk & Prop Firm Engine: `services/risk-engine-service`
- Execution Engine: `services/execution-engine-service`
- Trade Monitoring Engine: `services/trade-monitor-service`
- Economic Data Engine: `services/economic-data-service`
- Multi-Terminal MT5 Manager: `services/mt5-terminal-manager`

Coverage is declared programmatically in `services/architecture-registry`, which reports zero missing capabilities for the high-level architecture list.

## Safety Rule

No strategy may send an order directly to MT5. Strategies produce trade intents. Risk-core approves or blocks. Execution services convert approved intents into MT5 commands. The current EA sends demo-account heartbeat data only; order routing remains disabled until that loop exists.
