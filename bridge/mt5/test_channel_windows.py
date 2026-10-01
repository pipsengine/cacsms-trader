"""Channel Analysis derived windows: YTD (start of calendar year) and HY (rolling six calendar months).

Both are read from closed D1 candles with the same ChannelEngine as every other context. They are published in the
canonical hierarchy Y → YTD → HY → Q → MN → W → D1 → H8 → H1 but are never counted as extra votes in the scored chain.

Run from bridge/mt5:  python -m unittest test_channel_windows -v
"""

from __future__ import annotations

import calendar
import copy
import re
import time
import unittest
from pathlib import Path
from unittest import mock

import channel_analysis as ca
import channel_service
import opportunity
import regime
import vision
from test_vision import T0, bars_from_closes, channel_closes, upper

DAY = 86400
READY = ("READY", "test series")
P = 120  # pre-window bars; a multiple of the synthetic wave period so the window ends on the same phase as test_vision


def utc(y: int, m: int, d: int, h: int = 0) -> int:
    return calendar.timegm((y, m, d, h, 0, 0))


JAN1 = utc(2026, 1, 1)


def bars_at(closes: list[float], t0: int, step: int = DAY, wick: float = 0.05) -> list[tuple]:
    shift = t0 - T0
    return [(b[0] + shift,) + tuple(b[1:]) for b in bars_from_closes(closes, step, wick)]


def weekday_bars(start: int, end: int) -> list[tuple]:
    """Weekday-only daily bars in [start, end], as an FX broker stores D1 (no weekend candles)."""
    out, t, i = [], start, 0
    while t <= end:
        if time.gmtime(t).tm_wday < 5:
            p = 1.0 + 0.0001 * i
            out.append((t, p, p + 0.001, p - 0.001, p))
            i += 1
        t += DAY
    return out


def run(tf: str, bars: list[tuple], now: int | None = None, symbol: str = "EURUSD") -> dict:
    return ca.analyse_timeframe(symbol, tf, bars, READY, now or ca.bar_close("D1", int(bars[-1][0])))


def scenario(name: str, t0: int) -> list[tuple]:
    """Synthetic D1 series (P bars before t0 + scenario) mirroring the Stage 5 scenarios in test_vision."""
    s = 0.02
    start = t0 - P * DAY
    if name == "ascending":
        return bars_at(channel_closes(P + 300, s, 7), start)
    if name == "descending":
        return bars_at(channel_closes(P + 300, -s, 7), start)
    if name == "forming":
        closes = [90 + 0.1 * i for i in range(P + 101)]
        for leg, n in ((-0.17, 10), (0.17, 10), (-0.17, 10), (0.17, 5)):
            for _ in range(n):
                closes.append(closes[-1] + leg)
        return bars_at(closes, start)
    if name == "none":
        return bars_at([100.0 + 0.05 * i for i in range(P + 200)], start)
    if name == "weakening":
        closes = channel_closes(P + 290, s, 16)
        flat = [(start + i * DAY, closes[-1], closes[-1] + 0.01, closes[-1] - 0.01, closes[-1]) for i in range(P + 290, P + 300)]
        return bars_at(closes, start) + flat
    if name == "broken":
        closes = channel_closes(P + 300, s, 10) + [upper(P + 300, s) + 0.30, upper(P + 301, s) + 0.40]
        return bars_at(closes, start)
    if name == "retesting":
        closes = channel_closes(P + 300, s, 10) + [upper(P + 300, s) + 0.30, upper(P + 301, s) + 0.40, upper(P + 302, s) + 0.06]
        return bars_at(closes, start)
    raise KeyError(name)


class Hierarchy(unittest.TestCase):
    def test_exact_canonical_order(self):
        self.assertEqual(ca.TIMEFRAMES, ("Y", "YTD", "HY", "Q", "MN", "W", "D1", "H8", "H1"))
        self.assertEqual(len(ca.TIMEFRAMES), 9)
        self.assertEqual(ca.CORE_TIMEFRAMES, ("Y", "Q", "MN", "W", "D1", "H8", "H1"))
        self.assertEqual(ca.CONTEXT_TIMEFRAMES, ("YTD", "HY"))
        self.assertEqual([t for t in ca.TIMEFRAMES if t in ca.CORE_TIMEFRAMES], list(ca.CORE_TIMEFRAMES))

    def test_frontend_order_matches_engine(self):
        src = (Path(__file__).resolve().parents[2] / "src" / "features" / "channel-analysis" / "format.ts").read_text(encoding="utf-8")
        m = re.search(r"export const TIMEFRAMES: ChannelTimeframe\[\] = \[([^\]]*)\]", src)
        self.assertIsNotNone(m)
        self.assertEqual(tuple(re.findall(r"'([A-Z0-9]+)'", m.group(1))), ca.TIMEFRAMES)

    def test_derived_contexts_are_not_mt5_timeframes(self):
        for tf in ("YTD", "HY"):
            self.assertEqual(ca.SOURCE_TF[tf], "D1")
            self.assertIn(tf, ca.DERIVED["D1"])
            self.assertEqual(ca.CONFIG["tfWeight"][tf], 0)
        self.assertEqual(ca.WINDOWS["YTD"], {"type": "CALENDAR_YTD"})
        self.assertEqual(ca.WINDOWS["HY"], {"type": "ROLLING_MONTHS", "months": 6})
        self.assertEqual(ca.EXECUTION_TIMEFRAMES, ("M15", "M5"), "execution timeframes stay outside the hierarchy")
        self.assertNotIn("M15", ca.TIMEFRAMES)


