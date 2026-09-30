"""Multi-resolution opportunity discovery for the existing Stage 1–10 engine.

Normal trend continuation stays a separate family. Trend-in-Trend L1–L4, expected retracement
zones, and P1/P2 campaigns are additional hypotheses. This module does not place orders and
does not require an instrument to win the Stage 4 rank before a nested structure can be seen.
"""

from __future__ import annotations

import hashlib
from typing import Any

try:
    import confirm
    import regime
except ImportError:  # pragma: no cover
    from bridge.mt5 import confirm  # type: ignore
    from bridge.mt5 import regime  # type: ignore

SYMBOLS: list[str] = list(regime.SYMBOLS)
XAU = "XAUUSD"
VALID = frozenset(("VALIDATED", "ACTIVE", "WEAKENING", "BROKEN", "RETESTING"))
LEVELS = {
    "L1": {"parents": ("MN", "W"), "child": "D1", "execution": "H1"},
    "L2": {"parents": ("W", "D1"), "child": "H8", "execution": "H1"},
    "L3": {"parents": ("D1", "H8"), "child": "H1", "execution": "M15"},
    "L4": {"parents": ("H8", "H1"), "child": "M15", "execution": "M5"},
}

CONFIG: dict[str, Any] = {
    "campaignBudgetPct": 1.0,
    "p1WeightMin": 0.3,
    "p1WeightMax": 0.7,
    "extensionChaseAtr": confirm.CONFIG["extensionChaseAtr"],
    "extensionLateAtr": confirm.CONFIG["extensionLateAtr"],
    "lateChannelPct": confirm.CONFIG["lateChannelPct"],
    "currencyLimitPct": 2.0,
    "portfolioLimitPct": 3.0,
    "positionCeiling": 20,
    "xauReservePct": 0.0,
    "xauReservePolicy": "STRICT_RESERVE",
}


def _sign(direction: str | None) -> int:
    text = str(direction or "")
    if "BULL" in text:
        return 1
    if "BEAR" in text:
        return -1
    return 0


def _label(sign: int) -> str:
    return "BULLISH" if sign > 0 else "BEARISH" if sign < 0 else "UNKNOWN"


def _usable(channel: dict[str, Any] | None) -> bool:
    return bool(channel) and str(channel.get("status") or "") in VALID and _sign(channel.get("direction")) != 0


def _pick_parent(channels: dict[str, dict[str, Any]], names: tuple[str, ...]) -> dict[str, Any] | None:
    found = [(name, channels[name]) for name in names if _usable(channels.get(name))]
    if not found:
        return None
    name, channel = max(found, key=lambda item: float(item[1].get("confidence") or 0))
    return {**channel, "timeframe": channel.get("timeframe") or name}


def child_role(parent_direction: str, child_direction: str, child_status: str) -> str:
    """An opposing child is a correction until the parent structure itself fails."""
    ps, cs = _sign(parent_direction), _sign(child_direction)
    if ps == 0 or cs == 0:
        return "UNRESOLVED"
    if cs == ps:
        return "CONTINUATION"
    if str(child_status) == "BROKEN":
        return "TRANSITION"
    return "CORRECTION"


def _overlap(left: tuple[float, float], right: tuple[float, float]) -> tuple[float, float] | None:
    low, high = max(left[0], right[0]), min(left[1], right[1])
    return (low, high) if high > low else None


def _band(level: Any, width: float) -> tuple[float, float] | None:
    try:
        price = float(level)
    except (TypeError, ValueError):
        return None
    half = width * 0.15
    return (price - half, price + half) if half > 0 else None


