"""SQL Server access for Stage 5 HTF Market Vision: channels, touches, structural events, analysis history."""

from __future__ import annotations

import json
from typing import Any

try:
    from db import ROOT, _iso, connect, set_setting
except ImportError:  # pragma: no cover
    from bridge.mt5.db import ROOT, _iso, connect, set_setting  # type: ignore

_schema_ready = False

EVENT_SEVERITY = {
    "BREAKOUT": "WARNING", "FAILED_BREAKOUT": "WARNING", "INVALIDATED": "WARNING", "RETEST": "INFO",
    "INTRABAR_BREACH": "WARNING", "VOLATILITY_SPIKE": "WARNING", "DATA_BLOCKED": "ERROR", "ANALYSIS_ERROR": "ERROR",
}


def ensure_vision_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "005_htf_vision.sql").read_text(encoding="utf-8")
    batches = [b.strip() for b in sql.split("\nGO") if b.strip()]
    with connect() as conn:
        cur = conn.cursor()
        for batch in batches:
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


def scanner_rows() -> dict[str, dict[str, Any]]:
    """Market Scanner publication (Stage 3/4 pair intelligence) per instrument."""
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol, status, bias, conviction, differential, obs_date FROM dbo.app_regime_pair")
        return {
            s: {"status": st, "bias": b, "conviction": cv, "differential": d, "date": _iso(od)}
            for s, st, b, cv, d, od in cur.fetchall()
        }


