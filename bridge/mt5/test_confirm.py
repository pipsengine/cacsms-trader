"""Stage 7 H1 Confirmation tests: deterministic H1 structures + autonomous service triggers."""

from __future__ import annotations

import copy
import time
import unittest
from datetime import datetime, timezone
from unittest import mock

import confirm
import confirm_service

NOW = time.time()
PIP = 0.0001
BASE = 1.1000
T0 = 1_700_000_000 - (1_700_000_000 % 3600)


def path(segments: list[tuple[float, int]]) -> list[float]:
    """Closes in pips from linear legs (delta_pips, bars)."""
    out, lvl = [], 0.0
    for delta, n in segments:
        for k in range(n):
            out.append(lvl + delta * (k + 1) / n)
        lvl += delta
    return out


def bars(closes_pips: list[float], mirror: bool = False, wick: float = 1.5) -> list[tuple]:
    out, prev = [], closes_pips[0]
    for i, c in enumerate(closes_pips):
        o = prev
        hi, lo = max(o, c) + wick, min(o, c) - wick
        conv = (lambda p: BASE - p * PIP) if mirror else (lambda p: BASE + p * PIP)
        oo, cc, hh, ll = conv(o), conv(c), conv(hi), conv(lo)
        if mirror:
            hh, ll = ll, hh
        out.append((T0 + i * 3600, oo, hh, ll, cc))
        prev = c
    return out


HISTORY = [(40, 10), (-20, 5)] * 22 + [(40, 10)]  # steady H1 uptrend: 40-pip impulses, 50% pullbacks; ends on a peak P


def scenario(*tail: tuple[float, int], mirror: bool = False) -> list[tuple]:
    return bars(path(HISTORY + list(tail)), mirror=mirror)


BULL_BOS = [(-20, 5), (28, 7)]                                   # 50% pullback, then close above the prior high
BULL_CHOCH = [(-44, 11), (16, 4), (-20, 5), (28, 7)]             # pullback breaks the HL (CHoCH down), LL, then CHoCH up
PULLBACK = [(-20, 5)]
SETUP_FORMING = [(-20, 5), (12, 4)]
RETEST = [(-20, 5), (28, 7), (-7, 2), (14, 3)]
FALSE_BREAK = [(-20, 5), (28, 7), (-16, 3)]
CONFLICT = [(-44, 11), (16, 4), (-8, 2)]
INVALIDATE = [(-20, 5), (12, 4), (-20, 4)]
CONSOLIDATION = [(-10, 3)] + [(3, 1), (-3, 1)] * 12
EXPIRED = [(-20, 5), (28, 7), (104, 26)]


def s6(direction: str = "BULLISH", state: str = "READY_FOR_H1", zone: str = "VALUE", phase: str = "PULLBACK",
       d1_confirmed: bool = True, confidence: float = 80, h8: float = 40, fresh: str = "CURRENT") -> dict:
    sign = 1 if "BULL" in direction else -1 if "BEAR" in direction else 0
    o = {
        "symbol": "EURUSD", "state": state, "direction": direction, "expectedDirection": direction if sign else "NEUTRAL",
        "reasonCode": "READY_PULLBACK" if state == "READY_FOR_H1" else "NEUTRAL_STRUCTURE", "reason": "test",
        "structuralPhase": phase, "alignment": "ALIGNED", "confidence": confidence, "zone": {"name": zone, "relative": 30},
        "position": {"d1": 30 if sign >= 0 else 70, "h8": h8 if sign >= 0 else 100 - h8, "price": 1.1},
        "d1": {"status": "CONFIRMED" if d1_confirmed else "NONE", "direction": direction, "confirmed": d1_confirmed},
        "h8": {"status": "CONFIRMED", "direction": direction, "confirmed": True},
        "freshness": {"status": fresh}, "invalidation": [],
    }
    o["handoff"] = {"instrument": "EURUSD"} if state == "READY_FOR_H1" else None
    return o


def series(n: int = 400, status: str = "READY") -> dict:
    return {"status": status, "reason": f"test {status}", "candle_count": n, "latest_ts": T0, "provider_exhausted": False}


def ev(b, dec=None, ser=None, **kw):
    return confirm.evaluate("EURUSD", s6(**kw) if dec is None else dec, ser or series(len(b)), b, NOW)


