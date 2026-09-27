"""Stage 9 Execution & Positions: revalidation, routing, submission, broker reconciliation, autonomous management, exits and the
Stage 10 hand-off. Authorizations are produced by the real Stage 8 engine; MT5 and SQL Server are replaced by in-memory fakes."""

from __future__ import annotations

import copy
import itertools
import json
import unittest

import execution as ex
import execution_service as es
import risk
import test_risk as tr

NOW = tr.NOW
RISK_CFG = risk.merge_config({})[0]
GBP = dict(instrument="GBPUSD", invalidationLevel=1.2980, boundaries={"H8": {"lower": 1.29, "upper": 1.3070}})


def rt(v):
    return json.loads(json.dumps(v, default=str))


def stage8(accounts, handoffs=None, **kw) -> list[dict]:
    hs = handoffs or [tr.eur_long()]
    res = tr.run(hs, accounts, **kw)
    assert res["authorizations"], [a["reason"] for o in res["opportunities"] for a in o["accounts"]]
    return res["authorizations"]


def gbp_long() -> dict:
    return tr.eur_long(**GBP, entryContext={**tr.eur_long()["entryContext"], "triggerTs": 1790007200, "lastClose": 1.2998})


# ---------------------------------------------------------------- fakes

class FakeMT5:
    """A hedging-account MT5 terminal: positions carry the opening order ticket, deals carry comment / magic / reason."""

    def __init__(self, clock, login="1", server="Broker-Demo", currency="USD", equity=10000.0):
        self.clock = clock
        self.connected = True
        self.acct = {"login": str(login), "server": server, "currency": currency, "balance": equity, "equity": equity, "margin": 0.0,
                     "freeMargin": equity}
        self.trade_allowed = True
        self.trade_expert = True
        self.specs = {s: tr.spec(s, fillingMode=1) for s in tr.SPECS}
        self.quotes = {s: [m["bid"], m["ask"]] for s, m in tr.market().items()}
        self.pos: list[dict] = []
        self.ords: list[dict] = []
        self.horders: list[dict] = []
        self.dls: list[dict] = []
        self.seq = itertools.count(50001)
        self.script: list[str] = []
        self.sent: list[tuple[dict, str, str]] = []
        self.margin = 100.0
        self.fx_fn = tr.fx_from(tr.RATES)

    # --- simulation controls
    def quote(self, sym: str, bid: float, spread: float | None = None) -> None:
        sp = spread if spread is not None else self.quotes[sym][1] - self.quotes[sym][0]
        self.quotes[sym] = [round(bid, 6), round(bid + sp, 6)]
        for p in self.pos:
            if p["symbol"] == sym:
                self._reprice(p)

    def _reprice(self, p: dict) -> None:
        bid, ask = self.quotes[p["symbol"]]
        d = 1 if p["side"] == "BUY" else -1
        p["priceCurrent"] = bid if d > 0 else ask
        p["profit"] = round((p["priceCurrent"] - p["priceOpen"]) * d * self.specs[p["symbol"]]["contractSize"] * p["volume"], 2)

    def _deal(self, p: dict, entry: str, volume: float, price: float, reason: str, profit: float = 0.0) -> dict:
        t = next(self.seq)
        side = p["side"] if entry == "IN" else ("SELL" if p["side"] == "BUY" else "BUY")
        dl = {"ticket": t, "order": t if entry != "IN" else p["ticket"], "position": p["ticket"], "symbol": p["symbol"], "side": side,
              "type": 0 if side == "BUY" else 1, "entry": entry, "volume": volume, "price": price, "commission": round(-3.0 * volume, 2),
              "swap": 0.0, "fee": 0.0, "profit": profit, "magic": p["magic"], "comment": p["comment"], "reason": reason, "time": self.clock()}
        self.dls.append(dl)
        return dl

    def open_position(self, sym, side, volume, sl=None, tp=None, magic=0, comment="", slip=0.0) -> dict:
        t = next(self.seq)
        bid, ask = self.quotes[sym]
        d = 1 if side == "BUY" else -1
        p = {"ticket": t, "identifier": t, "symbol": sym, "side": side, "volume": volume, "priceOpen": round((ask if d > 0 else bid) + d * slip, 6),
             "priceCurrent": bid if d > 0 else ask, "sl": sl, "tp": tp, "profit": 0.0, "swap": 0.0, "magic": magic, "comment": comment,
             "time": self.clock()}
        self._reprice(p)
        self.pos.append(p)
        self._deal(p, "IN", volume, p["priceOpen"], "EXPERT" if magic else "CLIENT")
        return p

    def broker_close(self, ticket: int, volume: float | None = None, price: float | None = None, reason: str = "CLIENT") -> dict:
        p = next(p for p in self.pos if p["ticket"] == ticket)
        vol = round(min(volume or p["volume"], p["volume"]), 8)
        bid, ask = self.quotes[p["symbol"]]
        d = 1 if p["side"] == "BUY" else -1
        px = price if price is not None else (bid if d > 0 else ask)
        profit = round((px - p["priceOpen"]) * d * self.specs[p["symbol"]]["contractSize"] * vol, 2)
        dl = self._deal(p, "OUT", vol, px, reason, profit)
        p["volume"] = round(p["volume"] - vol, 8)
        if p["volume"] <= 1e-9:
            self.pos.remove(p)
        return dl

    def fill_pending(self, ticket: int) -> dict:
        o = next(o for o in self.ords if o["ticket"] == ticket)
        self.ords.remove(o)
        side = o["type"].split("_")[0]
        p = {"ticket": ticket, "identifier": ticket, "symbol": o["symbol"], "side": side, "volume": o["volumeCurrent"], "priceOpen": o["priceOpen"],
             "priceCurrent": o["priceOpen"], "sl": o["sl"], "tp": o["tp"], "profit": 0.0, "swap": 0.0, "magic": o["magic"], "comment": o["comment"],
             "time": self.clock()}
        self._reprice(p)
        self.pos.append(p)
        self.horders.append({**o, "state": "FILLED", "timeDone": self.clock(), "positionId": ticket})
        self._deal(p, "IN", p["volume"], p["priceOpen"], "EXPERT")
        return p

    def entry_sends(self) -> list[dict]:
        return [r for r, _, _ in self.sent if r["action"] in ("DEAL", "PENDING") and not r.get("position")]

    def sends(self, action: str) -> list[dict]:
        return [r for r, _, _ in self.sent if r["action"] == action]

    # --- provider interface (execution_mt5.ExecutionMT5)
    def terminal(self):
        a = self.acct
        return {"connected": self.connected, "algoTrading": True, "login": a["login"], "server": a["server"], "company": "Fake Broker",
                "currency": a["currency"], "balance": a["balance"], "equity": a["equity"], "margin": a["margin"], "freeMargin": a["freeMargin"],
                "marginLevel": None, "leverage": 500, "profit": 0.0, "tradeAllowed": self.trade_allowed, "tradeExpert": self.trade_expert,
                "marginMode": 2, "pingMs": 20, "snapshotAt": self.clock()}

    def positions(self):
        return copy.deepcopy(self.pos) if self.connected else None

    def orders(self):
        return copy.deepcopy(self.ords) if self.connected else None

    def market(self, symbol):
        if symbol not in self.specs:
            return {}
        bid, ask = self.quotes[symbol]
        return {"spec": dict(self.specs[symbol]), "bid": bid, "ask": ask, "time": self.clock() - 1}

    def fx(self, max_age):
        return self.fx_fn

    def margin_per_lot(self, symbol, side, price):
        return self.margin

    def position_deals(self, position_id):
        return [dict(d) for d in self.dls if d["position"] == int(position_id)] if self.connected else None

    def history_order(self, ticket):
        return next((dict(o) for o in self.horders if o["ticket"] == int(ticket)), None)

    def find_execution(self, eid, symbol, magic, since):
        if not self.connected:
            return None
        h = [dict(o) for o in self.horders if o["comment"] == eid]
        tickets = {o["ticket"] for o in h}
        return {"positions": [dict(p) for p in self.pos if p["comment"] == eid], "orders": [dict(o) for o in self.ords if o["comment"] == eid],
                "historyOrders": h, "deals": [dict(d) for d in self.dls if d["comment"] == eid or d["order"] in tickets],
                "magicCandidates": [dict(p) for p in self.pos if p["symbol"] == symbol and p["magic"] == magic and p["comment"] != eid]}

    def _res(self, rc, **kw):
        return {"sent": True, "result": {"retcode": rc, "comment": ex.RETCODES.get(rc, ""), "order": 0, "deal": 0, "volume": 0.0, "price": 0.0, **kw},
                "latencyMs": 37, "sentAt": self.clock(), "check": {"retcode": 0}}

    def send(self, req, login, server):
        if not self.connected:
            return {"sent": False, "notSentReason": "MT5 terminal not connected to the broker"}
        if str(login) != self.acct["login"]:
            return {"sent": False, "notSentReason": f"Terminal attached to {self.acct['login']}, not {login} — not submitted"}
        mode = self.script.pop(0) if self.script else "fill"
        self.sent.append((copy.deepcopy(req), mode, str(login)))
        if mode == "check_fail":
            return {"sent": False, "notSentReason": "order_check refused: No money (10019)", "check": {"retcode": 10019}}
        a = req["action"]
        if a == "SLTP":
            if mode == "reject":
                return self._res(10016)
            p = next((p for p in self.pos if p["ticket"] == req["position"]), None)
            if p is None:
                return self._res(10036)
            p["sl"], p["tp"] = req["sl"], req["tp"]
            return self._res(10009)
        if a == "REMOVE":
            o = next((o for o in self.ords if o["ticket"] == req["order"]), None)
            if o:
                self.ords.remove(o)
                self.horders.append({**o, "state": "CANCELED", "timeDone": self.clock()})
            return self._res(10009, order=req["order"])
        if a == "PENDING":
            t = next(self.seq)
            self.ords.append({"ticket": t, "symbol": req["symbol"], "type": req["type"], "state": "PLACED", "volumeInitial": req["volume"],
                              "volumeCurrent": req["volume"], "priceOpen": req["price"], "sl": req.get("sl"), "tp": req.get("tp"),
                              "magic": req["magic"], "comment": req["comment"], "timeSetup": self.clock(), "timeDone": None, "positionId": 0})
            return self._res(10008, order=t)
        if req.get("position"):   # close / partial close
            if mode == "reject":
                return self._res(10018)
            if mode == "timeout_nofill":
                return {"sent": True, "result": None, "error": "timeout", "latencyMs": 9000, "sentAt": self.clock()}
            dl = self.broker_close(req["position"], req["volume"], reason="EXPERT")
            return self._res(10009, order=dl["order"], deal=dl["ticket"], volume=dl["volume"], price=dl["price"], positionId=dl["position"],
                             dealPrice=dl["price"])
        # new market entry
        if mode == "reject":
            return self._res(10019)
        if mode == "requote":
            return self._res(10004)
        if mode == "retcode_timeout":
            return self._res(10012)
        if mode == "timeout_nofill":
            return {"sent": True, "result": None, "error": "order_send returned no result: timeout", "latencyMs": 9000, "sentAt": self.clock()}
        vol = float(req["volume"])
        if mode == "partial":
            vol = ex.floor_step(vol / 2, 0.01)
        p = self.open_position(req["symbol"], req["type"], vol, None if mode == "fill_nosl" else req.get("sl"), req.get("tp"), req["magic"],
                               "" if mode == "timeout_fill_nocomment" else req["comment"])
        if mode in ("timeout_fill", "timeout_fill_nocomment"):
            return {"sent": True, "result": None, "error": "order_send returned no result: timeout", "latencyMs": 9000, "sentAt": self.clock()}
        if mode == "disconnect_fill":
            self.connected = False
            return {"sent": True, "result": None, "error": "connection lost", "latencyMs": 9000, "sentAt": self.clock()}
        dl = self.dls[-1]
        return self._res(10010 if mode == "partial" else 10009, order=p["ticket"], deal=dl["ticket"], volume=vol, price=p["priceOpen"],
                         positionId=p["ticket"], dealPrice=p["priceOpen"])


