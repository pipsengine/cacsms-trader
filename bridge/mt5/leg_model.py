"""Typed trend-within-trend classifier for the existing Stages 5–9.

Dominant HTF structure, channel location, the current market leg, and the
tradable classification are separate facts. An opposing lower-timeframe
structure inside a healthy higher-timeframe channel is a correction. It does
not flip the dominant trend. Channel position is context and never a trade
by itself.

Confidence values are sums of the evidence that is actually present. Missing
evidence contributes zero.
"""

from __future__ import annotations

from typing import Any

CONFIG: dict[str, Any] = {
    # Absolute channel position, 0 = lower boundary, 100 = upper boundary.
    "regions": {"lower": 25.0, "lowerMiddle": 45.0, "equilibrium": 55.0, "upperMiddle": 75.0},
    # Remaining channel percent required before a corrective entry is still early enough.
    "minRoomPct": 25.0,
    # Trade-type policy can only be stricter than the global Stage 8 and prop-firm limits.
    "policies": {
        "CONTINUATION": {"minConfidence": 65.0, "minRewardRisk": 2.0, "minTargetDistanceAtr": 0.8},
        "COUNTER_TREND": {"minConfidence": 72.0, "minRewardRisk": 2.5, "minTargetDistanceAtr": 1.2},
        "REVERSAL": {"minConfidence": 75.0, "minRewardRisk": 2.5, "minTargetDistanceAtr": 1.2},
        "BREAKOUT": {"minConfidence": 70.0, "minRewardRisk": 2.2, "minTargetDistanceAtr": 1.0},
        "RANGE_ROTATION": {"minConfidence": 65.0, "minRewardRisk": 2.0, "minTargetDistanceAtr": 0.8},
    },
}

LEGS = (
    "BULLISH_IMPULSE", "BULLISH_CORRECTION", "BEARISH_IMPULSE", "BEARISH_CORRECTION",
    "RANGE_ROTATION_UP", "RANGE_ROTATION_DOWN", "REVERSAL_CANDIDATE_BULLISH", "REVERSAL_CANDIDATE_BEARISH",
    "BREAKOUT_BULLISH", "BREAKOUT_BEARISH", "UNRESOLVED",
)
TRADE_TYPES = (
    "NONE",
    "TREND_CONTINUATION_LONG", "TREND_CONTINUATION_SHORT",
    "COUNTER_TREND_LONG", "COUNTER_TREND_SHORT",
    "RANGE_ROTATION_LONG", "RANGE_ROTATION_SHORT",
    "BREAKOUT_LONG", "BREAKOUT_SHORT",
    "REVERSAL_LONG", "REVERSAL_SHORT",
)
REVERSAL_STATES = ("NONE", "POTENTIAL", "DEVELOPING", "CONFIRMED", "FAILED")
RELATIONSHIPS = ("ALIGNED", "CORRECTIVE", "REVERSAL_CANDIDATE", "RANGE_INTERNAL", "BREAKOUT", "UNRESOLVED")


def sign(direction: str | None) -> int:
    d = str(direction or "")
    if d in ("BULLISH", "STRONG_BULLISH", "LONG", "UP"):
        return 1
    if d in ("BEARISH", "STRONG_BEARISH", "SHORT", "DOWN"):
        return -1
    return 0


def label(s: int) -> str:
    return "BULLISH" if s > 0 else "BEARISH" if s < 0 else "NEUTRAL"


def region_of(position: float | None, cfg: dict[str, Any] | None = None) -> str:
    if position is None:
        return "UNKNOWN"
    p = float(position)
    bounds = (cfg or CONFIG)["regions"]
    if p < 0 or p > 100:
        return "BEYOND"
    if p < bounds["lower"]:
        return "LOWER"
    if p < bounds["lowerMiddle"]:
        return "LOWER_MIDDLE"
    if p < bounds["equilibrium"]:
        return "EQUILIBRIUM"
    if p < bounds["upperMiddle"]:
        return "UPPER_MIDDLE"
    return "UPPER"


def family(trade_type: str | None) -> str:
    t = str(trade_type or "NONE")
    if t.startswith("TREND_CONTINUATION"):
        return "CONTINUATION"
    if t.startswith("COUNTER_TREND"):
        return "COUNTER_TREND"
    if t.startswith("REVERSAL"):
        return "REVERSAL"
    if t.startswith("BREAKOUT"):
        return "BREAKOUT"
    if t.startswith("RANGE_ROTATION"):
        return "RANGE_ROTATION"
    return "NONE"


