"""Multitimeframe Supertrend intelligence for Channel Analysis.

This module is deliberately bridge-local: it consumes bars fetched through the
existing MT5 bridge process and persists settings/snapshots in the existing
Cacsms runtime database. It does not create another broker connection.
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from typing import Any

try:
    from db import ROOT, _iso, connect
except ImportError:  # pragma: no cover
    from bridge.mt5.db import ROOT, _iso, connect  # type: ignore

TIMEFRAMES = ("YTD", "Q", "MN", "W", "D", "H8", "H1", "M15")
HTF = ("YTD", "Q", "MN", "W", "D", "H8")
EXECUTION = ("H1", "M15")
DEFAULT_MULTIPLIER = 1.0
DEFAULT_PERIOD = 100
DEFAULT_TRIGGER = "PREVIOUS"
CONFIG_KEY = "GLOBAL"


def ensure_schema() -> None:
    sql = (ROOT / "database" / "mssql" / "021_multitimeframe_supertrend.sql").read_text(encoding="utf-8")
    with connect() as conn:
        cur = conn.cursor()
        for batch in (b.strip() for b in sql.split("\nGO") if b.strip()):
            cur.execute(batch)
        conn.commit()


def _dump(value: Any) -> str:
    return json.dumps(value, default=str)


def validate_config(multiplier: Any, period: Any) -> tuple[float, int]:
    try:
        m = float(multiplier)
    except (TypeError, ValueError):
        raise ValueError("ATR Multiplier must be numeric")
    try:
        p = int(period)
    except (TypeError, ValueError):
        raise ValueError("ATR Period must be an integer")
    if not math.isfinite(m) or m < 0.1 or m > 10.0:
        raise ValueError("ATR Multiplier must be between 0.1 and 10.0")
    if p < 2 or p > 1000:
        raise ValueError("ATR Period must be between 2 and 1000")
    return round(m, 4), p


def get_config() -> dict[str, Any]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT atr_multiplier, atr_period, trigger_candle, revision, updated_at, updated_by
            FROM dbo.trader_supertrend_settings WHERE settings_key=?
            """,
            CONFIG_KEY,
        )
        row = cur.fetchone()
        if not row:
            cur.execute(
                """
                INSERT INTO dbo.trader_supertrend_settings
                  (settings_key, atr_multiplier, atr_period, trigger_candle, revision, updated_by)
                VALUES (?,?,?,?,?,?)
                """,
                CONFIG_KEY, DEFAULT_MULTIPLIER, DEFAULT_PERIOD, DEFAULT_TRIGGER, 1, "migration",
            )
            conn.commit()
            return get_config()
        return {
            "atrMultiplier": float(row[0]),
            "atrPeriod": int(row[1]),
            "triggerCandle": row[2] or DEFAULT_TRIGGER,
            "revision": int(row[3]),
            "updatedAt": _iso(row[4]),
            "updatedBy": row[5],
        }


