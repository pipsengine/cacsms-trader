"""Persistence for Channel Analysis: per-timeframe channel state, the coherent instrument hierarchy, lifecycle,
touches, structural events and runs.

Every analysis run rewrites all nine context rows (Y/YTD/HY/Q/MN/W/D1/H8/H1) and the instrument row in one transaction
with the same run id, so readers never combine Y from one version with H1 from another. YTD/HY rows store
source_timeframe D1 and their window bounds in snapshot_json. Other engines read the published hierarchy with
`hierarchy(symbol)` or the compact `world_rows()`.
"""

from __future__ import annotations

import json
from typing import Any

try:
    import channel_analysis as ca
    from db import ROOT, _iso, connect, set_setting
except ImportError:  # pragma: no cover
    from bridge.mt5 import channel_analysis as ca  # type: ignore
    from bridge.mt5.db import ROOT, _iso, connect, set_setting  # type: ignore

_schema_ready = False

EVENT_SEVERITY = {
    "BREAKOUT": "WARN", "FAILED_BREAKOUT": "WARN", "INVALIDATION": "WARN", "INTRABAR_BREACH": "WARN",
    "CHANNEL_LOST": "WARN", "REVERSAL_CANDIDATE": "WARN", "ANALYSIS_ERROR": "ERROR",
    "VALIDATION": "SUCCESS", "NEW_CHANNEL": "SUCCESS",
}
TIMEFRAMES = ca.TIMEFRAMES


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "013_channel_analysis.sql").read_text(encoding="utf-8")
    with connect() as conn:
        cur = conn.cursor()
        for batch in (b.strip() for b in sql.split("\nGO") if b.strip()):
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


def _loads(raw: Any, default: Any) -> Any:
    try:
        return json.loads(raw) if raw else default
    except Exception:
        return default


def _dump(value: Any) -> str:
    return json.dumps(value, default=str)


# ---------------------------------------------------------------- runs

def start_run(trigger: str, symbols: list[str], version: str) -> int:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO dbo.app_channel_run (trigger_reason, symbols_json, analysed, failed, new_events, duration_ms, config_version) "
            "OUTPUT inserted.id VALUES (?,?,0,0,0,0,?)",
            trigger[:240], _dump(symbols), version,
        )
        run_id = int(cur.fetchone()[0])
        conn.commit()
        return run_id


def finish_run(run_id: int, analysed: int, failed: int, new_events: int, duration_ms: int) -> None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE dbo.app_channel_run SET analysed=?, failed=?, new_events=?, duration_ms=? WHERE id=?",
                    analysed, failed, new_events, duration_ms, run_id)
        conn.commit()


def recent_runs(limit: int = 20) -> list[dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT TOP ({int(limit)}) id, trigger_reason, symbols_json, analysed, failed, new_events, duration_ms, config_version, run_at "
                    "FROM dbo.app_channel_run ORDER BY id DESC")
        return [{"id": int(r[0]), "trigger": r[1], "symbols": _loads(r[2], []), "analysed": r[3], "failed": r[4], "newEvents": r[5],
                 "durationMs": r[6], "configVersion": r[7], "runAt": _iso(r[8])} for r in cur.fetchall()]


def save_meta(meta: dict[str, Any]) -> None:
    set_setting("channels.last_run", _dump(meta))


# ---------------------------------------------------------------- write

_STATE_COLS = ["channel_id", "status", "direction", "phase", "relationship", "parent_timeframe", "parent_channel_id", "confidence",
               "position", "upper_now", "mid_now", "lower_now", "slope", "width", "width_atr", "touch_count", "touch_quality",
               "data_status", "data_reason", "source_timeframe", "source_bar_ts", "last_bar_ts", "run_id", "config_version", "snapshot_json"]


def _state_values(s: dict[str, Any], run_id: int) -> list[Any]:
    g = s["evidence"].get("geometry") or {}
    return [
        s.get("channelId"), s["status"], s["direction"], s.get("phase"), s["relationship"], s.get("parentTimeframe"),
        s.get("parentChannelId"), float(s.get("confidence") or 0), s.get("position"), s.get("upperBoundary"), s.get("midline"),
        s.get("lowerBoundary"), s.get("slope"), g.get("width"), g.get("widthAtr"), int(s.get("touchCount") or 0), g.get("touchQuality"),
        s["dataStatus"], (s.get("dataReason") or "")[:400], s["sourceTimeframe"], s.get("sourceBarTs"),
        int(s["lastCandleTime"] / 1000) if s.get("lastCandleTime") else None, run_id, s["configVersion"], _dump(s),
    ]


