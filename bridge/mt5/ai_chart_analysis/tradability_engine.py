from __future__ import annotations

from typing import Any

try:
    from ai_chart_analysis.models import TRADABILITY_STAGES
except ImportError:  # pragma: no cover
    from bridge.mt5.ai_chart_analysis.models import TRADABILITY_STAGES  # type: ignore


def _stage(status: str) -> dict[str, Any]:
    return {"stage": status, "state": "PENDING"}


def build_tradability_chain(
    strip: list[dict[str, Any]],
    supporting: list[dict[str, Any]],
    missing: list[dict[str, Any]],
    tradable: bool,
    opportunity_row: dict[str, Any] | None,
    confirm: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    chain: list[dict[str, Any]] = []

    def set_stage(name: str, state: str, detail: str = "") -> None:
        chain.append({"stage": name, "state": state, "detail": detail})

    macro_ok = any(r["timeframe"] in ("YTD", "W", "MN") and r["direction"] in ("BULLISH", "BEARISH") for r in strip)
    set_stage("MACRO_CONTEXT", "COMPLETE" if macro_ok else "PENDING", "Strategic timeframe alignment")

    struct_ok = any(r["timeframe"] in ("D1", "H8") and r["channelState"] in ("ACTIVE", "VALIDATED", "RETESTING") for r in strip)
    set_stage("PRIMARY_STRUCTURE", "COMPLETE" if struct_ok else "ACTIVE" if macro_ok else "PENDING")

    d1 = next((r for r in strip if r["timeframe"] == "D1"), None)
    trade_dir = d1["direction"] if d1 and d1["direction"] not in ("UNKNOWN", "NEUTRAL") else "UNKNOWN"
    set_stage(
        "TRADING_DIRECTION",
        "COMPLETE" if trade_dir in ("BULLISH", "BEARISH") else "PENDING",
        trade_dir,
    )

    h1 = next((r for r in strip if r["timeframe"] == "H1"), None)
    loc_ok = h1 and h1.get("marketState") in ("PULLBACK", "RETEST", "TRENDING", "BREAKOUT_DEVELOPING")
    set_stage("LOCATION", "COMPLETE" if loc_ok else "ACTIVE" if struct_ok else "PENDING")

    reaction = any("reaction" in (e.get("text") or "").lower() or e.get("type") == "REACTION" for e in supporting)
    p1 = (opportunity_row or {}).get("p1") or {}
    if p1.get("state") in ("P1_ZONE_REACHED", "P1_CONFIRMED", "P1_READY_FOR_RISK"):
        reaction = True
    set_stage("REACTION", "COMPLETE" if reaction else "ACTIVE" if loc_ok else "PENDING")

    bos_missing = any(e.get("type") == "BOS" for e in missing)
    bos_ok = any(e.get("type") == "BOS" and e.get("status") == "CONFIRMED" for e in supporting)
    inst = (confirm or {}).get("instrument") if confirm else None
    if inst and (inst.get("status") or "").upper() == "CONFIRMED":
        bos_ok = True
    set_stage(
        "STRUCTURAL_CONFIRMATION",
        "COMPLETE" if bos_ok else "ACTIVE" if reaction else "PENDING",
        "M15/H1 closed-bar BOS" if bos_missing else "",
    )

    p2 = (opportunity_row or {}).get("p2") or {}
    p2_state = p2.get("state")
    if p2_state == "P2_READY_FOR_RISK":
        set_stage("RETEST", "COMPLETE")
    elif p2_state == "P2_WAIT_RETEST":
        set_stage("RETEST", "ACTIVE")
    else:
        set_stage("RETEST", "PENDING" if bos_ok else "NOT_REQUIRED")

    entry_ok = p2_state == "P2_READY_FOR_RISK" or (inst and inst.get("status") == "CONFIRMED")
    set_stage("ENTRY_REFINEMENT", "COMPLETE" if entry_ok else "PENDING")

    risk_ok = bool(opportunity_row and opportunity_row.get("actionable"))
    set_stage("RISK_VALIDATION", "COMPLETE" if risk_ok else "PENDING")

    set_stage("TRADABLE", "COMPLETE" if tradable else "FAILED" if risk_ok and not tradable else "PENDING")

    # pad if somehow short
    names = {c["stage"] for c in chain}
    for stage in TRADABILITY_STAGES:
        if stage not in names:
            chain.append(_stage(stage))

    return chain
