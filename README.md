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

## Run with Docker Desktop

Prerequisites:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running

Copy the environment template and start the stack:

```bash
cp .env.example .env
npm run docker:up
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm run docker:up
```

`docker:up` builds the Next.js app on your machine, packages the standalone output into a Docker image, starts PostgreSQL/Redis, applies database migrations, and runs the dashboard plus MT5 bridge.

Services:

- Dashboard: [http://localhost:3001](http://localhost:3001) (default Docker host port; override with `APP_HOST_PORT`)
- MT5 bridge: [http://localhost:8787/health](http://localhost:8787/health)
- PostgreSQL: `localhost:5433` (container uses internal port 5432)
- Redis: `localhost:6380`

Database migrations run automatically on app startup. View logs with:

```bash
npm run docker:logs
```

Stop the stack:

```bash
npm run docker:down
```

In MT5 on your host machine, add `http://127.0.0.1:8787` to allowed WebRequest URLs (the bridge port is published from the container).

### EA deployment in Docker (Windows)

The only EA source in this repo is `mt5/experts/CacsmsTraderEA/CacsmsTraderEA.mq5`. The EA deployment tool copies it into your local MT5 `MQL5/Experts/CacsmsTraderEA/` folder when the container can see your MetaQuotes data directory. Do not use legacy copies under `MQL5/Experts/CacsmsTrader` or `Experts/CACSMS` in MetaTrader.

1. Set your host MetaQuotes path in `.env` (forward slashes):

```env
CACSMS_MT5_METAQUOTES_HOST_PATH=C:/Users/YourUser/AppData/Roaming/MetaQuotes
```

2. Restart the stack:

```powershell
npm run docker:down
npm run docker:up
```

3. Open **MT5 Infrastructure → EA Deployment Link Manager**, click **Detect MT5 folders**, then use **Copy files** (recommended in Docker; symlinks are for native Windows runs).

If `CACSMS_MT5_METAQUOTES_HOST_PATH` is empty, Compose mounts a local stub (`.docker/mt5-host-stub`) so the stack still starts; EA detect will find no folders until you set your real MetaQuotes path.

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