def _upsert(cur, table: str, keys: dict[str, Any], cols: list[str], values: list[Any], stamp: str | None = None) -> None:
    where = " AND ".join(f"{k}=?" for k in keys)
    cur.execute(f"SELECT 1 FROM dbo.{table} WHERE {where}", *keys.values())
    if cur.fetchone():
        sets = ", ".join(f"{c}=?" for c in cols) + (f", {stamp}=SYSUTCDATETIME()" if stamp else "")
        cur.execute(f"UPDATE dbo.{table} SET {sets} WHERE {where}", *values, *keys.values())
    else:
        all_cols = [*keys, *cols]
        cur.execute(f"INSERT INTO dbo.{table} ({', '.join(all_cols)}) VALUES ({', '.join('?' for _ in all_cols)})",
                    *keys.values(), *values)


def _insert_event(cur, symbol: str, e: dict[str, Any]) -> bool:
    key = (symbol, e["tf"], e.get("channelId") or "-", e["type"], int(e["ts"]))
    cur.execute(
        "INSERT INTO dbo.app_channel_event (symbol, timeframe, channel_id, event_type, bar_ts, price, severity, detail) "
        "SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM dbo.app_channel_event "
        "WHERE symbol=? AND timeframe=? AND channel_id=? AND event_type=? AND bar_ts=?)",
        *key[:5], e.get("price"), EVENT_SEVERITY.get(e["type"], "INFO"), (e.get("detail") or e["type"])[:600], *key,
    )
    return cur.rowcount > 0


def persist(symbol: str, channels: dict[str, dict[str, Any]], analysed: list[str], edges: list[dict[str, Any]],
            interp: dict[str, Any], version: str, events: list[dict[str, Any]], trigger: str, run_id: int) -> list[dict[str, Any]]:
    """Atomically publish one coherent hierarchy for an instrument. Returns the events that were new."""
    new: list[dict[str, Any]] = []
    with connect() as conn:
        cur = conn.cursor()
        for tf in TIMEFRAMES:
            s = channels[tf]
            _upsert(cur, "app_channel_state", {"symbol": symbol, "timeframe": tf}, _STATE_COLS, _state_values(s, run_id), "analysed_at")
        for tf in analysed:
            s = channels[tf]
            cur.execute("DELETE FROM dbo.app_channel_touch WHERE symbol=? AND timeframe=?", symbol, tf)
            for t in s["evidence"]["touches"]:
                cur.execute(
                    "INSERT INTO dbo.app_channel_touch (symbol, timeframe, channel_id, seq, boundary, role, bar_ts, price, line_price, deviation_atr) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    symbol, tf, s["channelId"], t["ordinal"], t["boundary"], t["role"], int(t["time"] / 1000), t["price"], t["line"], t["deviationAtr"],
                )
            if s.get("channelId"):
                _lifecycle(cur, symbol, tf, s)
        for e in edges:
            _upsert(cur, "app_channel_edge", {"symbol": symbol, "child_timeframe": e["child"]},
                    ["parent_timeframe", "via_timeframe", "relationship", "confidence", "explanation", "run_id"],
                    [e["parent"], e.get("via"), e["relationship"], e["confidence"], e["explanation"][:400], run_id], "analysed_at")
        _upsert(cur, "app_channel_instrument", {"symbol": symbol},
                ["run_id", "state_version", "primary_direction", "intermediate_direction", "current_direction", "market_state",
                 "structural_confidence", "alignment", "hierarchy_json", "interpretation_json", "trigger_reason"],
                [run_id, version, interp["primaryDirection"], interp["intermediateDirection"], interp["currentDirection"],
                 interp["marketState"], interp["structuralConfidence"], interp["alignmentScore"], _dump(edges), _dump(interp), trigger[:200]],
                "analysed_at")
        for e in events:
            if _insert_event(cur, symbol, e):
                new.append(e)
        conn.commit()
    return new


