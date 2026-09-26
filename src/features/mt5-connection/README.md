# MT5 Connection — page-only integration module
A dependency-light, production-integration-ready UI module for Cacsms Trader. Supports multi-account Demo/Live/Prop workflows, USD/NGN native account display and account-specific execution gating. See INTEGRATION.md.
## Acceptance fixture
`data/mt5RuntimeAcceptanceFixture.json` contains 7,000 deterministic, non-production runtime events across the complete 29-instrument universe and multiple account IDs. It is provided for table virtualization, filtering, health/event-stream, latency, reconciliation and adapter acceptance testing. It must not be used as live market data and can be excluded from a production bundle after integration tests.
