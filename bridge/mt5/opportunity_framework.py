"""Opportunity classification and confirmation framework.

Light scan of all instruments → escalation of interesting channels → opportunity-specific detectors → the central
confirmation contract (opportunity_types) → lifecycle, stage reports and relationships.

Existing logic is consumed, not replaced: TiT hypotheses come from opportunity.scan, breakout states from the
Breakout & Retest scanner, channel geometry from Channel Analysis, Stage 6 from direction_store, the economic gate from
economic_store. New routes (see opportunity_types.ROUTES) run in SHADOW: they never enter `qualified`, so they can not
reach Stage 8 authorization or Stage 9 execution.
"""

from __future__ import annotations

import hashlib
import json
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable

try:
    import boundary_reaction as br
    import channel_analysis as ca
    import confirm
    import opportunity
    import opportunity_types as ot
    import vision
except ImportError:  # pragma: no cover
    from bridge.mt5 import boundary_reaction as br  # type: ignore
    from bridge.mt5 import channel_analysis as ca  # type: ignore
    from bridge.mt5 import confirm  # type: ignore
    from bridge.mt5 import opportunity  # type: ignore
    from bridge.mt5 import opportunity_types as ot  # type: ignore
    from bridge.mt5 import vision  # type: ignore

PARENT_TFS = ("D1", "H8", "H1")
EXECUTION = {"D1": "H1", "H8": "H1", "H1": "M15"}
TF_SEC = {"D1": 86400, "H8": 28800, "H1": 3600, "M15": 900, "M5": 300}
CHANNEL_OK = frozenset(("VALIDATED", "ACTIVE", "WEAKENING"))
ECON_RESTRICTED = frozenset(("PRE_EVENT_RESTRICTED", "EVENT_LOCK", "RELEASE_PROCESSING", "POST_EVENT_VOLATILITY", "STRUCTURE_REVALIDATION"))
POST_EVENT_STATES = frozenset(("RELEASE_PROCESSING", "POST_EVENT_VOLATILITY", "STRUCTURE_REVALIDATION"))

CONFIG: dict[str, Any] = {
    "enabled": True,
    "execBars": 300,
    "boundaryBandPct": 40.0,        # light scan: trade-relative channel position that escalates OP-01
    "internalBandPct": (40.0, 65.0),  # light scan: OP-02 escalation band
    "rangeBandPct": 40.0,           # light scan: OP-11 distance from either range boundary
    "structureExpiryBars": 24,      # OP-08 / OP-10 trigger age, structure-timeframe bars
    "bosQualityAtr": 0.15,          # OP-08 close beyond the swing level, execution ATR
    "failedBreakBars": 5,           # OP-09 failed break must be this recent, parent bars
    "reversalChochBars": 30,        # OP-10 CHoCH must be this recent, H8 bars
    "campaignBudgetPct": opportunity.CONFIG["campaignBudgetPct"],
}

LIFECYCLE_STAGE = {
    "DISCOVERED": 4, "WATCHING": 5, "TRIGGER_APPROACHING": 5, "TRIGGER_REACHED": 5, "CONFIRMING": 7, "READY_FOR_RISK": 8,
    "AUTHORIZED": 9, "REDUCED": 9, "WAITING": 7, "BLOCKED": 8, "EXECUTING": 9, "OPEN": 9, "COMPLETED": 10, "INVALIDATED": 10, "EXPIRED": 10,
}
MATURITY = {"OPEN": 10, "EXECUTING": 9, "AUTHORIZED": 8, "REDUCED": 8, "READY_FOR_RISK": 7, "BLOCKED": 6, "WAITING": 6, "CONFIRMING": 5,
            "TRIGGER_REACHED": 4, "TRIGGER_APPROACHING": 3, "WATCHING": 2, "DISCOVERED": 1}

# Written by risk_service after each Stage 8 run. SHADOW_STAGE8 is a pre-qualification per opportunityId, never an
# authorization; STAGE8_STATE is the production Stage 8 state per campaignId (campaign legs) or symbol (Stage 7 H1).
SHADOW_STAGE8: dict[str, dict[str, Any]] = {}
STAGE8_STATE: dict[str, dict[str, Any]] = {}


def _hid(*parts: Any) -> str:
    return hashlib.sha1("|".join("" if p is None else str(p) for p in parts).encode()).hexdigest()[:16]


def _sign(direction: Any) -> int:
    return opportunity._sign(direction)


def _label(sign: int) -> str:
    return "BULLISH" if sign > 0 else "BEARISH" if sign < 0 else "UNKNOWN"


def _iso(ts: float | None) -> str | None:
    return None if ts is None else datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()


def _trade_pos(position: Any, sign: int) -> float | None:
    if position is None:
        return None
    p = float(position)
    return p if sign > 0 else 100.0 - p


def _fresh(last_ts: Any, tf: str, now: float, bars: int = 2) -> bool:
    if not last_ts:
        return False
    sec = TF_SEC.get(tf, 3600)
    return now - (float(last_ts) + sec) <= bars * sec


class Context:
    """Per-instrument inputs gathered once per run."""

    def __init__(self, symbol: str, channels: dict[str, dict[str, Any]], snaps: dict[str, dict[str, Any]], *, direction: dict[str, Any] | None,
                 rank: int | None, econ: dict[str, Any] | None, bias: Any, now: float, missed: bool) -> None:
        self.symbol, self.channels, self.snaps = symbol, channels, snaps
        self.direction, self.rank, self.econ, self.bias, self.now, self.missed = direction or {}, rank, econ, bias, now, missed

    def channel(self, tf: str) -> dict[str, Any]:
        return {**(self.snaps.get(tf) or {}), **{k: v for k, v in (self.channels.get(tf) or {}).items() if v is not None}}

    def econ_state(self) -> tuple[str, bool, str | None]:
        if self.econ is None:
            return "UNKNOWN", True, "Economic risk state cannot be determined — new entries fail closed"
        state = str(self.econ.get("state") or "NORMAL")
        return state, bool(self.econ.get("blocks")) or state in ECON_RESTRICTED, self.econ.get("reason")

    def strength(self, sign: int) -> str:
        b = _sign(self.bias) if isinstance(self.bias, str) else (1 if (self.bias or 0) > 0 else -1 if (self.bias or 0) < 0 else 0)
        if b == 0 or sign == 0:
            return "NEUTRAL"
        return "SUPPORTS" if b == sign else "OPPOSES"

    def stage6(self, op: str, sign: int) -> str:
        row = self.direction
        if not row:
            return "NEUTRAL"
        d = _sign(row.get("expectedDirection") or row.get("direction"))
        if d == 0:
            return "NEUTRAL"
        if op == "OP-04":
            counter = str(row.get("tradeType") or "").startswith("COUNTER_TREND")
            return "SUPPORTS" if counter and d == sign else "NEUTRAL"
        return "SUPPORTS" if d == sign else "CONFLICT"


class LiveSource:
    """Database reads for the live service. Parent timestamps are cached per channel definition."""

    def __init__(self) -> None:
        self._ts: dict[tuple, list[int]] = {}

    def snapshots(self, symbols: list[str]) -> dict[str, dict[str, dict[str, Any]]]:
        try:
            from db import connect
        except ImportError:  # pragma: no cover
            from bridge.mt5.db import connect  # type: ignore
        out: dict[str, dict[str, dict[str, Any]]] = {}
        with connect() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT symbol, timeframe, channel_id, status, direction, phase, confidence, position, upper_now, mid_now, lower_now, "
                "data_status, last_bar_ts, json_extract(snapshot_json, '$.definition'), json_extract(snapshot_json, '$.evidence.atr'), "
                "json_extract(snapshot_json, '$.evidence.structure'), json_extract(snapshot_json, '$.breakout'), "
                "json_extract(snapshot_json, '$.evidence.events') FROM dbo.app_channel_state WHERE timeframe IN ('D1','H8','H1')"
            )
            rows = cur.fetchall()
        wanted = set(symbols)
        for r in rows:
            if r[0] not in wanted:
                continue
            load = lambda raw, default: (json.loads(raw) if isinstance(raw, str) else raw) if raw else default  # noqa: E731
            out.setdefault(r[0], {})[r[1]] = {
                "timeframe": r[1], "channelId": r[2], "status": r[3], "direction": r[4], "phase": r[5], "confidence": r[6], "position": r[7],
                "upper": r[8], "mid": r[9], "lower": r[10], "dataStatus": r[11], "lastBarTs": r[12], "definition": load(r[13], None),
                "atr": None if r[14] is None else float(r[14]), "structure": load(r[15], []), "breakout": load(r[16], None),
                "events": load(r[17], []),
            }
        return out

    def bars(self, symbol: str, tf: str, n: int) -> list[tuple]:
        import history_store as hs
        return hs.candle_tail(symbol, tf, n)

    def parent_ts(self, symbol: str, tf: str, from_ts: int, last_ts: Any = None) -> list[int]:
        key = (symbol, tf, int(from_ts), last_ts)
        if key not in self._ts:
            import history_store as hs
            if len(self._ts) > 400:
                self._ts.clear()
            self._ts[key] = [int(r[0]) for r in hs.candle_ohlc(symbol, ca.SOURCE_TF.get(tf, tf), from_ts=int(from_ts))]
        return self._ts[key]


# ---------------------------------------------------------------- hypothesis record

