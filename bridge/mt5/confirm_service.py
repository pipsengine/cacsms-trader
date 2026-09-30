"""Stage 7 autonomous runner: Stage 6 READY_FOR_H1 candidates + Stage 1 closed H1 candles -> H1 confirmation -> SQL Server -> Stage 8.

Runs on a bridge background thread, independent of any browser session. Re-evaluation is event driven: every new
H1 candle (and H1 history repair), Stage 6 decision changes (hand-off, HTF structural change, upstream invalidation),
H1 data freshness changes, intrabar BOS attempts / invalidation breaches from live price, plus a periodic sweep.
Stage 7 never places trades.
"""

from __future__ import annotations

import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable

try:
    import analysis_gate
    import confirm
    import confirm_store as cs
    import regime
except ImportError:  # pragma: no cover
    from bridge.mt5 import analysis_gate  # type: ignore
    from bridge.mt5 import confirm  # type: ignore
    from bridge.mt5 import confirm_store as cs  # type: ignore
    from bridge.mt5 import regime  # type: ignore

SYMBOLS: list[str] = list(regime.SYMBOLS)

CONFIG: dict[str, Any] = {
    "loopSec": 10,
    "fullEverySec": 300,
    "staleRunSec": 1800,   # Stage 6 older than this is treated as stale upstream
}

ACTIVE = ("MONITORING", "PULLBACK", "SETUP_FORMING", "CONFIRMING", "BREAKOUT_CONFIRMED_WAIT_RETEST", "CONFIRMED")


