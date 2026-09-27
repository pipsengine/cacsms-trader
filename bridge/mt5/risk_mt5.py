"""Stage 8 MT5 inputs: live quotes + broker contract specs, validated FX conversion, attached-account snapshot (with today's
deals for the daily-loss baseline) and broker per-lot margin. Every call runs under the bridge's MT5 lock and never
initializes or switches the terminal login itself."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable


class RiskMT5:
    def __init__(self, mt5: Any, lock: threading.RLock, ready: Callable[[], bool], offset: Callable[[], int | None]):
        self.mt5 = mt5
        self.lock = lock
        self.ready = ready
        self.offset = offset

    # ------------------------------------------------------------ helpers
    def _utc(self, server_ts: int) -> float | None:
        off = self.offset()
        return None if off is None else float(int(server_ts) - int(off))

    def _info(self, sym: str) -> Any:
        info = self.mt5.symbol_info(sym)
        if info is not None and not info.visible:
            self.mt5.symbol_select(sym, True)
            info = self.mt5.symbol_info(sym)
        return info

    @staticmethod
    def _spec(info: Any) -> dict[str, Any]:
        return {
            "name": info.name, "tickSize": float(info.trade_tick_size), "tickValue": float(info.trade_tick_value),
            "contractSize": float(info.trade_contract_size), "volumeMin": float(info.volume_min), "volumeMax": float(info.volume_max),
            "volumeStep": float(info.volume_step), "currencyProfit": info.currency_profit, "currencyMargin": info.currency_margin,
            "currencyBase": info.currency_base, "calcMode": int(info.trade_calc_mode), "tradeMode": int(info.trade_mode),
            "stopsLevel": int(info.trade_stops_level), "freezeLevel": int(info.trade_freeze_level), "point": float(info.point),
            "digits": int(info.digits),
        }

    # ------------------------------------------------------------ market
    def market(self, symbols: list[str]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        if not symbols:
            return out
        with self.lock:
            if not self.ready():
                return out
            for sym in sorted(set(symbols)):
                info = self._info(sym)
                if info is None:
                    continue
                row: dict[str, Any] = {"spec": self._spec(info)}
                t = self.mt5.symbol_info_tick(sym)
                if t is not None and t.bid and t.ask:
                    row.update({"bid": float(t.bid), "ask": float(t.ask), "time": self._utc(t.time)})
                out[sym] = row
        return out

    # ------------------------------------------------------------ FX
    def fx_resolver(self, max_age: float) -> Callable[[str, str], dict[str, Any]]:
        """Conversion src→dst from live terminal quotes: direct, inverse, or crossed via USD. Stale or missing quotes fail closed."""
        cache: dict[tuple[str, str], dict[str, Any]] = {}

        def quote(sym: str) -> dict[str, Any] | None:
            info = self._info(sym)
            if info is None:
                return None
            t = self.mt5.symbol_info_tick(sym)
            if t is None or not t.bid or not t.ask:
                return {"sym": sym, "ok": False, "reason": f"{sym} has no quote"}
            ts = self._utc(t.time)
            age = None if ts is None else time.time() - ts
            if age is None or age > max_age:
                return {"sym": sym, "ok": False, "reason": f"{sym} quote {'time unverifiable' if age is None else f'{int(age)} s old'} (max {int(max_age)} s)"}
            return {"sym": sym, "ok": True, "mid": (float(t.bid) + float(t.ask)) / 2, "age": age}

        def direct(src: str, dst: str) -> dict[str, Any] | None:
            q = quote(src + dst)
            if q is not None:
                return q if not q["ok"] else {"ok": True, "rate": q["mid"], "source": q["sym"], "age": int(q["age"])}
            q = quote(dst + src)
            if q is not None:
                return q if not q["ok"] else {"ok": True, "rate": 1 / q["mid"], "source": f"1/{q['sym']}", "age": int(q["age"])}
            return None

        def resolve(src: str, dst: str) -> dict[str, Any]:
            src, dst = src.upper(), dst.upper()
            if src == dst:
                return {"ok": True, "rate": 1.0, "source": "identity", "age": 0}
            if (src, dst) in cache:
                return cache[(src, dst)]
            with self.lock:
                if not self.ready():
                    res = {"ok": False, "reason": "MT5 terminal not ready"}
                else:
                    res = direct(src, dst)
                    if (res is None or not res.get("ok")) and "USD" not in (src, dst):
                        a, b = direct(src, "USD"), direct("USD", dst)
                        if a and b and a.get("ok") and b.get("ok"):
                            res = {"ok": True, "rate": a["rate"] * b["rate"], "source": f"{a['source']}×{b['source']}", "age": max(a["age"], b["age"])}
                    if res is None:
                        res = {"ok": False, "reason": f"No {src}{dst} / {dst}{src} symbol (or USD cross) at this broker"}
                    elif not res.get("ok"):
                        res = {"ok": False, "reason": res.get("reason")}
            cache[(src, dst)] = res
            return res

        return resolve

    # ------------------------------------------------------------ account
    def account(self, day_start_utc: float) -> dict[str, Any] | None:
        """Attached terminal account: balance/equity/margin, positions and today's realized P&L (broker deals since the server day start)."""
        with self.lock:
            if not self.ready():
                return None
            info = self.mt5.account_info()
            if info is None:
                return None
            positions = []
            for p in self.mt5.positions_get() or []:
                positions.append({"ticket": str(p.ticket), "symbol": p.symbol, "side": "BUY" if int(p.type) == 0 else "SELL",
                                  "volume": float(p.volume), "entry": float(p.price_open), "current": float(p.price_current),
                                  "sl": float(p.sl) if p.sl else None, "tp": float(p.tp) if p.tp else None, "pnl": float(p.profit),
                                  "magic": int(p.magic), "comment": p.comment})
            realized, deposits, deals_ok = 0.0, 0.0, True
            off = self.offset()
            if off is None:
                deals_ok = False
            else:
                start = datetime.fromtimestamp(day_start_utc + off, tz=timezone.utc)
                end = datetime.fromtimestamp(time.time() + off + 86400, tz=timezone.utc)
                deals = self.mt5.history_deals_get(start, end)
                if deals is None:
                    deals_ok = False
                else:
                    for dl in deals:
                        amt = float(dl.profit) + float(getattr(dl, "commission", 0) or 0) + float(getattr(dl, "swap", 0) or 0) + float(getattr(dl, "fee", 0) or 0)
                        if int(dl.type) in (0, 1):
                            realized += amt
                        else:
                            deposits += amt
            return {
                "login": str(info.login), "server": info.server, "company": info.company, "currency": info.currency,
                "balance": float(info.balance), "equity": float(info.equity), "margin": float(info.margin), "freeMargin": float(info.margin_free),
                "marginLevel": float(info.margin_level or 0) or None, "leverage": int(info.leverage), "profit": float(info.profit),
                "tradeAllowed": bool(info.trade_allowed), "tradeExpert": bool(info.trade_expert), "snapshotAt": time.time(),
                "positions": positions, "realizedToday": realized if deals_ok else None, "depositsToday": deposits if deals_ok else None,
            }

    def broker_margin(self, items: list[tuple[str, str, float]]) -> dict[tuple[str, str], float]:
        """Per-lot initial margin in the attached account's currency (order_calc_margin) for (symbol, side, price)."""
        out: dict[tuple[str, str], float] = {}
        with self.lock:
            if not self.ready():
                return out
            for sym, side, price in items:
                if not price:
                    continue
                typ = self.mt5.ORDER_TYPE_BUY if side == "BUY" else self.mt5.ORDER_TYPE_SELL
                m = self.mt5.order_calc_margin(typ, sym, 1.0, float(price))
                if m is not None and m > 0:
                    out[(sym, side)] = float(m)
        return out
