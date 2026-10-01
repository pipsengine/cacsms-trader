"""Live multi-horizon currency/XAU strength intelligence.

This module is intentionally bridge-local: it reuses the existing MT5 terminal
session owned by server.py and exposes pure calculation helpers that can be
tested without MetaTrader.
"""

from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from typing import Any

try:
    from db import connect
    import history
except ImportError:  # pragma: no cover
    from bridge.mt5.db import connect  # type: ignore
    from bridge.mt5 import history  # type: ignore

ASSETS = ["AUD", "CAD", "CHF", "GBP", "EUR", "JPY", "NZD", "USD", "XAU"]
FIAT = ["AUD", "CAD", "CHF", "GBP", "EUR", "JPY", "NZD", "USD"]
HORIZONS = ["YTD", "HY", "Q", "MN", "W", "D", "H8", "H1", "M15", "M5", "M1"]
FX_PAIRS = [
    "AUDCAD", "AUDCHF", "AUDJPY", "AUDNZD", "AUDUSD",
    "CADCHF", "CADJPY", "CHFJPY",
    "EURAUD", "EURCAD", "EURCHF", "EURGBP", "EURJPY", "EURNZD", "EURUSD",
    "GBPAUD", "GBPCAD", "GBPCHF", "GBPJPY", "GBPNZD", "GBPUSD",
    "NZDCAD", "NZDCHF", "NZDJPY", "NZDUSD",
    "USDCAD", "USDCHF", "USDJPY",
]
SYMBOLS = FX_PAIRS + ["XAUUSD"]

WEIGHTS = {
    "YTD": 0.06,
    "HY": 0.06,
    "Q": 0.07,
    "MN": 0.08,
    "W": 0.09,
    "D": 0.10,
    "H8": 0.11,
    "H1": 0.12,
    "M15": 0.12,
    "M5": 0.10,
    "M1": 0.09,
}

ROLLUP_POLICY = {
    "24H": "1s",
    "7D": "1m",
    "30D": "5m",
    "3M": "15m",
    "6M": "30m",
    "YTD": "1h",
    "1Y": "1h",
}


def split_symbol(symbol: str) -> tuple[str, str]:
    return symbol[:3], symbol[3:6]


def _mid_from_rate(row: Any) -> float:
    return float(row["close"])


def _return_pct(current: float, reference: float | None) -> float | None:
    if reference is None or reference <= 0 or current <= 0:
        return None
    return 100.0 * math.log(current / reference)


def _reference_by_horizon(rows: list[Any], horizon: str, now: datetime) -> float | None:
    if not rows:
        return None
    current_ts = int(rows[-1]["time"])
    if horizon == "YTD":
        year_start = datetime(now.year, 1, 1, tzinfo=timezone.utc).timestamp()
        candidates = [r for r in rows if int(r["time"]) <= year_start]
        return _mid_from_rate(candidates[-1] if candidates else rows[0])
    if horizon == "HY":
        target = current_ts - 182 * 86_400
    elif horizon == "Q":
        target = current_ts - 91 * 86_400
    elif horizon == "MN":
        target = current_ts - 30 * 86_400
    elif horizon == "W":
        target = current_ts - 7 * 86_400
    elif horizon == "D":
        target = current_ts - 86_400
    elif horizon == "H8":
        target = current_ts - 8 * 3600
    elif horizon == "H1":
        target = current_ts - 3600
    elif horizon == "M15":
        target = current_ts - 15 * 60
    elif horizon == "M5":
        target = current_ts - 5 * 60
    elif horizon == "M1":
        target = current_ts - 60
    else:
        return None
    ref = rows[0]
    for row in reversed(rows):
        if int(row["time"]) <= target:
            ref = row
            break
    return _mid_from_rate(ref)