def _lifecycle(cur, symbol: str, tf: str, s: dict[str, Any]) -> None:
    """Append-only channel lifecycle: one row per channel id, only closure fields move."""
    life = s.get("lifecycle") or {}
    g = s["evidence"].get("geometry") or {}
    ts = lambda ms: int(ms / 1000) if ms else None  # noqa: E731
    cur.execute("SELECT id FROM dbo.app_channel_history WHERE symbol=? AND timeframe=? AND channel_id=?", symbol, tf, s["channelId"])
    row = cur.fetchone()
    if row:
        cur.execute(
            "UPDATE dbo.app_channel_history SET direction=?, last_status=?, validated_bar_ts=COALESCE(validated_bar_ts, ?), "
            "broken_bar_ts=COALESCE(broken_bar_ts, ?), invalidated_bar_ts=COALESCE(invalidated_bar_ts, ?), last_seen_at=SYSUTCDATETIME(), "
            "replaced_at=NULL WHERE id=?",
            s["direction"], s["status"], ts(life.get("validatedTime")), ts(life.get("breakoutTime")), ts(life.get("invalidatedTime")), int(row[0]),
        )
    else:
        cur.execute(
            "UPDATE dbo.app_channel_history SET replaced_at=SYSUTCDATETIME() WHERE symbol=? AND timeframe=? AND replaced_at IS NULL",
            symbol, tf,
        )
        cur.execute(
            "INSERT INTO dbo.app_channel_history (symbol, timeframe, channel_id, anchor_side, anchor_ts, direction, last_status, first_status, "
            "validated_bar_ts, broken_bar_ts, invalidated_bar_ts, config_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            symbol, tf, s["channelId"], g.get("anchorSide"), ts(life.get("anchorTime")), s["direction"], s["status"], s["status"],
            ts(life.get("validatedTime")), ts(life.get("breakoutTime")), ts(life.get("invalidatedTime")), s["configVersion"],
        )


def add_events(symbol: str, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not events:
        return []
    with connect() as conn:
        cur = conn.cursor()
        new = [e for e in events if _insert_event(cur, symbol, e)]
        conn.commit()
    return new


def update_live(rows: list[tuple[float, str]]) -> None:
    """rows: (price, symbol)."""
    if not rows:
        return
    with connect() as conn:
        cur = conn.cursor()
        for price, symbol in rows:
            cur.execute("UPDATE dbo.app_channel_instrument SET live_price=?, live_at=SYSUTCDATETIME() WHERE symbol=?", price, symbol)
        conn.commit()


# ---------------------------------------------------------------- read

def load_states() -> dict[tuple[str, str], dict[str, Any]]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol, timeframe, snapshot_json FROM dbo.app_channel_state")
        return {(s, tf): snap for s, tf, raw in cur.fetchall() if (snap := _loads(raw, None))}


def load_versions() -> dict[str, str]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol, state_version FROM dbo.app_channel_instrument")
        return {s: v for s, v in cur.fetchall()}


def hierarchy(symbol: str) -> dict[str, Any] | None:
    """Latest coherent hierarchy: the channel snapshots of one run, their edges and the interpretation.
    Every core context must be present; a context added later (YTD/HY) may be absent until its first run."""
    ensure_schema()
    for _ in range(3):
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("SELECT run_id, state_version, hierarchy_json, interpretation_json, trigger_reason, analysed_at, live_price, live_at "
                        "FROM dbo.app_channel_instrument WHERE symbol=?", symbol)
            inst = cur.fetchone()
            if not inst:
                return None
            cur.execute("SELECT timeframe, run_id, snapshot_json FROM dbo.app_channel_state WHERE symbol=?", symbol)
            rows = cur.fetchall()
        present = {r[0] for r in rows}
        if all(r[1] == inst[0] for r in rows) and set(ca.CORE_TIMEFRAMES) <= present:
            channels = {tf: _loads(raw, None) for tf, _, raw in rows}
            for tf, snap in channels.items():
                if snap is not None:
                    snap.setdefault("hierarchyRole", "CONTEXT" if tf in ca.CONTEXT_TIMEFRAMES else "CORE")
                    snap.setdefault("window", None)
            return {
                "symbol": symbol, "runId": inst[0], "stateVersion": inst[1], "hierarchy": _loads(inst[2], []),
                "interpretation": _loads(inst[3], {}), "trigger": inst[4], "analysedAt": _iso(inst[5]),
                "livePrice": inst[6], "liveAt": _iso(inst[7]),
                "channels": channels,
            }
    return None


def world_rows() -> list[dict[str, Any]]:
    """Compact per-instrument hierarchy for the Market World Model and downstream stages (no candles or evidence)."""
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol, run_id, state_version, primary_direction, intermediate_direction, current_direction, market_state, "
                    "structural_confidence, alignment, interpretation_json, analysed_at FROM dbo.app_channel_instrument")
        inst = cur.fetchall()
        ctx = "CASE WHEN timeframe IN (" + ",".join(f"'{t}'" for t in ca.CONTEXT_TIMEFRAMES) + ") THEN JSON_VALUE(snapshot_json, '$.window.{}') END"
        cur.execute("SELECT symbol, timeframe, channel_id, status, direction, relationship, parent_timeframe, parent_channel_id, confidence, "
                    "position, upper_now, mid_now, lower_now, data_status, last_bar_ts, phase, slope, source_timeframe, "
                    + ", ".join(ctx.format(k) for k in ("type", "start", "end", "bars")) +
                    " FROM dbo.app_channel_state")
        states = cur.fetchall()
    num = lambda v: int(float(v)) if v not in (None, "") else None  # noqa: E731
    by_sym: dict[str, dict[str, Any]] = {}
    for r in sorted(states, key=lambda r: ca.TIMEFRAMES.index(r[1]) if r[1] in ca.TIMEFRAMES else 99):
        row = {
            "channelId": r[2], "status": r[3], "direction": r[4], "relationship": r[5], "parentTimeframe": r[6],
            "parentChannelId": r[7], "confidence": r[8], "position": r[9], "upper": r[10], "mid": r[11], "lower": r[12],
            "dataStatus": r[13], "lastBarTs": r[14], "phase": r[15], "slope": r[16], "sourceTimeframe": r[17],
            "hierarchyRole": "CONTEXT" if r[1] in ca.CONTEXT_TIMEFRAMES else "CORE",
        }
        if r[1] in ca.CONTEXT_TIMEFRAMES:
            row.update({"contextRole": "STRATEGIC_CONTEXT", "scored": False, "weight": ca.CONFIG["tfWeight"][r[1]],
                        "windowType": r[18], "windowStart": num(r[19]), "windowEnd": num(r[20]), "windowBars": num(r[21])})
        by_sym.setdefault(r[0], {})[r[1]] = row
    out = []
    for r in inst:
        interp = _loads(r[9], {})
        out.append({
            "symbol": r[0], "runId": r[1], "stateVersion": r[2], "primaryDirection": r[3], "intermediateDirection": r[4],
            "currentDirection": r[5], "marketState": r[6], "structuralConfidence": r[7], "alignmentScore": r[8],
            "parentTimeframe": interp.get("parentTimeframe"), "parentDirection": interp.get("parentDirection"),
            "currentTimeframe": interp.get("currentTimeframe"), "correctionDepth": interp.get("correctionDepth"),
            "narrative": interp.get("narrative"), "analysedAt": _iso(r[10]), "timeframes": by_sym.get(r[0], {}),
            "hierarchy": list(ca.TIMEFRAMES), "scoredTimeframes": list(ca.CORE_TIMEFRAMES),
            "contextTimeframes": list(ca.CONTEXT_TIMEFRAMES),
        })
    return out


