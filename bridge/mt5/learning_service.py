"""Stage 10 autonomous feedback loop.

Consumes persisted Stage 9 trades and non-trade decisions from Stages 6–8.
It records evidence, diagnostics and candidate parameters. It does not write production trading parameters.
"""

from __future__ import annotations

import json
import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Any

try:
    import autonomy_store as store
    import learning as engine
    import risk_store
    from db import ROOT, connect, get_setting, set_setting
except ImportError:  # pragma: no cover
    from bridge.mt5 import autonomy_store as store  # type: ignore
    from bridge.mt5 import learning as engine  # type: ignore
    from bridge.mt5 import risk_store  # type: ignore
    from bridge.mt5.db import ROOT, connect, get_setting, set_setting  # type: ignore

SERVICE = {"loopSec": 30, "fullEverySec": 300}
SCHEMA_READY = False


class LearningService:
    def __init__(self):
        self._wake = threading.Event()
        self._triggers: set[str] = set()
        self._lock = threading.Lock()
        self._run_lock = threading.Lock()
        self._last_full = 0.0
        self.meta: dict[str, Any] = {"status": "STARTING", "message": "Stage 10 starting", "runs": 0, "errors": 0}
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        store.ensure_schema()
        ensure_learning_schema()
        self.thread = threading.Thread(target=self._loop, name="learning-stage10", daemon=True)
        self.thread.start()

    def mark(self, reason: str, *_: Any) -> None:
        with self._lock:
            self._triggers.add(reason)
        self._wake.set()

    def _loop(self) -> None:
        time.sleep(8)
        self.mark("STARTUP_RECOVERY")
        while True:
            self._wake.wait(timeout=SERVICE["loopSec"])
            self._wake.clear()
            if time.time() - self._last_full >= SERVICE["fullEverySec"]:
                self._last_full = time.time()
                self.mark("PERIODIC_CATCHUP")
            with self._lock:
                triggers, self._triggers = sorted(self._triggers), set()
            if not triggers:
                continue
            try:
                self.run("; ".join(triggers))
            except Exception as exc:  # pragma: no cover
                self.meta["errors"] = int(self.meta.get("errors") or 0) + 1
                self.meta["lastError"] = f"{type(exc).__name__}: {exc}"
                traceback.print_exc()

    def _trades(self, pending_only: bool = False) -> list[tuple]:
        where = " WHERE stage10_status='PUBLISHED'" if pending_only else ""
        with connect() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT execution_id,account_id,account_class,currency,symbol,setup_key,direction,realized_pnl,r_multiple,"
                "slippage_points,exit_reason,opened_at,closed_at,trade_json,stage10_status "
                f"FROM dbo.app_exec_trade{where} ORDER BY published_at ASC"
            )
            return cur.fetchall()

    def _rejections(self) -> list[tuple]:
        last_id = int(store.get_checkpoint("learning.risk_history_id", 0) or 0)
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id,setup_key,account_id,symbol,state,reason_code,reason,score,risk_pct,trigger_reason,created_at "
                        "FROM dbo.app_risk_history WHERE id>? AND state IN ('BLOCKED','REJECTED','EXPIRED','INELIGIBLE') ORDER BY id ASC", last_id)
            return cur.fetchall()

    def run(self, trigger: str) -> dict[str, Any]:
        with self._run_lock:
            started = time.time()
            ensure_learning_schema()
            trade_count = self._ingest_trades()
            econ_count = self._ingest_economic()
            rejection_count = self._ingest_rejections()
            rejection_count += self._ingest_direction()
            rejection_count += self._ingest_h1()
            trades = [engine.normalize_trade(_trade_row(r)) for r in self._trades()]
            production, _ = risk_store.load_config()
            self._ensure_baseline(production)
            plan = engine.proposals(trades, production)
            self._apply_validation(plan["proposals"], trades)
            self._store_proposals(plan["proposals"])
            self._monitor(trades)
            status = engine.health(len(trades), rejection_count, plan["lifecycle"], None, "run")
            if status == "HEALTHY" and plan["lifecycle"] in ("BACKTEST", "VALIDATE", "SHADOW"):
                status = "VALIDATING"
            duration = int((time.time() - started) * 1000)
            summary = {
                "message": plan["message"] if not trades else f"Recorded {len(trades)} closed trade(s) and {rejection_count} new non-trade decision(s). {plan['message']}",
                "lifecycle": plan["lifecycle"],
                "sampleSufficient": plan["sampleSufficient"],
                "recommendations": plan["proposals"],
                "autoApplied": False,
                "productionUnchanged": not self._promoted_live(),
                "governance": governance(),
                "economicOutcomes": econ_count,
            }
            if not trades and not rejection_count:
                summary["message"] = plan["message"]
            if econ_count:
                summary["message"] += f" Recorded {econ_count} economic outcome(s) as diagnostics. Live risk parameters were not changed."
            store.learning_run(trigger, status[:16], trade_count, rejection_count, len(plan["proposals"]), duration, summary)
            self.meta.update({
                "status": status, "message": summary["message"], "runAt": datetime.now(timezone.utc).isoformat(),
                "durationMs": duration, "tradesEvaluated": len(trades), "rejectionsEvaluated": rejection_count,
                "recommendations": plan["proposals"], "lifecycle": plan["lifecycle"],
                "runs": int(self.meta.get("runs") or 0) + 1, "trigger": trigger, "lastError": None,
            })
            store.checkpoint("stage10.meta", self.meta)
            try:
                store.world(
                    "BOOK", 10, engine_health=status, pipeline_state=plan["lifecycle"], freshness="CURRENT",
                    trigger=trigger[:240], current_action=summary["message"][:240],
                    next_action="Keep collecting closes and rejections; production parameters stay unchanged",
                    evidence={"trades": len(trades), "decisions": rejection_count, "proposals": len(plan["proposals"])},
                    evaluated_at=self.meta["runAt"],
                )
            except Exception:
                traceback.print_exc()
            return self.meta

    def _ingest_trades(self) -> int:
        count = 0
        for row in self._trades(pending_only=True):
            item_row = _trade_row(row)
            doc = item_row["doc"]
            mg = doc.get("management") or {}
            norm = engine.normalize_trade(item_row)
            item = {
                "key": norm["key"], "kind": "TRADE", "executionId": item_row["executionId"], "setupKey": item_row["setupKey"],
                "accountId": item_row["accountId"], "symbol": item_row["symbol"], "decision": "EXECUTED", "outcome": norm["outcome"],
                "confidence": norm["confidence"],
                "expected": {"direction": item_row["direction"], "entry": doc.get("entryExpected"), "stopLoss": doc.get("stopLoss"),
                             "takeProfit": doc.get("takeProfit"), "riskAmount": doc.get("riskAmount"), "setup": norm["setup"]},
                "actual": {"realizedPnl": item_row["realizedPnl"], "rMultiple": item_row["rMultiple"], "slippagePoints": item_row["slippagePoints"],
                           "exitReason": item_row["exitReason"], "maeR": mg.get("maeR"), "mfeR": mg.get("mfeR")},
                "evidence": doc.get("evidence") or {},
            }
            if store.record_learning(item):
                count += 1
            with connect() as conn:
                cur = conn.cursor()
                cur.execute("UPDATE dbo.app_exec_trade SET stage10_status='LEARNED' WHERE execution_id=? AND stage10_status='PUBLISHED'", item_row["executionId"])
                conn.commit()
        return count

    def _ingest_economic(self) -> int:
        """Completed calendar outcomes become learning evidence. Recommendations stay diagnostic."""
        try:
            import economic_store
        except ImportError:  # pragma: no cover
            from bridge.mt5 import economic_store  # type: ignore
        count = 0
        ids: list[int] = []
        for row in economic_store.unpublished_outcomes():
            outcome = row["outcome"]
            surprise = outcome.get("surprise") if isinstance(outcome.get("surprise"), dict) else {}
            item = {
                "key": f"econ:{row['eventId']}:{row['symbol']}", "kind": "ECON_EVENT", "symbol": row["symbol"],
                "decision": "OBSERVED", "outcome": surprise.get("interpretation"),
                "expected": {"forecast": outcome.get("forecast"), "previous": outcome.get("previous"), "title": outcome.get("title")},
                "actual": {"actual": outcome.get("actual"), "move5m": outcome.get("move5m"), "move15m": outcome.get("move15m"),
                           "move30m": outcome.get("move30m"), "move1h": outcome.get("move1h"), "spread": outcome.get("spreadSpikePct")},
                "evidence": outcome, "recommendation": {"note": "Diagnostic only. Live risk and trading parameters were not changed."},
            }
            if store.record_learning(item):
                count += 1
            ids.append(int(row["id"]))
        economic_store.mark_outcomes_published(ids)
        return count

    def _ingest_rejections(self) -> int:
        last_rejection_id = None
        count = 0
        for rid, setup, aid, symbol, state, code, reason, score, risk_pct, why, created in self._rejections():
            last_rejection_id = int(rid)
            item = {"key": f"risk-history:{rid}", "kind": "REJECTION", "setupKey": setup, "accountId": aid, "symbol": symbol,
                    "decision": state, "outcome": "NOT_EXECUTED", "confidence": score,
                    "expected": {"riskPct": risk_pct}, "actual": {"executed": False},
                    "evidence": {"reasonCode": code, "reason": reason, "trigger": why, "decidedAt": str(created), "stage": 8, **_fresh_upstream(symbol, created)}}
            if store.record_learning(item):
                count += 1
        if last_rejection_id is not None:
            store.checkpoint("learning.risk_history_id", last_rejection_id)
        return count

    def _ingest_direction(self) -> int:
        last_id = int(store.get_checkpoint("learning.direction_history_id", 0) or 0)
        count = 0
        try:
            with connect() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT id,symbol,state,direction,reason_code,explanation,confidence,channel_position,alignment,created_at "
                    "FROM dbo.app_direction_history WHERE id>? AND state IN ('BLOCKED','INVALIDATED','NO_TRADE') ORDER BY id ASC",
                    last_id,
                )
                rows = cur.fetchall()
        except Exception:
            return 0
        newest = last_id
        for rid, symbol, state, direction, code, explanation, confidence, position, alignment, created in rows:
            newest = int(rid)
            item = {"key": f"direction-history:{rid}", "kind": "NO_TRADE", "symbol": symbol, "decision": state,
                    "outcome": "NOT_EXECUTED", "confidence": confidence,
                    "evidence": {"reasonCode": code, "reason": explanation, "direction": direction, "channelPosition": position,
                                 "alignment": alignment, "decidedAt": str(created), "stage": 6, **_fresh_upstream(symbol, created)}}
            if store.record_learning(item):
                count += 1
        if newest != last_id:
            store.checkpoint("learning.direction_history_id", newest)
        return count

    def _ingest_h1(self) -> int:
        last_id = int(store.get_checkpoint("learning.h1_history_id", 0) or 0)
        count = 0
        try:
            with connect() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT id,symbol,state,direction,reason_code,explanation,score,stage6_state,created_at "
                    "FROM dbo.app_h1_history WHERE id>? AND state IN ('REJECTED','INVALIDATED','BLOCKED') ORDER BY id ASC",
                    last_id,
                )
                rows = cur.fetchall()
        except Exception:
            return 0
        newest = last_id
        for rid, symbol, state, direction, code, explanation, score, stage6, created in rows:
            newest = int(rid)
            item = {"key": f"h1-history:{rid}", "kind": state if state in ("REJECTED", "INVALIDATED") else "NO_TRADE",
                    "symbol": symbol, "decision": state, "outcome": "NOT_EXECUTED", "confidence": score,
                    "evidence": {"reasonCode": code, "reason": explanation, "direction": direction, "h1State": state,
                                 "stage6State": stage6, "decidedAt": str(created), "timeframe": "H1", "stage": 7, **_fresh_upstream(symbol, created)}}
            if store.record_learning(item):
                count += 1
        if newest != last_id:
            store.checkpoint("learning.h1_history_id", newest)
        return count

    def _store_proposals(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        ensure_learning_schema()
        with connect() as conn:
            cur = conn.cursor()
            for row in rows:
                cur.execute("SELECT proposal_key FROM dbo.app_learning_proposal WHERE proposal_key=?", row["key"])
                if cur.fetchone():
                    cur.execute(
                        "UPDATE dbo.app_learning_proposal SET lifecycle=?,reason=?,sample_size=?,production_value=?,candidate_value=?,evidence_json=?,updated_at=SYSUTCDATETIME() "
                        "WHERE proposal_key=? AND applied=0",
                        row["lifecycle"], row["reason"][:600], int(row["sample"]), row.get("productionValue"), row.get("candidateValue"),
                        json.dumps({"evidenceKeys": row.get("evidenceKeys") or [], "validation": row.get("validation") or {}}), row["key"],
                    )
                else:
                    cur.execute(
                        "INSERT INTO dbo.app_learning_proposal (proposal_key,parameter,lifecycle,direction,reason,sample_size,required_size,production_value,candidate_value,applied,evidence_json) "
                        "VALUES (?,?,?,?,?,?,?,?,?,0,?)",
                        row["key"], row["parameter"], row["lifecycle"], row["direction"], row["reason"][:600], int(row["sample"]),
                        int(row["required"]), row.get("productionValue"), row.get("candidateValue"),
                        json.dumps({"evidenceKeys": row.get("evidenceKeys") or [], "validation": row.get("validation") or {}}),
                    )
            conn.commit()

    def _apply_validation(self, rows: list[dict[str, Any]], trades: list[dict[str, Any]]) -> None:
        stored = {p["key"]: p for p in _proposals()}
        for row in rows:
            prev = stored.get(row["key"])
            frozen = prev and (prev.get("applied") or prev.get("lifecycle") in ("SHADOW", "MONITOR", "ROLLBACK"))
            if frozen:
                row["lifecycle"] = prev["lifecycle"]
                row["validation"] = (prev.get("evidence") or {}).get("validation") or {}
                continue
            verdict = engine.validate_candidate(trades, row)
            row["lifecycle"] = verdict["lifecycle"]
            row["validation"] = verdict
        if governance() != "AUTO":
            return
        for row in rows:
            prev = stored.get(row["key"]) or {}
            if prev.get("lifecycle") != "SHADOW" or prev.get("applied") or not prev.get("updatedAt"):
                continue
            later = [t for t in trades if str(t.get("closedAt") or "") > str(prev.get("updatedAt"))]
            if len(later) < engine.MIN_OOS:
                continue
            self.approve(row["parameter"], "stage10-governance")

    def _ensure_baseline(self, production: dict[str, Any]) -> None:
        params = {k: v for k, v in production.items() if not str(k).startswith("_")}
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM dbo.app_learning_version WHERE kind='BASELINE'")
            if cur.fetchone():
                return
            cur.execute(
                "INSERT INTO dbo.app_learning_version (version_label,kind,parameters_json,metrics_json,predecessor_id,comparison,note) "
                "VALUES (?,?,?,?,?,?,?)",
                ("production-baseline", "BASELINE", json.dumps(params, default=str), None, None, "BASELINE",
                 "Observed live risk configuration. This row is not a promotion and does not change parameters."),
            )
            conn.commit()

    def _promoted_live(self) -> bool:
        versions = _versions()
        return bool(versions) and versions[-1]["kind"] == "PROMOTED"

    def _monitor(self, trades: list[dict[str, Any]]) -> None:
        versions = _versions()
        if not versions or versions[-1]["kind"] != "PROMOTED" or versions[-1].get("comparison") in ("IMPROVED", "DEGRADED"):
            return
        latest = versions[-1]
        after = [t for t in trades if str(t.get("closedAt") or "") > str(latest.get("createdAt") or "")]
        slips = [abs(float(t["slippagePoints"])) for t in after if t.get("slippagePoints") is not None]
        if len(slips) < engine.MIN_OOS:
            return
        before = [t for t in trades if str(t.get("closedAt") or "") <= str(latest.get("createdAt") or "")]
        before_slips = [abs(float(t["slippagePoints"])) for t in before if t.get("slippagePoints") is not None]
        if len(before_slips) < engine.MIN_OOS:
            return
        comparison = "IMPROVED" if (sum(slips) / len(slips)) < (sum(before_slips) / len(before_slips)) else "DEGRADED"
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE dbo.app_learning_version SET comparison=? WHERE id=?", comparison, latest["id"])
            conn.commit()

    def approve(self, parameter: str, actor: str) -> dict[str, Any]:
        row = next((p for p in _proposals() if p["parameter"] == parameter), None)
        if not row:
            return {"ok": False, "message": "No candidate is stored for that parameter."}
        allowed, message = engine.promotion_allowed({**row, "validation": (row.get("evidence") or {}).get("validation") or {}})
        if not allowed:
            return {"ok": False, "message": message}
        result = risk_store.save_config({parameter: row["candidateValue"]}, (actor or "operator")[:64], f"Stage 10 approved {parameter}")
        if not result.get("ok"):
            return {"ok": False, "message": "; ".join(result.get("errors") or ["Risk configuration rejected the candidate."])}
        if not result.get("changed"):
            return {"ok": True, "message": "Production already holds this value. No version was promoted.", "changed": []}
        predecessor = _versions()[-1]["id"] if _versions() else None
        self._write_version("PROMOTED", f"promoted-{parameter}", result.get("config") or {}, predecessor, "PROMOTED_UNPROVEN",
                            "Copied onto production after an explicit approval. Later closes decide IMPROVED or DEGRADED.")
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE dbo.app_learning_proposal SET applied=1,lifecycle='MONITOR',updated_at=SYSUTCDATETIME() WHERE proposal_key=?", row["key"])
            conn.commit()
        return {"ok": True, "message": f"{parameter} is now the production value. Rollback restores the previous version.", "changed": result.get("changed")}

    def rollback(self, actor: str) -> dict[str, Any]:
        versions = _version_rows()
        promoted = [v for v in versions if v["kind"] == "PROMOTED"]
        if not promoted:
            return {"ok": False, "message": "No promoted version exists. The live risk configuration is unchanged."}
        latest = promoted[-1]
        predecessor = next((v for v in versions if v["id"] == latest.get("predecessorId")), None)
        if not predecessor:
            return {"ok": False, "message": "The promoted version has no predecessor to restore."}
        result = risk_store.save_config(predecessor["parameters"], (actor or "operator")[:64], "Stage 10 rollback")
        if not result.get("ok"):
            return {"ok": False, "message": "; ".join(result.get("errors") or ["Risk configuration rejected the rollback."])}
        self._write_version("ROLLBACK", "rollback", result.get("config") or predecessor["parameters"], latest["id"], "ROLLED_BACK",
                            "Restored the predecessor parameters. The candidate is off production again.")
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE dbo.app_learning_proposal SET applied=0,lifecycle='ROLLBACK',updated_at=SYSUTCDATETIME() WHERE applied=1")
            conn.commit()
        return {"ok": True, "message": "Production parameters were restored from the predecessor version.", "changed": result.get("changed") or []}

    def set_governance(self, mode: str) -> dict[str, Any]:
        value = str(mode or "").upper()
        if value not in ("MANUAL", "AUTO"):
            return {"ok": False, "message": "Governance is MANUAL or AUTO."}
        set_setting("learning.governance", value)
        return {"ok": True, "governance": value, "message": "MANUAL keeps every candidate off production until Approve. AUTO can promote only after a later shadow sample."}

    def _write_version(self, kind: str, label: str, params: dict[str, Any], predecessor: int | None, comparison: str, note: str) -> None:
        with connect() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO dbo.app_learning_version (version_label,kind,parameters_json,metrics_json,predecessor_id,comparison,note) VALUES (?,?,?,?,?,?,?)",
                (label, kind, json.dumps(params, default=str), None, predecessor, comparison, note),
            )
            conn.commit()

    def snapshot(self, query: dict[str, list[str]] | None = None) -> dict[str, Any]:
        ensure_learning_schema()
        query = query or {}
        trades = [engine.normalize_trade(_trade_row(r)) for r in self._trades()]
        decisions = [_evaluation_row(r) for r in _evaluations()]
        accounts = sorted({*(t.get("accountId") or "" for t in trades), *(d.get("accountId") or "" for d in decisions if d.get("accountId"))} - {""})
        symbols = sorted({*(t.get("symbol") or "" for t in trades + decisions)} - {""})
        classes = sorted({t.get("accountClass") or "UNKNOWN" for t in trades} | {d.get("accountClass") or "UNKNOWN" for d in decisions})
        filtered_trades = _filter_rows(trades, query)
        filtered_decisions = [_with_path(row) for row in _filter_rows(decisions, query)]
        perf = engine.performance(filtered_trades)
        plan_trades = filtered_trades
        production, _ = risk_store.load_config()
        self._ensure_baseline(production)
        plan = engine.proposals(plan_trades, production)
        versions = _versions()
        stored_plans = _proposals()
        verdict = ((stored_plans[0].get("evidence") or {}).get("validation") or {}) if stored_plans else {}
        return {
            "ok": True,
            "health": {
                "status": self.meta.get("status") or "WAITING",
                "message": self.meta.get("message") or "Stage 10 is collecting evidence. Production parameters are unchanged.",
                "runAt": self.meta.get("runAt"),
                "durationMs": self.meta.get("durationMs"),
                "trigger": self.meta.get("trigger"),
                "closedTrades": len(trades),
                "decisions": len(decisions),
                "filteredTrades": len(filtered_trades),
                "sampleSufficient": plan["sampleSufficient"],
                "requiredTrades": engine.MIN_PROPOSAL,
                "sliceSize": engine.MIN_SLICE,
                "lifecycle": stored_plans[0]["lifecycle"] if stored_plans else plan["lifecycle"],
                "modelVersion": versions[-1]["label"] if versions else "production-unmodified",
                "candidateVersion": next((p["parameter"] for p in stored_plans if not p["applied"]), None),
                "validation": verdict.get("status") or ("NOT_RUN" if not stored_plans else "CANDIDATE_ONLY"),
                "governance": governance(),
                "nextCycle": "TRADE_CLOSED, SETUP_REJECTED, SETUP_INVALIDATED, POSITION_MANAGED, MODEL_OUTCOME_AVAILABLE, PARAMETER_CHANGED, or the 5 minute catch-up",
                "productionUnchanged": not self._promoted_live(),
            },
            "performance": perf,
            "analytics": engine.analytics(filtered_trades),
            "insights": engine.insights(filtered_trades, filtered_decisions),
            "proposals": _proposals(),
            "versions": versions,
            "trades": filtered_trades,
            "decisions": filtered_decisions,
            "filters": {
                "accounts": accounts,
                "classes": classes,
                "symbols": symbols,
                "setups": ["UNSPECIFIED", *engine.SETUP_CLASSES],
                "relationships": ["PRIMARY", "COUNTER_TREND", "REVERSAL", "UNSPECIFIED"],
                "regimes": _distinct(trades + decisions, "regime"),
                "sessions": _distinct(trades + decisions, "session"),
                "timeframes": _distinct(trades + decisions, "timeframe"),
                "modelVersions": _distinct(trades + decisions, "modelVersion"),
            },
        }