class Windows(unittest.TestCase):
    def test_ytd_starts_at_the_current_year(self):
        bars = weekday_bars(utc(2025, 6, 2), utc(2026, 9, 30))
        s = run("YTD", bars, now=utc(2026, 10, 1, 6))
        w = s["window"]
        self.assertEqual(w["type"], "CALENDAR_YTD")
        self.assertEqual(w["sourceTimeframe"], "D1")
        self.assertEqual(w["start"], JAN1 * 1000)
        self.assertEqual(w["firstBarTime"], JAN1 * 1000, "1 Jan 2026 is a Thursday and has a candle here")
        self.assertEqual(w["end"], utc(2026, 10, 1) * 1000, "close of the latest closed D1 candle")
        self.assertEqual(w["bars"], sum(1 for b in bars if b[0] >= JAN1))
        self.assertEqual(s["bars"], w["bars"])
        chart = ca.chart_payload(s, bars)
        self.assertTrue(chart["candles"])
        self.assertTrue(all(c["time"] >= JAN1 * 1000 for c in chart["candles"]), "no 2025 candle enters YTD")

    def test_ytd_uses_first_available_trading_candle(self):
        bars = [b for b in weekday_bars(utc(2025, 6, 2), utc(2026, 9, 30)) if b[0] != JAN1]
        s = run("YTD", bars, now=utc(2026, 10, 1))
        self.assertEqual(s["window"]["start"], JAN1 * 1000)
        self.assertEqual(s["window"]["firstBarTime"], utc(2026, 1, 2) * 1000, "no candle is fabricated for a closed 1 Jan")

    def test_ytd_touches_and_swings_never_precede_the_year(self):
        bars = scenario("ascending", JAN1)
        self.assertTrue(any(b[0] < JAN1 for b in bars))
        s = run("YTD", bars)
        self.assertTrue(ca.is_valid(s), s["reason"])
        ev = s["evidence"]
        self.assertTrue(all(t["time"] >= JAN1 * 1000 for t in ev["touches"]))
        self.assertTrue(all(x["time"] >= JAN1 * 1000 for x in ev["swings"]))
        self.assertTrue(all(x["swingTs"] >= JAN1 for x in ev["structure"]))
        self.assertGreaterEqual(s["lifecycle"]["anchorTime"], JAN1 * 1000)
        self.assertGreater(s["window"]["warmupBars"], 0, "ATR is warmed on earlier closed bars")

    def test_hy_is_six_calendar_months(self):
        bars = weekday_bars(utc(2025, 6, 2), utc(2026, 9, 30))
        s = run("HY", bars, now=utc(2026, 10, 1, 6))
        w = s["window"]
        self.assertEqual(w["type"], "ROLLING_MONTHS")
        self.assertEqual(w["months"], 6)
        self.assertEqual(w["start"], utc(2026, 4, 1) * 1000)
        self.assertEqual(w["firstBarTime"], utc(2026, 4, 1) * 1000)
        self.assertEqual(w["end"], utc(2026, 10, 1) * 1000)
        self.assertNotIn(w["start"], (JAN1 * 1000, utc(2026, 7, 1) * 1000), "HY is not a calendar half-year")

    def test_month_end_and_leap_year_subtraction(self):
        cases = {
            utc(2026, 10, 1): utc(2026, 4, 1),
            utc(2026, 8, 31): utc(2026, 2, 28),
            utc(2028, 8, 31): utc(2028, 2, 29),
            utc(2026, 3, 31): utc(2025, 9, 30),
            utc(2024, 2, 29): utc(2023, 8, 29),
            utc(2026, 1, 15, 13): utc(2025, 7, 15, 13),
            utc(2026, 12, 31): utc(2026, 6, 30),
        }
        for end, start in cases.items():
            self.assertEqual(ca.sub_months(end, 6), start, time.strftime("%Y-%m-%d", time.gmtime(end)))

    def test_hy_rolls_with_every_new_candle(self):
        bars = weekday_bars(utc(2025, 6, 2), utc(2026, 10, 1))
        before = run("HY", bars[:-1])
        after = run("HY", bars)
        self.assertEqual(before["window"]["firstBarTime"], utc(2026, 4, 1) * 1000)
        self.assertEqual(after["window"]["start"], utc(2026, 4, 2) * 1000)
        self.assertEqual(after["window"]["firstBarTime"], utc(2026, 4, 2) * 1000, "1 Apr left the window")
        self.assertEqual(after["window"]["lastBarTime"], utc(2026, 10, 1) * 1000, "the new candle entered it")

    def test_new_year_resets_ytd_but_not_hy(self):
        bars = weekday_bars(utc(2025, 6, 2), utc(2026, 12, 31))
        dec = run("YTD", bars, now=utc(2026, 12, 31, 12))
        self.assertFalse(ca.window_expired(dec, utc(2026, 12, 31, 23)))
        self.assertTrue(ca.window_expired(dec, utc(2027, 1, 1, 0)))
        jan = run("YTD", bars, now=utc(2027, 1, 1, 6))
        self.assertEqual(jan["window"]["start"], utc(2027, 1, 1) * 1000)
        self.assertEqual(jan["window"]["bars"], 0, "the previous year's window is not carried forward")
        self.assertEqual(jan["status"], "NO_CHANNEL")
        self.assertIn("year to date window", jan["reason"])
        self.assertFalse(ca.window_expired(jan, utc(2027, 3, 1)))
        hy = run("HY", bars, now=utc(2027, 1, 1, 6))
        self.assertEqual(hy["window"]["start"], utc(2026, 7, 1) * 1000)
        self.assertGreater(hy["window"]["bars"], 100)
        self.assertFalse(ca.window_expired(hy, utc(2027, 1, 1)))


