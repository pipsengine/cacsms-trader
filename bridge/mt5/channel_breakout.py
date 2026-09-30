"""Autonomous channel-breakout watchlist.

Reads channels the ChannelEngine has already published. It does not build a second
channel, does not place orders, and does not change confirmation or risk thresholds.
A wick beyond a boundary is BREAK_DETECTED. Only the engine's closed-candle break
(status BROKEN or RETESTING) is BREAK_CONFIRMED.
"""

from __future__ import annotations

import hashlib
import time
from typing import Any

try:
    import channel_analysis as ca
    import opportunity
    import vision
except ImportError:  # pragma: no cover
    from bridge.mt5 import channel_analysis as ca  # type: ignore
    from bridge.mt5 import opportunity  # type: ignore
    from bridge.mt5 import vision  # type: ignore

WATCH_STATES = ("NEAR_BREAKOUT", "BREAK_DETECTED", "BREAK_CONFIRMED", "RETEST_PENDING", "RETESTING", "RETEST_HELD")
MATURITY = {
    "RETEST_HELD": 0,
    "BREAK_CONFIRMED": 1,
    "RETESTING": 2,
    "RETEST_PENDING": 3,
    "BREAK_DETECTED": 4,
    "NEAR_BREAKOUT": 5,
}
ENGINE_STATE = {
    "NEAR_BREAKOUT": "CHANNEL_BREAK_APPROACH",
    "BREAK_DETECTED": "CHANNEL_BREAK_DETECTED",
    "BREAK_CONFIRMED": "CHANNEL_BREAK_CONFIRMED",
    "RETEST_PENDING": "CHANNEL_RETEST_PENDING",
    "RETESTING": "CHANNEL_RETEST_IN_PROGRESS",
    "RETEST_HELD": "CHANNEL_RETEST_HELD",
    "FAILED_BREAKOUT": "CHANNEL_BREAK_FAILED",
}
EVENT_TYPE = {
    "NEAR_BREAKOUT": "CHANNEL_BREAK_APPROACH",
    "BREAK_DETECTED": "CHANNEL_BREAK_DETECTED",
    "BREAK_CONFIRMED": "CHANNEL_BREAK_CONFIRMED",
    "RETESTING": "CHANNEL_RETEST_STARTED",
    "RETEST_HELD": "CHANNEL_RETEST_HELD",
    "FAILED_BREAKOUT": "CHANNEL_BREAK_FAILED",
}
FAMILY = {
    "CONTINUATION": "TIT_CONTINUATION",
    "CORRECTION": "TIT_CORRECTION",
    "TRANSITION": "TIT_CORRECTION_END",
}
CLOSED_STATUSES = frozenset(("BROKEN", "RETESTING"))
OPEN_STATUSES = frozenset(("VALIDATED", "ACTIVE", "WEAKENING"))


def _sign(direction: str | None) -> int:
    text = str(direction or "")
    if "BULL" in text:
        return 1
    if "BEAR" in text:
        return -1
    return 0


def relevant_boundary(parent_direction: str | None, role: str) -> tuple[str, str] | None:
    """The boundary that would end a correction or continue the parent. Not every touch qualifies."""
    if role not in ("CONTINUATION", "CORRECTION", "TRANSITION"):
        return None
    if _sign(parent_direction) > 0:
        return "UPPER", "BULLISH"
    if _sign(parent_direction) < 0:
        return "LOWER", "BEARISH"
    return None


def _bounds(snap: dict[str, Any]) -> tuple[float, float] | None:
    live = ca.live_bounds(snap)
    if live:
        return live
    try:
        return float(snap["lowerBoundary"]), float(snap["upperBoundary"])
    except (KeyError, TypeError, ValueError):
        return None


def _break_matches(boundary: str, breakout: dict[str, Any] | None) -> bool:
    if not breakout:
        return False
    side = str(breakout.get("side") or "")
    return (boundary == "UPPER" and side == "UP") or (boundary == "LOWER" and side == "DOWN")


def _structure(snap: dict[str, Any]) -> dict[str, Any]:
    events = ((snap.get("evidence") or {}).get("events") or [])
    bos = next((e for e in reversed(events) if str(e.get("kind") or e.get("type")) in ("BOS", "BOS_UP", "BOS_DOWN")), None)
    choch = next((e for e in reversed(events) if "CHOCH" in str(e.get("kind") or e.get("type")).upper()), None)
    return {
        "bos": None if not bos else {"time": bos.get("time") or bos.get("ts"), "label": bos.get("label") or bos.get("detail")},
        "choch": None if not choch else {"time": choch.get("time") or choch.get("ts"), "label": choch.get("label") or choch.get("detail")},
        "distinctFromChannelBreak": True,
    }


