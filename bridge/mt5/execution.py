"""Stage 9 Execution & Positions — pure decision logic (no MT5, no SQL).

Input: immutable, unexpired Stage 8 execution authorizations only. Stage 9 never creates an opportunity, a direction or a risk
decision of its own; it re-verifies that the authorized terms are still executable right now and fails closed on any
material change.

  Stage 8 AUTHORIZED -> pre-execution revalidation -> account / terminal routing -> order construction -> submit ->
  broker acknowledgement -> reconciliation against MT5 order / deal / position IDs -> autonomous position management ->
  exit -> reconciliation -> Stage 10 trade record.

Everything here is deterministic and unit-tested; `execution_service` wires it to MT5 and SQL Server.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

ORDER_STATES = ("AUTHORIZED", "QUEUED", "REVALIDATING", "SUBMITTING", "ACKNOWLEDGED", "PARTIALLY_FILLED", "FILLED", "REJECTED",
                "CANCELLED", "EXPIRED", "UNKNOWN", "RECONCILING")
POSITION_STATES = ("OPEN", "PROTECTED", "MANAGING", "PARTIAL_EXIT", "BREAKEVEN", "TRAILING", "EXIT_PENDING", "CLOSED", "ERROR")
# Order states that still need Stage 9 action before a position (or a final answer) exists.
PRE_SUBMIT = ("AUTHORIZED", "QUEUED", "REVALIDATING")
IN_FLIGHT = ("SUBMITTING", "ACKNOWLEDGED", "UNKNOWN", "RECONCILING")
FINAL_ORDER = ("FILLED", "PARTIALLY_FILLED", "REJECTED", "CANCELLED", "EXPIRED")
OPEN_POSITION = ("OPEN", "PROTECTED", "MANAGING", "PARTIAL_EXIT", "BREAKEVEN", "TRAILING", "EXIT_PENDING", "ERROR")

CONTROL_FLAGS = ("EMERGENCY_STOP", "MT5_DISCONNECTED", "RECONCILING", "EXECUTION_DISABLED", "TRADING_PAUSED")

CONFIG: dict[str, Any] = {
    # pre-execution revalidation
    "maxTickAgeSec": 30,             # quote used for submission must be at most this old
    "accountMaxAgeSec": 30,          # attached-account snapshot freshness
    "riskTolerancePct": 10.0,        # risk recomputed at the current price may exceed the authorized amount by at most this
    "marginBufferPct": 20.0,         # required margin must fit inside free margin minus this buffer
    "maxRequotes": 2,                # definitive no-fill retcodes (requote / price changed / off quotes) retried within the entry policy
    "unknownResolveSec": 90,         # an unknown submission outcome still unresolved after this is escalated for intervention
    "magic": 90909,                  # MT5 magic number carried by every Stage 9 order (the comment carries the execution ID)
    "demoTestMode": False,           # Demo only: allow new entries while non-blocking reconciliation findings are open. Never Live / Prop.
    # autonomous position management (R = initial stop distance)
    "breakEvenAtR": 1.0,
    "breakEvenOffsetR": 0.05,        # stop moved to entry + this fraction of R (covers costs)
    "partialAtR": 1.5,
    "partialFraction": 0.5,          # 0 disables partial exits
    "trailStartR": 2.0,
    "trailDistanceR": 1.0,
    "trailStepR": 0.25,              # minimum improvement before a trailing modification is sent
    "structuralExit": True,          # exit when Stage 7 confirms the opposite direction or an H1 close breaks the invalidation
    "riskExitDailyLoss": True,       # exit Stage 9 positions of an account whose daily loss reached the Stage 8 limit
    "maxHoldHours": 0,               # 0 = no time exit
    "protectRetries": 3,             # failed attempts to attach the protective stop before the unprotected position is closed
}

BOUNDS: dict[str, tuple[float, float]] = {
    "maxTickAgeSec": (2, 600), "accountMaxAgeSec": (5, 600), "riskTolerancePct": (0.0, 50.0), "marginBufferPct": (0.0, 90.0),
    "maxRequotes": (0, 5), "unknownResolveSec": (15, 3600), "magic": (1, 2_000_000_000), "breakEvenAtR": (0.2, 10.0),
    "breakEvenOffsetR": (0.0, 1.0), "partialAtR": (0.2, 10.0), "partialFraction": (0.0, 0.9), "trailStartR": (0.2, 20.0),
    "trailDistanceR": (0.1, 10.0), "trailStepR": (0.05, 5.0), "maxHoldHours": (0, 24 * 30), "protectRetries": (1, 10),
}
INT_KEYS = {"maxTickAgeSec", "accountMaxAgeSec", "maxRequotes", "unknownResolveSec", "magic", "maxHoldHours", "protectRetries"}
BOOL_KEYS = {"demoTestMode", "structuralExit", "riskExitDailyLoss"}

# MT5 TRADE_RETCODE_*
RETCODES: dict[int, str] = {
    10004: "REQUOTE", 10006: "REJECT", 10007: "CANCEL", 10008: "PLACED", 10009: "DONE", 10010: "DONE_PARTIAL", 10011: "ERROR",
    10012: "TIMEOUT", 10013: "INVALID", 10014: "INVALID_VOLUME", 10015: "INVALID_PRICE", 10016: "INVALID_STOPS",
    10017: "TRADE_DISABLED", 10018: "MARKET_CLOSED", 10019: "NO_MONEY", 10020: "PRICE_CHANGED", 10021: "PRICE_OFF",
    10022: "INVALID_EXPIRATION", 10023: "ORDER_CHANGED", 10024: "TOO_MANY_REQUESTS", 10025: "NO_CHANGES",
    10026: "SERVER_DISABLES_AT", 10027: "CLIENT_DISABLES_AT", 10028: "LOCKED", 10029: "FROZEN", 10030: "INVALID_FILL",
    10031: "CONNECTION", 10032: "ONLY_REAL", 10033: "LIMIT_ORDERS", 10034: "LIMIT_VOLUME", 10035: "INVALID_ORDER",
    10036: "POSITION_CLOSED", 10038: "INVALID_CLOSE_VOLUME", 10039: "CLOSE_ORDER_EXIST", 10040: "LIMIT_POSITIONS",
    10041: "REJECT_CANCEL", 10042: "LONG_ONLY", 10043: "SHORT_ONLY", 10044: "CLOSE_ONLY", 10045: "FIFO_CLOSE",
}
NO_FILL_RETRY = {10004, 10020, 10021, 10024}   # request definitively not executed; may be resent inside the entry policy
AMBIGUOUS = {10011, 10012, 10031}              # outcome unknown: reconcile, never resend
# MT5 DEAL_REASON_*
DEAL_REASONS = {0: "CLIENT", 1: "MOBILE", 2: "WEB", 3: "EXPERT", 4: "SL", 5: "TP", 6: "SO", 7: "ROLLOVER", 8: "VMARGIN", 9: "SPLIT"}
TRADE_MODES = {0: "DISABLED", 1: "LONG_ONLY", 2: "SHORT_ONLY", 3: "CLOSE_ONLY", 4: "FULL"}


# ---------------------------------------------------------------- configuration

def merge_config(overrides: dict[str, Any] | None) -> tuple[dict[str, Any], list[str]]:
    cfg = json.loads(json.dumps(CONFIG))
    errors: list[str] = []
    for k, v in (overrides or {}).items():
        if k not in CONFIG:
            errors.append(f"Unknown setting {k}")
            continue
        if k in BOOL_KEYS:
            if not isinstance(v, bool):
                errors.append(f"{k} must be true or false")
                continue
            cfg[k] = v
            continue
        try:
            x = float(v)
        except (TypeError, ValueError):
            errors.append(f"{k} must be numeric")
            continue
        lo, hi = BOUNDS[k]
        if math.isnan(x) or not (lo <= x <= hi):
            errors.append(f"{k}={v} outside {lo:g}–{hi:g}")
            continue
        cfg[k] = int(round(x)) if k in INT_KEYS else x
    if cfg["breakEvenAtR"] > cfg["trailStartR"]:
        errors.append("breakEvenAtR cannot exceed trailStartR")
    if cfg["trailDistanceR"] >= cfg["trailStartR"] + cfg["breakEvenOffsetR"] and cfg["trailStartR"] > 0:
        # trailing must never place the stop below break-even at the moment it starts
        errors.append("trailDistanceR must be smaller than trailStartR (the first trailing stop has to lock in profit)")
    return cfg, errors


# ---------------------------------------------------------------- helpers

def parse_ts(v: Any) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).timestamp()
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).timestamp()


def iso(ts: float | None) -> str | None:
    return None if ts is None else datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def dsign(direction: Any) -> int:
    s = str(direction or "").upper()
    return 1 if s in ("BUY", "LONG") or s.startswith("BULL") else -1 if s in ("SELL", "SHORT") or s.startswith("BEAR") else 0


def round_tick(p: float, tick: float, mode: str = "near") -> float:
    if not tick or tick <= 0:
        return p
    q = p / tick
    q = math.floor(q + 1e-9) if mode == "down" else math.ceil(q - 1e-9) if mode == "up" else round(q)
    return round(q * tick, 10)


def floor_step(x: float, step: float) -> float:
    if step <= 0:
        return 0.0
    return round(math.floor(x / step + 1e-9) * step, 8)


def on_step(x: float, step: float) -> bool:
    return step > 0 and abs(x / step - round(x / step)) < 1e-6


def tighter(d: int, new: float | None, old: float | None) -> bool:
    """True when stop `new` is closer to (or on the profitable side of) price than `old` for direction d."""
    if new is None:
        return False
    if old is None:
        return True
    return (new - old) * d > 0


def _chk(key: str, label: str, status: str, detail: str) -> dict[str, Any]:
    return {"key": key, "label": label, "status": status, "detail": detail}


# ---------------------------------------------------------------- control state

def control_state(ctrl: dict[str, Any], auto: bool, connected: bool, reconciled: bool) -> dict[str, Any]:
    """Separate, simultaneous control states. New entries need all clear; management needs only the MT5 connection."""
    flags: list[dict[str, str]] = []
    if ctrl.get("emergencyStop"):
        flags.append({"state": "EMERGENCY_STOP", "reason": f"Emergency stop engaged{(' — ' + ctrl['emergencyReason']) if ctrl.get('emergencyReason') else ''}"})
    if not connected:
        flags.append({"state": "MT5_DISCONNECTED", "reason": "MT5 terminal not connected — last confirmed positions are shown as STALE"})
    elif not reconciled:
        flags.append({"state": "RECONCILING", "reason": "Full reconciliation with MT5 required before any new execution"})
    if not ctrl.get("executionEnabled"):
        flags.append({"state": "EXECUTION_DISABLED", "reason": "Stage 9 order execution disabled by the operator"})
    if not auto:
        flags.append({"state": "TRADING_PAUSED", "reason": "Global trading PAUSED — new entries blocked, open positions still managed"})
    state = flags[0]["state"] if flags else "RUNNING"
    return {"state": state, "flags": flags, "newEntries": not flags, "management": connected,
            "reason": flags[0]["reason"] if flags else "Stage 9 accepting Stage 8 authorizations"}


# ---------------------------------------------------------------- 1. pre-execution revalidation

def revalidate(auth: dict[str, Any], ctx: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    """Re-verify an authorization against the live state before submission.

    ctx: now, control, authStatus, consumed (bool: this node already consumed it, e.g. a requote retry), account (stored row +
    live snapshot: attached, login, server, tradeAllowed, tradeExpert, balance, equity, freeMargin, margin, currency, snapshotAt),
    market {spec, bid, ask, time}, fx(src, dst) -> {ok, rate, reason}, marginPerLot, exposure {symbols, positions, maxPositions,
    allowSameSymbol}, duplicate (another active execution for the same setup/account), traded (setup already executed here),
    upstream {opportunityActive, setupState, stage7State, stage7Direction}, blockingRecon (open blocking findings on the account),
    openRecon (all open findings on the account).

    Returns ok, terminal (no point retrying: decline), code, reason, checks and the prepared order numbers.
    """
    now = ctx["now"]
    checks: list[dict[str, Any]] = []
    fails: list[tuple[bool, str, str]] = []   # (terminal, code, reason)

    def fail(terminal: bool, code: str, reason: str) -> None:
        fails.append((terminal, code, reason))

    d = dsign(auth.get("direction"))
    pol = auth.get("entryPolicy") or {}
    acct = ctx.get("account") or {}
    m = ctx.get("market") or {}
    spec = m.get("spec") or {}
    klass = str(auth.get("accountClass") or acct.get("accountClass") or "").upper()

    # authorization lifecycle
    st = str(ctx.get("authStatus") or "").upper()
    valid_until = parse_ts(pol.get("validUntil") or auth.get("expiresAt"))
    if not ctx.get("consumed") and st != "PENDING":
        code = {"EXPIRED": "AUTH_EXPIRED", "REVOKED": "AUTH_REVOKED", "CONSUMED": "AUTH_CONSUMED"}.get(st, "AUTH_NOT_PENDING")
        checks.append(_chk("authorization", "Stage 8 authorization", "FAIL", f"Authorization is {st or 'missing'}"))
        fail(True, code, f"Stage 8 authorization is {st or 'missing'} — Stage 9 may act only on a PENDING authorization")
    elif valid_until is None or now >= valid_until:
        checks.append(_chk("authorization", "Stage 8 authorization", "FAIL", "Expired" if valid_until else "No validity window"))
        fail(True, "AUTH_EXPIRED", "Authorization validity window has ended")
    else:
        checks.append(_chk("authorization", "Stage 8 authorization", "PASS", f"{st or 'CONSUMED'} · valid {int(valid_until - now)} s more"))

    # Stage 7 / Stage 8 invalidation
    up = ctx.get("upstream") or {}
    if not up.get("opportunityActive") or str(up.get("setupState") or "") != "QUALIFIED":
        checks.append(_chk("stage8", "Stage 8 setup", "FAIL", f"Setup {up.get('setupState') or 'withdrawn'}"))
        fail(True, "SETUP_INVALIDATED", f"Stage 8 no longer qualifies the setup ({up.get('setupState') or 'withdrawn'})")
    else:
        checks.append(_chk("stage8", "Stage 8 setup", "PASS", "Setup still QUALIFIED"))
    if str(up.get("stage7State") or "") != "CONFIRMED" or dsign(up.get("stage7Direction")) != d:
        checks.append(_chk("stage7", "Stage 7 confirmation", "FAIL", f"Stage 7 now {up.get('stage7State') or 'unknown'} {up.get('stage7Direction') or ''}".strip()))
        fail(True, "STAGE7_INVALIDATED", f"Stage 7 no longer confirms {auth.get('instrument')} {auth.get('direction')} "
                                         f"(now {up.get('stage7State') or 'unknown'})")
    else:
        checks.append(_chk("stage7", "Stage 7 confirmation", "PASS", f"CONFIRMED {up.get('stage7Direction')}"))
    if ctx.get("traded"):
        checks.append(_chk("duplicate", "Idempotency", "FAIL", "Setup already executed on this account"))
        fail(True, "SETUP_ALREADY_EXECUTED", "This setup was already executed on this account — one execution per setup")
    elif ctx.get("duplicate"):
        checks.append(_chk("duplicate", "Idempotency", "FAIL", "Another execution for this setup is active"))
        fail(True, "DUPLICATE_EXECUTION", "Another Stage 9 execution for this setup/account is still active")
    else:
        checks.append(_chk("duplicate", "Idempotency", "PASS", f"Execution {auth.get('executionId')} unique"))

    # engine control
    control = ctx.get("control") or {}
    if not control.get("newEntries"):
        checks.append(_chk("control", "Engine state", "WAIT", control.get("reason") or "New entries blocked"))
        fail(False, str(control.get("state") or "BLOCKED"), control.get("reason") or "New entries blocked")
    else:
        checks.append(_chk("control", "Engine state", "PASS", "RUNNING"))

    # account routing
    if not acct.get("id"):
        checks.append(_chk("account", "Account routing", "FAIL", "Account not registered"))
        fail(True, "ACCOUNT_NOT_FOUND", f"Account {auth.get('accountId')} is not registered")
    else:
        cls = str(acct.get("accountClass") or "").upper()
        mode = str(acct.get("tradingMode") or "").upper()
        if klass and cls != klass:
            checks.append(_chk("account", "Account routing", "FAIL", f"Class changed {klass} → {cls}"))
            fail(True, "ACCOUNT_CHANGED", f"Account class changed from {klass} to {cls} after authorization")
        elif not acct.get("tradingEnabled") or mode == "ANALYSIS_ONLY":
            checks.append(_chk("account", "Account routing", "FAIL", f"Trading {'disabled' if not acct.get('tradingEnabled') else 'ANALYSIS_ONLY'}"))
            fail(True, "ACCOUNT_DISABLED", f"Account trading is {'disabled' if not acct.get('tradingEnabled') else 'ANALYSIS_ONLY'}")
        elif not acct.get("attached"):
            checks.append(_chk("account", "Account routing", "WAIT", f"Terminal attached to {acct.get('terminalLogin') or 'no account'}"))
            fail(False, "ACCOUNT_NOT_ATTACHED", f"MT5 terminal on this node is attached to {acct.get('terminalLogin') or 'no account'}, "
                                                f"not {acct.get('login')}@{acct.get('server')}")
        elif acct.get("tradeAllowed") is False:
            checks.append(_chk("account", "Account routing", "WAIT", "Broker disallows trading"))
            fail(False, "BROKER_TRADING_DISABLED", "Broker reports trading not allowed on this account")
        elif acct.get("tradeExpert") is False:
            checks.append(_chk("account", "Account routing", "WAIT", "Algo Trading off in the terminal"))
            fail(False, "ALGO_TRADING_DISABLED", "MT5 'Algo Trading' is disabled in the terminal — automated orders are refused")
        else:
            checks.append(_chk("account", "Account routing", "PASS", f"{cls} {acct.get('login')}@{acct.get('server')} on node {acct.get('node') or '—'}"))
        age = None if parse_ts(acct.get("snapshotAt")) is None else now - parse_ts(acct.get("snapshotAt"))
        if acct.get("id") and (age is None or age > cfg["accountMaxAgeSec"]):
            checks.append(_chk("snapshot", "Account snapshot", "WAIT", "Unknown age" if age is None else f"{int(age)} s old"))
            fail(False, "ACCOUNT_STALE", "Account snapshot is stale — equity / margin cannot be verified")
        if acct.get("id") and str(acct.get("currency") or "").upper() != str(auth.get("accountCurrency") or "").upper():
            checks.append(_chk("currency", "Account currency", "FAIL", f"{acct.get('currency')} ≠ {auth.get('accountCurrency')}"))
            fail(True, "CURRENCY_MISMATCH", f"Account currency {acct.get('currency')} differs from the authorized {auth.get('accountCurrency')}")

    # Live / Prop safety: never execute with incomplete evidence or unresolved reconciliation
    ev = auth.get("evidence") or {}
    sizing = ev.get("sizing") or {}
    complete = bool(auth.get("stopLoss")) and float(auth.get("riskAmount") or 0) > 0 and float(auth.get("volume") or 0) > 0 \
        and sizing.get("lossPerLot") and ev.get("accountGates") and ev.get("setupGates")
    if not complete:
        checks.append(_chk("evidence", "Risk evidence", "FAIL", "Stop / risk / sizing evidence incomplete"))
        fail(True, "EVIDENCE_INCOMPLETE", "Authorization lacks complete stop-loss, risk amount or sizing evidence")
    else:
        checks.append(_chk("evidence", "Risk evidence", "PASS", f"Risk {auth.get('riskAmount')} {auth.get('riskCurrency')} · loss/lot {sizing.get('lossPerLot')}"))
    blocking, open_recon = int(ctx.get("blockingRecon") or 0), int(ctx.get("openRecon") or 0)
    demo_relaxed = klass == "DEMO" and cfg.get("demoTestMode")
    if blocking or (open_recon and not demo_relaxed):
        n = blocking or open_recon
        checks.append(_chk("reconciliation", "Reconciliation", "WAIT", f"{n} unresolved finding(s)"))
        fail(False, "RECONCILIATION_UNRESOLVED", f"{n} unresolved reconciliation finding(s) on this account — execution blocked until resolved")
    else:
        checks.append(_chk("reconciliation", "Reconciliation", "PASS", "Broker state reconciled" + (f" ({open_recon} non-blocking, demo test mode)" if open_recon else "")))

    # symbol mapping + contract spec
    sym = str(auth.get("brokerSymbol") or auth.get("instrument") or "")
    if not spec.get("name"):
        checks.append(_chk("symbol", "Broker symbol", "WAIT", f"{sym} unavailable"))
        fail(False, "SYMBOL_UNAVAILABLE", f"Broker symbol {sym} is not available on the attached terminal")
    elif spec["name"] != sym:
        checks.append(_chk("symbol", "Broker symbol", "FAIL", f"{spec['name']} ≠ {sym}"))
        fail(True, "SYMBOL_MISMATCH", f"Terminal symbol {spec['name']} does not match the authorized {sym}")
    else:
        tm = TRADE_MODES.get(int(spec.get("tradeMode", -1)), "UNKNOWN")
        if tm == "FULL" or (tm == "LONG_ONLY" and d > 0) or (tm == "SHORT_ONLY" and d < 0):
            checks.append(_chk("symbol", "Broker symbol", "PASS", f"{sym} · trade mode {tm}"))
        else:
            checks.append(_chk("symbol", "Broker symbol", "WAIT", f"Trade mode {tm}"))
            fail(False, "SYMBOL_NOT_TRADABLE", f"{sym} cannot be traded {'long' if d > 0 else 'short'} now (trade mode {tm})")

    order: dict[str, Any] = {}
    bid, ask, t = m.get("bid"), m.get("ask"), m.get("time")
    tick_age = None if t is None else now - float(t)
    if not bid or not ask or ask < bid or tick_age is None or tick_age > cfg["maxTickAgeSec"]:
        why = "no quote" if not (bid and ask) else "quote time unverifiable" if tick_age is None else f"quote {int(tick_age)} s old"
        checks.append(_chk("price", "Current price", "WAIT", why))
        fail(False, "PRICE_STALE", f"Current price unusable for submission: {why} (max {cfg['maxTickAgeSec']} s)")
    elif spec.get("name") and d:
        tick = float(spec.get("tickSize") or spec.get("point") or 0)
        point = float(spec.get("point") or tick or 1e-5)
        entry = float(ask) if d > 0 else float(bid)
        ref = float(pol.get("referencePrice") or entry)
        dev = entry - ref
        max_dev = float(pol.get("maxDeviationPrice") or 0)
        spread = float(ask) - float(bid)
        order.update({"entry": entry, "bid": float(bid), "ask": float(ask), "spread": round(spread, 10), "spreadPoints": round(spread / point, 1),
                      "deviation": round(dev, 10), "deviationPoints": int(pol.get("maxDeviationPoints") or 0), "tickAgeSec": int(tick_age)})
        checks.append(_chk("price", "Current price", "PASS", f"bid {bid} / ask {ask} · {int(tick_age)} s old"))
        kind = str(pol.get("type") or "MARKET").upper()
        stops_px = float(spec.get("stopsLevel") or 0) * point
        if kind == "MARKET":
            if abs(dev) > max_dev:
                checks.append(_chk("deviation", "Entry deviation", "WAIT", f"{dev:+.6g} vs max ±{max_dev:.6g} from {ref}"))
                fail(False, "PRICE_DEVIATION", f"Price moved {dev:+.6g} from the authorized reference {ref} (max ±{max_dev:.6g})")
            else:
                checks.append(_chk("deviation", "Entry deviation", "PASS", f"{dev:+.6g} of ±{max_dev:.6g}"))
        else:
            # pending entry: the order price must still sit on the correct side of the market, outside the stops level
            pend = float(pol.get("price") or pol.get("referencePrice") or 0)
            gap = (entry - pend) * d if kind == "LIMIT" else (pend - entry) * d
            if pend <= 0 or gap < max(stops_px, 1e-12):
                checks.append(_chk("deviation", "Pending price", "FAIL", f"{kind} {pend} vs market {entry}"))
                fail(True, "PENDING_PRICE_INVALID", f"{kind} price {pend} is no longer valid against the market {entry} (stops level {stops_px:g})")
            else:
                checks.append(_chk("deviation", "Pending price", "PASS", f"{kind} {pend} · {gap:.6g} from market"))
            entry = pend
            order["entry"] = pend
        max_sp = float(pol.get("maxSpread") or 0)
        if max_sp and spread > max_sp + 1e-12:
            checks.append(_chk("spread", "Spread", "WAIT", f"{spread:.6g} > {max_sp:.6g}"))
            fail(False, "SPREAD_TOO_WIDE", f"Spread {spread:.6g} exceeds the authorized maximum {max_sp:.6g}")
        else:
            checks.append(_chk("spread", "Spread", "PASS", f"{spread:.6g} of max {max_sp:.6g}"))
        # SL / TP validity at the current price (MT5 checks stops against the closing side)
        sl, tp = auth.get("stopLoss"), auth.get("takeProfit")
        stops = float(spec.get("stopsLevel") or 0) * point
        close_px = float(bid) if d > 0 else float(ask)
        if sl is None or (close_px - float(sl)) * d <= 0 or (entry - float(sl)) * d <= 0:
            checks.append(_chk("stops", "SL / TP", "FAIL", f"SL {sl} on the wrong side of {close_px}"))
            fail(True, "SL_INVALID", f"Stop-loss {sl} is no longer beyond the current price {close_px}")
        elif (close_px - float(sl)) * d < stops:
            checks.append(_chk("stops", "SL / TP", "WAIT", f"SL {sl} inside broker stops level {stops:g}"))
            fail(False, "SL_TOO_CLOSE", f"Stop-loss {sl} is inside the broker stops level ({stops:g}) of the current price")
        elif tp is not None and (float(tp) - close_px) * d < max(stops, 0):
            checks.append(_chk("stops", "SL / TP", "FAIL", f"TP {tp} already reached / inside stops level"))
            fail(True, "TP_INVALID", f"Take-profit {tp} is already reached or inside the broker stops level")
        else:
            checks.append(_chk("stops", "SL / TP", "PASS", f"SL {sl} · TP {tp if tp is not None else '—'} · stops level {stops:g}"))
        # volume against the current contract spec (never increased)
        vol = float(auth.get("volume") or 0)
        vmin, vmax, vstep = float(spec.get("volumeMin") or 0), float(spec.get("volumeMax") or 0), float(spec.get("volumeStep") or 0)
        if vol <= 0 or vol < vmin - 1e-9 or (vmax and vol > vmax + 1e-9) or not on_step(vol, vstep):
            checks.append(_chk("volume", "Volume", "FAIL", f"{vol} vs {vmin}–{vmax} step {vstep}"))
            fail(True, "VOLUME_INVALID", f"Authorized volume {vol} is not valid for {sym} ({vmin}–{vmax} lots, step {vstep})")
        else:
            checks.append(_chk("volume", "Volume", "PASS", f"{vol} lots ({vmin}–{vmax}, step {vstep})"))
        order["volume"] = vol
        # risk at the current price must stay within the authorized amount
        ccy = str(acct.get("currency") or auth.get("accountCurrency") or "")
        conv = ctx["fx"](str(spec.get("currencyProfit") or ""), ccy) if ctx.get("fx") and ccy else {"ok": False, "reason": "no FX resolver"}
        if not conv.get("ok"):
            checks.append(_chk("risk", "Risk at current price", "WAIT", conv.get("reason") or "FX unavailable"))
            fail(False, "FX_UNAVAILABLE", f"No validated {spec.get('currencyProfit')}→{ccy} conversion: {conv.get('reason') or 'unavailable'}")
        elif sl is not None:
            per_lot = abs(entry - float(sl)) * float(spec.get("contractSize") or 0) * float(conv["rate"])
            risk_now = per_lot * vol
            limit = float(auth.get("riskAmount") or 0) * (1 + cfg["riskTolerancePct"] / 100)
            order.update({"riskNow": round(risk_now, 2), "riskLimit": round(limit, 2), "fxRate": conv["rate"]})
            if risk_now > limit + 1e-9:
                checks.append(_chk("risk", "Risk at current price", "WAIT", f"{risk_now:,.2f} > {limit:,.2f} {ccy}"))
                fail(False, "RISK_EXCEEDS_AUTHORIZED", f"Risk at the current price {risk_now:,.2f} {ccy} exceeds the authorized "
                                                       f"{auth.get('riskAmount')} + {cfg['riskTolerancePct']:g}% tolerance")
            else:
                checks.append(_chk("risk", "Risk at current price", "PASS", f"{risk_now:,.2f} of {limit:,.2f} {ccy}"))
        # margin
        mpl = ctx.get("marginPerLot")
        free = float(acct.get("freeMargin") or 0)
        if mpl is None:
            checks.append(_chk("margin", "Margin", "WAIT", "Broker margin calculation unavailable"))
            fail(False, "MARGIN_UNVERIFIABLE", "Broker margin requirement could not be calculated")
        else:
            need = float(mpl) * vol
            room = free * (1 - cfg["marginBufferPct"] / 100)
            order["marginRequired"] = round(need, 2)
            if need > room:
                checks.append(_chk("margin", "Margin", "WAIT", f"{need:,.2f} > {room:,.2f} usable"))
                fail(False, "MARGIN_INSUFFICIENT", f"Required margin {need:,.2f} exceeds usable free margin {room:,.2f}")
            else:
                checks.append(_chk("margin", "Margin", "PASS", f"{need:,.2f} of {room:,.2f} usable (equity {acct.get('equity')})"))

    # existing exposure (positions opened / changed after authorization)
    ex = ctx.get("exposure") or {}
    inst = str(auth.get("instrument") or "")
    if not ex.get("allowSameSymbol") and inst in (ex.get("symbols") or set()):
        checks.append(_chk("exposure", "Existing exposure", "WAIT", f"Already exposed to {inst}"))
        fail(False, "SYMBOL_ALREADY_EXPOSED", f"Account already holds a position / order on {inst}")
    elif ex.get("maxPositions") is not None and int(ex.get("positions") or 0) >= int(ex["maxPositions"]):
        checks.append(_chk("exposure", "Existing exposure", "WAIT", f"{ex.get('positions')} of {ex['maxPositions']} positions"))
        fail(False, "MAX_POSITIONS", f"Account already has {ex.get('positions')} open positions (limit {ex['maxPositions']})")
    else:
        checks.append(_chk("exposure", "Existing exposure", "PASS", f"{int(ex.get('positions') or 0)} open · no {inst} exposure"))

    terminal = [f for f in fails if f[0]]
    first = terminal[0] if terminal else fails[0] if fails else None
    return {"ok": not fails, "terminal": bool(terminal), "code": first[1] if first else "PASS", "reason": first[2] if first else
            "All pre-execution checks passed", "checks": checks, "order": order, "at": iso(now)}


DECLINE_STATE = {"AUTH_EXPIRED": "EXPIRED", "AUTH_REVOKED": "CANCELLED", "AUTH_CONSUMED": "CANCELLED", "AUTH_NOT_PENDING": "CANCELLED"}


# ---------------------------------------------------------------- 2. order construction

def filling_mode(spec: dict[str, Any]) -> str:
    """SYMBOL_FILLING_FOK = 1, SYMBOL_FILLING_IOC = 2; market-execution symbols without either accept RETURN."""
    fm = int(spec.get("fillingMode") or 0)
    return "FOK" if fm & 1 else "IOC" if fm & 2 else "RETURN"


def build_entry(auth: dict[str, Any], rv: dict[str, Any], spec: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    """MT5 request for the authorized entry. Market orders use the revalidated price; LIMIT / STOP policies become pending orders
    that expire with the authorization. The comment carries the execution ID, the magic number marks Stage 9."""
    d = dsign(auth["direction"])
    pol = auth.get("entryPolicy") or {}
    kind = str(pol.get("type") or "MARKET").upper()
    tick = float(spec.get("tickSize") or spec.get("point") or 0)
    base = {"symbol": auth.get("brokerSymbol") or auth["instrument"], "volume": float(auth["volume"]), "sl": float(auth["stopLoss"]),
            "tp": None if auth.get("takeProfit") is None else float(auth["takeProfit"]), "magic": int(cfg["magic"]),
            "comment": str(auth["executionId"])[:31], "filling": filling_mode(spec)}
    if kind == "MARKET":
        return {**base, "action": "DEAL", "type": "BUY" if d > 0 else "SELL", "price": round_tick(rv["order"]["entry"], tick),
                "deviation": int(pol.get("maxDeviationPoints") or 0), "typeTime": "GTC"}
    price = round_tick(float(pol.get("price") or pol.get("referencePrice")), tick)
    suffix = "LIMIT" if kind == "LIMIT" else "STOP"
    return {**base, "action": "PENDING", "type": f"{'BUY' if d > 0 else 'SELL'}_{suffix}", "price": price, "deviation": 0,
            "typeTime": "SPECIFIED", "expiration": parse_ts(pol.get("validUntil") or auth.get("expiresAt")), "filling": "RETURN"}


def build_close(x: dict[str, Any], ticket: int, volume: float, price: float, cfg: dict[str, Any], deviation: int, spec: dict[str, Any]) -> dict[str, Any]:
    d = dsign(x["direction"])
    return {"action": "DEAL", "type": "SELL" if d > 0 else "BUY", "symbol": x["brokerSymbol"], "volume": float(volume), "position": int(ticket),
            "price": float(price), "deviation": int(deviation), "magic": int(cfg["magic"]), "comment": str(x["executionId"])[:31],
            "filling": filling_mode(spec), "typeTime": "GTC"}


def build_sltp(x: dict[str, Any], ticket: int, sl: float | None, tp: float | None, cfg: dict[str, Any]) -> dict[str, Any]:
    return {"action": "SLTP", "symbol": x["brokerSymbol"], "position": int(ticket), "sl": sl, "tp": tp, "magic": int(cfg["magic"]),
            "comment": str(x["executionId"])[:31]}


def classify_send(res: dict[str, Any] | None, requested_volume: float) -> dict[str, Any]:
    """Broker answer -> FILLED | PARTIAL | PLACED | NO_FILL_RETRY | REJECTED | UNKNOWN. A missing answer is UNKNOWN, never a failure."""
    if not res or res.get("retcode") is None:
        return {"outcome": "UNKNOWN", "code": "NO_RESPONSE", "reason": (res or {}).get("error") or "No broker response (disconnect / exception)"}
    rc = int(res["retcode"])
    name = RETCODES.get(rc, str(rc))
    text = f"{name} ({rc}){(' — ' + str(res.get('comment'))) if res.get('comment') else ''}"
    if rc in (10009, 10010):
        vol = float(res.get("volume") or 0)
        if rc == 10010 or (vol and vol + 1e-9 < requested_volume):
            return {"outcome": "PARTIAL", "code": name, "reason": f"Partially filled {vol} of {requested_volume} — {text}"}
        return {"outcome": "FILLED", "code": name, "reason": text}
    if rc == 10008:
        return {"outcome": "PLACED", "code": name, "reason": text}
    if rc in NO_FILL_RETRY:
        return {"outcome": "NO_FILL_RETRY", "code": name, "reason": text}
    if rc in AMBIGUOUS:
        return {"outcome": "UNKNOWN", "code": name, "reason": text}
    return {"outcome": "REJECTED", "code": name, "reason": text}


def slippage_points(d: int, requested: float | None, filled: float | None, point: float) -> float | None:
    """Adverse slippage is positive."""
    if requested is None or filled is None or not point:
        return None
    return round((filled - requested) * d / point, 1)


# ---------------------------------------------------------------- 3. autonomous position management

def r_multiple(x: dict[str, Any], price: float) -> float | None:
    dist = float(x.get("initialRiskDistance") or 0)
    entry = x.get("fillPrice")
    if dist <= 0 or entry is None:
        return None
    return (price - float(entry)) * dsign(x["direction"]) / dist


def exit_price(d: int, bid: float, ask: float) -> float:
    return bid if d > 0 else ask


def management_plan(x: dict[str, Any], pos: dict[str, Any], market: dict[str, Any], cfg: dict[str, Any], ctx: dict[str, Any]) -> list[dict[str, Any]]:
    """Ordered management actions for one Stage 9 position. Stops are only ever tightened; a missing or widened broker stop is
    restored to the engine's protective stop.

    x: ledger document (direction, fillPrice, initialRiskDistance, protectiveSl, targetTp, openVolume, mgmt flags)
    pos: broker position {ticket, volume, sl, tp, priceOpen, priceCurrent, profit, time}
    market: {bid, ask, spec}
    ctx: now, exits [{code, reason}] (operator / risk / structural / prop time rules)
    """
    d = dsign(x["direction"])
    spec = market.get("spec") or {}
    tick = float(spec.get("tickSize") or spec.get("point") or 0) or 1e-5
    point = float(spec.get("point") or tick)
    stops = float(spec.get("stopsLevel") or 0) * point
    bid, ask = market.get("bid"), market.get("ask")
    mg = x.get("mgmt") or {}
    out: list[dict[str, Any]] = []
    vol = float(pos.get("volume") or 0)
    # 1. exits (highest priority)
    exits = list(ctx.get("exits") or [])
    if cfg.get("maxHoldHours") and x.get("filledAt"):
        held = ctx["now"] - (parse_ts(x["filledAt"]) or ctx["now"])
        if held >= cfg["maxHoldHours"] * 3600:
            exits.append({"code": "TIME_EXIT", "reason": f"Held {held / 3600:.1f} h (max {cfg['maxHoldHours']} h)"})
    if exits and not mg.get("exitPending"):
        out.append({"type": "CLOSE", "volume": vol, "code": exits[0]["code"], "reason": exits[0]["reason"]})
        return out
    if not bid or not ask:
        return out
    px = exit_price(d, float(bid), float(ask))
    protective = x.get("protectiveSl")
    broker_sl = pos.get("sl") or None
    # 2. protection: attach / restore the protective stop, adopt an externally tightened one
    if broker_sl is None or tighter(d, protective, broker_sl) and abs(float(protective) - float(broker_sl)) > tick / 2:
        if protective is not None:
            out.append({"type": "SLTP", "sl": protective, "tp": x.get("targetTp") if pos.get("tp") is None else pos.get("tp"),
                        "code": "INITIAL_PROTECTION" if not mg.get("protected") else "RESTORE_PROTECTION",
                        "reason": ("Attach protective stop" if broker_sl is None else f"Broker stop {broker_sl} is wider than the protective stop {protective} — restoring")})
            return out
    elif protective is not None and tighter(d, broker_sl, protective) and abs(float(broker_sl) - float(protective)) > tick / 2:
        out.append({"type": "ADOPT_SL", "sl": float(broker_sl), "code": "EXTERNAL_TIGHTEN", "reason": f"Broker stop tightened externally to {broker_sl} — adopted"})
    cur_sl = broker_sl if broker_sl is not None else protective
    r = r_multiple(x, px)
    if r is None:
        return out
    dist = float(x["initialRiskDistance"])
    entry = float(x["fillPrice"])
    # 3. partial exit
    frac = float(cfg.get("partialFraction") or 0)
    if frac > 0 and not mg.get("partialDone") and not mg.get("partialPending") and r >= cfg["partialAtR"]:
        step, vmin = float(spec.get("volumeStep") or 0.01), float(spec.get("volumeMin") or 0.01)
        part = floor_step(vol * frac, step)
        if part >= vmin - 1e-9 and vol - part >= vmin - 1e-9:
            out.append({"type": "PARTIAL", "volume": part, "code": "PARTIAL_TARGET", "reason": f"+{r:.2f}R reached {cfg['partialAtR']:g}R — closing {part} of {vol} lots"})
        else:
            out.append({"type": "MARK", "flag": "partialDone", "code": "PARTIAL_SKIPPED", "reason": f"{vol} lots cannot be split at step {step} / min {vmin}"})
    # 4. break-even / 5. trailing — one stop modification per cycle, tightening only, outside the broker stops level
    cands = []
    if not mg.get("beDone") and r >= cfg["breakEvenAtR"]:
        be = round_tick(entry + d * cfg["breakEvenOffsetR"] * dist, tick, "up" if d > 0 else "down")
        cands.append(("BREAK_EVEN", be, f"+{r:.2f}R reached {cfg['breakEvenAtR']:g}R — stop to break-even {be}"))
    if r >= cfg["trailStartR"]:
        tr = round_tick(px - d * cfg["trailDistanceR"] * dist, tick, "down" if d > 0 else "up")
        if cur_sl is None or (tr - float(cur_sl)) * d >= cfg["trailStepR"] * dist - 1e-12:
            cands.append(("TRAILING", tr, f"+{r:.2f}R — trailing stop {cfg['trailDistanceR']:g}R behind price to {tr}"))
    valid = [c for c in cands if tighter(d, c[1], cur_sl) and (px - c[1]) * d >= stops]
    if valid:
        code, sl, why = max(valid, key=lambda c: c[1] * d)
        out.append({"type": "SLTP", "sl": sl, "tp": pos.get("tp"), "code": code, "reason": why})
    return out


def position_state(x: dict[str, Any]) -> str:
    mg = x.get("mgmt") or {}
    if mg.get("exitPending"):
        return "EXIT_PENDING"
    if mg.get("error"):
        return "ERROR"
    if mg.get("inFlight"):
        return "MANAGING"
    if mg.get("trailing"):
        return "TRAILING"
    if mg.get("beDone"):
        return "BREAKEVEN"
    if mg.get("partialDone") and mg.get("partialTaken"):
        return "PARTIAL_EXIT"
    if mg.get("protected"):
        return "PROTECTED"
    return "OPEN"


def next_action(x: dict[str, Any], cfg: dict[str, Any]) -> str:
    """Human description of the next planned management step."""
    mg = x.get("mgmt") or {}
    d = dsign(x.get("direction"))
    dist = float(x.get("initialRiskDistance") or 0)
    entry = x.get("fillPrice")
    if mg.get("exitPending"):
        return f"Exit in progress ({mg.get('exitCode') or 'exit'})"
    if not mg.get("protected"):
        return f"Attach / verify protective stop {x.get('protectiveSl')}"
    if entry is None or dist <= 0:
        return "Monitoring"
    lvl = lambda r: round(float(entry) + d * r * dist, 6)  # noqa: E731
    steps = []
    if cfg.get("partialFraction") and not mg.get("partialDone"):
        steps.append((cfg["partialAtR"], f"Partial {int(cfg['partialFraction'] * 100)}% at {lvl(cfg['partialAtR'])} (+{cfg['partialAtR']:g}R)"))
    if not mg.get("beDone"):
        steps.append((cfg["breakEvenAtR"], f"Break-even at {lvl(cfg['breakEvenAtR'])} (+{cfg['breakEvenAtR']:g}R)"))
    if not mg.get("trailing"):
        steps.append((cfg["trailStartR"], f"Trailing from {lvl(cfg['trailStartR'])} (+{cfg['trailStartR']:g}R)"))
    if steps:
        return min(steps, key=lambda s: s[0])[1]
    return f"Trailing {cfg['trailDistanceR']:g}R behind price · TP {x.get('targetTp') or '—'}"


# ---------------------------------------------------------------- 4. reconciliation

def match_broker(ledger: list[dict[str, Any]], positions: list[dict[str, Any]], magic: int) -> dict[str, Any]:
    """Link broker positions to Stage 9 executions: by recorded ticket, else by the execution ID in the comment.
    Returns matched [(x, pos)], unmatched_ledger, ours_unlinked (our magic / comment, no ledger row), external, duplicates."""
    by_ticket = {int(x["mt5Position"]): x for x in ledger if x.get("mt5Position")}
    by_eid = {x["executionId"]: x for x in ledger}
    matched, ours_unlinked, external, dupes = [], [], [], []
    seen: dict[str, dict[str, Any]] = {}
    for p in positions:
        x = by_ticket.get(int(p["ticket"]))
        if x is None and p.get("comment") in by_eid:
            x = by_eid[p["comment"]]
        if x is not None:
            if x["executionId"] in seen:
                dupes.append((x, p))
                continue
            seen[x["executionId"]] = p
            matched.append((x, p))
        elif int(p.get("magic") or 0) == int(magic) or str(p.get("comment") or "").startswith("EX-"):
            ours_unlinked.append(p)
        else:
            external.append(p)
    unmatched = [x for x in ledger if x["executionId"] not in seen and x.get("positionState") in OPEN_POSITION]
    return {"matched": matched, "unmatchedLedger": unmatched, "oursUnlinked": ours_unlinked, "external": external, "duplicates": dupes}


def deal_summary(deals: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate MT5 deals of one position: volume-weighted entry / exit, costs and realized P&L (profit + commission + swap + fee)."""
    ins = [dl for dl in deals if dl["entry"] in ("IN", "INOUT")]
    outs = [dl for dl in deals if dl["entry"] in ("OUT", "OUT_BY", "INOUT")]
    vin = sum(float(dl["volume"]) for dl in ins)
    vout = sum(float(dl["volume"]) for dl in outs)
    wavg = (lambda rows, v: sum(float(r["price"]) * float(r["volume"]) for r in rows) / v if v > 0 else None)  # noqa: E731
    comm = sum(float(dl.get("commission") or 0) + float(dl.get("fee") or 0) for dl in deals)
    swap = sum(float(dl.get("swap") or 0) for dl in deals)
    gross = sum(float(dl.get("profit") or 0) for dl in deals)
    last_out = max(outs, key=lambda dl: dl.get("time") or 0) if outs else None
    return {"volumeIn": round(vin, 8), "volumeOut": round(vout, 8), "entryPrice": wavg(ins, vin), "exitPrice": wavg(outs, vout),
            "commission": round(comm, 2), "swap": round(swap, 2), "gross": round(gross, 2), "realized": round(gross + comm + swap, 2),
            "openedAt": min((dl.get("time") for dl in ins if dl.get("time")), default=None),
            "closedAt": last_out.get("time") if last_out else None, "closeReason": last_out.get("reason") if last_out else None,
            "closed": vin > 0 and vout + 1e-9 >= vin}


