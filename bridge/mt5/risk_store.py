"""SQL Server access for Stage 8 Opportunities & Risk: Stage 7 hand-offs + Stage 5 boundaries in, opportunities, account
evaluations, exposure snapshots, decision history, immutable execution authorizations, audited risk configuration out."""

from __future__ import annotations

import json
import math
from typing import Any

try:
    import history_store
    import risk
    import vision
    import vision_service
    import vision_store
    from db import ROOT, _iso, connect, get_setting, list_accounts, list_positions, set_setting
except ImportError:  # pragma: no cover
    from bridge.mt5 import history_store, risk, vision, vision_service, vision_store  # type: ignore
    from bridge.mt5.db import ROOT, _iso, connect, get_setting, list_accounts, list_positions, set_setting  # type: ignore

_schema_ready = False
META_KEY = "risk.last_run"
CONFIG_KEY = "risk.config"


def ensure_risk_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "009_opportunity_risk.sql").read_text(encoding="utf-8")
    batches = [b.strip() for b in sql.split("\nGO") if b.strip()]
    with connect() as conn:
        cur = conn.cursor()
        for batch in batches:
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


def _ts(v: Any) -> str | None:
    """Epoch / ISO → SQL DATETIME2 literal (UTC)."""
    t = risk.parse_ts(v)
    return None if t is None else risk.iso(t)[:26].replace("T", " ")


# ---------------------------------------------------------------- configuration (centralized app_settings + audit)

def load_overrides() -> dict[str, Any]:
    raw = get_setting(CONFIG_KEY)
    try:
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


def load_config() -> tuple[dict[str, Any], dict[str, Any]]:
    overrides = load_overrides()
    cfg, errors = risk.merge_config(overrides)
    if errors:  # a corrupted stored value never loosens risk: fall back to defaults and report
        cfg, _ = risk.merge_config({})
        cfg["_errors"] = errors
    return cfg, overrides


def save_config(changes: dict[str, Any], actor: str, reason: str | None) -> dict[str, Any]:
    ensure_risk_schema()
    before, overrides = load_config()
    before.pop("_errors", None)
    merged = {**overrides, **(changes or {})}
    merged = {k: v for k, v in merged.items() if v is not None}
    after, errors = risk.merge_config(merged)
    if errors:
        return {"ok": False, "errors": errors}
    changed = sorted(k for k in risk.CONFIG if json.dumps(before.get(k), sort_keys=True) != json.dumps(after.get(k), sort_keys=True))
    if not changed:
        return {"ok": True, "changed": [], "config": after, "hash": risk.config_hash(after)}
    stored = {k: after[k] for k in risk.CONFIG if json.dumps(after[k], sort_keys=True) != json.dumps(risk.CONFIG[k], sort_keys=True)}
    critical = any(k in risk.CRITICAL_KEYS for k in changed)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.app_risk_config_audit (actor, changed_keys, critical, before_hash, after_hash, before_json, after_json, reason)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (actor or "operator")[:64], ", ".join(changed)[:600], 1 if critical else 0, risk.config_hash(before), risk.config_hash(after),
            json.dumps({k: before.get(k) for k in changed}, default=str), json.dumps({k: after.get(k) for k in changed}, default=str),
            (reason or "")[:400],
        )
        conn.commit()
    set_setting(CONFIG_KEY, json.dumps(stored))
    if "riskPerTradePct" in changed:
        set_setting("riskLimit", str(after["riskPerTradePct"]))
    return {"ok": True, "changed": changed, "critical": critical, "config": after, "hash": risk.config_hash(after)}


def config_audit(limit: int = 30) -> list[dict[str, Any]]:
    ensure_risk_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT TOP {int(limit)} id, changed_at, actor, changed_keys, critical, before_hash, after_hash, before_json, after_json, reason "
                    "FROM dbo.app_risk_config_audit ORDER BY id DESC")
        out = []
        for i, at, actor, keys, crit, bh, ah, bj, aj, reason in cur.fetchall():
            out.append({"id": int(i), "changedAt": _iso(at), "actor": actor, "changedKeys": keys, "critical": bool(crit), "beforeHash": bh,
                        "afterHash": ah, "before": json.loads(bj or "{}"), "after": json.loads(aj or "{}"), "reason": reason})
        return out