def _candidate_id(symbol: str, level: str, channel_id: str | None, boundary: str, direction: str) -> str:
    raw = "|".join([symbol, level, channel_id or "", boundary, direction])
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def classify_level(symbol: str, level: str, channels: dict[str, dict[str, Any]], price: float | None,
                   fresh: bool, hypothesis: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """One TiT level. Returns a watch candidate, a failed audit row, or None when nothing is relevant."""
    spec = opportunity.LEVELS[level]
    parent = opportunity._pick_parent(channels, spec["parents"])
    child = channels.get(spec["child"])
    if not parent or not child or child.get("status") in (None, "NO_CHANNEL", "FORMING"):
        return None
    role = opportunity.child_role(parent.get("direction"), child.get("direction"), child.get("status") or "")
    relationship = str(child.get("relationship") or "")
    if relationship in ("CORRECTIVE", "COUNTER_CORRECTION", "NESTED_CORRECTION") and str(child.get("status") or "") in CLOSED_STATUSES:
        role = "TRANSITION"
    boundary = relevant_boundary(parent.get("direction"), role)
    if boundary is None:
        return None
    side, expected = boundary
    bounds = _bounds(child)
    if not bounds:
        return None
    low, high = bounds
    atr = (child.get("evidence") or {}).get("atr") or child.get("atr")
    px = price if price is not None else child.get("currentPrice")
    stale = (not fresh) or str(child.get("dataStatus") or "") == "STALE"
    breakout = child.get("breakout") if isinstance(child.get("breakout"), dict) else None
    status = str(child.get("status") or "")
    phase = str(child.get("phase") or "")
    zone = ca.zone(child, float(px)) if px is not None and not stale else None
    matched = _break_matches(side, breakout)
    watch: str | None = None
    retest_state = None
    failure = None
    if status == "INVALIDATED" or (phase == "FAILED_BREAKOUT" and matched):
        watch, failure = "FAILED_BREAKOUT", phase or "CHANNEL_INVALIDATED"
        retest_state = "RETEST_FAILED" if breakout and breakout.get("retestTs") else None
    elif status == "RETESTING" and matched:
        watch, retest_state = "RETESTING", "RETEST_IN_PROGRESS"
    elif status == "BROKEN" and matched:
        if breakout and breakout.get("retestTs") and not breakout.get("retesting"):
            watch, retest_state = "RETEST_HELD", "RETEST_HELD"
        else:
            watch, retest_state = "BREAK_CONFIRMED", "RETEST_PENDING"
    elif status in OPEN_STATUSES and not stale:
        if (side == "UPPER" and zone == "BREACH_UP") or (side == "LOWER" and zone == "BREACH_DOWN"):
            watch = "BREAK_DETECTED"
        elif zone == side:
            watch = "NEAR_BREAKOUT"
    if watch is None:
        return None
    boundary_price = high if side == "UPPER" else low
    distance = None if px is None else (boundary_price - float(px) if side == "UPPER" else float(px) - boundary_price)
    distance_atr = None if distance is None or not atr else round(float(distance) / float(atr), 3)
    tol = float(vision.CONFIG["retestTolAtr"]) * float(atr or 0)
    p1 = (hypothesis or {}).get("p1") or {}
    p2 = (hypothesis or {}).get("p2") or {}
    now_ms = int(time.time() * 1000)
    detected_at = now_ms if watch == "BREAK_DETECTED" else (int(breakout["ts"]) * 1000 if breakout and breakout.get("ts") else None)
    confirmed_at = int(breakout["ts"]) * 1000 if watch in ("BREAK_CONFIRMED", "RETESTING", "RETEST_HELD") and breakout and breakout.get("ts") else None
    row = {
        "candidateId": _candidate_id(symbol, level, child.get("channelId"), side, expected),
        "symbol": symbol,
        "titLevel": level,
        "opportunityFamily": (hypothesis or {}).get("opportunityFamily") or FAMILY.get(role),
        "channelRole": role,
        "parent": {"timeframe": parent.get("timeframe"), "direction": parent.get("direction"), "channelId": parent.get("channelId")},
        "channel": {
            "id": child.get("channelId"), "timeframe": spec["child"], "role": role,
            "direction": child.get("direction"), "status": status, "confidence": child.get("confidence"),
            "position": child.get("position"), "upper": high, "mid": (high + low) / 2, "lower": low,
        },
        "breakout": {
            "relevantBoundary": side, "expectedDirection": expected, "boundaryPrice": boundary_price,
            "currentPrice": None if px is None else float(px), "distancePrice": None if distance is None else round(float(distance), 6),
            "distanceATR": distance_atr, "state": watch, "engineState": ENGINE_STATE[watch],
            "detectedAt": detected_at, "confirmedAt": confirmed_at,
            "breakPrice": None if not breakout else breakout.get("price"),
            "quality": None if not breakout else breakout.get("distanceAtr"),
            "penetrationAtr": None if not breakout else breakout.get("maxDistanceAtr"),
        },
        "retest": {
            "state": retest_state,
            "zoneLow": None if not tol else round(boundary_price - tol, 6),
            "zoneHigh": None if not tol else round(boundary_price + tol, 6),
            "startedAt": int(breakout["retestTs"]) * 1000 if breakout and breakout.get("retestTs") else None,
            "confirmedAt": int(breakout["lastRetestTs"]) * 1000 if watch == "RETEST_HELD" and breakout and breakout.get("lastRetestTs") else None,
            "failureReason": failure,
        },
        "structure": _structure(child),
        "p1": {"state": p1.get("state"), "reason": p1.get("reason")},
        "p2": {"state": p2.get("state"), "reason": p2.get("reason")},
        "freshness": {"state": "STALE" if stale else "CURRENT", "updatedAt": now_ms},
        "confirmationTimeframe": spec["execution"],
        "progressionBlocked": bool(stale),
        "authorizesTrade": False,
    }
    return row


def _sort_key(row: dict[str, Any]) -> tuple:
    state = row["breakout"]["state"]
    dist = row["breakout"]["distanceATR"]
    return (
        MATURITY.get(state, 9),
        0 if row["symbol"] == opportunity.XAU else 1,
        -float(row["channel"].get("confidence") or 0),
        99 if dist is None else abs(float(dist)),
        row["symbol"],
        row["titLevel"],
    )


class ChannelBreakoutScanner:
    """Background watchlist. The page only reads snapshot(); it does not scan."""

    def __init__(self) -> None:
        self.active: list[dict[str, Any]] = []
        self.history: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self._seen: set[tuple] = set()
        self._reconciled = False
        self._exec: dict[str, dict[str, dict[str, Any]]] = {}
        self._exec_ts: dict[tuple[str, str], Any] = {}
        self._channels: dict[str, dict[str, dict[str, Any]]] = {}
        self.meta: dict[str, Any] = {"status": "STARTING", "lastScan": None, "scanned": 0, "message": "Breakout scanner starting"}

    def ensure_execution(self, series: dict[tuple[str, str], dict[str, Any]] | None) -> None:
        """M15/M5 channels, rebuilt only when that timeframe's latest closed bar changes."""
        if not series:
            return
        try:
            import history_store as hs
        except ImportError:  # pragma: no cover
            from bridge.mt5 import history_store as hs  # type: ignore
        look = {tf: int(vision.tf_cfg(tf)["lookback"]) for tf in ("M15", "M5")}
        for symbol in opportunity.SYMBOLS:
            for tf in ("M15", "M5"):
                row = series.get((symbol, tf))
                latest = None if not row else row.get("latest_ts")
                key = (symbol, tf)
                if latest is None or self._exec_ts.get(key) == latest:
                    continue
                bars = hs.candle_tail(symbol, tf, look[tf])
                status = "STALE" if str((row or {}).get("status") or "") == "STALE" else "READY"
                snap = ca.analyse_timeframe(symbol, tf, bars, (status, f"{tf} closed candles"), int(latest or time.time()))
                self._exec.setdefault(symbol, {})[tf] = snap
                self._exec_ts[key] = latest

    def observe(self, channels: dict[str, dict[str, dict[str, Any]]], live: dict[str, dict[str, Any]] | None = None,
                hypotheses: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        live = live or {}
        self._channels = channels
        by_key = {(h.get("instrument"), h.get("TiTLevel")): h for h in (hypotheses or []) if h.get("status") != "NOT_DETECTED"}
        found: list[dict[str, Any]] = []
        failed: list[dict[str, Any]] = []
        symbols = list(opportunity.SYMBOLS)
        for symbol in symbols:
            pack = dict(channels.get(symbol) or {})
            pack.update(self._exec.get(symbol) or {})
            tick = live.get(symbol) or {}
            price = tick.get("price")
            fresh = bool(tick.get("fresh"))
            for level in opportunity.LEVELS:
                row = classify_level(symbol, level, pack, price, fresh, by_key.get((symbol, level)))
                if not row:
                    continue
                if row["breakout"]["state"] == "FAILED_BREAKOUT" or row["freshness"]["state"] == "STALE":
                    failed.append(row)
                else:
                    found.append(row)
        found.sort(key=_sort_key)
        self._record(found, failed)
        self.active = found
        counts = {name: sum(1 for row in found if row["breakout"]["state"] == name) for name in WATCH_STATES}
        self.meta.update({
            "status": "HEALTHY",
            "lastScan": time.time(),
            "scanned": len(symbols),
            "universe": len(opportunity.SYMBOLS),
            "active": len(found),
            "counts": counts,
            "message": f"{len(symbols)}/{len(opportunity.SYMBOLS)} scanned · {len(found)} breakout watches",
        })
        return self.snapshot()

    def _record(self, found: list[dict[str, Any]], failed: list[dict[str, Any]]) -> None:
        current = {(row["candidateId"], row["breakout"]["state"]) for row in found}
        if not self._reconciled:
            # Restart sees the current market. It does not re-publish those states as new events or orders.
            self._seen = set(current)
            self._reconciled = True
            for row in failed:
                self._push_history(row)
            return
        for row in found:
            key = (row["candidateId"], row["breakout"]["state"])
            if key in self._seen:
                continue
            self._seen.add(key)
            event = {
                "symbol": row["symbol"],
                "tf": row["channel"]["timeframe"], "type": EVENT_TYPE[row["breakout"]["state"]],
                "ts": int((row["breakout"]["detectedAt"] or row["breakout"]["confirmedAt"] or time.time() * 1000) / 1000),
                "price": row["breakout"]["currentPrice"], "channelId": row["channel"]["id"],
                "detail": f"{row['symbol']} {row['titLevel']} {row['breakout']['state']} {row['breakout']['relevantBoundary']}",
                "candidateId": row["candidateId"],
            }
            self.events.append(event)
        self.events = self.events[-80:]
        failed_ids = {row["candidateId"] for row in failed}
        gone = {row["candidateId"] for row in self.active} - {row["candidateId"] for row in found}
        for row in self.active:
            if row["candidateId"] in gone and row["candidateId"] not in failed_ids:
                self._push_history({**row, "removedReason": "NO_LONGER_QUALIFIES"})
        for row in failed:
            self._push_history(row)
        self.history = self.history[:40]

    def _push_history(self, row: dict[str, Any]) -> None:
        """One audit row per candidate, state, and removal reason. A watch that flickers back into range does not repeat."""
        cid = row.get("candidateId")
        state = (row.get("breakout") or {}).get("state")
        reason = row.get("removedReason") or ""
        for prev in self.history:
            if prev.get("candidateId") == cid and (prev.get("breakout") or {}).get("state") == state and (prev.get("removedReason") or "") == reason:
                return
        self.history.insert(0, {**row, "removedAt": row.get("removedAt") or time.time()})

    def snapshot(self) -> dict[str, Any]:
        counts = {name: sum(1 for row in self.active if row["breakout"]["state"] == name) for name in WATCH_STATES}
        return {
            "health": self.meta.get("status"),
            "lastScan": self.meta.get("lastScan"),
            "instrumentsScanned": self.meta.get("scanned") or 0,
            "universe": len(opportunity.SYMBOLS),
            "activeCount": len(self.active),
            "counts": counts,
            "candidates": self.active,
            "history": self.history[:20],
            "message": self.meta.get("message"),
            "authorizesTrade": False,
        }

    def candidate(self, candidate_id: str) -> dict[str, Any] | None:
        for row in self.active + self.history:
            if row.get("candidateId") == candidate_id:
                return row
        return None

    def chart(self, candidate_id: str) -> dict[str, Any] | None:
        row = self.candidate(candidate_id)
        if not row:
            return None
        symbol = row["symbol"]
        tf = row["channel"]["timeframe"]
        snap = ((self._channels.get(symbol) or {}).get(tf)
                or (self._exec.get(symbol) or {}).get(tf))
        if snap is None:
            return {"candidate": row, "chart": None}
        try:
            import history_store as hs
        except ImportError:  # pragma: no cover
            from bridge.mt5 import history_store as hs  # type: ignore
        # The analysis window, not a short tail: the stored anchor has to be in the series or the boundaries cannot be drawn.
        need = int(vision.tf_cfg(tf)["lookback"]) + int(ca.CONFIG["extraBars"])
        src = ca.SOURCE_TF.get(tf, tf)
        if src == "MN1":
            import channel_service
            bars = ca.aggregate(hs.candle_tail(symbol, "MN1", channel_service.CONFIG["mn1History"]), tf)[-need:]
        else:
            bars = ca.aggregate(hs.candle_tail(symbol, src, need), tf)
        payload = ca.chart_payload(snap, bars, limit=120)
        payload["retest"] = row["retest"]
        payload["boundary"] = row["breakout"]["relevantBoundary"]
        payload["breakPrice"] = row["breakout"]["breakPrice"]
        return {"candidate": row, "chart": payload}


SCANNER = ChannelBreakoutScanner()
