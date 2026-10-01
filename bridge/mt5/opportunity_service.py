"""Background multi-resolution scan. The browser is not required. Stage 8 still authorizes execution."""

from __future__ import annotations

import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Any

try:
    import channel_analysis as ca
    import channel_store
    import direction_store
    import history_store as hs
    import opportunity
    import opportunity_store as store
    import regime
    import scanner_store
except ImportError:  # pragma: no cover
    from bridge.mt5 import channel_analysis as ca  # type: ignore
    from bridge.mt5 import channel_store  # type: ignore
    from bridge.mt5 import direction_store  # type: ignore
    from bridge.mt5 import history_store as hs  # type: ignore
    from bridge.mt5 import opportunity  # type: ignore
    from bridge.mt5 import opportunity_store as store  # type: ignore
    from bridge.mt5 import regime  # type: ignore
    from bridge.mt5 import scanner_store  # type: ignore

SYMBOLS: list[str] = list(regime.SYMBOLS)
DEEP_TFS = ("M15", "M5")
CURRENT: OpportunityService | None = None


def _overlay_atr(channels: dict[str, dict[str, dict[str, Any]]]) -> None:
    """ATR lives in the channel snapshot. Distance is left blank when it cannot be read."""
    try:
        from db import connect
    except ImportError:
        from bridge.mt5.db import connect  # type: ignore
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol, timeframe, json_extract(snapshot_json, '$.evidence.atr') FROM dbo.app_channel_state")
        for symbol, tf, atr in cur.fetchall():
            pack = channels.get(symbol)
            if pack and tf in pack and atr is not None:
                pack[tf]["atr"] = float(atr)


def _close_from(pack: dict[str, dict[str, Any]]) -> float | None:
    """Last structural price already on a channel. A missing price is left unknown."""
    for tf in ("M5", "M15", "H1", "H8", "D1", "W"):
        channel = pack.get(tf) or {}
        if channel.get("currentPrice") is not None:
            return float(channel["currentPrice"])
        position, low, high = channel.get("position"), channel.get("lower"), channel.get("upper")
        if position is None or low is None or high is None:
            continue
        return float(low) + float(position) / 100.0 * (float(high) - float(low))
    return None


def _confirmation_from_decision(decision: dict[str, Any] | None) -> dict[str, Any] | None:
    if not decision:
        return None
    entry = decision.get("entry") or {}
    timing = entry.get("timing")
    return {"direction": decision.get("expectedDirection") or decision.get("direction"), "state": decision.get("state"),
            "timing": timing, "extension": entry.get("extensionATR"),
            "reaction": bool(decision.get("reaction")) or timing in ("ENTER_NOW", "RETEST_CONFIRMED")}


def _execution_confirmations(channels: dict[str, dict[str, dict[str, Any]]]) -> dict[str, dict[str, dict[str, Any]]]:
    """H1 uses the existing Stage 7 decision. M15/M5 use a break already present on a channel analysed this sweep."""
    out: dict[str, dict[str, dict[str, Any]]] = {}
    try:
        import confirm_store
        rows = confirm_store.load_state().get("instruments") or []
    except Exception:
        rows = []
    for row in rows:
        found = _confirmation_from_decision(row)
        if found and row.get("symbol"):
            out.setdefault(row["symbol"], {})["H1"] = found
    return out


def _confirmation_from_engine(direction: str | None, decision: dict[str, Any]) -> dict[str, Any] | None:
    state = str(decision.get("state") or "")
    if state not in ("CONFIRMED", "BREAKOUT_CONFIRMED_WAIT_RETEST"):
        return None
    entry = decision.get("entry") or {}
    timing = entry.get("timing")
    return {"direction": direction, "state": state, "timing": timing, "extension": entry.get("extensionATR"),
            "reaction": bool(decision.get("reaction")) or timing in ("ENTER_NOW", "RETEST_CONFIRMED")}


BREAK_STATES = frozenset(("BREAK_CONFIRMED", "RETESTING", "RETEST_HELD"))


