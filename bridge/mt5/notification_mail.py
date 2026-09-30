"""Email rendering and delivery. Trading modules never import SMTP details from here indirectly through their own code;
the notification service is the only caller."""

from __future__ import annotations

import os
import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any
from zoneinfo import ZoneInfo

DISCLAIMER = (
    "This notification reports an autonomous market-structure event. "
    "A confirmed channel break does not necessarily mean that a trade has been authorized or executed."
)


class TemporaryDeliveryError(Exception):
    pass


class PermanentDeliveryError(Exception):
    def __init__(self, message: str, auth: bool = False):
        super().__init__(message)
        self.auth = auth


@dataclass
class OutboundEmail:
    subject: str
    text: str
    html: str
    recipient: str
    sender: str


def smtp_config() -> dict[str, Any]:
    """Backend-only. The password is never copied into API payloads or logs."""
    mode = (os.environ.get("EMAIL_DELIVERY_MODE") or "GMAIL").strip().upper()
    return {
        "enabled": (os.environ.get("SMTP_ENABLED") or "true").strip().lower() in ("1", "true", "yes"),
        "host": (os.environ.get("SMTP_HOST") or "smtp.gmail.com").strip(),
        "port": int(os.environ.get("SMTP_PORT") or "587"),
        "secure": (os.environ.get("SMTP_SECURE") or "false").strip().lower() in ("1", "true", "yes"),
        "user": (os.environ.get("SMTP_USER") or "pipsengine@gmail.com").strip(),
        "password": os.environ.get("SMTP_APP_PASSWORD") or "",
        "fromEmail": (os.environ.get("SMTP_FROM_EMAIL") or "pipsengine@gmail.com").strip(),
        "fromName": (os.environ.get("SMTP_FROM_NAME") or "PipsEngine Trading System").strip(),
        "defaultRecipient": (os.environ.get("TRADING_ALERT_EMAIL") or "pipsengine@gmail.com").strip(),
        "mode": mode,
        "timezone": (os.environ.get("NOTIFICATION_TIMEZONE") or "Africa/Lagos").strip(),
    }


