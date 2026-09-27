# CACSMS MT5 Bridge

Local Windows bridge between MetaTrader 5 and the Cacsms Trader UI.

## Prerequisites

- MetaTrader 5 installed and running (logged into the target account, or provide login credentials)
- Python 3.10+ with `MetaTrader5` package (`py -m pip install -r requirements.txt`)

## Run

```bash
npm run mt5:bridge
```

Listens on `http://127.0.0.1:8765`. Vite proxies `/mt5-bridge` to this port.

## Security

- Passwords are stored only under `bridge/mt5/data/secrets.json` (gitignored), never returned to the browser.
- Bind is localhost-only.
- Account registry persists to SQL Server `db_Cacsms-Trader` (login from `.env`).