def _channel_breaks() -> dict[str, dict[str, dict[str, Any]]]:
    """Closed-candle child-channel breaks from the Breakout & Retest watchlist, per symbol and TiT level.

    Extension is how far price already sits beyond the broken boundary; a stale tick is not a break.
    """
    try:
        import channel_breakout
    except ImportError:  # pragma: no cover
        from bridge.mt5 import channel_breakout  # type: ignore
    out: dict[str, dict[str, dict[str, Any]]] = {}
    for row in list(channel_breakout.SCANNER.active):
        brk = row.get("breakout") or {}
        if brk.get("state") not in BREAK_STATES or (row.get("freshness") or {}).get("state") != "CURRENT":
            continue
        dist = brk.get("distanceATR")
        out.setdefault(str(row["symbol"]), {})[str(row["titLevel"])] = {
            "state": brk.get("state"),
            "boundary": brk.get("relevantBoundary"),
            "expectedDirection": brk.get("expectedDirection"),
            "extensionAtr": None if dist is None else max(0.0, -float(dist)),
            "candidateId": row.get("candidateId"),
        }
    return out


def _break_confirmations(breaks: dict[str, dict[str, dict[str, Any]]], confirmations: dict[str, dict[str, dict[str, Any]]]) -> None:
    """Confirm each broken level on its execution timeframe in the break direction, from closed bars only."""
    try:
        import confirm_engine
    except ImportError:  # pragma: no cover
        from bridge.mt5 import confirm_engine  # type: ignore
    for symbol, levels in breaks.items():
        for level, brk in levels.items():
            tf = opportunity.LEVELS[level]["execution"]
            direction = str(brk.get("expectedDirection") or "")
            existing = (confirmations.get(symbol) or {}).get(tf)
            if existing and opportunity._sign(existing.get("direction")) == opportunity._sign(direction):
                continue
            try:
                bars = hs.candle_tail(symbol, tf, 400)
                if len(bars or []) < 80:
                    continue
                decision = confirm_engine.ConfirmationEngine(tf).evaluate(symbol, bars, direction, now_ts=time.time())
            except Exception:
                continue
            found = _confirmation_from_engine(direction, decision)
            if found:
                confirmations.setdefault(symbol, {})[tf] = found


def _pair_bias() -> dict[str, Any]:
    try:
        from db import connect
    except ImportError:  # pragma: no cover
        from bridge.mt5.db import connect  # type: ignore
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol, bias FROM dbo.app_regime_pair")
        return {symbol: bias for symbol, bias in cur.fetchall()}


def _breakout_rows() -> list[dict[str, Any]]:
    """Active Breakout & Retest watches plus failed breakouts from the last day (OP-09 evidence)."""
    try:
        import channel_breakout
    except ImportError:  # pragma: no cover
        from bridge.mt5 import channel_breakout  # type: ignore
    rows = list(channel_breakout.SCANNER.active)
    horizon = time.time() - 86400
    seen = {row.get("candidateId") for row in rows}
    for row in list(channel_breakout.SCANNER.history):
        if (row.get("breakout") or {}).get("state") != "FAILED_BREAKOUT" or float(row.get("removedAt") or 0) < horizon:
            continue
        if row.get("candidateId") in seen:
            continue
        seen.add(row.get("candidateId"))
        rows.append(row)
    return rows


def _bars_since(symbol: str, tf: str, since_ts: int) -> list[tuple]:
    return hs.candle_ohlc(symbol, tf, from_ts=int(since_ts))


def current() -> dict[str, Any]:
    return CURRENT.snapshot() if CURRENT else {"ok": True, "summary": {}, "instruments": [], "qualified": []}


def framework_state() -> dict[str, Any] | None:
    return CURRENT.framework if CURRENT else None

CONFIG = {"loopSec": 15, "fullEverySec": 300}


