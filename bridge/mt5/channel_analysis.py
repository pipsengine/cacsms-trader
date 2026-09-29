"""Channel Analysis — independent Y/Q/MN/W/D1/H8/H1 channels and the trend-within-trend hierarchy (pure, no I/O).

Every timeframe is detected on its own closed candles with the Stage 5 rules (vision.analyse_tf): Touch #1 anchor,
Touch #2 candidate, Touch #3 validation, a parallel opposite boundary with its own touches, width and parallelism
limits, breakout, retest and invalidation. Y and Q candles are aggregated from closed MN1 candles; a period is used
only when every month in it has closed, so a provisional bar can never validate a touch.

The hierarchy is built after detection. A parent never forces a child's direction: an opposing child channel is
classified against its nearest valid ancestor (correction, counter-correction, nested correction, breakout or
reversal candidate) and both channels stay published.
"""

from __future__ import annotations

import calendar
import hashlib
import json
import time
from datetime import datetime, timezone
from typing import Any

try:
    import vision
except ImportError:  # pragma: no cover
    from bridge.mt5 import vision  # type: ignore

TIMEFRAMES: tuple[str, ...] = ("Y", "Q", "MN", "W", "D1", "H8", "H1")
SOURCE_TF = {"Y": "MN1", "Q": "MN1", "MN": "MN1", "W": "W1", "D1": "D1", "H8": "H8", "H1": "H1"}
DERIVED: dict[str, tuple[str, ...]] = {"MN1": ("Y", "Q", "MN"), "W1": ("W",), "D1": ("D1",), "H8": ("H8",), "H1": ("H1",)}
TF_LABEL = {"Y": "Yearly", "Q": "Quarterly", "MN": "Monthly", "W": "Weekly", "D1": "Daily", "H8": "8 Hour", "H1": "1 Hour"}
PERIOD_MONTHS = {"Y": 12, "Q": 3}
TF_SEC = {"W": 7 * 86400, "D1": 86400, "H8": 8 * 3600, "H1": 3600}
GROUPS = {"primary": ("Y", "Q", "MN"), "intermediate": ("W", "D1"), "current": ("H8", "H1")}

CONFIG: dict[str, Any] = {
    "version": "channel-analysis/2",
    "extraBars": 200,
    "chartBars": {"Y": 40, "Q": 60, "MN": 96, "W": 160, "D1": 160, "H8": 160, "H1": 160},
    "structureEvents": 12,
    "tfWeight": {"Y": 7, "Q": 6, "MN": 5, "W": 4, "D1": 3, "H8": 2, "H1": 1},
    "directionalShare": 0.2,
    "staleConfidenceFactor": 0.8,
}

VALID_STATUSES = frozenset(vision.CONFIRMED_STATUSES)
CORRECTION_BY_DEPTH = {1: "CORRECTIVE", 2: "COUNTER_CORRECTION", 3: "NESTED_CORRECTION"}
EVENT_KIND = {"TOUCH": "TOUCH", "CHANNEL_VALIDATED": "VALIDATION", "FAILED_BREAKOUT": "FAILED_BREAKOUT",
              "BREAKOUT": "BREAKOUT", "RETEST": "RETEST", "INVALIDATED": "INVALIDATION"}
ROLE_LABEL = {"ANCHOR": "anchor", "CANDIDATE": "candidate", "VALIDATION": "validation", "CONFIRMATION": "confirmation"}


# ---------------------------------------------------------------- time + candles

def _utc(ts: int) -> datetime:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc)


