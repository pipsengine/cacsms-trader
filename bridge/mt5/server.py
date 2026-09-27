#!/usr/bin/env python3
"""Localhost MT5 bridge for Cacsms Trader — account sync, test, secrets."""

from __future__ import annotations

import json
import os
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
from datetime import datetime, timezone

try:
    import MetaTrader5 as mt5
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "MetaTrader5 package missing. Run: py -m pip install -r bridge/mt5/requirements.txt"
    ) from exc

try:
    from db import (
        delete_account,
        health as db_health,
        list_accounts,
        list_positions,
        load_app_state,
        replace_positions,
        save_app_state,
        upsert_account,
    )
except ImportError:
    from bridge.mt5.db import (  # type: ignore
        delete_account,
        health as db_health,
        list_accounts,
        list_positions,
        load_app_state,
        replace_positions,
        save_app_state,
        upsert_account,
    )

HOST = os.environ.get("MT5_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("MT5_BRIDGE_PORT", "8765"))
ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SECRETS_PATH = DATA / "secrets.json"
MT5_PATH = os.environ.get("MT5_TERMINAL_PATH", "").strip() or None

DATA.mkdir(parents=True, exist_ok=True)


def _load_secrets() -> dict[str, Any]:
    if not SECRETS_PATH.exists():
        return {}
    try:
        return json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_secrets(data: dict[str, Any]) -> None:
    SECRETS_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    try:
        os.chmod(SECRETS_PATH, 0o600)
    except OSError:
        pass


def _account_payload(info: Any) -> dict[str, Any]:
    return {
        "login": str(info.login),
        "name": info.name,
        "server": info.server,
        "company": info.company,
        "currency": info.currency,
        "balance": float(info.balance),
        "equity": float(info.equity),
        "margin": float(info.margin),
        "freeMargin": float(info.margin_free),
        "leverage": int(info.leverage),
        "profit": float(info.profit),
        "tradeAllowed": bool(info.trade_allowed),
        "tradeExpert": bool(info.trade_expert),
    }


def _positions_payload(login: str, currency: str) -> list[dict[str, Any]]:
    positions = mt5.positions_get()
    if positions is None:
        return []
    out: list[dict[str, Any]] = []
    for p in positions:
        side = "BUY" if int(p.type) == 0 else "SELL"
        ticket = str(p.ticket)
        out.append(
            {
                "id": f"mt5-{ticket}",
                "accountLogin": login,
                "cacsmsTradeId": f"MT5-{ticket}",
                "mt5OrderId": ticket,
                "mt5DealId": ticket,
                "mt5PositionId": ticket,
                "symbol": p.symbol,
                "side": side,
                "volume": float(p.volume),
                "entry": float(p.price_open),
                "current": float(p.price_current),
                "sl": float(p.sl) if p.sl else None,
                "tp": float(p.tp) if p.tp else None,
                "pnl": float(p.profit),
                "currency": currency,
                "status": "OPEN",
                "openedAt": _mt5_time(p.time),
            }
        )
    return out


def _mt5_time(ts: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()


def _ensure_terminal(path: str | None = None) -> tuple[bool, str]:
    kwargs: dict[str, Any] = {}
    terminal = path or MT5_PATH
    if terminal:
        kwargs["path"] = terminal
    if not mt5.initialize(**kwargs):
        err = mt5.last_error()
        return False, f"MT5 initialize failed: {err}"
    return True, "ok"


def _login_if_needed(login: int, password: str | None, server: str | None) -> tuple[bool, str]:
    info = mt5.account_info()
    if info and int(info.login) == login:
        return True, "already_attached"
    if not password or not server:
        current = str(info.login) if info else "none"
        return (
            False,
            f"Terminal attached to login {current}; need password+server to switch to {login}",
        )
    ok = mt5.login(login, password=password, server=server)
    if not ok:
        return False, f"MT5 login failed: {mt5.last_error()}"
    return True, "logged_in"


def cmd_health() -> dict[str, Any]:
    ok, msg = _ensure_terminal()
    if not ok:
        return {
            "ok": False,
            "bridge": "DISCONNECTED",
            "message": msg,
            "terminalConnected": False,
        }
    term = mt5.terminal_info()
    info = mt5.account_info()
    return {
        "ok": True,
        "bridge": "HEALTHY" if term and term.connected else "DEGRADED",
        "message": "Bridge online",
        "terminalConnected": bool(term and term.connected),
        "terminalName": term.name if term else None,
        "terminalPath": term.path if term else None,
        "login": str(info.login) if info else None,
        "server": info.server if info else None,
        "currency": info.currency if info else None,
        "equity": float(info.equity) if info else None,
        "pingLastMs": int(round((term.ping_last or 0) / 1000)) if term else None,
    }


def cmd_pulse(body: dict[str, Any]) -> dict[str, Any]:
    """Fast 1Hz account + positions + ticks. Does not write SQL (caller may throttle persist)."""
    login_raw = body.get("login")
    if login_raw is None:
        return {"ok": False, "message": "login is required"}
    try:
        login = int(str(login_raw).strip())
    except ValueError:
        return {"ok": False, "message": "login must be numeric"}

    account_id = str(body.get("accountId") or login)
    password = body.get("password")
    server = body.get("server")
    secrets = _load_secrets()
    stored = secrets.get(account_id) or secrets.get(str(login)) or {}
    if not password:
        password = stored.get("password")
    if not server:
        server = body.get("server") or stored.get("server")

    ok, msg = _ensure_terminal(body.get("path"))
    if not ok:
        return {"ok": False, "message": msg, "bridge": "DISCONNECTED"}

    ok, login_msg = _login_if_needed(login, password, server)
    if not ok:
        return {"ok": False, "message": login_msg, "bridge": "DEGRADED"}

    info = mt5.account_info()
    if not info or int(info.login) != login:
        return {"ok": False, "message": "Account not attached for pulse"}

    term = mt5.terminal_info()
    account = _account_payload(info)
    positions = _positions_payload(str(info.login), info.currency)

    ticks: list[dict[str, Any]] = []
    for sym in body.get("symbols") or []:
        name = str(sym).strip()
        if not name:
            continue
        mt5.symbol_select(name, True)
        tick = mt5.symbol_info_tick(name)
        if tick is None:
            continue
        ticks.append(
            {
                "symbol": name,
                "bid": float(tick.bid),
                "ask": float(tick.ask),
                "last": float(tick.last),
                "volume": int(tick.volume),
                "time": _mt5_time(tick.time),
            }
        )

    return {
        "ok": True,
        "message": "pulse",
        "bridge": "HEALTHY" if term and term.connected else "DEGRADED",
        "loginMsg": login_msg,
        "account": account,
        "positions": positions,
        "ticks": ticks,
        "latencyMs": int((term.ping_last or 0) / 1000) if term else 0,
    }


_TF_MAP = {
    "M1": None,
    "M5": None,
    "M15": None,
    "H1": None,
    "H4": None,
    "H8": None,  # synthesized from H1
    "D1": None,
    "W1": None,
    "MN1": None,
}


def _tf_const(name: str):
    mapping = {
        "M1": mt5.TIMEFRAME_M1,
        "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "H1": mt5.TIMEFRAME_H1,
        "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
        "W1": mt5.TIMEFRAME_W1,
        "MN1": mt5.TIMEFRAME_MN1,
    }
    return mapping.get(name.upper())


def _dir_from_closes(prev: float, last: float) -> str:
    if last > prev * 1.00005:
        return "BULLISH"
    if last < prev * 0.99995:
        return "BEARISH"
    return "NEUTRAL"


def _symbol_enrich(symbol: str) -> dict[str, Any]:
    mt5.symbol_select(symbol, True)
    tick = mt5.symbol_info_tick(symbol)
    info = mt5.symbol_info(symbol)
    out: dict[str, Any] = {"symbol": symbol, "ok": tick is not None}
    if tick is None:
        out["message"] = str(mt5.last_error())
        return out

    bid = float(tick.bid)
    ask = float(tick.ask)
    point = float(info.point) if info and info.point else (0.01 if "JPY" in symbol or symbol == "XAUUSD" else 0.00001)
    spread = (ask - bid) / point if point else 0

    d1 = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_D1, 0, 3)
    h1 = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_H1, 0, 16)
    h4 = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_H4, 0, 4)

    change = 0.0
    d1_dir = "NEUTRAL"
    if d1 is not None and len(d1) >= 1:
        open_ = float(d1[-1]["open"])
        if open_:
            change = round((bid - open_) / open_ * 100, 2)
        if len(d1) >= 2:
            d1_dir = _dir_from_closes(float(d1[-2]["close"]), float(d1[-1]["close"]))

    h8_dir = "NEUTRAL"
    if h4 is not None and len(h4) >= 2:
        h8_dir = _dir_from_closes(float(h4[-2]["close"]), float(h4[-1]["close"]))

    h1_phase = "Waiting"
    h1_dir = "NEUTRAL"
    if h1 is not None and len(h1) >= 3:
        c0, c1, c2 = float(h1[-3]["close"]), float(h1[-2]["close"]), float(h1[-1]["close"])
        h1_dir = _dir_from_closes(c1, c2)
        if (c2 > c1 > c0) or (c2 < c1 < c0):
            h1_phase = "Confirmed"
        elif abs(c2 - c1) / max(point, 1e-9) < 5:
            h1_phase = "Range"
        else:
            h1_phase = "Pullback"

    score = 0.0
    if d1_dir == h8_dir and d1_dir != "NEUTRAL":
        score += 40
    if h1_phase == "Confirmed":
        score += 35
    elif h1_phase == "Pullback":
        score += 20
    score += min(25, abs(change) * 8)
    score = round(min(99, score), 1)

    state = "WAIT"
    if score >= 75 and h1_phase == "Confirmed":
        state = "READY"
    elif tick.time and (time.time() - int(tick.time)) > 3600:
        state = "BLOCKED"

    bars = {
        "D1": int(len(d1)) if d1 is not None else 0,
        "H4": int(len(h4)) if h4 is not None else 0,
        "H1": int(len(h1)) if h1 is not None else 0,
    }

    out.update(
        {
            "bid": bid,
            "ask": ask,
            "last": float(tick.last),
            "volume": int(tick.volume),
            "time": _mt5_time(tick.time),
            "spread": round(spread, 1),
            "change": change,
            "d1": d1_dir,
            "h8": h8_dir,
            "h1": h1_phase,
            "h1Dir": h1_dir,
            "score": score,
            "state": state,
            "confidence": round(min(99, score + 5), 1),
            "channelPos": 50,
            "strengthDiff": round(change, 1),
            "bars": bars,
            "tradeMode": int(info.trade_mode) if info else None,
            "digits": int(info.digits) if info else None,
        }
    )
    return out


