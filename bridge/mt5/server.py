#!/usr/bin/env python3
"""Localhost MT5 bridge for Cacsms Trader — account sync, test, secrets."""

from __future__ import annotations

import functools
import json
import os
import threading
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
    import analysis_gate
    import autonomy_service
    import autonomy_store
    import confirm
    import confirm_service
    import confirm_store
    import direction_service
    import direction_store
    import execution_mt5
    import execution_service
    import execution_store
    import history
    import history_store
    import learning_service
    import regime
    import risk_mt5
    import risk_service
    import risk_store
    import scanner
    import scanner_service
    import scanner_store
    import vision
    import vision_service
    import vision_store
    from db import (
        delete_account,
        ensure_database,
        ensure_regime_schema,
        ensure_schema,
        health as db_health,
        list_accounts,
        list_positions,
        load_app_state,
        load_regime_state,
        regime_history,
        regime_load_states,
        regime_persist,
        replace_positions,
        save_app_state,
        save_regime_meta,
        upsert_account,
    )
except ImportError:
    from bridge.mt5 import analysis_gate  # type: ignore
    from bridge.mt5 import autonomy_service, autonomy_store  # type: ignore
    from bridge.mt5 import confirm, confirm_service, confirm_store  # type: ignore
    from bridge.mt5 import direction_service, direction_store  # type: ignore
    from bridge.mt5 import execution_mt5, execution_service, execution_store  # type: ignore
    from bridge.mt5 import history, history_store  # type: ignore
    from bridge.mt5 import learning_service  # type: ignore
    from bridge.mt5 import regime  # type: ignore
    from bridge.mt5 import risk_mt5, risk_service, risk_store  # type: ignore
    from bridge.mt5 import scanner, scanner_service, scanner_store  # type: ignore
    from bridge.mt5 import vision, vision_service, vision_store  # type: ignore
    from bridge.mt5.db import (  # type: ignore
        delete_account,
        ensure_database,
        ensure_regime_schema,
        ensure_schema,
        health as db_health,
        list_accounts,
        list_positions,
        load_app_state,
        load_regime_state,
        regime_history,
        regime_load_states,
        regime_persist,
        replace_positions,
        save_app_state,
        save_regime_meta,
        upsert_account,
    )

HOST = os.environ.get("MT5_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("MT5_BRIDGE_PORT", "8765"))
ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SECRETS_PATH = DATA / "secrets.json"
MT5_PATH = os.environ.get("MT5_TERMINAL_PATH", "").strip() or None
MT5_AUTO_LAUNCH = os.environ.get("MT5_AUTO_LAUNCH", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)

DATA.mkdir(parents=True, exist_ok=True)

# The MetaTrader5 package is not thread-safe and can block the whole interpreter when
# called concurrently, so every MT5 command runs under this lock. SQL-only routes do not.
_MT5_LOCK = threading.RLock()
_mt5_ready_path: str | None = None
_mt5_ready = False


def _mt5_serialized(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with _MT5_LOCK:
            return fn(*args, **kwargs)

    return wrapper


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


def _terminal_path(path: str | None = None) -> str | None:
    """Resolve an explicit path or discover a local Windows MT5 installation."""
    configured = (path or MT5_PATH or "").strip()
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.is_dir():
            for exe in ("terminal64.exe", "terminal.exe"):
                nested = candidate / exe
                if nested.is_file():
                    return str(nested)
        return str(candidate)

    if os.name != "nt":
        return None

    roots = [
        os.environ.get("ProgramFiles"),
        os.environ.get("ProgramFiles(x86)"),
        os.environ.get("LOCALAPPDATA"),
    ]
    patterns = (
        "MetaTrader 5*/terminal64.exe",
        "*/terminal64.exe",
        "Programs/MetaTrader 5*/terminal64.exe",
    )
    seen: set[Path] = set()
    for root in filter(None, roots):
        base = Path(root)
        for pattern in patterns:
            for candidate in sorted(base.glob(pattern)):
                if candidate in seen:
                    continue
                seen.add(candidate)
                if candidate.is_file():
                    return str(candidate)
    return None


def _ensure_terminal(path: str | None = None) -> tuple[bool, str]:
    global _mt5_ready, _mt5_ready_path
    terminal = _terminal_path(path)
    same_terminal = not terminal or terminal == _mt5_ready_path
    if _mt5_ready and same_terminal and mt5.terminal_info() is not None:
        return True, "ok"
    kwargs: dict[str, Any] = {}
    if terminal:
        kwargs["path"] = terminal
    if not mt5.initialize(**kwargs):
        _mt5_ready = False
        err = mt5.last_error()
        return False, f"MT5 initialize failed: {err}"
    _mt5_ready = True
    _mt5_ready_path = terminal
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


@_mt5_serialized
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


@_mt5_serialized
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

    # H1 confirmation is owned by Stage 7 (closed-candle structure engine); a quote snapshot never labels H1 confirmed.
    h1_dir = "NEUTRAL"
    if h1 is not None and len(h1) >= 2:
        h1_dir = _dir_from_closes(float(h1[-2]["close"]), float(h1[-1]["close"]))

    score = 0.0
    if d1_dir == h8_dir and d1_dir != "NEUTRAL":
        score += 40
    score += min(25, abs(change) * 8)
    score = round(min(99, score), 1)

    # Stale quotes fail closed; trade readiness is decided downstream (Stage 7 → Stage 8), never here.
    state = "WAIT"
    if tick.time and (time.time() - int(tick.time)) > 3600:
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
            "h1Dir": h1_dir,
            "score": score,
            "state": state,
            "confidence": round(min(99, score + 5), 1),
            "channelPos": 50,
            "bars": bars,
            "tradeMode": int(info.trade_mode) if info else None,
            "digits": int(info.digits) if info else None,
        }
    )
    return out


