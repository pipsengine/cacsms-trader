"""SQL Server persistence for Stage 9 Execution & Positions: idempotent execution ledger, MT5 requests / deals, audit events,
reconciliation findings, Stage 10 trade records, operator control and configuration. Stage 8 authorizations are consumed with a
compare-and-set on their status (terms stay immutable)."""

from __future__ import annotations

import json
from typing import Any

try:
    import execution as ex
    import risk_store
    from db import ROOT, _iso, connect, get_setting, list_accounts, list_positions, replace_positions, set_setting
except ImportError:  # pragma: no cover
    from bridge.mt5 import execution as ex  # type: ignore
    from bridge.mt5 import risk_store  # type: ignore
    from bridge.mt5.db import ROOT, _iso, connect, get_setting, list_accounts, list_positions, replace_positions, set_setting  # type: ignore

_schema_ready = False
META_KEY = "execution.last_run"
CONFIG_KEY = "execution.config"
CONTROL_KEY = "execution.control"
LEDGER_COLS = "data_json, order_state, position_state, stale, created_at, updated_at, closed_at"


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "010_execution.sql").read_text(encoding="utf-8")
    with connect() as conn:
        cur = conn.cursor()
        for batch in [b.strip() for b in sql.split("\nGO") if b.strip()]:
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


def _ts(v: Any) -> str | None:
    t = ex.parse_ts(v)
    return None if t is None else ex.iso(t)[:26].replace("T", " ")


def _json(v: Any) -> str:
    return json.dumps(v, default=str)


# ---------------------------------------------------------------- configuration + control (central app_settings)

def load_config() -> tuple[dict[str, Any], dict[str, Any]]:
    raw = get_setting(CONFIG_KEY)
    try:
        overrides = json.loads(raw) if raw else {}
    except Exception:
        overrides = {}
    cfg, errors = ex.merge_config(overrides)
    if errors:
        cfg, _ = ex.merge_config({})
        cfg["_errors"] = errors
    return cfg, overrides


def save_config(changes: dict[str, Any], actor: str, reason: str | None) -> dict[str, Any]:
    ensure_schema()
    before, overrides = load_config()
    before.pop("_errors", None)
    merged = {k: v for k, v in {**overrides, **(changes or {})}.items() if v is not None}
    after, errors = ex.merge_config(merged)
    if errors:
        return {"ok": False, "errors": errors}
    changed = sorted(k for k in ex.CONFIG if _json(before.get(k)) != _json(after.get(k)))
    if not changed:
        return {"ok": True, "changed": [], "config": after}
    set_setting(CONFIG_KEY, _json({k: after[k] for k in ex.CONFIG if _json(after[k]) != _json(ex.CONFIG[k])}))
    event(None, None, "CONFIG", None, f"Execution configuration changed by {actor}: {', '.join(changed)}" + (f" — {reason}" if reason else ""),
          {"before": {k: before.get(k) for k in changed}, "after": {k: after.get(k) for k in changed}})
    return {"ok": True, "changed": changed, "config": after}


def load_control() -> dict[str, Any]:
    raw = get_setting(CONTROL_KEY)
    try:
        c = json.loads(raw) if raw else {}
    except Exception:
        c = {}
    # fail closed: execution stays disabled until an operator explicitly enables it
    return {"executionEnabled": bool(c.get("executionEnabled", False)), "emergencyStop": bool(c.get("emergencyStop", False)),
            "emergencyReason": c.get("emergencyReason"), "analysisPaused": bool(c.get("analysisPaused", False)),
            "analysisReason": c.get("analysisReason"), "updatedAt": c.get("updatedAt"), "updatedBy": c.get("updatedBy"), "reason": c.get("reason")}


CONTROL_KEYS = ("executionEnabled", "emergencyStop", "analysisPaused")


