"""Persisted multi-resolution opportunity snapshot. Additive table; existing stage tables are untouched."""

from __future__ import annotations

import json
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
    sql = (ROOT / "database" / "mssql" / "015_opportunity.sql").read_text(encoding="utf-8")
    with connect() as conn:
        cur = conn.cursor()
        for batch in (b.strip() for b in sql.split("\nGO") if b.strip()):
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


def save(snapshot: dict[str, Any]) -> None:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO dbo.app_opportunity_run (summary_json, snapshot_json) VALUES (?, ?)",
            json.dumps(snapshot.get("summary") or {}),
            json.dumps(snapshot),
        )
        conn.commit()


def latest() -> dict[str, Any] | None:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT TOP 1 snapshot_json, created_at FROM dbo.app_opportunity_run ORDER BY id DESC")
        row = cur.fetchone()
    if not row:
        return None
    snap = json.loads(row[0])
    snap["savedAt"] = _iso(row[1])
    return snap
