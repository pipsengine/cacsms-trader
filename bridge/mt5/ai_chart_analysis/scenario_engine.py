from __future__ import annotations

from typing import Any


def build_scenarios(
    direction: str,
    market_state: str,
    *,
    invalidation: float | None,
    t1: float | None,
    t2: float | None,
    tradable: bool,
    missing: list[dict[str, Any]],
) -> dict[str, Any]:
    d = (direction or "NEUTRAL").upper()
    bull = d == "BULLISH"
    inv_text = f"Closed-bar break beyond {invalidation:.5f}" if invalidation else "Primary invalidation level on chart"
    next_event = "M15 closed-bar BOS" if not tradable else "Retest hold / Stage 7 confirmation"
    if any("RETEST" in (m.get("text") or "").upper() for m in missing):
        next_event = "Valid retest hold on closed bar"

    primary = {
        "id": "primary",
        "title": "Primary bullish continuation" if bull else "Primary bearish continuation" if d == "BEARISH" else "Primary scenario",
        "kind": "PRIMARY",
        "direction": d,
        "status": "ACTIVE",
        "currentState": market_state.replace("_", " ").title(),
        "nextExpectedEvent": next_event,
        "confirmationRequirement": "Closed-bar structural confirmation on entry timeframe",
        "invalidation": inv_text,
        "targetPath": [t1, t2],
        "conditions": [
            "ERZ / reaction zone remains valid",
            "Closed-bar BOS on entry timeframe",
            "Retest respects break level",
        ],
        "pathLabels": ["ERZ", "Reaction", "BOS", "Retest", "T1", "T2"],
        "disclaimer": "PROJECTED SCENARIO — NOT OBSERVED PRICE",
    }
    alt_dir = "BEARISH" if bull else "BULLISH" if d == "BEARISH" else "NEUTRAL"
    alternative = {
        "id": "alternative",
        "title": "Deeper H8 correction" if bull else "H8 relief rally" if d == "BEARISH" else "Alternative path",
        "kind": "ALTERNATIVE",
        "direction": alt_dir,
        "status": "ALTERNATIVE",
        "currentState": "Counter-scenario",
        "nextExpectedEvent": "Invalidation on closed bar",
        "confirmationRequirement": "HTF structure realignment",
        "invalidation": "Primary structure reclaimed",
        "targetPath": [],
        "conditions": ["Primary ERZ fails", "Invalidation closes on primary timeframe"],
        "pathLabels": ["Invalidation", "HTF correction", "Reassessment"],
        "disclaimer": "PROJECTED SCENARIO — NOT OBSERVED PRICE",
    }
    return {"primary": primary, "alternative": alternative}
