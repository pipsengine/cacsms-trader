"""Campaign handoff, shared risk at execution, and restart reconciliation.

Discovery stays in opportunity.py. A hypothesis reaches Stage 8 only after this
planner accepts the confirmation. Stage 8 remains the authorization authority.
"""

from __future__ import annotations

from typing import Any

HELD_TIMING = frozenset(("WAIT_RETEST", "WAIT_PULLBACK", "WAIT_NEW_CONFIRMATION", "REJECT"))
P2_ENTRY = frozenset(("ENTER_NOW", "RETEST_CONFIRMED"))


def execution_key(campaign_id: str, leg: str, revision: Any) -> str:
    return f"{campaign_id}|{leg}|{revision}"


def _handoff(hypothesis: dict[str, Any], confirmation: dict[str, Any], leg: str, executable: bool, timing: str) -> dict[str, Any]:
    revision = confirmation.get("lastTs") or hypothesis.get("campaignId")
    entry = dict(confirmation.get("entry") or {})
    entry["timing"] = timing
    zone = hypothesis.get("expectedRetracementZone") or {}
    target = zone.get("expectedBreakLevel")
    if target is None:
        target = hypothesis.get("targetPrice")
    shared = float(hypothesis.get("remainingRisk") or 0)
    leg_risk = float((hypothesis.get(leg.lower()) or {}).get("riskPct") or 0)
    return {
        "handoffKind": "CAMPAIGN",
        "executable": executable,
        "campaignId": hypothesis.get("campaignId"),
        "legType": leg,
        "setupRevision": revision,
        "executionKey": execution_key(str(hypothesis.get("campaignId")), leg, revision),
        "instrument": hypothesis.get("instrument"),
        "direction": hypothesis.get("direction"),
        "opportunityFamily": hypothesis.get("opportunityFamily"),
        "TiTLevel": hypothesis.get("TiTLevel"),
        "parentTimeframe": hypothesis.get("parentTimeframe"),
        "childTimeframe": hypothesis.get("childTimeframe"),
        "executionTimeframe": confirmation.get("timeframe") or hypothesis.get("executionTimeframe"),
        "barSeconds": confirmation.get("barSeconds"),
        "barTs": confirmation.get("lastTs"),
        "lastClose": confirmation.get("lastClose"),
        "confirmedSince": confirmation.get("confirmedSince"),
        "confidence": float(confirmation.get("score") or hypothesis.get("confidence") or 0),
        "atr": confirmation.get("atr"),
        "invalidationLevel": confirmation.get("invalidationLevel") or zone.get("invalidationLevel"),
        "targetPrice": target,
        "entry": entry,
        "trigger": confirmation.get("trigger"),
        "reason": confirmation.get("reason"),
        "legRisk": leg_risk,
        "campaign": {
            "campaignId": hypothesis.get("campaignId"),
            "allocatedRisk": hypothesis.get("allocatedRisk"),
            "usedRisk": hypothesis.get("usedRisk") or 0,
            "remainingRisk": shared,
        },
        "executes": False,
        "scannerRank": hypothesis.get("scannerRank"),
    }


def plan(hypothesis: dict[str, Any], confirmation: dict[str, Any]) -> dict[str, Any]:
    """Turn one hypothesis plus a closed-bar confirmation into zero or more Stage 8 handoffs."""
    timing = str((confirmation.get("entry") or {}).get("timing") or "")
    if confirmation.get("falseBreakout"):
        return {"handoffs": [], "executable": False, "blocker": "FAILED_BREAKOUT", "reason": confirmation.get("reason")}
    if confirmation.get("state") == "INVALIDATED":
        return {"handoffs": [], "executable": False, "blocker": "STRUCTURE_INVALIDATED", "reason": confirmation.get("reason")}
    if str(confirmation.get("reasonCode") or "") == "MISSED_CONFIRMATION" or timing == "WAIT_NEW_CONFIRMATION":
        return {"handoffs": [], "executable": False, "blocker": "WAIT_NEW_CONFIRMATION", "reason": "Historical confirmation is not actionable now"}
    handoffs: list[dict[str, Any]] = []
    p1 = (hypothesis.get("p1") or {}).get("state")
    p2 = (hypothesis.get("p2") or {}).get("state")
    held = timing in HELD_TIMING or (confirmation.get("entry") or {}).get("classification") in ("EXTENDED", "POOR", "INVALID")
    p2_ready = p2 in ("P2_READY_FOR_RISK", "P2_READY")
    p1_ready = p1 in ("P1_READY_FOR_RISK", "P1_READY")
    if p2 == "P2_WAIT_RETEST" or (p2_ready and held and timing == "WAIT_RETEST"):
        handoffs.append(_handoff(hypothesis, confirmation, "P2", False, "WAIT_RETEST"))
    elif p2_ready and confirmation.get("confirmed") and timing in P2_ENTRY:
        handoffs.append(_handoff(hypothesis, confirmation, "P2", True, timing))
    if p1_ready and confirmation.get("reaction") and not held and timing != "WAIT_RETEST":
        handoffs.append(_handoff(hypothesis, confirmation, "P1", True, timing or "REACTION"))
    elif p1_ready and not any(h["legType"] == "P1" for h in handoffs):
        blocker = "WAITING_FOR_M5_CONFIRMATION" if hypothesis.get("executionTimeframe") == "M5" else "WAITING_FOR_CONFIRMATION"
        if not handoffs:
            return {"handoffs": [], "executable": False, "blocker": blocker, "reason": confirmation.get("reason")}
    executable = any(h["executable"] for h in handoffs)
    blocker = None if executable else ("WAIT_RETEST" if any(h["entry"]["timing"] == "WAIT_RETEST" for h in handoffs) else "WAITING_FOR_CONFIRMATION")
    return {"handoffs": handoffs, "executable": executable, "blocker": blocker, "reason": confirmation.get("reason")}