# ---------------------------------------------------------------- upstream reads

def _boundaries(symbol: str) -> dict[str, Any]:
    """Current (forming-bar) D1 / H8 channel boundaries from the persisted Stage 5 definitions."""
    out: dict[str, Any] = {}
    for tf in ("D1", "H8"):
        ch = vision_store.channel_analysis(symbol, tf)
        a = (ch or {}).get("analysis") or {}
        defn = a.get("def")
        if not defn:
            continue
        rows = history_store.candle_tail(symbol, tf, vision.TF_CFG[tf]["lookback"] + vision_service.CONFIG["extraBars"])
        lines = vision.channel_lines(defn, [r[0] for r in rows], 1, tf)
        if lines:
            last = lines[-1]
            out[tf] = {"lower": float(last["lower"]), "upper": float(last["upper"]), "ts": int(last["ts"]), "status": a.get("status"),
                       "direction": a.get("direction")}
    return out


def handoffs() -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Stage 7 CONFIRMED hand-offs (enriched with H1 ATR + current D1/H8 boundaries) and every symbol's Stage 7 state."""
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol, state, reason_code, reason, confirmed, decision_json, confirmed_since FROM dbo.app_h1_instrument")
        rows = cur.fetchall()
    out, states = [], {}
    for sym, st, code, reason, confirmed, js, since in rows:
        states[sym] = {"state": st, "reasonCode": code, "reason": reason}
        if not confirmed or st != "CONFIRMED":
            continue
        try:
            o = json.loads(js)
        except Exception:
            continue
        h = o.get("handoff")
        if not h:
            continue
        out.append({**h, "confirmedSince": _iso(since), "atr": (o.get("h1") or {}).get("atr"), "boundaries": _boundaries(sym)})
    return out, states


def accounts() -> list[dict[str, Any]]:
    rows = list_accounts()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, updated_at FROM dbo.mt5_accounts")
        upd = {i: at for i, at in cur.fetchall()}
    positions = list_positions()
    for a in rows:
        a["snapshotAt"] = _iso(upd.get(a["id"]))
        a["positions"] = [p for p in positions if p.get("accountId") == a["id"] and str(p.get("status") or "OPEN").upper() == "OPEN"]
    return rows


