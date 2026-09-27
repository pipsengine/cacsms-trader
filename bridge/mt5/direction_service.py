"""Stage 6 autonomous runner: Stage 4 candidates + Stage 5 D1/H8 vision -> structural decision -> SQL Server -> Stage 7.

Runs on a bridge background thread, independent of any browser session. Re-evaluation is event driven:
material Stage 2 strength changes and Stage 3 regime transitions (as published in the Stage 4 record), Stage 4
ranking/promotion changes, Stage 5 channel/phase/agreement changes, D1/H8 candle closes, breakouts and retests,
live channel-zone changes and freshness changes, plus a periodic sweep. Stage 6 never places trades.
"""

from __future__ import annotations

import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable

try:
    import analysis_gate
    import direction
    import direction_store as ds
    import regime
except ImportError:  # pragma: no cover
    from bridge.mt5 import analysis_gate  # type: ignore
    from bridge.mt5 import direction  # type: ignore
    from bridge.mt5 import direction_store as ds  # type: ignore
    from bridge.mt5 import regime  # type: ignore

SYMBOLS: list[str] = list(regime.SYMBOLS)

CONFIG: dict[str, Any] = {
    "loopSec": 10,
    "fullEverySec": 300,
    "materialStrength": 0.5,   # Stage 4 differential move (±10 scale) that counts as a material strength change
}