@_mt5_serialized
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


@_mt5_serialized
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
        # Canonical H8 on server-day 00/08/16 boundaries, same derivation as the historical store.
        raw = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_H1, 0, count * 8 + 8)
        if raw is None:
            return {"ok": False, "message": f"No H1 rates for H8: {mt5.last_error()}", "bars": []}
        h1 = [(int(r["time"]), float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]),
               int(r["tick_volume"]), int(r["spread"])) for r in raw]
        derived = history.derive_h8(h1, 2**40)
        bars = [
            {"time": _mt5_time(r[0]), "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5]}
            for r in derived
        ]
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


@_mt5_serialized
def _regime_terminal_ready() -> tuple[bool, str]:
    ok, msg = _ensure_terminal()
    if not ok:
        return False, msg
    term = mt5.terminal_info()
    if not term or not term.connected:
        return False, "MT5 terminal not connected to broker"
    return True, "ok"


@_mt5_serialized
def _regime_fetch_symbol(sym: str, count: int) -> dict[str, Any] | None:
    mt5.symbol_select(sym, True)
    rates = mt5.copy_rates_from_pos(sym, mt5.TIMEFRAME_D1, 0, count)
    if rates is None or len(rates) == 0:
        return None
    tick = mt5.symbol_info_tick(sym)
    return {
        "times": [int(r["time"]) for r in rates],
        "closes": [float(r["close"]) for r in rates],
        "tickTime": int(tick.time) if tick else 0,
        "nowTs": int(time.time()),
    }


def _regime_fetch(count: int) -> tuple[bool, str, dict[str, dict[str, Any]]]:
    # Lock per symbol so a first-time history download never stalls the 1Hz pulse for the whole run.
    ok, msg = _regime_terminal_ready()
    if not ok:
        return False, msg, {}
    out: dict[str, dict[str, Any]] = {}
    for sym in regime.SYMBOLS:
        payload = _regime_fetch_symbol(sym, count)
        if payload:
            out[sym] = payload
    return True, "ok", out


_REGIME_RUN_LOCK = threading.Lock()


def _regime_config() -> dict[str, Any]:
    return {k: v for k, v in regime.CONFIG.items()}


def cmd_regime_run(_body: dict[str, Any]) -> dict[str, Any]:
    """Stage 3: fetch D1 closes, continue regime hysteresis incrementally, persist, return DB state."""
    if analysis_gate.paused():
        state = load_regime_state()
        state.update({"ok": True, "paused": True, "message": "Analysis PAUSED by the operator — Stage 2/3 not recomputed"})
        return state
    with _REGIME_RUN_LOCK:
        started = time.time()
        ensure_regime_schema()
        ok, msg, data = _regime_fetch(int(regime.CONFIG["barsToFetch"]))
        run_at = datetime.now(timezone.utc).isoformat()
        if not ok or not data:
            meta = {
                "status": "BLOCKED",
                "message": msg if not ok else "MT5 returned no D1 history",
                "runAt": run_at,
                "durationMs": int((time.time() - started) * 1000),
                "config": _regime_config(),
                "assets": {},
            }
            save_regime_meta(meta)
            state = load_regime_state()
            state.update({"ok": False, "message": meta["message"]})
            return state

        result = regime.run(data, regime_load_states())
        statuses = {m["status"] for m in result["assets"].values()}
        status = "HEALTHY" if statuses == {"CLASSIFIED"} else "WARMING_UP"
        message = (
            f"{sum(1 for m in result['assets'].values() if m['status'] == 'CLASSIFIED')}/{len(regime.ASSETS)} assets classified"
            f" from {result['bars']} D1 bars"
        )
        if result["missing"]:
            message += f"; missing symbols: {', '.join(result['missing'])}"
        meta = {
            "status": status,
            "message": message,
            "runAt": run_at,
            "durationMs": 0,
            "latestObsDate": result["latestDate"],
            "forming": result["forming"],
            "missing": result["missing"],
            "config": _regime_config(),
            "assets": result["assets"],
        }
        written = regime_persist(result, meta)
        meta["durationMs"] = int((time.time() - started) * 1000)
        meta["written"] = written
        save_regime_meta(meta)
        state = load_regime_state()
        state.update({"ok": True, "message": message})
        return state


_REGIME_TRIGGER_TFS = {"D1", "W1", "MN1"}
_regime_trigger_pending = threading.Event()


def _regime_trigger_loop() -> None:
    while True:
        _regime_trigger_pending.wait()
        time.sleep(10)  # coalesce the burst of closes across all 29 symbols
        while analysis_gate.paused():
            time.sleep(5)  # the pending close stays set and is processed on resume
        _regime_trigger_pending.clear()
        try:
            state = cmd_regime_run({})
            history_store.event_add("DOWNSTREAM", "INFO", f"Stage 3 regime re-run after candle close: {state.get('message')}")
        except Exception as exc:
            history_store.event_add("DOWNSTREAM", "ERROR", f"Stage 3 regime re-run failed: {exc}")
        SCANNER.mark("REGIME_RUN")


@_mt5_serialized
def _vision_ticks(symbols: list[str]) -> dict[str, dict[str, Any]]:
    """Live bid/ask for Stage 5 boundary monitoring; never initializes the terminal itself."""
    if not _mt5_ready:
        return {}
    offset = HISTORY.server_offset
    out: dict[str, dict[str, Any]] = {}
    for sym in symbols:
        t = mt5.symbol_info_tick(sym)
        if t is not None and t.bid:
            utc = int(t.time) - offset if offset is not None else None
            out[sym] = {"bid": float(t.bid), "ask": float(t.ask), "time": utc}
    return out


ORCHESTRATOR: autonomy_service.AutonomousOrchestrator | None = None


def _risk_change(result: dict[str, Any]) -> None:
    if ORCHESTRATOR:
        ORCHESTRATOR.publish("RISK_CHANGE", "STAGE8", stage=8, payload={"changed": result.get("changed")})
    elif "EXECUTION" in globals():
        EXECUTION.mark("STAGE8_RISK_CHANGE")


RISK = risk_service.RiskService(
    risk_mt5.RiskMT5(mt5, _MT5_LOCK, lambda: _mt5_ready, lambda: HISTORY.server_offset),
    lambda: HISTORY.server_offset,
    on_change=_risk_change,
)
LEARNING = learning_service.LearningService()


def _execution_change(what: str) -> None:
    if ORCHESTRATOR:
        ORCHESTRATOR.publish("EXECUTION_CHANGE", "STAGE9", stage=9, payload={"what": what})
    else:
        RISK.mark("STAGE9_" + what)
        if what == "CLOSED":
            LEARNING.mark("TRADE_CLOSED")


EXECUTION = execution_service.ExecutionService(
    execution_mt5.ExecutionMT5(mt5, _MT5_LOCK, lambda: _mt5_ready, lambda: HISTORY.server_offset, fx_factory=RISK.provider.fx_resolver),
    node=os.environ.get("MT5_NODE_ID", "CACSMS-MT5-0001"),
    on_change=_execution_change,
)


def _confirm_change(symbols: list[str]) -> None:
    if ORCHESTRATOR:
        ORCHESTRATOR.publish("CONFIRMATION_CHANGE", "STAGE7", stage=7, symbols=symbols)
    else:
        RISK.on_stage7_change(symbols)


CONFIRM = confirm_service.ConfirmService(_vision_ticks, on_confirm_change=_confirm_change)


def _direction_change(symbols: list[str]) -> None:
    if ORCHESTRATOR:
        ORCHESTRATOR.publish("DIRECTION_CHANGE", "STAGE6", stage=6, symbols=symbols)
    else:
        CONFIRM.on_stage6_change(symbols)


DIRECTION = direction_service.DirectionService(on_ready_change=_direction_change)


def _vision_change(symbols: list[str]) -> None:
    if ORCHESTRATOR:
        ORCHESTRATOR.publish("VISION_CHANGE", "STAGE5", stage=5, symbols=symbols)
    else:
        DIRECTION.on_stage5_run(symbols)


VISION = vision_service.VisionService(_vision_ticks, on_run=_vision_change)


def _scanner_context() -> dict[str, Any]:
    return {"providerOk": bool(HISTORY.provider_ok), "marketOpen": history.fx_market_open(datetime.now(timezone.utc))}


def _on_promotion_change(symbols: list[str], reason: str) -> None:
    if ORCHESTRATOR:
        ORCHESTRATOR.publish("SCANNER_CHANGE", "STAGE4", stage=4, symbols=symbols, trigger={"reason": reason})
    else:
        VISION.mark(symbols, reason)
        DIRECTION.mark("STAGE4_PROMOTION_CHANGE")


SCANNER = scanner_service.ScannerService(_vision_ticks, _scanner_context, _on_promotion_change)


def _on_candles(timeframe: str, symbols: list[str], kind: str = "INCREMENTAL") -> None:
    if ORCHESTRATOR:
        bar_time = None
        if len(symbols) == 1:
            try:
                bar_time = history_store.candle_stats(symbols[0], timeframe)[2]
            except Exception:
                bar_time = None
        ORCHESTRATOR.publish("CANDLE_CHANGE", "STAGE1", stage=1, symbols=symbols,
                             payload={"timeframe": timeframe, "kind": kind, "barTime": bar_time})
    else:
        if timeframe in _REGIME_TRIGGER_TFS and kind == "INCREMENTAL":
            _regime_trigger_pending.set()
        SCANNER.on_candles(timeframe, symbols, kind)
        VISION.on_candles(timeframe, symbols, kind)
        DIRECTION.on_candles(timeframe, symbols, kind)
        CONFIRM.on_candles(timeframe, symbols, kind)
        RISK.on_candles(timeframe, symbols, kind)


HISTORY = history.HistoryService(history.MT5Provider(mt5, _MT5_LOCK, _ensure_terminal), on_candles=_on_candles)

ORCHESTRATOR = autonomy_service.AutonomousOrchestrator(
    list(regime.SYMBOLS), cmd_regime_run, SCANNER, VISION, DIRECTION, CONFIRM, RISK, EXECUTION, LEARNING,
    connected_fn=lambda: bool(_mt5_ready),
)


def cmd_vision_chart(symbol: str, timeframe: str, bars: int) -> dict[str, Any]:
    """Chart payload: stored closed candles from the Stage 1 store + the persisted Stage 5 channel projected onto them."""
    cfg = vision.TF_CFG[timeframe]
    bars = max(60, min(int(bars), 1500))
    rows = history_store.candle_tail(symbol, timeframe, max(bars, cfg["lookback"]) + vision_service.CONFIG["extraBars"])
    if not rows:
        return {"ok": True, "symbol": symbol, "timeframe": timeframe, "candles": [], "swings": [], "lines": [], "channel": None}
    view = rows[-bars:]
    first = view[0][0]
    ch = vision_store.channel_analysis(symbol, timeframe)
    a = (ch or {}).get("analysis")
    lines = vision.channel_lines((a or {}).get("def"), [r[0] for r in rows], 12, timeframe)
    return {
        "ok": True, "symbol": symbol, "timeframe": timeframe,
        "candles": [{"ts": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4]} for r in view],
        "swings": [s for s in vision.swing_points(timeframe, rows) if s["ts"] >= first],
        "lines": [x for x in lines if x["ts"] >= first],
        "channel": ch,
    }


