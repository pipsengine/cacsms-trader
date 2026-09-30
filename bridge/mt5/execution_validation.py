"""L3/L4 measurement, episode identity, excursion and portfolio counterfactuals.

Production operator limit and XAU reserve are read, never written. A counterfactual
configuration is a separate pass over the same events.
"""

from __future__ import annotations

from typing import Any

try:
    import opportunity
except ImportError:  # pragma: no cover
    from bridge.mt5 import opportunity  # type: ignore

STAGE6 = {
    "measured": False,
    "reason": (
        "Stage 6 READY_FOR_H1 requires the Stage 4 promotion and the Stage 5 vision object that existed at that timestamp. "
        "Those decisions are not stored per historical bar. Reconstructing them with a different rule is not the production path."
    ),
}

EXECUTION_MODEL = (
    "M5 and M15 bar replay approximates execution. Tick bid/ask history is not stored, so a fill, slippage path or spread "
    "is used only when that field is already on the stored candle. Results are not tick-accurate."
)

P1_READY = "P1_READY_FOR_RISK"
P2_READY = "P2_READY_FOR_RISK"

IMPLEMENTED_RULES = {
    "p1Reaction": (
        "A P1 leg is ready for Stage 8 only when price is inside the expected retracement zone, "
        "the child role is CORRECTION, CONTINUATION or TRANSITION, and the execution-timeframe confirmation "
        "has reaction=true with timing ENTER_NOW or RETEST_CONFIRMED. reaction is true when that timeframe's "
        "pullback is HOLDING or COMPLETE, or the entry timing is already ENTER_NOW or RETEST_CONFIRMED. "
        "HOLDING alone, without that timing, stays P1_CONFIRMED. Zone contact without reaction stays P1_ZONE_REACHED."
    ),
    "p1Structure": (
        "The execution-timeframe engine confirms on a closed-bar BOS or CHoCH after a pullback of at least 38.2% "
        "of the prior impulse, not on both. Mandatory gates must pass and the score must reach the existing confirm score. "
        "A prefix shorter than minBars (300) returns WARMING_UP / INSUFFICIENT_H1_HISTORY and cannot confirm."
    ),
    "p2Break": (
        "P2 does not read the retracement zone. A ready P2 requires the execution-timeframe confirmation direction "
        "to match the trade, state CONFIRMED, and timing ENTER_NOW or RETEST_CONFIRMED, and the extension must stay "
        "under the existing chase threshold (2.5 ATR, or 1.2 ATR when channel position is at least 78%). "
        "BREAKOUT_CONFIRMED_WAIT_RETEST or timing WAIT_RETEST is P2_WAIT_RETEST. A break flag without that confirmation object is P2_BREAK_DETECTED, not a handoff."
    ),
    "retest": (
        "After the trigger bar, a later bar that wicks back to the broken level within the retest tolerance and closes back through it is a held retest. "
        "A close back through that level by more than the false-break ATR within the false-break window is a failed break. "
        "The break level is the swing the trigger closed beyond. It is not recomputed from later swings."
    ),
    "ordering": (
        "BOS/CHoCH is a close beyond a swing that is already confirmed. The swing itself waits for the pivot bars, so the break level exists before the break bar. "
        "Nothing in the trigger scan reads a bar after the decision prefix. "
        "The pullback extreme is earlier than the trigger, so a CHoCH is not required to exist before price enters the retracement zone."
    ),
    "engineContext": (
        "Live confirmation of M15 and M5 calls ConfirmationEngine with the execution-channel direction and does not pass the parent channel. "
        "The engine then uses its existing shell (zone VALUE, position 40). Replay uses that same call. "
        "A break releases a leg only when that channel direction matches the trade. "
        "L1 and L2 live confirmation is the stored Stage 7 decision, which is not saved per historical bar, so a historical H1 engine pass is labelled separately and is not a Stage 7 reconstruction."
    ),
}


def confirmation_prefix_length() -> int:
    """Closed bars handed to confirmation. Must satisfy the existing minBars rule."""
    try:
        import confirm
    except ImportError:  # pragma: no cover
        from bridge.mt5 import confirm  # type: ignore
    return int(confirm.CONFIG["lookback"])


def production_limits() -> dict[str, Any]:
    try:
        import risk
    except ImportError:  # pragma: no cover
        from bridge.mt5 import risk  # type: ignore
    return {
        "operatorPositionLimit": int(risk.CONFIG["maxConcurrentPositions"]),
        "xauReservePct": float(risk.CONFIG["xauReservePct"]),
        "positionCeiling": int(risk.CONFIG["positionCeiling"]),
        "changed": False,
    }


def episode_key(item: dict[str, Any]) -> tuple:
    return (
        item.get("instrument"),
        item.get("TiTLevel"),
        item.get("direction"),
        item.get("opportunityFamily"),
        item.get("parentChannelId"),
        item.get("childChannelId"),
    )


def fold_episodes(samples: list[dict[str, Any]]) -> dict[str, Any]:
    """One persistent hypothesis is one episode, however many closed candles it spans."""
    order: list[tuple] = []
    episodes: dict[tuple, dict[str, Any]] = {}
    for sample in samples:
        key = episode_key(sample)
        if key not in episodes:
            order.append(key)
            episodes[key] = {
                "instrument": sample.get("instrument"), "level": sample.get("TiTLevel"),
                "direction": sample.get("direction"), "family": sample.get("opportunityFamily"),
                "samples": 0, "erz": False, "p1Zone": False, "p1": False, "p2": False,
                "waitRetest": False, "invalidated": False,
            }
        row = episodes[key]
        row["samples"] += 1
        location = sample.get("location") or {}
        p1 = (sample.get("p1") or {}).get("state")
        p2 = (sample.get("p2") or {}).get("state")
        row["erz"] = row["erz"] or location.get("inside") is True or p1 == "P1_ZONE_REACHED"
        row["p1Zone"] = row["p1Zone"] or p1 == "P1_ZONE_REACHED" or p1 == P1_READY
        row["p1"] = row["p1"] or p1 == P1_READY
        row["p2"] = row["p2"] or p2 == P2_READY
        row["waitRetest"] = row["waitRetest"] or p2 == "P2_WAIT_RETEST"
        row["invalidated"] = row["invalidated"] or sample.get("status") == "INVALIDATED"
    rows = [episodes[key] for key in order]
    def count(pred) -> int:
        return sum(1 for row in rows if pred(row))
    return {
        "episodes": len(rows),
        "samples": sum(row["samples"] for row in rows),
        "reachedErz": count(lambda row: row["erz"]),
        "p1Zone": count(lambda row: row["p1Zone"]),
        "p1": count(lambda row: row["p1"]),
        "p2": count(lambda row: row["p2"]),
        "both": count(lambda row: row["p1"] and row["p2"]),
        "waitRetest": count(lambda row: row["waitRetest"]),
        "neither": count(lambda row: not row["p1"] and not row["p2"]),
        "invalidated": count(lambda row: row["invalidated"]),
        "rows": rows,
    }