def exit_reason(x: dict[str, Any], closing_deal_reason: str | None) -> str:
    """Engine-initiated exits keep their code; broker-side closes are classified from the closing deal's reason."""
    mg = x.get("mgmt") or {}
    if mg.get("exitCode") and closing_deal_reason in (None, "EXPERT"):
        return str(mg["exitCode"])
    return {"SL": "TRAILING_STOP" if mg.get("trailing") else "BREAK_EVEN_STOP" if mg.get("beDone") else "STOP_LOSS", "TP": "TAKE_PROFIT",
            "SO": "STOP_OUT", "CLIENT": "MANUAL_BROKER_CLOSE", "MOBILE": "MANUAL_BROKER_CLOSE", "WEB": "MANUAL_BROKER_CLOSE",
            "EXPERT": str(mg.get("exitCode") or "EXPERT_CLOSE"), "VMARGIN": "VARIATION_MARGIN"}.get(str(closing_deal_reason or ""), "BROKER_CLOSE")


def trade_record(x: dict[str, Any], summary: dict[str, Any], orders: list[dict[str, Any]], events: list[dict[str, Any]]) -> dict[str, Any]:
    """Completed-trade record for Stage 10: expected vs actual entry, slippage, realized P&L, R-multiple, exit reason, the Stage 2-8
    evidence captured at consumption and execution quality."""
    auth = x.get("authorization") or {}
    risk_amt = float(auth.get("riskAmount") or 0) or None
    opened, closed = parse_ts(summary.get("openedAt")) or parse_ts(x.get("filledAt")), parse_ts(summary.get("closedAt"))
    entry_orders = [o for o in orders if o.get("purpose") == "ENTRY"]
    return {
        "executionId": x["executionId"], "setupKey": x["setupKey"], "accountId": x["accountId"], "accountClass": x["accountClass"],
        "currency": x.get("accountCurrency"), "symbol": x["instrument"], "brokerSymbol": x.get("brokerSymbol"), "direction": x["direction"],
        "volume": summary.get("volumeIn") or x.get("filledVolume"), "entryExpected": (auth.get("entryPolicy") or {}).get("referencePrice"),
        "entryRequested": x.get("requestedPrice"), "entryActual": summary.get("entryPrice") or x.get("fillPrice"), "exitPrice": summary.get("exitPrice"),
        "stopLoss": auth.get("stopLoss"), "takeProfit": auth.get("takeProfit"), "slippagePoints": x.get("slippagePoints"),
        "realizedPnl": summary.get("realized"), "grossPnl": summary.get("gross"), "commission": summary.get("commission"), "swap": summary.get("swap"),
        "riskAmount": risk_amt, "riskPct": auth.get("riskPct"),
        "rMultiple": None if not risk_amt or summary.get("realized") is None else round(float(summary["realized"]) / risk_amt, 2),
        "openedAt": iso(opened), "closedAt": iso(closed), "durationSec": None if not opened or not closed else int(closed - opened),
        "exitReason": x.get("exitReason"), "management": x.get("mgmt"),
        "executionQuality": {"latencyMs": x.get("latencyMs"), "spreadAtSubmit": x.get("spreadAtSubmit"), "slippagePoints": x.get("slippagePoints"),
                             "requotes": x.get("requotes", 0), "fillRatio": None if not x.get("authVolume") else round(float(summary.get("volumeIn") or 0) / float(x["authVolume"]), 4),
                             "entryOrders": len(entry_orders), "managementOrders": len(orders) - len(entry_orders)},
        "evidence": {"stage8": {"authorization": {k: auth.get(k) for k in ("executionId", "attempt", "volume", "riskAmount", "riskPct", "rewardRisk",
                                                                               "entryPolicy", "authorizedAt", "configHash")},
                                "gates": (auth.get("evidence") or {})}, "stage7": auth.get("source"), "upstream": x.get("upstream")},
        "timeline": [{k: e.get(k) for k in ("kind", "state", "detail", "createdAt")} for e in events][-60:],
    }