def cmd_enrich(body: dict[str, Any]) -> dict[str, Any]:
    ok, msg = _ensure_terminal(body.get("path"))
    if not ok:
        return {"ok": False, "message": msg, "bridge": "DISCONNECTED", "instruments": []}
    symbols = body.get("symbols") or []
    rows = [_symbol_enrich(str(s)) for s in symbols]
    term = mt5.terminal_info()
    return {
        "ok": True,
        "message": f"Enriched {len(rows)} symbols from MT5",
        "bridge": "HEALTHY" if term and term.connected else "DEGRADED",
        "instruments": rows,
        "latencyMs": int((term.ping_last or 0) / 1000) if term else 0,
        "at": datetime.now(timezone.utc).isoformat(),
    }


def cmd_bars(body: dict[str, Any]) -> dict[str, Any]:
    symbol = str(body.get("symbol") or "").strip()
    timeframe = str(body.get("timeframe") or "H1").upper()
    count = int(body.get("count") or 100)
    count = max(10, min(count, 5000))
    if not symbol:
        return {"ok": False, "message": "symbol required"}
    ok, msg = _ensure_terminal(body.get("path"))
    if not ok:
        return {"ok": False, "message": msg, "bars": []}

    mt5.symbol_select(symbol, True)
    if timeframe == "H8":
        # Build H8 from H1 (8 bars)
        raw = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_H1, 0, count * 8)
        if raw is None:
            return {"ok": False, "message": f"No H1 rates for H8: {mt5.last_error()}", "bars": []}
        bars = []
        chunk: list[Any] = []
        for r in raw:
            chunk.append(r)
            if len(chunk) == 8:
                bars.append(
                    {
                        "time": _mt5_time(int(chunk[0]["time"])),
                        "open": float(chunk[0]["open"]),
                        "high": float(max(x["high"] for x in chunk)),
                        "low": float(min(x["low"] for x in chunk)),
                        "close": float(chunk[-1]["close"]),
                        "volume": int(sum(x["tick_volume"] for x in chunk)),
                    }
                )
                chunk = []
        return {"ok": True, "symbol": symbol, "timeframe": "H8", "bars": bars[-count:], "count": len(bars[-count:])}

    tf = _tf_const(timeframe)
    if tf is None:
        return {"ok": False, "message": f"Unsupported timeframe {timeframe}", "bars": []}
    raw = mt5.copy_rates_from_pos(symbol, tf, 0, count)
    if raw is None:
        return {"ok": False, "message": f"No rates: {mt5.last_error()}", "bars": []}
    bars = [
        {
            "time": _mt5_time(int(r["time"])),
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "volume": int(r["tick_volume"]),
        }
        for r in raw
    ]
    return {"ok": True, "symbol": symbol, "timeframe": timeframe, "bars": bars, "count": len(bars)}


