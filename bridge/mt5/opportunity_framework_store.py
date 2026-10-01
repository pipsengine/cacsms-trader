"""Persistence for classified opportunities: current row per opportunity, append-only transitions and counterfactual
outcome tracking for Stage 10 learning. Additive tables (018); existing opportunity/campaign tables are untouched."""

from __future__ import annotations

import json
from typing import Any, Callable

try:
    from db import ROOT, _iso, connect
except ImportError:  # pragma: no cover
    from bridge.mt5.db import ROOT, _iso, connect  # type: ignore

TERMINAL = frozenset(("COMPLETED", "INVALIDATED", "EXPIRED"))
COUNTERFACTUAL_FROM = frozenset(("READY_FOR_RISK", "WAITING", "BLOCKED", "AUTHORIZED"))
COUNTERFACTUAL_MAX_BARS = 120
TF_SEC = {"D1": 86400, "H8": 28800, "H4": 14400, "H1": 3600, "M15": 900, "M5": 300}

_schema_ready = False


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "018_opportunity_framework.sql").read_text(encoding="utf-8")
    with connect() as conn:
        cur = conn.cursor()
        for batch in (b.strip() for b in sql.split("\nGO") if b.strip()):
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


def _j(value: Any) -> str:
    return json.dumps(value, default=str)


def _start_counterfactual(h: dict[str, Any]) -> dict[str, Any] | None:
    """Hypothetical entry at the first actionable lifecycle. Measured afterwards on closed bars only."""
    room = h.get("room") or {}
    entry, stop = room.get("entry"), room.get("invalidation")
    if entry is None or stop is None or h["lifecycle"] not in COUNTERFACTUAL_FROM:
        return None
    risk = (float(entry) - float(stop)) * (1 if h["direction"] == "BULLISH" else -1)
    if risk <= 0:
        return None
    start = (h.get("dataFreshness") or {}).get("lastBarTs")
    return {"state": "OPEN", "fromLifecycle": h["lifecycle"], "entry": float(entry), "stop": float(stop), "target": room.get("target"),
            "sign": 1 if h["direction"] == "BULLISH" else -1, "startTs": int(start) if start else None,
            "timeframe": h.get("executionTimeframe") or "H1", "mfeR": 0.0, "maeR": 0.0, "bars": 0, "outcome": None}


def measure_counterfactual(cf: dict[str, Any], bars: list[tuple]) -> dict[str, Any]:
    """MFE/MAE in R from closed bars strictly after the start bar. First touch of stop or target resolves it."""
    if cf.get("state") != "OPEN" or not cf.get("startTs"):
        return cf
    sign, entry, stop = cf["sign"], cf["entry"], cf["stop"]
    risk = (entry - stop) * sign
    target = cf.get("target")
    mfe, mae, n = 0.0, 0.0, 0
    outcome = None
    for b in bars:
        if int(b[0]) <= int(cf["startTs"]):
            continue
        n += 1
        hi, lo = float(b[2]), float(b[3])
        fav = ((hi - entry) if sign > 0 else (entry - lo)) / risk
        adv = ((lo - entry) if sign > 0 else (entry - hi)) / risk
        mfe, mae = max(mfe, fav), min(mae, adv)
        hit_stop = adv <= -1.0
        hit_target = target is not None and ((hi >= float(target)) if sign > 0 else (lo <= float(target)))
        if hit_stop:  # same-bar ambiguity resolves conservatively to the stop
            outcome = "STOP_FIRST"
            break
        if hit_target:
            outcome = "TARGET_FIRST"
            break
        if n >= COUNTERFACTUAL_MAX_BARS:
            outcome = "TIMEOUT"
            break
    out = {**cf, "mfeR": round(mfe, 2), "maeR": round(mae, 2), "bars": n}
    if outcome:
        out.update({"state": "RESOLVED", "outcome": outcome})
    return out