def measure_trade(bars: list[tuple], entry_index: int, entry: float, stop: float, target: float, sign: int) -> dict[str, Any]:
    """Excursion uses only bars after the signal bar. No future bar is an entry input."""
    if sign not in (1, -1) or entry_index < 0 or entry_index >= len(bars):
        return {"exitReason": "INSUFFICIENT_HISTORY", "mae": None, "mfe": None, "r": None, "holdingBars": 0}
    risk = abs(float(entry) - float(stop))
    if risk <= 0:
        return {"exitReason": "INSUFFICIENT_HISTORY", "mae": None, "mfe": None, "r": None, "holdingBars": 0}
    mae = mfe = 0.0
    exit_price = None
    exit_reason = "WINDOW_END"
    held = 0
    spread = None
    for bar in bars[entry_index + 1:]:
        held += 1
        high, low, close = float(bar[2]), float(bar[3]), float(bar[4])
        if len(bar) > 6 and bar[6] is not None and spread is None:
            spread = bar[6]
        if sign > 0:
            mae = max(mae, float(entry) - low)
            mfe = max(mfe, high - float(entry))
            if low <= float(stop):
                exit_reason, exit_price = "STOP", float(stop)
                break
            if high >= float(target):
                exit_reason, exit_price = "TARGET", float(target)
                break
        else:
            mae = max(mae, high - float(entry))
            mfe = max(mfe, float(entry) - low)
            if high >= float(stop):
                exit_reason, exit_price = "STOP", float(stop)
                break
            if low <= float(target):
                exit_reason, exit_price = "TARGET", float(target)
                break
        exit_price = close
    if held == 0:
        return {"exitReason": "INSUFFICIENT_HISTORY", "mae": None, "mfe": None, "r": None, "holdingBars": 0, "spread": spread}
    multiple = None if exit_price is None else round(sign * (float(exit_price) - float(entry)) / risk, 4)
    return {
        "exitReason": exit_reason,
        "exit": exit_price,
        "mae": round(mae, 6),
        "mfe": round(mfe, 6),
        "r": multiple,
        "holdingBars": held,
        "spread": spread,
    }


def outcome_summary(trades: list[dict[str, Any]]) -> dict[str, Any]:
    closed = [t for t in trades if t.get("r") is not None]
    wins = [t for t in closed if float(t["r"]) > 0]
    losses = [t for t in closed if float(t["r"]) < 0]
    gross_win = sum(float(t["r"]) for t in wins)
    gross_loss = abs(sum(float(t["r"]) for t in losses))
    equity = peak = max_dd = 0.0
    streak = worst_streak = 0
    for trade in closed:
        equity += float(trade["r"])
        peak = max(peak, equity)
        max_dd = max(max_dd, peak - equity)
        if float(trade["r"]) < 0:
            streak += 1
            worst_streak = max(worst_streak, streak)
        else:
            streak = 0
    return {
        "trades": len(closed),
        "winRate": None if not closed else round(len(wins) / len(closed), 4),
        "expectancy": None if not closed else round(sum(float(t["r"]) for t in closed) / len(closed), 4),
        "profitFactor": None if gross_loss == 0 else round(gross_win / gross_loss, 4),
        "maxDrawdownR": round(max_dd, 4),
        "consecutiveLosses": worst_streak,
        "mae": None if not closed else round(sum(float(t["mae"]) for t in closed if t.get("mae") is not None) / len(closed), 6),
        "mfe": None if not closed else round(sum(float(t["mfe"]) for t in closed if t.get("mfe") is not None) / len(closed), 6),
    }


def replay_portfolio(events: list[dict[str, Any]], cfg: dict[str, Any]) -> dict[str, Any]:
    """Walk opens and closes in time order through the existing portfolio governor."""
    open_positions: list[dict[str, Any]] = []
    counts = {"ALLOW": 0, "ALLOW_REDUCED": 0, "QUEUE": 0, "BLOCK": 0, "EMERGENCY_BLOCK": 0}
    peak = 0
    reasons: dict[str, int] = {}
    for event in sorted(events, key=lambda row: (int(row.get("ts") or 0), 0 if row.get("kind") == "CLOSE" else 1)):
        ts = int(event.get("ts") or 0)
        open_positions = [row for row in open_positions if int(row.get("exitTs") or 0) > ts]
        if event.get("kind") == "CLOSE":
            continue
        proposal = {
            "instrument": event.get("instrument"),
            "direction": event.get("direction"),
            "remainingRisk": float(event.get("riskPct") or 0),
        }
        held = [{"symbol": row["instrument"], "side": "BUY" if row.get("direction") == "BULLISH" else "SELL", "riskPct": row["riskPct"]} for row in open_positions]
        decision = opportunity.govern([proposal], held, cfg)[0]
        code = str(decision["decision"])
        counts[code] = counts.get(code, 0) + 1
        why = str(decision.get("decisionReason") or code)
        reasons[why] = reasons.get(why, 0) + 1
        if code in ("ALLOW", "ALLOW_REDUCED"):
            risk = float(proposal["remainingRisk"])
            if code == "ALLOW_REDUCED":
                room = why
                try:
                    risk = float(room.rsplit(" ", 1)[-1].rstrip("%"))
                except ValueError:
                    risk = proposal["remainingRisk"]
            open_positions.append({
                "instrument": proposal["instrument"], "direction": proposal["direction"],
                "riskPct": risk, "exitTs": int(event.get("exitTs") or ts),
            })
        peak = max(peak, len(open_positions))
    return {"decisions": counts, "peakConcurrent": peak, "reasons": reasons, "requested": sum(counts.values())}