# ---------------------------------------------------------------- 5. ledger document

def new_ledger(auth: dict[str, Any], node: str, now: float) -> dict[str, Any]:
    pol = auth.get("entryPolicy") or {}
    return {
        "executionId": auth["executionId"], "setupKey": auth["setupKey"], "attempt": int(auth.get("attempt") or 1), "accountId": auth["accountId"],
        "accountName": auth.get("accountName"), "accountClass": str(auth.get("accountClass") or "").upper(), "accountCurrency": auth.get("accountCurrency"),
        "instrument": auth["instrument"], "brokerSymbol": auth.get("brokerSymbol") or auth["instrument"], "direction": auth["direction"],
        "entryType": str(pol.get("type") or "MARKET").upper(), "authVolume": float(auth["volume"]), "authSl": auth.get("stopLoss"),
        "authTp": auth.get("takeProfit"), "referencePrice": pol.get("referencePrice"), "riskAmount": auth.get("riskAmount"),
        "riskPct": auth.get("riskPct"), "authExpiresAt": auth.get("expiresAt"), "node": node, "orderState": "AUTHORIZED", "positionState": None,
        "stateReason": "Stage 8 authorization received", "blockerCode": None, "revalidation": None, "requotes": 0, "mgmt": {},
        "authorization": auth, "createdAt": iso(now), "updatedAt": iso(now),
    }


