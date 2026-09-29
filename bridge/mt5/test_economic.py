"""Economic Intelligence: mapping, surprise semantics, fail-closed gate, and persistence."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

import economic as econ
import economic_store as store
from db import connect


class Mapping(unittest.TestCase):
    def test_universe_is_28_fx_plus_gold(self):
        self.assertEqual(len(econ.FX), 28)
        self.assertEqual(len(econ.UNIVERSE), 29)
        self.assertIn("XAUUSD", econ.UNIVERSE)

    def test_usd_high_reaches_every_usd_pair_and_gold(self):
        hit = econ.affected_instruments("USD", "HIGH", "HIGH")
        self.assertIn("EURUSD", hit)
        self.assertIn("USDJPY", hit)
        self.assertIn("XAUUSD", hit)
        self.assertNotIn("EURGBP", hit)
        self.assertEqual(len(hit), 8)

    def test_usd_low_does_not_pull_gold_when_sensitivity_is_high(self):
        self.assertNotIn("XAUUSD", econ.affected_instruments("USD", "LOW", "HIGH"))

    def test_eur_covers_every_eur_pair(self):
        hit = econ.affected_instruments("EUR", "HIGH", "HIGH")
        self.assertEqual(len(hit), 7)
        self.assertTrue(all("EUR" in s for s in hit))


class Surprise(unittest.TestCase):
    def test_higher_actual_is_not_automatically_bullish_for_unemployment(self):
        out = econ.surprise("4.8", "4.3", "lower_positive")
        self.assertEqual(out["interpretation"], "NEGATIVE_FOR_CURRENCY")
        self.assertGreater(out["rawDelta"], 0)

    def test_rate_hike_above_forecast_is_positive_for_the_currency(self):
        out = econ.surprise(4.85, 4.60, "rate")
        self.assertEqual(out["interpretation"], "POSITIVE_FOR_CURRENCY")

    def test_speech_has_no_numerical_surprise(self):
        out = econ.surprise(None, None, "speech")
        self.assertFalse(out["available"])
        self.assertEqual(out["interpretation"], "UNAVAILABLE")

    def test_unchanged_rate_is_neutral(self):
        self.assertEqual(econ.surprise("4.60", "4.60", "rate")["interpretation"], "NEUTRAL")


class Sources(unittest.TestCase):
    def test_development_sample_is_not_reported_live(self):
        self.assertEqual(econ.feed_state("DEVELOPMENT"), "NOT_CONFIGURED")
        self.assertEqual(econ.feed_state("LIVE"), "LIVE")
        self.assertEqual(econ.feed_state("ERROR"), "ERROR")

    def test_delayed_calendar_is_uncertain(self):
        blocks, reason = econ.blocks_new("ALLOW", source_mode="DELAYED", enabled=True, block_on_stale=True)
        self.assertTrue(blocks)
        self.assertIn("CALENDAR_UNCERTAIN", reason)

    def test_reaction_score_does_not_invent_missing_observations(self):
        empty = econ.reaction_score(spread_ratio=None, move_pips=None, spread_threshold=2, move_threshold=12)
        self.assertFalse(empty["available"])
        self.assertIsNone(empty["score"])
        move_only = econ.reaction_score(spread_ratio=None, move_pips=12, spread_threshold=2, move_threshold=12)
        self.assertTrue(move_only["available"])
        self.assertEqual(move_only["score"], 100)


class FailClosed(unittest.TestCase):
    def test_unconfigured_source_blocks_new_entries(self):
        blocks, reason = econ.blocks_new("ALLOW", source_mode="UNCONFIGURED", enabled=True, block_on_stale=True)
        self.assertTrue(blocks)
        self.assertIn("DATA SOURCE NOT CONFIGURED", reason)

    def test_development_sample_cannot_open_the_live_gate(self):
        blocks, reason = econ.blocks_new("ALLOW", source_mode="DEVELOPMENT", enabled=True, block_on_stale=True)
        self.assertTrue(blocks)
        self.assertIn("Development sample", reason)

    def test_live_high_impact_lock_blocks(self):
        blocks, _ = econ.blocks_new("BLOCK_NEW_ENTRY", source_mode="LIVE", enabled=True, block_on_stale=True)
        self.assertTrue(blocks)

    def test_live_clear_window_allows(self):
        blocks, _ = econ.blocks_new("ALLOW", source_mode="LIVE", enabled=True, block_on_stale=True)
        self.assertFalse(blocks)

    def test_uncertain_time_restricts(self):
        now = datetime.now(timezone.utc)
        event = econ.normalize_event({
            "title": "CPI", "currency": "USD", "scheduledAt": (now + timedelta(minutes=10)).isoformat(),
            "impact": "HIGH", "timeUncertain": True,
        }, source_mode="LIVE")
        row = econ.classify_event(event, econ.DEFAULT_POLICY, now)
        self.assertEqual(row["action"], "BLOCK_NEW_ENTRY")


class StateMachine(unittest.TestCase):
    def test_high_impact_lock_inside_five_minutes(self):
        now = datetime.now(timezone.utc)
        event = econ.normalize_event({
            "title": "Non-Farm Payrolls", "currency": "USD", "impact": "HIGH",
            "scheduledAt": (now + timedelta(minutes=3)).isoformat(), "forecast": "160", "previous": "142",
        }, source_mode="LIVE")
        row = econ.classify_event(event, econ.DEFAULT_POLICY, now)
        self.assertEqual(row["state"], "EVENT_LOCK")
        self.assertEqual(len(econ.affected_instruments("USD", "HIGH", "HIGH")), 8)


class Persistence(unittest.TestCase):
    def test_revision_is_kept_when_actual_arrives(self):
        previous = store.load_policy()
        store.save_policy({**previous, "developmentSample": False})
        try:
            event = econ.normalize_event({
                "id": "test-cpi", "title": "CPI (YoY)", "currency": "USD", "impact": "HIGH",
                "scheduledAt": datetime.now(timezone.utc).isoformat(), "forecast": "2.1", "previous": "2.0",
            }, source_mode="LIVE")
            store.replace_events([event], "LIVE")
            released = {**event, "actual": "2.4", "status": "RELEASED", "surprise": econ.surprise("2.4", "2.1", "higher_positive")}
            changed = store.replace_events([released], "LIVE")
            self.assertIn("test-cpi", changed)
            saved = next(e for e in store.load_events() if e["id"] == "test-cpi")
            self.assertEqual(saved["revision"], 2)
            self.assertEqual(saved["surprise"]["interpretation"], "POSITIVE_FOR_CURRENCY")
            self.assertEqual(saved["actual"], "2.4")
            with connect() as conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM dbo.app_econ_event WHERE event_id=?", "test-cpi")
                cur.execute("DELETE FROM dbo.app_econ_revision WHERE event_id=?", "test-cpi")
                conn.commit()
        finally:
            store.save_policy(previous)


if __name__ == "__main__":
    unittest.main()