def capacity_study(events: list[dict[str, Any]], limits: tuple[int, ...] = (3, 5, 10, 15, 20)) -> list[dict[str, Any]]:
    """Same events and risk rules. Only the operator limit changes, and only inside this study."""
    base = production_limits()
    out = []
    for limit in limits:
        cfg = {
            "operatorPositionLimit": int(limit),
            "xauReservePct": base["xauReservePct"],
            "positionCeiling": base["positionCeiling"],
            "currencyLimitPct": opportunity.CONFIG["currencyLimitPct"],
            "portfolioLimitPct": opportunity.CONFIG["portfolioLimitPct"],
        }
        result = replay_portfolio(events, cfg)
        out.append({"operatorPositionLimit": int(limit), "production": int(limit) == base["operatorPositionLimit"], **result})
    return out


def _admit(events: list[dict[str, Any]], cfg: dict[str, Any]) -> tuple[dict[str, int], dict[str, int]]:
    open_positions: list[dict[str, Any]] = []
    by_book = {"XAU": 0, "FX": 0}
    for event in sorted(events, key=lambda row: int(row.get("ts") or 0)):
        ts = int(event.get("ts") or 0)
        open_positions = [row for row in open_positions if int(row.get("exitTs") or 0) > ts]
        if event.get("kind") == "CLOSE":
            continue
        proposal = {"instrument": event.get("instrument"), "direction": event.get("direction"), "remainingRisk": float(event.get("riskPct") or 0)}
        held = [{"symbol": row["instrument"], "side": "BUY" if row.get("direction") == "BULLISH" else "SELL", "riskPct": row["riskPct"]} for row in open_positions]
        decision = opportunity.govern([proposal], held, cfg)[0]
        if decision["decision"] in ("ALLOW", "ALLOW_REDUCED"):
            book = "XAU" if proposal["instrument"] == "XAUUSD" else "FX"
            by_book[book] += 1
            open_positions.append({"instrument": proposal["instrument"], "direction": proposal["direction"], "riskPct": float(proposal["remainingRisk"]), "exitTs": int(event.get("exitTs") or ts)})
    return by_book, {}


def reserve_study(events: list[dict[str, Any]], reserves: tuple[float, ...] = (0.0, 0.25, 0.5, 1.0)) -> list[dict[str, Any]]:
    """Separate from production. Measures capacity left for XAUUSD, not which reserve made the most money."""
    base = production_limits()
    baseline_cfg = {
        "operatorPositionLimit": base["operatorPositionLimit"],
        "xauReservePct": 0.0,
        "xauReservePolicy": "STRICT_RESERVE",
        "positionCeiling": base["positionCeiling"],
        "currencyLimitPct": opportunity.CONFIG["currencyLimitPct"],
        "portfolioLimitPct": opportunity.CONFIG["portfolioLimitPct"],
    }
    baseline = _admit(events, baseline_cfg)[0]
    out = []
    for reserve in reserves:
        cfg = {**baseline_cfg, "xauReservePct": float(reserve)}
        admitted = _admit(events, cfg)[0]
        result = replay_portfolio(events, cfg)
        out.append({
            "xauReservePct": float(reserve),
            "production": float(reserve) == base["xauReservePct"],
            "xauAuthorized": admitted["XAU"],
            "fxAuthorized": admitted["FX"],
            "fxWithheld": max(0, baseline["FX"] - admitted["FX"]),
            "xauAdditionalVersusZero": max(0, admitted["XAU"] - baseline["XAU"]),
            **result,
        })
    return out


def coverage_report(stats: dict[tuple[str, str], tuple]) -> dict[str, Any]:
    """stats values are (count, earliest, latest) from the candle store."""
    rows = []
    for symbol in opportunity.SYMBOLS:
        item: dict[str, Any] = {"symbol": symbol}
        for tf in ("M15", "M5"):
            count, earliest, latest = stats.get((symbol, tf), (0, None, None))
            item[tf] = {"count": int(count or 0), "earliest": earliest, "latest": latest, "sufficient": int(count or 0) >= 80}
        item["measurable"] = bool(item["M15"]["sufficient"] or item["M5"]["sufficient"])
        rows.append(item)
    return {
        "symbols": len(rows),
        "m15Symbols": sum(1 for row in rows if row["M15"]["count"]),
        "m5Symbols": sum(1 for row in rows if row["M5"]["count"]),
        "rows": rows,
        "note": "A level that needs a missing timeframe is insufficient history. Candles are not forward-filled.",
    }


def _blank_diag() -> dict[str, Any]:
    return {
        "state": "NOT_EVALUATED", "reasonCode": "NO_CHANNEL_DIRECTION", "pullback": None, "trigger": None,
        "reaction": False, "timing": None, "retest": False, "falseBreak": False, "extension": None,
        "quality": None, "score": None, "direction": None,
    }


def _diag_from_decision(decision: dict[str, Any], direction: str) -> dict[str, Any]:
    """Read the fields ConfirmationEngine actually returns. The trigger is not nested under setup."""
    entry = decision.get("entry") or {}
    trigger = decision.get("trigger") or {}
    return {
        "state": str(decision.get("state") or ""),
        "reasonCode": str(decision.get("reasonCode") or ""),
        "pullback": decision.get("pullback"),
        "trigger": trigger.get("type") if isinstance(trigger, dict) else None,
        "reaction": bool(decision.get("reaction")),
        "timing": entry.get("timing"),
        "retest": bool(decision.get("retest")),
        "falseBreak": bool(decision.get("falseBreakout")),
        "extension": entry.get("extensionATR"),
        "quality": entry.get("breakoutQuality"),
        "score": decision.get("score"),
        "direction": direction,
    }