class FakeStore:
    """In-memory execution_store with the same compare-and-set semantics; documents round-trip through JSON like SQL Server."""

    def __init__(self, accounts, auths, clock):
        self.clock = clock
        self._accounts = accounts
        self.auth = {a["executionId"]: {"doc": rt(a), "status": "PENDING"} for a in auths}
        self.ledger: dict[str, dict] = {}
        self.evts: list[dict] = []
        self.ords: list[dict] = []
        self.dls: dict[tuple, dict] = {}
        self.recon: list[dict] = []
        self.published: dict[str, dict] = {}
        self.control = {"executionEnabled": True, "emergencyStop": False}
        self.auto = True
        self.cfg_over: dict = {}
        self.risk_accts: dict = {}
        self.up: dict = {}
        self.s7: dict = {}
        self.h1: dict = {}
        self.meta = None

    def add_auth(self, a):
        self.auth[a["executionId"]] = {"doc": rt(a), "status": "PENDING"}

    def ensure_schema(self):
        pass

    def load_config(self):
        cfg, errors = ex.merge_config(self.cfg_over)
        assert not errors, errors
        return cfg, dict(self.cfg_over)

    def load_control(self):
        return dict(self.control)

    def save_control(self, patch, actor, reason):
        changed = [k for k in patch if self.control.get(k) != patch[k]]
        self.control.update(patch)
        return {"ok": True, "control": dict(self.control), "changed": changed}

    def auto_enabled(self):
        return self.auto

    def set_trading(self, enabled, actor, reason):
        ch = self.auto != enabled
        self.auto = enabled
        return {"ok": True, "changed": ch}

    def accounts(self):
        return copy.deepcopy(self._accounts)

    def risk_context(self):
        return RISK_CFG, self.risk_accts

    def pending_authorizations(self):
        return [copy.deepcopy(v["doc"]) for v in self.auth.values() if v["status"] == "PENDING"]

    def authorization_status(self, eid):
        return (self.auth.get(eid) or {}).get("status")

    def consume_authorization(self, eid, reason):
        v = self.auth.get(eid)
        if not v or v["status"] != "PENDING" or ex.parse_ts(v["doc"]["expiresAt"]) <= self.clock():
            return False
        v["status"] = "CONSUMED"
        return True

    def decline_authorization(self, eid, reason):
        v = self.auth.get(eid)
        if not v or v["status"] != "PENDING":
            return False
        v["status"] = "DECLINED"
        return True

    @staticmethod
    def _closed(d):
        return d.get("positionState") == "CLOSED" or (d.get("positionState") is None and d.get("orderState") in ("REJECTED", "CANCELLED", "EXPIRED"))

    def ledger_create(self, doc):
        if doc["executionId"] in self.ledger:
            return False
        self.ledger[doc["executionId"]] = rt(doc)
        return True

    def ledger_save(self, doc, expect_state=None):
        cur = self.ledger.get(doc["executionId"])
        if cur is None:
            return False
        if expect_state:
            states = (expect_state,) if isinstance(expect_state, str) else tuple(expect_state)
            if cur["orderState"] not in states:
                return False
        new = rt(doc)
        new["closedAt"] = (cur.get("closedAt") or ex.iso(self.clock())) if self._closed(new) else None
        self.ledger[doc["executionId"]] = new
        return True

    def ledger_get(self, eid):
        d = self.ledger.get(eid)
        return rt(d) if d else None

    def ledger_active(self):
        live = ex.PRE_SUBMIT + ex.IN_FLIGHT
        return [rt(d) for d in self.ledger.values() if not d.get("closedAt") and (d["orderState"] in live or d.get("positionState") is not None)]

    def ledger_recent(self, hours=24, limit=80):
        return [rt(d) for d in self.ledger.values()][:limit]

    def traded(self, setup_key, account_id, exclude):
        return any(d["setupKey"] == setup_key and d["accountId"] == account_id and d["executionId"] != exclude and d.get("consumedAt")
                   for d in self.ledger.values())

    def mark_stale(self, account_id, stale):
        n = 0
        for d in self.ledger.values():
            if d["accountId"] == account_id and not d.get("closedAt") and bool(d.get("stale")) != stale:
                d["stale"] = stale
                n += 1
        return n

    def event(self, eid, account_id, kind, state, detail, data=None):
        self.evts.append({"id": len(self.evts) + 1, "executionId": eid, "accountId": account_id, "kind": kind, "state": state, "detail": detail,
                          "data": rt(data), "createdAt": ex.iso(self.clock())})

    def events(self, eid=None, limit=200):
        rows = [e for e in self.evts if eid is None or e["executionId"] == eid]
        return rows[:limit] if eid else list(reversed(rows))[:limit]

    def states(self, eid=None):
        return [e["state"] for e in self.evts if eid is None or e["executionId"] == eid]

    def order_add(self, row):
        if any(o["requestId"] == row["requestId"] for o in self.ords):
            return None
        self.ords.append({**rt(row), "id": len(self.ords) + 1})
        return len(self.ords)

    def order_update(self, oid, patch, complete=True):
        self.ords[oid - 1].update(rt(patch))

    def orders(self, eid=None, limit=120):
        return [dict(o) for o in self.ords if eid is None or o["executionId"] == eid]

    def deals_upsert(self, account_id, eid, deals):
        n = 0
        for d in deals:
            if (account_id, d["ticket"]) not in self.dls:
                self.dls[(account_id, d["ticket"])] = {**d, "accountId": account_id, "executionId": eid}
                n += 1
        return n

    def deals(self, eid=None, limit=120):
        return [dict(d) for d in self.dls.values() if eid is None or d["executionId"] == eid]

    def recon_open(self, account_id=None):
        return [dict(r) for r in self.recon if not r.get("resolvedAt") and (account_id is None or r["accountId"] == account_id)]

    def recon_recent(self, limit=60):
        return [dict(r) for r in self.recon if r.get("resolvedAt")][:limit]

    def recon_raise(self, item):
        for r in self.recon:
            if r["itemKey"] == item["itemKey"] and not r.get("resolvedAt"):
                r["occurrences"] += 1
                return r["id"], False
        r = {"resolution": None, **rt(item), "id": len(self.recon) + 1, "occurrences": 1, "resolvedAt": None}
        if item.get("resolution"):
            r.update({"resolvedAt": ex.iso(self.clock()), "resolvedBy": "stage9"})
        self.recon.append(r)
        return r["id"], True

    def recon_resolve(self, rid, key, resolution, actor, note):
        n = 0
        for r in self.recon:
            if not r.get("resolvedAt") and ((rid is not None and r["id"] == rid) or (rid is None and r["itemKey"] == key)):
                r.update({"resolution": resolution, "resolvedBy": actor, "resolvedAt": ex.iso(self.clock()), "note": note})
                n += 1
        return n

    def publish_trade(self, rec):
        if rec["executionId"] in self.published:
            return False
        self.published[rec["executionId"]] = rt(rec)
        return True

    def trades(self, limit=200, account_id=None, symbol=None, q=None, days=None):
        return list(self.published.values())[:limit]

    def upstream(self, setup_key, symbol):
        if symbol in self.up:
            return self.up[symbol]
        a = next((v["doc"] for v in self.auth.values() if v["doc"]["instrument"] == symbol), {})
        return {"opportunityActive": True, "setupState": "QUALIFIED", "stage7State": "CONFIRMED",
                "stage7Direction": (a.get("source") or {}).get("direction") or a.get("direction")}

    def stage7(self, symbol):
        return self.s7.get(symbol)

    def evidence(self, symbol):
        return {"stage7": {"symbol": symbol, "state": "CONFIRMED"}}

    def last_h1_close(self, symbol):
        return self.h1.get(symbol)

    def mirror_positions(self, account_id, positions, currency, links):
        self.mirrored = (account_id, positions, links)

    def stored_positions(self):
        return []

    def save_meta(self, meta):
        self.meta = rt(meta)

    def load_meta(self):
        return self.meta


