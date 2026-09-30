"""Stage 8 Opportunities & Risk: setup qualification, portfolio / account risk, prop rules, sizing, authorization, service."""

from __future__ import annotations

import copy
import unittest
from datetime import datetime, timezone
from unittest import mock

import risk
import risk_service

NOW = datetime(2026, 9, 23, 12, 0, tzinfo=timezone.utc).timestamp()  # Wednesday 12:00 UTC

SPECS = {
    "EURUSD": dict(tickSize=1e-5, tickValue=1.0, contractSize=100000, point=1e-5, digits=5, currencyProfit="USD", currencyMargin="EUR"),
    "GBPUSD": dict(tickSize=1e-5, tickValue=1.0, contractSize=100000, point=1e-5, digits=5, currencyProfit="USD", currencyMargin="GBP"),
    "AUDUSD": dict(tickSize=1e-5, tickValue=1.0, contractSize=100000, point=1e-5, digits=5, currencyProfit="USD", currencyMargin="AUD"),
    "XAUUSD": dict(tickSize=0.01, tickValue=1.0, contractSize=100, point=0.01, digits=2, currencyProfit="USD", currencyMargin="XAU"),
}
RATES = {("EUR", "USD"): 1.10003, ("GBP", "USD"): 1.3, ("AUD", "USD"): 0.66, ("XAU", "USD"): 4290.2, ("USD", "NGN"): 1550.0}


def spec(sym: str, **kw) -> dict:
    return {"name": sym, "volumeMin": 0.01, "volumeMax": 100.0, "volumeStep": 0.01, "calcMode": 0, "tradeMode": 4, "stopsLevel": 0,
            **SPECS[sym], **kw}


def market(overrides: dict | None = None, **kw) -> dict:
    m = {
        "EURUSD": {"bid": 1.10000, "ask": 1.10006, "time": NOW - 5, "spec": spec("EURUSD")},
        "GBPUSD": {"bid": 1.30000, "ask": 1.30008, "time": NOW - 5, "spec": spec("GBPUSD")},
        "AUDUSD": {"bid": 0.66000, "ask": 0.66006, "time": NOW - 5, "spec": spec("AUDUSD")},
        "XAUUSD": {"bid": 4290.00, "ask": 4290.40, "time": NOW - 5, "spec": spec("XAUUSD")},
    }
    for s, v in (overrides or {}).items():
        m[s] = {**m[s], **v}
    return m


def fx_from(rates: dict):
    def fx(src, dst):
        if src == dst:
            return {"ok": True, "rate": 1.0, "source": "identity", "age": 0}
        if (src, dst) in rates:
            return {"ok": True, "rate": rates[(src, dst)], "source": src + dst, "age": 3}
        if (dst, src) in rates:
            return {"ok": True, "rate": 1 / rates[(dst, src)], "source": f"1/{dst}{src}", "age": 3}
        if (src, "USD") in rates and ("USD", dst) in rates:
            return {"ok": True, "rate": rates[(src, "USD")] * rates[("USD", dst)], "source": "cross", "age": 3}
        return {"ok": False, "reason": f"No {src}{dst} symbol at this broker"}
    return fx


FX = fx_from(RATES)


def eur_long(**kw) -> dict:
    h = {"instrument": "EURUSD", "direction": "BULLISH", "confidence": 80.0, "invalidationLevel": 1.09800, "riskAtr": 2.0, "freshness": "FRESH",
         "h1LastTs": NOW - 3600 - 20 * 60, "confirmedSince": risk.iso(NOW - 30 * 60), "executes": False, "atr": 0.0010,
         "entryContext": {"model": "PULLBACK_CONTINUATION", "trigger": "BOS", "triggerTs": 1790000000, "triggerLevel": 1.0995, "lastClose": 1.0998},
         "channelLocation": {"zone": "VALUE"}, "boundaries": {"H8": {"lower": 1.0950, "upper": 1.1060}, "D1": {"lower": 1.0900, "upper": 1.1150}}}
    h.update(kw)
    return h


def xau_short(**kw) -> dict:
    h = {"instrument": "XAUUSD", "direction": "BEARISH", "confidence": 78.0, "invalidationLevel": 4310.0, "riskAtr": 1.2, "freshness": "FRESH",
         "h1LastTs": NOW - 3600 - 10 * 60, "confirmedSince": risk.iso(NOW - 20 * 60), "executes": False, "atr": 16.0,
         "entryContext": {"model": "PULLBACK_CONTINUATION", "trigger": "CHOCH", "triggerTs": 1790003600, "triggerLevel": 4296.0, "lastClose": 4292.0},
         "channelLocation": {"zone": "VALUE"}, "boundaries": {"H8": {"lower": 4230.0, "upper": 4330.0}, "D1": {"lower": 4150.0, "upper": 4400.0}}}
    h.update(kw)
    return h


