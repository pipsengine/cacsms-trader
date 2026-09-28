"""Stage 5 HTF Market Vision — pure D1/H8 structural analysis (no I/O).

Input: validated closed candles (ts, open, high, low, close) from the Stage 1 historical store.
Output: channel definition, touches, status, direction, phase, metrics, confidence evidence and events.

Channel construction:
  Touch #1 (anchor) and Touch #2 (candidate) are two swing points on the same boundary; the line
  through them must hold as a boundary between them. Touch #3 on that boundary validates it, and the
  opposite boundary is the parallel offset through the extreme opposite swing, confirmed by at least
  two opposite touches whose own slope is parallel within tolerance.
"""

from __future__ import annotations

import math
from typing import Any

import leg_model

TF_SEC = {"D1": 86400, "H8": 8 * 3600, "H1": 3600}

TF_CFG: dict[str, dict[str, Any]] = {
    "D1": {"lookback": 260, "pivot": 3, "minSwingAtr": 1.0, "minBars": 120, "maxSwings": 14, "minAnchorGap": 6,
           "invalidBars": 40, "chartBars": 320},
    "H8": {"lookback": 360, "pivot": 3, "minSwingAtr": 1.0, "minBars": 150, "maxSwings": 16, "minAnchorGap": 6,
           "invalidBars": 60, "chartBars": 420},
    # Same swing, touch and parallel rules as D1/H8. A nested channel is published only when this geometry validates.
    "H1": {"lookback": 220, "pivot": 3, "minSwingAtr": 1.0, "minBars": 100, "maxSwings": 16, "minAnchorGap": 4,
           "invalidBars": 40, "chartBars": 280},
}

CONFIG: dict[str, Any] = {
    "atrLen": 14,
    "atrSlowLen": 50,
    "touchTolAtr": 0.30,      # swing within this many ATR of a boundary counts as a touch
    "breakTolAtr": 0.35,      # close beyond a boundary by this many ATR is a breakout
    "retestTolAtr": 0.35,     # post-break extreme returning within this many ATR of the broken boundary
    "retestRecentBars": 3,
    "invalidAtr": 3.0,        # breakout distance at which the old channel is invalidated
    "minWidthAtr": 1.5,
    "maxWidthAtr": 16.0,
    "parallelTol": 0.6,       # |slope_opp - slope| * span / width
    "maxViolationShare": 0.08,
    "flatRise": 0.35,         # channel travel over its span, in channel widths
    "strongRise": 1.25,
    "minSlopeAtr": 0.3,       # slope in ATR per 20 bars below which a channel is horizontal
    "strongSlopeAtr": 1.0,
    "approachPct": 12.0,
    "activeTouches": 5,
    "compressionRatio": 0.75,
    "expansionRatio": 1.3,
}

DIRECTIONS = ("STRONG_BULLISH", "BULLISH", "NEUTRAL", "BEARISH", "STRONG_BEARISH")
STATUSES = ("FORMING", "VALIDATED", "ACTIVE", "WEAKENING", "BROKEN", "RETESTING", "INVALIDATED")
CONFIRMED_STATUSES = ("VALIDATED", "ACTIVE", "WEAKENING", "BROKEN", "RETESTING")


def wilder_atr(h: list[float], l: list[float], c: list[float], n: int) -> list[float]:
    out: list[float] = []
    prev = None
    for i in range(len(c)):
        tr = h[i] - l[i] if i == 0 else max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
        if prev is None:
            prev = tr
        elif i < n:
            prev = (prev * i + tr) / (i + 1)
        else:
            prev = (prev * (n - 1) + tr) / n
        out.append(prev)
    return out


def pivots(h: list[float], l: list[float], k: int) -> list[dict[str, Any]]:
    """Confirmed fractal swing points: extreme over k bars each side (strict on the left)."""
    out: list[dict[str, Any]] = []
    for i in range(k, len(h) - k):
        if h[i] > max(h[i - k:i]) and h[i] >= max(h[i + 1:i + k + 1]):
            out.append({"i": i, "kind": "H", "p": h[i]})
        if l[i] < min(l[i - k:i]) and l[i] <= min(l[i + 1:i + k + 1]):
            out.append({"i": i, "kind": "L", "p": l[i]})
    out.sort(key=lambda s: (s["i"], s["kind"]))
    return out


def zigzag(piv: list[dict[str, Any]], atr: list[float], min_amp: float) -> list[dict[str, Any]]:
    """Alternating significant swings: same-side runs keep the extreme; reversals need min_amp ATR."""
    out: list[dict[str, Any]] = []
    for s in piv:
        if not out:
            out.append(s)
            continue
        last = out[-1]
        if s["kind"] == last["kind"]:
            if (s["kind"] == "H" and s["p"] > last["p"]) or (s["kind"] == "L" and s["p"] < last["p"]):
                out[-1] = s
            continue
        if abs(s["p"] - last["p"]) >= min_amp * atr[s["i"]]:
            out.append(s)
    return out


def _slope_label(rise: float, s20: float | None = None) -> str:
    """rise: channel travel over its span in channel widths; s20: slope in ATR per 20 bars (floor against flat drift)."""
    s20 = rise if s20 is None else s20
    if abs(s20) < CONFIG["minSlopeAtr"]:
        return "NEUTRAL"
    if rise >= CONFIG["strongRise"] and s20 >= CONFIG["strongSlopeAtr"]:
        return "STRONG_BULLISH"
    if rise >= CONFIG["flatRise"]:
        return "BULLISH"
    if rise <= -CONFIG["strongRise"] and s20 <= -CONFIG["strongSlopeAtr"]:
        return "STRONG_BEARISH"
    if rise <= -CONFIG["flatRise"]:
        return "BEARISH"
    return "NEUTRAL"


def dir_sign(d: str | None) -> int:
    return 1 if d in ("BULLISH", "STRONG_BULLISH") else -1 if d in ("BEARISH", "STRONG_BEARISH") else 0


