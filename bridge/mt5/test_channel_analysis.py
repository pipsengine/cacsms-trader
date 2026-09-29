"""Channel Analysis: independent Y/Q/MN/W/D1/H8/H1 channels and the trend-within-trend hierarchy.

Opposing child channels stay published beside their parents and are classified by correction depth; a timeframe
without touch geometry reports NO VALID CHANNEL instead of inheriting one.
"""

from __future__ import annotations

import calendar
import copy
import unittest

import channel_analysis as ca
from test_vision import bars_from_closes, channel_closes

DAY = 86400
STEP = {"MN": 30 * DAY, "W": 7 * DAY, "D1": DAY, "H8": 8 * 3600, "H1": 3600}
READY = ("READY", "test series")


def snap(tf: str, slope: float, n: int = 300) -> dict:
    return ca.analyse_timeframe("EURUSD", tf, bars_from_closes(channel_closes(n, slope, 7), STEP[tf]), READY, now=2_000_000_000)


def empty(tf: str) -> dict:
    return ca.analyse_timeframe("EURUSD", tf, [], READY, now=2_000_000_000)


def nested_example() -> dict[str, dict]:
    """MN bull -> W bear correction -> D1 bear -> H8 bull counter-correction -> H1 bear nested correction."""
    return {"Y": empty("Y"), "Q": empty("Q"), "MN": snap("MN", 0.02), "W": snap("W", -0.02), "D1": snap("D1", -0.02),
            "H8": snap("H8", 0.02), "H1": snap("H1", -0.02)}


def month(y: int, m: int) -> int:
    return calendar.timegm((y, m, 1, 0, 0, 0))


class Aggregation(unittest.TestCase):
    def test_only_complete_periods_are_used(self):
        rows = []
        for i in range(30):  # Feb 2020 .. Jul 2022
            y, m = 2020 + (i + 1) // 12, (i + 1) % 12 + 1
            rows.append((month(y, m), 1.0 + i, 2.0 + i, 0.5 + i, 1.5 + i))
        years = ca.aggregate(rows, "Y")
        self.assertEqual([y[0] for y in years], [month(2021, 1)])
        o, h, lo, c = years[0][1:]
        self.assertEqual((o, c), (rows[11][1], rows[22][4]))
        self.assertEqual(h, max(r[2] for r in rows[11:23]))
        self.assertEqual(lo, min(r[3] for r in rows[11:23]))
        quarters = ca.aggregate(rows, "Q")
        self.assertEqual(quarters[0][0], month(2020, 4))
        self.assertEqual(quarters[-1][0], month(2022, 4))
        self.assertEqual(len(quarters), 9)


class Detection(unittest.TestCase):
    def test_each_timeframe_detects_its_own_channel(self):
        ch = nested_example()
        for tf in ("MN", "W", "D1", "H8", "H1"):
            self.assertTrue(ca.is_valid(ch[tf]), f"{tf}: {ch[tf]['status']} {ch[tf]['reason']}")
            self.assertGreater(ch[tf]["upperBoundary"], ch[tf]["lowerBoundary"])
            self.assertGreaterEqual(ch[tf]["touchCount"], 3)
            self.assertTrue(ch[tf]["channelId"].startswith(f"EURUSD:{tf}:"))
        self.assertEqual(ch["MN"]["direction"], "BULLISH")
        self.assertEqual(ch["W"]["direction"], "BEARISH")
        self.assertEqual(ch["H8"]["direction"], "BULLISH")

    def test_touch_sequence_is_labelled(self):
        s = snap("D1", 0.02)
        labels = [t["label"] for t in s["evidence"]["touches"]]
        self.assertTrue(any(x.startswith("Touch #1") for x in labels))
        self.assertTrue(any(x.startswith("Touch #3") for x in labels))
        self.assertTrue(any(x.startswith("Opposite #1") for x in labels))

    def test_insufficient_history_is_no_valid_channel(self):
        s = ca.analyse_timeframe("EURUSD", "Y", bars_from_closes(channel_closes(7, 0.02, 7), 365 * DAY), READY)
        self.assertEqual(s["status"], "NO_CHANNEL")
        self.assertEqual(s["direction"], "UNKNOWN")
        self.assertIsNone(s["upperBoundary"])
        self.assertTrue(s["reason"].startswith("NO VALID CHANNEL"))

    def test_blocked_stage1_series_is_not_analysed(self):
        s = ca.analyse_timeframe("EURUSD", "D1", bars_from_closes(channel_closes(300, 0.02, 7)), ("BLOCKED", "D1 Stage 1 PROVIDER_OFFLINE"))
        self.assertEqual(s["status"], "NO_CHANNEL")
        self.assertIn("PROVIDER_OFFLINE", s["reason"])

    def test_structure_events_have_no_hindsight(self):
        bars = bars_from_closes(channel_closes(300, 0.02, 7))
        full = ca.structure_events("D1", bars, limit=1000)
        cut = bars[200][0]
        prefix = ca.structure_events("D1", bars[:201], limit=1000)
        self.assertEqual([e for e in full if e["ts"] <= cut], prefix)


