from __future__ import annotations

from typing import Any


def classify_regime(strip: list[dict[str, Any]], channels: dict[str, Any]) -> dict[str, Any]:
    """Regime from closed-bar engine evidence (no synthetic OHLC)."""
    states = [(r.get("marketState") or "").upper() for r in strip if r["timeframe"] in ("D1", "H8", "H1")]
    channel_status = [str((channels.get(k) or {}).get("status") or "").upper() for k in ("D1", "H8", "H1") if k in channels]

    if any("COMPRESSION" in s for s in states):
        primary = "COMPRESSION"
    elif any("BREAKOUT" in s for s in states):
        primary = "BREAKOUT_ENVIRONMENT"
    elif any(s in ("REVERSAL_DEVELOPING", "REVERSAL_CANDIDATE", "REVERSAL_CONFIRMED") for s in states):
        primary = "REVERSAL_ENVIRONMENT"
    elif any(s == "RANGING" for s in states) or any(s == "RANGE" for s in channel_status):
        primary = "RANGING"
    elif any(s == "TRENDING" for s in states):
        primary = "TRENDING"
    elif any(s in ("PULLBACK", "CORRECTION") for s in states):
        primary = "TRANSITION"
    else:
        primary = "UNCLEAR"

    vol = "VOLATILE" if any("BREAKOUT" in s for s in states) else "LOW_VOLATILITY" if primary == "COMPRESSION" else "NORMAL"

    return {
        "primary": primary,
        "volatility": vol,
        "expansion": primary in ("BREAKOUT_ENVIRONMENT", "TRENDING"),
        "note": "Derived from D1/H8/H1 market states and channel status",
    }