def _new_episode(item: dict[str, Any], pack: dict[str, dict[str, Any]]) -> dict[str, Any]:
    child_tf = item.get("childTimeframe")
    child = pack.get(child_tf) or {}
    return {
        "level": item.get("TiTLevel"), "family": item.get("opportunityFamily"), "direction": item.get("direction"),
        "campaignId": item.get("campaignId"), "samples": 0, "sign": 1 if item.get("direction") == "BULLISH" else -1,
        "childStatus": child.get("status"), "childTouches": child.get("touchCount"),
        "approached": False, "inside": False, "insideBars": 0, "monitored": False, "reactionInZone": False,
        "reactionAnywhere": False, "structure": False, "confirmed": False, "p1Ready": False,
        "levelDefined": False, "breakApproached": False, "triggerAligned": False, "structureConfirmed": False,
        "qualityPassed": False, "extensionPassed": False, "p2Ready": False, "extended": False,
        "retest": False, "retestHeld": False, "falseBreak": False, "opposedTrigger": False, "childBoundaryCrossed": False,
        "pullbacks": set(), "triggers": set(), "states": set(),
        "engineReason": None, "p1Block": None, "p2Block": None,
        "inZone": False, "visits": 0, "entrySide": None, "maxPen": 0.0, "crossedPreferred": False,
        "exit": None, "parentBreached": False, "zoneInvalidated": False, "touch": None, "touchAtr": None,
        "fav": 0.0, "adv": 0.0, "prevPrice": None, "firstDist": None, "firstBreakDist": None,
    }


def observe_episode(row: dict[str, Any], item: dict[str, Any], diag: dict[str, Any], pack: dict[str, dict[str, Any]]) -> None:
    """Record one closed bar against an existing episode. This does not decide a trade."""
    row["samples"] += 1
    location = item.get("location") or {}
    zone = item.get("expectedRetracementZone") or {}
    price = location.get("price")
    inside = location.get("inside") is True
    sign = row["sign"]
    state = str(diag.get("state") or "")
    code = str(diag.get("reasonCode") or "")
    pullback = diag.get("pullback")
    trigger = diag.get("trigger")
    aligned = _sign_text(diag.get("direction")) == sign and sign != 0
    if pullback:
        row["pullbacks"].add(str(pullback))
    if trigger:
        row["triggers"].add(str(trigger))
    if state:
        row["states"].add(state)
    if diag.get("reaction"):
        row["reactionAnywhere"] = True
    if diag.get("falseBreak"):
        row["falseBreak"] = True
    if diag.get("retest"):
        row["retest"] = True
    if str(diag.get("timing") or "") == "RETEST_CONFIRMED":
        row["retestHeld"] = True
    dist = location.get("distance")
    if inside:
        row["inside"] = True
        row["insideBars"] += 1
        row["approached"] = True
    elif dist is not None:
        if row["firstDist"] is None:
            row["firstDist"] = float(dist)
        elif float(dist) < float(row["firstDist"]):
            row["approached"] = True
    if inside and state not in ("", "NOT_EVALUATED", "WARMING_UP"):
        row["monitored"] = True
        row["engineReason"] = code or row["engineReason"]
    if inside and diag.get("reaction"):
        row["reactionInZone"] = True
        row["p1Block"] = code or row["p1Block"]
    if inside and aligned and trigger in ("BOS", "CHOCH") and state in ("CONFIRMING", "CONFIRMED", "BREAKOUT_CONFIRMED_WAIT_RETEST", "REJECTED"):
        row["structure"] = True
        row["p1Block"] = code or row["p1Block"]
    if inside and aligned and state == "CONFIRMED":
        row["confirmed"] = True
        row["p1Block"] = code or "P1_CONFIRMED"
    if (item.get("p1") or {}).get("state") == P1_READY:
        row["p1Ready"] = True
        row["confirmed"] = True
        row["reactionInZone"] = True
        row["structure"] = True
        row["inside"] = True
    level = zone.get("expectedBreakLevel")
    if level is not None:
        row["levelDefined"] = True
        if price is not None:
            gap = abs(float(price) - float(level))
            if row["firstBreakDist"] is None:
                row["firstBreakDist"] = gap
            elif gap < float(row["firstBreakDist"]):
                row["breakApproached"] = True
            if sign * (float(price) - float(level)) > 0:
                row["childBoundaryCrossed"] = True
    if trigger and not aligned:
        row["opposedTrigger"] = True
    if aligned and trigger in ("BOS", "CHOCH"):
        row["triggerAligned"] = True
        row["breakApproached"] = True
        row["p2Block"] = code or row["p2Block"]
    if aligned and state in ("CONFIRMED", "BREAKOUT_CONFIRMED_WAIT_RETEST"):
        row["structureConfirmed"] = True
        row["triggerAligned"] = True
        row["breakApproached"] = True
        row["p2Block"] = code or row["p2Block"]
        weak = diag.get("quality") == "SUSPECTED_FALSE_BREAK" or diag.get("falseBreak") or diag.get("timing") == "REJECT"
        if not weak:
            row["qualityPassed"] = True
        if state == "CONFIRMED" and diag.get("timing") in ("ENTER_NOW", "RETEST_CONFIRMED"):
            row["extensionPassed"] = True
        if state == "BREAKOUT_CONFIRMED_WAIT_RETEST" or diag.get("timing") == "WAIT_RETEST":
            row["extended"] = True
    if (item.get("p2") or {}).get("state") == "P2_WAIT_RETEST":
        row["extended"] = True
        row["structureConfirmed"] = True
    if (item.get("p2") or {}).get("state") == P2_READY:
        row["p2Ready"] = True
        row["extensionPassed"] = True
        row["qualityPassed"] = True
        row["structureConfirmed"] = True
        row["triggerAligned"] = True
    _observe_zone(row, item, pack, price, inside, zone)
    if price is not None:
        row["prevPrice"] = float(price)


