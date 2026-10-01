"""Which autonomous events become emails. This module does not send mail and does not authorize trades."""

from __future__ import annotations

import re
from typing import Any

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Positive alerts stay off when the market evidence is stale.
FRESH_REQUIRED = {
    "CHANNEL_BREAK_CONFIRMED",
    "CHANNEL_RETEST_HELD",
    "CHANNEL_BREAK_CONTINUATION",
    "P1_READY_FOR_RISK",
    "P2_READY_FOR_RISK",
    "P1_AUTHORIZED",
    "P2_AUTHORIZED",
    "OPPORTUNITY_READY_FOR_RISK",
    "OPPORTUNITY_AUTHORIZED",
}

DEFAULT_POLICIES: dict[str, bool] = {
    "CHANNEL_BREAK_APPROACH": False,
    "CHANNEL_BREAK_DETECTED": False,
    "CHANNEL_BREAK_CONFIRMED": True,
    "CHANNEL_BREAK_FAILED": False,
    "CHANNEL_RETEST_STARTED": False,
    "CHANNEL_RETEST_HELD": True,
    "CHANNEL_RETEST_FAILED": False,
    "CHANNEL_BREAK_CONTINUATION": False,
    "P1_ZONE_REACHED": False,
    "P1_REACTION_DETECTED": False,
    "P1_READY_FOR_RISK": True,
    "P1_AUTHORIZED": True,
    "P2_BREAK_DETECTED": False,
    "P2_WAIT_RETEST": False,
    "P2_READY_FOR_RISK": True,
    "P2_AUTHORIZED": True,
    "ORDER_SUBMITTED": True,
    "ORDER_FILLED": True,
    "ORDER_PARTIALLY_FILLED": True,
    "ORDER_REJECTED": True,
    "POSITION_OPENED": True,
    "POSITION_CLOSED": True,
    "STOP_LOSS_TRIGGERED": True,
    "TAKE_PROFIT_TRIGGERED": True,
    "MT5_DISCONNECTED": False,
    "MT5_RECONNECTED": False,
    "MARKET_DATA_STALE": False,
    "CALENDAR_FEED_STALE": False,
    "ECONOMIC_EVENT_LOCK": False,
    "SMTP_DEGRADED": False,
    "SYSTEM_EMERGENCY_STOP": False,
    "OPPORTUNITY_DISCOVERED": False,
    "OPPORTUNITY_CONFIRMING": False,
    "OPPORTUNITY_READY_FOR_RISK": False,
    "OPPORTUNITY_AUTHORIZED": False,
    "OPPORTUNITY_INVALIDATED": False,
}

CATEGORIES = {
    "CHANNEL_BREAK_APPROACH": "MARKET_STRUCTURE",
    "CHANNEL_BREAK_DETECTED": "MARKET_STRUCTURE",
    "CHANNEL_BREAK_CONFIRMED": "MARKET_STRUCTURE",
    "CHANNEL_BREAK_FAILED": "MARKET_STRUCTURE",
    "CHANNEL_RETEST_STARTED": "MARKET_STRUCTURE",
    "CHANNEL_RETEST_HELD": "MARKET_STRUCTURE",
    "CHANNEL_RETEST_FAILED": "MARKET_STRUCTURE",
    "CHANNEL_BREAK_CONTINUATION": "MARKET_STRUCTURE",
    "P1_ZONE_REACHED": "TRADE_OPPORTUNITY",
    "P1_REACTION_DETECTED": "TRADE_OPPORTUNITY",
    "P1_READY_FOR_RISK": "TRADE_OPPORTUNITY",
    "P2_BREAK_DETECTED": "TRADE_OPPORTUNITY",
    "P2_WAIT_RETEST": "TRADE_OPPORTUNITY",
    "P2_READY_FOR_RISK": "TRADE_OPPORTUNITY",
    "P1_AUTHORIZED": "TRADE_OPPORTUNITY",
    "P2_AUTHORIZED": "TRADE_OPPORTUNITY",
    "OPPORTUNITY_DISCOVERED": "TRADE_OPPORTUNITY",
    "OPPORTUNITY_CONFIRMING": "TRADE_OPPORTUNITY",
    "OPPORTUNITY_READY_FOR_RISK": "TRADE_OPPORTUNITY",
    "OPPORTUNITY_AUTHORIZED": "TRADE_OPPORTUNITY",
    "OPPORTUNITY_INVALIDATED": "TRADE_OPPORTUNITY",
    "ORDER_SUBMITTED": "TRADE_EXECUTION",
    "ORDER_FILLED": "TRADE_EXECUTION",
    "ORDER_PARTIALLY_FILLED": "TRADE_EXECUTION",
    "ORDER_REJECTED": "TRADE_EXECUTION",
    "POSITION_OPENED": "TRADE_EXECUTION",
    "POSITION_CLOSED": "TRADE_EXECUTION",
    "STOP_LOSS_TRIGGERED": "TRADE_EXECUTION",
    "TAKE_PROFIT_TRIGGERED": "TRADE_EXECUTION",
    "MT5_DISCONNECTED": "SYSTEM",
    "MT5_RECONNECTED": "SYSTEM",
    "MARKET_DATA_STALE": "SYSTEM",
    "CALENDAR_FEED_STALE": "SYSTEM",
    "ECONOMIC_EVENT_LOCK": "SYSTEM",
    "SMTP_DEGRADED": "SYSTEM",
    "SYSTEM_EMERGENCY_STOP": "SYSTEM",
    "NOTIFICATION_TEST": "SYSTEM",
}


def valid_email(value: str) -> bool:
    return bool(EMAIL_RE.match((value or "").strip()))


def allows(event_type: str, symbol: str | None, settings: dict[str, Any], freshness: str | None = None) -> tuple[bool, str]:
    """Return whether this transition should be queued. A disabled policy is not an error."""
    if event_type == "NOTIFICATION_TEST":
        return True, "TEST"
    if not settings.get("masterEnabled", True):
        return False, "MASTER_OFF"
    policies = settings.get("policies") or {}
    if not policies.get(event_type, DEFAULT_POLICIES.get(event_type, False)):
        return False, "EVENT_OFF"
    if symbol:
        metal = symbol.upper().startswith("XAU")
        if metal and not settings.get("xauEnabled", True):
            return False, "XAU_OFF"
        if not metal and not settings.get("fxEnabled", True):
            return False, "FX_OFF"
    if event_type in FRESH_REQUIRED and str(freshness or "CURRENT").upper() == "STALE":
        return False, "STALE"
    return True, "MATCH"
