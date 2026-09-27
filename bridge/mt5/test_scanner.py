"""Stage 4 Market Scanner tests on synthetic Stage 1/2/3 inputs (no database, no MT5)."""

from __future__ import annotations

import time
import unittest
from datetime import date
from unittest import mock

import scanner
import scanner_service

OBS = "2026-09-25"
EXPECTED = date(2026, 9, 25)


def asset(code, comp, reg, mom=0.0, acc=0.0, macro=None, current=None, conf=80.0, pers=70.0, day=OBS):
    return {"asset": code, "composite": comp, "macro": comp if macro is None else macro, "current": comp if current is None else current,
            "momentum": mom, "acceleration": acc, "regime": reg, "confidence": conf, "persistence": pers, "durationObs": 12, "date": day}


def s1(status="READY", live=True):
    return {"status": status, "reason": status.lower(), "marketOpen": status != "CLOSED", "quoteValid": True, "tickAgeSec": 1,
            "liveEligible": live and status == "READY", "timeframes": {}}


def neutral_assets():
    return {a: asset(a, 0.0, "Stable") for a in scanner.regime.ASSETS}


def series(status="READY", count=2000):
    return {tf: {"status": status, "reason": status, "candle_count": count} for tf in scanner.STAGE1_TFS}


class Stage1Readiness(unittest.TestCase):
    now = 1_800_000_000

    def tick(self, age=5, bid=1.1, ask=1.1002):
        return {"bid": bid, "ask": ask, "time": self.now - age}

    def test_ready_when_history_valid_and_quote_fresh(self):
        r = scanner.stage1_readiness("EURUSD", series(), True, self.tick(), True, self.now)
        self.assertEqual(r["status"], "READY")
        self.assertTrue(r["liveEligible"])

    def test_market_closed_is_valid_but_not_live(self):
        r = scanner.stage1_readiness("EURUSD", series(), True, self.tick(age=200_000), False, self.now)
        self.assertEqual(r["status"], "CLOSED")
        self.assertFalse(r["liveEligible"])

    def test_stale_quote_while_open(self):
        self.assertEqual(scanner.stage1_readiness("EURUSD", series(), True, self.tick(age=500), True, self.now)["status"], "STALE")

    def test_invalid_quote_blocks(self):
        self.assertEqual(scanner.stage1_readiness("EURUSD", series(), True, self.tick(bid=0), True, self.now)["status"], "BLOCKED")

    def test_provider_offline_blocks(self):
        self.assertEqual(scanner.stage1_readiness("EURUSD", series(), False, self.tick(), True, self.now)["status"], "BLOCKED")

    def test_validation_failed_blocks_with_reason(self):
        s = series()
        s["H8"] = {"status": "VALIDATION_FAILED", "reason": "OHLC integrity", "candle_count": 3000}
        r = scanner.stage1_readiness("EURUSD", s, True, self.tick(), True, self.now)
        self.assertEqual(r["status"], "BLOCKED")
        self.assertIn("H8", r["reason"])

    def test_missing_h1_is_insufficient(self):
        s = series()
        s["H1"] = None
        self.assertEqual(scanner.stage1_readiness("EURUSD", s, True, self.tick(), True, self.now)["status"], "INSUFFICIENT_DATA")

    def test_stale_series(self):
        s = series()
        s["D1"] = {"status": "STALE", "reason": "behind provider", "candle_count": 2000}
        self.assertEqual(scanner.stage1_readiness("EURUSD", s, True, self.tick(), True, self.now)["status"], "STALE")


