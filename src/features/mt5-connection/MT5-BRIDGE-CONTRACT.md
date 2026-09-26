# MT5 Bridge Contract

The browser page is an observability/control surface. The persistent MT5 bridge belongs in the existing Cacsms Trader backend/service layer.

## Required state machine
DISCONNECTED → CONNECTING → AUTHENTICATING → SYNCHRONIZING → HEALTHY. Any stale heartbeat, broker rejection, terminal loss or reconciliation mismatch moves execution to DEGRADED/BLOCKED. Reconnection must complete account sync, open-order/position reconciliation and market-data freshness validation before new orders are permitted.

## Currency invariant
Every monetary amount has a currency. Account-native values are never silently aggregated across currencies. Reporting conversion is optional and separate from execution/risk accounting.

## Security invariant
The browser never receives retrievable MT5 passwords. Credentials are referenced through the host application's secure secret facility. All trading commands are authenticated/authorized and audited server-side.

## Execution invariant
A qualified market setup is not a blanket copy instruction. Each account independently validates connectivity, account mode, instrument mapping/specification, market state, spread/slippage bounds, risk budget, margin, prop restrictions and position limits before execution.
