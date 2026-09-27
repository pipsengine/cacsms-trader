"""SQL Server access for Stage 7 H1 Confirmation: current decisions, H1 structural events, decision history, run audit,
Stage 8 hand-off."""

from __future__ import annotations

import json
from typing import Any

try:
    import direction_store
    import history_store
    from db import ROOT, _iso, connect, get_setting, set_setting
except ImportError:  # pragma: no cover
    from bridge.mt5 import direction_store, history_store  # type: ignore
    from bridge.mt5.db import ROOT, _iso, connect, get_setting, set_setting  # type: ignore

_schema_ready = False
META_KEY = "h1.last_run"


def ensure_confirm_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "008_h1_confirmation.sql").read_text(encoding="utf-8")
    batches = [b.strip() for b in sql.split("\nGO") if b.strip()]
    with connect() as conn:
        cur = conn.cursor()
        for batch in batches:
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


# ---------------------------------------------------------------- upstream reads (published Stage 6 + Stage 1 outputs)

def upstream() -> dict[str, Any]:
    st = direction_store.load_state()
    series = {s: row for (s, tf), row in history_store.series_all().items() if tf == "H1"}
    return {"direction": {r["symbol"]: r for r in st["instruments"]}, "directionRun": st.get("run"), "series": series}


def h1_bars(symbol: str, n: int) -> list[tuple]:
    return history_store.candle_tail(symbol, "H1", n)


# ---------------------------------------------------------------- writes

_SET = """
state=?, direction=?, reason_code=?, reason=?, phase=?, score=?, invalidation_level=?, stage6_state=?, h1_data_status=?,
h1_last_ts=?, confirmed=?, trigger_reason=?, decision_json=?
"""
_COLS = [c.split("=")[0].strip() for c in _SET.replace("\n", " ").split(",")]


def _params(o: dict[str, Any], trigger: str) -> list[Any]:
    return [
        o["state"], o["expectedDirection"] or "NEUTRAL", o["reasonCode"] or "", (o["reason"] or "")[:500], o.get("phase"),
        float(o["score"]), o.get("invalidationLevel"), (o.get("stage6") or {}).get("state"), (o.get("data") or {}).get("status"),
        (o.get("h1") or {}).get("lastTs"), 1 if o["confirmed"] else 0, trigger[:200], json.dumps(o, default=str),
    ]


def _events(o: dict[str, Any]) -> list[tuple]:
    """Structural H1 events worth auditing: BOS/CHoCH, pullback completion, retest, false breakout, invalidation, confirmation."""
    out: list[tuple] = []
    for e in (o.get("h1") or {}).get("events") or []:
        out.append((e["type"], e["side"], int(e["ts"]), e.get("level"), e.get("price"), f"{e['type']} {e['side']} through swing {e.get('swingLabel')}"))
    su = o.get("setup") or {}
    d = "UP" if str(o.get("expectedDirection") or "").startswith("BULL") else "DOWN"
    trig = su.get("trigger")
    if trig and su.get("extreme"):
        depth = "" if su.get("depth") is None else "%.0f%% " % (su["depth"] * 100)
        out.append(("PULLBACK_COMPLETE", d, int(trig["ts"]), su["extreme"].get("price"), trig.get("price"),
                    f"Pullback {depth}completed by {trig['type']}"))
    if su.get("retest"):
        r = su["retest"]
        out.append(("RETEST", d, int(r["ts"]), r.get("level"), r.get("price"), "Broken H1 level retested and held"))
    if su.get("falseBreakout"):
        f = su["falseBreakout"]
        out.append(("FALSE_BREAKOUT", d, int(f["ts"]), f.get("level"), f.get("price"), "H1 closed back through the broken level"))
    last_ts = (o.get("h1") or {}).get("lastTs")
    if o["state"] == "INVALIDATED" and o["reasonCode"] == "H1_STRUCTURE_INVALIDATED" and last_ts:
        out.append(("INVALIDATION", d, int(last_ts), o.get("invalidationLevel"), (o.get("h1") or {}).get("lastClose"), o["reason"][:400]))
    if o["confirmed"] and last_ts:
        out.append(("CONFIRMED", d, int(last_ts), o.get("invalidationLevel"), (o.get("h1") or {}).get("lastClose"), o["reason"][:400]))
    return out