def persist(state: dict[str, Any], symbols: list[str], bars_since: Callable[[str, str, int], list[tuple]] | None = None) -> list[dict[str, Any]]:
    """Upsert current hypotheses, record transitions and close vanished ones. Returns the transitions written."""
    ensure_schema()
    hyps = state.get("hypotheses") or []
    transitions: list[dict[str, Any]] = []
    evaluated = set(symbols)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT opportunity_id, lifecycle, detector_state, confirmation_state, revision, counterfactual_json, closed_at, "
                    "snapshot_json FROM dbo.app_opportunity_hypothesis WHERE closed_at IS NULL OR counterfactual_json LIKE '%\"OPEN\"%'")
        existing = {r[0]: r for r in cur.fetchall()}
        ids = [h["opportunityId"] for h in hyps if h["opportunityId"] not in existing]
        for i in range(0, len(ids), 200):
            chunk = ids[i:i + 200]
            cur.execute("SELECT opportunity_id, lifecycle, detector_state, confirmation_state, revision, counterfactual_json, closed_at, snapshot_json "
                        f"FROM dbo.app_opportunity_hypothesis WHERE opportunity_id IN ({','.join('?' for _ in chunk)})", *chunk)
            existing.update({r[0]: r for r in cur.fetchall()})
        seen: set[str] = set()
        for h in hyps:
            oid = h["opportunityId"]
            seen.add(oid)
            row = existing.get(oid)
            terminal = h["lifecycle"] in TERMINAL
            prev_snap = json.loads(row[7]) if row and row[7] else {}
            changed = not row or prev_snap.get("revision") != h.get("revision")
            if row and row[6] is not None and terminal and row[1] == h["lifecycle"]:
                continue  # already closed in this state
            cf = json.loads(row[5]) if row and row[5] else None
            if cf is None:
                cf = _start_counterfactual(h)
            revision = (int(row[4]) + (1 if changed else 0)) if row else 1
            values = (
                h["opportunityType"], _j(h.get("opportunityContext") or []), h["route"], h["mode"], h["symbol"], h["direction"],
                h.get("parentTimeframe"), h.get("childTimeframe"), h.get("executionTimeframe"), None if h.get("channelId") is None else str(h["channelId"]),
                h.get("channelRole"), h.get("triggerType"), h.get("triggerTime"), h.get("triggerPrice"), h["confirmationContractId"],
                h["confirmationState"], str(h.get("detectorState") or "")[:80], h["lifecycle"], _j(h["requiredEvidence"]), _j(h["satisfiedEvidence"]),
                _j(h["missingEvidence"]), _j(h["optionalEvidence"]), (h.get("invalidationReason") or None), h.get("confidence"), h.get("entryQuality"),
                None if h.get("campaignId") is None else str(h["campaignId"]), h.get("episodeId"), revision, h.get("riskGroup"),
                None if cf is None else _j(cf), _j(h),
            )
            if not row:
                cur.execute(
                    "INSERT INTO dbo.app_opportunity_hypothesis (opportunity_type, opportunity_context, route, mode, symbol, direction, parent_tf, child_tf, "
                    "execution_tf, channel_id, channel_role, trigger_type, trigger_ts, trigger_price, contract_id, confirmation_state, detector_state, "
                    "lifecycle, required_json, satisfied_json, missing_json, optional_json, invalidation_reason, confidence, entry_quality, campaign_id, "
                    "episode_id, revision, risk_group, counterfactual_json, snapshot_json, opportunity_id, framework_version, discovered_at, updated_at, "
                    "closed_at) VALUES (" + ",".join("?" for _ in range(33)) + ", SYSUTCDATETIME(), SYSUTCDATETIME(), "
                    + ("SYSUTCDATETIME()" if terminal else "NULL") + ")",
                    *values, oid, state.get("frameworkVersion") or "",
                )
            elif changed or (row[6] is not None and not terminal):
                cur.execute(
                    "UPDATE dbo.app_opportunity_hypothesis SET opportunity_type=?, opportunity_context=?, route=?, mode=?, symbol=?, direction=?, "
                    "parent_tf=?, child_tf=?, execution_tf=?, channel_id=?, channel_role=?, trigger_type=?, trigger_ts=?, trigger_price=?, contract_id=?, "
                    "confirmation_state=?, detector_state=?, lifecycle=?, required_json=?, satisfied_json=?, missing_json=?, optional_json=?, "
                    "invalidation_reason=?, confidence=?, entry_quality=?, campaign_id=?, episode_id=?, revision=?, risk_group=?, counterfactual_json=?, "
                    "snapshot_json=?, updated_at=SYSUTCDATETIME(), closed_at=" + ("COALESCE(closed_at, SYSUTCDATETIME())" if terminal else "NULL")
                    + " WHERE opportunity_id=?",
                    *values, oid,
                )
            if not row or row[1] != h["lifecycle"] or row[2] != str(h.get("detectorState") or "")[:80]:
                t = {"opportunityId": oid, "opportunityType": h["opportunityType"], "opportunityName": h.get("opportunityName"),
                     "symbol": h["symbol"], "direction": h["direction"], "episodeId": h.get("episodeId"), "mode": h["mode"],
                     "fromLifecycle": row[1] if row else None, "toLifecycle": h["lifecycle"], "fromState": row[2] if row else None,
                     "toState": str(h.get("detectorState") or "")[:80], "confirmationState": h["confirmationState"], "revision": revision,
                     "detail": "; ".join(h.get("whyNotReady") or [])[:600] or None, "hypothesis": h}
                _transition(cur, t)
                transitions.append(t)
        for oid, row in existing.items():
            if oid in seen or row[6] is not None:
                continue
            snap = json.loads(row[7]) if row[7] else {}
            if snap.get("symbol") not in evaluated:
                continue
            cur.execute("UPDATE dbo.app_opportunity_hypothesis SET lifecycle='EXPIRED', updated_at=SYSUTCDATETIME(), closed_at=SYSUTCDATETIME(), "
                        "revision=revision+1 WHERE opportunity_id=?", oid)
            t = {"opportunityId": oid, "opportunityType": snap.get("opportunityType"), "opportunityName": snap.get("opportunityName"),
                 "symbol": snap.get("symbol"), "direction": snap.get("direction"), "episodeId": snap.get("episodeId"), "mode": snap.get("mode"),
                 "fromLifecycle": row[1], "toLifecycle": "EXPIRED", "fromState": row[2], "toState": row[2], "confirmationState": row[3],
                 "revision": int(row[4]) + 1, "detail": "No longer reported by its detector (conditions lapsed)", "hypothesis": snap}
            _transition(cur, t)
            transitions.append(t)
        if bars_since:
            _update_counterfactuals(cur, bars_since)
        conn.commit()
    return transitions


