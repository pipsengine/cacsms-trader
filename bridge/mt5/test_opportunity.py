"""Trend-in-Trend discovery, retracement zones, campaign risk and XAU priority. No orders are placed."""

from __future__ import annotations

import unittest

import opportunity
import opportunity_replay
import regime

BUDGET = opportunity.CONFIG["campaignBudgetPct"]


def ch(tf: str, direction: str, status: str = "ACTIVE", position: float = 40, lower: float = 1.0, upper: float = 1.2,
       confidence: float = 70) -> dict:
    return {"timeframe": tf, "direction": direction, "status": status, "position": position, "lower": lower, "upper": upper,
            "mid": (lower + upper) / 2, "channelId": f"EURUSD:{tf}", "confidence": confidence, "atr": 0.01}


def pack(**tfs: dict) -> dict:
    return tfs


class Discovery(unittest.TestCase):
    def test_normal_continuation_still_qualifies(self):
        channels = pack(D1=ch("D1", "BULLISH"), H8=ch("H8", "BULLISH", position=35))
        result = opportunity.scan(["EURUSD"], {"EURUSD": channels}, {"EURUSD": {"state": "READY_FOR_H1", "tradeType": "TREND_CONTINUATION"}})
        families = [h.get("opportunityFamily") for h in result["instruments"][0]["hypotheses"]]
        self.assertIn("NORMAL_TREND_CONTINUATION", families)

    def test_tit_is_visible_when_stage4_rank_is_not_first(self):
        channels = pack(D1=ch("D1", "BULLISH", position=30), H8=ch("H8", "BEARISH", position=70, lower=1.05, upper=1.18))
        result = opportunity.scan(["EURUSD"], {"EURUSD": channels}, ranks={"EURUSD": 18})
        live = [h for h in result["instruments"][0]["hypotheses"] if h.get("TiTLevel") == "L2" and h.get("opportunityFamily")]
        self.assertTrue(live, result["instruments"][0]["hypotheses"])
        self.assertEqual(live[0]["scannerRank"], 18)
        self.assertEqual(live[0]["opportunityFamily"], "TIT_CORRECTION")

    def test_levels_use_their_own_parent_and_child(self):
        channels = pack(
            MN=ch("MN", "BULLISH", lower=1.0, upper=1.4),
            W=ch("W", "BEARISH", lower=1.1, upper=1.3),
            D1=ch("D1", "BEARISH", lower=1.12, upper=1.28),
            H8=ch("H8", "BULLISH", lower=1.14, upper=1.22),
            H1=ch("H1", "BEARISH", lower=1.15, upper=1.2),
            M15=ch("M15", "BULLISH", lower=1.16, upper=1.19),
            M5=ch("M5", "BULLISH"),
        )
        found = {h["TiTLevel"]: h for h in opportunity.classify_levels("EURUSD", channels) if h.get("opportunityFamily")}
        self.assertEqual(found["L1"]["childTimeframe"], "D1")
        self.assertEqual(found["L2"]["childTimeframe"], "H8")
        self.assertEqual(found["L3"]["childTimeframe"], "H1")
        self.assertEqual(found["L4"]["childTimeframe"], "M15")
        self.assertEqual(found["L4"]["executionTimeframe"], "M5")
        self.assertNotEqual(found["L1"]["campaignId"], found["L4"]["campaignId"])

    def test_xau_l4_does_not_require_rank_one(self):
        channels = pack(H1=ch("H1", "BULLISH", lower=2300, upper=2500), M15=ch("M15", "BEARISH", lower=2360, upper=2440))
        result = opportunity.scan(
            ["XAUUSD"], {"XAUUSD": channels}, ranks={"XAUUSD": 29}, prices={"XAUUSD": 2395},
            confirmations={"XAUUSD": {"M5": {"direction": "BULLISH", "state": "CONFIRMED", "timing": "ENTER_NOW", "extension": 0.4, "reaction": True}}},
        )
        self.assertEqual(result["summary"]["xau"], "QUALIFIED")
        self.assertTrue(any("independently of Stage 4" in r for h in result["qualified"] for r in h["reasons"]))

    def test_erz_is_a_zone_and_not_fib_only(self):
        zone = opportunity.expected_retracement_zone(ch("D1", "BULLISH"), ch("H8", "BEARISH", lower=1.05, upper=1.18), 1)
        self.assertLess(zone["zoneLow"], zone["zoneHigh"])
        self.assertIn("parent channel", zone["reasons"][0])
        self.assertIsNotNone(zone["channelBoundary"])

    def test_h1_confirmation_releases_p2_while_price_is_outside_the_zone(self):
        parent, child = ch("D1", "BULLISH", position=30), ch("H8", "BULLISH", position=35)
        outside = opportunity.classify_levels(
            "XAUUSD", pack(H1=parent, M15=child), price=1.40,
            confirmation_by_tf={"M5": {"direction": "BULLISH", "state": "CONFIRMED", "timing": "ENTER_NOW", "extension": 0.4}},
        )
        # L4 execution is M5. Parent for L4 is H1 when H8 is absent.
        l4 = next(h for h in outside if h.get("TiTLevel") == "L4")
        self.assertEqual(l4["p1"]["reason"], "WAITING_FOR_ERZ")
        self.assertEqual(l4["p2"]["state"], "P2_READY_FOR_RISK")
        self.assertTrue(l4["actionable"])
        held = opportunity.classify_levels(
            "XAUUSD", pack(H1=parent, M15=child), price=1.40,
            confirmation_by_tf={"M5": {"direction": "BULLISH", "state": "BREAKOUT_CONFIRMED_WAIT_RETEST", "timing": "WAIT_RETEST", "extension": 1.4}},
        )
        l4b = next(h for h in held if h.get("TiTLevel") == "L4")
        self.assertEqual(l4b["p1"]["reason"], "WAITING_FOR_ERZ")
        self.assertEqual(l4b["p2"]["state"], "P2_WAIT_RETEST")
        self.assertFalse(l4b["actionable"])

    def test_waiting_for_erz_does_not_block_an_independent_p2(self):
        parent, child = ch("D1", "BULLISH", position=30), ch("H8", "BEARISH", lower=1.02, upper=1.12)
        outside = opportunity.classify_levels("GBPJPY", pack(D1=parent, H8=child), price=1.19, break_valid=False)
        l2 = next(h for h in outside if h.get("TiTLevel") == "L2")
        self.assertEqual(l2["p1"]["reason"], "WAITING_FOR_ERZ")
        self.assertEqual(l2["p2"]["reason"], "WAITING_FOR_BREAK")
        self.assertEqual(l2["blocker"], "WAITING_FOR_BREAK")
        self.assertFalse(l2["actionable"])
        released = opportunity.classify_levels(
            "GBPJPY", pack(D1=parent, H8=child), price=1.19,
            confirmation_by_tf={"H1": {"direction": "BULLISH", "state": "CONFIRMED", "timing": "ENTER_NOW", "extension": 0.4}},
        )
        l2b = next(h for h in released if h.get("TiTLevel") == "L2")
        self.assertEqual(l2b["p1"]["state"], "P1_WAITING_FOR_ERZ")
        self.assertEqual(l2b["p2"]["state"], "P2_READY_FOR_RISK")
        self.assertTrue(l2b["actionable"])
        self.assertEqual(l2b["blocker"], "P2_READY_FOR_RISK")
        unknown = opportunity.classify_levels("GBPJPY", pack(D1=parent, H8=child))
        l2c = next(h for h in unknown if h.get("TiTLevel") == "L2")
        self.assertEqual(l2c["p1"]["reason"], "PRICE_UNKNOWN")
        self.assertNotEqual(l2c["blocker"], "WAITING_FOR_ERZ")
        self.assertIsNone(l2c["location"]["inside"])

    def test_closed_prefix_excludes_the_next_bar(self):
        bars = [(i * 86400, 1, 1, 1, 1.0 + i, 1) for i in range(4)]
        prefix = opportunity_replay.closed_prefix(bars, "D1", 2 * 86400, 10)
        self.assertEqual([row[0] for row in prefix], [0, 86400])

    def test_p1_reaction_and_p2_are_independent(self):
        parent, child = ch("D1", "BULLISH", position=30), ch("H8", "BEARISH", lower=1.02, upper=1.12)
        zone = opportunity.expected_retracement_zone(parent, child, 1)
        ready = opportunity.classify_levels("EURUSD", pack(D1=parent, H8=child), price=(zone["zoneLow"] + zone["zoneHigh"]) / 2, break_valid=False)
        l2 = next(h for h in ready if h.get("TiTLevel") == "L2")
        self.assertEqual(l2["p1"]["state"], "P1_ZONE_REACHED")
        self.assertEqual(l2["p1"]["reason"], "P1_REACTION_PENDING")
        self.assertFalse(l2["actionable"])
        self.assertEqual(l2["p2"]["state"], "P2_WAITING_FOR_BREAK")
        reacted = opportunity.classify_levels(
            "EURUSD", pack(D1=parent, H8=child), price=(zone["zoneLow"] + zone["zoneHigh"]) / 2,
            confirmation_by_tf={"H1": {"direction": "BEARISH", "state": "CONFIRMED", "timing": "ENTER_NOW", "extension": 0.2, "reaction": True}},
        )
        l2r = next(h for h in reacted if h.get("TiTLevel") == "L2")
        self.assertEqual(l2r["p1"]["state"], "P1_READY_FOR_RISK")
        self.assertTrue(l2r["actionable"])
        later = opportunity.classify_levels(
            "EURUSD", pack(D1=parent, H8=child), price=1.19,
            confirmation_by_tf={"H1": {"direction": "BULLISH", "state": "CONFIRMED", "timing": "ENTER_NOW", "extension": 0.4}},
        )
        l2b = next(h for h in later if h.get("TiTLevel") == "L2")
        self.assertEqual(l2b["p2"]["state"], "P2_READY_FOR_RISK")
        self.assertNotEqual(l2b["p1"]["state"], "P1_FILLED")

    def test_extended_break_waits_for_retest(self):
        parent, child = ch("D1", "BULLISH", position=40), ch("H8", "BEARISH")
        rows = opportunity.classify_levels("EURUSD", pack(D1=parent, H8=child), extension_atr=3.0, break_valid=True)
        l2 = next(h for h in rows if h.get("TiTLevel") == "L2")
        self.assertEqual(l2["p2"]["state"], "P2_WAIT_RETEST")
        self.assertFalse(l2["p2"]["riskPct"] > 0 and l2["p2"]["state"] == "P2_READY")

    def test_shared_campaign_budget_never_doubles(self):
        parent, child = ch("D1", "BULLISH", position=30), ch("H8", "BEARISH", lower=1.02, upper=1.12)
        zone = opportunity.expected_retracement_zone(parent, child, 1)
        rows = opportunity.classify_levels(
            "EURUSD", pack(D1=parent, H8=child), price=(zone["zoneLow"] + zone["zoneHigh"]) / 2,
            confirmation_by_tf={"H1": {"direction": "BULLISH", "state": "CONFIRMED", "timing": "ENTER_NOW", "extension": 0.4, "reaction": True}},
        )
        l2 = next(h for h in rows if h.get("TiTLevel") == "L2")
        self.assertAlmostEqual(l2["p1"]["riskPct"] + l2["p2"]["riskPct"], BUDGET)
        self.assertLess(l2["p1"]["riskPct"], BUDGET)
        self.assertLess(l2["p2"]["riskPct"], BUDGET)

    def test_failed_break_does_not_authorize_p2(self):
        rows = opportunity.classify_levels("EURUSD", pack(D1=ch("D1", "BULLISH"), H8=ch("H8", "BEARISH", status="BROKEN")), break_valid=False)
        l2 = next(h for h in rows if h.get("TiTLevel") == "L2")
        self.assertEqual(l2["p2"]["state"], "P2_WAITING_FOR_BREAK")
        self.assertNotEqual(l2["childRole"], "REVERSAL_CANDIDATE")

    def test_correction_end_buys_with_the_parent(self):
        rows = opportunity.classify_levels("EURUSD", pack(D1=ch("D1", "BULLISH"), H8=ch("H8", "BEARISH")), extension_atr=0.4, break_valid=True)
        l2 = next(h for h in rows if h.get("TiTLevel") == "L2")
        self.assertEqual(l2["opportunityFamily"], "TIT_CORRECTION_END")
        self.assertEqual(l2["direction"], "BULLISH")

    def test_portfolio_allows_many_small_positions_and_blocks_concentration(self):
        small = [{"instrument": f"ZZ{i:02d}USD", "direction": "BULLISH", "remainingRisk": 0.1} for i in range(12)]
        # Synthetic symbols are not FX; use real diversified names under the currency limit.
        names = ["EURUSD", "USDJPY", "EURGBP", "AUDJPY", "GBPCHF", "EURCAD", "GBPAUD", "NZDJPY", "CADCHF", "EURNZD", "GBPCAD", "AUDNZD"]
        proposals = [{"instrument": n, "direction": "BULLISH", "remainingRisk": 0.1} for n in names]
        allowed = opportunity.govern(proposals, [], {"currencyLimitPct": 2.0, "portfolioLimitPct": 3.0, "positionCeiling": 20, "xauReservePct": 0})
        self.assertGreaterEqual(sum(1 for p in allowed if p["decision"] == "ALLOW"), 10)
        crowded = [{"symbol": s, "side": "BUY", "riskPct": 0.6} for s in ("EURUSD", "GBPUSD", "AUDUSD")]
        blocked = opportunity.govern([{"instrument": "NZDUSD", "direction": "BULLISH", "remainingRisk": 0.6}], crowded,
                                     {"currencyLimitPct": 2.0, "portfolioLimitPct": 5.0, "positionCeiling": 20, "xauReservePct": 0})
        self.assertEqual(blocked[0]["decision"], "BLOCK")

    def test_xau_reserve_and_emergency_veto(self):
        held = opportunity.govern(
            [{"instrument": "EURUSD", "direction": "BULLISH", "remainingRisk": 1.0}],
            [],
            {"currencyLimitPct": 5, "portfolioLimitPct": 1.2, "positionCeiling": 20, "xauReservePct": 0.5, "xauReservePolicy": "STRICT_RESERVE"},
        )
        self.assertIn(held[0]["decision"], ("ALLOW_REDUCED", "BLOCK"))
        veto = opportunity.govern([{"instrument": "XAUUSD", "direction": "BULLISH", "remainingRisk": 0.2}], [], emergency=True)
        self.assertEqual(veto[0]["decision"], "EMERGENCY_BLOCK")

    def test_reconnect_and_unknown_data_do_not_execute_history(self):
        channels = pack(D1=ch("D1", "BULLISH"), H8=ch("H8", "BEARISH"))
        missed = opportunity.scan(["EURUSD"], {"EURUSD": channels}, missed=True)
        self.assertFalse(any(h.get("actionable") for h in missed["qualified"]))
        stale = opportunity.scan(["EURUSD"], {"EURUSD": channels}, data_ok=False)
        self.assertTrue(any("fail closed" in " ".join(h.get("reasons") or []) for h in stale["instruments"][0]["hypotheses"]))

    def test_campaign_identity_is_stable(self):
        channels = pack(D1=ch("D1", "BULLISH"), H8=ch("H8", "BEARISH"))
        a = opportunity.classify_levels("EURUSD", channels)
        b = opportunity.classify_levels("EURUSD", channels)
        self.assertEqual(a[1]["campaignId"], b[1]["campaignId"])

    def test_every_symbol_is_scanned(self):
        result = opportunity.scan(list(regime.SYMBOLS), {})
        self.assertEqual(result["summary"]["scanned"], 29)
        self.assertEqual(result["summary"]["universe"], 29)
        self.assertEqual(result["summary"]["xau"], "WATCHING")


if __name__ == "__main__":
    unittest.main()
