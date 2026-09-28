"""Stage 6 Structural Direction: autonomous multi-timeframe decision engine (pure, no I/O).

Inputs are the published outputs of the upstream stages — never recalculated here:
  * Stage 4 Market Scanner instrument record (which carries the Stage 2 strength legs and Stage 3 regimes it used)
  * Stage 5 HTF Market Vision instrument output (D1/H8 channel state, phase, position, breakout, invalidation)

D1 is the primary authority and is never flipped because H8 or H1 points the other way.
An opposing H8 move inside a healthy D1 channel is a correction. `marketLeg` records the
dominant trend, the current leg, and any counter-trend candidate separately. Only an H8
structural reversal against deteriorating D1 evidence produces CONFLICT/BLOCKED.
Stage 6 publishes structural decisions only; it never executes trades.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import leg_model

DIRECTIONS = ("STRONG_BULLISH", "BULLISH", "NEUTRAL", "BEARISH", "STRONG_BEARISH")
STATES = ("WAITING", "ANALYSING", "ALIGNED", "CONFLICT", "BLOCKED", "STALE", "INVALIDATED", "READY_FOR_H1")
ALIGNMENTS = ("ALIGNED", "PULLBACK", "D1_ONLY", "CONFLICT", "UNCONFIRMED")

DETERIORATING_PHASES = ("DETERIORATION", "FAILED_BREAKOUT", "REVERSAL_RISK")

CONFIG: dict[str, Any] = {
    "readyScore": 55,          # structural confidence required for READY_FOR_H1
    "strongScore": 75,         # structural confidence required for a STRONG_ direction
    "minD1Confidence": 40,     # Stage 5 D1 confidence below this counts as deteriorating D1 evidence
    "valuePct": 40,            # trend-relative channel position at or below this is the value zone
    "extendedPct": 85,         # trend-relative position at or above this is extended (wait for a pullback)
    "staleRunSec": 1800,       # Stage 5 engine silent for longer than this -> STALE_DATA
    "diffFull": 8.0,           # |strength differential| earning full credit
    "weights": {
        "d1": 35, "h8Aligned": 15, "h8Pullback": 8, "h8Against": -20,
        "macro": 15, "macroAgainst": -20, "differential": 10, "regime": 5,
        "momentum": 5, "persistence": 5, "position": 10, "phase": 5,
    },
}

PHASE_POINTS = {
    "RETEST": 5, "PULLBACK": 5, "BREAKOUT": 2, "IMPULSE": 2, "REVERSAL": 0, "CONSOLIDATION": 0, "COMPRESSION": 0,
    "DETERIORATION": -10, "FAILED_BREAKOUT": -8, "REVERSAL_RISK": -10,
}


def dir_sign(d: str | None) -> int:
    return 1 if d in ("BULLISH", "STRONG_BULLISH") else -1 if d in ("BEARISH", "STRONG_BEARISH") else 0


def _label(sign: int) -> str:
    return "BULLISH" if sign > 0 else "BEARISH" if sign < 0 else "NEUTRAL"


def _ts(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _r(x: Any, n: int = 1) -> float | None:
    return None if x is None else round(float(x), n)


# ---------------------------------------------------------------- upstream views (read only)

def _leg(x: dict[str, Any] | None) -> dict[str, Any] | None:
    if not x:
        return None
    return {k: x.get(k) for k in ("asset", "composite", "macro", "current", "momentum", "regime", "group", "confidence",
                                  "persistence", "trajectory", "date")}


def scanner_view(sc: dict[str, Any] | None) -> dict[str, Any] | None:
    if not sc:
        return None
    fresh = sc.get("freshness") or {}
    return {
        "state": sc.get("state"), "promoted": sc.get("state") == "PROMOTED", "promotedAt": sc.get("promotedAt"),
        "direction": sc.get("direction") or "NEUTRAL", "conviction": sc.get("conviction"), "confidence": sc.get("confidence"),
        "differential": sc.get("differential"), "macroBias": sc.get("macroBias"), "relationship": sc.get("relationship"),
        "alignment": sc.get("alignment"), "trajectory": sc.get("trajectory"), "acceleration": sc.get("acceleration"),
        "persistence": sc.get("persistence"), "reason": sc.get("reason"), "rank": sc.get("rank"),
        "freshness": fresh.get("status"), "freshnessReason": fresh.get("reason"), "updatedAt": sc.get("updatedAt"),
        "base": _leg(sc.get("base")), "quote": _leg(sc.get("quote")),
    }


def tf_view(v: dict[str, Any] | None, tf: str) -> dict[str, Any]:
    x = (v or {}).get(tf.lower()) or {}
    return {
        "dataStatus": x.get("dataStatus"), "dataReason": x.get("dataReason"), "status": x.get("status"),
        "direction": x.get("direction") or "NEUTRAL", "lean": x.get("lean"), "confirmed": bool(x.get("confirmed")),
        "phase": x.get("phase"), "position": x.get("position"), "confidence": float(x.get("confidence") or 0),
        "channelKey": x.get("channelKey"), "relationship": x.get("relationship"), "parentChannelId": x.get("parentChannelId"),
        "lastTs": x.get("lastTs"), "breakout": x.get("breakout"),
        "touches": x.get("touches"), "available": x.get("available"), "required": x.get("required"), "reason": x.get("reason"),
    }


def positions(v: dict[str, Any] | None) -> dict[str, Any]:
    """Current price position in the D1/H8 channels: live Stage 5 boundary monitor first, closed bar otherwise."""
    live = (v or {}).get("live") or {}
    d1 = (v or {}).get("d1") or {}
    h8 = (v or {}).get("h8") or {}
    ld1, lh8 = live.get("positionD1"), live.get("positionH8")
    src = "LIVE" if ld1 is not None else "CLOSE"
    return {"d1": _r(ld1 if ld1 is not None else d1.get("position")), "h8": _r(lh8 if lh8 is not None else h8.get("position")),
            "source": src, "price": live.get("price"), "marketOpen": live.get("marketOpen"), "at": live.get("at")}


def zone(pos: float | None, sign: int, cfg: dict[str, Any]) -> tuple[str, float | None]:
    """Trend-relative zone: 0 = the side the trend should hold (support in an uptrend), 100 = the extension side."""
    if pos is None or sign == 0:
        return "UNKNOWN", None
    rel = pos if sign > 0 else 100 - pos
    if rel < 0:
        return "BEYOND_SUPPORT", round(rel, 1)
    if rel > 100:
        return "BEYOND_EXTENSION", round(rel, 1)
    if rel <= cfg["valuePct"]:
        return "VALUE", round(rel, 1)
    if rel >= cfg["extendedPct"]:
        return "EXTENDED", round(rel, 1)
    return "MID", round(rel, 1)


def freshness(v: dict[str, Any] | None, sv: dict[str, Any] | None, vision_run_at: str | None, now_ts: float,
              cfg: dict[str, Any]) -> dict[str, Any]:
    run_ts = _ts(vision_run_at)
    age = int(now_ts - run_ts) if run_ts else None
    out = {"status": "CURRENT", "reason": "", "visionRunAt": vision_run_at, "visionRunAgeSec": age,
           "visionAnalysedAt": (v or {}).get("analysedAt"), "scanner": (sv or {}).get("freshness"),
           "d1LastTs": ((v or {}).get("d1") or {}).get("lastTs"), "h8LastTs": ((v or {}).get("h8") or {}).get("lastTs")}
    if v is None:
        out.update(status="UNKNOWN", reason="No Stage 5 output")
    elif age is not None and age > cfg["staleRunSec"]:
        out.update(status="STALE", reason=f"Stage 5 last ran {age // 60} min ago (limit {cfg['staleRunSec'] // 60} min)")
    elif v.get("status") == "STALE":
        out.update(status="STALE", reason=f"Stage 5 STALE — {v.get('reason')}")
    elif sv and sv.get("freshness") == "STALE":
        out.update(status="STALE", reason=f"Stage 4 strength STALE — {sv.get('freshnessReason')}")
    else:
        out["reason"] = "Stage 4 strength and Stage 5 D1/H8 structure current"
    return out


# ---------------------------------------------------------------- decision

def _blank(symbol: str, sv: dict[str, Any] | None, v: dict[str, Any] | None, d1: dict[str, Any], h8: dict[str, Any],
           pos: dict[str, Any], fresh: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": symbol, "state": "WAITING", "direction": "NEUTRAL", "expectedDirection": "NEUTRAL",
        "reasonCode": None, "reason": "", "explanation": "", "structuralPhase": None, "alignment": "UNCONFIRMED",
        "confidence": 0.0, "components": [], "conflicts": [], "invalidation": [], "readyForH1": False, "handoff": None,
        "upstream": {
            "scanner": sv,
            "vision": None if v is None else {
                "status": v.get("status"), "reason": v.get("reason"), "primaryDirection": v.get("primaryDirection"),
                "agreement": v.get("agreement"), "phase": v.get("phase"), "confidence": v.get("confidence"),
                "qualified": bool((v.get("scanner") or {}).get("qualified")), "analysedAt": v.get("analysedAt"),
                "trigger": v.get("trigger"),
            },
        },
        "d1": d1, "h8": h8, "position": pos, "zone": {"name": "UNKNOWN", "relative": None}, "freshness": fresh,
        "executes": False,
    }


def _market_leg(out: dict[str, Any]) -> dict[str, Any]:
    """Attach the nested-leg classification without changing the Stage 6 state machine."""
    d1, h8, pos = out.get("d1") or {}, out.get("h8") or {}, out.get("position") or {}
    fresh = out.get("freshness") or {}
    boundary = d1.get("status") == "BROKEN"
    h1 = out.get("h1") or {}
    h1_confirmed = bool(h1.get("confirmed") and h1.get("relationship") in ("CORRECTIVE", "ALIGNED", "REVERSAL_CANDIDATE"))
    out["marketLeg"] = leg_model.classify(
        dominant_direction=d1.get("direction") if d1.get("confirmed") else "NEUTRAL",
        position=pos.get("d1"),
        d1_confirmed=bool(d1.get("confirmed")),
        d1_status=d1.get("status"),
        d1_phase=d1.get("phase"),
        d1_confidence=float(d1.get("confidence") or 0),
        h8_direction=h8.get("direction"),
        h8_confirmed=bool(h8.get("confirmed")),
        h1_bias=dir_sign(h1.get("direction")) if h1_confirmed else 0,
        h1_confirmed_break=bool(h1_confirmed and h1.get("relationship") == "CORRECTIVE"),
        stale=fresh.get("status") == "STALE",
        d1_boundary_failed=boundary,
        htf_bos=bool(d1.get("breakout")),
    )
    leg = out["marketLeg"]
    entry = leg.get("entryDirection")
    out["primaryStructure"] = leg.get("dominantTrend")
    out["currentTradableDirection"] = "BULLISH" if entry == "LONG" else "BEARISH" if entry == "SHORT" else "NEUTRAL"
    trade = str(leg.get("tradeType") or "NONE")
    out["setupRelationship"] = "COUNTER_TREND" if trade.startswith("COUNTER") else "TREND_CONTINUATION" if trade.startswith("TREND") else leg.get("relationship")
    out["parentStructure"] = "INTACT" if leg.get("reversalState") in (None, "NONE", "FAILED") else leg.get("reversalState")
    return out


def _gate(out: dict[str, Any], state: str, code: str, reason: str) -> dict[str, Any]:
    out.update(state=state, reasonCode=code, reason=reason[:500])
    out["explanation"] = f"{state.replace('_', ' ')} — {code}: {reason}"[:900]
    _market_leg(out)
    return out


def evaluate(symbol: str, sc: dict[str, Any] | None, v: dict[str, Any] | None, vision_run_at: str | None,
             now_ts: float, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or CONFIG
    w = cfg["weights"]
    sv = scanner_view(sc)
    d1, h8 = tf_view(v, "D1"), tf_view(v, "H8")
    pos = positions(v)
    fresh = freshness(v, sv, vision_run_at, now_ts, cfg)
    out = _blank(symbol, sv, v, d1, h8, pos, fresh)
    out["h1"] = tf_view(v, "H1")
    if v:
        out["invalidation"] = list(v.get("invalidation") or [])

    # ---- upstream gates: exact reason, never a manufactured direction
    if sv is None:
        return _gate(out, "WAITING", "WAITING_FOR_SCANNER", "Not yet ranked by the Stage 4 Market Scanner")
    if not sv["promoted"]:
        return _gate(out, "BLOCKED", "NOT_PROMOTED_BY_SCANNER", f"Stage 4 {sv['state']}: {sv['reason']}")
    if v is None:
        return _gate(out, "ANALYSING", "WAITING_FOR_HTF_VISION", "Promoted by Stage 4 — Stage 5 has not produced a D1/H8 analysis yet")
    promoted_ts, analysed_ts = _ts(sv.get("promotedAt")), _ts(v.get("analysedAt"))
    if not (v.get("scanner") or {}).get("qualified") or (promoted_ts and analysed_ts and analysed_ts < promoted_ts):
        return _gate(out, "ANALYSING", "WAITING_FOR_HTF_VISION",
                     f"Promoted by Stage 4 {sv.get('promotedAt') or ''} — Stage 5 D1/H8 re-analysis pending".replace("  ", " "))
    vst = v.get("status")
    if vst == "BLOCKED":
        tf = "D1" if d1["dataStatus"] == "BLOCKED" else "H8"
        return _gate(out, "BLOCKED", "DATA_BLOCKED", f"{v.get('reason')} ({tf} Stage 1 data blocked)")
    if vst in ("INSUFFICIENT_DATA", "WARMING_UP"):
        short_d1 = d1["dataStatus"] in ("INSUFFICIENT_DATA", "WARMING_UP")
        code = "INSUFFICIENT_D1_HISTORY" if short_d1 else "INSUFFICIENT_H8_HISTORY"
        tfv = d1 if short_d1 else h8
        return _gate(out, "WAITING" if vst == "WARMING_UP" else "BLOCKED", code, tfv["dataReason"] or v.get("reason") or code)

    # ---- D1 authority
    if d1["status"] == "INVALIDATED":
        out["structuralPhase"] = d1["phase"]
        return _gate(out, "INVALIDATED", "D1_CHANNEL_INVALIDATED",
                     f"D1 channel invalidated ({(d1.get('reason') or '').split(';')[0] or 'retired'}) — a new D1 structure is required")
    if d1["status"] in (None, "NONE", "FORMING") or not d1["confirmed"]:
        out["structuralPhase"] = d1["phase"]
        what = "no D1 channel detected" if d1["status"] in (None, "NONE") else "D1 channel still FORMING (needs a third anchor touch and opposite confirmation)"
        lean = f"; lean {d1['lean']}" if d1.get("lean") and d1["lean"] != "NEUTRAL" else ""
        return _stale_or(out, fresh, "WAITING", "CHANNEL_NOT_VALIDATED", f"{what}{lean}")
    s = dir_sign(d1["direction"])
    if s == 0:
        out["structuralPhase"] = d1["phase"] or "CONSOLIDATION"
        return _stale_or(out, fresh, "WAITING", "NEUTRAL_STRUCTURE",
                         f"D1 {d1['status'].lower()} channel is horizontal — no structural direction to hand to H1")

    # ---- H8 refinement
    h8_data_ok = h8["dataStatus"] in ("READY", "STALE")
    h8s = dir_sign(h8["direction"]) if h8_data_ok and h8["confirmed"] else 0
    brk = h8.get("breakout") or {}
    h8_break_against = h8_data_ok and bool(brk) and h8["status"] in ("BROKEN", "RETESTING") and \
        (1 if brk.get("side") == "UP" else -1) == -s
    d1_det = []
    if d1["status"] == "WEAKENING":
        d1_det.append("D1 channel WEAKENING")
    if d1["phase"] in DETERIORATING_PHASES:
        d1_det.append(f"D1 phase {d1['phase']}")
    if d1["confidence"] < cfg["minD1Confidence"]:
        d1_det.append(f"D1 confidence {d1['confidence']:.0f} < {cfg['minD1Confidence']}")
    counter = h8s == -s or h8_break_against
    h8_lean = dir_sign(h8.get("lean")) if h8_data_ok and not h8["confirmed"] else 0

    conflicts: list[str] = []
    if h8s == s:
        alignment = "ALIGNED"
    elif counter and d1_det:
        alignment = "CONFLICT"
        what = "broke its channel against" if h8_break_against else f"{h8['direction'].lower()} channel opposes"
        conflicts.append(f"H8 {what} the D1 {_label(s).lower()} structure while {', '.join(d1_det)} — reversal risk, not a pullback")
    elif counter:
        alignment = "PULLBACK"
    else:
        alignment = "D1_ONLY"

    # ---- structural phase
    d1_brk = d1.get("breakout") or {}
    if d1["status"] == "RETESTING":
        phase = "RETEST"
    elif d1["status"] == "BROKEN" and not d1["direction"].startswith("STRONG") and d1_brk:
        phase = "REVERSAL"
    elif d1["status"] == "BROKEN" and d1["phase"] == "BREAKOUT":
        phase = "BREAKOUT"
    elif alignment == "PULLBACK" or (alignment == "D1_ONLY" and h8_lean == -s and not d1_det):
        phase = "PULLBACK"
    elif alignment == "ALIGNED" and h8["phase"] in ("PULLBACK", "IMPULSE", "RETEST", "COMPRESSION") and d1["phase"] not in DETERIORATING_PHASES:
        phase = h8["phase"]
    else:
        phase = d1["phase"] or "CONSOLIDATION"

    zname, zrel = zone(pos["d1"], s, cfg)
    out["zone"] = {"name": zname, "relative": zrel}
    breakout_phase = phase in ("BREAKOUT", "RETEST", "REVERSAL")

    # ---- scoring contributions
    comps: list[dict[str, Any]] = []

    def add(key: str, label: str, pts: float, mx: float, detail: str) -> None:
        comps.append({"key": key, "label": label, "points": round(pts, 1), "max": mx, "detail": detail})

    add("d1", "D1 primary structure", w["d1"] * min(1.0, d1["confidence"] / 95), w["d1"],
        f"D1 {d1['status']} {d1['direction']} channel · Stage 5 confidence {d1['confidence']:.0f}")
    if alignment == "ALIGNED":
        add("h8", "H8 refinement", w["h8Aligned"] * (0.5 + 0.5 * min(1.0, h8["confidence"] / 95)), w["h8Aligned"],
            f"H8 {h8['status']} {h8['direction']} agrees with D1 (confidence {h8['confidence']:.0f})")
    elif alignment == "PULLBACK":
        add("h8", "H8 refinement", w["h8Pullback"], w["h8Aligned"],
            f"H8 {'break' if h8_break_against else h8['direction']} against a healthy D1 channel — corrective pullback inside the D1 trend")
    elif alignment == "CONFLICT":
        add("h8", "H8 refinement", w["h8Against"], w["h8Aligned"], conflicts[-1])
    else:
        add("h8", "H8 refinement", 0, w["h8Aligned"],
            f"H8 {h8['status'] or h8['dataStatus'] or 'n/a'} — no confirmed H8 channel" + (f", lean {h8['lean']}" if h8.get("lean") else ""))

    ms = dir_sign(sv["direction"])
    conv = float(sv.get("conviction") or 0)
    if ms == s:
        add("macro", "Scanner / macro bias", w["macro"] * min(1.0, conv / 100), w["macro"],
            f"Stage 4 {sv['direction']} · conviction {conv:.0f} agrees with D1")
    elif ms == -s:
        add("macro", "Scanner / macro bias", w["macroAgainst"], w["macro"], f"Stage 4 {sv['direction']} opposes the D1 {_label(s).lower()} structure")
        conflicts.append(f"Stage 4 macro bias {sv['direction']} (conviction {conv:.0f}) opposes the D1 {_label(s).lower()} channel")
    else:
        add("macro", "Scanner / macro bias", 0, w["macro"], "Stage 4 bias neutral")

    diff = sv.get("differential")
    if diff is not None:
        ds = 1 if diff > 0 else -1 if diff < 0 else 0
        frac = min(1.0, abs(diff) / cfg["diffFull"])
        add("differential", "Strength differential", w["differential"] * frac * (1 if ds == s else -1 if ds == -s else 0), w["differential"],
            f"{(sv.get('base') or {}).get('asset', 'base')} − {(sv.get('quote') or {}).get('asset', 'quote')} = {diff:+.2f} "
            f"({'supports' if ds == s else 'opposes' if ds == -s else 'flat vs'} D1)")
        if ds == -s and abs(diff) >= 1.5:
            conflicts.append(f"Strength differential {diff:+.2f} opposes the D1 structure")
    else:
        add("differential", "Strength differential", 0, w["differential"], "No Stage 2 differential")

    flip = 1 if ms == s else -1 if ms == -s else 0
    ra = {"ALIGNED": 1.0, "SUPPORTIVE": 0.6, "SIMILAR": -0.4, "CONFLICTING": -1.0}.get(sv.get("alignment") or "", 0.0)
    add("regime", "Regime alignment", w["regime"] * ra * (flip if ra > 0 else 1), w["regime"],
        f"Stage 3 {str(sv.get('relationship') or '—').replace('_', ' ')} · {sv.get('alignment') or 'UNCONFIRMED'}"
        + (" (behind the opposite bias)" if flip == -1 and ra > 0 else ""))
    traj = sv.get("trajectory")
    tm = {"WIDENING": 1, "NARROWING": -1}.get(traj or "", 0)
    add("momentum", "Momentum", w["momentum"] * tm * (flip or 1), w["momentum"],
        f"Strength gap {str(traj or 'flat').lower()} · acceleration {str(sv.get('acceleration') or 'steady').lower()}")
    pers = float(sv.get("persistence") or 0)
    add("persistence", "Persistence", w["persistence"] * pers / 100, w["persistence"], f"Regime persistence {pers:.0f}%")

    if breakout_phase:
        pp = w["position"] if phase == "RETEST" else w["position"] * 0.4
        add("position", "Channel position", pp, w["position"], f"{phase.lower()} — position measured against the broken boundary")
    else:
        pp = {"VALUE": 1.0, "MID": 0.4, "EXTENDED": -0.5, "BEYOND_SUPPORT": -1.0, "BEYOND_EXTENSION": -0.5}.get(zname, 0.0) * w["position"]
        add("position", "Channel position", pp, w["position"],
            f"D1 position {pos['d1']:.0f}% ({pos['source'].lower()}) → {zname.replace('_', ' ').lower()} zone for a {_label(s).lower()} trend"
            if pos["d1"] is not None else "No D1 channel position")
    add("phase", "Structural phase", PHASE_POINTS.get(phase, 0) + (-5 if h8_break_against and alignment == "PULLBACK" else 0), w["phase"],
        f"Phase {phase}" + (" · H8 channel broken against D1 (deep correction)" if h8_break_against and alignment == "PULLBACK" else ""))

    score = max(0.0, min(100.0, sum(c["points"] for c in comps)))
    if fresh["status"] == "STALE":
        score *= 0.6
    score = round(score, 1)
    out.update(components=comps, confidence=score, alignment=alignment, structuralPhase=phase)

    # ---- state
    macro_against = ms == -s
    if alignment == "CONFLICT" and macro_against:
        state, code = "BLOCKED", "STRUCTURAL_REVERSAL"
        reason = f"H8 reversal against deteriorating D1 and Stage 4 bias {sv['direction']} — structure no longer supports {_label(s).lower()}"
    elif alignment == "CONFLICT":
        state, code, reason = "CONFLICT", "H8_REVERSAL_AGAINST_D1", conflicts[0]
    elif macro_against:
        state, code = "CONFLICT", "SCANNER_STRUCTURE_CONFLICT"
        reason = f"Stage 4 {sv['direction']} bias conflicts with the D1 {d1['direction']} channel"
    elif d1_det and phase not in ("PULLBACK",):
        state, code = "WAITING", "D1_DETERIORATING"
        reason = f"{', '.join(d1_det)} — wait for D1 to reassert before H1 confirmation"
    elif zname == "BEYOND_SUPPORT" and not breakout_phase:
        state, code = "WAITING", "PRICE_BEYOND_D1_SUPPORT"
        reason = f"Live price {pos['d1']:.0f}% — outside the D1 {'lower' if s > 0 else 'upper'} boundary, unconfirmed until the D1 close"
    elif zname in ("EXTENDED", "BEYOND_EXTENSION") and not breakout_phase:
        state = "ALIGNED" if alignment == "ALIGNED" else "WAITING"
        code = "AWAITING_PULLBACK"
        reason = (f"Price extended at {pos['d1']:.0f}% of the D1 channel — wait for a pullback toward value"
                  if zname == "EXTENDED" else
                  f"Price at {pos['d1']:.0f}% — beyond the D1 {'upper' if s > 0 else 'lower'} boundary, an unconfirmed breakout until "
                  f"the D1 close; wait for a pullback or a confirmed breakout")
    elif score < cfg["readyScore"]:
        state = "ALIGNED" if alignment == "ALIGNED" else "WAITING"
        code, reason = "LOW_STRUCTURAL_CONFIDENCE", f"Structural confidence {score:.0f} below the READY threshold {cfg['readyScore']}"
    else:
        state = "READY_FOR_H1"
        code = {"PULLBACK": "READY_PULLBACK", "RETEST": "READY_RETEST", "BREAKOUT": "READY_BREAKOUT",
                "REVERSAL": "READY_REVERSAL"}.get(phase, "READY_CONTINUATION")
        reason = {
            "READY_PULLBACK": f"D1 {_label(s).lower()} channel intact; H8 correcting — Stage 7 monitors H1 for the pullback end",
            "READY_RETEST": f"D1 breakout retesting the broken boundary — Stage 7 monitors H1 for the retest hold",
            "READY_BREAKOUT": f"Fresh D1 breakout in the trend direction — Stage 7 monitors H1 for continuation or retest",
            "READY_REVERSAL": f"D1 channel broken {_label(s).lower()} with Stage 4 agreement — Stage 7 monitors H1 for the new trend",
        }.get(code, f"D1/H8 {alignment.replace('_', ' ').lower()} {_label(s).lower()} structure — Stage 7 monitors H1 for confirmation")

    if state in ("CONFLICT", "BLOCKED"):
        direction = "NEUTRAL"
    else:
        strong = score >= cfg["strongScore"] and (d1["direction"].startswith("STRONG") or (alignment == "ALIGNED" and ms == s))
        direction = ("STRONG_" if strong else "") + _label(s)
    out.update(direction=direction, expectedDirection=_label(s) if state not in ("CONFLICT", "BLOCKED") else "NEUTRAL",
               conflicts=conflicts)

    extra = [f"Stage 4 demotion or a {'bearish' if s > 0 else 'bullish'} bias flip withdraws the macro support"]
    if alignment == "PULLBACK":
        extra.append(f"H8 correction extending to a D1 close beyond the {'lower' if s > 0 else 'upper'} boundary converts the pullback into a D1 break")
    if d1_det:
        extra.append("Further D1 deterioration (WEAKENING → BROKEN against) invalidates the structural direction")
    out["invalidation"] = out["invalidation"] + extra

    if fresh["status"] == "STALE":
        state, code, reason = "STALE", "STALE_DATA", fresh["reason"]
    out.update(state=state, reasonCode=code, reason=reason[:500])
    out["explanation"] = explain(out)[:900]
    out["readyForH1"] = state == "READY_FOR_H1"
    _market_leg(out)
    if out["readyForH1"]:
        out["handoff"] = handoff(out)
    return out


def _stale_or(out: dict[str, Any], fresh: dict[str, Any], state: str, code: str, reason: str) -> dict[str, Any]:
    if fresh["status"] == "STALE":
        return _gate(out, "STALE", "STALE_DATA", f"{fresh['reason']} · {reason}")
    return _gate(out, state, code, reason)


def explain(o: dict[str, Any]) -> str:
    d1, h8, sv = o["d1"], o["h8"], o["upstream"]["scanner"] or {}
    bits = [f"{o['state'].replace('_', ' ')} ({o['reasonCode']}): {o['reason']}."]
    bits.append(f"D1 {d1['status']} {d1['direction'].replace('_', ' ').lower()} ({d1['confidence']:.0f}%) is the authority; "
                f"H8 {h8['status'] or 'n/a'} {h8['direction'].replace('_', ' ').lower()} → {o['alignment'].replace('_', ' ').lower()}.")
    bits.append(f"Stage 4 {sv.get('direction', 'n/a')} conviction {float(sv.get('conviction') or 0):.0f}, "
                f"differential {float(sv.get('differential') or 0):+.2f}.")
    if o["position"]["d1"] is not None:
        bits.append(f"Price at {o['position']['d1']:.0f}% of the D1 channel ({o['zone']['name'].replace('_', ' ').lower()}).")
    bits.append(f"Phase {o['structuralPhase']}, structural confidence {o['confidence']:.0f}.")
    if o["conflicts"]:
        bits.append("Conflicts: " + "; ".join(o["conflicts"]) + ".")
    return " ".join(bits)


def handoff(o: dict[str, Any]) -> dict[str, Any]:
    """Stage 6 → Stage 7 publication for one structurally valid candidate."""
    return {
        "instrument": o["symbol"], "expectedDirection": o["expectedDirection"], "direction": o["direction"],
        "d1": {k: o["d1"][k] for k in ("status", "direction", "phase", "confidence", "position")},
        "h8": {k: o["h8"][k] for k in ("status", "direction", "phase", "confidence", "position")},
        "phase": o["structuralPhase"], "alignment": o["alignment"], "reasonCode": o["reasonCode"],
        "channelPosition": o["position"]["d1"], "zone": o["zone"]["name"], "confidence": o["confidence"],
        "evidence": o["components"], "freshness": o["freshness"]["status"], "invalidation": o["invalidation"],
        "marketLeg": o.get("marketLeg"), "executes": False,
    }


def decision_signature(o: dict[str, Any]) -> tuple:
    leg = o.get("marketLeg") or {}
    return (o["state"], o["direction"], o["reasonCode"], o["structuralPhase"], o["alignment"], int(o["confidence"] // 5),
            leg.get("currentLeg"), leg.get("tradeType"), leg.get("reversalState"))


def evaluate_all(symbols: list[str], scanner_rows: dict[str, dict[str, Any]], vision_rows: dict[str, dict[str, Any]],
                 vision_run_at: str | None, now_ts: float, cfg: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    rows = [evaluate(s, scanner_rows.get(s), vision_rows.get(s), vision_run_at, now_ts, cfg) for s in symbols]
    order = {st: i for i, st in enumerate(("READY_FOR_H1", "ALIGNED", "WAITING", "CONFLICT", "ANALYSING", "STALE", "INVALIDATED", "BLOCKED"))}
    rows.sort(key=lambda r: (order.get(r["state"], 9), -r["confidence"], r["symbol"]))
    return rows


def counters(rows: list[dict[str, Any]]) -> dict[str, Any]:
    cand = [r for r in rows if r["reasonCode"] not in ("NOT_PROMOTED_BY_SCANNER", "WAITING_FOR_SCANNER")]
    return {
        "universe": len(rows),
        "candidates": len(cand),
        "analysed": sum(1 for r in cand if r["alignment"] != "UNCONFIRMED" or r["state"] in ("INVALIDATED",)
                        or r["reasonCode"] in ("CHANNEL_NOT_VALIDATED", "NEUTRAL_STRUCTURE")),
        "aligned": sum(1 for r in rows if r["alignment"] == "ALIGNED"),
        "pullbackWaiting": sum(1 for r in cand if r["structuralPhase"] == "PULLBACK" or r["state"] == "WAITING"),
        "conflicts": sum(1 for r in rows if r["state"] == "CONFLICT"),
        "blocked": sum(1 for r in rows if r["state"] == "BLOCKED"),
        "ready": sum(1 for r in rows if r["state"] == "READY_FOR_H1"),
        "stale": sum(1 for r in rows if r["state"] == "STALE"),
        "invalidated": sum(1 for r in rows if r["state"] == "INVALIDATED"),
        "byState": {st: sum(1 for r in rows if r["state"] == st) for st in STATES},
        "byDirection": {d: sum(1 for r in rows if r["direction"] == d) for d in DIRECTIONS},
    }
