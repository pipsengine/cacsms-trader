"""Trend-within-trend scenarios A–J.

The dominant HTF trend stays put unless HTF evidence confirms a reversal.
Channel location never authorizes a trade by itself.
"""

from __future__ import annotations

import unittest

import confirm
import direction
import leg_model
from test_confirm import BULL_BOS, NOW, PULLBACK, s6, scenario, series
from test_direction import NOW as DIR_NOW, scan, tf, vis


def leg(**kw):
    base = dict(dominant_direction="BULLISH", position=20, d1_confirmed=True, d1_status="ACTIVE",
                d1_confidence=80, h8_direction="BULLISH", h8_confirmed=True, h1_bias=1, h1_confirmed_break=True)
    base.update(kw)
    return leg_model.classify(**base)


class MarketLeg(unittest.TestCase):
    def test_a_continuation_long(self):
        o = leg()
        self.assertEqual(o["dominantTrend"], "BULLISH")
        self.assertEqual(o["currentLeg"], "BULLISH_IMPULSE")
        self.assertEqual(o["tradeType"], "TREND_CONTINUATION_LONG")
        self.assertTrue(o["candidate"])
        self.assertEqual(o["reversalState"], "NONE")
        self.assertGreater(o["confidence"]["continuation"], 0)
        self.assertEqual(o["confidence"]["reversal"], 0)

    def test_b_counter_trend_short_does_not_flip_d1(self):
        o = leg(position=91, h8_direction="BEARISH", h1_bias=-1)
        self.assertEqual(o["dominantTrend"], "BULLISH")
        self.assertEqual(o["currentLeg"], "BEARISH_CORRECTION")
        self.assertEqual(o["ltfTrend"], "BEARISH")
        self.assertEqual(o["relationship"], "CORRECTIVE")
        self.assertEqual(o["tradeType"], "COUNTER_TREND_SHORT")
        self.assertEqual(o["entryDirection"], "SHORT")
        self.assertEqual(o["reversalState"], "NONE")
        self.assertEqual(o["expectedDestination"], "D1_LOWER_STRUCTURAL_ZONE")
        self.assertTrue(o["candidate"])
        self.assertTrue(o["roomOk"])
        self.assertGreater(o["confidence"]["correction"], 0)
        self.assertEqual(o["confidence"]["reversal"], 0)
        self.assertEqual([t["layer"] for t in o["targets"]], ["TP1", "TP2", "FINAL_STRUCTURAL_TARGET"])

    def test_c_upper_channel_without_bearish_h1_is_not_a_short(self):
        o = leg(position=91)
        self.assertEqual(o["dominantTrend"], "BULLISH")
        self.assertEqual(o["tradeType"], "NONE")
        self.assertFalse(o["candidate"])
        self.assertEqual(o["reasonCode"], "LOCATION_IS_CONTEXT")
        self.assertEqual(o["reversalState"], "NONE")

    def test_d_late_counter_trend_short_has_no_room(self):
        o = leg(position=12, h8_direction="BEARISH", h1_bias=-1)
        self.assertEqual(o["tradeType"], "COUNTER_TREND_SHORT")
        self.assertFalse(o["candidate"])
        self.assertFalse(o["roomOk"])
        self.assertEqual(o["reasonCode"], "INSUFFICIENT_RETRACEMENT_ROOM")
        self.assertEqual(o["dominantTrend"], "BULLISH")

    def test_e_counter_trend_long(self):
        o = leg(dominant_direction="BEARISH", position=10, h8_direction="BULLISH", h1_bias=1)
        self.assertEqual(o["dominantTrend"], "BEARISH")
        self.assertEqual(o["currentLeg"], "BULLISH_CORRECTION")
        self.assertEqual(o["tradeType"], "COUNTER_TREND_LONG")
        self.assertEqual(o["reversalState"], "NONE")
        self.assertTrue(o["candidate"])
        self.assertEqual(o["expectedDestination"], "D1_UPPER_STRUCTURAL_ZONE")

    def test_f_correction_becomes_confirmed_reversal(self):
        none = leg_model.advance_reversal("NONE", {"ltf_opposes": True})
        self.assertEqual(none, "NONE")
        potential = leg_model.advance_reversal("NONE", {"ltf_opposes": True, "boundary_failed": True})
        developing = leg_model.advance_reversal(potential, {"ltf_opposes": True, "boundary_failed": True, "htf_bos": True})
        confirmed = leg_model.advance_reversal(developing, {"ltf_opposes": True, "boundary_failed": True, "htf_bos": True, "sustained_outside": True})
        self.assertEqual((potential, developing, confirmed), ("POTENTIAL", "DEVELOPING", "CONFIRMED"))
        o = leg(position=91, h8_direction="BEARISH", h1_bias=-1, d1_status="BROKEN", d1_boundary_failed=True,
                htf_bos=True, sustained_outside=True, reversal_state="DEVELOPING")
        self.assertEqual(o["reversalState"], "CONFIRMED")
        self.assertEqual(o["tradeType"], "REVERSAL_SHORT")
        self.assertNotEqual(o["currentLeg"], "BEARISH_CORRECTION")

    def test_g_opposition_without_bos_waits(self):
        o = leg(position=91, h8_direction="BEARISH", h1_bias=-1, h1_confirmed_break=False)
        self.assertFalse(o["candidate"])
        self.assertEqual(o["reasonCode"], "AWAITING_LTF_STRUCTURE")
        self.assertEqual(o["reversalState"], "NONE")
        self.assertEqual(o["tradeType"], "NONE")

    def test_h_stale_structure_blocks(self):
        o = leg(position=91, h8_direction="BEARISH", h1_bias=-1, stale=True)
        self.assertFalse(o["candidate"])
        self.assertEqual(o["reasonCode"], "STALE_STRUCTURE")
        block = leg_model.risk_decision(o, reward_risk=3, confidence=90, base_min_rr=2, base_min_confidence=65)
        self.assertEqual(block["code"], "STALE_STRUCTURE")

    def test_i_failed_correction_re_evaluates_continuation(self):
        o = leg(position=20, prior_trade_type="COUNTER_TREND_SHORT")
        self.assertEqual(o["relationship"], "ALIGNED")
        self.assertEqual(o["reasonCode"], "CONTINUATION_REEVALUATED")
        self.assertEqual(o["tradeType"], "TREND_CONTINUATION_LONG")
        self.assertTrue(o["candidate"])
        held = leg_model.management_transition("COUNTER_TREND_SHORT", o)
        self.assertEqual(held["action"], "EXIT")
        self.assertEqual(held["code"], "CORRECTION_FAILED")
        self.assertTrue(held["transition"]["originalUnchanged"])
        self.assertEqual(held["transition"]["originalTradeType"], "COUNTER_TREND_SHORT")

    def test_j_counter_trend_rr_must_clear_its_own_minimum(self):
        o = leg(position=91, h8_direction="BEARISH", h1_bias=-1)
        block = leg_model.risk_decision(o, reward_risk=2.1, confidence=80, base_min_rr=2.0, base_min_confidence=65)
        self.assertEqual(block["code"], "INSUFFICIENT_REWARD_RISK")
        clear = leg_model.risk_decision(o, reward_risk=2.6, confidence=80, base_min_rr=2.0, base_min_confidence=65)
        self.assertIsNone(clear)
        room = leg_model.risk_decision(leg(position=12, h8_direction="BEARISH", h1_bias=-1),
                                       reward_risk=3, confidence=90, base_min_rr=2, base_min_confidence=65)
        self.assertEqual(room["code"], "INSUFFICIENT_RETRACEMENT_ROOM")

    def test_boundary_touch_is_not_a_reversal(self):
        o = leg(position=100, h8_direction="BULLISH", h1_bias=1)
        self.assertEqual(o["reversalState"], "NONE")
        self.assertEqual(o["tradeType"], "NONE")
        self.assertEqual(o["reasonCode"], "LOCATION_IS_CONTEXT")

    def test_confidence_is_zero_without_evidence(self):
        o = leg_model.classify(dominant_direction="NEUTRAL", position=50, d1_confirmed=False)
        self.assertEqual(o["confidence"], {"continuation": 0.0, "correction": 0.0, "reversal": 0.0})
        self.assertFalse(o["candidate"])