def friday_close(now: float) -> float:
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    days = (4 - dt.weekday()) % 7
    return (dt + timedelta(days=days)).replace(hour=21, minute=0, second=0, microsecond=0).timestamp()


def risk_exits(x: dict[str, Any], acct: dict[str, Any] | None, risk_acct: dict[str, Any] | None, risk_cfg: dict[str, Any], cfg: dict[str, Any],
               stage7: dict[str, Any] | None, last_h1_close: float | None, now: float) -> list[dict[str, str]]:
    """Exit triggers that do not depend on price geometry: operator request, daily-loss breach, prop weekend rule, structural invalidation."""
    out: list[dict[str, str]] = []
    mg = x.get("mgmt") or {}
    if mg.get("exitRequest"):
        out.append({"code": "OPERATOR_EXIT", "reason": f"Operator exit requested: {mg['exitRequest'].get('reason') or 'no reason'} ({mg['exitRequest'].get('actor')})"})
    if cfg.get("riskExitDailyLoss") and risk_acct and risk_acct.get("dailyLossPct") is not None:
        lim = float(risk_cfg.get("maxDailyLossPct") or 0)
        if lim and float(risk_acct["dailyLossPct"]) >= lim:
            out.append({"code": "RISK_EXIT_DAILY_LOSS", "reason": f"Account daily loss {float(risk_acct['dailyLossPct']):.2f}% reached the {lim:g}% limit"})
    rules = (acct or {}).get("propRules") or {}
    if str((acct or {}).get("accountClass") or "").upper() == "PROP" and rules.get("weekendHolding") is False:
        to_close = friday_close(now) - now
        if 0 <= to_close <= float(risk_cfg.get("weekendCutoffHours") or 2) * 3600:
            out.append({"code": "PROP_WEEKEND_EXIT", "reason": f"Prop profile forbids weekend holding — {to_close / 60:.0f} min to the weekly close"})
    if cfg.get("structuralExit"):
        d = dsign(x["direction"])
        if stage7 and stage7.get("state") == "CONFIRMED" and dsign(stage7.get("direction")) == -d:
            out.append({"code": "STRUCTURAL_INVALIDATION", "reason": f"Stage 7 now confirms {stage7.get('direction')} on {x['instrument']} — opposite structure"})
        inv = ((x.get("authorization") or {}).get("source") or {}).get("invalidationLevel")
        if inv is not None and last_h1_close is not None and (float(last_h1_close) - float(inv)) * d < 0:
            out.append({"code": "STRUCTURAL_INVALIDATION", "reason": f"H1 closed at {last_h1_close} beyond the Stage 7 invalidation {inv}"})
    return out


FxFn = Callable[[str, str], dict[str, Any]]