class Detection(unittest.TestCase):
    EXPECT = {
        "ascending": ({"ACTIVE", "VALIDATED"}, "BULLISH"),
        "descending": ({"ACTIVE", "VALIDATED"}, "BEARISH"),
        "weakening": ({"WEAKENING"}, "BULLISH"),
        "broken": ({"BROKEN"}, "BULLISH"),
        "retesting": ({"RETESTING"}, "BULLISH"),
    }

    def test_valid_lifecycles_on_both_windows(self):
        for tf in ("YTD", "HY"):
            for name, (statuses, direction) in self.EXPECT.items():
                with self.subTest(tf=tf, scenario=name):
                    s = run(tf, scenario(name, JAN1))
                    self.assertIn(s["status"], statuses, s["reason"])
                    self.assertEqual(s["direction"], direction)
                    self.assertTrue(ca.is_valid(s))
                    self.assertGreater(s["upperBoundary"], s["midline"])
                    self.assertGreater(s["midline"], s["lowerBoundary"])
                    self.assertAlmostEqual(s["midline"], (s["upperBoundary"] + s["lowerBoundary"]) / 2)
                    self.assertGreaterEqual(s["anchorTouches"], 3)
                    self.assertGreaterEqual(s["oppositeTouches"], 2)
                    self.assertIsNotNone(s["slope"])
                    self.assertTrue(0 < s["confidence"] <= 95)
                    self.assertNotEqual(s["phase"], "UNKNOWN")
                    self.assertTrue(s["channelId"].startswith(f"EURUSD:{tf}:"))
                    self.assertEqual(s["hierarchyRole"], "CONTEXT")
                    labels = [t["label"] for t in s["evidence"]["touches"]]
                    self.assertTrue(any(x.startswith("Touch #1") for x in labels))
                    self.assertTrue(any(x.startswith("Touch #3") for x in labels))
                    self.assertTrue(any(x.startswith("Opposite #1") for x in labels))

    def test_lifecycle_phases_match_the_engine(self):
        for tf in ("YTD", "HY"):
            with self.subTest(tf=tf):
                self.assertEqual(run(tf, scenario("weakening", JAN1))["phase"], "DETERIORATION")
                self.assertEqual(run(tf, scenario("broken", JAN1))["phase"], "BREAKOUT")
                self.assertEqual(run(tf, scenario("retesting", JAN1))["phase"], "RETEST")
                self.assertEqual(run(tf, scenario("broken", JAN1))["breakout"]["side"], "UP")

    def test_forming_is_not_valid(self):
        for tf in ("YTD", "HY"):
            with self.subTest(tf=tf):
                s = run(tf, scenario("forming", JAN1))
                self.assertEqual(s["status"], "FORMING", s["reason"])
                self.assertFalse(ca.is_valid(s))
                self.assertLessEqual(s["confidence"], 45)
                self.assertTrue(s["invalidation"][0].startswith("Awaiting"))

    def test_no_channel_is_not_forced(self):
        for tf in ("YTD", "HY"):
            with self.subTest(tf=tf):
                s = run(tf, scenario("none", JAN1))
                self.assertEqual(s["status"], "NO_CHANNEL")
                self.assertEqual(s["direction"], "UNKNOWN")
                self.assertIsNone(s["upperBoundary"])
                self.assertTrue(s["reason"].startswith("NO VALID CHANNEL"))
                self.assertIn("window", s["reason"])

    def test_insufficient_window_is_no_valid_channel(self):
        bars = weekday_bars(utc(2025, 6, 2), utc(2026, 1, 20))
        s = run("YTD", bars, now=utc(2026, 1, 21))
        self.assertEqual(s["status"], "NO_CHANNEL")
        self.assertIn(f"/{vision.tf_cfg('YTD')['minBars']} closed D1 candles in the year to date window", s["reason"])

    def test_same_rules_as_d1(self):
        """Without bars before the window and within the D1 lookback, YTD and D1 must reach the identical read."""
        bars = bars_at(channel_closes(250, 0.02, 7), JAN1)
        y = run("YTD", bars)
        d = run("D1", bars)
        self.assertEqual(y["window"]["warmupBars"], 0)
        for k in ("status", "direction", "phase", "confidence", "position", "upperBoundary", "lowerBoundary", "slope",
                  "anchorTouches", "oppositeTouches", "definition"):
            self.assertEqual(y[k], d[k], k)
        self.assertEqual(y["channelId"].split(":", 2)[2], d["channelId"].split(":", 2)[2])

    def test_chart_is_the_window_with_projected_boundaries(self):
        bars = scenario("ascending", JAN1)
        for tf in ("YTD", "HY"):
            with self.subTest(tf=tf):
                s = run(tf, bars)
                chart = ca.chart_payload(s, bars)
                start = s["window"]["start"]
                self.assertEqual(len(chart["candles"]), s["window"]["bars"])
                self.assertEqual(chart["candles"][0]["time"], s["window"]["firstBarTime"])
                self.assertTrue(all(c["time"] >= start for c in chart["candles"]))
                self.assertGreater(len(chart["candles"]), 100, "a price series, not one aggregated candle")
                self.assertTrue(chart["lines"])
                self.assertAlmostEqual(chart["lines"][-1]["upper"], s["upperBoundary"], places=6)
                self.assertAlmostEqual(chart["lines"][-1]["lower"], s["lowerBoundary"], places=6)

    def test_no_lookahead(self):
        bars = scenario("ascending", JAN1)
        cut = len(bars) - 40
        full = run("HY", bars)
        prefix = run("HY", bars[:cut])
        self.assertLessEqual(prefix["window"]["end"], bars[cut][0] * 1000)
        self.assertTrue(all(t["time"] < bars[cut][0] * 1000 for t in prefix["evidence"]["touches"]))
        self.assertTrue(full["window"]["end"] > prefix["window"]["end"])