class Scoring(unittest.TestCase):
    def pair(self, b, q, sym="EURUSD", status="READY", promoted=False, expected=EXPECTED, regime_status="HEALTHY"):
        a = neutral_assets()
        a[b["asset"]], a[q["asset"]] = b, q
        return scanner.evaluate(sym, a, s1(status), expected, regime_status, promoted)

    def strong(self):
        return self.pair(asset("EUR", 5, "Strengthening", 1.0, 0.3, 4, 6), asset("USD", -3, "Weakening", -0.5, -0.1, -2, -4))

    def test_strong_base_weak_quote_is_strong_bullish_and_promoted(self):
        r = self.strong()
        self.assertEqual(r["relationship"], "STRONG_VS_WEAK")
        self.assertEqual(r["alignment"], "ALIGNED")
        self.assertEqual(r["direction"], "STRONG_BULLISH")
        self.assertEqual(r["state"], "PROMOTED")
        self.assertTrue(r["promotion"]["liveEligible"])
        self.assertAlmostEqual(r["conviction"], round(92 * 0.9, 1), places=1)
        self.assertEqual({c["key"] for c in r["components"]},
                         {"differential", "regime", "trajectory", "acceleration", "macro", "current", "persistence"})

    def test_weak_base_strong_quote_is_strong_bearish(self):
        r = self.pair(asset("EUR", -4, "Weakening", -1.0, -0.3), asset("USD", 4, "Accelerating", 1.0, 0.4))
        self.assertEqual(r["relationship"], "WEAK_VS_STRONG")
        self.assertEqual(r["direction"], "STRONG_BEARISH")

    def test_aligned_regimes_separate_more_than_one_sided(self):
        aligned = self.pair(asset("EUR", 3, "Strengthening"), asset("USD", -1, "Weakening"))
        led = self.pair(asset("EUR", 3, "Strengthening"), asset("USD", -1, "Stable"))
        self.assertEqual(led["relationship"], "BASE_LED")
        self.assertGreater(aligned["conviction"], led["conviction"])

    def test_similar_and_conflicting_regimes_reduce_conviction(self):
        base = self.pair(asset("EUR", 3, "Strengthening"), asset("USD", -1, "Stable"))
        similar = self.pair(asset("EUR", 3, "Strengthening"), asset("USD", -1, "Accelerating"))
        conflict = self.pair(asset("EUR", 3, "Weakening"), asset("USD", -1, "Strengthening"))
        self.assertEqual(similar["alignment"], "SIMILAR")
        self.assertEqual(conflict["alignment"], "CONFLICTING")
        self.assertLess(similar["conviction"], base["conviction"])
        self.assertLess(conflict["conviction"], similar["conviction"])
        self.assertNotEqual(conflict["state"], "PROMOTED")
        self.assertIn("Regime relationship", conflict["promotion"]["reason"])

    def test_neutral_band_caps_conviction(self):
        r = self.pair(asset("EUR", 0.8, "Strengthening"), asset("USD", 0, "Weakening"))
        self.assertEqual(r["direction"], "NEUTRAL")
        self.assertLessEqual(r["conviction"], scanner.CONFIG["neutralCap"])
        self.assertEqual(r["state"], "NEUTRAL")

    def test_moderate_candidate_is_qualified_with_explicit_rejection(self):
        r = self.pair(asset("EUR", 3, "Strengthening", 1.0, 0.3, 3, 3), asset("USD", 0, "Stable", 0, 0, 0, 0))
        self.assertEqual(r["direction"], "BULLISH")
        self.assertEqual(r["state"], "QUALIFIED")
        self.assertIn("Conviction threshold", r["promotion"]["reason"])
        self.assertTrue(r["reason"].startswith("Qualified but not promoted"))

    def test_hysteresis_keeps_existing_promotion(self):
        args = (asset("EUR", 3.6, "Strengthening", 1.0, 0.3, 3.6, 3.6), asset("USD", 0, "Stable", 0, 0, 0, 0))
        fresh = self.pair(*args)
        held = self.pair(*args, promoted=True)
        self.assertTrue(50 <= fresh["conviction"] < 55, fresh["conviction"])
        self.assertNotEqual(fresh["state"], "PROMOTED")
        self.assertEqual(held["state"], "PROMOTED")

    def test_stage1_blocked_keeps_intelligence_but_never_promotes(self):
        a = neutral_assets()
        a["EUR"], a["USD"] = asset("EUR", 5, "Strengthening", 1.0, 0.3, 4, 6), asset("USD", -3, "Weakening", -0.5, -0.1, -2, -4)
        r = scanner.evaluate("EURUSD", a, s1("BLOCKED"), EXPECTED, "HEALTHY", True)
        self.assertEqual(r["state"], "BLOCKED")
        self.assertGreater(r["conviction"], 60, "intelligence still visible")
        self.assertFalse(r["promotion"]["promoted"])
        self.assertIn("not promoted", r["reason"])

    def test_stale_strength_is_not_promoted(self):
        r = self.pair(asset("EUR", 5, "Strengthening", 1.0, 0.3, 4, 6, day="2026-09-24"), asset("USD", -3, "Weakening", -0.5, -0.1, -2, -4, day="2026-09-24"))
        self.assertEqual(r["state"], "STALE")
        self.assertEqual(r["freshness"]["lagDays"], 1)

    def test_stage3_blocked_marks_stale(self):
        r = self.pair(asset("EUR", 5, "Strengthening"), asset("USD", -3, "Weakening"), regime_status="BLOCKED")
        self.assertEqual(r["state"], "STALE")

    def test_market_closed_promotes_structurally_but_not_live(self):
        r = self.pair(asset("EUR", 5, "Strengthening", 1.0, 0.3, 4, 6), asset("USD", -3, "Weakening", -0.5, -0.1, -2, -4), status="CLOSED")
        self.assertEqual(r["state"], "PROMOTED")
        self.assertFalse(r["promotion"]["liveEligible"])
        cfg = {**scanner.CONFIG, "promotion": {**scanner.CONFIG["promotion"], "promoteWhenMarketClosed": False}}
        a = neutral_assets()
        a["EUR"], a["USD"] = asset("EUR", 5, "Strengthening"), asset("USD", -3, "Weakening")
        self.assertEqual(scanner.evaluate("EURUSD", a, s1("CLOSED"), EXPECTED, "HEALTHY", False, cfg)["state"], "STALE")

    def test_insufficient_data(self):
        a = neutral_assets()
        del a["JPY"]
        self.assertEqual(scanner.evaluate("USDJPY", a, s1(), EXPECTED, "HEALTHY", False)["state"], "INSUFFICIENT_DATA")
        a = neutral_assets()
        a["EUR"] = asset("EUR", 4, None)
        r = scanner.evaluate("EURUSD", a, s1(), EXPECTED, "HEALTHY", False)
        self.assertEqual(r["state"], "INSUFFICIENT_DATA")
        self.assertEqual(r["relationship"], "WARMING_UP")

    def test_xau_uses_dedicated_model(self):
        fx = self.pair(asset("EUR", 1.8, "Strengthening"), asset("USD", 0, "Stable"))
        gold = self.pair(asset("XAU", 1.8, "Strengthening"), asset("USD", 0, "Stable"), sym="XAUUSD")
        self.assertEqual(fx["direction"], "BULLISH")
        self.assertEqual(gold["direction"], "NEUTRAL")
        self.assertEqual(gold["model"], "XAU_DEDICATED")
        self.assertEqual(gold["baseAsset"], "XAU")
        self.assertTrue(any("XAU dedicated" in e for e in gold["evidence"]))


