"""Demo-only Stage 9 smoke test: one synthetic Stage 8 authorization at the broker's minimum volume with a stop-loss and a
take-profit. It travels the real execution path — pre-execution revalidation, order_check / order_send, reconciliation,
position management, exit and the Stage 10 trade record. Stage 9 waives only the Stage 7 / Stage 8 "setup still valid" checks
for it, and only on a DEMO account. Stage 10 learning ignores it (setup keys start with PREFIX).
"""

from __future__ import annotations

import hashlib
import math
from datetime import datetime, timezone
from typing import Any, Callable

PREFIX = "SMOKE-"
DEFAULT_SYMBOL = "EURUSD"
MIN_STOP_POINTS = 200
TTL_SEC = 120


def is_smoke(auth: dict[str, Any] | None) -> bool:
    return str((auth or {}).get("setupKey") or "").startswith(PREFIX)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def build(account: dict[str, Any] | None, term: dict[str, Any] | None, market: dict[str, Any], fx: Callable[[str, str], dict[str, Any]],
          now: float, symbol: str = DEFAULT_SYMBOL, side: str = "BUY", stop_points: int | None = None) -> dict[str, Any]:
    side = str(side or "BUY").upper()
    if side not in ("BUY", "SELL"):
        return {"ok": False, "message": "side must be BUY or SELL"}
    if not account:
        return {"ok": False, "message": "The MT5 terminal is not attached to a registered account"}
    if str(account.get("accountClass") or "").upper() != "DEMO":
        return {"ok": False, "message": f"Smoke test refused: account {account.get('id')} is {account.get('accountClass')}, not DEMO"}
    if not term or str(term.get("login")) != str(account.get("login")):
        return {"ok": False, "message": f"Terminal is attached to {(term or {}).get('login') or 'no account'}, not {account.get('login')}"}
    spec = market.get("spec") or {}
    bid, ask = market.get("bid"), market.get("ask")
    if not spec.get("name") or not bid or not ask:
        return {"ok": False, "message": f"No live quote / contract spec for {symbol}"}
    point = float(spec.get("point") or 0)
    vol = float(spec.get("volumeMin") or 0)
    if point <= 0 or vol <= 0:
        return {"ok": False, "message": f"{symbol} contract spec has no point size or minimum volume"}
    d = 1 if side == "BUY" else -1
    entry = float(ask) if d > 0 else float(bid)
    spread = float(ask) - float(bid)
    dist_pts = max(int(stop_points or 0), MIN_STOP_POINTS, int(spec.get("stopsLevel") or 0) * 3, int(math.ceil(spread / point)) * 10)
    dist = dist_pts * point
    digits = int(spec.get("digits") or 5)
    sl, tp = round(entry - d * dist, digits), round(entry + d * dist, digits)
    ccy = str(term.get("currency") or account.get("currency") or "")
    conv = fx(str(spec.get("currencyProfit") or ""), ccy)
    if not conv.get("ok"):
        return {"ok": False, "message": f"No {spec.get('currencyProfit')}→{ccy} conversion: {conv.get('reason') or 'unavailable'}"}
    loss_per_lot = dist * float(spec.get("contractSize") or 0) * float(conv["rate"])
    risk_amount = math.ceil(loss_per_lot * vol * 100) / 100
    equity = float(term.get("equity") or 0)
    setup_key = f"{PREFIX}{spec['name']}-{side}-{int(now)}"
    aid = str(account["id"])
    eid = "EX-" + hashlib.sha1(f"{setup_key}|{aid}|1".encode()).hexdigest()[:20].upper()
    auth = {
        "executionId": eid, "setupKey": setup_key, "attempt": 1, "accountId": aid, "accountName": account.get("name"),
        "accountClass": "DEMO", "accountCurrency": ccy, "instrument": spec["name"], "brokerSymbol": spec["name"], "direction": side,
        "volume": vol,
        "entryPolicy": {"type": "MARKET", "referencePrice": entry, "maxDeviationPrice": round(dist * 0.25, digits),
                        "maxDeviationPoints": max(int(dist_pts * 0.25), 10), "maxSpread": round(max(spread * 3, dist * 0.2), digits),
                        "validFrom": _iso(now), "validUntil": _iso(now + TTL_SEC)},
        "stopLoss": sl, "takeProfit": tp, "takeProfit2": None,
        "riskAmount": risk_amount, "riskCurrency": ccy, "riskPct": round(100 * risk_amount / equity, 4) if equity > 0 else 0.0,
        "rewardRisk": 1.0, "marginRequired": 0.0, "expiresAt": _iso(now + TTL_SEC), "authorizedAt": _iso(now), "configHash": "SMOKE_TEST",
        "source": {"stage": 0, "handoffKind": "SMOKE_TEST", "symbol": spec["name"], "direction": "BULLISH" if d > 0 else "BEARISH",
                   "confirmedSince": _iso(now), "tradeType": None},
        "evidence": {"setupScore": 0, "setupGates": {"smokeTest": "PASS"}, "accountGates": {"demoOnly": "PASS"},
                     "sizing": {"targetRiskPct": None, "allowedRiskPct": None, "lossPerLot": round(loss_per_lot, 4), "fxRate": conv["rate"],
                                "fxSource": conv.get("source"), "volumeRaw": vol, "marginRequired": None, "marginMethod": None, "marginLevelAfter": None}},
        "status": "PENDING", "executes": False,
    }
    return {"ok": True, "authorization": auth,
            "message": f"Smoke authorization {eid}: {side} {vol} {spec['name']} @ ~{entry} · SL {sl} · TP {tp} · risk {risk_amount} {ccy} · "
                       f"valid {TTL_SEC} s"}