class Position(unittest.TestCase):
    def test_boundaries_map_to_0_50_100_and_outside_is_not_clamped(self):
        for tf in ("YTD", "HY"):
            with self.subTest(tf=tf):
                s = run(tf, scenario("ascending", JAN1))
                lo, hi = ca.live_bounds(s)
                w = hi - lo
                self.assertAlmostEqual(ca.live_view(s, lo)["position"], 0.0, places=2)
                self.assertAlmostEqual(ca.live_view(s, (lo + hi) / 2)["position"], 50.0, places=2)
                self.assertAlmostEqual(ca.live_view(s, hi)["position"], 100.0, places=2)
                self.assertAlmostEqual(ca.live_view(s, lo - 0.03 * w)["position"], -3.0, places=2)
                self.assertAlmostEqual(ca.live_view(s, hi + 0.05 * w)["position"], 105.0, places=2)
                expected = (s["currentPrice"] - s["lowerBoundary"]) / (s["upperBoundary"] - s["lowerBoundary"]) * 100
                self.assertAlmostEqual(s["position"], expected, places=1)

    def test_open_d1_candle_paints_on_both_windows(self):
        bars = scenario("ascending", JAN1)
        forming = (bars[-1][0] + DAY, 1.0, 1.1, 0.9, 1.05)
        out = ca.current_bars(forming[0] + 3600, {"D1": [forming]}, [])
        self.assertEqual(out["YTD"], forming)
        self.assertEqual(out["HY"], forming)
        s = run("YTD", bars)
        painted = ca.attach_current_candle(s, ca.chart_payload(s, bars), out["YTD"])
        self.assertFalse(painted["candles"][-1]["complete"])
        self.assertEqual(painted["lines"][-1]["time"], forming[0] * 1000)


class Symbols(unittest.TestCase):
    def test_each_symbol_gets_its_own_state(self):
        series = {sym: [(b[0], b[1] * k, b[2] * k, b[3] * k, b[4] * k) for b in scenario("ascending", JAN1)]
                  for sym, k in (("CHFJPY", 1.8), ("XAUUSD", 40.0), ("EURUSD", 0.011))}
        first: dict[str, dict] = {}
        for sym in ("CHFJPY", "XAUUSD", "EURUSD"):
            first[sym] = {tf: run(tf, series[sym], symbol=sym) for tf in ("YTD", "HY")}
        for sym, k in (("CHFJPY", 1.8), ("XAUUSD", 40.0), ("EURUSD", 0.011)):
            for tf in ("YTD", "HY"):
                s = first[sym][tf]
                self.assertEqual(s["instrument"], sym)
                self.assertTrue(s["channelId"].startswith(f"{sym}:{tf}:"))
                self.assertAlmostEqual(s["currentPrice"], series[sym][-1][4])
                again = run(tf, series[sym], symbol=sym)
                self.assertEqual(again["upperBoundary"], s["upperBoundary"], "no state leaks between symbols")
        self.assertNotEqual(first["CHFJPY"]["YTD"]["upperBoundary"], first["XAUUSD"]["YTD"]["upperBoundary"])


def core_channels() -> dict[str, dict]:
    """The nested-correction example of test_channel_analysis: MN bull, W bear, D1 bear, H8 bull, H1 bear."""
    def snap(tf, slope):
        step = {"MN": 30 * DAY, "W": 7 * DAY, "D1": DAY, "H8": 8 * 3600, "H1": 3600}[tf]
        return ca.analyse_timeframe("EURUSD", tf, bars_from_closes(channel_closes(300, slope, 7), step), READY, now=2_000_000_000)
    empty = lambda tf: ca.analyse_timeframe("EURUSD", tf, [], READY, now=2_000_000_000)  # noqa: E731
    return {"Y": empty("Y"), "Q": empty("Q"), "MN": snap("MN", 0.02), "W": snap("W", -0.02), "D1": snap("D1", -0.02),
            "H8": snap("H8", 0.02), "H1": snap("H1", -0.02)}


def channels_with_context(ytd: str, hy: str) -> dict[str, dict]:
    ch = core_channels()
    ch["YTD"] = run("YTD", scenario(ytd, JAN1))
    ch["HY"] = run("HY", scenario(hy, JAN1))
    return ch


