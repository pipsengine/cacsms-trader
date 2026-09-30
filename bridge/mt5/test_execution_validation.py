"""M15/M5 storage rules, leg semantics, episodes and counterfactual portfolio studies."""

from __future__ import annotations

import unittest
from datetime import date

import execution_validation as ev
import history
import opportunity
import opportunity_replay


def ch(tf, direction, **kw):
    base = {"timeframe": tf, "direction": direction, "status": "ACTIVE", "position": 40,
            "lower": 1.0, "upper": 1.2, "mid": 1.1, "channelId": f"EURUSD:{tf}", "confidence": 70, "atr": 0.01}
    base.update(kw)
    return base


class Storage(unittest.TestCase):
    def test_execution_backfill_is_batched(self):
        self.assertEqual(history.backfill_request("M5", 0, 12000, 1000), 1000)
        self.assertEqual(history.backfill_request("M15", 11500, 12000, 1000), 500)
        self.assertEqual(history.backfill_request("H1", 100, 6000, 1000), 5900)

    def test_duplicate_and_out_of_order_candles_collapse(self):
        rows = [(900, 1, 1.1, 0.9, 1.05, 10, 1), (0, 1, 1.1, 0.9, 1.0, 10, 1), (900, 1, 1.2, 0.9, 1.08, 12, 1)]
        clean, issues = history.normalize_batch("M15", rows)
        self.assertEqual([row[0] for row in clean], [0, 900])
        self.assertEqual(clean[1][4], 1.08)
        self.assertTrue(any(item["code"] == "DUPLICATE" for item in issues))
        self.assertTrue(any(item["code"] == "OUT_OF_ORDER" for item in issues))

    def test_closure_calendar_is_not_a_missing_bar(self):
        start = 4 * 86400
        gaps, expected = history.find_gaps("M15", [start, start + 3600], {date(1970, 1, 5)})
        self.assertGreater(expected, 0)
        self.assertEqual(gaps, [])

    def test_a_weekday_hole_is_a_gap(self):
        start = 4 * 86400
        times = [start, start + 3600]
        for day in range(1, 4):
            base = start + day * 86400
            times.extend([base + step for step in (0, 900, 1800, 2700, 3600)])
        gaps, _ = history.find_gaps("M15", times, set())
        self.assertTrue(gaps)
        self.assertGreater(gaps[0][2], 0)


class ConfirmationReachable(unittest.TestCase):
    def test_replay_prefix_meets_the_existing_minimum(self):
        import confirm
        self.assertGreaterEqual(ev.confirmation_prefix_length(), int(confirm.CONFIG["minBars"]))
        self.assertEqual(ev.confirmation_prefix_length(), int(confirm.CONFIG["lookback"]))

    def test_a_short_prefix_cannot_reach_confirmation(self):
        import confirm_engine
        bars = [(i * 900, 1.0, 1.01, 0.99, 1.0 + i * 0.0001) for i in range(240)]
        decision = confirm_engine.ConfirmationEngine("M15").evaluate(
            "XAUUSD", bars, "BULLISH", now_ts=bars[-1][0] + 900,
            parent={"direction": "BULLISH", "position": 40, "confidence": 70},
        )
        self.assertEqual(decision["state"], "WARMING_UP")
        self.assertEqual(decision["reasonCode"], "INSUFFICIENT_H1_HISTORY")

    def test_bos_or_choch_is_not_both_required(self):
        with open("confirm.py", encoding="utf-8") as handle:
            text = handle.read()
        self.assertIn("g[\"bos\"][\"status\"] == \"PASS\" or g[\"choch\"][\"status\"] == \"PASS\"", text)