def _add_months(ts: int, months: int) -> int:
    d = _utc(ts)
    m = d.month - 1 + months
    return calendar.timegm((d.year + m // 12, m % 12 + 1, 1, 0, 0, 0))


def bar_close(tf: str, ts: int) -> int:
    if tf == "Y":
        return _add_months(ts, 12)
    if tf == "Q":
        return _add_months(ts, 3)
    if tf == "MN":
        return _add_months(ts, 1)
    return int(ts) + TF_SEC[tf]


def aggregate(rows: list[tuple], tf: str) -> list[tuple]:
    """Y/Q candles from closed MN1 candles. Incomplete periods (history start, current period) are dropped."""
    months = PERIOD_MONTHS.get(tf)
    if not months:
        return [(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4])) for r in rows]
    groups: dict[tuple[int, int], list[tuple]] = {}
    for r in rows:
        d = _utc(r[0])
        groups.setdefault((d.year, (d.month - 1) // months), []).append(r)
    out: list[tuple] = []
    for key in sorted(groups):
        g = sorted(groups[key], key=lambda r: r[0])
        if len(g) != months or _utc(g[0][0]).month != key[1] * months + 1:
            continue
        out.append((int(g[0][0]), float(g[0][1]), max(float(r[2]) for r in g), min(float(r[3]) for r in g), float(g[-1][4])))
    return out


def price_digits(p: float | None) -> int:
    if p is None:
        return 5
    a = abs(p)
    return 2 if a >= 1000 else 3 if a >= 20 else 5


def simple(direction: str | None) -> str:
    s = vision.dir_sign(direction)
    return "BULLISH" if s > 0 else "BEARISH" if s < 0 else "RANGE"


def sign(direction: str | None) -> int:
    return 1 if direction == "BULLISH" else -1 if direction == "BEARISH" else 0


def is_valid(c: dict[str, Any] | None) -> bool:
    return bool(c) and c.get("status") in VALID_STATUSES and c.get("direction") not in (None, "UNKNOWN")


# ---------------------------------------------------------------- per-timeframe detection

def channel_lines(defn: dict[str, Any] | None, ts: list[int]) -> dict[int, tuple[float, float]]:
    """(lower, upper) per bar from the anchor onward; a retired channel stops at its invalidation bar."""
    if not defn:
        return {}
    try:
        ia = ts.index(int(defn["anchorTs"]))
    except ValueError:
        return {}
    end = defn.get("endTs")
    out: dict[int, tuple[float, float]] = {}
    for i in range(ia, len(ts)):
        if end and ts[i] > int(end):
            break
        a = defn["anchorPrice"] + defn["slope"] * (i - ia)
        b = a + defn["sgn"] * defn["width"]
        out[ts[i]] = (a, b) if defn["sgn"] > 0 else (b, a)
    return out


def structure_events(tf: str, bars: list[tuple], limit: int | None = None) -> list[dict[str, Any]]:
    """BOS / CHoCH: a close beyond the most recent confirmed fractal swing. A fractal is only usable once its
    right-hand bars have closed, so every event is reproducible bar by bar without hindsight."""
    if len(bars) < 5:
        return []
    k = vision.tf_cfg(tf)["pivot"]
    h = [float(b[2]) for b in bars]
    lo = [float(b[3]) for b in bars]
    c = [float(b[4]) for b in bars]
    piv = vision.pivots(h, lo, k)
    out: list[dict[str, Any]] = []
    trend = 0
    last_h: dict[str, Any] | None = None
    last_l: dict[str, Any] | None = None
    j = 0
    for i in range(len(bars)):
        while j < len(piv) and piv[j]["i"] + k <= i:
            if piv[j]["kind"] == "H":
                last_h = piv[j]
            else:
                last_l = piv[j]
            j += 1
        if last_h is not None and c[i] > last_h["p"]:
            kind = "CHOCH" if trend < 0 else "BOS"
            trend = 1
            out.append({"kind": kind, "direction": "BULLISH", "ts": int(bars[i][0]), "price": c[i], "level": last_h["p"],
                        "swingTs": int(bars[last_h["i"]][0])})
            last_h = None
        if last_l is not None and c[i] < last_l["p"]:
            kind = "CHOCH" if trend > 0 else "BOS"
            trend = -1
            out.append({"kind": kind, "direction": "BEARISH", "ts": int(bars[i][0]), "price": c[i], "level": last_l["p"],
                        "swingTs": int(bars[last_l["i"]][0])})
            last_l = None
    return out[-(limit or CONFIG["structureEvents"]):]


def _swings(tf: str, bars: list[tuple], atr: float) -> list[dict[str, Any]]:
    start = int(bars[max(0, len(bars) - vision.tf_cfg(tf)["lookback"])][0])
    raw = [s for s in vision.swing_points(tf, bars) if s["ts"] >= start]
    out = []
    for i, s in enumerate(raw):
        amp = abs(s["price"] - raw[i - 1]["price"]) / atr if i and atr else None
        out.append({"id": f"{s['kind']}-{s['ts']}", "time": s["ts"] * 1000, "price": s["price"],
                    "kind": "HIGH" if s["kind"] == "H" else "LOW", "strength": round(amp, 2) if amp is not None else None,
                    "confirmed": True})
    return out


def _empty(symbol: str, tf: str, bars: list[tuple], data: tuple[str, str], now: int) -> dict[str, Any]:
    cfg = vision.tf_cfg(tf)
    last = bars[-1] if bars else None
    close_ts = bar_close(tf, int(last[0])) if last else None
    return {
        "instrument": symbol, "timeframe": tf, "label": TF_LABEL[tf], "sourceTimeframe": SOURCE_TF[tf],
        "direction": "UNKNOWN", "trend": None, "strength": None, "status": "NO_CHANNEL", "phase": "UNKNOWN",
        "relationship": "UNRESOLVED", "confidence": 0.0, "position": None,
        "currentPrice": float(last[4]) if last else None,
        "upperBoundary": None, "midline": None, "lowerBoundary": None, "distanceUpperAtr": None, "distanceLowerAtr": None,
        "slope": None, "touchCount": 0, "anchorTouches": 0, "oppositeTouches": 0,
        "freshnessSeconds": max(0, now - close_ts) if close_ts else None,
        "lastCandleTime": int(last[0]) * 1000 if last else None, "lastCandleClose": close_ts * 1000 if close_ts else None,
        "sourceBarTs": None, "analysedAt": int(time.time() * 1000), "channelId": None, "parentTimeframe": None, "parentChannelId": None,
        "dataStatus": data[0], "dataReason": data[1], "bars": len(bars), "requiredBars": cfg["minBars"],
        "reason": "", "digits": price_digits(float(last[4]) if last else None), "configVersion": CONFIG["version"],
        "definition": None, "ageBars": None, "breakout": None, "invalidation": [], "scoring": [], "lifecycle": {},
        "evidence": {"candles": len(bars), "closedCandles": len(bars), "atr": 0.0, "swings": [], "touches": [],
                     "events": [], "structure": [], "geometry": None, "reasons": [], "warnings": []},
    }


def _insufficient(tf: str, n: int, need: int, data: tuple[str, str]) -> str:
    if tf in PERIOD_MONTHS:
        return (f"NO VALID CHANNEL — {n} complete {TF_LABEL[tf].lower()} candles aggregated from Stage 1 MN1 history; "
                f"{need} are required for swing, Touch #1/#2/#3 and opposite-boundary validation")
    return f"NO VALID CHANNEL — {n}/{need} closed {tf} candles in Stage 1 ({data[1]})"


def analyse_timeframe(symbol: str, tf: str, bars: list[tuple], data: tuple[str, str], now: int | None = None) -> dict[str, Any]:
    """One independent channel read. `bars` are validated closed candles (Y/Q already aggregated), ascending.
    `now` is on the candle clock (broker server time), so freshness compares like with like."""
    now = int(now or time.time())
    cfg = vision.tf_cfg(tf)
    snap = _empty(symbol, tf, bars, data, now)
    ev = snap["evidence"]
    if data[0] == "BLOCKED" or len(bars) < cfg["minBars"]:
        why = f"NO VALID CHANNEL — {data[1]}" if data[0] == "BLOCKED" else _insufficient(tf, len(bars), cfg["minBars"], data)
        snap["reason"] = why
        ev["reasons"].append(why)
        return snap

    a = vision.analyse_tf(tf, bars)
    atr = float(a["atr"])
    close = float(a["lastClose"])
    ev["atr"] = atr
    ev["swings"] = _swings(tf, bars, atr)
    ev["structure"] = structure_events(tf, bars)
    snap["phase"] = a["phase"]
    if data[0] == "STALE":
        ev["warnings"].append(f"Stage 1 {SOURCE_TF[tf]} series is STALE — structure is last-known, not live evidence")
    if a["status"] == "NONE":
        snap["reason"] = "NO VALID CHANNEL — " + a["reason"]
        ev["reasons"].append(snap["reason"])
        snap["scoring"] = a["evidence"]
        ev["events"] = _structure_as_events(ev["structure"])
        return snap

    status = a["status"]
    trend = simple(vision._slope_label(a["rise"], a["slopeAtr20"]))
    direction = "UNKNOWN" if status == "INVALIDATED" else simple(a["lean"]) if status == "FORMING" else simple(a["direction"])
    upper, lower = float(a["upper"]), float(a["lower"])
    mid = (upper + lower) / 2
    tol = vision.CONFIG["touchTolAtr"]

    touches, n_anchor, n_opp = [], 0, 0
    for t in a["touchList"]:
        if t["role"] == "OPPOSITE":
            n_opp += 1
            label = f"Opposite #{n_opp}"
        else:
            n_anchor += 1
            label = f"Touch #{n_anchor} · {ROLE_LABEL.get(t['role'], t['role'].lower())}"
        touches.append({
            "id": f"{tf}-{t['seq']}", "ordinal": t["seq"], "label": label, "boundary": t["boundary"], "role": t["role"],
            "time": int(t["ts"]) * 1000, "price": t["price"], "line": t["line"], "deviationAtr": t["deviationAtr"],
            "distanceAtr": abs(t["deviationAtr"]), "quality": round(max(0.0, 1 - abs(t["deviationAtr"]) / tol), 3),
        })

    events = [{"id": f"{tf}-{e['type']}-{e['ts']}-{i}", "time": int(e["ts"]) * 1000, "kind": EVENT_KIND.get(e["type"], e["type"]),
               "price": e.get("price"), "label": e["detail"]} for i, e in enumerate(a["events"])]
    events += _structure_as_events(ev["structure"])
    events.sort(key=lambda e: e["time"])

    brk = a.get("breakout")
    d = a["def"]
    geometry = {
        "anchorSide": a["anchorSide"],
        "anchor": {"time": a["anchor"]["ts"] * 1000, "price": a["anchor"]["price"]},
        "candidate": {"time": a["candidate"]["ts"] * 1000, "price": a["candidate"]["price"]},
        "validation": {"time": a["validation"]["ts"] * 1000, "price": a["validation"]["price"]} if a.get("validation") else None,
        "lineDefinedBy": [{"time": p["ts"] * 1000, "price": p["price"]} for p in a["lineDefinedBy"]],
        "slopePerBar": a["slope"], "slopeAtr20": a["slopeAtr20"], "rise": a["rise"],
        "width": a["width"], "widthAtr": a["widthAtr"], "parallelismError": a["parallelDev"], "parallelOk": a["parallelOk"],
        "touchQuality": a["touchQuality"], "fitScore": round(a["touchQuality"] / 100, 3),
        "violations": a["violations"], "violationShare": a["violationShare"], "ageBars": a["ageBars"], "spanBars": a["spanBars"],
        "upperNext": a["upperNext"], "lowerNext": a["lowerNext"],
    }
    if not a["parallelOk"]:
        ev["warnings"].append("Opposite boundary parallelism is not verified within tolerance")
    if status == "WEAKENING":
        ev["warnings"].append("Channel weakening — the last swing failed to reach the far boundary")
    if a["volState"] == "EXPANDING":
        ev["warnings"].append(f"Expanding volatility (ATR ratio {a['volRatio']:.2f}) reduces structural reliability")
    if status == "FORMING":
        ev["warnings"].append("Forming only — not a valid channel until Touch #3 and the opposite boundary validate")
    if status == "INVALIDATED":
        ev["warnings"].append("NO VALID CHANNEL — the last channel was invalidated; a new anchor/candidate pair is required")

    ev.update({"touches": touches, "events": events, "geometry": geometry, "reasons": [a["reason"]] + ev["reasons"]})
    snap.update({
        "direction": direction, "trend": trend, "strength": a["direction"], "status": status,
        "confidence": float(a["confidence"]), "position": a["position"], "currentPrice": close,
        "upperBoundary": upper, "midline": mid, "lowerBoundary": lower,
        "distanceUpperAtr": round((upper - close) / atr, 3) if atr else None,
        "distanceLowerAtr": round((close - lower) / atr, 3) if atr else None,
        "slope": a["slope"], "touchCount": a["touches"]["total"], "anchorTouches": a["touches"]["anchor"],
        "oppositeTouches": a["touches"]["opposite"], "channelId": f"{symbol}:{tf}:{a['channelKey']}",
        "reason": ("NO VALID CHANNEL — " if status == "INVALIDATED" else "") + a["reason"],
        "definition": d, "ageBars": a["ageBars"], "invalidation": a["invalidation"], "scoring": a["evidence"],
        "breakout": _ms_breakout(brk),
        "lifecycle": {
            "anchorTime": a["anchor"]["ts"] * 1000,
            "validatedTime": a["validation"]["ts"] * 1000 if a.get("validation") and status != "FORMING" else None,
            "breakoutTime": brk["ts"] * 1000 if brk else None,
            "retestTime": brk["retestTs"] * 1000 if brk and brk.get("retestTs") else None,
            "invalidatedTime": brk["invalidTs"] * 1000 if brk and brk.get("invalidTs") else None,
        },
    })
    return snap


def _ms_breakout(brk: dict[str, Any] | None) -> dict[str, Any] | None:
    if not brk:
        return None
    return {**brk, "time": brk["ts"] * 1000, "retestTime": brk["retestTs"] * 1000 if brk.get("retestTs") else None,
            "invalidTime": brk["invalidTs"] * 1000 if brk.get("invalidTs") else None}


def _structure_as_events(structure: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"id": f"{s['kind']}-{s['ts']}", "time": s["ts"] * 1000, "kind": s["kind"], "direction": s["direction"],
             "price": s["price"], "label": f"{'Change of character' if s['kind'] == 'CHOCH' else 'Break of structure'} — "
                                          f"{s['direction'].lower()} close beyond the swing at {s['level']:.5g}"}
            for s in structure]


# ---------------------------------------------------------------- hierarchy

def _relate(p: dict[str, Any], c: dict[str, Any], depth: int) -> tuple[str, str, int]:
    ptf, ctf = p["timeframe"], c["timeframe"]
    sp, sc = sign(p["direction"]), sign(c["direction"])
    cd, pd = c["direction"].lower(), p["direction"].lower()
    brk = p.get("breakout")
    if p["status"] in ("BROKEN", "RETESTING") and brk:
        bs = 1 if brk["side"] == "UP" else -1
        side = "upside" if bs > 0 else "downside"
        if sc == bs:
            if sign(p.get("trend")) == bs:
                return "BREAKOUT", f"{ctf} {cd} confirms the {ptf} {side} breakout — acceleration beyond the parent channel", depth
            if sign(p.get("trend")) == 0:
                return "BREAKOUT", f"{ctf} {cd} follows the {ptf} {side} range breakout — expansion out of the parent range", depth
            return ("REVERSAL_CANDIDATE", f"{ctf} {cd} follows the {ptf} {side} break against its {(p.get('trend') or '').lower()} "
                                          f"channel — reversal candidate until the break is retested and holds", depth)
        if sc == -bs:
            nd = depth + 1
            return (CORRECTION_BY_DEPTH[min(nd, 3)],
                    f"{ctf} {cd} pulls back against the {ptf} {side} breakout — retest of the broken boundary", nd)
        return "RANGE_INTERNAL", f"{ctf} ranges after the {ptf} {side} breakout", depth
    if sp == 0:
        return "RANGE_INTERNAL", f"{ctf} {cd} channel is internal to the {ptf} range", depth
    if sc == 0:
        return "RANGE_INTERNAL", f"{ctf} ranges inside the {ptf} {pd} channel", depth
    if sc == sp:
        return "ALIGNED", f"{ctf} {cd} agrees with the {ptf} {pd} channel", depth
    nd = depth + 1
    rel = CORRECTION_BY_DEPTH[min(nd, 3)]
    why = {
        "CORRECTIVE": f"{ctf} {cd} opposes the intact {ptf} {pd} channel — a correction inside it, not a reversal",
        "COUNTER_CORRECTION": f"{ctf} {cd} opposes the {ptf} {pd} correction and turns back toward the primary trend — counter-correction",
        "NESTED_CORRECTION": f"{ctf} {cd} opposes the {ptf} {pd} counter-correction — nested correction inside it",
    }[rel]
    return rel, why, nd


def _unresolved(c: dict[str, Any]) -> str:
    st = c.get("status")
    if st == "FORMING":
        return f"{c['timeframe']} channel is still forming — excluded from the hierarchy until it validates"
    if st == "INVALIDATED":
        return f"{c['timeframe']} channel invalidated — no valid channel to relate"
    return f"{c['timeframe']}: no valid channel"


def build_hierarchy(channels: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Relate independently detected channels top-down. Mutates relationship/parent fields; never touches geometry."""
    edges: list[dict[str, Any]] = []
    depth: dict[str, int] = {}
    prev: str | None = None
    for i, tf in enumerate(TIMEFRAMES):
        c = channels[tf]
        parent = TIMEFRAMES[i - 1] if i else None
        c["parentTimeframe"] = parent
        c["parentChannelId"] = channels[prev]["channelId"] if prev else None
        c["relationshipVia"] = prev
        if not is_valid(c):
            rel, why = "UNRESOLVED", _unresolved(c)
        elif prev is None:
            rel, why = "PRIMARY", f"Highest valid channel — {tf} {c['direction'].lower()} structure anchors the hierarchy"
            depth[tf] = 0
        else:
            rel, why, depth[tf] = _relate(channels[prev], c, depth[prev])
        c["relationship"] = rel
        c["relationshipReason"] = why
        c["correctionDepth"] = depth.get(tf)
        if parent:
            conf = min(c["confidence"], channels[prev]["confidence"]) if prev and rel != "UNRESOLVED" else 0.0
            edges.append({"parent": parent, "child": tf, "via": prev if rel != "UNRESOLVED" else None, "relationship": rel,
                          "confidence": round(conf, 1), "explanation": why})
        if is_valid(c):
            prev = tf
    return edges


def _weighted(channels: dict[str, dict[str, Any]], tfs: tuple[str, ...]) -> str:
    w = CONFIG["tfWeight"]
    num = den = 0.0
    for t in tfs:
        c = channels[t]
        if is_valid(c):
            num += sign(c["direction"]) * c["confidence"] * w[t]
            den += c["confidence"] * w[t]
    if den <= 0:
        return "UNKNOWN"
    r = num / den
    return "BULLISH" if r > CONFIG["directionalShare"] else "BEARISH" if r < -CONFIG["directionalShare"] else "RANGE"


def interpret(channels: dict[str, dict[str, Any]], price: float | None = None) -> dict[str, Any]:
    valid = [t for t in TIMEFRAMES if is_valid(channels[t])]
    unresolved = [t for t in TIMEFRAMES if t not in valid]
    primary_tf = next((t for t in valid if channels[t]["relationship"] == "PRIMARY"), None)
    current_tf = valid[-1] if valid else None
    parent_dir = channels[primary_tf]["direction"] if primary_tf else "UNKNOWN"
    rels = {channels[t]["relationship"] for t in valid}

    if not valid:
        state = "UNKNOWN"
    elif "REVERSAL_CANDIDATE" in rels:
        state = "REVERSAL_CANDIDATE"
    elif "BREAKOUT" in rels or channels[primary_tf]["status"] in ("BROKEN", "RETESTING"):
        state = "BREAKOUT"
    elif "NESTED_CORRECTION" in rels:
        state = "NESTED_CORRECTION"
    elif "COUNTER_CORRECTION" in rels:
        state = "COUNTER_CORRECTION"
    elif "CORRECTIVE" in rels:
        state = "CORRECTION"
    elif sign(parent_dir) == 0:
        state = "CONSOLIDATION"
    else:
        state = "CONTINUATION"

    w = CONFIG["tfWeight"]
    den = sum(w[t] for t in valid)
    conf = sum(channels[t]["confidence"] * w[t] for t in valid) / den if den else 0.0
    if any(channels[t].get("dataStatus") == "STALE" for t in valid):
        conf *= CONFIG["staleConfidenceFactor"]
    directional = [t for t in valid if sign(channels[t]["direction"]) != 0]
    alignment = (sum(1 for t in directional if channels[t]["direction"] == parent_dir) / len(directional) * 100) if directional else 0.0

    depth, retrace = ("NONE" if valid else "UNKNOWN"), None
    first_corr = next((t for t in valid if channels[t]["relationship"] == "CORRECTIVE"), None)
    if first_corr:
        p = channels[channels[first_corr]["relationshipVia"]]
        pos = p.get("position")
        if pos is not None:
            retrace = max(0.0, min(100.0, (100 - pos) if sign(p["direction"]) > 0 else pos))
            depth = "SHALLOW" if retrace < 38.2 else "MODERATE" if retrace < 61.8 else "DEEP"
        else:
            depth = "UNKNOWN"

    px = price if price is not None else (channels[current_tf]["currentPrice"] if current_tf else None)
    levels = []
    if px is not None:
        for t in valid:
            c = channels[t]
            atr = c["evidence"]["atr"] or None
            for kind, v in (("UPPER", c["upperBoundary"]), ("MID", c["midline"]), ("LOWER", c["lowerBoundary"])):
                if v is not None:
                    levels.append({"timeframe": t, "kind": kind, "price": v, "distanceAtr": round((v - px) / atr, 2) if atr else None})
    supports = sorted((x for x in levels if x["price"] < px), key=lambda x: -x["price"]) if px is not None else []
    resistances = sorted((x for x in levels if x["price"] > px), key=lambda x: x["price"]) if px is not None else []

    chain = [{"timeframe": t, "direction": channels[t]["direction"], "relationship": channels[t]["relationship"],
              "status": channels[t]["status"]} for t in TIMEFRAMES]
    return {
        "primaryDirection": _weighted(channels, GROUPS["primary"]),
        "intermediateDirection": _weighted(channels, GROUPS["intermediate"]),
        "currentDirection": _weighted(channels, GROUPS["current"]),
        "parentTimeframe": primary_tf, "parentDirection": parent_dir,
        "currentTimeframe": current_tf, "currentLegDirection": channels[current_tf]["direction"] if current_tf else "UNKNOWN",
        "marketState": state, "structuralConfidence": round(max(0.0, min(100.0, conf)), 1), "alignmentScore": round(alignment, 1),
        "correctionDepth": depth, "correctionRetracement": round(retrace, 1) if retrace is not None else None,
        "keySupport": [x["price"] for x in supports[:4]], "keyResistance": [x["price"] for x in resistances[:4]],
        "keyLevels": supports[:4] + resistances[:4], "validTimeframes": valid, "unresolvedTimeframes": unresolved,
        "chain": chain, "narrative": _narrative(channels, valid, unresolved, primary_tf, state),
    }


REL_TEXT = {"CORRECTIVE": "correction", "COUNTER_CORRECTION": "counter-correction", "NESTED_CORRECTION": "nested correction",
            "BREAKOUT": "breakout", "REVERSAL_CANDIDATE": "reversal candidate", "RANGE_INTERNAL": "range-internal",
            "ALIGNED": "aligned", "PRIMARY": "primary"}


def _narrative(ch: dict[str, dict[str, Any]], valid: list[str], unresolved: list[str], primary_tf: str | None, state: str) -> str:
    if not valid:
        return "No timeframe currently has a validated channel. Structure is not interpreted until a channel validates."
    chain = " → ".join(f"{t} {ch[t]['direction'].title()} ({REL_TEXT.get(ch[t]['relationship'], ch[t]['relationship'].lower())})" for t in valid)
    parts = [chain + "."]
    p = ch[primary_tf]
    if state in ("CORRECTION", "COUNTER_CORRECTION", "NESTED_CORRECTION"):
        legs = []
        for t in valid:
            rel = ch[t]["relationship"]
            if rel in ("CORRECTIVE", "COUNTER_CORRECTION", "NESTED_CORRECTION"):
                legs.append(f"{t} {ch[t]['direction'].lower()} is a {REL_TEXT[rel]} inside {ch[t]['relationshipVia']}")
        parts.append(f"Valid nested structure: the {primary_tf} {p['direction'].lower()} channel stays intact; " + "; ".join(legs)
                     + ". Opposing timeframes are nested legs of the parent trend, not a conflict.")
    elif state == "CONTINUATION":
        parts.append(f"Every valid channel agrees with the {primary_tf} {p['direction'].lower()} structure.")
    elif state == "BREAKOUT":
        parts.append("A parent channel boundary has been broken; lower timeframes are read against the breakout.")
    elif state == "REVERSAL_CANDIDATE":
        parts.append("A lower timeframe follows a break against its parent channel — reversal candidate, not yet confirmed.")
    elif state == "CONSOLIDATION":
        parts.append(f"The {primary_tf} parent channel is ranging; lower timeframes rotate inside it.")
    if unresolved:
        parts.append(f"No valid channel on {', '.join(unresolved)}.")
    return " ".join(parts)


# ---------------------------------------------------------------- live price + change detection

def live_bounds(snap: dict[str, Any]) -> tuple[float, float] | None:
    """Boundaries at the forming bar (one bar after the last closed candle)."""
    d = snap.get("definition")
    if not d or snap.get("status") in ("NO_CHANNEL", "INVALIDATED") or snap.get("ageBars") is None:
        return None
    k = int(snap["ageBars"]) + 1
    a = d["anchorPrice"] + d["slope"] * k
    b = a + d["sgn"] * d["width"]
    return (a, b) if d["sgn"] > 0 else (b, a)


def live_view(snap: dict[str, Any], price: float) -> dict[str, Any]:
    b = live_bounds(snap)
    atr = snap["evidence"]["atr"] or None
    if not b:
        return {"currentPrice": price}
    lo, hi = b
    return {"currentPrice": price, "position": round((price - lo) / (hi - lo) * 100, 2) if hi > lo else None,
            "liveUpper": hi, "liveLower": lo, "liveMid": (hi + lo) / 2,
            "distanceUpperAtr": round((hi - price) / atr, 3) if atr else None,
            "distanceLowerAtr": round((price - lo) / atr, 3) if atr else None}


def zone(snap: dict[str, Any], price: float) -> str | None:
    b = live_bounds(snap)
    atr = snap["evidence"]["atr"]
    if not b or not atr or snap.get("status") == "FORMING":
        return None
    lo, hi = b
    bt = vision.CONFIG["breakTolAtr"] * atr
    ap = vision.CONFIG["approachPct"]
    p = (price - lo) / (hi - lo) * 100 if hi > lo else 50.0
    return "BREACH_UP" if price > hi + bt else "BREACH_DOWN" if price < lo - bt else "UPPER" if p >= 100 - ap else "LOWER" if p <= ap else "INSIDE"


def signature(snap: dict[str, Any]) -> tuple:
    return (snap.get("channelId"), snap.get("status"), snap.get("direction"), snap.get("relationship"))


def state_version(channels: dict[str, dict[str, Any]], interp: dict[str, Any]) -> str:
    raw = [signature(channels[t]) for t in TIMEFRAMES] + [interp.get("marketState"), interp.get("primaryDirection"), interp.get("currentDirection")]
    return hashlib.sha256(json.dumps(raw, default=str).encode()).hexdigest()[:20]


def diff_events(prev: dict[str, Any] | None, new: dict[str, Any]) -> list[dict[str, Any]]:
    """Lifecycle transitions between two runs of the same timeframe. Keyed on the new last bar so reruns do not repeat them."""
    if not prev:
        return []
    ts = int((new.get("lastCandleTime") or 0) / 1000)
    tf = new["timeframe"]
    out: list[dict[str, Any]] = []
    pid, nid = prev.get("channelId"), new.get("channelId")
    if nid and pid != nid:
        out.append({"type": "NEW_CHANNEL", "ts": ts, "detail": f"New {tf} {new['direction'].lower()} channel ({new['status']}) replaces {pid or 'no channel'}"})
    elif pid and not nid:
        out.append({"type": "CHANNEL_LOST", "ts": ts, "detail": f"{tf} channel {pid} no longer validates — NO VALID CHANNEL"})
    elif nid and prev.get("status") != new.get("status"):
        out.append({"type": "STATUS_CHANGE", "ts": ts, "detail": f"{tf} channel {prev.get('status')} → {new['status']}"})
    if nid and prev.get("direction") not in (None, new["direction"]):
        out.append({"type": "DIRECTION_CHANGE", "ts": ts, "detail": f"{tf} direction {prev.get('direction')} → {new['direction']}"})
    if prev.get("relationship") not in (None, new.get("relationship")):
        out.append({"type": "RELATIONSHIP_CHANGE", "ts": ts,
                    "detail": f"{tf} relationship {prev.get('relationship')} → {new.get('relationship')}: {new.get('relationshipReason') or ''}"[:600]})
    return out


def chart_payload(snap: dict[str, Any], bars: list[tuple], limit: int | None = None) -> dict[str, Any]:
    """Candles (from Stage 1, never persisted here) plus the channel boundaries recomputed from the stored definition."""
    n = limit or CONFIG["chartBars"][snap["timeframe"]]
    ts = [int(b[0]) for b in bars]
    lines = channel_lines(snap.get("definition"), ts)
    view = bars[-n:]
    return {
        "candles": [{"time": int(b[0]) * 1000, "open": b[1], "high": b[2], "low": b[3], "close": b[4], "complete": True} for b in view],
        "lines": [{"time": int(b[0]) * 1000, "upper": lines[int(b[0])][1], "lower": lines[int(b[0])][0],
                   "mid": (lines[int(b[0])][0] + lines[int(b[0])][1]) / 2} for b in view if int(b[0]) in lines],
    }


def _span(rows: list[tuple], open_ts: int | None = None) -> tuple | None:
    if not rows:
        return None
    g = sorted(rows, key=lambda r: int(r[0]))
    return (
        int(open_ts if open_ts is not None else g[0][0]),
        float(g[0][1]),
        max(float(r[2]) for r in g),
        min(float(r[3]) for r in g),
        float(g[-1][4]),
    )


def forming_macro(tf: str, closed_mn1: list[tuple], forming_mn: tuple | None, now: int) -> tuple | None:
    """The unfinished Y or Q candle: closed months of the current period plus the open month."""
    months = PERIOD_MONTHS.get(tf)
    if not months:
        return None
    d = _utc(now)
    key = (d.year, (d.month - 1) // months)
    rows = [r for r in closed_mn1 if (_utc(r[0]).year, (_utc(r[0]).month - 1) // months) == key]
    if forming_mn is not None:
        fd = _utc(forming_mn[0])
        if (fd.year, (fd.month - 1) // months) == key and all(int(r[0]) != int(forming_mn[0]) for r in rows):
            rows.append(forming_mn)
    return _span(rows)


def forming_bucket(rows: list[tuple], now: int, seconds: int) -> tuple | None:
    """Unfinished fixed-width bar (H8) from the source bars that belong to the current window, including the open source bar."""
    start = int(now) // seconds * seconds
    chosen = [r for r in rows if int(r[0]) >= start]
    return _span(chosen, start)


def current_bars(now: int, rates: dict[str, list[tuple]], closed_mn1: list[tuple]) -> dict[str, tuple]:
    """Open candle for each channel timeframe. `rates` values are ascending OHLC tuples and include the provider's current bar."""
    out: dict[str, tuple] = {}
    h1 = rates.get("H1") or []
    if h1:
        out["H1"] = tuple(h1[-1][:5])
        h8 = forming_bucket(h1, now, TF_SEC["H8"])
        if h8:
            out["H8"] = h8
    for src, tf in (("D1", "D1"), ("W1", "W"), ("MN1", "MN")):
        rows = rates.get(src) or []
        if rows:
            out[tf] = tuple(rows[-1][:5])
    mn = out.get("MN")
    if mn:
        year = forming_macro("Y", closed_mn1, mn, now)
        quarter = forming_macro("Q", closed_mn1, mn, now)
        if year:
            out["Y"] = year
        if quarter:
            out["Q"] = quarter
    return out


def current_bar_payload(snap: dict[str, Any], bar: tuple) -> dict[str, Any]:
    """Chart candle for the open bar, with the stored channel projected one step onto it. Detection is unchanged."""
    t = int(bar[0]) * 1000
    payload: dict[str, Any] = {
        "time": t, "open": float(bar[1]), "high": float(bar[2]), "low": float(bar[3]), "close": float(bar[4]), "complete": False,
    }
    bounds = live_bounds(snap)
    if bounds:
        lo, hi = bounds
        payload["line"] = {"time": t, "lower": lo, "upper": hi, "mid": (lo + hi) / 2}
    return payload


def attach_current_candle(snap: dict[str, Any], chart: dict[str, Any], bar: tuple | None) -> dict[str, Any]:
    """Place the open bar on a closed-candle chart. A bar already present is updated in place so the candle tracks the tick."""
    if not bar:
        return chart
    payload = current_bar_payload(snap, bar)
    candles = list(chart.get("candles") or [])
    lines = list(chart.get("lines") or [])
    t = payload["time"]
    if candles and candles[-1]["time"] > t:
        return chart
    if candles and candles[-1]["time"] == t:
        candles[-1] = {k: payload[k] for k in ("time", "open", "high", "low", "close", "complete")}
    else:
        candles.append({k: payload[k] for k in ("time", "open", "high", "low", "close", "complete")})
    point = payload.get("line")
    if point:
        lines = [x for x in lines if x["time"] != t]
        lines.append(point)
    return {"candles": candles, "lines": lines}
