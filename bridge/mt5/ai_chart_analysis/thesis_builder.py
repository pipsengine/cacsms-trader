from __future__ import annotations

from typing import Any


def build_thesis_title(direction: str, market_state: str, opportunity_type: str | None) -> str:
    d = (direction or "NEUTRAL").upper()
    ms = (market_state or "UNCLEAR").replace("_", " ").lower()
    if opportunity_type:
        ot = str(opportunity_type).replace("_", " ").replace("OP-", "").strip()
        if d == "BULLISH":
            return f"Bullish {ot.lower()}" if ot else "Bullish continuation"
        if d == "BEARISH":
            return f"Bearish {ot.lower()}" if ot else "Bearish continuation"
    if d == "BULLISH":
        if "pullback" in ms:
            return "Bullish continuation (pullback)"
        if "breakout" in ms:
            return "Bullish breakout developing"
        return "Bullish continuation"
    if d == "BEARISH":
        if "pullback" in ms:
            return "Bearish continuation (pullback)"
        if "breakout" in ms:
            return "Bearish breakout developing"
        return "Bearish continuation"
    return "Neutral observation"


def build_thesis_narrative(
    symbol: str,
    strip: list[dict[str, Any]],
    direction: str,
    market_state: str,
    tradable: bool,
    hierarchy: list[dict[str, Any]] | None = None,
) -> str:
    d1 = next((r for r in strip if r["timeframe"] == "D1"), None)
    h8 = next((r for r in strip if r["timeframe"] == "H8"), None)
    h1 = next((r for r in strip if r["timeframe"] == "H1"), None)
    m15 = next((r for r in strip if r["timeframe"] == "M15"), None)

    parts: list[str] = []
    if d1 and h8 and d1.get("direction") == h8.get("direction") and d1["direction"] in ("BULLISH", "BEARISH"):
        parts.append(
            f"Price remains structurally {d1['direction'].lower()} on D1 and H8."
        )
    elif d1 and d1["direction"] in ("BULLISH", "BEARISH"):
        parts.append(f"D1 primary structure is {d1['direction'].lower()}.")

    if h1:
        rel = next((h for h in hierarchy or [] if h.get("child") == "H1"), None)
        if rel and rel.get("relation") == "COUNTERTREND_PULLBACK":
            parts.append(
                f"H1 is a {h1.get('direction', '').lower()} counter-trend pullback inside higher-timeframe structure."
            )
        elif (h1.get("marketState") or "").upper() in ("BREAKOUT_DEVELOPING", "BREAKOUT_CONFIRMED", "BREAKOUT"):
            parts.append("H1 has completed a structural break and may be testing the broken area.")
        elif (h1.get("marketState") or "").upper() in ("PULLBACK", "CORRECTION"):
            parts.append(f"H1 is in pullback ({h1.get('direction', '').lower()}) toward the active reaction zone.")
        else:
            parts.append(f"H1 market state: {(h1.get('marketState') or 'unclear').replace('_', ' ').lower()}.")

    if m15 and m15.get("direction") not in (direction, "UNKNOWN", "NEUTRAL"):
        parts.append(f"M15 remains {m15['direction'].lower()}; confirmation timing is still open.")
    elif not tradable:
        parts.append("M15 confirmation remains absent, so the setup is developing but is not yet tradable.")
    else:
        parts.append("Analytical tradability chain is satisfied; deterministic Stage 8 authorization still required.")

    parts.append(
        "Execution is not authorized by this analysis layer."
        if not tradable
        else "Review deterministic risk gates before any execution."
    )
    return " ".join(parts)
