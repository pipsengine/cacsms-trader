"""Stage 10 autonomous feedback loop.

Consumes immutable Stage 9 trade records and Stage 8 rejection decisions. It records outcomes and
diagnostic recommendations, but never changes trading or risk parameters itself.
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
    import risk_store
    from db import connect, get_setting
except ImportError:  # pragma: no cover
    from bridge.mt5 import autonomy_store as store  # type: ignore
    from bridge.mt5 import risk_store  # type: ignore
    from bridge.mt5.db import connect, get_setting  # type: ignore

SERVICE = {"loopSec": 30, "fullEverySec": 300}
# Recommendations outside this allow-list are never emitted.
# Only maxSpreadAtr may be tightened, and only when learning.autoApply explicitly lists it.
# Prop-firm rules and hard risk limits are never written.
PERMITTED_RECOMMENDATIONS = {"minRewardRisk", "maxSpreadAtr", "authorizationTtlSec", "partialAtR", "trailStartR"}
AUTO_APPLY = {"maxSpreadAtr"}


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

    def _trades(self) -> list[tuple]:
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("SELECT execution_id,account_id,symbol,setup_key,direction,realized_pnl,r_multiple,slippage_points,exit_reason,trade_json "
                        "FROM dbo.app_exec_trade WHERE stage10_status='PUBLISHED' ORDER BY published_at ASC")
            return cur.fetchall()

    def _rejections(self) -> list[tuple]:
        last_id = int(store.get_checkpoint("learning.risk_history_id", 0) or 0)
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id,setup_key,account_id,symbol,state,reason_code,reason,score,risk_pct,trigger_reason,created_at "
                        "FROM dbo.app_risk_history WHERE id>? AND state IN ('BLOCKED','REJECTED','EXPIRED','INELIGIBLE') ORDER BY id ASC", last_id)
            return cur.fetchall()

    @staticmethod
    def _recommendations(trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Evidence-only suggestions. An administrator must explicitly approve any later config change."""
        if len(trades) < 5:
            return []
        out: list[dict[str, Any]] = []
        slips = [abs(float(t["slippage"])) for t in trades if t.get("slippage") is not None]
        losses = [t for t in trades if float(t.get("r") or 0) < 0]
        if len(slips) >= 5 and sum(slips) / len(slips) > 3:
            out.append({"parameter": "maxSpreadAtr", "direction": "TIGHTEN", "reason": "Mean absolute slippage exceeded 3 points",
                        "sample": len(slips), "autoApplied": False})
        if len(losses) / len(trades) >= 0.7:
            out.append({"parameter": "minRewardRisk", "direction": "REVIEW_UP", "reason": "At least 70% of the evaluated sample lost",
                        "sample": len(trades), "autoApplied": False})
        return [r for r in out if r["parameter"] in PERMITTED_RECOMMENDATIONS]

    @staticmethod
    def _apply_permitted(recs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Tighten an explicitly listed parameter. A missing setting, a prop rule, or a looser value is never applied."""
        try:
            allowed = set(json.loads(get_setting("learning.autoApply") or "[]"))
        except Exception:
            allowed = set()
        allowed &= AUTO_APPLY
        for rec in recs:
            rec["autoApplied"] = False
            if rec.get("parameter") not in allowed or rec.get("direction") != "TIGHTEN":
                continue
            cfg, _ = risk_store.load_config()
            current = float(cfg["maxSpreadAtr"])
            tightened = round(max(0.01, current * 0.9), 4)
            if tightened >= current:
                continue
            result = risk_store.save_config({"maxSpreadAtr": tightened}, "stage10", str(rec.get("reason") or "Stage 10 tighten"))
            rec["autoApplied"] = bool(result.get("ok") and "maxSpreadAtr" in (result.get("changed") or []))
            rec["appliedValue"] = tightened if rec["autoApplied"] else None
        return recs

    def run(self, trigger: str) -> dict[str, Any]:
        with self._run_lock:
            started = time.time()
            trade_count = rejection_count = 0
            analysed: list[dict[str, Any]] = []
            for eid, aid, symbol, setup, direction, pnl, r_mult, slip, exit_reason, raw in self._trades():
                doc = json.loads(raw or "{}")
                mg = doc.get("management") or {}
                actual = {
                    "realizedPnl": pnl, "rMultiple": r_mult, "slippagePoints": slip, "exitReason": exit_reason,
                    "maeR": mg.get("maeR"), "mfeR": mg.get("mfeR"), "minPrice": mg.get("minPrice"), "maxPrice": mg.get("maxPrice"),
                    "executionQuality": doc.get("executionQuality"), "openedAt": doc.get("openedAt"), "closedAt": doc.get("closedAt"),
                }
                expected = {"direction": direction, "entry": doc.get("entryExpected"), "stopLoss": doc.get("stopLoss"),
                            "takeProfit": doc.get("takeProfit"), "riskAmount": doc.get("riskAmount"), "riskPct": doc.get("riskPct")}
                item = {"key": f"trade:{eid}", "kind": "TRADE", "executionId": eid, "setupKey": setup, "accountId": aid,
                        "symbol": symbol, "decision": "EXECUTED", "outcome": "WIN" if float(pnl or 0) > 0 else "LOSS" if float(pnl or 0) < 0 else "FLAT",
                        "confidence": (((doc.get("evidence") or {}).get("stage7") or {}).get("confidence")), "expected": expected, "actual": actual,
                        "evidence": doc.get("evidence") or {}}
                if store.record_learning(item):
                    trade_count += 1
                analysed.append({"r": r_mult, "slippage": slip})
                with connect() as conn:
                    cur = conn.cursor()
                    cur.execute("UPDATE dbo.app_exec_trade SET stage10_status='LEARNED' WHERE execution_id=? AND stage10_status='PUBLISHED'", eid)
                    conn.commit()

            last_rejection_id = None
            for rid, setup, aid, symbol, state, code, reason, score, risk_pct, why, created in self._rejections():
                last_rejection_id = int(rid)
                item = {"key": f"risk-history:{rid}", "kind": "REJECTION", "setupKey": setup, "accountId": aid, "symbol": symbol,
                        "decision": state, "outcome": "NOT_EXECUTED", "confidence": score,
                        "expected": {"riskPct": risk_pct}, "actual": {"executed": False},
                        "evidence": {"reasonCode": code, "reason": reason, "trigger": why, "decidedAt": str(created)}}
                if store.record_learning(item):
                    rejection_count += 1
            if last_rejection_id is not None:
                store.checkpoint("learning.risk_history_id", last_rejection_id)

            recs = self._apply_permitted(self._recommendations(analysed))
            duration = int((time.time() - started) * 1000)
            summary = {"message": f"Evaluated {trade_count} completed trade(s) and {rejection_count} rejected setup decision(s)",
                       "recommendations": recs, "permittedParameters": sorted(PERMITTED_RECOMMENDATIONS),
                       "autoApplied": any(r.get("autoApplied") for r in recs)}
            status = "HEALTHY"
            store.learning_run(trigger, status, trade_count, rejection_count, len(recs), duration, summary)
            self.meta.update({"status": status, "message": summary["message"], "runAt": datetime.now(timezone.utc).isoformat(),
                              "durationMs": duration, "tradesEvaluated": trade_count, "rejectionsEvaluated": rejection_count,
                              "recommendations": recs, "runs": int(self.meta.get("runs") or 0) + 1, "trigger": trigger})
            store.checkpoint("stage10.meta", self.meta)
            return self.meta