def save_control(patch: dict[str, Any], actor: str, reason: str | None) -> dict[str, Any]:
    ensure_schema()
    cur = load_control()
    nxt = dict(cur)
    if "executionEnabled" in patch:
        nxt["executionEnabled"] = bool(patch["executionEnabled"])
    if "emergencyStop" in patch:
        nxt["emergencyStop"] = bool(patch["emergencyStop"])
        nxt["emergencyReason"] = (reason or "operator") if patch["emergencyStop"] else None
    if "analysisPaused" in patch:
        nxt["analysisPaused"] = bool(patch["analysisPaused"])
        nxt["analysisReason"] = (reason or "operator") if patch["analysisPaused"] else None
    changes = [k for k in CONTROL_KEYS if nxt[k] != cur[k]]
    if not changes:
        return {"ok": True, "control": cur, "changed": []}
    nxt.update({"updatedAt": ex.iso(__import__("time").time()), "updatedBy": actor, "reason": reason})
    set_setting(CONTROL_KEY, _json(nxt))
    event(None, None, "CONTROL", None, f"{actor}: " + "; ".join(f"{k} {cur[k]} → {nxt[k]}" for k in changes) + (f" — {reason}" if reason else ""),
          {"before": {k: cur[k] for k in changes}, "after": {k: nxt[k] for k in changes}})
    return {"ok": True, "control": nxt, "changed": changes}


def auto_enabled() -> bool:
    return risk_store.auto_enabled()


def set_trading(enabled: bool, actor: str, reason: str | None) -> dict[str, Any]:
    """Global TRADING_PAUSED switch (app_settings.auto, shared with Stage 8). Pausing blocks new entries; management continues."""
    ensure_schema()
    before = auto_enabled()
    if before == enabled:
        return {"ok": True, "changed": False, "tradingEnabled": enabled}
    set_setting("auto", "true" if enabled else "false")
    event(None, None, "CONTROL", None, f"{actor}: trading {'RESUMED' if enabled else 'PAUSED'}" + (f" — {reason}" if reason else ""),
          {"before": {"tradingEnabled": before}, "after": {"tradingEnabled": enabled}})
    return {"ok": True, "changed": True, "tradingEnabled": enabled}


def accounts() -> list[dict[str, Any]]:
    return list_accounts()


def risk_context() -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    cfg, _ = risk_store.load_config()
    meta = risk_store.load_meta() or {}
    return cfg, {a["accountId"]: a for a in meta.get("accounts") or []}


# ---------------------------------------------------------------- Stage 8 authorizations

def pending_authorizations() -> list[dict[str, Any]]:
    return sorted(risk_store.authorizations("PENDING", 200), key=lambda a: str(a.get("authorizedAt")))


def authorization_status(eid: str) -> str | None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT status FROM dbo.app_risk_authorization WHERE execution_id=?", eid)
        r = cur.fetchone()
        return r[0] if r else None


def _auth_transition(eid: str, to: str, reason: str, only_unexpired: bool) -> bool:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE dbo.app_risk_authorization SET status=?, status_reason=?, status_at=SYSUTCDATETIME() WHERE execution_id=? AND status='PENDING'"
                    + (" AND expires_at > SYSUTCDATETIME()" if only_unexpired else ""), to, reason[:400], eid)
        ok = cur.rowcount == 1
        if ok:
            cur.execute("INSERT INTO dbo.app_risk_authorization_event (execution_id, status, reason) VALUES (?,?,?)", eid, to, reason[:400])
        conn.commit()
        return ok


def consume_authorization(eid: str, reason: str) -> bool:
    """Atomic PENDING -> CONSUMED. Exactly one consumer can win; an expired or revoked authorization can never be consumed."""
    return _auth_transition(eid, "CONSUMED", reason, True)


def decline_authorization(eid: str, reason: str) -> bool:
    return _auth_transition(eid, "DECLINED", reason, False)


# ---------------------------------------------------------------- ledger

def _doc(row: tuple) -> dict[str, Any]:
    js, ost, pst, stale, created, updated, closed = row
    d = json.loads(js)
    d.update({"orderState": ost, "positionState": pst, "stale": bool(stale), "createdAt": _iso(created), "updatedAt": _iso(updated), "closedAt": _iso(closed)})
    return d