def _observe_zone(row: dict[str, Any], item: dict[str, Any], pack: dict[str, dict[str, Any]], price: Any, inside: bool, zone: dict[str, Any]) -> None:
    if price is None or zone.get("zoneLow") is None:
        return
    px = float(price)
    low, high = float(zone["zoneLow"]), float(zone["zoneHigh"])
    width = high - low
    parent = pack.get(item.get("parentTimeframe")) or {}
    sign = row["sign"]
    if parent.get("lower") is not None and parent.get("upper") is not None:
        if (sign > 0 and px < float(parent["lower"])) or (sign < 0 and px > float(parent["upper"])):
            row["parentBreached"] = True
    invalid = zone.get("invalidationLevel")
    if invalid is not None and ((sign > 0 and px < float(invalid)) or (sign < 0 and px > float(invalid))):
        row["zoneInvalidated"] = True
    if inside and not row["inZone"]:
        row["inZone"] = True
        row["visits"] += 1
        if row["touch"] is None:
            row["touch"] = px
            row["touchAtr"] = zone.get("atrContext") or parent.get("atr")
        if row["entrySide"] is None and row["prevPrice"] is not None:
            row["entrySide"] = "ABOVE" if float(row["prevPrice"]) > high else "BELOW"
    elif inside:
        row["inZone"] = True
    elif row["inZone"]:
        row["inZone"] = False
        if row["entrySide"] == "ABOVE":
            row["exit"] = "CONTINUED_THROUGH" if px < low else "RETURNED"
        elif row["entrySide"] == "BELOW":
            row["exit"] = "CONTINUED_THROUGH" if px > high else "RETURNED"
        else:
            row["exit"] = "LEFT_ZONE"
    if inside and width > 0:
        if row["entrySide"] == "BELOW":
            pen = (px - low) / width * 100
        else:
            pen = (high - px) / width * 100
        row["maxPen"] = max(float(row["maxPen"]), pen)
        preferred = zone.get("preferredPrice")
        if preferred is not None and min(px, float(row["prevPrice"] if row["prevPrice"] is not None else px)) <= float(preferred) <= max(px, float(row["prevPrice"] if row["prevPrice"] is not None else px)):
            row["crossedPreferred"] = True
    if row["touch"] is not None:
        move = sign * (px - float(row["touch"]))
        row["fav"] = max(float(row["fav"]), move)
        row["adv"] = max(float(row["adv"]), -move)


def _sign_text(direction: Any) -> int:
    text = str(direction or "")
    if "BULL" in text:
        return 1
    if "BEAR" in text:
        return -1
    return 0


def _p1_outcome(row: dict[str, Any]) -> tuple[str, str, str]:
    if row["p1Ready"]:
        return "P1_READY_FOR_RISK", "P1_READY_FOR_RISK", "REACHED"
    if row["confirmed"]:
        return "P1_CONFIRMATION_PASSED", row.get("p1Block") or "P1_CONFIRMED", "FAILED"
    if row["structure"]:
        return "P1_STRUCTURE_VALID", row.get("p1Block") or "AWAITING_REMAINING_GATES", "FAILED"
    if row["reactionInZone"]:
        return "P1_REACTION_DETECTED", row.get("p1Block") or "AWAITING_H1_BREAK", "FAILED"
    if row["monitored"]:
        return "P1_REACTION_MONITORING", row.get("engineReason") or "PRICE_NEVER_REACTED", "NEVER"
    if row["inside"]:
        return "P1_ZONE_REACHED", row.get("engineReason") or "INSUFFICIENT_H1_HISTORY", "NEVER"
    if row["approached"]:
        return "P1_ZONE_APPROACH", "PRICE_NEVER_ENTERED_ZONE", "NEVER"
    return "P1_HYPOTHESIS", "PRICE_NEVER_APPROACHED_ZONE", "NEVER"


def _p2_outcome(row: dict[str, Any]) -> tuple[str, str, str]:
    """Furthest stage on the main break chain. A wick through the child boundary is not a closed break."""
    if row["p2Ready"]:
        return "P2_READY_FOR_RISK", "P2_READY_FOR_RISK", "REACHED"
    if row["extensionPassed"]:
        return "P2_EXTENSION_CHECK_PASSED", row.get("p2Block") or "P2_EXTENSION_CHECK_PASSED", "FAILED"
    if row["qualityPassed"]:
        if row["extended"] and row["falseBreak"]:
            return "P2_BREAK_QUALITY_PASSED", "FALSE_BREAKOUT", "FAILED"
        if row["extended"] and not row["retest"]:
            return "P2_BREAK_QUALITY_PASSED", "NO_RETEST_OCCURRED", "NEVER"
        if row["extended"]:
            return "P2_BREAK_QUALITY_PASSED", row.get("p2Block") or "WAIT_RETEST", "FAILED"
        return "P2_BREAK_QUALITY_PASSED", row.get("p2Block") or "WAIT_RETEST", "FAILED"
    if row["structureConfirmed"]:
        return "P2_STRUCTURE_CONFIRMED", "FALSE_BREAKOUT" if row["falseBreak"] else (row.get("p2Block") or "WAIT_RETEST"), "FAILED"
    if row["triggerAligned"]:
        return "P2_CLOSED_BREAK", row.get("p2Block") or "AWAITING_REMAINING_GATES", "FAILED"
    if row["opposedTrigger"]:
        return "P2_BREAK_LEVEL_DEFINED" if row["levelDefined"] else "P2_HYPOTHESIS", "EXECUTION_CHANNEL_OPPOSES_TRADE", "FAILED"
    if row["breakApproached"]:
        return "P2_BREAK_APPROACHED", "NO_BREAK_OCCURRED", "NEVER"
    if row["levelDefined"]:
        return "P2_BREAK_LEVEL_DEFINED", "NO_BREAK_OCCURRED", "NEVER"
    return "P2_HYPOTHESIS", "NO_BREAK_LEVEL", "NEVER"


