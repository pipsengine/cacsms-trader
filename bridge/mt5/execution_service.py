"""Stage 9 autonomous runner — the central execution engine. Runs on a bridge background thread, independent of any browser:
closing, refreshing or losing the page never affects it.

Every cycle:
  1. connection   — MT5 terminal / attached account; a disconnect keeps the last confirmed positions marked STALE and requires a
                    full reconciliation before any new execution (also after every bridge restart).
  2. reconcile    — in-flight submissions resolved from MT5 orders / deals / positions by execution ID (never blindly resent),
                    broker positions matched to the ledger, closes / partial closes / external changes detected, findings raised.
  3. manage       — protective stop placement + verification, break-even, partial exit, trailing, structural / risk / operator exits.
                    Continues while trading is PAUSED or execution is disabled; stops are never widened or removed.
  4. entries      — PENDING Stage 8 authorizations: revalidate -> consume (compare-and-set) -> order_check / order_send -> reconcile.
  5. publish      — completed trades -> Stage 10 record; mirror broker positions into dbo.mt5_positions; service meta.
"""

from __future__ import annotations

import threading
import time
import traceback
from typing import Any, Callable

try:
    import analysis_gate
    import execution as ex
    import execution_store as default_store
except ImportError:  # pragma: no cover
    from bridge.mt5 import analysis_gate  # type: ignore
    from bridge.mt5 import execution as ex  # type: ignore
    from bridge.mt5 import execution_store as default_store  # type: ignore

SERVICE = {"loopSec": 2, "metaEverySec": 10, "mirrorEverySec": 15, "retryBackoffSec": 10, "exitConfirmSec": 30}
EPS = 1e-9