class Env:
    def __init__(self, accounts=None, auths=None, login="1", currency="USD", equity=10000.0, cfg=None, handoffs=None):
        self.t = [NOW]
        self.clock = lambda: self.t[0]
        self.accounts = accounts or [tr.acct()]
        self.auths = auths if auths is not None else stage8(self.accounts, handoffs)
        self.mt5 = FakeMT5(self.clock, login=login, currency=currency, equity=equity)
        self.store = FakeStore(self.accounts, self.auths, self.clock)
        self.store.cfg_over.update(cfg or {})
        self.svc = es.ExecutionService(self.mt5, "NODE-A", store=self.store, clock=self.clock)

    def tick(self, n=1, dt=2.0, svc=None):
        for _ in range(n):
            self.t[0] += dt
            (svc or self.svc).tick()

    @property
    def eid(self):
        return self.auths[0]["executionId"]

    def x(self, eid=None):
        return self.store.ledger[eid or self.eid]

    def pos(self):
        return self.mt5.pos[0]

    def move_r(self, r, eid=None):
        """Put the closing-side price at entry + r * initial risk distance."""
        x = self.x(eid)
        d = ex.dsign(x["direction"])
        px = float(x["fillPrice"]) + d * r * float(x["initialRiskDistance"])
        sp = self.mt5.quotes[x["brokerSymbol"]][1] - self.mt5.quotes[x["brokerSymbol"]][0]
        self.mt5.quote(x["brokerSymbol"], px if d > 0 else px - sp)


# ---------------------------------------------------------------- end-to-end

class EndToEnd(unittest.TestCase):
    def test_authorized_to_stage10_full_lifecycle(self):
        """Stage 8 AUTHORIZED -> REVALIDATE -> MT5 SUBMIT -> BROKER CONFIRM -> MANAGE (BE, partial, trail) -> EXIT -> RECONCILE -> Stage 10."""
        e = Env()
        e.tick()
        x = e.x()
        self.assertEqual(e.store.auth[e.eid]["status"], "CONSUMED")
        self.assertEqual((x["orderState"], x["positionState"]), ("FILLED", "PROTECTED"))
        req = e.mt5.entry_sends()[0]
        self.assertEqual((req["comment"], req["magic"], req["sl"]), (e.eid, 90909, e.auths[0]["stopLoss"]))
        self.assertEqual(x["mt5Position"], e.pos()["ticket"])
        self.assertTrue(x["consumedAt"] and x["submitAttemptedAt"])
        entry = [o for o in e.store.ords if o["purpose"] == "ENTRY"]
        self.assertEqual((len(entry), entry[0]["status"], entry[0]["retcode"]), (1, "FILLED", 10009))
        self.assertEqual(len(e.store.deals(e.eid)), 1)
        for s in ("AUTHORIZED", "CONSUMED", "SUBMITTING", "ACKNOWLEDGED", "FILLED"):
            self.assertIn(s, e.store.states(e.eid))
        vol = x["openVolume"]

        e.move_r(1.1)
        e.tick()
        x = e.x()
        self.assertEqual(x["positionState"], "BREAKEVEN")
        self.assertGreater(e.pos()["sl"], x["fillPrice"])
        self.assertEqual(e.mt5.sends("SLTP")[-1]["sl"], x["protectiveSl"])

        e.move_r(1.6)
        e.tick(2)
        x = e.x()
        self.assertTrue(x["mgmt"]["partialDone"])
        self.assertAlmostEqual(e.pos()["volume"], vol - ex.floor_step(vol * 0.5, 0.01))
        self.assertAlmostEqual(x["openVolume"], e.pos()["volume"])

        be_sl = x["protectiveSl"]
        e.move_r(2.5)
        e.tick()
        x = e.x()
        self.assertEqual(x["positionState"], "TRAILING")
        self.assertGreater(x["protectiveSl"], be_sl)
        self.assertAlmostEqual(e.pos()["sl"], x["protectiveSl"])

        e.mt5.broker_close(e.pos()["ticket"], price=e.pos()["sl"], reason="SL")
        e.tick()
        x = e.x()
        self.assertEqual((x["positionState"], x["exitReason"]), ("CLOSED", "TRAILING_STOP"))
        self.assertTrue(x["closedAt"])
        rec = e.store.published[e.eid]
        self.assertGreater(rec["realizedPnl"], 0)
        self.assertGreater(rec["rMultiple"], 1.0)
        self.assertEqual(rec["exitReason"], "TRAILING_STOP")
        self.assertEqual(rec["evidence"]["stage8"]["authorization"]["executionId"], e.eid)
        self.assertEqual(rec["entryExpected"], e.auths[0]["entryPolicy"]["referencePrice"])
        self.assertIsNotNone(rec["executionQuality"]["latencyMs"])
        self.assertTrue(rec["timeline"])
        self.assertIn("PUBLISHED", e.store.states(e.eid))
        self.assertEqual(e.store.ledger_active(), [])
        n = len(e.mt5.sent)
        e.tick(3)
        self.assertEqual(len(e.mt5.sent), n)   # nothing further happens for a closed trade
        self.assertEqual(len(e.store.published), 1)