class NoDoubleCounting(unittest.TestCase):
    def core(self) -> dict[str, dict]:
        return core_channels()

    def with_context(self, ytd: str, hy: str) -> dict[str, dict]:
        return channels_with_context(ytd, hy)

    KEYS = ("primaryDirection", "intermediateDirection", "currentDirection", "parentTimeframe", "parentDirection", "currentTimeframe",
            "currentLegDirection", "marketState", "structuralConfidence", "alignmentScore", "correctionDepth", "correctionRetracement",
            "validTimeframes", "unresolvedTimeframes", "keySupport", "keyResistance")

    def test_contexts_do_not_change_the_scored_hierarchy(self):
        before = self.core()
        edges_before = ca.build_hierarchy(before)
        x_before = ca.interpret(before)
        for ytd, hy in (("ascending", "ascending"), ("descending", "descending"), ("ascending", "descending"), ("none", "forming")):
            with self.subTest(ytd=ytd, hy=hy):
                after = self.with_context(ytd, hy)
                edges_after = ca.build_hierarchy(after)
                x_after = ca.interpret(after)
                for k in self.KEYS:
                    self.assertEqual(x_after[k], x_before[k], k)
                for tf in ca.CORE_TIMEFRAMES:
                    for k in ("relationship", "relationshipVia", "parentTimeframe", "parentChannelId", "correctionDepth"):
                        self.assertEqual(after[tf].get(k), before[tf].get(k), f"{tf}.{k}")
                core_edges = [e for e in edges_after if e["scored"]]
                self.assertEqual(core_edges, edges_before)
                self.assertEqual([e["child"] for e in edges_after], [t for t in ca.TIMEFRAMES if t != "Y"])
                self.assertEqual(x_after["scoredTimeframes"], list(ca.CORE_TIMEFRAMES))
                self.assertEqual(set(x_after["context"]), {"YTD", "HY"})
                self.assertIn("Strategic context (not scored)", x_after["narrative"])

    def test_context_relationship_reads_against_the_nearest_valid_context(self):
        ch = self.with_context("ascending", "descending")
        ca.build_hierarchy(ch)
        self.assertEqual(ch["YTD"]["relationship"], "PRIMARY", "Y has no valid channel here")
        self.assertEqual(ch["HY"]["relationshipVia"], "YTD")
        self.assertEqual(ch["HY"]["relationship"], "CORRECTIVE")
        self.assertEqual(ch["Q"]["parentTimeframe"], "Y", "core parents never route through YTD/HY")
        self.assertIn("not scored", ch["HY"]["relationshipReason"])

    def test_trade_discovery_is_identical_with_and_without_contexts(self):
        def compact(tf, snap):
            return {"timeframe": tf, "direction": snap["direction"], "status": snap["status"], "position": snap["position"],
                    "lower": snap["lowerBoundary"], "upper": snap["upperBoundary"], "mid": snap["midline"], "channelId": snap["channelId"],
                    "confidence": snap["confidence"], "atr": snap["evidence"]["atr"], "currentPrice": snap["currentPrice"]}
        ch = self.with_context("descending", "ascending")
        ca.build_hierarchy(ch)
        core = {tf: compact(tf, ch[tf]) for tf in ca.CORE_TIMEFRAMES}
        full = {tf: compact(tf, ch[tf]) for tf in ca.TIMEFRAMES}
        a = opportunity.scan(["EURUSD"], {"EURUSD": core})
        b = opportunity.scan(["EURUSD"], {"EURUSD": full})
        strip = lambda r: [{k: v for k, v in h.items() if k not in ("detectedAt", "updatedAt", "createdAt")}  # noqa: E731
                           for h in r["instruments"][0]["hypotheses"]]
        self.assertEqual(strip(a), strip(b))
        self.assertEqual(a["summary"], b["summary"])
        self.assertEqual(len(a["qualified"]), len(b["qualified"]))

    def test_seven_context_inputs_still_work(self):
        ch = self.core()
        edges = ca.build_hierarchy(ch)
        self.assertEqual(len(edges), 6)
        x = ca.interpret(ch)
        self.assertEqual(x["contextTimeframes"], [])
        ca.state_version(ch, x)