def baselines(day_start_utc: float) -> dict[str, dict[str, Any]]:
    """Per account: first equity snapshot of the server day and the all-time peak equity (dbo.account_balances)."""
    start = risk.iso(day_start_utc)[:26].replace("T", " ")
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT b.account_id, MAX(b.equity) AS peak,
                   (SELECT TOP 1 x.equity FROM dbo.account_balances x WHERE x.account_id = b.account_id AND x.as_of >= ? ORDER BY x.as_of ASC) AS day_first,
                   (SELECT TOP 1 x.as_of FROM dbo.account_balances x WHERE x.account_id = b.account_id AND x.as_of >= ? ORDER BY x.as_of ASC) AS day_first_at
            FROM dbo.account_balances b GROUP BY b.account_id
            """,
            start, start,
        )
        return {a: {"peakEquity": float(p) if p is not None else None, "dayFirstEquity": float(f) if f is not None else None,
                    "dayFirstAt": _iso(fa)} for a, p, f, fa in cur.fetchall()}


def record_balance(account_id: str, snap: dict[str, Any]) -> None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO dbo.account_balances (account_id, currency, balance, equity, margin, free_margin, profit) VALUES (?,?,?,?,?,?,?)",
            account_id, snap["currency"], snap["balance"], snap["equity"], snap["margin"], snap["freeMargin"], snap.get("profit") or 0,
        )
        conn.commit()


def auto_enabled() -> bool:
    return str(get_setting("auto") or "").lower() == "true"


def authorization_context() -> dict[str, Any]:
    ensure_risk_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT authorization_json, status FROM dbo.app_risk_authorization WHERE status = 'PENDING'")
        pending = []
        for js, st in cur.fetchall():
            try:
                pending.append({**json.loads(js), "status": st})
            except Exception:
                continue
        cur.execute("SELECT setup_key, account_id, MAX(attempt) FROM dbo.app_risk_authorization GROUP BY setup_key, account_id")
        attempts = {(k, a): int(n) for k, a, n in cur.fetchall()}
        cur.execute("SELECT setup_key, account_id FROM dbo.app_risk_approval")
        approvals = {(k, a) for k, a in cur.fetchall()}
        handed: dict[tuple[str, str], dict[str, Any]] = {}
        inflight: list[dict[str, Any]] = []
        if cur.execute("SELECT OBJECT_ID(N'dbo.app_exec_ledger', N'U')").fetchone()[0] is not None:
            cur.execute("SELECT a.setup_key, a.account_id, a.status, a.execution_id, a.authorization_json, l.order_state, l.position_state "
                        "FROM dbo.app_risk_authorization a LEFT JOIN dbo.app_exec_ledger l ON l.execution_id = a.execution_id "
                        "WHERE a.status IN ('CONSUMED', 'DECLINED')")
            for k, a, st, eid, js, ost, pst in cur.fetchall():
                handed[(k, a)] = {"status": st, "executionId": eid, "orderState": ost, "positionState": pst}
                # consumed but no confirmed broker position yet: its risk is still committed
                if st == "CONSUMED" and pst is None and ost in ("SUBMITTING", "ACKNOWLEDGED", "UNKNOWN", "RECONCILING"):
                    try:
                        inflight.append({**json.loads(js), "status": st, "inFlight": True})
                    except Exception:
                        continue
    return {"pending": pending, "attempts": attempts, "approvals": approvals, "handedOff": handed, "inflight": inflight}


def correlations(symbols: list[str], lookback: int) -> dict[tuple[str, str], float]:
    """Pearson correlation of aligned D1 log returns from the Stage 1 closed-candle store."""
    series: dict[str, dict[int, float]] = {}
    for s in sorted(set(symbols)):
        rows = history_store.candle_tail(s, "D1", lookback + 1)
        rets = {}
        for (t0, *_a, c0), (t1, *_b, c1) in zip(rows, rows[1:]):
            if c0 and c1 and c0 > 0 and c1 > 0:
                rets[int(t1)] = math.log(c1 / c0)
        series[s] = rets
    out: dict[tuple[str, str], float] = {}
    syms = sorted(series)
    for i, a in enumerate(syms):
        for b in syms[i + 1:]:
            common = sorted(set(series[a]) & set(series[b]))
            if len(common) < max(20, lookback // 2):
                continue
            x = [series[a][t] for t in common]
            y = [series[b][t] for t in common]
            mx, my = sum(x) / len(x), sum(y) / len(y)
            sx = math.sqrt(sum((v - mx) ** 2 for v in x))
            sy = math.sqrt(sum((v - my) ** 2 for v in y))
            if sx > 0 and sy > 0:
                out[(a, b)] = sum((p - mx) * (q - my) for p, q in zip(x, y)) / (sx * sy)
    return out


# ---------------------------------------------------------------- writes

def _hist(cur: Any, key: str, account: str | None, sym: str, state: str, prev: str | None, code: str, reason: str, score: Any,
          volume: Any, risk_pct: Any, trig: str) -> None:
    cur.execute(
        """
        INSERT INTO dbo.app_risk_history (setup_key, account_id, symbol, state, prev_state, reason_code, reason, score, volume, risk_pct, trigger_reason)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """,
        key, account, sym, state, prev, code[:48], (reason or "")[:600], score, volume, risk_pct, trig[:200],
    )


def _auth_event(cur: Any, eid: str, status: str, reason: str) -> None:
    cur.execute("INSERT INTO dbo.app_risk_authorization_event (execution_id, status, reason) VALUES (?,?,?)", eid, status, (reason or "")[:400])


def persist(result: dict[str, Any], meta: dict[str, Any], triggers: list[str], prev: dict[str, dict[str, Any]],
            stage7: dict[str, dict[str, Any]], exposure_changed: list[str]) -> dict[str, Any]:
    """Upsert opportunities + account evaluations, close withdrawn setups, insert new authorizations, revoke / expire pending ones,
    append history + exposure snapshots, and a run row when anything changed."""
    ensure_risk_schema()
    trig = ", ".join(triggers)[:200]
    now = meta["runAt"][:26].replace("T", " ")
    opps = result["opportunities"]
    current = {o["setupKey"] for o in opps}
    changed = 0
    created: list[str] = []
    revoked: list[str] = []
    expired: list[str] = []
    with connect() as conn:
        cur = conn.cursor()
        # expire / revoke pending authorizations first (status transitions only — terms are immutable)
        cur.execute("SELECT execution_id FROM dbo.app_risk_authorization WHERE status = 'PENDING' AND expires_at <= ?", now)
        for (eid,) in cur.fetchall():
            cur.execute("UPDATE dbo.app_risk_authorization SET status='EXPIRED', status_reason=?, status_at=? WHERE execution_id=? AND status='PENDING'",
                        "Not consumed by Stage 9 before expiry", now, eid)
            _auth_event(cur, eid, "EXPIRED", "Not consumed by Stage 9 before expiry")
            expired.append(eid)
        for r in result.get("revocations") or []:
            cur.execute("UPDATE dbo.app_risk_authorization SET status='REVOKED', status_reason=?, status_at=? WHERE execution_id=? AND status='PENDING'",
                        r["reason"][:400], now, r["executionId"])
            if cur.rowcount:
                _auth_event(cur, r["executionId"], "REVOKED", r["reason"])
                revoked.append(r["executionId"])
        for a in result.get("authorizations") or []:
            cur.execute("SELECT 1 FROM dbo.app_risk_authorization WHERE execution_id=?", a["executionId"])
            if cur.fetchone():
                continue
            cur.execute(
                """
                INSERT INTO dbo.app_risk_authorization (execution_id, setup_key, attempt, account_id, symbol, broker_symbol, direction, volume,
                  entry_policy_json, stop_loss, take_profit, risk_amount, risk_currency, risk_pct, expires_at, source_json, evidence_json,
                  authorization_json, config_hash, authorized_at, status, status_reason, status_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                a["executionId"], a["setupKey"], a["attempt"], a["accountId"], a["instrument"], a["brokerSymbol"], a["direction"], a["volume"],
                json.dumps(a["entryPolicy"]), a["stopLoss"], a["takeProfit"], a["riskAmount"], a["riskCurrency"], a["riskPct"], _ts(a["expiresAt"]),
                json.dumps(a["source"], default=str), json.dumps(a["evidence"], default=str), json.dumps(a, default=str), a["configHash"] or "",
                _ts(a["authorizedAt"]), "PENDING", "Awaiting Stage 9", now,
            )
            _auth_event(cur, a["executionId"], "PENDING", f"Authorized {a['direction']} {a['volume']} {a['instrument']} for {a['accountId']}")
            created.append(a["executionId"])
        # opportunities
        for o in opps:
            key = o["setupKey"]
            p = prev.get(key)
            is_changed = p is None or risk.signature(p) != risk.signature(o)
            g = o.get("geometry") or {}
            params = [o["symbol"], o["direction"], o["state"], o["setupState"], o["reasonCode"][:48], (o["reason"] or "")[:600], float(o["score"]),
                      o.get("confidence"), g.get("entry"), g.get("stopLoss"), g.get("takeProfit"), g.get("rewardRisk"), o["eligibleAccounts"],
                      o["authorizedAccounts"], o.get("proposedRiskPct"), _ts(o.get("confirmedSince")), _ts(o.get("expiresAt")),
                      trig if is_changed else ((p or {}).get("trigger") or trig), json.dumps(o, default=str)]
            cur.execute(
                f"""
                MERGE dbo.app_risk_opportunity AS t USING (SELECT ? AS setup_key) AS s ON t.setup_key = s.setup_key
                WHEN MATCHED THEN UPDATE SET symbol=?, direction=?, state=?, setup_state=?, reason_code=?, reason=?, score=?, confidence=?,
                  entry_price=?, stop_loss=?, take_profit=?, reward_risk=?, eligible_accounts=?, authorized_accounts=?, proposed_risk_pct=?,
                  confirmed_since=?, expires_at=?, trigger_reason=?, opportunity_json=?, active=1, evaluated_at=SYSUTCDATETIME()
                  {", changed_at=?" if is_changed else ""}
                WHEN NOT MATCHED THEN INSERT (setup_key, symbol, direction, state, setup_state, reason_code, reason, score, confidence, entry_price,
                  stop_loss, take_profit, reward_risk, eligible_accounts, authorized_accounts, proposed_risk_pct, confirmed_since, expires_at,
                  trigger_reason, opportunity_json, changed_at) VALUES (?, {', '.join('?' for _ in params)}, ?);
                """,
                key, *params, *([now] if is_changed else []), key, *params, now,
            )
            if is_changed:
                changed += 1
                _hist(cur, key, None, o["symbol"], o["state"], (p or {}).get("state"), o["reasonCode"], o["reason"], o["score"], None,
                      o.get("proposedRiskPct"), trig)
            prev_acc = {e.get("accountId"): e for e in (p or {}).get("accounts") or []}
            for e in o["accounts"]:
                pe = prev_acc.get(e["accountId"])
                s = e.get("sizing") or {}
                e_changed = pe is None or (pe.get("state"), pe.get("reasonCode"), (pe.get("sizing") or {}).get("volume")) != (e["state"], e["reasonCode"], s.get("volume"))
                eparams = [e["state"], e["reasonCode"][:48], (e["reason"] or "")[:600], s.get("volume"), s.get("riskMoney"), e.get("currency"),
                           s.get("riskPct"), s.get("marginRequired"), json.dumps(e, default=str)]
                cur.execute(
                    f"""
                    MERGE dbo.app_risk_account_eval AS t USING (SELECT ? AS setup_key, ? AS account_id) AS s
                      ON t.setup_key = s.setup_key AND t.account_id = s.account_id
                    WHEN MATCHED THEN UPDATE SET state=?, reason_code=?, reason=?, volume=?, risk_amount=?, risk_currency=?, risk_pct=?,
                      margin_required=?, eval_json=?, evaluated_at=SYSUTCDATETIME() {", changed_at=?" if e_changed else ""}
                    WHEN NOT MATCHED THEN INSERT (setup_key, account_id, state, reason_code, reason, volume, risk_amount, risk_currency, risk_pct,
                      margin_required, eval_json, changed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?);
                    """,
                    key, e["accountId"], *eparams, *([now] if e_changed else []), key, e["accountId"], *eparams, now,
                )
                if e_changed:
                    _hist(cur, key, e["accountId"], o["symbol"], e["state"], (pe or {}).get("state"), e["reasonCode"], e["reason"], o["score"],
                          s.get("volume"), s.get("riskPct"), trig)
        # setups Stage 7 no longer confirms: close them with the exact upstream reason
        cur.execute("SELECT setup_key, symbol, state FROM dbo.app_risk_opportunity WHERE active = 1")
        for key, sym, st in cur.fetchall():
            if key in current:
                continue
            s7 = stage7.get(sym) or {}
            reason = f"Stage 7 no longer confirms {sym}: now {s7.get('state') or 'not evaluated'} ({s7.get('reasonCode') or '—'})"
            cur.execute("UPDATE dbo.app_risk_opportunity SET active=0, state='EXPIRED', reason_code='STAGE7_WITHDRAWN', reason=?, changed_at=?, "
                        "evaluated_at=SYSUTCDATETIME() WHERE setup_key=?", reason[:600], now, key)
            cur.execute("UPDATE dbo.app_risk_account_eval SET state='EXPIRED', reason_code='STAGE7_WITHDRAWN', reason=?, changed_at=? WHERE setup_key=?",
                        reason[:600], now, key)
            _hist(cur, key, None, sym, "EXPIRED", st, "STAGE7_WITHDRAWN", reason, None, None, None, trig)
            changed += 1
        # exposure snapshots for accounts whose risk picture changed
        for a in result.get("accounts") or []:
            if a["accountId"] not in exposure_changed:
                continue
            cur.execute(
                "INSERT INTO dbo.app_risk_exposure (account_id, open_risk_pct, pending_risk_pct, daily_loss_pct, drawdown_pct, equity, snapshot_json) "
                "VALUES (?,?,?,?,?,?,?)",
                a["accountId"], a["openRiskPct"], a["pendingRiskPct"], a.get("dailyLossPct"), a.get("drawdownPct"), a.get("equity"),
                json.dumps(a, default=str),
            )
        run_id = None
        total = changed + len(created) + len(revoked) + len(expired)
        if total:
            c = meta["counters"]
            cur.execute(
                """
                INSERT INTO dbo.app_risk_run (run_at, triggers, status, candidates, qualified, authorized, blocked, changed, duration_ms, summary_json)
                OUTPUT INSERTED.id VALUES (?,?,?,?,?,?,?,?,?,?)
                """,
                now, ", ".join(triggers)[:400], meta["status"], c["candidates"], c["qualified"], c["authorized"], c["blocked"], total,
                int(meta.get("durationMs") or 0),
                json.dumps({"counters": c, "created": created, "revoked": revoked, "expired": expired}, default=str),
            )
            run_id = int(cur.fetchone()[0])
        conn.commit()
    return {"changed": changed, "created": created, "revoked": revoked, "expired": expired, "runId": run_id}


