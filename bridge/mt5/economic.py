"""Economic Intelligence calculations.

The bridge owns this engine. The page only observes the snapshot. No path here submits an order.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

FX = (
    "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD",
    "EURGBP", "EURJPY", "EURCHF", "EURCAD", "EURAUD", "EURNZD",
    "GBPJPY", "GBPCHF", "GBPCAD", "GBPAUD", "GBPNZD",
    "AUDJPY", "AUDCHF", "AUDCAD", "AUDNZD",
    "CADJPY", "CADCHF", "NZDJPY", "NZDCHF", "NZDCAD", "CHFJPY",
)
UNIVERSE = (*FX, "XAUUSD")
CURRENCIES = ("USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD")
IMPACTS = ("HIGH", "MEDIUM", "LOW")
STATES = (
    "NORMAL", "EVENT_WATCH", "PRE_EVENT_RESTRICTED", "EVENT_LOCK",
    "RELEASE_PROCESSING", "POST_EVENT_VOLATILITY", "STRUCTURE_REVALIDATION",
)
ACTIONS = ("ALLOW", "CAUTION", "REDUCE_RISK", "BLOCK_NEW_ENTRY", "MANAGE_EXISTING", "REVALIDATE", "RESUME")
ACTION_RANK = {name: i for i, name in enumerate(reversed(ACTIONS))}
# Higher rank is more restrictive for new entries.
RESTRICT_RANK = {
    "ALLOW": 0, "RESUME": 0, "MANAGE_EXISTING": 1, "CAUTION": 2,
    "REDUCE_RISK": 3, "REVALIDATE": 4, "BLOCK_NEW_ENTRY": 5,
}
BLOCKS_NEW = {"BLOCK_NEW_ENTRY", "REVALIDATE"}

DEFAULT_POLICY: dict[str, Any] = {
    "enabled": True,
    "providerUrlRef": "ECON_CALENDAR_URL",
    "providerTokenRef": "ECON_CALENDAR_TOKEN",
    "timezone": "Africa/Lagos",
    "currencies": list(CURRENCIES),
    "impacts": list(IMPACTS),
    "highPreWatchMin": 180,
    "highPreRestrictMin": 30,
    "highLockMin": 5,
    "highPostVolMin": 15,
    "highRevalidateMin": 30,
    "mediumPreCautionMin": 20,
    "mediumPostMin": 15,
    "lowWatchMin": 15,
    "maxSpreadMultiplier": 2.0,
    "volatilityAtr": 1.5,
    "xauSensitivity": "HIGH",
    "riskReductionFactor": 0.5,
    "blockOnStaleFeed": True,
    "staleAfterSec": 180,
    "developmentSample": False,
    "machineCalendar": True,
    "externalReference": True,
    "reactionMovePips": 12,
    "reactionScoreMin": 70,
}

POLICY_BOUNDS: dict[str, tuple[float, float]] = {
    "highPreWatchMin": (30, 720),
    "highPreRestrictMin": (5, 180),
    "highLockMin": (1, 30),
    "highPostVolMin": (1, 120),
    "highRevalidateMin": (5, 180),
    "mediumPreCautionMin": (5, 120),
    "mediumPostMin": (1, 90),
    "lowWatchMin": (1, 60),
    "maxSpreadMultiplier": (1, 8),
    "volatilityAtr": (0.5, 6),
    "riskReductionFactor": (0.1, 1),
    "staleAfterSec": (30, 3600),
    "reactionMovePips": (1, 200),
    "reactionScoreMin": (10, 100),
}


def development_mode() -> bool:
    return os.environ.get("CACSMS_ENV", "development").strip().lower() != "production"


def feed_state(source_mode: str) -> str:
    """Public calendar health. A development sample is never reported as LIVE."""
    mode = str(source_mode or "UNCONFIGURED").upper()
    if mode in ("LIVE", "DELAYED", "STALE", "DISCONNECTED", "ERROR"):
        return mode
    return "NOT_CONFIGURED"


def reaction_score(*, spread_ratio: float | None, move_pips: float | None, spread_threshold: float, move_threshold: float) -> dict[str, Any]:
    """Score only the observations that exist. Missing MT5 inputs stay null."""
    parts: list[float] = []
    if spread_ratio is not None and spread_threshold > 1:
        parts.append(min(100.0, max(0.0, (spread_ratio - 1) / (spread_threshold - 1) * 100)))
    if move_pips is not None and move_threshold > 0:
        parts.append(min(100.0, max(0.0, abs(move_pips) / move_threshold * 100)))
    if not parts:
        return {"score": None, "available": False}
    return {"score": round(sum(parts) / len(parts), 1), "available": True}


def provider_env(policy: dict[str, Any]) -> tuple[str, str]:
    """Resolve the configured provider without returning the token to callers that persist the snapshot for the UI."""
    url_key = str(policy.get("providerUrlRef") or "ECON_CALENDAR_URL")
    token_key = str(policy.get("providerTokenRef") or "ECON_CALENDAR_TOKEN")
    url = os.environ.get(url_key, "").strip()
    token = os.environ.get(token_key, "").strip()
    return url, token


def affected_instruments(currency: str, impact: str, xau_sensitivity: str) -> list[str]:
    ccy = currency.upper()
    if ccy == "XAU":
        return ["XAUUSD"]
    pairs = [s for s in FX if ccy in (s[:3], s[3:])]
    if ccy == "USD":
        level = str(xau_sensitivity or "HIGH").upper()
        order = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}
        if order.get(impact, 0) >= order.get(level, 3):
            pairs.append("XAUUSD")
    return pairs


def series_kind(title: str) -> str:
    t = title.lower()
    if any(k in t for k in ("speaks", "speech", "press conference", "minutes", "member")):
        return "speech"
    if "rate statement" in t or "monetary policy statement" in t or "policy statement" in t:
        return "speech"
    if any(k in t for k in ("unemployment", "jobless", "claimant count")):
        return "lower_positive"
    if any(k in t for k in ("non-farm", "nonfarm", "nfp", "employment change", "job openings", "jolts", "payroll")):
        return "higher_positive"
    if any(k in t for k in ("cpi", "inflation", "ppi", "pce", "hicp")):
        return "higher_positive"
    if "gdp" in t:
        return "higher_positive"
    if any(k in t for k in ("interest rate", "rate decision", "cash rate", "official bank rate")):
        return "rate"
    if any(k in t for k in ("confidence", "pmi", "sentiment", "kof", "ifo", "zew", "leading", "survey")):
        return "higher_positive"
    if any(k in t for k in ("trade balance", "retail sales", "industrial", "building", "permits", "consents")):
        return "higher_positive"
    return "unclassified"


def _num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    text = re.sub(r"[%$]", "", text)
    mult = 1.0
    if text.endswith(("K", "k")):
        mult, text = 1_000.0, text[:-1]
    elif text.endswith(("M", "m")):
        mult, text = 1_000_000.0, text[:-1]
    try:
        return float(text) * mult
    except ValueError:
        return None


def surprise(actual: Any, forecast: Any, kind: str) -> dict[str, Any] | None:
    """Raw actual-minus-forecast is stored separately from the currency interpretation.

    A positive raw delta is not treated as bullish. lower-is-positive series (unemployment)
    invert the interpretation. Speeches have no numerical surprise.
    """
    if kind == "speech":
        return {"available": False, "reason": "No numerical surprise for a speech or statement", "interpretation": "UNAVAILABLE"}
    a, f = _num(actual), _num(forecast)
    if a is None or f is None:
        return None
    raw = a - f
    scale = abs(f) if f else 1.0
    raw_pct = raw / scale * 100
    signed = -raw if kind == "lower_positive" else raw
    if abs(raw) < 1e-9:
        interpretation = "NEUTRAL"
    elif signed > 0:
        interpretation = "POSITIVE_FOR_CURRENCY"
    else:
        interpretation = "NEGATIVE_FOR_CURRENCY"
    return {
        "available": True,
        "rawDelta": round(raw, 6),
        "rawPct": round(raw_pct, 4),
        "interpretation": interpretation,
        "series": kind,
    }


def normalize_impact(value: Any) -> str:
    text = str(value or "").strip().upper()
    if text in ("HIGH", "3", "RED"):
        return "HIGH"
    if text in ("MEDIUM", "MED", "2", "ORANGE"):
        return "MEDIUM"
    if text in ("LOW", "1", "YELLOW", "GREEN"):
        return "LOW"
    return "LOW"


def normalize_event(raw: dict[str, Any], *, source_mode: str) -> dict[str, Any] | None:
    title = str(raw.get("title") or raw.get("event") or "").strip()
    currency = str(raw.get("currency") or raw.get("country") or "").strip().upper()[:3]
    when = raw.get("scheduledAt") or raw.get("time") or raw.get("datetime")
    if not title or currency not in CURRENCIES or not when:
        return None
    if isinstance(when, datetime):
        scheduled = when if when.tzinfo else when.replace(tzinfo=timezone.utc)
    else:
        text = str(when).replace("Z", "+00:00")
        try:
            scheduled = datetime.fromisoformat(text)
        except ValueError:
            return None
        if scheduled.tzinfo is None:
            scheduled = scheduled.replace(tzinfo=timezone.utc)
    kind = str(raw.get("seriesKind") or series_kind(title))
    impact = normalize_impact(raw.get("impact"))
    actual, forecast, previous = raw.get("actual"), raw.get("forecast"), raw.get("previous")
    status = str(raw.get("status") or "").upper()
    if status not in ("UPCOMING", "DUE", "RELEASED", "DELAYED", "CANCELLED"):
        status = "RELEASED" if actual not in (None, "") else "UPCOMING"
    key = str(raw.get("id") or raw.get("providerKey") or f"{currency}|{title}|{scheduled.astimezone(timezone.utc).strftime('%Y%m%d%H%M')}")
    return {
        "id": key[:80],
        "providerKey": key[:160],
        "scheduledAt": scheduled.astimezone(timezone.utc).isoformat(),
        "currency": currency,
        "country": str(raw.get("country") or currency)[:8],
        "title": title[:240],
        "impact": impact,
        "seriesKind": kind,
        "unit": (str(raw["unit"])[:16] if raw.get("unit") else None),
        "actual": None if actual in (None, "") else str(actual)[:40],
        "forecast": None if forecast in (None, "") else str(forecast)[:40],
        "previous": None if previous in (None, "") else str(previous)[:40],
        "status": status,
        "surprise": surprise(actual, forecast, kind) if status == "RELEASED" or actual not in (None, "") else None,
        "sourceMode": source_mode,
        "timeUncertain": bool(raw.get("timeUncertain")),
    }


def _minutes(scheduled_at: str, now: datetime) -> float | None:
    try:
        when = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (when - now).total_seconds() / 60


def classify_event(event: dict[str, Any], policy: dict[str, Any], now: datetime) -> dict[str, Any]:
    """Map one event onto the autonomous state machine and the action it may impose."""
    mins = _minutes(str(event["scheduledAt"]), now)
    impact = event["impact"]
    status = event["status"]
    base = {
        "eventId": event["id"], "currency": event["currency"], "impact": impact, "title": event["title"],
        "minutesToEvent": None if mins is None else int(round(mins)), "state": "NORMAL", "action": "ALLOW",
        "revalidationRequired": False,
    }
    if status == "CANCELLED":
        return {**base, "state": "NORMAL", "action": "RESUME", "reason": f"{event['title']} cancelled"}
    if status == "DELAYED" or event.get("timeUncertain") or mins is None:
        return {**base, "state": "PRE_EVENT_RESTRICTED", "action": "BLOCK_NEW_ENTRY",
                "reason": f"{event['currency']} {event['title']}: event time is uncertain — new entries fail closed"}
    if not policy.get("enabled", True):
        return {**base, "state": "NORMAL", "action": "ALLOW", "reason": "Economic Intelligence disabled"}

    high_watch = float(policy["highPreWatchMin"])
    high_restrict = float(policy["highPreRestrictMin"])
    lock = float(policy["highLockMin"])
    post_vol = float(policy["highPostVolMin"])
    reval = float(policy["highRevalidateMin"])
    med_pre = float(policy["mediumPreCautionMin"])
    med_post = float(policy["mediumPostMin"])
    low_watch = float(policy["lowWatchMin"])

    released = status == "RELEASED" or event.get("actual") not in (None, "")
    if impact == "HIGH":
        if not released and -1 <= mins <= lock:
            state, action = "EVENT_LOCK", "BLOCK_NEW_ENTRY"
        elif not released and lock < mins <= high_restrict:
            state, action = "PRE_EVENT_RESTRICTED", "BLOCK_NEW_ENTRY"
        elif not released and high_restrict < mins <= high_watch:
            state, action = "EVENT_WATCH", "CAUTION"
        elif released and -2 <= mins <= 2 and event.get("surprise") is None and event.get("seriesKind") != "speech":
            state, action = "RELEASE_PROCESSING", "BLOCK_NEW_ENTRY"
        elif mins < 0 and mins >= -post_vol:
            state, action = "POST_EVENT_VOLATILITY", "BLOCK_NEW_ENTRY"
        elif mins < -post_vol and mins >= -(post_vol + reval):
            state, action = "STRUCTURE_REVALIDATION", "REVALIDATE"
            base["revalidationRequired"] = True
        else:
            state, action = "NORMAL", "ALLOW"
    elif impact == "MEDIUM":
        if not released and 0 <= mins <= med_pre:
            state, action = "PRE_EVENT_RESTRICTED", "CAUTION"
        elif not released and med_pre < mins <= high_watch:
            state, action = "EVENT_WATCH", "ALLOW"
        elif released and -2 <= mins <= 2 and event.get("actual") not in (None, "") and event.get("surprise") is None:
            state, action = "RELEASE_PROCESSING", "REDUCE_RISK"
        elif mins < 0 and mins >= -med_post:
            state, action = "POST_EVENT_VOLATILITY", "REDUCE_RISK"
        elif mins < -med_post and mins >= -(med_post + reval / 2):
            state, action = "STRUCTURE_REVALIDATION", "REVALIDATE"
            base["revalidationRequired"] = True
        else:
            state, action = "NORMAL", "ALLOW"
    else:
        if not released and 0 <= mins <= low_watch:
            state, action = "EVENT_WATCH", "ALLOW"
        elif mins < 0 and mins >= -low_watch:
            state, action = "POST_EVENT_VOLATILITY", "MANAGE_EXISTING"
        else:
            state, action = "NORMAL", "ALLOW"

    if state == "NORMAL" and action == "ALLOW" and released and mins < -5:
        action = "RESUME"
    reason = f"{event['currency']} {event['title']} · {impact.lower()} · {base['minutesToEvent']}m"
    return {**base, "state": state, "action": action, "reason": reason}


def worst(actions: list[str]) -> str:
    if not actions:
        return "ALLOW"
    return max(actions, key=lambda a: RESTRICT_RANK.get(a, 0))


def engine_state(rows: list[dict[str, Any]]) -> str:
    order = list(STATES)
    best = "NORMAL"
    for row in rows:
        if order.index(row["state"]) > order.index(best):
            best = row["state"]
    return best


def blocks_new(action: str, *, source_mode: str, enabled: bool, block_on_stale: bool) -> tuple[bool, str]:
    """Live new-entry permission. A development sample never counts as a live calendar."""
    if not enabled:
        return False, "Economic Intelligence is disabled"
    if source_mode == "UNCONFIGURED":
        return True, "DATA SOURCE NOT CONFIGURED — new entries fail closed"
    if source_mode == "DISCONNECTED":
        return True, "Economic calendar provider disconnected — new entries fail closed"
    if source_mode in ("STALE", "DELAYED") and block_on_stale:
        return True, "CALENDAR_UNCERTAIN — the machine calendar is not fresh, so missing rows are not treated as no events"
    if source_mode == "DEVELOPMENT":
        return True, "Development sample is not a live calendar — new entries fail closed"
    if source_mode != "LIVE":
        return True, f"Economic source {source_mode} is not live — new entries fail closed"
    if action in BLOCKS_NEW:
        return True, action
    return False, ""


def sanitize_policy(patch: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    out = dict(current)
    for key, (lo, hi) in POLICY_BOUNDS.items():
        if key in patch and patch[key] is not None:
            try:
                value = float(patch[key])
            except (TypeError, ValueError):
                continue
            out[key] = int(value) if float(value).is_integer() and key != "riskReductionFactor" and key != "maxSpreadMultiplier" and key != "volatilityAtr" else round(value, 3)
            out[key] = min(hi, max(lo, out[key]))
    if "enabled" in patch:
        out["enabled"] = bool(patch["enabled"])
    if "blockOnStaleFeed" in patch:
        out["blockOnStaleFeed"] = bool(patch["blockOnStaleFeed"])
    if "machineCalendar" in patch:
        out["machineCalendar"] = bool(patch["machineCalendar"])
    if "externalReference" in patch:
        out["externalReference"] = bool(patch["externalReference"])
    if "developmentSample" in patch:
        out["developmentSample"] = bool(patch["developmentSample"]) and development_mode()
    if "timezone" in patch:
        zone = str(patch["timezone"] or "Africa/Lagos")
        try:
            ZoneInfo(zone)
            out["timezone"] = zone
        except Exception:
            pass
    if "xauSensitivity" in patch and str(patch["xauSensitivity"]).upper() in ("HIGH", "MEDIUM", "LOW", "ALL"):
        out["xauSensitivity"] = str(patch["xauSensitivity"]).upper()
    if "currencies" in patch and isinstance(patch["currencies"], list):
        out["currencies"] = [c for c in patch["currencies"] if c in CURRENCIES] or list(CURRENCIES)
    if "impacts" in patch and isinstance(patch["impacts"], list):
        out["impacts"] = [c for c in patch["impacts"] if c in IMPACTS] or list(IMPACTS)
    for ref in ("providerUrlRef", "providerTokenRef"):
        if ref in patch:
            name = re.sub(r"[^A-Za-z0-9_]", "", str(patch[ref] or ""))[:64]
            if name:
                out[ref] = name
    return out


def public_policy(policy: dict[str, Any]) -> dict[str, Any]:
    """Settings the browser may see. Environment values stay on the bridge."""
    url, _token = provider_env(policy)
    return {
        **{k: policy.get(k) for k in DEFAULT_POLICY},
        "providerConfigured": bool(url),
        "developmentMode": development_mode(),
    }


def development_events(now: datetime, zone_name: str) -> list[dict[str, Any]]:
    """Labeled sample calendar for development only. Times are real instants so countdowns move."""
    zone = ZoneInfo(zone_name)
    local = now.astimezone(zone)
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow = day + timedelta(days=1)
    # Next Monday, at least two days ahead, so Next Week is distinct from tomorrow.
    monday = day + timedelta(days=(7 - day.weekday()) % 7 or 7)
    due = (local + timedelta(seconds=75)).replace(microsecond=0)
    rows: list[tuple] = [
        ("AUD", "AU", "RBA Rate Statement", "HIGH", None, None, None, day.replace(hour=2, minute=30), "speech"),
        ("AUD", "AU", "RBA Interest Rate Decision", "HIGH", "4.60", "4.60", "4.35", day.replace(hour=5, minute=30), "rate"),
        ("CHF", "CH", "KOF Leading Indicators (Sep)", "MEDIUM", None, "106.0", "106.7", due, "higher_positive"),
        ("EUR", "EU", "ECB President Lagarde Speaks", "HIGH", None, None, None, day.replace(hour=12, minute=0), "speech"),
        ("CAD", "CA", "GDP (MoM) (Jul)", "MEDIUM", None, "0.0", "0.3", day.replace(hour=13, minute=30), "higher_positive"),
        ("USD", "US", "S&P/CS HPI Composite (YoY) (Jul)", "MEDIUM", None, "2.2", "2.1", day.replace(hour=14, minute=0), "higher_positive"),
        ("USD", "US", "S&P/CS HPI Composite (MoM) (Jul)", "MEDIUM", None, "0.4", "0.3", day.replace(hour=14, minute=3), "higher_positive"),
        ("USD", "US", "CB Consumer Confidence (Sep)", "HIGH", None, "89.2", "89.4", day.replace(hour=15, minute=0), "higher_positive"),
        ("USD", "US", "JOLTS Job Openings (Aug)", "HIGH", None, "7.230", "7.271", day.replace(hour=15, minute=0), "higher_positive"),
        ("GBP", "UK", "BoE MPC Member Mann Speaks", "MEDIUM", None, None, None, day.replace(hour=16, minute=0), "speech"),
        ("EUR", "EU", "German ZEW Economic Sentiment", "MEDIUM", None, "18.4", "16.2", day.replace(hour=17, minute=30), "higher_positive"),
        ("JPY", "JP", "BOJ Summary of Opinions", "MEDIUM", None, None, None, day.replace(hour=18, minute=10), "speech"),
        ("USD", "US", "FOMC Member Speaks", "HIGH", None, None, None, day.replace(hour=18, minute=30), "speech"),
        ("NZD", "NZ", "Building Consents (MoM)", "LOW", None, "1.2", "-0.4", day.replace(hour=22, minute=45), "higher_positive"),
        ("AUD", "AU", "MI Inflation Gauge (MoM)", "LOW", None, "0.2", "0.1", day.replace(hour=19, minute=15), "higher_positive"),
        ("CHF", "CH", "PPI (MoM)", "LOW", None, "0.1", "-0.2", day.replace(hour=20, minute=0), "higher_positive"),
        ("CAD", "CA", "Building Permits (MoM)", "LOW", None, "0.6", "1.1", day.replace(hour=21, minute=0), "higher_positive"),
        ("GBP", "UK", "Nationwide HPI (MoM)", "LOW", None, "0.2", "0.1", day.replace(hour=21, minute=30), "higher_positive"),
        ("USD", "US", "ADP Employment Change", "HIGH", None, "140", "120", tomorrow.replace(hour=13, minute=15), "higher_positive"),
        ("EUR", "EU", "CPI (YoY)", "HIGH", None, "2.1", "2.2", tomorrow.replace(hour=10, minute=0), "higher_positive"),
        ("GBP", "UK", "Unemployment Rate", "MEDIUM", None, "4.7", "4.7", tomorrow.replace(hour=7, minute=0), "lower_positive"),
        ("JPY", "JP", "Household Spending (YoY)", "LOW", None, "1.4", "0.8", tomorrow.replace(hour=0, minute=30), "higher_positive"),
        ("USD", "US", "Non-Farm Payrolls", "HIGH", None, "160", "142", monday.replace(hour=13, minute=30), "higher_positive"),
        ("USD", "US", "Unemployment Rate", "HIGH", None, "4.3", "4.3", monday.replace(hour=13, minute=30), "lower_positive"),
        ("EUR", "EU", "ECB Interest Rate Decision", "HIGH", None, "2.15", "2.15", monday.replace(hour=13, minute=15), "rate"),
    ]
    out = []
    for ccy, country, title, impact, actual, forecast, previous, when, kind in rows:
        local_when = when if when.tzinfo else when.replace(tzinfo=zone)
        released = local_when <= local and actual not in (None, "")
        status = "RELEASED" if released else ("DUE" if abs((local_when - local).total_seconds()) < 180 else "UPCOMING")
        out.append({
            "id": f"dev|{ccy}|{title}|{local_when.strftime('%Y%m%d%H%M')}",
            "currency": ccy, "country": country, "title": title, "impact": impact,
            "actual": actual, "forecast": forecast, "previous": previous,
            "scheduledAt": local_when.astimezone(timezone.utc).isoformat(),
            "status": status, "seriesKind": kind, "unit": "%" if "Rate" in title or "CPI" in title or "Unemployment" in title else None,
        })
    return out