def _retest_stage(row: dict[str, Any]) -> str | None:
    if not row["extended"]:
        return None
    if row["p2Ready"] and row["retestHeld"]:
        return "P2_READY_FOR_RISK"
    if row["retestHeld"]:
        return "P2_RETEST_HELD"
    if row["retest"]:
        return "P2_RETEST_DETECTED"
    return "P2_WAIT_RETEST"


def _episode_public(row: dict[str, Any]) -> dict[str, Any]:
    p1_stage, p1_reason, p1_class = _p1_outcome(row)
    p2_stage, p2_reason, p2_class = _p2_outcome(row)
    atr = row.get("touchAtr")
    fav, adv = row.get("fav"), row.get("adv")
    return {
        "family": row.get("family"), "direction": row.get("direction"), "samples": row.get("samples"),
        "campaignId": row.get("campaignId"), "childStatus": row.get("childStatus"), "childTouches": row.get("childTouches"),
        "p1Stage": p1_stage, "p1Reason": p1_reason, "p1Class": p1_class,
        "p2Stage": p2_stage, "p2Reason": p2_reason, "p2Class": p2_class,
        "retestStage": _retest_stage(row),
        "bos": "BOS" in row["triggers"], "choch": "CHOCH" in row["triggers"],
        "reactionInZone": row["reactionInZone"], "reactionAnywhere": row["reactionAnywhere"],
        "pullbacks": sorted(row["pullbacks"]), "retest": row["retest"], "falseBreak": row["falseBreak"],
        "childBoundaryCrossed": row["childBoundaryCrossed"], "opposedTrigger": row["opposedTrigger"],
        "erz": {
            "reached": row["inside"], "bars": row["insideBars"], "visits": row["visits"],
            "maxPenetrationPct": None if not row["inside"] else round(float(row["maxPen"]), 1),
            "exit": row["exit"] or ("STILL_INSIDE" if row["inZone"] else None),
            "crossedPreferred": row["crossedPreferred"], "parentBreached": row["parentBreached"],
            "invalidated": row["zoneInvalidated"],
            "favorableAtr": None if not atr or not row["touch"] else round(float(fav) / float(atr), 2),
            "adverseAtr": None if not atr or not row["touch"] else round(float(adv) / float(atr), 2),
            "researchOnly": True,
        },
    }


def _count_stage(rows: list[dict[str, Any]], order: tuple[str, ...], field: str) -> dict[str, int]:
    rank = {name: index for index, name in enumerate(order)}
    return {name: sum(1 for row in rows if rank.get(row[field], -1) >= index) for index, name in enumerate(order)}


def replay_symbol(symbol: str, clock: str = "M15", limit: int | None = None) -> dict[str, Any]:
    """Closed-candle replay. Higher timeframes update only when their own candle has closed."""
    if clock not in ("M15", "M5"):
        raise ValueError("L3 uses M15 closes and L4 uses M5 closes")
    try:
        import channel_analysis as ca
        import confirm
        import confirm_engine
        import history_store as hs
        import opportunity_replay as replay
        import vision
    except ImportError:  # pragma: no cover
        from bridge.mt5 import channel_analysis as ca  # type: ignore
        from bridge.mt5 import confirm  # type: ignore
        from bridge.mt5 import confirm_engine  # type: ignore
        from bridge.mt5 import history_store as hs  # type: ignore
        from bridge.mt5 import opportunity_replay as replay  # type: ignore
        from bridge.mt5 import vision  # type: ignore
    stored = {"MN": "MN1", "W": "W1"}
    # The clock timeframe is the confirmation channel. Extra frames that the level does not read are not analysed.
    frames = ("MN", "W", "D1", "H8", "H1", "M15") if clock == "M15" else ("H8", "H1", "M15", "M5")
    series = {tf: hs.candle_ohlc(symbol, stored.get(tf, tf)) for tf in frames}
    bars = series[clock]
    if len(bars) < 80:
        return {"symbol": symbol, "clock": clock, "status": "INSUFFICIENT_HISTORY", "decisions": 0, "groups": {}}
    cache: dict[tuple, dict[str, Any] | None] = {}

    def compact(tf: str, asof: int) -> dict[str, Any] | None:
        end = replay._closed_end(series[tf], tf, asof)
        if end <= 0:
            return None
        last = int(series[tf][end - 1][0])
        key = (tf, last)
        if key in cache:
            return cache[key]
        lookback = int(vision.tf_cfg(tf)["lookback"])
        prefix = series[tf][max(0, end - lookback):end]
        snap = ca.analyse_timeframe(symbol, tf, prefix, ("READY", "closed historical candles"), asof)
        if snap.get("status") in (None, "NO_CHANNEL", "INSUFFICIENT"):
            cache[key] = None
            return None
        built = {
            "timeframe": tf, "direction": snap.get("direction"), "status": snap.get("status"),
            "position": snap.get("position"), "lower": snap.get("lowerBoundary"), "upper": snap.get("upperBoundary"),
            "mid": snap.get("midline"), "channelId": snap.get("channelId"), "confidence": snap.get("confidence"),
            "atr": (snap.get("evidence") or {}).get("atr"),
            "touchCount": snap.get("touchCount"),
        }
        cache[key] = built
        return built

    # Live deep confirmation is M15 and M5. H1 is evaluated here only so L1/L2 have an execution-timeframe
    # read; it is not a stored Stage 7 decision. The engine is called without a parent, matching live.
    engine_tfs = ("H1", "M15") if clock == "M15" else ("M5",)
    engines = {tf: confirm_engine.ConfirmationEngine(tf) for tf in engine_tfs}
    decided: dict[tuple, tuple[dict[str, Any], dict[str, Any] | None]] = {}
    width = int(confirm.CONFIG["lookback"])
    minimum = int(confirm.CONFIG["minBars"])
    start = max(80, minimum)
    indexes = range(start, len(bars))
    if limit is not None:
        indexes = range(max(start, len(bars) - int(limit)), len(bars))
    episodes: dict[tuple, dict[str, Any]] = {}
    folded: dict[str, dict[str, Any]] = {level: {"order": [], "episodes": {}} for level in ("L1", "L2", "L3", "L4")}

    def confirmation_at(tf: str, asof: int) -> tuple[dict[str, Any], dict[str, Any] | None]:
        end = replay._closed_end(series[tf], tf, asof)
        prefix = series[tf][max(0, end - width):end]
        if prefix and ca.bar_close(tf, int(prefix[-1][0])) > asof:
            raise RuntimeError("confirmation prefix includes a future bar")
        channel = pack.get(tf) or {}
        direction = channel.get("direction")
        last = int(prefix[-1][0]) if prefix else 0
        key = (tf, last, direction)
        if key in decided:
            return decided[key]
        if len(prefix) < minimum:
            found = (_blank_diag() | {"state": "WARMING_UP", "reasonCode": "INSUFFICIENT_H1_HISTORY", "direction": direction}, None)
        elif direction not in ("BULLISH", "BEARISH"):
            found = (_blank_diag() | {"direction": direction}, None)
        else:
            decision = engines[tf].evaluate(symbol, prefix, str(direction), now_ts=asof)
            diag = _diag_from_decision(decision, str(direction))
            forwarded = None
            if diag["state"] in ("CONFIRMED", "BREAKOUT_CONFIRMED_WAIT_RETEST"):
                forwarded = {
                    "direction": direction, "state": diag["state"], "timing": diag["timing"],
                    "extension": diag["extension"], "reaction": diag["reaction"],
                }
            found = (diag, forwarded)
        decided[key] = found
        return found

    for index in indexes:
        asof = ca.bar_close(clock, int(bars[index][0]))
        pack = {tf: row for tf in frames if (row := compact(tf, asof))}
        diags: dict[str, dict[str, Any]] = {}
        confirmations: dict[str, dict[str, Any]] = {}
        for tf in engine_tfs:
            diag, forwarded = confirmation_at(tf, asof)
            diags[tf] = diag
            if forwarded:
                confirmations[tf] = forwarded
        close = float(bars[index][4])
        hypotheses = opportunity.classify_levels(symbol, pack, close, confirmation_by_tf=confirmations or None)
        for item in hypotheses:
            if item.get("status") == "NOT_DETECTED":
                continue
            level = item.get("TiTLevel")
            if clock == "M15" and level not in ("L1", "L2", "L3"):
                continue
            if clock == "M5" and level != "L4":
                continue
            key = episode_key(item)
            row = episodes.get(key)
            if row is None:
                row = _new_episode(item, pack)
                episodes[key] = row
            observe_episode(row, item, diags.get(item.get("executionTimeframe")) or _blank_diag(), pack)
            _fold_one(folded[level], item)
        for row in episodes.values():
            if row.get("touch") is None:
                continue
            move = row["sign"] * (close - float(row["touch"]))
            row["fav"] = max(float(row["fav"]), move)
            row["adv"] = max(float(row["adv"]), -move)
    groups = {level: _fold_summary(folded[level]) for level in ("L1", "L2", "L3", "L4")}
    wanted = ("L1", "L2", "L3") if clock == "M15" else ("L4",)
    funnel = {}
    for level in wanted:
        published = [_episode_public(row) for row in episodes.values() if row["level"] == level]
        funnel[level] = _funnel_level(published, historical_h1=level in ("L1", "L2"))
    return {
        "symbol": symbol, "clock": clock, "status": "REPLAYED",
        "decisions": len(list(indexes)),
        "confirmationBars": width, "confirmationMinimum": minimum,
        "lookahead": False, "groups": groups, "funnel": funnel,
    }