def previous_opportunities() -> dict[str, dict[str, Any]]:
    ensure_risk_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT opportunity_json, trigger_reason FROM dbo.app_risk_opportunity WHERE active = 1")
        out = {}
        for js, trig in cur.fetchall():
            try:
                o = json.loads(js)
                o["trigger"] = trig
                out[o["setupKey"]] = o
            except Exception:
                continue
        return out


def approve(setup_key: str, account_id: str, actor: str) -> dict[str, Any]:
    ensure_risk_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT state, reason_code FROM dbo.app_risk_account_eval WHERE setup_key=? AND account_id=?", setup_key, account_id)
        r = cur.fetchone()
        if not r:
            return {"ok": False, "message": "No Stage 8 evaluation for this setup / account"}
        if r[1] != "AWAITING_APPROVAL":
            return {"ok": False, "message": f"Evaluation is {r[0]} ({r[1]}) — only AWAITING_APPROVAL results can be approved"}
        cur.execute("IF NOT EXISTS (SELECT 1 FROM dbo.app_risk_approval WHERE setup_key=? AND account_id=?) "
                    "INSERT INTO dbo.app_risk_approval (setup_key, account_id, approved_by) VALUES (?,?,?)",
                    setup_key, account_id, setup_key, account_id, (actor or "operator")[:64])
        conn.commit()
    return {"ok": True, "message": f"Approved {setup_key} for {account_id} — re-evaluating"}


