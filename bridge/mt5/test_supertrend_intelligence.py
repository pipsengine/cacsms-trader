import unittest

import supertrend_intelligence as st


def candle(t, o, h, l, c, complete=True):
    return {"time": t, "open": o, "high": h, "low": l, "close": c, "complete": complete}


class WilderAtr(unittest.TestCase):
    def test_true_range_uses_previous_close(self):
        prev = candle(1, 10, 12, 9, 11)
        cur = candle(2, 11, 14, 10, 12)
        self.assertEqual(st.true_range(cur, prev), 4)

    def test_wilder_initialization_and_smoothing(self):
        rows = [
            candle(1, 10, 12, 9, 11),
            candle(2, 11, 13, 10, 12),
            candle(3, 12, 15, 11, 14),
            candle(4, 14, 16, 13, 15),
        ]
        values, trs = st.wilder_atr(rows, 3)
        self.assertEqual(trs[:3], [3, 3, 4])
        self.assertIsNone(values[1])
        self.assertAlmostEqual(values[2], 10 / 3)
        self.assertAlmostEqual(values[3], ((10 / 3) * 2 + 3) / 3)


class SupertrendCalculation(unittest.TestCase):
    def test_insufficient_bars_do_not_fabricate_direction(self):
        rows = [candle(i, 10 + i, 11 + i, 9 + i, 10.5 + i) for i in range(5)]
        card = st.build_card("EURUSD", "H1", rows, {"atrMultiplier": 1.0, "atrPeriod": 100, "triggerCandle": "PREVIOUS", "revision": 1}, 10_000)
        self.assertEqual(card["health"], "INSUFFICIENT_DATA")
        self.assertEqual(card["direction"], "UNKNOWN")

    def test_bullish_and_bearish_series(self):
        up = [candle(i * 1000, 100 + i, 101 + i, 99 + i, 100.8 + i) for i in range(130)]
        down = [candle(i * 1000, 200 - i, 201 - i, 199 - i, 199.2 - i) for i in range(130)]
        cfg = {"atrMultiplier": 1.0, "atrPeriod": 10, "triggerCandle": "PREVIOUS", "revision": 1}
        self.assertEqual(st.build_card("EURUSD", "H1", up, cfg, 130_000)["direction"], "UP")
        self.assertEqual(st.build_card("EURUSD", "H1", down, cfg, 130_000)["direction"], "DOWN")

    def test_live_candle_does_not_change_confirmed_state(self):
        rows = [candle(i * 1000, 100 + i * 0.1, 101 + i * 0.1, 99 + i * 0.1, 100.5 + i * 0.1) for i in range(80)]
        live = candle(81_000, 90, 120, 80, 80, complete=False)
        cfg = {"atrMultiplier": 1.0, "atrPeriod": 10, "triggerCandle": "PREVIOUS", "revision": 1}
        closed = st.build_card("EURUSD", "M15", rows, cfg, 90_000)
        with_live = st.build_card("EURUSD", "M15", [*rows, live], cfg, 90_000)
        self.assertEqual(with_live["lastClosedCandleTime"], closed["lastClosedCandleTime"])
        self.assertEqual(with_live["direction"], closed["direction"])
        self.assertFalse(with_live["candles"][-1]["complete"])
        self.assertEqual(with_live["currentPrice"], 80.0)

    def test_chart_payload_ohlc_preview_when_atr_not_ready(self):
        rows = [candle(i * 1000, 10 + i * 0.05, 11 + i * 0.05, 9 + i * 0.05, 10.4 + i * 0.05) for i in range(40)]
        cfg = {"atrMultiplier": 1.0, "atrPeriod": 100, "triggerCandle": "PREVIOUS", "revision": 1}
        card = st.build_card("EURUSD", "MN", rows, cfg, 40_000)
        self.assertEqual(card["health"], "INSUFFICIENT_DATA")
        self.assertGreater(len(card["candles"]), 0)
        self.assertTrue(card["chartProvisional"])
        self.assertTrue(any(c.get("supertrend") is not None for c in card["candles"]))
        st_count = sum(1 for c in card["candles"] if c.get("supertrend") is not None)
        self.assertGreaterEqual(st_count, 10)

    def test_chart_payload_excludes_atr_warmup_bars(self):
        rows = [candle(i * 1000, 100 + i * 0.05, 101 + i * 0.05, 99 + i * 0.05, 100.4 + i * 0.05) for i in range(130)]
        cfg = {"atrMultiplier": 1.0, "atrPeriod": 100, "triggerCandle": "PREVIOUS", "revision": 1}
        card = st.build_card("EURUSD", "W", rows, cfg, 130_000)
        self.assertTrue(len(card["candles"]) <= 80)
        self.assertTrue(all(c.get("atr") is not None for c in card["candles"]))
        self.assertTrue(all(c.get("trend") in ("UP", "DOWN") for c in card["candles"]))

    def test_live_price_overrides_last_close(self):
        rows = [candle(i * 1000, 10, 11, 9, 10.5) for i in range(120)]
        cfg = {"atrMultiplier": 1.0, "atrPeriod": 10, "triggerCandle": "PREVIOUS", "revision": 1}
        card = st.build_card("EURUSD", "H1", rows, cfg, 120_000, live_price=10.75)
        self.assertEqual(card["currentPrice"], 10.75)

    def test_config_validation(self):
        self.assertEqual(st.validate_config("0.75", "100"), (0.75, 100))
        with self.assertRaises(ValueError):
            st.validate_config("0", "100")
        with self.assertRaises(ValueError):
            st.validate_config("-1", "100")
        with self.assertRaises(ValueError):
            st.validate_config("abc", "100")


if __name__ == "__main__":
    unittest.main()

