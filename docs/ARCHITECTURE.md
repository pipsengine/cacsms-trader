# Cacsms Trader — End-to-End Architecture

## Processing stages
1. Market Data & Feed — ingestion, validation, OHLC/tick normalization, spread/volatility and freshness.
2. Currency & XAU Strength — quarterly/monthly currency strength and independent XAU regime.
3. Historical Regime — persistence, acceleration, deterioration, transition and reversal.
4. Pair Discovery — ranks 28 FX pairs + XAUUSD and builds the candidate set.
5. HTF Market Vision — D1/H8 swing, channel, touch, boundary, breakout/retest and visual confidence.
6. Structural Direction — combines macro, history and HTF structure into directional state.
7. H1 Confirmation — HH/HL/LH/LL, BOS, CHoCH, momentum and pullback/continuation state.
8. Opportunity & Risk — setup score, correlation clusters, currency exposure, volatility/spread, portfolio heat and risk budget.
9. Execution & Position Management — final freshness validation, order lifecycle, SL/TP, partials, trailing and invalidation.
10. Learning, Audit & Feedback — immutable evidence, trade outcome analytics and controlled calibration recommendations.

## Shared state
Each instrument record includes market data, strength, historical regime, D1/H8 channel state, structural direction, H1 state, risk/portfolio state, system decision, confidence, provenance and timestamps.

## Event model
MN close updates macro strength/regime/discovery. D1/H8 closes update vision/direction. H1 close updates confirmation/risk. Boundary approaches and breakouts trigger immediate structural re-evaluation. Ticks are reserved for feed health and open-position/execution management.

## Fail-closed rules
No trade may execute with stale data, missing required stage state, invalid risk approval, disconnected gateway, exceeded daily/cluster risk, or a changed/invalidation condition between qualification and order placement.
