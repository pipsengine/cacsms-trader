"""SQL Server access for Stage 6 Structural Direction: current decisions, decision history, run audit, Stage 7 hand-off."""

from __future__ import annotations

import json
from typing import Any

try:
    import scanner_store
    import vision_store
    from db import ROOT, _iso, connect, get_setting, set_setting
except ImportError:  # pragma: no cover
    from bridge.mt5 import scanner_store, vision_store  # type: ignore
    from bridge.mt5.db import ROOT, _iso, connect, get_setting, set_setting  # type: ignore

_schema_ready = False
META_KEY = "direction.last_run"


def ensure_direction_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "007_structural_direction.sql").read_text(encoding="utf-8")
    batches = [b.strip() for b in sql.split("\nGO") if b.strip()]
    with connect() as conn:
        cur = conn.cursor()
        for batch in batches:
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


# ---------------------------------------------------------------- upstream reads (published Stage 4 + Stage 5 outputs)

def upstream() -> dict[str, Any]:
    scanner_store.ensure_scanner_schema()
    vstate = vision_store.load_state(event_limit=0)
    return {
        "scanner": {r["symbol"]: r for r in scanner_store.load_instruments()},
        "scannerRun": scanner_store.load_meta(),
        "vision": {r["symbol"]: r for r in vstate["instruments"]},
        "visionRun": vstate.get("run"),
    }


# ---------------------------------------------------------------- writes

_SET = """
state=?, direction=?, reason_code=?, reason=?, structural_phase=?, alignment=?, confidence=?, channel_position=?, zone=?,
ready_for_h1=?, scanner_state=?, vision_status=?, d1_status=?, d1_direction=?, h8_status=?, h8_direction=?,
freshness_status=?, trigger_reason=?, decision_json=?
"""
_COLS = [c.split("=")[0].strip() for c in _SET.replace("\n", " ").split(",")]


def _params(o: dict[str, Any], trigger: str) -> list[Any]:
    up = o["upstream"]
    return [
        o["state"], o["direction"], o["reasonCode"] or "", (o["reason"] or "")[:500], o["structuralPhase"], o["alignment"],
        float(o["confidence"]), o["position"]["d1"], o["zone"]["name"], 1 if o["readyForH1"] else 0,
        (up["scanner"] or {}).get("state"), (up["vision"] or {}).get("status"), o["d1"]["status"], o["d1"]["direction"],
        o["h8"]["status"], o["h8"]["direction"], o["freshness"]["status"], trigger[:200], json.dumps(o, default=str),
    ]


def persist(rows: list[dict[str, Any]], changed: dict[str, dict[str, Any]], meta: dict[str, Any], triggers: list[str]) -> int | None:
    """Upsert every current decision; append decision history for changed symbols and a run row when anything changed."""
    trig = ", ".join(triggers)[:200]
    now = meta["runAt"][:26].replace("T", " ")
    run_id: int | None = None
    c = meta["counters"]
    with connect() as conn:
        cur = conn.cursor()
        if changed:
            cur.execute(
                """
                INSERT INTO dbo.app_direction_run (run_at, triggers, status, candidates, aligned, pullback_waiting, conflicts,
                  blocked, ready, changed, duration_ms, summary_json) OUTPUT INSERTED.id VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                now, ", ".join(triggers)[:400], meta["status"], c["candidates"], c["aligned"], c["pullbackWaiting"],
                c["conflicts"], c["blocked"], c["ready"], len(changed), int(meta.get("durationMs") or 0),
                json.dumps({"counters": c, "changes": meta.get("changes")}, default=str),
            )
            run_id = int(cur.fetchone()[0])
        cur.execute("SELECT symbol, ready_for_h1, ready_since FROM dbo.app_direction_instrument")
        prev = {s: (bool(r), at) for s, r, at in cur.fetchall()}
        for o in rows:
            sym = o["symbol"]
            was_ready, since = prev.get(sym, (False, None))
            ready_since = (since if was_ready else now) if o["readyForH1"] else None
            p = _params(o, trig if sym in changed else (o.get("trigger") or ""))
            is_changed = sym in changed or sym not in prev
            cur.execute(
                f"""
                MERGE dbo.app_direction_instrument AS t
                USING (SELECT ? AS symbol) AS s ON t.symbol = s.symbol
                WHEN MATCHED THEN UPDATE SET {_SET}, ready_since=?, evaluated_at=SYSUTCDATETIME()
                  {", changed_at=?" if is_changed else ""}
                WHEN NOT MATCHED THEN INSERT (symbol, {', '.join(_COLS)}, ready_since, changed_at)
                  VALUES (?, {', '.join('?' for _ in _COLS)}, ?, ?);
                """,
                sym, *p, ready_since, *([now] if is_changed else []), sym, *p, ready_since, now,
            )
            if sym in changed:
                pv = changed[sym]
                cur.execute(
                    """
                    INSERT INTO dbo.app_direction_history (symbol, state, direction, reason_code, structural_phase, alignment,
                      confidence, channel_position, d1_status, d1_direction, h8_status, h8_direction, prev_state, prev_direction,
                      trigger_reason, explanation) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    sym, o["state"], o["direction"], o["reasonCode"] or "", o["structuralPhase"], o["alignment"], float(o["confidence"]),
                    o["position"]["d1"], o["d1"]["status"], o["d1"]["direction"], o["h8"]["status"], o["h8"]["direction"],
                    pv.get("state"), pv.get("direction"), trig, (o["explanation"] or "")[:900],
                )
        conn.commit()
    return run_id


