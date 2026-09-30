"""Persist campaign learning events. Rows are facts. They do not change production parameters."""

from __future__ import annotations

import json
from typing import Any

try:
    from db import ROOT, connect
except ImportError:  # pragma: no cover
    from bridge.mt5.db import ROOT, connect  # type: ignore

_schema_ready = False


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "016_campaign_learning.sql").read_text(encoding="utf-8")
    with connect() as conn:
        cur = conn.cursor()
        for batch in (b.strip() for b in sql.split("\nGO") if b.strip()):
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


def save_event(event: dict[str, Any]) -> bool:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM dbo.app_campaign_event WHERE event_key=?", event["eventKey"])
        if cur.fetchone():
            return False
        cur.execute(
            "INSERT INTO dbo.app_campaign_event (event_key, campaign_id, symbol, family, tit_level, kind, payload_json) VALUES (?,?,?,?,?,?,?)",
            event["eventKey"], event.get("campaignId"), event.get("instrument"), event.get("family"), event.get("TiTLevel"),
            event["kind"], json.dumps(event),
        )
        conn.commit()
    return True
