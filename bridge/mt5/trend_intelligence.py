"""Multi-timeframe trend intelligence for the Strength Matrix page.

The engine is pure apart from persistence helpers. It consumes closed OHLC bars
from the existing MT5 bridge and optional channel hierarchy snapshots from the
existing Channel Analysis stage; it does not open another terminal connection.
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from typing import Any

try:
    from db import ROOT, _iso, connect
    import channel_store
    import strength_intelligence as strength
except ImportError:  # pragma: no cover
    from bridge.mt5.db import ROOT, _iso, connect  # type: ignore
    from bridge.mt5 import channel_store  # type: ignore
    from bridge.mt5 import strength_intelligence as strength  # type: ignore

ASSETS = strength.ASSETS
FIAT = strength.FIAT
HORIZONS = strength.HORIZONS
SYMBOLS = strength.SYMBOLS
FX_PAIRS = strength.FX_PAIRS

WEIGHTS = {
    "YTD": 0.13,
    "HY": 0.12,
    "Q": 0.12,
    "MN": 0.11,
    "W": 0.10,
    "D": 0.10,
    "H8": 0.09,
    "H1": 0.08,
    "M15": 0.06,
    "M5": 0.05,
    "M1": 0.04,
}

CONFIG = {
    "version": "trend-intelligence/1",
    "minBars": 24,
    "swingLookback": 2,
    "transitionScoreDelta": 8.0,
    "transitionDebounceSec": 45,
    "alignmentStrong": 72.0,
    "alignmentDirectional": 54.0,
}

ROLLUP_POLICY = strength.ROLLUP_POLICY

STATE_SIGN = {
    "Strong Bullish": 1,
    "Bullish": 1,
    "Bullish Weakening": 1,
    "Neutral / Range": 0,
    "Bearish Weakening": -1,
    "Bearish": -1,
    "Strong Bearish": -1,
}


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _stdev(xs: list[float]) -> float:
    if len(xs) < 2:
        return 0.0
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def _lin_slope(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    mx = (n - 1) / 2
    my = _mean(values)
    den = sum((i - mx) ** 2 for i in range(n)) or 1.0
    return sum((i - mx) * (values[i] - my) for i in range(n)) / den


def _atr(bars: list[dict[str, float]]) -> float:
    if len(bars) < 2:
        return 0.0
    trs = []
    prev = bars[0]["close"]
    for b in bars[1:]:
        trs.append(max(b["high"] - b["low"], abs(b["high"] - prev), abs(b["low"] - prev)))
        prev = b["close"]
    return _mean(trs[-20:])


def _pivots(bars: list[dict[str, float]], k: int = 2) -> list[dict[str, Any]]:
    out = []
    for i in range(k, len(bars) - k):
        h = bars[i]["high"]
        lo = bars[i]["low"]
        if all(h > bars[j]["high"] for j in range(i - k, i + k + 1) if j != i):
            out.append({"kind": "H", "i": i, "price": h, "ts": int(bars[i]["time"])})
        if all(lo < bars[j]["low"] for j in range(i - k, i + k + 1) if j != i):
            out.append({"kind": "L", "i": i, "price": lo, "ts": int(bars[i]["time"])})
    return out


def _structure_events(bars: list[dict[str, float]]) -> list[dict[str, Any]]:
    piv = _pivots(bars, int(CONFIG["swingLookback"]))
    out = []
    trend = 0
    last_h = last_l = None
    j = 0
    k = int(CONFIG["swingLookback"])
    for i, b in enumerate(bars):
        while j < len(piv) and piv[j]["i"] + k <= i:
            if piv[j]["kind"] == "H":
                last_h = piv[j]
            else:
                last_l = piv[j]
            j += 1
        if last_h and b["close"] > last_h["price"]:
            kind = "CHoCH" if trend < 0 else "BOS"
            trend = 1
            out.append({"kind": kind, "direction": "BULLISH", "ts": int(b["time"]), "price": b["close"], "level": last_h["price"]})
            last_h = None
        if last_l and b["close"] < last_l["price"]:
            kind = "CHoCH" if trend > 0 else "BOS"
            trend = -1
            out.append({"kind": kind, "direction": "BEARISH", "ts": int(b["time"]), "price": b["close"], "level": last_l["price"]})
            last_l = None
    return out[-12:]


def _hh_hl_state(pivots: list[dict[str, Any]]) -> tuple[int, str, dict[str, Any] | None, dict[str, Any] | None]:
    highs = [p for p in pivots if p["kind"] == "H"][-3:]
    lows = [p for p in pivots if p["kind"] == "L"][-3:]
    last_h = highs[-1] if highs else None
    last_l = lows[-1] if lows else None
    hh = len(highs) >= 2 and highs[-1]["price"] > highs[-2]["price"]
    hl = len(lows) >= 2 and lows[-1]["price"] > lows[-2]["price"]
    lh = len(highs) >= 2 and highs[-1]["price"] < highs[-2]["price"]
    ll = len(lows) >= 2 and lows[-1]["price"] < lows[-2]["price"]
    if hh and hl:
        return 1, "HH/HL", last_h, last_l
    if lh and ll:
        return -1, "LH/LL", last_h, last_l
    return 0, "MIXED", last_h, last_l


def _series_score(bars: list[dict[str, float]], channel: dict[str, Any] | None = None) -> dict[str, Any]:
    if len(bars) < int(CONFIG["minBars"]):
        return {
            "direction": "INSUFFICIENT DATA",
            "trendScore": 50.0,
            "trendStrength": 0.0,
            "structureState": "INSUFFICIENT DATA",
            "slope": 0.0,
            "momentum": 0.0,
            "persistence": 0.0,
            "volatilityAdjustedMove": 0.0,
            "lastBOS": None,
            "lastCHoCH": None,
            "lastSwingHigh": None,
            "lastSwingLow": None,
            "barsInTrend": 0,
            "confidence": 0.0,
            "dataQuality": "INSUFFICIENT DATA",
        }
    closes = [float(b["close"]) for b in bars]
    atr = _atr(bars) or max(1e-9, abs(closes[-1]) * 0.0005)
    look = min(34, len(closes))
    slope = _lin_slope(closes[-look:]) / atr
    fast = _mean(closes[-8:])
    slow = _mean(closes[-21:]) if len(closes) >= 21 else _mean(closes)
    ma_sign = 1 if fast > slow else -1 if fast < slow else 0
    momentum = (closes[-1] - closes[max(0, len(closes) - 8)]) / atr
    returns = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    recent = returns[-look:]
    up = sum(1 for r in recent if r > 0)
    down = sum(1 for r in recent if r < 0)
    persistence_signed = (up - down) / max(1, len(recent))
    volatility_move = (closes[-1] - closes[-look]) / atr
    piv = _pivots(bars)
    struct_sign, struct_state, last_h, last_l = _hh_hl_state(piv)
    events = _structure_events(bars)
    last_bos = next((e for e in reversed(events) if e["kind"] == "BOS"), None)
    last_choch = next((e for e in reversed(events) if e["kind"] == "CHoCH"), None)
    event_sign = 1 if (last_bos or {}).get("direction") == "BULLISH" else -1 if (last_bos or {}).get("direction") == "BEARISH" else 0
    channel_sign = 0
    if channel and channel.get("direction") in ("BULLISH", "BEARISH"):
        channel_sign = 1 if channel["direction"] == "BULLISH" else -1

    signed_score = (
        22 * math.tanh(slope / 2.0)
        + 18 * struct_sign
        + 14 * ma_sign
        + 14 * math.tanh(momentum / 3.0)
        + 12 * persistence_signed
        + 10 * math.tanh(volatility_move / 5.0)
        + 6 * event_sign
        + 4 * channel_sign
    )
    trend_score = _clamp(50 + signed_score / 2)
    strength_value = _clamp(abs(signed_score) * 1.15)
    direction = _classify(trend_score, strength_value, momentum, slope, last_choch)
    sign = 1 if trend_score > 54 else -1 if trend_score < 46 else 0
    bars_in_trend = 0
    for r in reversed(returns):
        if sign == 0 or (r > 0 and sign > 0) or (r < 0 and sign < 0):
            bars_in_trend += 1
        else:
            break
    if channel and channel.get("relationship") == "REVERSAL_CANDIDATE":
        direction = f"{direction} + Potential Reversal / Transition"
    confidence = _clamp(45 + strength_value * 0.45 + min(20, len(bars) / 6))
    return {
        "direction": direction,
        "trendScore": round(trend_score, 2),
        "trendStrength": round(strength_value, 1),
        "structureState": struct_state if not channel else f"{struct_state} / {channel.get('relationship', 'CHANNEL')}",
        "slope": round(slope, 4),
        "momentum": round(momentum, 3),
        "persistence": round(abs(persistence_signed) * 100, 1),
        "volatilityAdjustedMove": round(volatility_move, 3),
        "lastBOS": last_bos,
        "lastCHoCH": last_choch,
        "lastSwingHigh": last_h,
        "lastSwingLow": last_l,
        "barsInTrend": bars_in_trend,
        "confidence": round(confidence, 1),
        "dataQuality": "DEGRADED" if len(bars) < 50 else "OK",
    }


def _classify(score: float, strength_value: float, momentum: float, slope: float, choch: dict[str, Any] | None) -> str:
    if 45 <= score <= 55 or strength_value < 18:
        return "Neutral / Range"
    bullish = score > 50
    weakening = (bullish and (momentum < 0 or slope < 0.05)) or ((not bullish) and (momentum > 0 or slope > -0.05))
    if choch and ((bullish and choch.get("direction") == "BEARISH") or ((not bullish) and choch.get("direction") == "BULLISH")):
        weakening = True
    if bullish:
        return "Strong Bullish" if strength_value >= 72 and not weakening else "Bullish Weakening" if weakening else "Bullish"
    return "Strong Bearish" if strength_value >= 72 and not weakening else "Bearish Weakening" if weakening else "Bearish"


def _signed_symbol_series(symbol: str, asset: str, bars: list[dict[str, float]]) -> list[dict[str, float]]:
    if asset == "XAU":
        sign = 1 if symbol == "XAUUSD" else 0
    else:
        base, quote = strength.split_symbol(symbol)
        sign = 1 if base == asset else -1 if quote == asset else 0
    if sign >= 0:
        return bars
    return [
        {
            "time": b["time"],
            "open": -b["open"],
            "high": -b["low"],
            "low": -b["high"],
            "close": -b["close"],
        }
        for b in bars
    ]


def _synthetic_asset_series(asset: str, symbol_bars: dict[str, list[dict[str, float]]]) -> list[dict[str, float]]:
    members = []
    if asset == "XAU":
        rows = symbol_bars.get("XAUUSD") or []
        return rows
    for symbol in FX_PAIRS:
        if asset in strength.split_symbol(symbol):
            rows = symbol_bars.get(symbol) or []
            if len(rows) >= int(CONFIG["minBars"]):
                members.append(_signed_symbol_series(symbol, asset, rows))
    if not members:
        return []
    n = min(len(x) for x in members)
    members = [x[-n:] for x in members]
    out = []
    for i in range(n):
        out.append({
            "time": max(int(m[i]["time"]) for m in members),
            "open": _mean([m[i]["open"] for m in members]),
            "high": _mean([m[i]["high"] for m in members]),
            "low": _mean([m[i]["low"] for m in members]),
            "close": _mean([m[i]["close"] for m in members]),
        })
    return out


def _tf_channel(asset: str, horizon: str, channels: dict[str, Any]) -> dict[str, Any] | None:
    if asset != "XAU":
        return None
    tf = "D1" if horizon == "D" else horizon
    h = channels.get("XAUUSD") or {}
    return (h.get("channels") or {}).get(tf)


def _alignment(cells: dict[str, dict[str, Any]]) -> tuple[float, str, int]:
    num = den = 0.0
    for h in HORIZONS:
        state = str(cells[h]["direction"]).split(" + ")[0]
        sign = STATE_SIGN.get(state, 0)
        conf = float(cells[h].get("confidence") or 0) / 100
        num += sign * WEIGHTS[h] * conf
        den += WEIGHTS[h] * conf
    ratio = num / den if den else 0.0
    pct = abs(ratio) * 100
    if ratio >= CONFIG["alignmentStrong"] / 100:
        label = "Strong Bullish Alignment"
    elif ratio >= CONFIG["alignmentDirectional"] / 100:
        label = "Bullish Alignment"
    elif ratio <= -CONFIG["alignmentStrong"] / 100:
        label = "Strong Bearish Alignment"
    elif ratio <= -CONFIG["alignmentDirectional"] / 100:
        label = "Bearish Alignment"
    else:
        label = "Mixed / Transition"
    return round(pct, 1), label, 1 if ratio > 0.12 else -1 if ratio < -0.12 else 0


def _tit(cells: dict[str, dict[str, Any]], alignment_sign: int) -> dict[str, str]:
    htf_keys = ["YTD", "HY", "Q", "MN", "W", "D", "H8"]
    ltf_keys = ["H1", "M15", "M5", "M1"]
    htf = sum(STATE_SIGN.get(str(cells[h]["direction"]).split(" + ")[0], 0) * WEIGHTS[h] for h in htf_keys)
    ltf = sum(STATE_SIGN.get(str(cells[h]["direction"]).split(" + ")[0], 0) * WEIGHTS[h] for h in ltf_keys)
    htf_dir = "BULLISH" if htf > 0.05 else "BEARISH" if htf < -0.05 else "NEUTRAL"
    ltf_dir = "BULLISH" if ltf > 0.03 else "BEARISH" if ltf < -0.03 else "NEUTRAL"
    if htf_dir == "NEUTRAL" or ltf_dir == "NEUTRAL":
        state = "Transition"
    elif htf_dir == ltf_dir:
        state = "Trend Continuation"
    elif alignment_sign and ((htf_dir == "BULLISH" and ltf_dir == "BEARISH") or (htf_dir == "BEARISH" and ltf_dir == "BULLISH")):
        state = "Pullback"
    else:
        state = "Counter-Trend"
    d_score = cells["D"]["trendScore"]
    h8_score = cells["H8"]["trendScore"]
    h1_score = cells["H1"]["trendScore"]
    if abs(d_score - 50) < 9 and abs(h8_score - 50) < 9 and abs(h1_score - 50) > 16:
        state = "Potential Reversal"
    return {"htfDirection": htf_dir, "ltfDirection": ltf_dir, "state": state}


def _explain(row: dict[str, Any]) -> str:
    parts = [f"{row['asset']} is {row['overallDirection'].lower()} with {row['alignmentLabel'].lower()}."]
    parts.append(f"HTF is {row['htfDirection'].lower()} while LTF is {row['ltfDirection'].lower()}, classified as {row['titState'].lower()}.")
    evt = row.get("lastStructuralEvent")
    if evt:
        parts.append(f"Latest structural evidence is {evt['kind']} {evt['direction'].lower()} on {evt['timeframe']}.")
    if row["dataQuality"] != "OK":
        parts.append(f"Data quality is {row['dataQuality'].lower()}, so confidence is reduced.")
    return " ".join(parts)


def calculate_trends(
    bars: dict[str, dict[str, list[dict[str, float]]]],
    strength_rows: list[dict[str, Any]] | None = None,
    channel_hierarchies: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    strength_by_asset = {r["asset"]: r for r in (strength_rows or [])}
    channels = channel_hierarchies or {}
    rows = []
    features = []
    for asset in ASSETS:
        cells = {}
        missing = []
        for horizon in HORIZONS:
            symbol_bars = {s: (bars.get(s, {}).get(horizon) or []) for s in SYMBOLS}
            series = _synthetic_asset_series(asset, symbol_bars)
            if len(series) < int(CONFIG["minBars"]):
                missing.append(horizon)
            cell = _series_score(series, _tf_channel(asset, horizon, channels))
            smv = ((strength_by_asset.get(asset) or {}).get("values") or {}).get(horizon)
            if smv is not None and cell["dataQuality"] != "INSUFFICIENT DATA":
                # Strength is a small confirming feature, never the trend source.
                cell["trendStrength"] = round(_clamp(cell["trendStrength"] * 0.9 + abs(float(smv) - 50) * 0.2), 1)
            cell["timestamp"] = now.isoformat()
            cells[horizon] = cell
            features.append({
                "asset": asset,
                "timestamp": now.isoformat(),
                "timeframe": horizon,
                "direction": cell["direction"],
                "trendScore": cell["trendScore"],
                "strength": cell["trendStrength"],
                "alignment": None,
                "persistence": cell["persistence"],
                "velocity": cell["volatilityAdjustedMove"],
                "acceleration": cell["momentum"],
                "momentum": cell["momentum"],
                "structure": cell["structureState"],
                "BOS": cell["lastBOS"],
                "CHoCH": cell["lastCHoCH"],
                "regime": "TRENDING" if cell["trendStrength"] >= 45 else "RANGE",
                "TiTState": None,
                "strengthMatrixValue": smv,
                "dataQuality": cell["dataQuality"],
            })
        alignment, label, align_sign = _alignment(cells)
        tit = _tit(cells, align_sign)
        composite = sum(cells[h]["trendScore"] * WEIGHTS[h] for h in HORIZONS)
        overall = "BULLISH" if composite > 56 else "BEARISH" if composite < 44 else "NEUTRAL"
        strength_value = sum(cells[h]["trendStrength"] * WEIGHTS[h] for h in HORIZONS)
        events = []
        for h in HORIZONS:
            for key in ("lastCHoCH", "lastBOS"):
                ev = cells[h].get(key)
                if ev:
                    events.append({**ev, "timeframe": h})
        last_event = max(events, key=lambda e: e.get("ts") or 0) if events else None
        quality = "INSUFFICIENT DATA" if len(missing) == len(HORIZONS) else "DEGRADED" if missing else "OK"
        row = {
            "asset": asset,
            "timeframes": cells,
            "alignment": alignment,
            "alignmentLabel": label,
            "strength": round(strength_value, 1),
            "state": tit["state"],
            "overallDirection": overall,
            "persistence": round(sum(cells[h]["persistence"] * WEIGHTS[h] for h in HORIZONS), 1),
            "momentum": round(sum(cells[h]["momentum"] * WEIGHTS[h] for h in HORIZONS), 3),
            "acceleration": round(cells["M1"]["momentum"] - cells["M15"]["momentum"], 3),
            "currentStructure": cells["H1"]["structureState"],
            "marketRegime": "TRENDING" if strength_value >= 45 else "RANGE",
            "htfDirection": tit["htfDirection"],
            "ltfDirection": tit["ltfDirection"],
            "titState": tit["state"],
            "lastStructuralEvent": last_event,
            "lastUpdate": now.isoformat(),
            "dataQuality": quality,
        }
        row["explanation"] = _explain(row)
        for f in features:
            if f["asset"] == asset:
                f["alignment"] = alignment
                f["TiTState"] = row["titState"]
        rows.append(row)
    return {
        "ok": True,
        "timestamp": now.isoformat(),
        "sequence": int(now.timestamp() * 1000),
        "matrix": rows,
        "features": features,
        "weights": WEIGHTS,
        "config": CONFIG,
    }


def unavailable(message: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "ok": False,
        "timestamp": now,
        "sequence": int(time.time() * 1000),
        "feed": {"status": "DISCONNECTED", "message": message, "latencyMs": None, "lastTick": None},
        "matrix": [],
        "history": {"rows": [], "total": 0, "period": "24H", "resolution": "auto"},
        "transitions": [],
        "weights": WEIGHTS,
        "quality": 0,
    }


def ensure_schema() -> None:
    sql = (ROOT / "database" / "mssql" / "020_trend_intelligence.sql").read_text(encoding="utf-8")
    with connect() as conn:
        cur = conn.cursor()
        for batch in (b.strip() for b in sql.split("\nGO") if b.strip()):
            cur.execute(batch)
        conn.commit()


def _dump(value: Any) -> str:
    return json.dumps(value, default=str)


def _latest_current(cur: Any) -> dict[tuple[str, str], dict[str, Any]]:
    cur.execute("SELECT asset, timeframe, direction, trend_score, strength, payload_json FROM dbo.intelligence_trend_current")
    out = {}
    for asset, tf, direction, score, strength_value, raw in cur.fetchall():
        try:
            payload = json.loads(raw or "{}")
        except Exception:
            payload = {}
        out[(asset, tf)] = {"direction": direction, "trendScore": float(score or 0), "strength": float(strength_value or 0), "payload": payload}
    return out


def persist_snapshot(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    ensure_schema()
    transitions = []
    with connect() as conn:
        cur = conn.cursor()
        previous = _latest_current(cur)
        for row in snapshot.get("matrix") or []:
            for tf, cell in row["timeframes"].items():
                key = (row["asset"], tf)
                prev = previous.get(key)
                prev_dir = prev.get("direction") if prev else None
                score_delta = abs(float(cell["trendScore"]) - float(prev.get("trendScore", cell["trendScore"]) if prev else cell["trendScore"]))
                changed = prev_dir and prev_dir != cell["direction"] and score_delta >= CONFIG["transitionScoreDelta"]
                payload = {**cell, "alignment": row["alignment"], "titState": row["titState"], "overallDirection": row["overallDirection"]}
                cur.execute(
                    """
                    MERGE dbo.intelligence_trend_current AS t
                    USING (SELECT ? AS asset, ? AS timeframe) AS s ON t.asset=s.asset AND t.timeframe=s.timeframe
                    WHEN MATCHED THEN UPDATE SET direction=?, trend_score=?, strength=?, alignment=?, persistence=?,
                      momentum=?, acceleration=?, structure_state=?, tit_state=?, data_quality=?, payload_json=?, updated_at=SYSUTCDATETIME()
                    WHEN NOT MATCHED THEN INSERT
                      (asset, timeframe, direction, trend_score, strength, alignment, persistence, momentum, acceleration,
                       structure_state, tit_state, data_quality, payload_json)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?);
                    """,
                    row["asset"], tf,
                    cell["direction"], cell["trendScore"], cell["trendStrength"], row["alignment"], cell["persistence"],
                    cell["momentum"], row["acceleration"], cell["structureState"], row["titState"], cell["dataQuality"], _dump(payload),
                    row["asset"], tf, cell["direction"], cell["trendScore"], cell["trendStrength"], row["alignment"],
                    cell["persistence"], cell["momentum"], row["acceleration"], cell["structureState"], row["titState"],
                    cell["dataQuality"], _dump(payload),
                )
                if changed:
                    ev = cell.get("lastCHoCH") or cell.get("lastBOS") or {}
                    event = ev.get("kind") or "STATE_CHANGE"
                    cur.execute(
                        """
                        INSERT INTO dbo.intelligence_trend_transition
                          (asset, timeframe, previous_trend, new_trend, trend_score, strength, alignment,
                           persistence, momentum, event_type, regime, tit_state, price, payload_json)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        """,
                        row["asset"], tf, prev_dir, cell["direction"], cell["trendScore"], cell["trendStrength"], row["alignment"],
                        cell["persistence"], cell["momentum"], event, row["marketRegime"], row["titState"], ev.get("price"),
                        _dump(payload),
                    )
                    transitions.append({
                        "asset": row["asset"], "timeframe": tf, "previous": prev_dir, "current": cell["direction"],
                        "strength": cell["trendStrength"], "event": event, "time": snapshot["timestamp"],
                    })
            cur.execute(
                """
                INSERT INTO dbo.intelligence_trend_history
                  (snapshot_time, sequence, asset, overall_direction, strength, alignment, persistence, momentum,
                   acceleration, regime, tit_state, payload_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                snapshot["timestamp"], snapshot["sequence"], row["asset"], row["overallDirection"], row["strength"],
                row["alignment"], row["persistence"], row["momentum"], row["acceleration"], row["marketRegime"],
                row["titState"], _dump(row),
            )
        cur.execute(
            "INSERT INTO dbo.intelligence_trend_metadata (snapshot_time, config_json, weights_json, feature_count) VALUES (?,?,?,?)",
            snapshot["timestamp"], _dump(CONFIG), _dump(WEIGHTS), len(snapshot.get("features") or []),
        )
        conn.commit()
    return transitions


