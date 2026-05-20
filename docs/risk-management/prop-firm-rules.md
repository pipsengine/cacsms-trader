# Prop-Firm Risk Rules

Initial risk controls implemented in `packages/risk-core`:

- Emergency kill switch.
- Daily drawdown limit.
- Maximum total drawdown limit.
- Monthly target lock.
- Maximum trades per day.
- Maximum open trades.
- Consecutive loss lockout.
- High-impact news blackout flag.
- Minimum reward/risk ratio.
- Maximum lot size.

Recommended default values:

- Daily drawdown: 4%.
- Maximum drawdown: 8%.
- Risk per trade: 0.25% to 1%.
- Monthly target: 8% to 10%.
- Maximum trades per day: 3 to 5.
- Minimum reward/risk: 1:2.
- Stop after consecutive losses: 2.

Risk decisions should be persisted before execution so rejected orders are auditable.
