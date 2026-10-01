"""Canonical opportunity taxonomy and confirmation contracts.

This module is the single owner of the OP-01..OP-12 matrix. Detectors supply evidence, this module decides what the
evidence means for each opportunity type. The frontend reads the matrix from /opportunity/contracts.
Nothing here places orders or changes Stage 8 limits.
"""

from __future__ import annotations

from typing import Any

FRAMEWORK_VERSION = "opf-1"
CONTRACT_VERSION = "c1"

REQUIRED, OPTIONAL, NOT_REQUIRED, INCOMPATIBLE = "REQUIRED", "OPTIONAL", "NOT_REQUIRED", "INCOMPATIBLE"
REQUIREMENTS = (REQUIRED, OPTIONAL, NOT_REQUIRED, INCOMPATIBLE)

LIFECYCLE = (
    "DISCOVERED", "WATCHING", "TRIGGER_APPROACHING", "TRIGGER_REACHED", "CONFIRMING", "READY_FOR_RISK",
    "AUTHORIZED", "REDUCED", "WAITING", "BLOCKED", "EXECUTING", "OPEN", "COMPLETED", "INVALIDATED", "EXPIRED",
)
TERMINAL = frozenset(("COMPLETED", "INVALIDATED", "EXPIRED"))

CONFIRMED = "CONFIRMED"
WAITING_FOR_REQUIRED_EVIDENCE = "WAITING_FOR_REQUIRED_EVIDENCE"
OPTIONAL_EVIDENCE_MISSING = "OPTIONAL_EVIDENCE_MISSING"
INVALIDATED = "INVALIDATED"
STALE = "STALE"
INSUFFICIENT_HISTORY = "INSUFFICIENT_HISTORY"
RESULTS = (CONFIRMED, WAITING_FOR_REQUIRED_EVIDENCE, OPTIONAL_EVIDENCE_MISSING, INVALIDATED, STALE, INSUFFICIENT_HISTORY)
CONFIRMED_RESULTS = frozenset((CONFIRMED, OPTIONAL_EVIDENCE_MISSING))

CONTEXTS = ("POST_EVENT",)

TYPES: dict[str, dict[str, Any]] = {
    "OP-01": {"code": "CHANNEL_TREND_CONTINUATION", "name": "Channel Trend Continuation", "badge": "CHANNEL CONTINUATION"},
    "OP-02": {"code": "INTERNAL_CHANNEL_CONTINUATION", "name": "Internal Channel Continuation", "badge": "INTERNAL CONTINUATION"},
    "OP-03": {"code": "TIT_CONTINUATION", "name": "TiT Continuation", "badge": "TIT CONTINUATION"},
    "OP-04": {"code": "TIT_CORRECTION", "name": "TiT Correction", "badge": "TIT CORRECTION"},
    "OP-05": {"code": "TIT_CORRECTION_END", "name": "TiT Correction End", "badge": "CORRECTION END"},
    "OP-06": {"code": "CHANNEL_BREAKOUT", "name": "Channel Breakout", "badge": "CHANNEL BREAKOUT"},
    "OP-07": {"code": "CHANNEL_BREAKOUT_RETEST", "name": "Channel Breakout & Retest", "badge": "BREAK + RETEST"},
    "OP-08": {"code": "STRUCTURAL_BREAKOUT_CONTINUATION", "name": "Structural Breakout Continuation", "badge": "STRUCTURE BREAK"},
    "OP-09": {"code": "FAILED_BREAKOUT_REENTRY", "name": "Failed Breakout Re-entry", "badge": "FAILED BREAK"},
    "OP-10": {"code": "TREND_REVERSAL", "name": "Trend Reversal", "badge": "REVERSAL"},
    "OP-11": {"code": "RANGE_BOUNDARY_REACTION", "name": "Range Boundary Reaction", "badge": "RANGE REACTION"},
    "OP-12": {"code": "RANGE_BREAKOUT_RETEST", "name": "Range Breakout & Retest", "badge": "RANGE BREAK + RETEST"},
}
BY_CODE = {meta["code"]: op for op, meta in TYPES.items()}

