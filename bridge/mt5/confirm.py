"""Stage 7 H1 Confirmation: direction-aware H1 structure confirmation engine (pure, no I/O).

H1 does not invent a direction and does not flip the dominant HTF trend. It confirms the leg Stage 6
describes: continuation with the dominant trend, or a counter-trend correction when HTF location and
a confirmed H1 BOS/CHoCH agree. Channel position alone never confirms a trade.
Confirmation uses closed H1 candles only; Stage 7 never places a trade.
"""

from __future__ import annotations

from typing import Any

try:
    import vision
    import leg_model
except ImportError:  # pragma: no cover
    from bridge.mt5 import vision, leg_model  # type: ignore

STATES = ("WAITING_FOR_STAGE6", "WARMING_UP", "MONITORING", "PULLBACK", "SETUP_FORMING", "CONFIRMING",
          "BREAKOUT_CONFIRMED_WAIT_RETEST", "CONFIRMED", "REJECTED", "INVALIDATED", "STALE", "BLOCKED")
GATE_STATUSES = ("PASS", "WAIT", "FAIL", "STALE", "N/A")
H1_SEC = 3600

CONFIG: dict[str, Any] = {
    "atrLen": 14,
    "pivot": 3,                 # fractal bars each side for an H1 swing
    "minSwingAtr": 1.0,         # zigzag reversal amplitude in ATR
    "lookback": 400,            # closed H1 bars analysed
    "minBars": 300,             # closed H1 bars required
    "pullbackMin": 0.382,       # retracement of the prior impulse leg that counts as a pullback
    "pullbackDeep": 0.786,
    "pullbackLookback": 90,     # bars within which the pullback extreme must lie
    "triggerMaxAge": 24,        # a BOS/CHoCH trigger older than this many bars has expired
    "retestTolAtr": 0.3,
    "falseBreakAtr": 0.3,
    "falseBreakBars": 12,
    "momentumAtr": 0.5,         # 5-bar move (ATR) in the expected direction that counts as momentum
    "momentumAgainstAtr": 1.0,
    "expansion": 1.2,
    "contraction": 0.8,
    "impulseAtr": 1.5,
    "consolidationAtr": 2.5,
    "idealRiskAtr": 3.5,        # distance to the invalidation level
    "maxRiskAtr": 6.0,
    "h8OverheadPct": 90,        # trend-relative H8 position at which the H8 boundary blocks the entry location
    "confirmScore": 65,
    # Immediate entry is withheld when the close has run away from the broken level.
    # Distances are ATR-normalized. Channel position (0 = origin, 100 = destination) is a second factor, not a lone rule.
    "extensionChaseAtr": 2.5,
    "extensionLateAtr": 1.2,
    "lateChannelPct": 78.0,
    "noRoomPct": 92.0,
}

BREAKOUT_MODEL_PHASES = ("BREAKOUT", "RETEST", "REVERSAL")


def _sign(d: str | None) -> int:
    return vision.dir_sign(d)


def _side(sign: int) -> str:
    return "UP" if sign > 0 else "DOWN"


def _fmt(p: float | None) -> str:
    if p is None:
        return "—"
    a = abs(p)
    return f"{p:.2f}" if a >= 1000 else f"{p:.3f}" if a >= 20 else f"{p:.5f}"


# ---------------------------------------------------------------- Stage 1 H1 readiness (read only)

def h1_data_status(series: dict[str, Any] | None, available: int, cfg: dict[str, Any] | None = None) -> tuple[str, str]:
    cfg = cfg or CONFIG
    need = cfg["minBars"]
    if not series:
        return "WARMING_UP", f"H1: no Stage 1 series checkpoint ({available}/{need} bars)"
    st = series.get("status") or "WARMING_UP"
    why = series.get("reason") or st
    if st in ("PROVIDER_OFFLINE", "VALIDATION_FAILED"):
        return "BLOCKED", f"H1 Stage 1 {st}: {why}"
    if available < need:
        loading = st in ("WARMING_UP", "SYNCING", "MISSING_HISTORY") and not series.get("provider_exhausted")
        return ("WARMING_UP" if loading else "INSUFFICIENT_DATA"), f"H1: {available}/{need} validated closed bars ({why})"
    if st == "STALE":
        return "STALE", f"H1 Stage 1 STALE: {why}"
    if st in ("READY", "SYNCING"):
        return "READY", f"H1: {available} validated closed bars · {why}"
    return "WARMING_UP", f"H1 Stage 1 {st}: {why}"


# ---------------------------------------------------------------- direction-agnostic H1 structure

