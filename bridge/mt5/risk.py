"""Stage 8 Opportunities & Risk — pure qualification, portfolio-risk and account-eligibility engine.

Input: Stage 7 CONFIRMED hand-offs only. Two separate questions are answered for every hand-off:

1. Setup qualification (account-agnostic) — is the confirmed setup still technically tradeable right now?
   Stage 7 freshness + confidence, setup expiry, live price freshness, broker contract spec, structural stop beyond the
   Stage 7 invalidation, structural target from the persisted Stage 5 D1/H8 channel boundaries, stop distance in ATR,
   reward:risk, spread/slippage allowance and drift since confirmation ("has the original setup materially changed?").

2. Account qualification (per enabled Demo / Live / Prop account) — is THIS account allowed to take it, and at what size?
   Account connectivity + snapshot freshness, FX conversion, symbol trade mode, open risk of existing positions, daily
   loss / drawdown safety, prop-firm rules from the account's stored profile, portfolio / currency / correlated-cluster
   headroom, broker-valid position size, free margin, then permission (trading enabled, trading mode, approval) and the
   global PAUSED switch.

Only when every mandatory gate passes is an immutable, idempotent execution authorization produced for Stage 9.
Stage 8 never submits orders. Every missing or uncertain input fails closed with the exact reason.

Counter-trend, reversal, breakout and range trades use the trade-type policy in leg_model. That policy
can only be stricter than the global minimums. Prop-firm and account limits stay absolute.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import leg_model

CONFIG: dict[str, Any] = {
    # per-trade risk
    "riskPerTradePct": 1.0,          # target risk per trade, % of the risk basis
    "riskBasis": "MIN_BALANCE_EQUITY",  # EQUITY | BALANCE | MIN_BALANCE_EQUITY
    "minRiskFraction": 0.5,          # size may shrink to fit headroom, but never below this fraction of the target
    # portfolio
    "maxPortfolioRiskPct": 3.0,      # open + pending + proposed risk
    "maxCurrencyRiskPct": 2.0,       # |net signed risk| per currency / XAU
    "maxClusterRiskPct": 2.0,        # risk of positions correlated with the proposal (incl. proposal)
    "correlationThreshold": 0.7,     # signed D1-return correlation that makes two exposures one cluster
    "correlationLookback": 60,       # D1 returns
    "maxConcurrentPositions": 3,     # per account (the account's own maxConcurrentTrades also applies)
    "allowSameSymbol": False,
    # system safety
    "maxDailyLossPct": 3.0,          # realized + floating loss today, plus open risk, vs day-start equity
    "maxDrawdownPct": 10.0,          # from peak equity, plus open risk
    "minMarginLevelPct": 300.0,
    "maxMarginUsePct": 30.0,         # margin in use after the trade, % of equity
    "marginFormulaBuffer": 1.5,      # multiplier when the broker margin calculation is unavailable for the account
    "propSafetyPct": 10.0,           # only (100 - x)% of any prop-rule headroom may be consumed
    # setup qualification
    "minConfidence": 65.0,
    "minSetupScore": 55.0,
    "minRR": 2.0,
    "minStopAtr": 0.3,
    "maxStopAtr": 6.0,
    "slBufferAtr": 0.1,              # stop placed this far beyond the Stage 7 invalidation
    "tpBufferAtr": 0.05,             # target placed this far inside the opposing boundary
    "minTargetAtr": 0.5,
    "slippageAtr": 0.05,             # slippage allowance added to the stop distance for sizing / R:R
    "maxSpreadAtr": 0.25,
    "maxSpreadStopPct": 15.0,
    "maxDriftAtr": 1.0,              # price may not have run more than this from the Stage 7 confirmation close
    "setupTtlMin": 240,              # a Stage 7 confirmation older than this is EXPIRED
    "h1MaxAgeMin": 150,              # last closed H1 bar older than this (after its close) is STALE
    "maxTickAgeSec": 180,
    "fxMaxAgeSec": 600,
    "accountMaxAgeSec": 180,
    "authTtlSec": 300,               # authorization validity for Stage 9
    "maxEntryDeviationAtr": 0.1,
    # time rules used by prop profiles
    "weekendCutoffHours": 2.0,
    "overnightCutoffUtcHour": 20,
    "newsWindowMin": 30,
    "newsCalendar": {"mode": "NONE", "events": []},  # NONE = no verified calendar source; MANUAL = operator-maintained list
}

BOUNDS: dict[str, tuple[float, float]] = {
    "riskPerTradePct": (0.05, 5.0), "minRiskFraction": (0.1, 1.0), "maxPortfolioRiskPct": (0.1, 20.0),
    "maxCurrencyRiskPct": (0.1, 20.0), "maxClusterRiskPct": (0.1, 20.0), "correlationThreshold": (0.3, 0.99),
    "correlationLookback": (20, 250), "maxConcurrentPositions": (1, 50), "maxDailyLossPct": (0.1, 50.0),
    "maxDrawdownPct": (0.5, 90.0), "minMarginLevelPct": (100.0, 5000.0), "maxMarginUsePct": (1.0, 100.0),
    "marginFormulaBuffer": (1.0, 5.0), "propSafetyPct": (0.0, 50.0), "minConfidence": (0.0, 100.0),
    "minSetupScore": (0.0, 100.0), "minRR": (0.5, 10.0), "minStopAtr": (0.05, 5.0), "maxStopAtr": (0.5, 20.0),
    "slBufferAtr": (0.0, 2.0), "tpBufferAtr": (0.0, 2.0), "minTargetAtr": (0.0, 10.0), "slippageAtr": (0.0, 2.0),
    "maxSpreadAtr": (0.01, 2.0), "maxSpreadStopPct": (1.0, 100.0), "maxDriftAtr": (0.1, 10.0), "setupTtlMin": (15, 2880),
    "h1MaxAgeMin": (60, 1440), "maxTickAgeSec": (5, 3600), "fxMaxAgeSec": (5, 86400), "accountMaxAgeSec": (5, 3600),
    "authTtlSec": (30, 3600), "maxEntryDeviationAtr": (0.01, 2.0), "weekendCutoffHours": (0.0, 24.0),
    "overnightCutoffUtcHour": (0, 23), "newsWindowMin": (0, 240),
}
ENUMS = {"riskBasis": ("EQUITY", "BALANCE", "MIN_BALANCE_EQUITY")}
INT_KEYS = {"correlationLookback", "maxConcurrentPositions", "setupTtlMin", "h1MaxAgeMin", "maxTickAgeSec", "fxMaxAgeSec",
            "accountMaxAgeSec", "authTtlSec", "overnightCutoffUtcHour", "newsWindowMin"}
CRITICAL_KEYS = {"riskPerTradePct", "maxPortfolioRiskPct", "maxCurrencyRiskPct", "maxClusterRiskPct", "maxConcurrentPositions",
                 "maxDailyLossPct", "maxDrawdownPct", "minMarginLevelPct", "minRR", "riskBasis", "allowSameSymbol"}

STATES = ("EVALUATING", "QUALIFIED", "WAITING", "RISK_BLOCKED", "CORRELATION_BLOCKED", "EXPOSURE_BLOCKED", "ACCOUNT_BLOCKED",
          "PROP_RULE_BLOCKED", "MARGIN_BLOCKED", "STALE", "EXPIRED", "AUTHORIZED")
STATE_ORDER = ("AUTHORIZED", "QUALIFIED", "EVALUATING", "WAITING", "MARGIN_BLOCKED", "EXPOSURE_BLOCKED", "CORRELATION_BLOCKED",
               "RISK_BLOCKED", "PROP_RULE_BLOCKED", "ACCOUNT_BLOCKED", "STALE", "EXPIRED")

# MT5 SYMBOL_CALC_MODE_*: profit = price difference x contract size x lots for these modes.
LINEAR_CALC = (0, 2, 3, 4, 5)
TRADE_MODES = {0: "DISABLED", 1: "LONG_ONLY", 2: "SHORT_ONLY", 3: "CLOSE_ONLY", 4: "FULL"}


# ---------------------------------------------------------------- configuration

def merge_config(overrides: dict[str, Any] | None, base: dict[str, Any] | None = None) -> tuple[dict[str, Any], list[str]]:
    """Validated configuration = defaults <- base <- overrides. Invalid values are rejected with the exact reason."""
    cfg = json.loads(json.dumps(CONFIG))
    errors: list[str] = []
    for src in (base or {}, overrides or {}):
        for k, v in src.items():
            if k not in CONFIG:
                errors.append(f"Unknown setting {k}")
                continue
            if k in BOUNDS:
                try:
                    x = float(v)
                except (TypeError, ValueError):
                    errors.append(f"{k} must be numeric")
                    continue
                lo, hi = BOUNDS[k]
                if not (lo <= x <= hi) or math.isnan(x):
                    errors.append(f"{k}={v} outside {lo}–{hi}")
                    continue
                cfg[k] = int(round(x)) if k in INT_KEYS else x
            elif k in ENUMS:
                if v not in ENUMS[k]:
                    errors.append(f"{k} must be one of {', '.join(ENUMS[k])}")
                    continue
                cfg[k] = v
            elif k == "allowSameSymbol":
                cfg[k] = bool(v)
            elif k == "newsCalendar":
                cal, err = _validate_calendar(v)
                if err:
                    errors.append(err)
                    continue
                cfg[k] = cal
    if cfg["riskPerTradePct"] > cfg["maxPortfolioRiskPct"]:
        errors.append("riskPerTradePct cannot exceed maxPortfolioRiskPct")
    if cfg["minStopAtr"] >= cfg["maxStopAtr"]:
        errors.append("minStopAtr must be below maxStopAtr")
    return cfg, errors


def _validate_calendar(v: Any) -> tuple[dict[str, Any], str | None]:
    if not isinstance(v, dict) or v.get("mode") not in ("NONE", "MANUAL"):
        return {}, "newsCalendar.mode must be NONE or MANUAL"
    events = []
    for e in v.get("events") or []:
        ts = parse_ts(e.get("time"))
        if ts is None:
            return {}, f"newsCalendar event has an invalid time: {e.get('time')}"
        cur = [str(c).upper()[:3] for c in (e.get("currencies") or []) if c]
        if not cur:
            return {}, "newsCalendar event needs at least one currency"
        events.append({"time": iso(ts), "currencies": cur, "title": str(e.get("title") or "")[:120], "impact": str(e.get("impact") or "HIGH")[:10]})
    return {"mode": v["mode"], "events": events}, None


def config_hash(cfg: dict[str, Any]) -> str:
    return hashlib.sha1(json.dumps(cfg, sort_keys=True, default=str).encode()).hexdigest()[:12]


# ---------------------------------------------------------------- helpers

def parse_ts(v: Any) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).timestamp()
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).timestamp()


def iso(ts: float | None) -> str | None:
    return None if ts is None else datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def dsign(direction: Any) -> int:
    s = str(direction or "").upper()
    return 1 if s.startswith("BULL") or s in ("BUY", "LONG") else -1 if s.startswith("BEAR") or s in ("SELL", "SHORT") else 0


def legs(symbol: str) -> tuple[str, str]:
    return symbol[:3].upper(), symbol[3:6].upper()


def signed_legs(symbol: str, d: int) -> dict[str, int]:
    base, quote = legs(symbol)
    return {base: d, quote: -d}


def setup_key(h: dict[str, Any]) -> str:
    ec = h.get("entryContext") or {}
    anchor = ec.get("triggerTs") or h.get("h1LastTs") or h.get("confirmedSince") or ""
    return f"{h.get('instrument')}|{str(h.get('direction') or '').upper()}|{anchor}"


def _g(status: str, detail: str, **kw: Any) -> dict[str, Any]:
    return {"status": status, "detail": detail, **kw}


def _r(x: float | None, n: int = 5) -> float | None:
    return None if x is None else round(float(x), n)


def _fmt(x: float | None, digits: int = 5) -> str:
    return "—" if x is None else f"{x:.{digits}f}"


def _floor_step(x: float, step: float) -> float:
    if step <= 0:
        return 0.0
    return math.floor(x / step + 1e-9) * step


def _round_price(p: float, tick: float, mode: str) -> float:
    if not tick or tick <= 0:
        return p
    q = p / tick
    q = math.floor(q + 1e-9) if mode == "down" else math.ceil(q - 1e-9) if mode == "up" else round(q)
    return round(q * tick, 10)


FxFn = Callable[[str, str], dict[str, Any]]


def fx_identity_ok(fx: FxFn, src: str, dst: str) -> dict[str, Any]:
    if src == dst:
        return {"ok": True, "rate": 1.0, "source": "identity", "age": 0}
    try:
        return fx(src, dst) or {"ok": False, "reason": f"No {src}→{dst} rate"}
    except Exception as exc:  # pragma: no cover
        return {"ok": False, "reason": f"{src}→{dst} conversion error: {exc}"}


# ---------------------------------------------------------------- 1. setup qualification (account-agnostic)

def _targets(h: dict[str, Any], d: int, entry: float, atr: float, cfg: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for tf in ("H8", "D1"):
        b = (h.get("boundaries") or {}).get(tf) or {}
        lvl = b.get("upper") if d > 0 else b.get("lower")
        if lvl is None:
            continue
        tp = float(lvl) - d * cfg["tpBufferAtr"] * atr
        if (tp - entry) * d >= cfg["minTargetAtr"] * atr:
            out.append({"label": f"{tf} {'upper' if d > 0 else 'lower'} boundary", "boundary": float(lvl), "price": tp, "timeframe": tf,
                        "layer": None, "reason": f"{tf} structural boundary in the trade direction"})
    out.sort(key=lambda t: (t["price"] - entry) * d)
    layers = ((h.get("marketLeg") or {}).get("targets") or [])
    for i, target in enumerate(out):
        if i < len(layers):
            target["layer"] = layers[i]["layer"]
            target["reason"] = layers[i]["reason"]
            target["destination"] = layers[i]["destination"]
        else:
            target["layer"] = "FINAL_STRUCTURAL_TARGET" if i == len(out) - 1 else f"TP{i + 1}"
    return out


def evaluate_setup(h: dict[str, Any], market: dict[str, dict[str, Any]], cfg: dict[str, Any], now: float) -> dict[str, Any]:
    sym = str(h.get("instrument") or "")
    d = dsign(h.get("direction"))
    key = setup_key(h)
    ec = h.get("entryContext") or {}
    atr = float(h.get("atr") or 0)
    conf = float(h.get("confidence") or 0)
    inv = h.get("invalidationLevel")
    m = market.get(sym) or {}
    spec = m.get("spec") or {}
    gates: dict[str, dict[str, Any]] = {}
    fails: list[tuple[str, str, str]] = []

    def fail(state: str, code: str, reason: str) -> None:
        fails.append((state, code, reason))

    # Stage 7 hand-off integrity
    if d == 0 or inv is None or h.get("executes") not in (False, None):
        gates["stage7"] = _g("FAIL", "Hand-off has no direction / invalidation")
        fail("RISK_BLOCKED", "INVALID_HANDOFF", "Stage 7 hand-off is missing its direction or invalidation level")
    else:
        gates["stage7"] = _g("PASS", f"Stage 7 CONFIRMED {h.get('direction')} · {ec.get('model', '').replace('_', ' ').lower()} · "
                                     f"{'CHoCH' if ec.get('trigger') == 'CHOCH' else 'BOS'} through {ec.get('triggerLevel')}")
    # confirmation confidence
    gates["confidence"] = _g("PASS" if conf >= cfg["minConfidence"] else "FAIL",
                             f"Stage 7 confidence {conf:.1f} (min {cfg['minConfidence']:.0f})", value=conf, limit=cfg["minConfidence"])
    if conf < cfg["minConfidence"]:
        fail("RISK_BLOCKED", "CONFIDENCE_BELOW_MIN", f"Stage 7 confidence {conf:.1f} is below the {cfg['minConfidence']:.0f} minimum")
    # expiry
    confirmed_at = parse_ts(h.get("confirmedSince"))
    expires_at = None if confirmed_at is None else confirmed_at + cfg["setupTtlMin"] * 60
    if expires_at is None:
        gates["expiry"] = _g("FAIL", "Confirmation time unknown")
        fail("STALE", "CONFIRMATION_TIME_UNKNOWN", "Stage 7 confirmation time is unknown — setup age cannot be verified")
    elif now > expires_at:
        gates["expiry"] = _g("FAIL", f"Confirmed {int((now - confirmed_at) / 60)} min ago (TTL {cfg['setupTtlMin']} min)")
        fail("EXPIRED", "SETUP_EXPIRED", f"Setup confirmed {int((now - confirmed_at) / 60)} min ago exceeded its {cfg['setupTtlMin']} min lifetime")
    else:
        gates["expiry"] = _g("PASS", f"Confirmed {int((now - confirmed_at) / 60)} min ago · expires in {int((expires_at - now) / 60)} min")
    # Stage 7 / H1 freshness
    h1_ts = h.get("h1LastTs")
    h1_age = None if h1_ts is None else now - (float(h1_ts) + 3600)
    if h1_age is None or h1_age > cfg["h1MaxAgeMin"] * 60 or str(h.get("freshness") or "").upper() not in ("", "FRESH", "READY"):
        gates["freshness"] = _g("FAIL", "Last closed H1 unknown" if h1_age is None else
                                f"Last closed H1 {int(h1_age / 60)} min old (max {cfg['h1MaxAgeMin']}) · {h.get('freshness') or 'n/a'}")
        fail("STALE", "STAGE7_STALE", "Stage 7 confirmation is based on stale H1 data" +
             ("" if h1_age is None else f" (last close {int(h1_age / 60)} min ago)"))
    else:
        gates["freshness"] = _g("PASS", f"Last closed H1 {max(0, int(h1_age / 60))} min ago · {h.get('freshness') or 'fresh'}")
    # live price
    bid, ask, t_ts = m.get("bid"), m.get("ask"), m.get("time")
    tick_age = None if t_ts is None else now - float(t_ts)
    price_ok = bool(bid and ask and ask >= bid and tick_age is not None and tick_age <= cfg["maxTickAgeSec"])
    if not price_ok:
        why = "no live quote" if not (bid and ask) else "quote time unverifiable" if tick_age is None else f"last quote {int(tick_age)} s old"
        gates["price"] = _g("FAIL", f"{why} (max {cfg['maxTickAgeSec']} s)")
        fail("STALE", "PRICE_STALE", f"Current market price unusable: {why}")
    else:
        gates["price"] = _g("PASS", f"Bid {bid} / ask {ask} · {int(tick_age)} s old")
    # broker contract spec
    spec_ok = bool(spec.get("tickSize") and spec.get("contractSize") and spec.get("volumeStep") and spec.get("volumeMin"))
    if not spec_ok:
        gates["spec"] = _g("FAIL", "Broker contract specification unavailable")
        fail("STALE", "SPEC_UNAVAILABLE", "Broker contract specification (tick size / contract size / volume limits) unavailable")
    elif int(spec.get("calcMode", 0)) not in LINEAR_CALC:
        gates["spec"] = _g("FAIL", f"Unsupported profit calculation mode {spec.get('calcMode')}")
        fail("RISK_BLOCKED", "SPEC_UNSUPPORTED", f"Profit calculation mode {spec.get('calcMode')} is not supported for risk sizing")
    else:
        gates["spec"] = _g("PASS", f"Contract {spec['contractSize']:g} · tick {spec['tickSize']:g} · lots {spec['volumeMin']:g}–{spec.get('volumeMax', 0):g} "
                                   f"step {spec['volumeStep']:g} · profit in {spec.get('currencyProfit')}")
    if atr <= 0:
        gates["atr"] = _g("FAIL", "H1 ATR unavailable")
        fail("RISK_BLOCKED", "ATR_UNAVAILABLE", "H1 ATR from Stage 7 is unavailable — stop distance cannot be validated")

    geo: dict[str, Any] = {"atr": _r(atr, 6), "bid": bid, "ask": ask, "tickAgeSec": None if tick_age is None else int(tick_age)}
    if d and inv is not None and price_ok and atr > 0:
        inv = float(inv)
        tick = float(spec.get("tickSize") or 0)
        spread = float(ask) - float(bid)
        mid = (float(ask) + float(bid)) / 2
        buf = cfg["slBufferAtr"] * atr
        if d > 0:
            entry = float(ask)
            sl = _round_price(inv - buf, tick, "down")
            beyond = float(bid) <= inv
        else:
            entry = float(bid)
            sl = _round_price(inv + buf + spread, tick, "up")
            beyond = float(ask) >= inv
        stop = (entry - sl) * d
        slip = cfg["slippageAtr"] * atr
        loss_unit = stop + slip
        targets = _targets(h, d, entry, atr, cfg)
        tp = _round_price(targets[0]["price"], tick, "down" if d > 0 else "up") if targets else None
        tp2 = _round_price(targets[1]["price"], tick, "down" if d > 0 else "up") if len(targets) > 1 else None
        rr = None if tp is None or loss_unit <= 0 else (tp - entry) * d / loss_unit
        ref = ec.get("lastClose")
        drift = None if ref is None else (mid - float(ref)) * d / atr
        stops_level = float(spec.get("stopsLevel") or 0) * float(spec.get("point") or 0)
        geo.update({
            "entry": _r(entry, 6), "stopLoss": _r(sl, 6), "takeProfit": _r(tp, 6), "takeProfit2": _r(tp2, 6),
            "stopDistance": _r(stop, 6), "stopAtr": _r(stop / atr, 3), "lossPerUnit": _r(loss_unit, 6), "slippage": _r(slip, 6),
            "spread": _r(spread, 6), "spreadAtr": _r(spread / atr, 3), "spreadStopPct": _r(100 * spread / stop, 2) if stop > 0 else None,
            "rewardRisk": _r(rr, 2), "driftAtr": _r(drift, 3), "referenceClose": ref, "invalidation": inv, "targets": targets,
            "mid": _r(mid, 6),
        })
        if beyond or stop <= 0:
            gates["invalidation"] = _g("FAIL", f"Price {_fmt(mid)} already beyond the Stage 7 invalidation {inv}")
            fail("RISK_BLOCKED", "SL_INVALID", f"Price is already beyond the structural invalidation {inv} — stop-loss would be invalid")
        else:
            gates["invalidation"] = _g("PASS", f"SL {sl} = invalidation {inv} ± {cfg['slBufferAtr']} ATR buffer"
                                               + (" + spread" if d < 0 else ""))
        if stop > 0:
            if stop < cfg["minStopAtr"] * atr or (stops_level and stop < stops_level):
                gates["stopDistance"] = _g("FAIL", f"Stop {stop / atr:.2f} ATR below {cfg['minStopAtr']} ATR"
                                           + (f" / broker stops level {stops_level:g}" if stops_level else ""))
                fail("RISK_BLOCKED", "STOP_TOO_TIGHT", f"Stop distance {stop / atr:.2f} ATR is inside market noise / broker stops level")
            elif stop > cfg["maxStopAtr"] * atr:
                gates["stopDistance"] = _g("WAIT", f"Stop {stop / atr:.2f} ATR above {cfg['maxStopAtr']} ATR")
                fail("WAITING", "STOP_TOO_WIDE", f"Stop distance {stop / atr:.2f} ATR exceeds {cfg['maxStopAtr']} ATR — waiting for a better entry")
            else:
                gates["stopDistance"] = _g("PASS", f"Stop {stop / atr:.2f} ATR ({_fmt(stop, 6)}) + slippage {cfg['slippageAtr']} ATR")
        if tp is None:
            gates["target"] = _g("FAIL", "No D1/H8 opposing boundary beyond the entry")
            fail("RISK_BLOCKED", "NO_STRUCTURAL_TARGET", "No structural target: no persisted D1/H8 opposing channel boundary beyond the entry")
        else:
            gates["target"] = _g("PASS", f"TP {tp} at the {targets[0]['label']} ({targets[0]['boundary']:.6g})"
                                         + (f" · TP2 {tp2} at {targets[1]['label']}" if tp2 else ""))
        if drift is None:
            gates["drift"] = _g("FAIL", "Stage 7 confirmation close unknown")
            fail("STALE", "REFERENCE_UNKNOWN", "Stage 7 confirmation close unknown — cannot verify the setup has not changed")
        else:
            ok = drift <= cfg["maxDriftAtr"]
            gates["drift"] = _g("PASS" if ok else "WAIT", f"Price moved {drift:+.2f} ATR from the confirmation close {ref} (max {cfg['maxDriftAtr']} ATR)")
            if not ok:
                fail("WAITING", "SETUP_CHANGED", f"Price ran {drift:.2f} ATR from the confirmation close — setup has materially changed")
        sp_ok = spread <= cfg["maxSpreadAtr"] * atr and (stop <= 0 or 100 * spread / stop <= cfg["maxSpreadStopPct"])
        gates["spread"] = _g("PASS" if sp_ok else "WAIT", f"Spread {spread:.6g} = {spread / atr:.3f} ATR"
                             + (f" · {100 * spread / stop:.1f}% of stop" if stop > 0 else "")
                             + f" (max {cfg['maxSpreadAtr']} ATR / {cfg['maxSpreadStopPct']:.0f}%)")
        if not sp_ok:
            fail("WAITING", "SPREAD_TOO_WIDE", f"Spread {spread / atr:.3f} ATR deteriorated beyond the allowance")
        if rr is not None:
            ok = rr >= cfg["minRR"]
            gates["rewardRisk"] = _g("PASS" if ok else "WAIT", f"R:R {rr:.2f} (min {cfg['minRR']:.1f})", value=rr, limit=cfg["minRR"])
            if not ok:
                fail("WAITING", "RR_BELOW_MIN", f"Reward:risk {rr:.2f} is below the {cfg['minRR']:.1f} minimum")
        else:
            gates["rewardRisk"] = _g("N/A", "No target")
        typed = leg_model.risk_decision(h.get("marketLeg") or {}, reward_risk=rr, confidence=conf,
                                        base_min_rr=cfg["minRR"], base_min_confidence=cfg["minConfidence"])
        if typed:
            gates["tradeType"] = _g("FAIL", typed["reason"])
            fail("RISK_BLOCKED", typed["code"], typed["reason"])
        elif (h.get("marketLeg") or {}).get("tradeType"):
            gates["tradeType"] = _g("PASS", f"{h['marketLeg']['tradeType']} · dominant {h['marketLeg'].get('dominantTrend')} · "
                                            f"leg {h['marketLeg'].get('currentLeg')} · reversal {h['marketLeg'].get('reversalState')}")

    # setup score (quality ranking — never overrides a mandatory gate)
    comps = []
    if geo.get("rewardRisk") is not None:
        rr = float(geo["rewardRisk"])
        zone = str((h.get("channelLocation") or {}).get("zone") or "")
        age_frac = 0.0 if expires_at is None or confirmed_at is None else max(0.0, min(1.0, (now - confirmed_at) / (cfg["setupTtlMin"] * 60)))
        sp = float(geo.get("spreadAtr") or 0)
        dr = max(0.0, float(geo.get("driftAtr") or 0))
        comps = [
            {"key": "confidence", "label": "Stage 7 confidence", "points": round(35 * min(conf, 100) / 100, 1), "max": 35, "detail": f"{conf:.1f}"},
            {"key": "rewardRisk", "label": "Reward:risk", "points": round(25 * min(1.0, max(0.0, rr) / 3), 1), "max": 25, "detail": f"{rr:.2f}R (full at 3R)"},
            {"key": "location", "label": "Channel location", "points": 10.0 if zone in ("VALUE", "DISCOUNT", "PREMIUM") else 6.0 if zone in ("MID", "BREAKOUT") else 3.0,
             "max": 10, "detail": zone.replace("_", " ").lower() or "unknown"},
            {"key": "spread", "label": "Spread quality", "points": round(10 * max(0.0, 1 - sp / cfg["maxSpreadAtr"]), 1), "max": 10, "detail": f"{sp:.3f} ATR"},
            {"key": "freshness", "label": "Confirmation age", "points": round(10 * (1 - age_frac), 1), "max": 10, "detail": f"{int(age_frac * 100)}% of lifetime used"},
            {"key": "drift", "label": "Entry drift", "points": round(10 * max(0.0, 1 - dr / cfg["maxDriftAtr"]), 1), "max": 10, "detail": f"{dr:.2f} ATR"},
        ]
    score = round(sum(c["points"] for c in comps), 1)
    if comps:
        ok = score >= cfg["minSetupScore"]
        gates["score"] = _g("PASS" if ok else "WAIT", f"Setup score {score:.1f} (min {cfg['minSetupScore']:.0f})", value=score, limit=cfg["minSetupScore"])
        if not ok:
            fail("WAITING", "SETUP_SCORE_LOW", f"Setup score {score:.1f} is below the {cfg['minSetupScore']:.0f} minimum")
    else:
        gates["score"] = _g("N/A", "Not scored — geometry unavailable")

    priority = {"RISK_BLOCKED": 0, "EXPIRED": 1, "STALE": 2, "WAITING": 3}
    fails.sort(key=lambda f: priority.get(f[0], 9))
    if fails:
        state, code, reason = fails[0]
    else:
        state, code = "QUALIFIED", "SETUP_QUALIFIED"
        reason = (f"Setup technically qualified: entry {geo.get('entry')}, SL {geo.get('stopLoss')}, TP {geo.get('takeProfit')}, "
                  f"R:R {geo.get('rewardRisk')}, score {score:.1f}")
    return {
        "setupKey": key, "symbol": sym, "direction": "BULLISH" if d > 0 else "BEARISH" if d < 0 else "NEUTRAL", "side": "BUY" if d > 0 else "SELL",
        "setupState": state, "setupReasonCode": code, "setupReason": reason, "setupFailures": [{"state": s, "code": c, "reason": r} for s, c, r in fails],
        "score": score, "components": comps, "confidence": conf, "gates": gates, "geometry": geo,
        "confirmedSince": iso(confirmed_at), "expiresAt": iso(expires_at),
        "tradeType": (h.get("marketLeg") or {}).get("tradeType") or h.get("tradeType"),
        "marketLeg": h.get("marketLeg"),
        "stage7": {"confidence": conf, "model": ec.get("model"), "trigger": ec.get("trigger"), "triggerTs": ec.get("triggerTs"),
                   "triggerLevel": ec.get("triggerLevel"), "invalidationLevel": inv, "riskAtr": h.get("riskAtr"), "h1LastTs": h1_ts,
                   "freshness": h.get("freshness"), "zone": (h.get("channelLocation") or {}).get("zone"), "reasoning": h.get("reasoning"),
                   "tradeType": (h.get("marketLeg") or {}).get("tradeType") or h.get("tradeType"),
                   "dominantTrend": (h.get("marketLeg") or {}).get("dominantTrend"),
                   "currentLeg": (h.get("marketLeg") or {}).get("currentLeg"),
                   "reversalState": (h.get("marketLeg") or {}).get("reversalState"),
                   "expectedDestination": (h.get("marketLeg") or {}).get("expectedDestination")},
    }


# ---------------------------------------------------------------- 2. account portfolio state

def _position_risk(p: dict[str, Any], market: dict[str, dict[str, Any]], fx: FxFn, ccy: str) -> dict[str, Any]:
    sym = str(p.get("symbol") or "")
    d = dsign(p.get("side") or p.get("direction"))
    spec = (market.get(sym) or {}).get("spec") or {}
    sl, entry, vol = p.get("sl"), p.get("entry"), float(p.get("volume") or 0)
    out = {"symbol": sym, "side": "BUY" if d > 0 else "SELL", "volume": vol, "entry": entry, "sl": sl, "tp": p.get("tp"),
           "pnl": p.get("pnl"), "legs": signed_legs(sym, d) if len(sym) >= 6 else {}, "known": False}
    if not sl:
        out["reason"] = "Open position has no stop-loss — its risk is unbounded"
        return out
    if not spec.get("contractSize"):
        out["reason"] = f"No contract specification for {sym}"
        return out
    conv = fx_identity_ok(fx, str(spec.get("currencyProfit") or legs(sym)[1]), ccy)
    if not conv.get("ok"):
        out["reason"] = conv.get("reason") or "FX conversion unavailable"
        return out
    unit = max(0.0, (float(entry) - float(sl)) * d)
    out.update({"known": True, "riskMoney": unit * float(spec["contractSize"]) * vol * float(conv["rate"])})
    return out


def account_state(acct: dict[str, Any], market: dict[str, dict[str, Any]], fx: FxFn, cfg: dict[str, Any], now: float,
                  pending: list[dict[str, Any]]) -> dict[str, Any]:
    """Current risk picture of one account: connectivity, basis, open + pending risk, currency exposure, daily loss, drawdown."""
    ccy = str(acct.get("currency") or "").upper()
    snap_ts = parse_ts(acct.get("snapshotAt"))
    age = None if snap_ts is None else now - snap_ts
    bal, eq = acct.get("balance"), acct.get("equity")
    issues: list[tuple[str, str]] = []
    if bal is None or eq is None or not ccy:
        issues.append(("ACCOUNT_INFO_MISSING", "Account balance / equity / currency unavailable"))
    if age is None or age > cfg["accountMaxAgeSec"]:
        why = "never synchronized" if age is None else f"last synchronized {int(age / 60)} min ago"
        attached = "" if acct.get("live") else " — not attached to the MT5 terminal"
        issues.append(("ACCOUNT_DISCONNECTED", f"Account snapshot stale ({why}){attached}"))
    if str(acct.get("state") or "").upper() not in ("HEALTHY", "CONNECTED"):
        issues.append(("ACCOUNT_DISCONNECTED", f"Account connection state {acct.get('state') or 'unknown'}"))
    if acct.get("live") and acct.get("tradeAllowed") is False:
        issues.append(("BROKER_TRADING_DISABLED", "Broker reports trading not allowed on this account"))
    bal = float(bal or 0)
    eq = float(eq or 0)
    basis = {"EQUITY": eq, "BALANCE": bal}.get(cfg["riskBasis"], min(bal, eq))
    if basis <= 0 and not issues:
        issues.append(("ACCOUNT_INFO_MISSING", "Risk basis (balance / equity) is zero"))
    pos = [_position_risk(p, market, fx, ccy) for p in acct.get("positions") or []]
    unknown = [p for p in pos if not p["known"]]
    open_money = sum(p.get("riskMoney", 0.0) for p in pos if p["known"])
    pend = [a for a in pending if a.get("accountId") == acct.get("id")]
    pend_money = sum(float(a.get("riskAmount") or 0) for a in pend)
    pct = (lambda m: 100 * m / basis if basis > 0 else 0.0)
    exposures = []
    for p in pos:
        if p["known"]:
            exposures.append({"kind": "POSITION", "symbol": p["symbol"], "d": dsign(p["side"]), "riskPct": pct(p["riskMoney"]), "riskMoney": p["riskMoney"]})
    for a in pend:
        exposures.append({"kind": "AUTHORIZATION", "symbol": a["instrument"], "d": dsign(a.get("direction")), "riskPct": pct(float(a.get("riskAmount") or 0)),
                          "riskMoney": float(a.get("riskAmount") or 0), "executionId": a.get("executionId")})
    currency: dict[str, float] = {}
    for e in exposures:
        for c, s in signed_legs(e["symbol"], e["d"]).items():
            currency[c] = currency.get(c, 0.0) + s * e["riskPct"]
    day_start = acct.get("dayStartEquity")
    daily_pct = None if not day_start or day_start <= 0 else max(0.0, 100 * (float(day_start) - eq) / float(day_start))
    peak = max(float(acct.get("peakEquity") or 0), eq)
    dd_pct = 0.0 if peak <= 0 else max(0.0, 100 * (peak - eq) / peak)
    margin = float(acct.get("margin") or 0)
    return {
        "accountId": acct.get("id"), "currency": ccy, "live": bool(acct.get("live")), "snapshotAgeSec": None if age is None else int(age),
        "issues": issues, "basis": basis, "balance": bal, "equity": eq, "margin": margin, "freeMargin": float(acct.get("freeMargin") or 0),
        "marginLevel": (100 * eq / margin) if margin > 0 else None, "leverage": int(acct.get("leverage") or 0),
        "positions": pos, "unknownRisk": [p.get("reason") for p in unknown], "exposures": exposures,
        "openRiskMoney": open_money, "openRiskPct": pct(open_money), "pendingRiskMoney": pend_money, "pendingRiskPct": pct(pend_money),
        "currency_exposure": currency, "dailyLossPct": daily_pct, "dayStartEquity": day_start, "dayPnl": acct.get("dayPnl"),
        "baselineSource": acct.get("baselineSource"), "peakEquity": peak, "drawdownPct": dd_pct,
        "positionCount": len(pos), "pendingCount": len(pend), "symbols": sorted({p["symbol"] for p in pos} | {a["instrument"] for a in pend}),
    }


def _allocate(ps: dict[str, Any], auth: dict[str, Any]) -> None:
    """Add an in-run authorization to the account's portfolio so later setups in the same run see it."""
    pct = 100 * float(auth["riskAmount"]) / ps["basis"] if ps["basis"] > 0 else 0.0
    d = dsign(auth["direction"])
    ps["exposures"].append({"kind": "AUTHORIZATION", "symbol": auth["instrument"], "d": d, "riskPct": pct, "riskMoney": float(auth["riskAmount"]),
                            "executionId": auth["executionId"]})
    for c, s in signed_legs(auth["instrument"], d).items():
        ps["currency_exposure"][c] = ps["currency_exposure"].get(c, 0.0) + s * pct
    ps["pendingRiskMoney"] += float(auth["riskAmount"])
    ps["pendingRiskPct"] += pct
    ps["pendingCount"] += 1
    ps["symbols"] = sorted(set(ps["symbols"]) | {auth["instrument"]})