# Evidence vocabulary. `stage` says which stage owns the check: 7 = confirmation contract, 8 = Stage 8 (reported, not
# evaluated by the contract), "gate" = cross-cutting new-entry gate that blocks the lifecycle instead of the contract.
EVIDENCE: dict[str, dict[str, Any]] = {
    "CHANNEL_VALID": {"label": "Valid channel", "stage": 7},
    "DIRECTION_ALIGNED": {"label": "Channel direction aligned with trade", "stage": 7},
    "BOUNDARY_ZONE_REACHED": {"label": "Trend-supporting boundary zone reached", "stage": 7},
    "BOUNDARY_HOLDING": {"label": "Boundary has not decisively failed", "stage": 7},
    "REACTION": {"label": "Directional reaction confirmed", "stage": 7},
    "REACTION_STRONG": {"label": "Strong directional reaction", "stage": 7},
    "INTERNAL_CONFLUENCE": {"label": "Internal support/resistance confluence", "stage": 7},
    "ENTRY_QUALITY": {"label": "Entry quality GOOD", "stage": 7},
    "ROOM": {"label": "Room to target meets minimum R:R", "stage": 7},
    "ROOM_STAGE8": {"label": "Room / R:R (Stage 8)", "stage": 8},
    "FRESH_DATA": {"label": "Fresh closed-bar data", "stage": 7},
    "ECON_PERMITS": {"label": "Economic policy permits new entry", "stage": "gate"},
    "BOS": {"label": "BOS in trade direction", "stage": 7},
    "CHOCH": {"label": "CHoCH in trade direction", "stage": 7},
    "CHANNEL_BREAK": {"label": "Channel break", "stage": 7},
    "BREAK_CONFIRMED": {"label": "Break confirmed on closed candles", "stage": 7},
    "RETEST": {"label": "Retest zone revisited", "stage": 7},
    "RETEST_HOLD": {"label": "Broken boundary held on retest", "stage": 7},
    "FAILURE_EVIDENCE": {"label": "Failed-break evidence", "stage": 7},
    "PARENT_CHILD_ALIGNMENT": {"label": "Parent and child aligned", "stage": 7},
    "PARENT_VALID": {"label": "Parent trend valid", "stage": 7},
    "CORRECTIVE_STRUCTURE": {"label": "Corrective child structure", "stage": 7},
    "COUNTER_PARENT_FLAG": {"label": "Counter-parent trade flagged", "stage": 7},
    "CORRECTION_END": {"label": "Correction-end evidence", "stage": 7},
    "CHILD_CHANNEL_FAILURE": {"label": "Child channel failure/break", "stage": 7},
    "EXECUTION_CONFIRMATION": {"label": "Execution-timeframe confirmation", "stage": 7},
    "STRUCTURAL_BREAK": {"label": "Confirmed structural break (BOS)", "stage": 7},
    "BREAK_QUALITY": {"label": "Break quality acceptable", "stage": 7},
    "PRIOR_BREAK_ATTEMPT": {"label": "Prior breakout attempt", "stage": 7},
    "REENTRY": {"label": "Price re-entered the structure", "stage": 7},
    "TREND_DETERIORATION": {"label": "Trend deterioration", "stage": 7},
    "OPPOSITE_BOS": {"label": "Opposite-direction BOS", "stage": 7},
    "REVERSAL_CONFIRMATION": {"label": "Reversal confirmation", "stage": 7},
    "RANGE_VALID": {"label": "Confirmed range", "stage": 7},
    "RANGE_BREAK": {"label": "Range boundary break", "stage": 7},
    "REJECTION_WICK": {"label": "Rejection wick", "stage": 7},
    "MOMENTUM_RECOVERY": {"label": "Momentum recovery", "stage": 7},
    "HIGHER_LOW": {"label": "Higher low / lower high", "stage": 7},
    "ERZ_CONFLUENCE": {"label": "ERZ overlaps boundary zone", "stage": 7},
    "STRENGTH_ALIGNED": {"label": "Stage 3 pair bias aligned", "stage": 7},
    "STAGE6_SUPPORT": {"label": "Stage 6 structure supports", "stage": 7},
    "BOS_OR_CHOCH": {"label": "BOS or CHoCH on the execution timeframe", "stage": 7},
}

