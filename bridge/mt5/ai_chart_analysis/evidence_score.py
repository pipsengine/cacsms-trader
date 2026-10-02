from __future__ import annotations

from typing import Any


def compute_evidence_score(
    strip: list[dict[str, Any]],
    supporting: list[dict[str, Any]],
    conflicting: list[dict[str, Any]],
    missing: list[dict[str, Any]],
    hierarchy: list[dict[str, Any]],
) -> tuple[int, dict[str, Any]]:
    """Explainable evidence score — not win probability."""
    htf = [r for r in strip if r["timeframe"] in ("YTD", "Q", "MN", "W", "D1", "H8")]
    aligned = sum(1 for r in htf if r.get("direction") in ("BULLISH", "BEARISH"))
    htf_score = min(25, aligned * 4)

    struct = sum(1 for r in strip if r["timeframe"] in ("D1", "H8", "H1") and r.get("structure") not in (None, "UNKNOWN", "TRANSITION"))
    structure_score = min(20, struct * 7)

    st_align = 0
    for r in strip:
        st, d = r.get("supertrend"), r.get("direction")
        if st in ("UP", "DOWN") and d in ("BULLISH", "BEARISH"):
            if (st == "UP" and d == "BULLISH") or (st == "DOWN" and d == "BEARISH"):
                st_align += 1
    supertrend_score = min(15, st_align * 3)

    support_score = min(20, len(supporting) * 3)
    conflict_penalty = min(25, len(conflicting) * 5 + sum(1 for h in hierarchy if h.get("relation") == "DIVERGENT") * 4)
    missing_penalty = min(20, len(missing) * 4)

    data_ok = sum(1 for r in strip if r.get("confidence", 0) > 0)
    data_score = min(10, data_ok)

    raw = htf_score + structure_score + supertrend_score + support_score + data_score - conflict_penalty - missing_penalty
    score = max(5, min(95, int(raw)))

    components = {
        "htfAlignment": htf_score,
        "structureQuality": structure_score,
        "supertrendAgreement": supertrend_score,
        "supportingEvidence": support_score,
        "dataQuality": data_score,
        "contradictions": -conflict_penalty,
        "missingEvidence": -missing_penalty,
    }
    return score, components