# ---------------------------------------------------------------- idempotency

class Idempotency(unittest.TestCase):
    def test_retries_duplicate_events_and_second_node_never_resubmit(self):
        e = Env()
        stale = e.store.pending_authorizations()
        e.tick()
        e.store.pending_authorizations = lambda: copy.deepcopy(stale + stale)   # replayed + duplicated authorization events
        node_b = es.ExecutionService(e.mt5, "NODE-B", store=e.store, clock=e.clock)
        e.tick(3)
        e.tick(2, svc=node_b)
        self.assertEqual(len(e.mt5.entry_sends()), 1)
        self.assertEqual(len([o for o in e.store.ords if o["purpose"] == "ENTRY"]), 1)

    def test_consume_is_compare_and_set(self):
        e = Env()
        self.assertTrue(e.store.consume_authorization(e.eid, "a"))
        self.assertFalse(e.store.consume_authorization(e.eid, "b"))

    def test_claim_is_compare_and_set_on_order_state(self):
        e = Env()
        doc = ex.new_ledger(e.auths[0], "NODE-A", NOW)
        doc["orderState"] = "REVALIDATING"
        self.assertTrue(e.store.ledger_create(doc))
        self.assertFalse(e.store.ledger_create(doc))
        doc["orderState"] = "SUBMITTING"
        self.assertTrue(e.store.ledger_save(doc, ex.PRE_SUBMIT))
        self.assertFalse(e.store.ledger_save(doc, ex.PRE_SUBMIT))   # a second node can no longer claim it

    def test_rejected_execution_is_never_retried(self):
        e = Env()
        e.mt5.script = ["reject"]
        e.tick(4)
        self.assertEqual(e.x()["orderState"], "REJECTED")
        self.assertIn("NO_MONEY", e.x()["stateReason"])
        self.assertEqual(len(e.mt5.entry_sends()), 1)
        self.assertEqual(e.store.auth[e.eid]["status"], "CONSUMED")


# ---------------------------------------------------------------- broker outcomes

class BrokerOutcomes(unittest.TestCase):
    def test_order_check_refusal_is_not_submitted(self):
        e = Env()
        e.mt5.script = ["check_fail"]
        e.tick(3)
        self.assertEqual(e.x()["orderState"], "REJECTED")
        self.assertIn("order_check", e.x()["stateReason"])
        self.assertEqual(e.mt5.pos, [])

    def test_requote_is_retried_within_policy(self):
        e = Env()
        e.mt5.script = ["requote", "fill"]
        e.tick()
        self.assertEqual((e.x()["orderState"], e.x()["requotes"]), ("FILLED", 1))
        self.assertEqual(len(e.mt5.entry_sends()), 2)
        self.assertEqual(len(e.mt5.pos), 1)

    def test_requote_limit(self):
        e = Env()
        e.mt5.script = ["requote"] * 5
        e.tick(3)
        self.assertEqual(e.x()["orderState"], "REJECTED")
        self.assertEqual(len(e.mt5.entry_sends()), 3)   # first attempt + maxRequotes

    def test_partial_fill(self):
        e = Env()
        e.mt5.script = ["partial"]
        e.tick(2)
        x = e.x()
        self.assertEqual(x["orderState"], "PARTIALLY_FILLED")
        self.assertAlmostEqual(x["filledVolume"], ex.floor_step(e.auths[0]["volume"] / 2, 0.01))
        self.assertLess(x["initialRiskMoney"], e.auths[0]["riskAmount"])
        self.assertEqual(len(e.mt5.entry_sends()), 1)

    def test_unknown_outcome_that_filled_is_linked_not_resent(self):
        e = Env()
        e.mt5.script = ["timeout_fill"]
        e.tick()
        self.assertEqual(e.x()["orderState"], "FILLED")
        self.assertIn("UNKNOWN", e.store.states(e.eid))
        e.tick(3)
        self.assertEqual(len(e.mt5.entry_sends()), 1)

    def test_unknown_outcome_without_comment_matched_by_magic(self):
        e = Env()
        e.mt5.script = ["timeout_fill_nocomment"]
        e.tick(2)
        self.assertEqual(e.x()["orderState"], "FILLED")
        self.assertIn("magic", e.x()["stateReason"])
        self.assertEqual(len(e.mt5.entry_sends()), 1)

    def test_unknown_outcome_never_filled_escalates_and_blocks(self):
        auths = stage8([tr.acct()], [tr.eur_long(), gbp_long()])
        e = Env(auths=auths[:1])
        e.mt5.script = ["retcode_timeout"]
        e.tick()
        self.assertEqual(e.x()["orderState"], "UNKNOWN")
        e.tick(3)
        self.assertEqual(len(e.mt5.entry_sends()), 1)
        self.assertEqual(e.x()["orderState"], "UNKNOWN")
        self.assertFalse(e.store.recon_open())       # escalated only after unknownResolveSec
        e.t[0] += 100
        e.tick()
        self.assertEqual(e.x()["orderState"], "UNKNOWN")
        f = [r for r in e.store.recon_open() if r["status"] == "UNKNOWN_OUTCOME"]
        self.assertEqual((len(f), f[0]["severity"]), (1, "BLOCKING"))
        e.store.add_auth(auths[1])
        e.tick()
        gx = e.x(auths[1]["executionId"])
        self.assertEqual((gx["orderState"], gx["blockerCode"]), ("QUEUED", "RECONCILIATION_UNRESOLVED"))
        self.assertEqual(len(e.mt5.entry_sends()), 1)
        res = e.svc.resolve_finding(f[0]["id"], "NOT_EXECUTED", "tester", "checked MT5 journal")
        self.assertTrue(res["ok"])
        self.assertEqual(e.x()["orderState"], "REJECTED")
        e.tick()
        self.assertEqual(e.x(auths[1]["executionId"])["orderState"], "FILLED")
        self.assertEqual(len(e.mt5.entry_sends()), 2)


# ---------------------------------------------------------------- restart recovery + disconnects