def ensure_learning_schema() -> None:
    global SCHEMA_READY
    if SCHEMA_READY:
        return
    sql = (ROOT / "database" / "mssql" / "012_learning.sql").read_text(encoding="utf-8")
    with connect() as conn:
        cur = conn.cursor()
        for batch in (b.strip() for b in sql.split("\nGO") if b.strip()):
            cur.execute(batch)
        conn.commit()
    SCHEMA_READY = True


def _loads(raw: Any) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def _trade_row(row: tuple) -> dict[str, Any]:
    eid, aid, klass, currency, symbol, setup, direction, pnl, r_mult, slip, exit_reason, opened, closed, raw, _status = row
    return {
        "executionId": eid, "accountId": aid, "accountClass": klass, "currency": currency, "symbol": symbol,
        "setupKey": setup, "direction": direction, "realizedPnl": pnl, "rMultiple": r_mult, "slippagePoints": slip,
        "exitReason": exit_reason, "openedAt": str(opened) if opened else None, "closedAt": str(closed) if closed else None,
        "doc": _loads(raw),
    }


def _evaluations() -> list[tuple]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT evaluation_key,kind,execution_id,setup_key,account_id,symbol,decision,outcome,confidence,evidence_json "
            "FROM dbo.app_learning_evaluation ORDER BY created_at DESC"
        )
        return cur.fetchall()