class Service(unittest.TestCase):
    """All 29 instruments, autonomous, one D1 read per symbol for D1 + YTD + HY, and year rollover."""

    def setUp(self):
        self.tails = {
            "D1": scenario("ascending", JAN1)[-460:],
            "MN1": bars_at(channel_closes(200, 0.02, 7), utc(2010, 1, 1), 31 * DAY),
            "W1": bars_at(channel_closes(400, 0.02, 7), utc(2019, 1, 7), 7 * DAY),
            "H8": bars_at(channel_closes(560, 0.02, 7), utc(2026, 4, 1), 8 * 3600),
            "H1": bars_at(channel_closes(420, 0.02, 7), utc(2026, 9, 10), 3600),
        }
        self.calls: list[tuple[str, str, int]] = []
        self.persisted: dict[str, dict] = {}
        self.now = ca.bar_close("D1", self.tails["D1"][-1][0]) + 6 * 3600

        def tail(sym, tf, n):
            self.calls.append((sym, tf, n))
            return self.tails[tf][-n:]

        def persist(sym, channels, analysed, edges, interp, version, events, trigger, run_id):
            self.persisted[sym] = {"channels": copy.deepcopy(channels), "analysed": list(analysed), "edges": edges, "interp": interp}
            return []

        self.series = {(s, tf): {"status": "READY", "reason": "ok", "candle_count": 500, "latest_ts": self.tails[tf][-1][0]}
                       for s in channel_service.SYMBOLS for tf in ("MN1", "W1", "D1", "H8", "H1")}
        cs = channel_service.cs
        self.patches = [
            mock.patch.object(channel_service.hs, "candle_tail", tail),
            mock.patch.object(channel_service.hs, "series_all", lambda: self.series),
            mock.patch.object(cs, "persist", persist),
            mock.patch.object(cs, "start_run", lambda *a: 1),
            mock.patch.object(cs, "finish_run", lambda *a: None),
            mock.patch.object(cs, "save_meta", lambda m: None),
            mock.patch.object(cs, "add_events", lambda s, e: e),
            mock.patch.object(cs, "update_live", lambda rows: None),
        ]
        for p in self.patches:
            p.start()
        self.svc = channel_service.ChannelService(server_now_fn=lambda: self.now)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_every_instrument_publishes_ytd_and_hy(self):
        self.assertEqual(len(channel_service.SYMBOLS), 29)
        self.assertIn("XAUUSD", channel_service.SYMBOLS)
        res = self.svc.run({s: set(ca.TIMEFRAMES) for s in channel_service.SYMBOLS}, {s: "STARTUP" for s in channel_service.SYMBOLS})
        self.assertEqual(res["failed"], 0)
        self.assertEqual(res["analysed"], 29)
        for sym in channel_service.SYMBOLS:
            ch = self.persisted[sym]["channels"]
            self.assertEqual([t for t in ca.TIMEFRAMES if t in ch], list(ca.TIMEFRAMES))
            for tf in ("YTD", "HY"):
                s = ch[tf]
                self.assertEqual(s["instrument"], sym)
                self.assertEqual(s["sourceTimeframe"], "D1")
                self.assertIsNotNone(s["window"])
                self.assertEqual(s["sourceBarTs"], self.tails["D1"][-1][0])
                self.assertTrue(ca.is_valid(s), f"{sym} {tf}: {s['reason']}")
        summary = self.svc.summary()
        self.assertEqual(summary["analysed"], 29)
        self.assertEqual(set(summary["validByTimeframe"]), set(ca.TIMEFRAMES))

    def test_one_source_read_per_symbol(self):
        self.svc.run({"EURUSD": set(ca.TIMEFRAMES)}, {"EURUSD": "STARTUP"})
        reads = [(tf, n) for sym, tf, n in self.calls if sym == "EURUSD"]
        self.assertEqual(sorted(tf for tf, _ in reads), ["D1", "H1", "H8", "MN1", "W1"], "D1 serves D1, YTD and HY")
        self.calls.clear()
        self.svc.on_candles("D1", ["EURUSD"])
        self.assertEqual(self.svc._dirty["EURUSD"], {"YTD", "HY", "D1"})
        dirty, self.svc._dirty = self.svc._dirty, {}
        self.series[("EURUSD", "D1")] = {**self.series[("EURUSD", "D1")], "latest_ts": self.tails["D1"][-1][0] + 1}
        self.svc.run(dirty, {"EURUSD": "NEW_CANDLE D1"})
        self.assertEqual([tf for _, tf, _ in self.calls], ["D1"], "a new D1 candle re-reads D1 once, nothing else")
        self.assertEqual(sorted(self.persisted["EURUSD"]["analysed"]), ["D1", "HY", "YTD"])

    def test_unchanged_source_is_not_recalculated(self):
        self.svc.run({"EURUSD": set(ca.TIMEFRAMES)}, {"EURUSD": "STARTUP"})
        self.calls.clear()
        res = self.svc.run({"EURUSD": {"YTD", "HY"}}, {"EURUSD": "STAGE1_DATA_CHANGE D1"})
        self.assertEqual(res["analysed"], 0)
        self.assertEqual(self.calls, [])

    def test_new_year_marks_ytd_for_rebuild(self):
        self.svc.run({s: set(ca.TIMEFRAMES) for s in ("EURUSD", "XAUUSD")}, {})
        self.svc._reconcile(self.series)
        self.svc._dirty.clear()
        self.svc._reconcile(self.series)
        self.assertEqual(self.svc._dirty, {})
        self.now = utc(2027, 1, 1)
        self.svc._reconcile(self.series)
        self.assertEqual(self.svc._dirty.get("EURUSD"), {"YTD"})
        self.assertEqual(self.svc._dirty.get("XAUUSD"), {"YTD"})
        dirty, self.svc._dirty = self.svc._dirty, {}
        self.svc.run(dirty, {s: "WINDOW_ROLLOVER" for s in dirty})
        self.assertEqual(self.persisted["EURUSD"]["channels"]["YTD"]["window"]["start"], utc(2027, 1, 1) * 1000)
        self.svc._reconcile(self.series)
        self.assertEqual(self.svc._dirty, {}, "rebuilt once, not every tick")

    def test_stale_source_marks_contexts_stale(self):
        self.series[("EURUSD", "D1")] = {**self.series[("EURUSD", "D1")], "status": "STALE", "reason": "no new candle"}
        self.svc.run({"EURUSD": set(ca.TIMEFRAMES)}, {"EURUSD": "STARTUP"})
        ch = self.persisted["EURUSD"]["channels"]
        for tf in ("YTD", "HY", "D1"):
            self.assertEqual(ch[tf]["dataStatus"], "STALE")
            self.assertTrue(any("STALE" in w for w in ch[tf]["evidence"]["warnings"]))
        self.assertEqual(ch["H1"]["dataStatus"], "READY")


def first_touch(snap: dict) -> int:
    return min(t["time"] for t in snap["evidence"]["touches"])