class Recovery(unittest.TestCase):
    def _claimed(self, e, attempted: bool):
        doc = ex.new_ledger(e.auths[0], "NODE-A", NOW)
        doc.update({"orderState": "SUBMITTING", "consumedAt": ex.iso(NOW)})
        if attempted:
            doc["submitAttemptedAt"] = ex.iso(NOW)
        e.store.ledger_create(doc)
        e.store.auth[e.eid]["status"] = "CONSUMED"

    def test_crash_before_send_is_rejected_never_submitted(self):
        e = Env()
        self._claimed(e, attempted=False)
        e.tick()
        self.assertEqual(e.x()["orderState"], "REJECTED")
        self.assertEqual(e.mt5.sent, [])

    def test_crash_after_send_links_broker_position(self):
        e = Env()
        self._claimed(e, attempted=True)
        e.mt5.open_position("EURUSD", "BUY", e.auths[0]["volume"], e.auths[0]["stopLoss"], e.auths[0]["takeProfit"], 90909, e.eid)
        e.tick()
        self.assertEqual((e.x()["orderState"], e.x()["positionState"]), ("FILLED", "PROTECTED"))
        self.assertEqual(e.mt5.sent, [])

    def test_restart_reconciles_before_new_entries_and_keeps_managing(self):
        auths = stage8([tr.acct()], [tr.eur_long(), gbp_long()])
        e = Env(auths=auths[:1])
        e.tick()
        e.store.add_auth(auths[1])
        restarted = es.ExecutionService(e.mt5, "NODE-A", store=e.store, clock=e.clock)
        e.move_r(1.1)
        e.tick(svc=restarted)
        states = e.store.states()
        self.assertLess(states.index("RECONCILED", len(states) - 12), max(i for i, s in enumerate(states) if s == "CONSUMED"))
        self.assertEqual(e.x()["positionState"], "BREAKEVEN")
        self.assertEqual(e.x(auths[1]["executionId"])["orderState"], "FILLED")
        self.assertEqual(len(e.mt5.entry_sends()), 2)

    def test_disconnect_marks_stale_blocks_entries_and_reconnect_reconciles_first(self):
        auths = stage8([tr.acct()], [tr.eur_long(), gbp_long()])
        e = Env(auths=auths[:1])
        e.tick()
        e.mt5.connected = False
        e.store.add_auth(auths[1])
        e.move_r(1.1)
        e.tick(2)
        self.assertTrue(e.x()["stale"])
        self.assertEqual(e.store.meta["status"], "DISCONNECTED")
        self.assertEqual(e.store.meta["control"]["state"], "MT5_DISCONNECTED")
        self.assertEqual(e.store.meta["summary"]["stage9Positions"], 1)
        self.assertEqual(len(e.mt5.sent), 1)          # neither management nor entries without a connection
        e.mt5.connected = True
        e.tick()
        states = e.store.states()
        self.assertLess(states.index("MT5_RECONNECTED"), states.index("RECONCILED", states.index("MT5_RECONNECTED")))
        self.assertFalse(e.x()["stale"])
        self.assertEqual(e.x()["positionState"], "BREAKEVEN")
        self.assertEqual(e.x(auths[1]["executionId"])["orderState"], "FILLED")

    def test_disconnect_during_submission_reconciled_on_reconnect(self):
        e = Env()
        e.mt5.script = ["disconnect_fill"]
        e.tick()
        self.assertEqual(e.x()["orderState"], "UNKNOWN")
        e.tick(2)
        self.assertEqual(e.x()["orderState"], "UNKNOWN")
        e.mt5.connected = True
        e.tick()
        self.assertEqual(e.x()["orderState"], "FILLED")
        self.assertEqual(len(e.mt5.entry_sends()), 1)


# ---------------------------------------------------------------- control states

class Control(unittest.TestCase):
    def test_paused_blocks_entries_but_management_continues(self):
        auths = stage8([tr.acct()], [tr.eur_long(), gbp_long()])
        e = Env(auths=auths[:1])
        e.tick()
        e.store.auto = False
        e.store.add_auth(auths[1])
        e.move_r(1.1)
        e.tick()
        self.assertEqual(e.x()["positionState"], "BREAKEVEN")
        self.assertEqual(len(e.mt5.entry_sends()), 1)
        self.assertEqual(e.store.auth[auths[1]["executionId"]]["status"], "PENDING")
        self.assertEqual(e.store.meta["waiting"][0]["blocker"], "TRADING_PAUSED")

    def test_execution_disabled_and_emergency_stop(self):
        e = Env()
        e.store.control["executionEnabled"] = False
        e.tick()
        self.assertEqual(e.mt5.sent, [])
        self.assertEqual(e.store.meta["control"]["state"], "EXECUTION_DISABLED")
        e.store.control.update({"executionEnabled": True, "emergencyStop": True})
        e.tick()
        self.assertEqual(e.mt5.sent, [])
        self.assertEqual(e.store.meta["control"]["state"], "EMERGENCY_STOP")
        e.store.control["emergencyStop"] = False
        e.tick()
        self.assertEqual(len(e.mt5.entry_sends()), 1)

    def test_control_states_are_separate(self):
        c = ex.control_state({"executionEnabled": False, "emergencyStop": True}, False, False, False)
        self.assertEqual([f["state"] for f in c["flags"]], ["EMERGENCY_STOP", "MT5_DISCONNECTED", "EXECUTION_DISABLED", "TRADING_PAUSED"])
        self.assertFalse(c["newEntries"])
        c = ex.control_state({"executionEnabled": True}, False, True, True)
        self.assertEqual((c["state"], c["newEntries"], c["management"]), ("TRADING_PAUSED", False, True))
        c = ex.control_state({"executionEnabled": True}, True, True, False)
        self.assertEqual(c["state"], "RECONCILING")
        self.assertTrue(ex.control_state({"executionEnabled": True}, True, True, True)["newEntries"])

    def test_analysis_pause_blocks_entries_but_keeps_management(self):
        c = ex.control_state({"executionEnabled": True, "analysisPaused": True}, True, True, True)
        self.assertEqual((c["state"], c["newEntries"], c["management"]), ("ANALYSIS_PAUSED", False, True))

    def test_operator_control_goes_through_the_engine(self):
        e = Env()
        r = e.svc.set_control({"tradingEnabled": False, "emergencyStop": True}, "tester", "drill")
        self.assertEqual(sorted(r["changed"]), ["emergencyStop", "tradingEnabled"])
        self.assertFalse(e.store.auto)
        self.assertTrue(e.store.control["emergencyStop"])


# ---------------------------------------------------------------- routing, account classes, currencies