def previous_channels() -> dict[tuple[str, str], dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol, timeframe, channel_key, status, direction, phase, vol_state, data_status FROM dbo.app_vision_channel")
        return {
            (s, tf): {"channelKey": k, "status": st, "direction": d, "phase": ph, "volState": vs, "dataStatus": ds}
            for s, tf, k, st, d, ph, vs, ds in cur.fetchall()
        }


def _channel_params(symbol: str, tf: str, data: tuple[str, str], available: int, required: int, a: dict[str, Any] | None) -> list[Any]:
    a = a or {}
    brk = a.get("breakout") or {}
    touches = a.get("touches") or {}
    stored = {k: v for k, v in a.items() if k != "events"} if a else None
    return [
        data[0], data[1][:400], int(available), int(required), a.get("channelKey"), a.get("status"),
        a.get("direction") or "NEUTRAL", a.get("lean"), 1 if a.get("confirmed") else 0, a.get("phase"), a.get("position"),
        a.get("upper"), a.get("lower"), a.get("slope"), a.get("slopeAtr20"), a.get("width"), a.get("widthAtr"),
        touches.get("anchor"), touches.get("opposite"), a.get("touchQuality"), a.get("parallelDev"), a.get("ageBars"),
        brk.get("side"), brk.get("ts"), brk.get("distanceAtr"), a.get("atr"), a.get("volRatio"), a.get("volState"),
        float(a.get("confidence") or 0), a.get("lastTs"), json.dumps(stored, default=str) if stored else None,
    ]


_CHANNEL_SET = """
data_status=?, data_reason=?, bars_available=?, bars_required=?, channel_key=?, status=?, direction=?, lean=?,
confirmed=?, phase=?, position=?, upper_now=?, lower_now=?, slope=?, slope_atr20=?, width=?, width_atr=?,
touches_anchor=?, touches_opposite=?, touch_quality=?, parallel_dev=?, age_bars=?, breakout_side=?, breakout_ts=?,
breakout_atr=?, atr=?, vol_ratio=?, vol_state=?, confidence=?, last_bar_ts=?, analysis_json=?
"""
_CHANNEL_COLS = [c.split("=")[0].strip() for c in _CHANNEL_SET.replace("\n", " ").split(",")]


def persist(out: dict[str, Any], channels: dict[str, dict[str, Any]], events: list[dict[str, Any]],
            trigger: str, duration_ms: int) -> list[dict[str, Any]]:
    """One transaction per instrument. Returns the structural events that were new."""
    sym = out["symbol"]
    new_events: list[dict[str, Any]] = []
    d1, h8 = out["d1"], out["h8"]
    with connect() as conn:
        cur = conn.cursor()
        inst = [
            out["status"], out["reason"][:600], "QUALIFIED" if out["scanner"].get("qualified") else "NOT_QUALIFIED",
            (out["scanner"].get("reason") or "")[:300], out["primaryDirection"], out["agreement"], out["phase"],
            out["confidence"], out["channelPosition"], d1.get("lastTs"), h8.get("lastTs"),
            json.dumps(out, default=str), trigger[:200], int(duration_ms),
        ]
        cur.execute(
            """
            MERGE dbo.app_vision_instrument AS t USING (SELECT ? AS symbol) AS s ON t.symbol = s.symbol
            WHEN MATCHED THEN UPDATE SET status=?, reason=?, scanner_status=?, scanner_reason=?, primary_direction=?,
              agreement=?, phase=?, confidence=?, channel_position=?, d1_bar_ts=?, h8_bar_ts=?, output_json=?,
              trigger_reason=?, duration_ms=?, analysed_at=SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (symbol, status, reason, scanner_status, scanner_reason, primary_direction,
              agreement, phase, confidence, channel_position, d1_bar_ts, h8_bar_ts, output_json, trigger_reason, duration_ms)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);
            """,
            sym, *inst, sym, *inst,
        )
        for tf, c in channels.items():
            params = _channel_params(sym, tf, c["data"], c["available"], c["required"], c["analysis"])
            cur.execute(
                f"""
                MERGE dbo.app_vision_channel AS t USING (SELECT ? AS symbol, ? AS timeframe) AS s
                  ON t.symbol = s.symbol AND t.timeframe = s.timeframe
                WHEN MATCHED THEN UPDATE SET {_CHANNEL_SET}, analysed_at=SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT (symbol, timeframe, {', '.join(_CHANNEL_COLS)})
                VALUES (?, ?, {', '.join('?' for _ in _CHANNEL_COLS)});
                """,
                sym, tf, *params, sym, tf, *params,
            )
            cur.execute("DELETE FROM dbo.app_vision_touch WHERE symbol=? AND timeframe=?", sym, tf)
            a = c["analysis"] or {}
            for t in a.get("touchList") or []:
                cur.execute(
                    "INSERT INTO dbo.app_vision_touch (symbol, timeframe, channel_key, seq, boundary, role, bar_ts, price, line_price, deviation_atr) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    sym, tf, a["channelKey"], t["seq"], t["boundary"], t["role"], t["ts"], t["price"], t["line"], t["deviationAtr"],
                )
        for e in events:
            cur.execute(
                """
                INSERT INTO dbo.app_vision_event (symbol, timeframe, channel_key, event_type, bar_ts, price, severity, detail)
                SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (
                  SELECT 1 FROM dbo.app_vision_event WITH (UPDLOCK, HOLDLOCK)
                  WHERE symbol=? AND timeframe=? AND channel_key=? AND event_type=? AND bar_ts=?)
                """,
                sym, e["tf"], e.get("channelKey") or "-", e["type"], int(e["ts"]), e.get("price"),
                EVENT_SEVERITY.get(e["type"], "INFO"), e["detail"][:600],
                sym, e["tf"], e.get("channelKey") or "-", e["type"], int(e["ts"]),
            )
            if cur.rowcount and cur.rowcount > 0:
                new_events.append(e)
        if d1.get("lastTs") is not None and h8.get("lastTs") is not None:
            hist = [
                out["status"], out["primaryDirection"], out["agreement"], out["phase"], out["confidence"],
                d1.get("status"), d1.get("direction"), d1.get("position"), d1.get("confidence"),
                h8.get("status"), h8.get("direction"), h8.get("position"), h8.get("confidence"), trigger[:200],
            ]
            cur.execute(
                """
                MERGE dbo.app_vision_history AS t
                USING (SELECT ? AS symbol, ? AS d1_bar_ts, ? AS h8_bar_ts) AS s
                  ON t.symbol = s.symbol AND t.d1_bar_ts = s.d1_bar_ts AND t.h8_bar_ts = s.h8_bar_ts
                WHEN MATCHED THEN UPDATE SET status=?, primary_direction=?, agreement=?, phase=?, confidence=?,
                  d1_status=?, d1_direction=?, d1_position=?, d1_confidence=?, h8_status=?, h8_direction=?,
                  h8_position=?, h8_confidence=?, trigger_reason=?, analysed_at=SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT (symbol, d1_bar_ts, h8_bar_ts, status, primary_direction, agreement, phase,
                  confidence, d1_status, d1_direction, d1_position, d1_confidence, h8_status, h8_direction, h8_position,
                  h8_confidence, trigger_reason)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);
                """,
                sym, d1["lastTs"], h8["lastTs"], *hist, sym, d1["lastTs"], h8["lastTs"], *hist,
            )
        conn.commit()
    return new_events


def add_events(symbol: str, events: list[dict[str, Any]]) -> int:
    if not events:
        return 0
    n = 0
    with connect() as conn:
        cur = conn.cursor()
        for e in events:
            cur.execute(
                """
                INSERT INTO dbo.app_vision_event (symbol, timeframe, channel_key, event_type, bar_ts, price, severity, detail)
                SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (
                  SELECT 1 FROM dbo.app_vision_event WHERE symbol=? AND timeframe=? AND channel_key=? AND event_type=? AND bar_ts=?)
                """,
                symbol, e["tf"], e.get("channelKey") or "-", e["type"], int(e["ts"]), e.get("price"),
                EVENT_SEVERITY.get(e["type"], "INFO"), e["detail"][:600],
                symbol, e["tf"], e.get("channelKey") or "-", e["type"], int(e["ts"]),
            )
            n += max(0, cur.rowcount)
        conn.commit()
    return n


def update_live(rows: list[tuple]) -> None:
    """rows: (price, pos_d1, pos_h8, tick_ts, market_open, symbol)."""
    if not rows:
        return
    with connect() as conn:
        cur = conn.cursor()
        for r in rows:
            cur.execute(
                "UPDATE dbo.app_vision_instrument SET live_price=?, live_position_d1=?, live_position_h8=?, live_tick_ts=?, "
                "live_market_open=?, live_at=SYSUTCDATETIME() WHERE symbol=?",
                *r,
            )
        conn.commit()


_LIVE_COLS = "live_price, live_position_d1, live_position_h8, live_at, live_tick_ts, live_market_open"


def _live(price, pos_d1, pos_h8, at, tick_ts, market_open) -> dict[str, Any]:
    return {"price": price, "positionD1": pos_d1, "positionH8": pos_h8, "at": _iso(at),
            "tickTs": int(tick_ts) if tick_ts is not None else None,
            "marketOpen": None if market_open is None else bool(market_open)}


def save_meta(meta: dict[str, Any]) -> None:
    set_setting("vision.last_run", json.dumps(meta, default=str))


def _event_dict(r: tuple) -> dict[str, Any]:
    i, s, tf, k, typ, ts, price, sev, detail, created = r
    return {"id": int(i), "symbol": s, "timeframe": tf, "channelKey": k, "type": typ, "ts": int(ts), "price": price,
            "severity": sev, "detail": detail, "createdAt": _iso(created)}


_EVENT_COLS = "id, symbol, timeframe, channel_key, event_type, bar_ts, price, severity, detail, created_at"


def load_state(event_limit: int = 150) -> dict[str, Any]:
    ensure_vision_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT [value] FROM dbo.app_settings WHERE [key] = N'vision.last_run'")
        row = cur.fetchone()
        try:
            run = json.loads(row[0]) if row else None
        except Exception:
            run = None
        cur.execute(
            f"SELECT symbol, output_json, {_LIVE_COLS}, analysed_at, trigger_reason, duration_ms "
            "FROM dbo.app_vision_instrument ORDER BY symbol"
        )
        instruments = []
        for sym, js, lp, l1, l8, lat, lts, lopen, at, trig, dur in cur.fetchall():
            try:
                out = json.loads(js)
            except Exception:
                continue
            out.update({"live": _live(lp, l1, l8, lat, lts, lopen), "analysedAt": _iso(at), "trigger": trig, "durationMs": dur})
            instruments.append(out)
        cur.execute(f"SELECT TOP ({int(event_limit)}) {_EVENT_COLS} FROM dbo.app_vision_event ORDER BY created_at DESC, id DESC")
        events = [_event_dict(r) for r in cur.fetchall()]
    return {"ok": True, "run": run, "instruments": instruments, "events": events}


def channel_analysis(symbol: str, timeframe: str) -> dict[str, Any] | None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT analysis_json, data_status, data_reason, bars_available, bars_required, analysed_at "
            "FROM dbo.app_vision_channel WHERE symbol=? AND timeframe=?",
            symbol, timeframe,
        )
        r = cur.fetchone()
    if not r:
        return None
    try:
        a = json.loads(r[0]) if r[0] else None
    except Exception:
        a = None
    return {"analysis": a, "dataStatus": r[1], "dataReason": r[2], "available": r[3], "required": r[4], "analysedAt": _iso(r[5])}


