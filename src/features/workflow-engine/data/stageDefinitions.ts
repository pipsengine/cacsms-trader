export const STAGE_DEFINITIONS = [
  {
    "id": 1,
    "name": "Market Data & Feed",
    "description": "Validate market feed, normalize OHLC/ticks, calculate spread and volatility.",
    "slaMs": 80
  },
  {
    "id": 2,
    "name": "Currency & XAU Strength",
    "description": "Calculate Quarterly/Monthly currency strength and independent XAU regime.",
    "slaMs": 500
  },
  {
    "id": 3,
    "name": "Historical Regime",
    "description": "Measure persistence, acceleration, deterioration, reversal and regime state.",
    "slaMs": 650
  },
  {
    "id": 4,
    "name": "Pair Discovery & Ranking",
    "description": "Generate 28 FX combinations + XAUUSD and rank macro candidates.",
    "slaMs": 250
  },
  {
    "id": 5,
    "name": "HTF Market Vision",
    "description": "Detect D1/H8 swings, channels, touches, boundaries, breakouts and confidence.",
    "slaMs": 900
  },
  {
    "id": 6,
    "name": "Structural Direction",
    "description": "Fuse strength, regime and HTF vision into structural directional state.",
    "slaMs": 450
  },
  {
    "id": 7,
    "name": "H1 Confirmation",
    "description": "Evaluate H1 HH/HL/LH/LL, BOS, CHoCH, momentum and pullback state.",
    "slaMs": 350
  },
  {
    "id": 8,
    "name": "Opportunity & Risk",
    "description": "Score setup, correlation, currency exposure, volatility, spread and risk budget.",
    "slaMs": 180
  },
  {
    "id": 9,
    "name": "Execution & Position Management",
    "description": "Gate execution, size positions, manage SL/TP/trailing/partial exits.",
    "slaMs": 120
  },
  {
    "id": 10,
    "name": "Learning, Audit & Feedback",
    "description": "Persist decisions/outcomes, calculate attribution and calibration feedback.",
    "slaMs": 800
  }
] as const;
