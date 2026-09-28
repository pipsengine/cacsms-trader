"""SQL Server access for Stage 1 historical data: candles, series checkpoints, job queue, audit events."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Iterable

try:
    from db import ROOT, _iso, connect
except ImportError:  # pragma: no cover
    from bridge.mt5.db import ROOT, _iso, connect  # type: ignore

OPEN_JOB_STATES = ("QUEUED", "RUNNING", "VALIDATING", "RETRYING", "BLOCKED")

_schema_ready = False


def ensure_history_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "004_historical_data.sql").read_text(encoding="utf-8")
    batches = [b.strip() for b in sql.split("\nGO") if b.strip()]
    with connect() as conn:
        cur = conn.cursor()
        for batch in batches:
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


# ---------------------------------------------------------------- candles

def candle_stats_all() -> dict[tuple[str, str], tuple[int, int | None, int | None]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT symbol, timeframe, COUNT_BIG(*), MIN(open_ts), MAX(open_ts) FROM dbo.app_candles GROUP BY symbol, timeframe"
        )
        return {(s, tf): (int(n), mn, mx) for s, tf, n, mn, mx in cur.fetchall()}


def candle_stats(symbol: str, timeframe: str) -> tuple[int, int | None, int | None]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT_BIG(*), MIN(open_ts), MAX(open_ts) FROM dbo.app_candles WHERE symbol=? AND timeframe=?",
            symbol,
            timeframe,
        )
        n, mn, mx = cur.fetchone()
        return int(n), mn, mx


def candle_ohlc(symbol: str, timeframe: str, from_ts: int | None = None, to_ts: int | None = None) -> list[tuple]:
    """(ts, open, high, low, close) ordered by time."""
    sql = "SELECT open_ts, [open], high, low, [close] FROM dbo.app_candles WHERE symbol=? AND timeframe=?"
    params: list[Any] = [symbol, timeframe]
    if from_ts is not None:
        sql += " AND open_ts >= ?"
        params.append(int(from_ts))
    if to_ts is not None:
        sql += " AND open_ts < ?"
        params.append(int(to_ts))
    sql += " ORDER BY open_ts"
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(sql, *params)
        return [tuple(r) for r in cur.fetchall()]


def candle_tail(symbol: str, timeframe: str, n: int) -> list[tuple]:
    """Latest `n` stored closed candles (ts, open, high, low, close), ascending."""
    n = max(1, min(int(n), 10000))
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            f"SELECT TOP ({n}) open_ts, [open], high, low, [close] FROM dbo.app_candles "
            "WHERE symbol=? AND timeframe=? ORDER BY open_ts DESC",
            symbol,
            timeframe,
        )
        rows = [tuple(r) for r in cur.fetchall()]
    rows.reverse()
    return rows


def candle_full(symbol: str, timeframe: str, from_ts: int, to_ts: int) -> list[tuple]:
    """(ts, open, high, low, close, tick_volume, spread) in [from_ts, to_ts)."""
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT open_ts, [open], high, low, [close], tick_volume, spread FROM dbo.app_candles
            WHERE symbol=? AND timeframe=? AND open_ts >= ? AND open_ts < ? ORDER BY open_ts
            """,
            symbol,
            timeframe,
            int(from_ts),
            int(to_ts),
        )
        return [tuple(r) for r in cur.fetchall()]


def candle_times_by_symbol(timeframe: str) -> dict[str, list[int]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol, open_ts FROM dbo.app_candles WHERE timeframe=? ORDER BY symbol, open_ts", timeframe)
        out: dict[str, list[int]] = {}
        for s, ts in cur.fetchall():
            out.setdefault(s, []).append(int(ts))
        return out


def candle_page(symbol: str, timeframe: str, limit: int = 200, before_ts: int | None = None) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 2000))
    sql = (
        f"SELECT TOP ({limit}) open_ts, [open], high, low, [close], tick_volume, spread, source, ingested_at, revised_at "
        "FROM dbo.app_candles WHERE symbol=? AND timeframe=?"
    )
    params: list[Any] = [symbol, timeframe]
    if before_ts is not None:
        sql += " AND open_ts < ?"
        params.append(int(before_ts))
    sql += " ORDER BY open_ts DESC"
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(sql, *params)
        rows = [
            {
                "ts": int(ts), "open": o, "high": h, "low": lo, "close": c, "volume": int(v or 0),
                "spread": sp, "source": src, "ingestedAt": _iso(ing), "revisedAt": _iso(rev),
            }
            for ts, o, h, lo, c, v, sp, src, ing, rev in cur.fetchall()
        ]
    rows.reverse()
    return rows


