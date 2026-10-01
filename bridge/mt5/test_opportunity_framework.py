"""Opportunity classification & confirmation framework.

OP-01 acceptance: a valid channel, a boundary touch, a directional reaction on closed bars and room to target reach
READY_FOR_RISK without BOS, without CHoCH and without a channel break — bullish and bearish. The remaining tests cover
the detector states, identity / duplicate suppression, the contract matrix, the other opportunity types, relationships,
shadow isolation, Stage 9 idempotency keys, Stage 10 typing, notification defaults and persistence.
"""

from __future__ import annotations

import copy
import math
import os
import tempfile
import unittest
from pathlib import Path

_fd, _path = tempfile.mkstemp(prefix="cacsms-oppfw-", suffix=".db")
os.close(_fd)
os.environ["DATABASE_URL"] = "file:" + str(Path(_path))

import sqlite_db  # noqa: E402

sqlite_db._schema_ready = False

import boundary_reaction as br  # noqa: E402
import campaign  # noqa: E402
import channel_analysis as ca  # noqa: E402
import learning  # noqa: E402
import notification_policy as policy  # noqa: E402
import opportunity_framework as fw  # noqa: E402
import opportunity_framework_store as fstore  # noqa: E402
import opportunity_types as ot  # noqa: E402
import risk  # noqa: E402

H = 3600
T0 = 1_780_000_000 - (1_780_000_000 % H)
SLOPE, WIDTH, PATR = 0.00001, 0.0100, 0.0016
P0 = 1.1050  # mirror axis for the bearish fixture


def lower(i: int) -> float:
    return 1.1000 + SLOPE * i


def bull_bars(end: int = 94, rally=(0.0010, 0.0012, 0.0013, 0.0014, 0.0015), touch_low: float = -0.0002) -> list[tuple]:
    """Pre-phase near the upper region, a monotone decline into the lower boundary, a touch at bar 90, a modest rally."""
    bars: list[tuple] = []
    for i in range(60):
        mid = lower(i) + 0.0088 + 0.0004 * math.sin(i * 0.8)
        bars.append((T0 + i * H, mid - 0.0001, mid + 0.0003, mid - 0.0003, mid + 0.0001))
    for k, i in enumerate(range(60, 90)):
        c = lower(i) + 0.0085 - (0.0085 - 0.0013) * k / 29
        o = c + 0.00025
        bars.append((T0 + i * H, o, o + 0.0001, c - 0.0001, c))
    lo90 = lower(90)
    bars.append((T0 + 90 * H, lo90 + 0.0007, lo90 + 0.0012, lo90 + touch_low, lo90 + rally[0]))
    for k, i in enumerate(range(91, end + 1)):
        c = lower(i) + rally[k + 1]
        o = c - 0.00015
        bars.append((T0 + i * H, o, c + 0.0001, o - 0.0001, c))
    return bars


def mirror(bars: list[tuple]) -> list[tuple]:
    m = lambda p: 2 * P0 - p  # noqa: E731
    return [(b[0], m(b[1]), m(b[3]), m(b[2]), m(b[4])) for b in bars]


def lines_for(bars: list[tuple], sign: int = 1) -> list[tuple[float, float]]:
    out = []
    for b in bars:
        i = (int(b[0]) - T0) // H
        lo, up = lower(i), lower(i) + WIDTH
        out.append((lo, up) if sign > 0 else (2 * P0 - up, 2 * P0 - lo))
    return out


def definition(sign: int = 1) -> dict:
    if sign > 0:
        return {"anchorTs": T0, "anchorPrice": 1.1000, "slope": SLOPE, "sgn": 1, "width": WIDTH}
    return {"anchorTs": T0, "anchorPrice": 2 * P0 - 1.1000, "slope": -SLOPE, "sgn": -1, "width": WIDTH}


class Src:
    """Stand-in for LiveSource: H1 bars, a D1 snapshot, and parent bars that coincide with the H1 bars (lines step per bar)."""

    def __init__(self, bars: list[tuple], snaps: dict, symbol: str = "EURUSD"):
        self.h1, self.snaps, self.symbol = bars, snaps, symbol

    def snapshots(self, symbols):
        return {self.symbol: self.snaps}

    def bars(self, symbol, tf, n):
        return list(self.h1[-n:]) if tf == "H1" else []

    def parent_ts(self, symbol, tf, from_ts, last_ts=None):
        return [int(b[0]) for b in self.h1]


