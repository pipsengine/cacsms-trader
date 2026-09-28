"""Stage 10 measurement. Outcomes are recorded beside process quality.

A profitable trade is not treated as a good decision, and a loss is not treated as a bad one.
Statistics are computed only from the records passed in. Small samples stay INSUFFICIENT_SAMPLE.
"""

from __future__ import annotations

import math
from typing import Any

SETUP_CLASSES = (
    "TREND_CONTINUATION",
    "COUNTER_TREND_CORRECTION",
    "BREAKOUT",
    "BREAKOUT_RETEST",
    "REVERSAL",
)
PRIMARY = {"TREND_CONTINUATION", "BREAKOUT", "BREAKOUT_RETEST"}
COUNTER = {"COUNTER_TREND_CORRECTION"}
MIN_SLICE = 8
MIN_STAT = 20
MIN_PROPOSAL = 20
MIN_OOS = 8
LIFECYCLE = ("OBSERVE", "MEASURE", "IDENTIFY", "PROPOSE", "BACKTEST", "VALIDATE", "SHADOW", "APPROVE", "MONITOR", "ROLLBACK")


def _num(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def setup_class(trade_type: str | None, setup_key: str | None = None) -> str:
    raw = f"{trade_type or ''} {setup_key or ''}".upper().replace("-", "_").replace(" ", "_")
    if "BREAKOUT_RETEST" in raw or "RETEST" in raw:
        return "BREAKOUT_RETEST"
    if "COUNTER" in raw or "CORRECTION" in raw:
        return "COUNTER_TREND_CORRECTION"
    if "REVERSAL" in raw:
        return "REVERSAL"
    if "BREAKOUT" in raw:
        return "BREAKOUT"
    if "CONTINUATION" in raw or "TREND" in raw:
        return "TREND_CONTINUATION"
    return "UNSPECIFIED"


def relationship(setup: str) -> str:
    if setup in PRIMARY:
        return "PRIMARY"
    if setup in COUNTER:
        return "COUNTER_TREND"
    if setup == "REVERSAL":
        return "REVERSAL"
    return "UNSPECIFIED"


def _dig(doc: dict[str, Any], *path: str) -> Any:
    cur: Any = doc
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def normalize_trade(row: dict[str, Any]) -> dict[str, Any]:
    """Flatten one persisted Stage 9 trade. Missing upstream fields stay null."""
    doc = row.get("doc") if isinstance(row.get("doc"), dict) else {}
    evidence = doc.get("evidence") if isinstance(doc.get("evidence"), dict) else {}
    stage7 = evidence.get("stage7") if isinstance(evidence.get("stage7"), dict) else {}
    leg = stage7.get("marketLeg") if isinstance(stage7.get("marketLeg"), dict) else {}
    upstream = evidence.get("upstream") if isinstance(evidence.get("upstream"), dict) else {}
    kind = setup_class(stage7.get("tradeType") or leg.get("tradeType"), row.get("setupKey"))
    pnl = _num(row.get("realizedPnl"))
    r_mult = _num(row.get("rMultiple"))
    return {
        "key": f"trade:{row.get('executionId')}",
        "kind": "TRADE",
        "executionId": row.get("executionId"),
        "setupKey": row.get("setupKey"),
        "accountId": row.get("accountId"),
        "accountClass": str(row.get("accountClass") or "UNKNOWN").upper(),
        "currency": row.get("currency") or "",
        "symbol": row.get("symbol"),
        "direction": row.get("direction"),
        "setup": kind,
        "relationship": relationship(kind),
        "regime": upstream.get("regime") or stage7.get("regime"),
        "session": upstream.get("session"),
        "alignment": upstream.get("alignment") or stage7.get("alignment"),
        "channelPosition": _num(upstream.get("channelPosition") or stage7.get("channelPosition")),
        "nested": (upstream.get("nested") or stage7.get("nested") or {}).get("h1Status") if isinstance(upstream.get("nested") or stage7.get("nested"), dict) else None,
        "primaryTrend": upstream.get("primaryStructure") or stage7.get("primaryStructure"),
        "tradable": upstream.get("currentTradableDirection") or stage7.get("currentTradableDirection"),
        "confidence": _num(stage7.get("confidence") or stage7.get("score")),
        "rewardRisk": _num(_dig(evidence, "stage8", "authorization", "rewardRisk")),
        "spread": _num(_dig(doc, "executionQuality", "spreadAtSubmit")),
        "realizedPnl": pnl,
        "rMultiple": r_mult,
        "slippagePoints": _num(row.get("slippagePoints")),
        "exitReason": row.get("exitReason"),
        "maeR": _num(_dig(doc, "management", "maeR")),
        "mfeR": _num(_dig(doc, "management", "mfeR")),
        "openedAt": row.get("openedAt"),
        "closedAt": row.get("closedAt"),
        "decision": "EXECUTED",
        "outcome": "WIN" if (pnl or 0) > 0 else "LOSS" if (pnl or 0) < 0 else "FLAT",
        "process": "FOLLOWED" if evidence else "INCOMPLETE",
        "evidence": evidence,
        "stages": reconstruct(evidence, executed=True, exit_reason=row.get("exitReason")),
    }


def normalize_decision(row: dict[str, Any]) -> dict[str, Any]:
    evidence = row.get("evidence") if isinstance(row.get("evidence"), dict) else {}
    kind = setup_class(evidence.get("tradeType"), row.get("setupKey"))
    return {
        "key": row.get("key"),
        "kind": row.get("kind") or "DECISION",
        "executionId": row.get("executionId"),
        "setupKey": row.get("setupKey"),
        "accountId": row.get("accountId"),
        "accountClass": str(row.get("accountClass") or evidence.get("accountClass") or "UNKNOWN").upper(),
        "currency": evidence.get("currency") or "",
        "symbol": row.get("symbol"),
        "direction": evidence.get("direction"),
        "setup": kind,
        "relationship": relationship(kind),
        "regime": evidence.get("regime"),
        "session": evidence.get("session"),
        "timeframe": evidence.get("timeframe"),
        "modelVersion": evidence.get("modelVersion"),
        "decision": row.get("decision"),
        "outcome": row.get("outcome") or "NOT_EXECUTED",
        "process": "FOLLOWED" if evidence.get("reason") or evidence.get("reasonCode") else "INCOMPLETE",
        "confidence": _num(row.get("confidence")),
        "reason": evidence.get("reason") or evidence.get("reasonCode"),
        "closedAt": evidence.get("decidedAt"),
        "evidence": evidence,
        "stages": reconstruct(evidence, executed=False, decision=row.get("decision")),
    }


def reconstruct(evidence: dict[str, Any], *, executed: bool, exit_reason: str | None = None, decision: str | None = None) -> list[dict[str, Any]]:
    """What each stage left in the stored record. Absent stages are listed as not stored."""
    evidence = evidence or {}
    upstream = evidence.get("upstream") if isinstance(evidence.get("upstream"), dict) else {}
    stage7 = evidence.get("stage7") if isinstance(evidence.get("stage7"), dict) else {}
    stage8 = evidence.get("stage8") if isinstance(evidence.get("stage8"), dict) else {}
    owner = evidence.get("stage")
    reason = evidence.get("reason")
    known = {
        2: upstream.get("strength"),
        3: upstream.get("regimeDetail") or (None if isinstance(upstream.get("regime"), str) else upstream.get("regime")),
        4: upstream.get("scanner"),
        5: upstream.get("vision") or upstream.get("channels"),
        6: upstream.get("direction") or ({"state": evidence.get("stage6State") or decision, "reason": reason} if owner == 6 or evidence.get("stage6State") else None),
        7: stage7 or ({"state": evidence.get("h1State"), "reason": reason} if owner == 7 or evidence.get("h1State") else None),
        8: stage8 or ({"state": decision, "reason": reason, "reasonCode": evidence.get("reasonCode")} if owner == 8 else None),
        9: {"executed": executed, "exitReason": exit_reason} if executed else {"executed": False, "decision": decision},
    }
    rows = []
    for stage in range(1, 11):
        if stage == 10:
            rows.append({"stage": 10, "stored": True, "summary": "This reconstruction is the Stage 10 audit of the stored record."})
            continue
        payload = known.get(stage)
        if stage == 1:
            payload = upstream.get("stage1") or evidence.get("stage1")
        rows.append({
            "stage": stage,
            "stored": payload not in (None, {}, ""),
            "summary": payload if payload not in (None, {}, "") else "Not present in the stored Stage 9/decision record.",
        })
    return rows


def _mean(vals: list[float]) -> float | None:
    return sum(vals) / len(vals) if vals else None


def _stdev(vals: list[float]) -> float | None:
    if len(vals) < 2:
        return None
    mu = sum(vals) / len(vals)
    var = sum((v - mu) ** 2 for v in vals) / (len(vals) - 1)
    return math.sqrt(var)


def performance(trades: list[dict[str, Any]]) -> dict[str, Any]:
    currencies = sorted({t.get("currency") or "" for t in trades if t.get("currency")})
    single = currencies[0] if len(currencies) == 1 else None
    ordered = sorted(trades, key=lambda t: str(t.get("closedAt") or t.get("openedAt") or ""))
    pnls = [(t.get("realizedPnl") or 0) for t in ordered] if single else []
    wins = [t for t in trades if t.get("outcome") == "WIN"]
    losses = [t for t in trades if t.get("outcome") == "LOSS"]
    rs = [float(t["rMultiple"]) for t in trades if t.get("rMultiple") is not None]
    slips = [abs(float(t["slippagePoints"])) for t in trades if t.get("slippagePoints") is not None]
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    curve = []
    dd_curve = []
    if single:
        for i, pnl in enumerate(pnls, start=1):
            equity += pnl
            peak = max(peak, equity)
            dd = peak - equity
            max_dd = max(max_dd, dd)
            curve.append({"n": i, "equity": round(equity, 2)})
            dd_curve.append({"n": i, "drawdown": round(dd, 2)})
    gross_win = sum(float(t["realizedPnl"]) for t in wins) if single else None
    gross_loss = abs(sum(float(t["realizedPnl"]) for t in losses)) if single else None
    pf = None
    pf_note = "INSUFFICIENT SAMPLE"
    if single and trades:
        if gross_loss:
            pf = round(gross_win / gross_loss, 2) if gross_win is not None else None
            pf_note = f"{len(trades)} closed trades · {single}"
        elif gross_win:
            pf_note = "No losing trades in this currency sample — profit factor is not reported as infinite"
        else:
            pf_note = "No P&L in this sample"
    elif len(currencies) > 1:
        pf_note = f"P&L is not combined across {', '.join(currencies)}"
    sharpe = None
    sharpe_note = f"INSUFFICIENT SAMPLE — return/risk needs {MIN_STAT} closed trades with an R-multiple"
    if len(rs) >= MIN_STAT:
        sd = _stdev(rs)
        mu = _mean(rs)
        if sd and mu is not None and sd > 0:
            sharpe = round(mu / sd, 2)
            sharpe_note = f"Mean R / sample stdev of R · {len(rs)} trades · not annualized"
        else:
            sharpe_note = "R-multiple dispersion is zero in this sample"
    avg_r = _mean(rs)
    return {
        "trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "flats": len([t for t in trades if t.get("outcome") == "FLAT"]),
        "currency": single,
        "currencies": currencies,
        "netPnl": round(sum(pnls), 2) if single else None,
        "netNote": f"Realized · {single}" if single else ("INSUFFICIENT SAMPLE — no closed trades" if not trades else f"Not summed · {', '.join(currencies)}"),
        "winRate": round(100 * len(wins) / len(trades), 1) if trades else None,
        "profitFactor": pf,
        "profitFactorNote": pf_note,
        "averageR": round(avg_r, 2) if avg_r is not None else None,
        "expectancy": round(avg_r, 2) if len(rs) >= MIN_SLICE else None,
        "expectancyNote": f"{len(rs)} trades with initial risk" if len(rs) >= MIN_SLICE else f"INSUFFICIENT SAMPLE — expectancy needs {MIN_SLICE} R-multiples ({len(rs)} stored)",
        "maxDrawdown": round(max_dd, 2) if single and trades else None,
        "peakEquity": round(peak, 2) if single and trades else None,
        "currentEquity": round(equity, 2) if single and trades else None,
        "sharpe": sharpe,
        "sharpeNote": sharpe_note,
        "avgSlippage": round(sum(slips) / len(slips), 2) if slips else None,
        "slippageSample": len(slips),
        "curve": curve,
        "drawdown": dd_curve,
        "processNote": "Win rate counts P&L. It is not a grade of whether the decision followed valid stage evidence.",
    }


def _slice(trades: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for t in trades:
        label = str(t.get(key) or "UNKNOWN")
        groups.setdefault(label, []).append(t)
    rows = []
    for label, items in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        rs = [float(x["rMultiple"]) for x in items if x.get("rMultiple") is not None]
        wins = len([x for x in items if x.get("outcome") == "WIN"])
        rows.append({
            "label": label,
            "sample": len(items),
            "reliable": len(items) >= MIN_SLICE,
            "note": f"{len(items)} trades" if len(items) >= MIN_SLICE else f"INSUFFICIENT SAMPLE — {len(items)} of {MIN_SLICE} required",
            "winRate": round(100 * wins / len(items), 1) if items else None,
            "averageR": round(sum(rs) / len(rs), 2) if len(rs) >= MIN_SLICE else None,
            "evidenceKeys": [x.get("key") for x in items[:12]],
        })
    return rows


def analytics(trades: list[dict[str, Any]]) -> dict[str, Any]:
    tagged = []
    for t in trades:
        pos = t.get("channelPosition")
        conf = t.get("confidence")
        rr = t.get("rewardRisk")
        tagged.append({
            **t,
            "location": "UNKNOWN" if pos is None else "0–25%" if pos < 25 else "25–50%" if pos < 50 else "50–75%" if pos < 75 else "75–100%",
            "confidenceBand": "UNKNOWN" if conf is None else "<45" if conf < 45 else "45–54" if conf < 55 else "55–69" if conf < 70 else "≥70",
            "rrBand": "UNKNOWN" if rr is None else "<1.5" if rr < 1.5 else "1.5–2.4" if rr < 2.5 else "≥2.5",
            "nestedState": t.get("nested") or "UNKNOWN",
            "side": t.get("direction") or "UNKNOWN",
        })
    return {
        "minSample": MIN_SLICE,
        "bySetup": _slice(tagged, "setup"),
        "bySymbol": _slice(tagged, "symbol"),
        "bySide": _slice(tagged, "side"),
        "byRelationship": _slice(tagged, "relationship"),
        "byRegime": _slice(tagged, "regime"),
        "bySession": _slice(tagged, "session"),
        "byAlignment": _slice(tagged, "alignment"),
        "byLocation": _slice(tagged, "location"),
        "byNested": _slice(tagged, "nestedState"),
        "byConfidence": _slice(tagged, "confidenceBand"),
        "byRewardRisk": _slice(tagged, "rrBand"),
    }


def grade_note(row: dict[str, Any]) -> str:
    outcome = row.get("outcome")
    process = row.get("process")
    if row.get("kind") == "TRADE" and outcome == "WIN":
        return "Profitable result. Stage 10 does not treat P&L as proof the decision was valid."
    if row.get("kind") == "TRADE" and outcome == "LOSS":
        return "Losing result. Stage 10 does not treat P&L as proof the decision was invalid."
    if process == "FOLLOWED":
        return "The stored record includes the stage reason. Avoidance is not scored as a missed winner without later price evidence."
    return "The stored record does not contain enough stage evidence to judge the decision."


def insights(trades: list[dict[str, Any]], decisions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(trades) < MIN_SLICE:
        return [{
            "code": "INSUFFICIENT_SAMPLE",
            "title": "INSUFFICIENT SAMPLE",
            "detail": f"Stage 10 has {len(trades)} closed trade(s) and {len(decisions)} non-trade decision(s). A pattern needs {MIN_SLICE} records in one group. Collection continues on trade closes and stage rejections.",
            "sample": len(trades) + len(decisions),
            "required": MIN_SLICE,
            "evidenceKeys": [r.get("key") for r in (trades + decisions)[:12]],
        }]
    found = []
    for row in analytics(trades)["bySetup"]:
        if row["reliable"] and row.get("averageR") is not None and row["averageR"] < 0:
            found.append({
                "code": "NEGATIVE_EXPECTANCY",
                "title": f"{row['label']} average R is {row['averageR']}",
                "detail": f"{row['note']}. This is a measured R result, not a judgement that each losing trade was a bad decision.",
                "sample": row["sample"],
                "required": MIN_SLICE,
                "evidenceKeys": row["evidenceKeys"],
            })
    slips = [t for t in trades if t.get("slippagePoints") is not None]
    if len(slips) >= MIN_SLICE:
        avg = sum(abs(float(t["slippagePoints"])) for t in slips) / len(slips)
        if avg > 3:
            found.append({
                "code": "SLIPPAGE",
                "title": f"Mean absolute slippage {avg:.2f} points",
                "detail": "Execution cost is elevated in the stored fills. This does not change the production spread limit.",
                "sample": len(slips),
                "required": MIN_SLICE,
                "evidenceKeys": [t.get("key") for t in slips[:12]],
            })
    return found or [{
        "code": "NO_PATTERN",
        "title": "No evidence-backed pattern yet",
        "detail": f"{len(trades)} closed trades and {len(decisions)} other decisions are stored. No group of {MIN_SLICE} has a measured weakness to cite.",
        "sample": len(trades),
        "required": MIN_SLICE,
        "evidenceKeys": [t.get("key") for t in trades[:12]],
    }]


def proposals(trades: list[dict[str, Any]], production: dict[str, Any]) -> dict[str, Any]:
    """Candidate parameters only. Nothing here is written to production config."""
    if len(trades) < MIN_PROPOSAL:
        return {
            "lifecycle": "OBSERVE",
            "sampleSufficient": False,
            "sample": len(trades),
            "required": MIN_PROPOSAL,
            "message": f"INSUFFICIENT SAMPLE — {len(trades)} closed trade(s). A candidate needs {MIN_PROPOSAL} before propose / backtest / validate.",
            "proposals": [],
        }
    slips = [abs(float(t["slippagePoints"])) for t in trades if t.get("slippagePoints") is not None]
    out = []
    if len(slips) >= MIN_PROPOSAL and sum(slips) / len(slips) > 3:
        current = _num(production.get("maxSpreadAtr"))
        candidate = None if current is None else round(max(0.01, current * 0.9), 4)
        out.append({
            "key": "maxSpreadAtr",
            "parameter": "maxSpreadAtr",
            "lifecycle": "PROPOSE",
            "direction": "TIGHTEN",
            "reason": "Mean absolute slippage exceeded 3 points on the closed-trade sample",
            "sample": len(slips),
            "required": MIN_PROPOSAL,
            "productionValue": current,
            "candidateValue": candidate,
            "applied": False,
            "evidenceKeys": [t.get("key") for t in trades if t.get("slippagePoints") is not None][:12],
        })
    return {
        "lifecycle": "PROPOSE" if out else "MEASURE",
        "sampleSufficient": True,
        "sample": len(trades),
        "required": MIN_PROPOSAL,
        "message": "Candidate recorded. Production parameters are unchanged." if out else "Sample is large enough and no candidate rule fired. Production parameters are unchanged.",
        "proposals": out,
    }


def _slip_mean(rows: list[dict[str, Any]]) -> float | None:
    vals = [abs(float(t["slippagePoints"])) for t in rows if t.get("slippagePoints") is not None]
    if len(vals) < MIN_OOS:
        return None
    return sum(vals) / len(vals)


def validate_candidate(trades: list[dict[str, Any]], proposal: dict[str, Any]) -> dict[str, Any]:
    """Out-of-sample check. A pass moves the candidate to SHADOW and still does not apply it."""
    if proposal.get("parameter") != "maxSpreadAtr":
        return {"status": "NOT_RUN", "lifecycle": proposal.get("lifecycle") or "PROPOSE", "detail": "No out-of-sample check is defined for this parameter."}
    ordered = sorted(trades, key=lambda t: str(t.get("closedAt") or ""))
    if len(ordered) < MIN_PROPOSAL:
        return {"status": "INSUFFICIENT_SAMPLE", "lifecycle": "OBSERVE", "detail": f"INSUFFICIENT SAMPLE — {len(ordered)} closed trade(s). Validation needs {MIN_PROPOSAL}."}
    cut = int(len(ordered) * 0.7)
    held = len(ordered) - cut
    if cut < MIN_SLICE or held < MIN_OOS:
        return {
            "status": "INSUFFICIENT_OOS",
            "lifecycle": "PROPOSE",
            "inSample": cut,
            "outOfSample": held,
            "detail": f"INSUFFICIENT SAMPLE — the holdout has {held} trade(s). Out-of-sample validation needs {MIN_OOS} trades kept out of the proposal window.",
        }
    ins, oos = ordered[:cut], ordered[cut:]
    ins_mean, oos_mean = _slip_mean(ins), _slip_mean(oos)
    if ins_mean is None or oos_mean is None:
        return {"status": "INSUFFICIENT_OOS", "lifecycle": "PROPOSE", "detail": "INSUFFICIENT SAMPLE — slippage is missing on the in-sample or holdout trades."}
    if ins_mean > 3 and oos_mean > 3:
        return {
            "status": "PASSED",
            "lifecycle": "SHADOW",
            "comparison": "OOS_CONFIRMED",
            "inSample": round(ins_mean, 2),
            "outOfSample": round(oos_mean, 2),
            "detail": "Holdout slippage stayed above 3 points. The candidate can be approved explicitly. Production parameters are unchanged.",
        }
    return {
        "status": "FAILED",
        "lifecycle": "PROPOSE",
        "comparison": "OOS_NOT_CONFIRMED",
        "inSample": round(ins_mean, 2),
        "outOfSample": round(oos_mean, 2),
        "detail": "Holdout slippage did not repeat the in-sample pattern. The candidate stays off production.",
    }


def promotion_allowed(proposal: dict[str, Any]) -> tuple[bool, str]:
    verdict = proposal.get("validation") if isinstance(proposal.get("validation"), dict) else {}
    if proposal.get("applied") or proposal.get("lifecycle") == "MONITOR":
        return False, "This candidate is already recorded on a production version."
    if proposal.get("lifecycle") != "SHADOW" or verdict.get("status") != "PASSED":
        return False, "Approval waits for a passed out-of-sample check. The candidate stays off production."
    return True, "Explicit approval may copy this candidate onto the production risk configuration."


def price_diagnosis(*, executed: bool, direction: str | None, closes: list[float], slippage: float | None = None) -> dict[str, Any]:
    """Label a stored path. A profit or a loss is not itself the grade."""
    if executed and slippage is not None and abs(float(slippage)) > 3:
        return {"label": "EXECUTION_PROBLEM", "detail": f"Stored absolute slippage is {abs(float(slippage)):.2f} points. P&L is not the grade of the decision."}
    if len(closes) < 2:
        return {"label": "NO_PATH", "detail": "Later price path is not in the stored candles."}
    first, last = float(closes[0]), float(closes[-1])
    pct = ((last - first) / first * 100) if first else 0.0
    side = str(direction or "").upper()
    if side not in ("BUY", "SELL", "LONG", "SHORT"):
        return {"label": "UNLABELLED", "detail": f"H1 close moved {pct:.3f}% after the decision. No tradable direction was stored, so this is not a rejected winner or an avoided loser.", "changePct": round(pct, 3)}
    if abs(pct) < 0.05:
        return {"label": "UNRESOLVED", "detail": f"Later H1 move was {pct:.3f}%, inside the noise band. It is not scored.", "changePct": round(pct, 3)}
    favorable = (side in ("BUY", "LONG") and last > first) or (side in ("SELL", "SHORT") and last < first)
    if executed:
        return {"label": "PATH_CONTEXT", "detail": f"Later H1 move was {pct:.3f}%. The trade result stays separate from whether the decision followed the stored evidence.", "changePct": round(pct, 3)}
    if favorable:
        return {"label": "REJECTED_WINNER", "detail": f"The stored direction moved {pct:.3f}% in its favour after the decision was not executed.", "changePct": round(pct, 3)}
    return {"label": "AVOIDED_LOSER", "detail": f"The stored direction moved {pct:.3f}% against it after the decision was not executed.", "changePct": round(pct, 3)}


def health(trades: int, decisions: int, proposal_state: str, last_error: str | None, run_at: str | None) -> str:
    if last_error and not run_at:
        return "BLOCKED"
    if last_error:
        return "DEGRADED"
    if proposal_state in ("BACKTEST", "VALIDATE", "SHADOW"):
        return "VALIDATING"
    if trades == 0 and decisions == 0:
        return "WAITING"
    if trades < MIN_SLICE:
        return "WAITING"
    return "HEALTHY"