def _transition(cur: Any, t: dict[str, Any]) -> None:
    cur.execute(
        "INSERT INTO dbo.app_opportunity_transition (opportunity_id, opportunity_type, symbol, episode_id, mode, from_lifecycle, to_lifecycle, "
        "from_state, to_state, confirmation_state, revision, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, SYSUTCDATETIME())",
        t["opportunityId"], t.get("opportunityType") or "", t.get("symbol") or "", t.get("episodeId"), t.get("mode") or "", t.get("fromLifecycle"),
        t["toLifecycle"], t.get("fromState"), t.get("toState"), t.get("confirmationState"), int(t.get("revision") or 0), t.get("detail"),
    )


def _update_counterfactuals(cur: Any, bars_since: Callable[[str, str, int], list[tuple]]) -> None:
    cur.execute("SELECT TOP 200 opportunity_id, symbol, counterfactual_json FROM dbo.app_opportunity_hypothesis "
                "WHERE counterfactual_json LIKE '%\"OPEN\"%' ORDER BY updated_at DESC")
    for oid, symbol, raw in cur.fetchall():
        cf = json.loads(raw)
        if cf.get("state") != "OPEN" or not cf.get("startTs"):
            continue
        try:
            bars = bars_since(symbol, cf.get("timeframe") or "H1", int(cf["startTs"]))
        except Exception:
            continue
        nxt = measure_counterfactual(cf, bars or [])
        if nxt != cf:
            cur.execute("UPDATE dbo.app_opportunity_hypothesis SET counterfactual_json=? WHERE opportunity_id=?", _j(nxt), oid)


