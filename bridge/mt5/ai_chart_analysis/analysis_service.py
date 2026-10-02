from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

try:
    import history_store
    from ai_chart_analysis import analysis_store
    from ai_chart_analysis.annotation_engine import build_annotations
    from ai_chart_analysis.context_engine import aggregate_direction, build_timeframe_strip
    from ai_chart_analysis.evidence_engine import build_evidence
    from ai_chart_analysis.models import AI_VERSION, ANALYSIS_MODES, ENGINE_VERSION, STRIP_TFS
    from ai_chart_analysis.contradiction_engine import detect_contradictions
    from ai_chart_analysis.data_quality import assess_data_quality
    from ai_chart_analysis.evidence_score import compute_evidence_score
    from ai_chart_analysis.narrative_engine import analysis_status, build_market_state
    from ai_chart_analysis.regime_classifier import classify_regime
    from ai_chart_analysis.scenario_engine import build_scenarios
    from ai_chart_analysis.thesis_builder import build_thesis_narrative, build_thesis_title
    from ai_chart_analysis.timeframe_state_builder import build_timeframe_states
    from ai_chart_analysis.tradability_assessment import analytical_tradability_label
    from ai_chart_analysis.reconciliation_engine import reconcile
    from ai_chart_analysis.parent_child_engine import build_parent_child_hierarchy
    from ai_chart_analysis.tradability_engine import build_tradability_chain
    from ai_chart_analysis.analysis_mode import apply_analysis_mode
    from ai_chart_analysis.chart_builder import build_chart_payload
    from ai_chart_analysis.chart_model import build_chart_view
except ImportError:  # pragma: no cover
    from bridge.mt5 import history_store  # type: ignore
    from bridge.mt5.ai_chart_analysis import analysis_store  # type: ignore
    from bridge.mt5.ai_chart_analysis.annotation_engine import build_annotations  # type: ignore
    from bridge.mt5.ai_chart_analysis.context_engine import aggregate_direction, build_timeframe_strip  # type: ignore
    from bridge.mt5.ai_chart_analysis.evidence_engine import build_evidence  # type: ignore
    from bridge.mt5.ai_chart_analysis.models import AI_VERSION, ANALYSIS_MODES, ENGINE_VERSION, STRIP_TFS  # type: ignore
    from bridge.mt5.ai_chart_analysis.contradiction_engine import detect_contradictions  # type: ignore
    from bridge.mt5.ai_chart_analysis.data_quality import assess_data_quality  # type: ignore
    from bridge.mt5.ai_chart_analysis.evidence_score import compute_evidence_score  # type: ignore
    from bridge.mt5.ai_chart_analysis.narrative_engine import analysis_status, build_market_state  # type: ignore
    from bridge.mt5.ai_chart_analysis.regime_classifier import classify_regime  # type: ignore
    from bridge.mt5.ai_chart_analysis.scenario_engine import build_scenarios  # type: ignore
    from bridge.mt5.ai_chart_analysis.thesis_builder import build_thesis_narrative, build_thesis_title  # type: ignore
    from bridge.mt5.ai_chart_analysis.timeframe_state_builder import build_timeframe_states  # type: ignore
    from bridge.mt5.ai_chart_analysis.tradability_assessment import analytical_tradability_label  # type: ignore
    from bridge.mt5.ai_chart_analysis.reconciliation_engine import reconcile  # type: ignore
    from bridge.mt5.ai_chart_analysis.parent_child_engine import build_parent_child_hierarchy  # type: ignore
    from bridge.mt5.ai_chart_analysis.tradability_engine import build_tradability_chain  # type: ignore
    from bridge.mt5.ai_chart_analysis.analysis_mode import apply_analysis_mode  # type: ignore
    from bridge.mt5.ai_chart_analysis.chart_builder import build_chart_payload  # type: ignore
    from bridge.mt5.ai_chart_analysis.chart_model import build_chart_view  # type: ignore


