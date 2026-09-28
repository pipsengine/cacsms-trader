"""Durable event, job, world-model and learning persistence for the autonomous runtime."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

try:
    from db import ROOT, _iso, connect
except ImportError:  # pragma: no cover
    from bridge.mt5.db import ROOT, _iso, connect  # type: ignore

_ready = False


def _json(value: Any) -> str:
    return json.dumps(value, default=str, separators=(",", ":"))


def _loads(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(value) if value else fallback
    except Exception:
        return fallback


def ensure_schema() -> None:
    global _ready
    if _ready:
        return
    sql = (ROOT / "database" / "mssql" / "011_autonomy.sql").read_text(encoding="utf-8")
    with connect() as conn:
        cur = conn.cursor()
        for batch in (b.strip() for b in sql.split("\nGO") if b.strip()):
            cur.execute(batch)
        conn.commit()
    _ready = True


def checkpoint(key: str, value: Any) -> None:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM dbo.app_auto_checkpoint WHERE checkpoint_key=?", key)
        if cur.fetchone():
            cur.execute("UPDATE dbo.app_auto_checkpoint SET value_json=?, updated_at=SYSUTCDATETIME() WHERE checkpoint_key=?", _json(value), key)
        else:
            cur.execute("INSERT INTO dbo.app_auto_checkpoint (checkpoint_key, value_json) VALUES (?,?)", key, _json(value))
        conn.commit()


def get_checkpoint(key: str, fallback: Any = None) -> Any:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT value_json FROM dbo.app_auto_checkpoint WHERE checkpoint_key=?", key)
        row = cur.fetchone()
    return _loads(row[0], fallback) if row else fallback


def event(event_type: str, source: str, *, stage: int | None = None, symbol: str | None = None,
          account_id: str | None = None, severity: str = "INFO", trigger: Any = None,
          payload: Any = None, event_key: str | None = None) -> int:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO dbo.app_auto_event (event_key,event_type,source,stage,symbol,account_id,severity,status,trigger_json,payload_json) "
            "VALUES (?,?,?,?,?,?,?,'PENDING',?,?)",
            event_key, event_type[:64], source[:32], stage, symbol, account_id, severity[:12],
            _json(trigger) if trigger is not None else None, _json(payload) if payload is not None else None,
        )
        event_id = int(cur.raw.lastrowid)
        conn.commit()
        return event_id


def finish_event(event_id: int, error: str | None = None) -> None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE dbo.app_auto_event SET status=?, processed_at=SYSUTCDATETIME(), error=? WHERE id=?",
                    "FAILED" if error else "PROCESSED", (error or "")[:800] or None, event_id)
        conn.commit()


def queue_job(job_key: str, stage: int, action: str, *, event_id: int | None = None, symbol: str | None = None,
              account_id: str | None = None, priority: int = 50, input_version: str | None = None,
              payload: Any = None, max_attempts: int = 5) -> tuple[int | None, bool]:
    """Insert one idempotent job. Completed input versions are never replayed after restart."""
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id,state FROM dbo.app_auto_job WHERE job_key=?", job_key)
        found = cur.fetchone()
        if found:
            return int(found[0]), False
        cur.execute(
            "INSERT INTO dbo.app_auto_job (job_key,event_id,stage,symbol,account_id,action,state,priority,max_attempts,input_version,payload_json) "
            "VALUES (?,?,?,?,?,?,'READY',?,?,?,?)",
            job_key, event_id, stage, symbol, account_id, action[:64], int(priority), int(max_attempts), input_version,
            _json(payload) if payload is not None else None,
        )
        job_id = int(cur.raw.lastrowid)
        conn.commit()
        return job_id, True


def claim_job(owner: str) -> dict[str, Any] | None:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT TOP 1 id,job_key,event_id,stage,symbol,account_id,action,attempt,max_attempts,input_version,payload_json "
            "FROM dbo.app_auto_job WHERE state IN ('READY','RETRY') AND (not_before IS NULL OR not_before <= SYSUTCDATETIME()) "
            "ORDER BY priority ASC,id ASC"
        )
        row = cur.fetchone()
        if not row:
            return None
        cur.execute("UPDATE dbo.app_auto_job SET state='RUNNING',attempt=attempt+1,lease_owner=?,lease_until=DATEADD(SECOND,60,SYSUTCDATETIME()),updated_at=SYSUTCDATETIME() "
                    "WHERE id=? AND state IN ('READY','RETRY')", owner, int(row[0]))
        if cur.rowcount != 1:
            return None
        conn.commit()
    return {"id": int(row[0]), "jobKey": row[1], "eventId": row[2], "stage": int(row[3]), "symbol": row[4],
            "accountId": row[5], "action": row[6], "attempt": int(row[7]) + 1, "maxAttempts": int(row[8]),
            "inputVersion": row[9], "payload": _loads(row[10], {})}


def complete_job(job_id: int, *, blocker_code: str | None = None, blocker: str | None = None,
                 retry_sec: int | None = None) -> None:
    with connect() as conn:
        cur = conn.cursor()
        if retry_sec is not None:
            cur.execute("UPDATE dbo.app_auto_job SET state='RETRY',not_before=DATEADD(SECOND,?,SYSUTCDATETIME()),lease_owner=NULL,lease_until=NULL,"
                        "blocker_code=?,blocker=?,updated_at=SYSUTCDATETIME() WHERE id=?",
                        int(retry_sec), blocker_code, (blocker or "")[:800] or None, job_id)
        else:
            cur.execute("UPDATE dbo.app_auto_job SET state=?,blocker_code=?,blocker=?,lease_owner=NULL,lease_until=NULL,completed_at=SYSUTCDATETIME(),"
                        "updated_at=SYSUTCDATETIME() WHERE id=?", "BLOCKED" if blocker_code else "DONE", blocker_code,
                        (blocker or "")[:800] or None, job_id)
        conn.commit()


def recover_jobs() -> int:
    """Return abandoned leases to the queue; job keys prevent duplicate work/orders."""
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE dbo.app_auto_job SET state='RETRY',lease_owner=NULL,lease_until=NULL,not_before=SYSUTCDATETIME(),"
                    "blocker_code='RESTART_RECOVERY',blocker='Recovered after runtime restart',updated_at=SYSUTCDATETIME() "
                    "WHERE state='RUNNING'")
        count = max(0, cur.rowcount)
        conn.commit()
        return count


def world(symbol: str, stage: int, *, engine_health: str, pipeline_state: str, freshness: str,
          confidence: float | None = None, input_version: str | None = None, output_version: str | None = None,
          trigger: str | None = None, current_action: str | None = None, next_action: str | None = None,
          blocker_code: str | None = None, blocker: str | None = None, dependencies: Any = None,
          evidence: Any = None, evaluated_at: str | None = None) -> None:
    ensure_schema()
    values = (engine_health, pipeline_state, confidence, freshness, input_version, output_version, trigger, current_action, next_action,
              blocker_code, blocker, _json(dependencies) if dependencies is not None else None,
              _json(evidence) if evidence is not None else None, evaluated_at)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM dbo.app_world_instrument WHERE symbol=? AND stage=?", symbol, stage)
        if cur.fetchone():
            cur.execute("UPDATE dbo.app_world_instrument SET engine_health=?,pipeline_state=?,confidence=?,freshness=?,input_version=?,output_version=?,"
                        "trigger=?,current_action=?,next_action=?,blocker_code=?,blocker=?,dependencies_json=?,evidence_json=?,evaluated_at=?,"
                        "updated_at=SYSUTCDATETIME() WHERE symbol=? AND stage=?", *values, symbol, stage)
        else:
            cur.execute("INSERT INTO dbo.app_world_instrument (symbol,stage,engine_health,pipeline_state,confidence,freshness,input_version,output_version,"
                        "trigger,current_action,next_action,blocker_code,blocker,dependencies_json,evidence_json,evaluated_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", symbol, stage, *values)
        conn.commit()


def record_learning(item: dict[str, Any]) -> bool:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM dbo.app_learning_evaluation WHERE evaluation_key=?", item["key"])
        if cur.fetchone():
            return False
        cur.execute("INSERT INTO dbo.app_learning_evaluation (evaluation_key,kind,execution_id,setup_key,account_id,symbol,decision,outcome,confidence,"
                    "expected_json,actual_json,evidence_json,recommendation_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    item["key"], item["kind"], item.get("executionId"), item.get("setupKey"), item.get("accountId"), item["symbol"],
                    item["decision"], item.get("outcome"), item.get("confidence"), _json(item.get("expected")), _json(item.get("actual")),
                    _json(item.get("evidence") or {}), _json(item.get("recommendation")) if item.get("recommendation") is not None else None)
        conn.commit()
        return True


def record_decision(item: dict[str, Any]) -> int:
    """Immutable answer: what triggered a step, which inputs it used, what it decided, and what blocked it."""
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO dbo.app_auto_decision (event_id,job_id,stage,symbol,account_id,trigger_reason,inputs_json,decision,confidence,reason,blocker_code,blocker,next_action) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            item.get("eventId"), item.get("jobId"), int(item["stage"]), item.get("symbol"), item.get("accountId"),
            (item.get("trigger") or "")[:240] or None, _json(item.get("inputs")) if item.get("inputs") is not None else None,
            str(item.get("decision") or "RECORDED")[:32], item.get("confidence"), (item.get("reason") or "")[:800] or None,
            item.get("blockerCode"), (item.get("blocker") or "")[:800] or None, (item.get("nextAction") or "")[:300] or None,
        )
        decision_id = int(cur.raw.lastrowid)
        conn.commit()
        return decision_id


def learning_run(trigger: str, status: str, trades: int, rejections: int, recommendations: int, duration_ms: int, summary: Any) -> None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO dbo.app_learning_run (run_at,trigger_reason,status,trades_evaluated,rejections_evaluated,recommendations,duration_ms,summary_json) "
                    "VALUES (SYSUTCDATETIME(),?,?,?,?,?,?,?)", trigger[:240], status[:16], trades, rejections, recommendations, duration_ms, _json(summary))
        conn.commit()


def state(event_limit: int = 80) -> dict[str, Any]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT checkpoint_key,value_json,updated_at FROM dbo.app_auto_checkpoint")
        checkpoints = {k: {"value": _loads(v, {}), "updatedAt": _iso(at)} for k, v, at in cur.fetchall()}
        cur.execute("SELECT state,COUNT(*) FROM dbo.app_auto_job GROUP BY state")
        jobs = {s: int(n) for s, n in cur.fetchall()}
        cur.execute("SELECT symbol,stage,engine_health,pipeline_state,confidence,freshness,trigger,current_action,next_action,blocker_code,blocker,evaluated_at,updated_at "
                    "FROM dbo.app_world_instrument ORDER BY symbol,stage")
        world_rows = [{"symbol": r[0], "stage": int(r[1]), "engineHealth": r[2], "state": r[3], "confidence": r[4], "freshness": r[5],
                       "trigger": r[6], "currentAction": r[7], "nextAction": r[8], "blockerCode": r[9], "blocker": r[10],
                       "evaluatedAt": _iso(r[11]), "updatedAt": _iso(r[12])} for r in cur.fetchall()]
        cur.execute(f"SELECT TOP {int(event_limit)} id,event_type,source,stage,symbol,account_id,severity,status,trigger_json,payload_json,created_at,processed_at,error "
                    "FROM dbo.app_auto_event ORDER BY id DESC")
        events = [{"id": int(r[0]), "type": r[1], "source": r[2], "stage": r[3], "symbol": r[4], "accountId": r[5], "severity": r[6],
                   "status": r[7], "trigger": _loads(r[8], None), "payload": _loads(r[9], None), "createdAt": _iso(r[10]),
                   "processedAt": _iso(r[11]), "error": r[12]} for r in cur.fetchall()]
        cur.execute("SELECT TOP 1 run_at,status,trades_evaluated,rejections_evaluated,recommendations,duration_ms,summary_json FROM dbo.app_learning_run ORDER BY id DESC")
        lr = cur.fetchone()
        learning = None if not lr else {"runAt": _iso(lr[0]), "status": lr[1], "tradesEvaluated": int(lr[2]), "rejectionsEvaluated": int(lr[3]),
                                         "recommendations": int(lr[4]), "durationMs": int(lr[5]), "summary": _loads(lr[6], {})}
        cur.execute("SELECT TOP 40 id,event_id,job_id,stage,symbol,account_id,trigger_reason,inputs_json,decision,confidence,reason,blocker_code,blocker,next_action,created_at "
                    "FROM dbo.app_auto_decision ORDER BY id DESC")
        decisions = [{"id": int(r[0]), "eventId": r[1], "jobId": r[2], "stage": int(r[3]), "symbol": r[4], "accountId": r[5],
                      "trigger": r[6], "inputs": _loads(r[7], None), "decision": r[8], "confidence": r[9], "reason": r[10],
                      "blockerCode": r[11], "blocker": r[12], "nextAction": r[13], "createdAt": _iso(r[14])} for r in cur.fetchall()]
    return {"ok": True, "checkpoints": checkpoints, "jobs": jobs, "instruments": world_rows, "events": events,
            "decisions": decisions, "learning": learning}
