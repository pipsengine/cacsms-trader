"""Timeframe-generic confirmation. Stage 7 H1 behaviour stays in confirm.evaluate.

This engine reuses the closed-bar swing, BOS, CHoCH, pullback, retest and extension
logic. It does not read candles after the prefix it is given.
"""

from __future__ import annotations

from typing import Any

try:
    import confirm
except ImportError:  # pragma: no cover
    from bridge.mt5 import confirm  # type: ignore

TF_SECONDS = {"Y": 31536000, "Q": 7776000, "MN": 2592000, "W": 604800, "D1": 86400, "H8": 28800, "H1": 3600, "M15": 900, "M5": 300}


class ConfirmationEngine:
    def __init__(self, timeframe: str):
        self.timeframe = str(timeframe or "H1").upper()
        if self.timeframe not in TF_SECONDS:
            raise ValueError(f"unsupported confirmation timeframe {timeframe}")

    def evaluate(self, symbol: str, bars: list[tuple] | None, direction: str, *,
                 parent: dict[str, Any] | None = None, child: dict[str, Any] | None = None,
                 now_ts: float | None = None, missed_bars: int = 0, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
        """Confirm `direction` from closed bars of this timeframe only."""
        parent = parent or {}
        child = child or {}
        trade = direction if "BULL" in str(direction) or "BEAR" in str(direction) else "NEUTRAL"
        position = parent.get("position")
        context = {
            "symbol": symbol,
            "state": "READY_FOR_H1",
            "direction": trade,
            "expectedDirection": trade,
            "reasonCode": "CAMPAIGN_STRUCTURE",
            "reason": f"{parent.get('timeframe') or 'parent'} structure confirmed on {self.timeframe}",
            "structuralPhase": "PULLBACK",
            "alignment": "ALIGNED",
            "confidence": float(parent.get("confidence") or 70),
            "zone": {"name": parent.get("zone") or "VALUE"},
            "position": {"d1": position if position is not None else 40, "h8": child.get("position") if child.get("position") is not None else 40},
            "d1": {"status": "CONFIRMED", "direction": parent.get("direction") or trade, "confirmed": True},
            "h8": {"status": "CONFIRMED", "direction": child.get("direction") or trade, "confirmed": True},
            "freshness": {"status": "CURRENT"},
            "handoff": {"instrument": symbol, "timeframe": self.timeframe},
        }
        latest = int(bars[-1][0]) if bars else None
        series = {"status": "READY", "reason": f"{self.timeframe} closed candles", "candle_count": len(bars or []),
                  "latest_ts": latest, "provider_exhausted": False}
        raw = confirm.evaluate(symbol, context, series, bars, now_ts or (latest or 0) + TF_SECONDS[self.timeframe], cfg, missed_bars=missed_bars)
        entry = raw.get("entry") or {}
        setup = raw.get("setup") or {}
        structure = raw.get("h1") or {}
        return {
            "timeframe": self.timeframe,
            "barSeconds": TF_SECONDS[self.timeframe],
            "state": raw.get("state"),
            "reasonCode": raw.get("reasonCode"),
            "reason": raw.get("reason"),
            "confirmed": bool(raw.get("confirmed")),
            "phase": raw.get("phase"),
            "score": raw.get("score"),
            "entry": entry,
            "pullback": setup.get("pullback"),
            "trigger": setup.get("trigger"),
            "falseBreakout": bool(setup.get("falseBreakout")),
            "invalidationLevel": raw.get("invalidationLevel"),
            "atr": structure.get("atr"),
            "lastTs": structure.get("lastTs"),
            "lastClose": structure.get("lastClose"),
            "reaction": setup.get("pullback") in ("HOLDING", "COMPLETE") or entry.get("timing") in ("ENTER_NOW", "RETEST_CONFIRMED"),
        }