def update_config(multiplier: Any, period: Any, expected_revision: int | None, actor: str = "operator") -> dict[str, Any]:
    ensure_schema()
    m, p = validate_config(multiplier, period)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT atr_multiplier, atr_period, trigger_candle, revision, updated_at, updated_by
            FROM dbo.trader_supertrend_settings WHERE settings_key=?
            """,
            CONFIG_KEY,
        )
        row = cur.fetchone()
        before = {
            "atrMultiplier": float(row[0]) if row else DEFAULT_MULTIPLIER,
            "atrPeriod": int(row[1]) if row else DEFAULT_PERIOD,
            "triggerCandle": (row[2] if row else DEFAULT_TRIGGER),
            "revision": int(row[3]) if row else 1,
            "updatedAt": _iso(row[4]) if row else None,
            "updatedBy": row[5] if row else "migration",
        }
        if expected_revision is not None and int(expected_revision) != before["revision"]:
            return {"ok": False, "conflict": True, "message": "Supertrend configuration was changed by another operator", "settings": before}
        after = {**before, "atrMultiplier": m, "atrPeriod": p, "triggerCandle": DEFAULT_TRIGGER, "revision": before["revision"] + 1, "updatedBy": actor}
        cur.execute(
            """
            UPDATE dbo.trader_supertrend_settings
            SET atr_multiplier=?, atr_period=?, trigger_candle=?, revision=?, updated_at=SYSUTCDATETIME(), updated_by=?
            WHERE settings_key=?
            """,
            after["atrMultiplier"], after["atrPeriod"], after["triggerCandle"], after["revision"], actor, CONFIG_KEY,
        )
        if cur.rowcount == 0:
            cur.execute(
                """
                INSERT INTO dbo.trader_supertrend_settings
                  (settings_key, atr_multiplier, atr_period, trigger_candle, revision, updated_by)
                VALUES (?,?,?,?,?,?)
                """,
                CONFIG_KEY, after["atrMultiplier"], after["atrPeriod"], after["triggerCandle"], after["revision"], actor,
            )
        cur.execute(
            """
            INSERT INTO dbo.trader_supertrend_settings_audit
              (actor_id, before_json, after_json, configuration_version)
            VALUES (?,?,?,?)
            """,
            actor, _dump(before), _dump(after), after["revision"],
        )
        conn.commit()
    return {"ok": True, "settings": get_config()}


def reset_config(expected_revision: int | None = None, actor: str = "operator") -> dict[str, Any]:
    return update_config(DEFAULT_MULTIPLIER, DEFAULT_PERIOD, expected_revision, actor)


def true_range(current: dict[str, Any], previous: dict[str, Any] | None = None) -> float:
    if previous is None:
        return max(0.0, float(current["high"]) - float(current["low"]))
    return max(
        float(current["high"]) - float(current["low"]),
        abs(float(current["high"]) - float(previous["close"])),
        abs(float(current["low"]) - float(previous["close"])),
    )


def wilder_atr(candles: list[dict[str, Any]], period: int) -> tuple[list[float | None], list[float]]:
    if period < 1:
        raise ValueError("ATR period must be positive")
    trs = [true_range(c, candles[i - 1] if i else None) for i, c in enumerate(candles)]
    values: list[float | None] = [None] * len(candles)
    if len(candles) < period:
        return values, trs
    atr = sum(trs[:period]) / period
    values[period - 1] = atr
    for i in range(period, len(candles)):
        atr = ((atr * (period - 1)) + trs[i]) / period
        values[i] = atr
    return values, trs


def calculate_supertrend(candles: list[dict[str, Any]], period: int, multiplier: float) -> dict[str, Any]:
    ordered = sorted(candles, key=lambda c: int(c["time"]))
    atr_values, _ = wilder_atr(ordered, period)
    points: list[dict[str, Any]] = []
    prev_upper = None
    prev_lower = None
    prev_dir = "UNKNOWN"
    for i, candle in enumerate(ordered):
        atr = atr_values[i]
        if atr is None:
            points.append({"time": candle["time"], "value": None, "direction": "UNKNOWN", "atr": None, "upperBand": None, "lowerBand": None, "complete": bool(candle.get("complete", True))})
            continue
        hl2 = (float(candle["high"]) + float(candle["low"])) / 2
        basic_upper = hl2 + multiplier * atr
        basic_lower = hl2 - multiplier * atr
        prev_close = float(ordered[i - 1]["close"]) if i else None
        final_upper = basic_upper if prev_upper is None else (basic_upper if basic_upper < prev_upper or (prev_close is not None and prev_close > prev_upper) else prev_upper)
        final_lower = basic_lower if prev_lower is None else (basic_lower if basic_lower > prev_lower or (prev_close is not None and prev_close < prev_lower) else prev_lower)
        direction = prev_dir
        close = float(candle["close"])
        if prev_dir == "UNKNOWN":
            direction = "UP" if close >= hl2 else "DOWN"
        elif prev_dir == "DOWN" and close > final_upper:
            direction = "UP"
        elif prev_dir == "UP" and close < final_lower:
            direction = "DOWN"
        value = final_lower if direction == "UP" else final_upper
        points.append({
            "time": candle["time"],
            "value": value,
            "direction": direction,
            "atr": atr,
            "upperBand": final_upper,
            "lowerBand": final_lower,
            "complete": bool(candle.get("complete", True)),
        })
        prev_upper = final_upper
        prev_lower = final_lower
        prev_dir = direction
    painted = [{**c, "trend": (points[i].get("direction") if i < len(points) else "UNKNOWN"), "supertrend": (points[i].get("value") if i < len(points) else None), "atr": (points[i].get("atr") if i < len(points) else None)} for i, c in enumerate(ordered)]
    confirmed_index = len(ordered) - 1
    while confirmed_index >= 0 and not bool(ordered[confirmed_index].get("complete", True)):
        confirmed_index -= 1
    return {"points": points, "painted": painted, "confirmedIndex": confirmed_index}


def _bars_since_flip(points: list[dict[str, Any]], confirmed_index: int) -> tuple[int | None, int | None]:
    if confirmed_index < 0 or points[confirmed_index]["direction"] == "UNKNOWN":
        return None, None
    direction = points[confirmed_index]["direction"]
    start = confirmed_index
    while start > 0 and points[start - 1]["direction"] == direction:
        start -= 1
    return confirmed_index - start + 1, int(points[start]["time"])


def _health(candles: list[dict[str, Any]], confirmed_index: int, period: int, now_ms: int) -> str:
    if len(candles) < period or confirmed_index < 0:
        return "INSUFFICIENT_DATA"
    last = int(candles[confirmed_index]["time"])
    age = max(0, (now_ms - last) / 1000)
    return "STALE" if age > 7 * 86400 else "LIVE"


def _freshness_ms(candles: list[dict[str, Any]], confirmed_index: int, now_ms: int) -> int | None:
    if confirmed_index < 0:
        return None
    return max(0, now_ms - int(candles[confirmed_index]["time"]))


def build_card(symbol: str, timeframe: str, candles: list[dict[str, Any]], settings: dict[str, Any], now_ms: int, digits: int = 5) -> dict[str, Any]:
    period = int(settings["atrPeriod"])
    multiplier = float(settings["atrMultiplier"])
    calc = calculate_supertrend(candles, period, multiplier)
    points = calc["points"]
    confirmed_index = int(calc["confirmedIndex"])
    confirmed = points[confirmed_index] if confirmed_index >= 0 else None
    confirmed_candle = candles[confirmed_index] if confirmed_index >= 0 else None
    current_price = float(candles[-1]["close"]) if candles else None
    direction = confirmed["direction"] if confirmed else "UNKNOWN"
    supertrend = confirmed.get("value") if confirmed else None
    atr = confirmed.get("atr") if confirmed else None
    confirmed_close = float(confirmed_candle["close"]) if confirmed_candle else None
    distance = (confirmed_close - supertrend) if confirmed_close is not None and supertrend is not None else None
    distance_atr = (distance / atr) if distance is not None and atr else None
    bars_since, flip_time = _bars_since_flip(points, confirmed_index)
    health = _health(candles, confirmed_index, period, now_ms)
    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "direction": direction if health != "INSUFFICIENT_DATA" else "UNKNOWN",
        "confirmedDirection": direction if health != "INSUFFICIENT_DATA" else "UNKNOWN",
        "currentPrice": current_price,
        "confirmedClose": confirmed_close,
        "supertrend": supertrend,
        "atr": atr,
        "distancePrice": distance,
        "distanceAtr": distance_atr,
        "barsSinceFlip": bars_since,
        "lastFlipTime": flip_time,
        "lastClosedCandleTime": int(confirmed_candle["time"]) if confirmed_candle else None,
        "freshnessMs": _freshness_ms(candles, confirmed_index, now_ms),
        "health": health,
        "dataQuality": health,
        "barCount": len(candles),
        "multiplier": multiplier,
        "atrPeriod": period,
        "triggerCandle": settings.get("triggerCandle") or DEFAULT_TRIGGER,
        "candles": calc["painted"][-160:],
        "points": points[-160:],
        "sequence": now_ms,
        "settingsRevision": int(settings["revision"]),
        "digits": digits,
        "calculatedAt": datetime.now(timezone.utc).isoformat(),
    }


def alignment(cards: dict[str, dict[str, Any]]) -> dict[str, Any]:
    values = list(cards.values())
    bullish = sum(1 for x in values if x.get("direction") == "UP")
    bearish = sum(1 for x in values if x.get("direction") == "DOWN")
    unknown = len(values) - bullish - bearish
    known = bullish + bearish
    dominant = "UNKNOWN" if known == 0 else "MIXED" if bullish == bearish else "BULLISH" if bullish > bearish else "BEARISH"

    def bias(tfs: tuple[str, ...]) -> str:
        u = sum(1 for tf in tfs if cards.get(tf, {}).get("direction") == "UP")
        d = sum(1 for tf in tfs if cards.get(tf, {}).get("direction") == "DOWN")
        return "MIXED" if u == d else "BULLISH" if u > d else "BEARISH"

    htf = bias(HTF)
    execution = bias(EXECUTION)
    pct = max(bullish, bearish) / known * 100 if known else 0.0
    interpretation = "Insufficient data"
    if htf == "BULLISH" and execution == "BEARISH":
        interpretation = "HTF BULLISH / LTF BEARISH PULLBACK"
    elif htf == "BEARISH" and execution == "BULLISH":
        interpretation = "HTF BEARISH / LTF BULLISH PULLBACK"
    elif htf == "BULLISH" and execution == "BULLISH":
        interpretation = "BULLISH MULTITIMEFRAME CONTINUATION"
    elif htf == "BEARISH" and execution == "BEARISH":
        interpretation = "BEARISH MULTITIMEFRAME CONTINUATION"
    elif dominant != "UNKNOWN":
        interpretation = f"{dominant} / MIXED TIMEFRAME STRUCTURE"
    return {
        "bullish": bullish,
        "bearish": bearish,
        "unknown": unknown,
        "total": len(values),
        "alignmentPct": round(pct, 1),
        "dominant": dominant,
        "htfBias": htf,
        "executionBias": execution,
        "titState": interpretation,
        "interpretation": interpretation,
    }


def persist_snapshot(symbol: str, snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    ensure_schema()
    transitions: list[dict[str, Any]] = []
    with connect() as conn:
        cur = conn.cursor()
        for tf, card in snapshot["cards"].items():
            cur.execute("SELECT direction, last_closed_time FROM dbo.trader_supertrend_snapshot WHERE symbol=? AND timeframe=?", symbol, tf)
            prev = cur.fetchone()
            previous_direction = prev[0] if prev else None
            event_time = card.get("lastClosedCandleTime")
            changed = previous_direction in ("UP", "DOWN") and previous_direction != card["direction"] and card["direction"] in ("UP", "DOWN")
            cur.execute(
                """
                SELECT 1 FROM dbo.trader_supertrend_snapshot WHERE symbol=? AND timeframe=?
                """,
                symbol, tf,
            )
            exists = cur.fetchone()
            row = [
                card["direction"], card.get("supertrend"), card.get("atr"), card.get("confirmedClose"),
                card.get("barsSinceFlip"), _dt_ms(card.get("lastFlipTime")), _dt_ms(card.get("lastClosedCandleTime")),
                int(snapshot["settings"]["revision"]), int(snapshot["sequence"]), snapshot["generatedAt"], _dump(card),
                symbol, tf,
            ]
            if exists:
                cur.execute(
                    """
                    UPDATE dbo.trader_supertrend_snapshot
                    SET direction=?, supertrend_value=?, atr_value=?, confirmed_close=?, bars_since_flip=?,
                        last_flip_time=?, last_closed_time=?, settings_revision=?, sequence=?, calculated_at=?, payload_json=?
                    WHERE symbol=? AND timeframe=?
                    """,
                    row,
                )
            else:
                cur.execute(
                    """
                    INSERT INTO dbo.trader_supertrend_snapshot
                      (direction, supertrend_value, atr_value, confirmed_close, bars_since_flip, last_flip_time,
                       last_closed_time, settings_revision, sequence, calculated_at, payload_json, symbol, timeframe)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    row,
                )
            if changed:
                cur.execute(
                    """
                    INSERT INTO dbo.trader_supertrend_transition
                      (symbol, timeframe, previous_direction, new_direction, price, supertrend_value, atr_value,
                       settings_revision, event_time, payload_json)
                    SELECT ?,?,?,?,?,?,?,?,?,?
                    WHERE NOT EXISTS (
                      SELECT 1 FROM dbo.trader_supertrend_transition
                      WHERE symbol=? AND timeframe=? AND event_time=? AND settings_revision=?
                    )
                    """,
                    symbol, tf, previous_direction, card["direction"], card.get("confirmedClose"), card.get("supertrend"),
                    card.get("atr"), int(snapshot["settings"]["revision"]), _dt_ms(event_time), _dump(card),
                    symbol, tf, _dt_ms(event_time), int(snapshot["settings"]["revision"]),
                )
                if cur.rowcount > 0:
                    transitions.append({
                        "symbol": symbol, "timeframe": tf, "previousDirection": previous_direction,
                        "newDirection": card["direction"], "flipBarTime": event_time,
                        "priceAtFlip": card.get("confirmedClose"), "supertrendAtFlip": card.get("supertrend"),
                        "ATRAtFlip": card.get("atr"), "multiplier": card.get("multiplier"),
                    })
        conn.commit()
    return transitions


def _dt_ms(ms: Any) -> str | None:
    if ms is None:
        return None
    return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).isoformat()


def transitions(symbol: str, limit: int = 80) -> list[dict[str, Any]]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT TOP ({max(1, min(int(limit), 300))}) id, symbol, timeframe, previous_direction, new_direction,
                   price, supertrend_value, atr_value, settings_revision, event_time, created_at
            FROM dbo.trader_supertrend_transition
            WHERE symbol=?
            ORDER BY event_time DESC, id DESC
            """,
            symbol,
        )
        return [{
            "id": int(r[0]), "symbol": r[1], "timeframe": r[2], "previousDirection": r[3],
            "newDirection": r[4], "priceAtFlip": r[5], "supertrendAtFlip": r[6],
            "ATRAtFlip": r[7], "configVersion": r[8], "flipBarTime": _iso(r[9]), "createdAt": _iso(r[10]),
        } for r in cur.fetchall()]


def health() -> dict[str, Any]:
    cfg = get_config()
    return {"ok": True, "timeframes": list(TIMEFRAMES), "defaults": {"atrMultiplier": DEFAULT_MULTIPLIER, "atrPeriod": DEFAULT_PERIOD, "triggerCandle": DEFAULT_TRIGGER}, "settings": cfg}

