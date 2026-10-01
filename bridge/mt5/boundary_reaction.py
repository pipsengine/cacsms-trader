"""Boundary-relative reaction detector for OP-01, OP-02, OP-09 and OP-11.

Channel construction touches answer "does this geometry form a channel?". This module answers a different question:
"is price, on closed execution-timeframe bars, reacting from the trend-supporting boundary right now?".

Every decision at bar j uses bars[:j+1] only. Bearish logic runs on mirrored prices so both sides share one code path.
Tolerances reuse the channel engine's ATR tolerances; the reaction thresholds are fixed configuration and are not
tuned from results.
"""

from __future__ import annotations

import bisect
from typing import Any

try:
    import confirm
    import vision
except ImportError:  # pragma: no cover
    from bridge.mt5 import confirm  # type: ignore
    from bridge.mt5 import vision  # type: ignore

STATES = (
    "BOUNDARY_DISTANT", "BOUNDARY_APPROACH", "BOUNDARY_ZONE_REACHED", "BOUNDARY_TOUCH", "BOUNDARY_PENETRATION",
    "REACTION_PENDING", "REACTION_DETECTED", "REACTION_CONFIRMED", "REACTION_FAILED", "BOUNDARY_BROKEN",
)
CONTACT_STATES = frozenset(("BOUNDARY_ZONE_REACHED", "BOUNDARY_TOUCH", "BOUNDARY_PENETRATION"))

CONFIG: dict[str, Any] = {
    "zoneAtr": vision.CONFIG["touchTolAtr"],      # half-width of the boundary reaction zone, parent-TF ATR
    "breakAtr": vision.CONFIG["breakTolAtr"],     # close beyond the boundary by this much = BOUNDARY_BROKEN, parent-TF ATR
    "approachPct": vision.CONFIG["approachPct"],  # % of channel width outside the zone that counts as approach
    "midZoneAtr": vision.CONFIG["touchTolAtr"],   # OP-02 midline zone half-width, parent-TF ATR
    "upperRegionPct": 75.0,                       # OP-02 needs a prior visit to the outer region (leg_model UPPER)
    "lookbackBars": 160,
    "minBars": 40,
    "atrLen": vision.CONFIG["atrLen"],
    "wickRatio": 0.5,                             # rejection wick share of the bar range
    "closeAwayAtr": 0.25,                         # close beyond the zone edge, execution ATR
    "displacementAtr": 1.0,                       # close distance from the episode extreme, execution ATR
    "holdBars": 3,                                # bars without a new extreme
    "momentumBars": 3,
    "pivot": 2,
    "higherLowAtr": 0.1,
    "detectMin": 2,
    "confirmMin": 3,
    "reactionExpiryBars": 12,
    "pendingExpiryBars": 36,
    "staleBars": 2,
    "goodPosPct": 25.0,                           # leg_model LOWER region
    "acceptPosPct": 45.0,                         # leg_model LOWER_MIDDLE region
    "internalGoodPosPct": 60.0,
    "extensionLateAtr": confirm.CONFIG["extensionLateAtr"],
    "extensionChaseAtr": confirm.CONFIG["extensionChaseAtr"],
    "strong": {"detectMin": 3, "confirmMin": 4, "displacementAtr": 1.5, "closeAwayAtr": 0.4},
}

_RANK = {"REACTION_PENDING": 0, "REACTION_DETECTED": 1, "REACTION_CONFIRMED": 2}


def _min_rr() -> float:
    try:
        import risk
    except ImportError:  # pragma: no cover
        from bridge.mt5 import risk  # type: ignore
    return float(risk.CONFIG["minRR"])


