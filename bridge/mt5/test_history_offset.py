"""Server-offset learning must not trust tick drift while the market is closed.

Run from bridge/mt5:  python -m unittest test_history_offset -v
"""

from __future__ import annotations

import calendar
import unittest
from unittest import mock

import history

FRI_LAST_TICK_SERVER = calendar.timegm((2026, 9, 25, 23, 56, 59))  # UTC+3 server, Friday close
SUNDAY_NOW_UTC = calendar.timegm((2026, 9, 27, 12, 59, 30))
MONDAY_NOW_UTC = calendar.timegm((2026, 9, 28, 9, 0, 0))


class FakeProvider:
    def __init__(self, t):
        self.t = t

    def tick_times(self, symbols):
        return {s: self.t for s in symbols}


class ServerOffset(unittest.TestCase):
    def test_weekend_drift_is_ignored(self):
        svc = history.HistoryService(FakeProvider(FRI_LAST_TICK_SERVER))
        svc.server_offset = -133200  # bogus value learned from a closed-market drift
        with mock.patch.object(history.time, "time", lambda: SUNDAY_NOW_UTC + 0.0), \
                mock.patch.object(history, "fx_market_open", lambda now: False), \
                mock.patch.object(history, "set_setting") as saved:
            svc._learn_offset()
        self.assertEqual(svc.server_offset, 3 * 3600)
        self.assertTrue(svc.offset_source.startswith("NY-close"))
        saved.assert_not_called()

    def test_live_ticks_learn_offset_when_open(self):
        svc = history.HistoryService(FakeProvider(MONDAY_NOW_UTC + 3 * 3600 - 2))
        with mock.patch.object(history.time, "time", lambda: MONDAY_NOW_UTC + 0.0), \
                mock.patch.object(history, "fx_market_open", lambda now: True), \
                mock.patch.object(history, "set_setting") as saved:
            svc._learn_offset()
        self.assertEqual(svc.server_offset, 3 * 3600)
        self.assertEqual(svc.offset_source, "live ticks")
        saved.assert_called_once()

    def test_plausibility(self):
        self.assertTrue(history.plausible_offset(10800))
        self.assertFalse(history.plausible_offset(-133200))


if __name__ == "__main__":
    unittest.main()