class Legs(unittest.TestCase):
    def test_zone_entry_is_not_actionable(self):
        parent, child = ch("D1", "BULLISH", position=30), ch("H8", "BEARISH", lower=1.02, upper=1.12)
        zone = opportunity.expected_retracement_zone(parent, child, 1)
        rows = opportunity.classify_levels("EURUSD", {"D1": parent, "H8": child}, price=(zone["zoneLow"] + zone["zoneHigh"]) / 2)
        leg = next(row for row in rows if row.get("TiTLevel") == "L2")
        self.assertEqual(leg["p1"]["state"], "P1_ZONE_REACHED")
        self.assertFalse(leg["actionable"])

    def test_l3_uses_m15_confirmation_not_h1(self):
        channels = {"D1": ch("D1", "BULLISH"), "H1": ch("H1", "BULLISH", lower=1.05, upper=1.15)}
        h1_only = opportunity.classify_levels(
            "GBPUSD", channels, price=1.2,
            confirmation_by_tf={"H1": {"direction": "BULLISH", "state": "CONFIRMED", "timing": "ENTER_NOW", "extension": 0.3}},
        )
        l3 = next(row for row in h1_only if row.get("TiTLevel") == "L3")
        self.assertNotEqual(l3["p2"]["state"], "P2_READY_FOR_RISK")
        m15 = opportunity.classify_levels(
            "GBPUSD", channels, price=1.2,
            confirmation_by_tf={"M15": {"direction": "BULLISH", "state": "CONFIRMED", "timing": "ENTER_NOW", "extension": 0.3}},
        )
        ready = next(row for row in m15 if row.get("TiTLevel") == "L3")
        self.assertEqual(ready["p2"]["state"], "P2_READY_FOR_RISK")
        self.assertEqual(ready["executionTimeframe"], "M15")

    def test_xau_l4_uses_m5(self):
        channels = {"H1": ch("H1", "BULLISH", lower=2300, upper=2500), "M15": ch("M15", "BULLISH", lower=2360, upper=2440)}
        rows = opportunity.classify_levels(
            "XAUUSD", channels, price=2500,
            confirmation_by_tf={"M5": {"direction": "BULLISH", "state": "CONFIRMED", "timing": "ENTER_NOW", "extension": 0.4}},
        )
        l4 = next(row for row in rows if row.get("TiTLevel") == "L4")
        self.assertEqual(l4["childTimeframe"], "M15")
        self.assertEqual(l4["p2"]["state"], "P2_READY_FOR_RISK")
        self.assertEqual(l4["p1"]["state"], "P1_WAITING_FOR_ERZ")

    def test_closed_m15_prefix_excludes_the_next_bar(self):
        bars = [(i * 900, 1, 1, 1, 1, 1) for i in range(4)]
        prefix = opportunity_replay.closed_prefix(bars, "M15", 2 * 900, 10)
        self.assertEqual([row[0] for row in prefix], [0, 900])


