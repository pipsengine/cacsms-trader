"""Persistent notification settings and outbox. The SMTP app password is write-only and is never returned to the API."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from typing import Any

try:
    from db import ROOT, connect
    import notification_policy as policy
except ImportError:  # pragma: no cover
    from bridge.mt5.db import ROOT, connect  # type: ignore
    from bridge.mt5 import notification_policy as policy  # type: ignore

_schema_ready = False


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "017_notifications.sql").read_text(encoding="utf-8")
    with connect() as conn:
        cur = conn.cursor()
        for batch in (part.strip() for part in sql.split("\nGO") if part.strip()):
            cur.execute(batch)
        cols = {row[1] for row in conn.raw.execute("PRAGMA table_info(app_notification_settings)")}
        for name, kind in (
            ("smtp_host", "TEXT"),
            ("smtp_port", "INTEGER"),
            ("smtp_secure", "INTEGER"),
            ("smtp_user", "TEXT"),
            ("smtp_from_email", "TEXT"),
            ("smtp_from_name", "TEXT"),
            ("smtp_app_password", "TEXT"),
        ):
            if name not in cols:
                conn.raw.execute(f"ALTER TABLE app_notification_settings ADD COLUMN {name} {kind}")
        conn.commit()
    _schema_ready = True


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def default_settings(recipient: str) -> dict[str, Any]:
    return {
        "masterEnabled": True,
        "fxEnabled": True,
        "xauEnabled": True,
        "recipient": recipient,
        "policies": dict(policy.DEFAULT_POLICIES),
        "updatedAt": _now(),
    }


def _row_settings(recipient: str, master: int, fx: int, xau: int, raw: str, updated: str) -> dict[str, Any]:
    try:
        policies = json.loads(raw) if raw else {}
    except Exception:
        policies = {}
    merged = dict(policy.DEFAULT_POLICIES)
    merged.update({k: bool(v) for k, v in policies.items() if k in policy.DEFAULT_POLICIES})
    return {
        "masterEnabled": bool(master),
        "fxEnabled": bool(fx),
        "xauEnabled": bool(xau),
        "recipient": recipient,
        "policies": merged,
        "updatedAt": updated,
    }


class SqliteOutbox:
    def ensure(self) -> None:
        ensure_schema()

    def settings(self, recipient: str) -> dict[str, Any]:
        self.ensure()
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("SELECT recipient, master_enabled, fx_enabled, xau_enabled, policies_json, updated_at FROM dbo.app_notification_settings WHERE id=1")
            row = cur.fetchone()
        if not row:
            return default_settings(recipient)
        return _row_settings(row[0], row[1], row[2], row[3], row[4], row[5])

    def save_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        self.ensure()
        recipient = str(settings.get("recipient") or "").strip()
        if not policy.valid_email(recipient):
            raise ValueError("Recipient is not a valid email address")
        policies = dict(policy.DEFAULT_POLICIES)
        incoming = settings.get("policies") or {}
        for key in policies:
            if key in incoming:
                policies[key] = bool(incoming[key])
        saved = {
            "masterEnabled": bool(settings.get("masterEnabled", True)),
            "fxEnabled": bool(settings.get("fxEnabled", True)),
            "xauEnabled": bool(settings.get("xauEnabled", True)),
            "recipient": recipient,
            "policies": policies,
            "updatedAt": _now(),
        }
        payload = json.dumps(policies)
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM dbo.app_notification_settings WHERE id=1")
            if cur.fetchone():
                cur.execute(
                    "UPDATE dbo.app_notification_settings SET master_enabled=?, fx_enabled=?, xau_enabled=?, recipient=?, policies_json=?, updated_at=? WHERE id=1",
                    int(saved["masterEnabled"]), int(saved["fxEnabled"]), int(saved["xauEnabled"]), recipient, payload, saved["updatedAt"],
                )
            else:
                cur.execute(
                    "INSERT INTO dbo.app_notification_settings (id, master_enabled, fx_enabled, xau_enabled, recipient, policies_json, updated_at) VALUES (1,?,?,?,?,?,?)",
                    int(saved["masterEnabled"]), int(saved["fxEnabled"]), int(saved["xauEnabled"]), recipient, payload, saved["updatedAt"],
                )
            conn.commit()
        return saved

    def smtp_account(self) -> dict[str, Any]:
        """Backend-only. Callers that answer the browser must not pass this password through."""
        self.ensure()
        with connect() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT smtp_host, smtp_port, smtp_secure, smtp_user, smtp_from_email, smtp_from_name, smtp_app_password "
                "FROM dbo.app_notification_settings WHERE id=1"
            )
            row = cur.fetchone()
        if not row:
            return {"host": "", "port": None, "secure": False, "user": "", "fromEmail": "", "fromName": "", "password": ""}
        return {
            "host": row[0] or "",
            "port": int(row[1]) if row[1] else None,
            "secure": bool(row[2]),
            "user": row[3] or "",
            "fromEmail": row[4] or "",
            "fromName": row[5] or "",
            "password": row[6] or "",
        }

    def save_smtp(self, account: dict[str, Any]) -> None:
        self.ensure()
        current = self.smtp_account()
        user = str(account.get("user") or "").strip()
        from_email = str(account.get("fromEmail") or "").strip()
        if user and not policy.valid_email(user):
            raise ValueError("SMTP user is not a valid email address")
        if from_email and not policy.valid_email(from_email):
            raise ValueError("From email is not a valid email address")
        port = account.get("port") or current["port"] or 587
        try:
            port = int(port)
        except (TypeError, ValueError):
            raise ValueError("SMTP port must be a number")
        if port < 1 or port > 65535:
            raise ValueError("SMTP port must be a number")
        password = str(account.get("password") or "")
        saved_password = password if password else (current["password"] or "")
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM dbo.app_notification_settings WHERE id=1")
            if not cur.fetchone():
                raise ValueError("Save the notification recipient before the SMTP account")
            cur.execute(
                "UPDATE dbo.app_notification_settings SET smtp_host=?, smtp_port=?, smtp_secure=?, smtp_user=?, smtp_from_email=?, smtp_from_name=?, smtp_app_password=?, updated_at=? WHERE id=1",
                str(account.get("host") or "").strip(), port, int(bool(account.get("secure"))), user, from_email,
                str(account.get("fromName") or "").strip(), saved_password, _now(),
            )
            conn.commit()

    def enqueue(self, row: dict[str, Any]) -> dict[str, Any] | None:
        self.ensure()
        notification_id = row.get("notificationId") or uuid.uuid4().hex[:16]
        try:
            with connect() as conn:
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO dbo.app_notification_outbox (notification_id, event_key, candidate_id, campaign_id, symbol, tit_level, "
                    "event_type, category, recipient, subject, payload_json, status, attempt_count, created_at, next_attempt_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)",
                    notification_id, row["eventKey"], row.get("candidateId"), row.get("campaignId"), row.get("symbol"),
                    row.get("titLevel"), row["eventType"], row["category"], row["recipient"], row["subject"],
                    json.dumps(row.get("payload") or {}), "PENDING", _now(), _now(),
                )
                conn.commit()
        except sqlite3.IntegrityError:
            return None
        stored = dict(row)
        stored["notificationId"] = notification_id
        stored["status"] = "PENDING"
        stored["attemptCount"] = 0
        return stored

    def claim(self, notification_id: str | None = None) -> dict[str, Any] | None:
        self.ensure()
        now = _now()
        with connect() as conn:
            conn.raw.execute("BEGIN IMMEDIATE")
            cur = conn.cursor()
            sql = (
                "SELECT id, notification_id, event_key, candidate_id, campaign_id, symbol, tit_level, event_type, category, recipient, subject, payload_json, status, attempt_count "
                "FROM dbo.app_notification_outbox WHERE status IN ('PENDING','RETRYING') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)"
            )
            params: list[Any] = [now]
            if notification_id:
                sql += " AND notification_id=?"
                params.append(notification_id)
            sql += " ORDER BY id LIMIT 1"
            cur.execute(sql, *params)
            found = cur.fetchone()
            if not found:
                return None
            cur.execute(
                "UPDATE dbo.app_notification_outbox SET status='SENDING', last_attempt_at=? WHERE id=? AND status IN ('PENDING','RETRYING')",
                now, found[0],
            )
            if cur.rowcount != 1:
                return None
            conn.commit()
        return _out_row(found)

    def notification_status(self, notification_id: str) -> str | None:
        self.ensure()
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("SELECT status FROM dbo.app_notification_outbox WHERE notification_id=?", notification_id)
            row = cur.fetchone()
        return row[0] if row else None

    def mark(self, notification_id: str, status: str, error: str | None = None, delay_s: int = 0) -> None:
        self.ensure()
        now = _now()
        nxt = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + delay_s)) if delay_s else now
        with connect() as conn:
            cur = conn.cursor()
            if status == "SENT":
                cur.execute(
                    "UPDATE dbo.app_notification_outbox SET status='SENT', sent_at=?, last_error=NULL, attempt_count=attempt_count+1 WHERE notification_id=?",
                    now, notification_id,
                )
            else:
                cur.execute(
                    "UPDATE dbo.app_notification_outbox SET status=?, last_error=?, last_attempt_at=?, next_attempt_at=?, attempt_count=attempt_count+1 WHERE notification_id=?",
                    status, (error or "")[:400], now, nxt, notification_id,
                )
            conn.commit()

    def recover(self) -> int:
        """A restart cannot know whether a SENDING row reached Gmail. It becomes RETRYING, never a second SENT."""
        self.ensure()
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE dbo.app_notification_outbox SET status='RETRYING', last_error=? WHERE status='SENDING'", "Recovered after restart")
            count = cur.rowcount or 0
            conn.commit()
            return int(count)

    def history(self, status: str | None = None, candidate_id: str | None = None, limit: int = 40) -> list[dict[str, Any]]:
        self.ensure()
        sql = (
            "SELECT notification_id, event_key, candidate_id, campaign_id, symbol, tit_level, event_type, category, recipient, subject, status, "
            "attempt_count, last_error, created_at, sent_at FROM dbo.app_notification_outbox WHERE 1=1"
        )
        params: list[Any] = []
        if status and status.upper() != "ALL":
            sql += " AND status=?"
            params.append(status.upper())
        if candidate_id:
            sql += " AND candidate_id=?"
            params.append(candidate_id)
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(int(limit))
        with connect() as conn:
            cur = conn.cursor()
            cur.execute(sql, *params)
            rows = cur.fetchall()
        return [
            {
                "notificationId": r[0], "eventKey": r[1], "candidateId": r[2], "campaignId": r[3], "symbol": r[4],
                "titLevel": r[5], "eventType": r[6], "category": r[7], "recipient": r[8], "subject": r[9],
                "status": r[10], "attemptCount": r[11], "lastError": r[12], "createdAt": r[13], "sentAt": r[14],
            }
            for r in rows
        ]

    def counts(self) -> dict[str, int]:
        self.ensure()
        today = time.strftime("%Y-%m-%d", time.gmtime())
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("SELECT status, COUNT(1) FROM dbo.app_notification_outbox GROUP BY status")
            grouped = {row[0]: int(row[1]) for row in cur.fetchall()}
            cur.execute("SELECT COUNT(1) FROM dbo.app_notification_outbox WHERE status='SENT' AND sent_at >= ?", today)
            sent_today = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(1) FROM dbo.app_notification_outbox WHERE status IN ('FAILED','DEAD_LETTER') AND created_at >= ?", today)
            failed_today = int(cur.fetchone()[0])
        pending = grouped.get("PENDING", 0) + grouped.get("RETRYING", 0) + grouped.get("SENDING", 0)
        return {
            "pending": pending,
            "sent": grouped.get("SENT", 0),
            "failed": grouped.get("FAILED", 0) + grouped.get("DEAD_LETTER", 0),
            "deadLetter": grouped.get("DEAD_LETTER", 0),
            "sentToday": sent_today,
            "failedToday": failed_today,
        }


def _out_row(found: tuple) -> dict[str, Any]:
    try:
        payload = json.loads(found[11]) if found[11] else {}
    except Exception:
        payload = {}
    return {
        "id": found[0], "notificationId": found[1], "eventKey": found[2], "candidateId": found[3], "campaignId": found[4],
        "symbol": found[5], "titLevel": found[6], "eventType": found[7], "category": found[8], "recipient": found[9],
        "subject": found[10], "payload": payload, "status": "SENDING", "attemptCount": found[13],
    }