def upsert_candles(symbol: str, timeframe: str, rows: list[tuple], source: str) -> tuple[int, int]:
    """Idempotent write of validated closed candles. Returns (inserted, revised).

    rows: (ts, open, high, low, close, tick_volume, spread). Existing identical rows are untouched;
    broker corrections to OHLC are applied and stamped with revised_at for audit.
    """
    if not rows:
        return 0, 0
    with connect() as conn:
        cur = conn.cursor()
        params = [(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), int(r[5] or 0), int(r[6]) if r[6] is not None else None) for r in rows]
        inserted = revised = 0
        for ts, o, h, lo, close, volume, spread in params:
            cur.execute("SELECT [open],high,low,[close] FROM dbo.app_candles WHERE symbol=? AND timeframe=? AND open_ts=?", symbol, timeframe, ts)
            prior = cur.fetchone()
            if prior is None:
                cur.execute("INSERT INTO dbo.app_candles (symbol,timeframe,open_ts,[open],high,low,[close],tick_volume,spread,source) VALUES (?,?,?,?,?,?,?,?,?,?)",
                            symbol, timeframe, ts, o, h, lo, close, volume, spread, source)
                inserted += 1
            elif tuple(float(x) for x in prior) != (o, h, lo, close):
                cur.execute("UPDATE dbo.app_candles SET [open]=?,high=?,low=?,[close]=?,tick_volume=?,spread=?,source=?,revised_at=CURRENT_TIMESTAMP WHERE symbol=? AND timeframe=? AND open_ts=?",
                            o, h, lo, close, volume, spread, source, symbol, timeframe, ts)
                revised += 1
        conn.commit()
    return inserted, revised


# ---------------------------------------------------------------- series checkpoints

_SERIES_COLS = [
    "symbol", "timeframe", "status", "reason", "candle_count", "earliest_ts", "latest_ts", "provider_latest_ts",
    "required_depth", "min_required", "provider_depth", "provider_exhausted", "completeness", "quality_score",
    "integrity_errors", "missing_bars", "gaps_json", "provider_gaps_json", "issues_json", "source", "source_note",
    "last_sync_at", "last_success_at", "last_validated_at", "last_repair_at", "last_error", "updated_at",
]