def scene(sign: int = 1, bars: list[tuple] | None = None, *, status: str = "ACTIVE", econ: dict | None = None, now_lag: int = 10,
          symbol: str = "EURUSD"):
    bars = bars if bars is not None else (bull_bars() if sign > 0 else mirror(bull_bars()))
    last = lines_for(bars[-1:], sign)[0]
    pos = (float(bars[-1][4]) - last[0]) / (last[1] - last[0]) * 100
    d1 = {"timeframe": "D1", "channelId": f"{symbol}-D1-1", "status": status, "direction": "BULLISH" if sign > 0 else "BEARISH",
          "phase": "CONTINUATION", "confidence": 80.0, "position": round(pos, 1), "upper": last[1], "lower": last[0],
          "mid": (last[0] + last[1]) / 2, "dataStatus": "READY", "lastBarTs": int(bars[-1][0]), "definition": definition(sign),
          "atr": PATR, "structure": [], "breakout": None, "events": []}
    now = int(bars[-1][0]) + H + now_lag
    econ_map = econ if econ is not None else {symbol: {"blocks": False, "state": "NORMAL", "code": "OK"}}
    return Src(bars, {"D1": d1}, symbol), {symbol: {"D1": {k: d1[k] for k in ("channelId", "status", "direction", "position", "upper", "lower", "mid", "lastBarTs", "atr")}}}, econ_map, now


def build(sign: int = 1, bars=None, legacy=None, **kw):
    src, channels, econ, now = scene(sign, bars, **{k: v for k, v in kw.items() if k in ("status", "econ", "now_lag", "symbol")})
    symbol = kw.get("symbol", "EURUSD")
    return fw.build([symbol], channels, legacy or {"instruments": [], "qualified": []}, src, econ=econ, now=now)


def op01(state: dict) -> dict | None:
    return next((h for h in state["hypotheses"] if h["route"] == "OP-01:BOUNDARY_REACTION"), None)


class OP01Acceptance(unittest.TestCase):
    def _accept(self, sign: int) -> dict:
        state = build(sign)
        h = op01(state)
        self.assertIsNotNone(h, state["summary"])
        self.assertEqual(h["detectorState"], "REACTION_CONFIRMED")
        self.assertEqual(h["confirmationState"], ot.CONFIRMED)
        self.assertEqual(h["lifecycle"], "READY_FOR_RISK", h["whyNotReady"])
        self.assertEqual(h["direction"], "BULLISH" if sign > 0 else "BEARISH")
        # No BOS, no CHoCH, no channel break — and none of them is required.
        self.assertFalse(h["evidence"]["BOS"])
        self.assertFalse(h["evidence"]["CHOCH"])
        self.assertFalse(h["evidence"]["CHANNEL_BREAK"])
        self.assertNotIn("BOS", h["requiredEvidence"])
        self.assertNotIn("CHOCH", h["requiredEvidence"])
        src_bars = bull_bars() if sign > 0 else mirror(bull_bars())
        events = ca.structure_events("H1", src_bars, limit=60)
        touch = h["detail"]["reaction"]["touch"]["ts"]
        self.assertFalse(any(e["kind"] in ("BOS", "CHOCH") and fw._sign(e["direction"]) == sign and e["ts"] >= touch for e in events))
        room = h["room"]
        self.assertTrue(room["ok"])
        self.assertGreaterEqual(room["rewardRisk"], room["minRR"])
        self.assertEqual(h["mode"], "SHADOW")
        self.assertEqual(h["stages"]["9"]["status"], "NOT_ELIGIBLE")
        self.assertEqual(len(state["shadowHandoffs"]), 1)
        self.assertFalse(state["shadowHandoffs"][0]["executable"])
        return h

    def test_bullish_ready_for_risk_without_bos_choch_or_break(self):
        h = self._accept(1)
        self.assertLess(h["room"]["invalidation"], h["room"]["entry"])
        self.assertGreater(h["room"]["target"], h["room"]["entry"])

    def test_bearish_ready_for_risk_without_bos_choch_or_break(self):
        h = self._accept(-1)
        self.assertGreater(h["room"]["invalidation"], h["room"]["entry"])
        self.assertLess(h["room"]["target"], h["room"]["entry"])

    def test_bullish_and_bearish_are_symmetric(self):
        b, s = op01(build(1)), op01(build(-1))
        self.assertEqual(b["room"]["rewardRisk"], s["room"]["rewardRisk"])
        self.assertEqual(b["detail"]["reaction"]["signals"], s["detail"]["reaction"]["signals"])
        self.assertEqual(b["entryQuality"], s["entryQuality"])
        self.assertEqual(b["detail"]["reaction"]["position"], s["detail"]["reaction"]["position"])


