"""Chronological replay. A decision at bar i receives only bars[:i+1]."""

from __future__ import annotations

import bisect
from typing import Any, Callable

try:
    import opportunity
except ImportError:  # pragma: no cover
    from bridge.mt5 import opportunity  # type: ignore


def replay(bars: list[tuple], decide: Callable[[list[tuple], int], Any]) -> list[Any]:
    trail = []
    for i in range(len(bars)):
        trail.append(decide(bars[: i + 1], i))
    return trail


def replay_scan(symbol: str, bars: list[tuple], channel_at: Callable[[list[tuple]], dict[str, dict[str, Any]]]) -> dict[str, Any]:
    """channel_at must build channels from the prefix only. The scan never receives a future close."""
    hypotheses = 0
    actionable = 0
    families: dict[str, int] = {}
    longest = 0

    def decide(prefix: list[tuple], i: int) -> None:
        nonlocal hypotheses, actionable, longest
        if prefix[-1] is not bars[i]:
            raise RuntimeError("replay exposed a future bar")
        longest = max(longest, len(prefix))
        channels = channel_at(prefix)
        price = float(prefix[-1][4])
        result = opportunity.scan([symbol], {symbol: channels}, prices={symbol: price})
        for row in result["instruments"]:
            for item in row["hypotheses"]:
                if item.get("status") == "NOT_DETECTED":
                    continue
                hypotheses += 1
                family = str(item.get("opportunityFamily") or item.get("TiTLevel") or "NONE")
                families[family] = families.get(family, 0) + 1
                if item.get("actionable"):
                    actionable += 1

    replay(bars, decide)
    if bars and longest != len(bars):
        raise RuntimeError("replay did not reach the final closed bar")
    return {
        "symbol": symbol,
        "bars": len(bars),
        "hypotheses": hypotheses,
        "actionable": actionable,
        "executed": 0,
        "families": families,
        "win": None,
        "loss": None,
        "mae": None,
        "mfe": None,
        "r": None,
        "drawdown": None,
        "maxConcurrency": 0,
        "lookahead": False,
    }


def closed_prefix(bars: list[tuple], tf: str, asof: int, lookback: int) -> list[tuple]:
    """Bars whose close is at or before the decision. The decision bar is included. The next bar is not."""
    end = _closed_end(bars, tf, asof)
    if end <= 0:
        return []
    start = max(0, end - max(1, lookback))
    return list(bars[start:end])


def _closed_end(bars: list[tuple], tf: str, asof: int) -> int:
    try:
        import channel_analysis as ca
    except ImportError:  # pragma: no cover
        from bridge.mt5 import channel_analysis as ca  # type: ignore
    lo, hi = 0, len(bars)
    while lo < hi:
        mid = (lo + hi) // 2
        if ca.bar_close(tf, int(bars[mid][0])) <= int(asof):
            lo = mid + 1
        else:
            hi = mid
    return lo


def _blank() -> dict[str, int]:
    return {
        "detected": 0, "erzReached": 0, "p1": 0, "p2": 0, "waitRetest": 0, "neither": 0,
        "episodes": 0, "episodesReachedErz": 0, "episodesP1": 0, "episodesP2": 0, "episodesNeither": 0,
    }


def _touch(group: dict[str, int], item: dict[str, Any]) -> None:
    group["detected"] += 1
    inside = (item.get("location") or {}).get("inside") is True
    p1 = (item.get("p1") or {}).get("state") == "P1_READY_FOR_RISK"
    p2 = (item.get("p2") or {}).get("state") == "P2_READY_FOR_RISK"
    waiting = (item.get("p2") or {}).get("state") == "P2_WAIT_RETEST"
    if inside:
        group["erzReached"] += 1
    if p1:
        group["p1"] += 1
    if p2:
        group["p2"] += 1
    if waiting:
        group["waitRetest"] += 1
    if not inside and not p1 and not p2:
        group["neither"] += 1


def _close_episode(flags: dict[str, Any], groups: dict[str, dict[str, int]]) -> None:
    for name in flags["groups"]:
        group = groups[name]
        group["episodes"] += 1
        if flags["erz"]:
            group["episodesReachedErz"] += 1
        if flags["p1"]:
            group["episodesP1"] += 1
        if flags["p2"]:
            group["episodesP2"] += 1
        if not flags["erz"] and not flags["p1"] and not flags["p2"]:
            group["episodesNeither"] += 1