def _fold_one(bucket: dict[str, Any], item: dict[str, Any]) -> None:
    key = episode_key(item)
    row = bucket["episodes"].get(key)
    if row is None:
        row = {
            "samples": 0, "erz": False, "p1Zone": False, "p1": False, "p2": False,
            "waitRetest": False, "invalidated": False,
        }
        bucket["episodes"][key] = row
        bucket["order"].append(key)
    row["samples"] += 1
    location = item.get("location") or {}
    p1 = (item.get("p1") or {}).get("state")
    p2 = (item.get("p2") or {}).get("state")
    row["erz"] = row["erz"] or location.get("inside") is True or p1 == "P1_ZONE_REACHED"
    row["p1Zone"] = row["p1Zone"] or p1 == "P1_ZONE_REACHED" or p1 == P1_READY
    row["p1"] = row["p1"] or p1 == P1_READY
    row["p2"] = row["p2"] or p2 == P2_READY
    row["waitRetest"] = row["waitRetest"] or p2 == "P2_WAIT_RETEST"
    row["invalidated"] = row["invalidated"] or item.get("status") == "INVALIDATED"


def _fold_summary(bucket: dict[str, Any]) -> dict[str, Any]:
    rows = [bucket["episodes"][key] for key in bucket["order"]]

    def count(pred) -> int:
        return sum(1 for row in rows if pred(row))

    return {
        "episodes": len(rows),
        "samples": sum(row["samples"] for row in rows),
        "reachedErz": count(lambda row: row["erz"]),
        "p1Zone": count(lambda row: row["p1Zone"]),
        "p1": count(lambda row: row["p1"]),
        "p2": count(lambda row: row["p2"]),
        "both": count(lambda row: row["p1"] and row["p2"]),
        "waitRetest": count(lambda row: row["waitRetest"]),
        "neither": count(lambda row: not row["p1"] and not row["p2"]),
        "invalidated": count(lambda row: row["invalidated"]),
    }


