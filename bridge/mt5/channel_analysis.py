"""Channel Analysis — independent Y/YTD/HY/Q/MN/W/D1/H8/H1 channels and the trend-within-trend hierarchy (pure, no I/O).

Every context is detected on its own closed candles with the Stage 5 rules (vision.analyse_tf): Touch #1 anchor,
Touch #2 candidate, Touch #3 validation, a parallel opposite boundary with its own touches, width and parallelism
limits, breakout, retest and invalidation. Y and Q candles are aggregated from closed MN1 candles; a period is used
only when every month in it has closed, so a provisional bar can never validate a touch.

YTD and HY are derived analysis windows, not broker timeframes: closed D1 candles from the start of the current
calendar year (YTD) or from six calendar months before the end of the latest closed D1 candle (HY). They are
strategic context: they relate to the context above them for display, but the scored parent chain, market state,
confidence and directional groups are built from CORE_TIMEFRAMES only, so the overlapping windows never add votes.

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

# Canonical published hierarchy (display, persistence, Market World Model). Order is significant.
TIMEFRAMES: tuple[str, ...] = ("Y", "YTD", "HY", "Q", "MN", "W", "D1", "H8", "H1")
# Scored parent chain: relationships, market state, structural confidence and directional groups.
CORE_TIMEFRAMES: tuple[str, ...] = ("Y", "Q", "MN", "W", "D1", "H8", "H1")
# Derived strategic windows. Published and related for context; zero weight in every score.
CONTEXT_TIMEFRAMES: tuple[str, ...] = ("YTD", "HY")
WINDOWS: dict[str, dict[str, Any]] = {
    "YTD": {"type": "CALENDAR_YTD"},
    "HY": {"type": "ROLLING_MONTHS", "months": 6},
}
SOURCE_TF = {"Y": "MN1", "YTD": "D1", "HY": "D1", "Q": "MN1", "MN": "MN1", "W": "W1", "D1": "D1", "H8": "H8", "H1": "H1",
             "M15": "M15", "M5": "M5"}
DERIVED: dict[str, tuple[str, ...]] = {"MN1": ("Y", "Q", "MN"), "W1": ("W",), "D1": ("YTD", "HY", "D1"), "H8": ("H8",), "H1": ("H1",),
                                       "M15": ("M15",), "M5": ("M5",)}
TF_LABEL = {"Y": "Yearly", "YTD": "Year to Date", "HY": "6 Months", "Q": "Quarterly", "MN": "Monthly", "W": "Weekly",
            "D1": "Daily", "H8": "8 Hour", "H1": "1 Hour", "M15": "15 Minute", "M5": "5 Minute"}
PERIOD_MONTHS = {"Y": 12, "Q": 3}
TF_SEC = {"YTD": 86400, "HY": 86400, "W": 7 * 86400, "D1": 86400, "H8": 8 * 3600, "H1": 3600, "M15": 900, "M5": 300}
# M15/M5 are execution channels. They are analysed on demand and are not part of the Y–H1 hierarchy publication.
EXECUTION_TIMEFRAMES: tuple[str, ...] = ("M15", "M5")
GROUPS = {"primary": ("Y", "Q", "MN"), "intermediate": ("W", "D1"), "current": ("H8", "H1")}

CONFIG: dict[str, Any] = {
    "version": "channel-analysis/2",
    "extraBars": 200,
    "chartBars": {"Y": 40, "YTD": 320, "HY": 200, "Q": 60, "MN": 96, "W": 160, "D1": 160, "H8": 160, "H1": 160},
    "structureEvents": 12,
    "tfWeight": {"Y": 7, "YTD": 0, "HY": 0, "Q": 6, "MN": 5, "W": 4, "D1": 3, "H8": 2, "H1": 1},
    "directionalShare": 0.2,
    "staleConfidenceFactor": 0.8,
    # Closed source bars before a window start that only warm up ATR; never used for swings or touches.
    "windowWarmupBars": 60,
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


def sub_months(ts: int, months: int) -> int:
    """Calendar-month subtraction keeping the time of day. The day clamps to the target month's length,
    so 31 Aug − 6 months is 28/29 Feb and 31 Mar − 6 months is 30 Sep."""
    d = _utc(ts)
    m = d.month - 1 - months
    y, mo = d.year + m // 12, m % 12 + 1
    day = min(d.day, calendar.monthrange(y, mo)[1])
    return calendar.timegm((y, mo, day, d.hour, d.minute, d.second))


def year_start(ts: int) -> int:
    return calendar.timegm((_utc(ts).year, 1, 1, 0, 0, 0))


def window_slice(tf: str, bars: list[tuple], now: int) -> dict[str, Any]:
    """Analysis window of a derived context over ascending closed source bars.
    end is the close of the latest closed bar. YTD starts on 1 Jan of the current year on the candle clock, so a new
    year never carries the previous year's window; HY starts six calendar months before `end` and rolls with it."""
    spec = WINDOWS[tf]
    end = bar_close(tf, int(bars[-1][0])) if bars else None
    if spec["type"] == "CALENDAR_YTD":
        start = year_start(now)
    else:
        start = sub_months(end if end is not None else int(now), int(spec["months"]))
    first = next((i for i, b in enumerate(bars) if int(b[0]) >= start), len(bars))
    return {"type": spec["type"], "months": spec.get("months"), "start": start, "end": end, "first": first,
            "warmFrom": max(0, first - int(CONFIG["windowWarmupBars"]))}


