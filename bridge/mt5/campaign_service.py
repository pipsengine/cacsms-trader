"""Publish campaign handoffs for Stage 8. The browser is not required. Orders stay with Stage 9."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

try:
    import campaign
    import confirm_engine
    import opportunity_service
except ImportError:  # pragma: no cover
    from bridge.mt5 import campaign  # type: ignore
    from bridge.mt5 import confirm_engine  # type: ignore
    from bridge.mt5 import opportunity_service  # type: ignore

try:
    import history_store as hs
except ImportError:  # pragma: no cover
    from bridge.mt5 import history_store as hs  # type: ignore

_STATE: dict[str, Any] = {"handoffs": [], "diagnostics": [], "book": campaign.new_book(), "journal": []}


def snapshot() -> dict[str, Any]:
    return {
        "handoffs": len(_STATE["handoffs"]),
        "executable": sum(1 for h in _STATE["handoffs"] if h.get("executable")),
        "diagnostics": _STATE["diagnostics"][:40],
        "book": _STATE["book"],
        "journal": len(_STATE["journal"]),
    }


def pending_handoffs() -> list[dict[str, Any]]:
    """Confirmed campaign legs only. A watching hypothesis is not a handoff."""
    try:
        qualified = (opportunity_service.current().get("qualified") or [])[:12]
    except Exception:
        return []
    handoffs: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    for hypothesis in qualified:
        tf = str(hypothesis.get("executionTimeframe") or "H1")
        symbol = str(hypothesis.get("instrument") or "")
        try:
            bars = hs.candle_tail(symbol, tf, 400)
            confirmation = confirm_engine.ConfirmationEngine(tf).evaluate(
                symbol, bars, str(hypothesis.get("direction") or ""),
                parent={"timeframe": hypothesis.get("parentTimeframe"), "direction": hypothesis.get("parentDirection"),
                        "position": hypothesis.get("parentChannelPosition"), "confidence": hypothesis.get("confidence")},
                child={"timeframe": hypothesis.get("childTimeframe"), "direction": hypothesis.get("childDirection"),
                       "position": hypothesis.get("childChannelPosition")},
            )
        except Exception as exc:
            diagnostics.append({"instrument": symbol, "blocker": "STALE_DATA", "reason": str(exc)})
            continue
        if confirmation.get("lastTs"):
            confirmation["confirmedSince"] = datetime.fromtimestamp(int(confirmation["lastTs"]), tz=timezone.utc).isoformat()
        planned = campaign.plan(hypothesis, confirmation)
        diagnostics.append({"instrument": symbol, "family": hypothesis.get("opportunityFamily"), "TiTLevel": hypothesis.get("TiTLevel"),
                            "blocker": planned.get("blocker"), "executable": planned.get("executable"), "reason": planned.get("reason")})
        handoffs.extend(planned["handoffs"])
    _STATE["handoffs"] = handoffs
    _STATE["diagnostics"] = diagnostics
    return handoffs