def _evaluation_row(row: tuple) -> dict[str, Any]:
    key, kind, eid, setup, aid, symbol, decision, outcome, confidence, raw = row
    return engine.normalize_decision({
        "key": key, "kind": kind, "executionId": eid, "setupKey": setup, "accountId": aid, "symbol": symbol,
        "decision": decision, "outcome": outcome, "confidence": confidence, "evidence": _loads(raw),
    })


def _proposals() -> list[dict[str, Any]]:
    ensure_learning_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT proposal_key,parameter,lifecycle,direction,reason,sample_size,required_size,production_value,candidate_value,applied,evidence_json,updated_at "
            "FROM dbo.app_learning_proposal ORDER BY updated_at DESC"
        )
        rows = cur.fetchall()
    out = []
    for key, parameter, lifecycle, direction, reason, sample, required, production, candidate, applied, evidence, updated in rows:
        out.append({
            "key": key, "parameter": parameter, "lifecycle": lifecycle, "direction": direction, "reason": reason,
            "sample": int(sample), "required": int(required), "productionValue": production, "candidateValue": candidate,
            "applied": bool(applied), "evidence": _loads(evidence), "updatedAt": str(updated) if updated else None,
        })
    return out


def _versions() -> list[dict[str, Any]]:
    ensure_learning_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id,version_label,kind,comparison,note,created_at FROM dbo.app_learning_version ORDER BY id ASC")
        rows = cur.fetchall()
    return [{"id": int(i), "label": label, "kind": kind, "comparison": comparison, "note": note, "createdAt": str(created) if created else None}
            for i, label, kind, comparison, note, created in rows]


