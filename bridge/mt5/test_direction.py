"""Stage 6 Structural Direction: decision engine scenarios + autonomous service triggers."""

from __future__ import annotations

import copy
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

import direction
import direction_service

NOW = time.time()


def iso(offset_sec: float = 0) -> str:
    return (datetime.fromtimestamp(NOW, timezone.utc) + timedelta(seconds=offset_sec)).isoformat()


def scan(dirn="BULLISH", conviction=70.0, diff=6.0, state="PROMOTED", alignment="ALIGNED", traj="WIDENING", pers=60.0,
         fresh="CURRENT", promoted_at=None, reason="Stage 4 promoted"):
    return {
        "symbol": "EURUSD", "state": state, "direction": dirn, "conviction": conviction, "confidence": 60.0, "differential": diff,
        "macroBias": dirn, "relationship": "STRONG_VS_WEAK" if diff > 0 else "WEAK_VS_STRONG", "alignment": alignment,
        "trajectory": traj, "acceleration": "STEADY", "persistence": pers, "reason": reason, "rank": 1,
        "freshness": {"status": fresh, "reason": "Strength from closed D1"}, "promotedAt": promoted_at or iso(-3600),
        "base": {"asset": "EUR", "composite": 3.0, "regime": "Strengthening", "group": "BULLISH"},
        "quote": {"asset": "USD", "composite": -3.0, "regime": "Weakening", "group": "BEARISH"},
    }


def tf(status="ACTIVE", dirn="BULLISH", phase="IMPULSE", position=30.0, confidence=75.0, breakout=None, lean=None,
       data="READY", last_ts=1_000):
    confirmed = status in ("VALIDATED", "ACTIVE", "WEAKENING", "BROKEN", "RETESTING")
    return {"dataStatus": data, "dataReason": f"{data} reason", "status": status, "direction": dirn, "lean": lean or dirn,
            "confirmed": confirmed, "position": position, "phase": phase, "confidence": confidence, "channelKey": f"k-{status}",
            "lastTs": last_ts, "breakout": breakout, "touches": {"anchor": 4, "opposite": 2, "total": 6}}


def vis(d1, h8, status="READY", qualified=True, analysed=None, live_d1=None, reason="D1 and H8 validated history analysed"):
    return {"symbol": "EURUSD", "status": status, "reason": reason, "scanner": {"qualified": qualified},
            "primaryDirection": d1["direction"], "agreement": "AGREE", "phase": d1["phase"], "confidence": 70,
            "d1": d1, "h8": h8, "invalidation": ["D1 close below the lower boundary 1.0800 breaks the channel"],
            "evidence": [], "live": {"price": 1.09, "positionD1": live_d1, "positionH8": None, "marketOpen": False},
            "analysedAt": analysed or iso(-60)}


def ev(sc, v, run_at=None):
    return direction.evaluate("EURUSD", sc, v, run_at or iso(-60), NOW)