class Routing(unittest.TestCase):
    def test_routes_to_the_attached_account_only(self):
        accts = [tr.acct("demo", login="111"), tr.acct("live", cls="LIVE", login="222")]
        auths = stage8(accts)
        e = Env(accounts=accts, auths=auths, login="222")
        e.tick()
        live = next(a for a in auths if a["accountId"] == "live")
        demo = next(a for a in auths if a["accountId"] == "demo")
        self.assertEqual(e.x(live["executionId"])["orderState"], "FILLED")
        self.assertNotIn(demo["executionId"], e.store.ledger)
        self.assertEqual(e.store.auth[demo["executionId"]]["status"], "PENDING")
        self.assertEqual(e.store.meta["waiting"][0]["blocker"], "ACCOUNT_NOT_ATTACHED")
        self.assertEqual({login for _, _, login in e.mt5.sent}, {"222"})

    def test_prop_account_executes(self):
        accts = [tr.acct("prop", cls="PROP", propRules=tr.prop())]
        e = Env(accounts=accts)
        e.tick()
        self.assertEqual((e.x()["accountClass"], e.x()["orderState"]), ("PROP", "FILLED"))

    def test_live_blocked_by_any_open_finding_demo_test_mode_relaxes(self):
        for cls, test_mode, blocked in (("LIVE", True, True), ("PROP", True, True), ("DEMO", False, True), ("DEMO", True, False)):
            with self.subTest(cls=cls, test_mode=test_mode):
                accts = [tr.acct("a", cls=cls, propRules=tr.prop() if cls == "PROP" else None)]
                e = Env(accounts=accts, cfg={"demoTestMode": test_mode})
                e.store.recon_raise({"itemKey": "SL_TP_MISMATCH|a|x", "accountId": "a", "status": "SL_TP_MISMATCH", "severity": "WARNING", "detail": "t"})
                e.tick()
                x = e.x()
                self.assertEqual(x["orderState"] == "QUEUED" and x["blockerCode"] == "RECONCILIATION_UNRESOLVED", blocked)

    def test_ngn_account_uses_validated_conversion(self):
        accts = [tr.acct("ngn", ccy="NGN", equity=15_500_000.0)]
        e = Env(accounts=accts, currency="NGN", equity=15_500_000.0)
        e.tick()
        x = e.x()
        self.assertEqual(x["orderState"], "FILLED")
        self.assertEqual(x["accountCurrency"], "NGN")
        self.assertAlmostEqual(x["revalidation"]["order"]["fxRate"], 1550.0)
        self.assertLessEqual(x["revalidation"]["order"]["riskNow"], x["revalidation"]["order"]["riskLimit"])

    def test_currency_mismatch_declines(self):
        accts = [tr.acct("ngn", ccy="NGN", equity=15_500_000.0)]
        e = Env(accounts=accts, currency="USD", equity=15_500_000.0)
        e.tick()
        self.assertEqual((e.x()["orderState"], e.x()["blockerCode"]), ("CANCELLED", "CURRENCY_MISMATCH"))
        self.assertEqual(e.store.auth[e.eid]["status"], "DECLINED")
        self.assertEqual(e.mt5.sent, [])

    def test_ngn_without_rate_waits(self):
        accts = [tr.acct("ngn", ccy="NGN", equity=15_500_000.0)]
        e = Env(accounts=accts, currency="NGN", equity=15_500_000.0)
        e.mt5.fx_fn = tr.fx_from({})
        e.tick()
        self.assertEqual((e.x()["orderState"], e.x()["blockerCode"]), ("QUEUED", "FX_UNAVAILABLE"))


# ---------------------------------------------------------------- pre-execution revalidation

class Revalidation(unittest.TestCase):
    def test_expired_authorization(self):
        e = Env()
        e.t[0] += 400
        e.tick()
        self.assertEqual((e.x()["orderState"], e.x()["blockerCode"]), ("EXPIRED", "AUTH_EXPIRED"))
        self.assertEqual(e.store.auth[e.eid]["status"], "PENDING")   # Stage 8 expires its own authorization
        self.assertEqual(e.mt5.sent, [])

    def test_stage7_invalidation_declines(self):
        e = Env()
        e.store.up["EURUSD"] = {"opportunityActive": True, "setupState": "QUALIFIED", "stage7State": "WAITING_FOR_TRIGGER", "stage7Direction": "BULLISH"}
        e.tick()
        self.assertEqual((e.x()["orderState"], e.x()["blockerCode"]), ("CANCELLED", "STAGE7_INVALIDATED"))
        self.assertEqual(e.store.auth[e.eid]["status"], "DECLINED")

    def test_transient_changes_wait_then_execute(self):
        e = Env()
        bid, ask = e.mt5.quotes["EURUSD"]
        e.mt5.quote("EURUSD", bid + 0.0030)
        e.tick()
        self.assertEqual((e.x()["orderState"], e.x()["blockerCode"]), ("QUEUED", "PRICE_DEVIATION"))
        e.mt5.quote("EURUSD", ask - 0.0010 + 0.00004, spread=0.0010)
        e.tick()
        self.assertEqual(e.x()["blockerCode"], "SPREAD_TOO_WIDE")
        e.mt5.quote("EURUSD", bid, spread=ask - bid)
        e.mt5.margin = 1e9
        e.tick()
        self.assertEqual(e.x()["blockerCode"], "MARGIN_INSUFFICIENT")
        e.mt5.margin = 100.0
        e.mt5.trade_expert = False
        e.tick()
        self.assertEqual(e.x()["blockerCode"], "ALGO_TRADING_DISABLED")
        e.mt5.trade_expert = True
        e.tick()
        self.assertEqual(e.x()["orderState"], "FILLED")
        self.assertEqual(len(e.mt5.entry_sends()), 1)

    def test_existing_exposure_blocks(self):
        e = Env()
        e.mt5.open_position("EURUSD", "SELL", 0.1, 1.2, None, 0, "")
        e.tick()
        self.assertEqual(e.x()["blockerCode"], "SYMBOL_ALREADY_EXPOSED")

    def test_pure_revalidation_failures(self):
        a = stage8([tr.acct()])[0]
        m = tr.market()["EURUSD"]
        base = {"now": NOW, "control": {"newEntries": True}, "authStatus": "PENDING", "market": {**m, "spec": {**m["spec"], "tradeMode": 4}},
                "account": {**tr.acct(), "attached": True, "tradeExpert": True, "snapshotAt": NOW}, "fx": tr.FX, "marginPerLot": 100.0,
                "exposure": {"symbols": set(), "positions": 0, "maxPositions": 3}, "upstream": {"opportunityActive": True, "setupState": "QUALIFIED",
                                                                                                  "stage7State": "CONFIRMED", "stage7Direction": "BULLISH"}}
        cfg = ex.merge_config({})[0]
        self.assertTrue(ex.revalidate(a, base, cfg)["ok"])
        for mutate, code in ((lambda c, a: a.update(volume=0.013), "VOLUME_INVALID"),
                             (lambda c, a: a.update(stopLoss=1.2), "SL_INVALID"),
                             (lambda c, a: a.update(evidence={}), "EVIDENCE_INCOMPLETE"),
                             (lambda c, a: c.update(duplicate=True), "DUPLICATE_EXECUTION"),
                             (lambda c, a: c.update(traded=True), "SETUP_ALREADY_EXECUTED"),
                             (lambda c, a: c.update(authStatus="REVOKED"), "AUTH_REVOKED"),
                             (lambda c, a: c["account"].update(tradingMode="ANALYSIS_ONLY"), "ACCOUNT_DISABLED"),
                             (lambda c, a: c["market"]["spec"].update(name="EURUSD.r"), "SYMBOL_MISMATCH")):
            c, aa = copy.deepcopy(base), copy.deepcopy(a)
            mutate(c, aa)
            rv = ex.revalidate(aa, c, cfg)
            self.assertEqual((rv["ok"], rv["terminal"], rv["code"]), (False, True, code))
        c = copy.deepcopy(base)
        c["market"]["time"] = NOW - 120
        self.assertEqual(ex.revalidate(a, c, cfg)["code"], "PRICE_STALE")
        aa = copy.deepcopy(a)
        aa["riskAmount"] = a["riskAmount"] / 2
        self.assertEqual(ex.revalidate(aa, base, cfg)["code"], "RISK_EXCEEDS_AUTHORIZED")


# ---------------------------------------------------------------- pending orders