def policy_for(trade_type: str | None, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    fam = family(trade_type)
    return dict(((cfg or CONFIG)["policies"]).get(fam) or {})


def advance_reversal(prev: str, evidence: dict[str, Any]) -> str:
    """Explicit reversal machine. LTF opposition alone never leaves NONE.

    NONE → POTENTIAL requires an HTF boundary failure while LTF opposes.
    POTENTIAL → DEVELOPING requires an HTF BOS or a failed retest.
    DEVELOPING → CONFIRMED requires that break to hold outside the prior channel.
    Loss of the opposing leg returns FAILED.
    """
    state = prev if prev in REVERSAL_STATES else "NONE"
    if evidence.get("correction_failed"):
        return "FAILED"
    if state == "CONFIRMED":
        return "CONFIRMED"
    boundary = bool(evidence.get("boundary_failed"))
    htf_bos = bool(evidence.get("htf_bos"))
    failed_retest = bool(evidence.get("failed_retest"))
    sustained = bool(evidence.get("sustained_outside"))
    opposes = bool(evidence.get("ltf_opposes"))
    if state in ("NONE", "FAILED"):
        if boundary and opposes:
            return "POTENTIAL"
        return "NONE" if state == "FAILED" and not opposes else state if state == "FAILED" else "NONE"
    if state == "POTENTIAL":
        if not opposes and not boundary:
            return "FAILED"
        if htf_bos or failed_retest:
            return "DEVELOPING"
        return "POTENTIAL"
    if not opposes and not boundary:
        return "FAILED"
    if sustained and htf_bos:
        return "CONFIRMED"
    return "DEVELOPING"


def target_layers(dominant: int, relationship: str) -> list[dict[str, str]]:
    """Structural destinations. Prices are resolved later from persisted channel boundaries."""
    if relationship == "CORRECTIVE" and dominant > 0:
        return [
            {"layer": "TP1", "destination": "H1_NESTED_SUPPORT", "reason": "Nearest support of the bearish nested structure"},
            {"layer": "TP2", "destination": "H8_SUPPORT", "reason": "H8 support inside the bullish D1 channel"},
            {"layer": "FINAL_STRUCTURAL_TARGET", "destination": "D1_LOWER_STRUCTURAL_ZONE",
             "reason": "D1 lower structural zone. The dominant D1 trend is not reversed."},
        ]
    if relationship == "CORRECTIVE" and dominant < 0:
        return [
            {"layer": "TP1", "destination": "H1_NESTED_RESISTANCE", "reason": "Nearest resistance of the bullish nested structure"},
            {"layer": "TP2", "destination": "H8_RESISTANCE", "reason": "H8 resistance inside the bearish D1 channel"},
            {"layer": "FINAL_STRUCTURAL_TARGET", "destination": "D1_UPPER_STRUCTURAL_ZONE",
             "reason": "D1 upper structural zone. The dominant D1 trend is not reversed."},
        ]
    if relationship == "ALIGNED" and dominant:
        side = "UPPER" if dominant > 0 else "LOWER"
        return [
            {"layer": "TP1", "destination": f"H8_{side}_BOUNDARY", "reason": f"Nearest H8 {side.lower()} boundary in the dominant direction"},
            {"layer": "TP2", "destination": f"D1_{side}_MIDDLE", "reason": "Further D1 channel progress in the dominant direction"},
            {"layer": "FINAL_STRUCTURAL_TARGET", "destination": f"D1_{side}_BOUNDARY", "reason": f"D1 {side.lower()} boundary in the dominant direction"},
        ]
    if relationship == "RANGE_INTERNAL":
        return [
            {"layer": "TP1", "destination": "RANGE_MID", "reason": "Rotation toward the range midpoint"},
            {"layer": "FINAL_STRUCTURAL_TARGET", "destination": "RANGE_OPPOSITE_BOUNDARY", "reason": "Opposite side of the active range"},
        ]
    return []


def _reversal_confidence(state: str, evidence: dict[str, Any]) -> float:
    if state == "POTENTIAL" and evidence.get("boundary_failed") and evidence.get("ltf_opposes"):
        return 25.0
    if state == "DEVELOPING" and evidence.get("boundary_failed") and (evidence.get("htf_bos") or evidence.get("failed_retest")):
        return 50.0
    if state == "CONFIRMED" and evidence.get("boundary_failed") and evidence.get("htf_bos") and evidence.get("sustained_outside"):
        return 80.0
    return 0.0


def classify(*, dominant_direction: str | None, position: float | None, d1_confirmed: bool = True,
             d1_status: str | None = None, d1_phase: str | None = None, d1_confidence: float = 0,
             h8_direction: str | None = None, h8_confirmed: bool = False, h1_bias: int = 0,
             h1_confirmed_break: bool = False, stale: bool = False, d1_boundary_failed: bool = False,
             htf_bos: bool = False, failed_retest: bool = False, sustained_outside: bool = False,
             reversal_state: str | None = None, prior_trade_type: str | None = None,
             cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Classify one instrument. `candidate` is the only flag that may ask Stage 7 to confirm a trade."""
    cfg = cfg or CONFIG
    dom = sign(dominant_direction) if d1_confirmed else 0
    h8s = sign(h8_direction) if h8_confirmed else 0
    h1 = int(h1_bias or 0)
    ltf = h1 if h1 else h8s
    reg = region_of(position, cfg)
    ev = {
        "boundary_failed": bool(d1_boundary_failed),
        "htf_bos": bool(htf_bos),
        "failed_retest": bool(failed_retest),
        "sustained_outside": bool(sustained_outside),
        "ltf_opposes": bool(dom and ltf == -dom),
        "correction_failed": False,
    }
    if reversal_state in REVERSAL_STATES:
        rev = advance_reversal(reversal_state, ev)
    elif dom and d1_boundary_failed and ltf == -dom:
        rev = advance_reversal("NONE", ev)
        if htf_bos or failed_retest:
            rev = advance_reversal(rev, ev)
        if sustained_outside and htf_bos:
            rev = advance_reversal(rev, ev)
    else:
        rev = "NONE"

    if stale or dom == 0:
        relationship = "UNRESOLVED"
    elif rev == "CONFIRMED":
        relationship = "BREAKOUT"
    elif rev in ("POTENTIAL", "DEVELOPING"):
        relationship = "REVERSAL_CANDIDATE"
    elif ltf and ltf == -dom:
        relationship = "CORRECTIVE"
    elif ltf and ltf == dom:
        relationship = "ALIGNED"
    elif d1_phase in ("CONSOLIDATION", "COMPRESSION"):
        relationship = "RANGE_INTERNAL"
    else:
        relationship = "UNRESOLVED"

    if relationship == "CORRECTIVE":
        leg = "BEARISH_CORRECTION" if dom > 0 else "BULLISH_CORRECTION"
    elif relationship == "REVERSAL_CANDIDATE":
        leg = "REVERSAL_CANDIDATE_BEARISH" if dom > 0 else "REVERSAL_CANDIDATE_BULLISH"
    elif relationship == "BREAKOUT" and rev == "CONFIRMED":
        leg = "BEARISH_IMPULSE" if dom > 0 else "BULLISH_IMPULSE"
    elif relationship == "ALIGNED":
        leg = "BULLISH_IMPULSE" if dom > 0 else "BEARISH_IMPULSE"
    elif relationship == "RANGE_INTERNAL":
        leg = "RANGE_ROTATION_UP" if ltf > 0 else "RANGE_ROTATION_DOWN" if ltf < 0 else "UNRESOLVED"
    else:
        leg = "UNRESOLVED"

    room_corrective = None if position is None or not dom else (float(position) if dom > 0 else 100.0 - float(position))
    room_continuation = None if position is None or not dom else (100.0 - float(position) if dom > 0 else float(position))
    counter_zone = (dom > 0 and reg in ("UPPER", "BEYOND")) or (dom < 0 and reg in ("LOWER", "BEYOND"))
    observe_zone = (dom > 0 and reg == "UPPER_MIDDLE") or (dom < 0 and reg == "LOWER_MIDDLE")
    continuation_zone = (dom > 0 and reg in ("LOWER", "LOWER_MIDDLE")) or (dom < 0 and reg in ("UPPER", "UPPER_MIDDLE"))
    prospective = "COUNTER_TREND_SHORT" if dom > 0 else "COUNTER_TREND_LONG" if dom < 0 else "NONE"
    prospective_entry = "SHORT" if dom > 0 else "LONG" if dom < 0 else "NONE"
    destination = None
    trade, entry = "NONE", "NONE"
    reason_code, reason = "WAIT", "Insufficient evidence to classify a tradable leg. WAIT."
    candidate = False

    if stale:
        reason_code = "STALE_STRUCTURE"
        reason = "HTF or LTF structure is stale. Stale channels cannot authorize a trade."
    elif dom == 0:
        reason_code = "NO_DOMINANT_STRUCTURE"
        reason = "No confirmed dominant HTF structure. WAIT."
    elif relationship == "REVERSAL_CANDIDATE":
        destination = "HTF_REVERSAL_CONFIRMATION"
        reason_code = "REVERSAL_NOT_CONFIRMED"
        reason = ("HTF boundary evidence is developing, but reversal is not confirmed. "
                  "The prior dominant trend stays in force and no reversal trade is published.")
    elif rev == "CONFIRMED":
        trade = "REVERSAL_SHORT" if dom > 0 else "REVERSAL_LONG"
        entry = prospective_entry
        destination = "BEYOND_BROKEN_D1_CHANNEL"
        reason_code = "HTF_REVERSAL_CONFIRMED"
        reason = ("Decisive HTF boundary failure, HTF BOS and structure sustained outside the previous channel "
                  "confirm a reversal. This is recorded as a new classification, not a silent rewrite of an open correction.")
        candidate = bool(h1_confirmed_break and h1 == -dom)
    elif relationship == "CORRECTIVE":
        destination = "D1_LOWER_STRUCTURAL_ZONE" if dom > 0 else "D1_UPPER_STRUCTURAL_ZONE"
        room_ok = room_corrective is not None and room_corrective >= float(cfg["minRoomPct"])
        if not room_ok:
            trade, entry = prospective, prospective_entry
            reason_code = "INSUFFICIENT_RETRACEMENT_ROOM"
            reason = (f"The corrective move has already reached {float(position):.0f}% of the D1 channel. "
                      f"Remaining room {float(room_corrective or 0):.0f}% is below {float(cfg['minRoomPct']):.0f}%. Do not enter late.")
        elif not counter_zone:
            if observe_zone:
                reason_code = "POTENTIAL_COUNTER_TREND_ZONE"
                reason = (f"Price at {float(position):.0f}% is approaching the outer {label(dom).lower()} channel region. "
                          "That raises LTF observation. It is not a trade.")
            else:
                reason_code = "CORRECTION_INSIDE_VALUE"
                reason = ("The lower timeframe opposes the dominant trend inside the channel, away from the outer region. "
                          "Monitor the correction. Do not classify a counter-trend trade.")
        elif h1 == -dom and h1_confirmed_break:
            trade, entry = prospective, prospective_entry
            reason_code = "COUNTER_TREND_CANDIDATE"
            reason = (f"The dominant D1 structure is {label(dom).lower()} and price is in the {reg.replace('_', ' ').lower()} region "
                      f"({float(position):.0f}%). H1 has a confirmed {label(h1).lower()} nested structure, so the immediate tradable leg "
                      f"may be {entry.lower()} toward the HTF structural destination without declaring the D1 trend reversed.")
            candidate = True
        elif h1 == -dom:
            reason_code = "AWAITING_LTF_STRUCTURE"
            reason = ("H1 leans against the dominant trend in the outer channel region, but there is no confirmed H1 BOS or CHoCH. "
                      "Location is not a trade. WAIT.")
        else:
            reason_code = "POTENTIAL_COUNTER_TREND_ZONE"
            reason = (f"Price at {float(position):.0f}% of the {label(dom).lower()} channel is a potential counter-trend zone. "
                      "H8 may already oppose, but H1 has not confirmed the corrective leg. WAIT.")
    elif relationship == "ALIGNED" and continuation_zone:
        destination = "D1_UPPER_BOUNDARY" if dom > 0 else "D1_LOWER_BOUNDARY"
        if h1 and h1 != dom:
            reason_code = "AWAITING_LTF_STRUCTURE"
            reason = "Dominant trend and location support continuation, but H1 does not agree yet. WAIT."
        elif room_continuation is not None and room_continuation < float(cfg["minRoomPct"]):
            reason_code = "INSUFFICIENT_CONTINUATION_ROOM"
            reason = "Price is too close to the continuation destination. WAIT."
        else:
            trade = "TREND_CONTINUATION_LONG" if dom > 0 else "TREND_CONTINUATION_SHORT"
            entry = "LONG" if dom > 0 else "SHORT"
            reason_code = "CONTINUATION_CANDIDATE"
            reason = f"Dominant {label(dom).lower()} structure and price in the {reg.replace('_', ' ').lower()} region, with the lower timeframe aligned."
            candidate = bool(h1 == dom or (h1 == 0 and h8s == dom))
    elif relationship == "ALIGNED" and (counter_zone or observe_zone or reg == "BEYOND"):
        destination = "D1_UPPER_BOUNDARY" if dom > 0 else "D1_LOWER_BOUNDARY"
        reason_code = "LOCATION_IS_CONTEXT"
        reason = (f"Price is in the {reg.replace('_', ' ').lower()} region of a {label(dom).lower()} channel, "
                  "but the lower timeframe still agrees with the dominant trend. A boundary touch is not a short or a long. WAIT.")
    elif relationship == "RANGE_INTERNAL" and ltf:
        trade = "RANGE_ROTATION_LONG" if ltf > 0 else "RANGE_ROTATION_SHORT"
        entry = "LONG" if ltf > 0 else "SHORT"
        destination = "RANGE_OPPOSITE_BOUNDARY"
        reason_code = "RANGE_ROTATION_CANDIDATE" if h1_confirmed_break else "AWAITING_LTF_STRUCTURE"
        reason = "No HTF impulse. Internal range rotation only, and only after a confirmed LTF break."
        candidate = bool(h1_confirmed_break)
    elif relationship == "ALIGNED":
        reason_code = "WAIT"
        reason = "Dominant and lower timeframe agree, but price is not in a continuation location. WAIT."

    if prior_trade_type and str(prior_trade_type).startswith("COUNTER_TREND") and relationship == "ALIGNED" and not stale:
        if trade.startswith("TREND_CONTINUATION") and candidate:
            reason_code = "CONTINUATION_REEVALUATED"
            reason = ("The nested correction failed and the dominant trend resumed. "
                      "The counter-trend setup is invalidated. Continuation is evaluated on its own evidence.")
        else:
            trade, entry, candidate = "NONE", "NONE", False
            reason_code = "CORRECTION_FAILED"
            reason = "The nested correction failed and the dominant trend resumed. The counter-trend setup is invalidated. WAIT for a fresh continuation location."

    continuation_conf = 0.0
    correction_conf = 0.0
    if relationship == "ALIGNED" and not stale and dom:
        continuation_conf = min(90.0, 0.6 * float(d1_confidence or 0) + (20.0 if continuation_zone else 0.0) + (10.0 if h1 == dom else 0.0))
    if relationship == "CORRECTIVE" and not stale and dom:
        if h8s == -dom:
            correction_conf += 25.0
        if counter_zone:
            correction_conf += 20.0
        elif observe_zone:
            correction_conf += 8.0
        if h1 == -dom:
            correction_conf += 15.0
        if h1_confirmed_break and h1 == -dom:
            correction_conf += 20.0
        correction_conf = min(90.0, correction_conf)

    return {
        "dominantTrend": label(dom),
        "currentLeg": leg,
        "ltfTrend": label(ltf),
        "relationship": relationship,
        "reversalState": rev,
        "region": reg,
        "channelPosition": None if position is None else round(float(position), 2),
        "tradeType": trade,
        "entryDirection": entry,
        "expectedDestination": destination,
        "candidate": bool(candidate and not stale),
        "roomPct": None if room_corrective is None else round(float(room_corrective), 1),
        "continuationRoomPct": None if room_continuation is None else round(float(room_continuation), 1),
        "roomOk": True if not str(trade).startswith("COUNTER_TREND") else bool(room_corrective is not None and room_corrective >= float(cfg["minRoomPct"])),
        "reasonCode": reason_code,
        "reason": reason,
        "confidence": {
            "continuation": round(continuation_conf, 1),
            "correction": round(correction_conf, 1),
            "reversal": round(_reversal_confidence(rev, ev), 1),
        },
        "targets": target_layers(dom, relationship if rev != "CONFIRMED" else "ALIGNED"),
        "evidence": {
            "d1Confirmed": bool(d1_confirmed),
            "d1Status": d1_status,
            "h8Confirmed": bool(h8_confirmed),
            "h1Bias": h1,
            "h1ConfirmedBreak": bool(h1_confirmed_break),
            "stale": bool(stale),
            "counterZone": bool(counter_zone),
        },
        "observation": "ELEVATED" if (counter_zone or observe_zone) and not stale else "NORMAL",
    }


def risk_decision(leg: dict[str, Any] | None, *, reward_risk: float | None, confidence: float,
                  base_min_rr: float, base_min_confidence: float, cfg: dict[str, Any] | None = None) -> dict[str, str] | None:
    """Trade-type gate. Returns a block, or None when the global gates already decide.

    Prop-firm and account limits are not applied here. They stay absolute in Stage 8.
    A type policy is used only when it is stricter than the global minimum.
    """
    if not leg:
        return None
    if leg.get("evidence", {}).get("stale") or leg.get("reasonCode") == "STALE_STRUCTURE":
        return {"state": "BLOCKED", "code": "STALE_STRUCTURE", "reason": leg.get("reason") or "Stale structure cannot authorize a trade."}
    trade = str(leg.get("tradeType") or "NONE")
    if trade.startswith("COUNTER_TREND") and leg.get("roomOk") is False:
        return {"state": "BLOCKED", "code": "INSUFFICIENT_RETRACEMENT_ROOM",
                "reason": leg.get("reason") or "Not enough room remains before the HTF destination."}
    if not leg.get("candidate") or family(trade) == "NONE":
        return None
    pol = policy_for(trade, cfg)
    type_rr = float(pol.get("minRewardRisk") or 0)
    if reward_risk is not None and type_rr > float(base_min_rr) and float(base_min_rr) <= float(reward_risk) < type_rr:
        return {"state": "BLOCKED", "code": "INSUFFICIENT_REWARD_RISK",
                "reason": f"{trade} R:R {float(reward_risk):.2f} passes the global minimum {float(base_min_rr):.1f} but not the {type_rr:.1f} {family(trade).lower().replace('_', ' ')} minimum."}
    type_conf = float(pol.get("minConfidence") or 0)
    if type_conf > float(base_min_confidence) and float(base_min_confidence) <= float(confidence) < type_conf:
        return {"state": "BLOCKED", "code": "CONFIDENCE_BELOW_TRADE_TYPE",
                "reason": f"{trade} confidence {float(confidence):.1f} passes the global minimum {float(base_min_confidence):.0f} but not the {type_conf:.0f} {family(trade).lower().replace('_', ' ')} minimum."}
    return None


def management_transition(original_trade_type: str | None, current: dict[str, Any] | None) -> dict[str, Any] | None:
    """Stage 9 decision for an open counter-trend trade.

    A failed correction is an exit. A confirmed HTF reversal is recorded and does
    not rewrite the original trade type or its risk.
    """
    original = str(original_trade_type or "NONE")
    if not original.startswith("COUNTER_TREND") or not current:
        return None
    if current.get("reasonCode") in ("CORRECTION_FAILED", "CONTINUATION_REEVALUATED") or current.get("relationship") == "ALIGNED":
        return {
            "action": "EXIT",
            "code": "CORRECTION_FAILED",
            "reason": "Nested correction failed and the dominant trend resumed. Exit the counter-trend position. Continuation is a separate decision.",
            "transition": {"from": original, "to": current.get("tradeType") or "NONE", "reversalState": "FAILED",
                           "originalTradeType": original, "originalUnchanged": True},
        }
    if current.get("reversalState") == "CONFIRMED":
        return {
            "action": "RECORD",
            "code": "REVERSAL_CONFIRMED",
            "reason": "HTF reversal is now confirmed. The market state is reclassified. The open order keeps its original trade type and risk.",
            "transition": {"from": original, "to": current.get("tradeType") or "NONE", "reversalState": "CONFIRMED",
                           "originalTradeType": original, "originalUnchanged": True},
        }
    return None