# ---------------------------------------------------------------- prop-firm rules (generic, driven by the stored profile)

def _in_window(now: float, w: dict[str, Any]) -> bool:
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    days = w.get("days")
    if days and dt.weekday() not in [int(x) for x in days]:
        return False
    try:
        sh, sm = [int(x) for x in str(w.get("start", "00:00")).split(":")[:2]]
        eh, em = [int(x) for x in str(w.get("end", "00:00")).split(":")[:2]]
    except ValueError:
        return True  # malformed window: fail closed
    cur, s, e = dt.hour * 60 + dt.minute, sh * 60 + sm, eh * 60 + em
    return s <= cur < e if s <= e else (cur >= s or cur < e)


def _friday_close(now: float) -> float:
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    days = (4 - dt.weekday()) % 7
    close = (dt + timedelta(days=days)).replace(hour=21, minute=0, second=0, microsecond=0)
    return close.timestamp()


def prop_rules(acct: dict[str, Any], ps: dict[str, Any], opp: dict[str, Any], cfg: dict[str, Any], now: float,
               target_profit_money: float | None) -> dict[str, Any]:
    """Evaluate the account's stored prop-firm profile. Returns blocks, headroom constraints (in % of basis) and headroom detail."""
    rules = acct.get("propRules") or None
    blocks: list[tuple[str, str]] = []
    cons: list[dict[str, Any]] = []
    headroom: dict[str, Any] = {}
    if str(acct.get("accountClass") or "").upper() != "PROP":
        return {"applies": False, "blocks": blocks, "constraints": cons, "headroom": headroom, "rules": None}
    if not rules:
        blocks.append(("PROP_RULES_MISSING", "Prop account has no stored prop-firm rule profile — compliance cannot be verified"))
        return {"applies": True, "blocks": blocks, "constraints": cons, "headroom": headroom, "rules": None}
    size = float(rules.get("accountSize") or 0)
    daily_lim = rules.get("dailyLossLimitPct")
    max_lim = rules.get("maxLossLimitPct")
    if size <= 0 or daily_lim is None or max_lim is None:
        blocks.append(("PROP_RULES_INCOMPLETE", "Prop profile lacks accountSize / dailyLossLimitPct / maxLossLimitPct — compliance uncertain"))
        return {"applies": True, "blocks": blocks, "constraints": cons, "headroom": headroom, "rules": rules}
    basis, eq = ps["basis"], ps["equity"]
    safety = 1 - cfg["propSafetyPct"] / 100
    committed = ps["openRiskMoney"] + ps["pendingRiskMoney"]
    to_pct = (lambda m: 100 * m / basis if basis > 0 else 0.0)
    # daily loss (limit on account size by default, or on day-start equity)
    day_start = ps.get("dayStartEquity")
    if not day_start:
        blocks.append(("PROP_DAILY_BASELINE_UNKNOWN", "Day-start equity unknown — prop daily-loss compliance cannot be verified"))
    else:
        lim_base = float(day_start) if str(rules.get("dailyLossBasis") or "").upper() == "DAY_START" else size
        limit = lim_base * float(daily_lim) / 100
        used = max(0.0, float(day_start) - eq)
        room = (limit - used - committed) * safety
        headroom["dailyLoss"] = {"limit": limit, "used": used, "committed": committed, "headroom": room, "pct": float(daily_lim)}
        cons.append({"key": "propDailyLoss", "label": "Prop daily-loss headroom", "headroomPct": to_pct(room), "state": "PROP_RULE_BLOCKED",
                     "code": "PROP_DAILY_LOSS", "detail": f"used {used:,.2f} + open/pending risk {committed:,.2f} of {limit:,.2f} {ps['currency']}"})
    # max loss (static from account size, or trailing from peak equity)
    trailing = bool(rules.get("trailingDrawdown"))
    floor = (ps["peakEquity"] if trailing else size) - size * float(max_lim) / 100
    if trailing:
        floor = min(floor, size)
    room = (eq - floor - committed) * safety
    headroom["maxLoss"] = {"floor": floor, "equity": eq, "committed": committed, "headroom": room, "pct": float(max_lim), "trailing": trailing}
    cons.append({"key": "propMaxLoss", "label": "Prop max-loss headroom", "headroomPct": to_pct(room), "state": "PROP_RULE_BLOCKED",
                 "code": "PROP_MAX_LOSS", "detail": f"equity {eq:,.2f} vs {'trailing ' if trailing else ''}floor {floor:,.2f}, committed {committed:,.2f}"})
    # maximum total exposure (risk) and per-trade risk
    if rules.get("maxExposurePct") is not None:
        lim = size * float(rules["maxExposurePct"]) / 100
        room = (lim - committed) * safety
        headroom["exposure"] = {"limit": lim, "committed": committed, "headroom": room, "pct": float(rules["maxExposurePct"])}
        cons.append({"key": "propExposure", "label": "Prop max exposure", "headroomPct": to_pct(room), "state": "PROP_RULE_BLOCKED",
                     "code": "PROP_MAX_EXPOSURE", "detail": f"committed risk {committed:,.2f} of {lim:,.2f}"})
    if rules.get("maxOpenPositions") is not None and ps["positionCount"] + ps["pendingCount"] >= int(rules["maxOpenPositions"]):
        blocks.append(("PROP_MAX_POSITIONS", f"Prop profile allows {int(rules['maxOpenPositions'])} open positions"))
    allowed = rules.get("allowedSymbols")
    if allowed and opp["symbol"] not in allowed:
        blocks.append(("PROP_SYMBOL_NOT_ALLOWED", f"{opp['symbol']} is not in the prop profile's allowed instruments"))
    # time / news rules
    if rules.get("newsTrading") is False:
        cal = cfg.get("newsCalendar") or {}
        if cal.get("mode") != "MANUAL":
            blocks.append(("NEWS_RULE_UNVERIFIABLE", "Prop profile prohibits news trading and no verified economic calendar is configured"))
        else:
            win = cfg["newsWindowMin"] * 60
            cur = set(legs(opp["symbol"]))
            hit = [e for e in cal.get("events") or [] if abs((parse_ts(e["time"]) or 0) - now) <= win and cur & set(e["currencies"])]
            if hit:
                blocks.append(("NEWS_BLACKOUT", f"News blackout: {hit[0]['title'] or ','.join(hit[0]['currencies'])} at {hit[0]['time'][11:16]} UTC"))
            headroom["news"] = {"calendar": "MANUAL", "events": len(cal.get("events") or []), "blocking": len(hit)}
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    if rules.get("weekendHolding") is False:
        to_close = _friday_close(now) - now
        if dt.weekday() >= 5 or 0 <= to_close <= cfg["weekendCutoffHours"] * 3600:
            blocks.append(("WEEKEND_RULE", f"Prop profile forbids weekend holding — within {cfg['weekendCutoffHours']:g} h of the weekly close"))
    if rules.get("overnightHolding") is False and dt.hour >= int(cfg["overnightCutoffUtcHour"]):
        blocks.append(("OVERNIGHT_RULE", f"Prop profile forbids overnight holding — no new entries after {int(cfg['overnightCutoffUtcHour']):02d}:00 UTC"))
    for w in rules.get("prohibitedWindows") or []:
        if _in_window(now, w):
            blocks.append(("PROHIBITED_PERIOD", f"Prohibited trading period: {w.get('label') or (str(w.get('start')) + '–' + str(w.get('end')))} UTC"))
            break
    # profit target / consistency
    target_pct = rules.get("profitTargetPct")
    if target_pct is not None:
        target_eq = size * (1 + float(target_pct) / 100)
        headroom["profitTarget"] = {"target": target_eq, "equity": eq, "remaining": target_eq - eq}
        if rules.get("stopTradingAtTarget") and eq >= target_eq:
            blocks.append(("PROP_TARGET_REACHED", "Profit target reached — profile stops new trading"))
    if rules.get("consistencyRulePct") is not None:
        if target_pct is None:
            blocks.append(("CONSISTENCY_UNVERIFIABLE", "Consistency rule set without a profit target — cannot bound a single day's profit"))
        elif target_profit_money is not None:
            cap = float(rules["consistencyRulePct"]) / 100 * max(size * float(target_pct) / 100, eq - size)
            day_profit = max(0.0, float(ps.get("dayPnl") or 0))
            projected = day_profit + target_profit_money
            headroom["consistency"] = {"cap": cap, "dayProfit": day_profit, "projected": projected}
            if projected > cap:
                blocks.append(("CONSISTENCY_RULE", f"Consistency rule: projected day profit {projected:,.2f} would exceed {cap:,.2f} "
                                                   f"({rules['consistencyRulePct']}% of target)"))
    return {"applies": True, "blocks": blocks, "constraints": cons, "headroom": headroom, "rules": rules,
            "maxRiskPerTradePct": rules.get("maxRiskPerTradePct"), "maxLots": rules.get("maxLots"), "minRewardRisk": rules.get("minRewardRisk")}


