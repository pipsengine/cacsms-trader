# Cacsms Trader

Cacsms Trader is a standalone, integration-ready autonomous FX + XAU trading intelligence portal. The application models 29 instruments (28 combinations of eight major currencies plus XAUUSD) through a ten-stage, event-driven decision pipeline.

## Implemented interface
Overview; Market Data; Currency & XAU Strength; Historical Regime; Market Scanner; HTF Market Vision; Structural Direction; H1 Confirmation; Opportunities & Risk; Execution & Positions; Performance & Learning; System Control.

## Architecture
The UI is separated from the autonomous engines. A shared Market World Model stores timestamped state and the Orchestrator decides which engines run after candle, price, risk and position events. Every downstream action can be invalidated when upstream state becomes stale.

## Safety / execution
The bundled gateway is SIMULATION mode. Live order placement deliberately fails closed until a real broker adapter, credentials, account mapping and explicit live-trading configuration are supplied. Pausing execution does not pause observation.

## Run
1. `npm install`
2. `npm run dev`
3. Production: `npm run build` then `npm run preview`

## Historical fixture
`src/data/fixtures/h1-history.json` contains deterministic simulated H1 history for all 29 instruments. It exists to exercise charts, scanners, backtesting adapters and state transitions without pretending to be broker history. Replace it with validated broker history for production research.
