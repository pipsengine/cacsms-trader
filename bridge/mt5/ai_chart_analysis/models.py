from __future__ import annotations

ENGINE_VERSION = "ai-chart-analysis/1.0.0"
AI_VERSION = "interpreter/1.0.0"

STRIP_TFS: tuple[str, ...] = ("YTD", "Q", "MN", "W", "D1", "H8", "H1", "M15", "M5")
STRATEGIC_TFS = frozenset({"YTD", "Q", "MN", "W"})
TRADING_TFS = frozenset({"D1", "H8", "H1"})
ENTRY_TFS = frozenset({"M15", "M5"})

ANALYSIS_MODES: tuple[str, ...] = (
    "FULL_ANALYSIS",
    "STRUCTURE",
    "OPPORTUNITY",
    "CONFIRMATION",
    "CONTINUATION",
    "BREAKOUT",
    "REVERSAL",
)

LIFECYCLE_STATUSES = (
    "NO_OPPORTUNITY",
    "WATCHING",
    "SETUP_DEVELOPING",
    "NEAR_CONFIRMATION",
    "CONFIRMATION_PENDING",
    "CONFIRMED",
    "INVALIDATED",
    "EXPIRED",
    "COMPLETED",
)

CHANNEL_TO_STRIP = {
    "Y": "YTD",
    "YTD": "YTD",
    "Q": "Q",
    "MN": "MN",
    "W": "W",
    "D1": "D1",
    "H8": "H8",
    "H1": "H1",
}

ST_TO_STRIP = {"Y": "YTD", "Q": "Q", "MN": "MN", "W": "W", "D": "D1", "H8": "H8", "H1": "H1", "M15": "M15"}

TRADABILITY_STAGES: tuple[str, ...] = (
    "MACRO_CONTEXT",
    "PRIMARY_STRUCTURE",
    "TRADING_DIRECTION",
    "LOCATION",
    "REACTION",
    "STRUCTURAL_CONFIRMATION",
    "RETEST",
    "ENTRY_REFINEMENT",
    "RISK_VALIDATION",
    "TRADABLE",
)