def _funnel_level(rows: list[dict[str, Any]], historical_h1: bool = False) -> dict[str, Any]:
    p1_order = (
        "P1_HYPOTHESIS", "P1_ZONE_APPROACH", "P1_ZONE_REACHED", "P1_REACTION_MONITORING",
        "P1_REACTION_DETECTED", "P1_STRUCTURE_VALID", "P1_CONFIRMATION_PASSED", "P1_READY_FOR_RISK",
    )
    p2_order = (
        "P2_HYPOTHESIS", "P2_BREAK_LEVEL_DEFINED", "P2_BREAK_APPROACHED", "P2_BREAK_DETECTED",
        "P2_CLOSED_BREAK", "P2_STRUCTURE_CONFIRMED", "P2_BREAK_QUALITY_PASSED",
        "P2_EXTENSION_CHECK_PASSED", "P2_READY_FOR_RISK",
    )
    reasons: dict[str, int] = {}
    classes: dict[str, int] = {}
    families: dict[str, dict[str, int]] = {}
    maturity: dict[str, int] = {}
    touches: list[int] = []
    for row in rows:
        reasons[f"P1:{row['p1Reason']}"] = reasons.get(f"P1:{row['p1Reason']}", 0) + 1
        reasons[f"P2:{row['p2Reason']}"] = reasons.get(f"P2:{row['p2Reason']}", 0) + 1
        classes[f"P1_{row['p1Class']}"] = classes.get(f"P1_{row['p1Class']}", 0) + 1
        classes[f"P2_{row['p2Class']}"] = classes.get(f"P2_{row['p2Class']}", 0) + 1
        family = families.setdefault(str(row.get("family") or "NONE"), {"episodes": 0, "erz": 0, "p1Ready": 0, "p2Ready": 0})
        family["episodes"] += 1
        family["erz"] += 1 if row["erz"]["reached"] else 0
        family["p1Ready"] += 1 if row["p1Stage"] == "P1_READY_FOR_RISK" else 0
        family["p2Ready"] += 1 if row["p2Stage"] == "P2_READY_FOR_RISK" else 0
        maturity[str(row.get("childStatus") or "UNKNOWN")] = maturity.get(str(row.get("childStatus") or "UNKNOWN"), 0) + 1
        if row.get("childTouches") is not None:
            touches.append(int(row["childTouches"]))
    p1_ready = sum(1 for row in rows if row["p1Stage"] == "P1_READY_FOR_RISK")
    p2_ready = sum(1 for row in rows if row["p2Stage"] == "P2_READY_FOR_RISK")
    both = sum(1 for row in rows if row["p1Stage"] == "P1_READY_FOR_RISK" and row["p2Stage"] == "P2_READY_FOR_RISK")
    return {
        "episodes": len(rows),
        "historicalH1Confirmation": historical_h1,
        "p1": _count_stage(rows, p1_order, "p1Stage"),
        "p2": _count_stage(rows, p2_order, "p2Stage"),
        "retest": {
            "extended": sum(1 for row in rows if row.get("retestStage")),
            "waitRetest": sum(1 for row in rows if row.get("retestStage") in ("P2_WAIT_RETEST", "P2_RETEST_DETECTED", "P2_RETEST_HELD", "P2_READY_FOR_RISK")),
            "retestDetected": sum(1 for row in rows if row.get("retestStage") in ("P2_RETEST_DETECTED", "P2_RETEST_HELD", "P2_READY_FOR_RISK")),
            "retestHeld": sum(1 for row in rows if row.get("retestStage") in ("P2_RETEST_HELD", "P2_READY_FOR_RISK")),
        },
        "components": {
            "bos": sum(1 for row in rows if row["bos"]),
            "choch": sum(1 for row in rows if row["choch"]),
            "reactionInZone": sum(1 for row in rows if row["reactionInZone"]),
            "reactionAnywhere": sum(1 for row in rows if row["reactionAnywhere"]),
            "retest": sum(1 for row in rows if row["retest"]),
            "falseBreak": sum(1 for row in rows if row["falseBreak"]),
            "childBoundaryCrossed": sum(1 for row in rows if row["childBoundaryCrossed"]),
            "opposedTrigger": sum(1 for row in rows if row["opposedTrigger"]),
            "pullbackHoldingOrComplete": sum(1 for row in rows if "HOLDING" in row["pullbacks"] or "COMPLETE" in row["pullbacks"]),
            "pullbackInProgress": sum(1 for row in rows if "IN_PROGRESS" in row["pullbacks"]),
        },
        "erzReached": sum(1 for row in rows if row["erz"]["reached"]),
        "p1Ready": p1_ready,
        "p2Ready": p2_ready,
        "both": both,
        "neither": len(rows) - sum(1 for row in rows if row["p1Stage"] == "P1_READY_FOR_RISK" or row["p2Stage"] == "P2_READY_FOR_RISK"),
        "families": families,
        "childStatusAtStart": maturity,
        "childTouchCount": {"episodes": len(touches), "min": min(touches) if touches else None, "max": max(touches) if touches else None},
        "neverVsFailed": classes,
        "reasons": dict(sorted(reasons.items(), key=lambda item: -item[1])[:16]),
        "episodesDetail": rows,
        "researchOnly": "favorableAtr and adverseAtr are subsequent movement after an ERZ touch. They are not trades.",
    }


def replay_both(symbol: str) -> dict[str, Any]:
    """L3 on every closed M15 bar and L4 on every closed M5 bar. One symbol, both clocks."""
    m15 = replay_symbol(symbol, "M15")
    m5 = replay_symbol(symbol, "M5")
    def slim(result: dict[str, Any]) -> dict[str, Any]:
        return {key: result.get(key) for key in ("status", "decisions", "confirmationBars", "confirmationMinimum", "lookahead", "groups", "funnel")}
    return {"symbol": symbol, "m15": slim(m15), "m5": slim(m5)}


def validation_status() -> dict[str, Any]:
    limits = production_limits()
    try:
        import history_store as hs
    except ImportError:  # pragma: no cover
        from bridge.mt5 import history_store as hs  # type: ignore
    try:
        stats = hs.candle_stats_all()
    except Exception as exc:
        stats = {}
        coverage = {"symbols": 0, "rows": [], "error": str(exc)}
    else:
        coverage = coverage_report(stats)
    return {
        "kind": "HISTORICAL_REPLAY",
        "production": limits,
        "stage6": STAGE6,
        "executionModel": EXECUTION_MODEL,
        "coverage": coverage,
        "counterfactual": "Capacity and reserve studies are separate from production and are not applied.",
        "replay": "NOT_RUN" if not any(row.get("measurable") for row in coverage.get("rows") or []) else "WAITING_FOR_EXPLICIT_REPLAY",
    }
