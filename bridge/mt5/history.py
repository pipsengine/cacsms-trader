"""Stage 1 autonomous historical data: MT5 -> synchronizer -> validation -> SQL Server -> quality -> workflow events.

Runs inside the bridge process on background threads, independent of any browser session.
Candle timestamps are broker server time as delivered by MT5 (rates epoch); all alignment,
weekend and freshness logic works on that scale.
"""

from __future__ import annotations

import calendar
import json
import math
import statistics
import threading
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

try:
    import history_store as store
    import regime
    from db import get_setting, set_setting
except ImportError:  # pragma: no cover
    from bridge.mt5 import history_store as store  # type: ignore
    from bridge.mt5 import regime  # type: ignore
    from bridge.mt5.db import get_setting, set_setting  # type: ignore

SYMBOLS: list[str] = list(regime.SYMBOLS)
CORE_TFS = ["MN1", "W1", "D1", "H8", "H1"]
EXEC_TFS = ["M15", "M5"]

# depth: bootstrap target (capped by what the broker actually holds); min: readiness floor for downstream engines
# (MN1/W1: one full year of macro structure; D1: regime/vision look-back).
# MetaTrader5 holds the GIL while the terminal downloads missing history, so depths stay within the ~8 years the
# terminal already keeps for D1; deeper requests freeze the whole bridge until the download finishes.
TF_SPEC: dict[str, dict[str, Any]] = {
    "MN1": {"sec": None, "depth": 96, "min": 12, "bootstrapPriority": 12},
    "W1": {"sec": 7 * 86400, "depth": 400, "min": 52, "bootstrapPriority": 11},
    "D1": {"sec": 86400, "depth": 2000, "min": 300, "bootstrapPriority": 10},
    "H8": {"sec": 8 * 3600, "depth": 3000, "min": 300, "bootstrapPriority": 14},
    "H1": {"sec": 3600, "depth": 6000, "min": 500, "bootstrapPriority": 13},
    "M15": {"sec": 900, "depth": 4000, "min": 500, "bootstrapPriority": 20},
    "M5": {"sec": 300, "depth": 4000, "min": 500, "bootstrapPriority": 21},
}

CONFIG = {
    "plannerIntervalSec": 20,
    "validateEverySec": 3600,
    "repairCooldownSec": 6 * 3600,
    "h8CheckEverySec": 24 * 3600,
    "exhaustedReprobeSec": 12 * 3600,
    "completenessReady": 99.0,
    "feedStaleSec": 300,
    "staleGraceSec": 90,
    "maxAttempts": 5,
    "recurringGapShare": 0.3,
    "closureShare": 0.5,
    "spikeFactor": 25.0,
    "spikeFloor": 0.02,
}

STATUS_ORDER = ["PROVIDER_OFFLINE", "VALIDATION_FAILED", "MISSING_HISTORY", "WARMING_UP", "STALE", "SYNCING", "READY"]

PRIORITY_MANUAL = 1
PRIORITY_INCREMENTAL = 5
PRIORITY_BACKFILL = 30
PRIORITY_REPAIR = 40
PRIORITY_VALIDATE = 50


def utc(ts: int) -> datetime:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc)


def iso_server(ts: int | None) -> str | None:
    return utc(ts).strftime("%Y-%m-%dT%H:%M:%S") if ts is not None else None


def bar_start_next(tf: str, ts: int) -> int:
    if tf == "MN1":
        d = utc(ts)
        y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
        return calendar.timegm((y, m, 1, 0, 0, 0))
    return ts + TF_SPEC[tf]["sec"]


def aligned(tf: str, ts: int) -> bool:
    d = utc(ts)
    if tf == "MN1":
        return d.day == 1 and ts % 86400 == 0
    if tf == "W1":
        return ts % 86400 == 0 and d.weekday() in (6, 0)
    return ts % TF_SPEC[tf]["sec"] == 0


def ohlc_ok(o: float, h: float, lo: float, c: float) -> bool:
    vals = (o, h, lo, c)
    if any((v is None) or (not math.isfinite(v)) or v <= 0 for v in vals):
        return False
    return h >= max(o, c) and lo <= min(o, c) and h >= lo


# ---------------------------------------------------------------- validation / normalization (pure)

def normalize_batch(tf: str, rows: list[tuple]) -> tuple[list[tuple], list[dict[str, Any]]]:
    """Sort, de-duplicate and reject structurally invalid candles before they reach the database."""
    issues: list[dict[str, Any]] = []
    ordered = all(rows[i][0] < rows[i + 1][0] for i in range(len(rows) - 1))
    if not ordered:
        issues.append({"severity": "WARNING", "code": "OUT_OF_ORDER", "message": "Provider batch was out of order; re-sorted"})
    by_ts: dict[int, tuple] = {}
    dups = 0
    for r in rows:
        if int(r[0]) in by_ts:
            dups += 1
        by_ts[int(r[0])] = r
    if dups:
        issues.append({"severity": "WARNING", "code": "DUPLICATE", "message": f"{dups} duplicate candles in provider batch collapsed"})
    clean, rejected = [], []
    for ts in sorted(by_ts):
        r = by_ts[ts]
        if not aligned(tf, ts):
            rejected.append((ts, "MISALIGNED"))
        elif not ohlc_ok(float(r[1]), float(r[2]), float(r[3]), float(r[4])):
            rejected.append((ts, "OHLC_INTEGRITY"))
        else:
            clean.append(r)
    if rejected:
        issues.append({
            "severity": "ERROR", "code": "REJECTED",
            "message": f"{len(rejected)} invalid candles rejected ({', '.join(sorted({c for _, c in rejected}))})",
            "sample": [iso_server(ts) for ts, _ in rejected[:5]],
        })
    return clean, issues


def _missing_slots(tf: str, times: list[int]) -> list[int]:
    slots: list[int] = []
    for a, b in zip(times, times[1:]):
        t = bar_start_next(tf, a)
        while t < b and len(slots) < 500_000:
            slots.append(t)
            t = bar_start_next(tf, t)
    return slots