class WindowIsolation(unittest.TestCase):
    """YTD is its own detector run on its own window; it never inherits the D1 channel."""

    def test_d1_structure_before_the_year_is_not_reused_by_ytd(self):
        bars = bars_at(channel_closes(360, 0.02, 7), JAN1 - 200 * DAY)
        d1, ytd = run("D1", bars), run("YTD", bars)
        self.assertTrue(ca.is_valid(d1) and ca.is_valid(ytd))
        self.assertLess(first_touch(d1), JAN1 * 1000, "precondition: the D1 channel is anchored in the prior year")
        self.assertGreaterEqual(first_touch(ytd), JAN1 * 1000)
        self.assertNotEqual(ytd["channelId"].split(":", 2)[2], d1["channelId"].split(":", 2)[2])
        self.assertGreaterEqual(ytd["lifecycle"]["anchorTime"], JAN1 * 1000)

    def test_each_context_is_an_independent_detector_call(self):
        bars = bars_at(channel_closes(360, 0.02, 7), JAN1 - 200 * DAY)
        calls: list[tuple] = []
        real = vision.analyse_tf

        def spy(tf, work, start_ts=None):
            calls.append((tf, len(work), int(work[0][0]), start_ts))
            return real(tf, work, start_ts=start_ts)

        with mock.patch.object(vision, "analyse_tf", spy):
            d1 = run("D1", bars)
            ytd = run("YTD", bars)
        (tf_d, n_d, _, start_d), (tf_y, n_y, first_y, start_y) = calls
        self.assertEqual((tf_d, start_d, n_d), ("D1", None, len(bars)))
        self.assertEqual((tf_y, start_y), ("YTD", JAN1))
        self.assertEqual(n_y, ytd["window"]["bars"] + ytd["window"]["warmupBars"], "window plus ATR warm-up only")
        self.assertEqual(first_y, bars[len(bars) - n_y][0])
        self.assertIsNot(ytd["evidence"], d1["evidence"])

    def test_identical_channel_when_all_structure_is_inside_the_window(self):
        """The legitimate identity: no swing before 1 Jan, so the D1 lookback and the YTD window see the same structure."""
        level = channel_closes(1, 0.02, 7)[0]
        bars = bars_at([level] * 150 + channel_closes(250, 0.02, 7), JAN1 - 150 * DAY)
        d1, ytd = run("D1", bars), run("YTD", bars)
        self.assertTrue(ca.is_valid(d1), d1["reason"])
        self.assertGreaterEqual(first_touch(d1), JAN1 * 1000)
        self.assertEqual(ytd["channelId"].split(":", 2)[2], d1["channelId"].split(":", 2)[2])
        strip = lambda s: [(t["time"], t["price"], t["role"], t["boundary"]) for t in s["evidence"]["touches"]]  # noqa: E731
        self.assertEqual(strip(ytd), strip(d1))
        for k in ("status", "direction", "upperBoundary", "midline", "lowerBoundary", "slope", "confidence", "definition"):
            self.assertEqual(ytd[k], d1[k], k)
        self.assertGreater(ytd["window"]["warmupBars"], 0, "the D1 series reaches into the prior year")


class StatusSemantics(unittest.TestCase):
    def test_frontend_valid_statuses_match_engine(self):
        src = (Path(__file__).resolve().parents[2] / "src" / "features" / "channel-analysis" / "format.ts").read_text(encoding="utf-8")
        m = re.search(r"export const VALID_STATUSES: ChannelStatus\[\] = \[([^\]]*)\]", src)
        self.assertIsNotNone(m)
        self.assertEqual(set(re.findall(r"'([A-Z_]+)'", m.group(1))), set(ca.VALID_STATUSES))
        self.assertEqual(set(ca.VALID_STATUSES), {"VALIDATED", "ACTIVE", "WEAKENING", "BROKEN", "RETESTING"})

    def test_validated_counts_as_a_valid_channel(self):
        ch = core_channels()
        ch["D1"]["status"] = "VALIDATED"
        self.assertTrue(ca.is_valid(ch["D1"]))
        ca.build_hierarchy(ch)
        self.assertIn("D1", ca.interpret(ch)["validTimeframes"])
        for status in ("FORMING", "INVALIDATED", "NO_CHANNEL"):
            self.assertFalse(ca.is_valid({**ch["D1"], "status": status}), status)


def expand(channels: dict[str, dict], shared: dict[str, list]) -> dict[str, tuple]:
    """Mirror of expandSharedSeries in channelClient.ts."""
    def cut(rows, ref):
        i = next((k for k, r in enumerate(rows) if r["time"] == ref["from"]), None)
        return [] if i is None else rows[i:i + ref["count"]]
    candles = {tf: cut(shared[c["candlesRef"]["source"]], c["candlesRef"]) if c.get("candlesRef") else c["candles"] for tf, c in channels.items()}
    lines = {tf: cut(channels[c["linesRef"]["timeframe"]]["lines"], c["linesRef"]) if c.get("linesRef") else c["lines"] for tf, c in channels.items()}
    return {tf: (candles[tf], lines[tf]) for tf in channels}