_R, _O, _N, _X = REQUIRED, OPTIONAL, NOT_REQUIRED, INCOMPATIBLE
_SUPPORT = {"REJECTION_WICK": _O, "MOMENTUM_RECOVERY": _O, "HIGHER_LOW": _O, "ERZ_CONFLUENCE": _O, "STRENGTH_ALIGNED": _O, "STAGE6_SUPPORT": _O}

# Section 102 matrix. `headline` is what the UI prints for BOS / CHoCH / break / retest / reaction.
CONTRACTS: dict[str, dict[str, Any]] = {
    "OP-01": {
        "evidence": {"CHANNEL_VALID": _R, "DIRECTION_ALIGNED": _R, "BOUNDARY_ZONE_REACHED": _R, "BOUNDARY_HOLDING": _R, "REACTION": _R,
                     "ROOM": _R, "FRESH_DATA": _R, "ECON_PERMITS": _R, "BOS": _N, "CHOCH": _N, "CHANNEL_BREAK": _N, "RETEST": _N, **_SUPPORT},
        "headline": {"reaction": _R, "bos": _N, "choch": _N, "channelBreak": _N, "retest": _N},
        "confirmationTimeframe": "Execution TF of the parent channel: D1→H1, H8→H1, H1→M15",
        "invalidation": ["Close beyond the trend-supporting boundary by the channel break tolerance", "Parent channel INVALIDATED or BROKEN",
                         "Reaction fails with a new extreme beyond the touch extreme"],
        "expiry": "Confirmed reaction expires after reactionExpiryBars execution bars; an unresolved touch after pendingExpiryBars",
        "p1": "Boundary-reaction entry", "p2": "Not applicable unless a distinct validated continuation trigger exists (none implemented)",
        "notes": {"BOS": "Recorded as supporting evidence when present; never a gate for OP-01.",
                  "CHOCH": "Recorded as supporting evidence when present; never a gate for OP-01."},
    },
    "OP-02": {
        "evidence": {"CHANNEL_VALID": _R, "DIRECTION_ALIGNED": _R, "INTERNAL_CONFLUENCE": _R, "REACTION_STRONG": _R, "ROOM": _R,
                     "ENTRY_QUALITY": _R, "FRESH_DATA": _R, "ECON_PERMITS": _R, "BOS": _O, "CHOCH": _O, "CHANNEL_BREAK": _N, "RETEST": _N,
                     **_SUPPORT},
        "headline": {"reaction": "REQUIRED_STRONG", "bos": _O, "choch": _O, "channelBreak": _N, "retest": _N},
        "confirmationTimeframe": "Execution TF of the parent channel: D1→H1, H8→H1, H1→M15",
        "invalidation": ["Close through the internal support/resistance by the break tolerance", "Parent channel INVALIDATED or BROKEN"],
        "expiry": "Same bar expiry as OP-01",
        "p1": "Internal-reaction entry", "p2": "Not applicable",
        "notes": {"INTERNAL_CONFLUENCE": "Midline zone after a prior visit to the outer region, plus at least one independent confluence item."},
    },
    "OP-03": {
        "evidence": {"PARENT_CHILD_ALIGNMENT": _R, "EXECUTION_CONFIRMATION": _R, "FRESH_DATA": _R, "ECON_PERMITS": _R, "ROOM_STAGE8": _R,
                     "BOS": _O, "CHOCH": _O, **_SUPPORT},
        "headline": {"reaction": _R, "bos": "OPTIONAL/VARIANT", "choch": _O, "channelBreak": _N, "retest": _N},
        "confirmationTimeframe": "TiT level execution TF (L1/L2 H1, L3 M15, L4 M5)",
        "invalidation": ["Parent or child channel no longer valid", "Existing ERZ invalidation level"],
        "expiry": "Existing Stage 8 setup lifetime",
        "p1": "ERZ reaction (existing TiT P1)", "p2": "Child break confirmation (existing TiT P2)",
        "notes": {"EXECUTION_CONFIRMATION": "Supplied by the existing Stage 7 confirmation engine; its own BOS/CHoCH gate is the preserved variant rule."},
    },
    "OP-04": {
        "evidence": {"PARENT_VALID": _R, "CORRECTIVE_STRUCTURE": _R, "COUNTER_PARENT_FLAG": _R, "EXECUTION_CONFIRMATION": _R,
                     "FRESH_DATA": _R, "ECON_PERMITS": _R, "ROOM_STAGE8": _R, "BOS": _O, "CHOCH": _O, **_SUPPORT},
        "headline": {"reaction": _R, "bos": "EXISTING_VARIANT_RULES", "choch": "EXISTING_VARIANT_RULES", "channelBreak": _N, "retest": _N},
        "confirmationTimeframe": "TiT level execution TF",
        "invalidation": ["Child correction fails", "Parent invalidation"],
        "expiry": "Existing Stage 8 setup lifetime",
        "p1": "Existing TiT P1", "p2": "Existing TiT P2",
        "notes": {"COUNTER_PARENT_FLAG": "Correction trades are always flagged COUNTER_PARENT_TREND; they are never reinterpreted as reversals."},
    },
    "OP-05": {
        "evidence": {"PARENT_VALID": _R, "CORRECTION_END": _R, "CHILD_CHANNEL_FAILURE": _R, "EXECUTION_CONFIRMATION": _R, "FRESH_DATA": _R,
                     "ECON_PERMITS": _R, "ROOM_STAGE8": _R, "BOS": _O, "CHOCH": _O, "RETEST": _O, **_SUPPORT},
        "headline": {"reaction": _R, "bos": _O, "choch": _O, "channelBreak": "REQUIRED/VARIANT", "retest": _O},
        "confirmationTimeframe": "TiT level execution TF",
        "invalidation": ["Child correction resumes strongly", "Parent invalidated"],
        "expiry": "Existing Stage 8 setup lifetime",
        "p1": "Existing TiT P1", "p2": "Child-break continuation (existing TiT P2)",
        "notes": {"CHILD_CHANNEL_FAILURE": "Child channel BROKEN/TRANSITION or a closed-candle child break in the parent direction."},
    },
    "OP-06": {
        "evidence": {"CHANNEL_VALID": _R, "CHANNEL_BREAK": _R, "BREAK_CONFIRMED": _R, "FAILURE_EVIDENCE": _X, "FRESH_DATA": _R,
                     "ECON_PERMITS": _R, "ROOM_STAGE8": _R, "BOS": _O, "CHOCH": _O, "RETEST": _N},
        "headline": {"reaction": _N, "bos": _O, "choch": _O, "channelBreak": _R, "retest": _N},
        "confirmationTimeframe": "Breakout scanner confirmation TF",
        "invalidation": ["Break fails and price re-enters the channel"],
        "expiry": "Breakout scanner lifetime",
        "p1": "Not applicable", "p2": "Confirmed break continuation",
        "notes": {"CHANNEL_BREAK": "A channel break is not a BOS; the two are separate facts."},
    },
    "OP-07": {
        "evidence": {"CHANNEL_BREAK": _R, "BREAK_CONFIRMED": _R, "RETEST": _R, "RETEST_HOLD": _R, "FAILURE_EVIDENCE": _X, "FRESH_DATA": _R,
                     "ECON_PERMITS": _R, "ROOM_STAGE8": _R, "BOS": _O, "CHOCH": _O},
        "headline": {"reaction": _R, "bos": _O, "choch": _O, "channelBreak": _R, "retest": _R},
        "confirmationTimeframe": "Breakout scanner confirmation TF",
        "invalidation": ["Retest fails (close back inside the channel)"],
        "expiry": "Breakout scanner lifetime",
        "p1": "Retest reaction", "p2": "Continuation after break and retest",
        "notes": {},
    },
    "OP-08": {
        "evidence": {"STRUCTURAL_BREAK": _R, "BREAK_QUALITY": _R, "ROOM": _R, "FRESH_DATA": _R, "ECON_PERMITS": _R, "CHANNEL_BREAK": _N,
                     "CHOCH": _O, "RETEST": _O, "STAGE6_SUPPORT": _O, "STRENGTH_ALIGNED": _O},
        "headline": {"reaction": _N, "bos": _R, "choch": "CONTEXT_DEPENDENT", "channelBreak": _N, "retest": _O},
        "confirmationTimeframe": "H1 structure",
        "invalidation": ["Close back through the broken swing level", "Structure flips (opposite BOS)"],
        "expiry": "structureExpiryBars H1 bars after the BOS",
        "p1": "Not applicable", "p2": "Breakout continuation (primary leg)",
        "notes": {"STRUCTURAL_BREAK": "Closed-bar BOS through a confirmed fractal swing; independent of any channel break."},
    },
    "OP-09": {
        "evidence": {"PRIOR_BREAK_ATTEMPT": _R, "FAILURE_EVIDENCE": _R, "REENTRY": _R, "REACTION": _R, "ROOM": _R, "FRESH_DATA": _R,
                     "ECON_PERMITS": _R, "BOS": _O, "CHOCH": _O},
        "headline": {"reaction": _R, "bos": _O, "choch": _O, "channelBreak": "PRIOR_ATTEMPT_REQUIRED", "retest": _N},
        "confirmationTimeframe": "Breakout scanner confirmation TF",
        "invalidation": ["Price breaks out again beyond the failed boundary"],
        "expiry": "reactionExpiryBars execution bars",
        "p1": "Re-entry reaction", "p2": "Not applicable",
        "notes": {},
    },
    "OP-10": {
        "evidence": {"TREND_DETERIORATION": _R, "CHOCH": _R, "OPPOSITE_BOS": _R, "REVERSAL_CONFIRMATION": _R, "ROOM": _R, "FRESH_DATA": _R,
                     "ECON_PERMITS": _R, "STAGE6_SUPPORT": _O, "STRENGTH_ALIGNED": _O},
        "headline": {"reaction": _R, "bos": _R, "choch": _R, "channelBreak": _O, "retest": _O},
        "confirmationTimeframe": "H8 structure with H1 execution",
        "invalidation": ["Old trend reasserts with a BOS in the original direction"],
        "expiry": "structureExpiryBars after the opposite BOS",
        "p1": "Not applicable", "p2": "Reversal continuation",
        "notes": {"CHOCH": "Required by default — a single countertrend candle never qualifies.",
                  "OPPOSITE_BOS": "Required by default."},
    },
    "OP-11": {
        "evidence": {"RANGE_VALID": _R, "BOUNDARY_ZONE_REACHED": _R, "BOUNDARY_HOLDING": _R, "REACTION": _R, "ROOM": _R, "FRESH_DATA": _R,
                     "ECON_PERMITS": _R, "BOS": _N, "CHOCH": _N, "RANGE_BREAK": _X, "REJECTION_WICK": _O, "MOMENTUM_RECOVERY": _O, "HIGHER_LOW": _O},
        "headline": {"reaction": _R, "bos": _N, "choch": _N, "channelBreak": _X, "retest": _N},
        "confirmationTimeframe": "Execution TF of the range channel",
        "invalidation": ["Confirmed range breakout"],
        "expiry": "Same bar expiry as OP-01",
        "p1": "Boundary-reaction entry", "p2": "Not applicable",
        "notes": {"RANGE_BREAK": "A confirmed range breakout invalidates the boundary-reaction path."},
    },
    "OP-12": {
        "evidence": {"RANGE_VALID": _R, "RANGE_BREAK": _R, "BREAK_CONFIRMED": _R, "RETEST": _R, "RETEST_HOLD": _R, "FRESH_DATA": _R,
                     "ECON_PERMITS": _R, "ROOM_STAGE8": _R, "BOS": _O},
        "headline": {"reaction": _R, "bos": "OPTIONAL/SUPPORTING", "choch": _N, "channelBreak": _R, "retest": _R},
        "confirmationTimeframe": "Breakout scanner confirmation TF",
        "invalidation": ["Retest fails (close back inside the range)"],
        "expiry": "Breakout scanner lifetime",
        "p1": "Retest reaction", "p2": "Continuation after range break and retest",
        "notes": {},
    },
}