def window_expired(snap: dict[str, Any], now: int) -> bool:
    """A persisted YTD window from an earlier calendar year must be rebuilt even if no new source candle arrived."""
    tf = snap.get("timeframe")
    if tf not in WINDOWS:
        return False
    w = snap.get("window")
    if not w:
        return True
    return WINDOWS[tf]["type"] == "CALENDAR_YTD" and int(w["start"] / 1000) != year_start(now)


def _day(ts: int | None) -> str:
    return _utc(ts).strftime("%Y-%m-%d") if ts is not None else "—"


def _window_public(tf: str, win: dict[str, Any], view: list[tuple]) -> dict[str, Any]:
    start, end = win["start"], win["end"]
    definition = ("START_OF_YEAR → LATEST_CLOSED_" + SOURCE_TF[tf] if win["type"] == "CALENDAR_YTD"
                  else f"LATEST_CLOSED_{SOURCE_TF[tf]} − {win['months']} CALENDAR MONTHS → LATEST_CLOSED_{SOURCE_TF[tf]}")
    return {
        "type": win["type"], "months": win["months"], "sourceTimeframe": SOURCE_TF[tf], "definition": definition,
        "start": start * 1000, "end": end * 1000 if end is not None else None,
        "firstBarTime": int(view[0][0]) * 1000 if view else None, "lastBarTime": int(view[-1][0]) * 1000 if view else None,
        "bars": len(view), "warmupBars": win["first"] - win["warmFrom"],
        "label": f"{_day(start)} → {_day(end - 1) if end is not None else 'no data'}",
    }


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


def structure_events(tf: str, bars: list[tuple], limit: int | None = None, start_ts: int | None = None) -> list[dict[str, Any]]:
    """BOS / CHoCH: a close beyond the most recent confirmed fractal swing. A fractal is only usable once its
    right-hand bars have closed, so every event is reproducible bar by bar without hindsight.
    `start_ts` keeps only events whose swing lies inside an analysis window."""
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
    if start_ts is not None:
        out = [e for e in out if e["swingTs"] >= start_ts]
    return out[-(limit or CONFIG["structureEvents"]):]


def _swings(tf: str, bars: list[tuple], atr: float, start_ts: int | None = None) -> list[dict[str, Any]]:
    start = int(start_ts) if start_ts is not None else int(bars[max(0, len(bars) - vision.tf_cfg(tf)["lookback"])][0])
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
        "hierarchyRole": "CONTEXT" if tf in CONTEXT_TIMEFRAMES else "EXECUTION" if tf in EXECUTION_TIMEFRAMES else "CORE",
        "window": None,
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


def _insufficient(tf: str, n: int, need: int, data: tuple[str, str], window: dict[str, Any] | None = None) -> str:
    if window:
        return (f"NO VALID CHANNEL — {n}/{need} closed {SOURCE_TF[tf]} candles in the {TF_LABEL[tf].lower()} window "
                f"({window['label']}); {need} are required for swing, Touch #1/#2/#3 and opposite-boundary validation")
    if tf in PERIOD_MONTHS:
        return (f"NO VALID CHANNEL — {n} complete {TF_LABEL[tf].lower()} candles aggregated from Stage 1 MN1 history; "
                f"{need} are required for swing, Touch #1/#2/#3 and opposite-boundary validation")
    return f"NO VALID CHANNEL — {n}/{need} closed {tf} candles in Stage 1 ({data[1]})"


