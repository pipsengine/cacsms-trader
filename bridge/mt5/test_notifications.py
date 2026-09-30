"""Notification policy, outbox, and delivery. These tests never open a network connection."""

from __future__ import annotations

import json
import smtplib
import threading
import unittest
from unittest.mock import patch

import notification_mail as mail
import notification_policy as policy
import notification_service as notes
import risk


def service() -> notes.NotificationService:
    return notes.NotificationService(mail.TestEmailAdapter(), notes.MemoryOutbox())


def candidate(symbol="XAUUSD", level="L4", timeframe="M15", candidate_id="XAUUSD-L4-M15-ABC123", freshness="CURRENT"):
    return {
        "candidateId": candidate_id,
        "symbol": symbol,
        "titLevel": level,
        "opportunityFamily": "TIT_CORRECTION_END",
        "channelRole": "CORRECTIVE CHILD",
        "parent": {"timeframe": "H1", "direction": "BULLISH"},
        "channel": {"timeframe": timeframe, "direction": "BEARISH", "confidence": 82, "role": "CORRECTIVE CHILD"},
        "breakout": {
            "relevantBoundary": "UPPER",
            "expectedDirection": "BULLISH",
            "boundaryPrice": 2650.1,
            "breakPrice": 2651.4,
            "currentPrice": 2652.0,
            "confirmedAt": 1_700_000_000_000,
            "quality": 0.8,
            "state": "BREAK_CONFIRMED",
        },
        "retest": {"state": "PENDING", "zoneLow": 2649.0, "zoneHigh": 2651.0},
        "structure": {"bos": {"label": "NONE"}, "choch": {"label": "NONE"}},
        "p1": {"state": "WATCHING"},
        "p2": {"state": "WATCHING"},
        "freshness": {"state": freshness},
    }


def event(event_type, candidate_id="XAUUSD-L4-M15-ABC123", ts=1_700_000_003_000, symbol="XAUUSD"):
    return {"type": event_type, "candidateId": candidate_id, "symbol": symbol, "ts": ts, "price": 2652.0, "tf": "M15"}


def hypothesis(symbol="XAUUSD", level="L4", p1="WATCHING", p2="WATCHING", data="CURRENT"):
    return {
        "instruments": [{
            "symbol": symbol,
            "hypotheses": [{
                "instrument": symbol,
                "TiTLevel": level,
                "direction": "BULLISH",
                "opportunityFamily": "TIT_CORRECTION_END",
                "status": "WATCHING",
                "childTimeframe": "M15",
                "campaignId": f"{symbol}-{level}",
                "dataStatus": data,
                "p1": {"state": p1, "riskPct": 0.5, "reason": "reaction"},
                "p2": {"state": p2, "riskPct": 0.5, "reason": "break"},
            }],
        }],
    }


