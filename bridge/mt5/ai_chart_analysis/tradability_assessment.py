from __future__ import annotations

from typing import Any


def analytical_tradability_label(tradable: bool, status: str, missing: list[dict[str, Any]]) -> str:
    if tradable:
        return "ANALYTICALLY_TRADABLE"
    st = (status or "").upper()
    if st in ("CONFIRMED", "NEAR_CONFIRMATION"):
        return "NEAR_CONFIRMATION"
    if st == "CONFIRMATION_PENDING":
        return "CONFIRMATION_PENDING"
    if st == "SETUP_DEVELOPING" or missing:
        return "DEVELOPING"
    if st == "WATCHING":
        return "WATCHING"
    return "NOT_TRADABLE"