def save_meta(meta: dict[str, Any]) -> None:
    set_setting(META_KEY, json.dumps(meta, default=str))


def load_meta() -> dict[str, Any] | None:
    raw = get_setting(META_KEY)
    try:
        return json.loads(raw) if raw else None
    except Exception:
        return None


# ---------------------------------------------------------------- reads for the UI + Stage 9

_AUTH_COLS = "authorization_json, status, status_reason, status_at"


def _auth(js: str, st: str, reason: str | None, at: Any) -> dict[str, Any] | None:
    try:
        a = json.loads(js)
    except Exception:
        return None
    a.update({"status": st, "statusReason": reason, "statusAt": _iso(at)})
    return a


def authorizations(status: str | None = None, limit: int = 60, setup_key: str | None = None) -> list[dict[str, Any]]:
    ensure_risk_schema()
    sql = f"SELECT TOP {int(limit)} {_AUTH_COLS} FROM dbo.app_risk_authorization"
    where, params = [], []
    if status:
        where.append("status = ?")
        params.append(status)
    if setup_key:
        where.append("setup_key = ?")
        params.append(setup_key)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY authorized_at DESC"
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(sql, *params)
        return [a for a in (_auth(*r) for r in cur.fetchall()) if a]


def _history(r: tuple) -> dict[str, Any]:
    (i, key, acct, sym, st, pst, code, reason, score, vol, rp, trig, at) = r
    return {"id": int(i), "setupKey": key, "accountId": acct, "symbol": sym, "state": st, "prevState": pst, "reasonCode": code, "reason": reason,
            "score": score, "volume": vol, "riskPct": rp, "trigger": trig, "createdAt": _iso(at)}