class NotificationTests(unittest.TestCase):
    def test_production_risk_limits_are_unchanged(self):
        self.assertEqual(risk.CONFIG["maxConcurrentPositions"], 3)
        self.assertEqual(risk.CONFIG["xauReservePct"], 0)

    def test_smtp_defaults_and_missing_configuration(self):
        with patch.dict("os.environ", {}, clear=False):
            import os
            os.environ.pop("SMTP_APP_PASSWORD", None)
            os.environ["SMTP_ENABLED"] = "true"
            os.environ["EMAIL_DELIVERY_MODE"] = "GMAIL"
            cfg = mail.smtp_config()
        self.assertEqual((cfg["host"], cfg["port"], cfg["secure"], cfg["user"]), ("smtp.gmail.com", 587, False, "pipsengine@gmail.com"))
        self.assertEqual(cfg["password"], "")
        public = mail.public_smtp(cfg)
        self.assertNotIn("password", public)
        self.assertFalse(public["configured"])
        adapter = mail.GmailEmailAdapter({**cfg, "host": "127.0.0.1", "port": 1})
        with self.assertRaises(mail.PermanentDeliveryError):
            adapter.send(mail.OutboundEmail("s", "t", "<p>t</p>", "pipsengine@gmail.com", cfg["fromEmail"]))

    def test_secret_never_returned_by_status(self):
        svc = service()
        with patch.dict("os.environ", {"SMTP_APP_PASSWORD": "secret-value-not-real", "EMAIL_DELIVERY_MODE": "GMAIL"}):
            status = svc.public_status()
        blob = json.dumps(status)
        self.assertNotIn("secret-value-not-real", blob)
        self.assertNotIn("password", blob.lower())
        self.assertNotIn("SMTP_APP_PASSWORD", blob)

    def test_saved_smtp_password_is_write_only(self):
        svc = service()
        secret = "abcdefghijklmnop"
        status = svc.update_settings({
            "recipient": "pipsengine@gmail.com",
            "smtpHost": "smtp.gmail.com",
            "smtpPort": 587,
            "smtpSecure": False,
            "smtpUser": "pipsengine@gmail.com",
            "smtpFromEmail": "pipsengine@gmail.com",
            "smtpFromName": "PipsEngine Trading System",
            "smtpAppPassword": secret,
        })
        blob = json.dumps(status)
        self.assertNotIn(secret, blob)
        self.assertNotIn("smtpAppPassword", blob)
        self.assertNotIn("password", blob.lower())
        self.assertTrue(status["smtp"]["configured"])
        self.assertEqual(svc.delivery_config()["password"], secret)
        kept = svc.update_settings({"recipient": "pipsengine@gmail.com", "smtpHost": "smtp.gmail.com", "smtpAppPassword": ""})
        self.assertNotIn(secret, json.dumps(kept))
        self.assertEqual(svc.delivery_config()["password"], secret)

    def test_test_email_is_not_a_market_event_and_requires_configuration(self):
        blocked = notes.NotificationService(None, notes.MemoryOutbox())
        with patch.dict("os.environ", {"SMTP_APP_PASSWORD": "", "EMAIL_DELIVERY_MODE": "GMAIL", "SMTP_ENABLED": "true"}):
            refused = blocked.send_test()
        self.assertFalse(refused["ok"])
        self.assertEqual(refused["health"], "NOT_CONFIGURED")
        self.assertEqual(blocked.outbox.rows, [])

        retry = service()
        retry.mailer.fail = mail.TemporaryDeliveryError("SMTP connection failed")
        queued = retry.send_test()
        self.assertTrue(queued["ok"])
        self.assertEqual(queued["test"], "RETRYING")
        self.assertEqual(queued["httpStatus"], 202)

        svc = service()
        result = svc.send_test()
        self.assertTrue(result["ok"])
        self.assertEqual(result["test"], "SENT")
        self.assertEqual(result["httpStatus"], 200)
        self.assertEqual(len(svc.mailer.sent), 1)
        self.assertEqual(svc.mailer.sent[0].subject, "PipsEngine — Email Notification Test")
        self.assertIn("TEST", svc.mailer.sent[0].text)
        self.assertNotIn("CHANNEL BREAK CONFIRMED", svc.mailer.sent[0].text)
        self.assertEqual(svc.outbox.rows[0]["eventType"], "NOTIFICATION_TEST")
        self.assertIsNone(svc.outbox.rows[0]["candidateId"])

    def test_break_confirmed_emails_once_and_detected_or_near_do_not(self):
        svc = service()
        row = candidate()
        self.assertIsNone(svc.ingest_market(event("CHANNEL_BREAK_APPROACH"), row))
        self.assertIsNone(svc.ingest_market(event("CHANNEL_BREAK_DETECTED"), row))
        queued = svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED"), row)
        self.assertIsNotNone(queued)
        again = svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED"), row)
        self.assertIsNone(again)
        self.assertEqual(svc.process_one(), "SENT")
        self.assertEqual(len(svc.mailer.sent), 1)
        self.assertEqual(svc.mailer.sent[0].subject, "PipsEngine — XAUUSD M15 Channel Break Confirmed")
        self.assertIn("BULLISH CHANNEL BREAK", svc.mailer.sent[0].html)
        self.assertIn("2651.4", svc.mailer.sent[0].text)
        self.assertIn(mail.DISCLAIMER, svc.mailer.sent[0].text)
        self.assertIn("NOT YET AUTHORIZED", svc.mailer.sent[0].text)
        self.assertNotIn("ORDER FILLED", svc.mailer.sent[0].text)

    def test_retest_held_p1_and_p2_ready_and_authorization(self):
        svc = service()
        row = candidate()
        self.assertIsNotNone(svc.ingest_market(event("CHANNEL_RETEST_HELD", ts=1_700_000_010_000), row))
        svc.observe_hypotheses(hypothesis(p1="WATCHING", p2="WATCHING"))
        svc.observe_hypotheses(hypothesis(p1="P1_READY_FOR_RISK", p2="WATCHING"))
        svc.observe_hypotheses(hypothesis(p1="P1_READY_FOR_RISK", p2="P2_READY_FOR_RISK"))
        self.assertIsNotNone(svc.ingest_authorization("P1", {"id": "auth-1", "symbol": "XAUUSD", "direction": "BULLISH", "titLevel": "L4", "campaignId": "c1", "riskPct": 0.5}))
        self.assertIsNotNone(svc.ingest_authorization("P2", {"id": "auth-2", "symbol": "XAUUSD", "direction": "BULLISH", "titLevel": "L4", "campaignId": "c1", "riskPct": 0.5}))
        kinds = []
        while svc.process_one() == "SENT":
            kinds.append(svc.mailer.sent[-1].subject)
        self.assertIn("PipsEngine — XAUUSD M15 Channel Retest Held", kinds)
        self.assertIn("PipsEngine — XAUUSD L4 P1 Ready for Risk", kinds)
        self.assertIn("PipsEngine — XAUUSD L4 P2 Ready for Risk", kinds)
        self.assertIn("PipsEngine — XAUUSD P1 Authorized", kinds)
        self.assertIn("PipsEngine — XAUUSD P2 Authorized", kinds)
        ready = next(item for item in svc.mailer.sent if "P1 Ready" in item.subject)
        self.assertIn("READY FOR RISK EVALUATION", ready.text)
        self.assertNotIn("TRADE EXECUTED", ready.text)
        auth = next(item for item in svc.mailer.sent if "P2 Authorized" in item.subject)
        self.assertIn("not an order fill", auth.text)

    def test_new_revision_and_distinct_candidates_and_fx(self):
        svc = service()
        row = candidate()
        svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED", ts=1000), row)
        later = candidate()
        later["breakout"] = {**later["breakout"], "confirmedAt": 2000}
        svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED", ts=2000), later)
        other = candidate(level="L3", timeframe="H1", candidate_id="XAUUSD-L3-H1-OTHER")
        svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED", candidate_id="XAUUSD-L3-H1-OTHER", ts=3000), other)
        fx = candidate("EURUSD", "L2", "H1", "EURUSD-L2-H1-FX")
        svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED", "EURUSD-L2-H1-FX", 4000, "EURUSD"), fx)
        sent = 0
        while svc.process_one() == "SENT":
            sent += 1
        self.assertEqual(sent, 4)
        subjects = [item.subject for item in svc.mailer.sent]
        self.assertIn("PipsEngine — EURUSD H1 Channel Break Confirmed", subjects)
        self.assertEqual(len({item.subject for item in svc.mailer.sent if "XAUUSD" in item.subject}), 2)

    def test_master_event_and_scope_switches(self):
        svc = service()
        svc.update_settings({"masterEnabled": False, "recipient": "pipsengine@gmail.com"})
        self.assertIsNone(svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED"), candidate()))
        svc.update_settings({"masterEnabled": True, "recipient": "pipsengine@gmail.com", "policies": {"CHANNEL_BREAK_CONFIRMED": False}})
        self.assertIsNone(svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED", ts=2), candidate()))
        svc.update_settings({"fxEnabled": False, "xauEnabled": True, "recipient": "pipsengine@gmail.com", "policies": {"CHANNEL_BREAK_CONFIRMED": True}})
        self.assertIsNone(svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED", "EURUSD-L2-H1-FX", 3, "EURUSD"), candidate("EURUSD", "L2", "H1", "EURUSD-L2-H1-FX")))
        svc.update_settings({"fxEnabled": True, "xauEnabled": False, "recipient": "pipsengine@gmail.com"})
        self.assertIsNone(svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED", ts=4), candidate()))
        with self.assertRaises(ValueError):
            svc.update_settings({"recipient": "not-an-email"})

    def test_stale_and_watching_do_not_alert(self):
        svc = service()
        self.assertIsNone(svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED"), candidate(freshness="STALE")))
        svc.observe_hypotheses(hypothesis(p1="WATCHING", p2="WATCHING"))
        svc.observe_hypotheses(hypothesis(p1="WATCHING", p2="P2_BREAK_DETECTED"))
        self.assertEqual(svc.outbox.rows, [])
        self.assertIsNone(svc.process_one())

    def test_temporary_retry_exhaustion_and_auth_failure(self):
        svc = service()
        svc.mailer.fail = mail.TemporaryDeliveryError("SMTP connection failed")
        svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED"), candidate())
        outcomes = [svc.process_one() for _ in range(5)]
        self.assertEqual(outcomes[:4], ["RETRYING"] * 4)
        self.assertEqual(outcomes[4], "DEAD_LETTER")
        self.assertEqual(svc.mailer.sent, [])
        self.assertEqual(svc.outbox.rows[0]["status"], "DEAD_LETTER")

        auth = service()
        auth.mailer.fail = mail.PermanentDeliveryError("Gmail rejected the SMTP login", auth=True)
        auth.ingest_market(event("CHANNEL_BREAK_CONFIRMED"), candidate())
        self.assertEqual(auth.process_one(), "DEAD_LETTER")
        self.assertEqual(auth.health, "AUTH_FAILED")
        self.assertEqual(auth.process_one(), None)

    def test_restart_recovery_does_not_duplicate_a_sent_message(self):
        svc = service()
        svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED"), candidate())
        claimed = svc.outbox.claim()
        self.assertEqual(claimed["status"], "SENDING")
        recovered = svc.outbox.recover()
        self.assertEqual(recovered, 1)
        self.assertEqual(svc.outbox.rows[0]["status"], "RETRYING")
        self.assertEqual(svc.process_one(), "SENT")
        self.assertEqual(len(svc.mailer.sent), 1)
        self.assertIsNone(svc.process_one())

    def test_concurrent_claim_delivers_once(self):
        svc = service()
        svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED"), candidate())
        results = []

        def work():
            results.append(svc.process_one())

        threads = [threading.Thread(target=work) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(results.count("SENT"), 1)
        self.assertEqual(len(svc.mailer.sent), 1)

    def test_history_filters_and_html_plaintext(self):
        svc = service()
        svc.ingest_market(event("CHANNEL_BREAK_CONFIRMED"), candidate())
        svc.process_one()
        sent = svc.history("SENT")
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["symbol"], "XAUUSD")
        self.assertEqual(sent[0]["titLevel"], "L4")
        self.assertNotIn("payload", sent[0])
        self.assertEqual(svc.history("FAILED"), [])
        subject, text, html = mail.render("CHANNEL_BREAK_CONFIRMED", {
            "symbol": "XAUUSD", "timeframe": "M15", "titLevel": "L4", "breakDirection": "BEARISH",
            "breakPrice": 2640, "currentPrice": 2638, "stage8": "NOT YET AUTHORIZED", "eventEpoch": 1_700_000_000,
        })
        self.assertIn("XAUUSD", subject)
        self.assertIn("BEARISH", text)
        self.assertIn("2640", text)
        self.assertIn("BEARISH CHANNEL BREAK", html)
        self.assertIn(mail.DISCLAIMER, html)
        self.assertIn("WAT", text)

    def test_gmail_classifies_timeout_and_authentication_without_connecting(self):
        cfg = {
            "host": "127.0.0.1", "port": 1, "secure": False, "user": "pipsengine@gmail.com",
            "password": "not-a-real-password", "fromEmail": "pipsengine@gmail.com", "fromName": "PipsEngine Trading System",
        }
        message = mail.OutboundEmail("s", "plain", "<p>html</p>", "pipsengine@gmail.com", cfg["fromEmail"])

        class TimeoutSMTP:
            def __init__(self, *args, **kwargs):
                pass
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def ehlo(self):
                raise TimeoutError("timed out")
            def starttls(self, **kwargs):
                return None

        with patch.object(smtplib, "SMTP", TimeoutSMTP):
            with self.assertRaises(mail.TemporaryDeliveryError):
                mail.GmailEmailAdapter(cfg).send(message)

        class AuthSMTP(TimeoutSMTP):
            def ehlo(self):
                return None
            def login(self, user, password):
                raise smtplib.SMTPAuthenticationError(535, b"bad")

        with patch.object(smtplib, "SMTP", AuthSMTP):
            with self.assertRaises(mail.PermanentDeliveryError) as caught:
                mail.GmailEmailAdapter(cfg).send(message)
        self.assertTrue(caught.exception.auth)

    def test_policy_defaults(self):
        self.assertTrue(policy.DEFAULT_POLICIES["CHANNEL_BREAK_CONFIRMED"])
        self.assertTrue(policy.DEFAULT_POLICIES["CHANNEL_RETEST_HELD"])
        self.assertFalse(policy.DEFAULT_POLICIES["CHANNEL_BREAK_DETECTED"])
        self.assertFalse(policy.DEFAULT_POLICIES["CHANNEL_BREAK_APPROACH"])
        self.assertFalse(policy.allows("CHANNEL_BREAK_CONFIRMED", "XAUUSD", {"masterEnabled": True, "xauEnabled": True, "fxEnabled": True, "policies": policy.DEFAULT_POLICIES}, "STALE")[0])


if __name__ == "__main__":
    unittest.main()