def series_all() -> dict[tuple[str, str], dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT {', '.join(_SERIES_COLS)} FROM dbo.app_hist_series")
        out = {}
        for raw in cur.fetchall():
            d = dict(zip(_SERIES_COLS, raw))
            for key in ("last_sync_at", "last_success_at", "last_validated_at", "last_repair_at", "updated_at"):
                if isinstance(d.get(key), str):
                    d[key] = datetime.fromisoformat(d[key].replace("Z", "+00:00")).replace(tzinfo=None)
            out[(d["symbol"], d["timeframe"])] = d
        return out


def series_upsert(d: dict[str, Any], insert_defaults: dict[str, Any] | None = None) -> None:
    """Partial update; `insert_defaults` only apply when the series row does not exist yet."""
    cols = [c for c in _SERIES_COLS if c not in ("symbol", "timeframe", "updated_at") and c in d]
    extra = {k: v for k, v in (insert_defaults or {}).items() if k not in d and k in _SERIES_COLS}
    insert_cols = ["symbol", "timeframe", *cols, *extra]
    insert_vals = [d["symbol"], d["timeframe"], *[d[c] for c in cols], *extra.values()]
    matched = f"WHEN MATCHED THEN UPDATE SET {', '.join(f'{c}=?' for c in cols)}, updated_at=SYSUTCDATETIME()" if cols else ""
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            MERGE dbo.app_hist_series AS t
            USING (SELECT ? AS symbol, ? AS timeframe) AS s ON t.symbol=s.symbol AND t.timeframe=s.timeframe
            {matched}
            WHEN NOT MATCHED THEN INSERT ({', '.join(insert_cols)}) VALUES ({', '.join('?' for _ in insert_cols)});
            """,
            d["symbol"], d["timeframe"], *[d[c] for c in cols], *insert_vals,
        )
        conn.commit()


def series_mark_all(status: str, reason: str, timeframes: Iterable[str]) -> int:
    tfs = list(timeframes)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE dbo.app_hist_series SET status=?, reason=?, updated_at=SYSUTCDATETIME() "
            f"WHERE timeframe IN ({', '.join('?' for _ in tfs)})",
            status, reason, *tfs,
        )
        n = cur.rowcount
        conn.commit()
        return n


def series_dict(d: dict[str, Any]) -> dict[str, Any]:
    def load(v: Any) -> Any:
        try:
            return json.loads(v) if v else []
        except Exception:
            return []

    return {
        "symbol": d["symbol"], "timeframe": d["timeframe"], "status": d["status"], "reason": d["reason"],
        "count": int(d["candle_count"] or 0), "earliestTs": d["earliest_ts"], "latestTs": d["latest_ts"],
        "providerLatestTs": d["provider_latest_ts"], "requiredDepth": d["required_depth"], "minRequired": d["min_required"],
        "providerDepth": d["provider_depth"], "providerExhausted": bool(d["provider_exhausted"]),
        "completeness": d["completeness"], "quality": d["quality_score"], "integrityErrors": int(d["integrity_errors"] or 0),
        "missingBars": int(d["missing_bars"] or 0), "gaps": load(d["gaps_json"]), "providerGaps": load(d["provider_gaps_json"]),
        "issues": load(d["issues_json"]), "source": d["source"], "sourceNote": d["source_note"],
        "lastSyncAt": _iso(d["last_sync_at"]), "lastSuccessAt": _iso(d["last_success_at"]),
        "lastValidatedAt": _iso(d["last_validated_at"]), "lastRepairAt": _iso(d["last_repair_at"]),
        "lastError": d["last_error"], "updatedAt": _iso(d["updated_at"]),
    }


# ---------------------------------------------------------------- job queue

_JOB_COLS = [
    "id", "job_type", "symbol", "timeframe", "trigger_source", "priority", "state", "attempts", "max_attempts",
    "fetched", "inserted", "revised", "checkpoint_ts", "message", "created_at", "started_at", "finished_at", "next_attempt_at",
]


def _job_dict(d: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(d["id"]), "type": d["job_type"], "symbol": d["symbol"], "timeframe": d["timeframe"],
        "trigger": d["trigger_source"], "priority": d["priority"], "state": d["state"], "attempts": d["attempts"],
        "maxAttempts": d["max_attempts"], "fetched": d["fetched"], "inserted": d["inserted"], "revised": d["revised"],
        "checkpointTs": d["checkpoint_ts"], "message": d["message"], "createdAt": _iso(d["created_at"]),
        "startedAt": _iso(d["started_at"]), "finishedAt": _iso(d["finished_at"]), "nextAttemptAt": _iso(d["next_attempt_at"]),
    }


def job_enqueue(job_type: str, symbol: str, timeframe: str, trigger: str, priority: int, message: str | None = None) -> int | None:
    """Duplicate-safe: an open job of the same type for the series is reused (priority raised if needed)."""
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT TOP 1 id, priority FROM dbo.app_hist_job WITH (UPDLOCK, HOLDLOCK)
            WHERE symbol=? AND timeframe=? AND job_type=? AND state IN ({', '.join('?' for _ in OPEN_JOB_STATES)})
            ORDER BY id
            """,
            symbol, timeframe, job_type, *OPEN_JOB_STATES,
        )
        row = cur.fetchone()
        if row:
            if priority < int(row[1]):
                cur.execute("UPDATE dbo.app_hist_job SET priority=? WHERE id=?", priority, int(row[0]))
            conn.commit()
            return None
        cur.execute(
            """
            INSERT INTO dbo.app_hist_job (job_type, symbol, timeframe, trigger_source, priority, state, message)
            OUTPUT inserted.id VALUES (?,?,?,?,?,N'QUEUED',?)
            """,
            job_type, symbol, timeframe, trigger, priority, message,
        )
        new_id = int(cur.fetchone()[0])
        conn.commit()
        return new_id


def job_claim() -> dict[str, Any] | None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM dbo.app_hist_job WHERE state IN ('QUEUED','RETRYING') AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP) ORDER BY priority,id LIMIT 1")
        found = cur.fetchone()
        row = None
        if found:
            cur.execute("UPDATE dbo.app_hist_job SET state='RUNNING',started_at=CURRENT_TIMESTAMP,attempts=attempts+1,finished_at=NULL WHERE id=?", found[0])
            cur.execute(f"SELECT {', '.join(_JOB_COLS)} FROM dbo.app_hist_job WHERE id=?", found[0])
            row = cur.fetchone()
        conn.commit()
        return dict(zip(_JOB_COLS, row)) if row else None