_HIST = "id, setup_key, account_id, symbol, state, prev_state, reason_code, reason, score, volume, risk_pct, trigger_reason, created_at"


def load_state() -> dict[str, Any]:
    ensure_risk_schema()
    cfg, overrides = load_config()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT opportunity_json, active, state, reason_code, reason, changed_at, evaluated_at, trigger_reason FROM dbo.app_risk_opportunity "
                    "WHERE active = 1 OR changed_at >= DATEADD(hour, -24, SYSUTCDATETIME()) ORDER BY active DESC, changed_at DESC")
        opps = []
        for js, active, st, code, reason, ch, ev, trig in cur.fetchall()[:60]:
            try:
                o = json.loads(js)
            except Exception:
                continue
            if not active:
                o.update({"state": st, "reasonCode": code, "reason": reason})
            o.update({"active": bool(active), "changedAt": _iso(ch), "evaluatedAt": _iso(ev), "trigger": trig})
            opps.append(o)
        cur.execute(f"SELECT TOP 100 {_HIST} FROM dbo.app_risk_history ORDER BY id DESC")
        history = [_history(r) for r in cur.fetchall()]
        cur.execute("SELECT TOP 30 id, run_at, triggers, status, candidates, qualified, authorized, blocked, changed, duration_ms FROM dbo.app_risk_run ORDER BY id DESC")
        runs = [{"id": int(i), "runAt": _iso(at), "triggers": tr, "status": st, "candidates": ca, "qualified": q, "authorized": au, "blocked": bl,
                 "changed": ch, "durationMs": ms} for i, at, tr, st, ca, q, au, bl, ch, ms in cur.fetchall()]
    return {"ok": True, "run": load_meta(), "opportunities": opps, "authorizations": authorizations(limit=40), "history": history, "runs": runs,
            "config": {k: v for k, v in cfg.items() if k != "_errors"}, "configErrors": cfg.get("_errors"), "overrides": overrides,
            "configHash": risk.config_hash({k: v for k, v in cfg.items() if k != "_errors"}), "defaults": risk.CONFIG, "bounds": risk.BOUNDS,
            "criticalKeys": sorted(risk.CRITICAL_KEYS), "audit": config_audit(20)}