class Decisions(unittest.TestCase):
    def test_bullish_alignment_ready_for_h1(self):
        o = ev(scan(), vis(tf(), tf(confidence=70)))
        self.assertEqual(o["state"], "READY_FOR_H1")
        self.assertEqual(o["alignment"], "ALIGNED")
        self.assertEqual(o["direction"], "STRONG_BULLISH")
        self.assertEqual(o["reasonCode"], "READY_CONTINUATION")
        self.assertFalse(o["handoff"]["executes"])
        self.assertEqual(o["handoff"]["expectedDirection"], "BULLISH")
        self.assertTrue(o["handoff"]["invalidation"])
        self.assertEqual(len(o["components"]), 9)

    def test_bearish_alignment_ready_for_h1(self):
        sc = scan("BEARISH", diff=-6.0)
        o = ev(sc, vis(tf(dirn="BEARISH", position=70), tf(dirn="BEARISH", position=60)))
        self.assertEqual(o["state"], "READY_FOR_H1")
        self.assertEqual(direction.dir_sign(o["direction"]), -1)
        self.assertEqual(o["zone"]["name"], "VALUE")

    def test_d1_trend_with_h8_pullback_is_not_rejected(self):
        o = ev(scan(), vis(tf(position=45), tf(dirn="BEARISH", phase="IMPULSE")))
        self.assertEqual(o["alignment"], "PULLBACK")
        self.assertEqual(o["structuralPhase"], "PULLBACK")
        self.assertEqual(o["direction"], "BULLISH")
        self.assertEqual(o["state"], "READY_FOR_H1")
        self.assertEqual(o["reasonCode"], "READY_PULLBACK")
        self.assertFalse(o["conflicts"])

    def test_h8_channel_break_against_healthy_d1_is_a_deep_pullback(self):
        brk = {"side": "DOWN", "ts": 900, "retesting": False}
        o = ev(scan(), vis(tf(position=35), tf(status="BROKEN", dirn="BEARISH", phase="BREAKOUT", breakout=brk)))
        self.assertEqual(o["alignment"], "PULLBACK")
        self.assertNotIn(o["state"], ("CONFLICT", "BLOCKED"))
        self.assertEqual(direction.dir_sign(o["direction"]), 1)
        self.assertTrue(any("deep correction" in c["detail"] for c in o["components"]))

    def test_h8_reversal_against_deteriorating_d1_is_conflict(self):
        o = ev(scan(), vis(tf(status="WEAKENING", phase="DETERIORATION", confidence=55), tf(dirn="BEARISH")))
        self.assertEqual(o["state"], "CONFLICT")
        self.assertEqual(o["reasonCode"], "H8_REVERSAL_AGAINST_D1")
        self.assertEqual(o["direction"], "NEUTRAL")
        self.assertFalse(o["readyForH1"])
        self.assertTrue(o["conflicts"])

    def test_reversal_with_macro_against_is_blocked(self):
        o = ev(scan("BEARISH", diff=-5.0), vis(tf(status="WEAKENING", phase="DETERIORATION"), tf(dirn="BEARISH")))
        self.assertEqual(o["state"], "BLOCKED")
        self.assertEqual(o["reasonCode"], "STRUCTURAL_REVERSAL")

    def test_scanner_bias_against_d1_is_conflict(self):
        o = ev(scan("BEARISH", diff=-6.0), vis(tf(), tf()))
        self.assertEqual(o["state"], "CONFLICT")
        self.assertEqual(o["reasonCode"], "SCANNER_STRUCTURE_CONFLICT")
        self.assertEqual(o["direction"], "NEUTRAL")

    def test_breakout(self):
        brk = {"side": "UP", "ts": 900, "retesting": False}
        o = ev(scan(), vis(tf(status="BROKEN", dirn="STRONG_BULLISH", phase="BREAKOUT", position=110, breakout=brk), tf(confidence=70)))
        self.assertEqual(o["structuralPhase"], "BREAKOUT")
        self.assertEqual(o["reasonCode"], "READY_BREAKOUT")
        self.assertEqual(o["state"], "READY_FOR_H1")

    def test_retest(self):
        brk = {"side": "UP", "ts": 900, "retesting": True}
        o = ev(scan(), vis(tf(status="RETESTING", dirn="STRONG_BULLISH", phase="RETEST", position=101, breakout=brk), tf(confidence=70)))
        self.assertEqual(o["structuralPhase"], "RETEST")
        self.assertEqual(o["reasonCode"], "READY_RETEST")

    def test_reversal_breakout_with_macro_agreement(self):
        brk = {"side": "DOWN", "ts": 900, "retesting": False}
        o = ev(scan("BEARISH", diff=-6.0), vis(tf(status="BROKEN", dirn="BEARISH", phase="BREAKOUT", position=-8, breakout=brk),
                                                 tf(dirn="BEARISH", confidence=70)))
        self.assertEqual(o["structuralPhase"], "REVERSAL")
        self.assertEqual(o["reasonCode"], "READY_REVERSAL")
        self.assertEqual(direction.dir_sign(o["direction"]), -1)

    def test_neutral_structure(self):
        o = ev(scan(), vis(tf(dirn="NEUTRAL", phase="CONSOLIDATION"), tf()))
        self.assertEqual(o["state"], "WAITING")
        self.assertEqual(o["reasonCode"], "NEUTRAL_STRUCTURE")
        self.assertEqual(o["direction"], "NEUTRAL")

    def test_channel_not_validated(self):
        o = ev(scan(), vis(tf(status="FORMING", dirn="NEUTRAL", lean="BULLISH"), tf()))
        self.assertEqual(o["reasonCode"], "CHANNEL_NOT_VALIDATED")
        self.assertEqual(o["direction"], "NEUTRAL")
        o = ev(scan(), vis(tf(status="NONE", dirn="NEUTRAL"), tf()))
        self.assertEqual(o["reasonCode"], "CHANNEL_NOT_VALIDATED")

    def test_invalidated_d1(self):
        o = ev(scan(), vis(tf(status="INVALIDATED", dirn="NEUTRAL"), tf()))
        self.assertEqual(o["state"], "INVALIDATED")
        self.assertEqual(o["direction"], "NEUTRAL")

    def test_insufficient_history(self):
        o = ev(scan(), vis(tf(data="INSUFFICIENT_DATA"), tf(), status="INSUFFICIENT_DATA"))
        self.assertEqual((o["state"], o["reasonCode"]), ("BLOCKED", "INSUFFICIENT_D1_HISTORY"))
        o = ev(scan(), vis(tf(), tf(data="WARMING_UP"), status="WARMING_UP"))
        self.assertEqual((o["state"], o["reasonCode"]), ("WAITING", "INSUFFICIENT_H8_HISTORY"))
        self.assertEqual(o["direction"], "NEUTRAL")

    def test_stale_data(self):
        o = ev(scan(), vis(tf(data="STALE"), tf(), status="STALE", reason="D1 Stage 1 STALE: no bar"))
        self.assertEqual((o["state"], o["reasonCode"]), ("STALE", "STALE_DATA"))
        self.assertFalse(o["readyForH1"])
        o = ev(scan(), vis(tf(), tf()), run_at=iso(-7200))
        self.assertEqual(o["state"], "STALE")
        self.assertIn("Stage 5 last ran", o["reason"])

    def test_upstream_gates(self):
        o = ev(scan(state="WATCH", reason="conviction 30 < 55"), vis(tf(), tf(), status="BLOCKED", qualified=False))
        self.assertEqual((o["state"], o["reasonCode"]), ("BLOCKED", "NOT_PROMOTED_BY_SCANNER"))
        self.assertIn("conviction 30", o["reason"])
        o = ev(scan(), None)
        self.assertEqual((o["state"], o["reasonCode"]), ("ANALYSING", "WAITING_FOR_HTF_VISION"))
        o = ev(scan(promoted_at=iso(-10)), vis(tf(), tf(), analysed=iso(-600)))
        self.assertEqual(o["reasonCode"], "WAITING_FOR_HTF_VISION")
        o = ev(None, vis(tf(), tf()))
        self.assertEqual(o["reasonCode"], "WAITING_FOR_SCANNER")
        o = ev(scan(), vis(tf(data="BLOCKED"), tf(), status="BLOCKED"))
        self.assertEqual((o["state"], o["reasonCode"]), ("BLOCKED", "DATA_BLOCKED"))

    def test_extended_price_waits_for_pullback(self):
        o = ev(scan(), vis(tf(position=50), tf(), live_d1=93.0))
        self.assertEqual(o["position"]["source"], "LIVE")
        self.assertEqual((o["state"], o["reasonCode"]), ("ALIGNED", "AWAITING_PULLBACK"))
        self.assertEqual(direction.dir_sign(o["direction"]), 1)

    def test_price_beyond_channel_boundary_is_not_ready(self):
        o = ev(scan(), vis(tf(position=60), tf(), live_d1=100.5))
        self.assertEqual(o["zone"]["name"], "BEYOND_EXTENSION")
        self.assertEqual((o["state"], o["reasonCode"]), ("ALIGNED", "AWAITING_PULLBACK"))
        self.assertIn("unconfirmed breakout", o["reason"])
        o = ev(scan(), vis(tf(position=60), tf(), live_d1=-4.0))
        self.assertEqual((o["state"], o["reasonCode"]), ("WAITING", "PRICE_BEYOND_D1_SUPPORT"))

    def test_counters(self):
        rows = [ev(scan(), vis(tf(), tf())), ev(scan(), vis(tf(position=45), tf(dirn="BEARISH"))),
                ev(scan("BEARISH", diff=-6.0), vis(tf(), tf())), ev(scan(state="WATCH"), None)]
        c = direction.counters(rows)
        self.assertEqual(c["candidates"], 3)
        self.assertEqual(c["ready"], 2)
        self.assertEqual(c["conflicts"], 1)
        self.assertEqual(c["blocked"], 1)
        self.assertEqual(c["pullbackWaiting"], 1)
        self.assertEqual(c["aligned"], 2)