class Confirmation(unittest.TestCase):
    def test_bullish_bos_confirmation(self):
        o = ev(scenario(*BULL_BOS))
        self.assertEqual(o["state"], "CONFIRMED", o["reason"])
        self.assertEqual(o["gates"]["bos"]["status"], "PASS")
        self.assertEqual(o["gates"]["choch"]["status"], "N/A")
        self.assertEqual(o["gates"]["pullback"]["status"], "PASS")
        self.assertGreaterEqual(o["score"], confirm.CONFIG["confirmScore"])
        self.assertIsNotNone(o["handoff"])
        self.assertEqual(o["handoff"]["direction"], "BULLISH")
        self.assertFalse(o["handoff"]["executes"])
        self.assertLess(o["invalidationLevel"], o["h1"]["lastClose"])

    def test_bearish_confirmation_is_the_mirror(self):
        o = ev(scenario(*BULL_BOS, mirror=True), direction="BEARISH")
        self.assertEqual(o["state"], "CONFIRMED", o["reason"])
        self.assertEqual(o["setup"]["trigger"]["side"], "DOWN")
        self.assertGreater(o["invalidationLevel"], o["h1"]["lastClose"])

    def test_bullish_structure_never_confirms_a_bearish_htf(self):
        o = ev(scenario(*BULL_BOS), direction="BEARISH")
        self.assertNotEqual(o["state"], "CONFIRMED")
        self.assertIsNone(o["handoff"])

    def test_choch_confirmation_after_deep_pullback(self):
        o = ev(scenario(*BULL_CHOCH))
        self.assertEqual(o["setup"]["trigger"]["type"], "CHOCH")
        self.assertEqual(o["gates"]["choch"]["status"], "PASS")
        self.assertEqual(o["state"], "CONFIRMED", o["reason"])

    def test_pullback_in_progress(self):
        o = ev(scenario(*PULLBACK))
        self.assertEqual(o["state"], "PULLBACK", o["reason"])
        self.assertEqual(o["setup"]["pullback"], "IN_PROGRESS")
        self.assertEqual(o["gates"]["pullback"]["status"], "WAIT")

    def test_setup_forming_awaits_break(self):
        o = ev(scenario(*SETUP_FORMING))
        self.assertEqual(o["state"], "SETUP_FORMING", o["reason"])
        self.assertEqual(o["reasonCode"], "AWAITING_H1_BREAK")
        self.assertEqual(o["setup"]["pullback"], "HOLDING")

    def test_breakout_retest_model(self):
        o = ev(scenario(*RETEST), phase="RETEST", zone="EXTENDED")
        self.assertEqual(o["setup"]["model"], "BREAKOUT_RETEST")
        self.assertEqual(o["gates"]["retest"]["status"], "PASS")
        self.assertEqual(o["gates"]["location"]["status"], "PASS")
        self.assertEqual(o["state"], "CONFIRMED", o["reason"])
        self.assertEqual(o["reasonCode"], "CONFIRMED_RETEST")

    def test_false_breakout_rejected(self):
        o = ev(scenario(*FALSE_BREAK))
        self.assertEqual(o["state"], "REJECTED", o["reason"])
        self.assertEqual(o["reasonCode"], "FALSE_BREAKOUT")
        self.assertEqual(o["gates"]["retest"]["status"], "FAIL")

    def test_continuation_trigger_expires(self):
        o = ev(scenario(*EXPIRED))
        self.assertEqual(o["state"], "MONITORING", o["reason"])
        self.assertIn("expired", o["reason"])

    def test_consolidation(self):
        o = ev(scenario(*CONSOLIDATION))
        self.assertEqual(o["phase"], "CONSOLIDATION")
        self.assertNotEqual(o["state"], "CONFIRMED")

    def test_htf_h1_conflict(self):
        o = ev(scenario(*CONFLICT))
        self.assertNotEqual(o["state"], "CONFIRMED")
        self.assertEqual(o["reasonCode"], "H1_OPPOSES_HTF", o["reason"])
        self.assertEqual(o["gates"]["h1Structure"]["status"], "WAIT")

    def test_invalidation(self):
        o = ev(scenario(*INVALIDATE))
        self.assertEqual(o["state"], "INVALIDATED", o["reason"])
        self.assertEqual(o["gates"]["invalidation"]["status"], "FAIL")

    def test_poor_upper_channel_location_rejected(self):
        o = ev(scenario(*BULL_BOS), zone="EXTENDED", phase="PULLBACK")
        self.assertEqual(o["state"], "REJECTED")
        self.assertEqual(o["reasonCode"], "POOR_ENTRY_LOCATION")

    def test_h8_boundary_overhead_waits(self):
        o = ev(scenario(*BULL_BOS), h8=95)
        self.assertEqual(o["gates"]["location"]["status"], "WAIT")
        self.assertNotEqual(o["state"], "CONFIRMED")

    def test_missing_channel_blocks(self):
        o = ev(scenario(*BULL_BOS), d1_confirmed=False)
        self.assertEqual(o["state"], "BLOCKED")
        self.assertEqual(o["reasonCode"], "MISSING_CHANNEL_EVIDENCE")

    def test_insufficient_history_warms_up(self):
        b = scenario(*BULL_BOS)[-120:]
        o = ev(b, ser=series(120, "SYNCING"))
        self.assertEqual(o["state"], "WARMING_UP")
        self.assertEqual(o["reasonCode"], "INSUFFICIENT_H1_HISTORY")
        self.assertEqual(o["gates"]["freshness"]["status"], "WAIT")

    def test_stale_h1_data(self):
        b = scenario(*BULL_BOS)
        o = ev(b, ser=series(len(b), "STALE"))
        self.assertEqual(o["state"], "STALE")
        self.assertEqual(o["gates"]["freshness"]["status"], "STALE")
        self.assertIsNone(o["handoff"])

    def test_provider_offline_blocks(self):
        b = scenario(*BULL_BOS)
        o = ev(b, ser=series(len(b), "PROVIDER_OFFLINE"))
        self.assertEqual(o["state"], "BLOCKED")

    def test_stage6_neutral_or_not_ready_never_confirms(self):
        b = scenario(*BULL_BOS)
        for dec, want in ((s6(direction="NEUTRAL", state="WAITING"), "WAITING_FOR_STAGE6"),
                          (s6(state="BLOCKED"), "BLOCKED"), (s6(state="CONFLICT"), "BLOCKED"),
                          (s6(state="INVALIDATED"), "INVALIDATED"), (s6(state="STALE"), "STALE"),
                          (s6(state="ALIGNED"), "WAITING_FOR_STAGE6")):
            o = ev(b, dec=dec)
            self.assertEqual(o["state"], want, dec["state"])
            self.assertFalse(o["confirmed"])
            self.assertIn(dec["state"], o["reason"])
        o = confirm.evaluate("EURUSD", None, series(), b, NOW)
        self.assertEqual(o["state"], "WAITING_FOR_STAGE6")

    def test_stage6_stale_freshness_blocks_promotion(self):
        o = ev(scenario(*BULL_BOS), fresh="STALE")
        self.assertEqual(o["state"], "STALE")

    def test_checklist_has_every_gate_and_valid_statuses(self):
        o = ev(scenario(*PULLBACK))
        self.assertEqual([g for g, _ in confirm.GATE_ORDER], list(o["gates"]))
        for g in o["gates"].values():
            self.assertIn(g["status"], confirm.GATE_STATUSES)

    def test_score_is_evidence_weighted(self):
        o = ev(scenario(*BULL_BOS))
        self.assertAlmostEqual(o["score"], round(max(0, min(100, sum(c["points"] for c in o["components"]))), 1))
        weak = ev(scenario(*BULL_BOS), confidence=45)
        self.assertLess(weak["score"], o["score"])

    def test_no_lookahead_events_use_closed_bars_only(self):
        b = scenario(*BULL_BOS)
        full = confirm.analyse_h1(b)
        cut = confirm.analyse_h1(b[:-1])
        self.assertEqual([e["ts"] for e in full["events"] if e["ts"] <= b[-2][0]][-3:], [e["ts"] for e in cut["events"]][-3:])

    def test_intrabar_events_annotate_without_confirming(self):
        b = scenario(*SETUP_FORMING)
        dec = s6()
        base = confirm.evaluate("EURUSD", dec, series(len(b)), b, NOW)
        hi = base["h1"]["activeHigh"]
        o = confirm.evaluate("EURUSD", dec, series(len(b)), b, NOW, live={"price": hi + 5 * PIP, "time": T0})
        self.assertEqual(o["live"]["event"], "BOS_ATTEMPT")
        self.assertEqual(o["state"], base["state"])
        o = confirm.evaluate("EURUSD", dec, series(len(b)), b, NOW, live={"price": base["invalidationLevel"] - 5 * PIP, "time": T0})
        self.assertEqual(o["live"]["event"], "INVALIDATION_BREACH")

    def test_extended_breakout_is_not_an_immediate_entry(self):
        o = ev(scenario(*[(-20, 5), (12, 3), (40, 1)]))
        self.assertEqual(o["state"], "BREAKOUT_CONFIRMED_WAIT_RETEST", o["reason"])
        self.assertEqual(o["entry"]["timing"], "WAIT_RETEST")
        self.assertEqual(o["entry"]["classification"], "EXTENDED")
        self.assertFalse(o["confirmed"])
        self.assertIsNone(o["handoff"])
        self.assertGreaterEqual(o["entry"]["extensionATR"], 2.5)

    def test_bearish_extension_is_the_mirror(self):
        o = ev(scenario(*[(-20, 5), (12, 3), (40, 1)], mirror=True), direction="BEARISH")
        self.assertEqual(o["state"], "BREAKOUT_CONFIRMED_WAIT_RETEST", o["reason"])
        self.assertIsNone(o["handoff"])
        self.assertEqual(o["entry"]["timing"], "WAIT_RETEST")

    def test_new_pullback_discards_the_previous_break(self):
        o = ev(scenario(*BULL_BOS, (-30, 8)))
        self.assertNotEqual(o["state"], "CONFIRMED", o["reason"])
        self.assertIsNone(o["handoff"])
        self.assertNotEqual(o["entry"]["timing"], "ENTER_NOW")

    def test_reconnect_does_not_execute_an_old_break(self):
        b = scenario(*[(-20, 5), (12, 3), (20, 1), (8, 1)])
        fresh = confirm.evaluate("EURUSD", s6(), series(len(b)), b, NOW)
        self.assertTrue(fresh["confirmed"], fresh["reason"])
        o = confirm.evaluate("EURUSD", s6(), series(len(b)), b, NOW, missed_bars=3)
        self.assertFalse(o["confirmed"], o["reason"])
        self.assertIsNone(o["handoff"])
        self.assertEqual(o["reasonCode"], "MISSED_CONFIRMATION")
        self.assertEqual(o["entry"]["timing"], "WAIT_NEW_CONFIRMATION")

    def test_breakout_is_not_the_same_as_entry_across_regimes(self):
        """Structural confirmation and immediate entry are counted separately. One path must not define the rule."""
        regimes = [
            ("value", [(-20, 5), (12, 3), (20, 1)], s6(), False),
            ("extended", [(-20, 5), (12, 3), (40, 1)], s6(), False),
            ("retest", RETEST, s6(phase="RETEST", zone="EXTENDED"), False),
            ("false", FALSE_BREAK, s6(), True),
        ]
        immediate = wait = failed = 0
        for name, tail, dec, false_break in regimes:
            bars_ = scenario(*(FALSE_BREAK if false_break else tail))
            o = ev(bars_, dec=dec)
            if o["confirmed"]:
                immediate += 1
            elif o["state"] == "BREAKOUT_CONFIRMED_WAIT_RETEST":
                wait += 1
            elif o["state"] in ("REJECTED", "INVALIDATED"):
                failed += 1
            if o["confirmed"]:
                self.assertIn(o["entry"]["timing"], ("ENTER_NOW", "RETEST_CONFIRMED"))
            if o["state"] == "BREAKOUT_CONFIRMED_WAIT_RETEST":
                self.assertIsNone(o["handoff"])
        self.assertGreaterEqual(immediate, 1)
        self.assertGreaterEqual(wait, 1)
        self.assertGreaterEqual(failed, 1)