def _s6_sig(o: dict[str, Any]) -> tuple:
    return (o.get("state"), o.get("expectedDirection"), o.get("reasonCode"), o.get("structuralPhase"), o.get("alignment"),
            (o.get("zone") or {}).get("name"), (o.get("freshness") or {}).get("status"), int(float(o.get("confidence") or 0) // 5),
            ((o.get("d1") or {}).get("channelKey")), ((o.get("h8") or {}).get("channelKey")))


class ConfirmService:
    def __init__(self, tick_fn: Callable[[list[str]], dict[str, dict[str, Any]]] | None = None,
                 on_confirm_change: Callable[[list[str]], None] | None = None):
        self.tick_fn = tick_fn
        self.on_confirm_change = on_confirm_change
        self._pending: set[str] = set()
        self._plock = threading.Lock()
        self._run_lock = threading.Lock()
        self._wake = threading.Event()
        self._seen: dict[str, Any] | None = None
        self._decisions: dict[str, dict[str, Any]] | None = None
        self._last_full = 0.0
        self._last_h1: dict[str, int] = {}
        self.meta: dict[str, Any] = {"status": "STARTING", "message": "Stage 7 starting", "runs": 0, "errors": 0}
        self.thread: threading.Thread | None = None

    # ------------------------------------------------------------ triggers
    def mark(self, reason: str, *_: Any) -> None:
        with self._plock:
            self._pending.add(reason)
        self._wake.set()

    def on_stage6_change(self, symbols: list[str]) -> None:
        self.mark(f"STAGE6_HANDOFF_CHANGE {','.join(symbols[:6])}")

    def on_candles(self, timeframe: str, symbols: list[str], kind: str = "INCREMENTAL") -> None:
        if timeframe == "H1":
            self.mark(f"{'HISTORY_REPAIR' if kind == 'REPAIR' else 'NEW_CANDLE'} H1")

    def start(self) -> None:
        cs.ensure_confirm_schema()
        self.thread = threading.Thread(target=self._loop, name="confirm-stage7", daemon=True)
        self.thread.start()

    def _loop(self) -> None:
        time.sleep(6)
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

    # ------------------------------------------------------------ inputs
    @staticmethod
    def candidates(inp: dict[str, Any]) -> list[str]:
        return sorted(s for s, o in inp["direction"].items() if o.get("state") == "READY_FOR_H1" and o.get("handoff"))

    def _live(self, symbols: list[str]) -> dict[str, dict[str, Any]]:
        if not self.tick_fn or not symbols:
            return {}
        try:
            ticks = self.tick_fn(symbols) or {}
        except Exception:
            return {}
        out = {}
        for s, t in ticks.items():
            if t and t.get("bid"):
                out[s] = {"price": (float(t["bid"]) + float(t.get("ask") or t["bid"])) / 2, "time": t.get("time")}
        return out

    def _intrabar(self, live: dict[str, dict[str, Any]]) -> dict[str, str | None]:
        """Intrabar structural event per active candidate, against the levels of its last persisted decision."""
        out: dict[str, str | None] = {}
        for s, o in (self._decisions or {}).items():
            if o.get("state") not in ACTIVE or s not in live:
                continue
            d = 1 if str(o.get("expectedDirection") or "").startswith("BULL") else -1
            out[s] = (confirm.intrabar(o, live[s], d) or {}).get("event")
        return out

    # ------------------------------------------------------------ detection
    def _signatures(self, inp: dict[str, Any], live: dict[str, dict[str, Any]]) -> dict[str, Any]:
        return {
            "s6": {s: _s6_sig(o) for s, o in inp["direction"].items()},
            "h1": {s: r.get("latest_ts") for s, r in inp["series"].items()},
            "fresh": {s: r.get("status") for s, r in inp["series"].items()},
            "intrabar": self._intrabar(live),
        }

    def _detect(self, sig: dict[str, Any], cands: list[str]) -> list[str]:
        prev = self._seen
        if prev is None:
            return []
        out: list[str] = []

        def changed(key: str, only: list[str] | None = None) -> list[str]:
            keys = set(sig[key]) | set(prev[key])
            return sorted(s for s in keys if sig[key].get(s) != prev[key].get(s) and (only is None or s in only))

        if (c := changed("s6")):
            out.append(f"STAGE6_DECISION_CHANGE {','.join(c[:6])}")
        if any(prev["h1"].get(s) is not None for s in changed("h1", cands)):
            out.append("NEW_CANDLE H1")
        if (c := changed("fresh", cands)):
            out.append(f"FRESHNESS_CHANGE {','.join(c[:6])}")
        for s in changed("intrabar"):
            ev = sig["intrabar"].get(s)
            if ev:
                out.append(f"INTRABAR_{ev} {s}")
        return out

    # ------------------------------------------------------------ run
    def _gap(self, symbol: str, series: dict[str, Any] | None) -> int:
        """Closed H1 bars skipped since the last evaluation of this symbol. One new candle is not a miss."""
        latest = (series or {}).get("latest_ts")
        if latest is None:
            return 0
        prev = self._last_h1.get(symbol)
        if prev is None:
            stored = ((self._decisions or {}).get(symbol) or {}).get("h1") or {}
            prev = stored.get("lastTs")
        if prev is None:
            return 0
        return max(0, (int(latest) - int(prev)) // 3600 - 1)

    def _evaluate(self, inp: dict[str, Any], live: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        cands = set(self.candidates(inp))
        now = time.time()
        run = inp.get("directionRun") or {}
        run_at = run.get("runAt")
        stale_s6 = False
        if run_at:
            try:
                stale_s6 = now - datetime.fromisoformat(str(run_at).replace("Z", "+00:00")).timestamp() > CONFIG["staleRunSec"]
            except ValueError:
                stale_s6 = False
        rows = []
        for s in SYMBOLS:
            s6 = inp["direction"].get(s)
            if s6 is not None and stale_s6 and s6.get("state") == "READY_FOR_H1":
                s6 = {**s6, "state": "STALE", "reasonCode": "STAGE6_RUN_STALE", "reason": f"Stage 6 last ran at {run_at}"}
            bars = cs.h1_bars(s, confirm.CONFIG["lookback"]) if s in cands else None
            missed = self._gap(s, inp["series"].get(s)) if s in cands else 0
            rows.append(self._evaluate_symbol(s, s6, inp["series"].get(s), bars, now, live.get(s), missed))
        order = {st: i for i, st in enumerate(("CONFIRMED", "BREAKOUT_CONFIRMED_WAIT_RETEST", "CONFIRMING", "SETUP_FORMING", "PULLBACK", "MONITORING", "REJECTED",
                                                "INVALIDATED", "WARMING_UP", "STALE", "BLOCKED", "WAITING_FOR_STAGE6"))}
        rows.sort(key=lambda r: (order.get(r["state"], 99), -float(r["score"]), r["symbol"]))
        return rows

    def _evaluate_symbol(self, symbol: str, s6: dict[str, Any] | None, series: dict[str, Any] | None,
                         bars: list | None, now: float, live: dict[str, Any] | None, missed: int) -> dict[str, Any]:
        """Replay missed closed H1 bars for the audit, then decide only on the current bar."""
        events: list[str] = []
        if missed > 0 and bars:
            window = min(missed, 16)
            for end in range(max(1, len(bars) - window), len(bars)):
                chunk = bars[:end]
                past_series = {**(series or {}), "latest_ts": int(chunk[-1][0]), "candle_count": len(chunk)}
                past = confirm.evaluate(symbol, s6, past_series, chunk, now, live=None, missed_bars=0)
                if past.get("confirmed"):
                    events.append("MISSED_CONFIRMATION")
                elif past.get("state") == "BREAKOUT_CONFIRMED_WAIT_RETEST":
                    events.append("MISSED_BREAKOUT")
                elif (past.get("entry") or {}).get("timing") == "RETEST_CONFIRMED":
                    events.append("MISSED_RETEST")
                elif past.get("state") in ("REJECTED", "INVALIDATED"):
                    events.append("MISSED_INVALIDATION")
            events = list(dict.fromkeys(events))
        row = confirm.evaluate(symbol, s6, series, bars, now, live=live, missed_bars=missed)
        if missed > 0:
            timing = (row.get("entry") or {}).get("timing")
            outcome = "CURRENTLY_ACTIONABLE" if row.get("confirmed") else (
                "WAIT_RETEST" if timing == "WAIT_RETEST" else
                "WAIT_NEW_CONFIRMATION" if timing in ("WAIT_NEW_CONFIRMATION", "NONE") or row.get("reasonCode") == "MISSED_CONFIRMATION" else
                "INVALIDATED" if row.get("state") in ("REJECTED", "INVALIDATED") else
                "EXPIRED" if row.get("state") in ("STALE", "MONITORING") and not row.get("setup", {}) else
                "WAIT_NEW_CONFIRMATION"
            )
            row["reconciliation"] = {"missedBars": missed, "events": events, "outcome": outcome, "executable": bool(row.get("confirmed"))}
            if events:
                row.setdefault("reasoning", []).append(
                    "Historical structure discovered during reconnect (" + ", ".join(events) + ") — not executable retrospectively. Current outcome: " + outcome + "."
                )
        return row

    def tick(self) -> dict[str, Any]:
        inp = cs.upstream()
        cands = self.candidates(inp)
        live = self._live(cands)
        sig = self._signatures(inp, live)
        detected = self._detect(sig, cands)
        self._seen = sig
        if time.time() - self._last_full >= CONFIG["fullEverySec"]:
            self._last_full = time.time()
            detected.append("PERIODIC")
        with self._plock:
            pending, self._pending = self._pending, set()
        triggers = sorted(pending | set(detected))
        if not triggers:
            return {"ran": False}
        return self.run(triggers, inp, live)

    def run(self, triggers: list[str], inp: dict[str, Any] | None = None, live: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
        with self._run_lock:
            started = time.time()
            inp = inp or cs.upstream()
            if self._decisions is None:
                try:
                    self._decisions = cs.previous_decisions()
                except Exception:
                    self._decisions = {}
            live = live if live is not None else self._live(self.candidates(inp))
            rows = self._evaluate(inp, live)
            changed: dict[str, dict[str, Any]] = {}
            for r in rows:
                p = self._decisions.get(r["symbol"])
                if p is None or confirm.decision_signature(p) != confirm.decision_signature(r):
                    changed[r["symbol"]] = {"state": (p or {}).get("state")}
            c = confirm.counters(rows)
            drun = inp.get("directionRun") or {}
            upstream_ok = drun.get("status") in ("HEALTHY", "DEGRADED")
            missed = [s for s in self.candidates(inp) if self._gap(s, inp["series"].get(s)) > 0]
            confirmed_now = sorted(r["symbol"] for r in rows if r["confirmed"])
            confirmed_before = sorted(s for s, o in self._decisions.items() if o.get("confirmed"))
            self.meta.update({
                "status": "HEALTHY" if upstream_ok and not missed else "DEGRADED",
                "message": f"{c['candidates']} Stage 6 candidates · {c['monitoring']} monitoring · {c['confirmed']} confirmed · "
                           f"{c['rejected']} rejected · {c['invalidated']} invalidated"
                           + ("" if upstream_ok else f" · upstream Stage 6 {drun.get('status') or 'not run'}")
                           + (" · H1 PROCESSING LATE" if missed else ""),
                "runAt": datetime.now(timezone.utc).isoformat(),
                "triggers": triggers[:14],
                "runs": self.meta.get("runs", 0) + 1,
                "counters": c,
                "confirmedNow": confirmed_now,
                "candidates": self.candidates(inp),
                "missedCandles": missed[:20],
                "processing": {
                    "stage7StartedAt": datetime.fromtimestamp(started, timezone.utc).isoformat(),
                    "stage7CompletedAt": datetime.now(timezone.utc).isoformat(),
                    "processingLatencyMs": int((time.time() - started) * 1000),
                    "missed": missed[:20],
                },
                "changes": [{"symbol": s, "from": v.get("state"), "to": next(r["state"] for r in rows if r["symbol"] == s)}
                            for s, v in list(changed.items())[:40]],
                "upstream": {"directionRunAt": drun.get("runAt"), "directionStatus": drun.get("status"),
                             "ready": len((drun.get("readyNow") or []))},
                "live": sorted(live),
                "config": {"engine": confirm.CONFIG, "service": CONFIG},
            })
            self.meta["durationMs"] = int((time.time() - started) * 1000)
            run_id = cs.persist(rows, changed, self.meta, triggers)
            if run_id is not None:
                self.meta["runId"] = run_id
            self.meta["durationMs"] = int((time.time() - started) * 1000)
            self.meta["changed"] = len(changed)
            cs.save_meta(self.meta)
            self._decisions = {r["symbol"]: r for r in rows}
            for s in self.candidates(inp):
                ts = (inp["series"].get(s) or {}).get("latest_ts")
                if ts is not None:
                    self._last_h1[s] = int(ts)
            if confirmed_now != confirmed_before and self.on_confirm_change:
                try:
                    self.on_confirm_change(sorted(set(confirmed_now) ^ set(confirmed_before)))
                except Exception:
                    traceback.print_exc()
            return {"ran": True, "changed": len(changed), "confirmed": len(confirmed_now), "triggers": triggers}