def load_detail(symbol: str) -> dict[str, Any]:
    ensure_vision_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            f"SELECT output_json, {_LIVE_COLS}, analysed_at, trigger_reason, duration_ms "
            "FROM dbo.app_vision_instrument WHERE symbol=?",
            symbol,
        )
        r = cur.fetchone()
        out = None
        if r:
            try:
                out = json.loads(r[0])
                out.update({"live": _live(*r[1:7]), "analysedAt": _iso(r[7]), "trigger": r[8], "durationMs": r[9]})
            except Exception:
                out = None
        cur.execute(f"SELECT TOP 200 {_EVENT_COLS} FROM dbo.app_vision_event WHERE symbol=? ORDER BY bar_ts DESC, id DESC", symbol)
        events = [_event_dict(x) for x in cur.fetchall()]
        cur.execute(
            """
            SELECT TOP 240 d1_bar_ts, h8_bar_ts, status, primary_direction, agreement, phase, confidence, d1_status,
                   d1_direction, d1_position, d1_confidence, h8_status, h8_direction, h8_position, h8_confidence,
                   trigger_reason, analysed_at
            FROM dbo.app_vision_history WHERE symbol=? ORDER BY h8_bar_ts DESC, d1_bar_ts DESC
            """,
            symbol,
        )
        cols = [c[0] for c in cur.description]
        history = []
        for x in cur.fetchall():
            d = dict(zip(cols, x))
            history.append({
                "d1BarTs": d["d1_bar_ts"], "h8BarTs": d["h8_bar_ts"], "status": d["status"], "primaryDirection": d["primary_direction"],
                "agreement": d["agreement"], "phase": d["phase"], "confidence": d["confidence"],
                "d1": {"status": d["d1_status"], "direction": d["d1_direction"], "position": d["d1_position"], "confidence": d["d1_confidence"]},
                "h8": {"status": d["h8_status"], "direction": d["h8_direction"], "position": d["h8_position"], "confidence": d["h8_confidence"]},
                "trigger": d["trigger_reason"], "analysedAt": _iso(d["analysed_at"]),
            })
    channels = {tf: channel_analysis(symbol, tf) for tf in ("D1", "H8")}
    return {"ok": True, "symbol": symbol, "instrument": out, "channels": channels, "events": events, "history": history}
