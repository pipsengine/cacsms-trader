"""Operator "Pause Analysis" gate for the Stage 2-8 analysis engines.

The flag lives in the central execution control (app_settings `execution.control`, key `analysisPaused`) so it survives
restarts and is changed only through the audited /execution/control command. While paused, analysis loops hold their pending
triggers (they run on resume); Stage 1 data ingestion and Stage 9 position management keep running.
"""

from __future__ import annotations

import json
import threading
import time

try:
    from db import get_setting
except ImportError:  # pragma: no cover
    from bridge.mt5.db import get_setting  # type: ignore

CONTROL_KEY = "execution.control"
TTL_SEC = 2.0

_lock = threading.Lock()
_cache: tuple[float, bool] = (0.0, False)


def paused() -> bool:
    global _cache
    with _lock:
        at, value = _cache
        if time.time() - at < TTL_SEC:
            return value
    try:
        raw = get_setting(CONTROL_KEY)
        value = bool((json.loads(raw) if raw else {}).get("analysisPaused", False))
    except Exception:
        # an unreadable control row must not silently stop analysis; the execution gate stays fail-closed on its own
        value = False
    with _lock:
        _cache = (time.time(), value)
    return value


def invalidate() -> None:
    global _cache
    with _lock:
        _cache = (0.0, False)
