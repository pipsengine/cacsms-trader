# Cacsms Trader

Cacsms Trader is the foundation for a self-driving forex trading platform. The project is intentionally being built in a safety-first order: stable terminal connectivity, explicit risk rules, auditable execution contracts, and only then automated strategies.

This repository currently contains:

- A Next.js dashboard shell for account, terminal, risk, and market status.
- Shared TypeScript contracts for accounts, terminals, market data, risk, and execution.
- A first-pass risk core for prop-firm style guardrails and lot sizing.
- MT5 bridge protocol types for command/acknowledgment messaging.
- A terminal manager skeleton for heartbeat-based multi-terminal state.

## Current Status

The dashboard is prepared for broker demo account connectivity through the local MT5 bridge. It must not be connected to a live or prop-firm account until the execution service, risk engine, audit logging, and forward-testing controls are implemented and verified.

Forex trading carries substantial risk. This system can be engineered for stability and strict safeguards, but it cannot be guaranteed loss-free or profitable.

## Run Locally

Prerequisites:

- Node.js 20+
- npm

Install dependencies:

```bash
npm install
```

Run the dashboard:

```bash
npm run dev
```

Run the local MT5 bridge for demo-account heartbeat testing:

```bash
npm run bridge:mt5
```

Run both together:

```bash
npm run dev:all
```

In MT5, add `http://127.0.0.1:8787` to the allowed WebRequest URLs, compile `mt5/experts/CacsmsTraderEA/CacsmsTraderEA.mq5`, and attach the EA to a chart on a broker demo account.

Verify the project:

```bash
npm run lint
npm run typecheck
npm run build
```

## Foundation Build Order

1. Shared contracts and risk-core rules.
2. MT5 EA bridge protocol and terminal heartbeat.
3. Execution acknowledgment and command queue.
4. Dashboard connected to real service state.
5. Backtesting and forward-testing harness.
6. First controlled strategy implementations.
7. Automation and AI strategy selection after safety checks are proven.
