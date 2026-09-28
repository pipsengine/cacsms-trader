"""Proof that the orchestrator progresses instruments from events alone.

No browser, no Run Now, and no page mount. Eligible EURUSD walks S1-S10 from candle and
stage-handoff events. GBPUSD stays blocked on its own evidence. A paused analysis loop,
a restart, a repeated candle and a diagnostic reprocess cannot duplicate work or bypass
execution authorization.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_fd, _path = tempfile.mkstemp(prefix="cacsms-autonomy-", suffix=".db")
os.close(_fd)
os.environ["DATABASE_URL"] = "file:" + str(Path(_path))

import sqlite_db  # noqa: E402

sqlite_db._schema_ready = False

import autonomy_service  # noqa: E402
import autonomy_store as store  # noqa: E402
import learning_service  # noqa: E402
from db import connect, get_setting, set_setting  # noqa: E402


def _wipe() -> None:
    with connect() as conn:
        cur = conn.cursor()
        for table in (
            "app_auto_job", "app_auto_event", "app_auto_decision", "app_world_instrument",
            "app_auto_checkpoint", "app_learning_run", "app_learning_evaluation",
        ):
            cur.execute(f"DELETE FROM dbo.{table}")
        conn.commit()


def _jobs() -> list[tuple]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, stage, action, state, blocker_code, input_version FROM dbo.app_auto_job ORDER BY id")
        return list(cur.fetchall())


def _world() -> dict[tuple[str, int], tuple]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol, stage, engine_health, pipeline_state, blocker_code, blocker, current_action FROM dbo.app_world_instrument")
        return {(r[0], int(r[1])): r[2:] for r in cur.fetchall()}


def _drain(orch: autonomy_service.AutonomousOrchestrator, limit: int = 40) -> int:
    n = 0
    while n < limit:
        job = store.claim_job(orch.node)
        if not job:
            break
        orch._execute(job)
        n += 1
    return n


class _Engine:
    def __init__(self):
        self.meta = {"status": "HEALTHY", "message": "ok", "runs": 0, "errors": 0}
        self.reasons: list[str] = []

    def mark(self, reason, *_):
        self.reasons.append(str(reason))


class Lifecycle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        store.ensure_schema()

    def setUp(self):
        _wipe()
        self.snap = {
            "connected": True,
            "engines": {f"S{i}": "HEALTHY" for i in range(1, 11)},
            "regime": {"status": "HEALTHY"},
            "scanner": [],
            "vision": [],
            "direction": [],
            "confirm": [],
            "opportunities": [],
            "ledgers": [],
            "learned": [],
            "control": {"executionEnabled": True, "tradingEnabled": True, "emergencyStop": False},
        }
        self.vision = _Engine()
        self.direction = _Engine()
        self.confirm = _Engine()
        self.risk = _Engine()
        self.execution = _Engine()
        self.learning = _Engine()
        self.scanner = _Engine()
        self.submitted = 0
        self.orch = autonomy_service.AutonomousOrchestrator(
            ["EURUSD", "GBPUSD"], lambda _body: {"ok": True}, self.scanner, self.vision, self.direction,
            self.confirm, self.risk, self.execution, self.learning, connected_fn=lambda: True,
            world_reader=lambda: self.snap,
        )
        self.orch.started_at = "test-start"
        self._wire()

    def _wire(self):
        def scan(reason):
            self.scanner.reasons.append(str(reason))
            if self.snap["scanner"]:
                return
            fresh = {"status": "CURRENT", "reason": "Strength from closed D1"}
            self.snap["scanner"] = [
                {"symbol": "EURUSD", "state": "PROMOTED", "reason": "Promoted", "confidence": 80,
                 "stage1": {"status": "READY", "reason": "History and quote fresh"},
                 "base": {"asset": "EUR", "composite": 4, "regime": "Strengthening"},
                 "quote": {"asset": "USD", "composite": -3, "regime": "Weakening"}, "freshness": fresh},
                {"symbol": "GBPUSD", "state": "BLOCKED", "reason": "Stage 1 H1 stale", "reasonCode": "STAGE1_STALE",
                 "stage1": {"status": "STALE", "reason": "H1 behind the provider", "reasonCode": "STALE"},
                 "base": {"asset": "GBP", "composite": 1, "regime": "Stable"},
                 "quote": {"asset": "USD", "composite": -3, "regime": "Weakening"}, "freshness": fresh},
            ]
            self.orch.publish("SCANNER_CHANGE", "STAGE4", symbols=["EURUSD"], payload={"promoted": ["EURUSD"]})

        def vision(symbols, reason):
            self.vision.reasons.append(f"{reason}:{','.join(symbols)}")
            if symbols == ["GBPUSD"]:
                raise RuntimeError("GBPUSD feed stale")
            if any(v["symbol"] == "EURUSD" for v in self.snap["vision"]):
                return
            self.snap["vision"].append({"symbol": "EURUSD", "status": "READY", "reason": "D1 channel confirmed", "confidence": 77})
            self.orch.publish("VISION_CHANGE", "STAGE5", symbols=["EURUSD"], payload={"status": "READY"})

        def direction(reason):
            self.direction.reasons.append(str(reason))
            if any(d["symbol"] == "EURUSD" for d in self.snap["direction"]):
                return
            if not any(v.get("status") == "READY" for v in self.snap["vision"]):
                return
            self.snap["direction"].append({"symbol": "EURUSD", "state": "READY_FOR_H1", "readyForH1": True, "reason": "D1 and H8 agree", "confidence": 74})
            self.orch.publish("DIRECTION_CHANGE", "STAGE6", symbols=["EURUSD"], payload={"ready": True})

        def confirm(reason, *_):
            self.confirm.reasons.append(str(reason))
            if any(c["symbol"] == "EURUSD" for c in self.snap["confirm"]):
                return
            if not any(d.get("readyForH1") for d in self.snap["direction"]):
                return
            self.snap["confirm"].append({"symbol": "EURUSD", "state": "CONFIRMED", "confirmed": True, "reason": "H1 break of structure", "score": 71})
            self.orch.publish("CONFIRMATION_CHANGE", "STAGE7", symbols=["EURUSD"], payload={"confirmed": True})

        def risk(reason, *_):
            self.risk.reasons.append(str(reason))
            if self.snap["opportunities"]:
                return
            if not any(c.get("confirmed") for c in self.snap["confirm"]):
                return
            self.snap["opportunities"] = [
                {"symbol": "EURUSD", "accountId": "usd-demo", "state": "AUTHORIZED", "authorizedAccounts": 1, "reason": "USD demo eligible", "score": 70},
                {"symbol": "EURUSD", "accountId": "ngn-prop", "state": "RULE_BLOCKED", "authorizedAccounts": 0, "reason": "NGN prop daily loss", "reasonCode": "PROP_DAILY_LOSS", "score": 70},
            ]
            self.orch.publish("RISK_CHANGE", "STAGE8", symbols=["EURUSD"], payload={"authorized": ["usd-demo"], "blocked": ["ngn-prop"]})

        def execution(reason, *_):
            self.execution.reasons.append(str(reason))
            if reason == "MT5_DISCONNECTED":
                return
            authorized = any(int(o.get("authorizedAccounts") or 0) > 0 for o in self.snap["opportunities"])
            ctrl = self.snap["control"]
            if not authorized or not ctrl.get("executionEnabled") or not ctrl.get("tradingEnabled") or ctrl.get("emergencyStop"):
                return
            if not self.snap["ledgers"]:
                self.snap["ledgers"].append({"instrument": "EURUSD", "accountId": "usd-demo", "executionId": "ex-1", "positionState": "OPEN", "stateReason": "Filled"})
                return
            if self.snap["ledgers"][0]["positionState"] != "CLOSED":
                self.snap["ledgers"][0]["positionState"] = "CLOSED"
                self.orch.publish("EXECUTION_CHANGE", "STAGE9", symbols=["EURUSD"], payload={"what": "CLOSED", "executionId": "ex-1"})

        def learning(reason, *_):
            self.learning.reasons.append(str(reason))
            if "EURUSD" not in self.snap["learned"]:
                self.snap["learned"].append("EURUSD")

        self.scanner.mark = scan
        self.vision.mark = vision
        self.direction.mark = direction
        self.confirm.mark = confirm
        self.risk.mark = risk
        self.execution.mark = execution
        self.learning.mark = learning

    def test_events_alone_walk_one_instrument_and_leave_the_other_blocked(self):
        self.orch.publish("CANDLE_CHANGE", "STAGE1", symbols=["EURUSD", "GBPUSD"],
                          payload={"timeframe": "D1", "kind": "INCREMENTAL", "barTime": 1_700_000_000})
        _drain(self.orch)
        # The open position needs the execution engine's next cycle. That cycle is also an event, not a button.
        self.orch.publish("RISK_CHANGE", "STAGE8", symbols=["EURUSD"], payload={"what": "MANAGE", "executionId": "ex-1"})
        _drain(self.orch)
        self.orch.refresh_world("TEST")
        world = _world()

        self.assertEqual(world[("EURUSD", 4)][1], "PASSED")
        self.assertEqual(world[("EURUSD", 7)][1], "PASSED")
        self.assertEqual(world[("EURUSD", 8)][1], "PASSED")
        self.assertIn("NGN prop daily loss", world[("EURUSD", 8)][4])
        self.assertEqual(world[("EURUSD", 9)][1], "PASSED")
        self.assertEqual(world[("EURUSD", 10)][1], "PASSED")
        self.assertEqual(world[("GBPUSD", 4)][1], "BLOCKED")
        self.assertNotEqual(world[("GBPUSD", 5)][1], "PASSED")
        self.assertEqual(world[("GBPUSD", 1)][0], "HEALTHY")
        self.assertNotEqual(world[("GBPUSD", 1)][1], "PASSED")
        self.assertTrue(any(r[1] == 5 and r[3] in ("RETRY", "BLOCKED") for r in _jobs()))
        self.assertTrue(self.learning.reasons)
        self.assertEqual(len([row for row in self.snap["ledgers"] if row["positionState"] == "CLOSED"]), 1)

    def test_same_candle_is_not_analysed_twice(self):
        payload = {"timeframe": "D1", "kind": "INCREMENTAL", "barTime": 1_700_000_100}
        self.orch.publish("CANDLE_CHANGE", "STAGE1", symbols=["EURUSD"], payload=payload)
        self.orch.publish("CANDLE_CHANGE", "STAGE1", symbols=["EURUSD"], payload=payload)
        regime = [row for row in _jobs() if row[2] == "RUN_REGIME"]
        self.assertEqual(len(regime), 1)

    def test_analysis_pause_holds_research_and_still_protects_positions(self):
        with mock.patch.object(autonomy_service.analysis_gate, "paused", return_value=True):
            self.orch.publish("CANDLE_CHANGE", "STAGE1", symbols=["EURUSD"],
                              payload={"timeframe": "H1", "kind": "INCREMENTAL", "barTime": 50})
            self.orch.publish("RISK_CHANGE", "STAGE8", symbols=["EURUSD"], payload={"what": "PROTECT"})
            _drain(self.orch)
        states = {(row[1], row[2]): row[3] for row in _jobs()}
        self.assertEqual(states[(8, "MARK_RISK")], "RETRY")
        self.assertEqual(states[(9, "MARK_EXECUTION")], "DONE")
        self.assertTrue(self.execution.reasons)
        self.assertFalse(self.risk.reasons)

    def test_restart_recovers_a_leased_job_once(self):
        self.scanner.mark = lambda reason: self.scanner.reasons.append(str(reason))
        self.orch.publish("CANDLE_CHANGE", "STAGE1", symbols=["EURUSD"],
                          payload={"timeframe": "D1", "kind": "INCREMENTAL", "barTime": 77})
        first = store.claim_job(self.orch.node)
        self.assertIsNotNone(first)
        self.assertGreaterEqual(store.recover_jobs(), 1)
        second = store.claim_job(self.orch.node)
        self.assertEqual(second["id"], first["id"])
        self.orch._execute(second)
        regime = [row for row in _jobs() if row[2] == "RUN_REGIME"]
        self.assertEqual(len(regime), 1)
        self.assertEqual(regime[0][3], "DONE")
        self.orch.publish("CANDLE_CHANGE", "STAGE1", symbols=["EURUSD"],
                          payload={"timeframe": "D1", "kind": "INCREMENTAL", "barTime": 77})
        self.assertEqual(len([row for row in _jobs() if row[2] == "RUN_REGIME"]), 1)

    def test_disconnect_reconciles_execution_without_recomputing_research(self):
        self.orch.publish("MT5_DISCONNECTED", "MT5", stage=1, payload={"connected": False})
        rows = _jobs()
        self.assertEqual([row[2] for row in rows], ["MARK_EXECUTION"])
        _drain(self.orch)
        self.assertEqual(self.execution.reasons, ["MT5_DISCONNECTED"])
        self.assertFalse(self.scanner.reasons)

    def test_diagnostic_stage_cannot_reach_execution(self):
        self.vision.mark = lambda symbols, reason: self.vision.reasons.append(f"{reason}:{','.join(symbols)}")
        self.orch.publish("DIAGNOSTIC_REPROCESS", "OPERATOR", stage=5, symbols=["EURUSD"],
                          payload={"reason": "operator", "stage": 5, "symbol": "EURUSD"})
        _drain(self.orch)
        actions = {row[2] for row in _jobs()}
        self.assertEqual(actions, {"MARK_VISION"})
        self.assertFalse(self.execution.reasons)

    def test_stale_upstream_is_not_presented_as_live(self):
        self.snap["scanner"] = [{
            "symbol": "EURUSD", "state": "PROMOTED", "reason": "old promotion",
            "stage1": {"status": "STALE", "reason": "feed stale"},
            "base": {"asset": "EUR", "composite": 4, "regime": "Strengthening"},
            "quote": {"asset": "USD", "composite": -3, "regime": "Weakening"},
            "freshness": {"status": "STALE", "reason": "Strength observation behind the latest D1"},
        }]
        self.snap["vision"] = [{"symbol": "EURUSD", "status": "READY", "reason": "old channel"}]
        self.snap["confirm"] = [{"symbol": "EURUSD", "state": "CONFIRMED", "confirmed": True, "reason": "old H1", "score": 90}]
        self.orch.refresh_world("STALE_CHECK")
        world = _world()
        self.assertEqual(world[("EURUSD", 2)][1], "STALE")
        self.assertNotEqual(world[("EURUSD", 4)][1], "PASSED")
        self.assertNotEqual(world[("EURUSD", 5)][1], "PASSED")
        self.assertNotEqual(world[("EURUSD", 7)][1], "PASSED")
        self.assertEqual(world[("EURUSD", 4)][0], "HEALTHY")

    def test_pause_new_trades_blocks_submission_and_keeps_the_engine_healthy(self):
        self.snap["control"]["tradingEnabled"] = False
        self.snap["opportunities"] = [{"symbol": "EURUSD", "accountId": "usd-demo", "state": "AUTHORIZED", "authorizedAccounts": 1, "reason": "eligible", "score": 60}]
        self.snap["confirm"] = [{"symbol": "EURUSD", "confirmed": True, "state": "CONFIRMED", "reason": "H1", "score": 60}]
        self.snap["direction"] = [{"symbol": "EURUSD", "readyForH1": True, "state": "READY_FOR_H1", "reason": "aligned"}]
        self.snap["vision"] = [{"symbol": "EURUSD", "status": "READY", "reason": "channel"}]
        self.snap["scanner"] = [{
            "symbol": "EURUSD", "state": "PROMOTED", "reason": "promoted",
            "stage1": {"status": "READY", "reason": "fresh"},
            "base": {"asset": "EUR", "composite": 2, "regime": "Strengthening"},
            "quote": {"asset": "USD", "composite": -2, "regime": "Weakening"},
            "freshness": {"status": "CURRENT", "reason": "current"},
        }]
        self.orch.refresh_world("PAUSE_NEW")
        world = _world()
        self.assertEqual(world[("EURUSD", 9)][1], "BLOCKED")
        self.assertEqual(world[("EURUSD", 9)][2], "TRADING_PAUSED")
        self.assertEqual(world[("EURUSD", 9)][0], "HEALTHY")
        self.execution.mark("RISK_CHANGE")
        self.assertEqual(self.snap["ledgers"], [])

    def test_heartbeat_is_not_healthy_while_mt5_is_down(self):
        down = autonomy_service.AutonomousOrchestrator(
            ["EURUSD"], lambda _body: {"ok": True}, self.scanner, self.vision, self.direction,
            self.confirm, self.risk, self.execution, self.learning, connected_fn=lambda: False,
        )
        down._periodic(1_000_000)
        self.assertEqual(down.meta["status"], "DEGRADED")
        self.assertFalse(down.meta["connected"])


class LearningBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        store.ensure_schema()

    def test_learning_never_writes_prop_rules_and_tightens_only_when_configured(self):
        set_setting("learning.autoApply", '["minRewardRisk","maxSpreadAtr"]')
        held = learning_service.LearningService._apply_permitted([
            {"parameter": "minRewardRisk", "direction": "REVIEW_UP", "reason": "lose rate", "autoApplied": False},
        ])
        self.assertFalse(held[0]["autoApplied"])
        before, _ = __import__("risk_store").load_config()
        applied = learning_service.LearningService._apply_permitted([
            {"parameter": "maxSpreadAtr", "direction": "TIGHTEN", "reason": "slippage", "autoApplied": False},
        ])
        after, _ = __import__("risk_store").load_config()
        self.assertTrue(applied[0]["autoApplied"])
        self.assertLess(after["maxSpreadAtr"], before["maxSpreadAtr"])
        loosened = learning_service.LearningService._apply_permitted([
            {"parameter": "maxSpreadAtr", "direction": "LOOSEN", "reason": "must not apply", "autoApplied": False},
        ])
        again, _ = __import__("risk_store").load_config()
        self.assertFalse(loosened[0]["autoApplied"])
        self.assertEqual(again["maxSpreadAtr"], after["maxSpreadAtr"])
        set_setting("learning.autoApply", "[]")
        self.assertEqual(get_setting("learning.autoApply"), "[]")


if __name__ == "__main__":
    unittest.main()