def _scanner_state() -> dict[str, Any]:
    state = scanner_store.load_state()
    state["service"] = {k: SCANNER.meta.get(k) for k in ("status", "message", "runAt", "runs", "errors", "lastError")}
    return state


def _direction_state() -> dict[str, Any]:
    state = direction_store.load_state()
    state["service"] = {k: DIRECTION.meta.get(k) for k in ("status", "message", "runAt", "runs", "errors", "lastError")}
    return state


def _h1_state() -> dict[str, Any]:
    state = confirm_store.load_state()
    state["service"] = {k: CONFIRM.meta.get(k) for k in ("status", "message", "runAt", "runs", "errors", "lastError")}
    return state


def _risk_state() -> dict[str, Any]:
    state = risk_store.load_state()
    state["service"] = {k: RISK.meta.get(k) for k in ("status", "message", "runAt", "runs", "errors", "lastError")}
    return state


def cmd_h1_chart(symbol: str, bars: int) -> dict[str, Any]:
    """H1 chart payload: stored closed H1 candles, labelled swings + BOS/CHoCH from the Stage 7 analysis, the persisted Stage 7
    decision (pullback zone, trigger, invalidation) and the persisted Stage 5 D1/H8 channels projected onto the H1 window."""
    bars = max(60, min(int(bars), 400))
    rows = history_store.candle_tail(symbol, "H1", confirm.CONFIG["lookback"])
    decision = confirm_store.load_decision(symbol)
    if not rows:
        return {"ok": True, "symbol": symbol, "candles": [], "swings": [], "events": [], "channels": [], "decision": decision}
    view = rows[-bars:]
    first = view[0][0]
    st = confirm.analyse_h1(rows)
    channels = []
    for tf in ("D1", "H8"):
        ch = vision_store.channel_analysis(symbol, tf)
        defn = ((ch or {}).get("analysis") or {}).get("def")
        if not defn:
            continue
        tf_rows = history_store.candle_tail(symbol, tf, vision.TF_CFG[tf]["lookback"] + vision_service.CONFIG["extraBars"])
        lines = vision.channel_lines(defn, [r[0] for r in tf_rows], 2, tf)
        span = vision.TF_SEC[tf]
        pts = [x for x in lines if x["ts"] >= first - span]
        if pts:
            channels.append({"timeframe": tf, "lines": pts, "status": ((ch or {}).get("analysis") or {}).get("status"),
                             "direction": ((ch or {}).get("analysis") or {}).get("direction")})
    tick = _vision_ticks([symbol]).get(symbol)
    return {
        "ok": True, "symbol": symbol,
        "candles": [{"ts": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4]} for r in view],
        "swings": [{k: s[k] for k in ("ts", "kind", "price", "label", "confirmTs")} for s in st["swings"] if s["ts"] >= first],
        "events": [{k: e[k] for k in ("type", "side", "ts", "level", "swingTs", "price")} for e in st["events"] if e["ts"] >= first],
        "channels": channels,
        "live": None if not tick else {"price": (tick["bid"] + tick["ask"]) / 2, "bid": tick["bid"], "ask": tick["ask"], "time": tick["time"]},
        "decision": decision,
    }