def acct(aid="demo", cls="DEMO", ccy="USD", equity=10000.0, **kw) -> dict:
    a = {"id": aid, "name": aid.title(), "accountClass": cls, "currency": ccy, "login": "1", "server": "Broker-Demo", "state": "HEALTHY",
         "tradingMode": "AUTONOMOUS", "tradingEnabled": True, "leverage": 100, "maxConcurrentTrades": 5, "balance": equity, "equity": equity,
         "margin": 0.0, "freeMargin": equity, "snapshotAt": NOW - 3, "live": True, "tradeAllowed": True, "positions": [],
         "dayStartEquity": equity, "peakEquity": equity, "dayPnl": 0.0, "baselineSource": "broker deals", "propRules": None}
    a.update(kw)
    return a


def ctx(**kw) -> dict:
    c = {"now": NOW, "auto": True, "corr": {}, "pending": [], "attempts": {}, "approvals": set(), "brokerMargin": {}, "terminalCurrency": None,
         "configHash": "cfg1"}
    c.update(kw)
    return c


def cfg(**kw) -> dict:
    c, errors = risk.merge_config(kw)
    assert not errors, errors
    return c


def run(handoffs, accounts, m=None, fx=FX, config=None, **ckw):
    return risk.evaluate(handoffs, accounts, m or market(), fx, config or cfg(), ctx(**ckw))


def only(res) -> tuple[dict, dict]:
    o = res["opportunities"][0]
    return o, o["accounts"][0]


def position(sym, side, volume, entry, sl) -> dict:
    return {"symbol": sym, "side": side, "volume": volume, "entry": entry, "sl": sl, "tp": None, "pnl": 0.0}


class SetupQualification(unittest.TestCase):
    def test_stage7_wait_retest_is_not_authorized(self):
        held = eur_long(entry={"timing": "WAIT_RETEST", "classification": "EXTENDED", "breakoutQuality": "ACCEPTABLE",
                               "reasons": ["controlled retest required"]})
        o, a = only(run([held], [acct()]))
        self.assertEqual(o["setupState"], "WAITING")
        self.assertEqual(o["setupReasonCode"], "ENTRY_NOT_READY")
        self.assertEqual(o["authorizedAccounts"], 0)
        self.assertNotEqual(a["state"], "AUTHORIZED")

    def test_long_geometry_and_score(self):
        o, _ = only(run([eur_long()], [acct()]))
        g = o["geometry"]
        self.assertEqual(o["setupState"], "QUALIFIED")
        self.assertAlmostEqual(g["entry"], 1.10006)
        self.assertAlmostEqual(g["stopLoss"], 1.09790)           # invalidation - 0.1 ATR
        self.assertAlmostEqual(g["takeProfit"], 1.10595)         # H8 upper - 0.05 ATR
        self.assertAlmostEqual(g["rewardRisk"], 2.67, places=2)  # includes the slippage allowance
        self.assertGreater(o["score"], 70)
        self.assertEqual(o["gates"]["target"]["status"], "PASS")

    def test_short_stop_includes_spread(self):
        o, _ = only(run([xau_short()], [acct()]))
        g = o["geometry"]
        self.assertEqual(o["setupState"], "QUALIFIED")
        self.assertAlmostEqual(g["entry"], 4290.00)
        self.assertAlmostEqual(g["stopLoss"], 4312.00)            # 4310 + 1.6 buffer + 0.4 spread
        self.assertAlmostEqual(g["takeProfit"], 4230.80)
        self.assertGreater(g["rewardRisk"], 2.0)

    def test_stale_h1_expired_setup_and_stale_price(self):
        o, a = only(run([eur_long(h1LastTs=NOW - 3600 - 200 * 60)], [acct()]))
        self.assertEqual((o["state"], o["reasonCode"]), ("STALE", "STAGE7_STALE"))
        self.assertEqual(a["state"], "STALE")
        o, _ = only(run([eur_long(confirmedSince=risk.iso(NOW - 300 * 60))], [acct()]))
        self.assertEqual((o["state"], o["reasonCode"]), ("EXPIRED", "SETUP_EXPIRED"))
        o, _ = only(run([eur_long()], [acct()], m=market({"EURUSD": {"time": NOW - 900}})))
        self.assertEqual((o["state"], o["reasonCode"]), ("STALE", "PRICE_STALE"))

    def test_spread_and_slippage_deterioration(self):
        o, _ = only(run([eur_long()], [acct()], m=market({"EURUSD": {"ask": 1.10040}})))
        self.assertEqual((o["setupState"], o["setupReasonCode"]), ("WAITING", "SPREAD_TOO_WIDE"))
        o, _ = only(run([eur_long()], [acct()], config=cfg(slippageAtr=1.0)))
        self.assertEqual((o["setupState"], o["setupReasonCode"]), ("WAITING", "RR_BELOW_MIN"))

    def test_setup_materially_changed(self):
        o, _ = only(run([eur_long()], [acct()], m=market({"EURUSD": {"bid": 1.10120, "ask": 1.10126}})))
        self.assertEqual((o["setupState"], o["setupReasonCode"]), ("WAITING", "SETUP_CHANGED"))

    def test_price_beyond_invalidation_and_missing_target(self):
        o, _ = only(run([eur_long()], [acct()], m=market({"EURUSD": {"bid": 1.09790, "ask": 1.09796}})))
        self.assertEqual((o["state"], o["reasonCode"]), ("RISK_BLOCKED", "SL_INVALID"))
        o, _ = only(run([eur_long(boundaries={})], [acct()]))
        self.assertEqual((o["state"], o["reasonCode"]), ("RISK_BLOCKED", "NO_STRUCTURAL_TARGET"))

    def test_missing_spec_fails_closed(self):
        o, _ = only(run([eur_long()], [acct()], m=market({"EURUSD": {"spec": {}}})))
        self.assertEqual((o["state"], o["reasonCode"]), ("STALE", "SPEC_UNAVAILABLE"))


