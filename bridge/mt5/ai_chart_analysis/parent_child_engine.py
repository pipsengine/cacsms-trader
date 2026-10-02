from __future__ import annotations

from typing import Any

try:
    from ai_chart_analysis.models import STRIP_TFS
except ImportError:  # pragma: no cover
    from bridge.mt5.ai_chart_analysis.models import STRIP_TFS  # type: ignore

_PULLBACK_STATES = frozenset({"PULLBACK", "CORRECTION", "COUNTER_CORRECTION", "RETEST"})
_REVERSAL_STATES = frozenset({"REVERSAL_DEVELOPING", "REVERSAL_CONFIRMED", "REVERSAL_CANDIDATE"})
_BREAKOUT_STATES = frozenset({"BREAKOUT_DEVELOPING", "BREAKOUT_CONFIRMED", "BREAKOUT"})


def _norm_dir(d: str | None) -> str:
    u = (d or "UNKNOWN").upper()
    if u in ("BULLISH", "BEARISH", "NEUTRAL", "MIXED"):
        return u
    return "UNKNOWN"


def _relation(parent: dict[str, Any], child: dict[str, Any], channels: dict[str, Any]) -> str:
    pd = _norm_dir(parent.get("direction"))
    cd = _norm_dir(child.get("direction"))
    cms = (child.get("marketState") or "").upper()
    child_tf = child.get("timeframe")
    ch = channels.get(child.get("sourceChannelTf") or child_tf) if child_tf else None
    rel = (ch or {}).get("relationship") or ""

    if cd in ("UNKNOWN", "NEUTRAL", "MIXED"):
        return "UNCLEAR"
    if pd in ("UNKNOWN", "NEUTRAL"):
        return "UNCLEAR"
    if pd == cd:
        if cms in _BREAKOUT_STATES:
            return "BREAKOUT"
        if cms == "RETEST":
            return "RETEST"
        return "ALIGNED_CONTINUATION"
    if cms in _PULLBACK_STATES or rel in ("CORRECTIVE", "COUNTER_CORRECTION", "NESTED_CORRECTION"):
        return "COUNTERTREND_PULLBACK"
    if cms in _REVERSAL_STATES:
        return "REVERSAL_DEVELOPING"
    if cms in _BREAKOUT_STATES:
        return "BREAKOUT"
    if cms in ("RANGING", "COMPRESSION"):
        return "RANGE_INSIDE_PARENT"
    if cms == "TRANSITION":
        return "TRANSITION"
    return "DIVERGENT"


def build_parent_child_hierarchy(
    strip: list[dict[str, Any]],
    channels: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Map each child TF to its parent relationship (YTD→…→M5)."""
    channels = channels or {}
    by_tf = {r["timeframe"]: r for r in strip}
    out: list[dict[str, Any]] = []
    for i in range(1, len(STRIP_TFS)):
        parent_tf, child_tf = STRIP_TFS[i - 1], STRIP_TFS[i]
        parent = by_tf.get(parent_tf)
        child = by_tf.get(child_tf)
        if not parent or not child:
            continue
        relation = _relation(parent, child, channels)
        out.append(
            {
                "parent": parent_tf,
                "child": child_tf,
                "relation": relation,
                "parentDirection": _norm_dir(parent.get("direction")),
                "childDirection": _norm_dir(child.get("direction")),
                "childMarketState": child.get("marketState"),
            }
        )
    return out
