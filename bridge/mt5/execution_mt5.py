"""Stage 9 MT5 adapter: terminal / account snapshot, positions, pending orders, order_check + order_send, and the order / deal
history used for reconciliation. Every call runs under the bridge's MT5 lock and never initializes or switches the terminal login.
The attached login is re-verified inside the same lock hold as order_send, so an order can never reach a different account."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

try:
    import execution as ex
except ImportError:  # pragma: no cover
    from bridge.mt5 import execution as ex  # type: ignore

ENTRY = {0: "IN", 1: "OUT", 2: "INOUT", 3: "OUT_BY"}
ORDER_STATE = {0: "STARTED", 1: "PLACED", 2: "CANCELED", 3: "PARTIAL", 4: "FILLED", 5: "REJECTED", 6: "EXPIRED", 7: "REQUEST_ADD",
               8: "REQUEST_MODIFY", 9: "REQUEST_CANCEL"}
ORDER_TYPE = {0: "BUY", 1: "SELL", 2: "BUY_LIMIT", 3: "SELL_LIMIT", 4: "BUY_STOP", 5: "SELL_STOP", 6: "BUY_STOP_LIMIT", 7: "SELL_STOP_LIMIT", 8: "CLOSE_BY"}


class ExecutionMT5:
    def __init__(self, mt5: Any, lock: threading.RLock, ready: Callable[[], bool], offset: Callable[[], int | None],
                 fx_factory: Callable[[float], Callable[[str, str], dict[str, Any]]] | None = None):
        self.mt5 = mt5
        self.lock = lock
        self.ready = ready
        self.offset = offset
        self.fx_factory = fx_factory

    # ------------------------------------------------------------ time
    def _utc(self, server_ts: Any) -> float | None:
        if not server_ts:
            return None
        off = self.offset()
        return float(int(server_ts) - int(off or 0))

    def _server(self, utc: float) -> datetime:
        return datetime.fromtimestamp(utc + int(self.offset() or 0), tz=timezone.utc)

    # ------------------------------------------------------------ snapshots
    def terminal(self) -> dict[str, Any] | None:
        with self.lock:
            if not self.ready():
                return None
            term = self.mt5.terminal_info()
            info = self.mt5.account_info()
            if term is None or info is None:
                return None
            return {
                "connected": bool(term.connected), "algoTrading": bool(term.trade_allowed), "login": str(info.login), "server": info.server,
                "company": info.company, "currency": info.currency, "balance": float(info.balance), "equity": float(info.equity),
                "margin": float(info.margin), "freeMargin": float(info.margin_free), "marginLevel": float(info.margin_level or 0) or None,
                "leverage": int(info.leverage), "profit": float(info.profit), "tradeAllowed": bool(info.trade_allowed),
                "tradeExpert": bool(info.trade_expert) and bool(term.trade_allowed), "marginMode": int(getattr(info, "margin_mode", 2)),
                "pingMs": int(round((term.ping_last or 0) / 1000)), "snapshotAt": time.time(),
            }

    def _pos(self, p: Any) -> dict[str, Any]:
        return {"ticket": int(p.ticket), "identifier": int(getattr(p, "identifier", p.ticket)), "symbol": p.symbol, "side": "BUY" if int(p.type) == 0 else "SELL",
                "volume": float(p.volume), "priceOpen": float(p.price_open), "priceCurrent": float(p.price_current),
                "sl": float(p.sl) if p.sl else None, "tp": float(p.tp) if p.tp else None, "profit": float(p.profit), "swap": float(p.swap),
                "magic": int(p.magic), "comment": p.comment or "", "time": self._utc(p.time)}

    def _order(self, o: Any) -> dict[str, Any]:
        return {"ticket": int(o.ticket), "symbol": o.symbol, "type": ORDER_TYPE.get(int(o.type), str(o.type)), "state": ORDER_STATE.get(int(o.state), str(o.state)),
                "volumeInitial": float(o.volume_initial), "volumeCurrent": float(o.volume_current), "priceOpen": float(o.price_open),
                "sl": float(o.sl) if o.sl else None, "tp": float(o.tp) if o.tp else None, "magic": int(o.magic), "comment": o.comment or "",
                "timeSetup": self._utc(o.time_setup), "timeDone": self._utc(getattr(o, "time_done", 0)), "positionId": int(getattr(o, "position_id", 0) or 0)}

    def _deal(self, dl: Any) -> dict[str, Any]:
        return {"ticket": int(dl.ticket), "order": int(dl.order), "position": int(dl.position_id), "symbol": dl.symbol,
                "side": "BUY" if int(dl.type) == 0 else "SELL" if int(dl.type) == 1 else f"TYPE_{int(dl.type)}", "type": int(dl.type),
                "entry": ENTRY.get(int(dl.entry), str(dl.entry)), "volume": float(dl.volume), "price": float(dl.price),
                "commission": float(getattr(dl, "commission", 0) or 0), "swap": float(getattr(dl, "swap", 0) or 0), "fee": float(getattr(dl, "fee", 0) or 0),
                "profit": float(dl.profit), "magic": int(dl.magic), "comment": dl.comment or "", "reason": ex.DEAL_REASONS.get(int(dl.reason), str(dl.reason)),
                "time": self._utc(dl.time)}

    def positions(self) -> list[dict[str, Any]] | None:
        with self.lock:
            if not self.ready():
                return None
            rows = self.mt5.positions_get()
            return None if rows is None else [self._pos(p) for p in rows]

    def orders(self) -> list[dict[str, Any]] | None:
        with self.lock:
            if not self.ready():
                return None
            rows = self.mt5.orders_get()
            return None if rows is None else [self._order(o) for o in rows]

    def market(self, symbol: str) -> dict[str, Any]:
        with self.lock:
            if not self.ready():
                return {}
            info = self.mt5.symbol_info(symbol)
            if info is not None and not info.visible:
                self.mt5.symbol_select(symbol, True)
                info = self.mt5.symbol_info(symbol)
            if info is None:
                return {}
            spec = {"name": info.name, "tickSize": float(info.trade_tick_size), "tickValue": float(info.trade_tick_value), "point": float(info.point),
                    "digits": int(info.digits), "contractSize": float(info.trade_contract_size), "volumeMin": float(info.volume_min),
                    "volumeMax": float(info.volume_max), "volumeStep": float(info.volume_step), "currencyProfit": info.currency_profit,
                    "currencyMargin": info.currency_margin, "tradeMode": int(info.trade_mode), "stopsLevel": int(info.trade_stops_level),
                    "freezeLevel": int(info.trade_freeze_level), "fillingMode": int(info.filling_mode), "execMode": int(info.trade_exemode)}
            out: dict[str, Any] = {"spec": spec}
            t = self.mt5.symbol_info_tick(symbol)
            if t is not None and t.bid and t.ask:
                out.update({"bid": float(t.bid), "ask": float(t.ask), "time": self._utc(t.time)})
            return out

    def fx(self, max_age: float) -> Callable[[str, str], dict[str, Any]]:
        if self.fx_factory is None:
            return lambda s, d: {"ok": s == d, "rate": 1.0, "source": "identity", "reason": None if s == d else "No FX provider"}
        return self.fx_factory(max_age)

    def margin_per_lot(self, symbol: str, side: str, price: float) -> float | None:
        with self.lock:
            if not self.ready() or not price:
                return None
            typ = self.mt5.ORDER_TYPE_BUY if side == "BUY" else self.mt5.ORDER_TYPE_SELL
            m = self.mt5.order_calc_margin(typ, symbol, 1.0, float(price))
            return float(m) if m is not None and m > 0 else None

    # ------------------------------------------------------------ requests
    def _request(self, req: dict[str, Any]) -> dict[str, Any]:
        m = self.mt5
        action = {"DEAL": m.TRADE_ACTION_DEAL, "PENDING": m.TRADE_ACTION_PENDING, "SLTP": m.TRADE_ACTION_SLTP,
                  "REMOVE": m.TRADE_ACTION_REMOVE, "MODIFY": m.TRADE_ACTION_MODIFY}[req["action"]]
        r: dict[str, Any] = {"action": action, "symbol": req["symbol"], "magic": int(req.get("magic") or 0), "comment": str(req.get("comment") or "")[:31]}
        if req["action"] in ("DEAL", "PENDING"):
            r.update({"type": {"BUY": m.ORDER_TYPE_BUY, "SELL": m.ORDER_TYPE_SELL, "BUY_LIMIT": m.ORDER_TYPE_BUY_LIMIT,
                               "SELL_LIMIT": m.ORDER_TYPE_SELL_LIMIT, "BUY_STOP": m.ORDER_TYPE_BUY_STOP, "SELL_STOP": m.ORDER_TYPE_SELL_STOP}[req["type"]],
                      "volume": float(req["volume"]), "price": float(req["price"]), "deviation": int(req.get("deviation") or 0),
                      "type_filling": {"FOK": m.ORDER_FILLING_FOK, "IOC": m.ORDER_FILLING_IOC, "RETURN": m.ORDER_FILLING_RETURN}[req.get("filling") or "RETURN"],
                      "type_time": m.ORDER_TIME_SPECIFIED if req.get("typeTime") == "SPECIFIED" else m.ORDER_TIME_GTC})
            if req.get("sl") is not None:
                r["sl"] = float(req["sl"])
            if req.get("tp") is not None:
                r["tp"] = float(req["tp"])
            if req.get("position"):
                r["position"] = int(req["position"])
            if req.get("typeTime") == "SPECIFIED" and req.get("expiration"):
                r["expiration"] = int(self._server(float(req["expiration"])).timestamp())
        elif req["action"] == "SLTP":
            r.update({"position": int(req["position"]), "sl": float(req["sl"] or 0.0), "tp": float(req["tp"] or 0.0)})
        elif req["action"] == "REMOVE":
            r = {"action": action, "order": int(req["order"])}
        return r

    def send(self, req: dict[str, Any], login: str, server: str | None) -> dict[str, Any]:
        """order_check then order_send for `req` on account `login`. `sent` is False only when the request provably never reached
        the broker (login mismatch, terminal not ready, order_check refusal)."""
        with self.lock:
            if not self.ready():
                return {"sent": False, "notSentReason": "MT5 terminal not ready"}
            info = self.mt5.account_info()
            term = self.mt5.terminal_info()
            if info is None or term is None or not term.connected:
                return {"sent": False, "notSentReason": "MT5 terminal not connected to the broker"}
            if str(info.login) != str(login) or (server and str(info.server).lower() != str(server).lower()):
                return {"sent": False, "notSentReason": f"Terminal attached to {info.login}@{info.server}, not {login}@{server} — not submitted"}
            r = self._request(req)
            check = None
            if req["action"] in ("DEAL", "PENDING"):
                chk = self.mt5.order_check(r)
                check = None if chk is None else {"retcode": int(chk.retcode), "comment": chk.comment, "margin": float(chk.margin),
                                                  "marginFree": float(chk.margin_free), "marginLevel": float(chk.margin_level)}
                if chk is None or int(chk.retcode) != 0:
                    reason = f"order_check refused: {(check or {}).get('comment') or self.mt5.last_error()} ({(check or {}).get('retcode')})"
                    return {"sent": False, "notSentReason": reason, "check": check}
            sent_at = time.time()
            t0 = time.perf_counter()
            try:
                res = self.mt5.order_send(r)
            except Exception as exc:  # pragma: no cover
                return {"sent": True, "result": None, "error": f"{type(exc).__name__}: {exc}", "check": check, "sentAt": sent_at,
                        "latencyMs": int((time.perf_counter() - t0) * 1000)}
            latency = int((time.perf_counter() - t0) * 1000)
            if res is None:
                return {"sent": True, "result": None, "error": f"order_send returned no result: {self.mt5.last_error()}", "check": check,
                        "sentAt": sent_at, "latencyMs": latency}
            out = {"retcode": int(res.retcode), "comment": res.comment, "order": int(res.order or 0), "deal": int(res.deal or 0),
                   "volume": float(res.volume or 0), "price": float(res.price or 0), "bid": float(res.bid or 0), "ask": float(res.ask or 0),
                   "requestId": int(getattr(res, "request_id", 0) or 0), "retcodeExternal": int(getattr(res, "retcode_external", 0) or 0)}
            if out["deal"]:
                deals = self.mt5.history_deals_get(ticket=out["deal"])
                if deals:
                    d0 = self._deal(deals[0])
                    out.update({"positionId": d0["position"], "dealPrice": d0["price"], "dealTime": d0["time"], "dealVolume": d0["volume"]})
            return {"sent": True, "result": out, "check": check, "sentAt": sent_at, "latencyMs": latency, "request": {k: v for k, v in r.items()}}

    # ------------------------------------------------------------ reconciliation lookups
    def position_deals(self, position_id: int) -> list[dict[str, Any]] | None:
        with self.lock:
            if not self.ready():
                return None
            rows = self.mt5.history_deals_get(position=int(position_id))
            return None if rows is None else [self._deal(d) for d in rows]

    def history_order(self, ticket: int) -> dict[str, Any] | None:
        with self.lock:
            if not self.ready():
                return None
            rows = self.mt5.history_orders_get(ticket=int(ticket))
            return self._order(rows[0]) if rows else None

    def find_execution(self, execution_id: str, symbol: str, magic: int, since_utc: float) -> dict[str, Any] | None:
        """Everything the broker knows about one execution ID: open positions and pending orders carrying it, plus historical
        orders / deals (comment or magic + symbol) since the submission. None when MT5 cannot be queried."""
        with self.lock:
            if not self.ready():
                return None
            pos = self.mt5.positions_get(symbol=symbol)
            ords = self.mt5.orders_get(symbol=symbol)
            start, end = self._server(since_utc - 3600), self._server(time.time() + 3 * 86400)
            hord = self.mt5.history_orders_get(start, end, group=f"*{symbol}*")
            hdeal = self.mt5.history_deals_get(start, end, group=f"*{symbol}*")
            if pos is None or ords is None:
                return None
            mine = lambda o: (o.comment or "") == execution_id  # noqa: E731
            h_orders = [self._order(o) for o in (hord or []) if mine(o)]
            tickets = {o["ticket"] for o in h_orders}
            return {"positions": [self._pos(p) for p in pos if mine(p)], "orders": [self._order(o) for o in ords if mine(o)],
                    "historyOrders": h_orders, "deals": [self._deal(d) for d in (hdeal or []) if mine(d) or int(d.order) in tickets],
                    "magicCandidates": [self._pos(p) for p in pos if int(p.magic) == int(magic) and not mine(p)]}
