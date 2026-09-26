# Cacsms Trader — MT5 Connection Module

## Purpose
Drop-in React/TypeScript page for the existing Cacsms Trader repository. It does **not** contain an app shell, router, authentication, database, package.json or duplicate trading engine.

## Page
Add one sidebar item under **System**: `MT5 Connection`. The page itself contains five tabs: Overview, Accounts, Symbols & Data, Trading, Logs & Health.

## Minimal integration
```tsx
import { MT5ConnectionPage } from './MT5Connection';
<Route path="/system/mt5-connection" element={<MT5ConnectionPage source={mt5Source} />} />
```

The page intentionally accepts an injected `MT5ConnectionSource`. Do not make React components talk directly to MetaTrader. Implement a server-side/local bridge and adapt your existing runtime to the interface in `types/mt5.types.ts`.

```ts
import { createMT5ConnectionAdapter } from './MT5Connection';
const mt5Source = createMT5ConnectionAdapter({
  snapshot: () => api.getMT5RuntimeSnapshot(),
  subscribe: cb => eventBus.subscribe('mt5.snapshot', cb),
  commands: {
    connect: id => api.connectMT5(id),
    disconnect: id => api.disconnectMT5(id),
    reconnect: id => api.reconnectMT5(id),
    testConnection: draft => api.testMT5Connection(draft),
    saveAccount: draft => api.saveMT5Account(draft),
    setAccountTrading: (id, enabled) => api.setMT5AccountTrading(id, enabled),
    setGlobalTrading: enabled => api.setGlobalTrading(enabled),
    saveSymbolMap: map => api.saveSymbolMap(map),
    reconcile: id => api.reconcileMT5Account(id),
    emergencyStop: scope => api.stopNewEntries(scope),
  }
});
```

## Production bridge responsibilities
1. Maintain terminal/server sessions independently of the browser.
2. Authenticate securely. Never return account passwords to the browser and never store them in plain text.
3. Detect account deposit currency from MT5. USD and NGN are first-class requirements; the contract permits other currencies.
4. Normalize the canonical 29-instrument universe to broker symbols per account.
5. Stream ticks/bars and maintain historical synchronization. Generate canonical H8 where required by the Cacsms data layer.
6. Publish account balance/equity/margin, terminal health and heartbeat.
7. Accept only already-qualified Stage 9 execution requests. Re-run account-specific safety, risk, symbol, market, spread and prop-rule gates before sending an order.
8. Use independent position sizing in each account's native deposit currency. Never copy a USD lot size blindly to an NGN account.
9. Reconcile Cacsms Trade ID ↔ MT5 order/deal/position IDs after every execution and reconnect.
10. On connection loss: block new execution, reconnect, resynchronize, reconcile positions, validate freshness, then restore execution only when safe.
11. Prop-firm rules are account-specific configuration. Do not hard-code a firm's limits.
12. Emergency stop blocks **new entries** by default. Closing existing positions is a separate explicit action.

## Demo source
`createDemoMT5Source()` exists only so the module is immediately testable. If no `source` prop is supplied, the page displays a clear Integration Preview banner. Production must inject the live source.

## Stage 9 integration
The MT5 gateway is downstream of the existing Opportunity & Risk stage. One master setup can be evaluated independently for Demo, Live, and Prop accounts. Account currency, prop rules, risk capacity, connection health, symbol availability and trading mode can cause one account to execute while another is blocked.

## Dependencies
React only. Scoped CSS is included; no Tailwind, icon library, chart library, state library or UI framework is required.


## Expanded module integration checklist

1. Register `MT5ConnectionPage` under System > MT5 Connection without replacing the existing shell.
2. Implement `MT5ConnectionSource` against the existing backend/bridge. Keep demo source for development only.
3. Bind account CRUD to secure server-side credential references; never return passwords to the browser.
4. Bind connection commands to authenticated backend endpoints and audit every state-changing action.
5. Load Demo, Live and Prop accounts independently; derive account currency from MT5 and preserve native USD/NGN amounts.
6. Bind all 29 canonical symbols to account-specific broker symbols and validate contract specifications.
7. Normalize H8 bars in the bridge/data service if the broker terminal does not expose the required canonical H8 series directly.
8. Feed Stage 9 only through the execution-qualification service. No UI button may bypass risk, prop, freshness or synchronization checks.
9. Reconcile positions after every reconnect before restoring autonomous execution.
10. Wire health/log streams using WebSocket/SSE or the repository's existing event transport; polling is acceptable only as a fallback.
11. Disable controls for adapter capabilities not implemented by the backend.
12. Remove demo source from production route composition after live adapter acceptance testing.
