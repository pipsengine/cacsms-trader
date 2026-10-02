from __future__ import annotations

from typing import Any

_TF_MS = {
    "M5": 300_000,
    "M15": 900_000,
    "H1": 3_600_000,
    "H8": 28_800_000,
    "D1": 86_400_000,
}


def _ms(time_val: int | float) -> int:
    t = int(time_val)
    return t if t > 1_000_000_000_000 else t * 1000


def _st_direction(raw: str) -> str:
    u = (raw or "").upper()
    if u in ("UP", "BULLISH"):
        return "BULLISH"
    if u in ("DOWN", "BEARISH"):
        return "BEARISH"
    return "BULLISH"


def build_chart_view(
    *,
    symbol: str,
    primary_tf: str,
    direction: str,
    chart_snap: dict[str, Any],
    annotations: list[dict[str, Any]],
    level_hints: dict[str, Any],
    scenarios: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Structured ChartModel for AITradingChart (Annotation Planner output)."""
    candles = chart_snap.get("candles") or []
    lines = chart_snap.get("channelLines") or chart_snap.get("lines") or []
    st_raw = chart_snap.get("supertrendSeries") or []

    if not candles:
        return {"symbol": symbol, "timeframe": primary_tf, "candles": []}

    candle_rows = []
    for c in candles:
        if c.get("complete") is False:
            continue
        candle_rows.append(
            {
                "time": _ms(c["time"]),
                "open": float(c["open"]),
                "high": float(c["high"]),
                "low": float(c["low"]),
                "close": float(c["close"]),
                "volume": float(c.get("volume") or 0),
                "closed": True,
            }
        )
    if not candle_rows:
        return {"symbol": symbol, "timeframe": primary_tf, "candles": []}

    last_time = candle_rows[-1]["time"]
    step = _TF_MS.get(primary_tf, 3_600_000)
    future = int(step * 14)

    channels: list[dict[str, Any]] = []
    if len(lines) >= 2:
        l0, l1 = lines[0], lines[-1]
        t0, t1 = _ms(l0["time"]), _ms(l1["time"])
        end_t = max(t1, last_time) + future
        mid0 = l0.get("mid")
        mid1 = l1.get("mid")
        ch: dict[str, Any] = {
            "id": f"{primary_tf}-channel",
            "direction": direction,
            "upperStart": {"time": t0, "price": float(l0["upper"])},
            "upperEnd": {"time": end_t, "price": float(l1["upper"])},
            "lowerStart": {"time": t0, "price": float(l0["lower"])},
            "lowerEnd": {"time": end_t, "price": float(l1["lower"])},
        }
        if mid0 is not None and mid1 is not None:
            ch["medianStart"] = {"time": t0, "price": float(mid0)}
            ch["medianEnd"] = {"time": end_t, "price": float(mid1)}
        channels.append(ch)

    sup_hi = level_hints.get("supplyUpper")
    sup_lo = level_hints.get("supplyLower")
    erz_hi = level_hints.get("erzUpper")
    erz_lo = level_hints.get("erzLower")
    zones: list[dict[str, Any]] = []
    n = len(candle_rows)
    if sup_hi is not None and sup_lo is not None:
        zones.append(
            {
                "id": "supply",
                "type": "SUPPLY",
                "label": f"{primary_tf} Supply",
                "startTime": candle_rows[max(0, int(n * 0.38))]["time"],
                "endTime": last_time + int(step * 6),
                "high": float(max(sup_hi, sup_lo)),
                "low": float(min(sup_hi, sup_lo)),
                "state": "ACTIVE",
            }
        )
    if erz_hi is not None and erz_lo is not None:
        zones.append(
            {
                "id": "erz",
                "type": "ERZ",
                "label": f"{primary_tf} ERZ / Demand",
                "startTime": candle_rows[max(0, int(n * 0.52))]["time"],
                "endTime": last_time + future,
                "high": float(max(erz_hi, erz_lo)),
                "low": float(min(erz_hi, erz_lo)),
                "state": "REACTION",
            }
        )

    swings = sorted(
        [a for a in annotations if a.get("type") in ("HIGH", "LOW") and a.get("candleTimestamp")],
        key=lambda a: int(a.get("candleTimestamp") or 0),
    )
    structures: list[dict[str, Any]] = []
    seq = 3
    for sw in swings[-3:]:
        kind = sw.get("type")
        structures.append(
            {
                "id": sw.get("id") or f"sw-{sw.get('candleTimestamp')}",
                "type": "SWING_HIGH" if kind == "HIGH" else "SWING_LOW",
                "time": _ms(sw["candleTimestamp"]),
                "price": float(sw.get("price") or 0),
                "label": str(seq),
                "sequence": seq,
                "priority": 70,
                "state": "OBSERVED",
            }
        )
        seq += 1

    for ann in annotations:
        t = (ann.get("type") or "").upper()
        if t not in ("BOS", "CHOCH"):
            continue
        ts = ann.get("candleTimestamp")
        if ts is None:
            continue
        structures.append(
            {
                "id": ann.get("id") or t.lower(),
                "type": t,
                "time": _ms(ts),
                "price": float(ann.get("price") or candle_rows[-1]["close"]),
                "label": "CHOCH" if t == "CHOCH" else "BOS",
                "direction": direction,
                "priority": 95 if t == "BOS" else 90,
                "state": ann.get("status") or "CONFIRMED",
            }
        )

    levels: list[dict[str, Any]] = []
    p2 = level_hints.get("p2")
    if p2 is not None:
        levels.append(
            {
                "id": "p2",
                "type": "BREAK",
                "price": float(p2),
                "label": "P2 Break",
                "direction": direction,
            }
        )
    inv = level_hints.get("invalidation")
    if inv is not None:
        levels.append({"id": "invalidation", "type": "INVALIDATION", "price": float(inv), "label": "Invalidation"})
    t1 = level_hints.get("t1")
    t2 = level_hints.get("t2")
    if t1 is not None:
        levels.append({"id": "t1", "type": "TARGET", "price": float(t1), "label": "T1"})
    if t2 is not None:
        levels.append({"id": "t2", "type": "TARGET", "price": float(t2), "label": "T2"})

    last_close = candle_rows[-1]["close"]
    path_prices = _projected_prices(direction, last_close, level_hints)
    labels = ["CURRENT", "REACTION", "RETEST", "BOS", "T1", "T2"]
    offsets = [0, 3, 5, 8, 11, 14]
    projected = []
    for i, off in enumerate(offsets):
        if i >= len(path_prices):
            break
        projected.append(
            {
                "id": f"scenario-{i}",
                "time": last_time + int(step * off),
                "price": float(path_prices[i]),
                "label": labels[i] if i < len(labels) else None,
            }
        )

    supertrend = [
        {"time": _ms(p["time"]), "value": float(p["value"]), "direction": _st_direction(p.get("direction") or "")}
        for p in st_raw
        if p.get("time") is not None and p.get("value") is not None
    ]

    return {
        "symbol": symbol,
        "timeframe": primary_tf,
        "candles": candle_rows,
        "currentPrice": last_close,
        "timezoneLabel": "UTC+1",
        "supertrend": supertrend,
        "channels": channels,
        "zones": zones,
        "structures": structures,
        "levels": levels,
        "projectedScenario": projected,
        "scenarioPrimary": (scenarios or {}).get("primary"),
    }


def _projected_prices(direction: str, last_close: float, hints: dict[str, Any]) -> list[float]:
    erz_mid = hints.get("erzMid")
    p2 = hints.get("p2")
    t1 = hints.get("t1")
    t2 = hints.get("t2")
    erz_lo = hints.get("erzLower")
    erz_hi = hints.get("erzUpper")
    erz_touch = erz_lo if direction == "BULLISH" else erz_hi
    if erz_touch is None:
        erz_touch = erz_mid if erz_mid is not None else last_close
    bull = (direction or "").upper() == "BULLISH"
    reaction = (
        float(erz_mid) + (float(p2) - float(erz_mid)) * 0.35
        if bull and erz_mid is not None and p2 is not None
        else float(last_close) + (1 if bull else -1) * abs(float(last_close) - float(erz_touch or last_close)) * 0.2
    )
    retest = float(p2) if p2 is not None else reaction
    bos = float(t1) if t1 is not None else reaction
    out = [float(last_close), float(reaction), float(retest), float(bos)]
    if t1 is not None:
        out.append(float(t1))
    if t2 is not None:
        out.append(float(t2))
    return out
