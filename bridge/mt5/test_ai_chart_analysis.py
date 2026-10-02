from __future__ import annotations

import unittest

try:
    from ai_chart_analysis.analysis_service import _level_hints, run_analysis
    from ai_chart_analysis.annotation_engine import build_annotations
    from ai_chart_analysis.context_engine import aggregate_direction, build_timeframe_strip
    from ai_chart_analysis.evidence_engine import build_evidence
    from ai_chart_analysis.evidence_score import compute_evidence_score
    from ai_chart_analysis.parent_child_engine import build_parent_child_hierarchy
    from ai_chart_analysis.regime_classifier import classify_regime
    from ai_chart_analysis.thesis_builder import build_thesis_title
    from ai_chart_analysis.reconciliation_engine import reconcile
    from ai_chart_analysis.tradability_engine import build_tradability_chain
    from ai_chart_analysis.analysis_mode import apply_analysis_mode
    from ai_chart_analysis.analysis_orchestrator import should_refresh_analysis
    from ai_chart_analysis.chart_builder import build_chart_payload
    from ai_chart_analysis.chart_model import build_chart_view
except ImportError:  # pragma: no cover
    from bridge.mt5.ai_chart_analysis.analysis_service import _level_hints, run_analysis  # type: ignore
    from bridge.mt5.ai_chart_analysis.annotation_engine import build_annotations  # type: ignore
    from bridge.mt5.ai_chart_analysis.context_engine import aggregate_direction, build_timeframe_strip  # type: ignore
    from bridge.mt5.ai_chart_analysis.evidence_engine import build_evidence  # type: ignore
    from bridge.mt5.ai_chart_analysis.evidence_score import compute_evidence_score  # type: ignore
    from bridge.mt5.ai_chart_analysis.parent_child_engine import build_parent_child_hierarchy  # type: ignore
    from bridge.mt5.ai_chart_analysis.regime_classifier import classify_regime  # type: ignore
    from bridge.mt5.ai_chart_analysis.thesis_builder import build_thesis_title  # type: ignore
    from bridge.mt5.ai_chart_analysis.reconciliation_engine import reconcile  # type: ignore
    from bridge.mt5.ai_chart_analysis.tradability_engine import build_tradability_chain  # type: ignore
    from bridge.mt5.ai_chart_analysis.analysis_mode import apply_analysis_mode  # type: ignore
    from bridge.mt5.ai_chart_analysis.analysis_orchestrator import should_refresh_analysis  # type: ignore
    from bridge.mt5.ai_chart_analysis.chart_builder import build_chart_payload  # type: ignore
    from bridge.mt5.ai_chart_analysis.chart_model import build_chart_view  # type: ignore


def _channel(direction: str, tf: str = "H1") -> dict:
    return {
        "timeframe": tf,
        "direction": direction,
        "status": "ACTIVE",
        "confidence": 70,
        "evidence": {"events": [], "swings": []},
        "lastCandleClose": 1_700_000_000_000,
    }


