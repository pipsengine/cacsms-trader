from __future__ import annotations

from typing import Any


def _swing(ch: dict[str, Any] | None, kind: str) -> float | None:
    if not ch:
        return None
    swings = (ch.get("evidence") or {}).get("swings") or []
    matched = [s for s in swings if (s.get("kind") or "").upper() == kind]
    if not matched:
        return None
    p = matched[-1].get("price")
    return float(p) if p is not None else None


def _last_event(ch: dict[str, Any] | None) -> str:
    if not ch:
        return "NONE"
    events = [e for e in (ch.get("evidence") or {}).get("events") or [] if (e.get("status") or "CONFIRMED") != "INVALIDATED"]
    if not events:
        return "NONE"
    last = events[-1]
    kind = (last.get("kind") or "EVENT").upper()
    d = (last.get("direction") or ch.get("direction") or "").upper()
    return f"{kind}_{d}" if d else kind


def _channel_position(ch: dict[str, Any] | None) -> str:
    if not ch:
        return "UNKNOWN"
    label = ch.get("positionLabel") or ch.get("position")
    if label:
        return str(label).upper().replace(" ", "_")
    pos = (ch.get("positionInChannel") or "").upper()
    return pos or "UNKNOWN"


def build_timeframe_states(
    strip: list[dict[str, Any]],
    channels: dict[str, Any],
    *,
    opp_row: dict[str, Any] | None = None,
    confirm: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """Normalized CURRENT state per strip TF (summary for thesis layer, not raw event dumps)."""
    out: dict[str, dict[str, Any]] = {}
    inst = (confirm or {}).get("instrument") if confirm else None
    for row in strip:
        tf = row["timeframe"]
        ch_key = row.get("sourceChannelTf")
        ch = channels.get(ch_key) if ch_key else channels.get(tf)
        direction = row.get("direction") or "UNKNOWN"
        ms = row.get("marketState") or "UNCLEAR"
        st = row.get("supertrend")
        st_label = "BULLISH" if st == "UP" else "BEARISH" if st == "DOWN" else "NEUTRAL"
        quality = "VALID" if ch or st not in (None, "UNKNOWN") else "INSUFFICIENT"
        if direction in ("UNKNOWN", "NEUTRAL") and not ch:
            quality = "INSUFFICIENT"

        breakout = "CONFIRMED" if ms in ("BREAKOUT_CONFIRMED", "BREAKOUT") else "DEVELOPING" if "BREAKOUT" in ms else "NONE"
        pullback = "COMPLETE" if ms in ("PULLBACK", "CORRECTION", "COUNTER_CORRECTION") else "NONE"
        retest = "DEVELOPING" if ms == "RETEST" or (ch or {}).get("status") == "RETESTING" else "NONE"

        closed_ms = row.get("lastClosedCandleMs")
        out[tf] = {
            "timeframe": tf,
            "direction": direction,
            "marketState": ms,
            "structure": row.get("structure") or "UNKNOWN",
            "activeSwingHigh": _swing(ch, "HIGH"),
            "activeSwingLow": _swing(ch, "LOW"),
            "lastMeaningfulEvent": _last_event(ch),
            "channelDirection": direction if ch else "UNKNOWN",
            "channelPosition": _channel_position(ch),
            "supertrend": st_label,
            "strengthState": (ch or {}).get("strengthState") or "UNKNOWN",
            "volatilityState": (ch or {}).get("volatilityState") or "UNKNOWN",
            "pullbackState": pullback,
            "breakoutState": breakout,
            "retestState": retest,
            "closedBarTime": closed_ms,
            "dataQuality": quality,
            "p1State": (opp_row.get("p1") or {}).get("state") if opp_row and tf in ("H1", "M15") else None,
            "p2State": (opp_row.get("p2") or {}).get("state") if opp_row and tf in ("M15", "M5") else None,
            "stage7Confirmed": bool(inst and (inst.get("status") or "").upper() == "CONFIRMED") if tf == "H1" else None,
        }
    return out
