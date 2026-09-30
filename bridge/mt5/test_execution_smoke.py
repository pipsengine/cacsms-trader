"""Demo-only Stage 9 smoke test: the synthetic authorization runs the real execution path without an upstream setup, and never
executes on a Live / Prop account."""

from __future__ import annotations

import unittest

import execution as ex
import execution_smoke as smoke
import test_execution as te
import test_risk as tr


def smoke_env(cls="DEMO", side="BUY"):
    e = te.Env(accounts=[tr.acct(cls=cls)], auths=[])
    e.t[0] += 2
    res = smoke.build(e.accounts[0], e.mt5.terminal(), e.mt5.market("EURUSD"), e.mt5.fx(600), e.clock(), "EURUSD", side)
    return e, res


class SmokeBuild(unittest.TestCase):
    def test_refuses_non_demo(self):
        for cls in ("LIVE", "PROP"):
            _, res = smoke_env(cls)
            self.assertFalse(res["ok"])
            self.assertIn("not DEMO", res["message"])

    def test_refuses_other_terminal_login(self):
        e = te.Env(accounts=[tr.acct()], auths=[])
        e.mt5.acct["login"] = "999"
        res = smoke.build(e.accounts[0], e.mt5.terminal(), e.mt5.market("EURUSD"), e.mt5.fx(600), e.clock())
        self.assertFalse(res["ok"])

    def test_minimum_volume_with_symmetric_stops(self):
        _, res = smoke_env(side="SELL")
        a = res["authorization"]
        self.assertTrue(res["ok"])
        self.assertTrue(smoke.is_smoke(a))
        self.assertEqual(a["volume"], 0.01)
        entry = a["entryPolicy"]["referencePrice"]
        self.assertGreater(a["stopLoss"], entry)
        self.assertAlmostEqual(a["stopLoss"] - entry, entry - a["takeProfit"], places=5)
        self.assertLessEqual(len(a["executionId"]), 31)


class SmokeExecution(unittest.TestCase):
    def test_demo_lifecycle_to_stage10(self):
        e, res = smoke_env()
        a = res["authorization"]
        e.store.add_auth(a)
        e.store.up["EURUSD"] = {"opportunityActive": False, "setupState": None, "stage7State": "NO_SETUP", "stage7Direction": None}
        e.tick()
        x = e.x(a["executionId"])
        self.assertEqual(e.store.auth[a["executionId"]]["status"], "CONSUMED")
        self.assertEqual((x["orderState"], x["positionState"]), ("FILLED", "PROTECTED"))
        req = e.mt5.entry_sends()[0]
        self.assertEqual((req["volume"], req["sl"], req["tp"], req["comment"]), (0.01, a["stopLoss"], a["takeProfit"], a["executionId"]))

        self.assertTrue(e.svc.request_exit(a["executionId"], "smoke", "smoke test close")["ok"])
        e.tick(2)
        x = e.x(a["executionId"])
        self.assertEqual((x["positionState"], x["exitReason"]), ("CLOSED", "OPERATOR_EXIT"))
        self.assertEqual(e.mt5.pos, [])
        self.assertIn(a["executionId"], e.store.published)

    def test_revalidation_declines_smoke_on_live_class(self):
        e, res = smoke_env()
        a = {**res["authorization"], "accountClass": "LIVE"}
        acct = {**e.accounts[0], "accountClass": "LIVE", "attached": True, "snapshotAt": e.clock()}
        ctx = {"now": e.clock(), "control": {"newEntries": True}, "authStatus": "PENDING", "account": acct, "market": e.mt5.market("EURUSD"),
               "fx": e.mt5.fx(600), "marginPerLot": 100.0, "exposure": {}, "upstream": {}}
        rv = ex.revalidate(a, ctx, ex.merge_config({})[0])
        self.assertFalse(rv["ok"])
        self.assertTrue(rv["terminal"])
        self.assertEqual(rv["code"], "SMOKE_NOT_DEMO")

    def test_stage8_keeps_pending_smoke_authorization(self):
        _, res = smoke_env()
        a = res["authorization"]
        out = tr.run([], [tr.acct()], pending=[a])
        self.assertNotIn(a["executionId"], [r["executionId"] for r in out["revocations"]])
        paused = tr.run([], [tr.acct()], pending=[a], auto=False)
        self.assertIn(a["executionId"], [r["executionId"] for r in paused["revocations"]])


if __name__ == "__main__":
    unittest.main()
