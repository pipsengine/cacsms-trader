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

## Trend within trend

Stages 5–9 share one classifier, `leg_model.py`. It does not replace the 10-stage pipeline.

For every instrument the classifier keeps these facts separate:

- Dominant HTF trend (a bearish H1 or H8 does not flip a bullish D1)
- Channel region (lower, lower-middle, equilibrium, upper-middle, upper). Position is context. A touch of the upper boundary is a potential counter-trend zone, not a sell.
- Current leg (`BULLISH_IMPULSE`, `BEARISH_CORRECTION`, and the other typed legs)
- Nested relationship (`ALIGNED`, `CORRECTIVE`, `REVERSAL_CANDIDATE`, `RANGE_INTERNAL`, `BREAKOUT`, `UNRESOLVED`)
- Reversal state (`NONE`, `POTENTIAL`, `DEVELOPING`, `CONFIRMED`, `FAILED`). LTF opposition alone stays `NONE`.
- Trade type (`TREND_CONTINUATION_*`, `COUNTER_TREND_*`, `RANGE_ROTATION_*`, `BREAKOUT_*`, `REVERSAL_*`, or `NONE`)

A counter-trend candidate needs the outer HTF region, remaining room to the HTF destination, and a confirmed H1 BOS or CHoCH in the corrective direction. Missing evidence, a late correction (`INSUFFICIENT_RETRACEMENT_ROOM`), or stale channels produce `WAIT` or `BLOCKED`. Stage 8 applies a stricter reward and confidence minimum to counter-trend trades. Prop-firm and account limits stay absolute. Targets are the structural layers TP1, TP2 and the final HTF destination, with a reason on each.

Stage 9 exits a counter-trend position when the correction fails and the dominant trend resumes. If the correction later becomes a confirmed HTF reversal, that transition is recorded and the original trade type is not rewritten.

The result is stored on the existing Stage 5, 6 and 7 decision JSON. No new table is required. When price enters an outer channel region, that symbol is queued for closer H1 observation. The other instruments are not recomputed for that event.

Scanner promotion is still required before a setup can be handed to execution. Execution stays off until the operator turns it on.

## Security

- Passwords are stored only under `bridge/mt5/data/secrets.json` (gitignored), never returned to the browser.
- Bind is localhost-only.
- Account registry and pipeline state persist to `database/db_cacsms-trader.db`.