def public_smtp(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or smtp_config()
    configured = bool(cfg["enabled"] and cfg["user"] and cfg["password"] and cfg["fromEmail"])
    return {
        "enabled": bool(cfg["enabled"]),
        "host": cfg["host"],
        "port": cfg["port"],
        "secure": bool(cfg["secure"]),
        "user": cfg["user"],
        "fromEmail": cfg["fromEmail"],
        "fromName": cfg["fromName"],
        "configured": configured,
        "deliveryMode": "TEST" if cfg["mode"] == "TEST" else "GMAIL",
    }


def display_times(epoch_s: float | None, tz_name: str) -> tuple[str, str]:
    moment = datetime.fromtimestamp(epoch_s or datetime.now(timezone.utc).timestamp(), tz=timezone.utc)
    utc = moment.strftime("%Y-%m-%d %H:%M:%S UTC")
    try:
        local = moment.astimezone(ZoneInfo(tz_name))
        label = "WAT" if tz_name == "Africa/Lagos" else tz_name
        local_text = local.strftime(f"%Y-%m-%d %H:%M:%S {label}")
    except Exception:
        local_text = utc
    return utc, local_text


def _rows(pairs: list[tuple[str, Any]]) -> str:
    body = []
    for label, value in pairs:
        shown = "—" if value is None or value == "" else value
        body.append(f"{label}: {shown}")
    return "\n".join(body)


def _html_rows(pairs: list[tuple[str, Any]]) -> str:
    cells = []
    for label, value in pairs:
        shown = "—" if value is None or value == "" else value
        cells.append(
            "<tr>"
            f"<td style=\"padding:6px 10px;color:#5c6b7a;font-size:13px;width:42%\">{label}</td>"
            f"<td style=\"padding:6px 10px;color:#102033;font-size:13px;font-weight:600\">{shown}</td>"
            "</tr>"
        )
    return "".join(cells)


def _direction_banner(direction: str | None) -> tuple[str, str]:
    text = (direction or "UNSET").upper()
    if text == "BULLISH":
        return text + " CHANNEL BREAK", "#1f7a4d"
    if text == "BEARISH":
        return text + " CHANNEL BREAK", "#9b2c2c"
    return text, "#8a5a00"


def render(event_type: str, payload: dict[str, Any], cfg: dict[str, Any] | None = None) -> tuple[str, str, str]:
    """Subject, plain text, HTML. Critical facts are in the text part, not only in color."""
    cfg = cfg or smtp_config()
    symbol = payload.get("symbol") or "Market"
    tf = payload.get("timeframe") or payload.get("channelTimeframe") or ""
    level = payload.get("titLevel") or ""
    utc, local = display_times(payload.get("eventEpoch"), cfg["timezone"])
    direction = payload.get("breakDirection") or payload.get("direction")

    titles = {
        "CHANNEL_BREAK_CONFIRMED": "Channel Break Confirmed",
        "CHANNEL_BREAK_DETECTED": "Break Detected — Awaiting Confirmation",
        "CHANNEL_BREAK_APPROACH": "Near Breakout",
        "CHANNEL_BREAK_FAILED": "Break Failed",
        "CHANNEL_RETEST_STARTED": "Channel Retest Started",
        "CHANNEL_RETEST_HELD": "Channel Retest Held",
        "CHANNEL_RETEST_FAILED": "Channel Retest Failed",
        "CHANNEL_BREAK_CONTINUATION": "Channel Break Continuation",
        "P1_READY_FOR_RISK": "P1 Ready for Risk",
        "P2_READY_FOR_RISK": "P2 Ready for Risk",
        "P1_AUTHORIZED": "P1 Authorized",
        "P2_AUTHORIZED": "P2 Authorized",
        "ORDER_FILLED": "Order Filled",
        "ORDER_REJECTED": "Order Rejected",
        "POSITION_CLOSED": "Position Closed",
        "NOTIFICATION_TEST": "Email Notification Test",
    }
    title = titles.get(event_type, event_type.replace("_", " ").title())
    if event_type == "NOTIFICATION_TEST":
        subject = "PipsEngine — Email Notification Test"
    elif event_type in ("P1_READY_FOR_RISK", "P2_READY_FOR_RISK"):
        subject = f"PipsEngine — {symbol} {level} {title}".replace("  ", " ").strip()
    elif event_type in ("P1_AUTHORIZED", "P2_AUTHORIZED"):
        leg = "P1" if event_type.startswith("P1") else "P2"
        subject = f"PipsEngine — {symbol} {leg} Authorized"
    elif event_type == "CHANNEL_BREAK_FAILED":
        subject = f"PipsEngine — {symbol} {tf} Break Failed".replace("  ", " ").strip()
    else:
        subject = f"PipsEngine — {symbol} {tf} {title}".replace("  ", " ").strip()

    if event_type == "NOTIFICATION_TEST":
        pairs = [
            ("Notice", "TEST. This is not a market event."),
            ("Message", "PipsEngine email notifications are configured successfully."),
            ("Sender", f"{cfg['fromName']} <{cfg['fromEmail']}>"),
            ("Recipient", payload.get("recipient") or cfg["defaultRecipient"]),
            ("SMTP", "Gmail" if cfg["mode"] != "TEST" else "Test adapter"),
            ("Timestamp", local),
            ("Environment", payload.get("environment") or "development"),
        ]
        banner, color = "TEST", "#1d4e89"
    elif event_type == "CHANNEL_RETEST_HELD":
        pairs = [
            ("Status", "RETEST HELD"),
            ("Instrument", symbol),
            ("TiT Level", level),
            ("Parent", payload.get("parent")),
            ("Child", payload.get("child")),
            ("Channel", f"{tf} {payload.get('channelRole') or ''}".strip()),
            ("Break Direction", direction),
            ("Original Break Price", payload.get("breakPrice")),
            ("Retest Zone", payload.get("retestZone")),
            ("Retest Price", payload.get("currentPrice")),
            ("Retest Confirmation", payload.get("retestConfirmedAt") or local),
            ("BOS", payload.get("bos")),
            ("CHoCH", payload.get("choch")),
            ("P1", payload.get("p1")),
            ("P2", payload.get("p2")),
            ("Stage 8", payload.get("stage8")),
            ("Data Freshness", payload.get("freshness")),
        ]
        banner, color = "RETEST HELD", "#8a5a00"
    elif event_type in ("P1_READY_FOR_RISK", "P2_READY_FOR_RISK"):
        pairs = [
            ("Status", "READY FOR RISK EVALUATION"),
            ("Instrument", symbol),
            ("Direction", direction),
            ("TiT Level", level),
            ("Opportunity Family", payload.get("opportunityFamily")),
            ("Break Level", payload.get("breakPrice") or payload.get("boundaryPrice")),
            ("Channel Break", payload.get("channelBreak")),
            ("Structural Break", payload.get("structuralBreak")),
            ("Channel Retest", payload.get("retest")),
            ("BOS", payload.get("bos")),
            ("CHoCH", payload.get("choch")),
            ("Entry Plan", payload.get("entryPlan")),
            ("Invalidation", payload.get("invalidation")),
            ("Target", payload.get("target")),
            ("Campaign ID", payload.get("campaignId")),
            ("Requested Risk", payload.get("requestedRisk")),
            ("Stage 8", payload.get("stage8")),
        ]
        banner, color = "READY FOR RISK EVALUATION", "#1d4e89"
    elif event_type in ("P1_AUTHORIZED", "P2_AUTHORIZED"):
        pairs = [
            ("Status", "AUTHORIZED — not an order fill"),
            ("Campaign ID", payload.get("campaignId")),
            ("Leg", payload.get("leg")),
            ("Instrument", symbol),
            ("Direction", direction),
            ("Authorized Risk", payload.get("requestedRisk")),
            ("Entry Plan", payload.get("entryPlan")),
            ("Stop / Invalidation", payload.get("invalidation")),
            ("Target", payload.get("target")),
            ("Authorization Time", local),
        ]
        banner, color = "AUTHORIZED", "#1f7a4d"
    elif event_type in ("ORDER_FILLED", "ORDER_PARTIALLY_FILLED"):
        pairs = [
            ("Status", "ORDER FILLED" if event_type == "ORDER_FILLED" else "ORDER PARTIALLY FILLED"),
            ("Broker ticket", payload.get("ticket")),
            ("Campaign", payload.get("campaignId")),
            ("Leg", payload.get("leg")),
            ("Instrument", symbol),
            ("Direction", direction),
            ("Volume", payload.get("volume")),
            ("Fill price", payload.get("fillPrice")),
            ("Stop", payload.get("stop")),
            ("Take profit", payload.get("target")),
            ("Slippage", payload.get("slippage")),
            ("Fill time", payload.get("fillTime") or local),
        ]
        banner, color = "ORDER FILLED", "#1f7a4d"
    elif event_type == "POSITION_CLOSED":
        pairs = [
            ("Status", "POSITION CLOSED"),
            ("Campaign", payload.get("campaignId")),
            ("Leg", payload.get("leg")),
            ("Instrument", symbol),
            ("Entry", payload.get("entry")),
            ("Exit", payload.get("exit")),
            ("Reason", payload.get("reason")),
            ("P/L", payload.get("pnl")),
            ("R multiple", payload.get("rMultiple")),
            ("Holding", payload.get("holding")),
        ]
        banner, color = "POSITION CLOSED", "#1d4e89"
    else:
        banner, color = _direction_banner(direction if event_type == "CHANNEL_BREAK_CONFIRMED" else None)
        if event_type != "CHANNEL_BREAK_CONFIRMED":
            banner, color = title.upper(), "#1d4e89"
        pairs = [
            ("Instrument", symbol),
            ("TiT Level", level),
            ("Opportunity Family", payload.get("opportunityFamily")),
            ("Parent", payload.get("parent")),
            ("Child", payload.get("child")),
            ("Channel Role", payload.get("channelRole")),
            ("Channel Timeframe", tf),
            ("Relevant Boundary", payload.get("boundary")),
            ("Break Direction", direction),
            ("Boundary Price", payload.get("boundaryPrice")),
            ("Break Price", payload.get("breakPrice")),
            ("Current Price", payload.get("currentPrice")),
            ("Break Candle", payload.get("breakCandle")),
            ("Channel Confidence", payload.get("confidence")),
            ("Break Quality", payload.get("quality")),
            ("BOS", payload.get("bos")),
            ("CHoCH", payload.get("choch")),
            ("Retest", payload.get("retest")),
            ("P1", payload.get("p1")),
            ("P2", payload.get("p2")),
            ("Stage 8", payload.get("stage8") or "NOT YET AUTHORIZED"),
            ("Data Freshness", payload.get("freshness")),
            ("Event Time UTC", utc),
            ("Event Time Local", local),
        ]

    text = "PIPSENGINE\nAUTONOMOUS MARKET ALERT\n\n" + title.upper() + "\n\n" + _rows(pairs) + "\n\n" + DISCLAIMER
    html = (
        "<div style=\"margin:0;padding:16px;background:#f4f7fb;font-family:Segoe UI,Arial,sans-serif\">"
        "<div style=\"max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d5dee8;border-radius:8px;overflow:hidden\">"
        "<div style=\"background:#0c1c2e;color:#e8f2fb;padding:16px 18px\">"
        "<div style=\"font-size:13px;letter-spacing:.14em\">PIPSENGINE</div>"
        "<div style=\"font-size:12px;color:#9fb4c9;margin-top:4px\">Autonomous Trading Intelligence</div>"
        "</div>"
        f"<div style=\"padding:14px 18px;background:{color};color:#ffffff;font-weight:700\">{banner}</div>"
        "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse\">"
        + _html_rows(pairs) +
        "</table>"
        f"<p style=\"margin:0;padding:14px 18px;color:#5c6b7a;font-size:12px;line-height:1.45\">{DISCLAIMER}</p>"
        "</div></div>"
    )
    return subject, text, html


class TestEmailAdapter:
    """Records messages. It never opens a network connection."""

    def __init__(self) -> None:
        self.sent: list[OutboundEmail] = []
        self.fail: Exception | None = None

    def send(self, message: OutboundEmail) -> dict[str, Any]:
        if self.fail:
            raise self.fail
        self.sent.append(message)
        return {"ok": True, "adapter": "TEST"}


class GmailEmailAdapter:
    def __init__(self, cfg: dict[str, Any] | None = None):
        self.cfg = cfg or smtp_config()

    def send(self, message: OutboundEmail) -> dict[str, Any]:
        cfg = self.cfg
        if not cfg.get("password"):
            raise PermanentDeliveryError("SMTP app password is not configured")
        email = EmailMessage()
        email["Subject"] = message.subject
        email["From"] = f"{cfg['fromName']} <{cfg['fromEmail']}>"
        email["To"] = message.recipient
        email.set_content(message.text)
        email.add_alternative(message.html, subtype="html")
        try:
            if cfg.get("secure"):
                with smtplib.SMTP_SSL(cfg["host"], int(cfg["port"]), timeout=20, context=ssl.create_default_context()) as smtp:
                    smtp.login(cfg["user"], cfg["password"])
                    smtp.send_message(email)
            else:
                with smtplib.SMTP(cfg["host"], int(cfg["port"]), timeout=20) as smtp:
                    smtp.ehlo()
                    smtp.starttls(context=ssl.create_default_context())
                    smtp.ehlo()
                    smtp.login(cfg["user"], cfg["password"])
                    smtp.send_message(email)
        except smtplib.SMTPAuthenticationError as exc:
            raise PermanentDeliveryError("Gmail rejected the SMTP login", auth=True) from exc
        except smtplib.SMTPRecipientsRefused as exc:
            raise PermanentDeliveryError("Recipient was rejected") from exc
        except (TimeoutError, ConnectionError, OSError, smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError) as exc:
            raise TemporaryDeliveryError("SMTP connection failed") from exc
        except smtplib.SMTPException as exc:
            code = getattr(exc, "smtp_code", 0) or 0
            if isinstance(code, int) and 400 <= code < 500:
                raise TemporaryDeliveryError("SMTP temporarily unavailable") from exc
            raise PermanentDeliveryError("SMTP rejected the message") from exc
        return {"ok": True, "adapter": "GMAIL"}
