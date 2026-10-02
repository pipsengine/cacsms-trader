from __future__ import annotations

import queue
import threading
import time
import traceback
from typing import Any, Callable

try:
    from ai_chart_analysis.analysis_orchestrator import should_refresh_analysis
except ImportError:  # pragma: no cover
    from bridge.mt5.ai_chart_analysis.analysis_orchestrator import should_refresh_analysis  # type: ignore

_REFRESH_TFS = frozenset({"M5", "M15", "H1", "H8", "D1"})
_lock = threading.Lock()
_latest: dict[str, dict[str, Any]] = {}
_last_closed: dict[str, dict[str, int]] = {}
_last_run_ms: dict[str, int] = {}
_queue: queue.Queue[tuple[list[str], str]] = queue.Queue(maxsize=512)
_worker_started = False
_analyse_fn: Callable[..., dict[str, Any]] | None = None
_heartbeat_fn: Callable[[str], dict[str, Any]] | None = None


def configure(
    *,
    analyse: Callable[..., dict[str, Any]],
    heartbeat: Callable[[str], dict[str, Any]],
) -> None:
    global _analyse_fn, _heartbeat_fn
    _analyse_fn = analyse
    _heartbeat_fn = heartbeat
    _ensure_worker()


def _ensure_worker() -> None:
    global _worker_started
    if _worker_started:
        return
    _worker_started = True
    threading.Thread(target=_worker_loop, name="aca-autonomous", daemon=True).start()


def _worker_loop() -> None:
    while True:
        try:
            symbols, trigger = _queue.get(timeout=2.0)
        except queue.Empty:
            continue
        for symbol in symbols:
            try:
                _refresh_symbol(symbol.upper(), trigger)
            except Exception:
                traceback.print_exc()
        _queue.task_done()


def schedule(symbols: list[str], trigger: str) -> None:
    if not symbols:
        return
    _ensure_worker()
    syms = [s.upper() for s in symbols if s]
    try:
        _queue.put_nowait((syms, trigger))
    except queue.Full:
        pass


def on_candle_change(timeframe: str, symbols: list[str], kind: str = "INCREMENTAL") -> None:
    tf = (timeframe or "").upper()
    if tf not in _REFRESH_TFS:
        return
    schedule(symbols, f"CANDLE_{kind}_{tf}")


def on_channel_change(symbols: list[str], info: dict[str, Any] | None = None) -> None:
    schedule(symbols, f"CHANNEL_{(info or {}).get('runId', 'change')}")


def on_confirmation_change(symbols: list[str]) -> None:
    schedule(symbols, "CONFIRMATION_CHANGE")


def get_cached(symbol: str) -> dict[str, Any] | None:
    with _lock:
        row = _latest.get(symbol.upper())
        return dict(row) if row else None


def _refresh_symbol(symbol: str, trigger: str) -> None:
    if not _analyse_fn or not _heartbeat_fn:
        return
    hb = _heartbeat_fn(symbol)
    if not hb.get("ok"):
        return
    current = hb.get("lastClosedCandle") or {}
    now_ms = int(time.time() * 1000)
    with _lock:
        prev_lc = _last_closed.get(symbol)
        prev_ms = _last_run_ms.get(symbol)
    ok, reason = should_refresh_analysis(
        previous_last_closed=prev_lc,
        current_last_closed=current,
        previous_analysis_ms=prev_ms,
        now_ms=now_ms,
        min_interval_ms=3_000,
    )
    if not ok and get_cached(symbol):
        return
    result = _analyse_fn(
        symbol,
        mode="FULL_ANALYSIS",
        primary_tf="H1",
        lookback=500,
        persist=False,
        force=True,
    )
    if not result.get("ok"):
        return
    with _lock:
        prev_payload = _latest.get(symbol)
    persist = True
    if prev_payload:
        prev_key = (
            prev_payload.get("status"),
            prev_payload.get("direction"),
            prev_payload.get("p1State"),
            prev_payload.get("p2State"),
            str(prev_payload.get("lastClosedCandle")),
        )
        new_key = (
            result.get("status"),
            result.get("direction"),
            result.get("p1State"),
            result.get("p2State"),
            str(result.get("lastClosedCandle")),
        )
        persist = prev_key != new_key
    if persist:
        stored = _analyse_fn(symbol, mode="FULL_ANALYSIS", primary_tf="H1", lookback=500, persist=True, force=True)
        if stored.get("ok"):
            result = stored
    result["autonomousTrigger"] = trigger
    result["autonomousReason"] = reason
    result["dataMode"] = "AUTONOMOUS"
    with _lock:
        _latest[symbol] = result
        _last_closed[symbol] = dict(current)
        _last_run_ms[symbol] = now_ms


def bootstrap_universe(symbols: list[str]) -> None:
    schedule(symbols, "STARTUP_BOOTSTRAP")