class Measurement(unittest.TestCase):
    def test_episode_persisting_across_bars_is_one_opportunity(self):
        sample = {"instrument": "XAUUSD", "TiTLevel": "L4", "direction": "BULLISH", "opportunityFamily": "TIT_CONTINUATION",
                  "parentChannelId": "a", "childChannelId": "b", "location": {"inside": False},
                  "p1": {"state": "P1_WAITING_FOR_ERZ"}, "p2": {"state": "P2_WAITING_FOR_BREAK"}}
        folded = ev.fold_episodes([sample] * 20)
        self.assertEqual(folded["episodes"], 1)
        self.assertEqual(folded["samples"], 20)
        self.assertEqual(folded["neither"], 1)

    def test_mae_mfe_and_r_use_only_later_bars(self):
        bars = [
            (0, 1.0, 1.02, 0.99, 1.01),
            (300, 1.01, 1.04, 1.00, 1.03),
            (600, 1.03, 1.08, 1.02, 1.07),
        ]
        path = ev.measure_trade(bars, 0, 1.01, 0.99, 1.06, 1)
        self.assertEqual(path["exitReason"], "TARGET")
        self.assertEqual(path["r"], 2.5)
        self.assertGreater(path["mfe"], 0)
        self.assertIsNotNone(path["mae"])
        empty = ev.measure_trade(bars[:1], 0, 1.01, 0.99, 1.06, 1)
        self.assertEqual(empty["exitReason"], "INSUFFICIENT_HISTORY")

    def test_operator_cap_is_a_counterfactual(self):
        events = [
            {"ts": i, "exitTs": i + 5, "instrument": name, "direction": "BULLISH", "riskPct": 0.1}
            for i, name in enumerate(["EURUSD", "USDJPY", "EURGBP", "AUDJPY", "GBPCHF", "EURCAD"])
        ]
        study = ev.capacity_study(events, (3, 20))
        self.assertTrue(study[0]["production"])
        self.assertFalse(study[1]["production"])
        self.assertLessEqual(study[0]["peakConcurrent"], 3)
        self.assertGreaterEqual(study[0]["decisions"]["QUEUE"], 1)

    def test_reserve_study_does_not_change_the_zero_reserve_baseline(self):
        events = [
            {"ts": 1, "exitTs": 9, "instrument": "EURUSD", "direction": "BULLISH", "riskPct": 1.0},
            {"ts": 2, "exitTs": 9, "instrument": "USDJPY", "direction": "BULLISH", "riskPct": 1.0},
            {"ts": 3, "exitTs": 9, "instrument": "AUDJPY", "direction": "BULLISH", "riskPct": 1.0},
        ]
        study = ev.reserve_study(events, (0.0, 0.5))
        self.assertTrue(study[0]["production"])
        self.assertGreaterEqual(study[1]["fxWithheld"], study[0]["fxWithheld"])

    def test_missing_execution_history_is_not_sufficient(self):
        report = ev.coverage_report({})
        self.assertEqual(report["m15Symbols"], 0)
        self.assertFalse(any(row["measurable"] for row in report["rows"]))

    def test_stage6_is_not_invented(self):
        self.assertFalse(ev.STAGE6["measured"])

    def _episode_item(self, *, inside: bool, price: float = 10.0, p1: str = "P1_WAITING_FOR_ERZ", p2: str = "P2_WAITING_FOR_BREAK"):
        return {
            "instrument": "XAUUSD", "TiTLevel": "L3", "direction": "BULLISH", "opportunityFamily": "TIT_CORRECTION",
            "parentChannelId": "parent", "childChannelId": "child", "parentTimeframe": "H1", "childTimeframe": "M15",
            "campaignId": "abc",
            "location": {"inside": inside, "price": price, "distance": 0.0 if inside else abs(price - 11.0)},
            "expectedRetracementZone": {
                "zoneLow": 9.0, "zoneHigh": 11.0, "preferredPrice": 10.0, "expectedBreakLevel": 12.0,
                "invalidationLevel": 8.0, "atrContext": 1.0,
            },
            "p1": {"state": p1}, "p2": {"state": p2},
        }

    def test_engine_trigger_is_read_from_the_decision_itself(self):
        diag = ev._diag_from_decision(
            {"state": "CONFIRMING", "reasonCode": "AWAITING_REMAINING_GATES", "trigger": {"type": "CHOCH"},
             "pullback": "COMPLETE", "reaction": True, "entry": {"timing": "ENTER_NOW"}},
            "BULLISH",
        )
        self.assertEqual(diag["trigger"], "CHOCH")
        self.assertEqual(diag["pullback"], "COMPLETE")

    def test_no_reaction_is_not_a_failed_reaction(self):
        item = self._episode_item(inside=True, price=10.0)
        row = ev._new_episode(item, {"M15": {"status": "ACTIVE", "touchCount": 4}})
        ev.observe_episode(row, item, {"state": "MONITORING", "reasonCode": "AWAITING_PULLBACK", "pullback": "NONE",
                                        "trigger": None, "reaction": False, "timing": None, "direction": "BULLISH",
                                        "retest": False, "falseBreak": False, "quality": None}, {})
        stage, reason, kind = ev._p1_outcome(row)
        self.assertEqual(stage, "P1_REACTION_MONITORING")
        self.assertEqual(reason, "AWAITING_PULLBACK")
        self.assertEqual(kind, "NEVER")
        self.assertFalse(row["reactionInZone"])

    def test_reaction_without_structure_is_a_failed_confirmation(self):
        item = self._episode_item(inside=True, price=10.0)
        row = ev._new_episode(item, {})
        ev.observe_episode(row, item, {"state": "SETUP_FORMING", "reasonCode": "AWAITING_H1_BREAK", "pullback": "HOLDING",
                                        "trigger": None, "reaction": True, "timing": "NONE", "direction": "BULLISH",
                                        "retest": False, "falseBreak": False, "quality": None}, {})
        stage, reason, kind = ev._p1_outcome(row)
        self.assertEqual(stage, "P1_REACTION_DETECTED")
        self.assertEqual(reason, "AWAITING_H1_BREAK")
        self.assertEqual(kind, "FAILED")

    def test_aligned_break_without_confirmation_is_not_no_break(self):
        item = self._episode_item(inside=False, price=12.5)
        row = ev._new_episode(item, {})
        ev.observe_episode(row, item, {"state": "CONFIRMING", "reasonCode": "AWAITING_REMAINING_GATES", "pullback": "COMPLETE",
                                        "trigger": "BOS", "reaction": True, "timing": "ENTER_NOW", "direction": "BULLISH",
                                        "retest": False, "falseBreak": False, "quality": "ACCEPTABLE"}, {})
        stage, reason, kind = ev._p2_outcome(row)
        self.assertEqual(stage, "P2_CLOSED_BREAK")
        self.assertEqual(reason, "AWAITING_REMAINING_GATES")
        self.assertEqual(kind, "FAILED")
        self.assertNotEqual(reason, "NO_BREAK_OCCURRED")

    def test_opposite_channel_break_does_not_confirm_the_trade(self):
        item = self._episode_item(inside=False, price=12.5)
        row = ev._new_episode(item, {})
        ev.observe_episode(row, item, {"state": "CONFIRMING", "reasonCode": "AWAITING_REMAINING_GATES", "pullback": "COMPLETE",
                                        "trigger": "BOS", "reaction": True, "timing": "ENTER_NOW", "direction": "BEARISH",
                                        "retest": False, "falseBreak": False, "quality": "ACCEPTABLE"}, {})
        stage, reason, kind = ev._p2_outcome(row)
        self.assertEqual(reason, "EXECUTION_CHANNEL_OPPOSES_TRADE")
        self.assertEqual(kind, "FAILED")
        self.assertNotEqual(stage, "P2_CLOSED_BREAK")

    def test_extended_break_without_a_retest_is_never_retested(self):
        item = self._episode_item(inside=False, price=13.0, p2="P2_WAIT_RETEST")
        row = ev._new_episode(item, {})
        ev.observe_episode(row, item, {"state": "BREAKOUT_CONFIRMED_WAIT_RETEST", "reasonCode": "WAIT_RETEST",
                                        "pullback": "COMPLETE", "trigger": "CHOCH", "reaction": True, "timing": "WAIT_RETEST",
                                        "direction": "BULLISH", "retest": False, "falseBreak": False, "quality": "OVEREXTENDED"}, {})
        _stage, reason, kind = ev._p2_outcome(row)
        self.assertEqual(reason, "NO_RETEST_OCCURRED")
        self.assertEqual(kind, "NEVER")
        self.assertEqual(ev._retest_stage(row), "P2_WAIT_RETEST")

    def test_reaction_outside_the_zone_does_not_advance_p1(self):
        item = self._episode_item(inside=False, price=12.0)
        row = ev._new_episode(item, {})
        ev.observe_episode(row, item, {"state": "SETUP_FORMING", "reasonCode": "AWAITING_H1_BREAK", "pullback": "HOLDING",
                                        "trigger": None, "reaction": True, "timing": "NONE", "direction": "BULLISH",
                                        "retest": False, "falseBreak": False, "quality": None}, {})
        stage, reason, kind = ev._p1_outcome(row)
        self.assertEqual(kind, "NEVER")
        self.assertNotEqual(stage, "P1_REACTION_DETECTED")
        self.assertIn(reason, ("PRICE_NEVER_ENTERED_ZONE", "PRICE_NEVER_APPROACHED_ZONE"))


if __name__ == "__main__":
    unittest.main()
