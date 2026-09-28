"""Stage 5 autonomous runner: Market Scanner qualification -> Stage 1 D1/H8 history -> structural analysis -> SQL Server.

Runs on a bridge background thread, independent of any browser session. Re-analysis is event driven:
new/repaired D1/H8 candles, Stage 1 readiness changes, Market Scanner qualification changes, live price
approaching or breaching a channel boundary, intrabar volatility spikes, plus a periodic safety sweep.
Stage 5 publishes structural intelligence only; it never places or manages orders.
"""

from __future__ import annotations

import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable

try:
    import analysis_gate
    import history_store as hs
    import regime
    import vision
    import vision_store as vs
except ImportError:  # pragma: no cover
    from bridge.mt5 import analysis_gate  # type: ignore
    from bridge.mt5 import history_store as hs  # type: ignore
    from bridge.mt5 import regime  # type: ignore
    from bridge.mt5 import vision  # type: ignore
    from bridge.mt5 import vision_store as vs  # type: ignore

SYMBOLS: list[str] = list(regime.SYMBOLS)
TFS = ("D1", "H8", "H1")

CONFIG: dict[str, Any] = {
    "loopSec": 20,
    "fullEverySec": 900,
    "scannerGate": "STAGE4_PROMOTION",   # STAGE4_PROMOTION: promoted by the Market Scanner · ALL: analyse every instrument
    # Draw D1/H8 channels for unpromoted instruments too. Visibility only: combine() keeps them BLOCKED with a
    # NEUTRAL direction and zero confidence, and Stage 6 independently requires Stage 4 promotion.
    "analyseUnpromoted": True,
    "volSpikeAtr": 1.5,             # intrabar move from the last close, in ATR
    "liveMaxTickAgeSec": 600,       # ticks older than this (market closed) do not raise live events
    "extraBars": 200,
}