def new_book() -> dict[str, Any]:
    return {"orders": {}, "campaigns": {}}


def accept(book: dict[str, Any], authorization: dict[str, Any]) -> dict[str, Any]:
    """Idempotent campaign fill. A second call with the same key does not add risk or a second order."""
    source = authorization.get("source") or {}
    key = source.get("executionKey") or authorization.get("executionId")
    if not key:
        return {"accepted": False, "duplicate": False, "reason": "MISSING_EXECUTION_KEY", "order": None}
    existing = book["orders"].get(key)
    if existing:
        return {"accepted": False, "duplicate": True, "reason": "DUPLICATE_ORDER", "order": existing}
    cid = str(source.get("campaignId") or key)
    allocated = float(source.get("allocatedRisk") or 0)
    camp = book["campaigns"].setdefault(cid, {"allocated": allocated, "used": 0.0, "remaining": allocated, "legs": {}})
    if allocated and camp["allocated"] != allocated:
        camp["allocated"] = max(float(camp["allocated"]), allocated)
    risk = float(authorization.get("riskPct") or 0)
    if camp["used"] + risk > float(camp["allocated"]) + 1e-6:
        return {"accepted": False, "duplicate": False, "reason": "CAMPAIGN_RISK", "order": None,
                "campaign": {**camp, "remaining": round(float(camp["allocated"]) - camp["used"], 4)}}
    order = {
        "executionKey": key, "executionId": authorization.get("executionId"), "campaignId": cid,
        "legType": source.get("legType"), "riskPct": risk, "instrument": authorization.get("instrument"),
        "direction": authorization.get("direction"), "family": source.get("opportunityFamily") or source.get("tradeType"),
        "TiTLevel": source.get("TiTLevel"), "state": "SUBMITTED", "broker": "test-adapter",
    }
    camp["used"] = round(camp["used"] + risk, 4)
    camp["remaining"] = round(float(camp["allocated"]) - camp["used"], 4)
    camp["legs"][str(source.get("legType") or "LEG")] = order["state"]
    book["orders"][key] = order
    return {"accepted": True, "duplicate": False, "reason": "SUBMITTED", "order": order, "campaign": camp}


def reconcile(book: dict[str, Any], broker_positions: list[dict[str, Any]], actionable_now: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Restore filled legs from the broker. Historical setups are not submitted."""
    restored = []
    for pos in broker_positions:
        key = pos.get("executionKey") or pos.get("comment")
        if not key or key in book["orders"]:
            if key and key in book["orders"]:
                restored.append(key)
            continue
        cid = str(pos.get("campaignId") or "")
        allocated = float(pos.get("allocatedRisk") or 0)
        camp = book["campaigns"].setdefault(cid, {"allocated": allocated, "used": 0.0, "remaining": allocated, "legs": {}})
        risk = float(pos.get("riskPct") or 0)
        camp["used"] = round(float(camp["used"]) + risk, 4)
        camp["allocated"] = max(float(camp["allocated"]), allocated)
        camp["remaining"] = round(float(camp["allocated"]) - camp["used"], 4)
        leg = str(pos.get("legType") or "P1")
        camp["legs"][leg] = "RESTORED"
        book["orders"][key] = {**pos, "executionKey": key, "state": "RESTORED", "submitted": False}
        restored.append(key)
    return {"restored": restored, "submitted": [], "actionableNow": [h.get("executionKey") for h in (actionable_now or []) if h.get("executable")]}


class Journal:
    """Stage 10 campaign facts. Recording an event never changes production parameters."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def record(self, event: dict[str, Any]) -> bool:
        key = event.get("eventKey")
        if not key or any(row.get("eventKey") == key for row in self.events):
            return False
        stored = {**event, "changesParameters": False}
        self.events.append(stored)
        return True


def outcome_event(kind: str, hypothesis: dict[str, Any], **extra: Any) -> dict[str, Any]:
    symbol = str(hypothesis.get("instrument") or "")
    level = hypothesis.get("TiTLevel")
    family = hypothesis.get("opportunityFamily")
    bucket = "XAU" if symbol == "XAUUSD" else (level or family or "NORMAL")
    revision = extra.get("revision") or hypothesis.get("campaignId")
    return {
        "eventKey": f"{hypothesis.get('campaignId')}|{kind}|{revision}",
        "kind": kind,
        "instrument": symbol,
        "family": family,
        "TiTLevel": level,
        "bucket": bucket,
        "changesParameters": False,
        **{k: v for k, v in extra.items() if k != "revision"},
    }