class AccountQualification(unittest.TestCase):
    def test_long_authorized_with_broker_valid_size(self):
        res = run([eur_long()], [acct()])
        o, a = only(res)
        self.assertEqual((a["state"], o["state"]), ("AUTHORIZED", "AUTHORIZED"))
        self.assertAlmostEqual(a["sizing"]["lossPerLot"], 221.0, places=1)
        self.assertAlmostEqual(a["sizing"]["volume"], 0.45)
        self.assertLessEqual(a["sizing"]["riskPct"], 1.0)
        auth = res["authorizations"][0]
        self.assertTrue(auth["executionId"].startswith("EX-"))
        self.assertEqual((auth["direction"], auth["volume"], auth["stopLoss"], auth["takeProfit"]), ("BUY", 0.45, 1.0979, 1.10595))
        self.assertEqual(auth["entryPolicy"]["type"], "MARKET")
        self.assertFalse(auth["executes"])
        self.assertEqual(auth["source"]["stage"], 7)

    def test_short_authorized(self):
        o, a = only(run([xau_short()], [acct()]))
        self.assertEqual(a["state"], "AUTHORIZED")
        self.assertAlmostEqual(a["sizing"]["volume"], 0.04)
        self.assertEqual(a["authorization"]["direction"], "SELL")

    def test_paused_keeps_analysis_but_never_authorizes(self):
        res = run([eur_long()], [acct()], auto=False)
        o, a = only(res)
        self.assertEqual((a["state"], a["reasonCode"]), ("QUALIFIED", "TRADING_PAUSED"))
        self.assertEqual(res["authorizations"], [])
        self.assertAlmostEqual(a["sizing"]["volume"], 0.45)

    def test_trading_disabled_analysis_only_and_approval(self):
        _, a = only(run([eur_long()], [acct(tradingEnabled=False)]))
        self.assertEqual((a["state"], a["reasonCode"]), ("ACCOUNT_BLOCKED", "TRADING_DISABLED"))
        self.assertAlmostEqual(a["sizing"]["volume"], 0.45)  # hypothetical size still shown
        _, a = only(run([eur_long()], [acct(tradingMode="ANALYSIS_ONLY")]))
        self.assertEqual(a["reasonCode"], "ANALYSIS_ONLY")
        res = run([eur_long()], [acct(tradingMode="APPROVAL_REQUIRED")])
        self.assertEqual(only(res)[1]["reasonCode"], "AWAITING_APPROVAL")
        key = only(res)[0]["setupKey"]
        _, a = only(run([eur_long()], [acct(tradingMode="APPROVAL_REQUIRED")], approvals={(key, "demo")}))
        self.assertEqual(a["state"], "AUTHORIZED")

    def test_ngn_account_converts_with_validated_rate(self):
        res = run([eur_long()], [acct("ngn", ccy="NGN", equity=15_500_000.0)])
        _, a = only(res)
        self.assertEqual(a["state"], "AUTHORIZED")
        self.assertAlmostEqual(a["sizing"]["lossPerLot"], 221.0 * 1550, places=0)
        self.assertAlmostEqual(a["sizing"]["volume"], 0.45)
        self.assertEqual(res["authorizations"][0]["riskCurrency"], "NGN")

    def test_ngn_account_without_rate_fails_closed(self):
        rates = {k: v for k, v in RATES.items() if "NGN" not in k}
        _, a = only(run([eur_long()], [acct("ngn", ccy="NGN", equity=15_500_000.0)], fx=fx_from(rates)))
        self.assertEqual((a["state"], a["reasonCode"]), ("ACCOUNT_BLOCKED", "FX_UNAVAILABLE"))

    def test_account_disconnected_or_missing_info(self):
        _, a = only(run([eur_long()], [acct(live=False, snapshotAt=NOW - 3600)]))
        self.assertEqual((a["state"], a["reasonCode"]), ("ACCOUNT_BLOCKED", "ACCOUNT_DISCONNECTED"))
        _, a = only(run([eur_long()], [acct(state="DISCONNECTED")]))
        self.assertEqual(a["reasonCode"], "ACCOUNT_DISCONNECTED")
        _, a = only(run([eur_long()], [acct(equity=None, balance=None)]))
        self.assertEqual((a["state"], a["reasonCode"]), ("ACCOUNT_BLOCKED", "ACCOUNT_INFO_MISSING"))

    def test_insufficient_margin(self):
        _, a = only(run([eur_long()], [acct(margin=9500.0, freeMargin=500.0)]))
        self.assertEqual((a["state"], a["reasonCode"]), ("MARGIN_BLOCKED", "INSUFFICIENT_MARGIN"))

    def test_broker_margin_used_for_attached_account(self):
        _, a = only(run([eur_long()], [acct()], terminalCurrency="USD", brokerMargin={("EURUSD", "BUY"): 1100.0}))
        self.assertEqual(a["sizing"]["marginMethod"], "BROKER")
        self.assertAlmostEqual(a["sizing"]["marginRequired"], 495.0)

    def test_daily_loss_drawdown_and_unknown_baseline(self):
        _, a = only(run([eur_long(confidence=100)], [acct(dayStartEquity=10400.0)]))
        self.assertEqual((a["state"], a["reasonCode"]), ("RISK_BLOCKED", "DAILY_LOSS_LIMIT"))  # a high score never overrides it
        _, a = only(run([eur_long()], [acct(peakEquity=11200.0)]))
        self.assertEqual((a["state"], a["reasonCode"]), ("RISK_BLOCKED", "DRAWDOWN_LIMIT"))
        _, a = only(run([eur_long()], [acct(dayStartEquity=None)]))
        self.assertEqual((a["state"], a["reasonCode"]), ("RISK_BLOCKED", "DAILY_BASELINE_UNKNOWN"))

    def test_open_position_without_stop_blocks(self):
        _, a = only(run([eur_long()], [acct(positions=[position("GBPUSD", "BUY", 0.1, 1.3, None)])]))
        self.assertEqual((a["state"], a["reasonCode"]), ("RISK_BLOCKED", "OPEN_RISK_UNKNOWN"))

    def test_min_volume_exceeds_risk_and_tick_value_mismatch(self):
        _, a = only(run([eur_long()], [acct(equity=100.0)]))
        self.assertEqual((a["state"], a["reasonCode"]), ("RISK_BLOCKED", "MIN_VOLUME_EXCEEDS_RISK"))
        m = market({"EURUSD": {"spec": spec("EURUSD", tickValue=2.0)}})
        _, a = only(run([eur_long()], [acct()], m=m, terminalCurrency="USD"))
        self.assertEqual((a["state"], a["reasonCode"]), ("RISK_BLOCKED", "TICK_VALUE_MISMATCH"))

    def test_symbol_trade_mode(self):
        m = market({"EURUSD": {"spec": spec("EURUSD", tradeMode=3)}})
        _, a = only(run([eur_long()], [acct()], m=m))
        self.assertEqual((a["state"], a["reasonCode"]), ("ACCOUNT_BLOCKED", "SYMBOL_NOT_TRADABLE"))