def cmd_sync(body: dict[str, Any]) -> dict[str, Any]:
    login_raw = body.get("login")
    if login_raw is None:
        return {"ok": False, "message": "login is required"}
    try:
        login = int(str(login_raw).strip())
    except ValueError:
        return {"ok": False, "message": "login must be numeric"}

    account_id = str(body.get("accountId") or login)
    password = body.get("password")
    server = body.get("server")
    path = body.get("path")

    secrets = _load_secrets()
    stored = secrets.get(account_id) or secrets.get(str(login)) or {}
    if not password:
        password = stored.get("password")
    if not server:
        server = body.get("server") or stored.get("server")

    ok, msg = _ensure_terminal(path)
    if not ok:
        return {"ok": False, "message": msg, "bridge": "DISCONNECTED"}

    ok, login_msg = _login_if_needed(login, password, server)
    if not ok:
        return {"ok": False, "message": login_msg, "bridge": "DEGRADED"}

    info = mt5.account_info()
    if not info:
        return {"ok": False, "message": f"No account_info after attach: {mt5.last_error()}"}

    if int(info.login) != login:
        return {
            "ok": False,
            "message": f"Attached login {info.login} does not match requested {login}",
        }

    term = mt5.terminal_info()
    account = _account_payload(info)
    positions = _positions_payload(str(info.login), info.currency)

    # Persist live balances when accountId is known
    if account_id:
        try:
            upsert_account(
                {
                    "id": account_id,
                    "name": body.get("name") or account.get("name") or f"MT5 {login}",
                    "accountClass": body.get("accountClass") or "DEMO",
                    "currency": account["currency"],
                    "broker": body.get("broker") or account.get("company") or "Broker",
                    "firm": body.get("firm"),
                    "server": account["server"],
                    "login": account["login"],
                    "secretRef": body.get("secretRef"),
                    "terminalInstance": body.get("terminalInstance") or "CACSMS-MT5-0001",
                    "state": "HEALTHY",
                    "tradingMode": body.get("tradingMode") or "ANALYSIS_ONLY",
                    "tradingEnabled": bool(body.get("tradingEnabled")),
                    "leverage": account["leverage"],
                    "balance": account["balance"],
                    "equity": account["equity"],
                    "margin": account["margin"],
                    "freeMargin": account["freeMargin"],
                    "profit": account["profit"],
                    "latencyMs": int((term.ping_last or 0) / 1000) if term else 0,
                    "lastHeartbeat": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                    "connectedAt": body.get("connectedAt"),
                    "riskProfile": body.get("riskProfile") or "BALANCED",
                    "maxConcurrentTrades": body.get("maxConcurrentTrades") or 2,
                    "assignedSymbols": body.get("assignedSymbols") or [],
                    "propRules": body.get("propRules"),
                }
            )
            replace_positions(
                account_id,
                [{**p, "accountId": account_id} for p in positions],
            )
        except Exception as exc:
            return {
                "ok": True,
                "message": f"Synced MT5 but DB persist failed: {exc}",
                "bridge": "HEALTHY" if term and term.connected else "DEGRADED",
                "loginMsg": login_msg,
                "account": account,
                "positions": positions,
                "latencyMs": int((term.ping_last or 0) / 1000) if term else 0,
                "dbError": str(exc),
            }

    return {
        "ok": True,
        "message": f"Synced {info.login}@{info.server} - equity {info.equity} {info.currency}",
        "bridge": "HEALTHY" if term and term.connected else "DEGRADED",
        "loginMsg": login_msg,
        "account": account,
        "positions": positions,
        "latencyMs": int((term.ping_last or 0) / 1000) if term else 0,
    }


