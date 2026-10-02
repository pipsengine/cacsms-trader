from __future__ import annotations

import re
from typing import Any

_STRUCTURE = re.compile(r"structure|channel|swing|BOS|CHOCH|boundary|HTF|pullback|hierarchy", re.I)
_OPP = re.compile(r"opportunity|lifecycle|ERZ|zone|P1|P2|reaction|retest|framework", re.I)
_CONFIRM = re.compile(r"confirm|BOS|retest|stage\s*7|execution|closed.?bar|missing", re.I)
_BREAKOUT = re.compile(r"breakout|break|BOS|channel break", re.I)
_REVERSAL = re.compile(r"reversal|CHOCH|invalid|counter|deteriorat", re.I)
_CONT = re.compile(r"continuation|pullback|corrective|align|trend", re.I)

_ANN_BY_MODE: dict[str, frozenset[str]] = {
    "STRUCTURE": frozenset({"HIGH", "LOW", "BOS", "CHOCH", "CHANNEL", "TOUCH", "BREAKOUT", "RETEST"}),
    "OPPORTUNITY": frozenset({"ERZ", "INVALIDATION", "RETEST", "BOS"}),
    "CONFIRMATION": frozenset({"BOS", "CHOCH", "RETEST", "BREAKOUT", "ERZ", "INVALIDATION"}),
    "CONTINUATION": frozenset({"ERZ", "BOS", "RETEST", "INVALIDATION", "CHANNEL"}),
    "BREAKOUT": frozenset({"BOS", "BREAKOUT", "RETEST", "INVALIDATION"}),
    "REVERSAL": frozenset({"CHOCH", "INVALIDATION", "BOS", "LOW", "HIGH"}),
}

_TRAD_STAGES_BY_MODE: dict[str, frozenset[str]] = {
    "STRUCTURE": frozenset({"MACRO_CONTEXT", "PRIMARY_STRUCTURE", "TRADING_DIRECTION", "LOCATION"}),
    "OPPORTUNITY": frozenset({"LOCATION", "REACTION", "STRUCTURAL_CONFIRMATION", "RETEST", "TRADABLE"}),
    "CONFIRMATION": frozenset({"STRUCTURAL_CONFIRMATION", "RETEST", "ENTRY_REFINEMENT", "RISK_VALIDATION", "TRADABLE"}),
    "CONTINUATION": frozenset({"TRADING_DIRECTION", "LOCATION", "REACTION", "STRUCTURAL_CONFIRMATION", "RETEST", "TRADABLE"}),
    "BREAKOUT": frozenset({"STRUCTURAL_CONFIRMATION", "RETEST", "ENTRY_REFINEMENT", "TRADABLE"}),
    "REVERSAL": frozenset({"MACRO_CONTEXT", "PRIMARY_STRUCTURE", "STRUCTURAL_CONFIRMATION", "RISK_VALIDATION"}),
}


def _filter_evidence(items: list[dict[str, Any]], pattern: re.Pattern[str], limit: int = 8) -> list[dict[str, Any]]:
    out = [e for e in items if pattern.search((e.get("text") or "") + " " + (e.get("type") or ""))]
    return (out or items)[:limit]


def apply_analysis_mode(
    mode: str,
    *,
    supporting: list[dict[str, Any]],
    conflicting: list[dict[str, Any]],
    missing: list[dict[str, Any]],
    annotations: list[dict[str, Any]],
    tradability: list[dict[str, Any]],
    thesis: str,
) -> dict[str, Any]:
    """Narrow presentation for analytical modes without recomputing engine math."""
    mode = (mode or "FULL_ANALYSIS").upper()
    if mode == "FULL_ANALYSIS":
        return {
            "supporting": supporting,
            "conflicting": conflicting,
            "missing": missing,
            "annotations": annotations,
            "tradability": tradability,
            "thesis": thesis,
            "modeFocus": "Full multi-engine synthesis",
        }

    pattern = {
        "STRUCTURE": _STRUCTURE,
        "OPPORTUNITY": _OPP,
        "CONFIRMATION": _CONFIRM,
        "CONTINUATION": _CONT,
        "BREAKOUT": _BREAKOUT,
        "REVERSAL": _REVERSAL,
    }.get(mode, _STRUCTURE)

    ann_types = _ANN_BY_MODE.get(mode)
    filtered_ann = [a for a in annotations if not ann_types or (a.get("type") or "").upper() in ann_types]
    if not filtered_ann:
        filtered_ann = annotations[:6]

    stages = _TRAD_STAGES_BY_MODE.get(mode)
    filtered_trad = [t for t in tradability if not stages or t.get("stage") in stages]
    if not filtered_trad:
        filtered_trad = tradability

    focus_lines = {
        "STRUCTURE": "Structure-first view: channel hierarchy, swings, and closed-bar events.",
        "OPPORTUNITY": "Opportunity-first view: lifecycle, zones, and P1/P2 progression.",
        "CONFIRMATION": "Confirmation-first view: Stage 7 / BOS / retest requirements.",
        "CONTINUATION": "Continuation view: HTF alignment vs corrective pullbacks.",
        "BREAKOUT": "Breakout view: break levels, BOS, and retest validation.",
        "REVERSAL": "Reversal view: CHoCH, invalidation, and counter-scenario risk.",
    }
    prefix = focus_lines.get(mode, "")
    narrowed_thesis = f"{prefix} {thesis}".strip() if prefix else thesis

    return {
        "supporting": _filter_evidence(supporting, pattern, 8),
        "conflicting": _filter_evidence(conflicting, pattern, 5),
        "missing": _filter_evidence(missing, pattern, 5) if mode != "CONFIRMATION" else missing[:5],
        "annotations": filtered_ann,
        "tradability": filtered_trad,
        "thesis": narrowed_thesis,
        "modeFocus": prefix or mode.replace("_", " ").title(),
    }