USD_SHORTS = [position("EURUSD", "BUY", 0.1, 1.1000, 1.0940), position("GBPUSD", "BUY", 0.1, 1.3000, 1.2940),
              position("AUDUSD", "BUY", 0.1, 0.6600, 0.6540)]  # 0.6% risk each = 1.8% short USD


class PortfolioRisk(unittest.TestCase):
    def test_usd_concentration_blocks_fourth_usd_short(self):
        _, a = only(run([xau_short(direction="BULLISH", invalidationLevel=4270.0, entryContext={**xau_short()["entryContext"], "lastClose": 4288.0},
                                   boundaries={"H8": {"lower": 4230.0, "upper": 4350.0}})],
                        [acct(positions=USD_SHORTS)], config=cfg(maxClusterRiskPct=10.0, maxConcurrentPositions=5)))
        self.assertEqual((a["state"], a["reasonCode"]), ("EXPOSURE_BLOCKED", "CURRENCY_CONCENTRATION"))
        self.assertIn("USD", a["reason"])
        usd = next(c for c in a["exposure"]["currencies"] if c["currency"] == "USD")
        self.assertAlmostEqual(usd["net"], -1.8, places=2)  # short-USD exposure seen as the same risk

    def test_correlated_cluster_blocks(self):
        corr = {("XAUUSD", "EURUSD"): 0.78, ("XAUUSD", "GBPUSD"): 0.74, ("XAUUSD", "AUDUSD"): 0.81}
        h = xau_short(direction="BULLISH", invalidationLevel=4270.0, entryContext={**xau_short()["entryContext"], "lastClose": 4288.0},
                      boundaries={"H8": {"lower": 4230.0, "upper": 4350.0}})
        _, a = only(run([h], [acct(positions=USD_SHORTS)], config=cfg(maxCurrencyRiskPct=10.0, maxConcurrentPositions=5), corr=corr))
        self.assertEqual((a["state"], a["reasonCode"]), ("CORRELATION_BLOCKED", "CORRELATED_CLUSTER"))
        self.assertEqual(len(a["exposure"]["cluster"]), 3)

    def test_size_shrinks_to_fit_headroom(self):
        _, a = only(run([xau_short()], [acct(positions=USD_SHORTS[:2])], config=cfg(maxPortfolioRiskPct=1.9)))
        self.assertEqual(a["state"], "AUTHORIZED")
        self.assertLessEqual(a["sizing"]["riskPct"], 0.7 + 1e-9)

    def test_in_run_allocation_sees_earlier_authorization(self):
        gbp = eur_long(instrument="GBPUSD", invalidationLevel=1.2980, entryContext={**eur_long()["entryContext"], "triggerTs": 1790007200, "lastClose": 1.2998},
                       boundaries={"H8": {"lower": 1.29, "upper": 1.3070}})
        res = run([eur_long(), gbp], [acct()], config=cfg(maxCurrencyRiskPct=1.4))
        states = {o["symbol"]: o["accounts"][0]["state"] for o in res["opportunities"]}
        self.assertEqual(sorted(states.values()), ["AUTHORIZED", "EXPOSURE_BLOCKED"])
        self.assertEqual(len(res["authorizations"]), 1)

    def test_max_positions_and_same_symbol(self):
        _, a = only(run([eur_long()], [acct(maxConcurrentTrades=1, positions=[position("AUDUSD", "SELL", 0.01, 0.66, 0.67)])]))
        self.assertEqual((a["state"], a["reasonCode"]), ("EXPOSURE_BLOCKED", "MAX_POSITIONS"))
        _, a = only(run([eur_long()], [acct(positions=[position("EURUSD", "BUY", 0.01, 1.1, 1.09)])]))
        self.assertEqual(a["reasonCode"], "SYMBOL_ALREADY_EXPOSED")