class BoundaryDetector(unittest.TestCase):
    def detect(self, bars, sign=1, now_lag=10, **kw):
        return br.detect(bars, lines_for(bars, sign), sign, parent_atr=PATR, tf_sec=H, now_ts=int(bars[-1][0]) + H + now_lag, **kw)

    def test_touch_on_latest_bar_is_not_a_reaction(self):
        bars = bull_bars(end=90, rally=(0.0001,))
        d = self.detect(bars)
        self.assertEqual(d["state"], "BOUNDARY_TOUCH")
        h = op01(build(1, bars))
        self.assertEqual(h["lifecycle"], "TRIGGER_REACHED")
        self.assertIn("REACTION", h["missingEvidence"])

    def test_touch_without_reaction_waits(self):
        flat = bull_bars(end=93, rally=(0.0003, 0.0003, 0.0003, 0.0003))
        d = self.detect(flat)
        self.assertIn(d["state"], ("REACTION_PENDING", "REACTION_DETECTED"))
        h = op01(build(1, flat))
        self.assertNotEqual(h["lifecycle"], "READY_FOR_RISK")
        self.assertIn("REACTION", h["missingEvidence"])

    def test_penetration_and_recovery(self):
        d = self.detect(bull_bars(touch_low=-0.0005))
        self.assertEqual(d["contact"], "BOUNDARY_PENETRATION")
        self.assertEqual(d["state"], "REACTION_CONFIRMED")

    def test_boundary_break_invalidates(self):
        bars = bull_bars(end=91, rally=(0.0002, -0.0009))
        d = self.detect(bars)
        self.assertEqual(d["state"], "BOUNDARY_BROKEN")
        h = op01(build(1, bars))
        self.assertEqual(h["lifecycle"], "INVALIDATED")
        self.assertIn("broke", h["invalidationReason"])

    def test_stale_data_never_ready(self):
        h = op01(build(1, now_lag=10 * H))
        self.assertEqual(h["confirmationState"], ot.STALE)
        self.assertEqual(h["lifecycle"], "WAITING")

    def test_insufficient_history(self):
        d = self.detect(bull_bars()[-20:])
        self.assertEqual(d["state"], "INSUFFICIENT_HISTORY")

    def test_no_lookahead_confirmation_appears_on_its_bar(self):
        bars = bull_bars()
        full = self.detect(bars)
        self.assertEqual(full["confirmedAt"], int(bars[93][0]))
        before = self.detect(bars[:93])  # through bar 92
        self.assertNotEqual(before["state"], "REACTION_CONFIRMED")
        prefix = self.detect(bars[:94])  # through bar 93
        self.assertEqual(prefix["state"], "REACTION_CONFIRMED")
        self.assertEqual(prefix["confirmedAt"], full["confirmedAt"])
        self.assertEqual(prefix["touch"], full["touch"])

    def test_midline_requires_prior_outer_visit(self):
        bars = [(T0 + i * H, lower(i) + 0.004, lower(i) + 0.0045, lower(i) + 0.0035, lower(i) + 0.004) for i in range(80)]
        d = br.detect(bars, lines_for(bars), 1, parent_atr=PATR, mode="MIDLINE", tf_sec=H, now_ts=int(bars[-1][0]) + H)
        self.assertEqual(d["state"], "NO_PRIOR_IMPULSE")

    def test_midline_pullback_to_outer_boundary_is_op01_not_op02(self):
        d = br.detect(bull_bars(), lines_for(bull_bars()), 1, parent_atr=PATR, mode="MIDLINE", tf_sec=H, now_ts=int(bull_bars()[-1][0]) + H)
        self.assertEqual(d["state"], "OUTER_BOUNDARY_REACHED")