# Configured variants. The existing NORMAL_TREND_CONTINUATION production route is the OP-01 variant whose Stage 7 H1
# engine requires BOS or CHoCH; it is preserved exactly. The new boundary-reaction route uses the base OP-01 contract.
VARIANTS: dict[str, dict[str, Any]] = {
    "OP-01:LEGACY_H1": {
        "evidence": {"CHANNEL_VALID": _R, "DIRECTION_ALIGNED": _R, "EXECUTION_CONFIRMATION": _R, "BOS_OR_CHOCH": _R, "FRESH_DATA": _R,
                     "ECON_PERMITS": _R, "ROOM_STAGE8": _R},
        "headline": {"reaction": _R, "bos": "REQUIRED (variant: BOS or CHoCH)", "choch": "REQUIRED (variant: BOS or CHoCH)",
                     "channelBreak": _N, "retest": _N},
        "notes": {"BOS_OR_CHOCH": "Existing Stage 7 H1 rule for the Stage 6 READY_FOR_H1 route. Unchanged."},
    },
}

# P1 / P2 applicability. Legs are never invented to fill a schema.
LEGS: dict[str, dict[str, bool]] = {
    "OP-01": {"p1": True, "p2": False}, "OP-02": {"p1": True, "p2": False}, "OP-03": {"p1": True, "p2": True},
    "OP-04": {"p1": True, "p2": True}, "OP-05": {"p1": True, "p2": True}, "OP-06": {"p1": False, "p2": True},
    "OP-07": {"p1": True, "p2": True}, "OP-08": {"p1": False, "p2": True}, "OP-09": {"p1": True, "p2": False},
    "OP-10": {"p1": False, "p2": True}, "OP-11": {"p1": True, "p2": False}, "OP-12": {"p1": True, "p2": True},
}

