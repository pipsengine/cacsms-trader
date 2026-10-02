from __future__ import annotations

from typing import Any


def closed_bar_changes(
    previous: dict[str, Any] | None,
    current: dict[str, Any] | None,
) -> list[str]:
    """Return timeframe keys whose last closed bar timestamp advanced."""
    if not current:
        return []
    prev = previous or {}
    changed: list[str] = []
    for tf, ts in current.items():
        if not isinstance(ts, (int, float)):
            continue
        old = prev.get(tf)
        if old is None or int(ts) > int(old):
            changed.append(str(tf))
    return changed


def should_refresh_analysis(
    *,
    previous_last_closed: dict[str, Any] | None,
    current_last_closed: dict[str, Any] | None,
    previous_analysis_ms: int | None = None,
    now_ms: int | None = None,
    min_interval_ms: int = 5_000,
    entry_timeframes: tuple[str, ...] = ("M15", "M5", "H1"),
) -> tuple[bool, str]:
    """
    Incremental refresh policy: prefer closed-bar advances on entry/setup TFs,
    with a minimum spacing guard for poll loops.
    """
    now = int(now_ms or 0)
    if previous_analysis_ms and now and now - previous_analysis_ms < min_interval_ms:
        return False, "THROTTLED"

    changed = closed_bar_changes(previous_last_closed, current_last_closed)
    if not changed:
        return False, "NO_BAR_CHANGE"

    priority = [tf for tf in entry_timeframes if tf in changed]
    if priority:
        return True, f"CLOSED_BAR:{','.join(priority)}"
    return True, f"CLOSED_BAR:{','.join(changed[:3])}"