class Identity(unittest.TestCase):
    def test_duplicate_scan_same_identity(self):
        a, b = op01(build(1)), op01(build(1))
        self.assertEqual(a["opportunityId"], b["opportunityId"])
        self.assertEqual(a["episodeId"], b["episodeId"])
        self.assertEqual(a["revision"], b["revision"])

    def test_next_bar_keeps_identity(self):
        a = op01(build(1, bull_bars(end=94)))
        b = op01(build(1, bull_bars(end=95, rally=(0.0010, 0.0012, 0.0013, 0.0014, 0.0015, 0.0016))))
        self.assertEqual(a["opportunityId"], b["opportunityId"])
        self.assertEqual(a["episodeId"], b["episodeId"])

    def test_second_episode_after_midline_reset(self):
        first = bull_bars()
        bars = list(first)
        for k, i in enumerate(range(95, 115)):  # rally through the midline
            c = lower(i) + 0.0015 + 0.0004 * (k + 1)
            bars.append((T0 + i * H, c - 0.0003, c + 0.0001, c - 0.0004, c))
        top = float(bars[-1][4]) - lower(114)
        for k, i in enumerate(range(115, 140)):  # decline back to the boundary
            c = lower(i) + top - (top - 0.0013) * k / 24
            o = c + 0.0003
            bars.append((T0 + i * H, o, o + 0.0001, c - 0.0001, c))
        lo = lower(140)
        bars.append((T0 + 140 * H, lo + 0.0007, lo + 0.0012, lo - 0.0002, lo + 0.0010))
        for k, i in enumerate(range(141, 145)):
            c = lower(i) + (0.0012, 0.0013, 0.0014, 0.0015)[k]
            bars.append((T0 + i * H, c - 0.00015, c + 0.0001, c - 0.00025, c))
        a, b = op01(build(1, first)), op01(build(1, bars))
        self.assertIsNotNone(b)
        self.assertNotEqual(a["opportunityId"], b["opportunityId"])
        self.assertNotEqual(a["episodeId"], b["episodeId"])
        self.assertEqual(b["detail"]["reaction"]["touch"]["ts"], T0 + 140 * H)


class Contracts(unittest.TestCase):
    def test_every_type_has_one_contract(self):
        m = ot.matrix()
        self.assertEqual([c["opportunityType"] for c in m["contracts"]], [f"OP-{i:02d}" for i in range(1, 13)])
        self.assertEqual(m["contexts"], ["POST_EVENT"])

    def test_op01_does_not_require_structure_breaks(self):
        c = ot.contract("OP-01")
        for key in ("BOS", "CHOCH", "CHANNEL_BREAK", "RETEST"):
            self.assertIn(key, c["notRequired"])
        self.assertIn("REACTION", c["requiredEvidence"])
        self.assertIn("ROOM", c["requiredEvidence"])

    def test_legacy_variant_keeps_bos_gate(self):
        r = ot.evaluate("OP-01", {"CHANNEL_VALID": True, "DIRECTION_ALIGNED": True, "EXECUTION_CONFIRMATION": True, "BOS_OR_CHOCH": False,
                                   "FRESH_DATA": True}, variant="LEGACY_H1")
        self.assertEqual(r["result"], ot.WAITING_FOR_REQUIRED_EVIDENCE)
        self.assertEqual(r["missingEvidence"], ["BOS_OR_CHOCH"])
        self.assertEqual(r["contractId"], "OP-01:LEGACY_H1@c1")

    def test_op02_needs_confluence(self):
        ev = {"CHANNEL_VALID": True, "DIRECTION_ALIGNED": True, "REACTION_STRONG": True, "ROOM": True, "ENTRY_QUALITY": True, "FRESH_DATA": True,
              "INTERNAL_CONFLUENCE": False}
        self.assertEqual(ot.evaluate("OP-02", ev)["missingEvidence"], ["INTERNAL_CONFLUENCE"])
        self.assertTrue(ot.evaluate("OP-02", {**ev, "INTERNAL_CONFLUENCE": True, "REJECTION_WICK": True})["confirmed"])

    def test_op10_needs_more_than_one_countertrend_move(self):
        r = ot.evaluate("OP-10", {"TREND_DETERIORATION": True, "CHOCH": True, "OPPOSITE_BOS": False, "REVERSAL_CONFIRMATION": False,
                                  "ROOM": True, "FRESH_DATA": True})
        self.assertEqual(set(r["missingEvidence"]), {"OPPOSITE_BOS", "REVERSAL_CONFIRMATION"})

    def test_op11_range_break_incompatible(self):
        r = ot.evaluate("OP-11", {"RANGE_VALID": True, "BOUNDARY_ZONE_REACHED": True, "BOUNDARY_HOLDING": True, "REACTION": True, "ROOM": True,
                                  "FRESH_DATA": True, "RANGE_BREAK": True})
        self.assertEqual(r["result"], ot.INVALIDATED)

    def test_optional_evidence_missing_still_confirms(self):
        r = ot.evaluate("OP-01", {k: True for k in ("CHANNEL_VALID", "DIRECTION_ALIGNED", "BOUNDARY_ZONE_REACHED", "BOUNDARY_HOLDING",
                                                    "REACTION", "ROOM", "FRESH_DATA")})
        self.assertEqual(r["result"], ot.OPTIONAL_EVIDENCE_MISSING)
        self.assertTrue(r["confirmed"])

    def test_new_routes_start_in_shadow_and_weights_neutral(self):
        for route in ("OP-01:BOUNDARY_REACTION", "OP-02:INTERNAL_REACTION", "OP-08:STRUCTURE", "OP-09:BREAKOUT_SCANNER", "OP-10:REVERSAL",
                      "OP-11:RANGE_REACTION", "OP-12:BREAKOUT_SCANNER"):
            self.assertEqual(ot.ROUTES[route]["mode"], "SHADOW")
        self.assertEqual(ot.ROUTES["OP-01:LEGACY_H1"]["mode"], "PRODUCTION")
        self.assertTrue(all(v == 0.0 for v in ot.SCORE_WEIGHTS.values()))


