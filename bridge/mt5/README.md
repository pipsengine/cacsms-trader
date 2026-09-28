# CACSMS MT5 Bridge

Local Windows bridge between MetaTrader 5 and the Cacsms Trader UI.

## Prerequisites

- MetaTrader 5 installed and running (logged into the target account, or provide login credentials)
- Python 3.10+ with `MetaTrader5` package (`py -m pip install -r requirements.txt`)

## Run

```bash
npm run dev
```

This starts the web app and bridge together, and opens or attaches to the local MT5
terminal. Set `MT5_TERMINAL_PATH` in `.env` to a specific `terminal64.exe` when
multiple installations exist. To run only the bridge, use `npm run mt5:bridge`.

The bridge listens on `http://127.0.0.1:8765`. Vite proxies `/mt5-bridge` to this port.
On first start it creates and migrates `database/db_cacsms-trader.db` using SQLite.

The trading pipeline runs inside the bridge process. Closing the browser does not stop it.
Closing the terminal that is running the bridge does.

## Restart the bridge (Windows)

The website can be open while the engine is stopped. The sidebar then says **ENGINE OFFLINE**
and the pages show **Failed to fetch** or **LAST KNOWN**. That is not a live pipeline.

1. Open a terminal in `c:\Content-Generation\cacsms-trader`.
2. If the website is already open at `http://127.0.0.1:5173`, start only the engine:

```powershell
npm run mt5:bridge
```

3. Leave that window open. You should see `listening on http://127.0.0.1:8765` and
   `persistent Autonomous Orchestrator ... started`. Refresh the page. The header should
   change from ENGINE OFFLINE to ENGINE LIVE or ENGINE DEGRADED.
4. If nothing is running, use one window for both:

```powershell
npm run dev
```

5. To restart an engine that is already running, click that terminal and press `Ctrl+C`,
   then run `npm run mt5:bridge` again. `npm run dev` also restarts the bridge on its own
   if the process exits.
6. MetaTrader 5 must be open and logged in. Execution stays disabled until you turn
   **Execution ON** in Workflow Engine. Pause New Trades only blocks new orders. It does
   not stop analysis.

## Security

- Passwords are stored only under `bridge/mt5/data/secrets.json` (gitignored), never returned to the browser.
- Bind is localhost-only.
- Account registry and pipeline state persist to `database/db_cacsms-trader.db`.
