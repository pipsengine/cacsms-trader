from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

try:
    from db import ROOT, _iso, connect
except ImportError:  # pragma: no cover
    from bridge.mt5.db import ROOT, _iso, connect  # type: ignore

_schema_ready = False


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "022_ai_chart_analysis.sql").read_text(encoding="utf-8")
    with connect() as conn:
        cur = conn.cursor()
        for batch in (b.strip() for b in sql.split("\nGO") if b.strip()):
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


def _j(value: Any) -> str:
    return json.dumps(value, default=str)


def _now() -> str:
    return _iso(datetime.now(timezone.utc))


def next_analysis_id(symbol: str) -> str:
    ensure_schema()
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    day_key = day
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT next_seq FROM dbo.app_ai_analysis_seq WHERE day_key=?", day_key)
        row = cur.fetchone()
        seq = int(row[0]) + 1 if row else 1
        if row:
            cur.execute("UPDATE dbo.app_ai_analysis_seq SET next_seq=? WHERE day_key=?", seq, day_key)
        else:
            cur.execute("INSERT INTO dbo.app_ai_analysis_seq (day_key, next_seq) VALUES (?, ?)", day_key, seq)
        conn.commit()
    return f"ACA-{symbol}-{day}-{seq:06d}"


def save_run(payload: dict[str, Any], chart_snapshot: dict[str, Any] | None = None) -> str:
    ensure_schema()
    aid = payload["analysisId"]
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO dbo.app_ai_analysis_run
            (analysis_id, symbol, created_at, analysis_timestamp, last_closed_candle_json, engine_version,
             ai_version, opportunity_version, analysis_mode, primary_tf, status, direction, market_state,
             opportunity_type, confidence, tradable, execution_authorized, p1_state, p2_state, data_mode,
             snapshot_json, chart_snapshot_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                aid,
                payload["symbol"],
                _now(),
                payload.get("analysisTimestamp") or _now(),
                _j(payload.get("lastClosedCandle") or {}),
                payload.get("engineVersion"),
                payload.get("aiVersion"),
                payload.get("opportunityVersion"),
                payload.get("analysisMode"),
                payload.get("primaryTimeframe"),
                payload.get("status"),
                payload.get("direction"),
                payload.get("marketState"),
                payload.get("opportunity"),
                payload.get("confidence"),
                1 if payload.get("tradable") else 0,
                1 if payload.get("executionAuthorized") else 0,
                payload.get("p1State"),
                payload.get("p2State"),
                payload.get("dataMode") or "LIVE",
                _j(payload),
                _j(chart_snapshot) if chart_snapshot else None,
            ),
        )
        for ev in payload.get("timeline") or []:
            cur.execute(
                """INSERT INTO dbo.app_ai_analysis_event
                (analysis_id, event_ts, kind, detail, state_json) VALUES (?,?,?,?,?)""",
                (aid, ev.get("timestamp") or _now(), ev.get("kind") or "NOTE", ev.get("detail"), _j(ev.get("state")) if ev.get("state") else None),
            )
        conn.commit()
    return aid


def latest_for_symbol(symbol: str) -> dict[str, Any] | None:
    ensure_schema()
    symbol = symbol.upper()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT analysis_id, snapshot_json, chart_snapshot_json, created_at
               FROM dbo.app_ai_analysis_run WHERE symbol=? ORDER BY created_at DESC LIMIT 1""",
            (symbol,),
        )
        row = cur.fetchone()
        if not row:
            return None
        snap = json.loads(row[1])
        snap["analysisId"] = row[0]
        if row[2]:
            chart = json.loads(row[2])
            snap.setdefault("chart", chart)
            snap["historicalChart"] = chart
        snap["persistedAt"] = row[3]
        return snap


def get_run(analysis_id: str) -> dict[str, Any] | None:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT snapshot_json, chart_snapshot_json FROM dbo.app_ai_analysis_run WHERE analysis_id=?", analysis_id)
        row = cur.fetchone()
        if not row:
            return None
        snap = json.loads(row[0])
        if row[1]:
            snap["historicalChart"] = json.loads(row[1])
        cur.execute(
            "SELECT event_ts, kind, detail, state_json FROM dbo.app_ai_analysis_event WHERE analysis_id=? ORDER BY id",
            analysis_id,
        )
        snap["timelineEvents"] = [
            {"timestamp": r[0], "kind": r[1], "detail": r[2], "state": json.loads(r[3]) if r[3] else None}
            for r in cur.fetchall()
        ]
        cur.execute("SELECT outcome, recorded_at, detail FROM dbo.app_ai_analysis_outcome WHERE analysis_id=?", analysis_id)
        oc = cur.fetchone()
        if oc:
            snap["outcome"] = {"outcome": oc[0], "recordedAt": oc[1], "detail": oc[2]}
        return snap


def library_query(filters: dict[str, Any]) -> dict[str, Any]:
    ensure_schema()
    clauses = ["1=1"]
    params: list[Any] = []
    if filters.get("symbol"):
        clauses.append("symbol=?")
        params.append(filters["symbol"].upper())
    if filters.get("status"):
        clauses.append("status=?")
        params.append(filters["status"])
    if filters.get("direction"):
        clauses.append("direction=?")
        params.append(filters["direction"])
    if filters.get("analysisId"):
        clauses.append("analysis_id=?")
        params.append(filters["analysisId"])
    where = " AND ".join(clauses)
    limit = min(int(filters.get("limit") or 100), 500)
    offset = max(int(filters.get("offset") or 0), 0)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM dbo.app_ai_analysis_run WHERE {where}", tuple(params))
        total = int(cur.fetchone()[0])
        cur.execute(
            f"""SELECT analysis_id, symbol, created_at, direction, opportunity_type, market_state,
                primary_tf, confidence, status, tradable, p1_state, p2_state, snapshot_json
                FROM dbo.app_ai_analysis_run WHERE {where} ORDER BY created_at DESC LIMIT ? OFFSET ?""",
            tuple(params + [limit, offset]),
        )
        rows = []
        for r in cur.fetchall():
            snap = json.loads(r[12]) if r[12] else {}
            rows.append(
                {
                    "analysisId": r[0],
                    "symbol": r[1],
                    "timestamp": r[2],
                    "direction": r[3],
                    "opportunity": r[4],
                    "marketState": r[5],
                    "htf": snap.get("htf") or "D1",
                    "setupTf": snap.get("setupTimeframe") or r[6],
                    "entryTf": snap.get("entryTimeframe") or "M15",
                    "confidence": r[7],
                    "status": r[8],
                    "tradable": bool(r[9]),
                    "p1": r[10],
                    "p2": r[11],
                    "outcome": (snap.get("outcome") or {}).get("outcome"),
                }
            )
        cur.execute("SELECT status, COUNT(*) FROM dbo.app_ai_analysis_run GROUP BY status")
        by_status = {r[0]: r[1] for r in cur.fetchall()}
    summary = {
        "total": total,
        "active": sum(v for k, v in by_status.items() if k not in ("COMPLETED", "EXPIRED", "INVALIDATED")),
        "watching": by_status.get("WATCHING", 0),
        "confirmed": by_status.get("CONFIRMED", 0),
        "invalidated": by_status.get("INVALIDATED", 0),
        "expired": by_status.get("EXPIRED", 0),
        "completed": by_status.get("COMPLETED", 0),
    }
    return {"ok": True, "summary": summary, "rows": rows, "total": total, "limit": limit, "offset": offset}