def _filter_rows(rows: list[dict[str, Any]], query: dict[str, list[str]]) -> list[dict[str, Any]]:
    def one(name: str) -> str:
        values = query.get(name) or []
        return str(values[0]).strip() if values and values[0] not in (None, "", "ALL") else ""

    account = one("accountId")
    klass = one("accountClass").upper()
    symbol = one("symbol").upper()
    setup = one("setup")
    relation = one("relationship")
    regime = one("regime")
    session = one("session")
    timeframe = one("timeframe")
    model = one("modelVersion")
    start = one("from")
    end = one("to")
    out = []
    for row in rows:
        if account and str(row.get("accountId") or "") != account:
            continue
        if klass and str(row.get("accountClass") or "UNKNOWN").upper() != klass:
            continue
        if symbol and str(row.get("symbol") or "").upper() != symbol:
            continue
        if setup and str(row.get("setup") or "") != setup:
            continue
        if relation and str(row.get("relationship") or "") != relation:
            continue
        if regime and str(row.get("regime") or "") != regime:
            continue
        if session and str(row.get("session") or "") != session:
            continue
        if timeframe and str(row.get("timeframe") or "") != timeframe:
            continue
        if model and str(row.get("modelVersion") or "") != model:
            continue
        stamp = str(row.get("closedAt") or "")
        if start and stamp and stamp < start:
            continue
        if end and stamp and stamp > end + "T23:59:59":
            continue
        out.append(row)
    return out