class Ranking(unittest.TestCase):
    def test_all_29_ranked_and_every_qualifier_promoted(self):
        a = neutral_assets()
        a["EUR"] = asset("EUR", 5, "Strengthening", 1.0, 0.3, 4, 6)
        a["GBP"] = asset("GBP", 5, "Accelerating", 1.0, 0.3, 4, 6)
        a["JPY"] = asset("JPY", -4, "Weakening", -1.0, -0.3, -3, -5)
        stage1 = {s: s1() for s in scanner.SYMBOLS}
        stage1["GBPJPY"] = s1("BLOCKED")
        res = scanner.rank(a, stage1, EXPECTED, "HEALTHY", set())
        rows = res["instruments"]
        self.assertEqual(len(rows), 29)
        self.assertEqual([r["rank"] for r in rows], list(range(1, 30)))
        conv = [r["conviction"] for r in rows]
        self.assertEqual(conv, sorted(conv, reverse=True))
        promoted = {r["symbol"] for r in rows if r["state"] == "PROMOTED"}
        self.assertIn("EURJPY", promoted)
        self.assertNotIn("GBPJPY", promoted, "Stage 1 BLOCKED")
        self.assertEqual(res["counters"]["promoted"], len(promoted))
        self.assertEqual(res["counters"]["universe"], 29)
        self.assertEqual(res["counters"]["available"], 28)
        gbpjpy = next(r for r in rows if r["symbol"] == "GBPJPY")
        self.assertEqual(gbpjpy["state"], "BLOCKED")
        self.assertIn(gbpjpy["rank"], range(1, 6), "blocked instrument still ranked by its intelligence")

    def test_config_overrides_validated(self):
        cfg = scanner.merge_config({"promotion.minConviction": 60, "promotion.promoteWhenMarketClosed": False, "neutralBand": 2})
        self.assertEqual(cfg["promotion"]["minConviction"], 60)
        self.assertFalse(cfg["promotion"]["promoteWhenMarketClosed"])
        self.assertEqual(cfg["neutralBand"], 2)
        self.assertEqual(scanner.CONFIG["promotion"]["minConviction"], 55.0, "defaults untouched")
        for bad in ({"promotion.minConviction": 150}, {"weights.aligned": 99}, {"watchConviction": 90}):
            with self.assertRaises(ValueError):
                scanner.merge_config(bad)

    def test_signature_ignores_sub_point_noise(self):
        rows = [{"symbol": "EURUSD", "state": "PROMOTED", "direction": "BULLISH", "conviction": 60.2}]
        same = [{**rows[0], "conviction": 60.8}]
        self.assertEqual(scanner.ranking_signature(rows), scanner.ranking_signature(same))