# ---------------------------------------------------------------- 3. account qualification + sizing + authorization

def _corr(corr: dict[tuple[str, str], float], a: str, b: str) -> float | None:
    if a == b:
        return 1.0
    return corr.get((a, b)) if (a, b) in corr else corr.get((b, a))


def execution_id(key: str, account_id: str, attempt: int) -> str:
    return "EX-" + hashlib.sha1(f"{key}|{account_id}|{attempt}".encode()).hexdigest()[:20].upper()


def evaluate_account(opp: dict[str, Any], acct: dict[str, Any], ps: dict[str, Any], market: dict[str, dict[str, Any]], fx: FxFn,
                     cfg: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    now = ctx["now"]
    sym, d = opp["symbol"], dsign(opp["direction"])
    geo = opp["geometry"]
    spec = (market.get(sym) or {}).get("spec") or {}
    ccy = ps["currency"]
    gates: dict[str, dict[str, Any]] = {}
    fails: list[tuple[str, str, str]] = []
    out: dict[str, Any] = {"accountId": acct.get("id"), "name": acct.get("name"), "accountClass": acct.get("accountClass"),
                           "currency": ccy, "live": ps["live"], "login": acct.get("login"), "server": acct.get("server"),
                           "tradingMode": acct.get("tradingMode"), "tradingEnabled": bool(acct.get("tradingEnabled"))}

    def fail(state: str, code: str, reason: str) -> None:
        fails.append((state, code, reason))

    # setup-level result gates every account
    if opp["setupState"] != "QUALIFIED":
        gates["setup"] = _g("FAIL", f"Setup {opp['setupState']}: {opp['setupReason']}")
        fail(opp["setupState"], opp["setupReasonCode"], opp["setupReason"])
    else:
        gates["setup"] = _g("PASS", opp["setupReason"])
    # connectivity / account information
    if ps["issues"]:
        gates["account"] = _g("FAIL", "; ".join(r for _, r in ps["issues"]))
        code, reason = ps["issues"][0]
        fail("ACCOUNT_BLOCKED", code, reason)
    else:
        gates["account"] = _g("PASS", f"{'Attached' if ps['live'] else 'Synced'} {ps['snapshotAgeSec']} s ago · equity {ps['equity']:,.2f} {ccy}")
    # symbol trade mode
    tm = TRADE_MODES.get(int(spec.get("tradeMode", -1)), "UNKNOWN") if spec else "UNKNOWN"
    if tm in ("FULL",) or (tm == "LONG_ONLY" and d > 0) or (tm == "SHORT_ONLY" and d < 0):
        gates["symbol"] = _g("PASS", f"{spec.get('name') or sym} trade mode {tm}")
    else:
        gates["symbol"] = _g("FAIL", f"{sym} trade mode {tm}")
        fail("ACCOUNT_BLOCKED", "SYMBOL_NOT_TRADABLE", f"{sym} cannot be traded {'long' if d > 0 else 'short'} (broker trade mode {tm})")
    # FX conversion (profit currency and margin currency to the account currency)
    pc = str(spec.get("currencyProfit") or legs(sym)[1])
    mc = str(spec.get("currencyMargin") or legs(sym)[0])
    fxp = fx_identity_ok(fx, pc, ccy) if ccy else {"ok": False, "reason": "Account currency unknown"}
    fxm = fx_identity_ok(fx, mc, ccy) if ccy else {"ok": False, "reason": "Account currency unknown"}
    if fxp.get("ok") and fxm.get("ok"):
        gates["fx"] = _g("PASS", f"{pc}→{ccy} {fxp['rate']:.6g} ({fxp.get('source')})" + ("" if mc == pc else f" · {mc}→{ccy} {fxm['rate']:.6g} ({fxm.get('source')})"))
    else:
        bad = fxp if not fxp.get("ok") else fxm
        gates["fx"] = _g("FAIL", bad.get("reason") or "conversion unavailable")
        fail("ACCOUNT_BLOCKED", "FX_UNAVAILABLE", f"No validated current conversion rate: {bad.get('reason') or 'unavailable'}")
    # open-position risk must be known
    if ps["unknownRisk"]:
        gates["openRisk"] = _g("FAIL", ps["unknownRisk"][0])
        fail("RISK_BLOCKED", "OPEN_RISK_UNKNOWN", f"Portfolio risk unknown: {ps['unknownRisk'][0]}")
    else:
        gates["openRisk"] = _g("PASS", f"Open risk {ps['openRiskPct']:.2f}% · pending authorizations {ps['pendingRiskPct']:.2f}%")
    # system safety: daily loss + drawdown baselines
    if ps["dailyLossPct"] is None:
        gates["dailyLoss"] = _g("FAIL", "Day-start equity unknown")
        fail("RISK_BLOCKED", "DAILY_BASELINE_UNKNOWN", "Day-start equity unknown — daily-loss limit cannot be verified")
    # concurrency + same symbol
    max_pos = min(int(cfg["maxConcurrentPositions"]), int(acct.get("maxConcurrentTrades") or cfg["maxConcurrentPositions"]))
    busy = ps["positionCount"] + ps["pendingCount"]
    if busy >= max_pos:
        gates["concurrency"] = _g("FAIL", f"{busy} open/pending of {max_pos} allowed")
        fail("EXPOSURE_BLOCKED", "MAX_POSITIONS", f"Account already has {busy} open/pending positions (limit {max_pos})")
    else:
        gates["concurrency"] = _g("PASS", f"{busy} open/pending of {max_pos} allowed")
    if not cfg["allowSameSymbol"] and sym in ps["symbols"]:
        gates["sameSymbol"] = _g("FAIL", f"Already exposed to {sym}")
        fail("EXPOSURE_BLOCKED", "SYMBOL_ALREADY_EXPOSED", f"Account already holds or has an authorization on {sym}")

    # ---- headroom constraints (all in % of the risk basis)
    cons: list[dict[str, Any]] = []
    committed = ps["openRiskPct"] + ps["pendingRiskPct"]
    cons.append({"key": "portfolio", "label": "Portfolio risk", "headroomPct": cfg["maxPortfolioRiskPct"] - committed, "state": "EXPOSURE_BLOCKED",
                 "code": "PORTFOLIO_RISK_LIMIT", "detail": f"{committed:.2f}% committed of {cfg['maxPortfolioRiskPct']:.2f}%"})
    cur_rows = []
    for c, s in signed_legs(sym, d).items():
        net = ps["currency_exposure"].get(c, 0.0)
        room = cfg["maxCurrencyRiskPct"] - s * net
        cur_rows.append({"currency": c, "sign": s, "net": net, "headroomPct": room})
        cons.append({"key": f"currency:{c}", "label": f"{c} exposure", "headroomPct": room, "state": "EXPOSURE_BLOCKED", "code": "CURRENCY_CONCENTRATION",
                     "detail": f"net {c} {net:+.2f}% → {'long' if s > 0 else 'short'} {c} adds up to {cfg['maxCurrencyRiskPct']:.2f}%"})
    cluster = []
    for e in ps["exposures"]:
        rho = _corr(ctx.get("corr") or {}, sym, e["symbol"])
        shared = any(signed_legs(sym, d).get(c) == s for c, s in signed_legs(e["symbol"], e["d"]).items())
        signed = None if rho is None else rho * d * e["d"]
        if (signed is not None and signed >= cfg["correlationThreshold"]) or (signed is None and shared):
            cluster.append({**e, "rho": rho, "signed": signed, "basis": "CORRELATION" if signed is not None else "SHARED_CURRENCY (correlation unavailable)"})
    cl_risk = sum(e["riskPct"] for e in cluster)
    cons.append({"key": "cluster", "label": "Correlated cluster", "headroomPct": cfg["maxClusterRiskPct"] - cl_risk, "state": "CORRELATION_BLOCKED",
                 "code": "CORRELATED_CLUSTER", "detail": f"{len(cluster)} correlated exposure(s) {cl_risk:.2f}% of {cfg['maxClusterRiskPct']:.2f}%"
                 + (f" ({', '.join(e['symbol'] for e in cluster[:5])})" if cluster else "")})
    if ps["dailyLossPct"] is not None:
        room = cfg["maxDailyLossPct"] - ps["dailyLossPct"] - committed
        cons.append({"key": "dailyLoss", "label": "Daily loss", "headroomPct": room, "state": "RISK_BLOCKED", "code": "DAILY_LOSS_LIMIT",
                     "detail": f"lost {ps['dailyLossPct']:.2f}% today + committed {committed:.2f}% of {cfg['maxDailyLossPct']:.2f}%"})
        gates["dailyLoss"] = _g("PASS" if room > 0 else "FAIL", f"Daily loss {ps['dailyLossPct']:.2f}% ({ps.get('baselineSource') or 'baseline'}) + committed "
                                                               f"{committed:.2f}% of {cfg['maxDailyLossPct']:.2f}%")
    room = cfg["maxDrawdownPct"] - ps["drawdownPct"] - committed
    cons.append({"key": "drawdown", "label": "Drawdown", "headroomPct": room, "state": "RISK_BLOCKED", "code": "DRAWDOWN_LIMIT",
                 "detail": f"drawdown {ps['drawdownPct']:.2f}% from peak {ps['peakEquity']:,.2f} + committed {committed:.2f}% of {cfg['maxDrawdownPct']:.2f}%"})
    gates["drawdown"] = _g("PASS" if room > 0 else "FAIL", cons[-1]["detail"])

    # prop-firm profile
    loss_unit = float(geo.get("lossPerUnit") or 0)
    contract = float(spec.get("contractSize") or 0)
    rate = float(fxp.get("rate") or 0) if fxp.get("ok") else 0.0
    loss_per_lot = loss_unit * contract * rate
    target = cfg["riskPerTradePct"]
    tp, entry = geo.get("takeProfit"), geo.get("entry")
    reward_per_lot = abs(float(tp) - float(entry)) * contract * rate if tp is not None and entry is not None and rate else None
    est_money = ps["basis"] * target / 100
    est_profit = None if reward_per_lot is None or loss_per_lot <= 0 else est_money / loss_per_lot * reward_per_lot
    prop = prop_rules(acct, ps, opp, cfg, now, est_profit)
    if prop["applies"]:
        if prop.get("maxRiskPerTradePct") is not None:
            target = min(target, float(prop["maxRiskPerTradePct"]))
        cons.extend(prop["constraints"])
        if prop["blocks"]:
            gates["prop"] = _g("FAIL", "; ".join(r for _, r in prop["blocks"]))
            code, reason = prop["blocks"][0]
            fail("PROP_RULE_BLOCKED", code, reason)
        else:
            gates["prop"] = _g("PASS", f"Prop profile {((prop.get('rules') or {}).get('phase') or '').lower()} — all stored rules satisfied")
        min_rr = prop.get("minRewardRisk")
        if min_rr is not None and geo.get("rewardRisk") is not None and float(geo["rewardRisk"]) < float(min_rr):
            fail("PROP_RULE_BLOCKED", "PROP_MIN_RR", f"Prop profile requires R:R ≥ {min_rr}; setup offers {geo['rewardRisk']}")
    else:
        gates["prop"] = _g("N/A", "Not a prop-firm account")

    # Economic Intelligence is a cross-cutting gate. The Stage 8 runner always supplies it.
    # A missing map means this call is the pure evaluator (unit tests), not a live authorization path.
    econ_row = None if ctx.get("economic") is None else (ctx["economic"].get(sym) or {
        "blocks": True, "code": "ECON_UNKNOWN", "reason": "Economic risk state cannot be determined — new entries fail closed", "factor": 1.0,
    })
    if econ_row is not None:
        if econ_row.get("blocks"):
            gates["economic"] = _g("FAIL", econ_row.get("reason") or "Economic event gate")
            fail("RISK_BLOCKED", str(econ_row.get("code") or "ECON_EVENT_GATE"), str(econ_row.get("reason") or "Economic event gate"))
        else:
            factor = float(econ_row.get("factor") or 1)
            if econ_row.get("action") == "REDUCE_RISK" and 0 < factor < 1:
                target *= factor
            gates["economic"] = _g("PASS", econ_row.get("reason") or "Economic window clear")

    need = target * cfg["minRiskFraction"]
    binding = min(cons, key=lambda c: c["headroomPct"]) if cons else None
    risk_pct = max(0.0, min([target] + [c["headroomPct"] for c in cons]))
    for c in cons:
        c["ok"] = c["headroomPct"] >= need
    gates["headroom"] = _g("PASS" if risk_pct >= need else "FAIL",
                           f"Target {target:.2f}% · allowed {risk_pct:.2f}% (min {need:.2f}%)"
                           + (f" · binding: {binding['label']} {binding['headroomPct']:.2f}%" if binding and binding["headroomPct"] < target else ""))
    if risk_pct < need and binding:
        fail(binding["state"], binding["code"], f"{binding['label']} headroom {max(0.0, binding['headroomPct']):.2f}% < required {need:.2f}%: {binding['detail']}")

    # ---- position sizing (broker-valid)
    sizing: dict[str, Any] = {"targetRiskPct": target, "allowedRiskPct": risk_pct, "basis": ps["basis"], "basisType": cfg["riskBasis"],
                              "lossPerUnit": loss_unit, "contractSize": contract, "profitCurrency": pc, "fxRate": rate if rate else None,
                              "fxSource": fxp.get("source"), "lossPerLot": loss_per_lot if loss_per_lot > 0 else None}
    volume = 0.0
    headroom_ok = risk_pct >= need
    if not headroom_ok:
        sizing["hypotheticalAtTarget"] = True  # headroom failed: show what the target risk would size to, never authorize it
    if loss_per_lot > 0 and spec.get("volumeStep") and ps["basis"] > 0:
        money = ps["basis"] * (risk_pct if headroom_ok else target) / 100
        raw = money / loss_per_lot
        vmax = float(spec.get("volumeMax") or 0) or raw
        if prop.get("maxLots") is not None:
            vmax = min(vmax, float(prop["maxLots"]))
        volume = round(min(_floor_step(raw, float(spec["volumeStep"])), _floor_step(vmax, float(spec["volumeStep"]))), 8)
        min_money = float(spec["volumeMin"]) * loss_per_lot
        sizing.update({"riskMoneyAllowed": money, "volumeRaw": raw, "volumeMin": spec["volumeMin"], "volumeMax": spec.get("volumeMax"),
                       "volumeStep": spec["volumeStep"], "minVolumeRiskPct": 100 * min_money / ps["basis"]})
        # cross-check with the broker tick value when the account is the attached terminal account
        tv, ts_ = spec.get("tickValue"), spec.get("tickSize")
        if ps["live"] and tv and ts_ and ctx.get("terminalCurrency") == ccy:
            broker = loss_unit / float(ts_) * float(tv)
            sizing["brokerLossPerLot"] = broker
            if broker > 0 and abs(broker - loss_per_lot) / broker > 0.03:
                fail("RISK_BLOCKED", "TICK_VALUE_MISMATCH", f"Computed loss/lot {loss_per_lot:.2f} deviates from broker tick value {broker:.2f} {ccy} — spec uncertain")
        if volume < float(spec["volumeMin"]) - 1e-9:
            gates["sizing"] = _g("FAIL", f"Minimum {spec['volumeMin']} lot would risk {100 * min_money / ps['basis']:.2f}% (> {risk_pct:.2f}% allowed)")
            if headroom_ok:
                fail("RISK_BLOCKED", "MIN_VOLUME_EXCEEDS_RISK", f"Broker minimum volume {spec['volumeMin']} lot would risk "
                                                                f"{100 * min_money / ps['basis']:.2f}% — above the {risk_pct:.2f}% allowed")
        else:
            actual = volume * loss_per_lot
            sizing.update({"volume": volume, "riskMoney": actual, "riskPct": 100 * actual / ps["basis"],
                           "rewardMoney": None if reward_per_lot is None else volume * reward_per_lot})
            gates["sizing"] = _g("PASS", f"{volume:g} lot · risk {actual:,.2f} {ccy} ({100 * actual / ps['basis']:.2f}%) · "
                                         f"loss/lot {loss_per_lot:,.2f} {ccy}")
    else:
        gates["sizing"] = _g("N/A" if opp["setupState"] != "QUALIFIED" else "FAIL", "Size not computable (geometry, spec, FX or basis missing)")
        if opp["setupState"] == "QUALIFIED" and not fails:
            fail("RISK_BLOCKED", "SIZING_UNAVAILABLE", "Position size not computable")

    # ---- margin
    if volume > 0 and sizing.get("riskMoney") is not None:
        per_lot_broker = (ctx.get("brokerMargin") or {}).get((sym, "BUY" if d > 0 else "SELL")) if ps["live"] and ctx.get("terminalCurrency") == ccy else None
        mode = int(spec.get("calcMode", 0))
        lev = max(1, ps["leverage"] or 1)
        price = float(geo.get("entry") or 0)
        mrate = float(fxm.get("rate") or 0) if fxm.get("ok") else 0.0
        if per_lot_broker:
            m_req, method = per_lot_broker * volume, "BROKER"
        else:
            units = volume * contract
            base = units / lev if mode in (0,) else units if mode == 5 else units * price / lev if mode in (3, 4) else units * price
            m_req, method = base * mrate * cfg["marginFormulaBuffer"], f"FORMULA ×{cfg['marginFormulaBuffer']:g}"
        free_after = ps["freeMargin"] - m_req
        used_after = ps["margin"] + m_req
        lvl_after = 100 * ps["equity"] / used_after if used_after > 0 else None
        use_pct = 100 * used_after / ps["equity"] if ps["equity"] > 0 else 100.0
        sizing.update({"marginRequired": m_req, "marginMethod": method, "freeMarginAfter": free_after, "marginLevelAfter": lvl_after, "marginUsePct": use_pct})
        ok = m_req > 0 and free_after > 0 and (lvl_after is None or lvl_after >= cfg["minMarginLevelPct"]) and use_pct <= cfg["maxMarginUsePct"]
        gates["margin"] = _g("PASS" if ok else "FAIL", f"Margin {m_req:,.2f} {ccy} ({method}) · free after {free_after:,.2f} · level after "
                             f"{'—' if lvl_after is None else f'{lvl_after:,.0f}%'} (min {cfg['minMarginLevelPct']:.0f}%) · use {use_pct:.1f}% (max {cfg['maxMarginUsePct']:.0f}%)")
        if not ok:
            fail("MARGIN_BLOCKED", "INSUFFICIENT_MARGIN", f"Insufficient margin: requires {m_req:,.2f} {ccy}, free {ps['freeMargin']:,.2f}, "
                                                          f"level after {'—' if lvl_after is None else f'{lvl_after:,.0f}%'}")

    # ---- permission + global switch (evaluated last: the account result shows everything else first)
    perm: list[tuple[str, str, str]] = []
    if not acct.get("tradingEnabled"):
        perm.append(("ACCOUNT_BLOCKED", "TRADING_DISABLED", "Account trading is disabled — qualification is hypothetical"))
    mode_ = str(acct.get("tradingMode") or "ANALYSIS_ONLY").upper()
    approved = (opp["setupKey"], acct.get("id")) in (ctx.get("approvals") or set())
    if mode_ == "ANALYSIS_ONLY":
        perm.append(("ACCOUNT_BLOCKED", "ANALYSIS_ONLY", "Account is in ANALYSIS_ONLY mode — never authorized for execution"))
    gates["permission"] = _g("PASS" if not perm else "FAIL", f"Trading {'enabled' if acct.get('tradingEnabled') else 'disabled'} · mode {mode_}"
                             + (" · operator approved" if approved else ""))
    paused = not ctx.get("auto")
    gates["globalSwitch"] = _g("WAIT" if paused else "PASS", "Global trading PAUSED — analysis continues, no authorization" if paused else "Global trading RUNNING")

    setup_fail = fails[:1] if opp["setupState"] != "QUALIFIED" else []
    priority = {"ACCOUNT_BLOCKED": 0, "RISK_BLOCKED": 1, "PROP_RULE_BLOCKED": 2, "EXPOSURE_BLOCKED": 3, "CORRELATION_BLOCKED": 4, "MARGIN_BLOCKED": 5}
    fails = setup_fail + sorted(fails[len(setup_fail):], key=lambda f: priority.get(f[0], 9))
    auth = None
    if fails:
        state, code, reason = fails[0]
    elif perm:
        state, code, reason = perm[0]
    elif paused:
        state, code, reason = "QUALIFIED", "TRADING_PAUSED", "All risk gates pass — global trading is PAUSED, so no Stage 9 authorization is issued"
    elif mode_ == "APPROVAL_REQUIRED" and not approved:
        state, code, reason = "QUALIFIED", "AWAITING_APPROVAL", "All gates pass — account requires operator approval before authorization"
    else:
        state, code = "AUTHORIZED", "AUTHORIZED"
        auth = _authorization(opp, acct, ps, spec, sizing, gates, cfg, ctx)
        reason = f"Authorized {auth['direction']} {auth['volume']:g} {sym} · risk {auth['riskAmount']:,.2f} {ccy} ({auth['riskPct']:.2f}%) · {auth['executionId']}"
    out.update({"state": state, "reasonCode": code, "reason": reason, "hypothetical": state != "AUTHORIZED",
                "failures": [{"state": s, "code": c, "reason": r} for s, c, r in fails + perm], "gates": gates, "sizing": sizing,
                "constraints": [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in c.items()} for c in cons],
                "exposure": {"currencies": cur_rows, "cluster": [{k: e.get(k) for k in ("kind", "symbol", "d", "riskPct", "rho", "signed", "basis")} for e in cluster],
                             "clusterRiskPct": cl_risk, "committedPct": committed},
                "prop": {"applies": prop["applies"], "headroom": prop["headroom"], "blocks": [{"code": c, "reason": r} for c, r in prop["blocks"]]},
                "authorization": auth})
    return out