def project_lines(defn: dict[str, Any] | None, parent_ts: list[int], times: list[int]) -> list[tuple[float, float] | None]:
    """Parent channel (lower, upper) at each execution bar time, as a step function of the parent bar that contains it.

    A time after the last closed parent bar belongs to the forming parent bar (index last+1). Times before the
    anchor have no line. Same arithmetic as channel_analysis.channel_lines.
    """
    if not defn or not parent_ts:
        return [None] * len(times)
    try:
        ia = parent_ts.index(int(defn["anchorTs"]))
    except ValueError:
        return [None] * len(times)
    end = defn.get("endTs")
    out: list[tuple[float, float] | None] = []
    last = len(parent_ts) - 1
    for t in times:
        if end and t > int(end):
            out.append(None)
            continue
        idx = bisect.bisect_right(parent_ts, int(t)) - 1
        if idx < ia:
            out.append(None)
            continue
        if idx == last and t > parent_ts[last]:
            idx = last + 1 if _after_close(parent_ts, t) else last
        a = float(defn["anchorPrice"]) + float(defn["slope"]) * (idx - ia)
        b = a + float(defn["sgn"]) * float(defn["width"])
        out.append((a, b) if defn["sgn"] > 0 else (b, a))
    return out


def _after_close(parent_ts: list[int], t: int) -> bool:
    step = parent_ts[-1] - parent_ts[-2] if len(parent_ts) > 1 else 0
    gaps = [parent_ts[i + 1] - parent_ts[i] for i in range(max(0, len(parent_ts) - 6), len(parent_ts) - 1)]
    step = min(gaps) if gaps else step
    return step > 0 and t >= parent_ts[-1] + step


def _mirror_bars(bars: list[tuple]) -> list[tuple]:
    return [(b[0], -float(b[1]), -float(b[3]), -float(b[2]), -float(b[4])) for b in bars]


def _mirror_lines(lines: list[tuple[float, float] | None]) -> list[tuple[float, float] | None]:
    return [None if ln is None else (-ln[1], -ln[0]) for ln in lines]


def _empty(state: str, reason: str, **extra: Any) -> dict[str, Any]:
    return {"state": state, "contact": None, "reasons": [reason], "signals": {}, "quality": 0, "zone": None, "touch": None,
            "extreme": None, "breakBar": None, "room": None, "entryQuality": None, "expired": False, "stale": False,
            "episode": None, "detectedAt": None, "confirmedAt": None, "triggerPrice": None, **extra}