def governance() -> str:
    raw = str(get_setting("learning.governance") or "MANUAL").upper()
    return raw if raw in ("MANUAL", "AUTO") else "MANUAL"


def _distinct(rows: list[dict[str, Any]], key: str) -> list[str]:
    return sorted({str(row.get(key)) for row in rows if row.get(key) not in (None, "")})


def _version_rows() -> list[dict[str, Any]]:
    ensure_learning_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id,kind,parameters_json,predecessor_id,comparison FROM dbo.app_learning_version ORDER BY id ASC")
        rows = cur.fetchall()
    return [{
        "id": int(i), "kind": kind, "parameters": _loads(params),
        "predecessorId": int(pred) if pred else None, "comparison": comparison,
    } for i, kind, params, pred, comparison in rows]


def _recent(created: Any) -> bool:
    try:
        if isinstance(created, datetime):
            stamp = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
        else:
            stamp = datetime.fromisoformat(str(created).replace("Z", "").replace(" ", "T"))
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=timezone.utc)
        return abs((datetime.now(timezone.utc) - stamp).total_seconds()) <= 900
    except Exception:
        return False


def _fresh_upstream(symbol: str, created: Any) -> dict[str, Any]:
    """Attach the current Stage 2–5 world row only when the decision itself is current."""
    if not symbol or not _recent(created):
        return {}
    names = {2: "strength", 3: "regimeDetail", 4: "scanner", 5: "vision"}
    upstream: dict[str, Any] = {}
    try:
        with connect() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT stage,pipeline_state,blocker FROM dbo.app_world_instrument WHERE symbol=? AND stage IN (2,3,4,5)",
                symbol,
            )
            for stage, state, blocker in cur.fetchall():
                name = names.get(int(stage))
                if name and (state or blocker):
                    upstream[name] = {"state": state, "blocker": blocker}
    except Exception:
        return {}
    return {"upstream": upstream} if upstream else {}


def _epoch(stamp: Any) -> float | None:
    if isinstance(stamp, (int, float)):
        return float(stamp)
    text = str(stamp or "").strip()
    if not text:
        return None
    if text.isdigit():
        return float(text)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "").replace(" ", "T"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def _with_path(row: dict[str, Any]) -> dict[str, Any]:
    closes: list[float] = []
    symbol, stamp = row.get("symbol"), _epoch(row.get("closedAt"))
    if symbol and stamp is not None:
        try:
            with connect() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT TOP 24 [close] FROM dbo.app_candles WHERE symbol=? AND timeframe='H1' AND open_ts>=? ORDER BY open_ts ASC",
                    symbol, stamp,
                )
                closes = [float(item[0]) for item in cur.fetchall() if item[0] is not None]
        except Exception:
            closes = []
    direction = row.get("direction") if isinstance(row.get("direction"), str) else None
    path = engine.price_diagnosis(
        executed=row.get("kind") == "TRADE" or row.get("decision") == "EXECUTED",
        direction=direction,
        closes=closes,
        slippage=row.get("slippagePoints"),
    )
    return {**row, "path": path}