def calculate_strength(
    bars: dict[str, dict[str, list[Any]]],
    ticks: dict[str, dict[str, Any]],
    previous: dict[str, dict[str, Any]] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Calculate normalized 0-100 strength rows from constituent pair history.

    Contributions are positive for base currency movement and inverted for quote
    currency movement. XAU is normalized as XAUUSD plus the USD basket component,
    rather than assigned a hand-made score.
    """

    now = now or datetime.now(timezone.utc)
    raw: dict[str, dict[str, float | None]] = {a: {h: None for h in HORIZONS} for a in ASSETS}
    missing: list[str] = []
    insufficient: list[str] = []

    for horizon in HORIZONS:
        contrib: dict[str, list[float]] = {a: [] for a in FIAT}
        for symbol in FX_PAIRS:
            rows = bars.get(symbol, {}).get(horizon) or []
            tick = ticks.get(symbol)
            if not rows or not tick:
                missing.append(f"{symbol}:{horizon}")
                continue
            current = float(tick.get("mid") or _mid_from_rate(rows[-1]))
            reference = _reference_by_horizon(rows, horizon, now)
            ret = _return_pct(current, reference)
            if ret is None:
                insufficient.append(f"{symbol}:{horizon}")
                continue
            base, quote = split_symbol(symbol)
            contrib[base].append(ret)
            contrib[quote].append(-ret)
        for asset in FIAT:
            if len(contrib[asset]) >= 4:
                raw[asset][horizon] = sum(contrib[asset]) / len(contrib[asset])
        xau_rows = bars.get("XAUUSD", {}).get(horizon) or []
        xau_tick = ticks.get("XAUUSD")
        usd = raw["USD"][horizon]
        if xau_rows and xau_tick and usd is not None:
            current = float(xau_tick.get("mid") or _mid_from_rate(xau_rows[-1]))
            reference = _reference_by_horizon(xau_rows, horizon, now)
            ret = _return_pct(current, reference)
            if ret is not None:
                raw["XAU"][horizon] = ret + usd * (len(FIAT) - 1) / len(FIAT)
        else:
            missing.append(f"XAUUSD:{horizon}")

    values: dict[str, dict[str, float]] = {a: {} for a in ASSETS}
    for horizon in HORIZONS:
        present = [raw[a][horizon] for a in ASSETS if raw[a][horizon] is not None]
        if len(present) < len(ASSETS):
            for asset in ASSETS:
                values[asset][horizon] = 50.0
            continue
        lo, hi = min(present), max(present)
        span = (hi - lo) or 1.0
        for asset in ASSETS:
            score = 100.0 * ((raw[asset][horizon] or 0.0) - lo) / span
            values[asset][horizon] = max(0.0, min(100.0, score))

    rows: list[dict[str, Any]] = []
    for asset in ASSETS:
        composite = sum(values[asset][h] * WEIGHTS[h] for h in HORIZONS)
        prev_row = (previous or {}).get(asset) or {}
        prev_composite = float(prev_row.get("composite", composite))
        velocity = composite - prev_composite
        prev_velocity = float(prev_row.get("velocity", velocity))
        acceleration = velocity - prev_velocity
        agreement = sum(1 for h in HORIZONS if values[asset][h] >= 50) / len(HORIZONS)
        persistence = min(100.0, abs(composite - 50.0) * 2.0)
        rows.append(
            {
                "asset": asset,
                "values": values[asset],
                "composite": composite,
                "previousRank": prev_row.get("rank"),
                "rankChange": 0,
                "trend": "UP" if velocity > 0.15 else "DOWN" if velocity < -0.15 else "FLAT",
                "velocity": velocity,
                "acceleration": acceleration,
                "persistence": persistence,
                "agreement": agreement,
                "dataQuality": 0.0,
                "updatedAt": now.isoformat(),
            }
        )

    rows.sort(
        key=lambda r: (
            -r["composite"],
            -abs(r["acceleration"]),
            -abs(r["velocity"]),
            -(r["persistence"] or 0),
            r["previousRank"] or 99,
            r["asset"],
        )
    )
    for idx, row in enumerate(rows, start=1):
        prev_rank = row.get("previousRank")
        row["rank"] = idx
        row["rankChange"] = (int(prev_rank) - idx) if prev_rank else 0

    quality = max(0.0, 100.0 - 100.0 * (len(set(missing)) + len(set(insufficient))) / (len(SYMBOLS) * len(HORIZONS)))
    for row in rows:
        row["dataQuality"] = quality

    return {
        "timestamp": now.isoformat(),
        "sequence": int(now.timestamp() * 1000),
        "matrix": rows,
        "weights": WEIGHTS,
        "quality": quality,
        "dataQuality": {
            "missing": sorted(set(missing))[:80],
            "insufficient": sorted(set(insufficient))[:80],
            "requiredSymbols": SYMBOLS,
        },
    }


def unavailable(message: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "ok": False,
        "timestamp": now,
        "sequence": int(time.time() * 1000),
        "feed": {"status": "DISCONNECTED", "message": message, "latencyMs": None, "lastTick": None},
        "matrix": [],
        "history": {"rows": [], "total": 0, "resolution": "auto"},
        "predictions": {"status": "MODEL_NOT_AVAILABLE", "modelVersion": None, "rows": []},
        "quality": 0,
    }


def persist_snapshot(snapshot: dict[str, Any]) -> None:
    rows = snapshot.get("matrix") or []
    if not rows:
        return
    with connect() as conn:
        cur = conn.cursor()
        for row in rows:
            vals = row["values"]
            cur.execute(
                """
                INSERT INTO dbo.intelligence_strength_snapshot
                  (snapshot_time, sequence, asset, ytd, hy, q, mn, w, d, h8, h1, m15, m5, m1,
                   composite, rank, previous_rank, rank_change, trend, velocity, acceleration,
                   persistence, agreement, data_quality)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                snapshot["timestamp"], snapshot["sequence"], row["asset"],
                vals["YTD"], vals["HY"], vals["Q"], vals["MN"], vals["W"], vals["D"], vals["H8"],
                vals["H1"], vals["M15"], vals["M5"], vals["M1"], row["composite"], row["rank"],
                row.get("previousRank"), row["rankChange"], row["trend"], row["velocity"], row["acceleration"],
                row["persistence"], row["agreement"], row["dataQuality"],
            )
        conn.commit()