class ExecutionService:
    def __init__(self, provider: Any, node: str, store: Any = None, on_change: Callable[[str], None] | None = None,
                 clock: Callable[[], float] = time.time):
        self.p = provider
        self.s = store or default_store
        self.node = node
        self.on_change = on_change
        self.clock = clock
        self._wake = threading.Event()
        self._run_lock = threading.Lock()
        self._triggers: set[str] = set()
        self._tlock = threading.Lock()
        self.connected: bool | None = None
        self.reconciled = False            # restart recovery: a full reconciliation precedes any new execution
        self.attached_id: str | None = None
        self._external_seen: set[int] = set()
        self._mirror_sig: Any = None
        self._mirror_at = 0.0
        self._meta_at = 0.0
        self._meta_sig: Any = None
        self._mkt: dict[str, dict[str, Any]] = {}
        self.waiting: list[dict[str, Any]] = []
        self.last_positions: list[dict[str, Any]] = []
        self.meta: dict[str, Any] = {"status": "STARTING", "message": "Stage 9 starting", "runs": 0, "errors": 0, "node": node}
        self.thread: threading.Thread | None = None

    # ------------------------------------------------------------ lifecycle
    def mark(self, reason: str, *_: Any) -> None:
        with self._tlock:
            self._triggers.add(reason)
        self._wake.set()

    def start(self) -> None:
        self.s.ensure_schema()
        self.thread = threading.Thread(target=self._loop, name="execution-stage9", daemon=True)
        self.thread.start()

    def _loop(self) -> None:
        time.sleep(6)
        while True:
            self._wake.wait(timeout=SERVICE["loopSec"])
            self._wake.clear()
            try:
                self.tick()
            except Exception as exc:  # pragma: no cover
                self.meta["errors"] = self.meta.get("errors", 0) + 1
                self.meta["lastError"] = f"{type(exc).__name__}: {exc}"
                traceback.print_exc()

    def _notify(self, what: str) -> None:
        if self.on_change:
            try:
                self.on_change(what)
            except Exception:  # pragma: no cover
                traceback.print_exc()

    def _event(self, x: dict[str, Any] | None, kind: str, state: str | None, detail: str, data: Any = None, account: str | None = None) -> None:
        self.s.event(x["executionId"] if x else None, (x or {}).get("accountId") or account, kind, state, detail, data)

    def _save(self, x: dict[str, Any], expect: Any = None) -> bool:
        x["updatedAt"] = ex.iso(self.clock())
        return self.s.ledger_save(x, expect)

    # ------------------------------------------------------------ cycle
    def tick(self) -> dict[str, Any]:
        with self._run_lock:
            with self._tlock:
                triggers, self._triggers = sorted(self._triggers), set()
            now = self.clock()
            self._mkt = {}
            cfg, _ = self.s.load_config()
            ctrl = self.s.load_control()
            auto = self.s.auto_enabled()
            term = self.p.terminal()
            accounts = self.s.accounts()
            connected = bool(term and term.get("connected"))
            attached = None
            if term:
                attached = next((a for a in accounts if str(a.get("login")) == str(term["login"])
                                 and (not a.get("server") or str(a["server"]).lower() == str(term["server"]).lower())), None)
            if not connected:
                if self.connected is not False:
                    self._event(None, "CONNECTION", "MT5_DISCONNECTED", "MT5 terminal disconnected — positions kept as last confirmed (STALE); "
                                "new executions blocked until a full reconciliation after reconnect", account=self.attached_id)
                    if self.attached_id:
                        self.s.mark_stale(self.attached_id, True)
                self.connected, self.reconciled = False, False
                return self._finish(cfg, ctrl, auto, term, None, now, triggers)
            if self.connected is False:
                self._event(None, "CONNECTION", "MT5_RECONNECTED", "MT5 terminal reconnected — full reconciliation before any new execution",
                            account=self.attached_id)
                self.reconciled = False
            self.connected = True
            if attached is None:
                self.reconciled = False
                return self._finish(cfg, ctrl, auto, term, None, now, triggers,
                                    note=f"Terminal login {term['login']}@{term['server']} is not a registered account")
            if self.attached_id and self.attached_id != attached["id"]:
                self._event(None, "CONNECTION", "ACCOUNT_SWITCHED", f"Terminal switched from {self.attached_id} to {attached['id']} — "
                            f"{self.attached_id} positions kept STALE; reconciling {attached['id']}", account=attached["id"])
                self.s.mark_stale(self.attached_id, True)
                self.reconciled = False
            self.attached_id = attached["id"]
            positions, orders = self.p.positions(), self.p.orders()
            if positions is None or orders is None:
                self.reconciled = False
                return self._finish(cfg, ctrl, auto, term, attached, now, triggers, note="MT5 positions / orders unavailable")
            self.last_positions = positions
            ledger = [x for x in self.s.ledger_active() if x["accountId"] == attached["id"]]
            full = not self.reconciled
            self._reconcile(attached, term, positions, orders, ledger, cfg, now, full)
            if full:
                self.reconciled = True
                n = self.s.mark_stale(attached["id"], False)
                self._event(None, "RECONCILIATION", "RECONCILED", f"Full reconciliation with MT5 complete for {attached['id']}: {len(positions)} broker "
                            f"position(s), {len(orders)} pending order(s), {len(ledger)} ledger item(s)" + (f", {n} stale item(s) refreshed" if n else ""),
                            account=attached["id"])
            control = ex.control_state(ctrl, auto, True, self.reconciled)
            live = [x for x in ledger if not self.s_closed(x)]
            self._manage(attached, term, positions, live, cfg, now)
            self._cancel_blocked_entries(attached, live, control, cfg)
            self._entries(control, attached, term, positions, orders, [x for x in live if not self.s_closed(x)], accounts, cfg, now)
            self._mirror(attached, term, now)
            return self._finish(cfg, ctrl, auto, term, attached, now, triggers)

    @staticmethod
    def s_closed(x: dict[str, Any]) -> bool:
        return x.get("positionState") == "CLOSED" or (x.get("positionState") is None and x.get("orderState") in ("REJECTED", "CANCELLED", "EXPIRED"))

    def _market(self, symbol: str) -> dict[str, Any]:
        if symbol not in self._mkt:
            self._mkt[symbol] = self.p.market(symbol) or {}
        return self._mkt[symbol]

    # ------------------------------------------------------------ reconciliation
    def _finding(self, attached: dict[str, Any], status: str, severity: str, detail: str, key: str, x: dict[str, Any] | None = None,
                 ticket: int | None = None, action: str | None = None, resolution: str | None = None, data: Any = None) -> str:
        item_key = f"{status}|{attached['id']}|{key}"
        rid, created = self.s.recon_raise({"itemKey": item_key, "accountId": attached["id"], "executionId": (x or {}).get("executionId"), "ticket": ticket,
                                           "status": status, "severity": severity, "detail": detail, "action": action, "resolution": resolution, "data": data})
        if created:
            self._event(x, "RECONCILIATION", status, f"{status}: {detail}" + (f" → {action}" if action else ""), account=attached["id"])
        return item_key

    def _reconcile(self, attached: dict[str, Any], term: dict[str, Any], positions: list[dict[str, Any]], orders: list[dict[str, Any]],
                   ledger: list[dict[str, Any]], cfg: dict[str, Any], now: float, full: bool) -> None:
        observed: set[str] = set()
        for x in ledger:
            if x["orderState"] in ex.IN_FLIGHT:
                k = self._resolve_inflight(x, attached, positions, orders, cfg, now)
                if k:
                    observed.add(k)
        open_x = [x for x in ledger if x.get("positionState") in ex.OPEN_POSITION]
        m = ex.match_broker(open_x, positions, cfg["magic"])
        for x, pos in m["matched"]:
            k = self._sync_position(x, pos, attached, cfg)
            if k:
                observed.add(k)
        for x in m["unmatchedLedger"]:
            deals = self.p.position_deals(int(x["mt5Position"])) if x.get("mt5Position") else None
            if deals is None:
                continue
            summ = ex.deal_summary(deals)
            if summ["closed"]:
                self._close(x, deals, summ, attached)
            else:
                observed.add(self._finding(attached, "MISSING_BROKER", "BLOCKING", f"{x['instrument']} position #{x.get('mt5Position')} of {x['executionId']} "
                                           "is not at the broker and no closing deal was found", x["executionId"], x, x.get("mt5Position"),
                                           "Verify in MT5; resolve once the position's fate is confirmed"))
        for pos in m["oursUnlinked"]:
            doc = self.s.ledger_get(pos["comment"]) if str(pos.get("comment") or "").startswith("EX-") else None
            if doc and doc["accountId"] == attached["id"] and doc.get("positionState") is None:
                self._link_fill(doc, pos, attached, cfg, "Broker position carries the execution ID in its comment")
                self._finding(attached, "MISSING_LOCAL", "WARNING", f"Broker position #{pos['ticket']} carried {doc['executionId']} but was not linked locally",
                              str(pos["ticket"]), doc, pos["ticket"], "Linked to the ledger by execution ID", "AUTO_LINKED")
                ledger.append(doc)
            else:
                observed.add(self._finding(attached, "UNKNOWN_EXECUTION", "BLOCKING", f"Broker position #{pos['ticket']} {pos['side']} {pos['volume']} {pos['symbol']} "
                                           f"carries the Stage 9 magic / comment '{pos.get('comment')}' but matches no execution", str(pos["ticket"]), None,
                                           pos["ticket"], "Operator must verify this position in MT5"))
        for x, pos in m["duplicates"]:
            observed.add(self._finding(attached, "DUPLICATE_POSITION", "BLOCKING", f"More than one broker position carries {x['executionId']} (#{pos['ticket']})",
                                       f"{x['executionId']}|{pos['ticket']}", x, pos["ticket"], "Operator must close the duplicate in MT5"))
        for pos in m["external"]:
            key = self._finding_key_external(attached, pos)
            observed.add(key)
            if pos["ticket"] not in self._external_seen:
                self._external_seen.add(pos["ticket"])
                self._finding(attached, "EXTERNAL_POSITION", "INFO", f"#{pos['ticket']} {pos['side']} {pos['volume']} {pos['symbol']} was not opened by Stage 9 "
                              "— counted as exposure, not managed", str(pos["ticket"]), None, pos["ticket"])
        # findings no longer observed are cleared deterministically
        for f in self.s.recon_open(attached["id"]):
            if f["itemKey"] not in observed and f["status"] in ("MISSING_BROKER", "UNKNOWN_EXECUTION", "DUPLICATE_POSITION", "EXTERNAL_POSITION",
                                                               "UNKNOWN_OUTCOME", "VOLUME_MISMATCH"):
                self.s.recon_resolve(None, f["itemKey"], "CLEARED", "stage9", "Condition no longer observed at the broker")
                if f["status"] == "EXTERNAL_POSITION" and f.get("ticket"):
                    self._external_seen.discard(int(f["ticket"]))

    @staticmethod
    def _finding_key_external(attached: dict[str, Any], pos: dict[str, Any]) -> str:
        return f"EXTERNAL_POSITION|{attached['id']}|{pos['ticket']}"

    def _resolve_inflight(self, x: dict[str, Any], attached: dict[str, Any], positions: list[dict[str, Any]], orders: list[dict[str, Any]],
                          cfg: dict[str, Any], now: float) -> str | None:
        st = x["orderState"]
        if st == "SUBMITTING" and not x.get("submitAttemptedAt"):
            x.update({"orderState": "REJECTED", "stateReason": "Engine stopped after consuming the authorization and before any request reached MT5 — "
                                                               "never submitted (verified: no submission attempt recorded)"})
            self._save(x)
            self._event(x, "RECONCILIATION", "REJECTED", x["stateReason"])
            return None
        if st == "ACKNOWLEDGED" and x.get("mt5Order"):
            live = next((o for o in orders if o["ticket"] == int(x["mt5Order"])), None)
            if live:
                return None
            pos = next((p for p in positions if p.get("identifier") == int(x["mt5Order"]) or p.get("comment") == x["executionId"]), None)
            if pos:
                self._link_fill(x, pos, attached, cfg, f"Pending order #{x['mt5Order']} filled")
                return None
            ho = self.p.history_order(int(x["mt5Order"]))
            if ho and ho["state"] in ("CANCELED", "EXPIRED", "REJECTED"):
                final = {"CANCELED": "CANCELLED", "EXPIRED": "EXPIRED", "REJECTED": "REJECTED"}[ho["state"]]
                x.update({"orderState": final, "stateReason": f"Pending order #{x['mt5Order']} {ho['state'].lower()} at the broker"})
                self._save(x)
                self._event(x, "RECONCILIATION", final, x["stateReason"])
                return None
            if ho and ho["state"] == "FILLED":
                deals = self.p.position_deals(int(ho.get("positionId") or x["mt5Order"])) or []
                summ = ex.deal_summary(deals)
                if summ["volumeIn"] > 0:
                    self._link_from_deals(x, deals, summ, attached, cfg)
                return None
        f = self.p.find_execution(x["executionId"], x["brokerSymbol"], cfg["magic"], ex.parse_ts(x.get("submitAttemptedAt")) or now)
        if f is None:
            return None
        if f["positions"]:
            self._link_fill(x, f["positions"][0], attached, cfg, "Broker position found carrying the execution ID")
            return None
        if f["orders"]:
            o = f["orders"][0]
            x.update({"orderState": "ACKNOWLEDGED", "mt5Order": o["ticket"], "stateReason": f"Pending order #{o['ticket']} confirmed at the broker"})
            self._save(x)
            self._event(x, "RECONCILIATION", "ACKNOWLEDGED", x["stateReason"])
            return None
        ins = [d for d in f["deals"] if d["entry"] in ("IN", "INOUT")]
        if ins:
            deals = self.p.position_deals(ins[0]["position"]) or f["deals"]
            self._link_from_deals(x, deals, ex.deal_summary(deals), attached, cfg)
            return None
        if f["historyOrders"]:
            ho = sorted(f["historyOrders"], key=lambda o: o.get("timeDone") or 0)[-1]
            if ho["state"] in ("CANCELED", "EXPIRED", "REJECTED"):
                final = {"CANCELED": "CANCELLED", "EXPIRED": "EXPIRED", "REJECTED": "REJECTED"}[ho["state"]]
                x.update({"orderState": final, "mt5Order": ho["ticket"], "stateReason": f"Broker order #{ho['ticket']} {ho['state'].lower()} (resolved by execution ID)"})
                self._save(x)
                self._event(x, "RECONCILIATION", final, x["stateReason"])
                return None
        cands = [p for p in f.get("magicCandidates") or [] if abs(p["volume"] - float(x["authVolume"])) < EPS and (p.get("time") or 0) >= (ex.parse_ts(x.get("submitAttemptedAt")) or 0) - 5
                 and not any(y.get("mt5Position") == p["ticket"] for y in self.s.ledger_active())]
        if len(cands) == 1:
            self._link_fill(x, cands[0], attached, cfg, "Matched by magic number, symbol, volume and time (broker comment missing)")
            return None
        age = now - (ex.parse_ts(x.get("submitAttemptedAt")) or now)
        if age >= cfg["unknownResolveSec"]:
            if x["orderState"] != "UNKNOWN":
                x.update({"orderState": "UNKNOWN", "stateReason": f"Outcome unknown {int(age)} s after submission — no broker order, deal or position carries "
                                                                  f"{x['executionId']}; never resubmitted"})
                self._save(x)
            return self._finding(attached, "UNKNOWN_OUTCOME", "BLOCKING", f"Submission outcome of {x['executionId']} {x['direction']} {x['authVolume']} "
                                 f"{x['instrument']} still unknown after {int(age)} s", x["executionId"], x, None,
                                 "Verify in MT5; resolve as NOT_EXECUTED or link the position")
        if x["orderState"] != "RECONCILING" and x["orderState"] != "UNKNOWN":
            x.update({"orderState": "RECONCILING", "stateReason": "Reconciling the submission with MT5 by execution ID"})
            self._save(x)
        return None

    def _risk_distance(self, x: dict[str, Any], fill: float) -> tuple[float, float | None]:
        dist = abs(float(fill) - float(x["authSl"]))
        auth_dist = abs(float(x.get("referencePrice") or fill) - float(x["authSl"]))
        return dist, None if auth_dist <= 0 else float(x.get("riskAmount") or 0) * dist / auth_dist

    def _link_fill(self, x: dict[str, Any], pos: dict[str, Any], attached: dict[str, Any], cfg: dict[str, Any], why: str) -> None:
        fill, vol = float(pos["priceOpen"]), float(pos["volume"])
        dist, money = self._risk_distance(x, fill)
        spec = self._market(x["brokerSymbol"]).get("spec") or {}
        point = float(x.get("point") or spec.get("point") or 0) or None
        partial = vol + EPS < float(x["authVolume"])
        mg = x.setdefault("mgmt", {})
        x.update({"orderState": "PARTIALLY_FILLED" if partial else "FILLED", "positionState": x.get("positionState") or "OPEN", "mt5Position": pos["ticket"],
                  "fillPrice": fill, "filledVolume": vol, "openVolume": vol, "filledAt": x.get("filledAt") or ex.iso(pos.get("time") or self.clock()),
                  "initialRiskDistance": dist, "initialRiskMoney": None if money is None else round(money * vol / float(x["authVolume"]), 2),
                  "protectiveSl": x.get("protectiveSl") or x["authSl"], "targetTp": x.get("targetTp") or x.get("authTp"),
                  "slippagePoints": ex.slippage_points(ex.dsign(x["direction"]), x.get("requestedPrice"), fill, point) if point else None,
                  "currentPrice": pos["priceCurrent"], "unrealizedPnl": round(pos["profit"] + pos.get("swap", 0), 2), "stale": False,
                  "stateReason": f"{'Partially filled' if partial else 'Filled'} {vol} @ {fill} — position #{pos['ticket']} reconciled ({why})"})
        if pos.get("sl") and abs(float(pos["sl"]) - float(x["protectiveSl"])) < float(spec.get("tickSize") or 1e-9) / 2 + EPS:
            mg["protected"] = True
        x["positionState"] = ex.position_state(x)
        x["nextAction"] = ex.next_action(x, cfg)
        self._save(x)
        deals = self.p.position_deals(pos["ticket"]) or []
        if deals:
            self.s.deals_upsert(attached["id"], x["executionId"], deals)
        self._event(x, "RECONCILIATION", x["orderState"], x["stateReason"], {"ticket": pos["ticket"], "volume": vol, "price": fill})
        self.s.recon_resolve(None, f"UNKNOWN_OUTCOME|{attached['id']}|{x['executionId']}", "AUTO_LINKED", "stage9", why)
        self._notify("FILLED")

    def _link_from_deals(self, x: dict[str, Any], deals: list[dict[str, Any]], summ: dict[str, Any], attached: dict[str, Any], cfg: dict[str, Any]) -> None:
        ticket = next((d["position"] for d in deals if d["entry"] in ("IN", "INOUT")), None)
        pseudo = {"ticket": ticket, "priceOpen": summ["entryPrice"], "volume": summ["volumeIn"], "priceCurrent": summ["exitPrice"] or summ["entryPrice"],
                  "profit": 0.0, "swap": 0.0, "sl": None, "time": summ.get("openedAt")}
        self._link_fill(x, pseudo, attached, cfg, "Entry deal found by execution ID")
        if summ["closed"]:
            self._close(x, deals, summ, attached)

    def _sync_position(self, x: dict[str, Any], pos: dict[str, Any], attached: dict[str, Any], cfg: dict[str, Any]) -> str | None:
        """Refresh a matched position from the broker; detect partial closes and volume changes."""
        mg = x.setdefault("mgmt", {})
        key = None
        changed = x.get("stale") or x.get("mt5Position") != pos["ticket"]
        x.update({"mt5Position": pos["ticket"], "currentPrice": pos["priceCurrent"], "unrealizedPnl": round(pos["profit"] + pos.get("swap", 0), 2),
                  "brokerSl": pos.get("sl"), "brokerTp": pos.get("tp"), "stale": False})
        ov = float(x.get("openVolume") or pos["volume"])
        if pos["volume"] + EPS < ov:
            deals = self.p.position_deals(pos["ticket"]) or []
            if deals:
                self.s.deals_upsert(attached["id"], x["executionId"], deals)
            pend = mg.get("partialPending")
            if pend and pos["volume"] <= float(pend.get("expectedVolume", 0)) + EPS:
                mg.update({"partialPending": None, "partialDone": True, "partialTaken": True})
                self._event(x, "MANAGEMENT", "PARTIAL_EXIT", f"Partial exit confirmed: {ov} → {pos['volume']} lots")
            else:
                self._finding(attached, "VOLUME_MISMATCH", "WARNING", f"#{pos['ticket']} volume {ov} → {pos['volume']} changed at the broker (manual / broker partial close)",
                              f"{x['executionId']}|{pos['volume']}", x, pos["ticket"], "Adopted broker volume from deals", "AUTO_ADOPTED")
                mg["partialTaken"] = True
            x["openVolume"] = pos["volume"]
            changed = True
        elif pos["volume"] > ov + EPS:
            key = self._finding(attached, "VOLUME_MISMATCH", "BLOCKING", f"#{pos['ticket']} volume grew {ov} → {pos['volume']} — not caused by Stage 9",
                                x["executionId"], x, pos["ticket"], "Operator must verify in MT5")
        now = self.clock()
        if mg.get("exitPending") and now - (ex.parse_ts(mg.get("exitAt")) or now) > SERVICE["exitConfirmSec"]:
            mg.update({"exitPending": False, "exitAttempts": int(mg.get("exitAttempts") or 0) + 1})
            self._event(x, "RECONCILIATION", "EXIT_NOT_EXECUTED", f"Exit ({mg.get('exitCode')}) not confirmed within {SERVICE['exitConfirmSec']} s — "
                        f"position #{pos['ticket']} still open with {pos['volume']} lots; exit will be re-issued")
            changed = True
        pp = mg.get("partialPending")
        if pp and pos["volume"] > float(pp.get("expectedVolume") or 0) + EPS and now - (ex.parse_ts(pp.get("at")) or now) > SERVICE["exitConfirmSec"]:
            mg["partialPending"] = None
            mg["partialAttempts"] = int(mg.get("partialAttempts") or 0) + 1
            if mg["partialAttempts"] >= 3:
                mg["partialDone"] = True
            self._event(x, "RECONCILIATION", "PARTIAL_NOT_EXECUTED", f"Partial exit not confirmed within {SERVICE['exitConfirmSec']} s — volume still {pos['volume']}")
            changed = True
        tick = float((self._market(x["brokerSymbol"]).get("spec") or {}).get("tickSize") or 1e-9)
        if x.get("targetTp") is not None and pos.get("tp") is not None and abs(float(pos["tp"]) - float(x["targetTp"])) > tick / 2 + EPS:
            self._finding(attached, "SL_TP_MISMATCH", "INFO", f"#{pos['ticket']} take-profit changed at the broker {x.get('targetTp')} → {pos.get('tp')}",
                          f"{x['executionId']}|TP|{pos.get('tp')}", x, pos["ticket"], "Adopted broker take-profit", "AUTO_ADOPTED")
            x["targetTp"] = pos.get("tp")
            changed = True
        if changed:
            self._save(x)
        return key

    def _close(self, x: dict[str, Any], deals: list[dict[str, Any]], summ: dict[str, Any], attached: dict[str, Any]) -> None:
        self.s.deals_upsert(attached["id"], x["executionId"], deals)
        mg = x.setdefault("mgmt", {})
        reason = ex.exit_reason(x, summ.get("closeReason"))
        base = float(x.get("initialRiskMoney") or x.get("riskAmount") or 0)
        x.update({"positionState": "CLOSED", "exitPrice": summ["exitPrice"], "realizedPnl": summ["realized"], "commission": summ["commission"], "swap": summ["swap"],
                  "closedAt": ex.iso(summ.get("closedAt") or self.clock()), "exitReason": reason, "openVolume": 0.0, "unrealizedPnl": None,
                  "rMultiple": None if base <= 0 else round(float(summ["realized"]) / base, 2), "stale": False,
                  "stateReason": f"Closed {summ['volumeOut']} @ {summ['exitPrice']} — {reason} · realized {summ['realized']:+.2f}", "nextAction": None})
        mg.update({"exitPending": False, "inFlight": False})
        self._save(x)
        self._event(x, "EXIT", "CLOSED", x["stateReason"], {"summary": summ})
        rec = ex.trade_record(x, summ, self.s.orders(x["executionId"]), self.s.events(x["executionId"]))
        if self.s.publish_trade(rec):
            x["publishedAt"] = ex.iso(self.clock())
            self._save(x)
            self._event(x, "STAGE10", "PUBLISHED", f"Completed trade published to Stage 10: {rec['realizedPnl']:+.2f} {rec.get('currency')} · "
                        f"{rec['rMultiple'] if rec['rMultiple'] is not None else '—'}R · {reason}")
        self._notify("CLOSED")

    # ------------------------------------------------------------ management
    def _manage(self, attached: dict[str, Any], term: dict[str, Any], positions: list[dict[str, Any]], live: list[dict[str, Any]], cfg: dict[str, Any],
                now: float) -> None:
        by_ticket = {p["ticket"]: p for p in positions}
        mine = [x for x in live if x.get("positionState") in ex.OPEN_POSITION and x.get("mt5Position") in by_ticket]
        if not mine:
            return
        risk_cfg, risk_accts = self.s.risk_context()
        s7_cache: dict[str, Any] = {}
        h1_cache: dict[str, Any] = {}
        basis = min(float(term.get("balance") or 0), float(term.get("equity") or 0))
        for x in mine:
            pos = by_ticket[x["mt5Position"]]
            sym = x["instrument"]
            if sym not in s7_cache:
                s7_cache[sym] = self.s.stage7(sym)
                h1_cache[sym] = self.s.last_h1_close(sym)
            mkt = self._market(x["brokerSymbol"])
            mg = x.setdefault("mgmt", {})
            before = (x.get("positionState"), x.get("protectiveSl"), x.get("nextAction"), json_sig(mg))
            exits = ex.risk_exits(x, attached, risk_accts.get(attached["id"]), risk_cfg, cfg, s7_cache[sym], h1_cache[sym], now)
            if mg.get("forcedExit"):
                exits.insert(0, mg["forcedExit"])
            plan = ex.management_plan(x, pos, mkt, cfg, {"now": now, "exits": exits})
            for a in plan:
                self._execute(x, pos, a, mkt, attached, cfg)
            if pos.get("sl") is not None and x.get("protectiveSl") is not None:
                tick = float((mkt.get("spec") or {}).get("tickSize") or 1e-9)
                if abs(float(pos["sl"]) - float(x["protectiveSl"])) <= tick / 2 + EPS or ex.tighter(ex.dsign(x["direction"]), float(pos["sl"]), float(x["protectiveSl"])):
                    mg["protected"] = True
            self._position_risk(x, pos, mkt, basis, term.get("currency"))
            px = ex.exit_price(ex.dsign(x["direction"]), float(mkt.get("bid") or pos["priceCurrent"]), float(mkt.get("ask") or pos["priceCurrent"]))
            r = ex.r_multiple(x, px)
            x["currentR"] = None if r is None else round(r, 2)
            x["positionState"] = ex.position_state(x)
            x["nextAction"] = ex.next_action(x, cfg)
            if (x.get("positionState"), x.get("protectiveSl"), x.get("nextAction"), json_sig(mg)) != before:
                self._save(x)

    def _position_risk(self, x: dict[str, Any], pos: dict[str, Any], mkt: dict[str, Any], basis: float, ccy: str | None) -> None:
        spec = mkt.get("spec") or {}
        sl = pos.get("sl") or x.get("protectiveSl")
        if not sl or not spec.get("contractSize") or not ccy:
            x.update({"riskNowMoney": None, "riskNowPct": None})
            return
        conv = self.p.fx(600)(str(spec.get("currencyProfit") or ""), str(ccy))
        if not conv.get("ok"):
            x.update({"riskNowMoney": None, "riskNowPct": None})
            return
        d = ex.dsign(x["direction"])
        money = max(0.0, (float(pos["priceOpen"]) - float(sl)) * d) * float(spec["contractSize"]) * float(pos["volume"]) * float(conv["rate"])
        x.update({"riskNowMoney": round(money, 2), "riskNowPct": round(100 * money / basis, 3) if basis > 0 else None})

    def _send(self, x: dict[str, Any], attached: dict[str, Any], purpose: str, req: dict[str, Any], seq_key: str) -> tuple[dict[str, Any], dict[str, Any]]:
        n = int(x.setdefault("mgmt", {}).get("seq", 0)) + 1
        x["mgmt"]["seq"] = n
        rid = f"{x['executionId']}:{purpose}:{n}"
        oid = self.s.order_add({"requestId": rid, "executionId": x["executionId"], "accountId": attached["id"], "purpose": purpose, "symbol": req["symbol"],
                                "orderType": req.get("type") or req["action"], "volume": req.get("volume"), "requestedPrice": req.get("price"),
                                "sl": req.get("sl"), "tp": req.get("tp"), "status": "SENDING", "request": req})
        res = self.p.send(req, attached["login"], attached.get("server"))
        if not res.get("sent"):
            if oid:
                self.s.order_update(oid, {"status": "NOT_SENT", "retcodeText": res.get("notSentReason")})
            return {"outcome": "NOT_SENT", "reason": res.get("notSentReason")}, res
        rc = (res.get("result") or {}).get("retcode")
        cls = {"outcome": "FILLED", "code": "NO_CHANGES", "reason": "NO_CHANGES (10025)"} if rc == 10025 else ex.classify_send(res.get("result") or {"error": res.get("error")}, float(req.get("volume") or 0))
        r = res.get("result") or {}
        if oid:
            self.s.order_update(oid, {"status": cls["outcome"], "retcode": rc, "retcodeText": cls["reason"], "mt5Order": r.get("order") or None,
                                      "mt5Deal": r.get("deal") or None, "fillPrice": r.get("dealPrice") or r.get("price") or None, "fillVolume": r.get("volume") or None,
                                      "latencyMs": res.get("latencyMs"), "result": r or {"error": res.get("error")}})
        return cls, res

    def _execute(self, x: dict[str, Any], pos: dict[str, Any], a: dict[str, Any], mkt: dict[str, Any], attached: dict[str, Any], cfg: dict[str, Any]) -> None:
        mg = x.setdefault("mgmt", {})
        d = ex.dsign(x["direction"])
        spec = mkt.get("spec") or {}
        if a["type"] == "MARK":
            mg[a["flag"]] = True
            self._event(x, "MANAGEMENT", a["code"], a["reason"])
            return
        if a["type"] == "ADOPT_SL":
            x["protectiveSl"] = a["sl"]
            mg["protected"] = True
            if (a["sl"] - float(x["fillPrice"])) * d >= 0:
                mg["beDone"] = True
            self._finding(attached, "SL_TP_MISMATCH", "INFO", f"#{pos['ticket']} stop tightened at the broker to {a['sl']}", f"{x['executionId']}|SL|{a['sl']}", x,
                          pos["ticket"], "Adopted (tighter stop never loosened)", "AUTO_ADOPTED")
            return
        if self._backoff(mg, a["code"]):
            return
        if a["type"] == "SLTP":
            prot = x.get("protectiveSl")
            if a["code"] not in ("INITIAL_PROTECTION", "RESTORE_PROTECTION") and not ex.tighter(d, a["sl"], prot):
                return  # hard guard: a management step may never widen the protective stop
            req = ex.build_sltp(x, pos["ticket"], a["sl"], a.get("tp") if a.get("tp") is not None else x.get("targetTp"), cfg)
            mg["inFlight"] = True
            cls, res = self._send(x, attached, "SLTP", req, a["code"])
            mg["inFlight"] = False
            if cls["outcome"] == "FILLED":
                x["protectiveSl"] = a["sl"]
                mg["protected"] = True
                mg.pop("protectFailures", None)
                mg.pop("error", None)
                mg.pop("lastFailure", None)
                if a["code"] == "BREAK_EVEN":
                    mg["beDone"] = True
                if a["code"] == "TRAILING":
                    mg["trailing"] = True
                    if (a["sl"] - float(x["fillPrice"])) * d >= 0:
                        mg["beDone"] = True
                self._event(x, "MANAGEMENT", a["code"], f"{a['reason']} — confirmed by MT5", {"sl": a["sl"], "tp": req.get("tp")})
            else:
                mg["error"] = f"{a['code']} failed: {cls['reason']}"
                mg["lastFailure"] = {"code": a["code"], "at": ex.iso(self.clock())}
                self._event(x, "MANAGEMENT", "ERROR", mg["error"])
                if a["code"] in ("INITIAL_PROTECTION", "RESTORE_PROTECTION") and cls["outcome"] != "UNKNOWN":
                    mg["protectFailures"] = int(mg.get("protectFailures") or 0) + 1
                    if mg["protectFailures"] >= cfg["protectRetries"]:
                        mg["forcedExit"] = {"code": "UNPROTECTED_EXIT", "reason": f"Protective stop could not be attached after {mg['protectFailures']} attempts — closing"}
            return
        if a["type"] in ("CLOSE", "PARTIAL"):
            if a["type"] == "PARTIAL" and mg.get("partialPending"):
                return
            if not mkt.get("bid"):
                return
            px = ex.exit_price(d, float(mkt["bid"]), float(mkt["ask"]))
            dev = max(int(((x.get("authorization") or {}).get("entryPolicy") or {}).get("maxDeviationPoints") or 0) * 3, 20)
            req = ex.build_close(x, pos["ticket"], a["volume"], px, cfg, dev, spec)
            if a["type"] == "CLOSE":
                mg.update({"exitPending": True, "exitCode": a["code"], "exitReason": a["reason"], "exitAt": ex.iso(self.clock())})
                self._save(x)
                self._event(x, "EXIT", "EXIT_PENDING", a["reason"])
            else:
                mg["partialPending"] = {"expectedVolume": round(float(pos["volume"]) - float(a["volume"]), 8), "at": ex.iso(self.clock())}
            cls, _ = self._send(x, attached, "CLOSE" if a["type"] == "CLOSE" else "PARTIAL", req, a["code"])
            if cls["outcome"] in ("FILLED", "PARTIAL"):
                self._event(x, "EXIT" if a["type"] == "CLOSE" else "MANAGEMENT", a["code"], f"{a['reason']} — {cls['reason']}")
            elif cls["outcome"] == "UNKNOWN":
                self._event(x, "RECONCILIATION", "UNKNOWN", f"{a['code']} outcome unknown ({cls['reason']}) — reconciling volume before any retry")
            else:
                mg["lastFailure"] = {"code": a["code"], "at": ex.iso(self.clock())}
                if a["type"] == "CLOSE":
                    mg.update({"exitPending": False, "error": f"Exit rejected: {cls['reason']}"})
                    mg["exitAttempts"] = int(mg.get("exitAttempts") or 0) + 1
                else:
                    mg["partialPending"] = None
                    mg["partialAttempts"] = int(mg.get("partialAttempts") or 0) + 1
                    if mg["partialAttempts"] >= 3:
                        mg["partialDone"] = True
                self._event(x, "MANAGEMENT", "ERROR", f"{a['code']} rejected: {cls['reason']}")
            self._save(x)

    def _backoff(self, mg: dict[str, Any], code: str) -> bool:
        f = mg.get("lastFailure") or {}
        return f.get("code") == code and self.clock() - (ex.parse_ts(f.get("at")) or 0) < SERVICE["retryBackoffSec"]

    def _cancel_blocked_entries(self, attached: dict[str, Any], live: list[dict[str, Any]], control: dict[str, Any], cfg: dict[str, Any]) -> None:
        """Unfilled pending entry orders are new entries: withdraw them while paused / disabled / emergency-stopped."""
        blocking = [f for f in control["flags"] if f["state"] in ("EMERGENCY_STOP", "TRADING_PAUSED", "ANALYSIS_PAUSED", "EXECUTION_DISABLED")]
        if not blocking:
            return
        for x in live:
            if x["orderState"] != "ACKNOWLEDGED" or not x.get("mt5Order") or x.get("cancelRequestedAt"):
                continue
            x["cancelRequestedAt"] = ex.iso(self.clock())
            cls, _ = self._send(x, attached, "CANCEL", {"action": "REMOVE", "order": int(x["mt5Order"]), "symbol": x["brokerSymbol"]}, "CANCEL")
            self._event(x, "ORDER", "CANCEL_REQUESTED", f"Pending entry order #{x['mt5Order']} withdrawn: {blocking[0]['reason']} — {cls.get('reason')}")
            self._save(x)

    # ------------------------------------------------------------ new entries
    def _entries(self, control: dict[str, Any], attached: dict[str, Any], term: dict[str, Any], positions: list[dict[str, Any]], orders: list[dict[str, Any]],
                 live: list[dict[str, Any]], accounts: list[dict[str, Any]], cfg: dict[str, Any], now: float) -> None:
        auths = self.s.pending_authorizations()
        self.waiting = []
        if not auths:
            return
        by_id = {a["id"]: a for a in accounts}
        risk_cfg, _ = self.s.risk_context()
        recon = self.s.recon_open(attached["id"])
        blocking = sum(1 for f in recon if f["severity"] == "BLOCKING")
        non_info = sum(1 for f in recon if f["severity"] != "INFO")
        for a in auths:
            eid = a["executionId"]
            acct = by_id.get(a["accountId"])
            if not acct or acct["id"] != attached["id"]:
                self.waiting.append({"executionId": eid, "accountId": a["accountId"], "blocker": "ACCOUNT_NOT_ATTACHED",
                                     "reason": f"Account {a['accountId']} is not attached to this node's MT5 terminal ({attached['id']} is)"})
                continue
            x = self.s.ledger_get(eid)
            if x and x["orderState"] not in ex.PRE_SUBMIT:
                continue
            if not control["newEntries"]:
                if x:
                    if x.get("blockerCode") != control["state"]:
                        x.update({"orderState": "QUEUED", "blockerCode": control["state"], "stateReason": control["reason"]})
                        self._save(x)
                        self._event(x, "QUEUE", "QUEUED", control["reason"])
                else:
                    self.waiting.append({"executionId": eid, "accountId": a["accountId"], "blocker": control["state"], "reason": control["reason"]})
                continue
            rv, spec = self._revalidate(a, acct, term, positions, orders, live, risk_cfg, cfg, now, control, blocking, non_info, consumed=False)
            if x is None:
                x = ex.new_ledger(a, self.node, now)
                x["orderState"] = "REVALIDATING"
                if not self.s.ledger_create(x):
                    x = self.s.ledger_get(eid)
                    if not x or x["orderState"] not in ex.PRE_SUBMIT:
                        continue
                else:
                    self._event(x, "AUTHORIZATION", "AUTHORIZED", f"Stage 8 authorization received: {a['direction']} {a['volume']} {a['instrument']} · SL {a['stopLoss']} · "
                                f"TP {a.get('takeProfit')} · risk {a['riskAmount']} {a['riskCurrency']} ({a['riskPct']}%) · valid until {str(a.get('expiresAt'))[11:19]} UTC")
            x["revalidation"] = rv
            if not rv["ok"]:
                if rv["terminal"]:
                    final = ex.DECLINE_STATE.get(rv["code"], "CANCELLED")
                    x.update({"orderState": final, "blockerCode": rv["code"], "stateReason": rv["reason"]})
                    self._save(x)
                    self._event(x, "REVALIDATION", final, f"Pre-execution revalidation declined: {rv['reason']}", {"checks": rv["checks"]})
                    if final != "EXPIRED":
                        self.s.decline_authorization(eid, f"Stage 9 declined: {rv['reason']}")
                elif x.get("blockerCode") != rv["code"] or x["orderState"] != "QUEUED":
                    x.update({"orderState": "QUEUED", "blockerCode": rv["code"], "stateReason": rv["reason"]})
                    self._save(x)
                    self._event(x, "REVALIDATION", "QUEUED", f"Waiting: {rv['reason']}", {"checks": rv["checks"]})
                continue
            if not self.s.consume_authorization(eid, f"Consumed by Stage 9 node {self.node} after pre-execution revalidation"):
                st = self.s.authorization_status(eid)
                x.update({"orderState": "EXPIRED" if st == "EXPIRED" else "CANCELLED", "blockerCode": f"AUTH_{st or 'MISSING'}",
                          "stateReason": f"Authorization became {st} before it could be consumed — not submitted"})
                self._save(x)
                self._event(x, "AUTHORIZATION", x["orderState"], x["stateReason"])
                continue
            x.update({"consumedAt": ex.iso(self.clock()), "orderState": "SUBMITTING", "blockerCode": None, "node": self.node,
                      "stateReason": "Authorization consumed — submitting to MT5"})
            try:
                x["upstream"] = self.s.evidence(a["instrument"])
            except Exception:  # pragma: no cover
                x["upstream"] = None
            if not self._save(x, ex.PRE_SUBMIT):
                continue
            self._event(x, "AUTHORIZATION", "CONSUMED", f"Revalidated ({len(rv['checks'])} checks passed) and consumed on node {self.node}", {"checks": rv["checks"]})
            self._submit(x, a, rv, spec, acct, cfg, lambda: self._revalidate(a, acct, self.p.terminal() or term, self.p.positions() or positions,
                                                                             self.p.orders() or orders, live, risk_cfg, cfg, self.clock(), control,
                                                                             blocking, non_info, consumed=True))
            live.append(x)
            positions = self.p.positions() or positions
            orders = self.p.orders() or orders

    def _revalidate(self, a: dict[str, Any], acct: dict[str, Any], term: dict[str, Any], positions: list[dict[str, Any]], orders: list[dict[str, Any]],
                    live: list[dict[str, Any]], risk_cfg: dict[str, Any], cfg: dict[str, Any], now: float, control: dict[str, Any], blocking: int,
                    non_info: int, consumed: bool) -> tuple[dict[str, Any], dict[str, Any]]:
        self._mkt.pop(a.get("brokerSymbol") or a["instrument"], None)
        mkt = self._market(a.get("brokerSymbol") or a["instrument"])
        spec = mkt.get("spec") or {}
        side = "BUY" if ex.dsign(a["direction"]) > 0 else "SELL"
        price = mkt.get("ask") if side == "BUY" else mkt.get("bid")
        others = [y for y in live if y["executionId"] != a["executionId"]]
        busy = [y for y in others if y["orderState"] in ex.IN_FLIGHT and not y.get("mt5Position")]
        symbols = {p["symbol"] for p in positions} | {o["symbol"] for o in orders} | {y["instrument"] for y in busy}
        max_pos = min(int(risk_cfg.get("maxConcurrentPositions") or 99), int(acct.get("maxConcurrentTrades") or risk_cfg.get("maxConcurrentPositions") or 99))
        ctx = {
            "now": now, "control": control, "consumed": consumed, "authStatus": None if consumed else "PENDING",
            "account": {**acct, "attached": True, "node": self.node, "terminalLogin": term.get("login"), "tradeAllowed": term.get("tradeAllowed"),
                        "tradeExpert": term.get("tradeExpert"), "balance": term.get("balance"), "equity": term.get("equity"),
                        "freeMargin": term.get("freeMargin"), "margin": term.get("margin"), "currency": term.get("currency"), "snapshotAt": term.get("snapshotAt")},
            "market": mkt, "fx": self.p.fx(float(risk_cfg.get("fxMaxAgeSec") or 600)),
            "marginPerLot": self.p.margin_per_lot(spec.get("name") or a["instrument"], side, price) if spec.get("name") and price else None,
            "exposure": {"symbols": symbols, "positions": len(positions) + len(busy) + sum(1 for o in orders if o["type"] not in ("BUY", "SELL")),
                         "maxPositions": max_pos, "allowSameSymbol": bool(risk_cfg.get("allowSameSymbol"))},
            "duplicate": any(y["setupKey"] == a["setupKey"] and y["accountId"] == a["accountId"] and (y["orderState"] in ex.IN_FLIGHT or y.get("positionState") in ex.OPEN_POSITION)
                             for y in others),
            "traded": self.s.traded(a["setupKey"], a["accountId"], a["executionId"]),
            "upstream": self.s.upstream(a["setupKey"], a["instrument"]), "blockingRecon": blocking, "openRecon": non_info,
        }
        return ex.revalidate(a, ctx, cfg), spec

    def _submit(self, x: dict[str, Any], auth: dict[str, Any], rv: dict[str, Any], spec: dict[str, Any], acct: dict[str, Any], cfg: dict[str, Any],
                again: Callable[[], tuple[dict[str, Any], dict[str, Any]]]) -> None:
        req = ex.build_entry(auth, rv, spec, cfg)
        n = int(x.get("requotes") or 0) + 1
        x.update({"point": spec.get("point"), "requestedPrice": req["price"], "spreadAtSubmit": rv["order"].get("spreadPoints"), "entryRequest": req})
        oid = self.s.order_add({"requestId": f"{x['executionId']}:ENTRY:{n}", "executionId": x["executionId"], "accountId": acct["id"], "purpose": "ENTRY",
                                "symbol": req["symbol"], "orderType": req["type"], "volume": req["volume"], "requestedPrice": req["price"], "sl": req["sl"],
                                "tp": req["tp"], "status": "SENDING", "spread": rv["order"].get("spreadPoints"), "request": req})
        if oid is None:
            x.update({"orderState": "RECONCILING", "stateReason": "Entry request already recorded — reconciling instead of resending"})
            self._save(x)
            return
        x["submitAttemptedAt"] = ex.iso(self.clock())
        self._save(x)  # committed before the broker call: a crash from here on is reconciled, never resubmitted
        self._event(x, "SUBMISSION", "SUBMITTING", f"order_send {req['type']} {req['volume']} {req['symbol']} @ {req['price']} · SL {req['sl']} · TP {req['tp']} · "
                    f"deviation {req.get('deviation')} pts · {req.get('filling')} · magic {req['magic']} · comment {req['comment']}")
        res = self.p.send(req, acct["login"], acct.get("server"))
        if not res.get("sent"):
            self.s.order_update(oid, {"status": "NOT_SENT", "retcodeText": res.get("notSentReason"), "result": {"check": res.get("check")}})
            x.update({"orderState": "REJECTED", "stateReason": f"Not submitted: {res.get('notSentReason')}"})
            self._save(x)
            self._event(x, "SUBMISSION", "REJECTED", x["stateReason"], {"check": res.get("check")})
            return
        r = res.get("result") or {}
        cls = ex.classify_send(res.get("result") or {"error": res.get("error")}, req["volume"])
        point = float(spec.get("point") or 0) or None
        fill = r.get("dealPrice") or r.get("price") or None
        slip = ex.slippage_points(ex.dsign(x["direction"]), req["price"], fill, point) if fill and point else None
        self.s.order_update(oid, {"status": cls["outcome"], "retcode": r.get("retcode"), "retcodeText": cls["reason"], "mt5Order": r.get("order") or None,
                                  "mt5Deal": r.get("deal") or None, "fillPrice": fill, "fillVolume": r.get("volume") or None, "slippagePoints": slip,
                                  "latencyMs": res.get("latencyMs"), "result": {**r, "check": res.get("check")} if r else {"error": res.get("error")}})
        x.update({"latencyMs": res.get("latencyMs"), "submittedAt": ex.iso(res.get("sentAt") or self.clock()), "brokerResponse": {**r, "outcome": cls["outcome"]}})
        out = cls["outcome"]
        if out in ("FILLED", "PARTIAL"):
            x.update({"orderState": "RECONCILING", "mt5Order": r.get("order"), "mt5Deal": r.get("deal"), "acknowledgedAt": ex.iso(self.clock()),
                      "stateReason": f"Broker acknowledged {cls['reason']} — reconciling with MT5 position"})
            self._save(x)
            self._event(x, "BROKER", "ACKNOWLEDGED", f"{cls['reason']} · order #{r.get('order')} deal #{r.get('deal')} · {r.get('volume')} @ {fill} · "
                        f"{res.get('latencyMs')} ms" + (f" · slippage {slip:+g} pts" if slip is not None else ""))
            ticket = r.get("positionId") or r.get("order")
            pos = next((p for p in (self.p.positions() or []) if p["ticket"] == ticket or p.get("comment") == x["executionId"]), None)
            if pos:
                self._link_fill(x, pos, acct, cfg, f"broker {cls['code']} verified against position #{pos['ticket']}")
            return
        if out == "PLACED":
            x.update({"orderState": "ACKNOWLEDGED", "mt5Order": r.get("order"), "acknowledgedAt": ex.iso(self.clock()),
                      "stateReason": f"Pending order #{r.get('order')} placed — {cls['reason']}"})
            self._save(x)
            self._event(x, "BROKER", "ACKNOWLEDGED", x["stateReason"])
            return
        if out == "NO_FILL_RETRY":
            x["requotes"] = n
            self._event(x, "BROKER", "NO_FILL", f"{cls['reason']} — definitively not executed (attempt {n})")
            if n <= cfg["maxRequotes"]:
                rv2, spec2 = again()
                if rv2["ok"]:
                    x["revalidation"] = rv2
                    self._submit(x, auth, rv2, spec2, acct, cfg, again)
                    return
                x.update({"orderState": "REJECTED", "stateReason": f"{cls['reason']}; re-check failed: {rv2['reason']}"})
            else:
                x.update({"orderState": "REJECTED", "stateReason": f"{cls['reason']} — requote limit {cfg['maxRequotes']} reached"})
            self._save(x)
            self._event(x, "SUBMISSION", "REJECTED", x["stateReason"])
            return
        if out == "REJECTED":
            x.update({"orderState": "REJECTED", "stateReason": f"Broker rejected: {cls['reason']}"})
            self._save(x)
            self._event(x, "BROKER", "REJECTED", x["stateReason"])
            return
        x.update({"orderState": "UNKNOWN", "stateReason": f"Submission outcome unknown ({cls['reason']}) — reconciling by execution ID, never resent"})
        self._save(x)
        self._event(x, "BROKER", "UNKNOWN", x["stateReason"])
        self._resolve_inflight(x, acct, self.p.positions() or [], self.p.orders() or [], cfg, self.clock())

    # ------------------------------------------------------------ mirror + meta
    def _mirror(self, attached: dict[str, Any], term: dict[str, Any], now: float) -> None:
        sig = tuple(sorted((p["ticket"], p["volume"], p.get("sl"), p.get("tp")) for p in self.last_positions))
        if sig == self._mirror_sig and now - self._mirror_at < SERVICE["mirrorEverySec"]:
            return
        links = {int(x["mt5Position"]): x["executionId"] for x in self.s.ledger_active() if x.get("mt5Position")}
        try:
            self.s.mirror_positions(attached["id"], self.last_positions, term.get("currency") or "USD", links)
            self._mirror_sig, self._mirror_at = sig, now
        except Exception:  # pragma: no cover
            traceback.print_exc()

    def _finish(self, cfg: dict[str, Any], ctrl: dict[str, Any], auto: bool, term: dict[str, Any] | None, attached: dict[str, Any] | None, now: float,
                triggers: list[str], note: str | None = None) -> dict[str, Any]:
        connected = bool(term and term.get("connected"))
        control = ex.control_state(ctrl, auto, connected, self.reconciled and attached is not None)
        ledger = self.s.ledger_active()
        open_x = [x for x in ledger if x.get("positionState") in ex.OPEN_POSITION]
        queue = [x for x in ledger if x["orderState"] in ex.PRE_SUBMIT + ex.IN_FLIGHT and not x.get("positionState")]
        linked = {int(x["mt5Position"]) for x in open_x if x.get("mt5Position")}
        external = [p for p in self.last_positions if p["ticket"] not in linked] if attached or not connected else []
        basis = min(float((term or {}).get("balance") or 0), float((term or {}).get("equity") or 0))
        ext_risk = 0.0
        for p in external:
            if p.get("sl"):
                spec = (self._market(p["symbol"]) if connected else {}).get("spec") or {}
                conv = self.p.fx(600)(str(spec.get("currencyProfit") or ""), str((term or {}).get("currency") or "")) if spec and connected else {"ok": False}
                if conv.get("ok"):
                    d = 1 if p["side"] == "BUY" else -1
                    ext_risk += max(0.0, (p["priceOpen"] - p["sl"]) * d) * float(spec["contractSize"]) * p["volume"] * float(conv["rate"])
        s9_risk = sum(float(x.get("riskNowMoney") or 0) for x in open_x if x["accountId"] == (attached or {}).get("id"))
        unknown_risk = sum(1 for p in external if not p.get("sl")) + sum(1 for x in open_x if x.get("riskNowMoney") is None)
        recon = self.s.recon_open()
        pnl = sum(p["profit"] + p.get("swap", 0) for p in self.last_positions) if attached and connected else \
            sum(float(x.get("unrealizedPnl") or 0) for x in open_x)
        status = "HEALTHY" if connected and attached and self.reconciled else "DEGRADED" if connected else "DISCONNECTED"
        msg = (f"{control['state'].replace('_', ' ')} · {len(open_x)} Stage 9 position(s) · {len(external)} external · {len(queue)} in queue · "
               f"{sum(1 for f in recon if f['severity'] == 'BLOCKING')} blocking finding(s)" + (f" · {note}" if note else ""))
        self.meta.update({
            "status": status, "message": msg, "runAt": ex.iso(now), "runs": self.meta.get("runs", 0) + 1, "node": self.node,
            "control": control, "controlSettings": ctrl, "auto": auto, "reconciled": self.reconciled, "connected": connected,
            "terminal": None if not term else {k: term.get(k) for k in ("login", "server", "company", "currency", "balance", "equity", "freeMargin", "marginLevel",
                                                                        "leverage", "tradeAllowed", "tradeExpert", "algoTrading", "pingMs")} | {"accountId": (attached or {}).get("id")},
            "summary": {"openPnl": round(pnl, 2), "currency": (term or {}).get("currency"), "openRiskMoney": round(s9_risk + ext_risk, 2),
                        "openRiskPct": round(100 * (s9_risk + ext_risk) / basis, 3) if basis > 0 else None, "unknownRisk": unknown_risk,
                        "positions": len(open_x) + len(external), "stage9Positions": len(open_x), "externalPositions": len(external), "queue": len(queue),
                        "waiting": len(self.waiting), "findingsOpen": len(recon), "findingsBlocking": sum(1 for f in recon if f["severity"] == "BLOCKING")},
            "external": [{**p, "accountId": (attached or {}).get("id")} for p in external][:50],
            "waiting": self.waiting[:50], "triggers": triggers[:10], "config": {k: v for k, v in cfg.items() if k != "_errors"}, "configErrors": cfg.get("_errors"),
        })
        sig = json_sig({k: self.meta.get(k) for k in ("status", "control", "summary", "reconciled", "external", "waiting")})
        if sig != self._meta_sig or now - self._meta_at >= SERVICE["metaEverySec"]:
            self._meta_sig, self._meta_at = sig, now
            try:
                self.s.save_meta(self.meta)
            except Exception:  # pragma: no cover
                traceback.print_exc()
        return {"ran": True, "control": control["state"], "status": status}

    # ------------------------------------------------------------ operator commands (executed by this engine, never by the browser)
    def set_control(self, patch: dict[str, Any], actor: str, reason: str | None) -> dict[str, Any]:
        changed: list[str] = []
        if "tradingEnabled" in patch:
            if self.s.set_trading(bool(patch["tradingEnabled"]), actor, reason).get("changed"):
                changed.append("tradingEnabled")
        res = self.s.save_control({k: patch[k] for k in ("executionEnabled", "emergencyStop", "analysisPaused") if k in patch}, actor, reason)
        changed += res.get("changed") or []
        if "analysisPaused" in changed:
            analysis_gate.invalidate()
        if changed:
            self.mark("CONTROL_CHANGE " + ",".join(changed))
            self._notify("CONTROL_CHANGE")
        return {"ok": True, "changed": changed, "control": res.get("control"), "tradingEnabled": self.s.auto_enabled()}

    def request_reconcile(self, actor: str) -> dict[str, Any]:
        with self._run_lock:
            self.reconciled = False
            self._event(None, "OPERATOR", "RECONCILE_REQUESTED", f"Full reconciliation requested by {actor} — new executions wait for it",
                        account=self.attached_id)
        self.mark("MANUAL_RECONCILE")
        return {"ok": True, "message": "Full reconciliation queued on the central engine"}

    def request_exit(self, eid: str, actor: str, reason: str | None) -> dict[str, Any]:
        with self._run_lock:
            x = self.s.ledger_get(eid)
            if not x or x.get("positionState") not in ex.OPEN_POSITION:
                return {"ok": False, "message": "No open Stage 9 position for this execution"}
            x.setdefault("mgmt", {})["exitRequest"] = {"actor": actor, "reason": reason or "operator", "at": ex.iso(self.clock())}
            self._save(x)
            self._event(x, "OPERATOR", "EXIT_REQUESTED", f"Exit requested by {actor}: {reason or 'no reason given'} — the engine will close it")
        self.mark("OPERATOR_EXIT")
        return {"ok": True, "message": f"Exit of {eid} queued on the central engine"}

    def resolve_finding(self, rid: int, resolution: str, actor: str, note: str | None) -> dict[str, Any]:
        resolution = resolution.upper()
        if resolution not in ("VERIFIED", "NOT_EXECUTED", "ACCEPTED", "CLOSED_MANUALLY"):
            return {"ok": False, "message": "resolution must be VERIFIED, NOT_EXECUTED, ACCEPTED or CLOSED_MANUALLY"}
        with self._run_lock:
            f = next((r for r in self.s.recon_open() if r["id"] == int(rid)), None)
            if not f:
                return {"ok": False, "message": "Finding not open"}
            if resolution == "NOT_EXECUTED" and f.get("executionId"):
                x = self.s.ledger_get(f["executionId"])
                if x and x["orderState"] in ("UNKNOWN", "RECONCILING"):
                    x.update({"orderState": "REJECTED", "stateReason": f"Operator {actor} verified in MT5 that it was not executed: {note or ''}"})
                    self._save(x)
                    self._event(x, "OPERATOR", "NOT_EXECUTED", x["stateReason"])
            self.s.recon_resolve(int(rid), None, resolution, actor, note)
            self._event(None, "OPERATOR", "RESOLVED", f"{actor} resolved {f['status']} #{rid} as {resolution}: {note or ''}", account=f["accountId"])
        self.mark("FINDING_RESOLVED")
        return {"ok": True, "message": f"Finding #{rid} resolved as {resolution}"}

    # ------------------------------------------------------------ reads for the UI
    def state(self) -> dict[str, Any]:
        meta = self.s.load_meta() or self.meta
        ledger = self.s.ledger_recent(24, 120)
        ids = {x["executionId"] for x in ledger}
        pend = [a for a in self.s.pending_authorizations() if a["executionId"] not in ids]
        waiting = {w["executionId"]: w for w in meta.get("waiting") or []}
        virtual = [{"executionId": a["executionId"], "setupKey": a["setupKey"], "accountId": a["accountId"], "accountName": a.get("accountName"),
                    "accountClass": a.get("accountClass"), "instrument": a["instrument"], "direction": a["direction"], "authVolume": a["volume"],
                    "entryType": (a.get("entryPolicy") or {}).get("type"), "authExpiresAt": a.get("expiresAt"), "authSl": a.get("stopLoss"),
                    "authTp": a.get("takeProfit"), "riskAmount": a.get("riskAmount"), "riskPct": a.get("riskPct"), "orderState": "AUTHORIZED",
                    "blockerCode": (waiting.get(a["executionId"]) or {}).get("blocker"), "stateReason": (waiting.get(a["executionId"]) or {}).get("reason")
                    or "Awaiting Stage 9 pre-execution revalidation", "virtual": True} for a in pend]
        cfg, overrides = self.s.load_config()
        return {"ok": True, "run": meta, "ledger": ledger, "pendingAuthorizations": virtual, "orders": self.s.orders(None, 120), "deals": self.s.deals(None, 120),
                "trades": self.s.trades(100), "reconciliation": {"open": self.s.recon_open(), "recent": self.s.recon_recent(40)},
                "storedPositions": self.s.stored_positions(), "config": {k: v for k, v in cfg.items() if k != "_errors"}, "overrides": overrides,
                "defaults": ex.CONFIG, "bounds": {k: list(v) for k, v in ex.BOUNDS.items()}, "control": self.s.load_control(), "tradingEnabled": self.s.auto_enabled(), "events": self.s.events(None, 60)}

    def detail(self, eid: str) -> dict[str, Any]:
        x = self.s.ledger_get(eid)
        auth = (x or {}).get("authorization")
        if auth is None:
            auth = next((a for a in self.s.pending_authorizations() if a["executionId"] == eid), None)
        return {"ok": True, "executionId": eid, "execution": x, "authorization": auth, "events": self.s.events(eid, 400), "orders": self.s.orders(eid),
                "deals": self.s.deals(eid), "reconciliation": [f for f in self.s.recon_open() + self.s.recon_recent(200) if f.get("executionId") == eid],
                "trade": next((t for t in self.s.trades(500) if t["executionId"] == eid), None)}


def json_sig(v: Any) -> str:
    import json
    return json.dumps(v, sort_keys=True, default=str)