def history_page(period: str = "24H", asset: str = "", timeframe: str = "", limit: int = 80, offset: int = 0) -> dict[str, Any]:
    ensure_schema()
    period = period if period in {"24H", "7D", "30D", "3M", "6M", "YTD", "1Y", "Custom"} else "24H"
    limit = max(1, min(int(limit or 80), 500))
    offset = max(0, int(offset or 0))
    modifiers = {"24H": "-1 day", "7D": "-7 days", "30D": "-30 days", "3M": "-3 months", "6M": "-6 months", "1Y": "-12 months"}
    where = []
    params: list[Any] = []
    if period == "YTD":
        where.append("snapshot_time >= ?")
        params.append(f"{datetime.now(timezone.utc).year}-01-01T00:00:00+00:00")
    elif period != "Custom":
        where.append("snapshot_time >= datetime(CURRENT_TIMESTAMP, ?)")
        params.append(modifiers.get(period, "-1 day"))
    if asset:
        where.append("asset = ?")
        params.append(asset.upper())
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM dbo.intelligence_trend_history {clause}", params)
        total = int((cur.fetchone() or [0])[0] or 0)
        cur.execute(
            f"""
            SELECT snapshot_time, asset, overall_direction, strength, alignment, persistence, momentum,
                   acceleration, regime, tit_state, payload_json
            FROM dbo.intelligence_trend_history
            {clause}
            ORDER BY snapshot_time DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        )
        rows = []
        for r in cur.fetchall():
            payload = json.loads(r[10] or "{}")
            if timeframe:
                payload = (payload.get("timeframes") or {}).get(timeframe.upper()) or payload
            rows.append({
                "timestamp": _iso(r[0]), "asset": r[1], "direction": r[2], "strength": r[3],
                "alignment": r[4], "persistence": r[5], "momentum": r[6], "acceleration": r[7],
                "regime": r[8], "titState": r[9], "payload": payload,
            })
    return {"rows": rows, "total": total, "period": period, "resolution": ROLLUP_POLICY.get(period, "1s")}


def transitions(limit: int = 80, asset: str = "") -> list[dict[str, Any]]:
    ensure_schema()
    params: list[Any] = []
    where = ""
    if asset:
        where = "WHERE asset=?"
        params.append(asset.upper())
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT TOP ({max(1, min(int(limit), 300))}) id, asset, timeframe, previous_trend, new_trend,
                   strength, event_type, created_at
            FROM dbo.intelligence_trend_transition {where}
            ORDER BY id DESC
            """,
            params,
        )
        return [{
            "id": int(r[0]), "asset": r[1], "timeframe": r[2], "previous": r[3], "current": r[4],
            "strength": r[5], "event": r[6], "time": _iso(r[7]),
        } for r in cur.fetchall()]