class OpportunityService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pending: set[str] = set()
        self._last_full = 0.0
        self._last_ts: dict[str, int] = {}
        self.snapshot_data: dict[str, Any] = {"summary": {}, "instruments": [], "qualified": []}
        self.meta: dict[str, Any] = {"status": "STARTING", "message": "Opportunity scan starting"}
        self.framework: dict[str, Any] | None = None
        self._source: Any = None
        self._thread: threading.Thread | None = None
        global CURRENT
        CURRENT = self

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, name="opportunity", daemon=True)
        self._thread.start()

    def mark(self, reason: str) -> None:
        with self._lock:
            self._pending.add(reason)

    def on_candles(self, timeframe: str, symbols: list[str], kind: str = "INCREMENTAL") -> None:
        if timeframe in ("D1", "H8", "H1", "M15", "M5", "W1", "MN1"):
            self.mark(f"CANDLE {timeframe}")

    def snapshot(self) -> dict[str, Any]:
        out = {"ok": True, "run": self.meta, **self.snapshot_data}
        try:
            import opportunity_framework as fw
        except ImportError:  # pragma: no cover
            from bridge.mt5 import opportunity_framework as fw  # type: ignore
        out["framework"] = fw.compact(self.framework)
        return out

    def _framework(self, result: dict[str, Any], channels: dict[str, dict[str, dict[str, Any]]], directions: dict[str, Any],
                   ranks: dict[str, Any], missed: bool) -> None:
        """Classifies every opportunity through the central contract. Shadow routes never touch `qualified`."""
        try:
            import economic_store
            import opportunity_framework as fw
            import opportunity_framework_store as fstore
            import opportunity_types as ot
        except ImportError:  # pragma: no cover
            from bridge.mt5 import economic_store  # type: ignore
            from bridge.mt5 import opportunity_framework as fw  # type: ignore
            from bridge.mt5 import opportunity_framework_store as fstore  # type: ignore
            from bridge.mt5 import opportunity_types as ot  # type: ignore
        if not fw.CONFIG["enabled"]:
            return
        for row in result["instruments"]:
            for h in row.get("hypotheses") or []:
                op = ot.legacy_type(h.get("opportunityFamily"))
                if op:
                    h["opportunityType"], h["opportunityTypeName"] = op, ot.TYPES[op]["name"]
        try:
            econ = economic_store.gate_map()
        except Exception:
            econ = None  # every new entry fails closed
        try:
            bias = _pair_bias()
        except Exception:
            bias = {}
        try:
            import confirm_store
            stage7 = {r["symbol"]: r for r in (confirm_store.load_state().get("instruments") or []) if r.get("symbol")}
        except Exception:
            stage7 = {}
        try:
            breakouts = _breakout_rows()
        except Exception:
            breakouts = []
        if self._source is None:
            self._source = fw.LiveSource()
        try:
            state = fw.build(SYMBOLS, channels, result, self._source, directions=directions, ranks=ranks, breakouts=breakouts, econ=econ,
                             bias=bias, stage7=stage7, stage8=dict(fw.STAGE8_STATE), missed=missed)
        except Exception as exc:
            traceback.print_exc()
            self.framework = {**(self.framework or {}), "errors": [{"detector": "build", "error": f"{type(exc).__name__}: {exc}", "ts": time.time()}]}
            return
        by_campaign = {h["campaignId"]: h["opportunityId"] for h in state["hypotheses"] if h["route"].endswith(":TIT") or h["route"] == "OP-01:LEGACY_H1"}
        for row in result["instruments"]:
            for h in row.get("hypotheses") or []:
                if h.get("campaignId") in by_campaign:
                    h["opportunityId"] = by_campaign[h["campaignId"]]
        transitions: list[dict[str, Any]] = []
        try:
            transitions = fstore.persist(state, SYMBOLS, bars_since=_bars_since)
        except Exception as exc:
            traceback.print_exc()
            state["persistError"] = f"{type(exc).__name__}: {exc}"
        self.framework = state
        try:
            import notification_service as notes
            notes.SERVICE.observe_framework(transitions)
        except Exception:
            traceback.print_exc()

    def _loop(self) -> None:
        time.sleep(8)
        self.mark("STARTUP")
        while True:
            time.sleep(CONFIG["loopSec"])
            with self._lock:
                reasons, self._pending = self._pending, set()
            if time.time() - self._last_full >= CONFIG["fullEverySec"]:
                reasons.add("PERIODIC")
                self._last_full = time.time()
            if reasons:
                try:
                    self.run(sorted(reasons))
                except Exception as exc:
                    self.meta["status"] = "DEGRADED"
                    self.meta["lastError"] = f"{type(exc).__name__}: {exc}"
                    traceback.print_exc()

    def _execution_channels(self, symbol: str, deep: bool) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        if not deep:
            return {}, {}
        try:
            import confirm_engine
        except ImportError:
            from bridge.mt5 import confirm_engine  # type: ignore
        out: dict[str, dict[str, Any]] = {}
        confirmed: dict[str, dict[str, Any]] = {}
        for tf in DEEP_TFS:
            try:
                bars = hs.candle_tail(symbol, tf, 400)
            except Exception:
                continue
            if len(bars or []) < 80:
                continue
            try:
                snap = ca.analyse_timeframe(symbol, tf, bars, ("READY", f"{tf} closed candles"), int(time.time()))
            except Exception:
                continue
            out[tf] = snap
            try:
                decision = confirm_engine.ConfirmationEngine(tf).evaluate(symbol, bars, str(snap.get("direction") or "NEUTRAL"), now_ts=time.time())
                found = _confirmation_from_engine(snap.get("direction"), decision)
                if found:
                    confirmed[tf] = found
            except Exception:
                continue
        return out, confirmed

    def run(self, triggers: list[str]) -> dict[str, Any]:
        started = time.time()
        try:
            worlds = channel_store.world_rows()
        except Exception:
            worlds = []
        channels = {row["symbol"]: row.get("timeframes") or {} for row in worlds}
        try:
            _overlay_atr(channels)
        except Exception:
            pass
        try:
            directions = {row["symbol"]: row for row in (direction_store.load_state().get("instruments") or [])}
        except Exception:
            directions = {}
        try:
            scanner = scanner_store.load_state().get("instruments") or []
            ranks = {row["symbol"]: row.get("rank") for row in scanner}
        except Exception:
            ranks = {}
        try:
            level_breaks = _channel_breaks()
        except Exception:
            level_breaks = {}
        # Deep M15/M5 structure for XAUUSD always, for any instrument whose H1/H8 child is already a correction,
        # and for any instrument with a confirmed channel break.
        live_confirmed: dict[str, dict[str, dict[str, Any]]] = {}
        for symbol in SYMBOLS:
            existing = channels.get(symbol) or {}
            h1 = existing.get("H1") or {}
            d1 = existing.get("D1") or {}
            deep = symbol == opportunity.XAU or symbol in level_breaks or (
                h1.get("direction") and d1.get("direction") and h1.get("direction") != d1.get("direction")
            )
            extra, deep_confirmed = self._execution_channels(symbol, deep)
            if extra:
                channels[symbol] = {**existing, **extra}
            if deep_confirmed:
                live_confirmed.setdefault(symbol, {}).update(deep_confirmed)
        prices = {symbol: px for symbol, px in ((s, _close_from(channels.get(s) or {})) for s in SYMBOLS) if px is not None}
        confirmations = _execution_confirmations(channels)
        for symbol, pack in live_confirmed.items():
            confirmations.setdefault(symbol, {}).update(pack)
        _break_confirmations(level_breaks, confirmations)
        missed = False
        for symbol, pack in channels.items():
            latest = max((int(c.get("lastBarTs") or 0) for c in pack.values()), default=0)
            prev = self._last_ts.get(symbol)
            if prev and latest and latest - prev > 3600:
                missed = True
            if latest:
                self._last_ts[symbol] = latest
        result = opportunity.scan(SYMBOLS, channels, directions, ranks, prices=prices, confirmations=confirmations, missed=missed, data_ok=True,
                                  level_breaks=level_breaks)
        for row in result["instruments"]:
            pack = channels.get(row["symbol"]) or {}
            row["execution"] = {
                tf: {k: (pack[tf] or {}).get(k) for k in ("timeframe", "direction", "status", "phase", "position", "confidence", "touchCount", "upper", "lower", "mid", "channelId")}
                for tf in ("M15", "M5") if pack.get(tf)
            }
        result["triggers"] = triggers
        result["audits"] = [reason for row in result["instruments"] for h in row["hypotheses"] for reason in (h.get("reasons") or [])][:40]
        self._framework(result, channels, directions, ranks, missed)
        self.snapshot_data = result
        try:
            import notification_service as notes
            notes.SERVICE.observe_hypotheses(result)
        except Exception:
            traceback.print_exc()
        self.meta.update({
            "status": "DEGRADED" if missed else "HEALTHY",
            "message": (
                f"{result['summary']['scanned']}/{result['summary']['universe']} scanned · "
                f"normal {result['summary']['normal']} · TiT {result['summary']['tit']} · XAU {result['summary']['xau']}"
                + (" · RECONNECT RECONCILIATION" if missed else "")
            ),
            "runAt": datetime.now(timezone.utc).isoformat(),
            "durationMs": int((time.time() - started) * 1000),
            "triggers": triggers[:12],
        })
        try:
            store.save({"summary": result["summary"], "qualified": result["qualified"], "audits": result["audits"], "run": self.meta})
        except Exception as exc:
            self.meta["lastError"] = f"persist: {exc}"
        return result
