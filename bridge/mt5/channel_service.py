"""Channel Analysis autonomous runner: Stage 1 closed candles -> independent Y/Q/MN/W/D1/H8/H1 channels ->
trend-within-trend hierarchy -> persisted state -> Market World Model / event bus.

Runs on a bridge background thread for all 29 instruments, independent of any browser session and of Market Scanner
promotion. Only the timeframes whose source candles changed are recalculated (MN1 feeds Y/Q/MN, W1 feeds W, D1/H8/H1
feed themselves); the hierarchy and interpretation of that instrument are rebuilt after every recalculation. Live
price only updates positions and emits boundary approach / intrabar breach events; closed candles alone change a
channel. Operator re-analysis is a diagnostic that forces a recalculation through the same path.
"""

from __future__ import annotations

import copy
import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable

try:
    import analysis_gate
    import channel_analysis as ca
    import channel_store as cs
    import history_store as hs
    import regime
    import vision
except ImportError:  # pragma: no cover
    from bridge.mt5 import analysis_gate  # type: ignore
    from bridge.mt5 import channel_analysis as ca  # type: ignore
    from bridge.mt5 import channel_store as cs  # type: ignore
    from bridge.mt5 import history_store as hs  # type: ignore
    from bridge.mt5 import regime  # type: ignore
    from bridge.mt5 import vision  # type: ignore

SYMBOLS: list[str] = list(regime.SYMBOLS)

CONFIG: dict[str, Any] = {
    "loopSec": 20,
    "liveMaxTickAgeSec": 600,
    "mn1History": 10000,
}
FORCE_PREFIXES = ("MANUAL", "DIAGNOSTIC", "REANALYSE", "CONFIG")
PERSISTED_EVENTS = ("VALIDATION", "BREAKOUT", "RETEST", "FAILED_BREAKOUT", "INVALIDATION")


def data_state(tf: str, row: dict[str, Any] | None) -> tuple[str, str]:
    """Stage 1 readiness of the series a channel timeframe is read from."""
    src = ca.SOURCE_TF[tf]
    if not row:
        return "WARMING_UP", f"{src}: no Stage 1 series checkpoint yet"
    st = row.get("status") or "WARMING_UP"
    why = row.get("reason") or st
    n = int(row.get("candle_count") or 0)
    if st in ("PROVIDER_OFFLINE", "VALIDATION_FAILED"):
        return "BLOCKED", f"{src} Stage 1 {st}: {why}"
    if st == "STALE":
        return "STALE", f"{src} Stage 1 STALE: {why}"
    if st in ("READY", "SYNCING"):
        return "READY", f"{src}: {n} validated closed candles"
    return "WARMING_UP", f"{src} Stage 1 {st}: {why} ({n} candles)"


