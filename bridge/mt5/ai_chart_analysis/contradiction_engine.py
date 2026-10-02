from __future__ import annotations

from typing import Any


def detect_contradictions(
    strip: list[dict[str, Any]],
    hierarchy: list[dict[str, Any]],
    supporting: list[dict[str, Any]],
    conflicting: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Hierarchy-aware contradictions; countertrend pullbacks are not auto-conflicts."""
    out: list[dict[str, Any]] = []
    pullback_children = {h["child"] for h in hierarchy if h.get("relation") == "COUNTERTREND_PULLBACK"}

    for row in strip:
        tf = row["timeframe"]
        if tf in pullback_children:
            continue
        st = row.get("supertrend")
        d = row.get("direction")
        if st in ("UP", "DOWN") and d in ("BULLISH", "BEARISH"):
            aligned = (st == "UP" and d == "BULLISH") or (st == "DOWN" and d == "BEARISH")
            if not aligned:
                out.append(
                    {
                        "text": f"{tf}: Supertrend {st} vs structure {d}",
                        "type": "SUPERTREND_STRUCTURE",
                        "timeframe": tf,
                        "severity": "MEDIUM",
                    }
                )

    for h in hierarchy:
        if h.get("relation") == "DIVERGENT":
            out.append(
                {
                    "text": f"{h['child']} diverges from {h['parent']} ({h.get('parentDirection')} vs {h.get('childDirection')})",
                    "type": "HIERARCHY",
                    "timeframe": h["child"],
                    "severity": "HIGH",
                }
            )

    for c in conflicting[:3]:
        text = c.get("text") or ""
        if not text:
            continue
        out.append(
            {
                "text": text,
                "type": c.get("type") or "CONFLICT",
                "timeframe": c.get("timeframe"),
                "severity": "MEDIUM",
            }
        )

    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for item in out:
        key = item.get("text", "")
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped[:5]