def previous_decisions() -> dict[str, dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT decision_json FROM dbo.app_direction_instrument")
        out = {}
        for (js,) in cur.fetchall():
            try:
                o = json.loads(js)
                out[o["symbol"]] = o
            except Exception:
                continue
        return out


def save_meta(meta: dict[str, Any]) -> None:
    set_setting(META_KEY, json.dumps(meta, default=str))


def load_meta() -> dict[str, Any] | None:
    raw = get_setting(META_KEY)
    try:
        return json.loads(raw) if raw else None
    except Exception:
        return None


# ---------------------------------------------------------------- reads for the UI + Stage 7

def _decision(js: str, ready_since: Any, changed_at: Any, evaluated_at: Any, trigger: str | None) -> dict[str, Any] | None:
    try:
        o = json.loads(js)
    except Exception:
        return None
    o.update({"readySince": _iso(ready_since), "changedAt": _iso(changed_at), "evaluatedAt": _iso(evaluated_at), "trigger": trigger})
    return o


_HIST_COLS = ("id, symbol, state, direction, reason_code, structural_phase, alignment, confidence, channel_position, d1_status, "
              "d1_direction, h8_status, h8_direction, prev_state, prev_direction, trigger_reason, explanation, created_at")


def _history(r: tuple) -> dict[str, Any]:
    (i, s, st, d, code, ph, al, conf, pos, d1s, d1d, h8s, h8d, pst, pd, trig, ex, at) = r
    return {"id": int(i), "symbol": s, "state": st, "direction": d, "reasonCode": code, "phase": ph, "alignment": al,
            "confidence": conf, "position": pos, "d1": {"status": d1s, "direction": d1d}, "h8": {"status": h8s, "direction": h8d},
            "prevState": pst, "prevDirection": pd, "trigger": trig, "explanation": ex, "createdAt": _iso(at)}


def load_state() -> dict[str, Any]:
    ensure_direction_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT decision_json, ready_since, changed_at, evaluated_at, trigger_reason FROM dbo.app_direction_instrument")
        rows = [o for o in (_decision(*r) for r in cur.fetchall()) if o]
        cur.execute(f"SELECT TOP 80 {_HIST_COLS} FROM dbo.app_direction_history ORDER BY id DESC")
        history = [_history(r) for r in cur.fetchall()]
        cur.execute("SELECT TOP 30 id, run_at, triggers, status, candidates, aligned, pullback_waiting, conflicts, blocked, ready, "
                    "changed, duration_ms FROM dbo.app_direction_run ORDER BY id DESC")
        runs = [{"id": int(i), "runAt": _iso(at), "triggers": tr, "status": st, "candidates": ca, "aligned": al,
                 "pullbackWaiting": pw, "conflicts": cf, "blocked": bl, "ready": rd, "changed": ch, "durationMs": ms}
                for i, at, tr, st, ca, al, pw, cf, bl, rd, ch, ms in cur.fetchall()]
    return {"ok": True, "run": load_meta(), "instruments": rows, "history": history, "runs": runs}


def load_detail(symbol: str) -> dict[str, Any]:
    ensure_direction_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT decision_json, ready_since, changed_at, evaluated_at, trigger_reason FROM dbo.app_direction_instrument WHERE symbol=?", symbol)
        r = cur.fetchone()
        inst = _decision(*r) if r else None
        cur.execute(f"SELECT TOP 120 {_HIST_COLS} FROM dbo.app_direction_history WHERE symbol=? ORDER BY id DESC", symbol)
        history = [_history(x) for x in cur.fetchall()]
    return {"ok": True, "symbol": symbol, "instrument": inst, "history": history}


def handoffs() -> list[dict[str, Any]]:
    """Stage 6 → Stage 7: only structurally valid READY_FOR_H1 candidates."""
    ensure_direction_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT decision_json, ready_since FROM dbo.app_direction_instrument WHERE ready_for_h1 = 1 ORDER BY confidence DESC")
        out = []
        for js, since in cur.fetchall():
            try:
                o = json.loads(js)
            except Exception:
                continue
            if o.get("handoff"):
                out.append({**o["handoff"], "readySince": _iso(since)})
        return out