def prop(**kw) -> dict:
    r = {"phase": "CHALLENGE", "accountSize": 10000, "dailyLossLimitPct": 5, "maxLossLimitPct": 10, "profitTargetPct": 8, "newsTrading": True,
         "weekendHolding": True, "overnightHolding": True}
    r.update(kw)
    return r


class PropRules(unittest.TestCase):
    def test_prop_account_within_rules_authorized(self):
        _, a = only(run([eur_long()], [acct("prop", cls="PROP", propRules=prop())]))
        self.assertEqual(a["state"], "AUTHORIZED")
        self.assertIn("dailyLoss", a["prop"]["headroom"])

    def test_prop_daily_loss_headroom(self):
        _, a = only(run([eur_long()], [acct("prop", cls="PROP", equity=9540.0, dayStartEquity=10000.0, peakEquity=10000.0, propRules=prop())],
                        config=cfg(maxDailyLossPct=10.0)))
        self.assertEqual((a["state"], a["reasonCode"]), ("PROP_RULE_BLOCKED", "PROP_DAILY_LOSS"))

    def test_prop_rules_missing_or_incomplete(self):
        _, a = only(run([eur_long()], [acct("prop", cls="PROP")]))
        self.assertEqual((a["state"], a["reasonCode"]), ("PROP_RULE_BLOCKED", "PROP_RULES_MISSING"))
        _, a = only(run([eur_long()], [acct("prop", cls="PROP", propRules={"phase": "FUNDED"})]))
        self.assertEqual(a["reasonCode"], "PROP_RULES_INCOMPLETE")

    def test_news_rule(self):
        _, a = only(run([eur_long()], [acct("prop", cls="PROP", propRules=prop(newsTrading=False))]))
        self.assertEqual((a["state"], a["reasonCode"]), ("PROP_RULE_BLOCKED", "NEWS_RULE_UNVERIFIABLE"))
        cal = {"mode": "MANUAL", "events": [{"time": risk.iso(NOW + 600), "currencies": ["USD"], "title": "CPI", "impact": "HIGH"}]}
        _, a = only(run([eur_long()], [acct("prop", cls="PROP", propRules=prop(newsTrading=False))], config=cfg(newsCalendar=cal)))
        self.assertEqual(a["reasonCode"], "NEWS_BLACKOUT")
        _, a = only(run([eur_long()], [acct("prop", cls="PROP", propRules=prop(newsTrading=False))],
                        config=cfg(newsCalendar={"mode": "MANUAL", "events": []})))
        self.assertEqual(a["state"], "AUTHORIZED")

    def test_weekend_overnight_and_prohibited_window(self):
        friday = datetime(2026, 9, 25, 20, 0, tzinfo=timezone.utc).timestamp()
        h = eur_long(h1LastTs=friday - 3600 - 600, confirmedSince=risk.iso(friday - 1800))
        m = market({"EURUSD": {"time": friday - 5}})
        _, a = only(risk.evaluate([h], [acct("prop", cls="PROP", snapshotAt=friday, propRules=prop(weekendHolding=False))], m, FX, cfg(), ctx(now=friday)))
        self.assertEqual(a["reasonCode"], "WEEKEND_RULE")
        _, a = only(risk.evaluate([h], [acct("prop", cls="PROP", snapshotAt=friday, propRules=prop(overnightHolding=False))], m, FX, cfg(), ctx(now=friday)))
        self.assertEqual(a["reasonCode"], "OVERNIGHT_RULE")
        _, a = only(run([eur_long()], [acct("prop", cls="PROP", propRules=prop(prohibitedWindows=[{"start": "11:30", "end": "12:30", "label": "London fix"}]))]))
        self.assertEqual(a["reasonCode"], "PROHIBITED_PERIOD")

    def test_consistency_rule(self):
        _, a = only(run([eur_long()], [acct("prop", cls="PROP", dayPnl=200.0, propRules=prop(consistencyRulePct=30))]))
        self.assertEqual((a["state"], a["reasonCode"]), ("PROP_RULE_BLOCKED", "CONSISTENCY_RULE"))

    def test_each_account_evaluated_independently(self):
        accounts = [acct("demo"), acct("live", cls="LIVE", tradingEnabled=False), acct("prop", cls="PROP", propRules=prop(newsTrading=False)),
                    acct("ngn", ccy="NGN", equity=15_500_000.0)]
        res = run([eur_long()], accounts)
        o = res["opportunities"][0]
        states = {e["accountId"]: e["reasonCode"] for e in o["accounts"]}
        self.assertEqual(states, {"demo": "AUTHORIZED", "ngn": "AUTHORIZED", "live": "TRADING_DISABLED", "prop": "NEWS_RULE_UNVERIFIABLE"})
        self.assertEqual((o["eligibleAccounts"], o["authorizedAccounts"]), (2, 2))
        self.assertEqual(len({a["executionId"] for a in res["authorizations"]}), 2)