class AiChartAnalysisTests(unittest.TestCase):
    def test_timeframe_hierarchy_strip(self):
        channels = {
            "YTD": _channel("BULLISH", "YTD"),
            "D1": _channel("BULLISH", "D1"),
            "H8": _channel("BULLISH", "H8"),
            "H1": {**_channel("BEARISH", "H1"), "relationship": "CORRECTIVE"},
        }
        strip = build_timeframe_strip(channels, None, {"marketState": "CORRECTION"}, None)
        self.assertEqual(len(strip), 9)
        self.assertEqual(aggregate_direction(strip), "BULLISH")

    def test_parent_child_pullback(self):
        channels = {
            "D1": _channel("BULLISH", "D1"),
            "H8": _channel("BULLISH", "H8"),
            "H1": {**_channel("BEARISH", "H1"), "relationship": "CORRECTIVE"},
        }
        strip = build_timeframe_strip(channels, None, None, None)
        rels = build_parent_child_hierarchy(strip, channels)
        h1_rel = next(r for r in rels if r["child"] == "H1" and r["parent"] == "H8")
        self.assertEqual(h1_rel["relation"], "COUNTERTREND_PULLBACK")

    def test_pullback_not_auto_conflict(self):
        channels = {"D1": _channel("BULLISH", "D1"), "H1": {**_channel("BEARISH", "H1"), "relationship": "CORRECTIVE"}}
        strip = build_timeframe_strip(channels, None, None, None)
        s, c, m = build_evidence(strip, channels, None, None, None)
        self.assertTrue(any("pullback" in (e.get("text") or "").lower() for e in s))

    def test_tradability_not_tradable_without_p2(self):
        strip = build_timeframe_strip({"D1": _channel("BULLISH", "D1"), "H1": _channel("BULLISH", "H1")}, None, None, None)
        chain = build_tradability_chain(strip, [], [{"type": "BOS"}], False, {"p2": {"state": "P2_WAITING_FOR_BREAK"}}, None)
        tradable = next(c for c in chain if c["stage"] == "TRADABLE")
        self.assertNotEqual(tradable["state"], "COMPLETE")

    def test_reconciliation_partial_when_not_tradable(self):
        rec = reconcile("Bullish continuation developing.", {"direction": "BULLISH", "lifecycle": "CONFIRMING"}, {"p2": {"state": "P2_WAITING_FOR_BREAK"}}, None, False)
        self.assertIn(rec["agreement"], ("PARTIAL", "AGREEMENT", "CONFLICT", "INSUFFICIENT_DATA"))
        self.assertFalse(rec["executionAuthorized"])

    def test_evidence_score_bounded(self):
        strip = build_timeframe_strip({"D1": _channel("BULLISH", "D1"), "H1": _channel("BULLISH", "H1")}, None, None, None)
        score, comp = compute_evidence_score(strip, [{"text": "a"}], [], [], [])
        self.assertGreaterEqual(score, 5)
        self.assertLessEqual(score, 95)
        self.assertIn("htfAlignment", comp)

    def test_thesis_title_natural_language(self):
        title = build_thesis_title("BEARISH", "BREAKOUT_DEVELOPING", None)
        self.assertIn("Bearish", title)
        self.assertNotIn("BEARISH", title)

    def test_regime_classifier(self):
        ch = {**_channel("BEARISH", "H1"), "status": "BROKEN"}
        strip = build_timeframe_strip({"H1": ch}, None, None, None)
        reg = classify_regime(strip, {"H1": ch})
        self.assertEqual(reg["primary"], "BREAKOUT_ENVIRONMENT")

    def test_run_analysis_no_channel(self):
        out = run_analysis("XAUUSD", sources={"channel": {"ok": False, "message": "missing"}})
        self.assertFalse(out["ok"])

    def test_confirmation_mode_focus(self):
        pack = apply_analysis_mode(
            "CONFIRMATION",
            supporting=[{"text": "D1 channel intact", "source": "ChannelEngine"}],
            conflicting=[],
            missing=[{"text": "EXECUTION_CONFIRM pending", "type": "CONFIRMATION"}],
            annotations=[{"type": "BOS"}, {"type": "HIGH"}],
            tradability=[{"stage": "MACRO_CONTEXT"}, {"stage": "STRUCTURAL_CONFIRMATION", "state": "ACTIVE"}],
            thesis="Base thesis.",
        )
        self.assertIn("Confirmation-first", pack["modeFocus"])
        self.assertTrue(any(a.get("type") == "BOS" for a in pack["annotations"]))
        self.assertTrue(all(t.get("stage") != "MACRO_CONTEXT" for t in pack["tradability"]))

    def test_chart_payload_resolves_lines_ref(self):
        channels = {
            "D1": {
                "candles": [{"time": 1000, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "complete": True}],
                "lines": [{"time": 1000, "upper": 2.2, "lower": 0.8, "mid": 1.5}],
            },
            "YTD": {"candlesRef": {"source": "D1", "from": 1000, "count": 1}, "linesRef": {"timeframe": "D1", "from": 1000, "count": 1}},
        }
        chart = build_chart_payload(channels, "YTD", None, lookback=80, shared_candles={"D1": channels["D1"]["candles"]})
        self.assertEqual(len(chart["candles"]), 1)
        self.assertEqual(chart["lines"][0]["upper"], 2.2)

    def test_chart_payload_splits_channel_and_st(self):
        channels = {
            "H1": {
                "candles": [{"time": 1000, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "complete": True}],
                "lines": [{"time": 1000, "upper": 2.2, "lower": 0.8, "mid": 1.5}],
            }
        }
        st = {
            "ok": True,
            "cards": {
                "H1": {
                    "points": [{"time": 1000, "value": 1.1, "direction": "UP"}],
                }
            },
        }
        chart = build_chart_payload(channels, "H1", st, lookback=80)
        self.assertEqual(chart["lines"][0]["mid"], 1.5)
        self.assertEqual(chart["supertrendSeries"][0]["value"], 1.1)
        self.assertNotEqual(chart["supertrendSeries"][0]["value"], chart["lines"][0]["mid"])

    def test_level_hints_supply_erz_bands(self):
        channels = {
            "H1": {
                **_channel("BULLISH", "H1"),
                "upperBoundary": 2100.0,
                "lowerBoundary": 2000.0,
                "midline": 2050.0,
                "invalidation": 1990.0,
                "evidence": {
                    "swings": [
                        {"kind": "HIGH", "time": 100, "price": 2080.0},
                        {"kind": "LOW", "time": 200, "price": 2020.0},
                        {"kind": "HIGH", "time": 300, "price": 2090.0},
                    ],
                    "events": [],
                },
            }
        }
        ann = build_annotations(channels, "H1", "BULLISH")
        hints = _level_hints(ann, channels, "H1", None, fw_h=None, direction="BULLISH")
        self.assertIsNotNone(hints["supplyUpper"])
        self.assertIsNotNone(hints["supplyLower"])
        self.assertGreater(hints["supplyUpper"], hints["supplyLower"])
        self.assertGreater(hints["supplyLower"], hints["erzUpper"])
        self.assertEqual(len([a for a in ann if a.get("type") in ("HIGH", "LOW")]), 3)

    def test_chart_view_model(self):
        t0 = 1_700_000_000_000
        candles = [
            {"time": t0 + i * 3_600_000, "open": 1.0, "high": 1.2, "low": 0.9, "close": 1.1, "complete": True}
            for i in range(20)
        ]
        lines = [{"time": t0, "upper": 1.3, "lower": 0.8, "mid": 1.05}, {"time": t0 + 19 * 3_600_000, "upper": 1.35, "lower": 0.85, "mid": 1.1}]
        snap = {"candles": candles, "channelLines": lines, "supertrendSeries": [{"time": t0, "value": 0.95, "direction": "UP"}]}
        hints = {
            "supplyUpper": 1.36,
            "supplyLower": 1.32,
            "erzUpper": 0.92,
            "erzLower": 0.88,
            "p2": 1.12,
            "invalidation": 0.82,
            "t1": 1.25,
            "t2": 1.3,
            "erzMid": 0.9,
        }
        view = build_chart_view(
            symbol="EURUSD",
            primary_tf="H1",
            direction="BULLISH",
            chart_snap=snap,
            annotations=[],
            level_hints=hints,
        )
        self.assertEqual(len(view["candles"]), 20)
        self.assertEqual(len(view["zones"]), 2)
        self.assertGreaterEqual(len(view["projectedScenario"]), 4)

    def test_orchestrator_closed_bar(self):
        ok, reason = should_refresh_analysis(
            previous_last_closed={"M5": 1000, "H1": 2000},
            current_last_closed={"M5": 1000, "H1": 2000},
            previous_analysis_ms=0,
            now_ms=10_000,
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "NO_BAR_CHANGE")
        ok2, reason2 = should_refresh_analysis(
            previous_last_closed={"M5": 1000},
            current_last_closed={"M5": 1500},
            previous_analysis_ms=0,
            now_ms=10_000,
        )
        self.assertTrue(ok2)
        self.assertIn("M5", reason2)


if __name__ == "__main__":
    unittest.main()