def _ctx(symbol="EURUSD", channels=None, snaps=None, econ=None, direction=None, now=None):
    return fw.Context(symbol, channels or {}, snaps or {}, direction=direction, rank=3,
                      econ=econ if econ is not None else {"blocks": False, "state": "NORMAL"}, bias=None, now=now or T0 + 200 * H, missed=False)


class OtherTypes(unittest.TestCase):
    def test_op05_legacy_mapping_production(self):
        ctx = _ctx()
        h = {"opportunityFamily": "TIT_CORRECTION_END", "status": "WATCHING", "direction": "BULLISH", "TiTLevel": "L2", "parentTimeframe": "D1",
             "childTimeframe": "H8", "executionTimeframe": "H1", "campaignId": "CMP-1", "p1": {"state": "P1_WAITING"},
             "p2": {"state": "P2_READY_FOR_RISK"}, "childRole": "TRANSITION", "channelBreak": {"state": "BREAK_CONFIRMED"}, "confidence": 70}
        out = fw.legacy_hypotheses([{"symbol": "EURUSD", "hypotheses": [h]}], {"EURUSD": ctx})
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["opportunityType"], "OP-05")
        self.assertEqual(out[0]["route"], "OP-05:TIT")
        self.assertEqual(out[0]["mode"], "PRODUCTION")
        self.assertTrue(out[0]["confirmation"]["confirmed"])

    def _brk_row(self, state, cid="CAND-1"):
        return {"candidateId": cid, "symbol": "EURUSD", "titLevel": "L2", "channelRole": "CONTINUATION",
                "channel": {"id": "CH-H8", "timeframe": "H8", "direction": "BULLISH", "confidence": 70, "upper": 1.11, "lower": 1.10},
                "parent": {"timeframe": "D1", "direction": "BULLISH"},
                "breakout": {"relevantBoundary": "UPPER", "expectedDirection": "BULLISH", "state": state, "engineState": state,
                             "detectedAt": (T0 + 100 * H) * 1000, "confirmedAt": (T0 + 101 * H) * 1000, "breakPrice": 1.111, "boundaryPrice": 1.11},
                "retest": {"state": "RETEST_HELD" if state == "RETEST_HELD" else "PENDING"}, "structure": {"bos": False, "choch": False},
                "freshness": {"state": "CURRENT"}, "confirmationTimeframe": "H1"}

    def test_op06_op07_progression_same_identity(self):
        ctxs = {"EURUSD": _ctx()}
        wick = fw.breakout_hypotheses([self._brk_row("BREAK_DETECTED")], ctxs, {}, {}, Src([], {}))[0]
        conf = fw.breakout_hypotheses([self._brk_row("BREAK_CONFIRMED")], ctxs, {}, {}, Src([], {}))[0]
        held = fw.breakout_hypotheses([self._brk_row("RETEST_HELD")], ctxs, {}, {}, Src([], {}))[0]
        self.assertEqual((wick["opportunityType"], wick["confirmationState"]), ("OP-06", ot.WAITING_FOR_REQUIRED_EVIDENCE))
        self.assertIn("BREAK_CONFIRMED", wick["missingEvidence"])
        self.assertEqual(conf["opportunityType"], "OP-06")
        self.assertTrue(conf["confirmation"]["confirmed"])  # BOS / CHoCH are optional for OP-06
        self.assertEqual(held["opportunityType"], "OP-07")
        self.assertTrue(held["confirmation"]["confirmed"])
        self.assertEqual(len({wick["opportunityId"], conf["opportunityId"], held["opportunityId"]}), 1)
        self.assertEqual(held["supersedes"], "OP-06")
        self.assertFalse(held["evidence"]["BOS"])  # a channel break / retest is not a BOS

    def test_correction_break_is_op05_evidence_not_op06(self):
        row = {**self._brk_row("BREAK_CONFIRMED"), "channelRole": "CORRECTION"}
        self.assertEqual(fw.breakout_hypotheses([row], {"EURUSD": _ctx()}, {}, {}, Src([], {})), [])

    def test_op09_failed_break_reentry(self):
        lvl = 1.1050
        bars = [(T0 + i * H, 1.1030, 1.1036, 1.1024, 1.1030) for i in range(50)]
        for i in range(50, 53):  # closes above the upper boundary
            bars.append((T0 + i * H, 1.1052, 1.1062, 1.1050, 1.1058))
        for i, c in zip(range(53, 58), (1.1040, 1.1036, 1.1032, 1.1030, 1.1026)):  # back inside, displacement down
            bars.append((T0 + i * H, c + 0.0004, c + 0.0005, c - 0.0001, c))
        rx = br.reentry_reaction(bars, lvl, "UPPER", since_ts=T0 + 49 * H)
        self.assertEqual(rx["state"], "REENTRY_CONFIRMED")
        ctx = _ctx(now=int(bars[-1][0]) + H + 5)
        rec = fw._failed_record(ctx, {("EURUSD", "H1"): bars}, Src(bars, {}), tf="H1", exec_tf="H1", side="UPPER", level=lvl,
                                since=T0 + 49 * H, parent={"timeframe": "H8", "channelId": "X"}, channel_id="X", origin="scanner",
                                ident="CAND-9", confidence=60, opposite=1.0950)
        self.assertEqual(rec["opportunityType"], "OP-09")
        self.assertEqual(rec["direction"], "BEARISH")
        self.assertEqual(rec["invalidates"], fw._hid("BRK", "CAND-9"))
        self.assertTrue(rec["evidence"]["REENTRY"] and rec["evidence"]["REACTION"])

    def test_op10_one_countertrend_move_is_not_a_reversal(self):
        d1 = {"timeframe": "D1", "direction": "BULLISH", "status": "ACTIVE", "phase": "CONTINUATION", "upper": 1.2, "lower": 1.1}
        now = T0 + 300 * H
        h8 = {"timeframe": "H8", "direction": "BULLISH", "status": "ACTIVE", "lastBarTs": now - 2 * 8 * H,
              "structure": [{"kind": "CHOCH", "direction": "BEARISH", "ts": now - 5 * 8 * H, "price": 1.14, "level": 1.141}]}
        self.assertIsNone(fw.reversal_hypothesis(_ctx(snaps={"D1": d1, "H8": h8}, now=now), Src([], {}), {}))
        weak = {**d1, "status": "WEAKENING"}
        rec = fw.reversal_hypothesis(_ctx(snaps={"D1": weak, "H8": h8}, now=now), Src([], {}), {})
        self.assertEqual(rec["opportunityType"], "OP-10")
        self.assertEqual(rec["direction"], "BEARISH")
        self.assertIn("OPPOSITE_BOS", rec["missingEvidence"])
        self.assertFalse(rec["confirmation"]["confirmed"])

    def test_op12_range_break_retest_held(self):
        now = T0 + 300 * H
        rng = {"timeframe": "H8", "direction": "RANGE", "status": "BROKEN", "phase": "BREAKOUT", "channelId": "R1", "confidence": 65,
               "lastBarTs": now - 8 * H - 60, "breakout": {"side": "UP", "ts": now - 6 * 8 * H, "price": 1.12, "retestTs": now - 3 * 8 * H,
                                                          "retesting": False, "lastRetestTs": now - 3 * 8 * H}}
        out = fw.range_break_hypotheses(_ctx(snaps={"H8": rng}, now=now))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["opportunityType"], "OP-12")
        self.assertEqual(out[0]["detectorState"], "RETEST_HELD")
        self.assertTrue(out[0]["confirmation"]["confirmed"])

    def test_op08_structural_break_without_channel_break(self):
        bars = []
        price = 1.1000
        for i in range(120):  # rising zigzag: 6 up, 3 down
            step = 0.0004 if i % 9 < 6 else -0.0005
            o, c = price, price + step
            bars.append((T0 + i * H, o, max(o, c) + 0.0001, min(o, c) - 0.0001, c))
            price = c
        now = int(bars[-1][0]) + H + 5
        d1 = {"timeframe": "D1", "direction": "BULLISH", "status": "ACTIVE", "upper": price + 0.02, "lower": price - 0.01, "confidence": 70}
        rec = fw.structural_hypothesis(_ctx(snaps={"D1": d1}, now=now), Src(bars, {}), {})
        self.assertIsNotNone(rec)
        self.assertEqual(rec["opportunityType"], "OP-08")
        self.assertFalse(rec["evidence"]["CHANNEL_BREAK"])
        self.assertIn("CHANNEL_BREAK", [x["evidence"] for x in rec["confirmation"]["notRequired"]])