def history(opportunity_id: str, limit: int = 200) -> dict[str, Any]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT snapshot_json, counterfactual_json, discovered_at, updated_at, closed_at, revision FROM dbo.app_opportunity_hypothesis "
                    "WHERE opportunity_id=?", opportunity_id)
        row = cur.fetchone()
        cur.execute(f"SELECT TOP {int(limit)} id, from_lifecycle, to_lifecycle, from_state, to_state, confirmation_state, revision, detail, created_at "
                    "FROM dbo.app_opportunity_transition WHERE opportunity_id=? ORDER BY id DESC", opportunity_id)
        rows = cur.fetchall()
    return {
        "ok": row is not None, "opportunityId": opportunity_id,
        "hypothesis": json.loads(row[0]) if row else None, "counterfactual": json.loads(row[1]) if row and row[1] else None,
        "discoveredAt": _iso(row[2]) if row else None, "updatedAt": _iso(row[3]) if row else None, "closedAt": _iso(row[4]) if row else None,
        "revision": row[5] if row else None,
        "transitions": [{"id": r[0], "fromLifecycle": r[1], "toLifecycle": r[2], "fromState": r[3], "toState": r[4], "confirmationState": r[5],
                         "revision": r[6], "detail": r[7], "at": _iso(r[8])} for r in rows],
    }


def recent_transitions(limit: int = 50) -> list[dict[str, Any]]:
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT TOP {int(limit)} id, opportunity_id, opportunity_type, symbol, mode, from_lifecycle, to_lifecycle, to_state, detail, created_at "
                    "FROM dbo.app_opportunity_transition ORDER BY id DESC")
        rows = cur.fetchall()
    return [{"id": r[0], "opportunityId": r[1], "opportunityType": r[2], "symbol": r[3], "mode": r[4], "fromLifecycle": r[5],
             "toLifecycle": r[6], "toState": r[7], "detail": r[8], "at": _iso(r[9])} for r in rows]


def learning_summary() -> dict[str, Any]:
    """Stage 10 by opportunity type: lifecycle reach and counterfactual MFE/MAE (R). Reporting only — nothing is auto-tuned."""
    ensure_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT opportunity_type, mode, lifecycle, counterfactual_json FROM dbo.app_opportunity_hypothesis")
        rows = cur.fetchall()
        cur.execute("SELECT opportunity_type, to_lifecycle, COUNT(*) FROM dbo.app_opportunity_transition GROUP BY opportunity_type, to_lifecycle")
        reach = cur.fetchall()
    out: dict[str, dict[str, Any]] = {}
    for op, mode, life, raw in rows:
        s = out.setdefault(op, {"opportunityType": op, "total": 0, "byMode": {}, "byLifecycle": {}, "reached": {}, "counterfactual":
                                {"tracked": 0, "resolved": 0, "targetFirst": 0, "stopFirst": 0, "timeout": 0, "avgMfeR": None, "avgMaeR": None}})
        s["total"] += 1
        s["byMode"][mode] = s["byMode"].get(mode, 0) + 1
        s["byLifecycle"][life] = s["byLifecycle"].get(life, 0) + 1
        if raw:
            cf = json.loads(raw)
            c = s["counterfactual"]
            c["tracked"] += 1
            c.setdefault("_mfe", []).append(cf.get("mfeR") or 0.0)
            c.setdefault("_mae", []).append(cf.get("maeR") or 0.0)
            if cf.get("state") == "RESOLVED":
                c["resolved"] += 1
                c["targetFirst"] += cf.get("outcome") == "TARGET_FIRST"
                c["stopFirst"] += cf.get("outcome") == "STOP_FIRST"
                c["timeout"] += cf.get("outcome") == "TIMEOUT"
    for op, life, n in reach:
        if op in out:
            out[op]["reached"][life] = int(n)
    for s in out.values():
        c = s["counterfactual"]
        mfe, mae = c.pop("_mfe", []), c.pop("_mae", [])
        c["avgMfeR"] = round(sum(mfe) / len(mfe), 2) if mfe else None
        c["avgMaeR"] = round(sum(mae) / len(mae), 2) if mae else None
    return {"ok": True, "byOpportunityType": out, "note": "Counterfactual outcomes are observational; thresholds are never auto-tuned from them"}