class PendingOrders(unittest.TestCase):
    def _limit(self):
        a = copy.deepcopy(stage8([tr.acct()])[0])
        a["entryPolicy"] = {**a["entryPolicy"], "type": "LIMIT", "price": 1.09950, "referencePrice": 1.09950}
        return a

    def test_limit_order_placed_then_filled(self):
        e = Env(auths=[self._limit()])
        e.tick()
        x = e.x()
        self.assertEqual(x["orderState"], "ACKNOWLEDGED")
        req = e.mt5.entry_sends()[0]
        self.assertEqual((req["action"], req["type"], req["typeTime"]), ("PENDING", "BUY_LIMIT", "SPECIFIED"))
        self.assertEqual(req["expiration"], ex.parse_ts(e.auths[0]["expiresAt"]))
        e.tick()
        self.assertEqual(e.x()["orderState"], "ACKNOWLEDGED")
        e.mt5.fill_pending(x["mt5Order"])
        e.tick()
        self.assertEqual((e.x()["orderState"], e.x()["positionState"]), ("FILLED", "PROTECTED"))
        self.assertAlmostEqual(e.x()["fillPrice"], 1.09950)

    def test_pause_withdraws_unfilled_pending_entry(self):
        e = Env(auths=[self._limit()])
        e.tick()
        e.store.auto = False
        e.tick()
        self.assertEqual(len(e.mt5.sends("REMOVE")), 1)
        e.tick()
        self.assertEqual(e.x()["orderState"], "CANCELLED")
        e.tick(2)
        self.assertEqual(len(e.mt5.sends("REMOVE")), 1)

    def test_pending_price_on_wrong_side_declines(self):
        a = self._limit()
        a["entryPolicy"]["price"] = 1.1010
        e = Env(auths=[a])
        e.tick()
        self.assertEqual(e.x()["blockerCode"], "PENDING_PRICE_INVALID")

    def test_build_entry(self):
        a = stage8([tr.acct()])[0]
        cfg = ex.merge_config({})[0]
        req = ex.build_entry(a, {"order": {"entry": 1.100064}}, tr.spec("EURUSD", fillingMode=2), cfg)
        self.assertEqual((req["action"], req["type"], req["price"], req["filling"], req["comment"]), ("DEAL", "BUY", 1.10006, "IOC", a["executionId"]))
        self.assertLessEqual(len(req["comment"]), 31)


# ---------------------------------------------------------------- management + manual intervention

class Management(unittest.TestCase):
    def _open(self, **kw):
        e = Env(**kw)
        e.tick()
        return e

    def test_widened_or_removed_stop_is_restored(self):
        e = self._open()
        prot = e.x()["protectiveSl"]
        e.pos()["sl"] = prot - 0.0020
        e.tick()
        self.assertAlmostEqual(e.pos()["sl"], prot)
        self.assertEqual(e.mt5.sends("SLTP")[-1]["sl"], prot)
        e.pos()["sl"] = None
        e.tick()
        self.assertAlmostEqual(e.pos()["sl"], prot)
        self.assertIn("RESTORE_PROTECTION", e.store.states(e.eid))

    def test_externally_tightened_stop_is_adopted_never_loosened(self):
        e = self._open()
        tighter = round(e.x()["protectiveSl"] + 0.0005, 5)
        e.pos()["sl"] = tighter
        e.tick()
        self.assertAlmostEqual(e.x()["protectiveSl"], tighter)
        self.assertEqual(e.mt5.sends("SLTP"), [])
        self.assertTrue(any(r["status"] == "SL_TP_MISMATCH" for r in e.store.recon))

    def test_management_never_widens(self):
        x = {"direction": "BUY", "fillPrice": 1.1, "initialRiskDistance": 0.002, "protectiveSl": 1.1015, "targetTp": 1.11, "mgmt": {"protected": True, "beDone": True}}
        pos = {"ticket": 1, "volume": 0.2, "sl": 1.1015, "tp": 1.11, "priceOpen": 1.1}
        cfg = ex.merge_config({})[0]
        market = {"bid": 1.1045, "ask": 1.10456, "spec": tr.spec("EURUSD")}   # +2.25R: trail target 1.1025 is tighter -> allowed
        plan = ex.management_plan(x, pos, market, cfg, {"now": NOW, "exits": []})
        sl = [a for a in plan if a["type"] == "SLTP"]
        self.assertTrue(sl and sl[0]["sl"] > 1.1015)
        pos["sl"] = x["protectiveSl"] = 1.1040
        plan = ex.management_plan(x, pos, market, cfg, {"now": NOW, "exits": []})
        self.assertFalse([a for a in plan if a["type"] == "SLTP"])

    def test_manual_partial_close_is_adopted(self):
        e = self._open()
        vol = e.pos()["volume"]
        e.mt5.broker_close(e.pos()["ticket"], volume=0.05, reason="CLIENT")
        e.tick()
        self.assertAlmostEqual(e.x()["openVolume"], round(vol - 0.05, 8))
        f = [r for r in e.store.recon if r["status"] == "VOLUME_MISMATCH"]
        self.assertEqual((len(f), f[0]["resolution"]), (1, "AUTO_ADOPTED"))

    def test_manual_full_close(self):
        e = self._open()
        e.mt5.broker_close(e.pos()["ticket"], reason="CLIENT")
        e.tick()
        self.assertEqual((e.x()["positionState"], e.x()["exitReason"]), ("CLOSED", "MANUAL_BROKER_CLOSE"))
        self.assertIn(e.eid, e.store.published)

    def test_take_profit_hit(self):
        e = self._open()
        e.mt5.broker_close(e.pos()["ticket"], price=e.pos()["tp"], reason="TP")
        e.tick()
        self.assertEqual(e.x()["exitReason"], "TAKE_PROFIT")
        self.assertGreater(e.store.published[e.eid]["rMultiple"], 0)

    def test_stop_loss_hit_is_minus_one_r(self):
        e = self._open()
        e.mt5.broker_close(e.pos()["ticket"], price=e.pos()["sl"], reason="SL")
        e.tick()
        rec = e.store.published[e.eid]
        self.assertEqual(rec["exitReason"], "STOP_LOSS")
        self.assertAlmostEqual(rec["rMultiple"], -1.0, delta=0.15)

    def test_broker_tp_change_adopted(self):
        e = self._open()
        e.pos()["tp"] = 1.1200
        e.tick()
        self.assertEqual(e.x()["targetTp"], 1.12)

    def test_unprotected_position_is_closed_after_retries(self):
        e = Env()
        e.mt5.script = ["fill_nosl", "reject", "reject", "reject"]
        e.tick()
        self.assertEqual(e.pos()["sl"], None)
        e.tick(3, dt=11)
        self.assertEqual(e.x()["mgmt"]["forcedExit"]["code"], "UNPROTECTED_EXIT")
        e.tick(2)
        self.assertEqual((e.x()["positionState"], e.x()["exitReason"]), ("CLOSED", "UNPROTECTED_EXIT"))

    def test_protection_failure_retries_with_backoff(self):
        e = Env()
        e.mt5.script = ["fill_nosl", "reject"]
        e.tick(2)
        n = len(e.mt5.sends("SLTP"))
        self.assertEqual(n, 1)
        e.tick(2)
        self.assertEqual(len(e.mt5.sends("SLTP")), n)
        e.tick(dt=11)
        self.assertEqual(e.pos()["sl"], e.x()["protectiveSl"])

    def test_structural_invalidation_exit(self):
        e = self._open()
        e.store.s7["EURUSD"] = {"state": "CONFIRMED", "direction": "BEARISH"}
        e.tick(2)
        self.assertEqual(e.x()["exitReason"], "STRUCTURAL_INVALIDATION")

    def test_h1_close_beyond_invalidation_exit(self):
        e = self._open()
        e.store.h1["EURUSD"] = 1.0975
        e.tick(2)
        self.assertEqual(e.x()["exitReason"], "STRUCTURAL_INVALIDATION")

    def test_daily_loss_risk_exit(self):
        e = self._open()
        e.store.risk_accts = {"demo": {"dailyLossPct": 3.2}}
        e.tick(2)
        self.assertEqual(e.x()["exitReason"], "RISK_EXIT_DAILY_LOSS")

    def test_operator_exit_runs_on_the_engine(self):
        e = self._open()
        self.assertTrue(e.svc.request_exit(e.eid, "tester", "reduce exposure")["ok"])
        self.assertEqual(len(e.mt5.pos), 1)   # the request itself never touches MT5
        e.tick(2)
        self.assertEqual(e.x()["exitReason"], "OPERATOR_EXIT")
        self.assertFalse(e.svc.request_exit(e.eid, "tester", "again")["ok"])

    def test_rejected_exit_is_retried(self):
        e = self._open()
        e.store.s7["EURUSD"] = {"state": "CONFIRMED", "direction": "BEARISH"}
        e.mt5.script = ["reject"]
        e.tick()
        self.assertEqual(len(e.mt5.pos), 1)
        e.tick(dt=11)
        e.tick()
        self.assertEqual(e.x()["positionState"], "CLOSED")

    def test_unknown_exit_outcome_reissued_after_confirmation_window(self):
        e = self._open()
        e.store.s7["EURUSD"] = {"state": "CONFIRMED", "direction": "BEARISH"}
        e.mt5.script = ["timeout_nofill"]
        e.tick()
        self.assertEqual(e.x()["positionState"], "EXIT_PENDING")
        e.tick(2)
        self.assertEqual(len(e.mt5.sends("DEAL")), 2)   # entry + one exit: never blindly resent
        e.tick(dt=31)
        e.tick()
        self.assertEqual(e.x()["positionState"], "CLOSED")

    def test_prop_weekend_exit_rule(self):
        friday = tr.datetime(2026, 9, 25, 20, 0, tzinfo=tr.timezone.utc).timestamp()
        x = {"direction": "BUY", "instrument": "EURUSD", "mgmt": {}}
        out = ex.risk_exits(x, {"accountClass": "PROP", "propRules": {"weekendHolding": False}}, None, RISK_CFG, ex.CONFIG, None, None, friday)
        self.assertEqual(out[0]["code"], "PROP_WEEKEND_EXIT")
        self.assertEqual(ex.risk_exits(x, {"accountClass": "DEMO"}, None, RISK_CFG, ex.CONFIG, None, None, friday), [])


