"""Stage 5 HTF Market Vision tests on synthetic, fully specified price series (no MT5, no SQL).

Run from bridge/mt5:  python -m unittest test_vision -v
"""

from __future__ import annotations

import unittest
from unittest import mock

import vision
import vision_service

DAY = 86400
H8 = 8 * 3600
T0 = 1699920000  # 2023-11-14 00:00 UTC
W = 1.0          # channel half-amplitude driver
WICK = 0.05
BASE = 100.0


def tri(x: float) -> float:
    """Triangle wave in [-1, 1], period 1: trough at 0, peak at 0.5."""
    t = x % 1.0
    return 4 * t - 1 if t < 0.5 else 3 - 4 * t


def bars_from_closes(closes: list[float], step: int = DAY, wick: float = WICK) -> list[tuple]:
    out = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        out.append((T0 + i * step, o, max(o, c) + wick, min(o, c) - wick, c))
    return out


def channel_closes(n: int, slope: float, phase0: int, period: int = 20) -> list[float]:
    return [BASE + slope * i + 0.85 * W * tri((i + phase0) / period) for i in range(n)]


def upper(i: int, slope: float) -> float:
    """Exact upper boundary of the synthetic channel: every wave peak high lies on it."""
    return BASE + slope * i + 0.85 * W + WICK


def analyse(closes: list[float], tf: str = "D1") -> dict:
    return vision.analyse_tf(tf, bars_from_closes(closes, DAY if tf == "D1" else H8))


BULL = ("BULLISH", "STRONG_BULLISH")
BEAR = ("BEARISH", "STRONG_BEARISH")


class SwingDetection(unittest.TestCase):
    def test_pivots_alternate_at_wave_extremes(self):
        b = bars_from_closes(channel_closes(120, 0.0, 0))
        h = [x[2] for x in b]
        l = [x[3] for x in b]
        atr = vision.wilder_atr(h, l, [x[4] for x in b], 14)
        sw = vision.zigzag(vision.pivots(h, l, 3), atr, 1.0)
        kinds = [s["kind"] for s in sw]
        self.assertGreaterEqual(len(sw), 8)
        self.assertTrue(all(a != b for a, b in zip(kinds, kinds[1:])), "zigzag swings must alternate")
        self.assertTrue(all(s["i"] % 20 == (10 if s["kind"] == "H" else 0) for s in sw))


class ChannelConstruction(unittest.TestCase):
    def test_bullish_channel_validated_with_touch_roles(self):
        a = analyse(channel_closes(300, 0.02, 7))
        self.assertIn(a["status"], ("ACTIVE", "VALIDATED"))
        self.assertTrue(a["confirmed"])
        self.assertIn(a["direction"], BULL)
        roles = [t["role"] for t in a["touchList"]]
        for r in ("ANCHOR", "CANDIDATE", "VALIDATION", "OPPOSITE"):
            self.assertIn(r, roles)
        by_role = {t["role"]: t["ts"] for t in a["touchList"] if t["role"] in ("ANCHOR", "CANDIDATE", "VALIDATION")}
        self.assertLess(by_role["ANCHOR"], by_role["CANDIDATE"])
        self.assertLess(by_role["CANDIDATE"], by_role["VALIDATION"])
        self.assertEqual(a["candidate"]["ts"], by_role["CANDIDATE"])
        self.assertEqual(a["validation"]["ts"], by_role["VALIDATION"])
        self.assertGreaterEqual(a["touches"]["anchor"], 3)
        self.assertGreaterEqual(a["touches"]["opposite"], 2)
        self.assertTrue(a["parallelOk"])
        self.assertTrue(0 <= a["position"] <= 100)
        self.assertLessEqual(a["confidence"], 95)
        self.assertGreater(a["confidence"], 60)
        types = {e["type"] for e in a["events"]}
        self.assertIn("CHANNEL_VALIDATED", types)
        self.assertIn("TOUCH", types)
        self.assertEqual(a["phase"], "IMPULSE")

    def test_bearish_channel(self):
        a = analyse(channel_closes(300, -0.02, 7))
        self.assertTrue(a["confirmed"])
        self.assertIn(a["direction"], BEAR)
        self.assertLess(a["slopeAtr20"], 0)
        self.assertTrue(any("close above the upper boundary" in x for x in a["invalidation"]))

    def test_forming_channel_is_not_directional(self):
        closes = [90 + 0.1 * i for i in range(101)]                       # structureless trend to 100
        for leg, n in ((-0.17, 10), (0.17, 10), (-0.17, 10), (0.17, 5)):  # H100 L110 H120 L130
            for _ in range(n):
                closes.append(closes[-1] + leg)
        a = analyse(closes)
        self.assertEqual(a["status"], "FORMING")
        self.assertFalse(a["confirmed"])
        self.assertEqual(a["direction"], "NEUTRAL")
        self.assertLessEqual(a["confidence"], 45)
        self.assertTrue(a["invalidation"][0].startswith("Awaiting"))

    def test_no_channel_reports_reason(self):
        a = analyse([BASE + 0.05 * i for i in range(200)])
        self.assertEqual(a["status"], "NONE")
        self.assertFalse(a["confirmed"])
        self.assertIn("No channel", a["reason"])