def _scanner_sig(r: dict[str, Any]) -> tuple:
    return (r.get("state"), r.get("direction"), int(float(r.get("conviction") or 0) // 5), (r.get("freshness") or {}).get("status"))


def _regimes(r: dict[str, Any]) -> tuple:
    return ((r.get("base") or {}).get("regime"), (r.get("quote") or {}).get("regime"))


def _vision_sig(v: dict[str, Any]) -> tuple:
    d1, h8 = v.get("d1") or {}, v.get("h8") or {}
    return (v.get("status"), v.get("primaryDirection"), v.get("agreement"), v.get("phase"), bool((v.get("scanner") or {}).get("qualified")),
            d1.get("status"), d1.get("phase"), d1.get("direction"), d1.get("channelKey"),
            h8.get("status"), h8.get("phase"), h8.get("direction"), h8.get("channelKey"))


def _breakout_sig(v: dict[str, Any]) -> tuple:
    out = []
    for tf in ("d1", "h8"):
        b = (v.get(tf) or {}).get("breakout") or {}
        out.append((b.get("ts"), bool(b.get("retesting"))))
    return tuple(out)


class DirectionService:
    def __init__(self, on_ready_change: Callable[[list[str]], None] | None = None):
        self.on_ready_change = on_ready_change
        self._pending: set[str] = set()
        self._plock = threading.Lock()
        self._run_lock = threading.Lock()
        self._wake = threading.Event()
        self._seen: dict[str, Any] | None = None
        self._decisions: dict[str, dict[str, Any]] | None = None
        self._last_full = 0.0
        self.meta: dict[str, Any] = {"status": "STARTING", "message": "Stage 6 starting", "runs": 0, "errors": 0}
        self.thread: threading.Thread | None = None

    # ------------------------------------------------------------ triggers
    def mark(self, reason: str, *_: Any) -> None:
        with self._plock:
            self._pending.add(reason)
        self._wake.set()

    def on_stage5_run(self, symbols: list[str]) -> None:
        self.mark("STAGE5_RUN")

    def on_candles(self, timeframe: str, symbols: list[str], kind: str = "INCREMENTAL") -> None:
        if timeframe in ("D1", "H8"):
            self.mark(f"{'HISTORY_REPAIR' if kind == 'REPAIR' else 'NEW_CANDLE'} {timeframe}")

    def start(self) -> None:
        ds.ensure_direction_schema()
        self.thread = threading.Thread(target=self._loop, name="direction-stage6", daemon=True)
        self.thread.start()

    def _loop(self) -> None:
        time.sleep(4)
        self.mark("STARTUP")
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

    # ------------------------------------------------------------ detection
    def _signatures(self, inp: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
        sc, vi = inp["scanner"], inp["vision"]
        by = {r["symbol"]: r for r in rows}
        return {
            "scanner": {s: _scanner_sig(r) for s, r in sc.items()},
            "diff": {s: r.get("differential") for s, r in sc.items()},
            "regimes": {s: _regimes(r) for s, r in sc.items()},
            "vision": {s: _vision_sig(v) for s, v in vi.items()},
            "d1": {s: (v.get("d1") or {}).get("lastTs") for s, v in vi.items()},
            "h8": {s: (v.get("h8") or {}).get("lastTs") for s, v in vi.items()},
            "breakout": {s: _breakout_sig(v) for s, v in vi.items()},
            "zone": {s: r["zone"]["name"] for s, r in by.items()},
            "fresh": {s: r["freshness"]["status"] for s, r in by.items()},
        }

    def _detect(self, sig: dict[str, Any]) -> list[str]:
        prev = self._seen
        if prev is None:
            return []
        out: list[str] = []

        def changed(key: str) -> list[str]:
            return sorted(s for s in set(sig[key]) | set(prev[key]) if sig[key].get(s) != prev[key].get(s))

        if (c := changed("scanner")):
            out.append(f"STAGE4_RANKING_CHANGE {','.join(c[:6])}")
        moved = sorted(s for s, d in sig["diff"].items()
                       if d is not None and (prev["diff"].get(s) is None or abs(d - prev["diff"][s]) >= CONFIG["materialStrength"]))
        if moved:
            out.append(f"STRENGTH_CHANGE {','.join(moved[:6])}")
        if (c := changed("regimes")):
            out.append(f"REGIME_TRANSITION {','.join(c[:6])}")
        if (c := changed("vision")):
            out.append(f"STAGE5_STRUCTURE_CHANGE {','.join(c[:6])}")
        # candle closes / breakouts only count on a timeframe that was already analysed (not a first analysis)
        for tf in ("d1", "h8"):
            if any(prev[tf].get(s) is not None and sig[tf].get(s) is not None for s in changed(tf)):
                out.append(f"NEW_CANDLE {tf.upper()}")
        for s in changed("breakout"):
            now, was = sig["breakout"].get(s) or (), prev["breakout"].get(s) or ()
            for i, tf in enumerate(("D1", "H8")):
                if prev[tf.lower()].get(s) is None:
                    continue
                a = now[i] if len(now) > i else (None, False)
                b = was[i] if len(was) > i else (None, False)
                if a[0] and a[0] != b[0]:
                    out.append(f"BREAKOUT {tf} {s}")
                elif a[1] and not b[1]:
                    out.append(f"RETEST {tf} {s}")
        if (c := changed("zone")):
            out.append(f"CHANNEL_POSITION_CHANGE {','.join(c[:6])}")
        if (c := changed("fresh")):
            out.append(f"FRESHNESS_CHANGE {','.join(c[:6])}")
        return out

    # ------------------------------------------------------------ run
    def _evaluate(self, inp: dict[str, Any]) -> list[dict[str, Any]]:
        run_at = (inp.get("visionRun") or {}).get("runAt")
        return direction.evaluate_all(SYMBOLS, inp["scanner"], inp["vision"], run_at, time.time())

    def tick(self) -> dict[str, Any]:
        inp = ds.upstream()
        rows = self._evaluate(inp)
        sig = self._signatures(inp, rows)
        detected = self._detect(sig)
        # material strength is measured from the last evaluated differential, not drift since the previous poll
        if self._seen is None or any(t.startswith("STRENGTH_CHANGE") for t in detected):
            base_diff = sig["diff"]
        else:
            base_diff = self._seen["diff"]
        self._seen = {**sig, "diff": base_diff}
        if time.time() - self._last_full >= CONFIG["fullEverySec"]:
            self._last_full = time.time()
            detected.append("PERIODIC")
        with self._plock:
            pending, self._pending = self._pending, set()
        triggers = sorted(pending | set(detected))
        if not triggers:
            return {"ran": False}
        return self.run(triggers, inp, rows)

    def run(self, triggers: list[str], inp: dict[str, Any] | None = None, rows: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        with self._run_lock:
            started = time.time()
            inp = inp or ds.upstream()
            rows = rows if rows is not None else self._evaluate(inp)
            if self._decisions is None:
                try:
                    self._decisions = ds.previous_decisions()
                except Exception:
                    self._decisions = {}
            changed: dict[str, dict[str, Any]] = {}
            for r in rows:
                p = self._decisions.get(r["symbol"])
                if p is None or direction.decision_signature(p) != direction.decision_signature(r):
                    changed[r["symbol"]] = {"state": (p or {}).get("state"), "direction": (p or {}).get("direction")}
            c = direction.counters(rows)
            vrun, srun = inp.get("visionRun") or {}, inp.get("scannerRun") or {}
            upstream_ok = vrun.get("status") in ("HEALTHY", "DEGRADED") and srun.get("status") in ("HEALTHY", "DEGRADED")
            ready_now = sorted(r["symbol"] for r in rows if r["readyForH1"])
            ready_before = sorted(s for s, o in self._decisions.items() if o.get("readyForH1"))
            self.meta.update({
                "status": "HEALTHY" if upstream_ok else "DEGRADED",
                "message": f"{c['candidates']} Stage 4 candidates · {c['aligned']} D1/H8 aligned · {c['pullbackWaiting']} pullback/waiting · "
                           f"{c['conflicts']} conflicts · {c['ready']} ready for H1"
                           + ("" if upstream_ok else f" · upstream Stage 4 {srun.get('status') or 'not run'} / Stage 5 {vrun.get('status') or 'not run'}"),
                "runAt": datetime.now(timezone.utc).isoformat(),
                "triggers": triggers[:14],
                "runs": self.meta.get("runs", 0) + 1,
                "counters": c,
                "readyNow": ready_now,
                "changes": [{"symbol": s, "from": v.get("state"), "to": next(r["state"] for r in rows if r["symbol"] == s)}
                            for s, v in list(changed.items())[:40]],
                "upstream": {"scannerRunAt": srun.get("runAt"), "scannerStatus": srun.get("status"),
                             "visionRunAt": vrun.get("runAt"), "visionStatus": vrun.get("status"),
                             "promoted": len(srun.get("promotedNow") or [])},
                "config": {"engine": direction.CONFIG, "service": CONFIG},
            })
            self.meta["durationMs"] = int((time.time() - started) * 1000)
            run_id = ds.persist(rows, changed, self.meta, triggers)
            if run_id is not None:
                self.meta["runId"] = run_id
            self.meta["durationMs"] = int((time.time() - started) * 1000)
            self.meta["changed"] = len(changed)
            ds.save_meta(self.meta)
            self._decisions = {r["symbol"]: r for r in rows}
            if ready_now != ready_before and self.on_ready_change:
                try:
                    self.on_ready_change(sorted(set(ready_now) ^ set(ready_before)))
                except Exception:
                    traceback.print_exc()
            return {"ran": True, "changed": len(changed), "ready": len(ready_now), "triggers": triggers}
