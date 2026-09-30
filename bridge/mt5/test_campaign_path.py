"""Campaign confirmation through Stage 8, the test execution adapter, and Stage 10 facts.

Qualification thresholds are the existing ones. These tests use a deterministic
closed-bar series. They do not loosen a live non-actionable hypothesis.
"""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

import campaign
import confirm
import confirm_engine
import opportunity
import opportunity_replay
import risk
import test_confirm
import test_risk

CFG = {**confirm.CONFIG, "minBars": 80}


def confirmation(symbol: str, timeframe: str, direction: str = "BULLISH") -> dict:
    bars = test_confirm.scenario(*test_confirm.BULL_BOS)
    found = confirm_engine.ConfirmationEngine(timeframe).evaluate(
        symbol, bars, direction,
        parent={"timeframe": "D1", "direction": direction, "position": 40, "confidence": 80},
        child={"timeframe": "H8", "direction": direction, "position": 45, "confidence": 70},
        cfg=CFG,
    )
    found["confirmedSince"] = datetime.fromtimestamp(int(found["lastTs"]), tz=timezone.utc).isoformat()
    return found


def hypothesis(symbol: str, family: str, level: str | None, leg: str, *, rank: int = 4) -> dict:
    found = confirmation(symbol, "H1" if level in (None, "L1", "L2") else ("M15" if level == "L3" else "M5"))
    zone_low = float(found["lastClose"]) - float(found["atr"])
    zone_high = float(found["lastClose"]) + float(found["atr"]) * 0.2
    row = {
        "campaignId": f"{symbol}-{family}-{level or 'NORMAL'}",
        "instrument": symbol,
        "opportunityFamily": family,
        "TiTLevel": level,
        "parentTimeframe": "H1" if level == "L4" else "D1",
        "childTimeframe": "M15" if level == "L4" else "H8",
        "executionTimeframe": "M5" if level == "L4" else ("M15" if level == "L3" else "H1"),
        "direction": "BULLISH",
        "parentDirection": "BULLISH",
        "childDirection": "BULLISH" if family != "TIT_CORRECTION" else "BEARISH",
        "actionable": True,
        "scannerRank": rank,
        "confidence": found["score"],
        "allocatedRisk": 1.0,
        "usedRisk": 0.0,
        "remainingRisk": 1.0,
        "p1": {"state": "P1_READY" if leg == "P1" else "P1_WAITING", "riskPct": 1.0 if leg == "P1" else 0.0},
        "p2": {"state": "P2_READY" if leg == "P2" else "P2_WAITING", "riskPct": 1.0 if leg == "P2" else 0.0},
        "expectedRetracementZone": {"zoneLow": zone_low, "zoneHigh": zone_high, "expectedBreakLevel": float(found["lastClose"]) + float(found["atr"]) * 12,
                                    "invalidationLevel": found["invalidationLevel"]},
        "status": "CAMPAIGN_ACTIVE",
    }
    return row


def market_for(found: dict, symbol: str) -> dict:
    close = float(found["lastClose"])
    now = int(found["lastTs"]) + int(found["barSeconds"]) + 30
    base = test_risk.market()
    base[symbol] = {**base.get(symbol, base["EURUSD"]), "bid": close - 0.00003, "ask": close + 0.00003, "time": now - 2,
                    "spec": test_risk.spec(symbol if symbol in test_risk.SPECS else "EURUSD")}
    if symbol not in test_risk.SPECS:
        base[symbol]["spec"] = {**test_risk.spec("EURUSD"), "name": symbol}
    if symbol == "XAUUSD":
        # The deterministic series is priced near 1.15. The symbol stays XAUUSD so currency exposure is XAU/USD.
        # Contract digits follow that series; this is the execution path, not a live gold quote.
        base[symbol]["spec"] = {**test_risk.spec("EURUSD"), "name": "XAUUSD", "currencyMargin": "USD", "currencyProfit": "USD"}
    return base, now


def travel(symbol: str, family: str, level: str | None, leg: str, *, rank: int = 4, emergency_economic: bool = False):
    tf = "M5" if level == "L4" else ("M15" if level == "L3" else "H1")
    found = confirmation(symbol, tf)
    row = hypothesis(symbol, family, level, leg, rank=rank)
    planned = campaign.plan(row, found)
    handoff = next(h for h in planned["handoffs"] if h["legType"] == leg and h["executable"])
    market, now = market_for(found, symbol)
    context = test_risk.ctx(now=now)
    if emergency_economic:
        context["economic"] = {symbol: {"blocks": True, "code": "ECON_EVENT_GATE", "reason": "High-impact USD event lock", "factor": 1}}
    result = risk.evaluate([handoff], [test_risk.acct()], market, test_risk.FX, test_risk.cfg(), context)
    book = campaign.new_book()
    auth = result["opportunities"][0]["accounts"][0].get("authorization")
    filled = campaign.accept(book, auth) if auth else None
    return result, filled, book, planned