class AutonomousService(unittest.TestCase):
    def setUp(self):
        self.up = {
            "scanner": {"EURUSD": {**scan(), "symbol": "EURUSD"}, "GBPUSD": {**scan(state="WATCH"), "symbol": "GBPUSD"}},
            "scannerRun": {"status": "HEALTHY", "runAt": iso(-30), "promotedNow": ["EURUSD"]},
            "vision": {"EURUSD": {**vis(tf(), tf()), "symbol": "EURUSD"}},
            "visionRun": {"status": "HEALTHY", "runAt": iso(-30)},
        }
        self.persisted: list = []
        self.ready_calls: list = []
        self.patches = [
            mock.patch.object(direction_service.ds, "upstream", lambda: copy.deepcopy(self.up)),
            mock.patch.object(direction_service.ds, "persist",
                              lambda rows, ch, meta, trig: self.persisted.append((rows, ch, trig)) or (len(self.persisted) if ch else None)),
            mock.patch.object(direction_service.ds, "save_meta", lambda m: None),
            mock.patch.object(direction_service.ds, "previous_decisions", lambda: {}),
        ]
        for p in self.patches:
            p.start()
        self.svc = direction_service.DirectionService(on_ready_change=self.ready_calls.append)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_startup_persists_all_and_publishes_ready(self):
        r = self.svc.tick()
        self.assertTrue(r["ran"])
        rows, changed, _ = self.persisted[-1]
        self.assertEqual(len(rows), len(direction_service.SYMBOLS))
        self.assertEqual(len(changed), len(direction_service.SYMBOLS))
        self.assertEqual(self.ready_calls, [["EURUSD"]])
        self.assertEqual(self.svc.meta["counters"]["ready"], 1)
        self.assertFalse(self.svc.tick()["ran"])

    def test_h8_phase_change_triggers_reevaluation_and_history(self):
        self.svc.tick()
        self.up["vision"]["EURUSD"]["h8"] = tf(dirn="BEARISH")
        r = self.svc.tick()
        self.assertTrue(r["ran"])
        self.assertTrue(any(t.startswith("STAGE5_STRUCTURE_CHANGE") for t in r["triggers"]))
        _, changed, _ = self.persisted[-1]
        self.assertEqual(list(changed), ["EURUSD"])

    def test_breakout_and_candle_close_triggers(self):
        self.svc.tick()
        self.up["vision"]["EURUSD"]["d1"] = tf(status="BROKEN", dirn="STRONG_BULLISH", phase="BREAKOUT", position=110,
                                               breakout={"side": "UP", "ts": 1_100, "retesting": False}, last_ts=1_100)
        r = self.svc.tick()
        self.assertIn("BREAKOUT D1 EURUSD", r["triggers"])
        self.assertIn("NEW_CANDLE D1", r["triggers"])
        self.up["vision"]["EURUSD"]["d1"]["breakout"] = {"side": "UP", "ts": 1_100, "retesting": True}
        self.assertIn("RETEST D1 EURUSD", self.svc.tick()["triggers"])

    def test_first_analysis_is_not_a_candle_close_or_breakout(self):
        self.up["vision"]["GBPUSD"] = {**vis(tf(), tf(status="BROKEN", dirn="BEARISH", breakout={"side": "DOWN", "ts": 900, "retesting": False})),
                                       "symbol": "GBPUSD"}
        self.up["vision"]["GBPUSD"]["d1"]["lastTs"] = None
        self.up["vision"]["GBPUSD"]["h8"]["lastTs"] = None
        self.svc.tick()
        self.up["vision"]["GBPUSD"]["d1"]["lastTs"] = 1_000
        self.up["vision"]["GBPUSD"]["h8"]["lastTs"] = 1_000
        self.up["vision"]["GBPUSD"]["h8"]["breakout"] = {"side": "DOWN", "ts": 950, "retesting": False}
        trig = self.svc.tick().get("triggers") or []
        self.assertNotIn("NEW_CANDLE D1", trig)
        self.assertFalse(any(t.startswith("BREAKOUT") for t in trig))

    def test_material_strength_and_regime_triggers(self):
        self.svc.tick()
        self.up["scanner"]["EURUSD"]["differential"] = 6.3
        self.assertFalse(self.svc.tick()["ran"])
        self.up["scanner"]["EURUSD"]["differential"] = 6.6
        self.assertTrue(any(t.startswith("STRENGTH_CHANGE") for t in self.svc.tick()["triggers"]))
        self.up["scanner"]["EURUSD"]["quote"] = {**self.up["scanner"]["EURUSD"]["quote"], "regime": "Distribution"}
        self.assertTrue(any(t.startswith("REGIME_TRANSITION") for t in self.svc.tick()["triggers"]))

    def test_stage4_demotion_withdraws_ready(self):
        self.svc.tick()
        self.up["scanner"]["EURUSD"]["state"] = "QUALIFIED"
        r = self.svc.tick()
        self.assertTrue(any(t.startswith("STAGE4_RANKING_CHANGE") for t in r["triggers"]))
        self.assertEqual(self.ready_calls[-1], ["EURUSD"])
        self.assertEqual(self.svc.meta["counters"]["ready"], 0)

    def test_freshness_change_trigger(self):
        self.svc.tick()
        self.up["visionRun"]["runAt"] = iso(-7200)
        r = self.svc.tick()
        self.assertTrue(any(t.startswith("FRESHNESS_CHANGE") for t in r["triggers"]))


if __name__ == "__main__":
    unittest.main()