# ---------------------------------------------------------------- reconciliation

class Reconciliation(unittest.TestCase):
    def test_external_position_is_exposure_not_managed(self):
        e = Env()
        e.mt5.open_position("XAUUSD", "SELL", 0.01, 4300.0, None, 0, "manual")
        e.tick()
        f = [r for r in e.store.recon_open() if r["status"] == "EXTERNAL_POSITION"]
        self.assertEqual((len(f), f[0]["severity"]), (1, "INFO"))
        self.assertEqual(e.store.meta["summary"]["externalPositions"], 1)
        self.assertEqual(e.x()["orderState"], "FILLED")   # INFO findings never block
        xau = next(p for p in e.mt5.pos if p["symbol"] == "XAUUSD")
        e.mt5.broker_close(xau["ticket"])
        e.tick()
        self.assertFalse([r for r in e.store.recon_open() if r["status"] == "EXTERNAL_POSITION"])

    def test_unknown_stage9_position_blocks(self):
        e = Env()
        e.mt5.open_position("GBPUSD", "BUY", 0.1, 1.29, None, 90909, "EX-0123456789abcdef0123")
        e.tick()
        f = [r for r in e.store.recon_open() if r["status"] == "UNKNOWN_EXECUTION"]
        self.assertEqual((len(f), f[0]["severity"]), (1, "BLOCKING"))
        self.assertEqual(e.x()["blockerCode"], "RECONCILIATION_UNRESOLVED")
        self.assertEqual(e.mt5.sent, [])

    def test_missing_broker_position_without_deals(self):
        e = Env()
        e.tick()
        t = e.pos()["ticket"]
        e.mt5.pos.clear()
        e.tick()
        f = [r for r in e.store.recon_open() if r["status"] == "MISSING_BROKER"]
        self.assertEqual((len(f), f[0]["ticket"]), (1, t))
        self.assertNotEqual(e.x()["positionState"], "CLOSED")

    def test_match_broker(self):
        ledger = [{"executionId": "EX-a", "mt5Position": 1, "positionState": "OPEN"}, {"executionId": "EX-b", "positionState": "OPEN"},
                  {"executionId": "EX-c", "mt5Position": 9, "positionState": "OPEN"}]
        positions = [{"ticket": 1, "comment": "EX-a", "magic": 90909}, {"ticket": 2, "comment": "EX-b", "magic": 90909},
                     {"ticket": 3, "comment": "EX-b", "magic": 90909}, {"ticket": 4, "comment": "", "magic": 90909}, {"ticket": 5, "comment": "", "magic": 0}]
        m = ex.match_broker(ledger, positions, 90909)
        self.assertEqual([p["ticket"] for _, p in m["matched"]], [1, 2])
        self.assertEqual([p["ticket"] for _, p in m["duplicates"]], [3])
        self.assertEqual([p["ticket"] for p in m["oursUnlinked"]], [4])
        self.assertEqual([p["ticket"] for p in m["external"]], [5])
        self.assertEqual([x["executionId"] for x in m["unmatchedLedger"]], ["EX-c"])

    def test_deal_summary_and_exit_reason(self):
        deals = [{"entry": "IN", "volume": 0.2, "price": 1.1, "profit": 0, "commission": -0.6, "time": 1},
                 {"entry": "OUT", "volume": 0.1, "price": 1.103, "profit": 30, "commission": -0.3, "time": 2, "reason": "EXPERT"},
                 {"entry": "OUT", "volume": 0.1, "price": 1.102, "profit": 20, "commission": -0.3, "time": 3, "reason": "SL"}]
        s = ex.deal_summary(deals)
        self.assertTrue(s["closed"])
        self.assertAlmostEqual(s["exitPrice"], 1.1025)
        self.assertEqual((s["realized"], s["closeReason"]), (48.8, "SL"))
        self.assertEqual(ex.exit_reason({"mgmt": {"beDone": True}}, "SL"), "BREAK_EVEN_STOP")
        self.assertEqual(ex.exit_reason({"mgmt": {"exitCode": "OPERATOR_EXIT"}}, "EXPERT"), "OPERATOR_EXIT")
        self.assertEqual(ex.exit_reason({"mgmt": {}}, "SO"), "STOP_OUT")

    def test_classify_send(self):
        self.assertEqual(ex.classify_send({"retcode": 10009, "volume": 0.2}, 0.2)["outcome"], "FILLED")
        self.assertEqual(ex.classify_send({"retcode": 10009, "volume": 0.1}, 0.2)["outcome"], "PARTIAL")
        self.assertEqual(ex.classify_send({"retcode": 10008}, 0.2)["outcome"], "PLACED")
        self.assertEqual(ex.classify_send({"retcode": 10004}, 0.2)["outcome"], "NO_FILL_RETRY")
        self.assertEqual(ex.classify_send({"retcode": 10019}, 0.2)["outcome"], "REJECTED")
        for rc in (10011, 10012, 10031):
            self.assertEqual(ex.classify_send({"retcode": rc}, 0.2)["outcome"], "UNKNOWN")
        self.assertEqual(ex.classify_send(None, 0.2)["outcome"], "UNKNOWN")

    def test_config_validation(self):
        self.assertFalse(ex.merge_config({})[1])
        self.assertTrue(ex.merge_config({"breakEvenAtR": 3.0, "trailStartR": 2.0})[1])
        self.assertTrue(ex.merge_config({"trailDistanceR": 2.5})[1])
        self.assertTrue(ex.merge_config({"magic": "x"})[1])
        self.assertTrue(ex.merge_config({"nope": 1})[1])

    def test_ui_reads(self):
        e = Env()
        e.tick()
        st = e.svc.state()
        self.assertTrue(st["ok"])
        self.assertEqual(st["ledger"][0]["executionId"], e.eid)
        d = e.svc.detail(e.eid)
        self.assertEqual(d["execution"]["executionId"], e.eid)
        self.assertTrue(d["events"] and d["orders"])
        self.assertEqual(e.store.meta["summary"]["stage9Positions"], 1)


if __name__ == "__main__":
    unittest.main()