# Advisory only. Regime never hides or blocks a hypothesis; the UI shows the label.
REGIMES = ("TRENDING", "RANGING", "TRANSITIONAL", "EVENT_DISTORTED", "UNDEFINED")
_TREND = ("OP-01", "OP-02", "OP-03", "OP-04", "OP-05", "OP-06", "OP-07", "OP-08", "OP-09", "OP-10")
COMPATIBILITY: dict[str, dict[str, str]] = {
    "TRENDING": {**{op: "COMPATIBLE" for op in _TREND}, "OP-11": "INCOMPATIBLE", "OP-12": "CAUTION"},
    "RANGING": {**{op: "CAUTION" for op in _TREND}, "OP-09": "COMPATIBLE", "OP-11": "COMPATIBLE", "OP-12": "COMPATIBLE",
                "OP-01": "INCOMPATIBLE", "OP-02": "INCOMPATIBLE"},
    "TRANSITIONAL": {**{op: "CAUTION" for op in TYPES}, **{op: "COMPATIBLE" for op in ("OP-05", "OP-06", "OP-07", "OP-09", "OP-10", "OP-12")}},
    "EVENT_DISTORTED": {op: "CAUTION" for op in TYPES},
    "UNDEFINED": {op: "CAUTION" for op in TYPES},
}