def expected_retracement_zone(parent: dict[str, Any], child: dict[str, Any] | None, trade_sign: int,
                              context: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """A zone, not a single price. Parent-channel geometry is one input. Other structure only narrows it when it overlaps."""
    try:
        lo, hi = float(parent["lower"]), float(parent["upper"])
    except (TypeError, KeyError, ValueError):
        return None
    width = hi - lo
    if width <= 0 or trade_sign == 0:
        return None
    if trade_sign > 0:
        struct_low, struct_high = lo, lo + 0.5 * width
        boundary = lo
    else:
        struct_low, struct_high = hi - 0.5 * width, hi
        boundary = hi
    zone_low, zone_high = struct_low, struct_high
    confluence = 1
    reasons = ["parent channel half toward the origin of the trade"]
    fib_note = None
    if child and child.get("lower") is not None and child.get("upper") is not None:
        clo, chi = float(child["lower"]), float(child["upper"])
        span = abs(chi - clo)
        if span > 0:
            origin = chi if trade_sign > 0 else clo
            a = origin - trade_sign * 0.382 * span
            b = origin - trade_sign * 0.618 * span
            fib_low, fib_high = min(a, b), max(a, b)
            overlap_low, overlap_high = max(zone_low, fib_low), min(zone_high, fib_high)
            if overlap_high > overlap_low:
                zone_low, zone_high = overlap_low, overlap_high
                confluence += 1
                fib_note = "child-impulse retracement overlaps the channel zone"
                reasons.append(fib_note)
            else:
                reasons.append("Fibonacci retracement does not overlap the channel zone, so the channel zone stands")
            child_zone = _overlap((zone_low, zone_high), (min(clo, chi), max(clo, chi)))
            if child_zone and (child_zone[0] > zone_low or child_zone[1] < zone_high):
                zone_low, zone_high = child_zone
                confluence += 1
                reasons.append("child channel geometry overlaps the zone")
    context = context or {}
    atr = context.get("atr") or parent.get("atr") or (child or {}).get("atr")
    band_width = float(atr) if atr else width * 0.1
    for key, label in (
        ("swingLow" if trade_sign > 0 else "swingHigh", "latest structural swing"),
        ("bosLevel", "previous breakout level"),
        ("support" if trade_sign > 0 else "resistance", "support/resistance"),
        ("consolidationLow" if trade_sign > 0 else "consolidationHigh", "previous consolidation"),
    ):
        band = _band(context.get(key), band_width)
        if band is None:
            continue
        hit = _overlap((zone_low, zone_high), band)
        if hit:
            zone_low, zone_high = hit
            confluence += 1
            reasons.append(f"{label} overlaps the zone")
        else:
            reasons.append(f"{label} does not overlap, so it does not move the zone")
    if atr:
        confluence += 1
        reasons.append("ATR context available")
    if context.get("volatilityRegime"):
        reasons.append(f"volatility regime {context.get('volatilityRegime')}")
    preferred = (zone_low + zone_high) / 2
    return {
        "zoneLow": round(zone_low, 6),
        "zoneHigh": round(zone_high, 6),
        "preferredPrice": round(preferred, 6),
        "channelBoundary": boundary,
        "channelMidline": parent.get("mid"),
        "fibContext": fib_note,
        "atrContext": atr,
        "confluenceScore": confluence,
        "confidence": min(90, 40 + confluence * 15),
        "invalidationLevel": round(lo - float(atr or 0) if trade_sign > 0 else hi + float(atr or 0), 6),
        "expectedBreakLevel": (child or {}).get("upper") if trade_sign > 0 else (child or {}).get("lower"),
        "expiresAt": context.get("expiresAt"),
        "reasons": reasons,
    }


def _inside(price: float | None, zone: dict[str, Any] | None) -> bool:
    if price is None or not zone:
        return False
    return float(zone["zoneLow"]) <= float(price) <= float(zone["zoneHigh"])


def p2_timing(extension_atr: float | None, channel_position: float | None, break_valid: bool) -> str:
    """A valid break is not permission to enter. Thresholds match Stage 7."""
    if not break_valid:
        return "P2_WAITING"
    chased = extension_atr is not None and extension_atr >= CONFIG["extensionChaseAtr"]
    late = channel_position is not None and channel_position >= CONFIG["lateChannelPct"]
    late_extended = extension_atr is not None and extension_atr >= CONFIG["extensionLateAtr"] and late
    if chased or late_extended:
        return "P2_WAIT_RETEST"
    return "P2_READY"


def allocate_campaign(budget: float, p1_eligible: bool, p2_eligible: bool, erz_confidence: float) -> tuple[float, float]:
    """P1 and P2 share one budget. A single eligible leg may use it. Both legs cannot each take the full budget."""
    if budget <= 0 or (not p1_eligible and not p2_eligible):
        return 0.0, 0.0
    if p1_eligible and p2_eligible:
        weight = min(CONFIG["p1WeightMax"], max(CONFIG["p1WeightMin"], float(erz_confidence) / 100))
        p1 = round(budget * weight, 4)
        return p1, round(budget - p1, 4)
    if p1_eligible:
        return round(budget, 4), 0.0
    return 0.0, round(budget, 4)


def _campaign_id(symbol: str, level: str, parent_id: str | None, child_id: str | None, direction: str) -> str:
    raw = "|".join([symbol, level, parent_id or "", child_id or "", direction])
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def _structure_context(parent: dict[str, Any] | None, child: dict[str, Any] | None) -> dict[str, Any]:
    """Only fields already present on the channels. Missing features are omitted, not invented."""
    ctx: dict[str, Any] = {}
    for source in (parent, child):
        if not source:
            continue
        for key in ("swingLow", "swingHigh", "bosLevel", "support", "resistance", "consolidationLow", "consolidationHigh", "volatilityRegime", "atr", "expiresAt"):
            if source.get(key) is not None and key not in ctx:
                ctx[key] = source[key]
    return ctx


def _zone_location(price: float | None, zone: dict[str, Any] | None, atr: float | None) -> dict[str, Any]:
    """Where price sits relative to the zone. Unknown price is not treated as outside the zone."""
    if not zone:
        return {"price": price, "zoneLow": None, "zoneHigh": None, "distance": None, "distanceAtr": None, "inside": None}
    low, high = float(zone["zoneLow"]), float(zone["zoneHigh"])
    if price is None:
        return {"price": None, "zoneLow": low, "zoneHigh": high, "distance": None, "distanceAtr": None, "inside": None}
    px = float(price)
    if low <= px <= high:
        distance = 0.0
        inside = True
    elif px > high:
        distance, inside = px - high, False
    else:
        distance, inside = low - px, False
    return {
        "price": px, "zoneLow": low, "zoneHigh": high, "distance": round(distance, 6),
        "distanceAtr": None if not atr else round(distance / float(atr), 2), "inside": inside,
    }


def principal_blocker(item: dict[str, Any]) -> str:
    """Campaign reason. Waiting for the retracement zone blocks P1 only. It does not hide P2."""
    p1 = (item.get("p1") or {}).get("state")
    p2 = (item.get("p2") or {}).get("state")
    if item.get("actionable"):
        if p2 == "P2_READY":
            return "P2_READY"
        if p1 == "P1_READY":
            return "P1_READY"
        return "ACTIONABLE"
    status = str(item.get("status") or "")
    text = " ".join(item.get("reasons") or [])
    if status == "NOT_DETECTED":
        return "CHILD_CHANNEL_FORMING" if "FORMING" in text else "NOT_DETECTED"
    if status == "WAIT_NEW_CONFIRMATION":
        low = text.lower()
        return "STALE_DATA" if "fail closed" in low or "unknown" in low else "WAIT_NEW_CONFIRMATION"
    if p2 == "P2_WAIT_RETEST":
        return "WAIT_RETEST"
    if p2 == "P2_WAITING":
        return "WAITING_FOR_BREAK"
    if p1 == "P1_WAITING_FOR_ERZ":
        return "WAITING_FOR_ERZ"
    execution = str(item.get("executionTimeframe") or "")
    if execution == "M5":
        return "WAITING_FOR_M5_CONFIRMATION"
    if execution == "M15":
        return "WAITING_FOR_M15_CONFIRMATION"
    return "WAITING_FOR_CONFIRMATION"


def _confirmation_break(trade: int, confirmation: dict[str, Any] | None) -> tuple[bool, float | None, str | None]:
    """A closed-bar confirmation can release P2 without price having visited the retracement zone.

    An extended confirmation stays WAIT_RETEST. The extension value is never invented.
    """
    if not confirmation or _sign(confirmation.get("direction")) != trade or trade == 0:
        return False, None, None
    timing = str(confirmation.get("timing") or "")
    state = str(confirmation.get("state") or "")
    raw = confirmation.get("extension")
    extension = None if raw is None else float(raw)
    if state == "BREAKOUT_CONFIRMED_WAIT_RETEST" or timing == "WAIT_RETEST":
        return True, extension, "P2_WAIT_RETEST"
    if state == "CONFIRMED" and timing in ("ENTER_NOW", "RETEST_CONFIRMED"):
        return True, extension, None
    return False, None, None


def _hypothesis(symbol: str, family: str, level: str | None, parent: dict[str, Any] | None, child: dict[str, Any] | None,
                execution_tf: str, price: float | None, extension_atr: float | None, break_valid: bool,
                scanner_rank: int | None, confirmation: dict[str, Any] | None = None) -> dict[str, Any]:
    parent_sign = _sign((parent or {}).get("direction"))
    trade = parent_sign
    if family == "TIT_CORRECTION" and child is not None:
        trade = _sign(child.get("direction"))
    zone = expected_retracement_zone(parent, child, parent_sign, _structure_context(parent, child)) if parent else None
    role = child_role((parent or {}).get("direction"), (child or {}).get("direction"), (child or {}).get("status") or "") if parent and child else "UNRESOLVED"
    parent_break, parent_extension, parent_hold = _confirmation_break(parent_sign, confirmation)
    forced = None
    if role == "CORRECTION" and (break_valid or parent_break) and parent_sign != 0:
        family = "TIT_CORRECTION_END"
        trade = parent_sign
        break_valid = True
        if extension_atr is None:
            extension_atr = parent_extension
        forced = parent_hold
    else:
        leg_break, leg_extension, leg_hold = _confirmation_break(trade, confirmation)
        if leg_break:
            break_valid = True
            if leg_extension is not None:
                extension_atr = leg_extension
            forced = leg_hold
    p1_ready = _inside(price, zone) and role in ("CORRECTION", "CONTINUATION", "TRANSITION")
    timing = forced or p2_timing(extension_atr, (parent or {}).get("position") if trade == _sign((parent or {}).get("direction")) else None, break_valid)
    if zone is None:
        p1_state, p1_reason = "P1_NOT_AVAILABLE", "NO_ZONE"
    elif price is None:
        p1_state, p1_reason = "P1_WAITING", "PRICE_UNKNOWN"
    elif p1_ready:
        p1_state, p1_reason = "P1_READY", "INSIDE_ERZ"
    else:
        p1_state, p1_reason = "P1_WAITING_FOR_ERZ", "WAITING_FOR_ERZ"
    p2_reason = {"P2_WAITING": "WAITING_FOR_BREAK", "P2_WAIT_RETEST": "WAIT_RETEST", "P2_READY": "P2_READY"}.get(timing, timing)
    p1_eligible = p1_state == "P1_READY"
    p2_eligible = timing == "P2_READY"
    budget = float(CONFIG["campaignBudgetPct"])
    p1_risk, p2_risk = allocate_campaign(budget, p1_eligible, p2_eligible, float((zone or {}).get("confidence") or 0))
    direction = _label(trade)
    parent_id = (parent or {}).get("channelId")
    child_id = (child or {}).get("channelId")
    reasons = []
    if family == "NORMAL_TREND_CONTINUATION":
        reasons.append(f"{symbol} normal trend continuation remains available beside any nested hypothesis")
    elif parent and child:
        reasons.append(
            f"{symbol} {level} {family.replace('_', ' ').lower()}: {parent.get('timeframe')} {parent.get('direction')} parent, "
            f"{child.get('timeframe')} {child.get('direction')} child ({role.lower()})"
        )
    if timing == "P2_WAIT_RETEST":
        reasons.append("P2 held: breakout structure is valid but price is extended")
    if symbol == XAU and scanner_rank not in (None, 1):
        reasons.append("XAUUSD prioritized independently of Stage 4 ranking")
    actionable = (p1_eligible or p2_eligible) and direction != "UNKNOWN"
    location = _zone_location(price, zone, (parent or {}).get("atr") or (child or {}).get("atr"))
    out = {
        "campaignId": _campaign_id(symbol, level or "NORMAL", parent_id, child_id, direction),
        "instrument": symbol,
        "opportunityFamily": family,
        "TiTLevel": level,
        "parentTimeframe": (parent or {}).get("timeframe"),
        "childTimeframe": (child or {}).get("timeframe"),
        "executionTimeframe": execution_tf,
        "direction": direction,
        "parentChannelId": parent_id,
        "childChannelId": child_id,
        "parentDirection": (parent or {}).get("direction"),
        "childDirection": (child or {}).get("direction"),
        "parentChannelPosition": (parent or {}).get("position"),
        "childChannelPosition": (child or {}).get("position"),
        "childRole": role,
        "expectedRetracementZone": zone,
        "location": location,
        "p1": {"state": p1_state, "reason": p1_reason, "riskPct": p1_risk},
        "p2": {"state": timing, "reason": p2_reason, "riskPct": p2_risk},
        "allocatedRisk": budget if actionable else 0.0,
        "usedRisk": 0.0,
        "remainingRisk": (p1_risk + p2_risk) if actionable else 0.0,
        "status": "CAMPAIGN_ACTIVE" if actionable else "WATCHING",
        "actionable": actionable,
        "priceInsideZone": location["inside"],
        "blocker": None,
        "confidence": float((parent or {}).get("confidence") or (zone or {}).get("confidence") or 0),
        "scannerRank": scanner_rank,
        "reasons": reasons,
    }
    out["blocker"] = principal_blocker(out)
    return out


def classify_levels(symbol: str, channels: dict[str, dict[str, Any]], price: float | None = None,
                    extension_atr: float | None = None, break_valid: bool = False, scanner_rank: int | None = None,
                    confirmation_by_tf: dict[str, dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """One parent, one child and one execution timeframe per hypothesis. Levels do not nest inside each other."""
    out = []
    for level, spec in LEVELS.items():
        parent = _pick_parent(channels, spec["parents"])
        child = channels.get(spec["child"]) if _usable(channels.get(spec["child"])) else None
        if parent is None or child is None:
            missing = {
                "instrument": symbol, "TiTLevel": level, "opportunityFamily": None, "status": "NOT_DETECTED",
                "actionable": False, "reasons": [f"{level} needs a valid {spec['parents']} parent and {spec['child']} child"],
                "executionTimeframe": spec["execution"],
            }
            missing["blocker"] = principal_blocker(missing)
            out.append(missing)
            continue
        role = child_role(parent.get("direction"), child.get("direction"), child.get("status") or "")
        family = {"CONTINUATION": "TIT_CONTINUATION", "CORRECTION": "TIT_CORRECTION", "TRANSITION": "TIT_CORRECTION_END",
                  "REVERSAL_CANDIDATE": "REVERSAL_CANDIDATE"}.get(role, "TIT_CORRECTION")
        if role == "UNRESOLVED":
            unresolved = {"instrument": symbol, "TiTLevel": level, "status": "NOT_DETECTED", "actionable": False,
                          "reasons": ["parent or child direction is unresolved"], "executionTimeframe": spec["execution"]}
            unresolved["blocker"] = principal_blocker(unresolved)
            out.append(unresolved)
            continue
        child = {**child, "timeframe": child.get("timeframe") or spec["child"]}
        parent = {**parent, "timeframe": parent.get("timeframe") or parent.get("tf")}
        out.append(_hypothesis(symbol, family, level, parent, child, spec["execution"], price, extension_atr, break_valid, scanner_rank,
                               (confirmation_by_tf or {}).get(spec["execution"])))
    return out


def normal_continuation(symbol: str, direction: dict[str, Any] | None, channels: dict[str, dict[str, Any]],
                        price: float | None = None, extension_atr: float | None = None, break_valid: bool = False,
                        confirmation: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """The existing Stage 6 continuation hand-off. Nested hypotheses do not replace it."""
    if not direction or direction.get("state") != "READY_FOR_H1":
        return None
    if str(direction.get("tradeType") or "").startswith("COUNTER_TREND"):
        return None
    parent = channels.get("D1") if _usable(channels.get("D1")) else None
    child = channels.get("H8") if _usable(channels.get("H8")) else None
    return _hypothesis(symbol, "NORMAL_TREND_CONTINUATION", None, parent, child, "H1", price, extension_atr, break_valid, direction.get("rank"), confirmation)


def _funnel(rows: list[dict[str, Any]], qualified: list[dict[str, Any]]) -> dict[str, int]:
    hypotheses = [h for row in rows for h in row["hypotheses"]]
    return {
        "scanned": len(rows),
        "hypotheses": sum(1 for h in hypotheses if h.get("status") != "NOT_DETECTED"),
        "watching": sum(1 for h in hypotheses if h.get("status") == "WATCHING"),
        "confirming": 0,
        "erzActive": sum(1 for h in hypotheses if h.get("priceInsideZone")),
        "p1Ready": sum(1 for h in hypotheses if (h.get("p1") or {}).get("state") == "P1_READY"),
        "p2Ready": sum(1 for h in hypotheses if (h.get("p2") or {}).get("state") == "P2_READY"),
        "waitRetest": sum(1 for h in hypotheses if (h.get("p2") or {}).get("state") == "P2_WAIT_RETEST"),
        "stage8Authorized": 0,
        "activeCampaigns": 0,
        "actionable": len(qualified),
    }


def _blockers(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        for item in row["hypotheses"]:
            if item.get("actionable") or item.get("status") == "NOT_DETECTED":
                continue
            key = str(item.get("blocker") or "WAITING_FOR_CONFIRMATION")
            counts[key] = counts.get(key, 0) + 1
    return counts


def _leg_states(rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """P1 and P2 counted separately. An ERZ wait does not replace the break wait."""
    legs = {"p1": {}, "p2": {}}
    for row in rows:
        for item in row["hypotheses"]:
            if item.get("status") == "NOT_DETECTED":
                continue
            for leg in ("p1", "p2"):
                key = str((item.get(leg) or {}).get("reason") or (item.get(leg) or {}).get("state") or "UNKNOWN")
                legs[leg][key] = legs[leg].get(key, 0) + 1
    return legs


def scan(symbols: list[str], channels_by_symbol: dict[str, dict[str, dict[str, Any]]],
         directions: dict[str, dict[str, Any]] | None = None, ranks: dict[str, int] | None = None,
         prices: dict[str, float] | None = None, extensions: dict[str, float] | None = None,
         breaks: dict[str, bool] | None = None, missed: bool = False, data_ok: bool = True,
         confirmations: dict[str, dict[str, dict[str, Any]]] | None = None) -> dict[str, Any]:
    """Every supplied symbol is assessed. Ranking prioritises attention. It does not hide a valid nested structure."""
    directions, ranks = directions or {}, ranks or {}
    prices, extensions, breaks = prices or {}, extensions or {}, breaks or {}
    rows = []
    for symbol in symbols:
        channels = channels_by_symbol.get(symbol) or {}
        rank = ranks.get(symbol)
        symbol_confirmation = (confirmations or {}).get(symbol) or {}
        hypotheses = classify_levels(symbol, channels, prices.get(symbol), extensions.get(symbol), bool(breaks.get(symbol)), rank, symbol_confirmation)
        normal = normal_continuation(symbol, directions.get(symbol), channels, prices.get(symbol), extensions.get(symbol), bool(breaks.get(symbol)),
                                     symbol_confirmation.get("H1"))
        if normal:
            hypotheses.insert(0, normal)
        if not data_ok or missed:
            for item in hypotheses:
                item["actionable"] = False
                if item.get("status") != "NOT_DETECTED":
                    item["status"] = "WAIT_NEW_CONFIRMATION"
                item.setdefault("reasons", []).append(
                    "Historical opportunity discovered during reconnect; not executable retrospectively." if missed
                    else "Data freshness is unknown — new entries fail closed."
                )
                item["blocker"] = principal_blocker(item)
        for item in hypotheses:
            item["blocker"] = item.get("blocker") or principal_blocker(item)
        rows.append({"symbol": symbol, "scannerRank": rank, "hypotheses": hypotheses, "scanned": True})
    qualified = [h for r in rows for h in r["hypotheses"] if h.get("actionable")]
    def count(level: str) -> int:
        return sum(1 for h in qualified if h.get("TiTLevel") == level)
    xau = next((r for r in rows if r["symbol"] == XAU), None)
    xau_live = [h for h in (xau or {}).get("hypotheses") or [] if h.get("actionable")]
    xau_state = "ACTIVE" if any(h.get("status") == "CAMPAIGN_ACTIVE" and h.get("p1", {}).get("state") == "P1_FILLED" for h in xau_live) else (
        "QUALIFIED" if xau_live else "WATCHING"
    )
    summary = {
        "scanned": len(rows),
        "universe": len(symbols),
        "normal": sum(1 for h in qualified if h.get("opportunityFamily") == "NORMAL_TREND_CONTINUATION"),
        "tit": sum(1 for h in qualified if str(h.get("opportunityFamily") or "").startswith("TIT")),
        "L1": count("L1"), "L2": count("L2"), "L3": count("L3"), "L4": count("L4"),
        "xau": xau_state,
        "detected": sum(1 for r in rows for h in r["hypotheses"] if h.get("status") != "NOT_DETECTED"),
        "funnel": _funnel(rows, qualified),
        "blockers": _blockers(rows),
        "legs": _leg_states(rows),
    }
    return {"summary": summary, "instruments": rows, "qualified": qualified}


def currency_legs(symbol: str, direction_sign: int) -> dict[str, int]:
    if symbol == XAU:
        return {"XAU": direction_sign, "USD": -direction_sign}
    if len(symbol) < 6:
        return {}
    return {symbol[:3]: direction_sign, symbol[3:6]: -direction_sign}


def reserve_holdback(instrument: str, cfg: dict[str, Any]) -> float:
    """Risk ordinary FX must leave for XAUUSD. Borrowed capacity returns as exposure falls. Nothing is force-closed."""
    reserve = float(cfg.get("xauReservePct") or 0)
    if instrument == XAU or reserve <= 0:
        return 0.0
    policy = str(cfg.get("xauReservePolicy") or "STRICT_RESERVE")
    if policy == "PARTIAL_BORROW":
        borrow = min(1.0, max(0.0, float(cfg.get("xauBorrowFraction", 0.5))))
        return reserve * (1.0 - borrow)
    if policy == "DYNAMIC_RESERVE":
        state = str(cfg.get("xauWatchState") or "WATCHING").upper()
        if state in ("NONE", "INACTIVE"):
            return 0.0
        return reserve
    return reserve


def govern(proposals: list[dict[str, Any]], open_risk: list[dict[str, Any]], cfg: dict[str, Any] | None = None,
           emergency: bool = False, data_ok: bool = True) -> list[dict[str, Any]]:
    """Portfolio decision. Position count is not the objective. Concentration and total risk are."""
    cfg = {**CONFIG, **(cfg or {})}
    if emergency or not data_ok:
        code = "EMERGENCY_BLOCK" if emergency else "BLOCK"
        why = "Account emergency stop" if emergency else "Critical portfolio or market data is unavailable"
        return [{**p, "decision": code, "decisionReason": why} for p in proposals]
    exposure: dict[str, float] = {}
    committed = 0.0
    for pos in open_risk:
        committed += float(pos.get("riskPct") or 0)
        sign = 1 if str(pos.get("side") or "BUY").upper() == "BUY" else -1
        for ccy, leg in currency_legs(str(pos.get("symbol")), sign).items():
            exposure[ccy] = exposure.get(ccy, 0.0) + leg * float(pos.get("riskPct") or 0)
    out = []
    running = committed
    running_exposure = dict(exposure)
    for proposal in proposals:
        risk = float(proposal.get("remainingRisk") or proposal.get("allocatedRisk") or 0)
        sign = _sign(proposal.get("direction"))
        legs = currency_legs(str(proposal.get("instrument")), sign)
        hot = [c for c, leg in legs.items() if abs(running_exposure.get(c, 0.0) + leg * risk) > float(cfg["currencyLimitPct"]) + 1e-9]
        room = float(cfg["portfolioLimitPct"]) - running - reserve_holdback(str(proposal.get("instrument")), cfg)
        occupied = len(open_risk) + len(out)
        operator_limit = cfg.get("operatorPositionLimit")
        if hot:
            decision, why = "BLOCK", f"Blocked by portfolio concentration in {', '.join(hot)}"
        elif risk > room + 1e-9 and room > 0:
            decision, why = "ALLOW_REDUCED", f"Reduced to remaining portfolio room {room:.2f}%"
            risk = room
        elif risk > room + 1e-9:
            decision, why = "BLOCK", "Portfolio risk capacity is exhausted"
        elif operator_limit is not None and occupied >= int(operator_limit):
            decision, why = "QUEUE", "Operator position limit reached. Portfolio risk is a separate check and is not bypassed."
        elif occupied >= int(cfg["positionCeiling"]):
            decision, why = "QUEUE", "Technical position capacity reached. This is not a target."
        else:
            decision, why = "ALLOW", "Risk and concentration permit this hypothesis"
        if decision in ("ALLOW", "ALLOW_REDUCED"):
            running += risk
            for ccy, leg in legs.items():
                running_exposure[ccy] = running_exposure.get(ccy, 0.0) + leg * risk
        out.append({**proposal, "decision": decision, "decisionReason": why})
    return out
