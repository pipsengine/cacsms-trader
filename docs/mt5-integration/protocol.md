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

Terminal operations endpoints:

```text
GET http://127.0.0.1:8787/health
GET http://127.0.0.1:8787/terminals
GET http://127.0.0.1:8787/terminal-operations
GET http://127.0.0.1:8787/terminals/{terminalId}
```

The bridge tracks:

- terminal registration identity from heartbeat data
- heartbeat age and timeout state
- connected, degraded, and disconnected status
- WebRequest latency reported by the EA
- average latency and jitter
- heartbeat sequence numbers and missed sequence count
- terminal stability score
- per-terminal heartbeat history

Stability defaults:

- `MT5_HEARTBEAT_TIMEOUT_MS=15000`
- `MT5_DEGRADED_LATENCY_MS=2500`
- EA `HeartbeatSeconds=5`

For stable terminal communication, the EA heartbeat interval should remain comfortably below the bridge heartbeat timeout. With the defaults, the bridge allows roughly three missed 5-second heartbeats before marking a terminal disconnected.

MT5 setup:

1. Open Tools > Options > Expert Advisors.
2. Enable WebRequest for listed URLs.
3. Add `http://127.0.0.1:8787`.
4. Compile and attach `CacsmsTraderEA.mq5` to a broker demo account chart.

The EA is intentionally non-trading until the server-side risk gate and command queue are implemented.