def cmd_test(body: dict[str, Any]) -> dict[str, Any]:
    login_raw = body.get("login")
    password = body.get("password")
    server = body.get("server")
    if not login_raw or not server:
        return {"ok": False, "message": "login and server are required"}
    try:
        login = int(str(login_raw).strip())
    except ValueError:
        return {"ok": False, "message": "login must be numeric"}

    ok, msg = _ensure_terminal(body.get("path"))
    if not ok:
        return {"ok": False, "message": msg}

    info = mt5.account_info()
    if info and int(info.login) == login and (not password or info.server == server):
        return {
            "ok": True,
        "message": (
            f"Terminal already attached to {login}@{info.server} - "
            f"equity {info.equity} {info.currency} - trade={'yes' if info.trade_allowed else 'no'}"
        ),
            "account": _account_payload(info),
        }

    if not password:
        current = f"{info.login}@{info.server}" if info else "none"
        return {
            "ok": False,
            "message": f"Password required to authenticate {login}@{server} (terminal on {current})",
        }

    if not mt5.login(login, password=password, server=server):
        return {"ok": False, "message": f"Auth failed: {mt5.last_error()}"}

    info = mt5.account_info()
    if not info:
        return {"ok": False, "message": "Login succeeded but account_info empty"}

    return {
        "ok": True,
        "message": (
            f"Auth ok - {info.login}@{info.server} - "
            f"equity {info.equity} {info.currency} - trade={'yes' if info.trade_allowed else 'no'}"
        ),
        "account": _account_payload(info),
    }