class Phases(unittest.TestCase):
    def test_pullback_inside_bullish_channel(self):
        a = analyse(channel_closes(300, 0.02, 17))
        self.assertTrue(a["confirmed"])
        self.assertEqual(a["phase"], "PULLBACK")

    def test_consolidation(self):
        closes = channel_closes(290, 0.02, 6)  # ends mid-channel on a down leg
        mid = closes[-1]
        closes += [mid + (0.1 if k % 2 else -0.1) for k in range(10)]
        a = analyse(closes)
        self.assertTrue(a["confirmed"])
        self.assertEqual(a["phase"], "CONSOLIDATION")

    def test_compression(self):
        closes = channel_closes(290, 0.02, 6)  # after a down leg, so no lower high is printed
        closes += [closes[-1]] * 10
        a = vision.analyse_tf("D1", bars_from_closes(closes[:290]) + [
            (T0 + i * DAY, closes[-1], closes[-1] + 0.01, closes[-1] - 0.01, closes[-1]) for i in range(290, 300)
        ])
        self.assertEqual(a["phase"], "COMPRESSION")
        self.assertEqual(a["volState"], "CONTRACTING")

    def test_lower_high_is_deterioration(self):
        closes = channel_closes(290, 0.02, 16)  # flat after an up leg: last swing high stalls mid-channel
        a = vision.analyse_tf("D1", bars_from_closes(closes) + [
            (T0 + i * DAY, closes[-1], closes[-1] + 0.01, closes[-1] - 0.01, closes[-1]) for i in range(290, 300)
        ])
        self.assertEqual(a["status"], "WEAKENING")
        self.assertEqual(a["phase"], "DETERIORATION")
        self.assertIn(a["direction"], BULL)

    def test_breakout(self):
        s = 0.02
        closes = channel_closes(300, s, 10)
        closes += [upper(300, s) + 0.30, upper(301, s) + 0.40]
        a = analyse(closes)
        self.assertEqual(a["status"], "BROKEN")
        self.assertEqual(a["phase"], "BREAKOUT")
        self.assertEqual(a["breakout"]["side"], "UP")
        self.assertIn(a["direction"], BULL)
        self.assertIn("BREAKOUT", {e["type"] for e in a["events"]})

    def test_failed_breakout(self):
        s = 0.02
        closes = channel_closes(300, s, 10)
        closes += [upper(300, s) + 0.25, upper(301, s) - 0.30, upper(302, s) - 0.50]
        a = analyse(closes)
        self.assertIsNone(a["breakout"])
        self.assertTrue(a["failedBreakouts"])
        self.assertEqual(a["failedBreakouts"][-1]["side"], "UP")
        self.assertEqual(a["phase"], "FAILED_BREAKOUT")
        self.assertTrue(a["confirmed"])
        self.assertIn("FAILED_BREAKOUT", {e["type"] for e in a["events"]})

    def test_retest(self):
        s = 0.02
        closes = channel_closes(300, s, 10)
        closes += [upper(300, s) + 0.30, upper(301, s) + 0.40, upper(302, s) + 0.06]
        a = analyse(closes)
        self.assertEqual(a["status"], "RETESTING")
        self.assertEqual(a["phase"], "RETEST")
        self.assertTrue(a["breakout"]["retesting"])
        self.assertIn("RETEST", {e["type"] for e in a["events"]})

    def test_invalidation_after_extended_breakout(self):
        s = 0.02
        closes = channel_closes(300, s, 10)
        closes += [upper(300 + k, s) + 0.3 + 0.5 * k for k in range(8)]
        a = analyse(closes)
        self.assertEqual(a["status"], "INVALIDATED")
        self.assertFalse(a["confirmed"])
        self.assertEqual(a["direction"], "NEUTRAL")
        self.assertLessEqual(a["confidence"], 25)
        self.assertIn("INVALIDATED", {e["type"] for e in a["events"]})


