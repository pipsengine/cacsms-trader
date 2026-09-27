"""Stage 4 Market Scanner engine: rank the 29-instrument universe by regime conviction and promote candidates.

Pure functions only: inputs are Stage 1 readiness (validated history + live quote), Stage 2 strength and Stage 3
regime observations (latest closed D1 per asset). Output is one scored, explained record per instrument plus
pipeline counters. The scanner never places trades and never runs downstream (channel / H1) logic.
"""

from __future__ import annotations

import copy
from datetime import date, datetime, timezone
from typing import Any

try:
    import regime
except ImportError:  # pragma: no cover
    from bridge.mt5 import regime  # type: ignore

SYMBOLS: list[str] = list(regime.SYMBOLS)
STAGE1_TFS = ("D1", "H8", "H1")

CONFIG: dict[str, Any] = {
    "neutralBand": 1.5,           # |base − quote composite| below this is NEUTRAL (composite scale ±10)
    "strongDiff": 6.0,            # differential needed for STRONG_* bias (with aligned regimes)
    "strongConviction": 65.0,
    "diffFull": 8.0,              # differential that earns the full differential component
    "trajectoryDead": 0.25,       # momentum / acceleration differential dead-band
    "neutralCap": 30.0,           # conviction ceiling for a NEUTRAL bias
    "weights": {"differential": 35, "aligned": 25, "led": 12, "similar": -15, "conflicting": -20,
                "trajectory": 10, "acceleration": 5, "macro": 5, "current": 5, "persistence": 10},
    "promotion": {
        "minConviction": 55.0,
        "minConfidence": 45.0,
        "minPersistence": 30.0,
        "hysteresis": 5.0,        # an already promoted instrument keeps promotion down to minConviction − hysteresis
        "rejectAlignments": ["CONFLICTING", "SIMILAR"],
        "promoteWhenMarketClosed": True,  # closed D1/H8 candles are valid for HTF analysis; live execution stays gated
    },
    "qualifyConviction": 45.0,
    "watchConviction": 25.0,
    "maxTickAgeSec": 120,
    # XAUUSD: gold strength is scaled against its own volatility (not pooled with fiat), so wider bands.
    "xau": {"neutralBand": 2.0, "strongDiff": 7.5, "diffFull": 10.0},
}

# Operator-tunable settings (persisted in app_settings) with their allowed ranges.
TUNABLE: dict[str, tuple[float, float]] = {
    "promotion.minConviction": (0, 100), "promotion.minConfidence": (0, 100), "promotion.minPersistence": (0, 100),
    "promotion.hysteresis": (0, 20), "qualifyConviction": (0, 100), "watchConviction": (0, 100),
    "neutralBand": (0.1, 10), "strongDiff": (0.5, 20),
}


def merge_config(overrides: dict[str, Any] | None) -> dict[str, Any]:
    """Defaults + validated operator overrides; raises ValueError on anything out of range or unknown."""
    cfg = copy.deepcopy(CONFIG)
    for key, value in (overrides or {}).items():
        if key == "promotion.promoteWhenMarketClosed":
            cfg["promotion"]["promoteWhenMarketClosed"] = bool(value)
            continue
        if key not in TUNABLE:
            raise ValueError(f"Unknown scanner setting {key}")
        lo, hi = TUNABLE[key]
        v = float(value)
        if not lo <= v <= hi:
            raise ValueError(f"{key} must be between {lo:g} and {hi:g}")
        *path, leaf = key.split(".")
        (cfg[path[0]] if path else cfg)[leaf] = v
    if cfg["watchConviction"] > cfg["qualifyConviction"]:
        raise ValueError("watchConviction must not exceed qualifyConviction")
    return cfg


STATES = ("PROMOTED", "QUALIFIED", "WATCH", "NEUTRAL", "BLOCKED", "STALE", "INSUFFICIENT_DATA")
S1_RANK = {"BLOCKED": 0, "INSUFFICIENT_DATA": 1, "STALE": 2, "CLOSED": 3, "READY": 4}