def iso(offset: float = 0) -> str:
    return datetime.fromtimestamp(NOW + offset, timezone.utc).isoformat()


class AutonomousService(unittest.TestCase):
    def setUp(self):
        self.bars = scenario(*SETUP_FORMING)
        self.up = {
            "direction": {"EURUSD": s6(), "GBPUSD": {**s6(direction="NEUTRAL", state="BLOCKED"), "symbol": "GBPUSD"}},
            "directionRun": {"status": "HEALTHY", "runAt": iso(-20), "readyNow": ["EURUSD"]},
            "series": {"EURUSD": series(len(self.bars)), "GBPUSD": series()},
        }
        self.persisted: list = []
        self.confirm_calls: list = []
        self.reads: list = []
        self.ticks: dict = {}
        self.patches = [
            mock.patch.object(confirm_service.cs, "upstream", lambda: copy.deepcopy(self.up)),
            mock.patch.object(confirm_service.cs, "h1_bars", lambda s, n: self.reads.append(s) or list(self.bars)),
            mock.patch.object(confirm_service.cs, "persist",
                              lambda rows, ch, meta, trig: self.persisted.append((rows, ch, trig)) or (len(self.persisted) if ch else None)),
            mock.patch.object(confirm_service.cs, "save_meta", lambda m: None),
            mock.patch.object(confirm_service.cs, "previous_decisions", lambda: {}),
            mock.patch.object(confirm_service, "SYMBOLS", ["EURUSD", "GBPUSD"]),
        ]
        for p in self.patches:
            p.start()
        self.svc = confirm_service.ConfirmService(lambda syms: {s: self.ticks[s] for s in syms if s in self.ticks},
                                                  on_confirm_change=self.confirm_calls.append)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def by(self, rows):
        return {r["symbol"]: r for r in rows}

    def test_startup_evaluates_only_stage6_candidates(self):
        self.svc.mark("STARTUP")
        self.svc.tick()
        rows = self.by(self.persisted[-1][0])
        self.assertEqual(rows["EURUSD"]["state"], "SETUP_FORMING")
        self.assertEqual(rows["GBPUSD"]["state"], "BLOCKED")
        self.assertEqual(self.reads, ["EURUSD"])
        c = confirm.counters(self.persisted[-1][0])
        self.assertEqual((c["universe"], c["candidates"], c["monitoring"]), (2, 1, 1))

    def test_idle_tick_does_not_run(self):
        self.svc.mark("STARTUP")
        self.svc.tick()
        n = len(self.persisted)
        self.assertFalse(self.svc.tick()["ran"])
        self.assertEqual(len(self.persisted), n)

    def test_new_h1_candle_triggers_confirmation(self):
        self.svc.mark("STARTUP")
        self.svc.tick()
        self.bars = scenario(*BULL_BOS)
        self.up["series"]["EURUSD"] = {**series(len(self.bars)), "latest_ts": T0 + 3600}
        r = self.svc.tick()
        self.assertIn("NEW_CANDLE H1", r["triggers"])
        self.assertEqual(self.by(self.persisted[-1][0])["EURUSD"]["state"], "CONFIRMED")
        self.assertEqual(self.confirm_calls[-1], ["EURUSD"])

    def test_stage6_change_retriggers_and_fails_closed(self):
        self.bars = scenario(*BULL_BOS)
        self.svc.mark("STARTUP")
        self.svc.tick()
        self.assertEqual(self.by(self.persisted[-1][0])["EURUSD"]["state"], "CONFIRMED")
        self.up["direction"]["EURUSD"] = s6(state="INVALIDATED")
        r = self.svc.tick()
        self.assertTrue(any(t.startswith("STAGE6_DECISION_CHANGE") for t in r["triggers"]))
        row = self.by(self.persisted[-1][0])["EURUSD"]
        self.assertEqual(row["state"], "INVALIDATED")
        self.assertIsNone(row["handoff"])
        self.assertEqual(self.confirm_calls[-1], ["EURUSD"])

    def test_freshness_change_triggers(self):
        self.svc.mark("STARTUP")
        self.svc.tick()
        self.up["series"]["EURUSD"]["status"] = "STALE"
        r = self.svc.tick()
        self.assertTrue(any(t.startswith("FRESHNESS_CHANGE") for t in r["triggers"]))
        self.assertEqual(self.by(self.persisted[-1][0])["EURUSD"]["state"], "STALE")

    def test_intrabar_bos_attempt_triggers(self):
        self.svc.mark("STARTUP")
        self.svc.tick()
        hi = self.by(self.persisted[-1][0])["EURUSD"]["h1"]["activeHigh"]
        self.ticks["EURUSD"] = {"bid": hi + 4 * PIP, "ask": hi + 5 * PIP, "time": int(NOW)}
        r = self.svc.tick()
        self.assertIn("INTRABAR_BOS_ATTEMPT EURUSD", r["triggers"])
        row = self.by(self.persisted[-1][0])["EURUSD"]
        self.assertEqual(row["live"]["event"], "BOS_ATTEMPT")
        self.assertEqual(row["state"], "SETUP_FORMING")

    def test_stale_stage6_run_blocks_promotion(self):
        self.bars = scenario(*BULL_BOS)
        self.up["directionRun"]["runAt"] = iso(-4000)
        self.svc.mark("STARTUP")
        self.svc.tick()
        row = self.by(self.persisted[-1][0])["EURUSD"]
        self.assertEqual(row["state"], "STALE")
        self.assertFalse(row["confirmed"])

    def test_on_candles_marks_only_h1(self):
        self.svc.on_candles("D1", ["EURUSD"])
        self.assertEqual(self.svc._pending, set())
        self.svc.on_candles("H1", ["EURUSD"])
        self.assertEqual(self.svc._pending, {"NEW_CANDLE H1"})


if __name__ == "__main__":
    unittest.main()