class DataReadiness(unittest.TestCase):
    def test_insufficient(self):
        st, why = vision.data_status("D1", {"status": "READY", "reason": "ok"}, 50)
        self.assertEqual(st, "INSUFFICIENT_DATA")
        self.assertIn("50/120", why)

    def test_warming_up_while_syncing(self):
        st, why = vision.data_status("H8", {"status": "SYNCING", "reason": "backfill"}, 40)
        self.assertEqual(st, "WARMING_UP")
        self.assertIn("40/150", why)

    def test_stale(self):
        self.assertEqual(vision.data_status("D1", {"status": "STALE", "reason": "no close"}, 500)[0], "STALE")

    def test_blocked_provider(self):
        self.assertEqual(vision.data_status("D1", {"status": "PROVIDER_OFFLINE", "reason": "MT5 down"}, 500)[0], "BLOCKED")

    def test_no_checkpoint(self):
        self.assertEqual(vision.data_status("D1", None, 0)[0], "INSUFFICIENT_DATA")


QUAL = {"qualified": True, "reason": "Stage 4 PROMOTED BULLISH", "bias": "BULLISH", "conviction": 60, "differential": 5, "gate": "STAGE4_PROMOTION"}
READY = ("READY", "ok")


class Combination(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d1_bull = analyse(channel_closes(300, 0.02, 7))
        cls.h8_bull = analyse(channel_closes(300, 0.02, 7), "H8")
        cls.h8_bear = analyse(channel_closes(300, -0.02, 7), "H8")
        cls.d1_forming = analyse([90 + 0.1 * i for i in range(101)] + [100 - 0.17 * k for k in range(1, 11)]
                                 + [98.3 + 0.17 * k for k in range(1, 11)] + [100 - 0.17 * k for k in range(1, 11)]
                                 + [98.3 + 0.17 * k for k in range(1, 6)])

    def test_agreement(self):
        out = vision.combine("EURUSD", QUAL, self.d1_bull, self.h8_bull, READY, READY)
        self.assertEqual(out["status"], "READY")
        self.assertEqual(out["agreement"], "AGREE")
        self.assertIn(out["primaryDirection"], BULL)
        self.assertFalse(out["executes"])
        expected = min(95, 0.65 * self.d1_bull["confidence"] + 0.35 * self.h8_bull["confidence"] + 5)
        self.assertAlmostEqual(out["confidence"], round(expected, 1), places=1)

    def test_d1_h8_conflict(self):
        out = vision.combine("EURUSD", QUAL, self.d1_bull, self.h8_bear, READY, READY)
        self.assertEqual(out["agreement"], "CONFLICT")
        self.assertIn(out["primaryDirection"], BULL, "D1 stays primary")
        self.assertEqual(out["phase"], "PULLBACK")
        agree = vision.combine("EURUSD", QUAL, self.d1_bull, self.h8_bull, READY, READY)["confidence"]
        self.assertLess(out["confidence"], agree)
        self.assertTrue(any("conflicts" in r for r in out["reasoning"]))

    def test_unconfirmed_d1_publishes_no_direction(self):
        out = vision.combine("EURUSD", QUAL, self.d1_forming, self.h8_bull, READY, READY)
        self.assertEqual(out["agreement"], "UNCONFIRMED")
        self.assertEqual(out["primaryDirection"], "NEUTRAL")
        self.assertLessEqual(out["confidence"], 45)

    def test_not_qualified_is_blocked(self):
        q = {**QUAL, "qualified": False, "reason": "scanner regime bias NEUTRAL"}
        out = vision.combine("EURUSD", q, self.d1_bull, self.h8_bull, READY, READY)
        self.assertEqual(out["status"], "BLOCKED")
        self.assertEqual(out["primaryDirection"], "NEUTRAL")
        self.assertEqual(out["confidence"], 0)

    def test_stale_discounts_confidence(self):
        fresh = vision.combine("EURUSD", QUAL, self.d1_bull, self.h8_bull, READY, READY)["confidence"]
        out = vision.combine("EURUSD", QUAL, self.d1_bull, self.h8_bull, ("STALE", "old"), READY)
        self.assertEqual(out["status"], "STALE")
        self.assertLess(out["confidence"], fresh)

    def test_insufficient_data_zero_confidence(self):
        out = vision.combine("EURUSD", QUAL, None, None, ("INSUFFICIENT_DATA", "D1: 50/120"), READY)
        self.assertEqual(out["status"], "INSUFFICIENT_DATA")
        self.assertEqual(out["primaryDirection"], "NEUTRAL")
        self.assertEqual(out["confidence"], 0)
        self.assertEqual(out["reason"], "D1: 50/120")

    def test_channel_lines_projection(self):
        a = self.d1_bull
        ts = [T0 + i * DAY for i in range(300)]
        lines = vision.channel_lines(a["def"], ts, 12, "D1")
        self.assertEqual(sum(1 for x in lines if x["projected"]), 12)
        self.assertTrue(all(x["upper"] > x["lower"] for x in lines))


def series_row(status="READY", count=2000, latest=T0):
    return {"status": status, "reason": status, "candle_count": count, "latest_ts": latest, "provider_exhausted": False}


class AutonomousFlow(unittest.TestCase):
    """Scanner -> Stage 1 history -> swings -> channel -> touches -> interpretation -> confidence -> persist -> Stage 6 contract."""

    def setUp(self):
        self.persisted: dict[str, dict] = {}
        self.events: dict[str, list] = {}
        d1 = bars_from_closes(channel_closes(460, 0.02, 7))
        h8 = bars_from_closes(channel_closes(560, -0.02, 7), H8)
        self.tails = {"D1": d1, "H8": h8}
        def pub(direction, conviction, diff, promoted=True, state=None):
            return {"state": state or ("PROMOTED" if promoted else "NEUTRAL"), "direction": direction, "conviction": conviction,
                    "differential": diff, "relationship": "STRONG_VS_WEAK", "confidence": 80, "freshness": "CURRENT",
                    "promoted": promoted, "reason": "test", "evidence": ["e"], "liveEligible": False}

        self.pub = pub
        self.scanner = {
            "EURUSD": pub("STRONG_BULLISH", 70, 6),
            "GBPJPY": pub("BEARISH", 58, -8),
            "AUDCAD": pub("NEUTRAL", 5, 0, promoted=False),
            "USDJPY": pub("BULLISH", 56, 3),
            "EURGBP": pub("BEARISH", 57, -2),
            "NZDUSD": pub("BEARISH", 60, -3),
        }
        self.series = {(s, tf): series_row() for s in vision_service.SYMBOLS for tf in ("D1", "H8")}
        self.series[("USDJPY", "D1")] = series_row("READY", 60)
        self.series[("NZDUSD", "H8")] = series_row("STALE", 2000)

        def tail(sym, tf, n):
            if sym == "EURGBP":
                raise RuntimeError("corrupt series")
            return self.tails[tf][-n:]

        def persist(out, channels, events, trigger, ms):
            self.persisted[out["symbol"]] = {"out": out, "channels": channels, "trigger": trigger}
            self.events[out["symbol"]] = events
            return events

        self.patches = [
            mock.patch.object(vision_service.vs, "scanner_rows", lambda: self.scanner),
            mock.patch.object(vision_service.vs, "persist", persist),
            mock.patch.object(vision_service.vs, "save_meta", lambda m: None),
            mock.patch.object(vision_service.vs, "add_events", lambda s, e: e),
            mock.patch.object(vision_service.vs, "update_live", lambda rows: None),
            mock.patch.object(vision_service.hs, "series_all", lambda: self.series),
            mock.patch.object(vision_service.hs, "candle_tail", tail),
            mock.patch.object(vision_service.hs, "candle_stats", lambda s, tf: (0, None, None)),
        ]
        for p in self.patches:
            p.start()
        self.svc = vision_service.VisionService(tick_fn=None)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_full_run_is_isolated_per_instrument(self):
        res = self.svc.run({s: "STARTUP" for s in vision_service.SYMBOLS})
        self.assertEqual(res["failed"], 1)
        self.assertEqual(res["analysed"], len(vision_service.SYMBOLS) - 1)
        self.assertEqual(self.svc.meta["status"], "DEGRADED")
        self.assertEqual(len(self.persisted), len(vision_service.SYMBOLS))

        eur = self.persisted["EURUSD"]["out"]
        self.assertEqual(eur["status"], "READY")
        self.assertTrue(eur["d1"]["confirmed"])
        self.assertIn(eur["primaryDirection"], BULL)
        self.assertEqual(eur["agreement"], "CONFLICT", "bearish H8 against bullish D1")
        self.assertFalse(eur["executes"])
        for k in ("phase", "channelPosition", "confidence", "evidence", "invalidation", "reasoning", "scanner"):
            self.assertIn(k, eur)
        self.assertTrue(any(e["type"] == "CHANNEL_VALIDATED" for e in self.events["EURUSD"]))

        self.assertEqual(self.persisted["AUDCAD"]["out"]["status"], "BLOCKED")
        self.assertIn("Stage 4 NEUTRAL", self.persisted["AUDCAD"]["out"]["reason"])
        self.assertEqual(self.persisted["XAUUSD"]["out"]["status"], "BLOCKED", "not ranked by the scanner")
        self.assertEqual(eur["scanner"]["evidence"], ["e"])
        self.assertEqual(eur["scanner"]["relationship"], "STRONG_VS_WEAK")
        usd = self.persisted["USDJPY"]["out"]
        self.assertEqual(usd["status"], "INSUFFICIENT_DATA")
        self.assertIn("60/120", usd["reason"])
        self.assertEqual(usd["primaryDirection"], "NEUTRAL")
        nzd = self.persisted["NZDUSD"]["out"]
        self.assertEqual(nzd["status"], "STALE")
        err = self.persisted["EURGBP"]["out"]
        self.assertEqual(err["status"], "BLOCKED")
        self.assertIn("corrupt series", err["reason"])

    def test_event_driven_triggers(self):
        self.svc.on_candles("D1", ["EURUSD"], "INCREMENTAL")
        self.svc.on_candles("H8", ["GBPJPY"], "REPAIR")
        self.svc.on_candles("H1", ["USDJPY"], "INCREMENTAL")
        self.assertEqual(self.svc._dirty, {"EURUSD": "NEW_CANDLE D1", "GBPJPY": "HISTORY_REPAIR H8"})

        captured: list[dict] = []
        with mock.patch.object(self.svc, "run", lambda dirty, *a, **k: captured.append(dict(dirty)) or {}):
            self.svc._last_full = float("inf")
            self.svc.tick()
            self.scanner["AUDCAD"] = self.pub("BULLISH", 60, 4)
            self.series[("EURUSD", "D1")] = series_row("READY", 2001, T0 + DAY)
            self.svc.tick()
        self.assertEqual(captured[-1].get("AUDCAD"), "SCANNER_QUALIFICATION_CHANGE")
        self.assertEqual(captured[-1].get("EURUSD"), "STAGE1_DATA_CHANGE")

    def _forming_bounds(self, tf="D1"):
        a = self.svc._cache["EURUSD"]["analyses"][tf]
        d = a["def"]
        base = d["anchorPrice"] + d["slope"] * (a["ageBars"] + 1)
        other = base + d["sgn"] * d["width"]
        return a, min(base, other), max(base, other)

    def test_live_boundary_approach_marks_dirty(self):
        self.svc.run({"EURUSD": "STARTUP"})
        a, lo, hi = self._forming_bounds()
        import time as _t
        ticks = {"price": (lo + hi) / 2}
        self.svc.tick_fn = lambda syms: {"EURUSD": {"bid": ticks["price"], "ask": ticks["price"], "time": int(_t.time())}}
        added: list = []
        with mock.patch.object(vision_service.vs, "add_events", lambda s, e: added.extend(e) or e):
            self.svc._live_check()
            ticks["price"] = hi - 0.02 * (hi - lo)
            self.svc._live_check()
        self.assertTrue(any(e["type"] == "BOUNDARY_APPROACH" for e in added))
        self.assertIn("EURUSD", self.svc._dirty)

    def test_stale_ticks_raise_no_live_events(self):
        self.svc.run({"EURUSD": "STARTUP"})
        a, lo, hi = self._forming_bounds()
        prices = iter([(lo + hi) / 2, hi + 5 * a["atr"]])
        self.svc.tick_fn = lambda syms: {"EURUSD": {"bid": next(prices), "ask": None, "time": T0}}
        added: list = []
        with mock.patch.object(vision_service.vs, "add_events", lambda s, e: added.extend(e) or e):
            self.svc._live_check()
            self.svc._live_check()
        self.assertFalse(any(e["type"] in ("BOUNDARY_APPROACH", "INTRABAR_BREACH") for e in added))


if __name__ == "__main__":
    unittest.main()