def _record(op: str, route: str, symbol: str, sign: int, *, opportunity_id: str, parent: dict[str, Any] | None, child: dict[str, Any] | None,
            execution_tf: str | None, channel_role: str | None, trigger_type: str, detector_state: str, evidence: dict[str, Any],
            confirmation: dict[str, Any], ctx: Context, confidence: float, entry_quality: str | None, room: dict[str, Any] | None,
            campaign_id: str | None, episode_id: str | None, trigger_ts: Any = None, trigger_price: Any = None, data_ts: Any = None,
            data_tf: str | None = None, detail: dict[str, Any] | None = None, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    mode = ot.ROUTES.get(route, {}).get("mode", "SHADOW")
    meta = ot.TYPES[op]
    econ_state, _blocks, _why = ctx.econ_state()
    regime = _regime(parent, econ_state)
    fresh = data_ts is not None and _fresh(data_ts, data_tf or execution_tf or "H1", ctx.now)
    return {
        "opportunityId": opportunity_id, "opportunityType": op, "opportunityCode": meta["code"], "opportunityName": meta["name"],
        "badge": meta["badge"], "opportunityContext": ["POST_EVENT"] if econ_state in POST_EVENT_STATES else [],
        "route": route, "mode": mode, "symbol": symbol, "direction": _label(sign), "side": "BUY" if sign > 0 else "SELL",
        "parentTimeframe": (parent or {}).get("timeframe"), "childTimeframe": (child or {}).get("timeframe"), "executionTimeframe": execution_tf,
        "parentStructure": _structure(parent), "childStructure": _structure(child),
        "channelId": (parent or {}).get("channelId"), "channelRole": channel_role,
        "triggerType": trigger_type, "triggerTime": trigger_ts, "triggerPrice": trigger_price, "detectorState": detector_state,
        "evidence": evidence, "confirmation": confirmation, "confirmationContractId": confirmation["contractId"],
        "confirmationState": confirmation["result"], "requiredEvidence": confirmation["requiredEvidence"],
        "satisfiedEvidence": confirmation["satisfiedEvidence"], "missingEvidence": confirmation["missingEvidence"],
        "optionalEvidence": confirmation["optionalEvidence"], "invalidationConditions": ot.CONTRACTS[op]["invalidation"],
        "invalidationReason": confirmation.get("invalidationReason"), "confidence": round(float(confidence or 0), 1),
        "entryQuality": entry_quality, "room": room, "campaignId": campaign_id, "episodeId": episode_id,
        "regime": {"label": regime, "compatibility": ot.compatibility(op, regime)},
        "strength": ctx.strength(sign), "stage6": ctx.stage6(op, sign),
        "dataFreshness": {"state": "CURRENT" if fresh else "STALE", "lastBarTs": data_ts, "timeframe": data_tf or execution_tf},
        "scannerRank": ctx.rank, "legs": ot.LEGS[op], "detail": detail or {}, **(extra or {}),
    }


def _structure(ch: dict[str, Any] | None) -> dict[str, Any] | None:
    if not ch:
        return None
    return {k: ch.get(k) for k in ("timeframe", "direction", "status", "phase", "channelId", "position", "confidence", "upper", "lower", "mid")}


def _regime(parent: dict[str, Any] | None, econ_state: str) -> str:
    if econ_state in ("RELEASE_PROCESSING", "POST_EVENT_VOLATILITY"):
        return "EVENT_DISTORTED"
    if not parent:
        return "UNDEFINED"
    status, direction = str(parent.get("status") or ""), str(parent.get("direction") or "")
    if status in ("WEAKENING", "BROKEN", "RETESTING") or str(parent.get("phase") or "") in ("DETERIORATION", "REVERSAL_RISK", "FAILED_BREAKOUT"):
        return "TRANSITIONAL"
    if status in ("VALIDATED", "ACTIVE"):
        return "RANGING" if direction == "RANGE" else "TRENDING"
    return "UNDEFINED"


def _structure_since(events: list[dict[str, Any]], sign: int, since_ts: Any) -> tuple[bool, bool]:
    if since_ts is None:
        return False, False
    bos = any(e["kind"] == "BOS" and _sign(e["direction"]) == sign and int(e["ts"]) >= int(since_ts) for e in events)
    choch = any(e["kind"] == "CHOCH" and _sign(e["direction"]) == sign and int(e["ts"]) >= int(since_ts) for e in events)
    return bos, choch


def _erz_overlap(ctx: Context, tf: str, sign: int, zone: dict[str, Any] | None) -> dict[str, Any]:
    """CHANNEL_BOUNDARY_ZONE vs the existing ERZ construction for the same parent. The ERZ is not replaced."""
    parent = ctx.channel(tf)
    child_tf = {"D1": "H8", "H8": "H1", "H1": "M15"}.get(tf)
    child = ctx.channel(child_tf) if child_tf else None
    if not zone or parent.get("lower") is None or parent.get("upper") is None:
        return {"channelBoundaryZone": zone, "erz": None, "overlap": "UNAVAILABLE"}
    erz = opportunity.expected_retracement_zone({**parent, "atr": parent.get("atr")}, child if child and child.get("lower") is not None else None, sign)
    if not erz:
        return {"channelBoundaryZone": zone, "erz": None, "overlap": "UNAVAILABLE"}
    hit = min(float(zone["high"]), float(erz["zoneHigh"])) > max(float(zone["low"]), float(erz["zoneLow"]))
    return {"channelBoundaryZone": zone, "erz": {"zoneLow": erz["zoneLow"], "zoneHigh": erz["zoneHigh"], "reasons": erz["reasons"]},
            "overlap": "OVERLAP" if hit else "NON_OVERLAP",
            "entryQualityBasis": "Boundary-reaction zone and execution-TF extension; the ERZ is reported as confluence only"}


# ---------------------------------------------------------------- OP-01 / OP-02 / OP-11

def boundary_hypothesis(op: str, ctx: Context, src: Any, tf: str, sign: int, cache: dict[tuple, Any]) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Returns (hypothesis or None, detector diagnostics)."""
    ch = ctx.channel(tf)
    exec_tf = EXECUTION[tf]
    mode = "MIDLINE" if op == "OP-02" else "BOUNDARY"
    route = {"OP-01": "OP-01:BOUNDARY_REACTION", "OP-02": "OP-02:INTERNAL_REACTION", "OP-11": "OP-11:RANGE_REACTION"}[op]
    defn = ch.get("definition")
    key = (ctx.symbol, exec_tf)
    if key not in cache:
        cache[key] = src.bars(ctx.symbol, exec_tf, CONFIG["execBars"])
    bars = cache[key] or []
    diag = {"symbol": ctx.symbol, "timeframe": tf, "executionTimeframe": exec_tf, "opportunityType": op, "direction": _label(sign)}
    if not defn or not bars:
        det = br._empty("INSUFFICIENT_HISTORY", f"{'No channel definition' if not defn else f'No stored {exec_tf} candles'} — cannot measure a reaction")
    else:
        parent_ts = src.parent_ts(ctx.symbol, tf, int(defn["anchorTs"]), ch.get("lastBarTs"))
        lines = br.project_lines(defn, parent_ts, [int(b[0]) for b in bars])
        det = br.detect(bars, lines, sign, parent_atr=ch.get("atr"), mode=mode, tf_sec=TF_SEC[exec_tf], now_ts=ctx.now)
    diag["state"] = det["state"]
    if det["state"] in ("BOUNDARY_DISTANT", "NO_PRIOR_IMPULSE", "OUTER_BOUNDARY_REACHED"):
        return None, diag
    insufficient = det["state"] == "INSUFFICIENT_HISTORY"
    events = ca.structure_events(exec_tf, bars, limit=60) if bars and not insufficient else []
    touch_ts = (det.get("touch") or {}).get("ts")
    bos, choch = _structure_since(events, sign, touch_ts)
    diag["bos"] = bos
    erz = _erz_overlap(ctx, tf, sign, det.get("zone"))
    signals = det.get("signals") or {}
    room = det.get("room")
    grade = (det.get("entryQuality") or {}).get("grade")
    reacted = det["state"] == "REACTION_CONFIRMED" and not det.get("expired")
    reached = det["state"] in br.CONTACT_STATES or det["state"] in ("REACTION_PENDING", "REACTION_DETECTED", "REACTION_CONFIRMED", "REACTION_FAILED",
                                                                   "BOUNDARY_BROKEN")
    status = str(ch.get("status") or "")
    valid = status in CHANNEL_OK
    stale = bool(det.get("stale")) or str(ch.get("dataStatus") or "") == "STALE"
    child_tf = {"D1": "H8", "H8": "H1", "H1": "M15"}.get(tf)
    child = ctx.channel(child_tf) if child_tf else {}
    evidence: dict[str, Any] = {
        "CHANNEL_VALID": valid if op != "OP-11" else None,
        "RANGE_VALID": valid and str(ch.get("direction")) == "RANGE" if op == "OP-11" else None,
        "DIRECTION_ALIGNED": _sign(ch.get("direction")) == sign if op != "OP-11" else None,
        "BOUNDARY_ZONE_REACHED": reached if op != "OP-02" else None,
        "BOUNDARY_HOLDING": det["state"] != "BOUNDARY_BROKEN" if not insufficient else None,
        "REACTION": reacted if op != "OP-02" else None,
        "REACTION_STRONG": reacted if op == "OP-02" else None,
        "ROOM": None if not room else bool(room.get("ok")),
        "ENTRY_QUALITY": grade == "GOOD" if op == "OP-02" else None,
        "FRESH_DATA": not stale and not insufficient,
        "ECON_PERMITS": not ctx.econ_state()[1],
        "BOS": bos, "CHOCH": choch, "CHANNEL_BREAK": status in ("BROKEN", "RETESTING"), "RETEST": False,
        "RANGE_BREAK": det["state"] == "BOUNDARY_BROKEN" or status in ("BROKEN", "RETESTING") if op == "OP-11" else None,
        "REJECTION_WICK": bool(signals.get("rejectionWick")), "MOMENTUM_RECOVERY": bool(signals.get("momentumTurn")),
        "HIGHER_LOW": bool(signals.get("higherLow")), "ERZ_CONFLUENCE": erz["overlap"] == "OVERLAP" if erz["overlap"] != "UNAVAILABLE" else None,
        "STRENGTH_ALIGNED": ctx.strength(sign) == "SUPPORTS", "STAGE6_SUPPORT": ctx.stage6(op, sign) == "SUPPORTS",
    }
    confluence: list[str] = []
    if op == "OP-02":
        if erz["overlap"] == "OVERLAP":
            confluence.append("ERZ overlaps the midline zone")
        if evidence["STAGE6_SUPPORT"]:
            confluence.append("Stage 6 structure supports")
        if child and _sign(child.get("direction")) == sign and str(child.get("status") or "") in CHANNEL_OK:
            confluence.append(f"{child_tf} child channel aligned")
        if bos:
            confluence.append("BOS in trade direction since the touch")
        evidence["INTERNAL_CONFLUENCE"] = reached and bool(confluence)
    invalid = None
    if det["state"] == "BOUNDARY_BROKEN":
        invalid = "Trend-supporting boundary broke on a closed bar" if op != "OP-11" else "Range boundary broke (range breakout invalidates OP-11)"
    elif det["state"] == "REACTION_FAILED":
        invalid = "Reaction failed — new extreme beyond the touch extreme"
    elif status in ("INVALIDATED",):
        invalid = "Parent channel invalidated"
    confirmation = ot.evaluate(op, evidence, stale=stale and not insufficient, insufficient=insufficient, invalidated=invalid)
    cycle = (det.get("episode") or {}).get("cycleStartTs")
    oid = _hid(op, ctx.symbol, ch.get("channelId"), sign, cycle or f"touch:{touch_ts}" if (cycle or touch_ts) else "approach")
    episode_id = _hid(oid, touch_ts) if touch_ts else None
    side = "LOWER" if sign > 0 else "UPPER"
    role = {"OP-01": f"TREND_SUPPORT_{side}", "OP-02": "MIDLINE", "OP-11": f"RANGE_{'SUPPORT' if sign > 0 else 'RESISTANCE'}"}[op]
    trig = {"OP-01": f"{side}_CHANNEL_REACTION", "OP-02": "MIDLINE_REACTION", "OP-11": f"RANGE_{side}_REACTION"}[op]
    rec = _record(op, route, ctx.symbol, sign, opportunity_id=oid, parent={**ch, "timeframe": tf}, child=child if child else None,
                  execution_tf=exec_tf, channel_role=role, trigger_type=trig, detector_state=det["state"], evidence=evidence,
                  confirmation=confirmation, ctx=ctx, confidence=float(ch.get("confidence") or 0), entry_quality=grade, room=room,
                  campaign_id=_hid("CAMPAIGN", ctx.symbol, sign), episode_id=episode_id, trigger_ts=det.get("confirmedAt"),
                  trigger_price=det.get("triggerPrice"), data_ts=det.get("lastTs"), data_tf=exec_tf,
                  detail={"reaction": {k: det.get(k) for k in ("state", "contact", "signals", "quality", "zone", "touch", "extreme",
                                                                "detectedAt", "confirmedAt", "barsSinceTouch", "barsSinceTrigger",
                                                                "expired", "episode", "breakBar", "position", "reasons", "atr", "lastClose")},
                          "erz": erz, "confluence": confluence})
    rec["_expired"] = bool(det.get("expired"))
    return rec, diag


# ---------------------------------------------------------------- legacy TiT / NORMAL mapping (existing production routes)

def legacy_hypotheses(rows: list[dict[str, Any]], ctxs: dict[str, Context], stage7: dict[str, dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        symbol = row.get("symbol")
        ctx = ctxs.get(symbol)
        if not ctx:
            continue
        for h in row.get("hypotheses") or []:
            family = h.get("opportunityFamily")
            if not family or h.get("status") == "NOT_DETECTED":
                continue
            op = ot.legacy_type(family)
            if not op:
                continue
            try:
                out.append(_legacy(op, h, ctx, (stage7 or {}).get(symbol)))
            except Exception:
                traceback.print_exc()
    return out


def _legacy(op: str, h: dict[str, Any], ctx: Context, s7: dict[str, Any] | None) -> dict[str, Any]:
    sign = _sign(h.get("direction"))
    p1, p2 = (h.get("p1") or {}).get("state"), (h.get("p2") or {}).get("state")
    exec_conf = p1 in ("P1_READY_FOR_RISK", "P1_CONFIRMED") or p2 in ("P2_READY_FOR_RISK", "P2_WAIT_RETEST")
    fresh = h.get("status") != "WAIT_NEW_CONFIRMATION" and not ctx.missed
    parent = {"timeframe": h.get("parentTimeframe"), "direction": h.get("parentDirection"), "channelId": h.get("parentChannelId"),
              "position": h.get("parentChannelPosition"), **{k: v for k, v in ctx.channel(h.get("parentTimeframe") or "D1").items()
                                                              if k in ("status", "phase", "confidence", "upper", "lower", "mid")}}
    child = {"timeframe": h.get("childTimeframe"), "direction": h.get("childDirection"), "channelId": h.get("childChannelId"),
             "position": h.get("childChannelPosition")} if h.get("childTimeframe") else None
    variant = None
    route = f"{op}:TIT"
    evidence: dict[str, Any] = {"FRESH_DATA": fresh, "ECON_PERMITS": not ctx.econ_state()[1], "EXECUTION_CONFIRMATION": exec_conf,
                                "STRENGTH_ALIGNED": ctx.strength(sign) == "SUPPORTS", "STAGE6_SUPPORT": ctx.stage6(op, sign) == "SUPPORTS",
                                "ERZ_CONFLUENCE": (h.get("location") or {}).get("inside")}
    if op == "OP-01":
        variant, route = "LEGACY_H1", "OP-01:LEGACY_H1"
        state7 = str((s7 or {}).get("state") or "")
        # The legacy route's channel gate is Stage 6 READY_FOR_H1 (D1/H8 are context, not required).
        evidence.update({"CHANNEL_VALID": ctx.direction.get("state") == "READY_FOR_H1", "DIRECTION_ALIGNED": True,
                         "BOS_OR_CHOCH": True if state7 == "CONFIRMED" else (False if s7 else None)})
    elif op == "OP-03":
        evidence.update({"PARENT_CHILD_ALIGNMENT": h.get("childRole") == "CONTINUATION"})
    elif op == "OP-04":
        evidence.update({"PARENT_VALID": bool(h.get("parentTimeframe")), "CORRECTIVE_STRUCTURE": h.get("childRole") == "CORRECTION",
                         "COUNTER_PARENT_FLAG": True})
    elif op == "OP-05":
        brk = h.get("channelBreak") or {}
        evidence.update({"PARENT_VALID": bool(h.get("parentTimeframe")), "CORRECTION_END": True,
                         "CHILD_CHANNEL_FAILURE": bool(brk) or h.get("childRole") == "TRANSITION", "RETEST": brk.get("state") in ("RETESTING", "RETEST_HELD")})
    confirmation = ot.evaluate(op, evidence, stale=not fresh, variant=variant)
    oid = _hid(op, "LEGACY", h.get("campaignId"))
    trig = {"OP-01": "H1_PULLBACK_CONFIRMATION", "OP-03": "TIT_ERZ_OR_CHILD_BREAK", "OP-04": "TIT_CORRECTION_TRIGGER", "OP-05": "CHILD_CHANNEL_BREAK"}[op]
    rec = _record(op, route, ctx.symbol, sign, opportunity_id=oid, parent=parent, child=child, execution_tf=h.get("executionTimeframe"),
                  channel_role="PARENT_ERZ" if op != "OP-05" else "CHILD_BREAK", trigger_type=trig,
                  detector_state=f"P1 {p1} · P2 {p2}", evidence=evidence, confirmation=confirmation, ctx=ctx,
                  confidence=float(h.get("confidence") or 0), entry_quality=None, room=None, campaign_id=h.get("campaignId"),
                  episode_id=None, data_ts=int(ctx.now) if fresh else None, data_tf=h.get("executionTimeframe"),
                  detail={"legacy": {k: h.get(k) for k in ("opportunityFamily", "TiTLevel", "p1", "p2", "status", "blocker", "childRole",
                                                          "expectedRetracementZone", "location", "channelBreak", "actionable")}},
                  extra={"TiTLevel": h.get("TiTLevel"), "counterParentTrend": op == "OP-04", "legacyActionable": bool(h.get("actionable"))})
    return rec


# ---------------------------------------------------------------- OP-06 / OP-07 / OP-09 from the Breakout & Retest scanner

def breakout_hypotheses(rows: list[dict[str, Any]], ctxs: dict[str, Context], tit_by_level: dict[tuple, str], cache: dict[tuple, Any],
                        src: Any) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        ctx = ctxs.get(row.get("symbol"))
        if not ctx:
            continue
        brk = row.get("breakout") or {}
        state = str(brk.get("state") or "")
        sign = _sign(brk.get("expectedDirection"))
        channel = row.get("channel") or {}
        level = row.get("titLevel")
        role = str(row.get("channelRole") or "")
        if role in ("CORRECTION", "TRANSITION") and state != "FAILED_BREAKOUT":
            continue  # correction-end break: evidence for the OP-05 TiT hypothesis of this level, not a separate OP-06
        if str(channel.get("direction") or "") == "RANGE":
            continue  # range breaks are classified as OP-12 from the channel engine, not as OP-06
        fresh = str((row.get("freshness") or {}).get("state") or "") == "CURRENT"
        if state == "FAILED_BREAKOUT":
            failed = _failed_from_scanner(row, ctx, cache, src)
            if failed:
                out.append(failed)
            continue
        retest = row.get("retest") or {}
        op = "OP-07" if state in ("RETESTING", "RETEST_HELD") else "OP-06"
        evidence = {
            "CHANNEL_VALID": True, "CHANNEL_BREAK": state in ("BREAK_DETECTED", "BREAK_CONFIRMED", "RETESTING", "RETEST_HELD"),
            "BREAK_CONFIRMED": state in ("BREAK_CONFIRMED", "RETESTING", "RETEST_HELD"), "RETEST": state in ("RETESTING", "RETEST_HELD"),
            "RETEST_HOLD": state == "RETEST_HELD", "FAILURE_EVIDENCE": False, "FRESH_DATA": fresh, "ECON_PERMITS": not ctx.econ_state()[1],
            "BOS": bool((row.get("structure") or {}).get("bos")), "CHOCH": bool((row.get("structure") or {}).get("choch")),
        }
        confirmation = ot.evaluate(op, evidence, stale=not fresh)
        oid = _hid("BRK", row.get("candidateId"))
        parent = {**(row.get("parent") or {})}
        rec = _record(op, f"{op}:BREAKOUT_SCANNER", ctx.symbol, sign, opportunity_id=oid, parent=parent,
                      child={**channel, "timeframe": channel.get("timeframe")}, execution_tf=row.get("confirmationTimeframe"),
                      channel_role=f"BROKEN_{brk.get('relevantBoundary')}" if evidence["CHANNEL_BREAK"] else f"{brk.get('relevantBoundary')}_BOUNDARY",
                      trigger_type="CHANNEL_RETEST" if op == "OP-07" else "CHANNEL_BREAK", detector_state=str(brk.get("engineState") or state),
                      evidence=evidence, confirmation=confirmation, ctx=ctx, confidence=float(channel.get("confidence") or 0), entry_quality=None,
                      room=None, campaign_id=tit_by_level.get((ctx.symbol, level)) or _hid("CAMPAIGN", ctx.symbol, sign),
                      episode_id=row.get("candidateId"), trigger_ts=brk.get("confirmedAt") or brk.get("detectedAt"),
                      trigger_price=brk.get("breakPrice"), data_ts=int(ctx.now) if fresh else None, data_tf=row.get("confirmationTimeframe"),
                      detail={"breakout": brk, "retest": retest, "candidateId": row.get("candidateId"), "titLevel": level},
                      extra={"TiTLevel": level, "supersedes": "OP-06" if op == "OP-07" else None, "candidateId": row.get("candidateId")})
        rec["channelId"] = channel.get("id")
        out.append(rec)
    return out


def _failed_from_scanner(row: dict[str, Any], ctx: Context, cache: dict[tuple, Any], src: Any) -> dict[str, Any] | None:
    brk = row.get("breakout") or {}
    channel = row.get("channel") or {}
    side = str(brk.get("relevantBoundary") or "")
    level = brk.get("boundaryPrice")
    tf = row.get("confirmationTimeframe") or "H1"
    if level is None or side not in ("UPPER", "LOWER"):
        return None
    since = None
    if brk.get("detectedAt"):
        since = int(int(brk["detectedAt"]) / 1000)
    return _failed_record(ctx, cache, src, tf=tf, exec_tf=tf, side=side, level=float(level), since=since,
                          parent={**channel, "timeframe": channel.get("timeframe")}, channel_id=channel.get("id"),
                          origin="scanner", ident=row.get("candidateId"), confidence=float(channel.get("confidence") or 0),
                          opposite=channel.get("lower") if side == "UPPER" else channel.get("upper"))


def _failed_record(ctx: Context, cache: dict[tuple, Any], src: Any, *, tf: str, exec_tf: str, side: str, level: float, since: int | None,
                   parent: dict[str, Any], channel_id: Any, origin: str, ident: Any, confidence: float, opposite: Any) -> dict[str, Any] | None:
    key = (ctx.symbol, exec_tf)
    if key not in cache:
        cache[key] = src.bars(ctx.symbol, exec_tf, CONFIG["execBars"])
    bars = cache[key] or []
    sign = -1 if side == "UPPER" else 1
    rx = br.reentry_reaction(bars, level, side, since_ts=since) if bars else {"state": "INSUFFICIENT_HISTORY"}
    insufficient = rx["state"] == "INSUFFICIENT_HISTORY"
    if rx["state"] == "NO_BREAK_IN_WINDOW":
        return None
    room = None
    if not insufficient and rx.get("extreme") is not None and opposite is not None:
        entry, inv, target = float(rx["lastClose"]), float(rx["extreme"]), float(opposite)
        risk_d = (entry - inv) * sign
        rr = None if risk_d <= 0 else (target - entry) * sign / risk_d
        room = {"entry": entry, "invalidation": inv, "target": target, "targetKind": "OPPOSITE_BOUNDARY",
                "rewardRisk": None if rr is None else round(rr, 2), "minRR": br._min_rr(), "ok": rr is not None and rr >= br._min_rr()}
    fresh = not insufficient and _fresh(rx.get("lastTs"), exec_tf, ctx.now)
    events = ca.structure_events(exec_tf, bars, limit=40) if bars and not insufficient else []
    bos, choch = _structure_since(events, sign, since)
    evidence = {"PRIOR_BREAK_ATTEMPT": True, "FAILURE_EVIDENCE": True, "REENTRY": rx.get("reentry"), "REACTION": rx.get("reaction"),
                "ROOM": None if room is None else room["ok"], "FRESH_DATA": fresh, "ECON_PERMITS": not ctx.econ_state()[1], "BOS": bos, "CHOCH": choch}
    invalid = "Price broke out again beyond the failed boundary" if rx["state"] == "OUTSIDE" else None
    confirmation = ot.evaluate("OP-09", evidence, stale=not fresh and not insufficient, insufficient=insufficient, invalidated=invalid)
    oid = _hid("OP-09", ctx.symbol, origin, ident, side)
    return _record("OP-09", "OP-09:BREAKOUT_SCANNER", ctx.symbol, sign, opportunity_id=oid, parent=parent, child=None, execution_tf=exec_tf,
                   channel_role=f"FAILED_{side}", trigger_type="FAILED_BREAK_REENTRY", detector_state=rx["state"], evidence=evidence,
                   confirmation=confirmation, ctx=ctx, confidence=confidence, entry_quality=None, room=room,
                   campaign_id=_hid("CAMPAIGN", ctx.symbol, sign), episode_id=_hid(oid, since), data_ts=rx.get("lastTs"), data_tf=exec_tf,
                   trigger_ts=rx.get("lastTs") if rx.get("reaction") else None, trigger_price=rx.get("lastClose") if rx.get("reaction") else None,
                   detail={"reentry": rx, "failedBoundary": side, "level": level, "origin": origin},
                   extra={"invalidates": _hid("BRK", ident) if origin == "scanner" else None})


def failed_from_channels(ctx: Context, src: Any, cache: dict[tuple, Any]) -> list[dict[str, Any]]:
    """Channel-engine failed breakouts (closed back inside) on D1/H8/H1."""
    out = []
    for tf in PARENT_TFS:
        ch = ctx.channel(tf)
        recent = [e for e in (ch.get("events") or []) if str(e.get("kind")) == "FAILED_BREAKOUT"]
        if not recent or str(ch.get("status") or "") in ("INVALIDATED", "BROKEN"):
            continue
        last = max(recent, key=lambda e: int(e.get("time") or 0))
        t = int(int(last.get("time") or 0) / 1000)
        if ctx.now - t > CONFIG["failedBreakBars"] * TF_SEC[tf]:
            continue
        side = "UPPER" if str(last.get("label") or "").lower().startswith("upside") else "LOWER"
        level = ch.get("upper") if side == "UPPER" else ch.get("lower")
        if level is None:
            continue
        rec = _failed_record(ctx, cache, src, tf=tf, exec_tf=EXECUTION[tf], side=side, level=float(level), since=t - TF_SEC[tf],
                             parent={**ch, "timeframe": tf}, channel_id=ch.get("channelId"), origin=f"channel:{tf}", ident=f"{ch.get('channelId')}:{t}",
                             confidence=float(ch.get("confidence") or 0), opposite=ch.get("lower") if side == "UPPER" else ch.get("upper"))
        if rec:
            out.append(rec)
    return out


# ---------------------------------------------------------------- OP-08 structural breakout continuation

def structural_hypothesis(ctx: Context, src: Any, cache: dict[tuple, Any]) -> dict[str, Any] | None:
    parent_tf = next((tf for tf in ("D1", "H8") if str(ctx.channel(tf).get("status") or "") in CHANNEL_OK and _sign(ctx.channel(tf).get("direction"))), None)
    if not parent_tf:
        return None
    parent = ctx.channel(parent_tf)
    sign = _sign(parent.get("direction"))
    exec_tf = "H1"
    key = (ctx.symbol, exec_tf)
    if key not in cache:
        cache[key] = src.bars(ctx.symbol, exec_tf, CONFIG["execBars"])
    bars = cache[key] or []
    if len(bars) < 60:
        return None
    events = ca.structure_events(exec_tf, bars, limit=40)
    if not events:
        return None
    ts_index = {int(b[0]): i for i, b in enumerate(bars)}
    bos = next((e for e in reversed(events) if e["kind"] == "BOS" and _sign(e["direction"]) == sign), None)
    if not bos or int(bos["ts"]) not in ts_index:
        return None
    i = ts_index[int(bos["ts"])]
    age = len(bars) - 1 - i
    if age > CONFIG["structureExpiryBars"]:
        return None
    h = [float(b[2]) for b in bars]
    lo = [float(b[3]) for b in bars]
    cl = [float(b[4]) for b in bars]
    atr = vision.wilder_atr(h, lo, cl, vision.CONFIG["atrLen"])
    level = float(bos["level"])
    quality = (cl[i] - level) * sign >= CONFIG["bosQualityAtr"] * atr[i]
    lost = any((cl[j] - level) * sign < 0 for j in range(i + 1, len(bars)))
    flipped = events[-1]["kind"] in ("BOS", "CHOCH") and _sign(events[-1]["direction"]) == -sign
    ext_atr = (cl[-1] - level) * sign / atr[-1] if atr[-1] else None
    grade = None if ext_atr is None else "EXTENDED" if ext_atr >= confirm.CONFIG["extensionChaseAtr"] else "GOOD" if ext_atr <= confirm.CONFIG["extensionLateAtr"] else "ACCEPTABLE"
    retest = any(((lo[j] - level) if sign > 0 else (level - h[j])) <= vision.CONFIG["retestTolAtr"] * atr[j] and (cl[j] - level) * sign >= 0
                 for j in range(i + 1, len(bars)))
    piv = vision.pivots(h, lo, vision.tf_cfg(exec_tf)["pivot"])
    stops = [p["p"] for p in piv if p["i"] < i and p["kind"] == ("L" if sign > 0 else "H")]
    room = None
    target = parent.get("upper") if sign > 0 else parent.get("lower")
    if stops and target is not None:
        entry, inv = cl[-1], float(stops[-1])
        risk_d = (entry - inv) * sign
        rr = None if risk_d <= 0 else (float(target) - entry) * sign / risk_d
        room = {"entry": entry, "invalidation": inv, "target": float(target), "targetKind": f"{parent_tf}_OPPOSITE_BOUNDARY",
                "rewardRisk": None if rr is None else round(rr, 2), "minRR": br._min_rr(), "ok": rr is not None and rr >= br._min_rr()}
    choch = any(e["kind"] == "CHOCH" and _sign(e["direction"]) == sign and int(e["ts"]) <= int(bos["ts"]) for e in events[-6:])
    fresh = _fresh(bars[-1][0], exec_tf, ctx.now)
    channel_break = any(str(ctx.channel(tf).get("status") or "") in ("BROKEN", "RETESTING") for tf in PARENT_TFS)
    evidence = {"STRUCTURAL_BREAK": True, "BREAK_QUALITY": quality, "ROOM": None if room is None else room["ok"], "FRESH_DATA": fresh,
                "ECON_PERMITS": not ctx.econ_state()[1], "CHANNEL_BREAK": channel_break, "CHOCH": choch, "RETEST": retest,
                "STAGE6_SUPPORT": ctx.stage6("OP-08", sign) == "SUPPORTS", "STRENGTH_ALIGNED": ctx.strength(sign) == "SUPPORTS"}
    invalid = "Close back through the broken swing level" if lost else "Structure flipped (opposite BOS/CHoCH)" if flipped else None
    confirmation = ot.evaluate("OP-08", evidence, stale=not fresh, invalidated=invalid)
    oid = _hid("OP-08", ctx.symbol, exec_tf, bos["ts"], sign)
    return _record("OP-08", "OP-08:STRUCTURE", ctx.symbol, sign, opportunity_id=oid, parent={**parent, "timeframe": parent_tf}, child=None,
                   execution_tf=exec_tf, channel_role="CONTEXT", trigger_type="BOS_CONTINUATION", detector_state="BOS_CONFIRMED" if quality else "BOS_WEAK",
                   evidence=evidence, confirmation=confirmation, ctx=ctx, confidence=float(parent.get("confidence") or 0), entry_quality=grade,
                   room=room, campaign_id=_hid("CAMPAIGN", ctx.symbol, sign), episode_id=_hid(oid, "bos"), trigger_ts=int(bos["ts"]),
                   trigger_price=float(bos["price"]), data_ts=int(bars[-1][0]), data_tf=exec_tf,
                   detail={"bos": bos, "barsSince": age, "extensionAtr": None if ext_atr is None else round(ext_atr, 2), "retest": retest})


# ---------------------------------------------------------------- OP-10 trend reversal

def reversal_hypothesis(ctx: Context, src: Any, cache: dict[tuple, Any]) -> dict[str, Any] | None:
    d1 = ctx.channel("D1")
    trend = _sign(d1.get("direction"))
    if trend == 0 or str(d1.get("status") or "") not in ("VALIDATED", "ACTIVE", "WEAKENING", "BROKEN", "RETESTING"):
        return None
    h8 = ctx.channel("H8")
    structure = sorted(h8.get("structure") or [], key=lambda e: int(e["ts"]))
    horizon = ctx.now - CONFIG["reversalChochBars"] * TF_SEC["H8"]
    choch = next((e for e in reversed(structure) if e["kind"] == "CHOCH" and _sign(e["direction"]) == -trend and int(e["ts"]) >= horizon), None)
    leg = (ctx.direction or {}).get("marketLeg") or {}
    rev_state = str(leg.get("reversalState") or "NONE")
    brk = d1.get("breakout") or {}
    against = str(d1.get("status") or "") in ("BROKEN", "RETESTING") and (brk.get("side") == ("DOWN" if trend > 0 else "UP"))
    deterioration = (str(d1.get("status") or "") == "WEAKENING" or str(d1.get("phase") or "") in ("DETERIORATION", "REVERSAL_RISK")
                     or rev_state in ("DEVELOPING", "CONFIRMED") or against)
    if not choch or not deterioration:
        return None  # one countertrend move is not a reversal: CHoCH plus deterioration is the minimum to open the hypothesis
    sign = -trend
    opposite_bos = next((e for e in structure if e["kind"] == "BOS" and _sign(e["direction"]) == sign and int(e["ts"]) > int(choch["ts"])), None)
    reasserted = next((e for e in structure if e["kind"] == "BOS" and _sign(e["direction"]) == trend and int(e["ts"]) > int(choch["ts"])), None)
    h8_flip = _sign(h8.get("direction")) == sign and str(h8.get("status") or "") in ("VALIDATED", "ACTIVE")
    confirmation_ok = against or rev_state == "CONFIRMED" or h8_flip
    key = (ctx.symbol, "H8")
    if key not in cache:
        cache[key] = src.bars(ctx.symbol, "H8", 200)
    bars = cache[key] or []
    room = None
    target = d1.get("lower") if sign < 0 else d1.get("upper")
    if bars and target is not None:
        since = [b for b in bars if int(b[0]) >= int(choch["ts"])]
        if since:
            entry = float(bars[-1][4])
            inv = max(float(b[2]) for b in since) if sign < 0 else min(float(b[3]) for b in since)
            risk_d = (entry - inv) * sign
            rr = None if risk_d <= 0 else (float(target) - entry) * sign / risk_d
            room = {"entry": entry, "invalidation": inv, "target": float(target), "targetKind": "D1_OPPOSITE_BOUNDARY",
                    "rewardRisk": None if rr is None else round(rr, 2), "minRR": br._min_rr(), "ok": rr is not None and rr >= br._min_rr()}
    fresh = _fresh(h8.get("lastBarTs") or (bars[-1][0] if bars else None), "H8", ctx.now)
    evidence = {"TREND_DETERIORATION": deterioration, "CHOCH": True, "OPPOSITE_BOS": bool(opposite_bos), "REVERSAL_CONFIRMATION": confirmation_ok,
                "ROOM": None if room is None else room["ok"], "FRESH_DATA": fresh, "ECON_PERMITS": not ctx.econ_state()[1],
                "STAGE6_SUPPORT": ctx.stage6("OP-10", sign) == "SUPPORTS", "STRENGTH_ALIGNED": ctx.strength(sign) == "SUPPORTS"}
    invalid = "Old trend reasserted with a BOS in the original direction" if reasserted and (not opposite_bos or int(reasserted["ts"]) > int(opposite_bos["ts"])) else None
    confirmation = ot.evaluate("OP-10", evidence, stale=not fresh, invalidated=invalid)
    oid = _hid("OP-10", ctx.symbol, choch["ts"], sign)
    return _record("OP-10", "OP-10:REVERSAL", ctx.symbol, sign, opportunity_id=oid, parent={**d1, "timeframe": "D1"}, child={**h8, "timeframe": "H8"},
                   execution_tf="H8", channel_role="TREND_TRANSITION", trigger_type="CHOCH_THEN_OPPOSITE_BOS",
                   detector_state="REVERSAL_" + ("CONFIRMING" if not opposite_bos else "STRUCTURE_CHANGED"), evidence=evidence,
                   confirmation=confirmation, ctx=ctx, confidence=float(h8.get("confidence") or 0), entry_quality=None, room=room,
                   campaign_id=_hid("CAMPAIGN", ctx.symbol, sign), episode_id=_hid(oid, "choch"),
                   trigger_ts=int(opposite_bos["ts"]) if opposite_bos else None, trigger_price=opposite_bos["price"] if opposite_bos else None,
                   data_ts=h8.get("lastBarTs") or (bars[-1][0] if bars else None), data_tf="H8",
                   detail={"choch": choch, "oppositeBos": opposite_bos, "reversalState": rev_state, "d1Status": d1.get("status"), "d1Phase": d1.get("phase")})


# ---------------------------------------------------------------- OP-12 range breakout + retest (channel engine)

def range_break_hypotheses(ctx: Context) -> list[dict[str, Any]]:
    out = []
    for tf in PARENT_TFS:
        ch = ctx.channel(tf)
        if str(ch.get("direction") or "") != "RANGE" or str(ch.get("status") or "") not in ("BROKEN", "RETESTING", "INVALIDATED"):
            continue
        brk = ch.get("breakout") or {}
        if not brk.get("side"):
            continue
        sign = 1 if brk["side"] == "UP" else -1
        status = str(ch.get("status"))
        retest = bool(brk.get("retestTs"))
        hold = retest and not brk.get("retesting") and status == "BROKEN"
        fresh = _fresh(ch.get("lastBarTs"), tf, ctx.now)
        evidence = {"RANGE_VALID": True, "RANGE_BREAK": True, "BREAK_CONFIRMED": status in ("BROKEN", "RETESTING"), "RETEST": retest,
                    "RETEST_HOLD": hold, "FRESH_DATA": fresh, "ECON_PERMITS": not ctx.econ_state()[1]}
        invalid = "Range breakout failed (channel invalidated / re-entered)" if status == "INVALIDATED" or str(ch.get("phase")) == "FAILED_BREAKOUT" else None
        confirmation = ot.evaluate("OP-12", evidence, stale=not fresh, invalidated=invalid)
        oid = _hid("OP-12", ctx.symbol, tf, ch.get("channelId"), brk.get("ts"))
        out.append(_record("OP-12", "OP-12:BREAKOUT_SCANNER", ctx.symbol, sign, opportunity_id=oid, parent={**ch, "timeframe": tf}, child=None,
                           execution_tf=EXECUTION[tf], channel_role=f"BROKEN_RANGE_{'UPPER' if sign > 0 else 'LOWER'}",
                           trigger_type="RANGE_BREAK_RETEST", detector_state="RETEST_HELD" if hold else "RETESTING" if retest else "BREAK_CONFIRMED",
                           evidence=evidence, confirmation=confirmation, ctx=ctx, confidence=float(ch.get("confidence") or 0), entry_quality=None,
                           room=None, campaign_id=_hid("CAMPAIGN", ctx.symbol, sign), episode_id=_hid(oid, "range"),
                           trigger_ts=brk.get("lastRetestTs") if hold else None, trigger_price=brk.get("price"), data_ts=ch.get("lastBarTs"), data_tf=tf,
                           detail={"breakout": brk}))
    return out


# ---------------------------------------------------------------- lifecycle, stages, explanations

def lifecycle(h: dict[str, Any], ctx: Context) -> tuple[str, str | None]:
    """Generic lifecycle plus what the opportunity is waiting for. Stage 8/9 states are overlaid afterwards."""
    conf = h["confirmation"]
    result = conf["result"]
    det = str(h.get("detectorState") or "")
    if h.pop("_expired", False):
        return "EXPIRED", "A NEW EPISODE"
    if result == ot.INVALIDATED:
        return "INVALIDATED", None
    if result == ot.INSUFFICIENT_HISTORY:
        return "WATCHING", "SUFFICIENT_HISTORY"
    if result == ot.STALE:
        return "WAITING", "FRESH_DATA"
    if ctx.missed:
        return "WAITING", "NEW_CONFIRMATION_AFTER_RECONNECT"
    if conf["confirmed"]:
        econ_state, blocks, _ = ctx.econ_state()
        if blocks:
            return "BLOCKED", f"ECONOMIC_GATE_{(ctx.econ or {}).get('code') or econ_state}"
        if h.get("entryQuality") == "EXTENDED":
            return "WAITING", "EXTENDED_WAIT_RETEST"
        return "READY_FOR_RISK", "STAGE_8_RISK_EVALUATION"
    missing = conf["missingEvidence"]
    if det == "BOUNDARY_APPROACH":
        return "TRIGGER_APPROACHING", "BOUNDARY_ZONE"
    if det in br.CONTACT_STATES:
        return "TRIGGER_REACHED", "DIRECTIONAL_REACTION"
    if det in ("REACTION_PENDING", "REACTION_DETECTED"):
        return "CONFIRMING", "REACTION_CONFIRMATION"
    if det == "REACTION_CONFIRMED" and missing:
        return "WAITING", missing[0]
    if h["opportunityType"] in ("OP-06", "OP-07", "OP-12"):
        ev = h["evidence"]
        if not ev.get("CHANNEL_BREAK") and not ev.get("RANGE_BREAK"):
            return "TRIGGER_APPROACHING", "CHANNEL_BREAK"
        if not ev.get("BREAK_CONFIRMED"):
            return "TRIGGER_REACHED", "BREAK_CONFIRMATION"
        if not ev.get("RETEST"):
            return "WATCHING", "RETEST"
        return "CONFIRMING", missing[0] if missing else None
    if missing:
        return ("CONFIRMING" if len(missing) < len(conf["requiredEvidence"]) else "WATCHING"), missing[0]
    return "WATCHING", None


def stages(h: dict[str, Any], ctx: Context, stage8: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    op = h["opportunityType"]
    conf = h["confirmation"]
    shadow = h["mode"] != "PRODUCTION"
    econ_state, blocks, econ_reason = ctx.econ_state()
    fresh = h["dataFreshness"]
    parent = h.get("parentStructure") or {}
    s4 = (f"Discovered by the all-instrument light scan · Stage 4 rank {ctx.rank if ctx.rank is not None else '—'} is not a gate for this opportunity"
          if h["route"] not in ("OP-01:LEGACY_H1",) else "Existing route: Stage 4 PROMOTED → Stage 6 READY_FOR_H1")
    vis = h["detail"].get("reaction") or {}
    s5 = (f"{parent.get('timeframe')} {parent.get('direction')} channel {parent.get('status')} · {h['detectorState']}"
          + (f" · zone {vis.get('zone', {}).get('low')}–{vis.get('zone', {}).get('high')}" if vis.get("zone") else ""))
    s8 = {"status": "NOT_REACHED", "detail": "Stage 8 evaluates only READY_FOR_RISK opportunities"}
    if h["lifecycle"] == "READY_FOR_RISK" or stage8:
        if shadow:
            sh = SHADOW_STAGE8.get(h["opportunityId"])
            s8 = {"status": "SHADOW", "detail": "SHADOW — not submitted to Stage 8 authorization"
                  + (f" · setup pre-qualification {sh.get('setupState')} ({sh.get('setupReasonCode')})" if sh else " · awaiting Stage 8 shadow pre-qualification")}
        elif stage8:
            s8 = {"status": stage8.get("state") or "EVALUATING", "detail": stage8.get("reason") or "Stage 8 evaluated this campaign"}
        else:
            s8 = {"status": "EVALUATING", "detail": "Handed to Stage 8 through the existing route"}
    return {
        "1": {"name": "DATA", "status": fresh["state"], "detail": f"{fresh.get('timeframe')} closed bars · last {_iso(fresh.get('lastBarTs')) if fresh.get('lastBarTs') else 'unknown'}"},
        "2": {"name": "STRENGTH", "status": h["strength"], "detail": "Stage 3 pair bias relative to this opportunity (not a gate unless the contract requires it)"},
        "3": {"name": "REGIME", "status": h["regime"]["compatibility"], "detail": f"{h['regime']['label']} — advisory compatibility for {op}"},
        "4": {"name": "DISCOVERY", "status": "DISCOVERED", "detail": s4},
        "5": {"name": "VISION", "status": parent.get("status") or "—", "detail": s5},
        "6": {"name": "STRUCTURE", "status": h["stage6"], "detail": f"Stage 6 {ctx.direction.get('state') or 'n/a'} relative to {op} {h['direction']}"},
        "7": {"name": "CONFIRMATION", "status": conf["result"], "detail": f"Contract {conf['contractId']} · satisfied {len(conf['satisfiedEvidence'])}/{len(conf['requiredEvidence'])}"},
        "8": s8,
        "9": {"name": "EXECUTION", "status": "NOT_ELIGIBLE" if shadow else "AWAITING_AUTHORIZATION",
              "detail": "Shadow routes never reach Stage 9" if shadow else "Stage 9 executes only Stage 8 authorizations (idempotent key)"},
        "10": {"name": "LEARNING", "status": "RECORDING", "detail": f"Transitions and counterfactual outcome recorded under {op}"},
        "econ": {"name": "ECONOMIC", "status": econ_state, "detail": econ_reason or "", "blocksNewEntries": blocks},
    }


def explain(h: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    conf = h["confirmation"]
    why: list[dict[str, Any]] = []
    for key in conf["requiredEvidence"]:
        why.append({"ok": key in conf["satisfiedEvidence"], "kind": "REQUIRED", "evidence": key, "text": ot.EVIDENCE[key]["label"]})
    for item in conf["optionalEvidence"]:
        why.append({"ok": None if not item["present"] else True, "kind": "OPTIONAL", "evidence": item["evidence"],
                    "text": f"{ot.EVIDENCE[item['evidence']]['label']} — {'present' if item['present'] else 'absent'} (optional)"})
    for item in conf["notRequired"]:
        why.append({"ok": None, "kind": "NOT_REQUIRED", "evidence": item["evidence"],
                    "text": f"{ot.EVIDENCE[item['evidence']]['label']} — {'present' if item['present'] else 'not present'} (not required)"})
    for key in conf["deferredEvidence"]:
        owner = "Stage 8" if ot.EVIDENCE[key]["stage"] == 8 else "the economic new-entry gate"
        if key == "ECON_PERMITS":
            ok = not ((h.get("stages") or {}).get("econ") or {}).get("blocksNewEntries", True)
            why.append({"ok": ok, "kind": "GATE", "evidence": key, "text": f"{ot.EVIDENCE[key]['label']} — {owner}"})
            continue
        why.append({"ok": None, "kind": "DEFERRED", "evidence": key, "text": f"{ot.EVIDENCE[key]['label']} — evaluated by {owner}"})
    not_ready = []
    if h["lifecycle"] != "READY_FOR_RISK":
        for key in conf["missingEvidence"]:
            not_ready.append(f"Missing: {ot.EVIDENCE[key]['label']}" + (" (not measurable)" if key in conf.get("unmeasured", []) else ""))
        if conf.get("invalidationReason"):
            not_ready.append(f"Invalidated: {conf['invalidationReason']}")
        if h.get("waitingFor"):
            not_ready.append(f"Waiting for: {h['waitingFor']}")
    if h["mode"] != "PRODUCTION":
        not_ready.append(f"{h['mode']} route — classified and audited, never authorized for capital during validation")
    return why, not_ready


def relationships(hyps: list[dict[str, Any]]) -> None:
    by_symbol: dict[str, list[dict[str, Any]]] = {}
    for h in hyps:
        by_symbol.setdefault(h["symbol"], []).append(h)
        h["relationships"] = []
    for items in by_symbol.values():
        for a in items:
            for b in items:
                if a is b:
                    continue
                kind = None
                if a.get("invalidates") and a["invalidates"] == b["opportunityId"]:
                    kind = "INVALIDATES"
                elif a.get("supersedes") and b["opportunityType"] == a["supersedes"] and a.get("candidateId") == b.get("candidateId"):
                    kind = "SUPERSEDES"
                elif a.get("episodeId") and a["episodeId"] == b.get("episodeId"):
                    kind = "SAME_EPISODE"
                elif a["direction"] != b["direction"]:
                    kind = "INVALIDATES" if a["opportunityType"] == "OP-10" and a["confirmation"]["confirmed"] and b["opportunityType"] in ("OP-01", "OP-02", "OP-03") else "CONFLICTING"
                elif a["campaignId"] and a["campaignId"] == b.get("campaignId"):
                    kind = "SAME_EPISODE" if a.get("channelId") and a.get("channelId") == b.get("channelId") and a["opportunityType"] == b["opportunityType"] else "RELATED"
                else:
                    kind = "RELATED"
                a["relationships"].append({"to": b["opportunityId"], "type": b["opportunityType"], "kind": kind})
    # One campaign budget per instrument and direction. The most mature hypothesis is the risk owner; the rest share it.
    groups: dict[str, list[dict[str, Any]]] = {}
    for h in hyps:
        groups.setdefault(f"{h['symbol']}|{h['direction']}", []).append(h)
    for key, items in groups.items():
        items.sort(key=lambda h: (h["mode"] != "PRODUCTION", -MATURITY.get(h["lifecycle"], 0), -h["confidence"]))
        for i, h in enumerate(items):
            h["riskGroup"] = key
            h["riskRole"] = "PRIMARY" if i == 0 else "SHARED_BUDGET"


def shadow_handoff(h: dict[str, Any]) -> dict[str, Any] | None:
    """Campaign-style Stage 8 input for SHADOW pre-qualification only. `executable` stays False on the record."""
    room = h.get("room") or {}
    if h["mode"] == "PRODUCTION" or h["lifecycle"] != "READY_FOR_RISK" or room.get("invalidation") is None or room.get("target") is None:
        return None
    rx = (h.get("detail") or {}).get("reaction") or {}
    revision = h.get("triggerTime") or (h.get("dataFreshness") or {}).get("lastBarTs")
    try:
        import campaign
    except ImportError:  # pragma: no cover
        from bridge.mt5 import campaign  # type: ignore
    bar_ts = (h.get("dataFreshness") or {}).get("lastBarTs")
    tf = h.get("executionTimeframe") or "H1"
    return {
        "handoffKind": "CAMPAIGN", "executable": False, "shadow": True, "opportunityId": h["opportunityId"], "opportunityType": h["opportunityType"],
        "campaignId": h["campaignId"], "legType": "P1" if ot.LEGS[h["opportunityType"]]["p1"] else "P2", "setupRevision": revision,
        "episodeId": h.get("episodeId"),
        "executionKey": campaign.execution_key(str(h["campaignId"]), "P1" if ot.LEGS[h["opportunityType"]]["p1"] else "P2", revision, h.get("episodeId")),
        "instrument": h["symbol"], "direction": h["direction"], "opportunityFamily": h["opportunityCode"], "TiTLevel": h.get("TiTLevel"),
        "parentTimeframe": h.get("parentTimeframe"), "childTimeframe": h.get("childTimeframe"), "executionTimeframe": tf,
        "barSeconds": TF_SEC.get(tf, 3600), "barTs": bar_ts, "lastClose": room.get("entry") if rx.get("lastClose") is None else rx.get("lastClose"),
        "confirmedSince": _iso((h.get("triggerTime") or bar_ts or 0) + TF_SEC.get(tf, 3600)) if (h.get("triggerTime") or bar_ts) else None,
        "confidence": h["confidence"], "atr": rx.get("atr") or (h.get("detail") or {}).get("reentry", {}).get("atr"),
        "invalidationLevel": room["invalidation"], "targetPrice": room["target"],
        "entry": {"timing": "REACTION", "classification": h.get("entryQuality")}, "trigger": {"type": h["triggerType"], "ts": h.get("triggerTime")},
        "reason": f"{h['opportunityType']} {h['opportunityName']} (shadow)", "legRisk": CONFIG["campaignBudgetPct"],
        "campaign": {"campaignId": h["campaignId"], "allocatedRisk": CONFIG["campaignBudgetPct"], "usedRisk": 0, "remainingRisk": CONFIG["campaignBudgetPct"]},
        "executes": False,
    }


# ---------------------------------------------------------------- light scan + build

def light_scan(symbols: list[str], channels: dict[str, dict[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    """Cheap per-channel position check for all instruments. Only candidates inside a band are escalated."""
    found = []
    lo_band, hi_band = CONFIG["internalBandPct"]
    for symbol in symbols:
        for tf in PARENT_TFS:
            ch = (channels.get(symbol) or {}).get(tf) or {}
            status, direction, pos = str(ch.get("status") or ""), str(ch.get("direction") or ""), ch.get("position")
            if status not in CHANNEL_OK or pos is None:
                continue
            if direction == "RANGE":
                if float(pos) <= CONFIG["rangeBandPct"]:
                    found.append({"symbol": symbol, "timeframe": tf, "opportunityType": "OP-11", "sign": 1, "position": pos})
                if float(pos) >= 100 - CONFIG["rangeBandPct"]:
                    found.append({"symbol": symbol, "timeframe": tf, "opportunityType": "OP-11", "sign": -1, "position": pos})
                continue
            sign = _sign(direction)
            if sign == 0:
                continue
            tp = _trade_pos(pos, sign)
            if tp is not None and tp <= CONFIG["boundaryBandPct"]:
                found.append({"symbol": symbol, "timeframe": tf, "opportunityType": "OP-01", "sign": sign, "position": pos})
            if tp is not None and lo_band < tp <= hi_band:
                found.append({"symbol": symbol, "timeframe": tf, "opportunityType": "OP-02", "sign": sign, "position": pos})
    return found


def build(symbols: list[str], channels: dict[str, dict[str, dict[str, Any]]], legacy: dict[str, Any], src: Any, *,
          directions: dict[str, dict[str, Any]] | None = None, ranks: dict[str, int] | None = None,
          breakouts: list[dict[str, Any]] | None = None, econ: dict[str, dict[str, Any]] | None = None,
          bias: dict[str, Any] | None = None, stage7: dict[str, dict[str, Any]] | None = None,
          stage8: dict[str, dict[str, Any]] | None = None, now: float | None = None, missed: bool = False) -> dict[str, Any]:
    started = time.time()
    now = float(now if now is not None else time.time())
    errors: list[dict[str, Any]] = []
    try:
        snaps = src.snapshots(symbols)
    except Exception as exc:
        snaps = {}
        errors.append({"detector": "snapshots", "symbol": None, "opportunityType": None, "error": f"{type(exc).__name__}: {exc}", "ts": now})
    ctxs = {s: Context(s, channels.get(s) or {}, snaps.get(s) or {}, direction=(directions or {}).get(s), rank=(ranks or {}).get(s),
                       econ=None if econ is None else econ.get(s), bias=(bias or {}).get(s), now=now, missed=missed) for s in symbols}
    cache: dict[tuple, Any] = {}
    hyps: list[dict[str, Any]] = []
    diag: list[dict[str, Any]] = []

    def guard(detector: str, symbol: str | None, op: str | None, fn: Callable[[], Any]) -> Any:
        try:
            return fn()
        except Exception as exc:
            errors.append({"detector": detector, "symbol": symbol, "opportunityType": op, "error": f"{type(exc).__name__}: {exc}", "ts": now})
            return None

    candidates = light_scan(symbols, {s: {tf: ctxs[s].channel(tf) for tf in PARENT_TFS} for s in symbols})
    for cand in candidates:
        ctx = ctxs[cand["symbol"]]
        res = guard("boundary_reaction", cand["symbol"], cand["opportunityType"],
                    lambda c=cand, x=ctx: boundary_hypothesis(c["opportunityType"], x, src, c["timeframe"], c["sign"], cache))
        if res:
            rec, d = res
            diag.append(d)
            if rec:
                hyps.append(rec)
    hyps.extend(legacy_hypotheses(legacy.get("instruments") or [], ctxs, stage7))
    tit_by_level = {(h["symbol"], h.get("TiTLevel")): h["campaignId"] for h in hyps if h["route"].endswith(":TIT")}
    hyps.extend(guard("breakout_scanner", None, "OP-06", lambda: breakout_hypotheses(breakouts or [], ctxs, tit_by_level, cache, src)) or [])
    for symbol in symbols:
        ctx = ctxs[symbol]
        for detector, op, fn in (("structure", "OP-08", structural_hypothesis), ("reversal", "OP-10", reversal_hypothesis)):
            rec = guard(detector, symbol, op, lambda f=fn, x=ctx: f(x, src, cache))
            if rec:
                hyps.append(rec)
        hyps.extend(guard("failed_breakout", symbol, "OP-09", lambda x=ctx: failed_from_channels(x, src, cache)) or [])
        hyps.extend(guard("range_break", symbol, "OP-12", lambda x=ctx: range_break_hypotheses(x)) or [])
    seen: set[str] = set()
    unique = []
    for h in hyps:
        if h["opportunityId"] in seen:
            continue
        seen.add(h["opportunityId"])
        unique.append(h)
    hyps = unique
    for h in hyps:
        ctx = ctxs[h["symbol"]]
        h["lifecycle"], h["waitingFor"] = lifecycle(h, ctx)
        s8 = None
        if h["mode"] == "PRODUCTION" and stage8:
            s8 = stage8.get(str(h.get("campaignId"))) or (stage8.get(h["symbol"]) if h["route"] == "OP-01:LEGACY_H1" else None)
            if s8 and s8.get("state") == "AUTHORIZED":
                h["lifecycle"], h["waitingFor"] = "AUTHORIZED", "STAGE_9_EXECUTION"
        h["stage"] = LIFECYCLE_STAGE.get(h["lifecycle"], 4)
        h["stages"] = stages(h, ctx, s8)
        h["why"], h["whyNotReady"] = explain(h)
        h["nextStep"] = {"READY_FOR_RISK": "Stage 8 risk evaluation" if h["mode"] == "PRODUCTION" else "Shadow Stage 8 pre-qualification (no order)",
                         "AUTHORIZED": "Stage 9 execution"}.get(h["lifecycle"], h.get("waitingFor") or "Monitor")
        h["revision"] = _revision(h)
    relationships(hyps)
    handoffs = [x for x in (guard("shadow_handoff", h["symbol"], h["opportunityType"], lambda y=h: shadow_handoff(y)) for h in hyps) if x]
    hyps.sort(key=lambda h: (LIFECYCLE_STAGE.get(h["lifecycle"], 0) * -1, h["symbol"], h["opportunityType"]))
    return {
        "frameworkVersion": ot.FRAMEWORK_VERSION, "contractVersion": ot.CONTRACT_VERSION, "generatedAt": _iso(now),
        "summary": summarize(hyps, diag, candidates, symbols, channels_by=ctxs),
        "hypotheses": hyps, "shadowHandoffs": handoffs, "errors": errors[:50], "durationMs": int((time.time() - started) * 1000),
        "productionLimits": opportunity._production_limits(),
    }


def _revision(h: dict[str, Any]) -> str:
    sig = [h["opportunityType"], h["lifecycle"], h["detectorState"], h["confirmationState"], h.get("episodeId"), h.get("triggerTime")]
    return _hid(*sig)[:10]


def summarize(hyps: list[dict[str, Any]], diag: list[dict[str, Any]], candidates: list[dict[str, Any]], symbols: list[str],
              channels_by: dict[str, Context]) -> dict[str, Any]:
    by_type = {op: 0 for op in ot.TYPES}
    by_life: dict[str, int] = {}
    by_mode: dict[str, int] = {}
    for h in hyps:
        by_type[h["opportunityType"]] += 1
        by_life[h["lifecycle"]] = by_life.get(h["lifecycle"], 0) + 1
        by_mode[h["mode"]] = by_mode.get(h["mode"], 0) + 1
    bull = bear = 0
    for ctx in channels_by.values():
        for tf in PARENT_TFS:
            ch = ctx.channel(tf)
            if str(ch.get("status") or "") in CHANNEL_OK:
                s = _sign(ch.get("direction"))
                bull += s > 0
                bear += s < 0
    op01 = [h for h in hyps if h["route"] == "OP-01:BOUNDARY_REACTION"]
    op01_diag = [d for d in diag if d["opportunityType"] == "OP-01"]
    reached = {"BOUNDARY_ZONE_REACHED", "BOUNDARY_TOUCH", "BOUNDARY_PENETRATION", "REACTION_PENDING", "REACTION_DETECTED", "REACTION_CONFIRMED", "REACTION_FAILED", "BOUNDARY_BROKEN"}
    confirmed = [h for h in op01 if h["detectorState"] == "REACTION_CONFIRMED"]
    blocked8 = sum(1 for h in op01 if (SHADOW_STAGE8.get(h["opportunityId"]) or {}).get("setupState") not in (None, "QUALIFIED"))
    return {
        "universe": len(symbols), "scanned": len(symbols), "hypotheses": len(hyps), "byType": by_type, "byLifecycle": by_life, "byMode": by_mode,
        "lightScan": {"instruments": len(symbols), "escalated": len(candidates),
                      "byType": {op: sum(1 for c in candidates if c["opportunityType"] == op) for op in ("OP-01", "OP-02", "OP-11")}},
        "op01": {
            "validChannels": bull + bear, "bullishChannels": bull, "bearishChannels": bear,
            "nearBoundary": len(op01_diag), "approaching": sum(1 for d in op01_diag if d["state"] == "BOUNDARY_APPROACH"),
            "zoneReached": sum(1 for d in op01_diag if d["state"] in reached),
            "reactionsDetected": sum(1 for d in op01_diag if d["state"] in ("REACTION_DETECTED", "REACTION_CONFIRMED")),
            "reactionsConfirmed": len(confirmed), "withBos": sum(1 for h in confirmed if h["evidence"].get("BOS")),
            "withoutBos": sum(1 for h in confirmed if not h["evidence"].get("BOS")),
            "readyForRisk": sum(1 for h in op01 if h["lifecycle"] == "READY_FOR_RISK"), "blockedByStage8Shadow": blocked8,
            "insufficientHistory": sum(1 for d in op01_diag if d["state"] == "INSUFFICIENT_HISTORY"),
        },
        "legacyNormal": sum(1 for h in hyps if h["route"] == "OP-01:LEGACY_H1"),
        "shadowNeverQualified": True,
    }


def compact(state: dict[str, Any] | None) -> dict[str, Any] | None:
    """Small form for /autonomy/state. Full detail is served by /opportunity/framework."""
    if not state:
        return None
    keys = ("opportunityId", "opportunityType", "opportunityName", "badge", "symbol", "direction", "side", "mode", "lifecycle", "stage",
            "parentTimeframe", "executionTimeframe", "detectorState", "confirmationState", "missingEvidence", "waitingFor", "confidence",
            "entryQuality", "opportunityContext", "TiTLevel", "channelRole")
    return {"frameworkVersion": state.get("frameworkVersion"), "generatedAt": state.get("generatedAt"), "summary": state.get("summary"),
            "hypotheses": [{k: h.get(k) for k in keys} for h in state.get("hypotheses") or []], "errors": len(state.get("errors") or []),
            "durationMs": state.get("durationMs")}