class Authorization(unittest.TestCase):
    def test_duplicate_authorization_is_suppressed(self):
        first = run([eur_long()], [acct()])
        auth = first["authorizations"][0]
        again = run([eur_long()], [acct()], pending=[auth], attempts={(auth["setupKey"], "demo"): 1})
        _, a = only(again)
        self.assertEqual((a["state"], a["reasonCode"]), ("AUTHORIZED", "ALREADY_AUTHORIZED"))
        self.assertEqual(again["authorizations"], [])
        retry = run([eur_long()], [acct()], attempts={(auth["setupKey"], "demo"): 1})  # previous one expired
        self.assertNotEqual(retry["authorizations"][0]["executionId"], auth["executionId"])
        self.assertEqual(retry["authorizations"][0]["attempt"], 2)

    def test_execution_id_is_deterministic(self):
        a = run([eur_long()], [acct()])["authorizations"][0]["executionId"]
        b = run([eur_long()], [acct()])["authorizations"][0]["executionId"]
        self.assertEqual(a, b)

    def test_revocations(self):
        auth = run([eur_long()], [acct()])["authorizations"][0]
        res = run([eur_long(h1LastTs=NOW - 3600 - 400 * 60)], [acct()], pending=[auth])
        self.assertEqual([r["executionId"] for r in res["revocations"]], [auth["executionId"]])
        res = run([], [acct()], pending=[auth])
        self.assertIn("no longer confirms", res["revocations"][0]["reason"])
        res = run([eur_long()], [acct()], pending=[auth], auto=False)
        self.assertIn("PAUSED", res["revocations"][0]["reason"])

    def test_pending_authorization_counts_as_exposure(self):
        auth = run([eur_long()], [acct()])["authorizations"][0]
        gbp = eur_long(instrument="GBPUSD", invalidationLevel=1.2980, entryContext={**eur_long()["entryContext"], "triggerTs": 1790007200, "lastClose": 1.2998},
                       boundaries={"H8": {"lower": 1.29, "upper": 1.3070}})
        res = run([gbp], [acct()], pending=[auth], config=cfg(maxCurrencyRiskPct=1.4))
        self.assertEqual(only(res)[1]["reasonCode"], "CURRENCY_CONCENTRATION")

    def test_stage9_handed_off_setup_is_never_reauthorized(self):
        auth = run([eur_long()], [acct()])["authorizations"][0]
        key = (auth["setupKey"], "demo")
        for status, state, code in (("CONSUMED", "AUTHORIZED", "EXECUTED_BY_STAGE9"), ("DECLINED", "ACCOUNT_BLOCKED", "STAGE9_DECLINED")):
            res = run([eur_long()], [acct()], attempts={key: 1},
                      handedOff={key: {"status": status, "executionId": auth["executionId"], "orderState": "FILLED", "positionState": "OPEN"}})
            _, a = only(res)
            self.assertEqual((a["state"], a["reasonCode"]), (state, code))
            self.assertEqual(res["authorizations"], [])
            self.assertEqual(res["revocations"], [])

    def test_stage9_inflight_execution_counts_as_committed_risk(self):
        auth = run([eur_long()], [acct()])["authorizations"][0]
        gbp = eur_long(instrument="GBPUSD", invalidationLevel=1.2980, entryContext={**eur_long()["entryContext"], "triggerTs": 1790007200, "lastClose": 1.2998},
                       boundaries={"H8": {"lower": 1.29, "upper": 1.3070}})
        res = run([gbp], [acct()], inflight=[{**auth, "status": "CONSUMED", "inFlight": True}], config=cfg(maxCurrencyRiskPct=1.4))
        self.assertEqual(only(res)[1]["reasonCode"], "CURRENCY_CONCENTRATION")
        self.assertEqual(res["revocations"], [])   # an in-flight execution is never revoked by Stage 8


