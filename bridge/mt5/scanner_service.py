"""Stage 4 autonomous runner: Stage 1 readiness + Stage 2/3 strength and regimes -> ranking -> promotion -> SQL Server.

Runs on a bridge background thread, independent of any browser session. Re-ranking is event driven: a Stage 3
run or regime transition, a material strength change, new D1/H8/H1 candle closes, Stage 1 freshness or block
changes, and Stage 5 qualification changes, plus a periodic freshness sweep. Promotion changes are pushed to
Stage 5 HTF Market Vision immediately. The scanner never places trades.
"""

from __future__ import annotations

import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable

try:
    import history_store as hs
    import scanner
    import scanner_store as ss
except ImportError:  # pragma: no cover
    from bridge.mt5 import history_store as hs  # type: ignore
    from bridge.mt5 import scanner  # type: ignore
    from bridge.mt5 import scanner_store as ss  # type: ignore

SYMBOLS = scanner.SYMBOLS

CONFIG: dict[str, Any] = {
    "loopSec": 15,
    "fullEverySec": 600,
    "materialStrength": 0.5,   # composite change (±10 scale) that counts as a material strength change
}


class ScannerService:
    def __init__(self, tick_fn: Callable[[list[str]], dict[str, dict[str, Any]]] | None = None,
                 context_fn: Callable[[], dict[str, Any]] | None = None,
                 on_promotion_change: Callable[[list[str], str], None] | None = None):
        self.tick_fn = tick_fn
        self.context_fn = context_fn or (lambda: {"providerOk": False, "marketOpen": False})
        self.on_promotion_change = on_promotion_change
        self._pending: set[str] = set()
        self._plock = threading.Lock()
        self._run_lock = threading.Lock()
        self._wake = threading.Event()
        self._assets_seen: dict[str, tuple[float, str | None]] | None = None
        self._regime_run: str | None = None
        self._stage1_seen: dict[str, str] | None = None
        self._d1_seen: dict[str, Any] | None = None
        self._down_seen: dict[str, tuple] | None = None
        self._rank_sig: str | None = None
        self._promoted: set[str] | None = None
        self._last_full = 0.0
        self.meta: dict[str, Any] = {"status": "STARTING", "message": "Stage 4 starting", "runs": 0, "errors": 0}
        self.thread: threading.Thread | None = None

    # ------------------------------------------------------------ triggers
    def mark(self, reason: str) -> None:
        with self._plock:
            self._pending.add(reason)
        self._wake.set()

    def on_candles(self, timeframe: str, symbols: list[str], kind: str = "INCREMENTAL") -> None:
        if timeframe in scanner.STAGE1_TFS:
            self.mark(f"{'HISTORY_REPAIR' if kind == 'REPAIR' else 'NEW_CANDLE'} {timeframe}")

    def start(self) -> None:
        ss.ensure_scanner_schema()
        self.thread = threading.Thread(target=self._loop, name="scanner-stage4", daemon=True)
        self.thread.start()

    def _loop(self) -> None:
        time.sleep(2)
        self.mark("STARTUP")
        while True:
            self._wake.wait(timeout=CONFIG["loopSec"])
            self._wake.clear()
            try:
                self.tick()
            except Exception as exc:  # pragma: no cover
                self.meta["errors"] = self.meta.get("errors", 0) + 1
                self.meta["lastError"] = f"{type(exc).__name__}: {exc}"
                traceback.print_exc()

    # ------------------------------------------------------------ inputs
    def _inputs(self) -> dict[str, Any]:
        ctx = self.context_fn()
        series = hs.series_all()
        ticks: dict[str, dict[str, Any]] = {}
        if self.tick_fn:
            try:
                ticks = self.tick_fn(SYMBOLS)
            except Exception:
                ticks = {}
        now = time.time()
        stage1 = {
            s: scanner.stage1_readiness(s, {tf: series.get((s, tf)) for tf in scanner.STAGE1_TFS}, ctx.get("providerOk"),
                                        ticks.get(s), bool(ctx.get("marketOpen")), now)
            for s in SYMBOLS
        }
        return {
            "assets": ss.latest_assets(), "regimeMeta": ss.regime_meta(), "series": series, "stage1": stage1,
            "downstream": ss.downstream(), "context": ctx,
        }

    def _detect(self, inp: dict[str, Any]) -> list[str]:
        triggers: list[str] = []
        run_at = (inp["regimeMeta"] or {}).get("runAt")
        if self._regime_run is not None and run_at != self._regime_run:
            triggers.append("REGIME_RUN")
        self._regime_run = run_at

        seen = {a: (float(r["composite"]), r.get("regime")) for a, r in inp["assets"].items() if r.get("composite") is not None}
        if self._assets_seen is not None:
            moved = [a for a, (c, _) in seen.items() if a not in self._assets_seen or abs(c - self._assets_seen[a][0]) >= CONFIG["materialStrength"]]
            flipped = [a for a, (_, g) in seen.items() if a in self._assets_seen and g != self._assets_seen[a][1]]
            if flipped:
                triggers.append(f"REGIME_TRANSITION {','.join(sorted(flipped))}")
            if moved:
                triggers.append(f"STRENGTH_CHANGE {','.join(sorted(moved))}")
        if self._assets_seen is None or triggers:
            self._assets_seen = seen

        s1 = {s: r["status"] for s, r in inp["stage1"].items()}
        if self._stage1_seen is not None:
            changed = [s for s in SYMBOLS if s1.get(s) != self._stage1_seen.get(s)]
            blocks = [s for s in changed if "BLOCKED" in (s1.get(s), self._stage1_seen.get(s))]
            if blocks:
                triggers.append(f"STAGE1_BLOCK_CHANGE {','.join(blocks[:6])}")
            if len(changed) > len(blocks):
                triggers.append("FRESHNESS_CHANGE")
        self._stage1_seen = s1

        d1 = {s: r.get("latest_ts") for (s, tf), r in inp["series"].items() if tf == "D1"}
        if self._d1_seen is not None and d1 != self._d1_seen:
            triggers.append("NEW_CANDLE D1")
        self._d1_seen = d1

        down = inp["downstream"]
        if self._down_seen is not None and down != self._down_seen:
            triggers.append("DOWNSTREAM_QUALIFICATION_CHANGE")
        self._down_seen = down
        return triggers

    # ------------------------------------------------------------ run
    def tick(self) -> dict[str, Any]:
        inp = self._inputs()
        detected = self._detect(inp)
        if time.time() - self._last_full >= CONFIG["fullEverySec"]:
            self._last_full = time.time()
            detected.append("PERIODIC")
        with self._plock:
            pending, self._pending = self._pending, set()
        triggers = sorted(pending | set(detected))
        if not triggers:
            return {"ran": False}
        return self.run(triggers, inp)

    def run(self, triggers: list[str], inp: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._run_lock:
            started = time.time()
            inp = inp or self._inputs()
            if self._promoted is None:
                try:
                    self._promoted = ss.previously_promoted()
                except Exception:
                    self._promoted = set()
            meta_r = inp["regimeMeta"] or {}
            expected = scanner.expected_d1_date(inp["series"])
            overrides = ss.load_config()
            try:
                cfg = scanner.merge_config(overrides)
            except ValueError as exc:
                cfg = scanner.merge_config({})
                self.meta["configError"] = str(exc)
            result = scanner.rank(inp["assets"], inp["stage1"], expected, meta_r.get("status"), self._promoted, cfg)
            rows = result["instruments"]

            now_promoted = {r["symbol"] for r in rows if r["state"] == "PROMOTED"}
            changes = [{"action": "PROMOTED", "row": r, "reason": r["reason"]} for r in rows if r["symbol"] in now_promoted - self._promoted]
            changes += [{"action": "DEMOTED", "row": r, "reason": f"{r['state']}: {r['reason']}"} for r in rows if r["symbol"] in self._promoted - now_promoted]

            down = inp["downstream"]
            downstream = {
                "stage5Analysed": len(down),
                "channelQualified": sum(1 for s, (st, cf) in down.items() if st == "READY" and cf),
                "channelQualifiedPromoted": sum(1 for s, (st, cf) in down.items() if st == "READY" and cf and s in now_promoted),
            }
            sig = scanner.ranking_signature(rows)
            snapshot = sig != self._rank_sig or bool(changes)
            c = result["counters"]
            ctx = inp["context"]
            regime_ok = meta_r.get("status") in ("HEALTHY", "WARMING_UP")
            status = "HEALTHY" if regime_ok and ctx.get("providerOk") else "DEGRADED"
            self.meta.update({
                "status": status,
                "message": f"{c['available']}/{c['universe']} available · {c['directional']} regime directional · {c['promoted']} promoted to HTF Market Vision"
                           + ("" if ctx.get("providerOk") else " · MT5 provider offline")
                           + ("" if regime_ok else f" · Stage 3 {meta_r.get('status') or 'not run'}"),
                "runAt": datetime.now(timezone.utc).isoformat(),
                "triggers": triggers[:12],
                "runs": self.meta.get("runs", 0) + 1,
                "counters": c, "byState": result["byState"], "downstream": downstream,
                "marketOpen": bool(ctx.get("marketOpen")), "providerOk": bool(ctx.get("providerOk")),
                "expectedD1": str(expected) if expected else None,
                "regimeRunAt": meta_r.get("runAt"), "regimeStatus": meta_r.get("status"),
                "promotedNow": sorted(now_promoted),
                "changes": [{"symbol": ch["row"]["symbol"], "action": ch["action"]} for ch in changes],
                "config": {"engine": result["config"], "service": CONFIG, "overrides": overrides,
                           "tunable": {k: list(v) for k, v in scanner.TUNABLE.items()}},
            })
            self.meta["durationMs"] = int((time.time() - started) * 1000)
            run_id = ss.persist(result, self.meta, snapshot, changes)
            if run_id is not None:
                self.meta["snapshotId"] = run_id
            self.meta["snapshot"] = snapshot
            ss.save_meta(self.meta)
            self._rank_sig = sig
            self._promoted = now_promoted
            if changes and self.on_promotion_change:
                try:
                    self.on_promotion_change([ch["row"]["symbol"] for ch in changes], "SCANNER_QUALIFICATION_CHANGE")
                except Exception:
                    traceback.print_exc()
            return {"ran": True, "promoted": len(now_promoted), "changes": len(changes), "snapshot": snapshot, "triggers": triggers}