def analyse_h1(bars: list[tuple], cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Swings with HH/HL/LH/LL labels, BOS/CHoCH events (no look-ahead), momentum and volatility of closed H1 bars."""
    cfg = cfg or CONFIG
    bars = bars[-cfg["lookback"]:]
    ts = [int(b[0]) for b in bars]
    h = [float(b[2]) for b in bars]
    lo = [float(b[3]) for b in bars]
    c = [float(b[4]) for b in bars]
    n = len(c)
    k = cfg["pivot"]
    atr = vision.wilder_atr(h, lo, c, cfg["atrLen"])
    atr_fast = vision.wilder_atr(h, lo, c, 5)
    zz = vision.zigzag(vision.pivots(h, lo, k), atr, cfg["minSwingAtr"])

    swings: list[dict[str, Any]] = []
    last = {"H": None, "L": None}
    for p in zz:
        prev = last[p["kind"]]
        if prev is None:
            label = p["kind"]
        elif p["kind"] == "H":
            label = "HH" if p["p"] > prev else "LH"
        else:
            label = "HL" if p["p"] > prev else "LL"
        last[p["kind"]] = p["p"]
        swings.append({"i": p["i"], "ts": ts[p["i"]], "kind": p["kind"], "price": p["p"], "label": label,
                       "confirmI": min(p["i"] + k, n - 1), "confirmTs": ts[min(p["i"] + k, n - 1)]})

    events: list[dict[str, Any]] = []
    bias = 0
    active = {"H": None, "L": None}
    order = sorted(swings, key=lambda s: s["confirmI"])
    ptr = 0
    for j in range(n):
        while ptr < len(order) and order[ptr]["confirmI"] <= j:
            active[order[ptr]["kind"]] = order[ptr]
            ptr += 1
        sh, sl = active["H"], active["L"]
        if sh is not None and c[j] > sh["price"]:
            events.append({"type": "CHOCH" if bias == -1 else "BOS", "side": "UP", "i": j, "ts": ts[j], "level": sh["price"],
                           "swingTs": sh["ts"], "swingLabel": sh["label"], "price": c[j]})
            bias, active["H"] = 1, None
        if sl is not None and c[j] < sl["price"]:
            events.append({"type": "CHOCH" if bias == 1 else "BOS", "side": "DOWN", "i": j, "ts": ts[j], "level": sl["price"],
                           "swingTs": sl["ts"], "swingLabel": sl["label"], "price": c[j]})
            bias, active["L"] = -1, None

    highs = [s for s in swings if s["kind"] == "H"][-2:]
    lows = [s for s in swings if s["kind"] == "L"][-2:]
    hl = {x["label"] for x in highs[-1:] + lows[-1:]}
    trend = "BULLISH" if hl == {"HH", "HL"} else "BEARISH" if hl == {"LH", "LL"} else "RANGE"
    a = atr[-1] if atr else 0.0
    mom5 = (c[-1] - c[-6]) / a if n > 6 and a else 0.0
    mom_prev = (c[-6] - c[-11]) / a if n > 11 and a else 0.0
    vol_ratio = atr_fast[-1] / a if a else 1.0
    rng12 = (max(h[-12:]) - min(lo[-12:])) / a if n >= 12 and a else 0.0
    return {
        "bars": n, "ts": ts, "high": h, "low": lo, "close": c, "atr": a, "lastTs": ts[-1] if ts else None,
        "lastClose": c[-1] if c else None, "swings": swings, "events": events, "bias": bias, "trend": trend,
        "activeHigh": active["H"]["price"] if active["H"] else None, "activeLow": active["L"]["price"] if active["L"] else None,
        "mom5": round(mom5, 3), "momPrev": round(mom_prev, 3), "volRatio": round(vol_ratio, 3),
        "volState": "EXPANDING" if vol_ratio >= cfg["expansion"] else "CONTRACTING" if vol_ratio <= cfg["contraction"] else "NORMAL",
        "range12Atr": round(rng12, 2),
    }


# ---------------------------------------------------------------- direction-aware setup

def setup(st: dict[str, Any], d: int, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Pullback, trigger (BOS/CHoCH after the pullback extreme), retest / false breakout and invalidation for direction d."""
    cfg = cfg or CONFIG
    n, a = st["bars"], st["atr"] or 1e-9
    h, lo, c, ts = st["high"], st["low"], st["close"], st["ts"]
    peak, trough = ("H", "L") if d > 0 else ("L", "H")
    x = lambda p: d * p  # noqa: E731  (directional price: the expected direction is always "up")
    sw = st["swings"]
    out: dict[str, Any] = {"model": "PULLBACK_CONTINUATION", "pullback": "NONE", "depth": None, "peak": None, "extreme": None,
                           "origin": None, "trigger": None, "triggerAgeBars": None, "retest": None, "falseBreakout": None,
                           "counterAfterTrigger": None, "invalidation": None, "invalidated": False, "riskAtr": None, "fib": None}

    last = sw[-1] if sw else None

    # live pullback: retracement from the latest peak that has not formed a confirmed trough yet
    live: dict[str, Any] | None = None
    if last and last["kind"] == peak:
        prev_t = next((s for s in reversed(sw[:-1]) if s["kind"] == trough), None)
        if prev_t:
            ext_i = max(range(last["i"], n), key=lambda i: -x(lo[i] if d > 0 else h[i]))
            ext_p = lo[ext_i] if d > 0 else h[ext_i]
            leg = x(last["price"]) - x(prev_t["price"])
            depth = (x(last["price"]) - x(ext_p)) / leg if leg > 0 else 0.0
            live = {"peak": last, "origin": prev_t, "depth": round(depth, 3), "fib": _fib(last["price"], leg, d),
                    "invalidation": prev_t["price"],
                    "pullback": "NONE" if x(c[-1]) > x(last["price"]) else "IN_PROGRESS" if depth >= cfg["pullbackMin"] else "SHALLOW"}
            if live["pullback"] == "IN_PROGRESS":
                live["extreme"] = {"i": ext_i, "ts": ts[ext_i], "price": ext_p}

    # most recent completed pullback (confirmed trough after a counter move of sufficient depth)
    done: dict[str, Any] | None = None
    troughs = [s for s in sw if s["kind"] == trough]
    for t in reversed(troughs[-4:]):
        if n - 1 - t["i"] > cfg["pullbackLookback"]:
            break
        p = next((s for s in reversed(sw) if s["kind"] == peak and s["i"] < t["i"]), None)
        if p is None:
            break
        o = next((s for s in reversed(sw) if s["kind"] == trough and s["i"] < p["i"]), None)
        done = _pullback_setup(st, d, t, p, o, cfg)
        if done:
            break

    fresh = lambda s: s and s.get("trigger") and s["triggerAgeBars"] <= cfg["triggerMaxAge"]  # noqa: E731
    if done and fresh(done) and (done["falseBreakout"] or done["counterAfterTrigger"]):
        chosen = done
    elif live and live["pullback"] == "IN_PROGRESS":
        chosen = live
    elif done:
        chosen = done
    elif live:
        chosen = live
    elif last and last["kind"] == trough:
        chosen = {"pullback": "SHALLOW", "invalidation": last["price"]}
    else:
        chosen = {}
    out.update(chosen)

    if out["pullback"] in ("COMPLETE", "HOLDING") and out["extreme"]:
        out["invalidation"] = out["extreme"]["price"]
        out["invalidated"] = any(x(c[i]) < x(out["invalidation"]) for i in range(out["extreme"]["i"] + 1, n))
    elif out["invalidation"] is not None:
        out["invalidated"] = x(c[-1]) < x(out["invalidation"])
    if out["invalidation"] is not None and c:
        out["riskAtr"] = round((x(c[-1]) - x(out["invalidation"])) / a, 2)
    return out


def _fib(p: float, leg: float, d: int) -> dict[str, float]:
    return {"f382": p - d * 0.382 * leg, "f618": p - d * 0.618 * leg, "f786": p - d * 0.786 * leg}


def _pullback_setup(st: dict[str, Any], d: int, t: dict[str, Any], p: dict[str, Any], o: dict[str, Any] | None,
                    cfg: dict[str, Any]) -> dict[str, Any] | None:
    """Pullback peak p -> trough t (leg origin o); None when the counter move is too shallow to count as a pullback."""
    n, a = st["bars"], st["atr"] or 1e-9
    c, ts = st["close"], st["ts"]
    x = lambda v: d * v  # noqa: E731
    leg = x(p["price"]) - x(o["price"]) if o else None
    depth = (x(p["price"]) - x(t["price"])) / leg if leg and leg > 0 else None
    counter = [e for e in st["events"] if e["side"] == _side(-d) and p["i"] <= e["i"] <= t["i"] + cfg["pivot"]]
    if not ((depth is not None and depth >= cfg["pullbackMin"]) or counter):
        return None
    out: dict[str, Any] = {"peak": p, "origin": o, "depth": round(depth, 3) if depth is not None else None,
                           "extreme": {"i": t["i"], "ts": t["ts"], "price": t["price"]}, "fib": _fib(p["price"], leg, d) if leg else None,
                           "pullback": "HOLDING", "trigger": None, "triggerAgeBars": None, "retest": None, "falseBreakout": None,
                           "counterAfterTrigger": None}
    trig = next((e for e in st["events"] if e["side"] == _side(d) and e["i"] > t["i"]), None)
    if not trig:
        return out
    out.update(pullback="COMPLETE", trigger=trig, triggerAgeBars=n - 1 - trig["i"])
    lvl = trig["level"]
    tol, fb = cfg["retestTolAtr"] * a, cfg["falseBreakAtr"] * a
    lows, highs = st["low"], st["high"]
    for j in range(trig["i"] + 1, n):
        if x(c[j]) < x(lvl) - fb and j - trig["i"] <= cfg["falseBreakBars"]:
            out.update(falseBreakout={"ts": ts[j], "price": c[j], "level": lvl}, retest=None)
            break
        touch = lows[j] if d > 0 else highs[j]
        if out["retest"] is None and x(touch) <= x(lvl) + tol and x(c[j]) >= x(lvl):
            out["retest"] = {"ts": ts[j], "price": touch, "level": lvl}
        if out["retest"] is not None and j - trig["i"] > cfg["falseBreakBars"]:
            break
    out["counterAfterTrigger"] = next((e for e in st["events"] if e["side"] == _side(-d) and e["i"] > trig["i"] and e["type"] == "CHOCH"), None)
    return out


# ---------------------------------------------------------------- confirmation decision

def _gate(key: str, label: str, status: str, detail: str, mandatory: bool = True, ts: int | None = None) -> dict[str, Any]:
    return {"key": key, "label": label, "status": status, "detail": detail, "mandatory": mandatory, "ts": ts}


GATE_ORDER = [("htf", "HTF Direction"), ("structure", "Stage 5/6 Structure"), ("location", "Channel Location"),
              ("freshness", "H1 Data Freshness"), ("h1Structure", "H1 Structure"), ("pullback", "Pullback State"),
              ("bos", "BOS"), ("choch", "CHoCH"), ("momentum", "Momentum"), ("retest", "Breakout/Retest"),
              ("invalidation", "Invalidation"), ("score", "Overall Confirmation Score")]


def _blank(symbol: str, s6: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "symbol": symbol, "state": "WAITING_FOR_STAGE6", "direction": "NEUTRAL", "expectedDirection": "NEUTRAL",
        "reasonCode": None, "reason": "", "explanation": "", "phase": None, "score": 0.0, "components": [],
        "gates": {k: _gate(k, lbl, "N/A", "Not evaluated") for k, lbl in GATE_ORDER}, "reasoning": [],
        "h1": None, "setup": None, "invalidationLevel": None, "confirmed": False, "handoff": None,
        "stage6": None if s6 is None else {
            "state": s6.get("state"), "direction": s6.get("direction"), "expectedDirection": s6.get("expectedDirection"),
            "reasonCode": s6.get("reasonCode"), "reason": s6.get("reason"), "phase": s6.get("structuralPhase"),
            "alignment": s6.get("alignment"), "confidence": s6.get("confidence"), "zone": (s6.get("zone") or {}).get("name"),
            "positionD1": (s6.get("position") or {}).get("d1"), "positionH8": (s6.get("position") or {}).get("h8"),
            "price": (s6.get("position") or {}).get("price"), "d1": s6.get("d1"), "h8": s6.get("h8"),
            "freshness": (s6.get("freshness") or {}).get("status"), "readySince": s6.get("readySince"),
            "invalidation": s6.get("invalidation") or [],
        },
        "data": None, "live": None, "executes": False,
    }


def _finish(out: dict[str, Any], state: str, code: str, reason: str) -> dict[str, Any]:
    out.update(state=state, reasonCode=code, reason=reason[:500])
    out["explanation"] = explain(out)[:1200]
    return out


def intrabar(o: dict[str, Any], live: dict[str, Any] | None, d: int) -> dict[str, Any] | None:
    """Live-price structural events between H1 closes. They re-trigger evaluation but never confirm on their own."""
    if not live or live.get("price") is None or not o.get("h1"):
        return None
    px, h = float(live["price"]), o["h1"]
    brk = h["activeHigh"] if d > 0 else h["activeLow"]
    inv = o.get("invalidationLevel")
    event = None
    if inv is not None and d * px < d * inv:
        event = "INVALIDATION_BREACH"
    elif brk is not None and d * px > d * brk:
        event = "BOS_ATTEMPT"
    return {"price": px, "at": live.get("time"), "event": event, "breakLevel": brk, "invalidationLevel": inv,
            "note": None if event is None else
            (f"Live price through invalidation {_fmt(inv)} — awaiting H1 close" if event == "INVALIDATION_BREACH"
             else f"Live price through H1 swing {_fmt(brk)} — BOS/CHoCH needs an H1 close")}


def _counter_trend(out: dict[str, Any], s6: dict[str, Any], st: dict[str, Any], cfg: dict[str, Any], d_htf: int,
                  state: str, code: str, reason: str) -> tuple[str, str, str]:
    """Confirm a corrective leg when HTF location and H1 structure agree. Never flips the dominant trend."""
    pos = (s6.get("position") or {}).get("d1")
    d1, h8 = s6.get("d1") or {}, s6.get("h8") or {}
    side = "UP" if st.get("bias", 0) > 0 else "DOWN" if st.get("bias", 0) < 0 else ""
    confirmed = any(e.get("type") in ("BOS", "CHOCH") and e.get("side") == side for e in (st.get("events") or []))
    data_stale = (out.get("data") or {}).get("status") == "STALE" or (s6.get("freshness") or {}).get("status") == "STALE"
    leg = leg_model.classify(
        dominant_direction=d1.get("direction") or s6.get("direction"),
        position=pos,
        d1_confirmed=bool(d1.get("confirmed", True)),
        d1_status=d1.get("status"),
        d1_phase=s6.get("structuralPhase"),
        d1_confidence=float(s6.get("confidence") or 0),
        h8_direction=h8.get("direction"),
        h8_confirmed=bool(h8.get("confirmed")),
        h1_bias=int(st.get("bias") or 0),
        h1_confirmed_break=confirmed,
        stale=data_stale,
        d1_boundary_failed=d1.get("status") == "BROKEN",
        htf_bos=bool(d1.get("breakout")),
    )
    out["marketLeg"] = leg
    out["tradeType"] = leg["tradeType"]
    if data_stale:
        return "BLOCKED", "STALE_STRUCTURE", leg["reason"]
    if leg["reasonCode"] == "INSUFFICIENT_RETRACEMENT_ROOM" and int(st.get("bias") or 0) == -d_htf:
        return "BLOCKED", "INSUFFICIENT_RETRACEMENT_ROOM", leg["reason"]
    if leg["candidate"] and str(leg["tradeType"]).startswith("COUNTER_TREND"):
        trade_sign = -d_htf
        su = setup(st, trade_sign, cfg)
        trig = su.get("trigger")
        fresh_trig = trig is not None and su.get("triggerAgeBars") is not None and su["triggerAgeBars"] <= cfg["triggerMaxAge"]
        if not fresh_trig or su.get("invalidated"):
            return "MONITORING", "AWAITING_LTF_STRUCTURE", leg["reason"]
        su["model"] = leg["tradeType"]
        out["setup"] = {k: (v if not isinstance(v, dict) else {kk: vv for kk, vv in v.items() if kk != "i"}) for k, v in su.items()}
        out["invalidationLevel"] = su.get("invalidation")
        out["expectedDirection"] = "BEARISH" if trade_sign < 0 else "BULLISH"
        g = out["gates"]
        g["location"] = _gate("location", "Channel Location", "PASS", leg["reason"])
        g["h1Structure"] = _gate("h1Structure", "H1 Structure", "PASS",
                                f"H1 {leg['ltfTrend'].lower()} nested structure confirms the {leg['tradeType']} leg. "
                                f"Dominant trend stays {leg['dominantTrend']}. Reversal {leg['reversalState']}.")
        return "CONFIRMED", "CONFIRMED_COUNTER_TREND", leg["reason"]
    if leg["reasonCode"] == "AWAITING_LTF_STRUCTURE" and int(st.get("bias") or 0) == -d_htf and leg["evidence"].get("counterZone"):
        return "MONITORING", "AWAITING_LTF_STRUCTURE", leg["reason"]
    if leg["reasonCode"] == "LOCATION_IS_CONTEXT" and state == "CONFIRMED" and s6.get("structuralPhase") not in BREAKOUT_MODEL_PHASES:
        return "MONITORING", "LOCATION_IS_CONTEXT", leg["reason"]
    return state, code, reason


def evaluate(symbol: str, s6: dict[str, Any] | None, series: dict[str, Any] | None, bars: list[tuple] | None,
             now_ts: float, cfg: dict[str, Any] | None = None, live: dict[str, Any] | None = None,
             missed_bars: int = 0) -> dict[str, Any]:
    cfg = cfg or CONFIG
    out = _blank(symbol, s6)
    g = out["gates"]
    available = len(bars or []) if bars is not None else int((series or {}).get("candle_count") or 0)
    dst, dwhy = h1_data_status(series, available, cfg)
    out["data"] = {"status": dst, "reason": dwhy, "available": available, "required": cfg["minBars"],
                   "latestTs": (series or {}).get("latest_ts")}
    g["freshness"] = _gate("freshness", "H1 Data Freshness", "PASS" if dst == "READY" else "STALE" if dst == "STALE" else
                           "FAIL" if dst in ("BLOCKED", "INSUFFICIENT_DATA") else "WAIT", dwhy, ts=(series or {}).get("latest_ts"))

    # ---- Stage 6 gate: H1 only confirms a direction handed over by Structural Direction
    if s6 is None:
        g["htf"] = _gate("htf", "HTF Direction", "WAIT", "Stage 6 has not evaluated this instrument")
        return _finish(out, "WAITING_FOR_STAGE6", "STAGE6_NOT_EVALUATED", "No Stage 6 Structural Direction decision yet")
    s6st = s6.get("state")
    d = _sign(s6.get("expectedDirection") or s6.get("direction"))
    d1 = s6.get("d1") or {}
    g["structure"] = _gate("structure", "Stage 5/6 Structure",
                           "PASS" if d1.get("confirmed") else "FAIL",
                           f"D1 {d1.get('status') or 'no channel'} {d1.get('direction') or ''} · Stage 6 {s6.get('alignment')} · phase {s6.get('structuralPhase')}")
    if s6st != "READY_FOR_H1" or not s6.get("handoff"):
        g["htf"] = _gate("htf", "HTF Direction", "FAIL" if s6st in ("BLOCKED", "CONFLICT", "INVALIDATED") or d == 0 else
                         "STALE" if s6st == "STALE" else "WAIT",
                         f"Stage 6 {s6st} {s6.get('direction')} — {s6.get('reasonCode')}: {s6.get('reason')}")
        state = {"BLOCKED": "BLOCKED", "CONFLICT": "BLOCKED", "INVALIDATED": "INVALIDATED", "STALE": "STALE"}.get(s6st, "WAITING_FOR_STAGE6")
        return _finish(out, state, f"STAGE6_{s6st}", f"Stage 6 {s6st} ({s6.get('reasonCode')}): {s6.get('reason')}")
    if d == 0:
        g["htf"] = _gate("htf", "HTF Direction", "FAIL", "Stage 6 expected direction NEUTRAL")
        return _finish(out, "BLOCKED", "HTF_DIRECTION_NEUTRAL", "Stage 6 hand-off carries no direction — H1 never creates one")
    out.update(direction=s6.get("direction"), expectedDirection=s6.get("expectedDirection"))
    g["htf"] = _gate("htf", "HTF Direction", "PASS",
                     f"Stage 6 READY_FOR_H1 {s6.get('direction')} · {s6.get('reasonCode')} · structural confidence {float(s6.get('confidence') or 0):.0f}")
    if not d1.get("confirmed"):
        return _finish(out, "BLOCKED", "MISSING_CHANNEL_EVIDENCE", "Stage 6 hand-off without a confirmed Stage 5 D1 channel")
    if (s6.get("freshness") or {}).get("status") == "STALE":
        g["structure"]["status"] = "STALE"
        return _finish(out, "STALE", "STAGE6_STALE", "Stage 5/6 structural evidence is stale")

    # ---- channel location (Stage 5/6 positions, never recomputed)
    model = "BREAKOUT_RETEST" if s6.get("structuralPhase") in BREAKOUT_MODEL_PHASES else "PULLBACK_CONTINUATION"
    zone = (s6.get("zone") or {}).get("name") or "UNKNOWN"
    pos = s6.get("position") or {}
    h8p = pos.get("h8")
    h8rel = None if h8p is None else (h8p if d > 0 else 100 - h8p)
    side_word = "upper" if d > 0 else "lower"
    if zone in ("EXTENDED", "BEYOND_EXTENSION") and model != "BREAKOUT_RETEST":
        loc = ("FAIL", f"D1 position {pos.get('d1')}% ({zone.lower()}) — structurally poor {side_word}-channel location for a "
                       f"{'long' if d > 0 else 'short'}; only a validated breakout/retest permits it")
    elif zone == "BEYOND_SUPPORT":
        loc = ("FAIL", f"Price beyond the D1 {'lower' if d > 0 else 'upper'} boundary — HTF support lost")
    elif zone == "UNKNOWN":
        loc = ("WAIT", "No D1 channel position available")
    elif h8rel is not None and h8rel >= cfg["h8OverheadPct"] and model != "BREAKOUT_RETEST":
        loc = ("WAIT", f"H8 position {h8p:.0f}% — H8 {side_word} boundary directly {'overhead' if d > 0 else 'below'}")
    else:
        loc = ("PASS", f"D1 {pos.get('d1')}% ({zone.replace('_', ' ').lower()})" + (f" · H8 {h8p:.0f}%" if h8p is not None else "")
               + (" · breakout/retest model" if model == "BREAKOUT_RETEST" else ""))
    g["location"] = _gate("location", "Channel Location", loc[0], loc[1])

    # ---- H1 data
    if dst == "BLOCKED":
        return _finish(out, "BLOCKED", "H1_DATA_BLOCKED", dwhy)
    if dst in ("WARMING_UP", "INSUFFICIENT_DATA"):
        return _finish(out, "WARMING_UP", "INSUFFICIENT_H1_HISTORY", dwhy)
    if not bars or len(bars) < cfg["minBars"]:
        return _finish(out, "WARMING_UP", "INSUFFICIENT_H1_HISTORY", f"H1: {len(bars or [])}/{cfg['minBars']} closed bars readable")

    st = analyse_h1(bars, cfg)
    su = setup(st, d, cfg)
    su["model"] = model
    out["h1"] = {k: st[k] for k in ("bars", "atr", "lastTs", "lastClose", "bias", "trend", "mom5", "momPrev", "volRatio", "volState",
                                    "range12Atr", "activeHigh", "activeLow")}
    out["h1"]["swings"] = st["swings"][-12:]
    out["h1"]["events"] = [{k: v for k, v in e.items() if k != "i"} for e in st["events"][-12:]]
    out["setup"] = {k: (v if not isinstance(v, dict) else {kk: vv for kk, vv in v.items() if kk != "i"}) for k, v in su.items()}
    out["invalidationLevel"] = su["invalidation"]
    a = st["atr"] or 1e-9
    sd = _side(d)

    # ---- H1 gates
    if dst == "STALE":
        g["freshness"]["status"] = "STALE"
    bias_ok = st["bias"] == d
    g["h1Structure"] = _gate("h1Structure", "H1 Structure", "PASS" if bias_ok else "WAIT",
                             f"H1 structure bias {'bullish' if st['bias'] > 0 else 'bearish' if st['bias'] < 0 else 'undefined'} · "
                             f"swings {st['trend'].lower()} ({', '.join(s['label'] for s in st['swings'][-4:]) or 'none'})"
                             + ("" if bias_ok else " — H1 counter-move inside the HTF structure; waiting for it to turn"))
    pb = su["pullback"]
    depth_txt = f"{su['depth'] * 100:.0f}% retracement" if su["depth"] is not None else "counter-structure break"
    if pb == "COMPLETE":
        g["pullback"] = _gate("pullback", "Pullback State", "PASS", f"Pullback completed ({depth_txt}) at {_fmt(su['extreme']['price'])}",
                              ts=su["extreme"]["ts"])
    elif pb == "HOLDING":
        g["pullback"] = _gate("pullback", "Pullback State", "WAIT", f"Pullback ({depth_txt}) holding at {_fmt(su['extreme']['price'])} — awaiting H1 {sd.lower()}side break",
                              ts=su["extreme"]["ts"])
    elif pb == "IN_PROGRESS":
        g["pullback"] = _gate("pullback", "Pullback State", "WAIT", f"Pullback in progress ({depth_txt} of the last H1 leg)")
    elif model == "BREAKOUT_RETEST":
        g["pullback"] = _gate("pullback", "Pullback State", "N/A", "Breakout/retest model — the retest replaces the pullback", mandatory=False)
    else:
        g["pullback"] = _gate("pullback", "Pullback State", "WAIT",
                              "No H1 pullback yet — impulse in progress, re-entry requires a pullback" if pb == "NONE" else
                              f"Retracement only {su['depth'] * 100:.0f}% (< {cfg['pullbackMin'] * 100:.1f}%)")

    trig = su["trigger"]
    fresh_trig = trig is not None and su["triggerAgeBars"] is not None and su["triggerAgeBars"] <= cfg["triggerMaxAge"]
    for key, typ in (("bos", "BOS"), ("choch", "CHOCH")):
        label = "BOS" if key == "bos" else "CHoCH"
        if trig and trig["type"] == typ and fresh_trig:
            g[key] = _gate(key, label, "PASS", f"{label} {sd.lower()} at {_fmt(trig['level'])} (swing {trig['swingLabel']}) · {su['triggerAgeBars']} bars ago",
                           mandatory=False, ts=trig["ts"])
        elif trig and fresh_trig:
            g[key] = _gate(key, label, "N/A", f"Confirmation came from {'CHoCH' if trig['type'] == 'CHOCH' else 'BOS'}", mandatory=False)
        elif trig:
            g[key] = _gate(key, label, "WAIT", f"Last {sd.lower()} trigger {su['triggerAgeBars']} bars ago has expired (> {cfg['triggerMaxAge']})", mandatory=False)
        else:
            g[key] = _gate(key, label, "WAIT", f"No H1 {label} {sd.lower()} after the pullback extreme yet", mandatory=False)
    counter = su["counterAfterTrigger"]
    if counter and fresh_trig:
        g["choch"] = _gate("choch", "CHoCH", "FAIL", f"CHoCH {_side(-d).lower()} at {_fmt(counter['level'])} after the trigger — H1 reversed against the HTF",
                           mandatory=False, ts=counter["ts"])

    m5, mp = d * st["mom5"], d * st["momPrev"]
    if m5 >= cfg["momentumAtr"]:
        g["momentum"] = _gate("momentum", "Momentum", "PASS", f"5-bar move {m5:+.2f} ATR with the HTF direction · volatility {st['volState'].lower()}"
                              + (" · recovering" if m5 > mp else ""))
    elif m5 <= -cfg["momentumAgainstAtr"] and fresh_trig:
        g["momentum"] = _gate("momentum", "Momentum", "FAIL", f"5-bar move {m5:+.2f} ATR against the HTF direction after the trigger")
    else:
        g["momentum"] = _gate("momentum", "Momentum", "WAIT", f"5-bar move {m5:+.2f} ATR (needs ≥ {cfg['momentumAtr']} ATR with the HTF direction)")

    if su["falseBreakout"] and fresh_trig:
        g["retest"] = _gate("retest", "Breakout/Retest", "FAIL", f"False breakout — H1 closed back through {_fmt(su['falseBreakout']['level'])}",
                            ts=su["falseBreakout"]["ts"])
    elif su["retest"] and fresh_trig:
        g["retest"] = _gate("retest", "Breakout/Retest", "PASS", f"Broken level {_fmt(su['retest']['level'])} retested and held", mandatory=False,
                            ts=su["retest"]["ts"])
    elif trig and fresh_trig:
        g["retest"] = _gate("retest", "Breakout/Retest", "WAIT" if model == "BREAKOUT_RETEST" else "N/A",
                            f"No retest of {_fmt(trig['level'])} yet" + ("" if model == "BREAKOUT_RETEST" else " (optional for pullback continuation)"),
                            mandatory=model == "BREAKOUT_RETEST")
    else:
        g["retest"] = _gate("retest", "Breakout/Retest", "N/A", "No H1 breakout to retest", mandatory=False)

    inv = su["invalidation"]
    if inv is None:
        g["invalidation"] = _gate("invalidation", "Invalidation", "WAIT", "No H1 swing defines an invalidation level yet")
    elif su["invalidated"]:
        g["invalidation"] = _gate("invalidation", "Invalidation", "FAIL", f"H1 closed {'below' if d > 0 else 'above'} the invalidation level {_fmt(inv)}")
    elif su["riskAtr"] is not None and su["riskAtr"] > cfg["maxRiskAtr"]:
        g["invalidation"] = _gate("invalidation", "Invalidation", "WAIT", f"Invalidation {_fmt(inv)} is {su['riskAtr']:.1f} ATR away (> {cfg['maxRiskAtr']} ATR)")
    else:
        g["invalidation"] = _gate("invalidation", "Invalidation", "PASS",
                                  f"H1 close {'below' if d > 0 else 'above'} {_fmt(inv)} invalidates · {su['riskAtr']:.1f} ATR from price")

    # ---- weighted evidence
    comps: list[dict[str, Any]] = []

    def add(key: str, label: str, pts: float, mx: float, detail: str) -> None:
        comps.append({"key": key, "label": label, "points": round(pts, 1), "max": mx, "detail": detail})

    add("htf", "HTF structural confidence", 20 * min(1.0, float(s6.get("confidence") or 0) / 100), 20, f"Stage 6 confidence {float(s6.get('confidence') or 0):.0f}")
    add("location", "Entry location", {"PASS": 12 if zone == "VALUE" or model == "BREAKOUT_RETEST" else 6, "WAIT": 0, "FAIL": -15}[loc[0]], 12, loc[1])
    add("structure", "H1 structure", (8 if bias_ok else 0) + (4 if st["trend"] == ("BULLISH" if d > 0 else "BEARISH") else 0), 12,
        f"bias {st['bias']:+d} · swings {st['trend'].lower()}")
    dp = su["depth"]
    pb_pts = (12 if dp is None or cfg["pullbackMin"] <= dp <= cfg["pullbackDeep"] else 8) if pb in ("COMPLETE", "HOLDING") else \
        4 if pb == "IN_PROGRESS" else (8 if model == "BREAKOUT_RETEST" and su["retest"] else 0)
    add("pullback", "Pullback quality", pb_pts, 12, g["pullback"]["detail"])
    brk = (12 if trig["type"] == "CHOCH" else 10) + (3 if any(e["type"] == "BOS" and e["side"] == sd and e["ts"] > trig["ts"] for e in st["events"]) else 0) \
        if trig and fresh_trig else 0
    add("break", "BOS / CHoCH", min(15, brk), 15, (g["choch"] if g["choch"]["status"] == "PASS" else g["bos"])["detail"])
    mom_pts = (10 if st["volState"] == "EXPANDING" else 7) if g["momentum"]["status"] == "PASS" else -8 if m5 <= -cfg["momentumAgainstAtr"] else 2 if m5 > 0 else 0
    add("momentum", "Momentum", mom_pts, 10, g["momentum"]["detail"])
    add("retest", "Breakout / retest", 6 if g["retest"]["status"] == "PASS" else -15 if g["retest"]["status"] == "FAIL" else 0, 6, g["retest"]["detail"])
    add("freshness", "H1 data freshness", 5 if dst == "READY" else 0, 5, dwhy)
    risk = su["riskAtr"]
    add("risk", "Invalidation distance", 0 if risk is None or su["invalidated"] else 5 if risk <= cfg["idealRiskAtr"] else 2 if risk <= cfg["maxRiskAtr"] else -5,
        5, g["invalidation"]["detail"])
    score = round(max(0.0, min(100.0, sum(x["points"] for x in comps))), 1)
    out.update(components=comps, score=score)
    g["score"] = _gate("score", "Overall Confirmation Score", "PASS" if score >= cfg["confirmScore"] else "WAIT",
                       f"{score:.1f} from weighted evidence (confirm at ≥ {cfg['confirmScore']})")

    # ---- phase
    if su["falseBreakout"] and fresh_trig:
        phase = "FALSE_BREAKOUT"
    elif su["retest"] and fresh_trig:
        phase = "RETEST"
    elif trig and fresh_trig and su["triggerAgeBars"] <= 3:
        phase = "BREAKOUT"
    elif pb in ("IN_PROGRESS", "HOLDING"):
        phase = "PULLBACK"
    elif m5 >= cfg["impulseAtr"]:
        phase = "IMPULSE"
    elif st["range12Atr"] < cfg["consolidationAtr"]:
        phase = "CONSOLIDATION"
    else:
        phase = "TRENDING" if bias_ok else "COUNTER_MOVE"
    out["phase"] = phase

    # ---- state
    gate_list = list(g.values())
    severity = ("retest", "choch", "location", "momentum", "structure", "freshness")
    mandatory_fail = sorted((x for x in gate_list if x["status"] == "FAIL" and (x["mandatory"] or x["key"] == "choch")),
                            key=lambda x: severity.index(x["key"]) if x["key"] in severity else 99)
    break_ok = g["bos"]["status"] == "PASS" or g["choch"]["status"] == "PASS"
    mandatory_ok = all(x["status"] in ("PASS", "N/A") for x in gate_list if x["mandatory"]) and break_ok
    if su["invalidated"]:
        state, code = "INVALIDATED", "H1_STRUCTURE_INVALIDATED"
        reason = f"H1 closed {'below' if d > 0 else 'above'} {_fmt(inv)} — the {'pullback low' if pb in ('COMPLETE', 'HOLDING') else 'leg origin'} failed"
    elif dst == "STALE":
        state, code, reason = "STALE", "H1_DATA_STALE", dwhy
    elif mandatory_fail:
        f = mandatory_fail[0]
        state, code = "REJECTED", {"location": "POOR_ENTRY_LOCATION", "retest": "FALSE_BREAKOUT", "choch": "H1_REVERSAL_AFTER_TRIGGER",
                                   "momentum": "MOMENTUM_AGAINST_HTF", "structure": "MISSING_CHANNEL_EVIDENCE",
                                   "freshness": "H1_DATA_FAILED"}.get(f["key"], f"{f['key'].upper()}_FAILED")
        reason = f"{f['label']}: {f['detail']}"
    elif mandatory_ok and score >= cfg["confirmScore"]:
        state, code = "CONFIRMED", "CONFIRMED_" + ("RETEST" if model == "BREAKOUT_RETEST" else "PULLBACK_CONTINUATION")
        reason = (f"{trig['type'].replace('CHOCH', 'CHoCH')} {sd.lower()} after a completed pullback, momentum with the HTF, "
                  f"location {zone.replace('_', ' ').lower()}, invalidation {_fmt(inv)} — all mandatory gates pass (score {score:.1f})")
    elif trig and fresh_trig:
        pending = [x["label"] for x in gate_list if x["mandatory"] and x["status"] not in ("PASS", "N/A")]
        need = ", ".join(pending) or "score ≥ " + str(cfg["confirmScore"])
        state, code = "CONFIRMING", "AWAITING_REMAINING_GATES"
        reason = f"{trig['type'].replace('CHOCH', 'CHoCH')} {sd.lower()} printed — waiting on {need}"
    elif pb == "HOLDING":
        state, code = "SETUP_FORMING", "AWAITING_H1_BREAK"
        reason = f"Pullback holding at {_fmt(su['extreme']['price'])} — waiting for an H1 {sd.lower()}side BOS/CHoCH"
    elif pb == "IN_PROGRESS":
        state, code = "PULLBACK", "PULLBACK_IN_PROGRESS"
        reason = f"H1 retracing {su['depth'] * 100:.0f}% of the last leg against the HTF direction — waiting for it to complete"
    else:
        state, code = "MONITORING", "AWAITING_PULLBACK" if pb in ("NONE", "SHALLOW") else "MONITORING"
        reason = (f"H1 {phase.lower().replace('_', ' ')} — waiting for a pullback and an H1 {sd.lower()}side structure break"
                  + ("" if trig is None or fresh_trig else f" (last trigger expired {su['triggerAgeBars']} bars ago)"))
    if state in ("MONITORING", "PULLBACK", "SETUP_FORMING") and st["bias"] == -d:
        code = "H1_OPPOSES_HTF"
        reason = (f"H1 structure is {'bearish' if d > 0 else 'bullish'} (last break {_side(-d).lower()}) against the "
                  f"{'bullish' if d > 0 else 'bearish'} HTF direction — no confirmation until an H1 {sd.lower()}side CHoCH")

    out["reasoning"] = [f"{x['label']}: {x['status']} — {x['detail']}" for x in gate_list]
    if dst == "READY":
        state, code, reason = _counter_trend(out, s6, st, cfg, d, state, code, reason)
        leg = out.get("marketLeg") or {}
        if leg:
            out["reasoning"].append(
                f"Market leg {leg.get('dominantTrend')} dominant · {leg.get('currentLeg')} · "
                f"{leg.get('tradeType')} · reversal {leg.get('reversalState')} — {leg.get('reason')}"
            )
    trade_sign = -d if str((out.get("marketLeg") or {}).get("tradeType") or "").startswith("COUNTER_TREND") else d
    entry = assess_entry(st, su, s6, trade_sign, cfg, missed_bars=missed_bars) if st is not None else None
    if entry and state == "CONFIRMED" and entry["timing"] == "WAIT_RETEST":
        state, code = "BREAKOUT_CONFIRMED_WAIT_RETEST", "WAIT_RETEST"
        reason = "Breakout confirmed; " + "; ".join(entry["reasons"]) + "."
    elif entry and state == "CONFIRMED" and entry["timing"] == "WAIT_NEW_CONFIRMATION":
        state, code = "MONITORING", "MISSED_CONFIRMATION"
        reason = "Historical confirmation discovered during reconnect; not executable retrospectively."
    elif entry and state == "CONFIRMED" and entry["timing"] == "RETEST_CONFIRMED":
        code = "CONFIRMED_RETEST"
        reason = "Retest held; " + (reason if "retest" in reason.lower() else "bullish continuation confirmation received." if trade_sign > 0 else "bearish continuation confirmation received.")
    if entry:
        out["entry"] = entry
        out["reasoning"].append(
            f"Entry {entry['timing']}: {entry['classification']} · breakout {entry['breakoutQuality']}"
            + (f" · {entry['extensionATR']} ATR beyond structure" if entry.get("extensionATR") is not None else "")
            + (f" · channel {entry['channelPosition']:.0f}%" if entry.get("channelPosition") is not None else "")
        )
    out["confirmed"] = state == "CONFIRMED"
    out["live"] = intrabar(out, live, d if not str((out.get("marketLeg") or {}).get("tradeType") or "").startswith("COUNTER_TREND") else -d)
    _finish(out, state, code, reason)
    if out["confirmed"]:
        out["handoff"] = handoff(out)
    return out


def _dir_pos(position: float | None, trade_sign: int) -> float | None:
    """0 = room at the origin of the trade, 100 = price already at the destination boundary."""
    if position is None or trade_sign == 0:
        return None
    return float(position) if trade_sign > 0 else 100.0 - float(position)


def assess_entry(st: dict[str, Any], su: dict[str, Any], s6: dict[str, Any], trade_sign: int,
                 cfg: dict[str, Any], *, missed_bars: int = 0) -> dict[str, Any]:
    """Separate entry quality from structural confirmation. A valid break is not permission to enter."""
    atr = float(st.get("atr") or 0) or 1e-9
    close = st.get("lastClose")
    trig = su.get("trigger") or None
    pos = _dir_pos((s6.get("position") or {}).get("d1"), trade_sign)
    extension = None
    penetration = None
    close_loc = None
    quality = "ACCEPTABLE"
    if trig and close is not None:
        extension = trade_sign * (float(close) - float(trig["level"])) / atr
        i = trig.get("i")
        if isinstance(i, int) and 0 <= i < int(st.get("bars") or 0):
            rng = float(st["high"][i]) - float(st["low"][i])
            penetration = trade_sign * (float(st["close"][i]) - float(trig["level"])) / atr
            if rng > 0:
                close_loc = (float(st["close"][i]) - float(st["low"][i])) / rng if trade_sign > 0 else (float(st["high"][i]) - float(st["close"][i])) / rng
    retest_held = bool(su.get("retest")) and not su.get("falseBreakout")
    reasons: list[str] = []
    late = pos is not None and pos >= cfg["lateChannelPct"]
    no_room = pos is not None and pos >= cfg["noRoomPct"]
    chased = extension is not None and extension >= cfg["extensionChaseAtr"]
    late_and_extended = extension is not None and extension >= cfg["extensionLateAtr"] and late
    if su.get("falseBreakout"):
        quality = "SUSPECTED_FALSE_BREAK"
    elif chased or late_and_extended:
        quality = "OVEREXTENDED"
    elif penetration is not None and penetration < 0.08:
        quality = "WEAK"
    elif penetration is not None and penetration >= 0.25 and (close_loc or 0) >= 0.55 and not late:
        quality = "STRONG"
    held = retest_held and not su.get("invalidated")
    timing = "ENTER_NOW"
    classification = "ACCEPTABLE"
    if su.get("falseBreakout") or su.get("invalidated"):
        classification, timing = "INVALID", "REJECT"
    elif not trig:
        timing = "NONE"
        reasons.append("no current H1 break to enter")
    elif held:
        classification, timing = "GOOD", "RETEST_CONFIRMED"
        reasons.append("Broken structure was retested and held")
    elif chased or late_and_extended or (no_room and not held):
        classification, timing = "EXTENDED", "WAIT_RETEST"
        if extension is not None:
            reasons.append(f"price is {extension:.1f} ATR beyond the broken structure")
        if pos is not None and (late or no_room):
            reasons.append(f"parent-channel position is {pos:.0f}% toward the destination")
        reasons.append("controlled retest required")
    elif pos is not None and pos <= 55:
        classification = "GOOD"
        reasons.append(f"parent-channel position {pos:.0f}% still leaves room in the trade direction")
    age = su.get("triggerAgeBars")
    discovered_late = missed_bars > 0 and trig is not None and age not in (0, None) and not (held and (su.get("retest") or {}).get("ts") == st.get("lastTs"))
    if discovered_late and timing == "ENTER_NOW":
        timing = "WAIT_NEW_CONFIRMATION"
        classification = "POOR"
        reasons.append("historical confirmation discovered during reconnect; not executable retrospectively")
    if not reasons and timing == "ENTER_NOW":
        reasons.append("break is fresh and location is not extended")
    return {
        "classification": classification,
        "breakoutQuality": quality,
        "extensionATR": None if extension is None else round(extension, 2),
        "channelPosition": None if pos is None else round(pos, 1),
        "distanceToObstacle": None,
        "availableRoomATR": None,
        "retestRequired": timing == "WAIT_RETEST",
        "stale": bool(discovered_late),
        "timing": timing,
        "reasons": reasons,
    }


def explain(o: dict[str, Any]) -> str:
    bits = [f"{o['state'].replace('_', ' ')} ({o['reasonCode']}): {o['reason']}."]
    s6 = o.get("stage6") or {}
    if s6:
        bits.append(f"Stage 6 {s6.get('state')} {s6.get('direction')} is the direction authority; H1 only confirms it.")
    if o.get("h1"):
        h = o["h1"]
        bits.append(f"H1 bias {h['bias']:+d}, swings {h['trend'].lower()}, momentum {h['mom5']:+.2f} ATR, phase {o['phase']}.")
    if o.get("invalidationLevel") is not None:
        bits.append(f"Invalidation {_fmt(o['invalidationLevel'])}.")
    if o.get("components"):
        bits.append(f"Confirmation score {o['score']:.1f}.")
    entry = o.get("entry") or {}
    if entry.get("timing") and entry.get("timing") != "ENTER_NOW":
        bits.append(f"Entry {entry['timing'].replace('_', ' ').lower()}: {'; '.join(entry.get('reasons') or [])}.")
    if (o.get("live") or {}).get("note"):
        bits.append(o["live"]["note"] + ".")
    return " ".join(bits)


def handoff(o: dict[str, Any]) -> dict[str, Any]:
    """Stage 7 → Stage 8 publication for one CONFIRMED candidate."""
    su, h, s6 = o["setup"] or {}, o["h1"] or {}, o["stage6"] or {}
    trig = su.get("trigger") or {}
    return {
        "instrument": o["symbol"], "direction": o["expectedDirection"], "structuralDirection": o["direction"],
        "entryContext": {"model": su.get("model"), "trigger": trig.get("type"), "triggerTs": trig.get("ts"), "triggerLevel": trig.get("level"),
                         "pullbackExtreme": (su.get("extreme") or {}).get("price"), "pullbackDepth": su.get("depth"),
                         "lastClose": h.get("lastClose"), "retest": su.get("retest")},
        "h1Structure": {"bias": h.get("bias"), "trend": h.get("trend"), "phase": o["phase"], "momentum": h.get("mom5"), "volState": h.get("volState")},
        "evidence": {"bos": o["gates"]["bos"], "choch": o["gates"]["choch"], "components": o["components"]},
        "channelLocation": {"zone": s6.get("zone"), "d1": s6.get("positionD1"), "h8": s6.get("positionH8")},
        "confidence": o["score"], "invalidationLevel": o["invalidationLevel"], "riskAtr": su.get("riskAtr"),
        "freshness": (o.get("data") or {}).get("status"), "h1LastTs": h.get("lastTs"), "reasoning": o["reasoning"],
        "tradeType": o.get("tradeType") or (o.get("marketLeg") or {}).get("tradeType"),
        "marketLeg": o.get("marketLeg"),
        "entry": o.get("entry"),
        "structure": {
            "parentTrend": (o.get("marketLeg") or {}).get("dominantTrend") or o.get("direction"),
            "h1Phase": o.get("phase"),
            "bos": (o.get("gates") or {}).get("bos", {}).get("status") == "PASS",
            "choch": (o.get("gates") or {}).get("choch", {}).get("status") == "PASS",
        },
        "confirmation": {
            "state": o.get("state"),
            "level": trig.get("level"),
            "candleClose": h.get("lastClose"),
            "confirmedAt": trig.get("ts"),
        },
        "validity": {"current": True, "stale": bool((o.get("entry") or {}).get("stale")), "invalidationLevel": o.get("invalidationLevel")},
        "executes": False,
    }


def decision_signature(o: dict[str, Any]) -> tuple:
    trig = ((o.get("setup") or {}).get("trigger") or {})
    entry = o.get("entry") or {}
    return (o["state"], o["reasonCode"], o.get("phase"), int(float(o.get("score") or 0) // 5), trig.get("ts"),
            o.get("invalidationLevel"), (o.get("h1") or {}).get("lastTs"), ((o.get("live") or {}).get("event")),
            entry.get("timing"))


def counters(rows: list[dict[str, Any]]) -> dict[str, Any]:
    cand = [r for r in rows if (r.get("stage6") or {}).get("state") == "READY_FOR_H1"]
    return {
        "universe": len(rows), "candidates": len(cand),
        "monitoring": sum(1 for r in rows if r["state"] in ("MONITORING", "PULLBACK", "SETUP_FORMING", "CONFIRMING", "BREAKOUT_CONFIRMED_WAIT_RETEST")),
        "confirmed": sum(1 for r in rows if r["state"] == "CONFIRMED"),
        "rejected": sum(1 for r in rows if r["state"] == "REJECTED"),
        "invalidated": sum(1 for r in rows if r["state"] == "INVALIDATED"),
        "blocked": sum(1 for r in rows if r["state"] in ("BLOCKED", "STALE", "WARMING_UP")),
        "byState": {s: sum(1 for r in rows if r["state"] == s) for s in STATES},
    }
