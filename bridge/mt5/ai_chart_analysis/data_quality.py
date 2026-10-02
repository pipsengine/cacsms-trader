from __future__ import annotations

from typing import Any


def assess_data_quality(strip: list[dict[str, Any]], channel_resp: dict[str, Any]) -> str:
    if not channel_resp.get("ok"):
        return "INVALID"
    health = str(channel_resp.get("health") or channel_resp.get("selected", {}).get("sourceHealth") or "").upper()
    if health in ("STALE", "DEGRADED"):
        return "STALE"
    valid_tfs = sum(1 for r in strip if r.get("direction") not in (None, "UNKNOWN") or r.get("confidence", 0) > 0)
    if valid_tfs < 3:
        return "INSUFFICIENT"
    if valid_tfs < len(strip):
        return "PARTIAL"
    return "VALID"
