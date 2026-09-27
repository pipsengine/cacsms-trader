"""Stage 8 autonomous runner: Stage 7 CONFIRMED hand-offs x every registered Demo / Live / Prop account -> setup qualification,
portfolio / account risk, broker-valid sizing -> immutable execution authorizations for Stage 9 -> SQL Server.

Runs on a bridge background thread, independent of any browser session. Re-evaluation is event driven: Stage 7 confirmation
changes, material price moves, spread changes, account equity / margin changes, positions opening / closing, exposure and
prop-rule utilization changes, account configuration changes, risk configuration changes, the global PAUSED switch, pending
authorization expiry and H1 candle closes (freshness), plus a periodic sweep for time-based rules. Stage 8 never submits orders.
"""

from __future__ import annotations

import json
import math
import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable

try:
    import analysis_gate
    import confirm_store
    import risk
    import risk_store as rs
except ImportError:  # pragma: no cover
    from bridge.mt5 import analysis_gate  # type: ignore
    from bridge.mt5 import confirm_store  # type: ignore
    from bridge.mt5 import risk  # type: ignore
    from bridge.mt5 import risk_store as rs  # type: ignore

CONFIG: dict[str, Any] = {
    "loopSec": 5,
    "fullEverySec": 60,        # periodic sweep while opportunities / pending authorizations exist (time rules, expiry)
    "idleEverySec": 300,
    "priceMoveAtr": 0.1,       # material price move per candidate
    "equityStepPct": 0.1,      # material equity / free-margin change
    "balanceSnapshotSec": 600, # attached-account snapshot into dbo.account_balances (daily-loss / peak baselines)
    "correlationCacheSec": 900,
}


def _bucket(x: float | None, step_pct: float) -> int | None:
    if x is None or x <= 0:
        return None
    return int(math.log(x) / math.log(1 + step_pct / 100))