def analyse_timeframe(symbol: str, tf: str, bars: list[tuple], data: tuple[str, str], now: int | None = None) -> dict[str, Any]:
    """One independent channel read. `bars` are validated closed candles (Y/Q already aggregated), ascending.
    For a derived window (YTD/HY) `bars` is the closed source series; the window is cut here and earlier bars only
    warm up the ATR. `now` is on the candle clock (broker server time), so freshness compares like with like."""
    now = int(now or time.time())
    cfg = vision.tf_cfg(tf)
    win = window_slice(tf, bars, now) if tf in WINDOWS else None
    view = bars[win["first"]:] if win else bars
    snap = _empty(symbol, tf, view, data, now)
    if win:
        snap["window"] = _window_public(tf, win, view)
    ev = snap["evidence"]
    if data[0] == "BLOCKED" or len(view) < cfg["minBars"]:
        why = (f"NO VALID CHANNEL — {data[1]}" if data[0] == "BLOCKED"
               else _insufficient(tf, len(view), cfg["minBars"], data, snap["window"]))
        snap["reason"] = why
        ev["reasons"].append(why)
        return snap

    work = bars[win["warmFrom"]:] if win else bars
    start_ts = win["start"] if win else None
    a = vision.analyse_tf(tf, work, start_ts=start_ts)
    atr = float(a["atr"])
    close = float(a["lastClose"])
    ev["atr"] = atr
    ev["swings"] = _swings(tf, work, atr, start_ts)
    ev["structure"] = structure_events(tf, work, start_ts=start_ts)
    snap["phase"] = a["phase"]
    if data[0] == "STALE":
        ev["warnings"].append(f"Stage 1 {SOURCE_TF[tf]} series is STALE — structure is last-known, not live evidence")
    if win:
        ev["warnings"].append(f"Derived {TF_LABEL[tf].lower()} window {snap['window']['label']} on closed {SOURCE_TF[tf]} candles — "
                              "strategic context, not part of the scored hierarchy")
    if a["status"] == "NONE":
        snap["reason"] = "NO VALID CHANNEL — " + a["reason"] + (f" (window {snap['window']['label']})" if win else "")
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
    """Relate independently detected channels top-down. Mutates relationship/parent fields; never touches geometry.
    The scored chain runs over CORE_TIMEFRAMES only. YTD/HY are then related to the nearest valid context above them
    in the canonical order, but no core channel is ever related through them."""
    edges: list[dict[str, Any]] = []
    depth: dict[str, int] = {}
    prev: str | None = None
    core = [t for t in CORE_TIMEFRAMES if t in channels]
    for i, tf in enumerate(core):
        c = channels[tf]
        parent = core[i - 1] if i else None
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
                          "confidence": round(conf, 1), "explanation": why, "scored": True})
        if is_valid(c):
            prev = tf
    for tf in CONTEXT_TIMEFRAMES:
        if tf in channels:
            edges.append(_relate_context(channels, tf, depth))
    edges.sort(key=lambda e: TIMEFRAMES.index(e["child"]))
    return edges


def _relate_context(channels: dict[str, dict[str, Any]], tf: str, depth: dict[str, int]) -> dict[str, Any]:
    i = TIMEFRAMES.index(tf)
    above = [t for t in TIMEFRAMES[:i] if t in channels]
    parent = above[-1] if above else None
    via = next((t for t in reversed(above) if is_valid(channels[t])), None)
    c = channels[tf]
    c["parentTimeframe"] = parent
    c["parentChannelId"] = channels[via]["channelId"] if via else None
    c["relationshipVia"] = via
    if not is_valid(c):
        rel, why = "UNRESOLVED", _unresolved(c)
    elif via is None:
        rel, why = "PRIMARY", f"Highest valid strategic context — {tf} {c['direction'].lower()} structure (context only, not scored)"
        depth[tf] = 0
    else:
        rel, why, depth[tf] = _relate(channels[via], c, depth.get(via, 0))
        why += " (strategic context, not scored)"
    c["relationship"] = rel
    c["relationshipReason"] = why
    c["correctionDepth"] = depth.get(tf)
    conf = min(c["confidence"], channels[via]["confidence"]) if via and rel != "UNRESOLVED" else 0.0
    return {"parent": parent, "child": tf, "via": via if rel != "UNRESOLVED" else None, "relationship": rel,
            "confidence": round(conf, 1), "explanation": why, "scored": False}


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
    """Market state, confidence, alignment, key levels and directional groups come from CORE_TIMEFRAMES only.
    YTD/HY overlap Y/Q/MN and D1 history, so they are reported under `context` and never counted as extra votes."""
    valid = [t for t in CORE_TIMEFRAMES if is_valid(channels[t])]
    unresolved = [t for t in CORE_TIMEFRAMES if t not in valid]
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

    present = [t for t in TIMEFRAMES if t in channels]
    chain = [{"timeframe": t, "direction": channels[t]["direction"], "relationship": channels[t]["relationship"],
              "status": channels[t]["status"], "scored": t in CORE_TIMEFRAMES} for t in present]
    context = {t: {k: channels[t].get(k) for k in ("direction", "status", "phase", "relationship", "relationshipVia", "confidence",
                                                   "position", "channelId", "dataStatus", "window")}
               for t in CONTEXT_TIMEFRAMES if t in channels}
    narrative = _narrative(channels, valid, unresolved, primary_tf, state)
    if context:
        narrative += " " + _context_narrative(channels, list(context))
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
        "chain": chain, "narrative": narrative, "scoredTimeframes": list(CORE_TIMEFRAMES),
        "contextTimeframes": list(context), "validContextTimeframes": [t for t in context if is_valid(channels[t])],
        "context": context,
    }