# Route → mode. SHADOW routes detect, confirm, persist and audit, but never reach `qualified` (Stage 8 / Stage 9).
# PRODUCTION routes are the existing, already-validated paths; they keep their existing permissions.
ROUTES: dict[str, dict[str, str]] = {
    "OP-01:BOUNDARY_REACTION": {"mode": "SHADOW", "source": "boundary_reaction (new)"},
    "OP-01:LEGACY_H1": {"mode": "PRODUCTION", "source": "Stage 6 READY_FOR_H1 → Stage 7 H1 (existing; its BOS/CHoCH gate is unchanged)"},
    "OP-02:INTERNAL_REACTION": {"mode": "SHADOW", "source": "boundary_reaction midline profile (new)"},
    "OP-03:TIT": {"mode": "PRODUCTION", "source": "opportunity.classify_levels (existing)"},
    "OP-04:TIT": {"mode": "PRODUCTION", "source": "opportunity.classify_levels (existing)"},
    "OP-05:TIT": {"mode": "PRODUCTION", "source": "opportunity.classify_levels (existing)"},
    "OP-06:BREAKOUT_SCANNER": {"mode": "OBSERVE", "source": "channel_breakout.SCANNER (existing); capital path is the TiT P2 leg"},
    "OP-07:BREAKOUT_SCANNER": {"mode": "OBSERVE", "source": "channel_breakout.SCANNER (existing); capital path is the TiT P2 leg"},
    "OP-08:STRUCTURE": {"mode": "SHADOW", "source": "channel_analysis.structure_events on H1 (new route)"},
    "OP-09:BREAKOUT_SCANNER": {"mode": "SHADOW", "source": "channel_breakout FAILED_BREAKOUT + re-entry reaction (new route)"},
    "OP-10:REVERSAL": {"mode": "SHADOW", "source": "leg_model + H8 structure events (new route)"},
    "OP-11:RANGE_REACTION": {"mode": "SHADOW", "source": "boundary_reaction on RANGE channels (new route)"},
    "OP-12:BREAKOUT_SCANNER": {"mode": "SHADOW", "source": "channel_breakout on RANGE channels (new route)"},
}