class Hierarchy(unittest.TestCase):
    def test_nested_correction_chain(self):
        ch = nested_example()
        before = copy.deepcopy({tf: ch[tf]["definition"] for tf in ch})
        edges = ca.build_hierarchy(ch)
        rel = {tf: ch[tf]["relationship"] for tf in ca.TIMEFRAMES}
        self.assertEqual(rel, {"Y": "UNRESOLVED", "Q": "UNRESOLVED", "MN": "PRIMARY", "W": "CORRECTIVE", "D1": "ALIGNED",
                               "H8": "COUNTER_CORRECTION", "H1": "NESTED_CORRECTION"})
        self.assertEqual({tf: ch[tf]["definition"] for tf in ch}, before, "hierarchy must never change channel geometry")
        self.assertEqual(len(edges), 6)
        self.assertEqual(ch["H1"]["parentChannelId"], ch["H8"]["channelId"])
        self.assertEqual(ch["W"]["relationshipVia"], "MN")
        self.assertEqual(ch["MN"]["direction"], "BULLISH")
        self.assertEqual(ch["H1"]["direction"], "BEARISH")

    def test_interpretation_reads_nested_structure(self):
        ch = nested_example()
        ca.build_hierarchy(ch)
        x = ca.interpret(ch)
        self.assertEqual(x["marketState"], "NESTED_CORRECTION")
        self.assertEqual(x["parentTimeframe"], "MN")
        self.assertEqual(x["parentDirection"], "BULLISH")
        self.assertEqual(x["currentLegDirection"], "BEARISH")
        self.assertEqual(x["primaryDirection"], "BULLISH")
        self.assertIn("Valid nested structure", x["narrative"])
        self.assertIn("not a conflict", x["narrative"])
        self.assertEqual(x["unresolvedTimeframes"], ["Y", "Q"])
        self.assertTrue(0 < x["structuralConfidence"] <= 100)
        self.assertEqual(x["keyResistance"], sorted(x["keyResistance"]))
        self.assertEqual(x["keySupport"], sorted(x["keySupport"], reverse=True))

    def test_unresolved_timeframe_is_skipped_not_inherited(self):
        ch = nested_example()
        ch["W"] = empty("W")
        ca.build_hierarchy(ch)
        self.assertEqual(ch["W"]["relationship"], "UNRESOLVED")
        self.assertEqual(ch["W"]["direction"], "UNKNOWN")
        self.assertEqual(ch["D1"]["relationshipVia"], "MN")
        self.assertEqual(ch["D1"]["relationship"], "CORRECTIVE")

    def test_parent_break_classification(self):
        def parent(trend):
            return {"timeframe": "W", "direction": "BEARISH", "trend": trend, "status": "BROKEN", "breakout": {"side": "DOWN"}}
        child = {"timeframe": "H8", "direction": "BEARISH"}
        self.assertEqual(ca._relate(parent("BEARISH"), child, 0)[0], "BREAKOUT")
        self.assertEqual(ca._relate(parent("RANGE"), child, 0)[0], "BREAKOUT")
        self.assertEqual(ca._relate(parent("BULLISH"), child, 0)[0], "REVERSAL_CANDIDATE")
        rel, _, depth = ca._relate(parent("BULLISH"), {"timeframe": "H8", "direction": "BULLISH"}, 0)
        self.assertEqual((rel, depth), ("CORRECTIVE", 1))

    def test_aligned_stack_is_continuation(self):
        ch = {"Y": empty("Y"), "Q": empty("Q"), **{tf: snap(tf, 0.02) for tf in ("MN", "W", "D1", "H8", "H1")}}
        ca.build_hierarchy(ch)
        self.assertEqual([ch[t]["relationship"] for t in ("MN", "W", "D1", "H8", "H1")], ["PRIMARY"] + ["ALIGNED"] * 4)
        x = ca.interpret(ch)
        self.assertEqual(x["marketState"], "CONTINUATION")
        self.assertEqual(x["alignmentScore"], 100.0)


