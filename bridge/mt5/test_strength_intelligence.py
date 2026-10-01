from datetime import datetime, timezone
import unittest

import strength_intelligence as si


def _bars(start: float, end: float, n: int = 370):
    out = []
    base_ts = 1735689600
    for i in range(n):
        t = base_ts + i * 86400
        close = start + (end - start) * (i / max(1, n - 1))
        out.append({"time": t, "close": close})
    return out


def _fixture(up_symbol: str = "AUDUSD"):
    bars = {}
    ticks = {}
    for symbol in si.SYMBOLS:
        start, end = (1.0, 1.01)
        if symbol == up_symbol:
            start, end = (1.0, 1.20)
        if symbol == "XAUUSD":
            start, end = (2000.0, 2100.0)
        rows = _bars(start, end)
        bars[symbol] = {h: rows for h in si.HORIZONS}
        ticks[symbol] = {"mid": end, "timeRaw": rows[-1]["time"]}
    return bars, ticks


class StrengthIntelligenceTests(unittest.TestCase):
    def test_calculates_all_assets_and_horizons(self):
        bars, ticks = _fixture()
        snap = si.calculate_strength(bars, ticks, now=datetime(2026, 10, 1, tzinfo=timezone.utc))
        self.assertTrue([r["asset"] for r in snap["matrix"]])
        self.assertEqual({r["asset"] for r in snap["matrix"]}, set(si.ASSETS))
        for row in snap["matrix"]:
            self.assertEqual(set(row["values"]), set(si.HORIZONS))
            self.assertGreaterEqual(row["composite"], 0)
            self.assertLessEqual(row["composite"], 100)

    def test_base_quote_inversion_strengthens_base_and_weakens_quote(self):
        bars, ticks = _fixture("AUDUSD")
        snap = si.calculate_strength(bars, ticks, now=datetime(2026, 10, 1, tzinfo=timezone.utc))
        rows = {r["asset"]: r for r in snap["matrix"]}
        self.assertGreater(rows["AUD"]["values"]["D"], rows["USD"]["values"]["D"])

    def test_xau_uses_xauusd_and_is_ranked(self):
        bars, ticks = _fixture()
        snap = si.calculate_strength(bars, ticks, now=datetime(2026, 10, 1, tzinfo=timezone.utc))
        xau = next(r for r in snap["matrix"] if r["asset"] == "XAU")
        self.assertGreaterEqual(xau["rank"], 1)
        self.assertNotEqual(xau["values"]["YTD"], 50)

    def test_weighted_composite_and_deterministic_ranking(self):
        bars, ticks = _fixture()
        previous = {"AUD": {"composite": 50, "velocity": 0, "rank": 3}}
        snap = si.calculate_strength(bars, ticks, previous, now=datetime(2026, 10, 1, tzinfo=timezone.utc))
        aud = next(r for r in snap["matrix"] if r["asset"] == "AUD")
        expected = sum(aud["values"][h] * si.WEIGHTS[h] for h in si.HORIZONS)
        self.assertAlmostEqual(aud["composite"], expected, places=6)
        self.assertEqual(sorted(r["rank"] for r in snap["matrix"]), list(range(1, len(si.ASSETS) + 1)))

    def test_missing_pair_reduces_data_quality(self):
        bars, ticks = _fixture()
        bars.pop("AUDCAD")
        snap = si.calculate_strength(bars, ticks, now=datetime(2026, 10, 1, tzinfo=timezone.utc))
        self.assertLess(snap["quality"], 100)
        self.assertTrue(any(x.startswith("AUDCAD:") for x in snap["dataQuality"]["missing"]))


if __name__ == "__main__":
    unittest.main()