class Config(unittest.TestCase):
    def test_validation_and_hash(self):
        c, errors = risk.merge_config({"riskPerTradePct": 9})
        self.assertTrue(errors)
        c, errors = risk.merge_config({"riskPerTradePct": 2, "maxPortfolioRiskPct": 1})
        self.assertIn("riskPerTradePct cannot exceed maxPortfolioRiskPct", errors)
        c, errors = risk.merge_config({"newsCalendar": {"mode": "MANUAL", "events": [{"time": "bad", "currencies": ["USD"]}]}})
        self.assertTrue(errors)
        a, _ = risk.merge_config({"riskPerTradePct": 0.5})
        b, _ = risk.merge_config({})
        self.assertNotEqual(risk.config_hash(a), risk.config_hash(b))
        self.assertEqual((b["riskPerTradePct"], b["maxPortfolioRiskPct"]), (1.0, 3.0))

    def test_config_change_does_not_alter_issued_authorization(self):
        auth = run([eur_long()], [acct()])["authorizations"][0]
        frozen = copy.deepcopy(auth)
        res = run([eur_long()], [acct()], config=cfg(riskPerTradePct=0.25), pending=[auth], configHash="cfg2")
        self.assertEqual(only(res)[1]["reasonCode"], "ALREADY_AUTHORIZED")
        self.assertEqual(auth, frozen)


