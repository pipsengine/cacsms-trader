"""Stage 10 measures stored evidence and does not treat P&L as the decision grade."""

from __future__ import annotations

import unittest

import learning as engine


def trade(i: int, *, pnl: float, r: float, kind: str, currency: str = "USD", slip: float | None = 1.0, evidence: bool = True) -> dict:
    return engine.normalize_trade({
        "executionId": f"e{i}",
        "accountId": "a1",
        "accountClass": "DEMO",
        "currency": currency,
        "symbol": "NZDUSD" if i % 2 == 0 else "USDCHF",
        "setupKey": kind,
        "direction": "BUY",
        "realizedPnl": pnl,
        "rMultiple": r,
        "slippagePoints": slip,
        "exitReason": "TAKE_PROFIT" if pnl > 0 else "STOP_LOSS",
        "openedAt": f"2026-01-{i+1:02d}T00:00:00",
        "closedAt": f"2026-01-{i+1:02d}T04:00:00",
        "doc": {"evidence": {"stage7": {"tradeType": kind, "confidence": 60}}} if evidence else {},
    })


class LearningMeasure(unittest.TestCase):
    def test_setup_classes_stay_separate(self):
        self.assertEqual(engine.setup_class("COUNTER_TREND"), "COUNTER_TREND_CORRECTION")
        self.assertEqual(engine.relationship("COUNTER_TREND_CORRECTION"), "COUNTER_TREND")
        self.assertEqual(engine.relationship("TREND_CONTINUATION"), "PRIMARY")
        rows = [trade(i, pnl=1, r=0.4, kind="TREND_CONTINUATION") for i in range(4)]
        rows += [trade(i + 4, pnl=-1, r=-0.5, kind="COUNTER_TREND") for i in range(4)]
        groups = {row["label"]: row for row in engine.analytics(rows)["byRelationship"]}
        self.assertEqual(groups["PRIMARY"]["sample"], 4)
        self.assertEqual(groups["COUNTER_TREND"]["sample"], 4)
        self.assertNotEqual(groups["PRIMARY"]["evidenceKeys"], groups["COUNTER_TREND"]["evidenceKeys"])

    def test_profit_is_not_a_good_decision_label(self):
        row = trade(1, pnl=10, r=1.2, kind="TREND_CONTINUATION")
        self.assertEqual(row["outcome"], "WIN")
        self.assertIn("not treat P&L as proof", engine.grade_note(row))
        loser = trade(2, pnl=-3, r=-1, kind="TREND_CONTINUATION")
        self.assertIn("not treat P&L as proof the decision was invalid", engine.grade_note(loser))

    def test_empty_and_small_samples_stay_insufficient(self):
        empty = engine.performance([])
        self.assertIsNone(empty["netPnl"])
        self.assertIn("INSUFFICIENT SAMPLE", empty["netNote"])
        self.assertEqual(engine.insights([], [])[0]["code"], "INSUFFICIENT_SAMPLE")
        few = [trade(i, pnl=1, r=0.2, kind="TREND_CONTINUATION") for i in range(3)]
        perf = engine.performance(few)
        self.assertIsNone(perf["sharpe"])
        self.assertIn("INSUFFICIENT SAMPLE", perf["sharpeNote"])
        self.assertIsNone(perf["expectancy"])
        plan = engine.proposals(few, {"maxSpreadAtr": 0.2})
        self.assertEqual(plan["lifecycle"], "OBSERVE")
        self.assertEqual(plan["proposals"], [])
        self.assertFalse(plan["sampleSufficient"])

    def test_mixed_currencies_are_not_summed(self):
        rows = [trade(1, pnl=10, r=1, kind="TREND_CONTINUATION", currency="USD"), trade(2, pnl=5000, r=1, kind="TREND_CONTINUATION", currency="NGN")]
        perf = engine.performance(rows)
        self.assertIsNone(perf["netPnl"])
        self.assertIn("USD", perf["netNote"])
        self.assertIn("NGN", perf["netNote"])
        self.assertEqual(perf["curve"], [])

    def test_proposal_does_not_mark_itself_applied(self):
        rows = [trade(i, pnl=-1, r=-0.2, kind="TREND_CONTINUATION", slip=6) for i in range(20)]
        plan = engine.proposals(rows, {"maxSpreadAtr": 0.2})
        self.assertEqual(plan["lifecycle"], "PROPOSE")
        self.assertEqual(plan["proposals"][0]["candidateValue"], 0.18)
        self.assertFalse(plan["proposals"][0]["applied"])
        self.assertEqual(plan["proposals"][0]["productionValue"], 0.2)

    def test_holdout_must_confirm_before_shadow(self):
        short = [trade(i, pnl=-1, r=-0.2, kind="TREND_CONTINUATION", slip=6) for i in range(20)]
        proposal = engine.proposals(short, {"maxSpreadAtr": 0.2})["proposals"][0]
        held = engine.validate_candidate(short, proposal)
        self.assertEqual(held["status"], "INSUFFICIENT_OOS")
        self.assertEqual(held["lifecycle"], "PROPOSE")
        confirmed = [trade(i, pnl=-1, r=-0.2, kind="TREND_CONTINUATION", slip=6) for i in range(30)]
        verdict = engine.validate_candidate(confirmed, proposal)
        self.assertEqual(verdict["status"], "PASSED")
        self.assertEqual(verdict["lifecycle"], "SHADOW")
        self.assertFalse(proposal["applied"])
        allowed, _ = engine.promotion_allowed({**proposal, "lifecycle": "SHADOW", "validation": verdict})
        self.assertTrue(allowed)
        blocked, message = engine.promotion_allowed(proposal)
        self.assertFalse(blocked)
        self.assertIn("out-of-sample", message)

    def test_price_path_is_not_invented(self):
        missing = engine.price_diagnosis(executed=False, direction="BUY", closes=[])
        self.assertEqual(missing["label"], "NO_PATH")
        winner = engine.price_diagnosis(executed=False, direction="BUY", closes=[1.0, 1.02])
        self.assertEqual(winner["label"], "REJECTED_WINNER")
        avoided = engine.price_diagnosis(executed=False, direction="BUY", closes=[1.0, 0.98])
        self.assertEqual(avoided["label"], "AVOIDED_LOSER")
        unknown = engine.price_diagnosis(executed=False, direction="NEUTRAL", closes=[1.0, 1.02])
        self.assertEqual(unknown["label"], "UNLABELLED")

    def test_missing_stage_evidence_is_explicit(self):
        row = trade(1, pnl=1, r=0.2, kind="TREND_CONTINUATION", evidence=False)
        stored = {s["stage"]: s["stored"] for s in row["stages"]}
        self.assertFalse(stored[4])
        self.assertTrue(stored[10])
        self.assertEqual(row["process"], "INCOMPLETE")


if __name__ == "__main__":
    unittest.main()