def _pick_framework_hypothesis(symbol: str, framework: dict[str, Any] | None) -> dict[str, Any] | None:
    if not framework:
        return None
    hypos = [h for h in framework.get("hypotheses") or [] if (h.get("symbol") or "").upper() == symbol.upper()]
    if not hypos:
        return None
    mode_rank = {"PRODUCTION": 0, "SHADOW": 1, "OBSERVE": 2}
    lc_rank = {"AUTHORIZED": 0, "READY_FOR_RISK": 1, "CONFIRMING": 2, "WATCHING": 3}

    def key(h: dict[str, Any]) -> tuple:
        return (mode_rank.get(h.get("mode") or "OBSERVE", 9), lc_rank.get(h.get("lifecycle") or "WATCHING", 9))

    hypos.sort(key=key)
    best = hypos[0]
    satisfied = [{"text": x, "type": "EVIDENCE"} if isinstance(x, str) else x for x in (best.get("satisfiedEvidence") or best.get("satisfied") or [])]
    missing = [{"text": x, "type": "EVIDENCE"} if isinstance(x, str) else x for x in (best.get("missingEvidence") or best.get("missing") or [])]
    return {**best, "satisfied": satisfied, "missing": missing, "conflicts": []}


def _pick_opportunity_row(symbol: str, opportunity_snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    if not opportunity_snapshot:
        return None
    for row in opportunity_snapshot.get("instruments") or []:
        if (row.get("symbol") or "").upper() == symbol.upper():
            return row
    return None


def _m5_meta(symbol: str) -> dict[str, Any]:
    try:
        bars = history_store.candle_tail(symbol, "M5", 120)
    except Exception:
        bars = []
    if not bars:
        return {"bars": 0}
    last = bars[-1]
    return {"lastClosedTs": int(last[0]) * 1000, "bars": len(bars)}


def _opportunity_detail(fw_h: dict[str, Any] | None, opp_row: dict[str, Any] | None) -> dict[str, Any]:
    if not fw_h and not opp_row:
        return {"available": False}
    h = fw_h or {}
    row = opp_row or {}
    return {
        "available": True,
        "opportunityId": h.get("opportunityId") or h.get("id") or row.get("id"),
        "opportunityType": h.get("opportunityType") or h.get("opportunity_type") or row.get("type"),
        "direction": h.get("direction") or row.get("direction"),
        "originTimeframe": h.get("originTimeframe") or row.get("timeframe") or "H1",
        "lifecycle": h.get("lifecycle") or row.get("lifecycle"),
        "zone": h.get("zoneLabel") or row.get("zone"),
        "distanceToZone": row.get("distanceToZone") or row.get("distance"),
        "reactionState": (row.get("p1") or {}).get("state"),
        "breakState": (row.get("p2") or {}).get("state"),
        "retestState": row.get("retestState"),
        "invalidation": h.get("invalidation") or row.get("invalidation"),
        "blockingRequirements": h.get("missing") or [],
    }


def _engine_snapshot(
    strip: list[dict[str, Any]],
    fw_h: dict[str, Any] | None,
    opp_row: dict[str, Any] | None,
    confirm: dict[str, Any] | None,
    reconciliation: dict[str, Any],
    supporting: list[dict[str, Any]],
    missing: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    inst = (confirm or {}).get("instrument") if confirm else None
    h1 = next((r for r in strip if r["timeframe"] == "H1"), None)
    d1 = next((r for r in strip if r["timeframe"] == "D1"), None)

    def _hl(source: str, limit: int = 4) -> list[str]:
        out: list[str] = []
        for e in supporting + missing:
            src = (e.get("source") or "").lower()
            if source.lower() not in src and source.lower() not in (e.get("text") or "").lower():
                continue
            t = (e.get("text") or "").strip()
            if t and t not in out:
                out.append(t[:120])
            if len(out) >= limit:
                break
        return out

    rows = [
        {
            "engine": "Channel",
            "summary": f"H1 {h1.get('structure') if h1 else '—'} / {h1.get('channelState') if h1 else '—'}",
            "agreement": reconciliation.get("agreement"),
            "highlights": _hl("Channel") or [f"D1 {d1.get('structure') if d1 else '—'}"],
        },
        {
            "engine": "Supertrend",
            "summary": f"H1 ST {h1.get('supertrend') if h1 else '—'} · D1 {d1.get('supertrend') if d1 else '—'}",
            "agreement": reconciliation.get("agreement"),
            "highlights": [f"{r['timeframe']} ST {r.get('supertrend')}" for r in strip if r.get("supertrend")][:5],
        },
        {
            "engine": "Opportunity Framework",
            "summary": (fw_h or {}).get("lifecycle") or "No hypothesis",
            "agreement": reconciliation.get("agreement"),
            "highlights": _hl("Opportunity") or _hl("Framework") or [(fw_h or {}).get("opportunityType") or "—"],
        },
        {
            "engine": "P1 / P2",
            "summary": f"{(opp_row or {}).get('p1', {}).get('state', '—')} / {(opp_row or {}).get('p2', {}).get('state', '—')}",
            "agreement": reconciliation.get("agreement"),
            "highlights": [
                x
                for x in [
                    f"P1 {(opp_row or {}).get('p1', {}).get('state')}",
                    f"P2 {(opp_row or {}).get('p2', {}).get('state')}",
                    (opp_row or {}).get("zone"),
                ]
                if x and "None" not in str(x)
            ],
        },
        {
            "engine": "ConfirmationEngine",
            "summary": f"Stage 7 {(inst or {}).get('status', '—')}",
            "agreement": reconciliation.get("agreement"),
            "highlights": _hl("Confirmation") or _hl("Stage") or [(inst or {}).get("detail") or "—"],
        },
    ]
    return rows


def _float_or_none(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _level_hints(
    annotations: list[dict[str, Any]],
    channels: dict[str, Any],
    primary_tf: str,
    opp_row: dict[str, Any] | None,
    fw_h: dict[str, Any] | None = None,
    direction: str = "NEUTRAL",
) -> dict[str, Any]:
    inv_ann = next((a.get("price") for a in annotations if a.get("type") == "INVALIDATION"), None)
    ch = channels.get(primary_tf) or channels.get("H1") or {}
    t1 = ch.get("target1") or ch.get("t1") or (ch.get("targets") or {}).get("t1")
    t2 = ch.get("target2") or ch.get("t2") or (ch.get("targets") or {}).get("t2")
    erz = ch.get("erz") or ch.get("entryZone")
    erz_lo = erz_hi = erz_mid = None
    if isinstance(erz, dict):
        erz_lo = _float_or_none(erz.get("lower") or erz.get("zoneLow"))
        erz_hi = _float_or_none(erz.get("upper") or erz.get("zoneHigh"))
        erz_mid = _float_or_none(erz.get("mid") or erz.get("lower"))
    if erz_lo is None or erz_hi is None:
        fw_erz = ((fw_h or {}).get("detail") or {}).get("erz") or {}
        if isinstance(fw_erz, dict):
            erz_lo = erz_lo or _float_or_none(fw_erz.get("zoneLow"))
            erz_hi = erz_hi or _float_or_none(fw_erz.get("zoneHigh"))
    if erz_mid is None:
        erz_ann = next((a.get("price") for a in annotations if a.get("type") == "ERZ"), None)
        erz_mid = _float_or_none(erz_ann)
    if erz_mid is None and erz_lo is not None and erz_hi is not None:
        erz_mid = (erz_lo + erz_hi) / 2

    upper = _float_or_none(ch.get("upperBoundary"))
    lower = _float_or_none(ch.get("lowerBoundary"))
    mid = _float_or_none(ch.get("midline"))
    width = abs(upper - lower) if upper is not None and lower is not None else None
    band = max(width * 0.08, abs(mid or upper or lower or 1) * 0.001) if width else None

    supply_upper = supply_lower = None
    if upper is not None and band is not None:
        supply_upper = upper + band * 0.12
        supply_lower = upper - band * 2.4

    if (erz_lo is None or erz_hi is None) and lower is not None and band is not None:
        erz_hi = erz_hi if erz_hi is not None else lower + band * 1.6
        erz_lo = erz_lo if erz_lo is not None else lower - band * 0.55
        if erz_mid is None:
            erz_mid = (erz_hi + erz_lo) / 2

    room = (fw_h or {}).get("room") or {}
    inv = _float_or_none(inv_ann) or _float_or_none(ch.get("invalidation") or (ch.get("risk") or {}).get("invalidation"))
    inv = inv or _float_or_none(room.get("invalidation")) or _float_or_none((fw_h or {}).get("invalidation"))

    t1 = _float_or_none(t1) or _float_or_none(room.get("target")) or _float_or_none((fw_h or {}).get("targetPrice"))
    t2 = _float_or_none(t2)
    d = (direction or "NEUTRAL").upper()
    if t2 is None and t1 is not None and upper is not None and lower is not None:
        if d == "BULLISH":
            t2 = t1 + max(abs(upper - t1) * 0.55, band or 0)
        elif d == "BEARISH":
            t2 = t1 - max(abs(t1 - lower) * 0.55, band or 0)
    if t1 is None and upper is not None and lower is not None and mid is not None:
        if d == "BULLISH":
            t1 = upper
            t2 = t2 or upper + (width or 0) * 0.35
        elif d == "BEARISH":
            t1 = lower
            t2 = t2 or lower - (width or 0) * 0.35

    p2_row = (opp_row or {}).get("p2") or {}
    p2_lvl = _float_or_none(p2_row.get("level") or p2_row.get("trigger") or p2_row.get("breakLevel"))
    if p2_lvl is None and mid is not None and erz_mid is not None:
        p2_lvl = (mid + erz_mid) / 2 if d == "BULLISH" else (mid + (upper or mid)) / 2

    return {
        "invalidation": inv,
        "t1": t1,
        "t2": t2,
        "erzMid": erz_mid,
        "erzLower": erz_lo,
        "erzUpper": erz_hi,
        "supplyUpper": supply_upper,
        "supplyLower": supply_lower,
        "p2": p2_lvl,
    }


def run_analysis(
    symbol: str,
    *,
    mode: str = "FULL_ANALYSIS",
    primary_tf: str = "H1",
    lookback: int = 80,
    persist: bool = False,
    sources: dict[str, Any],
    data_mode: str = "LIVE",
) -> dict[str, Any]:
    """Build structured AI chart analysis from authoritative engine outputs (no duplicate calculations)."""
    symbol = symbol.upper()
    mode = mode if mode in ANALYSIS_MODES else "FULL_ANALYSIS"
    primary_tf = primary_tf if primary_tf in STRIP_TFS else "H1"

    channel_resp = sources.get("channel") or {}
    if not channel_resp.get("ok"):
        return {
            "ok": False,
            "code": "NO_MARKET_DATA",
            "message": channel_resp.get("message") or "Channel snapshot unavailable",
            "symbol": symbol,
        }

    selected = channel_resp.get("selected") or {}
    channels = selected.get("channels") or {}
    interpretation = selected.get("interpretation") or {}
    supertrend = sources.get("supertrend")
    confirm = sources.get("confirm")
    framework = sources.get("framework")
    opp_snap = sources.get("opportunity")

    m5 = _m5_meta(symbol)
    strip = build_timeframe_strip(channels, supertrend, interpretation, m5)
    hierarchy = build_parent_child_hierarchy(strip, channels)
    direction = aggregate_direction(strip)
    market_state = build_market_state(strip)
    fw_h = _pick_framework_hypothesis(symbol, framework)
    opp_row = _pick_opportunity_row(symbol, opp_snap)

    supporting, conflicting, missing = build_evidence(strip, channels, fw_h, confirm, opp_row)
    opportunity_type = (fw_h or {}).get("opportunityType") or (fw_h or {}).get("opportunity_type")
    p1_state = (opp_row.get("p1") or {}).get("state") if opp_row else None
    p2_state = (opp_row.get("p2") or {}).get("state") if opp_row else None

    tradable = bool(
        opp_row
        and opp_row.get("actionable")
        and p2_state == "P2_READY_FOR_RISK"
        and (fw_h or {}).get("lifecycle") in ("READY_FOR_RISK", "AUTHORIZED")
    )
    execution_authorized = False

    annotations = build_annotations(channels, primary_tf, direction)
    status = analysis_status(tradable, fw_h, missing)
    confidence, score_components = compute_evidence_score(strip, supporting, conflicting, missing, hierarchy)
    thesis_title = build_thesis_title(direction, market_state, opportunity_type)
    thesis = build_thesis_narrative(symbol, strip, direction, market_state, tradable, hierarchy)
    tradability = build_tradability_chain(strip, supporting, missing, tradable, opp_row, confirm)
    reconciliation = reconcile(thesis, fw_h, opp_row, confirm, tradable)
    tf_states = build_timeframe_states(strip, channels, opp_row=opp_row, confirm=confirm)
    regime = classify_regime(strip, channels)
    contradictions = detect_contradictions(strip, hierarchy, supporting, conflicting)
    level_hints = _level_hints(annotations, channels, primary_tf, opp_row, fw_h=fw_h, direction=direction)
    scenarios = build_scenarios(
        direction,
        market_state,
        invalidation=level_hints["invalidation"],
        t1=level_hints["t1"],
        t2=level_hints["t2"],
        tradable=tradable,
        missing=missing,
    )
    data_quality = assess_data_quality(strip, channel_resp)
    tradability_label = analytical_tradability_label(tradable, status, missing)

    mode_pack = apply_analysis_mode(
        mode,
        supporting=supporting,
        conflicting=conflicting,
        missing=missing,
        annotations=annotations,
        tradability=tradability,
        thesis=thesis,
    )
    supporting = mode_pack["supporting"]
    conflicting = mode_pack["conflicting"]
    missing = mode_pack["missing"]
    annotations = mode_pack["annotations"]
    tradability = mode_pack["tradability"]
    thesis = mode_pack["thesis"]

    last_closed = {}
    for row in strip:
        if row.get("lastClosedCandleMs"):
            last_closed[row["timeframe"]] = row["lastClosedCandleMs"]

    now_ms = int(time.time() * 1000)
    analysis_id = analysis_store.next_analysis_id(symbol) if persist else f"ACA-{symbol}-EPHEMERAL"

    payload: dict[str, Any] = {
        "ok": True,
        "symbol": symbol,
        "analysisId": analysis_id,
        "analysisTimestamp": datetime.now(timezone.utc).isoformat(),
        "analysisMode": mode,
        "primaryTimeframe": primary_tf,
        "lookback": lookback,
        "status": status,
        "direction": direction,
        "marketState": market_state,
        "structure": next((r["structure"] for r in strip if r["timeframe"] == "H1"), "UNKNOWN"),
        "opportunity": opportunity_type,
        "confidence": confidence,
        "evidenceScoreComponents": score_components,
        "thesisTitle": thesis_title,
        "tradable": tradable,
        "analyticalTradability": tradability_label,
        "executionAuthorized": execution_authorized,
        "p1State": p1_state,
        "p2State": p2_state,
        "engineVersion": ENGINE_VERSION,
        "aiVersion": AI_VERSION,
        "opportunityVersion": (framework or {}).get("version"),
        "dataMode": data_mode,
        "lastClosedCandle": last_closed,
        "timeframeStrip": strip,
        "hierarchy": hierarchy,
        "timeframeStates": tf_states,
        "regime": regime,
        "contradictions": contradictions,
        "dataQuality": data_quality,
        "supportingEvidence": supporting,
        "conflictingEvidence": conflicting,
        "missingEvidence": missing,
        "thesis": thesis,
        "modeFocus": mode_pack["modeFocus"],
        "annotations": annotations,
        "tradabilityChain": tradability,
        "reconciliation": reconciliation,
        "scenarios": scenarios,
        "chartLevels": level_hints,
        "opportunityDetail": _opportunity_detail(fw_h, opp_row),
        "engines": _engine_snapshot(strip, fw_h, opp_row, confirm, reconciliation, supporting, missing),
        "htf": "D1",
        "setupTimeframe": "H1",
        "entryTimeframe": (fw_h or {}).get("executionTimeframe") or "M15",
        "marketDataStatus": selected.get("sourceHealth") or channel_resp.get("health"),
        "channelRunId": selected.get("runId"),
        "timeline": [{"timestamp": datetime.now(timezone.utc).isoformat(), "kind": "ANALYSIS_BUILT", "detail": f"{mode} analysis refreshed"}],
        "frameworkHypothesisId": (fw_h or {}).get("opportunityId") or (fw_h or {}).get("id"),
        "generatedAtMs": now_ms,
    }

    shared_candles = (selected.get("sharedCandles") or {}) if isinstance(selected, dict) else {}
    chart_snap = build_chart_payload(
        channels,
        primary_tf,
        supertrend,
        lookback=lookback,
        shared_candles=shared_candles,
    )
    payload["chart"] = chart_snap
    payload["chartView"] = build_chart_view(
        symbol=symbol,
        primary_tf=primary_tf,
        direction=direction,
        chart_snap=chart_snap,
        annotations=annotations,
        level_hints=level_hints,
        scenarios=scenarios,
    )
    if persist:
        analysis_store.save_run(payload, chart_snap)
        payload["persisted"] = True

    return payload