class CampaignPath(unittest.TestCase):
    def test_normal_continuation_reaches_stage9_adapter(self):
        result, filled, book, _ = travel("EURUSD", "NORMAL_TREND_CONTINUATION", None, "P2")
        opp = result["opportunities"][0]
        self.assertEqual(opp["setupState"], "QUALIFIED", opp["setupReason"])
        self.assertEqual(opp["accounts"][0]["state"], "AUTHORIZED", opp["accounts"][0]["reason"])
        self.assertTrue(filled["accepted"])
        self.assertEqual(book["orders"][filled["order"]["executionKey"]]["family"], "NORMAL_TREND_CONTINUATION")

    def test_tit_l3_m15_confirmation_reaches_stage8(self):
        found = confirmation("GBPUSD", "M15")
        self.assertEqual(found["timeframe"], "M15")
        self.assertTrue(found["confirmed"])
        result, filled, _, _ = travel("GBPUSD", "TIT_CONTINUATION", "L3", "P2")
        self.assertEqual(result["opportunities"][0]["accounts"][0]["state"], "AUTHORIZED")
        self.assertEqual(filled["order"]["TiTLevel"], "L3")

    def test_tit_l4_m5_confirmation_reaches_stage9(self):
        found = confirmation("USDJPY", "M5")
        self.assertEqual(found["timeframe"], "M5")
        result, filled, _, _ = travel("USDJPY", "TIT_CONTINUATION", "L4", "P2")
        self.assertEqual(result["opportunities"][0]["setupState"], "QUALIFIED")
        self.assertEqual(filled["order"]["broker"], "test-adapter")

    def test_xau_priority_does_not_need_rank_one_and_cannot_bypass_a_hard_veto(self):
        result, filled, _, _ = travel("XAUUSD", "TIT_CORRECTION_END", "L4", "P2", rank=29)
        self.assertEqual(result["opportunities"][0]["accounts"][0]["state"], "AUTHORIZED")
        self.assertNotEqual(filled["order"]["executionKey"].split("|")[0], "")
        blocked, _, _, _ = travel("XAUUSD", "TIT_CORRECTION_END", "L4", "P2", rank=29, emergency_economic=True)
        self.assertNotEqual(blocked["opportunities"][0]["accounts"][0]["state"], "AUTHORIZED")
        self.assertEqual(blocked["opportunities"][0]["accounts"][0]["reasonCode"], "ECON_EVENT_GATE")

    def test_p1_reaches_stage8_and_stage9(self):
        result, filled, book, _ = travel("EURUSD", "TIT_CORRECTION_END", "L2", "P1")
        self.assertEqual(result["opportunities"][0]["accounts"][0]["state"], "AUTHORIZED")
        self.assertEqual(filled["order"]["legType"], "P1")
        self.assertAlmostEqual(book["campaigns"][filled["order"]["campaignId"]]["used"], filled["order"]["riskPct"])

    def test_p2_wait_retest_is_not_authorized(self):
        found = confirmation("EURUSD", "H1")
        found["entry"] = {"timing": "WAIT_RETEST", "classification": "EXTENDED", "reasons": ["price is extended"]}
        found["confirmed"] = True
        row = hypothesis("EURUSD", "NORMAL_TREND_CONTINUATION", None, "P2")
        row["p2"] = {"state": "P2_WAIT_RETEST", "riskPct": 1.0}
        planned = campaign.plan(row, found)
        self.assertFalse(planned["executable"])
        self.assertEqual(planned["blocker"], "WAIT_RETEST")
        market, now = market_for(found, "EURUSD")
        result = risk.evaluate(planned["handoffs"], [test_risk.acct()], market, test_risk.FX, test_risk.cfg(), test_risk.ctx(now=now))
        self.assertEqual(result["opportunities"][0]["setupState"], "WAITING")
        self.assertIsNone(result["opportunities"][0]["accounts"][0].get("authorization"))

    def test_p1_fill_leaves_only_remaining_campaign_risk(self):
        book = campaign.new_book()
        first = {"executionId": "a", "instrument": "EURUSD", "direction": "BUY", "riskPct": 0.4,
                 "source": {"executionKey": "c|P1|1", "campaignId": "c", "legType": "P1", "allocatedRisk": 1.0}}
        second = {"executionId": "b", "instrument": "EURUSD", "direction": "BUY", "riskPct": 0.7,
                  "source": {"executionKey": "c|P2|1", "campaignId": "c", "legType": "P2", "allocatedRisk": 1.0}}
        self.assertTrue(campaign.accept(book, first)["accepted"])
        rejected = campaign.accept(book, second)
        self.assertFalse(rejected["accepted"])
        self.assertEqual(rejected["reason"], "CAMPAIGN_RISK")
        self.assertAlmostEqual(book["campaigns"]["c"]["remaining"], 0.6)
        fitted = {**second, "riskPct": 0.6}
        self.assertTrue(campaign.accept(book, fitted)["accepted"])
        self.assertAlmostEqual(book["campaigns"]["c"]["remaining"], 0.0)

    def test_duplicate_execution_key_does_not_add_risk(self):
        book = campaign.new_book()
        auth = {"executionId": "a", "instrument": "EURUSD", "direction": "BUY", "riskPct": 0.4,
                "source": {"executionKey": "c|P1|1", "campaignId": "c", "legType": "P1", "allocatedRisk": 1.0}}
        campaign.accept(book, auth)
        again = campaign.accept(book, auth)
        self.assertTrue(again["duplicate"])
        self.assertEqual(len(book["orders"]), 1)
        self.assertAlmostEqual(book["campaigns"]["c"]["used"], 0.4)

    def test_restart_restores_open_legs_and_submits_nothing(self):
        book = campaign.new_book()
        report = campaign.reconcile(book, [
            {"executionKey": "c|P1|1", "campaignId": "c", "legType": "P1", "riskPct": 0.4, "allocatedRisk": 1.0, "comment": "c|P1|1"},
        ], actionable_now=[{"executionKey": "c|P2|9", "executable": False}])
        self.assertEqual(report["submitted"], [])
        self.assertEqual(book["campaigns"]["c"]["legs"]["P1"], "RESTORED")
        self.assertAlmostEqual(book["campaigns"]["c"]["remaining"], 0.6)
        pending = {"executionKey": "c|P2|2", "campaignId": "c", "legType": "P2", "riskPct": 0.6, "allocatedRisk": 1.0}
        again = campaign.reconcile(book, [pending], actionable_now=[])
        self.assertEqual(again["submitted"], [])
        self.assertEqual(book["orders"][pending["executionKey"]]["state"], "RESTORED")

    def test_stage10_records_without_changing_parameters(self):
        journal = campaign.Journal()
        row = hypothesis("XAUUSD", "TIT_CONTINUATION", "L4", "P1")
        event = campaign.outcome_event("P1_EXECUTED", row, revision="1", mae=None, mfe=None, rMultiple=None)
        self.assertTrue(journal.record(event))
        self.assertFalse(journal.record(event))
        self.assertFalse(journal.events[0]["changesParameters"])
        self.assertEqual(journal.events[0]["bucket"], "XAU")

    def test_replay_never_receives_a_future_bar(self):
        bars = [(i, 1, 2, 0.5, 1.5) for i in range(6)]

        def channels(prefix):
            if len(prefix) > len(bars):
                raise AssertionError("future prefix")
            return {"D1": {"timeframe": "D1", "direction": "BULLISH", "status": "ACTIVE", "position": 40,
                           "lower": 1, "upper": 2, "channelId": "EURUSD:D1", "confidence": 70},
                    "H8": {"timeframe": "H8", "direction": "BULLISH", "status": "ACTIVE", "position": 30,
                           "lower": 1.1, "upper": 1.8, "channelId": "EURUSD:H8", "confidence": 60}}

        report = opportunity_replay.replay_scan("EURUSD", bars, channels)
        self.assertFalse(report["lookahead"])
        self.assertEqual(report["bars"], 6)
        self.assertGreaterEqual(report["hypotheses"], 1)
        self.assertIn("executed", report)

    def test_reserve_policies_and_position_capacity_are_distinct(self):
        strict = opportunity.govern(
            [{"instrument": "EURUSD", "direction": "BULLISH", "remainingRisk": 1.0}], [],
            {"currencyLimitPct": 5, "portfolioLimitPct": 1.2, "positionCeiling": 20, "xauReservePct": 0.5, "xauReservePolicy": "STRICT_RESERVE"},
        )
        borrowed = opportunity.govern(
            [{"instrument": "EURUSD", "direction": "BULLISH", "remainingRisk": 1.0}], [],
            {"currencyLimitPct": 5, "portfolioLimitPct": 1.2, "positionCeiling": 20, "xauReservePct": 0.5,
             "xauReservePolicy": "PARTIAL_BORROW", "xauBorrowFraction": 1.0},
        )
        released = opportunity.govern(
            [{"instrument": "EURUSD", "direction": "BULLISH", "remainingRisk": 1.0}], [],
            {"currencyLimitPct": 5, "portfolioLimitPct": 1.2, "positionCeiling": 20, "xauReservePct": 0.5,
             "xauReservePolicy": "DYNAMIC_RESERVE", "xauWatchState": "NONE"},
        )
        self.assertEqual(strict[0]["decision"], "ALLOW_REDUCED")
        self.assertEqual(borrowed[0]["decision"], "ALLOW")
        self.assertEqual(released[0]["decision"], "ALLOW")
        crowded = opportunity.govern(
            [{"instrument": "EURUSD", "direction": "BULLISH", "remainingRisk": 0.1}],
            [{"symbol": "GBPUSD", "side": "BUY", "riskPct": 0.1}] * 3,
            {"currencyLimitPct": 5, "portfolioLimitPct": 5, "positionCeiling": 20, "operatorPositionLimit": 3, "xauReservePct": 0},
        )
        self.assertEqual(crowded[0]["decision"], "QUEUE")
        self.assertIn("Operator", crowded[0]["decisionReason"])

    def test_confluence_does_not_invent_a_zone_or_force_a_fib(self):
        parent = {"lower": 1.0, "upper": 2.0, "mid": 1.5}
        plain = opportunity.expected_retracement_zone(parent, None, 1)
        away = opportunity.expected_retracement_zone(parent, None, 1, {"swingLow": 9.0, "bosLevel": 8.0})
        self.assertEqual(plain["zoneLow"], away["zoneLow"])
        self.assertTrue(any("does not overlap" in r for r in away["reasons"]))
        near = opportunity.expected_retracement_zone(parent, None, 1, {"swingLow": 1.2})
        self.assertGreaterEqual(near["zoneLow"], plain["zoneLow"])
        self.assertLessEqual(near["zoneHigh"], plain["zoneHigh"])

    def test_non_actionable_hypothesis_keeps_a_principal_reason(self):
        channels = {"D1": {"timeframe": "D1", "direction": "BULLISH", "status": "ACTIVE", "position": 40, "lower": 1, "upper": 2,
                           "channelId": "EURUSD:D1", "confidence": 70},
                    "H8": {"timeframe": "H8", "direction": "BEARISH", "status": "ACTIVE", "position": 80, "lower": 1.4, "upper": 1.8,
                           "channelId": "EURUSD:H8", "confidence": 60}}
        result = opportunity.scan(["EURUSD"], {"EURUSD": channels}, prices={"EURUSD": 1.7})
        watched = [h for h in result["instruments"][0]["hypotheses"] if not h.get("actionable")]
        self.assertTrue(watched)
        self.assertTrue(all(h.get("blocker") for h in watched))
        self.assertIn("funnel", result["summary"])
        self.assertEqual(result["summary"]["funnel"]["scanned"], 1)

    def test_learning_migration_is_additive(self):
        import campaign_store
        sql = (campaign_store.ROOT / "database" / "mssql" / "016_campaign_learning.sql").read_text(encoding="utf-8")
        self.assertIn("IF OBJECT_ID", sql)
        self.assertNotIn("DROP TABLE", sql.upper())
        campaign_store.ensure_schema()
        event = campaign.outcome_event("P2_EXTENDED", {"campaignId": "migrate-test", "instrument": "EURUSD", "opportunityFamily": "NORMAL_TREND_CONTINUATION"}, revision="unit")
        event["campaignId"] = "migrate-test"
        with campaign_store.connect() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM dbo.app_campaign_event WHERE event_key=?", event["eventKey"])
            conn.commit()
        first = campaign_store.save_event(event)
        second = campaign_store.save_event(event)
        self.assertTrue(first)
        self.assertFalse(second)


if __name__ == "__main__":
    unittest.main()