def find_gaps(tf: str, times: list[int], closures: set[date]) -> tuple[list[list[int]], int]:
    """Abnormal gap ranges [start_ts, end_ts, missing] and the count of expected (closure) slots."""
    slots = _missing_slots(tf, times)
    if not slots:
        return [], 0
    intraday = tf in ("M5", "M15", "H1", "H8")

    def closed_market(t: int) -> bool:
        d = utc(t)
        if tf in ("W1", "MN1"):
            return False
        return d.weekday() >= 5 or d.date() in closures

    candidates = [t for t in slots if not closed_market(t)]
    expected = len(slots) - len(candidates)
    if intraday and candidates:
        days = max(1, len({t // 86400 for t in times}))
        counts: dict[int, int] = {}
        for t in candidates:
            counts[t % 86400] = counts.get(t % 86400, 0) + 1
        recurring = {k for k, n in counts.items() if n >= CONFIG["recurringGapShare"] * days}
        if recurring:
            kept = [t for t in candidates if t % 86400 not in recurring]
            expected += len(candidates) - len(kept)
            candidates = kept
    gaps: list[list[int]] = []
    for t in candidates:
        if gaps and bar_start_next(tf, gaps[-1][1]) == t:
            gaps[-1][1] = t
            gaps[-1][2] += 1
        else:
            gaps.append([t, t, 1])
    return gaps, expected


def validate_series(tf: str, rows: list[tuple], closures: set[date], provider_gaps: list[list[int]]) -> dict[str, Any]:
    """Validation of stored candles: integrity, alignment, ordering, duplicates, gaps and spikes."""
    issues: list[dict[str, Any]] = []
    integrity = misaligned = dups = ooo = 0
    prev = None
    for r in rows:
        ts = int(r[0])
        if prev is not None:
            if ts == prev:
                dups += 1
            elif ts < prev:
                ooo += 1
        if not aligned(tf, ts):
            misaligned += 1
        if not ohlc_ok(float(r[1]), float(r[2]), float(r[3]), float(r[4])):
            integrity += 1
        prev = ts
    if integrity:
        issues.append({"severity": "ERROR", "code": "OHLC_INTEGRITY", "message": f"{integrity} candles violate OHLC integrity"})
    if misaligned:
        issues.append({"severity": "ERROR", "code": "MISALIGNED", "message": f"{misaligned} candles off {tf} boundary"})
    if dups:
        issues.append({"severity": "ERROR", "code": "DUPLICATE", "message": f"{dups} duplicate timestamps"})
    if ooo:
        issues.append({"severity": "ERROR", "code": "OUT_OF_ORDER", "message": f"{ooo} out-of-order candles"})

    times = [int(r[0]) for r in rows]
    gaps, expected = find_gaps(tf, times, closures)
    confirmed = {(int(g[0]), int(g[1])) for g in provider_gaps}
    abnormal = [g for g in gaps if (g[0], g[1]) not in confirmed]
    provider_missing = sum(g[2] for g in gaps if (g[0], g[1]) in confirmed)
    missing = sum(g[2] for g in abnormal)
    n = len(rows)
    completeness = round(100.0 * n / (n + missing), 3) if n else 0.0
    if abnormal:
        issues.append({
            "severity": "WARNING", "code": "MISSING_CANDLES",
            "message": f"{missing} missing candles in {len(abnormal)} gap(s) outside expected market closures",
            "sample": [f"{iso_server(g[0])} → {iso_server(g[1])} ({g[2]})" for g in abnormal[:5]],
        })
    if provider_missing:
        issues.append({
            "severity": "INFO", "code": "PROVIDER_GAP",
            "message": f"{provider_missing} candles absent at the provider (confirmed by repair; no trading recorded)",
        })

    closes = [float(r[4]) for r in rows if float(r[4]) > 0]
    rets = [abs(math.log(b / a)) for a, b in zip(closes, closes[1:]) if a > 0 and b > 0]
    spikes = []
    if len(rets) >= 20:
        med = statistics.median(rets) or 1e-9
        limit = max(CONFIG["spikeFactor"] * med, CONFIG["spikeFloor"])
        spikes = [times[i + 1] for i, r in enumerate(rets) if r > limit]
    if spikes:
        issues.append({
            "severity": "WARNING", "code": "ABNORMAL_MOVE",
            "message": f"{len(spikes)} abnormal close-to-close moves (> max({CONFIG['spikeFactor']}× median, {CONFIG['spikeFloor']:.0%}))",
            "sample": [iso_server(t) for t in spikes[:5]],
        })
    return {
        "count": n,
        "integrityErrors": integrity + misaligned + dups + ooo,
        "gaps": abnormal,
        "missing": missing,
        "expectedMissing": expected,
        "providerMissing": provider_missing,
        "completeness": completeness,
        "spikes": len(spikes),
        "issues": issues,
    }


def closure_dates(d1_times: dict[str, list[int]]) -> set[date]:
    """Market-wide closures: weekdays on which most instruments with coverage printed no D1 candle."""
    days_by_symbol = {s: {utc(t).date() for t in ts} for s, ts in d1_times.items() if ts}
    if len(days_by_symbol) < 3:
        return set()
    spans = [(min(v), max(v), v) for v in days_by_symbol.values()]
    lo = min(s[0] for s in spans)
    hi = max(s[1] for s in spans)
    out: set[date] = set()
    d = lo
    while d <= hi:
        if d.weekday() < 5:
            covering = present = 0
            for first, last, days in spans:
                if first <= d <= last:
                    covering += 1
                    present += d in days
            if covering and present < CONFIG["closureShare"] * covering:
                out.add(d)
        d += timedelta(days=1)
    return out


def derive_h8(h1: list[tuple], complete_before: int | None) -> list[tuple]:
    """Canonical H8 from H1 on server-day boundaries (00/08/16). Only buckets whose window has ended."""
    buckets: dict[int, list[tuple]] = {}
    for r in h1:
        buckets.setdefault(int(r[0]) // 28800 * 28800, []).append(r)
    out = []
    for start in sorted(buckets):
        if complete_before is None or start + 28800 > complete_before:
            continue
        rows = buckets[start]
        out.append((
            start, float(rows[0][1]), max(float(r[2]) for r in rows), min(float(r[3]) for r in rows),
            float(rows[-1][4]), sum(int(r[5] or 0) for r in rows), max(int(r[6] or 0) for r in rows),
        ))
    return out


def evaluate_status(tf: str, count: int, validation: dict[str, Any] | None, latest: int | None, provider_latest: int | None,
                    provider_ok: bool, feed_stale: bool, job_active: bool) -> tuple[str, str]:
    spec = TF_SPEC[tf]
    if not provider_ok:
        return "PROVIDER_OFFLINE", "MT5 provider offline — data frozen at last valid candle"
    if count == 0:
        return ("SYNCING", "Bootstrap in progress") if job_active else ("MISSING_HISTORY", "No candles stored")
    if validation and validation["integrityErrors"] > 0:
        return "VALIDATION_FAILED", "; ".join(i["message"] for i in validation["issues"] if i["severity"] == "ERROR")
    if count < spec["min"]:
        return ("SYNCING" if job_active else "WARMING_UP"), f"{count}/{spec['min']} candles required"
    if validation and validation["completeness"] < CONFIG["completenessReady"]:
        return (
            "SYNCING" if job_active else "MISSING_HISTORY",
            f"{validation['missing']} missing candles in {len(validation['gaps'])} gap(s) · {validation['completeness']:.2f}% complete",
        )
    if provider_latest is not None and (latest is None or latest < provider_latest):
        return ("SYNCING" if job_active else "STALE"), f"Behind provider: last stored {iso_server(latest)}, provider closed {iso_server(provider_latest)}"
    if feed_stale:
        return "STALE", "Provider feed not ticking while market open"
    return "READY", "Available · complete · valid · fresh"


def quality_score(tf: str, count: int, validation: dict[str, Any] | None, status: str) -> float | None:
    if not validation or count == 0:
        return None
    depth = min(1.0, count / TF_SPEC[tf]["min"])
    integrity = 1.0 - min(1.0, validation["integrityErrors"] / max(1, count))
    fresh = 1.0 if status in ("READY", "SYNCING") else 0.5 if status == "STALE" else 0.0 if status == "PROVIDER_OFFLINE" else 0.8
    return round(100 * depth * (0.55 * validation["completeness"] / 100 + 0.3 * integrity + 0.15 * fresh), 1)


# ---------------------------------------------------------------- MT5 provider

class MT5Provider:
    """Serialized access to the MetaTrader5 package (not thread-safe)."""

    def __init__(self, mt5: Any, lock: Any, ensure: Callable[[], tuple[bool, str]]):
        self.mt5 = mt5
        self.lock = lock
        self.ensure = ensure

    def tf(self, name: str) -> int:
        return getattr(self.mt5, f"TIMEFRAME_{name}")

    def status(self) -> dict[str, Any]:
        with self.lock:
            ok, msg = self.ensure()
            if not ok:
                return {"connected": False, "message": msg}
            term = self.mt5.terminal_info()
            info = self.mt5.account_info()
            if not term or not term.connected:
                return {"connected": False, "message": "MT5 terminal not connected to broker"}
            return {
                "connected": True,
                "message": "MT5 connected",
                "server": info.server if info else None,
                "login": str(info.login) if info else None,
                "pingMs": int(round((term.ping_last or 0) / 1000)),
            }

    def _rows(self, rates: Any) -> list[tuple] | None:
        if rates is None:
            return None
        return [
            (int(r["time"]), float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]),
             int(r["tick_volume"]), int(r["spread"]))
            for r in rates
        ]

    def rates_from_pos(self, symbol: str, tf: str, start: int, count: int) -> list[tuple] | None:
        with self.lock:
            ok, _ = self.ensure()
            if not ok:
                return None
            self.mt5.symbol_select(symbol, True)
            return self._rows(self.mt5.copy_rates_from_pos(symbol, self.tf(tf), start, count))

    def rates_range(self, symbol: str, tf: str, from_ts: int, to_ts: int) -> list[tuple] | None:
        with self.lock:
            ok, _ = self.ensure()
            if not ok:
                return None
            self.mt5.symbol_select(symbol, True)
            return self._rows(self.mt5.copy_rates_range(symbol, self.tf(tf), int(from_ts), int(to_ts)))

    def rates_before(self, symbol: str, tf: str, before_ts: int, count: int) -> list[tuple] | None:
        with self.lock:
            ok, _ = self.ensure()
            if not ok:
                return None
            self.mt5.symbol_select(symbol, True)
            return self._rows(self.mt5.copy_rates_from(symbol, self.tf(tf), int(before_ts), int(count)))

    def tick_times(self, symbols: list[str]) -> dict[str, int]:
        with self.lock:
            ok, _ = self.ensure()
            if not ok:
                return {}
            out = {}
            for s in symbols:
                self.mt5.symbol_select(s, True)
                t = self.mt5.symbol_info_tick(s)
                if t is not None and t.time:
                    out[s] = int(t.time)
            return out


def ny_close_offset(last_tick_server: int) -> int:
    """Server-UTC offset for NY-close aligned servers, from the final tick before a market closure."""
    server_midnight = (last_tick_server // 86400 + 1) * 86400
    day = utc(last_tick_server).date()
    year = day.year
    march = date(year, 3, 8) + timedelta(days=(6 - date(year, 3, 8).weekday()) % 7)
    november = date(year, 11, 1) + timedelta(days=(6 - date(year, 11, 1).weekday()) % 7)
    close_hour_utc = 21 if march <= day < november else 22
    ny_close_utc = calendar.timegm((day.year, day.month, day.day, close_hour_utc, 0, 0))
    return server_midnight - ny_close_utc


def plausible_offset(sec: int) -> bool:
    """Broker server clocks sit between UTC-12 and UTC+14."""
    return -12 * 3600 <= sec <= 14 * 3600


def fx_market_open(now_utc: datetime) -> bool:
    wd, h = now_utc.weekday(), now_utc.hour
    if wd == 5:
        return False
    if wd == 6:
        return h >= 22
    if wd == 4:
        return h < 22
    return True


# ---------------------------------------------------------------- autonomous service

class HistoryService:
    def __init__(self, provider: MT5Provider, on_candles: Callable[[str, list[str], str], None] | None = None):
        self.provider = provider
        self.on_candles = on_candles
        self.lock = threading.RLock()
        self.provider_ok: bool | None = None
        self.provider_status: dict[str, Any] = {"connected": False, "message": "Not checked yet"}
        self.server_offset: int | None = None
        self.offset_source: str | None = None
        self.feed_stale = False
        self.last_tick_server: int | None = None
        self.last_loop_at: float | None = None
        self.loop_ms: int | None = None
        self.worker_heartbeat: float | None = None
        self.current_job: dict[str, Any] | None = None
        self.closures: set[date] = set()
        self.closures_at = 0.0
        self.closures_key: tuple = ()
        self.exhaust_probe: dict[tuple[str, str], float] = {}
        self.repaired_gaps: dict[tuple[str, str], str] = {}
        self.last_prune = 0.0
        self.recovering = False
        self.started_at: float | None = None
        self.errors = 0
        self.last_error: str | None = None
        self._stop = threading.Event()
        self._wake = threading.Event()

    # ------------------------------------------------------------ config
    def exec_enabled(self) -> bool:
        try:
            return (get_setting("history.executionTimeframes") or "false").lower() == "true"
        except Exception:
            return False

    def set_exec_enabled(self, enabled: bool) -> None:
        set_setting("history.executionTimeframes", "true" if enabled else "false")
        store.event_add("CONFIG", "INFO", f"Execution timeframes M15/M5 {'enabled' if enabled else 'disabled'}")
        self._wake.set()

    def timeframes(self) -> list[str]:
        return CORE_TFS + (EXEC_TFS if self.exec_enabled() else [])

    def _series(self, d: dict[str, Any]) -> None:
        spec = TF_SPEC[d["timeframe"]]
        store.series_upsert(d, {"status": "MISSING_HISTORY", "reason": "Not synchronized yet",
                                "required_depth": spec["depth"], "min_required": spec["min"]})

    def server_now(self) -> int | None:
        return int(time.time()) + self.server_offset if self.server_offset is not None else None

    # ------------------------------------------------------------ lifecycle
    def start(self) -> None:
        store.ensure_history_schema()
        stale = store.jobs_transition(("RUNNING", "VALIDATING"), "STALE", "Interrupted by bridge restart; re-planned")
        store.event_add("SCHEDULER_STARTED", "INFO", f"Autonomous historical synchronizer started ({stale} interrupted job(s) marked STALE)")
        try:
            saved = get_setting("history.serverOffsetSec")
            if saved is not None and plausible_offset(int(saved)):
                self.server_offset, self.offset_source = int(saved), "persisted"
        except Exception:
            pass
        self.started_at = time.time()
        threading.Thread(target=self._planner_loop, name="history-planner", daemon=True).start()
        threading.Thread(target=self._worker_loop, name="history-worker", daemon=True).start()

    def wake(self) -> None:
        self._wake.set()

    # ------------------------------------------------------------ planner
    def _planner_loop(self) -> None:
        while not self._stop.is_set():
            started = time.time()
            try:
                self.plan()
            except Exception as exc:
                self.errors += 1
                self.last_error = f"planner: {exc}"
                traceback.print_exc()
            self.loop_ms = int((time.time() - started) * 1000)
            self.last_loop_at = time.time()
            self._wake.wait(CONFIG["plannerIntervalSec"])
            self._wake.clear()

    def _learn_offset(self) -> None:
        ticks = self.provider.tick_times(["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "AUDUSD"])
        if not ticks:
            return
        t_max = max(ticks.values())
        self.last_tick_server = t_max
        now = time.time()
        drift = t_max - now
        cand = int(round(drift / 1800.0)) * 1800
        # While the market is closed the last tick is arbitrarily old, so its drift says nothing about the offset.
        if fx_market_open(datetime.now(timezone.utc)) and abs(drift - cand) <= 90 and plausible_offset(cand):
            if self.server_offset != cand:
                set_setting("history.serverOffsetSec", str(cand))
            self.server_offset, self.offset_source = cand, "live ticks"
            self.feed_stale = False
            return
        if self.server_offset is None or not plausible_offset(self.server_offset):
            self.server_offset, self.offset_source = ny_close_offset(t_max), "NY-close rule (market closed)"
        now_server = self.server_now()
        self.feed_stale = bool(
            fx_market_open(datetime.now(timezone.utc)) and now_server and now_server - t_max > CONFIG["feedStaleSec"]
        )

    def _past_grace(self, tf: str, provider_latest: int) -> bool:
        """A just-closed candle gets one propagation window before the series counts as stale."""
        now = self.server_now()
        return now is None or now - bar_start_next(tf, provider_latest) > CONFIG["staleGraceSec"]

    def _provider_latest_closed(self, symbol: str, tf: str) -> int | None:
        rows = self.provider.rates_from_pos(symbol, tf, 0, 2)
        if not rows:
            return None
        now = self.server_now()
        last = rows[-1][0]
        if now is not None and bar_start_next(tf, last) <= now:
            return last
        return rows[-2][0] if len(rows) > 1 else None

    def plan(self) -> None:
        prov = self.provider.status()
        tfs = self.timeframes()
        was = self.provider_ok
        self.provider_status = prov
        self.provider_ok = bool(prov.get("connected"))
        if not self.provider_ok:
            if was is not False:
                store.event_add("PROVIDER_DISCONNECTED", "ERROR", f"MT5 provider offline: {prov.get('message')}")
                blocked = store.jobs_transition(("QUEUED", "RETRYING"), "BLOCKED", "Provider offline")
                n = store.series_mark_all("PROVIDER_OFFLINE", "MT5 provider offline — data frozen at last valid candle", CORE_TFS + EXEC_TFS)
                store.event_add("DATA_STALE", "ERROR", f"{n} series marked PROVIDER_OFFLINE; {blocked} job(s) blocked; dependent instruments blocked in Stage 1")
            return
        trigger = "AUTO"
        if was is False:
            unblocked = store.jobs_transition(("BLOCKED",), "QUEUED", "Provider reconnected")
            store.event_add("PROVIDER_RECONNECTED", "INFO", f"MT5 provider reconnected; {unblocked} blocked job(s) resumed; recovery backfill planned")
            self.recovering = True
            trigger = "AUTO_RECOVERY"
        elif was is None:
            store.jobs_transition(("BLOCKED",), "QUEUED", "Provider available at startup")
            trigger = "AUTO_STARTUP"

        self._learn_offset()
        now = time.time()
        if now - self.last_prune > 3600:
            store.jobs_prune(30)
            self.last_prune = now

        stats = store.candle_stats_all()
        d1_coverage = tuple(sorted((k[0], v[1], v[2]) for k, v in stats.items() if k[1] == "D1"))
        if d1_coverage != self.closures_key or now - self.closures_at > CONFIG["validateEverySec"]:
            before = self.closures
            self.closures = closure_dates(store.candle_times_by_symbol("D1"))
            self.closures_at, self.closures_key = now, d1_coverage
            if self.closures != before:
                store.event_add("CLOSURES", "INFO", f"Market-wide closure calendar updated: {len(self.closures)} weekday closure(s) detected",
                                detail={"latest": sorted(d.isoformat() for d in self.closures)[-10:]})
                for (sym, tf), s in store.series_all().items():
                    if tf in ("D1", "H8", "H1", "M15", "M5") and s.get("gaps_json") not in (None, "[]"):
                        store.job_enqueue("VALIDATE", sym, tf, "AUTO_CLOSURES", PRIORITY_INCREMENTAL + 1, "Re-validate against closure calendar")
        series = store.series_all()
        pending = 0
        for sym in SYMBOLS:
            for tf in tfs:
                spec = TF_SPEC[tf]
                count, earliest, latest = stats.get((sym, tf), (0, None, None))
                s = series.get((sym, tf))
                prov_latest = self._provider_latest_closed(sym, tf)
                if s is None:
                    s = {"symbol": sym, "timeframe": tf, "status": "MISSING_HISTORY", "reason": "Not synchronized yet"}
                    self._series({**s, "provider_latest_ts": prov_latest})
                if count == 0:
                    store.job_enqueue("BOOTSTRAP", sym, tf, trigger, spec["bootstrapPriority"], "Initial history bootstrap")
                    pending += 1
                    continue
                if prov_latest is not None and (latest is None or prov_latest > latest):
                    store.job_enqueue("INCREMENTAL", sym, tf, trigger if trigger != "AUTO" else "AUTO_CANDLE", PRIORITY_INCREMENTAL,
                                      f"New closed candle(s) at provider up to {iso_server(prov_latest)}")
                    pending += 1
                if count < spec["depth"]:
                    if not s.get("provider_exhausted"):
                        store.job_enqueue("BOOTSTRAP", sym, tf, trigger, PRIORITY_BACKFILL, f"Backfill depth {count}/{spec['depth']}")
                    elif now - self.exhaust_probe.get((sym, tf), 0.0) > CONFIG["exhaustedReprobeSec"]:
                        self.exhaust_probe[(sym, tf)] = now
                        store.job_enqueue("BOOTSTRAP", sym, tf, trigger, PRIORITY_BACKFILL,
                                          f"Re-probe provider depth ({count}/{spec['depth']} held)")
                gaps_raw = s.get("gaps_json") or "[]"
                gaps = json.loads(gaps_raw)
                last_repair = s.get("last_repair_at")
                new_gaps = self.repaired_gaps.get((sym, tf)) != gaps_raw
                if gaps and (new_gaps or last_repair is None
                             or (datetime.utcnow() - last_repair).total_seconds() > CONFIG["repairCooldownSec"]):
                    store.job_enqueue("REPAIR", sym, tf, trigger, PRIORITY_REPAIR, f"{len(gaps)} gap(s) detected")
                last_val = s.get("last_validated_at")
                if s.get("candle_count") is not None and int(s["candle_count"]) != count and prov_latest == latest:
                    store.job_enqueue("VALIDATE", sym, tf, "AUTO_INTEGRITY", PRIORITY_INCREMENTAL + 1,
                                      f"Stored candle count changed outside the synchronizer ({s['candle_count']} → {count})")
                elif s.get("min_required") not in (None, spec["min"]) or s.get("required_depth") not in (None, spec["depth"]):
                    store.job_enqueue("VALIDATE", sym, tf, "AUTO_CONFIG", PRIORITY_INCREMENTAL + 1, "Readiness specification changed")
                elif last_val is None or (datetime.utcnow() - last_val).total_seconds() > CONFIG["validateEverySec"]:
                    store.job_enqueue("VALIDATE", sym, tf, "AUTO_SCHEDULE", PRIORITY_VALIDATE, "Periodic validation")
                behind = prov_latest is not None and (latest is None or prov_latest > latest)
                status, reason = s.get("status"), s.get("reason")
                if status == "PROVIDER_OFFLINE":
                    status, reason = "SYNCING", "Reconciling after provider recovery"
                    store.job_enqueue("VALIDATE", sym, tf, trigger, PRIORITY_INCREMENTAL + 1, "Reconcile after provider recovery")
                elif behind and status == "READY" and self._past_grace(tf, prov_latest):
                    status, reason = "STALE", f"Behind provider (closed {iso_server(prov_latest)}); incremental sync queued"
                if status != s.get("status") or s.get("provider_latest_ts") != prov_latest:
                    self._series({"symbol": sym, "timeframe": tf, "provider_latest_ts": prov_latest, "status": status, "reason": reason})
        if self.recovering and pending == 0 and not any(
            j["type"] in ("BOOTSTRAP", "INCREMENTAL", "REPAIR") for j in store.jobs_open()
        ):
            self.recovering = False
            store.event_add("RECOVERY_COMPLETE", "INFO", "Provider recovery reconciled: missing period backfilled and validated")

    # ------------------------------------------------------------ worker
    def _worker_loop(self) -> None:
        while not self._stop.is_set():
            self.worker_heartbeat = time.time()
            try:
                job = store.job_claim()
            except Exception as exc:
                self.errors += 1
                self.last_error = f"claim: {exc}"
                time.sleep(3)
                continue
            if not job:
                time.sleep(1.0)
                continue
            self._run_job(job)

    def _run_job(self, job: dict[str, Any]) -> None:
        jid, sym, tf, jtype = int(job["id"]), job["symbol"], job["timeframe"], job["job_type"]
        self.current_job = {"id": jid, "type": jtype, "symbol": sym, "timeframe": tf, "state": "RUNNING", "startedAt": time.time()}
        if not self.provider_ok and jtype != "VALIDATE":
            store.job_update(jid, state="BLOCKED", attempts=max(0, int(job["attempts"]) - 1), message="Provider offline")
            self.current_job = None
            return
        try:
            self._series({"symbol": sym, "timeframe": tf, "last_sync_at": datetime.utcnow()})
            fetched = inserted = revised = 0
            issues: list[dict[str, Any]] = []
            if jtype in ("BOOTSTRAP", "INCREMENTAL"):
                fetched, inserted, revised, issues = self._sync(sym, tf, jtype, jid)
            elif jtype == "REPAIR":
                fetched, inserted, revised, issues = self._repair(sym, tf)
            self.current_job["state"] = "VALIDATING"
            store.job_update(jid, state="VALIDATING", fetched=fetched, inserted=inserted, revised=revised)
            result = self.validate(sym, tf, batch_issues=issues, success=jtype != "VALIDATE")
            msg = (
                f"{jtype.title()}: fetched {fetched}, inserted {inserted}, revised {revised} · "
                f"{result['status']} · {result['completeness'] if result['completeness'] is not None else '—'}% complete"
            )
            stats = store.candle_stats(sym, tf)
            store.job_update(jid, state="COMPLETED", message=msg, checkpoint_ts=stats[2], finished=True)
            if inserted and jtype != "VALIDATE":
                store.event_add(
                    "CANDLE_CLOSED" if jtype == "INCREMENTAL" else "HISTORY_LOADED", "INFO",
                    f"{sym} {tf}: {inserted} new candle(s) persisted, latest {iso_server(stats[2])}",
                    sym, tf, jid, {"inserted": inserted, "latestTs": stats[2], "latest": iso_server(stats[2]), "type": jtype},
                )
                if jtype in ("INCREMENTAL", "REPAIR") and self.on_candles:
                    self.on_candles(tf, [sym], jtype)
            if revised:
                store.event_add("CANDLE_REVISED", "WARNING", f"{sym} {tf}: {revised} candle(s) corrected by provider", sym, tf, jid)
                if self.on_candles and not inserted:
                    self.on_candles(tf, [sym], "REPAIR")
        except Exception as exc:
            attempts = int(job["attempts"])
            final = attempts >= int(job["max_attempts"])
            state = "FAILED" if final else "RETRYING"
            backoff = min(900, 15 * 2 ** attempts)
            store.job_update(jid, state=state, message=f"{type(exc).__name__}: {exc}"[:800],
                             **({"finished": True} if final else {"next_attempt_in": backoff}))
            self._series({"symbol": sym, "timeframe": tf, "last_error": str(exc)[:800]})
            store.event_add("JOB_FAILED" if final else "JOB_RETRY", "ERROR" if final else "WARNING",
                            f"{jtype} {sym} {tf} {'failed' if final else f'retry in {backoff}s'}: {exc}", sym, tf, jid)
            self.errors += 1
            self.last_error = f"{sym} {tf}: {exc}"
            traceback.print_exc()
        finally:
            self.current_job = None

    def _closed_filter(self, tf: str, rows: list[tuple]) -> list[tuple]:
        if not rows:
            return rows
        now = self.server_now()
        out = []
        for i, r in enumerate(rows):
            if i < len(rows) - 1 or (now is not None and bar_start_next(tf, r[0]) <= now):
                out.append(r)
        return out

    def _persist(self, sym: str, tf: str, rows: list[tuple], source: str) -> tuple[int, int, list[dict[str, Any]]]:
        clean, issues = normalize_batch(tf, rows)
        ins, rev = store.upsert_candles(sym, tf, clean, source)
        return ins, rev, issues

    def _h8_mode(self, sym: str) -> tuple[str, str]:
        """Use native broker H8 when it matches canonical server-day 00/08/16 buckets built from H1."""
        s = store.series_all().get((sym, "H8")) or {}
        checked = s.get("source_note") or ""
        if s.get("source") and s.get("last_validated_at") and "checked" in checked:
            age = (datetime.utcnow() - s["last_validated_at"]).total_seconds()
            if age < CONFIG["h8CheckEverySec"] and s.get("source") in ("MT5_NATIVE", "DERIVED_H1"):
                return s["source"], checked
        native = self.provider.rates_from_pos(sym, "H8", 1, 90) or []
        if not native:
            return "DERIVED_H1", "Native H8 unavailable at provider — derived from H1 (checked)"
        h1 = self.provider.rates_range(sym, "H1", native[0][0], native[-1][0] + 28800) or []
        derived = {r[0]: r for r in derive_h8(h1, native[-1][0] + 28800)}
        aligned_all = all(aligned("H8", r[0]) for r in native)
        matches = 0
        for r in native:
            d = derived.get(r[0])
            if d and all(abs(r[k] - d[k]) <= 1e-9 * max(1.0, abs(r[k])) for k in (1, 2, 3, 4)):
                matches += 1
        share = matches / len(native)
        if aligned_all and share >= 0.9:
            return "MT5_NATIVE", f"Native H8 matches canonical H1 buckets on {matches}/{len(native)} bars (checked)"
        return "DERIVED_H1", f"Native H8 incompatible ({matches}/{len(native)} match, aligned={aligned_all}) — derived from H1 (checked)"

    def _sync(self, sym: str, tf: str, jtype: str, jid: int) -> tuple[int, int, int, list[dict[str, Any]]]:
        spec = TF_SPEC[tf]
        issues: list[dict[str, Any]] = []
        fetched = inserted = revised = 0
        source = "MT5"
        if tf == "H8":
            source, note = self._h8_mode(sym)
            self._series({"symbol": sym, "timeframe": tf, "source": source, "source_note": note})
            if source == "DERIVED_H1":
                return self._derive_h8_from_db(sym)
        count, earliest, latest = store.candle_stats(sym, tf)
        if count == 0:
            rows = self.provider.rates_from_pos(sym, tf, 0, spec["depth"] + 1)
            if rows is None:
                raise RuntimeError(f"Provider returned no {tf} history for {sym}")
            rows = self._closed_filter(tf, rows)
            fetched += len(rows)
            ins, rev, iss = self._persist(sym, tf, rows, source)
            inserted, revised, issues = inserted + ins, revised + rev, issues + iss
            exhausted = len(rows) < spec["depth"]
            self._series({"symbol": sym, "timeframe": tf, "provider_depth": len(rows) if exhausted else None,
                                 "provider_exhausted": 1 if exhausted else 0})
        else:
            if latest is not None:
                newer = self.provider.rates_range(sym, tf, latest + 1, (self.server_now() or int(time.time())) + 3 * 86400)
                if newer is None:
                    raise RuntimeError(f"Provider refused {tf} range for {sym}")
                newer = self._closed_filter(tf, [r for r in newer if r[0] > latest])
                fetched += len(newer)
                ins, rev, iss = self._persist(sym, tf, newer, source)
                inserted, revised, issues = inserted + ins, revised + rev, issues + iss
                store.job_update(jid, checkpoint_ts=store.candle_stats(sym, tf)[2])
            if jtype == "BOOTSTRAP" and count < spec["depth"] and earliest is not None:
                want = spec["depth"] - count
                older = self.provider.rates_before(sym, tf, earliest - 1, want) or []
                older = [r for r in older if r[0] < earliest]
                fetched += len(older)
                ins, rev, iss = self._persist(sym, tf, older, source)
                inserted, revised, issues = inserted + ins, revised + rev, issues + iss
                exhausted = len(older) < want
                self._series({"symbol": sym, "timeframe": tf, "provider_exhausted": 1 if exhausted else 0,
                              "provider_depth": store.candle_stats(sym, tf)[0] if exhausted else None})
        if tf == "H1":
            self._maybe_derive_dependent_h8(sym)
        return fetched, inserted, revised, issues

    def _maybe_derive_dependent_h8(self, sym: str) -> None:
        s = store.series_all().get((sym, "H8")) or {}
        if s.get("source") == "DERIVED_H1":
            self._derive_h8_from_db(sym)

    def _derive_h8_from_db(self, sym: str) -> tuple[int, int, int, list[dict[str, Any]]]:
        _, _, h8_latest = store.candle_stats(sym, "H8")
        start = (h8_latest + 28800) if h8_latest is not None else 0
        h1 = store.candle_full(sym, "H1", start, 2**40)
        if not h1:
            return 0, 0, 0, []
        complete_before = self.server_now()
        rows = derive_h8(h1, complete_before)
        ins, rev, issues = self._persist(sym, "H8", rows, "DERIVED_H1")
        return len(h1), ins, rev, issues

    def _repair(self, sym: str, tf: str) -> tuple[int, int, int, list[dict[str, Any]]]:
        s = store.series_all().get((sym, tf)) or {}
        gaps = json.loads(s.get("gaps_json") or "[]")
        provider_gaps = json.loads(s.get("provider_gaps_json") or "[]")
        fetched = inserted = revised = 0
        issues: list[dict[str, Any]] = []
        self.repaired_gaps[(sym, tf)] = s.get("gaps_json") or "[]"
        if not gaps:
            return fetched, inserted, revised, issues
        source = s.get("source") or "MT5"
        for g in gaps:
            start, end = int(g[0]), int(g[1])
            if tf == "H8" and source == "DERIVED_H1":
                h1 = store.candle_full(sym, "H1", start, end + 28800)
                rows = derive_h8(h1, self.server_now())
                rows = [r for r in rows if start <= r[0] <= end]
            else:
                rows = self.provider.rates_range(sym, tf, start, end) or []
                rows = [r for r in rows if start <= r[0] <= end]
            fetched += len(rows)
            if rows:
                ins, rev, iss = self._persist(sym, tf, rows, source if tf == "H8" else "MT5")
                inserted, revised, issues = inserted + ins, revised + rev, issues + iss
            if not rows or len(rows) < int(g[2]):
                provider_gaps.append([start, end, int(g[2]) - len(rows)])
        self._series({"symbol": sym, "timeframe": tf, "last_repair_at": datetime.utcnow(),
                             "provider_gaps_json": json.dumps(provider_gaps[-500:])})
        store.event_add("REPAIR", "INFO", f"{sym} {tf}: repaired {inserted} candle(s) across {len(gaps)} gap(s)", sym, tf,
                        detail={"gaps": len(gaps), "inserted": inserted})
        return fetched, inserted, revised, issues

    # ------------------------------------------------------------ validation / status
    def validate(self, sym: str, tf: str, batch_issues: list[dict[str, Any]] | None = None, success: bool = False) -> dict[str, Any]:
        s = store.series_all().get((sym, tf)) or {}
        provider_gaps = json.loads(s.get("provider_gaps_json") or "[]")
        rows = store.candle_ohlc(sym, tf)
        v = validate_series(tf, rows, self.closures, provider_gaps)
        issues = (batch_issues or []) + v["issues"]
        latest = int(rows[-1][0]) if rows else None
        job_active = any(j["symbol"] == sym and j["timeframe"] == tf and j["type"] in ("BOOTSTRAP", "INCREMENTAL", "REPAIR")
                         and j["state"] in ("QUEUED", "RETRYING") for j in store.jobs_open())
        status, reason = evaluate_status(tf, len(rows), v, latest, s.get("provider_latest_ts"), bool(self.provider_ok),
                                         self.feed_stale, job_active)
        q = quality_score(tf, len(rows), v, status)
        update = {
            "symbol": sym, "timeframe": tf, "status": status, "reason": reason[:400], "candle_count": len(rows),
            "earliest_ts": int(rows[0][0]) if rows else None, "latest_ts": latest,
            "required_depth": TF_SPEC[tf]["depth"], "min_required": TF_SPEC[tf]["min"],
            "completeness": v["completeness"], "quality_score": q, "integrity_errors": v["integrityErrors"],
            "missing_bars": v["missing"], "gaps_json": json.dumps(v["gaps"][:500]),
            "issues_json": json.dumps(issues[:50], default=str), "last_validated_at": datetime.utcnow(),
        }
        if not s.get("source"):
            update["source"] = "MT5"
        if success:
            update["last_success_at"] = datetime.utcnow()
            update["last_error"] = None
        self._series(update)
        if s.get("status") and s.get("status") != status:
            sev = "INFO" if status == "READY" else "WARNING"
            store.event_add("SERIES_STATUS", sev, f"{sym} {tf}: {s.get('status')} → {status} ({reason})", sym, tf)
        return {"status": status, "reason": reason, "completeness": v["completeness"], "quality": q, "issues": issues}

    def validate_all(self, symbol: str | None = None, timeframe: str | None = None) -> dict[str, Any]:
        self.closures = closure_dates(store.candle_times_by_symbol("D1"))
        self.closures_at = time.time()
        results = []
        for sym in [symbol] if symbol else SYMBOLS:
            for tf in [timeframe] if timeframe else self.timeframes():
                r = self.validate(sym, tf)
                results.append({"symbol": sym, "timeframe": tf, **{k: r[k] for k in ("status", "reason", "completeness", "quality")}})
        store.event_add("VALIDATION_RUN", "INFO", f"Manual validation of {len(results)} series",
                        detail={"ready": sum(1 for r in results if r["status"] == "READY")})
        return {"ok": True, "validated": len(results), "results": results, "closures": sorted(d.isoformat() for d in self.closures)}

    # ------------------------------------------------------------ administrative overrides
    def enqueue_manual(self, kind: str, symbol: str | None, timeframe: str | None) -> dict[str, Any]:
        syms = [symbol] if symbol else SYMBOLS
        tfs = [timeframe] if timeframe else self.timeframes()
        series = store.series_all()
        created = 0
        for sym in syms:
            for tf in tfs:
                s = series.get((sym, tf)) or {}
                if kind == "sync":
                    if int(s.get("candle_count") or 0) < TF_SPEC[tf]["depth"] and not s.get("provider_exhausted"):
                        created += 1 if store.job_enqueue("BOOTSTRAP", sym, tf, "MANUAL", PRIORITY_MANUAL, "Manual sync (depth)") else 0
                    created += 1 if store.job_enqueue("INCREMENTAL", sym, tf, "MANUAL", PRIORITY_MANUAL, "Manual sync") else 0
                elif kind == "repair":
                    if json.loads(s.get("gaps_json") or "[]") or not s:
                        created += 1 if store.job_enqueue("REPAIR", sym, tf, "MANUAL", PRIORITY_MANUAL, "Manual repair") else 0
        store.event_add("MANUAL_OVERRIDE", "INFO",
                        f"Manual {kind}: {created} job(s) queued for {len(syms)} instrument(s) × {len(tfs)} timeframe(s)")
        self._wake.set()
        return {"ok": True, "queued": created, "message": f"{created} job(s) queued"}

    # ------------------------------------------------------------ status payload
    def status(self) -> dict[str, Any]:
        tfs = self.timeframes()
        series = store.series_all()
        rows = []
        for sym in SYMBOLS:
            for tf in tfs:
                s = series.get((sym, tf))
                if s:
                    d = store.series_dict(s)
                else:
                    d = {"symbol": sym, "timeframe": tf, "status": "MISSING_HISTORY", "reason": "Not synchronized yet", "count": 0,
                         "requiredDepth": TF_SPEC[tf]["depth"], "minRequired": TF_SPEC[tf]["min"], "issues": [], "gaps": []}
                if not self.provider_ok and self.provider_ok is not None:
                    d["status"], d["reason"] = "PROVIDER_OFFLINE", "MT5 provider offline — data frozen at last valid candle"
                d["earliest"] = iso_server(d.get("earliestTs"))
                d["latest"] = iso_server(d.get("latestTs"))
                now = self.server_now()
                d["freshnessSec"] = (now - bar_start_next(tf, d["latestTs"])) if (now and d.get("latestTs")) else None
                d["depthPct"] = round(100 * min(1.0, d["count"] / max(1, d.get("providerDepth") or d["requiredDepth"])), 1)
                rows.append(d)
        instruments = []
        for sym in SYMBOLS:
            mine = [r for r in rows if r["symbol"] == sym]
            worst = min(mine, key=lambda r: STATUS_ORDER.index(r["status"]) if r["status"] in STATUS_ORDER else 0)
            instruments.append({
                "symbol": sym,
                "status": worst["status"],
                "ready": all(r["status"] == "READY" for r in mine),
                "reason": "All required timeframes READY" if worst["status"] == "READY" else f"{worst['timeframe']}: {worst.get('reason') or worst['status']}",
                "series": {r["timeframe"]: r["status"] for r in mine},
            })
        counts = store.job_counts(24)
        open_jobs = store.jobs_open()
        cur = self.current_job
        return {
            "ok": True,
            "provider": {**self.provider_status, "connected": bool(self.provider_ok), "feedStale": self.feed_stale,
                         "serverOffsetSec": self.server_offset, "offsetSource": self.offset_source,
                         "serverNow": iso_server(self.server_now()), "lastTickServer": iso_server(self.last_tick_server),
                         "marketOpen": fx_market_open(datetime.now(timezone.utc))},
            "scheduler": {
                "running": self.last_loop_at is not None and time.time() - self.last_loop_at < CONFIG["plannerIntervalSec"] * 4,
                "startedAt": datetime.fromtimestamp(self.started_at, tz=timezone.utc).isoformat() if self.started_at else None,
                "lastCycleAt": datetime.fromtimestamp(self.last_loop_at, tz=timezone.utc).isoformat() if self.last_loop_at else None,
                "cycleMs": self.loop_ms, "intervalSec": CONFIG["plannerIntervalSec"],
                "workerAlive": self.worker_heartbeat is not None and time.time() - self.worker_heartbeat < 120,
                "recovering": self.recovering, "errors": self.errors, "lastError": self.last_error,
                "closures": len(self.closures),
            },
            "config": {"timeframes": tfs, "core": CORE_TFS, "execution": EXEC_TFS, "executionEnabled": self.exec_enabled(),
                       "spec": {k: {"depth": v["depth"], "min": v["min"]} for k, v in TF_SPEC.items()},
                       "completenessReady": CONFIG["completenessReady"]},
            "series": rows,
            "instruments": instruments,
            "queue": {
                "counts": counts,
                "open": len(open_jobs),
                "current": ({**cur, "runningSec": round(time.time() - cur["startedAt"], 1)} if cur else None),
                "next": open_jobs[:10],
            },
            "summary": {
                "series": len(rows),
                "ready": sum(1 for r in rows if r["status"] == "READY"),
                "instrumentsReady": sum(1 for i in instruments if i["ready"]),
                "candles": sum(r["count"] for r in rows),
                "quality": round(statistics.mean([r["quality"] for r in rows if r.get("quality") is not None]), 1)
                if any(r.get("quality") is not None for r in rows) else None,
                "completeness": round(statistics.mean([r["completeness"] for r in rows if r.get("completeness") is not None]), 2)
                if any(r.get("completeness") is not None for r in rows) else None,
            },
        }