class AutonomousService(unittest.TestCase):
    def setUp(self):
        self.handoffs = [eur_long()]
        self.accounts = [acct()]
        self.auto = True
        self.m = market()
        self.pending: list[dict] = []
        self.attempts: dict = {}
        self.persisted: list = []
        self.changes: list = []

        def inputs():
            return {"now": NOW, "cfg": cfg(), "handoffs": copy.deepcopy(self.handoffs), "stage7": {}, "accounts": copy.deepcopy(self.accounts),
                    "live": {"currency": "USD", "equity": 10000}, "terminalAccount": "demo", "market": copy.deepcopy(self.m), "fx": FX,
                    "brokerMargin": {}, "corr": {}, "auto": self.auto, "h1Meta": {"status": "HEALTHY"}, "pending": list(self.pending),
                    "attempts": dict(self.attempts), "approvals": set()}

        def persist(result, meta, triggers, prev, stage7, exp):
            self.persisted.append((result, list(triggers)))
            for a in result["authorizations"]:
                self.pending.append(a)
                self.attempts[(a["setupKey"], a["accountId"])] = a["attempt"]
            revoked = [r["executionId"] for r in result["revocations"]]
            self.pending = [p for p in self.pending if p["executionId"] not in revoked]
            return {"changed": 1, "created": [a["executionId"] for a in result["authorizations"]], "revoked": revoked, "expired": [], "runId": 1}

        self.patches = [
            mock.patch.object(risk_service, "_economic_gate", lambda: {"EURUSD": {"blocks": False, "reason": "clear", "factor": 1.0}}),
            mock.patch.object(risk_service.rs, "persist", persist),
            mock.patch.object(risk_service.rs, "save_meta", lambda m: None),
            mock.patch.object(risk_service.rs, "previous_opportunities", lambda: {}),
            mock.patch.object(risk_service.rs, "record_balance", lambda a, s: None),
        ]
        for p in self.patches:
            p.start()
        self.svc = risk_service.RiskService(None, lambda: 0, on_change=self.changes.append)
        self.svc.inputs = inputs

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_stage7_confirmed_to_authorized_once(self):
        self.svc.mark("STARTUP")
        r = self.svc.tick()
        self.assertTrue(r["ran"])
        self.assertEqual(len(r["created"]), 1)
        self.assertEqual(self.changes[-1]["created"], r["created"])
        self.assertEqual(self.svc.meta["counters"]["authorized"], 1)
        r = self.svc.tick()  # nothing changed: no run, no duplicate
        self.assertFalse(r["ran"])
        self.svc.mark("PERIODIC")
        r = self.svc.tick()
        self.assertEqual(r["created"], [])
        o = self.persisted[-1][0]["opportunities"][0]
        self.assertEqual(o["accounts"][0]["reasonCode"], "ALREADY_AUTHORIZED")

    def test_events_trigger_reevaluation(self):
        self.svc.mark("STARTUP")
        self.svc.tick()
        self.m["EURUSD"].update({"bid": 1.10030, "ask": 1.10036})
        self.assertIn("PRICE_MOVE EURUSD", self.svc.tick()["triggers"])
        self.m["EURUSD"].update({"ask": 1.10050})
        self.assertIn("SPREAD_CHANGE EURUSD", self.svc.tick()["triggers"])
        self.accounts[0]["equity"] = 9800.0
        self.assertTrue(any(t.startswith("ACCOUNT_EQUITY_MARGIN_CHANGE") for t in self.svc.tick()["triggers"]))
        self.accounts[0]["positions"] = [position("AUDUSD", "SELL", 0.01, 0.66, 0.67)]
        self.assertTrue(any(t.startswith("POSITIONS_CHANGE") for t in self.svc.tick()["triggers"]))
        self.accounts[0]["tradingMode"] = "ANALYSIS_ONLY"
        self.assertTrue(any(t.startswith("ACCOUNT_CONFIG_CHANGE") for t in self.svc.tick()["triggers"]))

    def test_pause_revokes_pending_and_stage7_withdrawal(self):
        self.svc.mark("STARTUP")
        first = self.svc.tick()
        self.auto = False
        r = self.svc.tick()
        self.assertIn("TRADING_PAUSED", r["triggers"])
        self.assertEqual(r["revoked"], first["created"])
        self.auto = True
        self.handoffs = []
        r = self.svc.tick()
        self.assertIn("STAGE7_HANDOFF_CHANGE", r["triggers"])
        self.assertEqual(self.persisted[-1][0]["opportunities"], [])


if __name__ == "__main__":
    unittest.main()
