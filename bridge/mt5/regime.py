"""Stage 3 Historical Regime engine.

Derives currency/XAU strength trajectories from closed MT5 D1 bars, classifies each asset
with hysteresis (noise filtering), detects confirmed transitions and builds pair-level
regime intelligence. Pure computation: MT5 access and SQL persistence live in server.py/db.py.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timezone
from typing import Any

FIAT = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"]
ASSETS = FIAT + ["XAU"]
FX_PAIRS = [
    "EURUSD", "EURGBP", "EURJPY", "EURCHF", "EURCAD", "EURAUD", "EURNZD",
    "GBPUSD", "GBPJPY", "GBPCHF", "GBPCAD", "GBPAUD", "GBPNZD",
    "USDJPY", "USDCHF", "USDCAD",
    "AUDUSD", "AUDJPY", "AUDCHF", "AUDCAD", "AUDNZD",
    "NZDUSD", "NZDJPY", "NZDCHF", "NZDCAD",
    "CADJPY", "CADCHF", "CHFJPY",
]
XAU_SYMBOL = "XAUUSD"
SYMBOLS = FX_PAIRS + [XAU_SYMBOL]

REGIMES = [
    "Strengthening", "Accelerating", "Persistent", "Stable",
    "Deteriorating", "Weakening", "Recovering", "Reversing",
]

CONFIG: dict[str, Any] = {
    # Horizons in closed D1 observations: Quarterly/Monthly = macro, Weekly/Daily = current evolution.
    "windows": {"Q": 63, "M": 21, "W": 5, "D": 1},
    "weights": {"Q": 0.35, "M": 0.25, "W": 0.25, "D": 0.15},
    "sigmaWindow": 120,
    "sigmaWindowMin": 60,
    "minFiatForSigma": 5,
    "smoothingSpan": 3,
    "momentumLag": 10,
    "accelLag": 5,
    "levelBand": 2.0,
    # Momentum band adapts to each asset's own recent momentum magnitude.
    "momentumBandFactor": 0.8,
    "momentumBandWindow": 60,
    "momentumBandFloor": 0.5,
    "accelFactor": 0.25,
    "confirmObs": 8,
    "candidateDominance": 0.6,
    "retentionFactor": 0.7,
    "minTransitionConfidence": 40.0,
    "persistenceWindow": 20,
    "historyObs": 260,
    "barsToFetch": 700,
    "pairBand": 1.5,
    "minPairsPerCurrency": 4,
    "scale": 10.0,
}
CONFIG["requiredObs"] = CONFIG["momentumLag"] + CONFIG["accelLag"] + CONFIG["confirmObs"]
CONFIG["barsRequired"] = CONFIG["windows"]["Q"] + CONFIG["sigmaWindowMin"] + CONFIG["requiredObs"]


def split_symbol(symbol: str) -> tuple[str, str]:
    return symbol[:3], symbol[3:6]


def _sign(x: float, dead: float = 0.0) -> int:
    if x > dead:
        return 1
    if x < -dead:
        return -1
    return 0


def _bar_date(ts: int) -> date:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).date()


# ---------------------------------------------------------------- series building

def _aligned_closes(data: dict[str, dict[str, Any]]) -> tuple[list[date], dict[str, list[float | None]], bool]:
    """Union D1 date index with forward-filled closes. Returns (dates, closes, last_bar_forming)."""
    per_symbol: dict[str, dict[date, float]] = {}
    for sym, payload in data.items():
        per_symbol[sym] = {_bar_date(t): c for t, c in zip(payload["times"], payload["closes"]) if c > 0}
    dates = sorted({d for m in per_symbol.values() for d in m})
    closes: dict[str, list[float | None]] = {}
    for sym, by_date in per_symbol.items():
        last: float | None = None
        col: list[float | None] = []
        for d in dates:
            if d in by_date:
                last = by_date[d]
            col.append(last)
        closes[sym] = col

    forming = False
    if dates:
        latest = dates[-1]
        # Last bar is still forming when a live (non-stale) tick belongs to the latest D1 bar.
        for sym, payload in data.items():
            if not payload["times"]:
                continue
            last_bar_ts = int(payload["times"][-1])
            tick_ts = int(payload.get("tickTime") or 0)
            if _bar_date(last_bar_ts) != latest or not tick_ts:
                continue
            live = (payload.get("nowTs", 0) - tick_ts) < 4 * 3600
            if live and tick_ts < last_bar_ts + 86400:
                forming = True
                break
    return dates, closes, forming


def _log_return(col: list[float | None], i: int, w: int) -> float | None:
    if i - w < 0:
        return None
    a, b = col[i - w], col[i]
    if not a or not b:
        return None
    return math.log(b / a)


def _raw_strengths(dates: list[date], closes: dict[str, list[float | None]]) -> dict[str, dict[str, list[float | None]]]:
    """Basket-relative log returns per asset per window."""
    windows = CONFIG["windows"]
    n = len(dates)
    out: dict[str, dict[str, list[float | None]]] = {a: {k: [None] * n for k in windows} for a in ASSETS}
    for key, w in windows.items():
        for i in range(n):
            contrib: dict[str, list[float]] = {c: [] for c in FIAT}
            for sym in FX_PAIRS:
                col = closes.get(sym)
                if col is None:
                    continue
                r = _log_return(col, i, w)
                if r is None:
                    continue
                base, quote = split_symbol(sym)
                contrib[base].append(r)
                contrib[quote].append(-r)
            for c in FIAT:
                if len(contrib[c]) >= CONFIG["minPairsPerCurrency"]:
                    out[c][key][i] = sum(contrib[c]) / len(contrib[c])
            # XAU vs the 8-currency basket: gold/X = gold/USD * USD/X, averaged (USD/USD = 0).
            gold = closes.get(XAU_SYMBOL)
            usd = out["USD"][key][i]
            if gold is not None and usd is not None:
                rg = _log_return(gold, i, w)
                if rg is not None:
                    out["XAU"][key][i] = rg + usd * (len(FIAT) - 1) / len(FIAT)
    return out


def _scaled_scores(raw: dict[str, dict[str, list[float | None]]], n: int, sigma_window: int) -> dict[str, dict[str, list[float | None]]]:
    """Scale each window with a trailing mean-absolute sigma (fiat pooled, XAU on its own)."""
    scale = CONFIG["scale"]
    out: dict[str, dict[str, list[float | None]]] = {a: {k: [None] * n for k in CONFIG["windows"]} for a in ASSETS}
    for key in CONFIG["windows"]:
        for group, min_members in ((FIAT, CONFIG["minFiatForSigma"]), (["XAU"], 1)):
            abs_by_idx: list[float | None] = []
            for i in range(n):
                vals = [raw[a][key][i] for a in group if raw[a][key][i] is not None]
                if len(vals) < min_members:
                    abs_by_idx.append(None)
                else:
                    abs_by_idx.append(sum(abs(v) for v in vals) / len(vals))  # type: ignore[arg-type]
            prefix_sum = [0.0]
            prefix_gap = [0]
            for v in abs_by_idx:
                prefix_sum.append(prefix_sum[-1] + (v or 0.0))
                prefix_gap.append(prefix_gap[-1] + (1 if v is None else 0))
            for i in range(n):
                lo = i - sigma_window + 1
                if lo < 0 or prefix_gap[i + 1] - prefix_gap[lo] > 0:
                    continue
                sigma = (prefix_sum[i + 1] - prefix_sum[lo]) / sigma_window
                if sigma <= 0:
                    continue
                for a in group:
                    v = raw[a][key][i]
                    if v is not None:
                        out[a][key][i] = round(scale * math.tanh(v / (2 * sigma)), 4)
    return out


# ---------------------------------------------------------------- classification

def classify(s: float, mom: float, acc: float, macro: float, current: float, tm: float) -> str:
    t = CONFIG["levelBand"]
    if abs(macro) > t and abs(current) > t and (macro > 0) != (current > 0) and abs(mom) >= tm and (mom > 0) == (current > 0):
        return "Reversing"
    if s > t:
        if mom >= tm and acc >= CONFIG["accelFactor"] * tm:
            return "Accelerating"
        if mom >= tm:
            return "Strengthening"
        if mom <= -tm:
            return "Deteriorating"
        return "Persistent"
    if s < -t:
        if mom >= tm:
            return "Recovering"
        if mom <= -tm:
            return "Weakening"
        return "Persistent"
    if mom >= tm:
        return "Recovering" if s < 0 else "Strengthening"
    if mom <= -tm:
        return "Deteriorating" if s > 0 else "Weakening"
    return "Stable"


def retains(regime: str, o: dict[str, Any]) -> bool:
    """Exit hysteresis: a confirmed regime holds while its own conditions pass at relaxed thresholds."""
    f = CONFIG["retentionFactor"]
    t, tm = CONFIG["levelBand"], o["momentumBand"]
    s, mom, acc = o["composite"], o["momentum"], o["acceleration"]
    raw = o["raw"]
    if regime == "Accelerating":
        return s > f * t and mom >= f * tm and acc >= -(1 - f) * tm
    if regime == "Strengthening":
        return raw != "Accelerating" and mom >= f * tm and s > -(1 - f) * t
    if regime == "Deteriorating":
        return mom <= -f * tm and s > -(1 - f) * t
    if regime == "Weakening":
        return mom <= -f * tm and s < (1 - f) * t
    if regime == "Recovering":
        return mom >= f * tm and s < (1 - f) * t
    if regime == "Persistent":
        return abs(s) > f * t and abs(mom) < tm / f
    if regime == "Stable":
        return abs(s) <= t / f and abs(mom) < tm / f
    if regime == "Reversing":
        m, c = o["macro"], o["current"]
        return abs(m) > f * t and abs(c) > f * t and (m > 0) != (c > 0) and abs(mom) >= f * tm and (mom > 0) == (c > 0)
    return False


def regime_group(regime: str | None, s: float) -> str:
    if regime in ("Strengthening", "Accelerating") or (regime == "Persistent" and s > 0):
        return "BULLISH"
    if regime in ("Weakening", "Deteriorating") or (regime == "Persistent" and s <= 0):
        return "BEARISH"
    if regime in ("Recovering", "Reversing"):
        return "TRANSITION"
    if regime == "Stable":
        return "NEUTRAL"
    return "UNKNOWN"


def obs_confidence(raw: str, o: dict[str, Any], streak: int) -> float:
    t, tm, n = CONFIG["levelBand"], o["momentumBand"], CONFIG["confirmObs"]
    signs = [_sign(o[k], 0.5) for k in ("q", "m", "w", "d")]
    agreement = abs(sum(signs)) / 4
    magnitude = min(1.0, abs(o["composite"]) / (3 * t))
    clarity = min(1.0, abs(o["momentum"]) / (2 * tm))
    stability = min(1.0, streak / (2 * n))
    if raw == "Stable":
        agreement = 1 - agreement
        magnitude = 1 - min(1.0, abs(o["composite"]) / t)
        clarity = 1 - min(1.0, abs(o["momentum"]) / tm)
    elif raw == "Persistent":
        clarity = 1 - min(1.0, abs(o["momentum"]) / tm)
    elif raw == "Reversing":
        agreement = min(1.0, (abs(o["macro"]) + abs(o["current"])) / (4 * t))
    return round(100 * (0.35 * agreement + 0.25 * magnitude + 0.2 * clarity + 0.2 * stability), 1)


def rule_text(regime: str, o: dict[str, Any]) -> str:
    t, tm = CONFIG["levelBand"], round(o["momentumBand"], 2)
    lag = CONFIG["momentumLag"]
    s, mom, acc = o["composite"], o["momentum"], o["acceleration"]
    if regime == "Accelerating":
        return f"composite {s:+.2f} above +{t} with {lag}-obs momentum {mom:+.2f} >= +{tm} and rising acceleration {acc:+.2f}"
    if regime == "Strengthening":
        return f"composite {s:+.2f} with {lag}-obs momentum {mom:+.2f} >= +{tm}"
    if regime == "Deteriorating":
        return f"composite {s:+.2f} still above zero but {lag}-obs momentum {mom:+.2f} <= -{tm}"
    if regime == "Weakening":
        return f"composite {s:+.2f} with {lag}-obs momentum {mom:+.2f} <= -{tm}"
    if regime == "Recovering":
        return f"composite {s:+.2f} at/below zero but {lag}-obs momentum {mom:+.2f} >= +{tm}"
    if regime == "Persistent":
        return f"composite {s:+.2f} beyond +/-{t} with flat momentum {mom:+.2f} (|m| < {tm})"
    if regime == "Reversing":
        return (
            f"macro Q/M {o['macro']:+.2f} and current W/D {o['current']:+.2f} disagree beyond +/-{t}; "
            f"momentum {mom:+.2f} follows the current trend"
        )
    return f"composite {s:+.2f} within +/-{t} and momentum {mom:+.2f} within +/-{tm}"


# ---------------------------------------------------------------- engine

def _asset_observations(scores: dict[str, list[float | None]], dates: list[date]) -> list[dict[str, Any]]:
    w = CONFIG["weights"]
    macro_w = w["Q"] + w["M"]
    cur_w = w["W"] + w["D"]
    alpha = 2 / (CONFIG["smoothingSpan"] + 1)
    obs: list[dict[str, Any]] = []
    smoothed: float | None = None
    for i, d in enumerate(dates):
        vals = {k: scores[k][i] for k in ("Q", "M", "W", "D")}
        if any(v is None for v in vals.values()):
            smoothed = None
            continue
        q, m, wk, dy = vals["Q"], vals["M"], vals["W"], vals["D"]
        blend = w["Q"] * q + w["M"] * m + w["W"] * wk + w["D"] * dy  # type: ignore[operator]
        smoothed = blend if smoothed is None else alpha * blend + (1 - alpha) * smoothed
        obs.append(
            {
                "date": d,
                "q": q, "m": m, "w": wk, "d": dy,
                "macro": round((w["Q"] * q + w["M"] * m) / macro_w, 4),  # type: ignore[operator]
                "current": round((w["W"] * wk + w["D"] * dy) / cur_w, 4),  # type: ignore[operator]
                "blend": round(blend, 4),
                "composite": round(smoothed, 4),
            }
        )
    lag, alag = CONFIG["momentumLag"], CONFIG["accelLag"]
    band_window = CONFIG["momentumBandWindow"]
    for k, o in enumerate(obs):
        o["prev"] = obs[k - 1]["composite"] if k >= 1 else None
        o["momentum"] = round(o["composite"] - obs[k - lag]["composite"], 4) if k >= lag else None
        if k >= lag + alag and obs[k - alag]["momentum"] is not None:
            o["acceleration"] = round(o["momentum"] - obs[k - alag]["momentum"], 4)
        else:
            o["acceleration"] = None
        trailing = [abs(x["momentum"]) for x in obs[max(0, k - band_window + 1) : k + 1] if x["momentum"] is not None]
        typical = sum(trailing) / len(trailing) if trailing else 0.0
        o["momentumBand"] = round(max(CONFIG["momentumBandFloor"], CONFIG["momentumBandFactor"] * typical), 4)
        if o["momentum"] is not None and o["acceleration"] is not None:
            o["raw"] = classify(o["composite"], o["momentum"], o["acceleration"], o["macro"], o["current"], o["momentumBand"])
        else:
            o["raw"] = None
    streak = 0
    prev_raw = None
    for o in obs:
        if o["raw"] is None:
            streak, prev_raw = 0, None
            o["streak"] = 0
            o["obsConfidence"] = 0.0
            continue
        streak = streak + 1 if o["raw"] == prev_raw else 1
        prev_raw = o["raw"]
        o["streak"] = streak
        o["obsConfidence"] = obs_confidence(o["raw"], o, streak)
    return obs


def _mode_latest(values: list[str]) -> str:
    """Most frequent class; ties resolved by the most recent occurrence."""
    counts: dict[str, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    best = max(counts.values())
    for v in reversed(values):
        if counts[v] == best:
            return v
    return values[-1]


def _step(state: dict[str, Any], closed: list[dict[str, Any]], k: int, asset: str) -> dict[str, Any] | None:
    """Advance hysteresis with closed observation k. Returns a confirmed transition or None.

    Every consecutive observation that disagrees with the confirmed regime counts toward a
    challenge; after `confirmObs` of them the dominant challenger replaces the regime (if the
    challengers' mean confidence clears the floor). One agreeing observation resets the challenge.
    """
    n = CONFIG["confirmObs"]
    o = closed[k]
    raw = o["raw"]
    if raw is None:
        return None
    if state["regime"] is not None and (raw == state["regime"] or retains(state["regime"], o)):
        state["candidate"], state["candidateCount"], state["candidateSince"] = None, 0, None
        return None
    if state["candidateCount"] == 0:
        state["candidateSince"] = o["date"]
    state["candidateCount"] += 1
    recent = closed[max(0, k - min(state["candidateCount"], n) + 1) : k + 1]
    challengers = [x["raw"] for x in recent if x["raw"]]
    candidate = _mode_latest(challengers)
    state["candidate"] = candidate
    if state["candidateCount"] < n:
        return None
    if challengers.count(candidate) < math.ceil(CONFIG["candidateDominance"] * n):
        return None
    if state["regime"] is None:
        state["regime"], state["since"] = candidate, state["candidateSince"]
        state["candidate"], state["candidateCount"], state["candidateSince"] = None, 0, None
        return None
    mean_conf = sum(x["obsConfidence"] for x in recent) / len(recent)
    if mean_conf < CONFIG["minTransitionConfidence"]:
        return None
    transition = {
        "asset": asset,
        "prev": state["regime"],
        "prevSince": state["since"],
        "new": candidate,
        "firstSeen": state["candidateSince"],
        "confirmedAt": o["date"],
        "confidence": round(mean_conf, 1),
    }
    state["regime"], state["since"] = candidate, state["candidateSince"]
    state["candidate"], state["candidateCount"], state["candidateSince"] = None, 0, None
    return transition


def _regime_metrics(state: dict[str, Any], closed: list[dict[str, Any]], k: int) -> dict[str, Any]:
    """Regime-level confidence/persistence/duration at closed observation index k."""
    regime = state["regime"]
    if regime is None:
        return {"confidence": 0.0, "persistence": 0.0, "duration": 0}
    recent = closed[max(0, k - 4) : k + 1]
    target = regime_group(regime, closed[k]["composite"])

    def credit(o: dict[str, Any]) -> float:
        if o["raw"] == regime:
            return o["obsConfidence"]
        if o["raw"] and regime_group(o["raw"], o["composite"]) == target:
            return o["obsConfidence"] * 0.5
        return 0.0

    conf = sum(credit(o) for o in recent) / len(recent)
    pw = CONFIG["persistenceWindow"]
    window = closed[max(0, k - pw + 1) : k + 1]
    same = sum(1 for o in window if o["raw"] and regime_group(o["raw"], o["composite"]) == target)
    duration = sum(1 for o in closed[: k + 1] if state["since"] and o["date"] >= state["since"])
    return {"confidence": round(conf, 1), "persistence": round(100 * same / len(window), 1), "duration": duration}


def _snapshot_row(asset: str, o: dict[str, Any], state: dict[str, Any], metrics: dict[str, Any], closed: bool, raw: str | None) -> dict[str, Any]:
    return {
        "asset": asset,
        "date": o["date"],
        "closed": closed,
        "q": o["q"], "m": o["m"], "w": o["w"], "d": o["d"],
        "macro": o["macro"], "current": o["current"], "composite": o["composite"],
        "prev": o["prev"], "momentum": o["momentum"], "acceleration": o["acceleration"],
        "momentumBand": o["momentumBand"],
        "raw": raw,
        "regime": state["regime"],
        "since": state["since"],
        "candidate": state["candidate"],
        "candidateCount": state["candidateCount"],
        "candidateSince": state["candidateSince"],
        "duration": metrics["duration"],
        "confidence": metrics["confidence"],
        "obsConfidence": o["obsConfidence"],
        "persistence": metrics["persistence"],
    }


def _evidence(transition: dict[str, Any], closed: list[dict[str, Any]], k: int) -> dict[str, Any]:
    n = CONFIG["confirmObs"]
    confirm = closed[max(0, k - n + 1) : k + 1]
    rule_obs = next((o for o in reversed(confirm) if o["raw"] == transition["new"]), closed[k])
    return {
        "firstSeen": transition["firstSeen"].isoformat(),
        "confirmedAt": transition["confirmedAt"].isoformat(),
        "previous": {
            "regime": transition["prev"],
            "since": transition["prevSince"].isoformat() if transition["prevSince"] else None,
            "durationObs": sum(
                1 for o in closed[:k] if transition["prevSince"] and transition["prevSince"] <= o["date"] < transition["firstSeen"]
            ),
        },
        "observations": [
            {
                "date": o["date"].isoformat(),
                "raw": o["raw"],
                "composite": o["composite"],
                "momentum": o["momentum"],
                "acceleration": o["acceleration"],
                "macro": o["macro"],
                "current": o["current"],
                "q": o["q"], "m": o["m"], "w": o["w"], "d": o["d"],
                "confidence": o["obsConfidence"],
            }
            for o in confirm
        ],
        "rule": rule_text(transition["new"], rule_obs),
        "ruleObservation": rule_obs["date"].isoformat(),
        "thresholds": {
            "levelBand": CONFIG["levelBand"],
            "momentumBand": rule_obs["momentumBand"],
            "confirmObs": n,
            "minConfidence": CONFIG["minTransitionConfidence"],
        },
    }


def run(data: dict[str, dict[str, Any]], persisted: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Compute trajectories and continue hysteresis from persisted state.

    `data`: {symbol: {times, closes, tickTime, nowTs}} from MT5 D1 bars.
    `persisted`: {asset: {lastClosedDate, regime, since, candidate, candidateCount, candidateSince}}.
    """
    dates, closes, forming = _aligned_closes(data)
    n = len(dates)
    windows = CONFIG["windows"]
    sigma_window = min(CONFIG["sigmaWindow"], n - windows["Q"] - CONFIG["requiredObs"])
    missing = [s for s in SYMBOLS if s not in data]

    asset_meta: dict[str, dict[str, Any]] = {}
    snapshots: list[dict[str, Any]] = []
    transitions: list[dict[str, Any]] = []
    latest: dict[str, dict[str, Any]] = {}

    if sigma_window < CONFIG["sigmaWindowMin"]:
        for a in ASSETS:
            asset_meta[a] = {
                "status": "WARMING_UP",
                "collected": 0,
                "required": CONFIG["requiredObs"],
                "bars": n,
                "barsRequired": CONFIG["barsRequired"],
                "message": f"Collecting D1 history: {n}/{CONFIG['barsRequired']} bars",
            }
        return {"assets": asset_meta, "snapshots": [], "transitions": [], "latest": {}, "pairs": [], "strengths": [],
                "forming": forming, "latestDate": dates[-1].isoformat() if dates else None, "missing": missing, "bars": n}

    raw = _raw_strengths(dates, closes)
    scores = _scaled_scores(raw, n, sigma_window)
    history_obs = CONFIG["historyObs"]

    for asset in ASSETS:
        obs = _asset_observations(scores[asset], dates)
        closed = obs[:-1] if (forming and obs and obs[-1]["date"] == dates[-1]) else obs
        forming_obs = obs[-1] if len(closed) < len(obs) else None
        classifiable = [o for o in closed if o["raw"] is not None]
        if len(classifiable) < CONFIG["confirmObs"]:
            asset_meta[asset] = {
                "status": "WARMING_UP",
                "collected": len(classifiable),
                "required": CONFIG["requiredObs"],
                "bars": n,
                "barsRequired": CONFIG["barsRequired"],
                "message": f"Collecting observations: {len(classifiable)}/{CONFIG['requiredObs']}",
            }
            continue

        prior = persisted.get(asset)
        dates_closed = [o["date"] for o in closed]
        start = 0
        state = {"regime": None, "since": None, "candidate": None, "candidateCount": 0, "candidateSince": None}
        backfill = True
        if prior and prior.get("lastClosedDate") in dates_closed:
            start = dates_closed.index(prior["lastClosedDate"]) + 1
            state = {
                "regime": prior.get("regime"),
                "since": prior.get("since"),
                "candidate": prior.get("candidate"),
                "candidateCount": int(prior.get("candidateCount") or 0),
                "candidateSince": prior.get("candidateSince"),
            }
            backfill = False
        history_start = max(0, len(closed) - history_obs)

        for k in range(start, len(closed)):
            o = closed[k]
            t = _step(state, closed, k, asset)
            if t:
                t["evidence"] = _evidence(t, closed, k)
                t["reason"] = (
                    f"{t['prev']} -> {t['new']}: {t['evidence']['rule']}; held for {CONFIG['confirmObs']} consecutive "
                    f"closed D1 observations ({t['firstSeen'].isoformat()} to {t['confirmedAt'].isoformat()}), "
                    f"confidence {t['confidence']:.0f}%"
                )
                if not backfill or k >= history_start:
                    transitions.append(t)
            if not backfill or k >= history_start:
                snapshots.append(_snapshot_row(asset, o, state, _regime_metrics(state, closed, k), True, o["raw"]))

        last_k = len(closed) - 1
        metrics = _regime_metrics(state, closed, last_k)
        latest_row = _snapshot_row(asset, closed[last_k], state, metrics, True, closed[last_k]["raw"])
        if forming_obs is not None:
            # Provisional intraday observation: shown live, never advances the confirmed regime.
            latest_row = _snapshot_row(asset, forming_obs, state, metrics, False, forming_obs["raw"])
            snapshots.append(latest_row)
        latest[asset] = latest_row
        asset_meta[asset] = {
            "status": "CLASSIFIED" if state["regime"] else "WARMING_UP",
            "collected": len(classifiable),
            "required": CONFIG["requiredObs"],
            "bars": n,
            "barsRequired": CONFIG["barsRequired"],
            "processed": len(closed) - start,
            "backfill": backfill,
        }

    pairs = build_pairs(latest)
    strengths = build_strengths(latest)
    return {
        "assets": asset_meta,
        "snapshots": snapshots,
        "transitions": transitions,
        "latest": latest,
        "pairs": pairs,
        "strengths": strengths,
        "forming": forming,
        "latestDate": dates[-1].isoformat() if dates else None,
        "missing": missing,
        "bars": n,
    }


# ---------------------------------------------------------------- downstream outputs

def build_pairs(latest: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    band = CONFIG["pairBand"]
    out: list[dict[str, Any]] = []
    for sym in SYMBOLS:
        base, quote = split_symbol(sym)
        b, q = latest.get(base), latest.get(quote)
        tm = max(b["momentumBand"], q["momentumBand"]) if b and q else CONFIG["momentumBandFloor"]
        if not b or not q or not b["regime"] or not q["regime"]:
            out.append({
                "symbol": sym, "base": base, "quote": quote, "status": "WARMING_UP", "bias": "NEUTRAL",
                "differential": round((b["composite"] - q["composite"]) if b and q else 0.0, 3),
                "conviction": 0.0, "persistence": 0.0, "momentum": 0.0, "confidence": 0.0,
                "baseRegime": b["regime"] if b else None, "quoteRegime": q["regime"] if q else None,
                "relationship": "WARMING_UP",
                "reason": "Base or quote regime not yet confirmed — no directional conviction published",
                "date": (b or q or {}).get("date"),
            })
            continue
        diff = b["composite"] - q["composite"]
        direction = _sign(diff)
        bias = "BULLISH" if diff > band else "BEARISH" if diff < -band else "NEUTRAL"
        gb, gq = regime_group(b["regime"], b["composite"]), regime_group(q["regime"], q["composite"])
        directional = ("BULLISH", "BEARISH")
        align = 0
        if gb == "BULLISH" and gq == "BEARISH":
            relationship, align = "ALIGNED_LONG", 1
        elif gb == "BEARISH" and gq == "BULLISH":
            relationship, align = "ALIGNED_SHORT", -1
        elif gb == gq and gb in directional:
            relationship = "SAME_REGIME"
        elif gb in directional and gq not in directional:
            relationship, align = "BASE_LED", (1 if gb == "BULLISH" else -1)
        elif gq in directional and gb not in directional:
            relationship, align = "QUOTE_LED", (-1 if gq == "BULLISH" else 1)
        else:
            relationship = "NEUTRAL"

        parts: list[str] = []
        score = 55 * min(1.0, abs(diff) / 8)
        parts.append(f"differential {diff:+.2f} -> {score:.0f}")
        if relationship in ("ALIGNED_LONG", "ALIGNED_SHORT"):
            adj = 30 if align == direction else -25
            score += adj
            parts.append(f"{base} {b['regime']} vs {quote} {q['regime']} ({'confirms' if adj > 0 else 'contradicts'} {adj:+d})")
        elif relationship in ("BASE_LED", "QUOTE_LED"):
            adj = 15 if align == direction else -15
            score += adj
            parts.append(f"one-sided regime {relationship.lower()} ({adj:+d})")
        elif relationship == "SAME_REGIME":
            score -= 20
            parts.append(f"both {gb.lower()} regimes reduce conviction (-20)")
        mom = (b["momentum"] or 0.0) - (q["momentum"] or 0.0)
        if abs(mom) >= tm and direction != 0:
            adj = 10 if _sign(mom) == direction else -10
            score += adj
            parts.append(f"momentum differential {mom:+.2f} ({adj:+d})")
        confidence = (b["confidence"] + q["confidence"]) / 2
        conviction = max(0.0, min(100.0, score * (0.5 + 0.5 * confidence / 100)))
        if bias == "NEUTRAL":
            conviction = min(conviction, 30.0)
            parts.append("differential inside neutral band (cap 30)")
        out.append({
            "symbol": sym, "base": base, "quote": quote, "status": "READY", "bias": bias,
            "differential": round(diff, 3), "conviction": round(conviction, 1),
            "persistence": round((b["persistence"] + q["persistence"]) / 2, 1),
            "momentum": round(mom, 3), "confidence": round(confidence, 1),
            "baseRegime": b["regime"], "quoteRegime": q["regime"], "relationship": relationship,
            "reason": "; ".join(parts) + f"; confidence-weighted by {confidence:.0f}%",
            "date": max(b["date"], q["date"]),
        })
    return out


def build_strengths(latest: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Stage 2 currency/XAU strength rows derived from the same trajectories."""
    t = CONFIG["levelBand"]
    trend_map = {
        "Strengthening": "Strengthening", "Accelerating": "Strengthening",
        "Weakening": "Weakening", "Deteriorating": "Weakening",
        "Recovering": "Recovering", "Reversing": "Recovering", "Stable": "Stable",
    }
    rows = []
    for asset, r in latest.items():
        regime = r["regime"]
        trend = trend_map.get(regime or "", "Stable")
        if regime == "Persistent":
            trend = "Strengthening" if r["composite"] > 0 else "Weakening"
        classification = "STRONG" if r["macro"] > t else "WEAK" if r["macro"] < -t else "NEUTRAL"
        rows.append({
            "code": asset,
            "q": round(r["q"], 2),
            "m": round(r["m"], 2),
            "score": round(r["macro"], 2),
            "trend": trend,
            "classification": classification if regime else "WARMING UP",
        })
    rows.sort(key=lambda x: x["score"], reverse=True)
    return rows
