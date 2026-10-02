from __future__ import annotations

from typing import Any


def _closed_events(ch: dict[str, Any]) -> list[dict[str, Any]]:
    events = (ch.get("evidence") or {}).get("events") or []
    out: list[dict[str, Any]] = []
    for ev in events:
        status = (ev.get("status") or "CONFIRMED").upper()
        if status == "INVALIDATED":
            continue
        out.append(ev)
    return out


def build_evidence(
    strip: list[dict[str, Any]],
    channels: dict[str, Any],
    framework_hypothesis: dict[str, Any] | None,
    confirm: dict[str, Any] | None,
    opportunity_row: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    supporting: list[dict[str, Any]] = []
    conflicting: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []

    for row in strip:
        tf = row["timeframe"]
        ch_key = row.get("sourceChannelTf")
        ch = channels.get(ch_key) if ch_key else None
        d = row.get("direction")
        if d in ("BULLISH", "BEARISH") and ch and ch.get("status") in ("ACTIVE", "VALIDATED", "RETESTING"):
            supporting.append(
                {
                    "text": f"{tf} {d.lower()} structure / channel",
                    "type": "STRUCTURE",
                    "timeframe": tf,
                    "source": "ChannelEngine",
                    "status": "OBSERVED",
                }
            )
        st = row.get("supertrend")
        if st in ("UP", "DOWN") and d in ("BULLISH", "BEARISH"):
            aligned = (st == "UP" and d == "BULLISH") or (st == "DOWN" and d == "BEARISH")
            bucket = supporting if aligned else conflicting
            bucket.append(
                {
                    "text": f"{tf} Supertrend {st} vs channel {d}",
                    "type": "SUPERTREND",
                    "timeframe": tf,
                    "source": "SupertrendEngine",
                    "status": "DETECTED" if aligned else "INTERPRETED",
                }
            )

    if framework_hypothesis:
        for item in framework_hypothesis.get("satisfied") or []:
            supporting.append({**item, "source": item.get("source") or "OpportunityFramework", "status": "CONFIRMED"})
        for item in framework_hypothesis.get("missing") or []:
            text = item.get("text") if isinstance(item, dict) else str(item)
            if text and "EXECUTION_CONFIRM" in text.upper():
                text = "Closed-bar execution confirmation (Stage 7 / entry refinement)"
            enriched = {**item, "source": item.get("source") or "OpportunityFramework", "status": "NOT_CONFIRMED"} if isinstance(item, dict) else {"text": text, "type": "CONFIRMATION", "source": "OpportunityFramework", "status": "NOT_CONFIRMED"}
            if isinstance(enriched, dict) and text:
                enriched["text"] = text
            missing.append(enriched)
        for item in framework_hypothesis.get("conflicts") or []:
            conflicting.append({**item, "source": item.get("source") or "OpportunityFramework", "status": "DETECTED"})

    inst = (confirm or {}).get("instrument") if confirm else None
    if inst:
        s7 = (inst.get("status") or "").upper()
        if s7 == "CONFIRMED":
            supporting.append(
                {
                    "text": "Stage 7 H1 structure confirmed (closed bar)",
                    "type": "CONFIRMATION",
                    "timeframe": "H1",
                    "source": "ConfirmationEngine",
                    "status": "CONFIRMED",
                }
            )
        elif s7 in ("INVALIDATED", "BLOCKED"):
            conflicting.append(
                {
                    "text": f"Stage 7 state: {s7}",
                    "type": "CONFIRMATION",
                    "timeframe": "H1",
                    "source": "ConfirmationEngine",
                    "status": "CONFIRMED",
                }
            )
        else:
            missing.append(
                {
                    "text": "Stage 7 closed-bar structural confirmation",
                    "type": "CONFIRMATION",
                    "timeframe": "H1",
                    "source": "ConfirmationEngine",
                    "status": "NOT_CONFIRMED",
                }
            )

    if opportunity_row:
        p2 = (opportunity_row.get("p2") or {}).get("state")
        if p2 in ("P2_WAITING_FOR_BREAK", "P2_WAIT_RETEST"):
            missing.append(
                {
                    "text": f"P2 lifecycle: {p2}",
                    "type": "P2",
                    "timeframe": opportunity_row.get("executionTimeframe") or "M15",
                    "source": "OpportunityFramework",
                    "status": "NOT_CONFIRMED",
                }
            )
        elif p2 == "P2_READY_FOR_RISK":
            supporting.append(
                {
                    "text": "P2 ready for risk (deterministic)",
                    "type": "P2",
                    "timeframe": opportunity_row.get("executionTimeframe") or "M15",
                    "source": "OpportunityFramework",
                    "status": "CONFIRMED",
                }
            )

    # Higher-TF vs entry-TF tension (contextual, not automatic conflict)
    trade_dir = next((r["direction"] for r in strip if r["timeframe"] == "D1"), "UNKNOWN")
    h1 = next((r for r in strip if r["timeframe"] == "H1"), None)
    m15 = next((r for r in strip if r["timeframe"] == "M15"), None)
    h1_ch = channels.get("H1")
    h1_rel = (h1_ch or {}).get("relationship") or ""
    if trade_dir in ("BULLISH", "BEARISH") and h1 and h1["direction"] not in (trade_dir, "UNKNOWN", "NEUTRAL"):
        if (h1.get("marketState") or "").upper() in ("PULLBACK", "CORRECTION", "COUNTER_CORRECTION") or h1_rel in (
            "CORRECTIVE",
            "COUNTER_CORRECTION",
            "NESTED_CORRECTION",
        ):
            supporting.append(
                {
                    "text": f"H1 {h1['direction'].lower()} pullback inside {trade_dir.lower()} D1 structure",
                    "type": "CONTEXT",
                    "timeframe": "H1",
                    "source": "AIInterpreter",
                    "status": "INTERPRETED",
                }
            )
        else:
            conflicting.append(
                {
                    "text": f"H1 direction {h1['direction']} vs D1 {trade_dir}",
                    "type": "CONTEXT",
                    "timeframe": "H1",
                    "source": "AIInterpreter",
                    "status": "INTERPRETED",
                }
            )
    if m15 and trade_dir in ("BULLISH", "BEARISH") and m15["direction"] not in (trade_dir, "UNKNOWN", "NEUTRAL"):
        conflicting.append(
            {
                "text": f"M15 remains structurally {m15['direction'].lower()}",
                "type": "STRUCTURE",
                "timeframe": "M15",
                "source": "ChannelEngine",
                "status": "OBSERVED",
            }
        )
        missing.append(
            {
                "text": f"M15 bullish BOS" if trade_dir == "BULLISH" else "M15 bearish BOS",
                "type": "BOS",
                "timeframe": "M15",
                "source": "ConfirmationEngine",
                "status": "NOT_CONFIRMED",
            }
        )

    # One synthesized structural line per primary TF (not every raw BOS/CHoCH event).
    for tf_key in ("YTD", "Q", "MN", "W", "D1", "H8", "H1"):
        ch = channels.get(tf_key)
        if not ch:
            continue
        events = [e for e in _closed_events(ch) if (e.get("kind") or "").upper() in ("BOS", "CHOCH")]
        if not events:
            continue
        last = events[-1]
        kind = (last.get("kind") or "").upper()
        direction = last.get("direction") or ch.get("direction") or "UNKNOWN"
        supporting.append(
            {
                "text": f"{tf_key} structure: {str(direction).lower()} regime; latest {kind} on closed bar",
                "type": "STRUCTURE_SYNTH",
                "timeframe": tf_key,
                "source": "ChannelEngine",
                "candleTimestamp": last.get("time"),
                "status": "CONFIRMED",
                "rawCount": len(events),
            }
        )

    supporting = _cap_dedupe(supporting, 8)
    conflicting = _cap_dedupe(conflicting, 5)
    missing = _cap_dedupe(missing, 5)
    return supporting, conflicting, missing


def _cap_dedupe(rows: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in rows:
        key = f"{row.get('type')}|{row.get('timeframe')}|{(row.get('text') or '')[:80]}"
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
        if len(out) >= limit:
            break
    return out