class Lifecycle(unittest.TestCase):
    def test_post_event_context_blocks_new_entry(self):
        econ = {"EURUSD": {"blocks": True, "state": "POST_EVENT_VOLATILITY", "code": "POST_EVENT", "reason": "NFP volatility"}}
        h = op01(build(1, econ=econ))
        self.assertEqual(h["confirmationState"], ot.CONFIRMED)
        self.assertEqual(h["lifecycle"], "BLOCKED")
        self.assertEqual(h["opportunityContext"], ["POST_EVENT"])
        self.assertEqual(h["regime"]["label"], "EVENT_DISTORTED")

    def test_unknown_economic_state_fails_closed(self):
        h = op01(build(1, econ={}))
        self.assertEqual(h["lifecycle"], "BLOCKED")

    def test_shadow_never_enters_qualified(self):
        legacy = {"instruments": [], "qualified": [{"campaignId": "X"}]}
        before = copy.deepcopy(legacy)
        state = build(1, legacy=legacy)
        self.assertEqual(legacy, before)
        self.assertTrue(state["summary"]["shadowNeverQualified"])
        self.assertEqual(state["productionLimits"], {"operatorPositionLimit": 3, "xauReservePct": 0.0})

    def test_conflict_and_single_risk_owner(self):
        a = {"symbol": "EURUSD", "direction": "BULLISH", "opportunityId": "A", "opportunityType": "OP-01", "campaignId": "C1", "mode": "SHADOW",
             "lifecycle": "READY_FOR_RISK", "confidence": 70, "confirmation": {"confirmed": True}}
        b = {**a, "opportunityId": "B", "opportunityType": "OP-03", "mode": "PRODUCTION", "lifecycle": "CONFIRMING", "campaignId": "C2"}
        c = {**a, "opportunityId": "C", "opportunityType": "OP-10", "direction": "BEARISH", "campaignId": "C3"}
        fw.relationships([a, b, c])
        kinds = {(r["to"]): r["kind"] for r in c["relationships"]}
        self.assertEqual(kinds["A"], "INVALIDATES")
        self.assertEqual({r["to"]: r["kind"] for r in a["relationships"]}["C"], "CONFLICTING")
        self.assertEqual({r["to"]: r["kind"] for r in a["relationships"]}["B"], "RELATED")
        self.assertEqual(b["riskRole"], "PRIMARY")  # production route owns the instrument/direction budget
        self.assertEqual(a["riskRole"], "SHARED_BUDGET")