def _is_closed(doc: dict[str, Any]) -> bool:
    if doc.get("positionState") == "CLOSED":
        return True
    return doc.get("positionState") is None and doc.get("orderState") in ("REJECTED", "CANCELLED", "EXPIRED")


def _params(doc: dict[str, Any]) -> list[Any]:
    body = {k: v for k, v in doc.items() if k not in ("orderState", "positionState", "stale", "createdAt", "updatedAt", "closedAt")}
    return [doc["orderState"], doc.get("positionState"), (doc.get("blockerCode") or None) and str(doc["blockerCode"])[:48], doc.get("node"),
            doc.get("mt5Order") or None, doc.get("mt5Position") or None, 1 if doc.get("stale") else 0, _json(body)]


def ledger_create(doc: dict[str, Any]) -> bool:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM dbo.app_exec_ledger WHERE execution_id=?)
            INSERT INTO dbo.app_exec_ledger (execution_id, setup_key, attempt, account_id, account_class, symbol, direction, order_state,
              position_state, blocker_code, node, mt5_order, mt5_position, stale, data_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            doc["executionId"], doc["executionId"], doc["setupKey"], doc["attempt"], doc["accountId"], doc["accountClass"] or "DEMO",
            doc["instrument"], doc["direction"], *_params(doc),
        )
        ok = cur.rowcount == 1
        conn.commit()
        return ok


def ledger_save(doc: dict[str, Any], expect_state: str | tuple[str, ...] | None = None) -> bool:
    """Persist the document; with expect_state the write is a compare-and-set on order_state (claims for submission)."""
    sql = ("UPDATE dbo.app_exec_ledger SET order_state=?, position_state=?, blocker_code=?, node=?, mt5_order=?, mt5_position=?, stale=?, data_json=?, "
           "updated_at=SYSUTCDATETIME(), closed_at=" + ("COALESCE(closed_at, SYSUTCDATETIME())" if _is_closed(doc) else "NULL") + " WHERE execution_id=?")
    params = [*_params(doc), doc["executionId"]]
    if expect_state:
        states = (expect_state,) if isinstance(expect_state, str) else tuple(expect_state)
        sql += f" AND order_state IN ({','.join('?' for _ in states)})"
        params += list(states)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(sql, *params)
        ok = cur.rowcount == 1
        conn.commit()
        return ok


def ledger_get(eid: str) -> dict[str, Any] | None:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT {LEDGER_COLS} FROM dbo.app_exec_ledger WHERE execution_id=?", eid)
        r = cur.fetchone()
        return _doc(r) if r else None


def ledger_active() -> list[dict[str, Any]]:
    """Every execution Stage 9 still owns: pre-submit / in-flight orders and open positions."""
    ensure_schema()
    pre = ex.PRE_SUBMIT + ex.IN_FLIGHT
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT {LEDGER_COLS} FROM dbo.app_exec_ledger WHERE closed_at IS NULL AND (order_state IN ({','.join('?' for _ in pre)}) "
                    f"OR position_state IS NOT NULL) ORDER BY created_at", *pre)
        return [_doc(r) for r in cur.fetchall()]


def ledger_recent(hours: int = 24, limit: int = 80) -> list[dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT TOP {int(limit)} {LEDGER_COLS} FROM dbo.app_exec_ledger WHERE closed_at IS NULL OR updated_at >= DATEADD(hour, ?, SYSUTCDATETIME()) "
                    "ORDER BY updated_at DESC", -int(hours))
        return [_doc(r) for r in cur.fetchall()]


def traded(setup_key: str, account_id: str, exclude: str) -> bool:
    """True when another execution of this setup on this account consumed its authorization (one execution per setup)."""
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM dbo.app_exec_ledger WHERE setup_key=? AND account_id=? AND execution_id<>? "
                    "AND JSON_VALUE(data_json, '$.consumedAt') IS NOT NULL", setup_key, account_id, exclude)
        return int(cur.fetchone()[0]) > 0