class SharedChartSeries(unittest.TestCase):
    def charts(self, bars: list[tuple]) -> dict[str, dict]:
        forming = (bars[-1][0] + DAY, bars[-1][4], bars[-1][4] + 0.2, bars[-1][4] - 0.2, bars[-1][4] + 0.1)
        out = {}
        for tf in ("YTD", "HY", "D1"):
            s = run(tf, bars)
            out[tf] = {**s, **ca.attach_current_candle(s, ca.chart_payload(s, bars), forming)}
        return out

    def test_references_expand_to_the_original_series(self):
        bars = scenario("ascending", JAN1)
        channels = self.charts(bars)
        original = copy.deepcopy({tf: (c["candles"], c["lines"]) for tf, c in channels.items()})
        shared = ca.share_source_series(channels)
        self.assertEqual(expand(channels, shared), original)
        self.assertTrue(all(c.get("candlesRef") and c["candles"] == [] for c in channels.values()))
        sent = len(shared["D1"])
        self.assertLess(sent, sum(len(c) for c, _ in original.values()))
        self.assertEqual(sent, len({x["time"] for c, _ in original.values() for x in c}), "each D1 candle is sent once")

    def test_a_series_that_is_not_an_exact_slice_stays_inline(self):
        channels = self.charts(scenario("ascending", JAN1))
        channels["HY"]["candles"][5] = {**channels["HY"]["candles"][5], "close": -1.0}
        channels["YTD"]["lines"][3] = {**channels["YTD"]["lines"][3], "upper": -1.0}
        original = copy.deepcopy({tf: (c["candles"], c["lines"]) for tf, c in channels.items()})
        shared = ca.share_source_series(channels)
        self.assertEqual(expand(channels, shared), original)
        self.assertNotIn("linesRef", channels["YTD"])

    def test_aggregated_sources_are_untouched(self):
        mn = bars_at(channel_closes(200, 0.02, 7), utc(2010, 1, 1), 31 * DAY)
        y = ca.aggregate(mn, "Y")
        channels = {"MN": {**run("MN", mn), **ca.chart_payload(run("MN", mn), mn)},
                    "Y": {**run("Y", y), **ca.chart_payload(run("Y", y), y)}}
        self.assertEqual(ca.share_source_series(channels), {})
        self.assertNotIn("candlesRef", channels["MN"])


class WorldModel(unittest.TestCase):
    def setUp(self):
        import os
        import tempfile
        fd, self.path = tempfile.mkstemp(prefix="cacsms-world-", suffix=".db")
        os.close(fd)
        self.env = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = "file:" + self.path
        import sqlite_db
        self.sqlite = sqlite_db
        self.sqlite._schema_ready = False
        self.store = channel_service.cs
        self.store._schema_ready = False
        self.store.ensure_schema()

    def tearDown(self):
        import os
        if self.env is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = self.env
        self.sqlite._schema_ready = False
        self.store._schema_ready = False
        try:
            os.remove(self.path)
        except OSError:
            pass

    def test_derived_contexts_expose_window_metadata(self):
        ch = channels_with_context("ascending", "descending")
        edges = ca.build_hierarchy(ch)
        interp = ca.interpret(ch)
        self.store.persist("EURUSD", ch, list(ca.TIMEFRAMES), edges, interp, ca.state_version(ch, interp), [], "TEST", 1)
        row = next(r for r in self.store.world_rows() if r["symbol"] == "EURUSD")
        self.assertEqual(list(row["timeframes"]), list(ca.TIMEFRAMES))
        for tf, kind in (("YTD", "CALENDAR_YTD"), ("HY", "ROLLING_MONTHS")):
            w, win = row["timeframes"][tf], ch[tf]["window"]
            self.assertEqual(w["sourceTimeframe"], "D1")
            self.assertEqual(w["contextRole"], "STRATEGIC_CONTEXT")
            self.assertFalse(w["scored"])
            self.assertEqual(w["weight"], 0)
            self.assertEqual(w["windowType"], kind)
            self.assertEqual((w["windowStart"], w["windowEnd"], w["windowBars"]), (win["start"], win["end"], win["bars"]))
        for tf in ca.CORE_TIMEFRAMES:
            for k in ("contextRole", "windowStart", "windowEnd", "scored", "weight"):
                self.assertNotIn(k, row["timeframes"][tf], f"core {tf} rows are unchanged")


class TradingWeight(unittest.TestCase):
    """YTD/HY are strategic context only: weight 0 and invisible to every trading stage."""

    def test_contexts_carry_zero_weight_and_no_group(self):
        for tf in ca.CONTEXT_TIMEFRAMES:
            self.assertEqual(ca.CONFIG["tfWeight"][tf], 0)
            self.assertFalse(any(tf in g for g in ca.GROUPS.values()), f"{tf} is in no interpretation group")
        self.assertEqual({k: v for k, v in ca.CONFIG["tfWeight"].items() if k in ca.CORE_TIMEFRAMES},
                         {"Y": 7, "Q": 6, "MN": 5, "W": 4, "D1": 3, "H8": 2, "H1": 1})

    def test_trading_levels_are_unchanged(self):
        self.assertEqual({k: (v["parents"], v["child"], v["execution"]) for k, v in opportunity.LEVELS.items()},
                         {"L1": (("MN", "W"), "D1", "H1"), "L2": (("W", "D1"), "H8", "H1"),
                          "L3": (("D1", "H8"), "H1", "M15"), "L4": (("H8", "H1"), "M15", "M5")})

    def test_no_trading_stage_reads_ytd_or_hy(self):
        here = Path(__file__).resolve().parent
        allowed = {
            "channel_analysis.py",
            "channel_service.py",
            "channel_store.py",
            "strength_intelligence.py",
            "supertrend_intelligence.py",
            "trend_intelligence.py",
            "vision.py",
            "server.py",
        }
        token = re.compile(r"""["'](?:YTD|HY)["']""")
        offenders = [p.name for p in here.glob("*.py")
                     if not p.name.startswith("test_") and p.name not in allowed and token.search(p.read_text(encoding="utf-8", errors="ignore"))]
        self.assertEqual(offenders, [], "Stage 4/6/7/8, TiT, opportunity, risk and execution code must not consume YTD/HY")


class Universe(unittest.TestCase):
    def test_universe_is_29_instruments(self):
        self.assertEqual(len(regime.SYMBOLS), 29)
        self.assertEqual(list(channel_service.SYMBOLS), list(regime.SYMBOLS))


if __name__ == "__main__":
    unittest.main()