OP01_ORDER = ("BOUNDARY_APPROACH", "BOUNDARY_ZONE_REACHED", "BOUNDARY_TOUCH", "BOUNDARY_PENETRATION", "REACTION_PENDING",
              "REACTION_DETECTED", "REACTION_CONFIRMED")


def op01_replay(symbols: list[str] | None = None, *, tf: str = "D1", days: int = 120, h1_stride: int = 2,
                loader: Callable[[str, str], list[tuple]] | None = None) -> dict[str, Any]:
    """Causal OP-01 boundary-reaction replay with a per-episode funnel and the shadow comparison against the legacy
    BOS/CHoCH gate.

    At each closed parent bar the channel is rebuilt from the parent prefix only. Each following execution bar is then
    evaluated on the execution prefix that has closed at that bar, against that channel. Bars after a confirmation are
    read only to measure the counterfactual outcome (MFE/MAE in R), never to decide.
    """
    try:
        import boundary_reaction as br
        import channel_analysis as ca
        import opportunity_framework as fw
        import opportunity_framework_store as fstore
        import history_store as hs
        import vision
    except ImportError:  # pragma: no cover
        from bridge.mt5 import boundary_reaction as br  # type: ignore
        from bridge.mt5 import channel_analysis as ca  # type: ignore
        from bridge.mt5 import opportunity_framework as fw  # type: ignore
        from bridge.mt5 import opportunity_framework_store as fstore  # type: ignore
        from bridge.mt5 import history_store as hs  # type: ignore
        from bridge.mt5 import vision  # type: ignore

    exec_tf = fw.EXECUTION[tf]
    sec = fw.TF_SEC[exec_tf]
    symbols = list(symbols or opportunity.SYMBOLS)
    read = loader or (lambda symbol, frame: hs.candle_ohlc(symbol, ca.SOURCE_TF.get(frame, frame)))
    lookback = int(vision.tf_cfg(tf)["lookback"])
    funnel = {"episodes": 0, "zoneReached": 0, "reactionDetected": 0, "reactionConfirmed": 0, "roomOk": 0, "readyForRisk": 0,
              "confirmedWithBos": 0, "confirmedWithoutBos": 0, "legacyGateWouldPass": 0, "broken": 0, "failed": 0}
    outcomes: dict[str, dict[str, Any]] = {k: {"tracked": 0, "targetFirst": 0, "stopFirst": 0, "timeout": 0, "open": 0, "mfe": [], "mae": []}
                                           for k in ("withBos", "withoutBos")}
    per_symbol: dict[str, int] = {}
    evaluations = 0
    for symbol in symbols:
        parent = read(symbol, tf)
        execution = read(symbol, exec_tf)
        if len(parent) < lookback // 2 or len(execution) < br.CONFIG["minBars"]:
            continue
        exec_ts = [int(b[0]) for b in execution]
        episodes: dict[tuple, dict[str, Any]] = {}
        start = max(lookback // 2, len(parent) - int(days))
        for i in range(start, len(parent)):
            asof = ca.bar_close(tf, int(parent[i][0]))
            prefix = parent[max(0, i + 1 - lookback):i + 1]
            if ca.bar_close(tf, int(prefix[-1][0])) > asof:
                raise RuntimeError("parent prefix includes a future bar")
            snap = ca.analyse_timeframe(symbol, tf, prefix, ("READY", "closed historical candles"), asof)
            defn = snap.get("definition")
            sign = fw._sign(snap.get("direction"))
            if not defn or sign == 0 or str(snap.get("status") or "") not in fw.CHANNEL_OK:
                continue
            tp = fw._trade_pos(snap.get("position"), sign)
            if tp is None or tp > fw.CONFIG["boundaryBandPct"]:
                continue
            atr = (snap.get("evidence") or {}).get("atr")
            parent_ts = [int(b[0]) for b in parent[:i + 1] if int(b[0]) >= int(defn["anchorTs"])]
            nxt = ca.bar_close(tf, int(parent[i + 1][0])) if i + 1 < len(parent) else asof + fw.TF_SEC[tf]
            j0 = bisect.bisect_left(exec_ts, asof)
            j1 = bisect.bisect_left(exec_ts, nxt - sec + 1)
            for j in range(j0, min(j1, len(execution)), max(1, int(h1_stride))):
                now = exec_ts[j] + sec
                bars = execution[max(0, j + 1 - 300):j + 1]
                lines = br.project_lines(defn, parent_ts, [int(b[0]) for b in bars])
                det = br.detect(bars, lines, sign, parent_atr=atr, mode="BOUNDARY", tf_sec=sec, now_ts=now)
                evaluations += 1
                touch = (det.get("touch") or {}).get("ts")
                if not touch or det["state"] in ("BOUNDARY_DISTANT", "BOUNDARY_APPROACH", "INSUFFICIENT_HISTORY"):
                    continue
                key = (snap.get("channelId"), sign, touch)
                ep = episodes.setdefault(key, {"rank": -1, "confirmed": False, "broken": False, "failed": False, "room": False, "ready": False})
                if det["state"] in OP01_ORDER:
                    ep["rank"] = max(ep["rank"], OP01_ORDER.index(det["state"]))
                ep["broken"] = ep["broken"] or det["state"] == "BOUNDARY_BROKEN"
                ep["failed"] = ep["failed"] or det["state"] == "REACTION_FAILED"
                if det["state"] == "REACTION_CONFIRMED" and not det.get("expired") and not ep["confirmed"]:
                    ep["confirmed"] = True
                    events = ca.structure_events(exec_tf, bars, limit=60)
                    bos, choch = fw._structure_since(events, sign, touch)
                    room = det.get("room") or {}
                    ep.update({"bos": bos, "choch": choch, "room": bool(room.get("ok")),
                               "ready": bool(room.get("ok")) and (det.get("entryQuality") or {}).get("grade") != "EXTENDED"})
                    if room.get("entry") is not None and room.get("invalidation") is not None:
                        ep["cf"] = {"state": "OPEN", "entry": float(room["entry"]), "stop": float(room["invalidation"]),
                                    "target": room.get("target"), "sign": sign, "startTs": int(bars[-1][0]), "mfeR": 0.0, "maeR": 0.0, "bars": 0}
        for ep in episodes.values():
            funnel["episodes"] += 1
            funnel["zoneReached"] += ep["rank"] >= OP01_ORDER.index("BOUNDARY_ZONE_REACHED")
            funnel["reactionDetected"] += ep["rank"] >= OP01_ORDER.index("REACTION_DETECTED")
            funnel["reactionConfirmed"] += ep["confirmed"]
            funnel["broken"] += ep["broken"]
            funnel["failed"] += ep["failed"]
            if ep["confirmed"]:
                funnel["roomOk"] += ep["room"]
                funnel["readyForRisk"] += ep["ready"]
                funnel["confirmedWithBos"] += bool(ep.get("bos"))
                funnel["confirmedWithoutBos"] += not ep.get("bos")
                funnel["legacyGateWouldPass"] += bool(ep.get("bos") or ep.get("choch"))
            if ep.get("cf") and ep["ready"]:
                k = "withBos" if ep.get("bos") else "withoutBos"
                after = execution[bisect.bisect_right(exec_ts, ep["cf"]["startTs"]):]
                cf = fstore.measure_counterfactual(ep["cf"], after[:fstore.COUNTERFACTUAL_MAX_BARS + 1])
                o = outcomes[k]
                o["tracked"] += 1
                o["mfe"].append(cf["mfeR"])
                o["mae"].append(cf["maeR"])
                outcome = cf.get("outcome")
                o["targetFirst"] += outcome == "TARGET_FIRST"
                o["stopFirst"] += outcome == "STOP_FIRST"
                o["timeout"] += outcome == "TIMEOUT"
                o["open"] += outcome is None
        per_symbol[symbol] = len(episodes)
    for o in outcomes.values():
        mfe, mae = o.pop("mfe"), o.pop("mae")
        o["avgMfeR"] = round(sum(mfe) / len(mfe), 2) if mfe else None
        o["avgMaeR"] = round(sum(mae) / len(mae), 2) if mae else None
    return {
        "opportunityType": "OP-01", "route": "OP-01:BOUNDARY_REACTION", "parentTimeframe": tf, "executionTimeframe": exec_tf,
        "days": int(days), "executionStride": int(h1_stride), "symbols": len(symbols), "evaluations": evaluations,
        "funnel": funnel, "counterfactual": outcomes, "episodesBySymbol": per_symbol, "lookahead": False, "thresholdsChanged": False,
        "note": ("Episodes keyed by channel, direction and touch bar. legacyGateWouldPass counts confirmed reactions that also had a "
                 "BOS or CHoCH since the touch (the existing NORMAL gate). Counterfactual outcomes are observational, "
                 "first-touch, conservative on same-bar ambiguity, and never change thresholds."),
    }


def historical_distribution(symbols: list[str] | None = None, stride: int = 5, loader: Callable[[str, str], list[tuple]] | None = None) -> dict[str, Any]:
    """Replay the live discovery engine on stored closed candles. No bar after the decision is visible.

    Samples every `stride` closed D1 bar. A touch that exists only between samples is not counted.
    M15 and M5 are not in the stored history, so L4 and M15-confirmed L3 cannot fire P2 here.
    """
    try:
        import channel_analysis as ca
        import confirm
        import history_store as hs
        import vision
        import confirm_engine
    except ImportError:  # pragma: no cover
        from bridge.mt5 import channel_analysis as ca  # type: ignore
        from bridge.mt5 import confirm  # type: ignore
        from bridge.mt5 import history_store as hs  # type: ignore
        from bridge.mt5 import vision  # type: ignore
        from bridge.mt5 import confirm_engine  # type: ignore

    symbols = list(symbols or opportunity.SYMBOLS)
    read = loader or (lambda symbol, tf: hs.candle_ohlc(symbol, {"MN": "MN1", "W": "W1"}.get(tf, tf)))
    frames = ("MN", "W", "D1", "H8", "H1")
    names = ("NORMAL", "L1", "L2", "L3", "L4", "XAU", "FX")
    groups = {name: _blank() for name in names}
    decisions = 0
    confirmation_counts = {"eligible": 0, "confirmed": 0, "waitRetest": 0, "other": 0, "symbolsWithH1": 0}
    cache: dict[tuple, dict[str, Any] | None] = {}

    def compact(symbol: str, tf: str, bars: list[tuple], asof: int) -> dict[str, Any] | None:
        end = _closed_end(bars, tf, asof)
        if end <= 0:
            return None
        last = int(bars[end - 1][0])
        key = (symbol, tf, last)
        if key in cache:
            return cache[key]
        lookback = int(vision.tf_cfg(tf)["lookback"])
        prefix = bars[max(0, end - lookback):end]
        if prefix and ca.bar_close(tf, int(prefix[-1][0])) > asof:
            raise RuntimeError("channel prefix includes a future bar")
        snap = ca.analyse_timeframe(symbol, tf, prefix, ("READY", "closed historical candles"), asof)
        if snap.get("status") in (None, "NO_CHANNEL", "INSUFFICIENT"):
            cache[key] = None
            return None
        built = {
            "timeframe": tf, "direction": snap.get("direction"), "status": snap.get("status"),
            "position": snap.get("position"), "lower": snap.get("lowerBoundary"), "upper": snap.get("upperBoundary"),
            "mid": snap.get("midline"), "channelId": snap.get("channelId"), "confidence": snap.get("confidence"),
            "atr": (snap.get("evidence") or {}).get("atr"), "currentPrice": snap.get("currentPrice"),
        }
        cache[key] = built
        return built

    for symbol in symbols:
        series = {tf: read(symbol, tf) for tf in frames}
        clock = series["D1"]
        if len(clock) < 120 or len(series["H1"]) < int(confirm.CONFIG["minBars"]):
            continue
        confirmation_counts["symbolsWithH1"] += 1
        first = None
        for index in range(119, len(clock)):
            asof = ca.bar_close("D1", int(clock[index][0]))
            if len(closed_prefix(series["H1"], "H1", asof, int(confirm.CONFIG["lookback"]))) >= int(confirm.CONFIG["minBars"]):
                first = index
                break
        if first is None:
            continue
        open_eps: dict[str, dict[str, Any]] = {}
        engine = confirm_engine.ConfirmationEngine("H1")
        for index in range(first, len(clock), max(1, int(stride))):
            asof = ca.bar_close("D1", int(clock[index][0]))
            pack = {tf: row for tf in frames if (row := compact(symbol, tf, series[tf], asof))}
            price = float(clock[index][4])
            h1_end = _closed_end(series["H1"], "H1", asof)
            h1_prefix = series["H1"][max(0, h1_end - int(confirm.CONFIG["lookback"])):h1_end]
            confirmation = None
            h1 = pack.get("H1") or {}
            d1 = pack.get("D1") or {}
            if len(h1_prefix) >= int(confirm.CONFIG["minBars"]) and h1.get("direction") in ("BULLISH", "BEARISH"):
                if h1_prefix and ca.bar_close("H1", int(h1_prefix[-1][0])) > asof:
                    raise RuntimeError("confirmation prefix includes a future bar")
                decision = engine.evaluate(
                    symbol, h1_prefix, str(h1.get("direction")), now_ts=asof,
                    parent={"timeframe": "D1", "direction": d1.get("direction"), "position": d1.get("position"), "confidence": d1.get("confidence")},
                    child={"timeframe": "H8", "direction": (pack.get("H8") or {}).get("direction"), "position": (pack.get("H8") or {}).get("position")},
                )
                entry = decision.get("entry") or {}
                state = str(decision.get("state") or "")
                confirmation_counts["eligible"] += 1
                if state == "CONFIRMED":
                    confirmation_counts["confirmed"] += 1
                elif state == "BREAKOUT_CONFIRMED_WAIT_RETEST":
                    confirmation_counts["waitRetest"] += 1
                else:
                    confirmation_counts["other"] += 1
                if state in ("CONFIRMED", "BREAKOUT_CONFIRMED_WAIT_RETEST"):
                    timing = entry.get("timing")
                    confirmation = {"direction": h1.get("direction"), "state": state,
                                    "timing": timing, "extension": entry.get("extensionATR"),
                                    "reaction": timing in ("ENTER_NOW", "RETEST_CONFIRMED")}
            result = opportunity.scan(
                [symbol], {symbol: pack}, prices={symbol: price},
                confirmations={symbol: {"H1": confirmation}} if confirmation else None,
            )
            decisions += 1
            seen: set[str] = set()
            for row in result["instruments"]:
                for item in row["hypotheses"]:
                    if item.get("status") == "NOT_DETECTED":
                        continue
                    level = item.get("TiTLevel") or "NORMAL"
                    bucket_names = [level, "XAU" if symbol == "XAUUSD" else "FX"]
                    for name in bucket_names:
                        if name in groups:
                            _touch(groups[name], item)
                    key = f"{symbol}|{level}|{item.get('direction')}|{item.get('opportunityFamily')}"
                    seen.add(key)
                    flags = open_eps.setdefault(key, {"groups": bucket_names, "erz": False, "p1": False, "p2": False})
                    flags["erz"] = flags["erz"] or (item.get("location") or {}).get("inside") is True
                    flags["p1"] = flags["p1"] or (item.get("p1") or {}).get("state") == "P1_READY_FOR_RISK"
                    flags["p2"] = flags["p2"] or (item.get("p2") or {}).get("state") == "P2_READY_FOR_RISK"
            for key in [key for key in open_eps if key not in seen]:
                _close_episode(open_eps.pop(key), groups)
        for flags in open_eps.values():
            _close_episode(flags, groups)
        print(f"replay {symbol} decisions={decisions} cache={len(cache)}", flush=True)
    return {
        "stride": int(stride),
        "decisionTimeframe": "D1",
        "symbols": len(symbols),
        "decisions": decisions,
        "m15Stored": False,
        "m5Stored": False,
        "lookahead": False,
        "thresholdsChanged": False,
        "normalMeasured": False,
        "normalReason": "NORMAL_TREND_CONTINUATION is emitted only from a Stage 6 READY_FOR_H1 decision. Those decisions are not stored per historical bar, and this replay does not invent them.",
        "confirmation": confirmation_counts,
        "h1Window": "Decisions start on the first daily close that has 300 prior closed H1 bars. Earlier daily history is excluded from this pass.",
        "note": (
            "Every stride-th closed daily bar. Channel and H1 confirmation use only bars closed at that decision. "
            "M15 and M5 candles are not stored, so L4 is not detected and an M15 confirmation cannot release L3 P2. "
            "H1 confirmation uses the existing closed-bar rules and the 400-bar lookback. ERZ geometry is unchanged."
        ),
        "groups": groups,
    }
