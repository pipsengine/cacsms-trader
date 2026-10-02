from __future__ import annotations

from typing import Any

# Primary chart TF → Supertrend intelligence card key
_TF_MS: dict[str, int] = {
    "M5": 300_000,
    "M15": 900_000,
    "H1": 3_600_000,
    "H8": 28_800_000,
    "D1": 86_400_000,
    "W": 604_800_000,
    "MN": 2_592_000_000,
    "Q": 7_776_000_000,
    "YTD": 31_536_000_000,
}

_ST_KEY_FOR_PRIMARY: dict[str, str] = {
    "YTD": "Y",
    "Q": "Q",
    "MN": "MN",
    "W": "W",
    "D1": "D",
    "H8": "H8",
    "H1": "H1",
    "M15": "M15",
    "M5": "M15",
}


def _resolve_candles(ch: dict[str, Any], channels: dict[str, Any], shared: dict[str, Any]) -> list[dict[str, Any]]:
    raw = ch.get("candles") or []
    if raw:
        return list(raw)
    ref = ch.get("candlesRef")
    if not isinstance(ref, dict):
        return []
    series = shared.get(ref.get("source")) or []
    if not series:
        src_tf = str(ref.get("source") or "")
        series = (channels.get(src_tf) or {}).get("candles") or []
    start = ref.get("from")
    count = int(ref.get("count") or 0)
    if start is None or count <= 0:
        return []
    idx = next((i for i, c in enumerate(series) if c.get("time") == start), None)
    if idx is None:
        return []
    return list(series[idx : idx + count])


def _resolve_lines(ch: dict[str, Any], channels: dict[str, Any]) -> list[dict[str, Any]]:
    raw = ch.get("lines") or []
    if raw:
        return list(raw)
    ref = ch.get("linesRef")
    if not isinstance(ref, dict):
        return []
    native = channels.get(ref.get("timeframe") or "") or {}
    base = native.get("lines") or []
    start = ref.get("from")
    count = int(ref.get("count") or 0)
    if start is None or count <= 0:
        return []
    idx = next((i for i, p in enumerate(base) if p.get("time") == start), None)
    if idx is None:
        return []
    return list(base[idx : idx + count])


def _line_points(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in lines:
        if not isinstance(row, dict):
            continue
        t = row.get("time")
        upper = row.get("upper")
        lower = row.get("lower")
        if t is None or upper is None or lower is None:
            continue
        mid = row.get("mid")
        if mid is None:
            try:
                mid = (float(upper) + float(lower)) / 2
            except (TypeError, ValueError):
                mid = None
        out.append(
            {
                "time": int(t),
                "upper": float(upper),
                "lower": float(lower),
                "mid": float(mid) if mid is not None else None,
            }
        )
    return out


def _norm_ms(t: int | float) -> int:
    v = int(t)
    return v if v > 1_000_000_000_000 else v * 1000


def _window_filter(series: list[dict[str, Any]], candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not series or not candles:
        return series
    times = sorted(_norm_ms(c["time"]) for c in candles if c.get("time") is not None)
    if not times:
        return series
    t0, t1 = times[0], times[-1]
    return [p for p in series if t0 <= _norm_ms(p.get("time", 0)) <= t1]


def _channel_lines_for_chart(
    ch: dict[str, Any],
    channels: dict[str, Any],
    candles: list[dict[str, Any]],
    primary_tf: str,
) -> list[dict[str, Any]]:
    """Two endpoint rows for diagonal channel rails (full series, not window-clipped to zero)."""
    resolved = _line_points(_resolve_lines(ch, channels))
    if len(resolved) >= 2:
        resolved.sort(key=lambda p: _norm_ms(p["time"]))
        return [resolved[0], resolved[-1]]
    step = _TF_MS.get(primary_tf, 3_600_000)
    if len(resolved) == 1 and candles:
        l0 = resolved[0]
        t_end = _norm_ms(candles[-1]["time"]) + step * 14
        return [
            l0,
            {
                "time": t_end,
                "upper": l0["upper"],
                "lower": l0["lower"],
                "mid": l0.get("mid"),
            },
        ]
    ub, lb = ch.get("upperBoundary"), ch.get("lowerBoundary")
    if ub is not None and lb is not None and candles:
        t0 = _norm_ms(candles[0]["time"])
        t1 = _norm_ms(candles[-1]["time"]) + step * 14
        mid = ch.get("midline")
        if mid is None:
            try:
                mid = (float(ub) + float(lb)) / 2
            except (TypeError, ValueError):
                mid = None
        row0 = {
            "time": t0,
            "upper": float(ub),
            "lower": float(lb),
            "mid": float(mid) if mid is not None else None,
        }
        row1 = {
            "time": t1,
            "upper": float(ub),
            "lower": float(lb),
            "mid": float(mid) if mid is not None else None,
        }
        return [row0, row1]
    return []


def _supertrend_series(supertrend: dict[str, Any] | None, primary_tf: str) -> list[dict[str, Any]]:
    if not supertrend or not supertrend.get("ok"):
        return []
    cards = supertrend.get("cards") or {}
    st_key = _ST_KEY_FOR_PRIMARY.get(primary_tf, "H1")
    card = cards.get(st_key)
    if not card:
        return []
    series: list[dict[str, Any]] = []
    for pt in card.get("points") or []:
        if not isinstance(pt, dict):
            continue
        t = pt.get("time")
        val = pt.get("value")
        if t is None or val is None:
            continue
        direction = (pt.get("direction") or "UNKNOWN").upper()
        series.append({"time": int(t), "value": float(val), "direction": direction})
    if series:
        return series
    for c in card.get("candles") or []:
        if not isinstance(c, dict):
            continue
        val = c.get("supertrend")
        t = c.get("time")
        if val is None or t is None:
            continue
        direction = (c.get("trend") or "UNKNOWN").upper()
        series.append({"time": int(t), "value": float(val), "direction": direction})
    return series


def build_chart_payload(
    channels: dict[str, Any],
    primary_tf: str,
    supertrend: dict[str, Any] | None,
    lookback: int = 80,
    shared_candles: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Channel candles/lines plus authoritative Supertrend series for the primary TF."""
    shared = shared_candles or {}
    key = primary_tf if primary_tf in channels else {"YTD": "YTD", "D1": "D1"}.get(primary_tf, "H1")
    ch = channels.get(key) or channels.get("H1")
    if not ch:
        return {}
    candles = _resolve_candles(ch, channels, shared)
    for c in candles:
        if "complete" not in c:
            c["complete"] = True
    if lookback > 0 and len(candles) > lookback:
        candles = candles[-lookback:]
    channel_lines = _channel_lines_for_chart(ch, channels, candles, primary_tf)
    st_series = _window_filter(_supertrend_series(supertrend, primary_tf), candles)
    return {
        "timeframe": key,
        "candles": [{k: c[k] for k in ("time", "open", "high", "low", "close", "complete") if k in c} for c in candles],
        "lines": channel_lines,
        "channelLines": channel_lines,
        "supertrendSeries": st_series,
        "supertrendTimeframe": _ST_KEY_FOR_PRIMARY.get(primary_tf, "H1"),
        "disclaimer": "DATA AVAILABLE AT DECISION TIME ONLY",
    }