def _soften(d: str) -> str:
    return {"STRONG_BULLISH": "BULLISH", "STRONG_BEARISH": "BEARISH"}.get(d, d)


def _linreg_slope(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 2:
        return None
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    den = sum((x - mx) ** 2 for x in xs)
    if den == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den


class _Series:
    def __init__(self, bars: list[tuple]):
        self.ts = [int(b[0]) for b in bars]
        self.o = [float(b[1]) for b in bars]
        self.h = [float(b[2]) for b in bars]
        self.l = [float(b[3]) for b in bars]
        self.c = [float(b[4]) for b in bars]
        self.n = len(bars)


def _scan_breaks(s: _Series, line, sgn_out: int, start: int, atr: list[float]) -> tuple[int | None, list[dict[str, Any]]]:
    """Walk closes from `start`; a close beyond the boundary (outside direction sgn_out) by breakTol is a break.
    A later close back inside turns it into a failed breakout. Returns (definitive break index, failed list)."""
    bt = CONFIG["breakTolAtr"]
    failed: list[dict[str, Any]] = []
    brk: int | None = None
    for i in range(start, s.n):
        d = sgn_out * (s.c[i] - line(i))
        if brk is None:
            if d > bt * atr[i]:
                brk = i
        elif d < 0:
            failed.append({"i": brk, "reentry": i})
            brk = None
    return brk, failed


def _build(tf: str, s: _Series, side: str, A: dict, B: dict, piv: list[dict], atr: list[float]) -> dict[str, Any] | None:
    C = TF_CFG[tf]
    ia, ib = A["i"], B["i"]
    if ib - ia < C["minAnchorGap"]:
        return None
    slope = (B["p"] - A["p"]) / (ib - ia)
    sgn = 1 if side == "L" else -1          # +1: price lives above the anchor line (support); -1: below (resistance)
    tt = CONFIG["touchTolAtr"]

    def line(i: float) -> float:
        return A["p"] + slope * (i - ia)

    wick = s.l if side == "L" else s.h
    pierce = 0
    for i in range(ia + 1, ib):
        if sgn * (s.c[i] - line(i)) < -tt * atr[i]:
            return None
        if sgn * (wick[i] - line(i)) < -2 * tt * atr[i]:
            pierce += 1
    if pierce > 1:
        return None

    brk_a, failed_a = _scan_breaks(s, line, -sgn, ib + 1, atr)
    end_a = brk_a if brk_a is not None else s.n

    def same_touches(end: int) -> list[dict]:
        out: list[dict] = []
        for p in piv:
            if p["kind"] == side and ia <= p["i"] < end and abs(p["p"] - line(p["i"])) <= tt * atr[p["i"]]:
                if out and p["i"] - out[-1]["i"] <= TF_CFG[tf]["pivot"]:
                    continue
                out.append(p)
        return out

    t_a = same_touches(end_a)
    if len(t_a) < 2:
        return None
    cut = max(t_a[-1]["i"], ib)
    opp = [p for p in piv if p["kind"] != side and ia <= p["i"] <= cut and p["i"] < end_a]
    if not opp:
        opp = [p for p in piv if p["kind"] != side and ia <= p["i"] < end_a]
    if not opp:
        return None
    width = max(sgn * (p["p"] - line(p["i"])) for p in opp)
    a_last = atr[-1]
    if width <= 0 or not (CONFIG["minWidthAtr"] <= width / a_last <= CONFIG["maxWidthAtr"]):
        return None

    def opp_line(i: float) -> float:
        return line(i) + sgn * width

    brk_o, failed_o = _scan_breaks(s, opp_line, sgn, cut + 1, atr)
    brk, brk_side_sgn = None, 0
    if brk_a is not None and (brk_o is None or brk_a <= brk_o):
        brk, brk_side_sgn = brk_a, -sgn
    elif brk_o is not None:
        brk, brk_side_sgn = brk_o, sgn
    end_pre = brk if brk is not None else s.n
    if brk is not None and brk < end_a:
        t_a = same_touches(end_pre)
        if len(t_a) < 2:
            return None

    t_o: list[dict] = []
    for p in piv:
        if p["kind"] != side and ia <= p["i"] < end_pre and abs(p["p"] - opp_line(p["i"])) <= tt * atr[p["i"]]:
            if t_o and p["i"] - t_o[-1]["i"] <= TF_CFG[tf]["pivot"]:
                continue
            t_o.append(p)

    near_opp = [p for p in piv if p["kind"] != side and ia <= p["i"] < end_pre and sgn * (p["p"] - line(p["i"])) >= 0.65 * width]
    slope_o = _linreg_slope([p["i"] for p in near_opp], [p["p"] for p in near_opp]) if len(near_opp) >= 2 else None
    span = max(1, end_pre - 1 - ia)
    pdev = abs(slope_o - slope) * span / width if slope_o is not None else None
    parallel_ok = pdev is not None and pdev <= CONFIG["parallelTol"]

    viol = 0
    for i in range(ia, end_pre):
        lo, hi = (line(i), opp_line(i)) if sgn > 0 else (opp_line(i), line(i))
        if s.c[i] < lo - tt * atr[i] or s.c[i] > hi + tt * atr[i]:
            viol += 1
    viol_share = viol / max(1, end_pre - ia)
    if viol_share > CONFIG["maxViolationShare"]:
        return None

    devs = [abs(p["p"] - line(p["i"])) / (tt * atr[p["i"]]) for p in t_a] + [
        abs(p["p"] - opp_line(p["i"])) / (tt * atr[p["i"]]) for p in t_o
    ]
    quality = max(0.0, 100.0 * (1 - sum(devs) / len(devs))) if devs else 0.0
    last_touch = max([p["i"] for p in t_a + t_o])
    recency = 1 - min(1.0, (s.n - 1 - last_touch) / max(20.0, span * 0.6))

    invalid_hint = False
    if brk is not None:
        if (s.n - 1 - brk) > TF_CFG[tf]["invalidBars"]:
            invalid_hint = True
        else:
            up = brk_side_sgn > 0
            for i in range(brk, s.n):
                lo, hi = (line(i), opp_line(i)) if sgn > 0 else (opp_line(i), line(i))
                if ((s.c[i] - hi) if up else (lo - s.c[i])) >= CONFIG["invalidAtr"] * atr[i]:
                    invalid_hint = True
                    break
    score = (
        12 * min(len(t_a), 5) + 8 * min(len(t_o), 4) + 0.15 * quality + 20 * recency
        + 8 * min(1.0, span / (C["lookback"] * 0.5)) - 150 * viol_share
        - (10 * min(pdev, 2.0) if pdev is not None else 6) - (80 if invalid_hint else 0)
    )
    return {
        "side": side, "sgn": sgn, "A": A, "B": B, "slope": slope, "width": width, "line": line, "oppLine": opp_line,
        "tA": t_a, "tO": t_o, "brk": brk, "brkSideSgn": brk_side_sgn, "failed": failed_a + failed_o,
        "pdev": pdev, "parallelOk": parallel_ok, "viol": viol, "violShare": viol_share, "quality": quality,
        "span": span, "recency": recency, "score": score, "endPre": end_pre,
    }


def _bounds(ch: dict, i: float) -> tuple[float, float]:
    a, b = ch["line"](i), ch["oppLine"](i)
    return (a, b) if ch["sgn"] > 0 else (b, a)


def _position(ch: dict, i: float, price: float) -> float:
    lo, hi = _bounds(ch, i)
    return (price - lo) / (hi - lo) * 100 if hi > lo else 50.0


def _vol_state(ratio: float) -> str:
    return "EXPANDING" if ratio >= CONFIG["expansionRatio"] else "CONTRACTING" if ratio <= CONFIG["compressionRatio"] else "NORMAL"


def _fmt(p: float) -> str:
    return f"{p:.5f}" if p < 50 else f"{p:.3f}" if p < 1000 else f"{p:.2f}"


def analyse_tf(tf: str, bars: list[tuple]) -> dict[str, Any]:
    """Full structural read for one timeframe. `bars` must be validated closed candles, ascending."""
    C = TF_CFG[tf]
    s = _Series(bars)
    n = s.n
    atr = wilder_atr(s.h, s.l, s.c, CONFIG["atrLen"])
    atr_slow = wilder_atr(s.h, s.l, s.c, CONFIG["atrSlowLen"])
    a_last = atr[-1]
    vol_ratio = a_last / atr_slow[-1] if atr_slow[-1] > 0 else 1.0
    start = max(0, n - C["lookback"])
    piv = [p for p in pivots(s.h, s.l, C["pivot"]) if p["i"] >= start]
    swings = zigzag(piv, atr, C["minSwingAtr"])

    best: dict[str, Any] | None = None
    for side in ("L", "H"):
        anchors = [x for x in swings if x["kind"] == side][-C["maxSwings"]:]
        for ai in range(len(anchors)):
            for bi in range(ai + 1, len(anchors)):
                cand = _build(tf, s, side, anchors[ai], anchors[bi], piv, atr)
                if cand and (best is None or cand["score"] > best["score"]):
                    best = cand

    base = {
        "timeframe": tf, "bars": n, "lastTs": s.ts[-1], "lastClose": s.c[-1], "atr": a_last, "atrSlow": atr_slow[-1],
        "volRatio": round(vol_ratio, 3), "volState": _vol_state(vol_ratio),
        "swings": {"highs": sum(1 for x in swings if x["kind"] == "H"), "lows": sum(1 for x in swings if x["kind"] == "L")},
    }
    last10 = max(s.h[-10:]) - min(s.l[-10:])
    net5 = s.c[-1] - s.c[-6] if n > 6 else 0.0

    if best is None:
        phase = "COMPRESSION" if vol_ratio <= CONFIG["compressionRatio"] and last10 < 2.5 * atr_slow[-1] else \
            "IMPULSE" if abs(net5) >= 1.5 * a_last else "CONSOLIDATION"
        reason = (
            f"No channel: {base['swings']['lows']} swing lows / {base['swings']['highs']} swing highs in the last "
            f"{min(n, C['lookback'])} bars do not form a boundary within {CONFIG['touchTolAtr']} ATR tolerance"
        )
        net20 = (s.c[-1] - s.c[-21]) / a_last if n > 21 and a_last else 0.0
        return {**base, "status": "NONE", "direction": "NEUTRAL", "lean": _slope_label(net20 / 4, net20),
                "confirmed": False, "phase": phase, "confidence": 0.0, "position": None, "reason": reason,
                "evidence": [{"factor": "Channel", "value": "none", "points": 0, "max": 100, "detail": reason}],
                "events": [], "touchList": [], "def": None, "invalidation": [], "failedBreakouts": [], "breakout": None}

    ch = best
    ia = ch["A"]["i"]
    t_a, t_o = ch["tA"], ch["tO"]
    validated_struct = len(t_a) >= 3 and len(t_o) >= 2 and ch["parallelOk"]
    v_idx = t_a[2]["i"] if len(t_a) >= 3 else None
    slope20 = ch["slope"] * 20 / a_last if a_last else 0.0
    rise = ch["slope"] * ch["span"] / ch["width"]
    slope_dir = _slope_label(rise, slope20)
    last = n - 1
    lo_now, hi_now = _bounds(ch, last)
    pos = _position(ch, last, s.c[-1])
    events: list[dict[str, Any]] = []
    boundary_a = "LOWER" if ch["sgn"] > 0 else "UPPER"
    boundary_o = "UPPER" if ch["sgn"] > 0 else "LOWER"

    touches = sorted(
        [{"boundary": boundary_a, "p": p} for p in t_a] + [{"boundary": boundary_o, "p": p} for p in t_o],
        key=lambda x: x["p"]["i"],
    )
    roles = {t_a[0]["i"]: "ANCHOR", t_a[1]["i"]: "CANDIDATE"}
    if len(t_a) >= 3:
        roles[t_a[2]["i"]] = "VALIDATION"
    touch_list = []
    for seq, t in enumerate(touches, 1):
        p = t["p"]
        lp = ch["line"](p["i"]) if t["boundary"] == boundary_a else ch["oppLine"](p["i"])
        role = roles.get(p["i"], "CONFIRMATION") if t["boundary"] == boundary_a else "OPPOSITE"
        touch_list.append({
            "seq": seq, "boundary": t["boundary"], "role": role, "ts": s.ts[p["i"]], "price": p["p"], "line": lp,
            "deviationAtr": round((p["p"] - lp) / atr[p["i"]], 3),
        })
        events.append({"type": "TOUCH", "ts": s.ts[p["i"]], "price": p["p"],
                       "detail": f"{role.title()} touch on {t['boundary'].lower()} boundary ({(p['p'] - lp) / atr[p['i']]:+.2f} ATR)"})
    if validated_struct and v_idx is not None:
        events.append({"type": "CHANNEL_VALIDATED", "ts": s.ts[v_idx], "price": s.l[v_idx] if ch["sgn"] > 0 else s.h[v_idx],
                       "detail": f"Touch #3 validated the {boundary_a.lower()} boundary; opposite boundary {len(t_o)} touches, "
                                 f"parallelism {ch['pdev']:.2f}"})

    failed_list = []
    for f in ch["failed"]:
        up = s.c[f["i"]] > _bounds(ch, f["i"])[1]
        failed_list.append({"side": "UP" if up else "DOWN", "ts": s.ts[f["i"]], "reentryTs": s.ts[f["reentry"]]})
        events.append({"type": "FAILED_BREAKOUT", "ts": s.ts[f["reentry"]], "price": s.c[f["reentry"]],
                       "detail": f"{'Upside' if up else 'Downside'} break on {_iso_day(s.ts[f['i']])} closed back inside"})
    last_failed = max((f["reentry"] for f in ch["failed"]), default=None)

    breakout = None
    status: str
    if ch["brk"] is not None:
        b = ch["brk"]
        up = ch["brkSideSgn"] > 0
        bound = (lambda i: _bounds(ch, i)[1]) if up else (lambda i: _bounds(ch, i)[0])
        dsg = 1 if up else -1
        dist = [(s.c[i] - bound(i)) * dsg / atr[i] for i in range(b, n)]
        rt = CONFIG["retestTolAtr"]
        retests = [i for i in range(b + 1, n) if ((s.l[i] - bound(i)) if up else (bound(i) - s.h[i])) <= rt * atr[i]]
        since = last - b
        breakout = {
            "side": "UP" if up else "DOWN", "ts": s.ts[b], "price": s.c[b], "barsSince": since,
            "distanceAtr": round(dist[-1], 3), "maxDistanceAtr": round(max(dist), 3),
            "retestTs": s.ts[retests[0]] if retests else None, "lastRetestTs": s.ts[retests[-1]] if retests else None,
            "retesting": bool(retests) and last - retests[-1] <= CONFIG["retestRecentBars"],
            "boundary": bound(last), "invalidTs": None,
        }
        events.append({"type": "BREAKOUT", "ts": s.ts[b], "price": s.c[b],
                       "detail": f"{'Upside' if up else 'Downside'} close beyond the {'upper' if up else 'lower'} boundary "
                                 f"({dist[0]:+.2f} ATR)"})
        if retests:
            events.append({"type": "RETEST", "ts": s.ts[retests[0]], "price": s.l[retests[0]] if up else s.h[retests[0]],
                           "detail": f"Price returned to the broken {'upper' if up else 'lower'} boundary"})
        inv_i = next((b + k for k, d in enumerate(dist) if d >= CONFIG["invalidAtr"]), None)
        if inv_i is None and since > C["invalidBars"]:
            inv_i = b + C["invalidBars"]
        if not validated_struct or (v_idx is not None and v_idx >= b):
            status = "INVALIDATED"
            inv_i = inv_i if inv_i is not None else b
            reason_inv = "broken before validation"
        elif inv_i is not None:
            status = "INVALIDATED"
            reason_inv = (f"breakout extended {max(dist):.1f} ATR" if max(dist) >= CONFIG["invalidAtr"]
                          else f"{since} bars outside without re-entry")
        else:
            status = "RETESTING" if breakout["retesting"] else "BROKEN"
            reason_inv = ""
        if status == "INVALIDATED":
            breakout["invalidTs"] = s.ts[inv_i]
            events.append({"type": "INVALIDATED", "ts": s.ts[inv_i], "price": s.c[inv_i], "detail": f"Channel invalidated — {reason_inv}"})
    elif not validated_struct:
        status = "FORMING"
    else:
        after_v = [t for t in t_a + t_o if v_idx is not None and t["i"] > v_idx]
        status = "ACTIVE" if (len(t_a) + len(t_o) >= CONFIG["activeTouches"] or after_v) else "VALIDATED"

    # deterioration: the last swing in the channel direction fails to reach the far boundary and is lower than the prior one
    weakening_note = ""
    sd = dir_sign(slope_dir)
    if status in ("VALIDATED", "ACTIVE") and sd != 0:
        kind = "H" if sd > 0 else "L"
        seq = [p for p in piv if p["kind"] == kind and p["i"] >= (v_idx or ia)]
        if len(seq) >= 2:
            p1, p2 = _position(ch, seq[-2]["i"], seq[-2]["p"]), _position(ch, seq[-1]["i"], seq[-1]["p"])
            if sd > 0 and p2 < 55 and p2 < p1 - 10:
                status, weakening_note = "WEAKENING", f"last swing high reached {p2:.0f}% of the channel vs {p1:.0f}% before"
            elif sd < 0 and p2 > 45 and p2 > p1 + 10:
                status, weakening_note = "WEAKENING", f"last swing low held at {p2:.0f}% of the channel vs {p1:.0f}% before"

    # direction
    if status in ("BROKEN", "RETESTING") and breakout:
        up = breakout["side"] == "UP"
        with_trend = (up and sd > 0) or ((not up) and sd < 0)
        direction = ("STRONG_BULLISH" if up else "STRONG_BEARISH") if with_trend else ("BULLISH" if up else "BEARISH")
        lean = direction
    elif status == "INVALIDATED":
        direction = "NEUTRAL"
        lean = ("BULLISH" if breakout and breakout["side"] == "UP" else "BEARISH") if breakout else _soften(slope_dir)
    elif status == "FORMING":
        direction, lean = "NEUTRAL", slope_dir
    else:
        direction = _soften(slope_dir) if status == "WEAKENING" else slope_dir
        lean = direction

    # phase
    since_fail = last - last_failed if last_failed is not None else None
    if status == "RETESTING":
        phase = "RETEST"
    elif status == "BROKEN" and breakout and breakout["barsSince"] <= 3:
        phase = "BREAKOUT"
    elif since_fail is not None and since_fail <= 3 and status not in ("BROKEN", "INVALIDATED"):
        phase = "FAILED_BREAKOUT"
    elif status == "WEAKENING":
        phase = "DETERIORATION"
    elif vol_ratio <= CONFIG["compressionRatio"] and last10 < 0.45 * ch["width"]:
        phase = "COMPRESSION"
    elif status in ("VALIDATED", "ACTIVE", "FORMING") and (
        (sd > 0 and pos < 15 and s.c[-1] < s.c[-2] < s.c[-3]) or (sd < 0 and pos > 85 and s.c[-1] > s.c[-2] > s.c[-3])
    ):
        phase = "REVERSAL_RISK"
    elif last10 < 2.2 * atr_slow[-1] or (sd == 0 and abs(net5) < 1.2 * a_last):
        phase = "CONSOLIDATION"
    else:
        move_dir = sd if sd != 0 else (1 if breakout and breakout["side"] == "UP" else -1)
        if net5 * move_dir >= 1.2 * a_last:
            phase = "IMPULSE"
        elif net5 * move_dir <= -0.6 * a_last:
            phase = "PULLBACK"
        else:
            phase = "CONSOLIDATION"

    # confidence evidence
    ev: list[dict[str, Any]] = []

    def add(factor: str, value: str, points: float, mx: float, detail: str) -> None:
        ev.append({"factor": factor, "value": value, "points": round(points, 1), "max": mx, "detail": detail})

    ta_pts = {0: 0, 1: 0, 2: 8, 3: 18, 4: 22}.get(len(t_a), 25)
    add("Boundary touches", f"{len(t_a)} on {boundary_a.lower()}", ta_pts, 25,
        "Touch #1 anchor, #2 candidate, #3 validation" + (f", +{len(t_a) - 3} confirmation" if len(t_a) > 3 else ""))
    to_pts = {0: 0, 1: 5, 2: 12}.get(len(t_o), 15)
    add("Opposite touches", f"{len(t_o)} on {boundary_o.lower()}", to_pts, 15, "Opposite boundary confirmation")
    add("Touch quality", f"{ch['quality']:.0f}%", ch["quality"] * 0.15, 15,
        f"Mean touch deviation within the {CONFIG['touchTolAtr']} ATR tolerance")
    if ch["pdev"] is None:
        add("Parallelism", "unverified", 0, 10, "Fewer than two opposite swings near the boundary")
    else:
        pp = 10 if ch["pdev"] <= 0.25 else 6 if ch["parallelOk"] else -10
        add("Parallelism", f"{ch['pdev']:.2f}", pp, 10, f"Opposite-swing slope drift over the span (tolerance {CONFIG['parallelTol']})")
    span_pts = 10 * min(1.0, ch["span"] / (C["lookback"] * 0.5))
    add("Structure age", f"{ch['span']} bars", span_pts, 10, "Longer respected structures carry more weight")
    resp = 10 * max(0.0, 1 - ch["violShare"] / CONFIG["maxViolationShare"])
    add("Boundary respect", f"{ch['viol']} closes outside", resp, 10, f"{ch['violShare'] * 100:.1f}% of closes outside tolerance")
    add("Recency", f"{ch['recency'] * 100:.0f}%", 5 * ch["recency"], 5, "How recently the boundaries were tested")
    st_adj = {"ACTIVE": 10, "VALIDATED": 5, "WEAKENING": -10, "BROKEN": -5, "RETESTING": 0, "FORMING": -15, "INVALIDATED": -30}[status]
    add("Channel state", status, st_adj, 10, weakening_note or f"Status adjustment for {status}")
    if base["volState"] == "EXPANDING":
        add("Volatility", f"ATR ratio {vol_ratio:.2f}", -5, 0, "Expanding volatility reduces structural reliability")
    conf = sum(e["points"] for e in ev)
    cap = 45 if status == "FORMING" else 25 if status == "INVALIDATED" else 95
    conf = max(0.0, min(cap, conf))
    if slope_dir.startswith("STRONG") and conf < 60 and direction.startswith("STRONG"):
        direction = _soften(direction)

    upper_next, lower_next = _bounds(ch, last + 1)[1], _bounds(ch, last + 1)[0]
    bt = CONFIG["breakTolAtr"] * a_last
    inval: list[str] = []
    tfn = tf
    if status in ("VALIDATED", "ACTIVE", "WEAKENING"):
        if sd >= 0:
            inval.append(f"{tfn} close below the lower boundary {_fmt(lower_next)} by {CONFIG['breakTolAtr']} ATR (< {_fmt(lower_next - bt)}) breaks the channel")
        if sd <= 0:
            inval.append(f"{tfn} close above the upper boundary {_fmt(upper_next)} by {CONFIG['breakTolAtr']} ATR (> {_fmt(upper_next + bt)}) breaks the channel")
        if sd > 0:
            inval.append(f"{tfn} close above {_fmt(upper_next + bt)} is an upside breakout (acceleration, not continuation of the channel)")
        if sd < 0:
            inval.append(f"{tfn} close below {_fmt(lower_next - bt)} is a downside breakout (acceleration)")
    elif status in ("BROKEN", "RETESTING") and breakout:
        up = breakout["side"] == "UP"
        inval.append(f"{tfn} close back {'below' if up else 'above'} the broken boundary {_fmt(breakout['boundary'])} turns the breakout into a failed breakout")
        inval.append(f"Breakout extension beyond {CONFIG['invalidAtr']} ATR or {C['invalidBars']} bars outside retires the channel")
    elif status == "FORMING":
        nxt = lower_next if ch["sgn"] > 0 else upper_next
        need = []
        if len(t_a) < 3:
            need.append(f"touch #3 within {CONFIG['touchTolAtr']} ATR of {_fmt(nxt)} validates the {boundary_a.lower()} boundary")
        if len(t_o) < 2:
            need.append(f"a second touch of the {boundary_o.lower()} boundary")
        if not ch["parallelOk"]:
            need.append("parallel opposite swings")
        inval.append("Awaiting " + "; ".join(need) if need else "Awaiting validation")
        inval.append(f"{tfn} close beyond {_fmt(nxt - ch['sgn'] * bt)} before validation invalidates the forming channel")
    elif status == "INVALIDATED":
        inval.append("Channel retired — a new anchor/candidate pair is required")

    shape = {1: "ascending", -1: "descending"}.get(sd, "horizontal")
    reason_bits = [f"{tf} {status.lower()} {shape} channel"]
    reason_bits.append(f"{len(t_a)}+{len(t_o)} touches")
    reason_bits.append(f"slope {slope20:+.2f} ATR/20 bars, width {ch['width'] / a_last:.1f} ATR")
    if breakout:
        reason_bits.append(f"{breakout['side'].lower()}side break {breakout['barsSince']} bars ago ({breakout['distanceAtr']:+.2f} ATR)")
    if weakening_note:
        reason_bits.append(weakening_note)

    return {
        **base,
        "status": status, "direction": direction, "lean": lean, "confirmed": status in CONFIRMED_STATUSES,
        "channelKey": f"{ch['side']}:{s.ts[ia]}:{s.ts[ch['B']['i']]}",
        "anchorSide": boundary_a,
        "anchor": {"ts": s.ts[ia], "price": ch["A"]["p"]},
        "candidate": {"ts": s.ts[t_a[1]["i"]], "price": t_a[1]["p"]},
        "lineDefinedBy": [{"ts": s.ts[ia], "price": ch["A"]["p"]}, {"ts": s.ts[ch["B"]["i"]], "price": ch["B"]["p"]}],
        "validation": {"ts": s.ts[v_idx], "price": t_a[2]["p"]} if v_idx is not None else None,
        "slope": ch["slope"], "slopeAtr20": round(slope20, 3), "rise": round(rise, 3),
        "width": ch["width"], "widthAtr": round(ch["width"] / a_last, 3),
        "upper": hi_now, "lower": lo_now, "upperNext": upper_next, "lowerNext": lower_next,
        "position": round(pos, 2),
        "touches": {"anchor": len(t_a), "opposite": len(t_o), "total": len(t_a) + len(t_o)},
        "touchList": touch_list,
        "touchQuality": round(ch["quality"], 1),
        "parallelDev": round(ch["pdev"], 3) if ch["pdev"] is not None else None,
        "parallelOk": ch["parallelOk"],
        "ageBars": last - ia, "spanBars": ch["span"],
        "violations": ch["viol"], "violationShare": round(ch["violShare"], 4),
        "breakout": breakout, "failedBreakouts": failed_list,
        "phase": phase, "confidence": round(conf, 1), "evidence": ev, "invalidation": inval,
        "reason": "; ".join(reason_bits),
        "events": sorted(events, key=lambda e: e["ts"]),
        "def": {"anchorTs": s.ts[ia], "anchorPrice": ch["A"]["p"], "slope": ch["slope"], "width": ch["width"],
                "sgn": ch["sgn"], "endTs": breakout["invalidTs"] if breakout and breakout.get("invalidTs") else None},
    }


def _iso_day(ts: int) -> str:
    import time as _t
    return _t.strftime("%Y-%m-%d", _t.gmtime(ts))


def channel_lines(defn: dict[str, Any] | None, ts: list[int], project: int, tf: str) -> list[dict[str, Any]]:
    """Boundary values per bar (and `project` future bars) for a persisted channel definition."""
    if not defn:
        return []
    try:
        ia = ts.index(int(defn["anchorTs"]))
    except ValueError:
        return []
    end_ts = defn.get("endTs")
    out = []
    step = TF_SEC[tf]
    total = len(ts) + (project if not end_ts else 0)
    for i in range(ia, total):
        t = ts[i] if i < len(ts) else ts[-1] + (i - len(ts) + 1) * step
        if end_ts and t > int(end_ts) + 3 * step:
            break
        a = defn["anchorPrice"] + defn["slope"] * (i - ia)
        b = a + defn["sgn"] * defn["width"]
        lo, hi = (a, b) if defn["sgn"] > 0 else (b, a)
        out.append({"ts": t, "lower": lo, "upper": hi, "projected": i >= len(ts)})
    return out


def swing_points(tf: str, bars: list[tuple]) -> list[dict[str, Any]]:
    s = _Series(bars)
    atr = wilder_atr(s.h, s.l, s.c, CONFIG["atrLen"])
    piv = pivots(s.h, s.l, TF_CFG[tf]["pivot"])
    return [{"ts": s.ts[p["i"]], "kind": p["kind"], "price": p["p"]} for p in zigzag(piv, atr, TF_CFG[tf]["minSwingAtr"])]


# ---------------------------------------------------------------- data readiness + instrument synthesis

DATA_RANK = {"BLOCKED": 0, "INSUFFICIENT_DATA": 1, "WARMING_UP": 2, "STALE": 3, "READY": 4}


def data_status(tf: str, series: dict[str, Any] | None, available: int) -> tuple[str, str]:
    """Map the Stage 1 series checkpoint + stored closed-bar count to a Stage 5 readiness state with the exact reason."""
    need = TF_CFG[tf]["minBars"]
    if not series:
        return ("INSUFFICIENT_DATA" if available < need else "WARMING_UP"), f"{tf}: no Stage 1 series checkpoint ({available}/{need} bars)"
    st = series.get("status") or "WARMING_UP"
    why = series.get("reason") or st
    if st in ("PROVIDER_OFFLINE", "VALIDATION_FAILED"):
        return "BLOCKED", f"{tf} Stage 1 {st}: {why}"
    if available < need:
        loading = st in ("WARMING_UP", "SYNCING", "MISSING_HISTORY") and not series.get("provider_exhausted")
        return ("WARMING_UP" if loading else "INSUFFICIENT_DATA"), f"{tf}: {available}/{need} validated closed bars ({why})"
    if st == "STALE":
        return "STALE", f"{tf} Stage 1 STALE: {why}"
    if st in ("READY", "SYNCING"):
        return "READY", f"{tf}: {available} validated closed bars"
    return "WARMING_UP", f"{tf} Stage 1 {st}: {why} ({available}/{need} bars)"


def link_channels(d1: dict[str, Any] | None, h8: dict[str, Any] | None, h1: dict[str, Any] | None) -> None:
    """Attach parent/child identity. This does not change channel geometry or replace the parent direction."""
    parent_id = d1.get("channelKey") if d1 and d1.get("confirmed") else None
    if d1 is not None:
        d1["channelId"] = d1.get("channelKey")
        d1["parentChannelId"] = None
        d1["relationship"] = "PRIMARY" if d1.get("confirmed") else "UNRESOLVED"
    dominant = dir_sign(d1.get("direction")) if d1 and d1.get("confirmed") else 0
    for child in (h8, h1):
        if child is None:
            continue
        child["channelId"] = child.get("channelKey")
        child["parentChannelId"] = parent_id
        confirmed = bool(child.get("confirmed") and child.get("status") not in (None, "NONE", "FORMING"))
        sign = dir_sign(child.get("direction")) if confirmed else 0
        if not confirmed:
            child["relationship"] = "UNRESOLVED"
        elif not sign:
            child["relationship"] = "RANGE_INTERNAL"
        elif dominant == 0:
            child["relationship"] = "RANGE_INTERNAL"
        elif sign == dominant:
            child["relationship"] = "ALIGNED"
        elif d1 and d1.get("status") in ("BROKEN", "INVALIDATED"):
            child["relationship"] = "REVERSAL_CANDIDATE"
        else:
            child["relationship"] = "CORRECTIVE"


def combine(symbol: str, scanner: dict[str, Any], d1: dict[str, Any] | None, h8: dict[str, Any] | None,
            d1_data: tuple[str, str], h8_data: tuple[str, str],
            h1: dict[str, Any] | None = None, h1_data: tuple[str, str] | None = None) -> dict[str, Any]:
    """Instrument-level Stage 5 output published to Structural Direction (Stage 6)."""
    link_channels(d1, h8, h1)
    h1_data = h1_data or ("WARMING_UP", "H1 nested channel not analysed")
    # H1 availability never downgrades the D1/H8 publication. A missing nested channel is reported as NOT DETECTED.
    worst = min((d1_data, h8_data), key=lambda x: DATA_RANK[x[0]])
    if not scanner.get("qualified"):
        status, reason = "BLOCKED", f"Not qualified by Market Scanner — {scanner.get('reason')}"
    elif worst[0] != "READY":
        status, reason = worst
    else:
        status, reason = "READY", "D1 and H8 validated history analysed"

    def dsum(x: dict[str, Any] | None, data: tuple[str, str]) -> dict[str, Any]:
        if not x:
            return {"dataStatus": data[0], "dataReason": data[1], "status": None, "direction": "NEUTRAL", "confirmed": False,
                    "position": None, "phase": None, "confidence": 0}
        return {"dataStatus": data[0], "dataReason": data[1], "status": x["status"], "direction": x["direction"],
                "lean": x.get("lean"), "confirmed": x["confirmed"], "position": x.get("position"), "phase": x["phase"],
                "confidence": x["confidence"], "channelKey": x.get("channelKey"), "channelId": x.get("channelId") or x.get("channelKey"),
                "parentChannelId": x.get("parentChannelId"), "relationship": x.get("relationship"),
                "upper": x.get("upper"), "lower": x.get("lower"), "slope": x.get("slope"), "width": x.get("width"),
                "lastTs": x.get("lastTs"), "breakout": x.get("breakout"), "touches": x.get("touches")}

    d1s, h8s, h1s = dsum(d1, d1_data), dsum(h8, h8_data), dsum(h1, h1_data)
    d1_ok = d1 is not None and d1_data[0] in ("READY", "STALE") and d1["confirmed"]
    s1 = dir_sign(d1["direction"]) if d1_ok else 0
    s2 = dir_sign(h8["direction"]) if h8 and h8_data[0] in ("READY", "STALE") and h8["confirmed"] else 0
    if not d1_ok:
        agreement = "UNCONFIRMED"
    elif s1 and s2:
        agreement = "AGREE" if s1 == s2 else "CONFLICT"
    elif s1 or s2:
        agreement = "PARTIAL"
    else:
        agreement = "NEUTRAL"

    primary = d1["direction"] if d1_ok and status in ("READY", "STALE") else "NEUTRAL"
    phase = d1["phase"] if d1 else None
    if d1 and h8 and d1_ok:
        h8_break_against = h8.get("breakout") and h8["status"] in ("BROKEN", "RETESTING") and \
            dir_sign("BULLISH" if h8["breakout"]["side"] == "UP" else "BEARISH") == -s1
        if h8_break_against:
            phase = "REVERSAL_RISK"
        elif d1["status"] in ("VALIDATED", "ACTIVE") and s2 == -s1 and s1 != 0 and d1["phase"] in ("IMPULSE", "CONSOLIDATION"):
            phase = "PULLBACK"

    conf = 0.0
    if d1:
        conf = 0.65 * d1["confidence"] + 0.35 * (h8["confidence"] if h8 else 0)
        conf += 5 if agreement == "AGREE" else -12 if agreement == "CONFLICT" else 0
        if not d1_ok:
            conf = min(conf, 45)
        if status == "STALE":
            conf *= 0.6
        if status in ("BLOCKED", "INSUFFICIENT_DATA", "WARMING_UP"):
            conf = 0.0
    conf = round(max(0.0, min(95.0, conf)), 1)

    reasoning: list[str] = []
    if status != "READY":
        reasoning.append(reason)
    if d1:
        reasoning.append(d1["reason"])
    if h8:
        reasoning.append(h8["reason"])
    if h1 and h1.get("confirmed"):
        reasoning.append(f"H1 {h1.get('relationship', 'UNRESOLVED').lower().replace('_', ' ')} channel: {h1['reason']}")
    elif h1 and h1.get("status") in (None, "NONE", "FORMING"):
        reasoning.append("H1 nested channel: NOT DETECTED — the H1 swings do not validate a channel")
    structure = d1["direction"] if d1_ok else primary
    if agreement == "AGREE":
        reasoning.append(f"H8 structure agrees with the D1 {structure.replace('_', ' ').lower()} channel")
    elif agreement == "CONFLICT":
        reasoning.append(f"H8 {h8['direction'].replace('_', ' ').lower()} structure conflicts with D1 {structure.replace('_', ' ').lower()} — a nested counter-move, not an HTF reversal")
    elif agreement == "UNCONFIRMED" and d1:
        reasoning.append(f"D1 channel {d1['status'].lower()} — no confirmed primary direction is published")
    if phase:
        reasoning.append(f"Market phase {phase.replace('_', ' ').lower()}")

    invalidation = (d1.get("invalidation") if d1 else []) + (h8.get("invalidation") if h8 else [])
    evidence = [{"tf": "D1", **e} for e in (d1.get("evidence") if d1 else [])] + \
               [{"tf": "H8", **e} for e in (h8.get("evidence") if h8 else [])]
    nested_leg = leg_model.classify(
        dominant_direction=d1.get("direction") if d1_ok else "NEUTRAL",
        position=d1.get("position") if d1 else None,
        d1_confirmed=bool(d1_ok),
        d1_status=(d1 or {}).get("status"),
        d1_phase=(d1 or {}).get("phase"),
        d1_confidence=float((d1 or {}).get("confidence") or 0),
        h8_direction=(h8 or {}).get("direction"),
        h8_confirmed=bool(h8 and h8_data[0] in ("READY", "STALE") and h8.get("confirmed")),
        h1_bias=dir_sign(h1.get("direction")) if h1 and h1.get("confirmed") else 0,
        h1_confirmed_break=bool(h1 and h1.get("confirmed") and h1.get("relationship") == "CORRECTIVE"),
        stale=status == "STALE" or d1_data[0] == "STALE" or h8_data[0] == "STALE",
        d1_boundary_failed=bool(d1 and d1.get("status") == "BROKEN"),
        htf_bos=bool(d1 and d1.get("breakout")),
    )
    if nested_leg["relationship"] == "CORRECTIVE":
        reasoning.append("H8 opposing D1 is a nested correction inside the dominant channel, not contradictory data and not an HTF reversal.")
    elif nested_leg["reasonCode"] == "POTENTIAL_COUNTER_TREND_ZONE":
        reasoning.append(nested_leg["reason"])
    h1_detected = bool(h1 and h1.get("confirmed") and h1.get("channelKey"))
    nested = {
        "parentTimeframe": "D1", "parentChannelId": (d1 or {}).get("channelKey"),
        "childTimeframe": "H1" if h1_detected else "H8",
        "childChannelId": (h1 or {}).get("channelKey") if h1_detected else (h8 or {}).get("channelKey"),
        "relationship": (h1 or {}).get("relationship") if h1_detected else nested_leg["relationship"],
        "region": nested_leg["region"],
        "currentLeg": nested_leg["currentLeg"], "expectedDestination": nested_leg["expectedDestination"],
        "h1Status": h1.get("status") if h1_detected else "NOT_DETECTED",
        "h1Direction": h1.get("direction") if h1_detected else None,
        "h1Relationship": h1.get("relationship") if h1_detected else None,
        "h1ChannelId": h1.get("channelKey") if h1_detected else None,
        "h1Upper": h1.get("upper") if h1_detected else None,
        "h1Lower": h1.get("lower") if h1_detected else None,
    }
    return {
        "symbol": symbol, "status": status, "reason": reason, "scanner": scanner,
        "primaryDirection": primary, "agreement": agreement, "phase": phase,
        "channelPosition": d1.get("position") if d1 else None, "confidence": conf,
        "d1": d1s, "h8": h8s, "h1": h1s, "nested": nested, "observation": nested_leg["observation"],
        "invalidation": invalidation, "evidence": evidence, "reasoning": reasoning,
        "executes": False,
    }
