from __future__ import annotations

from typing import Any


def build_thesis(
    symbol: str,
    strip: list[dict[str, Any]],
    direction: str,
    market_state: str,
    tradable: bool,
    opportunity_type: str | None,
) -> str:
    d1 = next((r for r in strip if r["timeframe"] == "D1"), None)
    h8 = next((r for r in strip if r["timeframe"] == "H8"), None)
    h1 = next((r for r in strip if r["timeframe"] == "H1"), None)
    lines = [f"{symbol}", f"{direction} {market_state.replace('_', ' ').title()}"]
    if opportunity_type:
        lines[0] = f"{symbol} — {opportunity_type}"
    if d1 and h8:
        lines.append(f"D1 and H8 remain structurally {d1.get('direction', 'unknown').lower()}.")
    if h1:
        ms = h1.get("marketState", "")
        if ms in ("PULLBACK", "CORRECTION", "COUNTER_CORRECTION"):
            lines.append(
                f"H1 is undergoing a counter-trend pullback ({h1.get('direction', '').lower()}) "
                f"toward active channel / ERZ region."
            )
        else:
            lines.append(f"H1 market state: {ms.replace('_', ' ').lower()}.")
    lines.append("M15 structural confirmation is still absent." if not tradable else "Deterministic gates satisfied for tradability review.")
    lines.append(
        "The continuation thesis remains valid, but the setup is not yet tradable."
        if not tradable and direction in ("BULLISH", "BEARISH")
        else "Awaiting deterministic confirmation before execution authorization."
        if not tradable
        else "Setup meets analytical tradability chain; Stage 8 authorization still required."
    )
    return "\n\n".join(lines)


def build_market_state(strip: list[dict[str, Any]]) -> str:
    h1 = next((r for r in strip if r["timeframe"] == "H1"), None)
    if h1:
        ms = (h1.get("marketState") or "").upper()
        mapping = {
            "TRENDING": "TRENDING",
            "PULLBACK": "PULLBACK",
            "CORRECTION": "PULLBACK",
            "COUNTER_CORRECTION": "PULLBACK",
            "RETEST": "RETEST",
            "BREAKOUT_DEVELOPING": "BREAKOUT_DEVELOPING",
            "BREAKOUT": "BREAKOUT_CONFIRMED",
            "REVERSAL_CANDIDATE": "REVERSAL_DEVELOPING",
        }
        if ms in mapping:
            return mapping[ms]
    d1 = next((r for r in strip if r["timeframe"] == "D1"), None)
    if d1 and d1.get("channelState") == "RETESTING":
        return "RETEST"
    return "UNCLEAR"


def analysis_status(tradable: bool, framework_hypothesis: dict[str, Any] | None, missing: list[dict[str, Any]]) -> str:
    if framework_hypothesis:
        lc = (framework_hypothesis.get("lifecycle") or "").upper()
        if lc == "CONFIRMED":
            return "CONFIRMED"
        if lc in ("READY_FOR_RISK", "AUTHORIZED"):
            return "NEAR_CONFIRMATION"
        if lc in ("CONFIRMING", "WATCHING"):
            return "SETUP_DEVELOPING" if missing else "CONFIRMATION_PENDING"
        if lc in ("INVALIDATED", "EXPIRED", "COMPLETED"):
            return lc
    if tradable:
        return "NEAR_CONFIRMATION"
    if missing:
        return "SETUP_DEVELOPING"
    return "WATCHING" if framework_hypothesis else "NO_OPPORTUNITY"