def scanner_qualification(rows: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    gate = CONFIG["scannerGate"]
    out: dict[str, dict[str, Any]] = {}
    for sym in SYMBOLS:
        p = rows.get(sym)
        if gate == "ALL":
            q, why = True, "Scanner gate ALL"
        elif not p:
            q, why = False, "not yet ranked by the Market Scanner"
        elif not p.get("promoted"):
            q, why = False, f"Stage 4 {p.get('state')}: {p.get('reason')}"
        else:
            q, why = True, f"Stage 4 PROMOTED {p['direction']} · conviction {p['conviction']:.0f}" if p.get("conviction") is not None else f"Stage 4 PROMOTED {p['direction']}"
        p = p or {}
        out[sym] = {"qualified": q, "reason": why[:300], "bias": p.get("direction"), "conviction": p.get("conviction"),
                    "differential": p.get("differential"), "relationship": p.get("relationship"), "confidence": p.get("confidence"),
                    "freshness": p.get("freshness"), "state": p.get("state"), "evidence": p.get("evidence") or [],
                    "liveEligible": bool(p.get("liveEligible")), "gate": gate}
    return out


class VisionService:
    def __init__(self, tick_fn: Callable[[list[str]], dict[str, dict[str, Any]]] | None = None,
                 on_run: Callable[[list[str]], None] | None = None):
        self.tick_fn = tick_fn
        self.on_run = on_run
        self._dirty: dict[str, str] = {}
        self._dlock = threading.Lock()
        self._run_lock = threading.Lock()
        self._wake = threading.Event()
        self._prev_scanner: dict[str, tuple] | None = None
        self._prev_series: dict[tuple[str, str], tuple] | None = None
        self._prev_channels: dict[tuple[str, str], dict[str, Any]] = {}
        self._cache: dict[str, dict[str, Any]] = {}
        self._zones: dict[tuple[str, str], str] = {}
        self._spikes: dict[tuple[str, str], int] = {}
        self._last_full = 0.0
        self.meta: dict[str, Any] = {"status": "STARTING", "message": "Stage 5 starting", "runs": 0, "errors": 0}
        self.thread: threading.Thread | None = None

    # ------------------------------------------------------------ triggers
    def mark(self, symbols: list[str], reason: str) -> None:
        with self._dlock:
            for s in symbols:
                if s in SYMBOLS:
                    self._dirty.setdefault(s, reason)
        self._wake.set()

    def on_candles(self, timeframe: str, symbols: list[str], kind: str = "INCREMENTAL") -> None:
        if timeframe in TFS:
            self.mark(symbols, f"{'HISTORY_REPAIR' if kind == 'REPAIR' else 'NEW_CANDLE'} {timeframe}")

    def start(self) -> None:
        vs.ensure_vision_schema()
        try:
            self._prev_channels = vs.previous_channels()
        except Exception:
            self._prev_channels = {}
        self.thread = threading.Thread(target=self._loop, name="vision-stage5", daemon=True)
        self.thread.start()

    def _loop(self) -> None:
        time.sleep(3)
        self.mark(SYMBOLS, "STARTUP")
        while True:
            self._wake.wait(timeout=CONFIG["loopSec"])
            self._wake.clear()
            if analysis_gate.paused():
                continue  # operator paused analysis: pending triggers are kept and run on resume
            try:
                self.tick()
            except Exception as exc:  # pragma: no cover
                self.meta["errors"] = self.meta.get("errors", 0) + 1
                self.meta["lastError"] = f"{type(exc).__name__}: {exc}"
                traceback.print_exc()

    def tick(self) -> dict[str, Any]:
        scanner = scanner_qualification(vs.scanner_rows())
        sig = {s: (q["qualified"], q["bias"], q["state"]) for s, q in scanner.items()}
        if self._prev_scanner is not None:
            changed = [s for s in SYMBOLS if self._prev_scanner.get(s) != sig.get(s)]
            if changed:
                self.mark(changed, "SCANNER_QUALIFICATION_CHANGE")
        self._prev_scanner = sig

        series = hs.series_all()
        ssig = {(s, tf): (r["status"], r["latest_ts"], r["candle_count"]) for (s, tf), r in series.items() if tf in TFS}
        if self._prev_series is not None:
            changed = sorted({s for k, v in ssig.items() if self._prev_series.get(k) != v for s in [k[0]]})
            if changed:
                self.mark(changed, "STAGE1_DATA_CHANGE")
        self._prev_series = ssig

        if time.time() - self._last_full >= CONFIG["fullEverySec"]:
            self._last_full = time.time()
            self.mark(SYMBOLS, "PERIODIC")

        self._live_check()

        with self._dlock:
            dirty, self._dirty = self._dirty, {}
        if dirty:
            return self.run(dirty, scanner, series)
        return {"analysed": 0}

    # ------------------------------------------------------------ analysis
    def run(self, dirty: dict[str, str], scanner: dict[str, dict[str, Any]] | None = None,
            series: dict[tuple[str, str], dict[str, Any]] | None = None) -> dict[str, Any]:
        with self._run_lock:
            started = time.time()
            scanner = scanner or scanner_qualification(vs.scanner_rows())
            series = series if series is not None else hs.series_all()
            order = sorted(dirty, key=lambda s: (not scanner[s]["qualified"], -(scanner[s].get("conviction") or 0)))
            ok = failed = 0
            new_events = 0
            for sym in order:
                try:
                    new_events += self.analyse_symbol(sym, scanner[sym], series, dirty[sym])
                    ok += 1
                except Exception as exc:
                    failed += 1
                    self._persist_error(sym, scanner[sym], exc, dirty[sym])
            summary = self._summary()
            self.meta.update({
                "status": "HEALTHY" if failed == 0 else "DEGRADED",
                "message": f"{summary['analysed']}/{len(SYMBOLS)} instruments analysed · {summary['qualified']} scanner-qualified · "
                           f"{summary['confirmedD1']} confirmed D1 channels" + (f" · {failed} failed" if failed else ""),
                "runAt": datetime.now(timezone.utc).isoformat(),
                "durationMs": int((time.time() - started) * 1000),
                "analysedNow": ok, "failedNow": failed, "newEvents": new_events,
                "triggers": sorted(set(dirty.values()))[:12],
                "runs": self.meta.get("runs", 0) + 1,
                "summary": summary,
                "config": {"engine": vision.CONFIG, "timeframes": vision.TF_CFG, "service": CONFIG},
            })
            vs.save_meta(self.meta)
            if self.on_run:
                try:
                    self.on_run(list(dirty))
                except Exception:
                    traceback.print_exc()
            return {"analysed": ok, "failed": failed, "newEvents": new_events}

    def _summary(self) -> dict[str, Any]:
        outs = [c["out"] for c in self._cache.values() if "out" in c]
        return {
            "analysed": len(outs),
            "qualified": sum(1 for o in outs if o["scanner"].get("qualified")),
            "ready": sum(1 for o in outs if o["status"] == "READY"),
            "confirmedD1": sum(1 for o in outs if o["d1"].get("confirmed")),
            "agree": sum(1 for o in outs if o["agreement"] == "AGREE"),
            "conflict": sum(1 for o in outs if o["agreement"] == "CONFLICT"),
            "byStatus": {k: sum(1 for o in outs if o["status"] == k) for k in ("READY", "STALE", "WARMING_UP", "INSUFFICIENT_DATA", "BLOCKED")},
        }

    def analyse_symbol(self, sym: str, scan: dict[str, Any], series: dict[tuple[str, str], dict[str, Any]], trigger: str) -> int:
        t0 = time.time()
        channels: dict[str, dict[str, Any]] = {}
        analyses: dict[str, dict[str, Any] | None] = {}
        data: dict[str, tuple[str, str]] = {}
        for tf in TFS:
            row = series.get((sym, tf))
            available = int(row["candle_count"] or 0) if row else hs.candle_stats(sym, tf)[0]
            data[tf] = vision.data_status(tf, row, available)
            a = None
            if (scan["qualified"] or CONFIG["analyseUnpromoted"]) and data[tf][0] in ("READY", "STALE") and available >= vision.TF_CFG[tf]["minBars"]:
                need = vision.TF_CFG[tf]["lookback"] + CONFIG["extraBars"]
                bars = hs.candle_tail(sym, tf, need)
                if len(bars) >= vision.TF_CFG[tf]["minBars"]:
                    a = vision.analyse_tf(tf, bars)
                    a["available"] = available
                else:
                    data[tf] = ("INSUFFICIENT_DATA", f"{tf}: {len(bars)}/{vision.TF_CFG[tf]['minBars']} closed bars readable")
            analyses[tf] = a
            channels[tf] = {"data": data[tf], "available": available, "required": vision.TF_CFG[tf]["minBars"], "analysis": a}

        out = vision.combine(sym, scan, analyses["D1"], analyses["H8"], data["D1"], data["H8"], analyses.get("H1"), data.get("H1"))
        for tf in TFS:
            a = analyses[tf]
            out[tf.lower()]["available"] = channels[tf]["available"]
            out[tf.lower()]["required"] = channels[tf]["required"]
            if a:
                out[tf.lower()]["reason"] = a["reason"]

        # Channel events feed the event bus / Stage 6 triggers, so visibility-only analyses stay silent.
        events = self._events(sym, analyses, data) if scan["qualified"] else []
        new = vs.persist(out, channels, events, trigger, int((time.time() - t0) * 1000))
        self._cache[sym] = {"out": out, "analyses": analyses}
        for tf in TFS:
            a = analyses[tf]
            self._prev_channels[(sym, tf)] = {
                "channelKey": a.get("channelKey") if a else None, "status": a["status"] if a else None,
                "direction": a["direction"] if a else None, "phase": a["phase"] if a else None,
                "volState": a["volState"] if a else None, "dataStatus": data[tf][0],
            }
        return len(new)

    def _events(self, sym: str, analyses: dict[str, dict[str, Any] | None], data: dict[str, tuple[str, str]]) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        for tf in TFS:
            a = analyses[tf]
            prev = self._prev_channels.get((sym, tf))
            if a and a.get("channelKey"):
                for e in a["events"]:
                    events.append({**e, "tf": tf, "channelKey": a["channelKey"]})
            key = (a or {}).get("channelKey") or "-"
            ts = (a or {}).get("lastTs") or int(time.time())
            if prev:
                if prev.get("dataStatus") != data[tf][0]:
                    events.append({"tf": tf, "type": "DATA_BLOCKED" if data[tf][0] == "BLOCKED" else "DATA_STATUS", "ts": ts,
                                   "channelKey": key, "detail": f"{tf} data {prev.get('dataStatus')} → {data[tf][0]}: {data[tf][1]}"})
                if a and prev.get("channelKey") and prev["channelKey"] != a.get("channelKey"):
                    events.append({"tf": tf, "type": "NEW_CHANNEL", "ts": ts, "channelKey": key,
                                   "detail": f"New {tf} channel selected ({a['status']}, {a['anchorSide'].lower()} anchor) replacing {prev['channelKey']}"})
                elif a and prev.get("status") and prev["status"] != a["status"]:
                    events.append({"tf": tf, "type": "STATUS_CHANGE", "ts": ts, "channelKey": key,
                                   "detail": f"{tf} channel {prev['status']} → {a['status']}"})
                if a and prev.get("direction") and prev["direction"] != a["direction"]:
                    events.append({"tf": tf, "type": "DIRECTION_CHANGE", "ts": ts, "channelKey": key,
                                   "detail": f"{tf} direction {prev['direction']} → {a['direction']}"})
                if a and prev.get("volState") and prev["volState"] != a["volState"]:
                    events.append({"tf": tf, "type": "VOLATILITY_SHIFT", "ts": ts, "channelKey": key,
                                   "detail": f"{tf} volatility {prev['volState']} → {a['volState']} (ATR ratio {a['volRatio']:.2f})"})
        return events

    def _persist_error(self, sym: str, scan: dict[str, Any], exc: Exception, trigger: str) -> None:
        msg = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
        err = ("BLOCKED", f"Stage 5 analysis error: {msg}"[:380])
        out = vision.combine(sym, scan, None, None, err, err)
        try:
            vs.persist(out, {tf: {"data": err, "available": 0, "required": vision.TF_CFG[tf]["minBars"], "analysis": None} for tf in TFS},
                       [{"tf": "D1", "type": "ANALYSIS_ERROR", "ts": int(time.time()), "detail": msg}], trigger, 0)
        except Exception:
            traceback.print_exc()

    # ------------------------------------------------------------ live boundary monitoring
    def _live_check(self) -> None:
        if not self.tick_fn or not self._cache:
            return
        try:
            ticks = self.tick_fn(list(self._cache))
        except Exception:
            return
        now = time.time()
        rows: list[tuple] = []
        for sym, cached in self._cache.items():
            t = ticks.get(sym)
            if not t or not t.get("bid"):
                continue
            price = (t["bid"] + (t.get("ask") or t["bid"])) / 2
            tick_ts = t.get("time")
            live_ok = tick_ts is not None and now - int(tick_ts) <= CONFIG["liveMaxTickAgeSec"]
            pos = {}
            events: list[dict[str, Any]] = []
            for tf in TFS:
                a = (cached.get("analyses") or {}).get(tf)
                if not a or not a.get("def") or a["status"] == "INVALIDATED":
                    pos[tf] = None
                    continue
                d = a["def"]
                k = a["ageBars"] + 1
                base = d["anchorPrice"] + d["slope"] * k
                other = base + d["sgn"] * d["width"]
                lo, hi = (base, other) if d["sgn"] > 0 else (other, base)
                p = (price - lo) / (hi - lo) * 100 if hi > lo else None
                pos[tf] = round(p, 2) if p is not None else None
                if p is None or not live_ok:
                    continue
                bt = vision.CONFIG["breakTolAtr"] * a["atr"]
                ap = vision.CONFIG["approachPct"]
                zone = ("BREACH_UP" if price > hi + bt else "BREACH_DOWN" if price < lo - bt else
                        "UPPER" if p >= 100 - ap else "LOWER" if p <= ap else "INSIDE")
                forming_ts = int(a["lastTs"]) + vision.TF_SEC[tf]
                prev_zone = self._zones.get((sym, tf))
                self._zones[(sym, tf)] = zone
                if prev_zone is not None and zone != prev_zone and zone != "INSIDE":
                    typ = "INTRABAR_BREACH" if zone.startswith("BREACH") else "BOUNDARY_APPROACH"
                    what = {"BREACH_UP": "above the upper boundary (unconfirmed until close)",
                            "BREACH_DOWN": "below the lower boundary (unconfirmed until close)",
                            "UPPER": f"approaching the upper boundary ({p:.0f}%)", "LOWER": f"approaching the lower boundary ({p:.0f}%)"}[zone]
                    events.append({"tf": tf, "type": typ, "ts": forming_ts, "price": price, "channelKey": a.get("channelKey"),
                                   "detail": f"{tf} live price {what}"})
                move = abs(price - a["lastClose"]) / a["atr"] if a["atr"] else 0
                if move >= CONFIG["volSpikeAtr"] and self._spikes.get((sym, tf)) != forming_ts:
                    self._spikes[(sym, tf)] = forming_ts
                    events.append({"tf": tf, "type": "VOLATILITY_SPIKE", "ts": forming_ts, "price": price, "channelKey": a.get("channelKey"),
                                   "detail": f"{tf} intrabar move {move:.1f} ATR from the last close"})
            rows.append((price, pos.get("D1"), pos.get("H8"), tick_ts, live_ok, sym))
            if events:
                try:
                    if vs.add_events(sym, events):
                        self.mark([sym], events[0]["type"])
                except Exception:
                    traceback.print_exc()
        try:
            vs.update_live(rows)
        except Exception:
            traceback.print_exc()
