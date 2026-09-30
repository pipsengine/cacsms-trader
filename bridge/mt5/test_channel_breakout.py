"""Channel breakout watchlist. Synthetic channels only — no broker and no orders."""

import unittest

import channel_breakout as cb
import opportunity


def _snap(tf, status, direction, upper=10.0, lower=0.0, atr=1.0, breakout=None, phase="CONSOLIDATION", data="READY"):
    return {
        "timeframe": tf, "status": status, "direction": direction, "confidence": 70, "position": 50,
        "channelId": f"TEST:{tf}:k", "upperBoundary": upper, "lowerBoundary": lower, "midline": (upper + lower) / 2,
        "dataStatus": data, "phase": phase, "ageBars": 10, "currentPrice": 5.0,
        "definition": {"anchorPrice": lower, "slope": 0.0, "sgn": 1, "width": upper - lower},
        "evidence": {"atr": atr, "events": [{"kind": "BOS", "label": "bos"}, {"kind": "CHOCH", "label": "choch"}]},
        "breakout": breakout,
    }


def _pack(child_tf, child, parent_tf="H1", parent_dir="BULLISH"):
    return {
        parent_tf: _snap(parent_tf, "ACTIVE", parent_dir, upper=20, lower=10),
        child_tf: child,
    }


class BreakoutTests(unittest.TestCase):
    def test_universe_is_evaluated_and_an_ordinary_channel_stays_off_the_list(self):
        child = _snap("H1", "ACTIVE", "BULLISH")
        snap = cb.ChannelBreakoutScanner().observe({"EURUSD": _pack("H1", child, "D1", "BULLISH")}, {"EURUSD": {"price": 5.0, "fresh": True}})
        self.assertEqual(snap["instrumentsScanned"], len(opportunity.SYMBOLS))
        self.assertEqual(snap["activeCount"], 0)

    def test_near_upper_boundary_of_a_bearish_correction_is_a_bullish_watch(self):
        child = _snap("M15", "ACTIVE", "BEARISH")
        channels = {"XAUUSD": {"H1": _snap("H1", "ACTIVE", "BULLISH", 20, 10), "M15": child}}
        row = cb.classify_level("XAUUSD", "L4", channels["XAUUSD"], 9.2, True)
        self.assertEqual(row["breakout"]["state"], "NEAR_BREAKOUT")
        self.assertEqual(row["breakout"]["relevantBoundary"], "UPPER")
        self.assertEqual(row["breakout"]["expectedDirection"], "BULLISH")
        self.assertEqual(row["opportunityFamily"], "TIT_CORRECTION")
        self.assertEqual(row["channelRole"], "CORRECTION")
        self.assertFalse(row["authorizesTrade"])

    def test_bearish_parent_watches_the_lower_boundary(self):
        channels = {"EURUSD": {"H1": _snap("H1", "ACTIVE", "BEARISH", 20, 10), "M15": _snap("M15", "ACTIVE", "BULLISH")}}
        row = cb.classify_level("EURUSD", "L4", channels["EURUSD"], 0.4, True)
        self.assertEqual(row["breakout"]["relevantBoundary"], "LOWER")
        self.assertEqual(row["breakout"]["expectedDirection"], "BEARISH")
        self.assertEqual(row["breakout"]["state"], "NEAR_BREAKOUT")

    def test_a_wick_is_detected_and_a_closed_break_is_confirmed(self):
        wick = _snap("H1", "ACTIVE", "BEARISH")
        channels = {"EURUSD": _pack("H1", wick, "D1", "BULLISH")}
        detected = cb.classify_level("EURUSD", "L3", channels["EURUSD"], 10.6, True)
        self.assertEqual(detected["breakout"]["state"], "BREAK_DETECTED")
        self.assertIsNone(detected["breakout"]["confirmedAt"])
        closed = _snap("H1", "BROKEN", "BEARISH", breakout={"side": "UP", "ts": 100, "price": 10.4, "retesting": False, "distanceAtr": 0.4})
        confirmed = cb.classify_level("EURUSD", "L3", _pack("H1", closed, "D1", "BULLISH"), 10.6, True)
        self.assertEqual(confirmed["breakout"]["state"], "BREAK_CONFIRMED")
        self.assertEqual(confirmed["opportunityFamily"], "TIT_CORRECTION_END")
        self.assertEqual(confirmed["retest"]["state"], "RETEST_PENDING")
        self.assertIsNotNone(confirmed["breakout"]["confirmedAt"])

    def test_retest_in_progress_and_retest_held(self):
        retesting = _snap("H1", "RETESTING", "BULLISH", breakout={"side": "UP", "ts": 100, "retestTs": 130, "retesting": True})
        row = cb.classify_level("EURUSD", "L3", _pack("H1", retesting, "D1", "BULLISH"), 10.1, True)
        self.assertEqual(row["breakout"]["state"], "RETESTING")
        self.assertEqual(row["retest"]["state"], "RETEST_IN_PROGRESS")
        held = _snap("H1", "BROKEN", "BULLISH", breakout={"side": "UP", "ts": 100, "retestTs": 130, "lastRetestTs": 140, "retesting": False})
        held_row = cb.classify_level("EURUSD", "L3", _pack("H1", held, "D1", "BULLISH"), 11.0, True)
        self.assertEqual(held_row["breakout"]["state"], "RETEST_HELD")

    def test_failed_and_invalidated_channels_leave_the_dropdown(self):
        scanner = cb.ChannelBreakoutScanner()
        broken = _snap("H1", "BROKEN", "BULLISH", breakout={"side": "UP", "ts": 100, "retesting": False})
        scanner.observe({"EURUSD": _pack("H1", broken, "D1", "BULLISH")}, {"EURUSD": {"price": 11, "fresh": True}})
        self.assertEqual(scanner.snapshot()["activeCount"], 1)
        failed = _snap("H1", "INVALIDATED", "BULLISH", breakout={"side": "UP", "ts": 100}, phase="FAILED_BREAKOUT")
        scanner.observe({"EURUSD": _pack("H1", failed, "D1", "BULLISH")}, {"EURUSD": {"price": 5, "fresh": True}})
        self.assertEqual(scanner.snapshot()["activeCount"], 0)
        self.assertTrue(scanner.history)
        self.assertEqual(scanner.history[0]["breakout"]["state"], "FAILED_BREAKOUT")

    def test_xau_is_not_inserted_without_a_break_and_sorts_ahead_when_it_has_one(self):
        quiet = _snap("H1", "ACTIVE", "BULLISH")
        near = _snap("M15", "ACTIVE", "BEARISH")
        channels = {
            "XAUUSD": {"H1": quiet, "D1": _snap("D1", "ACTIVE", "BULLISH", 20, 10)},
            "EURUSD": {"H1": _snap("H1", "ACTIVE", "BULLISH", 20, 10), "M15": near},
        }
        live = {"XAUUSD": {"price": 5, "fresh": True}, "EURUSD": {"price": 9.2, "fresh": True}}
        snap = cb.ChannelBreakoutScanner().observe(channels, live)
        symbols = [row["symbol"] for row in snap["candidates"]]
        self.assertNotIn("XAUUSD", symbols)
        self.assertIn("EURUSD", symbols)
        channels["XAUUSD"]["M15"] = near
        live["XAUUSD"] = {"price": 9.2, "fresh": True}
        ordered = cb.ChannelBreakoutScanner().observe(channels, live)
        self.assertEqual(ordered["candidates"][0]["symbol"], "XAUUSD")

    def test_p1_zone_and_channel_break_do_not_become_ready(self):
        child = _snap("H1", "BROKEN", "BULLISH", breakout={"side": "UP", "ts": 50, "retesting": False})
        hypothesis = {
            "instrument": "EURUSD", "TiTLevel": "L3", "status": "WATCHING", "opportunityFamily": "TIT_CORRECTION_END",
            "p1": {"state": "P1_ZONE_REACHED", "reason": "P1_REACTION_PENDING"},
            "p2": {"state": "P2_WAITING_FOR_BREAK", "reason": "WAITING_FOR_BREAK"},
        }
        row = cb.classify_level("EURUSD", "L3", _pack("H1", child, "D1", "BULLISH"), 11, True, hypothesis)
        self.assertEqual(row["p1"]["state"], "P1_ZONE_REACHED")
        self.assertEqual(row["p2"]["state"], "P2_WAITING_FOR_BREAK")
        self.assertNotEqual(row["p1"]["state"], "P1_READY_FOR_RISK")
        self.assertNotEqual(row["p2"]["state"], "P2_READY_FOR_RISK")
        self.assertTrue(row["structure"]["distinctFromChannelBreak"])
        self.assertIsNotNone(row["structure"]["bos"])
        self.assertIsNotNone(row["structure"]["choch"])

    def test_restart_does_not_emit_the_current_state_twice_or_authorize(self):
        child = _snap("H1", "ACTIVE", "BEARISH")
        channels = {"EURUSD": _pack("H1", child, "D1", "BULLISH")}
        live = {"EURUSD": {"price": 9.2, "fresh": True}}
        scanner = cb.ChannelBreakoutScanner()
        scanner.observe(channels, live)
        self.assertEqual(scanner.events, [])
        scanner.observe(channels, live)
        self.assertEqual(scanner.events, [])
        channels["EURUSD"]["H1"] = _snap("H1", "BROKEN", "BULLISH", breakout={"side": "UP", "ts": 80, "retesting": False})
        scanner.observe(channels, {"EURUSD": {"price": 11, "fresh": True}})
        self.assertEqual(len(scanner.events), 1)
        scanner.observe(channels, {"EURUSD": {"price": 11, "fresh": True}})
        self.assertEqual(len(scanner.events), 1)
        self.assertTrue(all(not row["authorizesTrade"] for row in scanner.active))

    def test_l3_uses_h1_and_l4_uses_m15(self):
        l3 = cb.classify_level("GBPUSD", "L3", _pack("H1", _snap("H1", "ACTIVE", "BEARISH"), "D1", "BULLISH"), 9.2, True)
        l4 = cb.classify_level("GBPUSD", "L4", {"H1": _snap("H1", "ACTIVE", "BULLISH", 20, 10), "M15": _snap("M15", "ACTIVE", "BEARISH")}, 9.2, True)
        self.assertEqual(l3["channel"]["timeframe"], "H1")
        self.assertEqual(l3["confirmationTimeframe"], "M15")
        self.assertEqual(l4["channel"]["timeframe"], "M15")
        self.assertEqual(l4["confirmationTimeframe"], "M5")

    def test_chart_reads_the_hierarchy_channel_and_a_flicker_is_audited_once(self):
        child = _snap("H1", "ACTIVE", "BEARISH")
        child["definition"]["anchorTs"] = 1_700_000_000
        channels = {"EURUSD": _pack("H1", child, "D1", "BULLISH")}
        near = {"EURUSD": {"price": 9.2, "fresh": True}}
        inside = {"EURUSD": {"price": 5.0, "fresh": True}}
        scanner = cb.ChannelBreakoutScanner()
        scanner.observe(channels, near)
        scanner.observe(channels, inside)
        scanner.observe(channels, near)
        scanner.observe(channels, inside)
        removals = [row for row in scanner.history if row.get("removedReason") == "NO_LONGER_QUALIFIES"]
        self.assertEqual(len(removals), 1)

        import history_store as hs
        original = hs.candle_tail
        hs.candle_tail = lambda symbol, tf, n: [(1_700_000_000 + i * 3600, 5.0, 6.0, 4.0, 5.2) for i in range(40)]
        try:
            row = scanner.observe(channels, near)["candidates"][0]
            payload = scanner.chart(row["candidateId"])
        finally:
            hs.candle_tail = original
        self.assertEqual(payload["chart"]["candles"][0]["close"], 5.2)
        self.assertTrue(payload["chart"]["lines"])

    def test_continuation_and_two_levels_stay_distinct(self):
        cont = _snap("H1", "ACTIVE", "BULLISH")
        corr = _snap("M15", "ACTIVE", "BEARISH")
        channels = {"EURUSD": {"D1": _snap("D1", "ACTIVE", "BULLISH", 20, 10), "H1": cont, "M15": corr}}
        a = cb.classify_level("EURUSD", "L3", channels["EURUSD"], 9.2, True)
        b = cb.classify_level("EURUSD", "L4", channels["EURUSD"], 9.2, True)
        self.assertEqual(a["opportunityFamily"], "TIT_CONTINUATION")
        self.assertEqual(b["opportunityFamily"], "TIT_CORRECTION")
        self.assertNotEqual(a["candidateId"], b["candidateId"])


if __name__ == "__main__":
    unittest.main()