class AutonomousService(unittest.TestCase):
    def setUp(self):
        self.assets = neutral_assets()
        self.assets["EUR"] = asset("EUR", 5, "Strengthening", 1.0, 0.3, 4, 6)
        self.assets["USD"] = asset("USD", -3, "Weakening", -0.5, -0.1, -2, -4)
        self.series = {(s, tf): {"status": "READY", "reason": "ok", "candle_count": 2000, "latest_ts": 1790294400 if tf == "D1" else 1}
                       for s in scanner.SYMBOLS for tf in scanner.STAGE1_TFS}
        self.meta = {"status": "HEALTHY", "runAt": "r1"}
        self.overrides: dict = {}
        self.down: dict = {}
        self.persisted: list = []
        self.notified: list = []
        self.patches = [
            mock.patch.object(scanner_service.ss, "latest_assets", lambda: self.assets),
            mock.patch.object(scanner_service.ss, "regime_meta", lambda: self.meta),
            mock.patch.object(scanner_service.ss, "downstream", lambda: self.down),
            mock.patch.object(scanner_service.ss, "previously_promoted", lambda: set()),
            mock.patch.object(scanner_service.ss, "load_config", lambda: self.overrides),
            mock.patch.object(scanner_service.ss, "persist", lambda res, meta, snap, ch: self.persisted.append((res, snap, ch)) or (len(self.persisted) if snap else None)),
            mock.patch.object(scanner_service.ss, "save_meta", lambda m: None),
            mock.patch.object(scanner_service.hs, "series_all", lambda: self.series),
        ]
        for p in self.patches:
            p.start()
        now = int(time.time())
        self.svc = scanner_service.ScannerService(
            tick_fn=lambda syms: {s: {"bid": 1.0, "ask": 1.0001, "time": now} for s in syms},
            context_fn=lambda: {"providerOk": True, "marketOpen": False},
            on_promotion_change=lambda syms, why: self.notified.append((sorted(syms), why)),
        )
        self.svc._last_full = float("inf")

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_startup_run_promotes_and_notifies_stage5(self):
        self.svc.mark("STARTUP")
        out = self.svc.tick()
        self.assertTrue(out["ran"])
        self.assertIn("EURUSD", self.svc.meta["promotedNow"])
        res, snap, changes = self.persisted[-1]
        self.assertTrue(snap)
        self.assertIn(("PROMOTED", "EURUSD"), {(c["action"], c["row"]["symbol"]) for c in changes})
        self.assertEqual(self.notified[-1][1], "SCANNER_QUALIFICATION_CHANGE")
        self.assertIn("EURUSD", self.notified[-1][0])
        self.assertEqual(self.svc.meta["counters"]["universe"], 29)

    def test_idle_without_triggers(self):
        self.svc.mark("STARTUP")
        self.svc.tick()
        self.assertEqual(self.svc.tick(), {"ran": False})

    def test_immaterial_strength_move_does_not_rerank(self):
        self.svc.mark("STARTUP")
        self.svc.tick()
        self.assets["EUR"] = {**self.assets["EUR"], "composite": 5.2}
        self.assertEqual(self.svc.tick(), {"ran": False})

    def test_material_strength_and_transition_rerank_and_demote(self):
        self.svc.mark("STARTUP")
        self.svc.tick()
        self.assets["EUR"] = asset("EUR", -1, "Deteriorating", -1.0, -0.3)
        out = self.svc.tick()
        self.assertTrue(out["ran"])
        self.assertTrue(any(t.startswith("STRENGTH_CHANGE") for t in out["triggers"]))
        self.assertTrue(any(t.startswith("REGIME_TRANSITION") for t in out["triggers"]))
        _, _, changes = self.persisted[-1]
        self.assertIn(("DEMOTED", "EURUSD"), {(c["action"], c["row"]["symbol"]) for c in changes})

    def test_operator_thresholds_change_promotions(self):
        self.assets["EUR"] = asset("EUR", 3, "Strengthening", 1.0, 0.3, 3, 3)
        self.assets["USD"] = asset("USD", 0, "Stable", 0, 0, 0, 0)
        self.svc.mark("STARTUP")
        self.svc.tick()
        self.assertNotIn("EURUSD", self.svc.meta["promotedNow"])
        self.overrides = {"promotion.minConviction": 40}
        self.svc.run(["CONFIG_CHANGE"])
        self.assertIn("EURUSD", self.svc.meta["promotedNow"])
        self.assertEqual(self.svc.meta["config"]["engine"]["promotion"]["minConviction"], 40)

    def test_stage1_block_downstream_and_candle_triggers(self):
        self.svc.mark("STARTUP")
        self.svc.tick()
        self.series[("EURUSD", "H8")] = {"status": "VALIDATION_FAILED", "reason": "bad OHLC", "candle_count": 3000, "latest_ts": 1}
        out = self.svc.tick()
        self.assertTrue(any(t.startswith("STAGE1_BLOCK_CHANGE") for t in out["triggers"]))
        self.assertNotIn("EURUSD", self.svc.meta["promotedNow"])
        self.down = {"EURUSD": ("READY", True)}
        self.assertIn("DOWNSTREAM_QUALIFICATION_CHANGE", self.svc.tick()["triggers"])
        self.svc.on_candles("H1", ["EURUSD"])
        self.svc.on_candles("M15", ["EURUSD"])
        self.assertEqual(self.svc.tick()["triggers"], ["NEW_CANDLE H1"])
        self.meta = {"status": "HEALTHY", "runAt": "r2"}
        self.assertIn("REGIME_RUN", self.svc.tick()["triggers"])


if __name__ == "__main__":
    unittest.main()