def _stage6(**kw) -> dict:
    zone = kw.pop("zone", "VALUE")
    phase = kw.pop("phase", "PULLBACK")
    o = s6(zone=zone, phase=phase)
    o["position"]["d1"] = kw.pop("position", o["position"]["d1"])
    if "h8" in kw:
        o["h8"]["direction"] = kw.pop("h8")
        o["alignment"] = "PULLBACK"
    if kw.get("stale"):
        o["freshness"]["status"] = "STALE"
    return o


class Pipeline(unittest.TestCase):
    def test_stage6_keeps_bullish_d1_during_a_bearish_h8_correction(self):
        o = direction.evaluate("EURUSD", scan(), vis(tf(position=40), tf(dirn="BEARISH", position=20), live_d1=91.0), None, DIR_NOW)
        self.assertEqual(o["direction"], "BULLISH")
        self.assertEqual(o["expectedDirection"], "BULLISH")
        self.assertEqual(o["marketLeg"]["dominantTrend"], "BULLISH")
        self.assertEqual(o["marketLeg"]["currentLeg"], "BEARISH_CORRECTION")
        self.assertEqual(o["marketLeg"]["reversalState"], "NONE")
        self.assertNotEqual(o["marketLeg"]["tradeType"], "COUNTER_TREND_SHORT")
        self.assertIn(o["marketLeg"]["reasonCode"], ("POTENTIAL_COUNTER_TREND_ZONE", "AWAITING_LTF_STRUCTURE"))

    def test_stage7_confirms_counter_trend_short(self):
        o = confirm.evaluate("EURUSD", _stage6(position=91, zone="EXTENDED", h8="BEARISH"), series(), scenario(*BULL_BOS, mirror=True), NOW)
        self.assertEqual(o["state"], "CONFIRMED", o["reason"])
        self.assertEqual(o["reasonCode"], "CONFIRMED_COUNTER_TREND")
        self.assertEqual(o["tradeType"], "COUNTER_TREND_SHORT")
        self.assertEqual(o["direction"], "BULLISH")
        self.assertEqual(o["expectedDirection"], "BEARISH")
        self.assertEqual(o["marketLeg"]["reversalState"], "NONE")
        self.assertEqual(o["handoff"]["direction"], "BEARISH")
        self.assertEqual(o["handoff"]["structuralDirection"], "BULLISH")
        self.assertFalse(o["handoff"]["executes"])

    def test_stage7_does_not_short_a_bullish_h1_at_the_upper_boundary(self):
        o = confirm.evaluate("EURUSD", _stage6(position=91, zone="EXTENDED"), series(), scenario(*BULL_BOS), NOW)
        self.assertNotEqual(o["reasonCode"], "CONFIRMED_COUNTER_TREND")
        self.assertNotEqual((o.get("marketLeg") or {}).get("tradeType"), "COUNTER_TREND_SHORT")
        self.assertNotEqual(o["state"], "CONFIRMED")

    def test_stage7_rejects_a_late_short_and_waits_without_a_break(self):
        late = confirm.evaluate("EURUSD", _stage6(position=8, h8="BEARISH"), series(), scenario(*BULL_BOS, mirror=True), NOW)
        self.assertEqual(late["state"], "BLOCKED")
        self.assertEqual(late["reasonCode"], "INSUFFICIENT_RETRACEMENT_ROOM")
        waiting = confirm.evaluate("EURUSD", _stage6(position=91, zone="EXTENDED", h8="BEARISH"), series(), scenario(*PULLBACK, mirror=True), NOW)
        self.assertEqual(waiting["state"], "MONITORING")
        self.assertEqual(waiting["reasonCode"], "AWAITING_LTF_STRUCTURE")
        self.assertIsNone(waiting["handoff"])

    def test_stale_h1_cannot_confirm(self):
        o = confirm.evaluate("EURUSD", _stage6(position=91, zone="EXTENDED", h8="BEARISH"), series(status="STALE"), scenario(*BULL_BOS, mirror=True), NOW)
        self.assertNotEqual(o["state"], "CONFIRMED")
        self.assertIsNone(o["handoff"])


if __name__ == "__main__":
    unittest.main()