class RiskService:
    def __init__(self, provider: Any | None, offset_fn: Callable[[], int | None],
                 on_change: Callable[[dict[str, Any]], None] | None = None):
        self.provider = provider
        self.offset_fn = offset_fn
        self.on_change = on_change
        self._pending: set[str] = set()
        self._plock = threading.Lock()
        self._run_lock = threading.Lock()
        self._wake = threading.Event()
        self._seen: dict[str, Any] | None = None
        self._prev: dict[str, dict[str, Any]] | None = None
        self._exp_sig: dict[str, Any] = {}
        self._last_full = 0.0
        self._corr: tuple[float, tuple, dict] | None = None
        self._last_balance: dict[str, tuple[float, float]] = {}
        self.meta: dict[str, Any] = {"status": "STARTING", "message": "Stage 8 starting", "runs": 0, "errors": 0}
        self.thread: threading.Thread | None = None

    # ------------------------------------------------------------ triggers
    def mark(self, reason: str, *_: Any) -> None:
        with self._plock:
            self._pending.add(reason)
        self._wake.set()

    def on_stage7_change(self, symbols: list[str]) -> None:
        self.mark(f"STAGE7_CONFIRMATION_CHANGE {','.join(symbols[:6])}")

    def on_candles(self, timeframe: str, symbols: list[str], kind: str = "INCREMENTAL") -> None:
        if timeframe == "H1":
            self.mark("NEW_CANDLE H1")

    def start(self) -> None:
        rs.ensure_risk_schema()
        self.thread = threading.Thread(target=self._loop, name="risk-stage8", daemon=True)
        self.thread.start()

    def _loop(self) -> None:
        time.sleep(8)
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
    def day_start(self, now: float) -> float:
        off = self.offset_fn() or 0
        return math.floor((now + off) / 86400) * 86400 - off

    def _correlations(self, symbols: list[str], lookback: int) -> dict[tuple[str, str], float]:
        key = tuple(sorted(set(symbols)))
        if len(key) < 2:
            return {}
        if self._corr and self._corr[1] == (key, lookback) and time.time() - self._corr[0] < CONFIG["correlationCacheSec"]:
            return self._corr[2]
        corr = rs.correlations(list(key), lookback)
        self._corr = (time.time(), (key, lookback), corr)
        return corr

    def inputs(self) -> dict[str, Any]:
        now = time.time()
        cfg, _ = rs.load_config()
        handoffs, stage7 = rs.handoffs()
        accounts = rs.accounts()
        day0 = self.day_start(now)
        live = self.provider.account(day0) if self.provider else None
        base = rs.baselines(day0)
        terminal = None
        for a in accounts:
            b = base.get(a["id"]) or {}
            a["live"] = False
            if live and str(a.get("login")) == str(live["login"]) and (not a.get("server") or str(a["server"]).lower() == str(live["server"]).lower()):
                terminal = a["id"]
                a.update({k: live[k] for k in ("balance", "equity", "margin", "freeMargin", "leverage", "tradeAllowed", "tradeExpert", "snapshotAt",
                                               "profit", "currency")})
                a.update({"live": True, "state": "HEALTHY", "positions": live["positions"]})
                cands, src = [], []
                if live.get("realizedToday") is not None:
                    cands.append(live["balance"] - live["realizedToday"] - (live.get("depositsToday") or 0))
                    src.append("broker deals")
                    a["dayPnl"] = live["equity"] - live["balance"] + live["realizedToday"]
                if b.get("dayFirstEquity") is not None:
                    cands.append(b["dayFirstEquity"])
                    src.append("first snapshot today")
                a["dayStartEquity"] = max(cands) if cands else None
                a["baselineSource"] = " + ".join(src) or None
            else:
                a["dayStartEquity"] = b.get("dayFirstEquity")
                a["baselineSource"] = "first snapshot today" if b.get("dayFirstEquity") is not None else None
                a["dayPnl"] = None if b.get("dayFirstEquity") is None else float(a.get("equity") or 0) - b["dayFirstEquity"]
            a["peakEquity"] = b.get("peakEquity")
        actx = rs.authorization_context()
        symbols = sorted({h["instrument"] for h in handoffs} | {p["symbol"] for a in accounts for p in a.get("positions") or []})
        market = self.provider.market(symbols) if self.provider else {}
        fx = self.provider.fx_resolver(cfg["fxMaxAgeSec"]) if self.provider else (lambda s, d: {"ok": s == d, "rate": 1.0, "source": "identity",
                                                                                                 "reason": "MT5 provider unavailable"})
        items = []
        for h in handoffs:
            m = market.get(h["instrument"]) or {}
            if m.get("ask"):
                items.append((h["instrument"], "BUY" if risk.dsign(h["direction"]) > 0 else "SELL",
                              m["ask"] if risk.dsign(h["direction"]) > 0 else m["bid"]))
        broker_margin = self.provider.broker_margin(items) if self.provider and items else {}
        corr_syms = symbols + [p["instrument"] for p in actx["pending"]]
        corr = self._correlations(corr_syms, int(cfg["correlationLookback"])) if handoffs else {}
        h1meta = confirm_store.load_meta() or {}
        return {"now": now, "cfg": cfg, "handoffs": handoffs, "stage7": stage7, "accounts": accounts, "live": live, "terminalAccount": terminal,
                "market": market, "fx": fx, "brokerMargin": broker_margin, "corr": corr, "auto": rs.auto_enabled(), "h1Meta": h1meta, **actx}

    # ------------------------------------------------------------ detection
    def _signatures(self, inp: dict[str, Any]) -> dict[str, Any]:
        prices, spreads = {}, {}
        for h in inp["handoffs"]:
            m = inp["market"].get(h["instrument"]) or {}
            atr = float(h.get("atr") or 0)
            if m.get("bid") and atr > 0:
                prices[h["instrument"]] = int(((m["bid"] + m["ask"]) / 2) / (CONFIG["priceMoveAtr"] * atr))
                spreads[h["instrument"]] = int((m["ask"] - m["bid"]) / atr * 40)
        return {
            "handoffs": tuple(sorted(risk.setup_key(h) for h in inp["handoffs"])),
            "price": prices,
            "spread": spreads,
            "equity": {a["id"]: (_bucket(a.get("equity"), CONFIG["equityStepPct"]), _bucket(a.get("freeMargin"), CONFIG["equityStepPct"]))
                       for a in inp["accounts"]},
            "positions": {a["id"]: tuple(sorted((p.get("ticket") or p.get("id") or p["symbol"], p.get("volume"), p.get("sl"), p.get("tp"))
                                               for p in a.get("positions") or [])) for a in inp["accounts"]},
            "accountCfg": {a["id"]: (a.get("accountClass"), a.get("tradingMode"), bool(a.get("tradingEnabled")), a.get("maxConcurrentTrades"),
                                     json.dumps(a.get("propRules"), sort_keys=True), a.get("state"), a.get("live")) for a in inp["accounts"]},
            "auto": inp["auto"],
            "config": risk.config_hash(inp["cfg"]),
            "expired": sum(1 for p in inp["pending"] if (risk.parse_ts(p.get("expiresAt")) or 0) <= inp["now"]),
            "approvals": tuple(sorted(inp["approvals"])),
            "stage9": tuple(sorted((k, a, h["status"], h.get("orderState"), h.get("positionState"))
                                   for (k, a), h in (inp.get("handedOff") or {}).items())),
        }

    def _detect(self, sig: dict[str, Any]) -> list[str]:
        prev = self._seen
        if prev is None:
            return []
        out: list[str] = []

        def changed(key: str) -> list[str]:
            keys = set(sig[key]) | set(prev[key])
            return sorted(str(s) for s in keys if sig[key].get(s) != prev[key].get(s))

        if sig["handoffs"] != prev["handoffs"]:
            out.append("STAGE7_HANDOFF_CHANGE")
        if (c := changed("price")):
            out.append(f"PRICE_MOVE {','.join(c[:6])}")
        if (c := changed("spread")):
            out.append(f"SPREAD_CHANGE {','.join(c[:6])}")
        if (c := changed("equity")):
            out.append(f"ACCOUNT_EQUITY_MARGIN_CHANGE {','.join(c[:4])}")
        if (c := changed("positions")):
            out.append(f"POSITIONS_CHANGE {','.join(c[:4])}")
        if (c := changed("accountCfg")):
            out.append(f"ACCOUNT_CONFIG_CHANGE {','.join(c[:4])}")
        if sig["auto"] != prev["auto"]:
            out.append("TRADING_RESUMED" if sig["auto"] else "TRADING_PAUSED")
        if sig["config"] != prev["config"]:
            out.append("RISK_CONFIG_CHANGE")
        if sig["expired"] and sig["expired"] != prev["expired"]:
            out.append("AUTHORIZATION_EXPIRY")
        if sig["approvals"] != prev["approvals"]:
            out.append("OPERATOR_APPROVAL")
        if sig["stage9"] != prev.get("stage9"):
            out.append("STAGE9_EXECUTION_CHANGE")
        return out

    def tick(self) -> dict[str, Any]:
        inp = self.inputs()
        sig = self._signatures(inp)
        detected = self._detect(sig)
        self._seen = sig
        busy = bool(inp["handoffs"] or inp["pending"])
        if time.time() - self._last_full >= (CONFIG["fullEverySec"] if busy else CONFIG["idleEverySec"]):
            self._last_full = time.time()
            detected.append("PERIODIC")
        with self._plock:
            pending, self._pending = self._pending, set()
        triggers = sorted(pending | set(detected))
        self._snapshot_balance(inp)
        if not triggers:
            return {"ran": False}
        return self.run(triggers, inp)

    def _snapshot_balance(self, inp: dict[str, Any]) -> None:
        live, aid = inp.get("live"), inp.get("terminalAccount")
        if not live or not aid:
            return
        last = self._last_balance.get(aid)
        moved = last is None or abs(live["equity"] - last[1]) > max(0.01, abs(last[1]) * CONFIG["equityStepPct"] / 100)
        if last is None or moved or time.time() - last[0] >= CONFIG["balanceSnapshotSec"]:
            try:
                rs.record_balance(aid, live)
                self._last_balance[aid] = (time.time(), live["equity"])
            except Exception:
                traceback.print_exc()

    # ------------------------------------------------------------ run
    def run(self, triggers: list[str], inp: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._run_lock:
            started = time.time()
            inp = inp or self.inputs()
            cfg = inp["cfg"]
            ctx = {"now": inp["now"], "auto": inp["auto"], "corr": inp["corr"], "pending": inp["pending"], "attempts": inp["attempts"],
                   "approvals": inp["approvals"], "brokerMargin": inp["brokerMargin"],
                   "inflight": inp.get("inflight") or [], "handedOff": inp.get("handedOff") or {},
                   "terminalCurrency": (inp.get("live") or {}).get("currency"), "configHash": risk.config_hash(cfg)}
            result = risk.evaluate(inp["handoffs"], inp["accounts"], inp["market"], inp["fx"], cfg, ctx)
            if self._prev is None:
                try:
                    self._prev = rs.previous_opportunities()
                except Exception:
                    self._prev = {}
            exp_changed = []
            for a in result["accounts"]:
                s = (round(a["openRiskPct"], 3), round(a["pendingRiskPct"], 3), None if a["dailyLossPct"] is None else round(a["dailyLossPct"], 2),
                     round(a["drawdownPct"], 2), tuple((c["currency"], round(c["netPct"], 3)) for c in a["currencies"]), a["status"])
                if self._exp_sig.get(a["accountId"]) != s:
                    exp_changed.append(a["accountId"])
                    self._exp_sig[a["accountId"]] = s
            c = result["counters"]
            terminal_ok = bool(inp.get("live"))
            h1 = inp.get("h1Meta") or {}
            upstream_ok = h1.get("status") in ("HEALTHY", "DEGRADED")
            changes = []
            for o in result["opportunities"]:
                p = self._prev.get(o["setupKey"])
                if p is None or risk.signature(p) != risk.signature(o):
                    changes.append({"setupKey": o["setupKey"], "symbol": o["symbol"], "from": (p or {}).get("state"), "to": o["state"]})
            self.meta.update({
                "status": "HEALTHY" if terminal_ok and upstream_ok else "DEGRADED",
                "message": f"{c['candidates']} Stage 7 confirmed · {c['qualified']} setup-qualified · {c['eligible']} account-eligible · "
                           f"{c['authorized']} authorized · {c['accounts']} accounts ({c['eligibleAccounts']} trading-enabled)"
                           + ("" if inp["auto"] else " · trading PAUSED (analysis only)")
                           + ("" if terminal_ok else " · MT5 terminal account not attached")
                           + ("" if upstream_ok else f" · upstream Stage 7 {h1.get('status') or 'not run'}"),
                "runAt": datetime.now(timezone.utc).isoformat(),
                "triggers": triggers[:14],
                "runs": self.meta.get("runs", 0) + 1,
                "counters": c,
                "accounts": result["accounts"],
                "auto": inp["auto"],
                "terminal": None if not inp.get("live") else {k: inp["live"].get(k) for k in ("login", "server", "company", "currency", "leverage")}
                            | {"accountId": inp.get("terminalAccount")},
                "configHash": ctx["configHash"],
                "changes": changes[:40],
                "upstream": {"h1RunAt": h1.get("runAt"), "h1Status": h1.get("status"), "confirmed": len(inp["handoffs"])},
                "service": CONFIG,
            })
            self.meta["durationMs"] = int((time.time() - started) * 1000)
            res = rs.persist(result, self.meta, triggers, self._prev, inp["stage7"], exp_changed)
            self.meta.update({"runId": res["runId"] or self.meta.get("runId"), "created": res["created"], "revoked": res["revoked"],
                              "expired": res["expired"], "changed": res["changed"], "durationMs": int((time.time() - started) * 1000)})
            rs.save_meta(self.meta)
            self._prev = {o["setupKey"]: o for o in result["opportunities"]}
            if (res["changed"] or res["created"] or res["revoked"] or res["expired"]) and self.on_change:
                try:
                    self.on_change(res)
                except Exception:
                    traceback.print_exc()
            return {"ran": True, **res, "counters": c, "triggers": triggers}