def mark_stale(account_id: str, stale: bool) -> int:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE dbo.app_exec_ledger SET stale=? WHERE account_id=? AND closed_at IS NULL AND stale<>?", 1 if stale else 0, account_id, 1 if stale else 0)
        n = cur.rowcount
        conn.commit()
        return n


# ---------------------------------------------------------------- events, requests, deals

def event(eid: str | None, account_id: str | None, kind: str, state: str | None, detail: str, data: Any = None) -> None:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO dbo.app_exec_event (execution_id, account_id, kind, state, detail, data_json) VALUES (?,?,?,?,?,?)",
                    eid, account_id, kind[:32], (state or None) and state[:24], detail[:800], None if data is None else _json(data))
        conn.commit()


def events(eid: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        if eid:
            cur.execute(f"SELECT TOP {int(limit)} id, execution_id, account_id, kind, state, detail, data_json, created_at FROM dbo.app_exec_event "
                        "WHERE execution_id=? ORDER BY id", eid)
        else:
            cur.execute(f"SELECT TOP {int(limit)} id, execution_id, account_id, kind, state, detail, data_json, created_at FROM dbo.app_exec_event ORDER BY id DESC")
        return [{"id": int(i), "executionId": e, "accountId": a, "kind": k, "state": s, "detail": dt, "data": json.loads(js) if js else None,
                 "createdAt": _iso(at)} for i, e, a, k, s, dt, js, at in cur.fetchall()]


ORDER_FIELDS = ("request_id", "execution_id", "account_id", "purpose", "symbol", "order_type", "volume", "requested_price", "sl", "tp", "status",
                "retcode", "retcode_text", "mt5_order", "mt5_deal", "fill_price", "fill_volume", "spread", "slippage_points", "latency_ms",
                "request_json", "result_json")
ORDER_KEYS = {"requestId": "request_id", "executionId": "execution_id", "accountId": "account_id", "purpose": "purpose", "symbol": "symbol",
              "orderType": "order_type", "volume": "volume", "requestedPrice": "requested_price", "sl": "sl", "tp": "tp", "status": "status",
              "retcode": "retcode", "retcodeText": "retcode_text", "mt5Order": "mt5_order", "mt5Deal": "mt5_deal", "fillPrice": "fill_price",
              "fillVolume": "fill_volume", "spread": "spread", "slippagePoints": "slippage_points", "latencyMs": "latency_ms",
              "request": "request_json", "result": "result_json"}


def _order_val(col: str, v: Any) -> Any:
    if col in ("request_json", "result_json"):
        return None if v is None else _json(v)
    if col == "retcode_text" and v is not None:
        return str(v)[:200]
    return v


def order_add(row: dict[str, Any]) -> int | None:
    """Insert a broker request; None when this request_id already exists (duplicate suppressed)."""
    cols = [ORDER_KEYS[k] for k in row if k in ORDER_KEYS]
    vals = [_order_val(ORDER_KEYS[k], v) for k, v in row.items() if k in ORDER_KEYS]
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM dbo.app_exec_order WHERE request_id=?", row["requestId"])
        if cur.fetchone():
            return None
        cur.execute(f"INSERT INTO dbo.app_exec_order ({', '.join(cols)}) OUTPUT INSERTED.id VALUES ({', '.join('?' for _ in cols)})", *vals)
        oid = int(cur.fetchone()[0])
        conn.commit()
        return oid


def order_update(oid: int, patch: dict[str, Any], complete: bool = True) -> None:
    items = [(ORDER_KEYS[k], _order_val(ORDER_KEYS[k], v)) for k, v in patch.items() if k in ORDER_KEYS]
    if not items and not complete:
        return
    sets = [f"{c}=?" for c, _ in items] + (["completed_at=SYSUTCDATETIME()"] if complete else [])
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"UPDATE dbo.app_exec_order SET {', '.join(sets)} WHERE id=?", *[v for _, v in items], oid)
        conn.commit()


