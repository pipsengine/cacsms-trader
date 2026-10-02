from __future__ import annotations

from typing import Any


def reconcile(
    ai_summary: str,
    framework_hypothesis: dict[str, Any] | None,
    opportunity_row: dict[str, Any] | None,
    confirm: dict[str, Any] | None,
    tradable: bool,
) -> dict[str, Any]:
    engine_bits: list[str] = []
    if framework_hypothesis:
        ot = framework_hypothesis.get("opportunityType") or framework_hypothesis.get("opportunity_type")
        if ot:
            engine_bits.append(f"{ot} detected")
        engine_bits.append(f"lifecycle {framework_hypothesis.get('lifecycle')}")
        cs = framework_hypothesis.get("confirmationState")
        if cs:
            engine_bits.append(str(cs))
    if opportunity_row:
        p1 = (opportunity_row.get("p1") or {}).get("state")
        p2 = (opportunity_row.get("p2") or {}).get("state")
        if p1:
            engine_bits.append(p1)
        if p2:
            engine_bits.append(p2)
    inst = (confirm or {}).get("instrument") if confirm else None
    if inst:
        engine_bits.append(f"Stage7 {inst.get('status')}")

    engine_text = "; ".join(engine_bits) if engine_bits else "No deterministic opportunity row for symbol"

    agreement = "INSUFFICIENT_DATA"
    conflict = ""
    if not framework_hypothesis and not opportunity_row:
        agreement = "INSUFFICIENT_DATA"
        conflict = "No Opportunity Framework hypothesis or classic opportunity row loaded."
    elif tradable:
        agreement = "AGREEMENT"
    else:
        ai_bull = "bullish" in ai_summary.lower()
        ai_bear = "bearish" in ai_summary.lower()
        dir_fw = (framework_hypothesis or {}).get("direction") or opportunity_row.get("direction") if opportunity_row else None
        if dir_fw in ("BULLISH", "BEARISH") and ((dir_fw == "BULLISH" and ai_bull) or (dir_fw == "BEARISH" and ai_bear)):
            agreement = "PARTIAL"
            conflict = (
                "AI narrative aligns on direction, but deterministic confirmation / P2 lifecycle has not authorized tradability."
            )
        elif dir_fw and dir_fw not in ("UNKNOWN", "NEUTRAL"):
            agreement = "CONFLICT"
            conflict = "AI interpretation diverges from primary framework direction or lifecycle."
        else:
            agreement = "PARTIAL"
            conflict = "Direction unclear in framework; AI thesis is provisional."

    return {
        "aiInterpretation": ai_summary,
        "deterministicEngine": engine_text,
        "agreement": agreement,
        "conflictDetail": conflict,
        "executionAuthorized": False,
        "note": "AI confidence does not grant execution authorization; Stage 8 remains authoritative.",
    }
