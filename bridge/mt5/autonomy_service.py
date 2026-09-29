"""Central durable orchestrator and market world model for the existing S1-S10 engines.

The specialist engines keep their proven calculations. This service owns durable triggers, restart recovery,
dependency hand-offs, job idempotency, heartbeat and the cross-stage per-instrument operational view.
Engine health and an instrument's pipeline state are stored separately: a healthy engine can still be
waiting, blocked or stale on one symbol without stopping the other instruments.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable

try:
    import analysis_gate
    import autonomy_store as store
    import channel_store, confirm_store, direction_store, execution_store, risk_store, scanner_store, vision_store
except ImportError:  # pragma: no cover
    from bridge.mt5 import analysis_gate, autonomy_store as store  # type: ignore
    from bridge.mt5 import channel_store, confirm_store, direction_store, execution_store, risk_store, scanner_store, vision_store  # type: ignore

SERVICE = {"loopSec": 1, "heartbeatSec": 5, "worldRefreshSec": 15, "regimeRefreshSec": 60}
# Vision marks are symbol-scoped. One symbol's failure retries only that symbol.
PER_SYMBOL_ACTIONS = {"MARK_VISION"}
OPEN_POSITION = {"OPEN", "PROTECTED", "MANAGING", "PARTIAL_EXIT", "BREAKEVEN", "TRAILING", "EXIT_PENDING"}
STAGE_ACTION = {
    2: (2, "RUN_REGIME"), 3: (2, "RUN_REGIME"), 4: (4, "MARK_SCANNER"), 5: (5, "MARK_VISION"),
    6: (6, "MARK_DIRECTION"), 7: (7, "MARK_CONFIRM"), 8: (8, "MARK_RISK"), 9: (9, "MARK_EXECUTION"),
    10: (10, "RUN_LEARNING"),
}


def _version(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True).encode()).hexdigest()[:20]


def _engine_health(meta: dict[str, Any] | None, *, fallback: str = "OFFLINE") -> str:
    status = str((meta or {}).get("status") or "").upper()
    if status in ("HEALTHY", "RUNNING"):
        return "HEALTHY"
    if status in ("ERROR", "FAILED"):
        return "ERROR"
    if status:
        return "DEGRADED"
    return fallback


class AutonomousOrchestrator:
    def __init__(self, symbols: list[str], regime_run: Callable[[dict[str, Any]], dict[str, Any]], scanner: Any, vision: Any,
                 direction: Any, confirm: Any, risk: Any, execution: Any, learning: Any,
                 connected_fn: Callable[[], bool], world_reader: Callable[[], dict[str, Any]] | None = None,
                 channels: Any = None):
        self.symbols = symbols
        self.regime_run = regime_run
        self.channels = channels
        self.scanner, self.vision, self.direction = scanner, vision, direction
        self.confirm, self.risk, self.execution, self.learning = confirm, risk, execution, learning
        self.connected_fn = connected_fn
        self.world_reader = world_reader
        self.node = os.environ.get("MT5_NODE_ID", "CACSMS-MT5-0001") + ":orchestrator"
        self.thread: threading.Thread | None = None
        self.started_at: str | None = None
        self._wake = threading.Event()
        self._last_heartbeat = self._last_world = self._last_regime = 0.0
        self._connected: bool | None = None
        self.meta: dict[str, Any] = {"status": "STARTING", "message": "Autonomous orchestrator starting", "cycles": 0, "errors": 0}

    def start(self) -> None:
        store.ensure_schema()
        recovered = store.recover_jobs()
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.meta.update({"startedAt": self.started_at, "recoveredJobs": recovered})
        self.thread = threading.Thread(target=self._loop, name="autonomous-orchestrator", daemon=True)
        self.thread.start()

    def publish(self, event_type: str, source: str, *, stage: int | None = None, symbols: list[str] | None = None,
                account_id: str | None = None, severity: str = "INFO", trigger: Any = None, payload: Any = None) -> int:
        symbols = [s for s in (symbols or []) if s in self.symbols]
        event_id = store.event(event_type, source, stage=stage, symbol=symbols[0] if len(symbols) == 1 else None,
                               account_id=account_id, severity=severity, trigger=trigger,
                               payload={**(payload or {}), "symbols": symbols} if symbols else payload)
        self._route(event_id, event_type, symbols, payload or {})
        store.finish_event(event_id)
        self._wake.set()
        return event_id

    def _job(self, event_id: int, stage: int, action: str, *, symbols: list[str] | None = None, priority: int = 50,
             version: str | None = None, payload: Any = None) -> None:
        subject = ",".join(sorted(symbols or [])) or "ALL"
        # A version identifies the inputs. The same candle, slot or reconnect is not analysed twice.
        # Unversioned work (a new operator diagnostic) stays unique per event and is still idempotent inside each engine.
        key = f"{stage}:{action}:{subject}:{version}" if version else f"{event_id}:{stage}:{action}:{subject}"
        store.queue_job(key, stage, action, event_id=event_id, symbol=symbols[0] if symbols and len(symbols) == 1 else None,
                        priority=priority, input_version=version, payload={**(payload or {}), "symbols": symbols or []})

    def _enqueue(self, event_id: int, stage: int, action: str, *, symbols: list[str] | None = None, priority: int = 50,
                 version: str | None = None, payload: Any = None) -> None:
        groups = [[s] for s in symbols] if action in PER_SYMBOL_ACTIONS and symbols and len(symbols) > 1 else [symbols]
        for group in groups:
            group_version = f"{version}:{group[0]}" if version and group and len(group) == 1 and len(symbols or []) > 1 else version
            self._job(event_id, stage, action, symbols=group, priority=priority, version=group_version, payload=payload)

    def _route(self, event_id: int, event_type: str, symbols: list[str], payload: dict[str, Any]) -> None:
        tf = str(payload.get("timeframe") or "").upper()
        bar = payload.get("barTime")
        if event_type == "DIAGNOSTIC_REPROCESS":
            self._diagnostic(event_id, symbols, payload)
        elif event_type in ("STARTUP", "MT5_RECONNECTED"):
            version = f"{event_type}:{self.started_at or event_id}"
            self._enqueue(event_id, 2, "RUN_REGIME", priority=10, version=version, payload={"reason": event_type})
            self._enqueue(event_id, 4, "MARK_SCANNER", priority=20, version=version, payload={"reason": event_type})
            self._enqueue(event_id, 5, "MARK_VISION", symbols=self.symbols, priority=25, version=version, payload={"reason": event_type})
            if self.channels:
                self._enqueue(event_id, 5, "MARK_CHANNELS", priority=26, version=version, payload={"reason": event_type})
            self._enqueue(event_id, 6, "MARK_DIRECTION", priority=30, version=version, payload={"reason": event_type})
            self._enqueue(event_id, 7, "MARK_CONFIRM", symbols=self.symbols, priority=35, version=version, payload={"reason": event_type})
            self._enqueue(event_id, 8, "MARK_RISK", priority=40, version=version, payload={"reason": event_type})
            self._enqueue(event_id, 9, "MARK_EXECUTION", priority=5, version=version, payload={"reason": event_type})
            self._enqueue(event_id, 10, "RUN_LEARNING", priority=45, version=version, payload={"reason": event_type})
        elif event_type == "MT5_DISCONNECTED":
            self._enqueue(event_id, 9, "MARK_EXECUTION", priority=1, version=f"disconnect:{event_id}",
                          payload={"reason": "MT5_DISCONNECTED"})
        elif event_type == "CANDLE_CHANGE":
            ident = f"{tf}:{payload.get('kind')}:{bar if bar is not None else event_id}:{_version(symbols)}"
            if tf in ("D1", "W1", "MN1"):
                self._enqueue(event_id, 2, "RUN_REGIME", priority=10, version=ident, payload={"reason": f"{payload.get('kind')} {tf}"})
            self._enqueue(event_id, 4, "MARK_SCANNER", symbols=symbols, priority=20, version=ident,
                          payload={"reason": f"{payload.get('kind')} {tf}"})
            if tf in ("D1", "H8"):
                self._enqueue(event_id, 5, "MARK_VISION", symbols=symbols, priority=25, version=ident,
                              payload={"reason": f"{payload.get('kind')} {tf}"})
            if self.channels and tf in ("MN1", "W1", "D1", "H8", "H1"):
                self._enqueue(event_id, 5, "MARK_CHANNELS", symbols=symbols, priority=26, version=ident,
                              payload={"reason": f"{'HISTORY_REPAIR' if payload.get('kind') == 'REPAIR' else 'NEW_CANDLE'} {tf}", "timeframe": tf})
            if tf in ("D1", "H8", "H1"):
                self._enqueue(event_id, 6, "MARK_DIRECTION", symbols=symbols, priority=30, version=ident,
                              payload={"reason": f"{payload.get('kind')} {tf}"})
            if tf == "H1":
                self._enqueue(event_id, 7, "MARK_CONFIRM", symbols=symbols, priority=35, version=ident,
                              payload={"reason": f"{payload.get('kind')} H1"})
                self._enqueue(event_id, 8, "MARK_RISK", symbols=symbols, priority=40, version=ident, payload={"reason": "H1_CLOSE"})
        elif event_type == "REGIME_CHANGE":
            self._enqueue(event_id, 4, "MARK_SCANNER", symbols=symbols, priority=20, version=f"regime:{_version(payload)}",
                          payload={"reason": event_type})
        elif event_type == "SCANNER_CHANGE":
            self._enqueue(event_id, 5, "MARK_VISION", symbols=symbols, priority=25, version=f"scanner:{_version(payload)}:{_version(symbols)}",
                          payload={"reason": event_type})
            self._enqueue(event_id, 6, "MARK_DIRECTION", symbols=symbols, priority=30, version=f"scanner:{_version(payload)}:{_version(symbols)}",
                          payload={"reason": event_type})
        elif event_type == "VISION_CHANGE":
            self._enqueue(event_id, 6, "MARK_DIRECTION", symbols=symbols, priority=30, version=f"vision:{_version(payload)}:{_version(symbols)}",
                          payload={"reason": event_type})
            watch = [s for s in (payload.get("counterTrendWatch") or []) if s in symbols or not symbols]
            if watch:
                self._enqueue(event_id, 7, "MARK_CONFIRM", symbols=watch, priority=32,
                              version=f"zone:{_version(watch)}:{event_id}",
                              payload={"reason": "HTF_COUNTER_TREND_ZONE"})
        elif event_type == "DIRECTION_CHANGE":
            self._enqueue(event_id, 7, "MARK_CONFIRM", symbols=symbols, priority=35, version=f"direction:{_version(payload)}:{_version(symbols)}",
                          payload={"reason": event_type})
        elif event_type == "CONFIRMATION_CHANGE":
            self._enqueue(event_id, 8, "MARK_RISK", symbols=symbols, priority=40, version=f"confirm:{_version(payload)}:{_version(symbols)}",
                          payload={"reason": event_type})
            self._enqueue(event_id, 10, "RUN_LEARNING", symbols=symbols, priority=45, version=f"h1:{_version(payload)}:{event_id}",
                          payload={"reason": "SETUP_INVALIDATED"})
        elif event_type == "RISK_CHANGE":
            self._enqueue(event_id, 9, "MARK_EXECUTION", symbols=symbols, priority=5, version=f"risk:{_version(payload)}:{_version(symbols)}",
                          payload={"reason": event_type})
            self._enqueue(event_id, 10, "RUN_LEARNING", symbols=symbols, priority=46, version=f"risk-learn:{_version(payload)}:{event_id}",
                          payload={"reason": "SETUP_REJECTED"})
        elif event_type == "EXECUTION_CHANGE":
            self._enqueue(event_id, 8, "MARK_RISK", symbols=symbols, priority=20, version=f"execution:{payload.get('what')}:{_version(symbols)}",
                          payload={"reason": event_type})
            if payload.get("what") == "CLOSED":
                self._enqueue(event_id, 10, "RUN_LEARNING", symbols=symbols, priority=30, version=f"closed:{_version(payload)}",
                              payload={"reason": "TRADE_CLOSED"})
            else:
                self._enqueue(event_id, 10, "RUN_LEARNING", symbols=symbols, priority=48, version=f"managed:{payload.get('what')}:{event_id}",
                              payload={"reason": "POSITION_MANAGED"})
        elif event_type == "CHANNEL_REANALYSE_REQUESTED" and self.channels:
            self._enqueue(event_id, 5, "MARK_CHANNELS", symbols=symbols or None, priority=24,
                          payload={"reason": str(payload.get("reason") or "MANUAL_REANALYSE"), "timeframes": payload.get("timeframes")})
        elif event_type == "CHANNEL_CHANGE":
            self._enqueue(event_id, 5, "PUBLISH_WORLD", priority=27, version=f"channels:{_version(payload)}",
                          payload={"reason": event_type})
        elif event_type in ("ECON_REVALIDATION_REQUESTED", "ECON_STRUCTURE_INVALIDATED", "ECON_RELEASED", "ECON_MARKET_SHOCK", "ECON_RELEASE_WINDOW", "ECON_SPREAD_SPIKE"):
            version = f"{event_type}:{_version(payload)}:{event_id}"
            self._enqueue(event_id, 5, "MARK_VISION", symbols=symbols, priority=22, version=version, payload={"reason": event_type})
            if self.channels:
                self._enqueue(event_id, 5, "MARK_CHANNELS", symbols=symbols, priority=23, version=version, payload={"reason": event_type})
            self._enqueue(event_id, 6, "MARK_DIRECTION", symbols=symbols, priority=28, version=version, payload={"reason": event_type})
            self._enqueue(event_id, 7, "MARK_CONFIRM", symbols=symbols, priority=33, version=version, payload={"reason": event_type})
            self._enqueue(event_id, 8, "MARK_RISK", symbols=symbols, priority=15, version=version, payload={"reason": event_type})
        elif event_type in ("ECON_EVENT_UPCOMING", "ECON_EVENT_WATCH", "ECON_PRE_EVENT_GATE", "ECON_SURPRISE_CALCULATED", "ECON_VOLATILITY_SPIKE", "ECON_NORMALIZED", "ECON_FEED_SYNCED", "ECON_FEED_STALE", "ECON_FEED_FAILED", "ECON_ACTUAL_RECEIVED"):
            self._enqueue(event_id, 8, "MARK_RISK", symbols=symbols, priority=18, version=f"{event_type}:{event_id}", payload={"reason": event_type})
        elif event_type in ("MODEL_OUTCOME_AVAILABLE", "PARAMETER_CHANGED"):
            self._enqueue(event_id, 10, "RUN_LEARNING", symbols=symbols, priority=44, version=f"{event_type}:{event_id}",
                          payload={"reason": event_type})

    def _diagnostic(self, event_id: int, symbols: list[str], payload: dict[str, Any]) -> None:
        """Operator reprocess. It wakes the same engines and cannot skip their dependency or risk gates."""
        reason = str(payload.get("reason") or "DIAGNOSTIC")
        stage = payload.get("stage")
        if stage:
            mapped = STAGE_ACTION.get(int(stage))
            if not mapped:
                return
            st, action = mapped
            self._enqueue(event_id, st, action, symbols=symbols or None, priority=st, payload={"reason": reason})
            return
        version = f"diagnostic:{self.started_at or event_id}"
        self._enqueue(event_id, 2, "RUN_REGIME", priority=10, version=f"{version}:{event_id}", payload={"reason": reason})
        self._enqueue(event_id, 4, "MARK_SCANNER", symbols=symbols or None, priority=20, payload={"reason": reason})
        self._enqueue(event_id, 5, "MARK_VISION", symbols=symbols or self.symbols, priority=25, payload={"reason": reason})
        if self.channels:
            self._enqueue(event_id, 5, "MARK_CHANNELS", symbols=symbols or None, priority=26, payload={"reason": f"DIAGNOSTIC {reason}"})
        self._enqueue(event_id, 6, "MARK_DIRECTION", priority=30, payload={"reason": reason})
        self._enqueue(event_id, 7, "MARK_CONFIRM", symbols=symbols or self.symbols, priority=35, payload={"reason": reason})
        self._enqueue(event_id, 8, "MARK_RISK", symbols=symbols or None, priority=40, payload={"reason": reason})
        self._enqueue(event_id, 9, "MARK_EXECUTION", priority=5, payload={"reason": reason})
        self._enqueue(event_id, 10, "RUN_LEARNING", priority=45, payload={"reason": reason})

    def _periodic(self, now: float) -> None:
        connected = bool(self.connected_fn())
        if self._connected is not None and connected != self._connected:
            self.publish("MT5_RECONNECTED" if connected else "MT5_DISCONNECTED", "MT5", stage=1,
                         severity="INFO" if connected else "ERROR", payload={"connected": connected})
        self._connected = connected
        if now - self._last_regime >= SERVICE["regimeRefreshSec"]:
            self._last_regime = now
            if connected and not analysis_gate.paused():
                slot = int(now // SERVICE["regimeRefreshSec"])
                eid = store.event("SCHEDULED", "ORCHESTRATOR", stage=2, trigger={"schedule": "FORMING_D1", "slot": slot})
                self._enqueue(eid, 2, "RUN_REGIME", priority=15, version=f"forming-d1:{slot}", payload={"reason": "FORMING_D1_REFRESH"})
                store.finish_event(eid)
        if now - self._last_world >= SERVICE["worldRefreshSec"]:
            self._last_world = now
            self.refresh_world("SCHEDULED_WORLD_REFRESH")
        if now - self._last_heartbeat >= SERVICE["heartbeatSec"]:
            self._last_heartbeat = now
            status = "HEALTHY" if connected else "DEGRADED"
            self.meta.update({
                "status": status,
                "message": "Persistent S1-S10 control loop active" if connected else "Control loop active — MT5 disconnected; new execution stays fail-closed until reconciliation",
                "heartbeatAt": datetime.now(timezone.utc).isoformat(),
                "connected": connected, "analysisPaused": analysis_gate.paused(), "cycles": int(self.meta.get("cycles") or 0) + 1,
                "threadAlive": bool(self.thread and self.thread.is_alive()), "service": SERVICE,
            })
            store.checkpoint("orchestrator.meta", self.meta)

    def _loop(self) -> None:
        time.sleep(1)
        self.publish("STARTUP", "ORCHESTRATOR", trigger={"recovery": True, "startedAt": self.started_at})
        while True:
            try:
                self._periodic(time.time())
                job = store.claim_job(self.node)
                if job:
                    self._execute(job)
                else:
                    self._wake.wait(timeout=SERVICE["loopSec"])
                    self._wake.clear()
            except Exception as exc:  # pragma: no cover
                self.meta["errors"] = int(self.meta.get("errors") or 0) + 1
                self.meta["lastError"] = f"{type(exc).__name__}: {exc}"
                traceback.print_exc()
                time.sleep(1)

    def _audit(self, job: dict[str, Any], *, decision: str, reason: str, blocker_code: str | None = None,
               blocker: str | None = None, next_action: str | None = None) -> None:
        payload = job.get("payload") or {}
        symbols = payload.get("symbols") or []
        try:
            store.record_decision({
                "eventId": job.get("eventId"), "jobId": job.get("id"), "stage": job.get("stage"),
                "symbol": symbols[0] if len(symbols) == 1 else job.get("symbol"),
                "trigger": reason, "inputs": {"version": job.get("inputVersion"), "symbols": symbols, "action": job.get("action")},
                "decision": decision, "reason": reason, "blockerCode": blocker_code, "blocker": blocker, "nextAction": next_action,
            })
        except Exception:
            traceback.print_exc()

    def _execute(self, job: dict[str, Any]) -> None:
        action, payload = job["action"], job.get("payload") or {}
        symbols = payload.get("symbols") or self.symbols
        reason = payload.get("reason") or action
        try:
            if analysis_gate.paused() and 2 <= int(job["stage"]) <= 8:
                store.complete_job(job["id"], blocker_code="ANALYSIS_PAUSED", blocker="Held until analysis resumes", retry_sec=5)
                self._audit(job, decision="HELD", reason=reason, blocker_code="ANALYSIS_PAUSED",
                            blocker="Analysis paused — market sensing, position protection and learning continue",
                            next_action="Retry when analysis resumes")
                return
            if action == "RUN_REGIME":
                result = self.regime_run({})
                if result.get("paused"):
                    store.complete_job(job["id"], blocker_code="ANALYSIS_PAUSED", blocker=result.get("message"), retry_sec=5)
                    self._audit(job, decision="HELD", reason=reason, blocker_code="ANALYSIS_PAUSED", blocker=result.get("message"),
                                next_action="Retry when analysis resumes")
                    return
                if not result.get("ok"):
                    raise RuntimeError(result.get("message") or "Regime engine blocked")
                self.scanner.mark("REGIME_RUN")
            elif action == "MARK_SCANNER":
                self.scanner.mark(reason)
            elif action == "MARK_VISION":
                self.vision.mark(symbols, reason)
            elif action == "MARK_CHANNELS":
                self.channels.mark(symbols, reason, payload.get("timeframes") or self.channels.derived(payload.get("timeframe")))
            elif action == "PUBLISH_WORLD":
                self.refresh_world(reason)
            elif action == "MARK_DIRECTION":
                self.direction.mark(reason)
            elif action == "MARK_CONFIRM":
                self.confirm.mark(f"{reason} {','.join(symbols[:6])}".strip())
            elif action == "MARK_RISK":
                self.risk.mark(f"{reason} {','.join(symbols[:6])}".strip())
            elif action == "MARK_EXECUTION":
                self.execution.mark(reason)
            elif action == "RUN_LEARNING":
                self.learning.mark(reason)
            else:
                raise RuntimeError(f"Unknown autonomous action {action}")
            store.complete_job(job["id"])
            self._audit(job, decision="RAN", reason=reason, next_action="Downstream stages consume the published output on their own events")
        except Exception as exc:
            if int(job["attempt"]) < int(job["maxAttempts"]):
                store.complete_job(job["id"], blocker_code="RETRYABLE_ERROR", blocker=str(exc), retry_sec=min(60, 2 ** int(job["attempt"])))
                nxt = "Retry this instrument only" if len(symbols) == 1 else "Retry after backoff"
            else:
                store.complete_job(job["id"], blocker_code="RETRIES_EXHAUSTED", blocker=str(exc))
                nxt = "Requires operator review; other instruments continue"
            self._audit(job, decision="FAILED", reason=reason, blocker_code="RETRYABLE_ERROR" if int(job["attempt"]) < int(job["maxAttempts"]) else "RETRIES_EXHAUSTED",
                        blocker=str(exc), next_action=nxt)
            store.event("JOB_FAILURE", "ORCHESTRATOR", stage=job["stage"], symbol=job.get("symbol"), severity="ERROR",
                        trigger={"job": job["jobKey"]}, payload={"error": str(exc), "attempt": job["attempt"], "symbols": symbols})

    @staticmethod
    def _put(symbol: str, stage: int, row: dict[str, Any], *, engine_health: str, state_key: str = "state",
             reason_key: str = "reason", confidence_key: str = "confidence", passed: bool = False,
             next_action: str = "Await the next qualifying event") -> None:
        raw_state = str(row.get(state_key) or "WAITING").upper().replace(" ", "_")
        reason = str(row.get(reason_key) or "No current evidence")
        fresh = row.get("freshness") if isinstance(row.get("freshness"), dict) else {}
        stale = raw_state == "STALE" or str((fresh or {}).get("status") or "").upper() == "STALE" or engine_health in ("ERROR", "OFFLINE")
        state = "PASSED" if passed and not stale else ("STALE" if stale and passed else raw_state)
        if state == "PASSED" and engine_health in ("ERROR", "OFFLINE"):
            state = "STALE"
            reason = f"{engine_health} engine — last output is not live evidence"
        blocked = state in ("BLOCKED", "ERROR", "STALE", "INSUFFICIENT_DATA", "REJECTED", "INVALIDATED", "CONFLICT")
        store.world(symbol, stage, engine_health=engine_health, pipeline_state=state,
                    freshness="STALE" if stale else "CURRENT", confidence=row.get(confidence_key),
                    input_version=_version({k: row.get(k) for k in (state_key, reason_key, confidence_key, "evaluatedAt", "updatedAt")}),
                    trigger=str(row.get("trigger") or "AUTONOMOUS"), current_action=reason, next_action=next_action,
                    blocker_code=str(row.get("reasonCode") or raw_state) if blocked else None, blocker=reason if blocked else None,
                    dependencies=row.get("upstream") or row.get("stage1") or row.get("dependencies"),
                    evidence=row.get("evidence") or row.get("reasoning"),
                    evaluated_at=row.get("evaluatedAt") or row.get("analysedAt") or row.get("updatedAt"))

    def _live_snapshot(self) -> dict[str, Any]:
        def safe(label: str, fn: Callable[[], Any], fallback: Any) -> Any:
            try:
                return fn()
            except Exception as exc:
                self.meta["lastError"] = f"{label}: {exc}"
                return fallback

        scanner = safe("scanner", scanner_store.load_state, {})
        vision_rows = safe("vision", lambda: vision_store.load_state().get("instruments") or [], [])
        direction_rows = safe("direction", lambda: direction_store.load_state().get("instruments") or [], [])
        confirm_rows = safe("confirm", lambda: confirm_store.load_state().get("instruments") or [], [])
        risk_state = safe("risk", risk_store.load_state, {})
        ledgers = safe("execution", lambda: execution_store.ledger_recent(hours=720, limit=500), [])
        trades = safe("trades", lambda: execution_store.trades(limit=1000), [])
        control = safe("control", execution_store.load_control, {"executionEnabled": False, "emergencyStop": False})
        try:
            control = {**control, "tradingEnabled": bool(execution_store.auto_enabled())}
        except Exception:
            control = {**control, "tradingEnabled": False}
        regime = safe("regime", scanner_store.regime_meta, {}) or {}
        channel_rows = safe("channels", channel_store.world_rows, []) if self.channels else []
        return {
            "channels": channel_rows,
            "connected": bool(self.connected_fn()),
            "engines": {
                "S1": "HEALTHY" if self.connected_fn() else "DEGRADED",
                "S2": _engine_health({"status": regime.get("status")}, fallback="OFFLINE"),
                "S3": _engine_health({"status": regime.get("status")}, fallback="OFFLINE"),
                "S4": _engine_health(self.scanner.meta),
                "S5": _engine_health(self.vision.meta),
                "CHANNELS": _engine_health(self.channels.meta) if self.channels else "OFFLINE",
                "S6": _engine_health(self.direction.meta),
                "S7": _engine_health(self.confirm.meta),
                "S8": _engine_health(self.risk.meta),
                "S9": _engine_health(self.execution.meta),
                "S10": _engine_health(self.learning.meta),
            },
            "regime": regime,
            "scanner": scanner.get("instruments") or [],
            "vision": vision_rows,
            "direction": direction_rows,
            "confirm": confirm_rows,
            "opportunities": risk_state.get("opportunities") or [],
            "ledgers": ledgers,
            "learned": [t.get("symbol") for t in trades if t.get("stage10Status") == "LEARNED"],
            "control": control,
        }

    def refresh_world(self, trigger: str) -> None:
        """Build one independent S1-S10 state vector per instrument. A blocked symbol never rewrites the others."""
        snap = self.world_reader() if self.world_reader else self._live_snapshot()
        self._project(snap, trigger)

    def _project(self, snap: dict[str, Any], trigger: str) -> None:
        engines = snap.get("engines") or {}
        regime = snap.get("regime") or {}
        rows = {r["symbol"]: r for r in snap.get("scanner") or []}
        vision = {r["symbol"]: r for r in snap.get("vision") or []}
        channels = {r["symbol"]: {k: v for k, v in r.items() if k != "narrative"} for r in snap.get("channels") or []}
        direction = {r["symbol"]: r for r in snap.get("direction") or []}
        confirm = {r["symbol"]: r for r in snap.get("confirm") or []}
        opportunities: dict[str, list[dict[str, Any]]] = {}
        for r in snap.get("opportunities") or []:
            opportunities.setdefault(r["symbol"], []).append(r)
        ledgers: dict[str, list[dict[str, Any]]] = {}
        for r in snap.get("ledgers") or []:
            ledgers.setdefault(r.get("instrument") or r.get("symbol"), []).append(r)
        learned = set(snap.get("learned") or [])
        control = snap.get("control") or {}
        connected = bool(snap.get("connected"))
        for symbol in self.symbols:
            s4 = rows.get(symbol) or {"state": "WAITING", "reason": "Stage 4 has not ranked this instrument", "reasonCode": "NO_RANK"}
            s1 = dict(s4.get("stage1") or {"status": "WAITING", "reason": "Stage 1 history not yet available", "reasonCode": "NO_HISTORY"})
            if not connected and s1.get("status") == "READY":
                s1.update({"status": "STALE", "reason": "MT5 disconnected — stored history is not live evidence", "reasonCode": "MT5_DISCONNECTED"})
            self._put(symbol, 1, {**s1, "trigger": trigger}, engine_health=engines.get("S1", "DEGRADED"), state_key="status",
                      passed=s1.get("status") == "READY", next_action="React to the next MT5 tick or required candle close")
            base = s4.get("base") if isinstance(s4.get("base"), dict) else {}
            quote = s4.get("quote") if isinstance(s4.get("quote"), dict) else {}
            fresh = s4.get("freshness") if isinstance(s4.get("freshness"), dict) else {}
            strength_ready = base.get("composite") is not None and quote.get("composite") is not None and fresh.get("status") == "CURRENT"
            regime_status = str(regime.get("status") or s4.get("regimeStatus") or "")
            regime_ready = strength_ready and bool(base.get("regime")) and bool(quote.get("regime")) and regime_status == "HEALTHY"
            s2_state = "READY" if strength_ready else ("STALE" if fresh.get("status") == "STALE" else "WAITING")
            s2_reason = fresh.get("reason") or ("Strength published for both legs" if strength_ready else "Stage 2 strength not published for both legs")
            self._put(symbol, 2, {"state": s2_state, "reason": s2_reason, "reasonCode": fresh.get("status") or "NO_STRENGTH",
                                  "confidence": s4.get("confidence"), "freshness": fresh, "trigger": trigger,
                                  "evidence": {"base": base.get("asset"), "quote": quote.get("asset")}},
                      engine_health=engines.get("S2", "OFFLINE"), passed=strength_ready,
                      next_action="Recompute on a closed D1/W1/MN1 bar or a material forming-D1 move")
            if regime_ready:
                s3_state, s3_reason, s3_code = "READY", f"Regimes {base.get('regime')} / {quote.get('regime')}", None
            elif regime_status in ("", "STARTING", "WARMING_UP"):
                s3_state, s3_reason, s3_code = "WAITING", f"Stage 3 {regime_status or 'not run'} — regime is not authoritative yet", "REGIME_NOT_READY"
            elif fresh.get("status") == "STALE" or regime_status == "BLOCKED":
                s3_state, s3_reason, s3_code = "STALE" if fresh.get("status") == "STALE" else "BLOCKED", fresh.get("reason") or f"Stage 3 {regime_status}", regime_status or "STALE"
            else:
                s3_state, s3_reason, s3_code = "WAITING", "Stage 3 has not published a regime for both legs", "NO_REGIME"
            self._put(symbol, 3, {"state": s3_state, "reason": s3_reason, "reasonCode": s3_code, "confidence": s4.get("confidence"),
                                  "freshness": fresh, "trigger": trigger, "dependencies": {"regimeStatus": regime_status or None}},
                      engine_health=engines.get("S3", "OFFLINE"), passed=regime_ready,
                      next_action="Publish regime only from a healthy Stage 3 run on current strength")
            promoted = s4.get("state") == "PROMOTED" and fresh.get("status") != "STALE" and s1.get("status") == "READY"
            if s4.get("state") == "PROMOTED" and not promoted:
                s4 = {**s4, "state": "STALE", "reason": s4.get("reason") or "Promotion is last-known and is not current live evidence", "reasonCode": "STALE_PROMOTION"}
            self._put(symbol, 4, {**s4, "trigger": trigger}, engine_health=engines.get("S4", "OFFLINE"),
                      passed=promoted, next_action="Promote to Stage 5 when every ranking gate passes")
            s5 = vision.get(symbol) or {"status": "WAITING", "reason": "Awaiting Stage 4 qualification", "reasonCode": "AWAITING_PROMOTION"}
            if not promoted and s5.get("status") == "READY":
                s5 = {**s5, "status": "STALE", "reason": "Stage 5 output kept as last-known — Stage 4 is not a current promotion", "reasonCode": "UPSTREAM_NOT_CURRENT"}
            hierarchy = channels.get(symbol)
            if hierarchy:
                deps = s5.get("upstream") or s5.get("stage1") or s5.get("dependencies")
                s5 = {**s5, "upstream": {**(deps if isinstance(deps, dict) else {"stage": deps} if deps else {}), "channelHierarchy": hierarchy}}
            self._put(symbol, 5, {**s5, "trigger": trigger}, engine_health=engines.get("S5", "OFFLINE"), state_key="status",
                      passed=promoted and s5.get("status") == "READY", next_action="React to the next D1/H8 close or channel event")
            s6 = direction.get(symbol) or {"state": "WAITING", "reason": "Awaiting Stage 5 structure", "reasonCode": "AWAITING_STRUCTURE"}
            if not (promoted and s5.get("status") == "READY") and s6.get("readyForH1"):
                s6 = {**s6, "state": "STALE", "readyForH1": False, "reason": "Stage 6 hand-off is last-known — Stage 5 is not current", "reasonCode": "UPSTREAM_NOT_CURRENT"}
            self._put(symbol, 6, {**s6, "trigger": trigger}, engine_health=engines.get("S6", "OFFLINE"),
                      passed=bool(s6.get("readyForH1")), next_action="Publish READY_FOR_H1 only when structure agrees with the current promotion")
            s7 = confirm.get(symbol) or {"state": "WAITING", "reason": "Awaiting Stage 6 direction", "reasonCode": "AWAITING_DIRECTION"}
            if not s6.get("readyForH1") and s7.get("confirmed"):
                s7 = {**s7, "confirmed": False, "state": "STALE", "reason": "Stage 7 confirmation is last-known — Stage 6 is not current", "reasonCode": "UPSTREAM_NOT_CURRENT"}
            self._put(symbol, 7, {**s7, "trigger": trigger}, engine_health=engines.get("S7", "OFFLINE"),
                      passed=bool(s7.get("confirmed")), confidence_key="score", next_action="React to the next H1 close or intrabar invalidation")
            opps = opportunities.get(symbol) or []
            authorized = [o for o in opps if int(o.get("authorizedAccounts") or 0) > 0 and str(o.get("state") or "").upper() != "STALE"]
            blocked = [o for o in opps if str(o.get("state") or "").upper() in ("BLOCKED", "STALE", "REJECTED", "EXPIRED", "INELIGIBLE") or str(o.get("state") or "").endswith("_BLOCKED")]
            if not s7.get("confirmed"):
                s8 = {"state": "WAITING", "reason": s7.get("reason") or "Awaiting a confirmed H1 setup", "reasonCode": "AWAITING_CONFIRMATION"}
                s8_pass = False
            elif authorized:
                extra = f"; {len(blocked)} other account path(s) blocked — {blocked[0].get('reason')}" if blocked else ""
                s8 = {"state": "AUTHORIZED", "reason": f"Authorized on {len(authorized)} account path(s){extra}", "reasonCode": None,
                      "score": authorized[0].get("score"), "freshness": authorized[0].get("freshness"),
                      "evidence": [{"accountId": o.get("accountId"), "state": o.get("state")} for o in opps]}
                s8_pass = True
            elif blocked:
                s8 = {"state": "BLOCKED", "reason": blocked[0].get("reason") or blocked[0].get("state"), "reasonCode": blocked[0].get("reasonCode") or blocked[0].get("state"),
                      "score": blocked[0].get("score"), "freshness": blocked[0].get("freshness")}
                s8_pass = False
            else:
                s8 = {"state": "WAITING", "reason": "Stage 8 has not qualified this confirmation", "reasonCode": "AWAITING_RISK"}
                s8_pass = False
            self._put(symbol, 8, {**s8, "trigger": trigger}, engine_health=engines.get("S8", "OFFLINE"), passed=s8_pass,
                      confidence_key="score", next_action="Authorize each eligible account independently; a blocked account does not block the others")
            books = [b for b in ledgers.get(symbol) or [] if b]
            open_book = next((b for b in books if str(b.get("positionState") or "") in OPEN_POSITION), None)
            active = open_book or (books[0] if books else None)
            if active:
                state = active.get("positionState") or active.get("orderState") or "WAITING"
                self._put(symbol, 9, {"state": state, "reason": active.get("stateReason") or state, "reasonCode": state, "trigger": trigger,
                                      "evidence": {"accountId": active.get("accountId"), "executionId": active.get("executionId")}},
                          engine_health=engines.get("S9", "OFFLINE"), passed=state in OPEN_POSITION or state == "CLOSED",
                          next_action=active.get("nextAction") or "Reconcile and manage at the broker")
            elif authorized:
                if control.get("emergencyStop"):
                    held, code, why = "BLOCKED", "EMERGENCY_STOP", "Emergency stop — new orders blocked; open positions stay protected"
                elif not control.get("tradingEnabled", True):
                    held, code, why = "BLOCKED", "TRADING_PAUSED", "Pause New Trades — this authorization is not submitted"
                elif not control.get("executionEnabled"):
                    held, code, why = "BLOCKED", "EXECUTION_DISABLED", "Stage 9 execution is disabled — authorization is not submitted"
                else:
                    held, code, why = "WAITING", "AWAITING_EXECUTION", "Stage 9 will consume this authorization on its next cycle"
                self._put(symbol, 9, {"state": held, "reason": why, "reasonCode": code, "trigger": trigger},
                          engine_health=engines.get("S9", "OFFLINE"), next_action="Submit only after reconciliation, freshness and risk revalidation")
            else:
                self._put(symbol, 9, {"state": "WAITING", "reason": "Awaiting a current Stage 8 authorization", "reasonCode": "AWAITING_AUTHORIZATION", "trigger": trigger},
                          engine_health=engines.get("S9", "OFFLINE"), next_action="Stay idle until Stage 8 authorizes this instrument")
            learned_row = symbol in learned
            self._put(symbol, 10, {"state": "LEARNED" if learned_row else "WAITING",
                                   "reason": "Latest completed trade evaluated" if learned_row else "Awaiting a completed trade or rejected setup",
                                   "reasonCode": None if learned_row else "AWAITING_OUTCOME", "trigger": trigger},
                      engine_health=engines.get("S10", "OFFLINE"), passed=learned_row,
                      next_action="Record the outcome. Candidate parameters stay separate from production until an explicit approval.")

    def state(self) -> dict[str, Any]:
        out = store.state()
        out["orchestrator"] = self.meta
        out["engines"] = {
            "S1": {"health": "HEALTHY" if self.connected_fn() else "DEGRADED"},
            "S4": self.scanner.meta, "S5": self.vision.meta, "CHANNELS": self.channels.meta if self.channels else None, "S6": self.direction.meta,
            "S7": self.confirm.meta, "S8": self.risk.meta, "S9": self.execution.meta, "S10": self.learning.meta,
        }
        return out
