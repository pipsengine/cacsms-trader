"""SQLite persistence for Economic Intelligence. Revisions are appended; evidence is not overwritten in place."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

try:
    from db import ROOT, _iso, connect
except ImportError:  # pragma: no cover
    from bridge.mt5.db import ROOT, _iso, connect  # type: ignore

import economic as econ

_schema_ready = False


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "014_economic_intelligence.sql").read_text(encoding="utf-8")
    with connect() as conn:
        cur = conn.cursor()
        for batch in (b.strip() for b in sql.split("\nGO") if b.strip()):
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


def _loads(raw: Any, fallback: Any) -> Any:
    if raw in (None, ""):
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def load_policy() -> dict[str, Any]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT policy_json FROM dbo.app_econ_policy WHERE id=1")
        row = cur.fetchone()
    if not row:
        policy = dict(econ.DEFAULT_POLICY)
        if econ.development_mode():
            policy["developmentSample"] = True
        save_policy(policy)
        return policy
    stored = _loads(row[0], {})
    return econ.sanitize_policy(stored, dict(econ.DEFAULT_POLICY))


def save_policy(policy: dict[str, Any]) -> dict[str, Any]:
    ensure_schema()
    clean = econ.sanitize_policy(policy, dict(econ.DEFAULT_POLICY))
    raw = json.dumps(clean)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM dbo.app_econ_policy WHERE id=1")
        if cur.fetchone():
            cur.execute("UPDATE dbo.app_econ_policy SET policy_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=1", raw)
        else:
            cur.execute("INSERT INTO dbo.app_econ_policy (id, policy_json) VALUES (1, ?)", raw)
        conn.commit()
    return clean


def replace_events(events: list[dict[str, Any]], source_mode: str) -> list[str]:
    """Upsert the current window. A changed actual/forecast/status writes a revision instead of destroying the prior reading."""
    ensure_schema()
    changed: list[str] = []
    now_ids = [e["id"] for e in events]
    with connect() as conn:
        cur = conn.cursor()
        for event in events:
            cur.execute("SELECT revision, actual, forecast, previous, status, surprise_json FROM dbo.app_econ_event WHERE event_id=?", event["id"])
            prev = cur.fetchone()
            surprise = json.dumps(event.get("surprise")) if event.get("surprise") is not None else None
            if not prev:
                cur.execute(
                    "INSERT INTO dbo.app_econ_event (event_id, provider_key, scheduled_at, currency, country, title, impact, series_kind, unit, "
                    "actual, forecast, previous, status, surprise_json, source_mode, revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
                    event["id"], event["providerKey"], event["scheduledAt"], event["currency"], event["country"], event["title"],
                    event["impact"], event["seriesKind"], event.get("unit"), event.get("actual"), event.get("forecast"), event.get("previous"),
                    event["status"], surprise, source_mode,
                )
                cur.execute("INSERT INTO dbo.app_econ_revision (event_id, revision, payload_json) VALUES (?,?,?)", event["id"], 1, json.dumps(event))
                changed.append(event["id"])
                continue
            same = (prev[1], prev[2], prev[3], prev[4], prev[5]) == (event.get("actual"), event.get("forecast"), event.get("previous"), event["status"], surprise)
            if same:
                continue
            revision = int(prev[0]) + 1
            cur.execute(
                "UPDATE dbo.app_econ_event SET actual=?, forecast=?, previous=?, status=?, surprise_json=?, source_mode=?, revision=?, updated_at=CURRENT_TIMESTAMP WHERE event_id=?",
                event.get("actual"), event.get("forecast"), event.get("previous"), event["status"], surprise, source_mode, revision, event["id"],
            )
            cur.execute("INSERT INTO dbo.app_econ_revision (event_id, revision, payload_json) VALUES (?,?,?)", event["id"], revision, json.dumps(event))
            changed.append(event["id"])
        if source_mode != "DEVELOPMENT":
            cur.execute("DELETE FROM dbo.app_econ_event WHERE source_mode='DEVELOPMENT'")
        elif now_ids:
            marks = ",".join("?" for _ in now_ids)
            cur.execute(f"DELETE FROM dbo.app_econ_event WHERE source_mode='DEVELOPMENT' AND event_id NOT IN ({marks})", now_ids)
        conn.commit()
    return changed


def clear_events() -> None:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM dbo.app_econ_event")
        conn.commit()


def load_events() -> list[dict[str, Any]]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT event_id, scheduled_at, currency, country, title, impact, series_kind, unit, actual, forecast, previous, status, "
            "surprise_json, source_mode, revision FROM dbo.app_econ_event ORDER BY scheduled_at"
        )
        rows = cur.fetchall()
    out = []
    for r in rows:
        out.append({
            "id": r[0], "scheduledAt": _iso(r[1]) or str(r[1]), "currency": r[2], "country": r[3], "title": r[4],
            "impact": r[5], "seriesKind": r[6], "unit": r[7], "actual": r[8], "forecast": r[9], "previous": r[10],
            "status": r[11], "surprise": _loads(r[12], None), "sourceMode": r[13], "revision": int(r[14]),
        })
    return out


def save_instruments(rows: list[dict[str, Any]]) -> None:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        for row in rows:
            cur.execute("SELECT 1 FROM dbo.app_econ_instrument WHERE symbol=?", row["symbol"])
            values = (
                row["state"], row.get("activeEventId"), row.get("currency"), row.get("impact"), row.get("minutesToEvent"),
                row.get("surprise"), row["spreadCondition"], row["volatilityCondition"], row["restriction"],
                1 if row["blocksNewEntries"] else 0, 1 if row["revalidationRequired"] else 0, row["reason"][:400],
                json.dumps(row.get("detail") or {}), row["symbol"],
            )
            if cur.fetchone():
                cur.execute(
                    "UPDATE dbo.app_econ_instrument SET state=?, active_event_id=?, currency=?, impact=?, minutes_to_event=?, surprise=?, "
                    "spread_condition=?, volatility_condition=?, restriction=?, blocks_new=?, revalidation_required=?, reason=?, detail_json=?, "
                    "updated_at=CURRENT_TIMESTAMP WHERE symbol=?",
                    values,
                )
            else:
                cur.execute(
                    "INSERT INTO dbo.app_econ_instrument (state, active_event_id, currency, impact, minutes_to_event, surprise, spread_condition, "
                    "volatility_condition, restriction, blocks_new, revalidation_required, reason, detail_json, symbol) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    values,
                )
        conn.commit()


def load_instruments() -> list[dict[str, Any]]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT symbol, state, active_event_id, currency, impact, minutes_to_event, surprise, spread_condition, volatility_condition, "
            "restriction, blocks_new, revalidation_required, reason, detail_json, updated_at FROM dbo.app_econ_instrument ORDER BY symbol"
        )
        rows = cur.fetchall()
    return [{
        "symbol": r[0], "state": r[1], "activeEventId": r[2], "currency": r[3], "impact": r[4],
        "minutesToEvent": r[5], "surprise": r[6], "spreadCondition": r[7], "volatilityCondition": r[8],
        "restriction": r[9], "blocksNewEntries": bool(r[10]), "revalidationRequired": bool(r[11]),
        "reason": r[12], "detail": _loads(r[13], {}), "updatedAt": _iso(r[14]),
    } for r in rows]


def gate_map() -> dict[str, dict[str, Any]]:
    """Authoritative new-entry gate consumed by Stage 8. Missing rows fail closed."""
    rows = {r["symbol"]: r for r in load_instruments()}
    out = {}
    for symbol in econ.UNIVERSE:
        row = rows.get(symbol)
        if not row:
            out[symbol] = {"blocks": True, "code": "ECON_UNKNOWN", "reason": "Economic risk state cannot be determined — new entries fail closed",
                           "action": "BLOCK_NEW_ENTRY", "factor": 1.0}
            continue
        factor = 1.0
        if row["restriction"] == "REDUCE_RISK":
            factor = float((row.get("detail") or {}).get("riskReductionFactor") or 0.5)
        code = "ECON_SOURCE" if row["blocksNewEntries"] and row["restriction"] not in ("BLOCK_NEW_ENTRY", "REVALIDATE") else (
            "ECON_REVALIDATE" if row["revalidationRequired"] else "ECON_EVENT_GATE")
        out[symbol] = {
            "blocks": row["blocksNewEntries"], "code": code, "reason": row["reason"], "action": row["restriction"],
            "factor": factor, "state": row["state"],
        }
    return out


def save_engine(state: str, source_mode: str, reason: str, detail: dict[str, Any]) -> None:
    ensure_schema()
    raw = json.dumps(detail)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM dbo.app_econ_engine WHERE id=1")
        if cur.fetchone():
            cur.execute("UPDATE dbo.app_econ_engine SET state=?, source_mode=?, reason=?, heartbeat_at=CURRENT_TIMESTAMP, detail_json=? WHERE id=1",
                        state, source_mode, reason[:400], raw)
        else:
            cur.execute("INSERT INTO dbo.app_econ_engine (id, state, source_mode, reason, heartbeat_at, detail_json) VALUES (1,?,?,?,CURRENT_TIMESTAMP,?)",
                        state, source_mode, reason[:400], raw)
        conn.commit()


def load_engine() -> dict[str, Any]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT state, source_mode, reason, heartbeat_at, detail_json FROM dbo.app_econ_engine WHERE id=1")
        row = cur.fetchone()
    if not row:
        return {"state": "NORMAL", "sourceMode": "UNCONFIGURED", "reason": "DATA SOURCE NOT CONFIGURED", "heartbeatAt": None, "detail": {}}
    return {"state": row[0], "sourceMode": row[1], "reason": row[2], "heartbeatAt": _iso(row[3]), "detail": _loads(row[4], {})}


def audit(event_type: str, detail: str, *, event_id: str | None = None, symbol: str | None = None,
          severity: str = "INFO", payload: dict[str, Any] | None = None) -> int:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO dbo.app_econ_audit (event_type, event_id, symbol, severity, detail, payload_json) VALUES (?,?,?,?,?,?)",
            event_type, event_id, symbol, severity, detail[:400], json.dumps(payload) if payload else None,
        )
        conn.commit()
        cur.execute("SELECT last_insert_rowid()")
        return int(cur.fetchone()[0])


def recent_audit(limit: int = 80) -> list[dict[str, Any]]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT id, event_type, event_id, symbol, severity, detail, payload_json, created_at FROM dbo.app_econ_audit ORDER BY id DESC LIMIT {int(limit)}")
        rows = cur.fetchall()
    return [{
        "id": int(r[0]), "type": r[1], "eventId": r[2], "symbol": r[3], "severity": r[4], "detail": r[5],
        "payload": _loads(r[6], None), "createdAt": _iso(r[7]),
    } for r in rows]


def record_outcome(event_id: str, symbol: str, outcome: dict[str, Any]) -> None:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM dbo.app_econ_outcome WHERE event_id=? AND symbol=?", event_id, symbol)
        if cur.fetchone():
            return
        cur.execute("INSERT INTO dbo.app_econ_outcome (event_id, symbol, outcome_json, published) VALUES (?,?,?,0)",
                    event_id, symbol, json.dumps(outcome))
        conn.commit()


def unpublished_outcomes(limit: int = 40) -> list[dict[str, Any]]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT id, event_id, symbol, outcome_json FROM dbo.app_econ_outcome WHERE published=0 ORDER BY id LIMIT {int(limit)}")
        rows = cur.fetchall()
    return [{"id": int(r[0]), "eventId": r[1], "symbol": r[2], "outcome": _loads(r[3], {})} for r in rows]


def mark_outcomes_published(ids: list[int]) -> None:
    if not ids:
        return
    ensure_schema()
    marks = ",".join("?" for _ in ids)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"UPDATE dbo.app_econ_outcome SET published=1 WHERE id IN ({marks})", ids)
        conn.commit()


def history_summary() -> list[dict[str, Any]]:
    """Completed-event diagnostics. A thin sample stays labeled; nothing here changes live parameters."""
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT event_id, symbol, outcome_json FROM dbo.app_econ_outcome ORDER BY id DESC LIMIT 400")
        rows = cur.fetchall()
    groups: dict[str, dict[str, Any]] = {}
    for event_id, symbol, raw in rows:
        doc = _loads(raw, {})
        key = str(doc.get("eventKey") or event_id)
        bucket = groups.setdefault(key, {"eventKey": key, "currency": doc.get("currency"), "title": doc.get("title"), "samples": 0,
                                          "move5": [], "move15": [], "move30": [], "move1h": [], "spread": [], "bias": []})
        bucket["samples"] += 1
        for name, field in (("move5", "move5m"), ("move15", "move15m"), ("move30", "move30m"), ("move1h", "move1h")):
            if doc.get(field) is not None:
                bucket[name].append(float(doc[field]))
        if doc.get("spreadSpikePct") is not None:
            bucket["spread"].append(float(doc["spreadSpikePct"]))
        if doc.get("directionBias"):
            bucket["bias"].append(doc["directionBias"])
    out = []
    for bucket in groups.values():
        def avg(vals: list[float]) -> float | None:
            return round(sum(vals) / len(vals), 2) if vals else None
        biases = bucket["bias"]
        if biases and all(b == "UP" for b in biases):
            bias = "UP"
        elif biases and all(b == "DOWN" for b in biases):
            bias = "DOWN"
        else:
            bias = "MIXED" if biases else "UNKNOWN"
        out.append({
            "eventKey": bucket["eventKey"], "currency": bucket["currency"], "title": bucket["title"], "samples": bucket["samples"],
            "avgMove5m": avg(bucket["move5"]), "avgMove15m": avg(bucket["move15"]), "avgMove30m": avg(bucket["move30"]),
            "avgMove1h": avg(bucket["move1h"]), "avgSpreadSpike": avg(bucket["spread"]), "directionalBias": bias,
        })
    return out


def snapshot() -> dict[str, Any]:
    policy = load_policy()
    engine = load_engine()
    events = load_events()
    instruments = load_instruments()
    age = None
    if engine.get("heartbeatAt"):
        try:
            beat = datetime.fromisoformat(str(engine["heartbeatAt"]).replace("Z", "+00:00"))
            if beat.tzinfo is None:
                beat = beat.replace(tzinfo=timezone.utc)
            age = max(0, int((datetime.now(timezone.utc) - beat).total_seconds()))
        except ValueError:
            age = None
    sources = (engine.get("detail") or {}).get("sources") or {
        "calendar": econ.feed_state(str(engine.get("sourceMode") or "UNCONFIGURED")),
        "calendarReason": engine.get("reason"),
        "sample": engine.get("sourceMode") == "DEVELOPMENT",
        "lastSync": None,
        "mt5": "DISCONNECTED",
        "external": "AVAILABLE" if policy.get("externalReference", True) else "UNAVAILABLE",
    }
    return {
        "ok": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sources": sources,
        "engine": engine,
        "freshnessSeconds": age,
        "policy": econ.public_policy(policy),
        "events": events,
        "instruments": instruments,
        "history": history_summary(),
        "audit": recent_audit(60),
        "universe": list(econ.UNIVERSE),
    }
