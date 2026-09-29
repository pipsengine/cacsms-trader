"""Autonomous economic-calendar engine.

Runs on the bridge thread. It keeps processing when no browser is connected. It never submits orders.
"""

from __future__ import annotations

import json
import threading
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import economic as econ
import economic_store as store

try:
    import channel_store
except ImportError:  # pragma: no cover
    from bridge.mt5 import channel_store  # type: ignore

LOOP_SEC = 2
FETCH_SEC = 60


class ProviderError(RuntimeError):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def fetch_provider(url: str, token: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
    """Provider-independent HTTP adapter. The bridge validates and normalizes the payload."""
    join = "&" if "?" in url else "?"
    query = f"from={start.strftime('%Y-%m-%dT%H:%M:%SZ')}&to={end.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    headers = {"Accept": "application/json", "User-Agent": "cacsms-economic/2"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url + join + query, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=12) as res:
            payload = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        code = "ERROR" if exc.code == 429 else "DISCONNECTED"
        raise ProviderError(f"Provider HTTP {exc.code}", code) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderError(f"Provider unreachable: {exc}", "DISCONNECTED") from exc
    rows = payload if isinstance(payload, list) else payload.get("events") or payload.get("data") or []
    if not isinstance(rows, list):
        raise RuntimeError("Provider payload has no event list")
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        item = econ.normalize_event(row, source_mode="LIVE")
        if item:
            out.append(item)
    return out


def _pip(symbol: str) -> float:
    if symbol == "XAUUSD":
        return 0.1
    if "JPY" in symbol:
        return 0.01
    return 0.0001


class EconomicService:
    def __init__(self) -> None:
        self.publish: Callable[..., int] | None = None
        self.wake_risk: Callable[..., None] | None = None
        self.wake_learning: Callable[..., None] | None = None
        self.quotes: Callable[[list[str]], dict[str, dict[str, float]]] | None = None
        self.thread: threading.Thread | None = None
        self._wake = threading.Event()
        self._lock = threading.Lock()
        self._force_fetch = False
        self._revalidate: set[str] = set()
        self._source_mode = "UNCONFIGURED"
        self._source_reason = "DATA SOURCE NOT CONFIGURED"
        self._feed_reported: str | None = None
        self._mt5_state = "DISCONNECTED"
        self._actuals: set[str] = set()
        self._spread_hit: set[str] = set()
        self._shock: set[str] = set()
        self._last_fetch = 0.0
        self._last_ok = 0.0
        self._phases: dict[str, str] = {}
        self._global = "NORMAL"
        self._anchors: dict[str, dict[str, float]] = {}
        self._paths: dict[str, dict[str, list[tuple[float, float]]]] = {}
        self._closed: set[str] = set()
        self._structure_sig: dict[str, str] = {}
        self.meta: dict[str, Any] = {"status": "STARTING", "message": "Economic Intelligence starting", "cycles": 0, "errors": 0}

    def bind(self, *, publish: Callable[..., int] | None, wake_risk: Callable[..., None] | None,
             wake_learning: Callable[..., None] | None, quotes: Callable[[list[str]], dict[str, dict[str, float]]] | None) -> None:
        self.publish = publish
        self.wake_risk = wake_risk
        self.wake_learning = wake_learning
        self.quotes = quotes

    def start(self) -> None:
        store.ensure_schema()
        self.thread = threading.Thread(target=self._loop, name="economic-intelligence", daemon=True)
        self.thread.start()

    def refresh(self) -> dict[str, Any]:
        """Administrative diagnostic. Normal operation does not depend on it."""
        with self._lock:
            self._force_fetch = True
        self._wake.set()
        store.audit("DIAGNOSTIC_REFRESH", "Operator requested an economic calendar refresh", severity="INFO")
        return {"ok": True, "message": "Calendar refresh requested. The engine applies the result on its own loop."}

    def revalidate(self, symbol: str) -> dict[str, Any]:
        symbol = symbol.upper()
        if symbol not in econ.UNIVERSE:
            return {"ok": False, "message": f"Unknown instrument {symbol}"}
        with self._lock:
            self._revalidate.add(symbol)
        self._wake.set()
        return {"ok": True, "message": f"Revalidation requested for {symbol}. Existing positions are left open."}

    def set_policy(self, patch: dict[str, Any]) -> dict[str, Any]:
        current = store.load_policy()
        saved = store.save_policy({**current, **patch})
        store.audit("POLICY_CHANGED", "Economic policy updated. Live trading parameters were not rewritten.", severity="INFO",
                    payload=econ.public_policy(saved))
        with self._lock:
            self._force_fetch = True
        self._wake.set()
        return {"ok": True, "policy": econ.public_policy(saved)}

    def _loop(self) -> None:
        time.sleep(1)
        while True:
            try:
                self.tick()
            except Exception as exc:  # pragma: no cover
                self.meta["errors"] = int(self.meta.get("errors") or 0) + 1
                self.meta["lastError"] = f"{type(exc).__name__}: {exc}"
                traceback.print_exc()
            self._wake.wait(timeout=LOOP_SEC)
            self._wake.clear()

    def tick(self) -> None:
        policy = store.load_policy()
        self._ingest(policy)
        now = datetime.now(timezone.utc)
        events = [e for e in store.load_events() if e["currency"] in policy["currencies"] and e["impact"] in policy["impacts"]]
        classified = [econ.classify_event(e, policy, now) | {"event": e} for e in events]
        active = [c for c in classified if c["state"] != "NORMAL" or c["action"] not in ("ALLOW", "RESUME")]
        symbols = sorted({s for c in active for s in econ.affected_instruments(c["currency"], c["impact"], policy["xauSensitivity"])})
        probe = list(dict.fromkeys([*symbols, "EURUSD"]))
        quotes = self.quotes(probe) if self.quotes else {}
        self._mt5_state = "LIVE" if quotes.get("EURUSD") or any(quotes.get(s) for s in symbols) else "DISCONNECTED"
        channels = self._channels()
        rows = []
        for symbol in econ.UNIVERSE:
            rows.append(self._instrument(symbol, classified, policy, quotes.get(symbol), channels.get(symbol)))
        store.save_instruments(rows)
        state = econ.engine_state([c for c in classified if c["state"] != "NORMAL"]) if policy.get("enabled", True) else "NORMAL"
        reason = self._source_reason if self._source_mode != "LIVE" else (active[0]["reason"] if active else "No active economic restriction")
        calendar = self._calendar_state(policy)
        store.save_engine(state, self._source_mode, reason, {
            "activeEvents": len(active), "blocked": sum(1 for r in rows if r["blocksNewEntries"]),
            "provider": self._source_reason,
            "sources": {
                "calendar": calendar,
                "calendarReason": self._source_reason,
                "sample": self._source_mode == "DEVELOPMENT",
                "lastSync": datetime.fromtimestamp(self._last_ok, timezone.utc).isoformat() if self._last_ok else None,
                "mt5": self._mt5_state,
                "external": "AVAILABLE" if policy.get("externalReference", True) else "UNAVAILABLE",
            },
        })
        self._note_feed(calendar)
        self._transitions(classified, state, policy)
        self._outcomes(classified, policy, quotes)
        self._publish_learning()
        changed = state != self._global or any(r["blocksNewEntries"] for r in rows)
        self._global = state
        if changed and self.wake_risk:
            self.wake_risk("ECON_RISK_GATE")
        self.meta.update({
            "status": "HEALTHY" if self._source_mode == "LIVE" else "DEGRADED",
            "message": reason, "sourceMode": self._source_mode, "state": state,
            "cycles": int(self.meta.get("cycles") or 0) + 1,
            "heartbeatAt": now.isoformat(), "events": len(events),
        })

    def _ingest(self, policy: dict[str, Any]) -> None:
        due = self._force_fetch or time.time() - self._last_fetch >= FETCH_SEC
        with self._lock:
            self._force_fetch = False
        if not policy.get("enabled", True) or not policy.get("machineCalendar", True):
            self._source_mode = "NOT_CONFIGURED"
            self._source_reason = "Machine calendar is off — CALENDAR_UNCERTAIN, new entries fail closed"
            return
        if not due and self._last_fetch:
            if self._source_mode == "LIVE" and time.time() - self._last_ok > float(policy["staleAfterSec"]):
                self._source_mode = "STALE"
                self._source_reason = "Economic calendar heartbeat is stale"
            return
        self._last_fetch = time.time()
        url, token = econ.provider_env(policy)
        if url:
            start, end = datetime.now(timezone.utc) - timedelta(days=1), datetime.now(timezone.utc) + timedelta(days=10)
            try:
                rows = fetch_provider(url, token, start, end)
                store.replace_events(rows, "LIVE")
                self._source_mode = "LIVE"
                self._source_reason = f"Live calendar · {len(rows)} events"
                self._last_ok = time.time()
            except ProviderError as exc:
                self._source_mode = "ERROR" if exc.code == "ERROR" else ("STALE" if self._last_ok else "DISCONNECTED")
                self._source_reason = str(exc)
            except Exception as exc:
                self._source_mode = "ERROR"
                self._source_reason = f"Provider error: {exc}"
            return
        if policy.get("developmentSample") and econ.development_mode():
            raw = econ.development_events(datetime.now(timezone.utc), str(policy.get("timezone") or "Africa/Lagos"))
            rows = [item for item in (econ.normalize_event(r, source_mode="DEVELOPMENT") for r in raw) if item]
            store.replace_events(rows, "DEVELOPMENT")
            self._source_mode = "DEVELOPMENT"
            self._source_reason = "DEVELOPMENT SAMPLE — not a live calendar"
            return
        store.clear_events()
        self._source_mode = "UNCONFIGURED"
        self._source_reason = "DATA SOURCE NOT CONFIGURED"

    def _calendar_state(self, policy: dict[str, Any]) -> str:
        if self._source_mode == "LIVE" and self._last_ok:
            age = time.time() - self._last_ok
            stale = float(policy.get("staleAfterSec") or 180)
            if age > stale:
                return "STALE"
            if age > stale / 2:
                return "DELAYED"
        return econ.feed_state(self._source_mode)

    def _note_feed(self, calendar: str) -> None:
        if self._feed_reported == calendar:
            return
        self._feed_reported = calendar
        if calendar == "LIVE":
            self._emit("ECON_FEED_SYNCED", self._source_reason)
        elif calendar == "STALE":
            self._emit("ECON_FEED_STALE", self._source_reason)
        elif calendar in ("DISCONNECTED", "ERROR"):
            self._emit("ECON_FEED_FAILED", self._source_reason)

    def _channels(self) -> dict[str, dict[str, Any]]:
        try:
            return {r["symbol"]: r for r in channel_store.world_rows()}
        except Exception:
            return {}

    def _instrument(self, symbol: str, classified: list[dict[str, Any]], policy: dict[str, Any],
                    quote: dict[str, float] | None, channel: dict[str, Any] | None) -> dict[str, Any]:
        hits = []
        for row in classified:
            if symbol in econ.affected_instruments(row["currency"], row["impact"], policy["xauSensitivity"]):
                if row["state"] != "NORMAL" or row["action"] not in ("ALLOW", "RESUME"):
                    hits.append(row)
        hits.sort(key=lambda r: econ.RESTRICT_RANK.get(r["action"], 0), reverse=True)
        top = hits[0] if hits else None
        action = top["action"] if top else "ALLOW"
        state = top["state"] if top else "NORMAL"
        reval = bool(top and top["revalidationRequired"])
        spread, vol, score, reaction = self._conditions(symbol, quote, top, policy)
        if top and top["state"] in ("POST_EVENT_VOLATILITY", "STRUCTURE_REVALIDATION"):
            if spread == "SPIKE" or vol == "SPIKE":
                action = "BLOCK_NEW_ENTRY" if top["impact"] == "HIGH" else "REDUCE_RISK"
            event = top["event"]
            analysed = str((channel or {}).get("analysedAt") or "")
            if reval and analysed and analysed >= str(event["scheduledAt"]) and spread != "SPIKE" and vol != "SPIKE":
                reval = False
                action = "RESUME"
                state = "NORMAL"
            elif reval and (spread == "UNKNOWN" or vol == "UNKNOWN"):
                action = "REVALIDATE"
        manual = symbol in self._revalidate
        if manual:
            reval = True
            action = "REVALIDATE"
            state = "STRUCTURE_REVALIDATION"
        feed = self._calendar_state(policy)
        blocks, source_reason = econ.blocks_new(action, source_mode=feed if self._source_mode == "LIVE" else self._source_mode,
                                                enabled=bool(policy.get("enabled", True)),
                                                block_on_stale=bool(policy.get("blockOnStaleFeed", True)))
        if reval and self._source_mode == "LIVE":
            blocks = True
        reason = source_reason if blocks and self._source_mode != "LIVE" else (top["reason"] if top else "No economic event in the active window")
        if manual:
            reason = f"Operator requested structure revalidation for {symbol}"
        if reaction == "MARKET_REACTION_UNKNOWN" and top and top["state"] in ("RELEASE_PROCESSING", "POST_EVENT_VOLATILITY"):
            reason = f"{reason} · MARKET_REACTION_UNKNOWN"
        if spread == "SPIKE" and symbol not in self._spread_hit:
            self._spread_hit.add(symbol)
            self._emit("ECON_SPREAD_SPIKE", f"{symbol} spread expanded", event=top["event"] if top else None, symbols=[symbol], severity="WARNING")
        threshold = float(policy.get("reactionScoreMin") or 70)
        if score is not None and score >= threshold and top and top["state"] in ("RELEASE_PROCESSING", "POST_EVENT_VOLATILITY") and symbol not in self._shock:
            self._shock.add(symbol)
            self._emit("ECON_MARKET_SHOCK", f"{symbol} market reaction {score}", event=top["event"], symbols=[symbol], severity="WARNING")
        surprise = None
        if top and top["event"].get("surprise") and top["event"]["surprise"].get("available"):
            surprise = top["event"]["surprise"]["interpretation"]
        elif top and top["event"].get("seriesKind") == "speech":
            surprise = "UNAVAILABLE"
        return {
            "symbol": symbol, "state": state, "activeEventId": top["eventId"] if top else None,
            "currency": top["currency"] if top else None, "impact": top["impact"] if top else None,
            "minutesToEvent": top["minutesToEvent"] if top else None, "surprise": surprise,
            "spreadCondition": spread, "volatilityCondition": vol, "restriction": action,
            "blocksNewEntries": blocks, "revalidationRequired": reval, "reason": reason,
            "detail": {
                "sourceMode": self._source_mode, "calculatedAction": action, "riskReductionFactor": policy["riskReductionFactor"],
                "positionAction": "MANAGE" if top else "NONE", "title": top["title"] if top else None,
                "closesPositions": False, "marketReactionScore": score, "marketReaction": reaction,
                "calendarFeedHealth": feed, "mt5Health": self._mt5_state,
                "scheduledAt": top["event"]["scheduledAt"] if top else None,
                "actual": top["event"].get("actual") if top else None,
                "forecast": top["event"].get("forecast") if top else None,
                "previous": top["event"].get("previous") if top else None,
                "releasePhase": "RELEASE_AWAITING_DATA" if top and top["state"] == "RELEASE_PROCESSING" and not top["event"].get("actual") else None,
            },
        }

    def _conditions(self, symbol: str, quote: dict[str, float] | None, top: dict[str, Any] | None, policy: dict[str, Any]) -> tuple[str, str, float | None, str]:
        if not quote or quote.get("bid") is None or quote.get("ask") is None:
            return "UNKNOWN", "UNKNOWN", None, "MARKET_REACTION_UNKNOWN"
        bid, ask = float(quote["bid"]), float(quote["ask"])
        mid = (bid + ask) / 2
        spread = ask - bid
        anchor = self._anchors.setdefault(symbol, {"spread": spread, "price": mid})
        if spread < anchor["spread"]:
            anchor["spread"] = spread
        spread_state = "SPIKE" if anchor["spread"] > 0 and spread > anchor["spread"] * float(policy["maxSpreadMultiplier"]) else "NORMAL"
        move = None
        if top and top["state"] in ("RELEASE_PROCESSING", "POST_EVENT_VOLATILITY", "STRUCTURE_REVALIDATION"):
            key = top["eventId"]
            path = self._paths.setdefault(key, {}).setdefault(symbol, [])
            mins = top["minutesToEvent"] if top["minutesToEvent"] is not None else 0
            path.append((float(mins), mid))
            base = path[0][1]
            move = abs(mid - base) / _pip(symbol)
        vol = "SPIKE" if move is not None and move >= float(policy.get("reactionMovePips") or 12) * float(policy["volatilityAtr"]) else "NORMAL"
        scored = econ.reaction_score(
            spread_ratio=(spread / anchor["spread"]) if anchor["spread"] > 0 else None,
            move_pips=move,
            spread_threshold=float(policy["maxSpreadMultiplier"]),
            move_threshold=float(policy.get("reactionMovePips") or 12),
        )
        return spread_state, vol, scored["score"], "OBSERVED" if scored["available"] else "MARKET_REACTION_UNKNOWN"

    def _transitions(self, classified: list[dict[str, Any]], state: str, policy: dict[str, Any]) -> None:
        for row in classified:
            prev = self._phases.get(row["eventId"])
            phase = row["state"]
            if prev == phase:
                continue
            self._phases[row["eventId"]] = phase
            event = row["event"]
            symbols = econ.affected_instruments(row["currency"], row["impact"], policy["xauSensitivity"])
            kind = None
            if phase == "EVENT_WATCH":
                kind = "ECON_EVENT_WATCH"
                self._emit("ECON_EVENT_UPCOMING", row["reason"], event=event, symbols=symbols)
            elif phase in ("PRE_EVENT_RESTRICTED", "EVENT_LOCK"):
                kind = "ECON_PRE_EVENT_GATE"
            elif phase == "RELEASE_PROCESSING":
                kind = "ECON_RELEASE_WINDOW"
            elif phase == "POST_EVENT_VOLATILITY":
                kind = "ECON_VOLATILITY_SPIKE" if row["impact"] == "HIGH" else "ECON_RELEASED"
            elif phase == "STRUCTURE_REVALIDATION":
                kind = "ECON_REVALIDATION_REQUESTED"
            elif phase == "NORMAL" and prev:
                kind = "ECON_NORMALIZED"
            if event.get("actual") and row["eventId"] not in self._actuals:
                self._actuals.add(row["eventId"])
                self._emit("ECON_ACTUAL_RECEIVED", f"{event['title']} actual {event.get('actual')}", event=event, symbols=symbols)
            if event.get("surprise") and event["surprise"].get("available") and row["eventId"] not in self._closed:
                self._emit("ECON_SURPRISE_CALCULATED", f"{event['title']}: {event['surprise']['interpretation']}", event=event, symbols=symbols)
            if kind:
                self._emit(kind, row["reason"], event=event, symbols=symbols, severity="WARNING" if kind != "ECON_NORMALIZED" else "INFO")
            if kind == "ECON_REVALIDATION_REQUESTED":
                self._structure(event, symbols)
        if state != self._global and state == "NORMAL":
            self._revalidate.clear()

    def _structure(self, event: dict[str, Any], symbols: list[str]) -> None:
        channels = self._channels()
        for symbol in symbols:
            tfs = (channels.get(symbol) or {}).get("timeframes") or {}
            sig = ",".join(f"{tf}:{tfs.get(tf, {}).get('status')}" for tf in ("D1", "H8", "H1"))
            prev = self._structure_sig.get(symbol)
            self._structure_sig[symbol] = sig
            if prev and prev != sig and "INVALIDATED" in sig:
                self._emit("ECON_STRUCTURE_INVALIDATED", f"{symbol} structure changed through the event window ({sig})",
                           event=event, symbols=[symbol], severity="WARNING")

    def _emit(self, event_type: str, detail: str, *, event: dict[str, Any] | None = None, symbols: list[str] | None = None,
              severity: str = "INFO") -> None:
        store.audit(event_type, detail, event_id=None if not event else event.get("id"), symbol=(symbols or [None])[0],
                    severity=severity, payload={"symbols": symbols or [], "title": None if not event else event.get("title")})
        if self.publish:
            try:
                self.publish(event_type, "ECONOMIC", stage=8, symbols=symbols or None, severity=severity,
                             payload={"detail": detail, "eventId": None if not event else event.get("id")})
            except Exception:
                traceback.print_exc()

    def _outcomes(self, classified: list[dict[str, Any]], policy: dict[str, Any], quotes: dict[str, dict[str, float]]) -> None:
        if self._source_mode != "LIVE":
            return
        for row in classified:
            mins = row["minutesToEvent"]
            if mins is None or mins > -70 or row["eventId"] in self._closed:
                continue
            if row["state"] != "NORMAL":
                continue
            event = row["event"]
            for symbol in econ.affected_instruments(row["currency"], row["impact"], policy["xauSensitivity"]):
                path = self._paths.get(row["eventId"], {}).get(symbol) or []
                def nearest(target: float) -> float | None:
                    if not path:
                        return None
                    base = path[0][1]
                    point = min(path, key=lambda p: abs(p[0] - target))
                    return round((point[1] - base) / _pip(symbol), 2)
                quote = quotes.get(symbol) or {}
                store.record_outcome(row["eventId"], symbol, {
                    "eventKey": event["title"], "currency": event["currency"], "title": event["title"], "symbol": symbol,
                    "actual": event.get("actual"), "forecast": event.get("forecast"), "previous": event.get("previous"),
                    "surprise": event.get("surprise"), "move5m": nearest(-5), "move15m": nearest(-15),
                    "move30m": nearest(-30), "move1h": nearest(-60),
                    "spreadSpikePct": None, "directionBias": "UP" if (nearest(-30) or 0) > 0 else "DOWN" if (nearest(-30) or 0) < 0 else "MIXED",
                    "preEventStructure": self._structure_sig.get(symbol), "quote": quote,
                })
            self._closed.add(row["eventId"])
            self._paths.pop(row["eventId"], None)

    def _publish_learning(self) -> None:
        rows = store.unpublished_outcomes()
        if not rows or not self.wake_learning:
            return
        self.wake_learning("ECON_OUTCOME")