def cmd_put_secret(body: dict[str, Any]) -> dict[str, Any]:
    account_id = str(body.get("accountId") or "").strip()
    login = str(body.get("login") or "").strip()
    server = str(body.get("server") or "").strip()
    password = body.get("password")
    if not account_id or not login or not password:
        return {"ok": False, "message": "accountId, login and password are required"}
    secrets = _load_secrets()
    secrets[account_id] = {
        "login": login,
        "server": server,
        "password": password,
    }
    secrets[login] = secrets[account_id]
    _save_secrets(secrets)
    return {"ok": True, "message": "Secret stored on bridge", "secretRef": f"bridge:{account_id}"}


def cmd_delete_secret(account_id: str) -> dict[str, Any]:
    secrets = _load_secrets()
    entry = secrets.pop(account_id, None)
    if entry and entry.get("login"):
        secrets.pop(str(entry["login"]), None)
    _save_secrets(secrets)
    return {"ok": True, "message": "Secret removed"}


class Handler(BaseHTTPRequestHandler):
    server_version = "CacsmsMT5Bridge/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[mt5-bridge] {self.address_string()} {fmt % args}")

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        try:
            if parsed.path in ("/", "/health"):
                mt5_h = cmd_health()
                sql_h = db_health()
                self._json(
                    200,
                    {
                        **mt5_h,
                        "database": sql_h,
                    },
                )
                return
            if parsed.path == "/db/health":
                result = db_health()
                self._json(200 if result.get("ok") else 500, result)
                return
            if parsed.path == "/accounts":
                accounts = list_accounts()
                positions = list_positions()
                self._json(200, {"ok": True, "accounts": accounts, "positions": positions})
                return
            if parsed.path == "/app/state":
                self._json(200, load_app_state())
                return
            if parsed.path == "/sync":
                qs = parse_qs(parsed.query)
                body = {k: v[0] for k, v in qs.items()}
                result = cmd_sync(body)
                self._json(200 if result.get("ok") else 400, result)
                return
            self._json(404, {"ok": False, "message": f"Unknown path {parsed.path}"})
        except Exception as exc:  # pragma: no cover
            self._json(500, {"ok": False, "message": str(exc), "trace": traceback.format_exc()})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        try:
            body = self._read_json()
            if parsed.path == "/sync" or parsed.path == "/connect":
                result = cmd_sync(body)
                self._json(200 if result.get("ok") else 400, result)
                return
            if parsed.path == "/pulse":
                result = cmd_pulse(body)
                self._json(200 if result.get("ok") else 400, result)
                return
            if parsed.path == "/market/enrich":
                result = cmd_enrich(body)
                self._json(200 if result.get("ok") else 400, result)
                return
            if parsed.path == "/bars":
                result = cmd_bars(body)
                self._json(200 if result.get("ok") else 400, result)
                return
            if parsed.path == "/test":
                result = cmd_test(body)
                self._json(200 if result.get("ok") else 400, result)
                return
            if parsed.path == "/secrets":
                result = cmd_put_secret(body)
                self._json(200 if result.get("ok") else 400, result)
                return
            if parsed.path == "/accounts":
                result = upsert_account(body)
                self._json(200 if result.get("ok") else 400, result)
                return
            if parsed.path == "/app/state":
                result = save_app_state(body)
                self._json(200 if result.get("ok") else 400, result)
                return
            self._json(404, {"ok": False, "message": f"Unknown path {parsed.path}"})
        except Exception as exc:  # pragma: no cover
            self._json(500, {"ok": False, "message": str(exc), "trace": traceback.format_exc()})

    def do_PUT(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        try:
            body = self._read_json()
            if parsed.path == "/app/state":
                result = save_app_state(body)
                self._json(200 if result.get("ok") else 400, result)
                return
            if parsed.path == "/accounts" or parsed.path.startswith("/accounts/"):
                if parsed.path.startswith("/accounts/") and not body.get("id"):
                    body["id"] = parsed.path.split("/accounts/", 1)[1]
                result = upsert_account(body)
                self._json(200 if result.get("ok") else 400, result)
                return
            self._json(404, {"ok": False, "message": f"Unknown path {parsed.path}"})
        except Exception as exc:  # pragma: no cover
            self._json(500, {"ok": False, "message": str(exc), "trace": traceback.format_exc()})

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        try:
            if parsed.path.startswith("/secrets/"):
                account_id = parsed.path.split("/secrets/", 1)[1]
                self._json(200, cmd_delete_secret(account_id))
                return
            if parsed.path.startswith("/accounts/"):
                account_id = parsed.path.split("/accounts/", 1)[1]
                self._json(200, delete_account(account_id))
                return
            self._json(404, {"ok": False, "message": f"Unknown path {parsed.path}"})
        except Exception as exc:  # pragma: no cover
            self._json(500, {"ok": False, "message": str(exc), "trace": traceback.format_exc()})


def main() -> None:
    try:
        db = db_health()
        print(f"[mt5-bridge] database: {db}")
    except Exception as exc:
        print(f"[mt5-bridge] database warning: {exc}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[mt5-bridge] listening on http://{HOST}:{PORT}")
    print("[mt5-bridge] keep MetaTrader 5 running; Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[mt5-bridge] shutting down")
    finally:
        mt5.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()