def load_previous() -> dict[str, dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT asset, composite, rank, velocity
            FROM dbo.intelligence_strength_snapshot s
            JOIN (
              SELECT asset AS a, MAX(snapshot_time) AS t
              FROM dbo.intelligence_strength_snapshot
              GROUP BY asset
            ) x ON x.a = s.asset AND x.t = s.snapshot_time
            """
        )
        return {asset: {"composite": composite, "rank": rank, "velocity": velocity} for asset, composite, rank, velocity in cur.fetchall()}


def history_page(period: str = "24H", limit: int = 100, offset: int = 0, search: str = "") -> dict[str, Any]:
    period = period if period in {"24H", "7D", "30D", "3M", "6M", "YTD", "1Y", "Custom"} else "24H"
    limit = max(1, min(int(limit or 100), 500))
    offset = max(0, int(offset or 0))
    resolution = ROLLUP_POLICY.get(period, "1s")
    modifiers = {
        "24H": "-1 day",
        "7D": "-7 days",
        "30D": "-30 days",
        "3M": "-3 months",
        "6M": "-6 months",
        "1Y": "-12 months",
    }
    where = ""
    params: list[Any] = []
    if period == "YTD":
        where = "WHERE snapshot_time >= ?"
        params.append(f"{datetime.now(timezone.utc).year}-01-01T00:00:00+00:00")
    elif period != "Custom":
        where = "WHERE snapshot_time >= datetime(CURRENT_TIMESTAMP, ?)"
        params.append(modifiers.get(period, "-1 day"))
    if search.strip():
        where += (" AND " if where else "WHERE ") + "snapshot_time LIKE ?"
        params.append(f"%{search.strip()}%")
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(DISTINCT snapshot_time) FROM dbo.intelligence_strength_snapshot {where}", params)
        total = int((cur.fetchone() or [0])[0] or 0)
        cur.execute(
            f"""
            SELECT snapshot_time, asset, composite
            FROM dbo.intelligence_strength_snapshot
            {where}
            ORDER BY snapshot_time DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit * len(ASSETS), offset * len(ASSETS)],
        )
        grouped: dict[str, dict[str, Any]] = {}
        for ts, asset, composite in cur.fetchall():
            row = grouped.setdefault(ts, {"timestamp": ts, "values": {}})
            row["values"][asset] = composite
        rows = list(grouped.values())[:limit]
    return {"rows": rows, "total": total, "resolution": resolution, "period": period}