def job_update(job_id: int, **fields: Any) -> None:
    """Plain column updates, plus `finished=True` and `next_attempt_in=<seconds>` helpers."""
    sets, params = [], []
    for k, v in fields.items():
        if k == "finished":
            if v:
                sets.append("finished_at=SYSUTCDATETIME()")
        elif k == "next_attempt_in":
            sets.append("next_attempt_at=DATEADD(SECOND, ?, SYSUTCDATETIME())")
            params.append(int(v))
        else:
            sets.append(f"{k}=?")
            params.append(v)
    if not sets:
        return
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"UPDATE dbo.app_hist_job SET {', '.join(sets)} WHERE id=?", *params, job_id)
        conn.commit()


def jobs_transition(from_states: Iterable[str], to_state: str, message: str) -> int:
    states = list(from_states)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE dbo.app_hist_job SET state=?, message=? WHERE state IN ({', '.join('?' for _ in states)})",
            to_state, message, *states,
        )
        n = cur.rowcount
        conn.commit()
        return n


def jobs_recent(limit: int = 60, symbol: str | None = None, timeframe: str | None = None) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 500))
    sql = f"SELECT TOP ({limit}) {', '.join(_JOB_COLS)} FROM dbo.app_hist_job"
    params: list[Any] = []
    if symbol:
        sql += " WHERE symbol=?" + (" AND timeframe=?" if timeframe else "")
        params.append(symbol)
        if timeframe:
            params.append(timeframe)
    sql += " ORDER BY id DESC"
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(sql, *params)
        return [_job_dict(dict(zip(_JOB_COLS, r))) for r in cur.fetchall()]


def jobs_open() -> list[dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            f"SELECT {', '.join(_JOB_COLS)} FROM dbo.app_hist_job WHERE state IN ({', '.join('?' for _ in OPEN_JOB_STATES)}) ORDER BY priority, id",
            *OPEN_JOB_STATES,
        )
        return [_job_dict(dict(zip(_JOB_COLS, r))) for r in cur.fetchall()]


def job_counts(hours: int = 24) -> dict[str, int]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT state, COUNT(*) FROM dbo.app_hist_job
            WHERE state IN ({', '.join('?' for _ in OPEN_JOB_STATES)}) OR created_at >= DATEADD(HOUR, ?, SYSUTCDATETIME())
            GROUP BY state
            """,
            *OPEN_JOB_STATES, -int(hours),
        )
        return {s: int(n) for s, n in cur.fetchall()}


def jobs_prune(days: int = 30) -> int:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM dbo.app_hist_job WHERE state IN (N'COMPLETED', N'STALE') AND created_at < DATEADD(DAY, ?, SYSUTCDATETIME())",
            -int(days),
        )
        n = cur.rowcount
        conn.commit()
        return n


# ---------------------------------------------------------------- audit / workflow events

def event_add(kind: str, severity: str, message: str, symbol: str | None = None, timeframe: str | None = None,
              job_id: int | None = None, detail: dict[str, Any] | None = None) -> int:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.app_hist_event (kind, severity, symbol, timeframe, job_id, message, detail_json)
            OUTPUT inserted.id VALUES (?,?,?,?,?,?,?)
            """,
            kind, severity, symbol, timeframe, job_id, message[:800], json.dumps(detail, default=str) if detail else None,
        )
        new_id = int(cur.fetchone()[0])
        conn.commit()
        return new_id


def events_after(after_id: int = 0, limit: int = 200) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 1000))
    with connect() as conn:
        cur = conn.cursor()
        if after_id > 0:
            cur.execute(
                f"SELECT TOP ({limit}) id, at, kind, severity, symbol, timeframe, job_id, message, detail_json "
                "FROM dbo.app_hist_event WHERE id > ? ORDER BY id",
                int(after_id),
            )
            rows = cur.fetchall()
        else:
            cur.execute(
                f"SELECT TOP ({limit}) id, at, kind, severity, symbol, timeframe, job_id, message, detail_json "
                "FROM dbo.app_hist_event ORDER BY id DESC"
            )
            rows = list(reversed(cur.fetchall()))
    out = []
    for i, at, kind, sev, sym, tf, job, msg, detail in rows:
        try:
            parsed = json.loads(detail) if detail else None
        except Exception:
            parsed = None
        out.append({
            "id": int(i), "at": _iso(at), "kind": kind, "severity": sev, "symbol": sym, "timeframe": tf,
            "jobId": job, "message": msg, "detail": parsed,
        })
    return out