def load_detail(setup_key: str) -> dict[str, Any]:
    ensure_risk_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT opportunity_json, active, state, reason_code, reason, changed_at, evaluated_at FROM dbo.app_risk_opportunity WHERE setup_key=?", setup_key)
        r = cur.fetchone()
        opp = None
        if r:
            opp = json.loads(r[0])
            if not r[1]:
                opp.update({"state": r[2], "reasonCode": r[3], "reason": r[4]})
            opp.update({"active": bool(r[1]), "changedAt": _iso(r[5]), "evaluatedAt": _iso(r[6])})
        cur.execute(f"SELECT TOP 200 {_HIST} FROM dbo.app_risk_history WHERE setup_key=? ORDER BY id DESC", setup_key)
        history = [_history(x) for x in cur.fetchall()]
        cur.execute("SELECT e.execution_id, e.status, e.reason, e.created_at FROM dbo.app_risk_authorization_event e "
                    "JOIN dbo.app_risk_authorization a ON a.execution_id = e.execution_id WHERE a.setup_key=? ORDER BY e.id DESC", setup_key)
        events = [{"executionId": i, "status": s, "reason": rs, "createdAt": _iso(at)} for i, s, rs, at in cur.fetchall()]
    return {"ok": True, "setupKey": setup_key, "opportunity": opp, "history": history, "authorizations": authorizations(setup_key=setup_key, limit=50),
            "authorizationEvents": events}
