from __future__ import annotations

from typing import Any

_LABELS = {
    "HIGH": "Structural High",
    "LOW": "Structural Low",
    "BOS": "BOS",
    "CHOCH": "CHoCH",
    "BREAKOUT": "Breakout",
    "RETEST": "Retest",
    "INVALIDATION": "Invalidation",
    "TOUCH": "Channel Boundary",
    "CHANNEL": "Channel Boundary",
    "ERZ": "ERZ",
}

_PRIORITY = {
    "INVALIDATION": 0,
    "ERZ": 1,
    "BOS": 2,
    "CHOCH": 2,
    "BREAKOUT": 3,
    "RETEST": 3,
    "TOUCH": 4,
    "CHANNEL": 4,
    "HIGH": 5,
    "LOW": 5,
}


def build_annotations(channels: dict[str, Any], primary_tf: str, thesis_direction: str) -> list[dict[str, Any]]:
    """Thesis-relevant overlays only — avoid chart clutter from every swing/event."""
    candidates: list[dict[str, Any]] = []
    ch_key = primary_tf if primary_tf in channels else {"YTD": "YTD", "D1": "D1", "H1": "H1"}.get(primary_tf, primary_tf)
    primary = channels.get(ch_key) or channels.get("H1") or next(iter(channels.values()), None)
    if not primary:
        return []

    swings = (primary.get("evidence") or {}).get("swings") or []
    if swings:
        ordered = sorted(
            [s for s in swings if s.get("time") is not None],
            key=lambda s: int(s.get("time") or 0),
        )
        for s in ordered[-3:]:
            candidates.append(_swing_ann(primary, primary_tf, s))

    events = (primary.get("evidence") or {}).get("events") or []
    for kind in ("BOS", "CHOCH", "BREAKOUT", "RETEST"):
        matched = [e for e in events if (e.get("kind") or "").upper() == kind]
        if matched:
            candidates.append(_event_ann(primary, primary_tf, matched[-1], kind))

    if primary.get("upperBoundary") is not None:
        candidates.append(
            {
                "id": "channel-upper",
                "type": "CHANNEL",
                "label": "Channel Boundary",
                "timeframe": primary.get("timeframe") or primary_tf,
                "price": primary.get("upperBoundary"),
                "source": "ChannelEngine",
                "reason": "Active channel boundary",
                "thesisRelation": "LOCATION",
                "status": "OBSERVED",
                "priority": _PRIORITY["CHANNEL"],
            }
        )

    erz = primary.get("erz") or primary.get("entryZone")
    if isinstance(erz, dict) and erz.get("lower") is not None:
        candidates.append(
            {
                "id": "erz",
                "type": "ERZ",
                "label": "ERZ",
                "timeframe": primary.get("timeframe") or primary_tf,
                "price": erz.get("mid") or erz.get("lower"),
                "source": "OpportunityFramework",
                "reason": "Execution reaction zone",
                "thesisRelation": "ENTRY",
                "status": "OBSERVED",
                "priority": _PRIORITY["ERZ"],
            }
        )

    inv = primary.get("invalidation") or (primary.get("risk") or {}).get("invalidation")
    if inv is not None:
        candidates.append(
            {
                "id": "invalidation",
                "type": "INVALIDATION",
                "label": "Invalidation",
                "timeframe": primary.get("timeframe") or primary_tf,
                "price": inv,
                "source": "OpportunityFramework",
                "reason": "Thesis invalidation",
                "thesisRelation": "RISK",
                "status": "PROJECTED",
                "priority": _PRIORITY["INVALIDATION"],
            }
        )

    candidates.sort(key=lambda a: a.get("priority", 99))
    out: list[dict[str, Any]] = []
    for i, ann in enumerate(candidates[:10]):
        ann["index"] = i + 1
        out.append(ann)
    return out


def _swing_ann(primary: dict[str, Any], primary_tf: str, sw: dict[str, Any]) -> dict[str, Any]:
    kind = sw.get("kind") or "SWING"
    return {
        "id": sw.get("id") or f"sw-{sw.get('time')}",
        "type": kind,
        "label": _LABELS.get(kind, kind.title()),
        "timeframe": primary.get("timeframe") or primary_tf,
        "candleTimestamp": sw.get("time"),
        "price": sw.get("price"),
        "source": "ChannelEngine",
        "reason": f"Key swing {kind.lower()}",
        "thesisRelation": "STRUCTURE",
        "status": "CONFIRMED",
        "priority": _PRIORITY.get(kind, 6),
    }


def _event_ann(primary: dict[str, Any], primary_tf: str, ev: dict[str, Any], kind: str) -> dict[str, Any]:
    return {
        "id": ev.get("id") or f"{kind}-{ev.get('time')}",
        "type": kind,
        "label": _LABELS.get(kind, kind),
        "timeframe": primary.get("timeframe") or primary_tf,
        "candleTimestamp": ev.get("time"),
        "price": ev.get("price"),
        "source": "ChannelEngine",
        "reason": ev.get("label") or f"{kind} on closed bar",
        "thesisRelation": "CONFIRMATION",
        "status": "CONFIRMED",
        "priority": _PRIORITY.get(kind, 6),
    }