def persist(rows: list[dict[str, Any]], changed: dict[str, dict[str, Any]], meta: dict[str, Any], triggers: list[str]) -> int | None:
    """Upsert every current decision; append new H1 events, decision history for changed symbols and a run row when anything changed."""
    trig = ", ".join(triggers)[:200]
    now = meta["runAt"][:26].replace("T", " ")
    run_id: int | None = None
    c = meta["counters"]
    with connect() as conn:
        cur = conn.cursor()
        if changed:
            cur.execute(
                """
                INSERT INTO dbo.app_h1_run (run_at, triggers, status, candidates, monitoring, confirmed, rejected, invalidated,
                  blocked, changed, duration_ms, summary_json) OUTPUT INSERTED.id VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                now, ", ".join(triggers)[:400], meta["status"], c["candidates"], c["monitoring"], c["confirmed"], c["rejected"],
                c["invalidated"], c["blocked"], len(changed), int(meta.get("durationMs") or 0),
                json.dumps({"counters": c, "changes": meta.get("changes")}, default=str),
            )
            run_id = int(cur.fetchone()[0])
        cur.execute("SELECT symbol, confirmed, confirmed_since FROM dbo.app_h1_instrument")
        prev = {s: (bool(x), at) for s, x, at in cur.fetchall()}
        for o in rows:
            sym = o["symbol"]
            was, since = prev.get(sym, (False, None))
            confirmed_since = (since if was else now) if o["confirmed"] else None
            p = _params(o, trig if sym in changed else (o.get("trigger") or ""))
            is_changed = sym in changed or sym not in prev
            cur.execute(
                f"""
                MERGE dbo.app_h1_instrument AS t
                USING (SELECT ? AS symbol) AS s ON t.symbol = s.symbol
                WHEN MATCHED THEN UPDATE SET {_SET}, confirmed_since=?, evaluated_at=SYSUTCDATETIME()
                  {", changed_at=?" if is_changed else ""}
                WHEN NOT MATCHED THEN INSERT (symbol, {', '.join(_COLS)}, confirmed_since, changed_at)
                  VALUES (?, {', '.join('?' for _ in _COLS)}, ?, ?);
                """,
                sym, *p, confirmed_since, *([now] if is_changed else []), sym, *p, confirmed_since, now,
            )
            for typ, side, ts, level, price, detail in _events(o):
                cur.execute(
                    """
                    IF NOT EXISTS (SELECT 1 FROM dbo.app_h1_event WHERE symbol=? AND event_type=? AND side=? AND bar_ts=?)
                      INSERT INTO dbo.app_h1_event (symbol, event_type, side, bar_ts, level, price, detail) VALUES (?,?,?,?,?,?,?)
                    """,
                    sym, typ, side, ts, sym, typ, side, ts, level, price, (detail or "")[:400],
                )
            if sym in changed:
                cur.execute(
                    """
                    INSERT INTO dbo.app_h1_history (symbol, state, direction, reason_code, phase, score, invalidation_level,
                      stage6_state, prev_state, trigger_reason, explanation) VALUES (?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    sym, o["state"], o["expectedDirection"] or "NEUTRAL", o["reasonCode"] or "", o.get("phase"), float(o["score"]),
                    o.get("invalidationLevel"), (o.get("stage6") or {}).get("state"), changed[sym].get("state"), trig,
                    (o["explanation"] or "")[:1200],
                )
        conn.commit()
    return run_id


def previous_decisions() -> dict[str, dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT decision_json FROM dbo.app_h1_instrument")
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


# ---------------------------------------------------------------- reads for the UI + Stage 8

def _decision(js: str, since: Any, changed_at: Any, evaluated_at: Any, trigger: str | None) -> dict[str, Any] | None:
    try:
        o = json.loads(js)
    except Exception:
        return None
    o.update({"confirmedSince": _iso(since), "changedAt": _iso(changed_at), "evaluatedAt": _iso(evaluated_at), "trigger": trigger})
    return o


_HIST_COLS = ("id, symbol, state, direction, reason_code, phase, score, invalidation_level, stage6_state, prev_state, "
              "trigger_reason, explanation, created_at")


def _history(r: tuple) -> dict[str, Any]:
    (i, s, st, d, code, ph, sc, inv, s6, pst, trig, ex, at) = r
    return {"id": int(i), "symbol": s, "state": st, "direction": d, "reasonCode": code, "phase": ph, "score": sc,
            "invalidationLevel": inv, "stage6State": s6, "prevState": pst, "trigger": trig, "explanation": ex, "createdAt": _iso(at)}


def _event(r: tuple) -> dict[str, Any]:
    (i, s, typ, side, ts, lvl, px, det, at) = r
    return {"id": int(i), "symbol": s, "type": typ, "side": side, "ts": int(ts), "level": lvl, "price": px, "detail": det, "createdAt": _iso(at)}


_EVENT_COLS = "id, symbol, event_type, side, bar_ts, level, price, detail, created_at"
_SEL = "SELECT decision_json, confirmed_since, changed_at, evaluated_at, trigger_reason FROM dbo.app_h1_instrument"


def load_state() -> dict[str, Any]:
    ensure_confirm_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(_SEL)
        rows = [o for o in (_decision(*r) for r in cur.fetchall()) if o]
        cur.execute(f"SELECT TOP 80 {_HIST_COLS} FROM dbo.app_h1_history ORDER BY id DESC")
        history = [_history(r) for r in cur.fetchall()]
        cur.execute(f"SELECT TOP 60 {_EVENT_COLS} FROM dbo.app_h1_event ORDER BY id DESC")
        events = [_event(r) for r in cur.fetchall()]
        cur.execute("SELECT TOP 30 id, run_at, triggers, status, candidates, monitoring, confirmed, rejected, invalidated, blocked, "
                    "changed, duration_ms FROM dbo.app_h1_run ORDER BY id DESC")
        runs = [{"id": int(i), "runAt": _iso(at), "triggers": tr, "status": st, "candidates": ca, "monitoring": mo, "confirmed": co,
                 "rejected": rj, "invalidated": iv, "blocked": bl, "changed": ch, "durationMs": ms}
                for i, at, tr, st, ca, mo, co, rj, iv, bl, ch, ms in cur.fetchall()]
    return {"ok": True, "run": load_meta(), "instruments": rows, "history": history, "events": events, "runs": runs}


def load_detail(symbol: str) -> dict[str, Any]:
    ensure_confirm_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(_SEL + " WHERE symbol=?", symbol)
        r = cur.fetchone()
        inst = _decision(*r) if r else None
        cur.execute(f"SELECT TOP 120 {_HIST_COLS} FROM dbo.app_h1_history WHERE symbol=? ORDER BY id DESC", symbol)
        history = [_history(x) for x in cur.fetchall()]
        cur.execute(f"SELECT TOP 120 {_EVENT_COLS} FROM dbo.app_h1_event WHERE symbol=? ORDER BY bar_ts DESC", symbol)
        events = [_event(x) for x in cur.fetchall()]
    return {"ok": True, "symbol": symbol, "instrument": inst, "history": history, "events": events}


def load_decision(symbol: str) -> dict[str, Any] | None:
    ensure_confirm_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(_SEL + " WHERE symbol=?", symbol)
        r = cur.fetchone()
    return _decision(*r) if r else None


def handoffs() -> list[dict[str, Any]]:
    """Stage 7 → Stage 8: only CONFIRMED candidates whose mandatory gates all passed."""
    ensure_confirm_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT decision_json, confirmed_since FROM dbo.app_h1_instrument WHERE confirmed = 1 ORDER BY score DESC")
        out = []
        for js, since in cur.fetchall():
            try:
                o = json.loads(js)
            except Exception:
                continue
            if o.get("handoff") and o.get("state") == "CONFIRMED":
                out.append({**o["handoff"], "confirmedSince": _iso(since)})
        return out
