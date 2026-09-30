"""Consumes autonomous events and queues email. It does not authorize trades and it does not raise into the trading engines."""

from __future__ import annotations

import os
import threading
import time
import traceback
import uuid
from typing import Any

try:
    import notification_mail as mail
    import notification_policy as policy
    import notification_store as store
except ImportError:  # pragma: no cover
    from bridge.mt5 import notification_mail as mail  # type: ignore
    from bridge.mt5 import notification_policy as policy  # type: ignore
    from bridge.mt5 import notification_store as store  # type: ignore

MAX_ATTEMPTS = 5
BACKOFF_S = (15, 30, 60, 120, 300)

P1_EVENTS = {
    "P1_ZONE_REACHED": "P1_ZONE_REACHED",
    "P1_REACTION_DETECTED": "P1_REACTION_DETECTED",
    "P1_READY_FOR_RISK": "P1_READY_FOR_RISK",
}
P2_EVENTS = {
    "P2_BREAK_DETECTED": "P2_BREAK_DETECTED",
    "P2_WAIT_RETEST": "P2_WAIT_RETEST",
    "P2_READY_FOR_RISK": "P2_READY_FOR_RISK",
}


class MemoryOutbox:
    """In-process outbox for tests. It does not touch SQLite or the network."""

    def __init__(self, recipient: str = "pipsengine@gmail.com") -> None:
        self.recipient = recipient
        self.rows: list[dict[str, Any]] = []
        self._settings = store.default_settings(recipient)
        self._smtp = {"host": "", "port": None, "secure": False, "user": "", "fromEmail": "", "fromName": "", "password": ""}
        self._lock = threading.Lock()

    def ensure(self) -> None:
        return None

    def settings(self, recipient: str) -> dict[str, Any]:
        return self._settings

    def save_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        recipient = str(settings.get("recipient") or "").strip()
        if not policy.valid_email(recipient):
            raise ValueError("Recipient is not a valid email address")
        policies = dict(policy.DEFAULT_POLICIES)
        for key, value in (settings.get("policies") or {}).items():
            if key in policies:
                policies[key] = bool(value)
        self._settings = {
            "masterEnabled": bool(settings.get("masterEnabled", True)),
            "fxEnabled": bool(settings.get("fxEnabled", True)),
            "xauEnabled": bool(settings.get("xauEnabled", True)),
            "recipient": recipient,
            "policies": policies,
            "updatedAt": store._now(),
        }
        return self._settings

    def smtp_account(self) -> dict[str, Any]:
        return dict(self._smtp)

    def save_smtp(self, account: dict[str, Any]) -> None:
        current = dict(self._smtp)
        password = str(account.get("password") or "")
        current.update({
            "host": str(account.get("host") or current["host"] or "").strip(),
            "port": account.get("port") if account.get("port") else current["port"],
            "secure": bool(account.get("secure")),
            "user": str(account.get("user") or "").strip(),
            "fromEmail": str(account.get("fromEmail") or "").strip(),
            "fromName": str(account.get("fromName") or "").strip(),
            "password": password if password else current["password"],
        })
        self._smtp = current

    def enqueue(self, row: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            if any(item["eventKey"] == row["eventKey"] for item in self.rows):
                return None
            stored = dict(row)
            stored["notificationId"] = row.get("notificationId") or uuid.uuid4().hex[:16]
            stored["status"] = "PENDING"
            stored["attemptCount"] = 0
            stored["payload"] = row.get("payload") or {}
            stored["createdAt"] = store._now()
            stored["sentAt"] = None
            self.rows.append(stored)
            return stored

    def claim(self, notification_id: str | None = None) -> dict[str, Any] | None:
        with self._lock:
            for row in self.rows:
                if notification_id and row.get("notificationId") != notification_id:
                    continue
                if row["status"] in ("PENDING", "RETRYING"):
                    row["status"] = "SENDING"
                    return dict(row)
        return None

    def notification_status(self, notification_id: str) -> str | None:
        for row in self.rows:
            if row.get("notificationId") == notification_id:
                return row.get("status")
        return None

    def mark(self, notification_id: str, status: str, error: str | None = None, delay_s: int = 0) -> None:
        with self._lock:
            for row in self.rows:
                if row.get("notificationId") == notification_id:
                    row["status"] = status
                    row["attemptCount"] = int(row.get("attemptCount") or 0) + 1
                    row["lastError"] = error
                    if status == "SENT":
                        row["sentAt"] = store._now()
                    return

    def recover(self) -> int:
        with self._lock:
            count = 0
            for row in self.rows:
                if row["status"] == "SENDING":
                    row["status"] = "RETRYING"
                    row["lastError"] = "Recovered after restart"
                    count += 1
            return count

    def history(self, status: str | None = None, candidate_id: str | None = None, limit: int = 40) -> list[dict[str, Any]]:
        rows = list(reversed(self.rows))
        if status and status.upper() != "ALL":
            rows = [row for row in rows if row.get("status") == status.upper()]
        if candidate_id:
            rows = [row for row in rows if row.get("candidateId") == candidate_id]
        return rows[:limit]

    def counts(self) -> dict[str, int]:
        pending = sum(1 for row in self.rows if row["status"] in ("PENDING", "RETRYING", "SENDING"))
        sent = sum(1 for row in self.rows if row["status"] == "SENT")
        dead = sum(1 for row in self.rows if row["status"] == "DEAD_LETTER")
        failed = sum(1 for row in self.rows if row["status"] in ("FAILED", "DEAD_LETTER"))
        return {"pending": pending, "sent": sent, "failed": failed, "deadLetter": dead, "sentToday": sent, "failedToday": failed}


class NotificationService:
    def __init__(self, mailer: Any = None, outbox: Any = None) -> None:
        self.mailer = mailer
        self.outbox = outbox or store.SqliteOutbox()
        self.health = "NOT_CONFIGURED"
        self.last_error: str | None = None
        self.last_success: str | None = None
        self._probed = False
        self._hyp_seeded = False
        self._hyp_open: set[str] = set()
        self._stop = False
        self._thread: threading.Thread | None = None
        self._started = False

    def start(self) -> None:
        self._started = True
        try:
            self.outbox.ensure()
            self.outbox.recover()
        except Exception:
            traceback.print_exc()
        self._probe_once()
        if self._thread and self._thread.is_alive():
            return
        self._stop = False
        self._thread = threading.Thread(target=self._loop, name="notification-email", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop:
            try:
                self.process_one()
            except Exception:
                traceback.print_exc()
            time.sleep(2)

    def delivery_config(self) -> dict[str, Any]:
        """Env defaults, then the saved SMTP account. The password stays inside this process."""
        cfg = mail.smtp_config()
        try:
            account = self.outbox.smtp_account()
        except Exception:
            account = {}
        if account.get("host"):
            cfg["host"] = account["host"]
            cfg["secure"] = bool(account.get("secure"))
        if account.get("port"):
            cfg["port"] = int(account["port"])
        if account.get("user"):
            cfg["user"] = account["user"]
        if account.get("fromEmail"):
            cfg["fromEmail"] = account["fromEmail"]
        if account.get("fromName"):
            cfg["fromName"] = account["fromName"]
        if account.get("password"):
            cfg["password"] = account["password"]
        return cfg

    def _mailer(self) -> Any:
        if self.mailer is not None:
            return self.mailer
        cfg = self.delivery_config()
        if cfg["mode"] == "TEST":
            self.mailer = mail.TestEmailAdapter()
            return self.mailer
        return mail.GmailEmailAdapter(cfg)

    def _probe_once(self) -> None:
        if self._probed:
            return
        self._probed = True
        cfg = self.delivery_config()
        if self.mailer is not None or cfg["mode"] == "TEST":
            self.health = "READY"
            return
        if not cfg["enabled"] or not cfg["password"]:
            self.health = "NOT_CONFIGURED"
            return
        self.health = "CHECKING"

    def public_status(self) -> dict[str, Any]:
        cfg = self.delivery_config()
        try:
            settings = self.outbox.settings(cfg["defaultRecipient"])
            counts = self.outbox.counts()
        except Exception as exc:
            settings = store.default_settings(cfg["defaultRecipient"])
            counts = {"pending": 0, "sent": 0, "failed": 0, "deadLetter": 0, "sentToday": 0, "failedToday": 0}
            self.last_error = type(exc).__name__
        smtp = mail.public_smtp(cfg)
        return {
            "ok": True,
            "health": self.health,
            "smtp": smtp,
            "sender": f"{smtp['fromName']} <{smtp['fromEmail']}>",
            "recipient": settings["recipient"],
            "masterEnabled": settings["masterEnabled"],
            "fxEnabled": settings["fxEnabled"],
            "xauEnabled": settings["xauEnabled"],
            "policies": settings["policies"],
            "pending": counts["pending"],
            "sentToday": counts["sentToday"],
            "failedToday": counts["failedToday"],
            "deadLetter": counts["deadLetter"],
            "lastSuccess": self.last_success,
            "lastError": self.last_error,
            "authorizesTrade": False,
        }

    def update_settings(self, body: dict[str, Any]) -> dict[str, Any]:
        current = self.outbox.settings(self.delivery_config()["defaultRecipient"])
        merged = {
            "masterEnabled": body.get("masterEnabled", current["masterEnabled"]),
            "fxEnabled": body.get("fxEnabled", current["fxEnabled"]),
            "xauEnabled": body.get("xauEnabled", current["xauEnabled"]),
            "recipient": body.get("recipient", current["recipient"]),
            "policies": {**current["policies"], **(body.get("policies") or {})},
        }
        saved = self.outbox.save_settings(merged)
        smtp_keys = ("smtpHost", "smtpPort", "smtpSecure", "smtpUser", "smtpFromEmail", "smtpFromName", "smtpAppPassword")
        if any(key in body for key in smtp_keys):
            self.outbox.save_smtp({
                "host": body.get("smtpHost", ""),
                "port": body.get("smtpPort"),
                "secure": body.get("smtpSecure"),
                "user": body.get("smtpUser", ""),
                "fromEmail": body.get("smtpFromEmail", ""),
                "fromName": body.get("smtpFromName", ""),
                "password": body.get("smtpAppPassword") or "",
            })
            if body.get("smtpAppPassword"):
                self.health = "CHECKING"
                self.last_error = None
                self._probed = True
        status = self.public_status()
        status["settings"] = {key: value for key, value in saved.items()}
        return status

    def _live(self) -> bool:
        """The production singleton ignores events until its worker starts, so unit tests cannot write the live outbox."""
        return self._started or self.mailer is not None or not isinstance(self.outbox, store.SqliteOutbox)

    def ingest_market(self, event: dict[str, Any], candidate: dict[str, Any] | None) -> dict[str, Any] | None:
        if not self._live():
            return None
        try:
            return self._ingest_market(event, candidate)
        except Exception:
            traceback.print_exc()
            return None

    def _ingest_market(self, event: dict[str, Any], candidate: dict[str, Any] | None) -> dict[str, Any] | None:
        event_type = str(event.get("type") or "")
        candidate = candidate or {}
        freshness = ((candidate.get("freshness") or {}).get("state")) or event.get("freshness") or "CURRENT"
        symbol = candidate.get("symbol") or event.get("symbol")
        settings = self.outbox.settings(self.delivery_config()["defaultRecipient"])
        ok, _reason = policy.allows(event_type, symbol, settings, freshness)
        if not ok:
            return None
        revision = event.get("ts") or (candidate.get("breakout") or {}).get("confirmedAt") or (candidate.get("breakout") or {}).get("detectedAt") or "0"
        candidate_id = event.get("candidateId") or candidate.get("candidateId") or symbol
        payload = _market_payload(event, candidate, freshness)
        return self._queue(event_type, f"{candidate_id}|{event_type}|{revision}", payload, candidate_id, symbol, candidate.get("titLevel"))

    def observe_hypotheses(self, result: dict[str, Any]) -> None:
        if not self._live():
            return
        try:
            self._observe_hypotheses(result)
        except Exception:
            traceback.print_exc()

    def _observe_hypotheses(self, result: dict[str, Any]) -> None:
        current: set[str] = set()
        found: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
        for instrument in result.get("instruments") or []:
            symbol = instrument.get("symbol")
            for hypothesis in instrument.get("hypotheses") or []:
                if hypothesis.get("status") == "NOT_DETECTED":
                    continue
                for source, mapping in ((hypothesis.get("p1") or {}, P1_EVENTS), (hypothesis.get("p2") or {}, P2_EVENTS)):
                    state = source.get("state")
                    event_type = mapping.get(state or "")
                    if not event_type:
                        continue
                    key = f"{symbol}|{hypothesis.get('TiTLevel')}|{event_type}"
                    current.add(key)
                    found.append((key, instrument, hypothesis | {"_event": event_type, "_state": state}))
        if not self._hyp_seeded:
            self._hyp_open = current
            self._hyp_seeded = True
            return
        for key, instrument, hypothesis in found:
            if key in self._hyp_open:
                continue
            self._queue_hypothesis(instrument, hypothesis)
        self._hyp_open = current

    def _queue_hypothesis(self, instrument: dict[str, Any], hypothesis: dict[str, Any]) -> None:
        event_type = hypothesis["_event"]
        symbol = instrument.get("symbol")
        freshness = (hypothesis.get("freshness") or {}).get("state") if isinstance(hypothesis.get("freshness"), dict) else hypothesis.get("dataStatus")
        if str(freshness or "").upper() == "STALE":
            freshness = "STALE"
        else:
            freshness = "CURRENT"
        settings = self.outbox.settings(self.delivery_config()["defaultRecipient"])
        ok, _reason = policy.allows(event_type, symbol, settings, freshness)
        if not ok:
            return
        level = hypothesis.get("TiTLevel")
        revision = int(time.time())
        payload = {
            "symbol": symbol,
            "titLevel": level,
            "direction": hypothesis.get("direction"),
            "opportunityFamily": hypothesis.get("opportunityFamily"),
            "timeframe": hypothesis.get("childTimeframe") or hypothesis.get("executionTimeframe"),
            "channelBreak": hypothesis.get("channelBreak") or (hypothesis.get("p1") or {}).get("reason"),
            "structuralBreak": hypothesis.get("structuralBreak"),
            "retest": (hypothesis.get("retest") or {}).get("state") if isinstance(hypothesis.get("retest"), dict) else hypothesis.get("retest"),
            "bos": hypothesis.get("bos"),
            "choch": hypothesis.get("choch"),
            "p1": (hypothesis.get("p1") or {}).get("state"),
            "p2": (hypothesis.get("p2") or {}).get("state"),
            "stage8": "NOT YET AUTHORIZED",
            "campaignId": hypothesis.get("campaignId"),
            "requestedRisk": (hypothesis.get("p1") or {}).get("riskPct") if event_type.startswith("P1") else (hypothesis.get("p2") or {}).get("riskPct"),
            "freshness": freshness,
            "eventEpoch": time.time(),
            "environment": os.environ.get("CACSMS_ENV") or "development",
        }
        self._queue(event_type, f"{symbol}|{level}|{event_type}|{revision}", payload, hypothesis.get("candidateId"), symbol, level, hypothesis.get("campaignId"))

    def ingest_execution(self, event_type: str, execution: dict[str, Any]) -> dict[str, Any] | None:
        if not self._live():
            return None
        try:
            symbol = execution.get("instrument") or execution.get("symbol")
            settings = self.outbox.settings(self.delivery_config()["defaultRecipient"])
            ok, _reason = policy.allows(event_type, symbol, settings, "CURRENT")
            if not ok:
                return None
            identity = execution.get("executionId") or execution.get("mt5Position") or execution.get("ticket")
            payload = {
                "symbol": symbol,
                "direction": execution.get("direction"),
                "ticket": execution.get("mt5Position") or execution.get("mt5Order"),
                "campaignId": execution.get("campaignId"),
                "leg": execution.get("leg") or execution.get("entryPath"),
                "volume": execution.get("filledVolume") or execution.get("openVolume"),
                "fillPrice": execution.get("fillPrice"),
                "stop": execution.get("protectiveSl") or execution.get("authSl"),
                "target": execution.get("targetTp") or execution.get("authTp"),
                "slippage": execution.get("slippagePoints"),
                "fillTime": execution.get("filledAt"),
                "entry": execution.get("fillPrice"),
                "exit": execution.get("exitPrice"),
                "reason": execution.get("exitReason"),
                "pnl": execution.get("realizedPnl"),
                "rMultiple": execution.get("rMultiple"),
                "eventEpoch": time.time(),
            }
            revision = execution.get("filledAt") or execution.get("closedAt") or execution.get("updatedAt") or identity
            return self._queue(event_type, f"{identity}|{event_type}|{revision}", payload, None, symbol, None, execution.get("campaignId"))
        except Exception:
            traceback.print_exc()
            return None

    def ingest_authorization(self, kind: str, row: dict[str, Any]) -> dict[str, Any] | None:
        if not self._live():
            return None
        try:
            event_type = "P1_AUTHORIZED" if kind == "P1" else "P2_AUTHORIZED"
            symbol = row.get("symbol") or row.get("instrument")
            settings = self.outbox.settings(self.delivery_config()["defaultRecipient"])
            ok, _reason = policy.allows(event_type, symbol, settings, row.get("freshness") or "CURRENT")
            if not ok:
                return None
            identity = row.get("id") or row.get("setupKey") or row.get("campaignId")
            payload = {
                "symbol": symbol,
                "direction": row.get("direction"),
                "titLevel": row.get("titLevel"),
                "campaignId": row.get("campaignId") or identity,
                "leg": kind,
                "requestedRisk": row.get("riskPct"),
                "entryPlan": row.get("entry"),
                "invalidation": row.get("invalidation") or row.get("stop"),
                "target": row.get("target"),
                "stage8": "AUTHORIZED",
                "eventEpoch": time.time(),
            }
            return self._queue(event_type, f"{identity}|{event_type}", payload, None, symbol, row.get("titLevel"), payload["campaignId"])
        except Exception:
            traceback.print_exc()
            return None

    def send_test(self) -> dict[str, Any]:
        cfg = self.delivery_config()
        if self.mailer is None and cfg["mode"] != "TEST" and (not cfg["enabled"] or not cfg["password"]):
            self.health = "NOT_CONFIGURED"
            return {"ok": False, "health": self.health, "httpStatus": 503, "message": "SMTP is not configured. Add the Gmail app password on the backend only."}
        settings = self.outbox.settings(cfg["defaultRecipient"])
        payload = {
            "recipient": settings["recipient"],
            "environment": os.environ.get("CACSMS_ENV") or "development",
            "eventEpoch": time.time(),
            "test": True,
        }
        queued = self._queue("NOTIFICATION_TEST", f"TEST|{uuid.uuid4().hex}", payload, None, None, None)
        if not queued:
            return {"ok": False, "httpStatus": 503, "message": "Test notification was not queued"}
        outcome = self.process_one(queued["notificationId"])
        if outcome is None:
            outcome = self.outbox.notification_status(queued["notificationId"])
        accepted = outcome in ("SENT", "RETRYING", "SENDING", "PENDING")
        status = self.public_status()
        status["test"] = outcome
        status["ok"] = accepted
        if outcome == "SENT":
            status["message"] = "Test email accepted by Gmail"
            status["httpStatus"] = 200
        elif accepted:
            status["message"] = "Test email is queued. A temporary SMTP delay will be retried."
            status["httpStatus"] = 202
        else:
            status["message"] = f"Test email {outcome or 'was not sent'}"
            status["httpStatus"] = 503
        return status

    def _queue(self, event_type: str, event_key: str, payload: dict[str, Any], candidate_id: Any, symbol: Any, level: Any, campaign_id: Any = None) -> dict[str, Any] | None:
        cfg = self.delivery_config()
        settings = self.outbox.settings(cfg["defaultRecipient"])
        subject, text, html = mail.render(event_type, {**payload, "recipient": settings["recipient"]}, cfg)
        return self.outbox.enqueue({
            "eventKey": event_key,
            "candidateId": candidate_id,
            "campaignId": campaign_id or payload.get("campaignId"),
            "symbol": symbol,
            "titLevel": level,
            "eventType": event_type,
            "category": policy.CATEGORIES.get(event_type, "SYSTEM"),
            "recipient": settings["recipient"],
            "subject": subject,
            "payload": {**payload, "text": text, "html": html},
        })

    def process_one(self, notification_id: str | None = None) -> str | None:
        cfg = self.delivery_config()
        if self.mailer is None and cfg["mode"] != "TEST" and not cfg["password"]:
            self.health = "NOT_CONFIGURED"
            return None
        row = self.outbox.claim(notification_id)
        if not row:
            return None
        try:
            text = (row.get("payload") or {}).get("text") or ""
            html = (row.get("payload") or {}).get("html") or ""
            if not text:
                _subject, text, html = mail.render(row["eventType"], row.get("payload") or {}, cfg)
            message = mail.OutboundEmail(subject=row["subject"], text=text, html=html, recipient=row["recipient"], sender=cfg["fromEmail"])
            self._mailer().send(message)
        except mail.PermanentDeliveryError as exc:
            self.health = "AUTH_FAILED" if exc.auth else "DEGRADED"
            self.last_error = str(exc)
            self.outbox.mark(row["notificationId"], "DEAD_LETTER", str(exc))
            return "DEAD_LETTER"
        except mail.TemporaryDeliveryError as exc:
            return self._retry(row, str(exc))
        except Exception as exc:
            return self._retry(row, type(exc).__name__)
        self.health = "READY"
        self.last_error = None
        self.last_success = store._now()
        self.outbox.mark(row["notificationId"], "SENT")
        return "SENT"

    def _retry(self, row: dict[str, Any], error: str) -> str:
        attempt = int(row.get("attemptCount") or 0) + 1
        self.last_error = error
        self.health = "DEGRADED"
        if attempt >= MAX_ATTEMPTS:
            self.outbox.mark(row["notificationId"], "DEAD_LETTER", error)
            return "DEAD_LETTER"
        self.outbox.mark(row["notificationId"], "RETRYING", error, BACKOFF_S[min(attempt - 1, len(BACKOFF_S) - 1)])
        return "RETRYING"

    def history(self, status: str | None = None, candidate_id: str | None = None, limit: int = 40) -> list[dict[str, Any]]:
        wanted = (status or "").upper()
        if wanted == "PENDING":
            rows = self.outbox.history(None, candidate_id, max(limit * 4, limit))
            rows = [row for row in rows if row.get("status") in ("PENDING", "RETRYING", "SENDING")]
        elif wanted == "FAILED":
            rows = self.outbox.history(None, candidate_id, max(limit * 4, limit))
            rows = [row for row in rows if row.get("status") in ("FAILED", "DEAD_LETTER")]
        else:
            rows = self.outbox.history(None if wanted in ("", "ALL") else wanted, candidate_id, limit)
        public = []
        for row in rows[:limit]:
            public.append({
                "notificationId": row.get("notificationId"),
                "eventKey": row.get("eventKey"),
                "candidateId": row.get("candidateId"),
                "campaignId": row.get("campaignId"),
                "symbol": row.get("symbol"),
                "titLevel": row.get("titLevel"),
                "eventType": row.get("eventType"),
                "category": row.get("category"),
                "recipient": row.get("recipient"),
                "subject": row.get("subject"),
                "status": row.get("status"),
                "attemptCount": row.get("attemptCount"),
                "lastError": row.get("lastError"),
                "createdAt": row.get("createdAt"),
                "sentAt": row.get("sentAt"),
            })
        return public


def _label(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("label") or value.get("state") or value.get("kind") or "—")
    return "—" if value in (None, "") else str(value)


def _market_payload(event: dict[str, Any], candidate: dict[str, Any], freshness: str) -> dict[str, Any]:
    breakout = candidate.get("breakout") or {}
    channel = candidate.get("channel") or {}
    parent = candidate.get("parent") or {}
    retest = candidate.get("retest") or {}
    structure = candidate.get("structure") or {}
    zone = None
    if retest.get("zoneLow") is not None and retest.get("zoneHigh") is not None:
        zone = f"{retest.get('zoneLow')} – {retest.get('zoneHigh')}"
    epoch = event.get("ts")
    if isinstance(epoch, (int, float)) and epoch > 10_000_000_000:
        epoch = float(epoch) / 1000
    return {
        "symbol": candidate.get("symbol") or event.get("symbol"),
        "titLevel": candidate.get("titLevel"),
        "opportunityFamily": candidate.get("opportunityFamily"),
        "parent": f"{parent.get('timeframe') or ''} {parent.get('direction') or ''}".strip(),
        "child": f"{channel.get('timeframe') or event.get('tf') or ''} {channel.get('direction') or ''}".strip(),
        "channelRole": candidate.get("channelRole"),
        "timeframe": channel.get("timeframe") or event.get("tf"),
        "boundary": breakout.get("relevantBoundary"),
        "breakDirection": breakout.get("expectedDirection"),
        "direction": breakout.get("expectedDirection"),
        "boundaryPrice": breakout.get("boundaryPrice"),
        "breakPrice": breakout.get("breakPrice"),
        "currentPrice": breakout.get("currentPrice") or event.get("price"),
        "breakCandle": breakout.get("confirmedAt") or breakout.get("detectedAt"),
        "confidence": channel.get("confidence"),
        "quality": breakout.get("quality"),
        "bos": _label(structure.get("bos")),
        "choch": _label(structure.get("choch")),
        "retest": retest.get("state") or "PENDING",
        "retestZone": zone,
        "retestConfirmedAt": retest.get("confirmedAt"),
        "p1": (candidate.get("p1") or {}).get("state"),
        "p2": (candidate.get("p2") or {}).get("state"),
        "stage8": "NOT YET AUTHORIZED",
        "freshness": freshness,
        "eventEpoch": epoch or time.time(),
    }


SERVICE = NotificationService()
