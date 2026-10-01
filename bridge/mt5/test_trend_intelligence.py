from datetime import datetime, timezone

import trend_intelligence as ti


def bars(start: float, step: float, n: int = 80):
    out = []
    price = start
    for i in range(n):
        open_ = price
        close = price + step
        high = max(open_, close) + abs(step) * 0.6 + 0.1
        low = min(open_, close) - abs(step) * 0.6 - 0.1
        out.append({"time": 1_700_000_000 + i * 60, "open": open_, "high": high, "low": low, "close": close})
        price = close
    return out


def universe(series):
    return {symbol: {h: series for h in ti.HORIZONS} for symbol in ti.SYMBOLS}


def test_bullish_structure_classifies_direction():
    cell = ti._series_score(bars(100, 0.35))
    assert cell["direction"] in ("Bullish", "Strong Bullish")
    assert cell["trendScore"] > 55
    assert cell["trendStrength"] > 20


def test_bearish_structure_classifies_direction():
    cell = ti._series_score(bars(100, -0.35))
    assert cell["direction"] in ("Bearish", "Strong Bearish")
    assert cell["trendScore"] < 45
    assert cell["trendStrength"] > 20


def test_insufficient_data_is_not_fabricated():
    cell = ti._series_score(bars(100, 0.1, 5))
    assert cell["direction"] == "INSUFFICIENT DATA"
    assert cell["dataQuality"] == "INSUFFICIENT DATA"


def test_alignment_weights_prevent_short_term_override():
    cells = {h: {"direction": "Bullish", "confidence": 90, "trendScore": 65} for h in ti.HORIZONS}
    cells["M1"] = {"direction": "Strong Bearish", "confidence": 100, "trendScore": 20}
    cells["M5"] = {"direction": "Strong Bearish", "confidence": 100, "trendScore": 20}
    alignment, label, sign = ti._alignment(cells)
    assert sign == 1
    assert "Bullish" in label
    assert alignment > 50


def test_xau_uses_xauusd_first_class_series():
    up = bars(1900, 1.2)
    snapshot = ti.calculate_trends(universe(up), [], {}, datetime(2026, 1, 1, tzinfo=timezone.utc))
    xau = next(r for r in snapshot["matrix"] if r["asset"] == "XAU")
    assert xau["overallDirection"] == "BULLISH"
    assert xau["timeframes"]["H1"]["dataQuality"] in ("OK", "DEGRADED")