def _order_row(r: tuple) -> dict[str, Any]:
    (i, rid, eid, acct, purpose, sym, typ, vol, req_px, sl, tp, st, rc, rct, mo, md, fpx, fvol, spread, slip, lat, rj, sj, cat, dat) = r
    return {"id": int(i), "requestId": rid, "executionId": eid, "accountId": acct, "purpose": purpose, "symbol": sym, "orderType": typ, "volume": vol,
            "requestedPrice": req_px, "sl": sl, "tp": tp, "status": st, "retcode": rc, "retcodeText": rct, "mt5Order": mo, "mt5Deal": md,
            "fillPrice": fpx, "fillVolume": fvol, "spread": spread, "slippagePoints": slip, "latencyMs": lat,
            "request": json.loads(rj) if rj else None, "result": json.loads(sj) if sj else None, "createdAt": _iso(cat), "completedAt": _iso(dat)}


_ORDER_SELECT = ("SELECT id, request_id, execution_id, account_id, purpose, symbol, order_type, volume, requested_price, sl, tp, status, retcode, retcode_text, "
                 "mt5_order, mt5_deal, fill_price, fill_volume, spread, slippage_points, latency_ms, request_json, result_json, created_at, completed_at FROM dbo.app_exec_order")


def orders(eid: str | None = None, limit: int = 120) -> list[dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        if eid:
            cur.execute(_ORDER_SELECT + " WHERE execution_id=? ORDER BY id", eid)
        else:
            cur.execute(_ORDER_SELECT.replace("SELECT ", f"SELECT TOP {int(limit)} ", 1) + " ORDER BY id DESC")
        return [_order_row(r) for r in cur.fetchall()]


def deals_upsert(account_id: str, eid: str | None, deals: list[dict[str, Any]]) -> int:
    n = 0
    with connect() as conn:
        cur = conn.cursor()
        for dl in deals:
            cur.execute(
                """
                IF NOT EXISTS (SELECT 1 FROM dbo.app_exec_deal WHERE account_id=? AND deal_ticket=?)
                INSERT INTO dbo.app_exec_deal (account_id, deal_ticket, execution_id, mt5_order, mt5_position, symbol, side, entry, volume, price,
                  commission, swap, fee, profit, magic, comment, reason, deal_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                account_id, dl["ticket"], account_id, dl["ticket"], eid, dl.get("order"), dl.get("position"), dl["symbol"], dl.get("side") or "",
                dl.get("entry") or "", dl["volume"], dl["price"], dl.get("commission") or 0, dl.get("swap") or 0, dl.get("fee") or 0,
                dl.get("profit") or 0, dl.get("magic"), (dl.get("comment") or "")[:64], dl.get("reason"), _ts(dl.get("time")),
            )
            n += max(0, cur.rowcount)
        conn.commit()
    return n


def deals(eid: str | None = None, limit: int = 120) -> list[dict[str, Any]]:
    sel = ("SELECT {top} account_id, deal_ticket, execution_id, mt5_order, mt5_position, symbol, side, entry, volume, price, commission, swap, fee, profit, "
           "magic, comment, reason, deal_time FROM dbo.app_exec_deal")
    with connect() as conn:
        cur = conn.cursor()
        if eid:
            cur.execute(sel.format(top="") + " WHERE execution_id=? ORDER BY deal_time, deal_ticket", eid)
        else:
            cur.execute(sel.format(top=f"TOP {int(limit)}") + " ORDER BY deal_time DESC, deal_ticket DESC")
        return [{"accountId": a, "ticket": int(t), "executionId": e, "order": o, "position": p, "symbol": s, "side": sd, "entry": en, "volume": v,
                 "price": px, "commission": c, "swap": sw, "fee": f, "profit": pr, "magic": mg, "comment": cm, "reason": rs, "time": _iso(tm)}
                for a, t, e, o, p, s, sd, en, v, px, c, sw, f, pr, mg, cm, rs, tm in cur.fetchall()]


# ---------------------------------------------------------------- reconciliation findings

def _recon(r: tuple) -> dict[str, Any]:
    (i, key, acct, eid, ticket, st, sev, detail, action, js, occ, first, last, res, by, at, note) = r
    return {"id": int(i), "itemKey": key, "accountId": acct, "executionId": eid, "ticket": ticket, "status": st, "severity": sev, "detail": detail,
            "action": action, "data": json.loads(js) if js else None, "occurrences": occ, "firstSeen": _iso(first), "lastSeen": _iso(last),
            "resolution": res, "resolvedBy": by, "resolvedAt": _iso(at), "note": note}


_RECON = ("id, item_key, account_id, execution_id, mt5_ticket, status, severity, detail, action, data_json, occurrences, first_seen, last_seen, "
          "resolution, resolved_by, resolved_at, resolution_note")


def recon_open(account_id: str | None = None) -> list[dict[str, Any]]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        if account_id:
            cur.execute(f"SELECT {_RECON} FROM dbo.app_exec_reconcile WHERE resolved_at IS NULL AND account_id=? ORDER BY id", account_id)
        else:
            cur.execute(f"SELECT {_RECON} FROM dbo.app_exec_reconcile WHERE resolved_at IS NULL ORDER BY id")
        return [_recon(r) for r in cur.fetchall()]


def recon_recent(limit: int = 60) -> list[dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT TOP {int(limit)} {_RECON} FROM dbo.app_exec_reconcile WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC")
        return [_recon(r) for r in cur.fetchall()]


def recon_raise(item: dict[str, Any]) -> tuple[int, bool]:
    """Open (or refresh) a finding keyed by item_key. Returns (id, created)."""
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM dbo.app_exec_reconcile WHERE item_key=? AND resolved_at IS NULL", item["itemKey"])
        r = cur.fetchone()
        if r:
            cur.execute("UPDATE dbo.app_exec_reconcile SET occurrences=occurrences+1, last_seen=SYSUTCDATETIME(), detail=?, severity=?, data_json=? WHERE id=?",
                        item["detail"][:800], item["severity"], _json(item.get("data")), int(r[0]))
            conn.commit()
            return int(r[0]), False
        cur.execute(
            "INSERT INTO dbo.app_exec_reconcile (item_key, account_id, execution_id, mt5_ticket, status, severity, detail, action, data_json) "
            "OUTPUT INSERTED.id VALUES (?,?,?,?,?,?,?,?,?)",
            item["itemKey"][:160], item["accountId"], item.get("executionId"), item.get("ticket"), item["status"], item["severity"], item["detail"][:800],
            (item.get("action") or None) and item["action"][:200], _json(item.get("data")),
        )
        rid = int(cur.fetchone()[0])
        if item.get("resolution"):
            cur.execute("UPDATE dbo.app_exec_reconcile SET resolution=?, resolved_by='stage9', resolved_at=SYSUTCDATETIME(), resolution_note=? WHERE id=?",
                        item["resolution"], (item.get("action") or "")[:400], rid)
        conn.commit()
        return rid, True


def recon_resolve(rid: int | None, key: str | None, resolution: str, actor: str, note: str | None) -> int:
    with connect() as conn:
        cur = conn.cursor()
        where, param = ("id=?", rid) if rid is not None else ("item_key=?", key)
        cur.execute(f"UPDATE dbo.app_exec_reconcile SET resolution=?, resolved_by=?, resolved_at=SYSUTCDATETIME(), resolution_note=? "
                    f"WHERE {where} AND resolved_at IS NULL", resolution[:24], actor[:64], (note or "")[:400], param)
        n = cur.rowcount
        conn.commit()
        return n


# ---------------------------------------------------------------- Stage 10 hand-off

def publish_trade(rec: dict[str, Any]) -> bool:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM dbo.app_exec_trade WHERE execution_id=?)
            INSERT INTO dbo.app_exec_trade (execution_id, account_id, account_class, currency, symbol, direction, setup_key, opened_at, closed_at, volume,
              entry_expected, entry_actual, exit_price, slippage_points, realized_pnl, commission, swap, risk_amount, r_multiple, duration_sec, exit_reason, trade_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            rec["executionId"], rec["executionId"], rec["accountId"], rec["accountClass"] or "DEMO", rec.get("currency") or "", rec["symbol"], rec["direction"],
            rec["setupKey"], _ts(rec.get("openedAt")), _ts(rec.get("closedAt")), float(rec.get("volume") or 0), rec.get("entryExpected"),
            rec.get("entryActual"), rec.get("exitPrice"), rec.get("slippagePoints"), float(rec.get("realizedPnl") or 0), float(rec.get("commission") or 0),
            float(rec.get("swap") or 0), rec.get("riskAmount"), rec.get("rMultiple"), rec.get("durationSec"), (rec.get("exitReason") or "UNKNOWN")[:48], _json(rec),
        )
        ok = cur.rowcount == 1
        conn.commit()
        return ok


_TRADE = ("execution_id, account_id, account_class, currency, symbol, direction, setup_key, opened_at, closed_at, volume, entry_expected, entry_actual, "
          "exit_price, slippage_points, realized_pnl, commission, swap, risk_amount, r_multiple, duration_sec, exit_reason, stage10_status, published_at, trade_json")


def trades(limit: int = 200, account_id: str | None = None, symbol: str | None = None, q: str | None = None, days: int | None = None) -> list[dict[str, Any]]:
    where, params = [], []
    if account_id:
        where.append("account_id=?")
        params.append(account_id)
    if symbol:
        where.append("symbol=?")
        params.append(symbol.upper())
    if days:
        where.append("closed_at >= DATEADD(day, ?, SYSUTCDATETIME())")
        params.append(-int(days))
    if q:
        where.append("(execution_id LIKE ? OR setup_key LIKE ? OR exit_reason LIKE ? OR symbol LIKE ?)")
        params += [f"%{q}%"] * 4
    sql = f"SELECT TOP {int(limit)} {_TRADE} FROM dbo.app_exec_trade" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY closed_at DESC"
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(sql, *params)
        out = []
        for (eid, acct, cls, ccy, sym, dr, key, oa, ca, vol, ee, ea, xp, slip, pnl, comm, swap, ra, rm, dur, reason, s10, pub, js) in cur.fetchall():
            t = json.loads(js)
            s7 = ((t.get("evidence") or {}).get("stage7") or {})
            out.append({"executionId": eid, "accountId": acct, "accountClass": cls, "currency": ccy, "symbol": sym, "direction": dr, "setupKey": key,
                        "openedAt": _iso(oa), "closedAt": _iso(ca), "volume": vol, "entryExpected": ee, "entryActual": ea, "exitPrice": xp,
                        "slippagePoints": slip, "realizedPnl": pnl, "commission": comm, "swap": swap, "riskAmount": ra, "rMultiple": rm,
                        "durationSec": dur, "exitReason": reason, "stage10Status": s10, "publishedAt": _iso(pub), "riskPct": t.get("riskPct"),
                        "setup": {"model": s7.get("model"), "trigger": s7.get("trigger"), "confidence": s7.get("confidence"), "zone": s7.get("zone")}})
        return out


# ---------------------------------------------------------------- upstream reads

def upstream(setup_key: str, symbol: str) -> dict[str, Any]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT active, setup_state, state FROM dbo.app_risk_opportunity WHERE setup_key=?", setup_key)
        o = cur.fetchone()
        cur.execute("SELECT state, direction, reason_code, invalidation_level FROM dbo.app_h1_instrument WHERE symbol=?", symbol)
        h = cur.fetchone()
    return {"opportunityActive": bool(o and o[0]), "setupState": o[1] if o else None, "opportunityState": o[2] if o else None,
            "stage7State": h[0] if h else None, "stage7Direction": h[1] if h else None, "stage7ReasonCode": h[2] if h else None,
            "stage7Invalidation": h[3] if h else None}


def stage7(symbol: str) -> dict[str, Any] | None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT state, direction, reason_code, reason FROM dbo.app_h1_instrument WHERE symbol=?", symbol)
        r = cur.fetchone()
    return None if not r else {"state": r[0], "direction": r[1], "reasonCode": r[2], "reason": r[3]}


def evidence(symbol: str) -> dict[str, Any]:
    """Compact Stage 2-7 decision snapshot for the instrument at the moment Stage 9 consumes the authorization."""
    out: dict[str, Any] = {}
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT state, direction, differential, macro_bias, relationship, alignment, trajectory, conviction, rank_no, reason "
                    "FROM dbo.app_scanner_instrument WHERE symbol=?", symbol)
        r = cur.fetchone()
        if r:
            out["stage2_3"] = {"differential": r[2], "macroBias": r[3], "relationship": r[4], "alignment": r[5], "trajectory": r[6]}
            out["stage4"] = {"state": r[0], "direction": r[1], "conviction": r[7], "rank": r[8], "reason": r[9]}
        cur.execute("SELECT status, primary_direction, agreement, phase, confidence, channel_position FROM dbo.app_vision_instrument WHERE symbol=?", symbol)
        r = cur.fetchone()
        if r:
            out["stage5"] = {"status": r[0], "direction": r[1], "agreement": r[2], "phase": r[3], "confidence": r[4], "channelPosition": r[5]}
        cur.execute("SELECT state, direction, reason_code, alignment, confidence, zone, structural_phase FROM dbo.app_direction_instrument WHERE symbol=?", symbol)
        r = cur.fetchone()
        if r:
            out["stage6"] = {"state": r[0], "direction": r[1], "reasonCode": r[2], "alignment": r[3], "confidence": r[4], "zone": r[5], "phase": r[6]}
        cur.execute("SELECT state, direction, reason_code, score, invalidation_level, confirmed_since FROM dbo.app_h1_instrument WHERE symbol=?", symbol)
        r = cur.fetchone()
        if r:
            out["stage7"] = {"state": r[0], "direction": r[1], "reasonCode": r[2], "score": r[3], "invalidation": r[4], "confirmedSince": _iso(r[5])}
    return out


def last_h1_close(symbol: str) -> float | None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT TOP 1 [close] FROM dbo.app_candles WHERE symbol=? AND timeframe='H1' ORDER BY open_ts DESC", symbol)
        r = cur.fetchone()
        return float(r[0]) if r else None


def mirror_positions(account_id: str, positions: list[dict[str, Any]], currency: str, links: dict[int, str]) -> None:
    """Keep the existing broker mirror (dbo.mt5_positions) current from the engine — Stage 8 and the UI read it."""
    rows = []
    for p in positions:
        eid = links.get(int(p["ticket"]))
        rows.append({"id": f"mt5-{p['ticket']}", "cacsmsTradeId": eid or f"MT5-{p['ticket']}", "mt5OrderId": str(p.get("identifier") or p["ticket"]),
                     "mt5DealId": None, "mt5PositionId": str(p["ticket"]), "symbol": p["symbol"], "side": p["side"], "volume": p["volume"],
                     "entry": p["priceOpen"], "current": p["priceCurrent"], "sl": p.get("sl"), "tp": p.get("tp"), "pnl": p["profit"], "currency": currency,
                     "status": "OPEN", "openedAt": ex.iso(p.get("time")) if p.get("time") else None})
    replace_positions(account_id, rows)


def stored_positions() -> list[dict[str, Any]]:
    return list_positions()


def save_meta(meta: dict[str, Any]) -> None:
    set_setting(META_KEY, _json(meta))


def load_meta() -> dict[str, Any] | None:
    raw = get_setting(META_KEY)
    try:
        return json.loads(raw) if raw else None
    except Exception:
        return None