def _sign(x: float | None, dead: float) -> int:
    if x is None:
        return 0
    return 1 if x > dead else -1 if x < -dead else 0


def _r(x: float | None, n: int = 2) -> float | None:
    return None if x is None else round(float(x), n)


def _date(v: Any) -> date | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def model_for(symbol: str) -> str:
    return "XAU_DEDICATED" if symbol == regime.XAU_SYMBOL else "FIAT"


def params_for(symbol: str, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or CONFIG
    p = {k: cfg[k] for k in ("neutralBand", "strongDiff", "diffFull")}
    if symbol == regime.XAU_SYMBOL:
        p.update(cfg.get("xau") or {})
    return p


# ---------------------------------------------------------------- Stage 1 readiness

def stage1_readiness(symbol: str, series: dict[str, dict[str, Any] | None], provider_ok: bool | None,
                     tick: dict[str, Any] | None, market_open: bool, now_ts: float, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Per-instrument data readiness from the Stage 1 history checkpoints plus live quote validity/freshness."""
    cfg = cfg or CONFIG
    tfs: dict[str, dict[str, Any]] = {}
    worst = ("READY", "D1/H8/H1 history complete, valid and fresh")
    for tf in STAGE1_TFS:
        row = series.get(tf)
        st = (row or {}).get("status") or "MISSING"
        why = (row or {}).get("reason") or "no Stage 1 series checkpoint"
        if not provider_ok:
            s = ("BLOCKED", "MT5 provider offline — Stage 1 data frozen")
        elif row is None or st in ("MISSING_HISTORY", "WARMING_UP", "MISSING"):
            s = ("INSUFFICIENT_DATA", f"{tf} {st}: {why}")
        elif st in ("PROVIDER_OFFLINE", "VALIDATION_FAILED"):
            s = ("BLOCKED", f"{tf} {st}: {why}")
        elif st == "STALE":
            s = ("STALE", f"{tf} STALE: {why}")
        else:  # READY / SYNCING — validated and complete
            s = ("READY", f"{tf} {int((row or {}).get('candle_count') or 0)} validated candles")
        tfs[tf] = {"status": s[0], "reason": s[1], "series": st}
        if S1_RANK[s[0]] < S1_RANK[worst[0]]:
            worst = s

    tick_age = None
    if tick and tick.get("time") is not None:
        tick_age = max(0, int(now_ts - int(tick["time"])))
    quote_ok = bool(tick and (tick.get("bid") or 0) > 0 and (tick.get("ask") or 0) >= (tick.get("bid") or 0))
    if worst[0] == "READY":
        if not provider_ok:
            worst = ("BLOCKED", "MT5 provider offline")
        elif market_open:
            if not quote_ok:
                worst = ("BLOCKED", "No valid live bid/ask")
            elif tick_age is None or tick_age > cfg["maxTickAgeSec"]:
                worst = ("STALE", f"Live quote {'age unknown' if tick_age is None else f'{tick_age}s old'} (limit {cfg['maxTickAgeSec']}s)")
        else:
            worst = ("CLOSED", "FX market closed — closed D1/H8/H1 candles valid; live execution gated downstream")
    return {
        "status": worst[0], "reason": worst[1], "marketOpen": bool(market_open), "quoteValid": quote_ok,
        "tickAgeSec": tick_age, "liveEligible": worst[0] == "READY", "timeframes": tfs,
    }


# ---------------------------------------------------------------- per-asset view

def asset_view(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row or row.get("composite") is None:
        return None
    comp = float(row["composite"])
    reg = row.get("regime")
    mom = row.get("momentum")
    return {
        "asset": row["asset"],
        "composite": _r(comp), "macro": _r(row.get("macro")), "current": _r(row.get("current")),
        "momentum": _r(mom), "acceleration": _r(row.get("acceleration")),
        "regime": reg, "group": regime.regime_group(reg, comp) if reg else "UNKNOWN",
        "confidence": _r(row.get("confidence") or 0, 1), "persistence": _r(row.get("persistence") or 0, 1),
        "durationObs": int(row.get("durationObs") or 0),
        "trajectory": "RISING" if _sign(mom, CONFIG["trajectoryDead"]) > 0 else "FALLING" if _sign(mom, CONFIG["trajectoryDead"]) < 0 else "FLAT",
        "date": str(_date(row.get("date"))) if row.get("date") else None,
    }


def _lean(a: dict[str, Any]) -> int:
    """Directional lean of one leg's regime: bullish +1, bearish −1, transition follows momentum."""
    g = a["group"]
    if g == "BULLISH":
        return 1
    if g == "BEARISH":
        return -1
    if g == "TRANSITION":
        return _sign(a.get("momentum"), CONFIG["trajectoryDead"])
    return 0


def relationship(b: dict[str, Any], q: dict[str, Any]) -> tuple[str, int]:
    """Regime combination and the direction it implies for BASE/QUOTE."""
    if not b.get("regime") or not q.get("regime"):
        return "WARMING_UP", 0
    lb, lq = _lean(b), _lean(q)
    if lb > 0 and lq < 0:
        return "STRONG_VS_WEAK", 1
    if lb < 0 and lq > 0:
        return "WEAK_VS_STRONG", -1
    if lb != 0 and lb == lq:
        return "SIMILAR", 0
    if b["regime"] == q["regime"]:
        return "SIMILAR", 0
    if lb != 0:
        return "BASE_LED", lb
    if lq != 0:
        return "QUOTE_LED", -lq
    return "MIXED", 0


def alignment(rel: str, implied: int, direction: int) -> str:
    if rel == "WARMING_UP":
        return "UNCONFIRMED"
    if rel == "SIMILAR":
        return "SIMILAR"
    if direction == 0 or implied == 0:
        return "UNCONFIRMED"
    if implied != direction:
        return "CONFLICTING"
    return "ALIGNED" if rel in ("STRONG_VS_WEAK", "WEAK_VS_STRONG") else "SUPPORTIVE"


# ---------------------------------------------------------------- scoring

def score_pair(symbol: str, b: dict[str, Any], q: dict[str, Any], cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or CONFIG
    w = cfg["weights"]
    p = params_for(symbol, cfg)
    dead = cfg["trajectoryDead"]
    diff = b["composite"] - q["composite"]
    macro_d = (b["macro"] or 0) - (q["macro"] or 0)
    cur_d = (b["current"] or 0) - (q["current"] or 0)
    mom_d = (b["momentum"] - q["momentum"]) if b["momentum"] is not None and q["momentum"] is not None else None
    acc_d = (b["acceleration"] - q["acceleration"]) if b["acceleration"] is not None and q["acceleration"] is not None else None
    d = _sign(diff, p["neutralBand"])
    rel, implied = relationship(b, q)
    align = alignment(rel, implied, d)

    comps: list[dict[str, Any]] = []

    def add(key: str, label: str, pts: float, mx: float, detail: str) -> None:
        comps.append({"key": key, "label": label, "points": round(pts, 1), "max": mx, "detail": detail})

    add("differential", "Strength differential", w["differential"] * min(1.0, abs(diff) / p["diffFull"]), w["differential"],
        f"{b['asset']} {b['composite']:+.2f} − {q['asset']} {q['composite']:+.2f} = {diff:+.2f} (full credit at ±{p['diffFull']:g})")

    rel_pts = {"ALIGNED": w["aligned"], "SUPPORTIVE": w["led"], "SIMILAR": w["similar"], "CONFLICTING": w["conflicting"]}.get(align, 0)
    add("regime", "Regime alignment", rel_pts, w["aligned"],
        f"{b['asset']} {b['regime'] or '—'} ({b['group']}) vs {q['asset']} {q['regime'] or '—'} ({q['group']}) → {rel.replace('_', ' ')}, {align}")

    ms = _sign(mom_d, dead)
    traj = "FLAT" if d == 0 or ms == 0 else "WIDENING" if ms == d else "NARROWING"
    add("trajectory", "Strength trajectory", w["trajectory"] if traj == "WIDENING" else -w["trajectory"] if traj == "NARROWING" else 0,
        w["trajectory"], f"Momentum differential {mom_d:+.2f} → gap {traj.lower()}" if mom_d is not None else "Momentum not yet available")

    acs = _sign(acc_d, dead)
    accel = "STEADY" if d == 0 or acs == 0 else "ACCELERATING" if acs == d else "DECELERATING"
    add("acceleration", "Acceleration", w["acceleration"] if accel == "ACCELERATING" else -w["acceleration"] if accel == "DECELERATING" else 0,
        w["acceleration"], f"Acceleration differential {acc_d:+.2f} → {accel.lower()}" if acc_d is not None else "Acceleration not yet available")

    mb = _sign(macro_d, p["neutralBand"])
    macro_bias = "BULLISH" if mb > 0 else "BEARISH" if mb < 0 else "NEUTRAL"
    add("macro", "Macro bias (Q+M)", w["macro"] if d and mb == d else -w["macro"] if d and mb == -d else 0, w["macro"],
        f"Macro differential {macro_d:+.2f} → {macro_bias}")

    cs = _sign(cur_d, p["neutralBand"])
    add("current", "Current strength (W+D)", w["current"] if d and cs == d else -w["current"] if d and cs == -d else 0, w["current"],
        f"Current differential {cur_d:+.2f}" + (" confirms" if d and cs == d else " diverges" if d and cs == -d else " is flat"))

    pers = (b["persistence"] + q["persistence"]) / 2
    add("persistence", "Regime persistence", w["persistence"] * pers / 100, w["persistence"],
        f"{b['asset']} {b['persistence']:.0f}% · {q['asset']} {q['persistence']:.0f}% over the persistence window")

    raw = max(0.0, min(100.0, sum(c["points"] for c in comps)))
    conf = (b["confidence"] + q["confidence"]) / 2
    conviction = raw * (0.5 + 0.5 * conf / 100)
    if d == 0:
        conviction = min(conviction, cfg["neutralCap"])
    conviction = round(conviction, 1)

    if d == 0:
        direction = "NEUTRAL"
    else:
        strong = abs(diff) >= p["strongDiff"] and align == "ALIGNED" and conviction >= cfg["strongConviction"]
        direction = ("STRONG_" if strong else "") + ("BULLISH" if d > 0 else "BEARISH")

    return {
        "direction": direction, "sign": d, "conviction": conviction, "rawScore": round(raw, 1), "confidence": round(conf, 1),
        "differential": round(diff, 2), "macroDifferential": round(macro_d, 2), "currentDifferential": round(cur_d, 2),
        "momentumDifferential": _r(mom_d), "accelerationDifferential": _r(acc_d),
        "macroBias": macro_bias, "trajectory": traj, "acceleration": accel,
        "relationship": rel, "alignment": align, "persistence": round(pers, 1), "components": comps,
        "params": p,
    }


# ---------------------------------------------------------------- state + promotion

def freshness(b: dict[str, Any] | None, q: dict[str, Any] | None, expected: date | None, regime_status: str | None) -> dict[str, Any]:
    dates = [_date(x["date"]) for x in (b, q) if x and x.get("date")]
    obs = min(dates) if dates else None
    lag = (expected - obs).days if expected and obs else None
    if regime_status == "BLOCKED":
        st, why = "STALE", "Stage 3 last run BLOCKED — strength not refreshed"
    elif obs is None:
        st, why = "UNKNOWN", "No closed strength observation"
    elif expected and obs < expected:
        st, why = "STALE", f"Strength observation {obs} behind latest closed D1 {expected} (Stage 3 re-run pending)"
    else:
        st, why = "CURRENT", f"Strength from closed D1 {obs}" + (f" (latest Stage 1 close {expected})" if expected else "")
    return {"status": st, "reason": why, "obsDate": str(obs) if obs else None,
            "expectedDate": str(expected) if expected else None, "lagDays": lag}


def evaluate(symbol: str, assets: dict[str, dict[str, Any]], s1: dict[str, Any], expected: date | None,
             regime_status: str | None, was_promoted: bool, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or CONFIG
    pc = cfg["promotion"]
    base, quote = regime.split_symbol(symbol)
    b, q = asset_view(assets.get(base)), asset_view(assets.get(quote))
    fresh = freshness(b, q, expected, regime_status)
    out: dict[str, Any] = {
        "symbol": symbol, "baseAsset": base, "quoteAsset": quote, "model": model_for(symbol),
        "base": b, "quote": q, "stage1": s1, "freshness": fresh,
    }

    if b is None or q is None:
        missing = [a for a, v in ((base, b), (quote, q)) if v is None]
        out.update({"state": "INSUFFICIENT_DATA", "direction": "NEUTRAL", "conviction": None, "rawScore": None,
                    "confidence": None, "differential": None, "relationship": "WARMING_UP", "alignment": "UNCONFIRMED",
                    "components": [], "reason": f"No Stage 2/3 strength for {', '.join(missing)}",
                    "promotion": {"eligible": False, "promoted": False, "rules": [], "reason": "Insufficient strength data"}})
        return out

    sc = score_pair(symbol, b, q, cfg)
    out.update(sc)

    threshold = pc["minConviction"] - (pc["hysteresis"] if was_promoted else 0)
    s1_ok = s1["status"] == "READY" or (s1["status"] == "CLOSED" and pc["promoteWhenMarketClosed"])
    rules = [
        {"key": "regimes", "label": "Both legs classified", "pass": bool(b["regime"] and q["regime"]),
         "detail": f"{base} {b['regime'] or 'warming up'} · {quote} {q['regime'] or 'warming up'}"},
        {"key": "direction", "label": "Directional bias", "pass": sc["sign"] != 0,
         "detail": f"|differential| {abs(sc['differential']):.2f} vs neutral band {sc['params']['neutralBand']:g}"},
        {"key": "conviction", "label": "Conviction threshold", "pass": sc["conviction"] >= threshold,
         "detail": f"{sc['conviction']:.1f} vs {threshold:g}" + (" (hysteresis while promoted)" if was_promoted else "")},
        {"key": "confidence", "label": "Regime confidence", "pass": sc["confidence"] >= pc["minConfidence"],
         "detail": f"{sc['confidence']:.1f} vs {pc['minConfidence']:g}"},
        {"key": "persistence", "label": "Regime persistence", "pass": sc["persistence"] >= pc["minPersistence"],
         "detail": f"{sc['persistence']:.1f}% vs {pc['minPersistence']:g}%"},
        {"key": "alignment", "label": "Regime relationship", "pass": sc["alignment"] not in pc["rejectAlignments"],
         "detail": f"{sc['alignment']} ({sc['relationship'].replace('_', ' ')})"},
        {"key": "freshness", "label": "Strength freshness", "pass": fresh["status"] == "CURRENT", "detail": fresh["reason"]},
        {"key": "stage1", "label": "Stage 1 data readiness", "pass": s1_ok, "detail": f"{s1['status']}: {s1['reason']}"},
    ]
    failed = [r for r in rules if not r["pass"]]
    promoted = not failed
    reject = "; ".join(f"{r['label']}: {r['detail']}" for r in failed)

    if not (b["regime"] and q["regime"]):
        state = "INSUFFICIENT_DATA"
        reason = f"Regime warming up — {rules[0]['detail']}"
    elif s1["status"] in ("BLOCKED", "INSUFFICIENT_DATA"):
        state = "BLOCKED" if s1["status"] == "BLOCKED" else "INSUFFICIENT_DATA"
        reason = f"Stage 1 {s1['status']}: {s1['reason']} — intelligence shown for visibility, not promoted"
    elif fresh["status"] != "CURRENT" or s1["status"] == "STALE" or (s1["status"] == "CLOSED" and not pc["promoteWhenMarketClosed"]):
        state = "STALE"
        reason = (fresh["reason"] if fresh["status"] != "CURRENT" else f"Stage 1 {s1['status']}: {s1['reason']}") + " — not promoted"
    elif promoted:
        state = "PROMOTED"
        reason = f"{sc['direction']} · conviction {sc['conviction']:.0f} · {sc['alignment'].lower()} regimes → HTF Market Vision"
    elif sc["sign"] == 0:
        state = "NEUTRAL"
        reason = f"Differential {sc['differential']:+.2f} inside ±{sc['params']['neutralBand']:g} neutral band"
    elif sc["conviction"] >= cfg["qualifyConviction"]:
        state = "QUALIFIED"
        reason = f"Qualified but not promoted — {reject}"
    elif sc["conviction"] >= cfg["watchConviction"]:
        state = "WATCH"
        reason = f"Watch — {reject}"
    else:
        state = "NEUTRAL"
        reason = f"Low conviction — {reject}"

    evidence = [
        f"{base} {b['composite']:+.2f} ({b['regime']}, {b['trajectory'].lower()}) vs {quote} {q['composite']:+.2f} ({q['regime']}, {q['trajectory'].lower()})",
        f"Differential {sc['differential']:+.2f} · macro {sc['macroDifferential']:+.2f} · current {sc['currentDifferential']:+.2f}",
        f"Relationship {sc['relationship'].replace('_', ' ')} · {sc['alignment']} · trajectory {sc['trajectory']} · {sc['acceleration']}",
        f"Persistence {sc['persistence']:.0f}% · confidence {sc['confidence']:.0f} · {fresh['reason']}",
    ]
    if symbol == regime.XAU_SYMBOL:
        evidence.append("XAU dedicated model: gold vs the 8-currency basket, scaled on its own volatility; wider bands")

    out.update({
        "state": state, "reason": reason, "evidence": evidence,
        "promotion": {"eligible": promoted, "promoted": state == "PROMOTED", "threshold": threshold, "rules": rules,
                      "reason": "All promotion rules passed" if promoted else reject,
                      "liveEligible": state == "PROMOTED" and s1["liveEligible"]},
    })
    return out


def rank(assets: dict[str, dict[str, Any]], stage1: dict[str, dict[str, Any]], expected: date | None,
         regime_status: str | None, previously_promoted: set[str], cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or CONFIG
    rows = [evaluate(sym, assets, stage1[sym], expected, regime_status, sym in previously_promoted, cfg) for sym in SYMBOLS]
    rows.sort(key=lambda r: (-(r["conviction"] if r["conviction"] is not None else -1), -abs(r["differential"] or 0), r["symbol"]))
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    counts = {s: sum(1 for r in rows if r["state"] == s) for s in STATES}
    return {
        "instruments": rows,
        "counters": {
            "universe": len(SYMBOLS),
            "available": sum(1 for r in rows if r["stage1"]["status"] in ("READY", "CLOSED")),
            "directional": sum(1 for r in rows if r["direction"] != "NEUTRAL" and r["state"] != "INSUFFICIENT_DATA"),
            "promoted": counts["PROMOTED"],
        },
        "byState": counts,
        "config": copy.deepcopy(cfg),
    }


def ranking_signature(rows: list[dict[str, Any]]) -> str:
    """Material ranking identity: order, state, direction and whole-point conviction."""
    return "|".join(f"{r['symbol']}:{r['state']}:{r['direction']}:{int(r['conviction'] or 0)}" for r in rows)


def expected_d1_date(series: dict[tuple[str, str], dict[str, Any]]) -> date | None:
    """Latest closed D1 bar date across the universe (Stage 1 stores broker-server-time bar opens)."""
    ts = [int(r["latest_ts"]) for (s, tf), r in series.items() if tf == "D1" and r.get("latest_ts") and s in SYMBOLS]
    return datetime.fromtimestamp(max(ts), tz=timezone.utc).date() if ts else None