def detect(bars: list[tuple], lines: list[tuple[float, float] | None], direction: int, *, parent_atr: float | None,
           mode: str = "BOUNDARY", tf_sec: int = 3600, now_ts: float | None = None,
           cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Boundary reaction state for one channel side.

    bars: closed execution bars (ts, open, high, low, close), ascending. lines: (lower, upper) per bar.
    direction +1 trades long from the lower boundary (or the midline in MIDLINE mode); -1 trades short from the upper.
    """
    c = {**CONFIG, **(cfg or {})}
    if mode == "MIDLINE":
        c = {**c, **c["strong"]}
    n = len(bars)
    if direction not in (1, -1):
        return _empty("INSUFFICIENT_HISTORY", "Trade direction unknown")
    if n < int(c["minBars"]):
        return _empty("INSUFFICIENT_HISTORY", f"{n} closed execution bars, {c['minBars']} required")
    if not parent_atr or parent_atr <= 0:
        return _empty("INSUFFICIENT_HISTORY", "Parent ATR unavailable")
    if len(lines) != n or lines[-1] is None:
        return _empty("INSUFFICIENT_HISTORY", "Parent channel lines cannot be projected onto the execution bars")
    sign = direction
    work = bars if sign > 0 else _mirror_bars(bars)
    geo = lines if sign > 0 else _mirror_lines(lines)
    o = [float(b[1]) for b in work]
    h = [float(b[2]) for b in work]
    lo = [float(b[3]) for b in work]
    cl = [float(b[4]) for b in work]
    atr = vision.wilder_atr(h, lo, cl, int(c["atrLen"]))
    last_ts = int(bars[-1][0])
    stale = bool(now_ts is not None and now_ts - (last_ts + tf_sec) > float(c["staleBars"]) * tf_sec)
    zone_half = float(c["midZoneAtr" if mode == "MIDLINE" else "zoneAtr"]) * float(parent_atr)
    brk = float(c["breakAtr"]) * float(parent_atr)
    outer_zone = float(c["zoneAtr"]) * float(parent_atr)

    def support(i: int) -> float:
        ln = geo[i]
        return (ln[0] + ln[1]) / 2 if mode == "MIDLINE" else ln[0]

    def reset_level(i: int) -> float:
        ln = geo[i]
        if mode == "MIDLINE":
            return ln[0] + float(c["upperRegionPct"]) / 100.0 * (ln[1] - ln[0])
        return (ln[0] + ln[1]) / 2

    w0 = 0
    while w0 < n and geo[w0] is None:
        w0 += 1
    if n - w0 < int(c["minBars"]) // 2:
        return _empty("INSUFFICIENT_HISTORY", "The channel is younger than the reaction lookback on this timeframe", stale=stale)
    # The cycle starts after the last bar that reached the reset level (midline, or the outer region for OP-02).
    # Searching the full projected history keeps the cycle start, and so the opportunity identity, stable bar to bar.
    reset_idx = None
    for i in range(n - 1, w0 - 1, -1):
        if h[i] >= reset_level(i):
            reset_idx = i
            break
    if mode == "MIDLINE" and reset_idx is None:
        return _empty("NO_PRIOR_IMPULSE", "No visit to the outer channel region in the lookback — not an internal continuation", stale=stale)
    start = reset_idx + 1 if reset_idx is not None else w0
    lb0 = max(w0, (reset_idx if reset_idx is not None else start) - int(c["lookbackBars"]))
    lower_last, upper_last = geo[-1]
    width_last = upper_last - lower_last
    sup_last = support(n - 1)
    # Computed on the mirrored series for shorts, so this is already the trade-relative position (0 = supporting boundary).
    position = None if width_last <= 0 else (cl[-1] - lower_last) / width_last * 100.0
    touch = next((i for i in range(start, n) if lo[i] <= support(i) + zone_half), None)
    if mode == "MIDLINE" and any(lo[i] <= geo[i][0] + outer_zone for i in range(start, n)):
        return _empty("OUTER_BOUNDARY_REACHED", "Pullback reached the outer boundary zone — evaluated as OP-01, not OP-02", stale=stale)
    cycle_ts = int(bars[start][0]) if start < n and reset_idx is not None else None
    if touch is None:
        gap = cl[-1] - (sup_last + zone_half)
        band = float(c["approachPct"]) / 100.0 * width_last
        state = "BOUNDARY_APPROACH" if gap <= band else "BOUNDARY_DISTANT"
        out = _empty(state, "Price approaching the boundary zone" if state == "BOUNDARY_APPROACH" else "Price is away from the boundary zone",
                     stale=stale)
        out.update({"zone": _zone(sup_last, zone_half, sign), "distanceAtr": None if not atr[-1] else round(gap / atr[-1], 2),
                    "position": None if position is None else round(position, 1),
                    "episode": {"cycleStartTs": cycle_ts, "touchTs": None}, "lastTs": last_ts, "lastClose": float(bars[-1][4]),
                    "atr": round(atr[-1], 8)})
        return out

    def episode(first: int) -> dict[str, Any]:
        ext, ext_idx = lo[first], first
        state = "REACTION_PENDING"
        detected_at = confirmed_at = None
        ref_ext = None
        broken = failed = None
        signals: dict[str, bool] = {}
        for j in range(first, n):
            if lo[j] < ext:
                if ref_ext is not None and lo[j] < ref_ext:
                    failed = j
                    break
                ext, ext_idx = lo[j], j
            if cl[j] < support(j) - brk:
                broken = j
                break
            a = atr[j] or 0.0
            sig = {
                "rejectionWick": any(
                    lo[k] <= support(k) + zone_half and h[k] > lo[k] and (min(o[k], cl[k]) - lo[k]) / (h[k] - lo[k]) >= float(c["wickRatio"])
                    and cl[k] >= support(k) for k in range(first, j + 1)),
                "closeAway": a > 0 and cl[j] >= support(j) + zone_half + float(c["closeAwayAtr"]) * a,
                "displacement": a > 0 and cl[j] - ext >= float(c["displacementAtr"]) * a,
                "noNewExtreme": j - ext_idx >= int(c["holdBars"]),
                "momentumTurn": j > ext_idx and cl[j] > cl[max(ext_idx, j - int(c["momentumBars"]))] and cl[j] > o[j],
                "higherLow": _higher_low(lo, ext_idx, j, ext, a, c),
            }
            signals = sig
            count = sum(1 for v in sig.values() if v)
            core = sig["closeAway"] or sig["displacement"]
            new = "REACTION_PENDING"
            if count >= int(c["confirmMin"]) and sig["closeAway"] and sig["displacement"] and sig["noNewExtreme"]:
                new = "REACTION_CONFIRMED"
            elif count >= int(c["detectMin"]) and core:
                new = "REACTION_DETECTED"
            if _RANK[new] > _RANK[state]:
                state = new
                if detected_at is None:
                    detected_at, ref_ext = j, ext
                if new == "REACTION_CONFIRMED":
                    confirmed_at = j
        return {"first": first, "ext": ext, "extIdx": ext_idx, "state": state, "detectedAt": detected_at, "confirmedAt": confirmed_at,
                "broken": broken, "failed": failed, "signals": signals}

    # A failed reaction (new extreme after the reaction) restarts a new attempt from the failure bar inside the same cycle.
    attempts: list[dict[str, Any]] = []
    ep = episode(touch)
    while ep["failed"] is not None and ep["failed"] < n - 1 and len(attempts) < 8:
        attempts.append({"touchTs": int(bars[ep["first"]][0]), "failedTs": int(bars[ep["failed"]][0]),
                         "detectedTs": None if ep["detectedAt"] is None else int(bars[ep["detectedAt"]][0])})
        ep = episode(ep["failed"])
    touch, ext, ext_idx, state = ep["first"], ep["ext"], ep["extIdx"], ep["state"]
    detected_at, confirmed_at, broken, failed, signals = ep["detectedAt"], ep["confirmedAt"], ep["broken"], ep["failed"], ep["signals"]
    pen = support(ext_idx) - ext
    contact = "BOUNDARY_PENETRATION" if pen > zone_half else "BOUNDARY_TOUCH" if pen >= 0 else "BOUNDARY_ZONE_REACHED"
    reasons: list[str] = []
    if broken is not None:
        state = "BOUNDARY_BROKEN"
        reasons.append("Closed beyond the trend-supporting boundary by the break tolerance")
    elif failed is not None:
        state = "REACTION_FAILED"
        reasons.append("Reaction failed: a new extreme formed beyond the touch extreme after the reaction")
    elif state == "REACTION_PENDING" and ext_idx == n - 1:
        state = contact
        reasons.append("Boundary zone entered on the latest closed bar — reaction not measurable yet")
    else:
        reasons.append({"REACTION_PENDING": "Zone reached; reaction evidence below the detection threshold",
                        "REACTION_DETECTED": "Reaction detected; confirmation evidence incomplete",
                        "REACTION_CONFIRMED": "Reaction confirmed on closed bars"}[state])
    end = broken if broken is not None else failed if failed is not None else n - 1
    a_last = atr[-1] or 0.0
    expired = False
    if state == "REACTION_CONFIRMED" and confirmed_at is not None and (n - 1 - confirmed_at) > int(c["reactionExpiryBars"]):
        expired = True
        reasons.append(f"Confirmed {n - 1 - confirmed_at} bars ago — trigger expired")
    elif state in CONTACT_STATES | {"REACTION_PENDING", "REACTION_DETECTED"} and (n - 1 - touch) > int(c["pendingExpiryBars"]):
        expired = True
        reasons.append(f"Zone touched {n - 1 - touch} bars ago without confirmation — expired")
    pos_trade = position
    ext_atr = None if not a_last else (cl[-1] - (sup_last + zone_half)) / a_last
    if mode == "MIDLINE":
        good = pos_trade is not None and pos_trade <= float(c["internalGoodPosPct"]) and (ext_atr is None or ext_atr <= float(c["extensionLateAtr"]))
        grade = "GOOD" if good else "EXTENDED"
    elif pos_trade is not None and pos_trade <= float(c["goodPosPct"]) and (ext_atr is None or ext_atr <= float(c["extensionLateAtr"])):
        grade = "GOOD"
    elif pos_trade is not None and pos_trade <= float(c["acceptPosPct"]) and (ext_atr is None or ext_atr <= float(c["extensionChaseAtr"])):
        grade = "ACCEPTABLE"
    else:
        grade = "EXTENDED"
    room = _room(cl[-1], ext, sup_last, brk, geo, h, lb0, touch, zone_half, sign)
    m = 1.0 if sign > 0 else -1.0
    return {
        "state": state, "contact": contact, "mode": mode, "direction": "BULLISH" if sign > 0 else "BEARISH",
        "reasons": reasons, "signals": signals, "quality": sum(1 for v in signals.values() if v),
        "zone": _zone(sup_last, zone_half, sign),
        "touch": {"ts": int(bars[touch][0]), "price": round(m * lo[touch], 8)},
        "extreme": {"ts": int(bars[ext_idx][0]), "price": round(m * ext, 8), "penetrationAtr": round(pen / float(parent_atr), 3)},
        "breakBar": None if broken is None else {"ts": int(bars[broken][0]), "close": float(bars[broken][4])},
        "failedBar": None if failed is None else {"ts": int(bars[failed][0])},
        "detectedAt": None if detected_at is None else int(bars[detected_at][0]),
        "confirmedAt": None if confirmed_at is None else int(bars[confirmed_at][0]),
        "triggerPrice": None if confirmed_at is None else float(bars[confirmed_at][4]),
        "barsSinceTouch": n - 1 - touch, "barsSinceTrigger": None if confirmed_at is None else n - 1 - confirmed_at,
        "episode": {"cycleStartTs": cycle_ts, "touchTs": int(bars[touch][0]), "attempt": len(attempts) + 1, "priorAttempts": attempts},
        "room": room, "entryQuality": {"grade": grade, "extensionAtr": None if ext_atr is None else round(ext_atr, 2),
                                       "position": None if pos_trade is None else round(pos_trade, 1)},
        "position": None if pos_trade is None else round(pos_trade, 1),
        "expired": expired, "stale": stale, "evaluatedThrough": int(bars[end][0]),
        "lastTs": last_ts, "lastClose": float(bars[-1][4]), "atr": round(a_last, 8),
    }


def _zone(level: float, half: float, sign: int) -> dict[str, float]:
    lo_, hi_ = level - half, level + half
    if sign < 0:
        lo_, hi_ = -hi_, -lo_
    return {"low": round(lo_, 8), "high": round(hi_, 8), "line": round(level if sign > 0 else -level, 8), "halfWidth": round(half, 8)}


def _higher_low(lo: list[float], ext_idx: int, j: int, ext: float, a: float, c: dict[str, Any]) -> bool:
    k = int(c["pivot"])
    for p in range(ext_idx + 1, j - k + 1):
        if p - k < 0:
            continue
        if lo[p] <= min(lo[p - k:p + k + 1]) and lo[p] > ext + float(c["higherLowAtr"]) * a:
            return True
    return False


def _room(entry: float, ext: float, sup_last: float, brk: float, geo: list, h: list[float], w0: int, touch: int,
          zone_half: float, sign: int) -> dict[str, Any]:
    """Room on the existing Stage 8 basis: structural invalidation vs target hierarchy, minimum R:R from risk.CONFIG."""
    lower, upper = geo[-1]
    mid = (lower + upper) / 2
    inv = min(ext, sup_last - brk)
    opposite = upper - zone_half
    prior = [h[i] for i in range(w0, touch)]
    structural = max(prior) if prior else None
    layers = []
    if mid > entry:
        layers.append(("MIDLINE", mid))
    if structural is not None and structural > entry:
        layers.append(("PRIOR_STRUCTURAL_HIGH" if sign > 0 else "PRIOR_STRUCTURAL_LOW", structural))
    if opposite > entry:
        layers.append(("OPPOSITE_REGION", opposite))
    target, target_kind = (opposite, "OPPOSITE_REGION") if opposite > entry else (None, None)
    if target is not None and structural is not None and mid < structural < opposite:
        target, target_kind = structural, "PRIOR_STRUCTURAL_HIGH" if sign > 0 else "PRIOR_STRUCTURAL_LOW"
    risk_dist = entry - inv
    rr = None if target is None or risk_dist <= 0 else (target - entry) / risk_dist
    min_rr = _min_rr()
    m = 1.0 if sign > 0 else -1.0
    return {
        "entry": round(m * entry, 8), "invalidation": round(m * inv, 8),
        "targets": [{"kind": k, "price": round(m * p, 8)} for k, p in sorted(layers, key=lambda x: x[1])],
        "target": None if target is None else round(m * target, 8), "targetKind": target_kind,
        "rewardRisk": None if rr is None else round(rr, 2), "minRR": min_rr, "ok": rr is not None and rr >= min_rr,
    }


def reentry_reaction(bars: list[tuple], level: float, broken_side: str, *, since_ts: int | None, atr_len: int = 14,
                     cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """OP-09 evidence after a failed break: closes back inside the structure, displacement away from the post-break extreme.

    broken_side UPPER means the failed break was upward, so the re-entry trade is short. The boundary is the level
    reported by the breakout scanner for the current bar.
    """
    c = {**CONFIG, **(cfg or {})}
    if len(bars) < int(c["minBars"]):
        return {"state": "INSUFFICIENT_HISTORY", "reentry": None, "reaction": None, "signals": {}}
    sign = -1 if str(broken_side).upper() == "UPPER" else 1
    work = bars if sign > 0 else _mirror_bars(bars)
    lvl = level if sign > 0 else -level
    h = [float(b[2]) for b in work]
    lo = [float(b[3]) for b in work]
    cl = [float(b[4]) for b in work]
    o = [float(b[1]) for b in work]
    atr = vision.wilder_atr(h, lo, cl, atr_len)
    start = 0
    if since_ts is not None:
        start = next((i for i, b in enumerate(bars) if int(b[0]) >= int(since_ts)), len(bars) - 1)
    window = range(start, len(bars))
    beyond = [i for i in window if cl[i] < lvl]
    if not beyond:
        return {"state": "NO_BREAK_IN_WINDOW", "reentry": False, "reaction": False, "signals": {}}
    last_out = beyond[-1]
    after = list(range(last_out + 1, len(bars)))
    ext = min(lo[last_out:])
    a = atr[-1] or 0.0
    sig = {
        "closeBackInside": bool(after) and a > 0 and cl[-1] >= lvl + float(c["closeAwayAtr"]) * a,
        "displacement": a > 0 and cl[-1] - ext >= float(c["displacementAtr"]) * a,
        "holding": len(after) >= int(c["holdBars"]) and all(cl[i] >= lvl for i in after),
        "momentumTurn": bool(after) and cl[-1] > o[-1],
    }
    reentry = bool(after) and cl[-1] >= lvl
    reaction = sig["closeBackInside"] and sig["displacement"] and sig["holding"]
    return {"state": "REENTRY_CONFIRMED" if reentry and reaction else "REENTRY_PENDING" if reentry else "OUTSIDE",
            "reentry": reentry, "reaction": reaction, "signals": sig, "extreme": round(ext if sign > 0 else -ext, 8),
            "barsInside": len(after), "lastTs": int(bars[-1][0]), "lastClose": float(bars[-1][4]), "atr": round(a, 8)}