def recent_events(symbol: str | None = None, limit: int = 60) -> list[dict[str, Any]]:
    sql = f"SELECT TOP ({int(limit)}) id, symbol, timeframe, channel_id, event_type, bar_ts, price, severity, detail, created_at FROM dbo.app_channel_event"
    params: list[Any] = []
    if symbol:
        sql += " WHERE symbol=?"
        params.append(symbol)
    sql += " ORDER BY id DESC"
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(sql, *params)
        return [{"id": int(i), "symbol": s, "timeframe": tf, "channelId": ch, "type": typ, "ts": int(ts), "price": price,
                 "severity": sev, "detail": detail, "createdAt": _iso(created)}
                for i, s, tf, ch, typ, ts, price, sev, detail, created in cur.fetchall()]


def lifecycle(symbol: str) -> dict[str, list[dict[str, Any]]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT timeframe, channel_id, anchor_side, anchor_ts, direction, first_status, last_status, validated_bar_ts, broken_bar_ts, "
                    "invalidated_bar_ts, first_seen_at, last_seen_at, replaced_at FROM dbo.app_channel_history WHERE symbol=? ORDER BY id DESC", symbol)
        out: dict[str, list[dict[str, Any]]] = {}
        for r in cur.fetchall():
            if len(out.setdefault(r[0], [])) >= 5:
                continue
            out[r[0]].append({"channelId": r[1], "anchorSide": r[2], "anchorTs": r[3], "direction": r[4], "firstStatus": r[5],
                              "lastStatus": r[6], "validatedTs": r[7], "brokenTs": r[8], "invalidatedTs": r[9],
                              "firstSeenAt": _iso(r[10]), "lastSeenAt": _iso(r[11]), "replacedAt": _iso(r[12])})
        return out