class ChangeAndLive(unittest.TestCase):
    def test_diff_events(self):
        a = snap("D1", 0.02)
        b = empty("D1")
        self.assertEqual([e["type"] for e in ca.diff_events(a, b)], ["CHANNEL_LOST"])
        self.assertEqual([e["type"] for e in ca.diff_events(b, a)][0], "NEW_CHANNEL")
        self.assertEqual(ca.diff_events(a, copy.deepcopy(a)), [])
        self.assertEqual(ca.diff_events(None, a), [])

    def test_state_version_tracks_structure_only(self):
        ch = nested_example()
        ca.build_hierarchy(ch)
        x = ca.interpret(ch)
        v = ca.state_version(ch, x)
        ch2 = copy.deepcopy(ch)
        ch2["H1"]["freshnessSeconds"] = 1
        self.assertEqual(ca.state_version(ch2, x), v)
        ch2["H1"]["status"] = "BROKEN"
        self.assertNotEqual(ca.state_version(ch2, x), v)

    def test_chart_lines_follow_the_stored_definition(self):
        bars = bars_from_closes(channel_closes(300, 0.02, 7))
        s = ca.analyse_timeframe("EURUSD", "D1", bars, READY)
        p = ca.chart_payload(s, bars)
        self.assertEqual(len(p["candles"]), ca.CONFIG["chartBars"]["D1"])
        self.assertTrue(p["lines"])
        self.assertTrue(all(x["upper"] > x["lower"] for x in p["lines"]))
        last = p["lines"][-1]
        self.assertAlmostEqual(last["upper"], s["upperBoundary"], places=6)
        self.assertAlmostEqual(last["lower"], s["lowerBoundary"], places=6)

    def test_live_zone(self):
        s = snap("D1", 0.02)
        lo, hi = ca.live_bounds(s)
        atr = s["evidence"]["atr"]
        self.assertEqual(ca.zone(s, hi + 2 * atr), "BREACH_UP")
        self.assertEqual(ca.zone(s, lo - 2 * atr), "BREACH_DOWN")
        self.assertEqual(ca.zone(s, (lo + hi) / 2), "INSIDE")
        v = ca.live_view(s, (lo + hi) / 2)
        self.assertAlmostEqual(v["position"], 50.0, places=1)
        self.assertIsNone(ca.zone(empty("D1"), 1.0))


class CurrentCandle(unittest.TestCase):
    def test_open_year_and_quarter_include_the_forming_month(self):
        closed = [(month(2026, m), 1.0 + m, 1.2 + m, 0.8 + m, 1.1 + m) for m in range(1, 9)]
        forming = (month(2026, 9), 1.3, 1.5, 1.2, 1.4)
        now = month(2026, 9) + 10 * DAY
        year = ca.forming_macro("Y", closed, forming, now)
        self.assertEqual(year[0], month(2026, 1))
        self.assertEqual(year[1], closed[0][1])
        self.assertEqual(year[4], forming[4])
        self.assertEqual(year[2], max(forming[2], max(r[2] for r in closed)))
        quarter = ca.forming_macro("Q", closed, forming, now)
        self.assertEqual(quarter[0], month(2026, 7))
        self.assertEqual(quarter[4], forming[4])

    def test_h8_bucket_uses_the_open_hour(self):
        start = 1_700_000_000 // 28800 * 28800
        h1 = [(start + i * 3600, 1.1, 1.2 + i * 0.01, 1.0, 1.15) for i in range(3)]
        bar = ca.forming_bucket(h1, start + 3 * 3600, 28800)
        self.assertEqual(bar[0], start)
        self.assertEqual(bar[4], h1[-1][4])
        self.assertEqual(bar[2], h1[-1][2])

    def test_current_bars_cover_every_timeframe(self):
        now = month(2026, 9) + 15 * DAY
        h1_open = now // 3600 * 3600
        rates = {
            "H1": [(h1_open - 3600, 1.1, 1.2, 1.0, 1.11), (h1_open, 1.11, 1.25, 1.08, 1.2)],
            "D1": [(now // 86400 * 86400, 1.1, 1.3, 1.0, 1.2)],
            "W1": [(now // (7 * 86400) * 7 * 86400, 1.0, 1.4, 0.9, 1.2)],
            "MN1": [(month(2026, 9), 1.0, 1.4, 0.9, 1.2)],
        }
        closed = [(month(2026, m), 1.0, 1.1, 0.9, 1.05) for m in range(1, 9)]
        bars = ca.current_bars(now, rates, closed)
        self.assertEqual(set(bars), set(ca.TIMEFRAMES))
        self.assertEqual(bars["H1"][0], h1_open)
        self.assertEqual(bars["MN"][4], 1.2)
        self.assertEqual(bars["Y"][0], month(2026, 1))

    def test_open_candle_is_appended_and_then_updated(self):
        bars = bars_from_closes(channel_closes(300, 0.02, 7), STEP["D1"])
        s = ca.analyse_timeframe("EURUSD", "D1", bars, READY)
        chart = ca.chart_payload(s, bars)
        last = bars[-1][0]
        forming = (last + STEP["D1"], 1.2, 1.4, 1.1, 1.3)
        painted = ca.attach_current_candle(s, chart, forming)
        self.assertEqual(painted["candles"][-1]["time"], forming[0] * 1000)
        self.assertFalse(painted["candles"][-1]["complete"])
        self.assertEqual(painted["lines"][-1]["time"], forming[0] * 1000)
        self.assertGreater(painted["lines"][-1]["upper"], painted["lines"][-1]["lower"])
        moved = (forming[0], 1.2, 1.6, 1.05, 1.55)
        again = ca.attach_current_candle(s, painted, moved)
        self.assertEqual(len(again["candles"]), len(painted["candles"]))
        self.assertEqual(again["candles"][-1]["high"], 1.6)
        self.assertEqual(again["candles"][-1]["close"], 1.55)
        self.assertTrue(chart["candles"][-1]["complete"])


if __name__ == "__main__":
    unittest.main()