# New quality weights start neutral: they are reported, never added to confidence, until historically validated.
SCORE_WEIGHTS: dict[str, float] = {
    "structure": 0.0, "channel": 0.0, "reaction": 0.0, "location": 0.0, "strength": 0.0, "regime": 0.0, "room": 0.0, "execution": 0.0,
}

LEGACY_FAMILY = {
    "NORMAL_TREND_CONTINUATION": "OP-01", "TIT_CONTINUATION": "OP-03", "TIT_CORRECTION": "OP-04", "TIT_CORRECTION_END": "OP-05",
    "REVERSAL_CANDIDATE": "OP-10",
}
LEGACY_SETUP = {
    "TREND_CONTINUATION": "OP-01", "BREAKOUT_RETEST": "OP-07", "BREAKOUT": "OP-06", "REVERSAL": "OP-10", "COUNTER_TREND_CORRECTION": "OP-04",
}


def label(op: str | None) -> str:
    meta = TYPES.get(str(op or ""))
    return f"{op} {meta['name']}" if meta else "UNCLASSIFIED"


def legacy_type(family: str | None = None, setup: str | None = None) -> str | None:
    """Mapping for labels written before the framework existed. Historical rows are read through this, never rewritten."""
    if family and str(family) in LEGACY_FAMILY:
        return LEGACY_FAMILY[str(family)]
    if family and str(family) in BY_CODE:
        return BY_CODE[str(family)]
    if setup and str(setup) in LEGACY_SETUP:
        return LEGACY_SETUP[str(setup)]
    return None


def compatibility(op: str, regime: str | None) -> str:
    return COMPATIBILITY.get(str(regime or "UNDEFINED"), COMPATIBILITY["UNDEFINED"]).get(op, "CAUTION")