class Idempotency(unittest.TestCase):
    def test_legacy_keys_unchanged(self):
        self.assertEqual(campaign.execution_key("C", "P1", 3), "C|P1|3")
        self.assertEqual(risk.setup_key({"handoffKind": "CAMPAIGN", "campaignId": "C", "legType": "P1", "setupRevision": 3}), "C|P1|3")

    def test_episode_in_identity(self):
        self.assertEqual(campaign.execution_key("C", "P1", 3, "E9"), "C|E9|P1|3")
        self.assertEqual(risk.setup_key({"handoffKind": "CAMPAIGN", "campaignId": "C", "legType": "P1", "setupRevision": 3, "episodeId": "E9"}),
                         "C|E9|P1|3")

    def test_shadow_handoff_carries_episode(self):
        h = build(1)["shadowHandoffs"][0]
        self.assertEqual(h["executionKey"], campaign.execution_key(h["campaignId"], "P1", h["setupRevision"], h["episodeId"]))
        self.assertEqual(h["opportunityType"], "OP-01")


class Learning(unittest.TestCase):
    def test_trade_typed_by_opportunity(self):
        t = learning.normalize_trade({"executionId": 1, "doc": {"evidence": {"stage7": {"opportunityType": "OP-01", "tradeType": "NORMAL_TREND_CONTINUATION"}}}})
        self.assertEqual(t["opportunityType"], "OP-01")
        old = learning.normalize_trade({"executionId": 2, "doc": {"evidence": {"stage7": {"tradeType": "TIT_CORRECTION_END"}}}})
        self.assertEqual(old["opportunityType"], "OP-05")
        self.assertIn("byOpportunityType", learning.analytics([t, old]))