def _authorization(opp: dict[str, Any], acct: dict[str, Any], ps: dict[str, Any], spec: dict[str, Any], sizing: dict[str, Any],
                   gates: dict[str, Any], cfg: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    now = ctx["now"]
    geo = opp["geometry"]
    key, aid = opp["setupKey"], str(acct.get("id"))
    prior = (ctx.get("attempts") or {}).get((key, aid), 0)
    attempt = prior + 1
    point = float(spec.get("point") or spec.get("tickSize") or 0) or 1e-5
    dev = cfg["maxEntryDeviationAtr"] * float(geo.get("atr") or 0)
    return {
        "executionId": execution_id(key, aid, attempt), "setupKey": key, "attempt": attempt, "accountId": aid, "accountName": acct.get("name"),
        "accountClass": acct.get("accountClass"), "accountCurrency": ps["currency"], "instrument": opp["symbol"],
        "brokerSymbol": spec.get("name") or opp["symbol"], "direction": opp["side"], "volume": sizing["volume"],
        "entryPolicy": {"type": "MARKET", "referencePrice": geo["entry"], "maxDeviationPrice": round(dev, 6),
                        "maxDeviationPoints": int(round(dev / point)), "maxSpread": round(cfg["maxSpreadAtr"] * float(geo.get("atr") or 0), 6),
                        "validFrom": iso(now), "validUntil": iso(now + cfg["authTtlSec"])},
        "stopLoss": geo["stopLoss"], "takeProfit": geo["takeProfit"], "takeProfit2": geo.get("takeProfit2"),
        "riskAmount": round(float(sizing["riskMoney"]), 2), "riskCurrency": ps["currency"], "riskPct": round(float(sizing["riskPct"]), 4),
        "rewardRisk": geo.get("rewardRisk"), "marginRequired": round(float(sizing.get("marginRequired") or 0), 2),
        "expiresAt": iso(now + cfg["authTtlSec"]), "authorizedAt": iso(now), "configHash": ctx.get("configHash"),
        "source": {"stage": 7, "symbol": opp["symbol"], "direction": opp["direction"], "confirmedSince": opp["confirmedSince"],
                   "tradeType": opp.get("tradeType"), **opp["stage7"]},
        "evidence": {"setupScore": opp["score"], "setupGates": {k: v["status"] for k, v in opp["gates"].items()},
                     "accountGates": {k: v["status"] for k, v in gates.items()}, "sizing": {k: sizing.get(k) for k in
                     ("targetRiskPct", "allowedRiskPct", "lossPerLot", "fxRate", "fxSource", "volumeRaw", "marginRequired", "marginMethod", "marginLevelAfter")}},
        "status": "PENDING", "executes": False,
    }


# ---------------------------------------------------------------- 4. run: all hand-offs x all accounts

def evaluate(handoffs: list[dict[str, Any]], accounts: list[dict[str, Any]], market: dict[str, dict[str, Any]], fx: FxFn,
             cfg: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """ctx: now, auto, corr {(a,b): rho}, pending [PENDING authorizations], attempts {(setupKey, accountId): n}, approvals {(setupKey, accountId)},
    brokerMargin {(symbol, side): per-lot margin in terminal currency}, terminalCurrency, configHash,
    inflight [authorizations Stage 9 consumed whose broker position is not yet confirmed — still committed risk],
    handedOff {(setupKey, accountId): {status, executionId, orderState, positionState}} — consumed / declined by Stage 9, never re-authorized."""
    now = ctx["now"]
    pending = [a for a in ctx.get("pending") or [] if (parse_ts(a.get("expiresAt")) or 0) > now]
    inflight = list(ctx.get("inflight") or [])
    handed = ctx.get("handedOff") or {}
    states = {a["id"]: account_state(a, market, fx, cfg, now, pending + inflight) for a in accounts}
    opps = [evaluate_setup(h, market, cfg, now) for h in handoffs]
    opps.sort(key=lambda o: (0 if o["setupState"] == "QUALIFIED" else 1, -o["score"], o["symbol"]))
    authorizations: list[dict[str, Any]] = []
    pend_keys = {(a["setupKey"], a["accountId"]): a for a in pending}
    for o in opps:
        evals = []
        for a in accounts:
            ps = states[a["id"]]
            existing = pend_keys.get((o["setupKey"], a["id"]))
            if existing:
                ev = _existing(o, a, ps, existing)
            elif (o["setupKey"], a["id"]) in handed:
                ev = _handed_off(a, ps, handed[(o["setupKey"], a["id"])])
            else:
                ev = evaluate_account(o, a, ps, market, fx, cfg, ctx)
                if ev["authorization"]:
                    authorizations.append(ev["authorization"])
                    _allocate(ps, ev["authorization"])
            evals.append(ev)
        evals.sort(key=lambda e: (STATE_ORDER.index(e["state"]) if e["state"] in STATE_ORDER else 99, str(e["name"])))
        o["accounts"] = evals
        o["eligibleAccounts"] = sum(1 for e in evals if e["state"] in ("QUALIFIED", "AUTHORIZED"))
        o["authorizedAccounts"] = sum(1 for e in evals if e["state"] == "AUTHORIZED")
        best = evals[0] if evals else None
        o["state"] = best["state"] if best else ("ACCOUNT_BLOCKED" if o["setupState"] == "QUALIFIED" else o["setupState"])
        o["reasonCode"] = best["reasonCode"] if best else ("NO_ACCOUNTS" if o["setupState"] == "QUALIFIED" else o["setupReasonCode"])
        o["reason"] = best["reason"] if best else ("No Demo / Live / Prop account is registered" if o["setupState"] == "QUALIFIED" else o["setupReason"])
        risks = [e["sizing"].get("riskPct") for e in evals if e["sizing"].get("riskPct") is not None]
        o["proposedRiskPct"] = max(risks) if risks else None
        worst_corr = next((e for e in evals if e["state"] in ("CORRELATION_BLOCKED", "EXPOSURE_BLOCKED")), None)
        o["exposureStatus"] = worst_corr["reasonCode"] if worst_corr else ("CLEAR" if evals and o["setupState"] == "QUALIFIED" else "N/A")
    # revoke PENDING authorizations whose setup is no longer qualified, or when trading is paused
    live = {o["setupKey"]: o for o in opps}
    revocations = []
    for a in pending:
        o = live.get(a["setupKey"])
        if not ctx.get("auto"):
            revocations.append({"executionId": a["executionId"], "reason": "Global trading PAUSED before Stage 9 consumed the authorization"})
        elif o is None:
            revocations.append({"executionId": a["executionId"], "reason": "Stage 7 no longer confirms the setup"})
        elif o["setupState"] != "QUALIFIED":
            revocations.append({"executionId": a["executionId"], "reason": f"Setup {o['setupState']}: {o['setupReason']}"})
        elif ctx.get("economic") is not None:
            gate = ctx["economic"].get(a.get("instrument") or "") or {}
            if gate.get("blocks"):
                revocations.append({"executionId": a["executionId"], "reason": gate.get("reason") or "Economic event invalidated the unconsumed authorization"})
    accts = [_account_summary(a, states[a["id"]], cfg) for a in accounts]
    return {"opportunities": opps, "accounts": accts, "authorizations": authorizations, "revocations": revocations, "counters": counters(opps, accts)}


def _existing(o: dict[str, Any], a: dict[str, Any], ps: dict[str, Any], auth: dict[str, Any]) -> dict[str, Any]:
    """An unexpired PENDING authorization exists for this setup/account: never re-authorize (idempotent), report it."""
    return {"accountId": a.get("id"), "name": a.get("name"), "accountClass": a.get("accountClass"), "currency": ps["currency"], "live": ps["live"],
            "login": a.get("login"), "server": a.get("server"), "tradingMode": a.get("tradingMode"), "tradingEnabled": bool(a.get("tradingEnabled")),
            "state": "AUTHORIZED", "reasonCode": "ALREADY_AUTHORIZED", "hypothetical": False,
            "reason": f"Authorization {auth['executionId']} already issued (expires {str(auth.get('expiresAt'))[11:19]} UTC) — duplicate suppressed",
            "failures": [], "gates": {"authorization": _g("PASS", f"Existing PENDING authorization {auth['executionId']}")},
            "sizing": {"volume": auth.get("volume"), "riskMoney": auth.get("riskAmount"), "riskPct": auth.get("riskPct"), "marginRequired": auth.get("marginRequired")},
            "constraints": [], "exposure": {}, "prop": {}, "authorization": None, "existingAuthorization": auth.get("executionId")}


def _handed_off(a: dict[str, Any], ps: dict[str, Any], h: dict[str, Any]) -> dict[str, Any]:
    """Stage 9 already consumed (or declined) this setup's authorization for the account: one execution per setup, never re-authorized."""
    consumed = h.get("status") == "CONSUMED"
    where = " / ".join(s for s in (h.get("orderState"), h.get("positionState")) if s) or "recorded"
    reason = (f"Authorization {h.get('executionId')} consumed by Stage 9 — execution {where}; setup not re-authorized" if consumed else
              f"Stage 9 declined authorization {h.get('executionId')} at pre-execution revalidation — setup not re-authorized")
    return {"accountId": a.get("id"), "name": a.get("name"), "accountClass": a.get("accountClass"), "currency": ps["currency"], "live": ps["live"],
            "login": a.get("login"), "server": a.get("server"), "tradingMode": a.get("tradingMode"), "tradingEnabled": bool(a.get("tradingEnabled")),
            "state": "AUTHORIZED" if consumed else "ACCOUNT_BLOCKED", "reasonCode": "EXECUTED_BY_STAGE9" if consumed else "STAGE9_DECLINED",
            "hypothetical": False, "reason": reason, "failures": [],
            "gates": {"authorization": _g("PASS" if consumed else "FAIL", reason)}, "sizing": {}, "constraints": [], "exposure": {}, "prop": {},
            "authorization": None, "existingAuthorization": h.get("executionId")}


def _account_summary(a: dict[str, Any], ps: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    committed = ps["openRiskPct"] + ps["pendingRiskPct"]
    util = {
        "portfolio": {"used": committed, "limit": cfg["maxPortfolioRiskPct"]},
        "dailyLoss": {"used": ps["dailyLossPct"], "limit": cfg["maxDailyLossPct"]},
        "drawdown": {"used": ps["drawdownPct"], "limit": cfg["maxDrawdownPct"]},
        "positions": {"used": ps["positionCount"] + ps["pendingCount"],
                      "limit": min(int(cfg["maxConcurrentPositions"]), int(a.get("maxConcurrentTrades") or cfg["maxConcurrentPositions"]))},
        "marginLevel": {"used": ps["marginLevel"], "limit": cfg["minMarginLevelPct"]},
    }
    cur = sorted(({"currency": c, "netPct": round(v, 4), "limit": cfg["maxCurrencyRiskPct"]} for c, v in ps["currency_exposure"].items() if abs(v) > 1e-9),
                 key=lambda x: -abs(x["netPct"]))
    status = "ACCOUNT_BLOCKED" if ps["issues"] else "ELIGIBLE" if a.get("tradingEnabled") and str(a.get("tradingMode")).upper() != "ANALYSIS_ONLY" else "ANALYSIS_ONLY" \
        if str(a.get("tradingMode")).upper() == "ANALYSIS_ONLY" else "TRADING_DISABLED"
    return {"accountId": a.get("id"), "name": a.get("name"), "accountClass": a.get("accountClass"), "currency": ps["currency"], "login": a.get("login"),
            "server": a.get("server"), "live": ps["live"], "snapshotAgeSec": ps["snapshotAgeSec"], "status": status,
            "issues": [{"code": c, "reason": r} for c, r in ps["issues"]], "tradingEnabled": bool(a.get("tradingEnabled")), "tradingMode": a.get("tradingMode"),
            "balance": ps["balance"], "equity": ps["equity"], "freeMargin": ps["freeMargin"], "margin": ps["margin"], "marginLevel": ps["marginLevel"],
            "leverage": ps["leverage"], "basis": ps["basis"], "openRiskPct": ps["openRiskPct"], "pendingRiskPct": ps["pendingRiskPct"],
            "availableRiskPct": max(0.0, cfg["maxPortfolioRiskPct"] - committed), "dailyLossPct": ps["dailyLossPct"], "drawdownPct": ps["drawdownPct"],
            "dayStartEquity": ps["dayStartEquity"], "peakEquity": ps["peakEquity"], "baselineSource": ps["baselineSource"], "dayPnl": ps["dayPnl"],
            "utilization": util, "currencies": cur, "unknownRisk": ps["unknownRisk"],
            "positions": [{k: p.get(k) for k in ("symbol", "side", "volume", "entry", "sl", "tp", "pnl", "known", "reason")} |
                          {"riskPct": (100 * p["riskMoney"] / ps["basis"]) if p.get("known") and ps["basis"] > 0 else None} for p in ps["positions"]],
            "propRules": a.get("propRules")}


def counters(opps: list[dict[str, Any]], accts: list[dict[str, Any]]) -> dict[str, Any]:
    by: dict[str, int] = {}
    for o in opps:
        by[o["state"]] = by.get(o["state"], 0) + 1
    return {
        "candidates": len(opps),
        "qualified": sum(1 for o in opps if o["setupState"] == "QUALIFIED"),
        "authorized": sum(o["authorizedAccounts"] for o in opps),
        "eligible": sum(o["eligibleAccounts"] for o in opps),
        "waiting": sum(1 for o in opps if o["setupState"] == "WAITING"),
        "blocked": sum(1 for o in opps if o["state"].endswith("_BLOCKED")),
        "stale": sum(1 for o in opps if o["state"] == "STALE"),
        "expired": sum(1 for o in opps if o["state"] == "EXPIRED"),
        "accounts": len(accts),
        "eligibleAccounts": sum(1 for a in accts if a["status"] == "ELIGIBLE"),
        "byState": by,
    }


def signature(o: dict[str, Any]) -> tuple:
    g = o.get("geometry") or {}
    return (o.get("state"), o.get("setupState"), o.get("reasonCode"), o.get("setupReasonCode"),
            tuple((e.get("accountId"), e.get("state"), e.get("reasonCode"), (e.get("sizing") or {}).get("volume")) for e in o.get("accounts") or []),
            None if g.get("rewardRisk") is None else round(float(g["rewardRisk"]), 1), int(float(o.get("score") or 0) // 5))