def contract(op: str) -> dict[str, Any]:
    c = CONTRACTS[op]
    return {
        "contractId": f"{op}@{CONTRACT_VERSION}", "opportunityType": op, **TYPES[op],
        "requiredEvidence": [k for k, v in c["evidence"].items() if v == REQUIRED],
        "optionalEvidence": [k for k, v in c["evidence"].items() if v == OPTIONAL],
        "notRequired": [k for k, v in c["evidence"].items() if v == NOT_REQUIRED],
        "incompatible": [k for k, v in c["evidence"].items() if v == INCOMPATIBLE],
        "headline": c["headline"], "confirmationTimeframe": c["confirmationTimeframe"], "invalidation": c["invalidation"],
        "expiry": c["expiry"], "legs": {**LEGS[op], "p1Meaning": c["p1"], "p2Meaning": c["p2"]}, "notes": c.get("notes") or {},
        "evidenceStage": {k: EVIDENCE[k]["stage"] for k in c["evidence"]},
    }


def matrix() -> dict[str, Any]:
    return {
        "frameworkVersion": FRAMEWORK_VERSION, "contractVersion": CONTRACT_VERSION, "requirements": list(REQUIREMENTS),
        "results": list(RESULTS), "lifecycle": list(LIFECYCLE), "contexts": list(CONTEXTS),
        "evidence": {k: {"label": v["label"], "stage": v["stage"]} for k, v in EVIDENCE.items()},
        "contracts": [contract(op) for op in TYPES], "routes": ROUTES, "compatibility": COMPATIBILITY, "scoreWeights": SCORE_WEIGHTS,
        "variants": {key: {"evidence": v["evidence"], "headline": v["headline"], "notes": v.get("notes") or {}} for key, v in VARIANTS.items()},
        "legs": LEGS,
    }


def _spec(op: str, variant: str | None) -> dict[str, Any]:
    if variant and f"{op}:{variant}" in VARIANTS:
        return VARIANTS[f"{op}:{variant}"]
    return CONTRACTS[op]


def evaluate(op: str, evidence: dict[str, bool | None], *, stale: bool = False, insufficient: bool = False,
             invalidated: str | None = None, variant: str | None = None) -> dict[str, Any]:
    """Apply one contract to detector evidence.

    evidence values: True present, False absent, None not measurable. Only stage-7 REQUIRED items decide CONFIRMED.
    Stage-8 items and the economic gate are reported, never evaluated here.
    """
    chosen = _spec(op, variant)
    spec = chosen["evidence"]
    required, satisfied, missing, unknown = [], [], [], []
    optional, not_required, conflicts = [], [], []
    for key, req in spec.items():
        stage = EVIDENCE[key]["stage"]
        value = evidence.get(key)
        if req == REQUIRED and stage == 7:
            required.append(key)
            if value is True:
                satisfied.append(key)
            elif value is None:
                unknown.append(key)
                missing.append(key)
            else:
                missing.append(key)
        elif req == OPTIONAL:
            optional.append({"evidence": key, "present": value is True, "measured": value is not None})
        elif req == NOT_REQUIRED:
            not_required.append({"evidence": key, "present": value is True})
        elif req == INCOMPATIBLE and value is True:
            conflicts.append(key)
    deferred = [k for k, req in spec.items() if req == REQUIRED and EVIDENCE[k]["stage"] != 7]
    if insufficient:
        result = INSUFFICIENT_HISTORY
    elif stale:
        result = STALE
    elif invalidated or conflicts:
        result = INVALIDATED
    elif missing:
        result = WAITING_FOR_REQUIRED_EVIDENCE
    elif optional and not any(o["present"] for o in optional):
        result = OPTIONAL_EVIDENCE_MISSING
    else:
        result = CONFIRMED
    return {
        "contractId": f"{op}{':' + variant if variant and f'{op}:{variant}' in VARIANTS else ''}@{CONTRACT_VERSION}",
        "result": result, "confirmed": result in CONFIRMED_RESULTS,
        "requiredEvidence": required, "satisfiedEvidence": satisfied, "missingEvidence": missing, "unmeasured": unknown,
        "optionalEvidence": optional, "notRequired": not_required, "incompatiblePresent": conflicts, "deferredEvidence": deferred,
        "invalidationReason": invalidated or (f"{', '.join(conflicts)} present (incompatible)" if conflicts else None),
        "headline": chosen["headline"],
    }