class ChannelService:
    def __init__(self, tick_fn: Callable[[list[str]], dict[str, dict[str, Any]]] | None = None,
                 connected_fn: Callable[[], bool] | None = None,
                 on_change: Callable[[list[str], dict[str, Any]], None] | None = None,
                 on_event: Callable[[str, list[dict[str, Any]]], None] | None = None,
                 server_now_fn: Callable[[], int | None] | None = None):
        self.tick_fn = tick_fn
        self.server_now_fn = server_now_fn
        self.connected_fn = connected_fn
        self.on_change = on_change
        self.on_event = on_event
        self._dirty: dict[str, set[str]] = {}
        self._reasons: dict[str, str] = {}
        self._dlock = threading.Lock()
        self._run_lock = threading.Lock()
        self._wake = threading.Event()
        self._cache: dict[str, dict[str, dict[str, Any]]] = {}
        self._versions: dict[str, str] = {}
        self._series_sig: dict[tuple[str, str], tuple] | None = None
        self._zones: dict[tuple[str, str], str] = {}
        self._live: dict[str, dict[str, Any]] = {}
        self.meta: dict[str, Any] = {"status": "STARTING", "message": "Channel Analysis starting", "runs": 0, "errors": 0,
                                     "configVersion": ca.CONFIG["version"]}
        self.thread: threading.Thread | None = None

    # ------------------------------------------------------------ triggers
    def mark(self, symbols: list[str] | None, reason: str, timeframes: list[str] | None = None) -> None:
        tfs = [t for t in (timeframes or ca.TIMEFRAMES) if t in ca.TIMEFRAMES]
        with self._dlock:
            for s in symbols or SYMBOLS:
                if s in SYMBOLS and tfs:
                    self._dirty.setdefault(s, set()).update(tfs)
                    prev = self._reasons.get(s)
                    self._reasons[s] = reason if not prev or reason.startswith(FORCE_PREFIXES) else prev
        self._wake.set()

    @staticmethod
    def derived(source_tf: str | None) -> list[str] | None:
        """Channel timeframes read from a Stage 1 series; None means every timeframe."""
        return list(ca.DERIVED[source_tf]) if source_tf in ca.DERIVED else None

    def on_candles(self, source_tf: str, symbols: list[str], kind: str = "INCREMENTAL") -> None:
        tfs = ca.DERIVED.get(source_tf)
        if tfs:
            self.mark(symbols, f"{'HISTORY_REPAIR' if kind == 'REPAIR' else 'NEW_CANDLE'} {source_tf}", list(tfs))

    def start(self) -> None:
        cs.ensure_schema()
        try:
            for (sym, tf), snap in cs.load_states().items():
                self._cache.setdefault(sym, {})[tf] = snap
            self._versions = cs.load_versions()
        except Exception:
            traceback.print_exc()
        summary = self.summary()
        self.meta.update({"restoredInstruments": len(self._cache), "summary": summary,
                          "message": f"Restored {summary['analysed']}/{len(SYMBOLS)} persisted instruments · "
                                     f"{summary['validChannels']} valid channels — reconciling against Stage 1"})
        self.thread = threading.Thread(target=self._loop, name="channel-analysis", daemon=True)
        self.thread.start()

    def _loop(self) -> None:
        time.sleep(4)
        while True:
            try:
                if not analysis_gate.paused():
                    self.tick()
                else:
                    self.meta["status"] = "PAUSED"
            except Exception as exc:  # pragma: no cover
                self.meta["errors"] = int(self.meta.get("errors") or 0) + 1
                self.meta["lastError"] = f"{type(exc).__name__}: {exc}"
                self.meta["status"] = "DEGRADED"
                traceback.print_exc()
            self._wake.wait(timeout=CONFIG["loopSec"])
            self._wake.clear()

    def tick(self) -> dict[str, Any]:
        series = hs.series_all()
        self._reconcile(series)
        self._live_check()
        with self._dlock:
            dirty, self._dirty = self._dirty, {}
            reasons, self._reasons = self._reasons, {}
        if dirty:
            return self.run(dirty, reasons, series)
        self._idle()
        return {"analysed": 0}

    def _idle(self) -> None:
        if self.meta.get("status") in ("STARTING", "PAUSED"):
            self.meta["status"] = "HEALTHY"
        if "reconciling" in str(self.meta.get("message") or ""):
            s = self.summary()
            self.meta.update({"summary": s, "message": f"Up to date — {s['analysed']}/{len(SYMBOLS)} instruments · "
                                                       f"{s['validChannels']} valid channels · {s['nested']} nested corrections"})

    def _reconcile(self, series: dict[tuple[str, str], dict[str, Any]]) -> None:
        """Series signature check: new/repaired candles or readiness changes mark only the derived timeframes.
        On the first pass after start it compares against the persisted state, so an unchanged series is not reanalysed."""
        sig = {(s, tf): (r.get("status"), r.get("latest_ts"), r.get("candle_count")) for (s, tf), r in series.items() if tf in ca.DERIVED}
        if self._series_sig is None:
            for sym in SYMBOLS:
                stale = [tf for tf in ca.TIMEFRAMES if self._needs(sym, tf, series)]
                if stale:
                    self.mark([sym], "STARTUP_RECONCILE", stale)
        else:
            for (sym, src), v in sig.items():
                if self._series_sig.get((sym, src)) != v and sym in SYMBOLS:
                    self.mark([sym], f"STAGE1_DATA_CHANGE {src}", list(ca.DERIVED[src]))
        self._series_sig = sig

    def _needs(self, sym: str, tf: str, series: dict[tuple[str, str], dict[str, Any]]) -> bool:
        snap = (self._cache.get(sym) or {}).get(tf)
        if not snap or snap.get("configVersion") != ca.CONFIG["version"]:
            return True
        row = series.get((sym, ca.SOURCE_TF[tf]))
        latest = row.get("latest_ts") if row else None
        return snap.get("sourceBarTs") != latest or snap.get("dataStatus") != data_state(tf, row)[0]

    # ------------------------------------------------------------ analysis
    def run(self, dirty: dict[str, set[str]], reasons: dict[str, str] | None = None,
            series: dict[tuple[str, str], dict[str, Any]] | None = None) -> dict[str, Any]:
        with self._run_lock:
            started = time.time()
            reasons = reasons or {}
            series = series if series is not None else hs.series_all()
            work: dict[str, list[str]] = {}
            for sym in sorted(dirty):
                force = reasons.get(sym, "MARK").startswith(FORCE_PREFIXES)
                tfs = {tf for tf in ca.TIMEFRAMES if tf in dirty[sym] and (force or self._needs(sym, tf, series))}
                tfs |= {tf for tf in ca.TIMEFRAMES if tf not in (self._cache.get(sym) or {})}
                if tfs:
                    work[sym] = sorted(tfs, key=ca.TIMEFRAMES.index)
            if not work:
                self._idle()
                return {"analysed": 0, "failed": 0, "newEvents": 0, "changed": [], "runId": None}
            triggers = sorted({reasons.get(s, "MARK") for s in work})
            run_id = cs.start_run(", ".join(triggers)[:240], sorted(work), ca.CONFIG["version"])
            ok = failed = new_events = 0
            changed: list[str] = []
            recalculated: dict[str, list[str]] = {}
            for sym, tfs in work.items():
                reason = reasons.get(sym, "MARK")
                try:
                    did_change, n = self.analyse_symbol(sym, tfs, series, reason, run_id)
                    ok += 1
                    new_events += n
                    recalculated[sym] = tfs
                    if did_change:
                        changed.append(sym)
                except Exception as exc:
                    failed += 1
                    self.meta["lastError"] = f"{sym}: {type(exc).__name__}: {exc}"
                    traceback.print_exc()
            duration = int((time.time() - started) * 1000)
            cs.finish_run(run_id, ok, failed, new_events, duration)
            summary = self.summary()
            self.meta.update({
                "status": "HEALTHY" if failed == 0 else "DEGRADED",
                "message": f"{summary['analysed']}/{len(SYMBOLS)} instruments · {summary['validChannels']} valid channels · "
                           f"{summary['nested']} nested corrections" + (f" · {failed} failed" if failed else ""),
                "runAt": datetime.now(timezone.utc).isoformat(), "runId": run_id, "durationMs": duration,
                "analysedNow": ok, "failedNow": failed, "newEvents": new_events, "triggers": triggers[:12],
                "recalculated": {s: t for s, t in list(recalculated.items())[:29]},
                "runs": int(self.meta.get("runs") or 0) + 1, "summary": summary,
                "config": {"service": CONFIG, "engine": ca.CONFIG, "macroTimeframes": vision.MACRO_TF_CFG},
            })
            cs.save_meta(self.meta)
            if changed and self.on_change:
                try:
                    self.on_change(changed, {"runId": run_id, "hierarchies": {s: self.world_summary(s) for s in changed[:29]}})
                except Exception:
                    traceback.print_exc()
            return {"analysed": ok, "failed": failed, "newEvents": new_events, "changed": changed, "runId": run_id}

    def load_bars(self, sym: str, tf: str, mn1: list[tuple] | None = None) -> list[tuple]:
        need = vision.tf_cfg(tf)["lookback"] + ca.CONFIG["extraBars"]
        src = ca.SOURCE_TF[tf]
        if src == "MN1":
            rows = mn1 if mn1 is not None else hs.candle_tail(sym, "MN1", CONFIG["mn1History"])
            return ca.aggregate(rows, tf)[-need:]
        return ca.aggregate(hs.candle_tail(sym, src, need), tf)

    def server_now(self) -> int:
        """Current time on the candle clock (broker server time)."""
        try:
            v = self.server_now_fn() if self.server_now_fn else None
        except Exception:
            v = None
        return int(v) if v is not None else int(time.time())

    def analyse_symbol(self, sym: str, tfs: list[str], series: dict[tuple[str, str], dict[str, Any]], trigger: str, run_id: int) -> tuple[bool, int]:
        now = self.server_now()
        prev = copy.deepcopy(self._cache.get(sym) or {})
        mn1 = hs.candle_tail(sym, "MN1", CONFIG["mn1History"]) if any(ca.SOURCE_TF[t] == "MN1" for t in tfs) else None
        channels = copy.deepcopy(prev)
        for tf in tfs:
            row = series.get((sym, ca.SOURCE_TF[tf]))
            bars = self.load_bars(sym, tf, mn1)
            snap = ca.analyse_timeframe(sym, tf, bars, data_state(tf, row), now)
            snap["sourceBarTs"] = row.get("latest_ts") if row else None
            channels[tf] = snap
        edges = ca.build_hierarchy(channels)
        live = self._live.get(sym)
        interp = ca.interpret(channels, live["price"] if live else None)
        version = ca.state_version(channels, interp)

        events: list[dict[str, Any]] = []
        for tf in ca.TIMEFRAMES:
            c = channels[tf]
            events += [{**e, "tf": tf, "channelId": c.get("channelId")} for e in ca.diff_events(prev.get(tf), c)]
            if tf in tfs and c.get("channelId"):
                for e in c["evidence"]["events"]:
                    if e["kind"] in PERSISTED_EVENTS:
                        events.append({"tf": tf, "type": e["kind"], "ts": int(e["time"] / 1000), "price": e.get("price"),
                                       "channelId": c["channelId"], "detail": e["label"]})
        new = cs.persist(sym, channels, tfs, edges, interp, version, events, trigger, run_id)
        self._cache[sym] = channels
        did_change = self._versions.get(sym) != version
        self._versions[sym] = version
        if new and self.on_event:
            try:
                self.on_event(sym, new)
            except Exception:
                traceback.print_exc()
        return did_change, len(new)

    # ------------------------------------------------------------ live boundary monitoring
    def _live_check(self) -> None:
        if not self.tick_fn or not self._cache:
            return
        try:
            ticks = self.tick_fn(list(self._cache))
        except Exception:
            return
        now = time.time()
        rows: list[tuple[float, str]] = []
        for sym, channels in self._cache.items():
            t = ticks.get(sym)
            if not t or not t.get("bid"):
                continue
            price = (t["bid"] + (t.get("ask") or t["bid"])) / 2
            tick_ts = t.get("time")
            fresh = tick_ts is not None and now - int(tick_ts) <= CONFIG["liveMaxTickAgeSec"]
            self._live[sym] = {"price": price, "tickTs": tick_ts, "fresh": fresh, "at": now}
            if not fresh:
                continue
            rows.append((price, sym))
            events: list[dict[str, Any]] = []
            for tf, snap in channels.items():
                z = ca.zone(snap, price)
                if z is None:
                    continue
                prev_zone = self._zones.get((sym, tf))
                self._zones[(sym, tf)] = z
                if prev_zone is None or z == prev_zone or z == "INSIDE":
                    continue
                forming = int((snap.get("lastCandleClose") or 0) / 1000)
                what = {"BREACH_UP": "above the upper boundary (unconfirmed until the candle closes)",
                        "BREACH_DOWN": "below the lower boundary (unconfirmed until the candle closes)",
                        "UPPER": "approaching the upper boundary", "LOWER": "approaching the lower boundary"}[z]
                events.append({"tf": tf, "type": "INTRABAR_BREACH" if z.startswith("BREACH") else "BOUNDARY_APPROACH",
                               "ts": forming, "price": price, "channelId": snap.get("channelId"),
                               "detail": f"{tf} live price {what}"})
            if events:
                try:
                    new = cs.add_events(sym, events)
                    if new and self.on_event:
                        self.on_event(sym, new)
                except Exception:
                    traceback.print_exc()
        try:
            cs.update_live(rows)
        except Exception:
            traceback.print_exc()

    # ------------------------------------------------------------ read models
    def live_price(self, sym: str) -> dict[str, Any] | None:
        return self._live.get(sym)

    def summary(self) -> dict[str, Any]:
        analysed = [s for s in SYMBOLS if len(self._cache.get(s) or {}) == len(ca.TIMEFRAMES)]
        valid = sum(1 for s in analysed for tf in ca.TIMEFRAMES if ca.is_valid(self._cache[s][tf]))
        nested = sum(1 for s in analysed for tf in ca.TIMEFRAMES
                     if self._cache[s][tf].get("relationship") in ("CORRECTIVE", "COUNTER_CORRECTION", "NESTED_CORRECTION"))
        by_tf = {tf: sum(1 for s in analysed if ca.is_valid(self._cache[s][tf])) for tf in ca.TIMEFRAMES}
        return {"analysed": len(analysed), "validChannels": valid, "nested": nested, "validByTimeframe": by_tf}

    def instruments(self) -> list[dict[str, Any]]:
        out = []
        for s in SYMBOLS:
            ch = self._cache.get(s) or {}
            out.append({"symbol": s, "assetClass": "METAL" if s.startswith(("XAU", "XAG")) else "FX",
                        "analysed": len(ch) == len(ca.TIMEFRAMES),
                        "validChannels": sum(1 for c in ch.values() if ca.is_valid(c))})
        return out

    def world_summary(self, sym: str) -> dict[str, Any]:
        ch = self._cache.get(sym) or {}
        return {tf: {"status": c.get("status"), "direction": c.get("direction"), "relationship": c.get("relationship"),
                     "channelId": c.get("channelId")} for tf, c in ch.items()}
