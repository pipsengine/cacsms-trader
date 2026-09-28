"""Parent and nested channels are detected independently and stay linked.

A bearish H1 channel inside a bullish D1 channel is a correction. It does not
replace the parent, and a move without the touch geometry is not a channel.
"""

from __future__ import annotations

import unittest

import leg_model
import vision
from test_vision import bars_from_closes, channel_closes

HOUR = 3600
BULL = ("BULLISH", "STRONG_BULLISH")
BEAR = ("BEARISH", "STRONG_BEARISH")


def ready(direction: str = "BULLISH") -> dict:
    return {"qualified": True, "reason": "test", "direction": direction, "state": "PROMOTED"}


class NestedChannels(unittest.TestCase):
    def test_a_bullish_parent_and_bearish_h1_channel_coexist(self):
        d1 = vision.analyse_tf("D1", bars_from_closes(channel_closes(300, 0.02, 7)))
        h1 = vision.analyse_tf("H1", bars_from_closes(channel_closes(300, -0.02, 7), HOUR))
        parent_direction = d1["direction"]
        vision.link_channels(d1, None, h1)
        self.assertTrue(d1["confirmed"])
        self.assertTrue(h1["confirmed"])
        self.assertIn(parent_direction, BULL)
        self.assertEqual(d1["direction"], parent_direction)
        self.assertIn(h1["direction"], BEAR)
        self.assertEqual(d1["relationship"], "PRIMARY")
        self.assertEqual(h1["relationship"], "CORRECTIVE")
        self.assertEqual(h1["parentChannelId"], d1["channelKey"])
        self.assertNotEqual(d1["channelKey"], h1["channelKey"])
        self.assertGreater(d1["upper"], d1["lower"])
        self.assertGreater(h1["upper"], h1["lower"])
        self.assertNotEqual(round(d1["upper"], 4), round(h1["upper"], 4))
        out = vision.combine("EURUSD", ready(), d1, None, ("READY", "d1"), ("READY", "h8"), h1, ("READY", "h1"))
        self.assertEqual(out["primaryDirection"], parent_direction)
        self.assertEqual(out["nested"]["h1Status"], h1["status"])
        self.assertEqual(out["nested"]["h1Relationship"], "CORRECTIVE")
        self.assertEqual(out["h1"]["parentChannelId"], d1["channelKey"])
        self.assertEqual(out["d1"]["relationship"], "PRIMARY")

    def test_b_bearish_parent_and_bullish_h1_channel_coexist(self):
        d1 = vision.analyse_tf("D1", bars_from_closes(channel_closes(300, -0.02, 7)))
        h1 = vision.analyse_tf("H1", bars_from_closes(channel_closes(300, 0.02, 7), HOUR))
        vision.link_channels(d1, None, h1)
        self.assertIn(d1["direction"], BEAR)
        self.assertIn(h1["direction"], BULL)
        self.assertEqual(d1["relationship"], "PRIMARY")
        self.assertEqual(h1["relationship"], "CORRECTIVE")
        self.assertEqual(h1["parentChannelId"], d1["channelId"])

    def test_c_opposite_movement_without_geometry_is_not_a_channel(self):
        d1 = vision.analyse_tf("D1", bars_from_closes(channel_closes(300, 0.02, 7)))
        h1 = vision.analyse_tf("H1", bars_from_closes([100 + 0.01 * i for i in range(200)], HOUR))
        vision.link_channels(d1, None, h1)
        self.assertEqual(h1["status"], "NONE")
        self.assertFalse(h1["confirmed"])
        self.assertIsNone(h1.get("def"))
        self.assertNotEqual(h1["relationship"], "CORRECTIVE")
        out = vision.combine("EURUSD", ready(), d1, None, ("READY", "d1"), ("READY", "h8"), h1, ("READY", "h1"))
        self.assertEqual(out["nested"]["h1Status"], "NOT_DETECTED")
        self.assertIsNone(out["nested"]["h1ChannelId"])
        self.assertIn(d1["direction"], BULL)

    def test_d_correction_becomes_reversal_only_after_parent_failure(self):
        d1 = vision.analyse_tf("D1", bars_from_closes(channel_closes(300, 0.02, 7)))
        h1 = vision.analyse_tf("H1", bars_from_closes(channel_closes(300, -0.02, 7), HOUR))
        vision.link_channels(d1, None, h1)
        self.assertEqual(h1["relationship"], "CORRECTIVE")
        d1["status"] = "BROKEN"
        vision.link_channels(d1, None, h1)
        self.assertEqual(d1["relationship"], "PRIMARY")
        self.assertEqual(h1["relationship"], "REVERSAL_CANDIDATE")
        self.assertEqual(leg_model.advance_reversal("NONE", {"ltf_opposes": True}), "NONE")
        state = leg_model.advance_reversal("NONE", {"ltf_opposes": True, "boundary_failed": True})
        state = leg_model.advance_reversal(state, {"ltf_opposes": True, "boundary_failed": True, "htf_bos": True})
        state = leg_model.advance_reversal(state, {"ltf_opposes": True, "boundary_failed": True, "htf_bos": True, "sustained_outside": True})
        self.assertEqual(state, "CONFIRMED")

    def test_e_valid_structure_can_still_fail_risk(self):
        d1 = vision.analyse_tf("D1", bars_from_closes(channel_closes(300, 0.02, 7)))
        h1 = vision.analyse_tf("H1", bars_from_closes(channel_closes(300, -0.02, 7), HOUR))
        vision.link_channels(d1, None, h1)
        self.assertEqual(h1["relationship"], "CORRECTIVE")
        leg = leg_model.classify(
            dominant_direction="BULLISH", position=91, d1_confirmed=True, d1_confidence=80,
            h8_direction="BEARISH", h8_confirmed=True, h1_bias=-1, h1_confirmed_break=True,
        )
        self.assertEqual(leg["tradeType"], "COUNTER_TREND_SHORT")
        self.assertTrue(leg["candidate"])
        block = leg_model.risk_decision(leg, reward_risk=2.1, confidence=80, base_min_rr=2.0, base_min_confidence=65)
        self.assertEqual(block["code"], "INSUFFICIENT_REWARD_RISK")
        self.assertTrue(h1["confirmed"])
        self.assertGreater(h1["upper"], h1["lower"])


if __name__ == "__main__":
    unittest.main()
