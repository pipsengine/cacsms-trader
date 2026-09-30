# PipsEngine email notifications

The trading engines decide what happened. The notification worker only delivers email. A Gmail failure does not stop market data, the channel scanner, Stage 8, or Stage 9.

## Google account

1. Sign in to `pipsengine@gmail.com`.
2. Enable Google 2-Step Verification if it is not already enabled.
3. Where Google offers App Passwords for this account, create one named `PipsEngine Trading System`.
4. Copy that App Password into the backend environment only:

```
SMTP_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=pipsengine@gmail.com
SMTP_APP_PASSWORD=<the app password>
SMTP_FROM_EMAIL=pipsengine@gmail.com
SMTP_FROM_NAME=PipsEngine Trading System
TRADING_ALERT_EMAIL=pipsengine@gmail.com
```

5. Keep it in the backend `.env` or save it from System Control → Email Notifications → SMTP account. The saved app password stays in the local database and is not returned to the browser. Do not commit `.env`. `.env.example` keeps `SMTP_APP_PASSWORD` empty.
6. Do not use the normal Gmail password. If this Google account cannot create an App Password, stop. Do not store the account password as a substitute.
7. Restart the MT5 bridge.
8. Open System Control and confirm SMTP status.
9. Use Send test email once.
10. Confirm the message arrives at `pipsengine@gmail.com`.

Automated tests use `TestEmailAdapter` and never send through Gmail. Set `EMAIL_DELIVERY_MODE=TEST` for a local bridge that should queue mail without contacting Google.
