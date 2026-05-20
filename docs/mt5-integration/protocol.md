# MT5 Bridge Protocol

The MT5 bridge uses command envelopes and acknowledgments:

- `place_order`
- `modify_order`
- `close_order`
- `partial_close`
- `move_to_breakeven`
- `set_trailing_stop`
- `emergency_close_all`
- `heartbeat`

Every command requires:

- `commandId`
- `terminalId`
- `type`
- `payload`
- `createdAt`
- `expiresAt`

Every execution response should include:

- `commandId`
- `terminalId`
- `status`
- `ticket` when available
- `latencyMs`
- `receivedAt`
- broker rejection or error message when applicable

The EA currently posts heartbeat/account data to the local bridge:

```text
POST http://127.0.0.1:8787/heartbeat
```

MT5 setup:

1. Open Tools > Options > Expert Advisors.
2. Enable WebRequest for listed URLs.
3. Add `http://127.0.0.1:8787`.
4. Compile and attach `CacsmsTraderEA.mq5` to a broker demo account chart.

The EA is intentionally non-trading until the server-side risk gate and command queue are implemented.