def _q(qs: dict[str, list[str]], key: str) -> str | None:
    v = (qs.get(key) or [""])[0].strip()
    return v or None


def _history_target(body: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    symbol = (str(body.get("symbol") or "").strip().upper()) or None
    timeframe = (str(body.get("timeframe") or "").strip().upper()) or None
    if symbol and symbol not in history.SYMBOLS:
        return None, None, f"Unknown instrument {symbol}"
    if timeframe and timeframe not in history.TF_SPEC:
        return None, None, f"Unknown timeframe {timeframe}"
    return symbol, timeframe, None


def cmd_history_series(symbol: str, timeframe: str) -> dict[str, Any]:
    row = history_store.series_all().get((symbol, timeframe))
    return {
        "ok": True,
        "series": history_store.series_dict(row) if row else None,
        "jobs": history_store.jobs_recent(40, symbol, timeframe),
        "candles": history_store.candle_page(symbol, timeframe, 300),
    }


@_mt5_serialized
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

    # Persist live balances when accountId is known. Operator-owned settings (class, mode, trading flag, risk profile,
    # prop rules, symbol assignment) are kept from the stored row when the caller omits them — a reconnect never resets them.
    if account_id:
        try:
            prior = next((a for a in list_accounts() if a["id"] == account_id), None) or {}
            keep = lambda key, default=None: body.get(key) if body.get(key) is not None else prior.get(key, default)  # noqa: E731
            upsert_account(
                {
                    "id": account_id,
                    "name": body.get("name") or prior.get("name") or account.get("name") or f"MT5 {login}",
                    "accountClass": keep("accountClass", "DEMO"),
                    "currency": account["currency"],
                    "broker": body.get("broker") or account.get("company") or "Broker",
                    "firm": keep("firm"),
                    "server": account["server"],
                    "login": account["login"],
                    "secretRef": keep("secretRef"),
                    "terminalInstance": keep("terminalInstance", "CACSMS-MT5-0001"),
                    "state": "HEALTHY",
                    "tradingMode": keep("tradingMode", "ANALYSIS_ONLY"),
                    "tradingEnabled": bool(keep("tradingEnabled", False)),
                    "leverage": account["leverage"],
                    "balance": account["balance"],
                    "equity": account["equity"],
                    "margin": account["margin"],
                    "freeMargin": account["freeMargin"],
                    "profit": account["profit"],
                    "latencyMs": int((term.ping_last or 0) / 1000) if term else 0,
                    "lastHeartbeat": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                    "connectedAt": keep("connectedAt"),
                    "riskProfile": keep("riskProfile", "BALANCED"),
                    "maxConcurrentTrades": keep("maxConcurrentTrades", 2),
                    "assignedSymbols": keep("assignedSymbols", []),
                    "propRules": keep("propRules"),
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


@_mt5_serialized
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
            if parsed.path == "/autonomy/state":
                self._json(200, ORCHESTRATOR.state() if ORCHESTRATOR else autonomy_store.state())
                return
            if parsed.path == "/accounts":
                accounts = list_accounts()
                positions = list_positions()
                self._json(200, {"ok": True, "accounts": accounts, "positions": positions})
                return
            if parsed.path == "/app/state":
                self._json(200, load_app_state())
                return
            if parsed.path == "/regime/state":
                self._json(200, load_regime_state())
                return
            if parsed.path == "/regime/history":
                qs = parse_qs(parsed.query)
                asset = (qs.get("asset") or [""])[0].upper()
                if asset not in regime.ASSETS:
                    self._json(400, {"ok": False, "message": f"Unknown asset {asset}"})
                    return
                limit = int((qs.get("limit") or ["260"])[0])
                self._json(200, {"ok": True, "asset": asset, "history": regime_history(asset, limit)})
                return
            if parsed.path == "/scanner/state":
                self._json(200, _scanner_state())
                return
            if parsed.path == "/scanner/detail":
                symbol = (_q(parse_qs(parsed.query), "symbol") or "").upper()
                if symbol not in regime.SYMBOLS:
                    self._json(400, {"ok": False, "message": f"Unknown symbol {symbol}"})
                    return
                self._json(200, scanner_store.load_detail(symbol))
                return
            if parsed.path == "/direction/state":
                self._json(200, _direction_state())
                return
            if parsed.path == "/direction/handoff":
                self._json(200, {"ok": True, "candidates": direction_store.handoffs()})
                return
            if parsed.path == "/direction/detail":
                symbol = (_q(parse_qs(parsed.query), "symbol") or "").upper()
                if symbol not in regime.SYMBOLS:
                    self._json(400, {"ok": False, "message": f"Unknown symbol {symbol}"})
                    return
                self._json(200, direction_store.load_detail(symbol))
                return
            if parsed.path == "/h1/state":
                self._json(200, _h1_state())
                return
            if parsed.path == "/h1/handoff":
                self._json(200, {"ok": True, "candidates": confirm_store.handoffs()})
                return
            if parsed.path.startswith("/execution/"):
                qs = parse_qs(parsed.query)
                if parsed.path == "/execution/state":
                    self._json(200, EXECUTION.state())
                    return
                if parsed.path == "/execution/detail":
                    eid = _q(qs, "executionId") or ""
                    if not eid:
                        self._json(400, {"ok": False, "message": "executionId required"})
                        return
                    self._json(200, EXECUTION.detail(eid))
                    return
                if parsed.path == "/execution/trades":
                    days = _q(qs, "days")
                    self._json(200, {"ok": True, "trades": execution_store.trades(int(_q(qs, "limit") or 200), _q(qs, "accountId"), _q(qs, "symbol"),
                                                                                   _q(qs, "q"), int(days) if days else None)})
                    return
            if parsed.path.startswith("/risk/"):
                qs = parse_qs(parsed.query)
                if parsed.path == "/risk/state":
                    self._json(200, _risk_state())
                    return
                if parsed.path == "/risk/detail":
                    key = _q(qs, "setupKey")
                    if not key:
                        self._json(400, {"ok": False, "message": "setupKey required"})
                        return
                    self._json(200, risk_store.load_detail(key))
                    return
                if parsed.path == "/risk/authorizations":
                    status = (_q(qs, "status") or "").upper() or None
                    self._json(200, {"ok": True, "authorizations": risk_store.authorizations(status, int(_q(qs, "limit") or 60))})
                    return
                if parsed.path == "/risk/config":
                    cfg, overrides = risk_store.load_config()
                    self._json(200, {"ok": True, "config": cfg, "overrides": overrides, "audit": risk_store.config_audit(50)})
                    return
            if parsed.path in ("/h1/detail", "/h1/chart"):
                qs = parse_qs(parsed.query)
                symbol = (_q(qs, "symbol") or "").upper()
                if symbol not in regime.SYMBOLS:
                    self._json(400, {"ok": False, "message": f"Unknown symbol {symbol}"})
                    return
                if parsed.path == "/h1/detail":
                    self._json(200, confirm_store.load_detail(symbol))
                else:
                    self._json(200, cmd_h1_chart(symbol, int(_q(qs, "bars") or 180)))
                return
            if parsed.path.startswith("/vision/"):
                qs = parse_qs(parsed.query)
                if parsed.path == "/vision/state":
                    state = vision_store.load_state()
                    state["service"] = {k: VISION.meta.get(k) for k in ("status", "message", "runAt", "runs", "errors", "lastError")}
                    self._json(200, state)
                    return
                symbol = (_q(qs, "symbol") or "").upper()
                if symbol not in regime.SYMBOLS:
                    self._json(400, {"ok": False, "message": f"Unknown symbol {symbol}"})
                    return
                if parsed.path == "/vision/detail":
                    self._json(200, vision_store.load_detail(symbol))
                    return
                if parsed.path == "/vision/chart":
                    tf = (_q(qs, "timeframe") or "D1").upper()
                    if tf not in vision.TF_CFG:
                        self._json(400, {"ok": False, "message": f"Unsupported timeframe {tf}"})
                        return
                    self._json(200, cmd_vision_chart(symbol, tf, int(_q(qs, "bars") or 240)))
                    return
            if parsed.path == "/sync":
                qs = parse_qs(parsed.query)
                body = {k: v[0] for k, v in qs.items()}
                result = cmd_sync(body)
                self._json(200 if result.get("ok") else 400, result)
                return
            if parsed.path.startswith("/history/"):
                qs = parse_qs(parsed.query)
                if parsed.path == "/history/status":
                    self._json(200, HISTORY.status())
                    return
                if parsed.path in ("/history/series", "/history/candles"):
                    symbol, timeframe, err = _history_target({"symbol": _q(qs, "symbol"), "timeframe": _q(qs, "timeframe")})
                    if err or not symbol or not timeframe:
                        self._json(400, {"ok": False, "message": err or "symbol and timeframe required"})
                        return
                    if parsed.path == "/history/series":
                        self._json(200, cmd_history_series(symbol, timeframe))
                    else:
                        before = _q(qs, "before")
                        limit = max(1, min(int(_q(qs, "limit") or 300), 5000))
                        self._json(200, {"ok": True, "candles": history_store.candle_page(
                            symbol, timeframe, limit, int(before) if before else None)})
                    return
                if parsed.path == "/history/events":
                    after = int(_q(qs, "after") or 0)
                    self._json(200, {"ok": True, "events": history_store.events_after(after, int(_q(qs, "limit") or 200))})
                    return
                if parsed.path == "/history/jobs":
                    self._json(200, {"ok": True, "jobs": history_store.jobs_recent(
                        int(_q(qs, "limit") or 100), _q(qs, "symbol"), _q(qs, "timeframe"))})
                    return
            self._json(404, {"ok": False, "message": f"Unknown path {parsed.path}"})
        except Exception as exc:  # pragma: no cover
            self._json(500, {"ok": False, "message": str(exc), "trace": traceback.format_exc()})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        try:
            body = self._read_json()
            if parsed.path == "/autonomy/run":
                if not ORCHESTRATOR:
                    self._json(503, {"ok": False, "message": "Autonomous orchestrator not started"})
                    return
                symbol = str(body.get("symbol") or "").strip().upper() or None
                stage = body.get("stage")
                reason = str(body.get("reason") or "Manual diagnostic reprocess")
                event_id = ORCHESTRATOR.publish(
                    "DIAGNOSTIC_REPROCESS", "OPERATOR",
                    stage=int(stage) if stage else None,
                    symbols=[symbol] if symbol else None,
                    trigger={"reason": reason, "stage": stage, "symbol": symbol},
                    payload={"reason": reason, "stage": int(stage) if stage else None, "symbol": symbol},
                )
                self._json(202, {"ok": True, "eventId": event_id, "message": "Diagnostic reprocess queued. Dependencies, freshness, risk and execution authorization still apply."})
                return
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
            if parsed.path in ("/scanner/run", "/vision/run", "/direction/run", "/h1/run", "/risk/run") and analysis_gate.paused():
                self._json(409, {"ok": False, "paused": True, "message": "Analysis PAUSED by the operator — resume analysis before re-running a stage"})
                return
            if parsed.path == "/regime/run":
                result = cmd_regime_run(body)
                if not result.get("paused"):
                    SCANNER.mark("REGIME_RUN")
                self._json(200, result)
                return
            if parsed.path == "/scanner/run":
                result = SCANNER.run(["MANUAL"])
                self._json(200, {"ok": True, **result, "state": _scanner_state()})
                return
            if parsed.path == "/scanner/config":
                overrides = {k: v for k, v in (body.get("overrides") or {}).items() if v is not None and v != ""}
                try:
                    scanner.merge_config(overrides)
                except (ValueError, TypeError) as exc:
                    self._json(400, {"ok": False, "message": str(exc)})
                    return
                scanner_store.save_config(overrides)
                result = SCANNER.run(["CONFIG_CHANGE"])
                self._json(200, {"ok": True, **result, "state": _scanner_state()})
                return
            if parsed.path == "/direction/run":
                result = DIRECTION.run(["MANUAL"])
                self._json(200, {"ok": True, **result, "state": _direction_state()})
                return
            if parsed.path == "/h1/run":
                result = CONFIRM.run(["MANUAL"])
                self._json(200, {"ok": True, **result, "state": _h1_state()})
                return
            if parsed.path == "/risk/run":
                result = RISK.run(["MANUAL"])
                self._json(200, {"ok": True, **result, "state": _risk_state()})
                return
            if parsed.path == "/risk/config":
                result = risk_store.save_config(body.get("changes") or {}, str(body.get("actor") or "operator"), body.get("reason"))
                if not result.get("ok"):
                    self._json(400, {"ok": False, "message": "; ".join(result.get("errors") or []), "errors": result.get("errors")})
                    return
                run = RISK.run(["RISK_CONFIG_CHANGE " + ",".join(result.get("changed") or [])[:120]]) if result.get("changed") else {}
                self._json(200, {**result, "run": run, "state": _risk_state()})
                return
            if parsed.path == "/risk/approve":
                result = risk_store.approve(str(body.get("setupKey") or ""), str(body.get("accountId") or ""), str(body.get("actor") or "operator"))
                if result.get("ok"):
                    RISK.run(["OPERATOR_APPROVAL"])
                self._json(200 if result.get("ok") else 400, {**result, "state": _risk_state()})
                return
            if parsed.path.startswith("/execution/"):
                actor = str(body.get("actor") or "operator")
                if parsed.path == "/execution/control":
                    patch = {k: body[k] for k in ("tradingEnabled", "executionEnabled", "emergencyStop", "analysisPaused") if k in body}
                    if not patch:
                        self._json(400, {"ok": False, "message": "tradingEnabled, executionEnabled, emergencyStop or analysisPaused required"})
                        return
                    self._json(200, {**EXECUTION.set_control(patch, actor, body.get("reason")), "state": EXECUTION.state()})
                    return
                if parsed.path == "/execution/close":
                    result = EXECUTION.request_exit(str(body.get("executionId") or ""), actor, body.get("reason"))
                    self._json(200 if result.get("ok") else 400, result)
                    return
                if parsed.path == "/execution/resolve":
                    try:
                        rid = int(body.get("id"))
                    except (TypeError, ValueError):
                        self._json(400, {"ok": False, "message": "finding id required"})
                        return
                    result = EXECUTION.resolve_finding(rid, str(body.get("resolution") or ""), actor, body.get("note"))
                    self._json(200 if result.get("ok") else 400, result)
                    return
                if parsed.path == "/execution/config":
                    result = execution_store.save_config(body.get("changes") or {}, actor, body.get("reason"))
                    if not result.get("ok"):
                        self._json(400, {"ok": False, "message": "; ".join(result.get("errors") or []), "errors": result.get("errors")})
                        return
                    if result.get("changed"):
                        EXECUTION.mark("CONFIG_CHANGE")
                    self._json(200, result)
                    return
                if parsed.path == "/execution/reconcile":
                    self._json(200, EXECUTION.request_reconcile(actor))
                    return
            if parsed.path == "/vision/run":
                symbol = str(body.get("symbol") or "").upper()
                targets = [symbol] if symbol in regime.SYMBOLS else list(regime.SYMBOLS)
                result = VISION.run({s: "MANUAL" for s in targets})
                self._json(200, {"ok": True, **result, "state": vision_store.load_state()})
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
            if parsed.path in ("/history/sync", "/history/repair", "/history/validate"):
                symbol, timeframe, err = _history_target(body)
                if err:
                    self._json(400, {"ok": False, "message": err})
                    return
                if parsed.path == "/history/validate":
                    self._json(200, HISTORY.validate_all(symbol, timeframe))
                else:
                    self._json(200, HISTORY.enqueue_manual("sync" if parsed.path == "/history/sync" else "repair", symbol, timeframe))
                return
            if parsed.path == "/history/config":
                if "executionTimeframes" in body:
                    HISTORY.set_exec_enabled(bool(body["executionTimeframes"]))
                self._json(200, {"ok": True, "executionEnabled": HISTORY.exec_enabled()})
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
        ensure_database()
        ensure_schema()
        db = db_health()
        print(f"[mt5-bridge] database: {db}")
        ensure_regime_schema()
        print("[mt5-bridge] regime schema ready")
        history_store.ensure_history_schema()
        scanner_store.ensure_scanner_schema()
        vision_store.ensure_vision_schema()
        direction_store.ensure_direction_schema()
        confirm_store.ensure_confirm_schema()
        risk_store.ensure_risk_schema()
        execution_store.ensure_schema()
        autonomy_store.ensure_schema()
        print("[mt5-bridge] S1-S10 runtime + autonomy control-plane schema ready")
        history_ready = True
    except Exception as exc:
        history_ready = False
        print(f"[mt5-bridge] database warning: {exc}")
    ThreadingHTTPServer.request_queue_size = 64
    ThreadingHTTPServer.daemon_threads = True
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[mt5-bridge] listening on http://{HOST}:{PORT}")
    if MT5_AUTO_LAUNCH:
        ok, message = _ensure_terminal()
        if ok:
            info = mt5.terminal_info()
            print(f"[mt5-bridge] MT5 terminal ready: {info.path if info else _mt5_ready_path or 'auto-detected'}")
            account = mt5.account_info()
            if account:
                account_class = "DEMO" if account.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO else "LIVE"
                synced = cmd_sync(
                    {
                        "login": str(account.login),
                        "accountId": str(account.login),
                        "accountClass": account_class,
                        "tradingMode": "ANALYSIS_ONLY",
                        "tradingEnabled": False,
                    }
                )
                print(f"[mt5-bridge] startup account sync: {synced.get('message', 'unknown result')}")
        else:
            print(f"[mt5-bridge] MT5 startup warning: {message}")
    # Bound before touching MT5: a terminal busy downloading history can block initialize() for minutes.
    if history_ready:
        HISTORY.start()
        print("[mt5-bridge] autonomous historical synchronizer started")
        SCANNER.start()
        print("[mt5-bridge] Stage 4 Market Scanner engine started")
        VISION.start()
        print("[mt5-bridge] Stage 5 HTF Market Vision engine started")
        DIRECTION.start()
        print("[mt5-bridge] Stage 6 Structural Direction engine started")
        CONFIRM.start()
        print("[mt5-bridge] Stage 7 H1 Confirmation engine started")
        RISK.start()
        print("[mt5-bridge] Stage 8 Opportunities & Risk engine started")
        EXECUTION.start()
        print("[mt5-bridge] Stage 9 Execution & Positions engine started")
        LEARNING.start()
        print("[mt5-bridge] Stage 10 Performance & Learning engine started")
        ORCHESTRATOR.start()
        print("[mt5-bridge] persistent Autonomous Orchestrator + Event Bus + World Model started")
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