class Notifications(unittest.TestCase):
    def test_framework_policies_default_off(self):
        for ev in ("OPPORTUNITY_DISCOVERED", "OPPORTUNITY_CONFIRMING", "OPPORTUNITY_READY_FOR_RISK", "OPPORTUNITY_AUTHORIZED",
                   "OPPORTUNITY_INVALIDATED"):
            self.assertFalse(policy.DEFAULT_POLICIES[ev])
            self.assertEqual(policy.allows(ev, "EURUSD", {"masterEnabled": True, "policies": {}}), (False, "EVENT_OFF"))

    def test_mail_carries_opportunity_type(self):
        import notification_mail as mail
        subject, text, _ = mail.render("P1_READY_FOR_RISK", {"symbol": "EURUSD", "titLevel": "L2", "opportunityType": "OP-03",
                                                            "opportunityTypeName": "TiT Continuation"},
                                       {"timezone": "UTC", "fromName": "x", "fromEmail": "x@y.z", "defaultRecipient": "a@b.c", "mode": "TEST"})
        self.assertIn("OP-03", subject)
        self.assertIn("Opportunity: OP-03 TiT Continuation", text)


class Persistence(unittest.TestCase):
    def test_transitions_and_expiry(self):
        state = build(1)
        first = fstore.persist(state, ["EURUSD"])
        self.assertTrue(any(t["opportunityType"] == "OP-01" and t["fromLifecycle"] is None for t in first))
        self.assertEqual(fstore.persist(state, ["EURUSD"]), [])  # same revision: no duplicate transition
        h = op01(state)
        hist = fstore.history(h["opportunityId"])
        self.assertEqual(hist["hypothesis"]["opportunityType"], "OP-01")
        self.assertEqual(len(hist["transitions"]), 1)
        gone = fstore.persist({**state, "hypotheses": []}, ["EURUSD"])
        self.assertTrue(any(t["opportunityId"] == h["opportunityId"] and t["toLifecycle"] == "EXPIRED" for t in gone))
        self.assertIn("OP-01", fstore.learning_summary()["byOpportunityType"])

    def test_counterfactual_first_touch(self):
        cf = {"state": "OPEN", "entry": 1.10, "stop": 1.09, "target": 1.12, "sign": 1, "startTs": T0, "mfeR": 0, "maeR": 0, "bars": 0}
        bars = [(T0, 1.1, 1.1, 1.1, 1.1), (T0 + H, 1.1, 1.105, 1.095, 1.1), (T0 + 2 * H, 1.1, 1.121, 1.099, 1.12)]
        out = fstore.measure_counterfactual(cf, bars)
        self.assertEqual(out["outcome"], "TARGET_FIRST")
        self.assertAlmostEqual(out["maeR"], -0.5, places=2)
        both = fstore.measure_counterfactual(cf, [(T0 + H, 1.1, 1.13, 1.08, 1.1)])
        self.assertEqual(both["outcome"], "STOP_FIRST")


if __name__ == "__main__":
    unittest.main()