def _context_narrative(ch: dict[str, dict[str, Any]], tfs: list[str]) -> str:
    bits = []
    for t in tfs:
        c = ch[t]
        if is_valid(c):
            rel = REL_TEXT.get(c.get("relationship") or "", (c.get("relationship") or "").lower())
            via = f" vs {c['relationshipVia']}" if c.get("relationshipVia") and c.get("relationship") != "PRIMARY" else ""
            bits.append(f"{t} {c['direction'].lower()} ({rel}{via})")
        else:
            bits.append(f"{t} {'forming' if c.get('status') == 'FORMING' else 'no valid channel'}")
    return "Strategic context (not scored): " + ", ".join(bits) + "."


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
    raw = [signature(channels[t]) for t in TIMEFRAMES if t in channels] + [interp.get("marketState"), interp.get("primaryDirection"), interp.get("currentDirection")]
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
    """Candles (from Stage 1, never persisted here) plus the channel boundaries recomputed from the stored definition.
    A derived window (YTD/HY) charts exactly its own window, capped at chartBars."""
    n = limit or CONFIG["chartBars"][snap["timeframe"]]
    ts = [int(b[0]) for b in bars]
    lines = channel_lines(snap.get("definition"), ts)
    win = snap.get("window")
    if win:
        start = int(win["start"] / 1000)
        bars = [b for b in bars if int(b[0]) >= start]
    view = bars[-n:]
    return {
        "candles": [{"time": int(b[0]) * 1000, "open": b[1], "high": b[2], "low": b[3], "close": b[4], "complete": True} for b in view],
        "lines": [{"time": int(b[0]) * 1000, "upper": lines[int(b[0])][1], "lower": lines[int(b[0])][0],
                   "mid": (lines[int(b[0])][0] + lines[int(b[0])][1]) / 2} for b in view if int(b[0]) in lines],
    }


def share_source_series(channels: dict[str, dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Display-payload dedup for a source that feeds windowed contexts (D1 → D1/YTD/HY chart the same closed candles).
    The source's candles are returned once; a context whose candles are an exact contiguous slice of them gets
    `candles: []` plus `candlesRef {source, from, count}`, and a window whose lines are an exact slice of the native
    context's lines gets `linesRef {timeframe, from, count}`. Anything that is not an exact slice stays inline, so
    expanding the references always reproduces the original lists. Analysis inputs are not involved."""
    shared: dict[str, list[dict[str, Any]]] = {}
    for src, tfs in DERIVED.items():
        if not any(t in WINDOWS for t in tfs):
            continue
        members = [t for t in tfs if channels.get(t) and channels[t].get("candles")]
        if len(members) < 2:
            continue
        by_time: dict[int, dict[str, Any]] = {}
        for t in members:
            for c in channels[t]["candles"]:
                by_time.setdefault(c["time"], c)
        series = [by_time[k] for k in sorted(by_time)]
        index = {c["time"]: i for i, c in enumerate(series)}
        native = next((t for t in tfs if t not in WINDOWS), None)
        base = channels.get(native) if native else None
        base_lines = (base or {}).get("lines") or []
        line_index = {p["time"]: i for i, p in enumerate(base_lines)}
        for t in members:
            snap = channels[t]
            candles = snap["candles"]
            i = index[candles[0]["time"]]
            if series[i:i + len(candles)] == candles:
                snap["candlesRef"] = {"source": src, "from": candles[0]["time"], "count": len(candles)}
                snap["candles"] = []
                shared[src] = series
            lines = snap.get("lines") or []
            if t in WINDOWS and lines and lines[0]["time"] in line_index:
                j = line_index[lines[0]["time"]]
                if base_lines[j:j + len(lines)] == lines:
                    snap["linesRef"] = {"timeframe": native, "from": lines[0]["time"], "count": len(lines)}
                    snap["lines"] = []
    return shared


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
    for src, tf in (("D1", "D1"), ("W1", "W"), ("MN1", "MN"), ("M15", "M15"), ("M5", "M5")):
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
    d1 = out.get("D1")
    if d1:
        for tf in CONTEXT_TIMEFRAMES:
            out[tf] = d1
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
