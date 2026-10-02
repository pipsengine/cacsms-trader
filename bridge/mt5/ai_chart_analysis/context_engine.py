from __future__ import annotations

from typing import Any

try:
    from ai_chart_analysis.models import CHANNEL_TO_STRIP, ST_TO_STRIP, STRIP_TFS
except ImportError:  # pragma: no cover
    from bridge.mt5.ai_chart_analysis.models import CHANNEL_TO_STRIP, ST_TO_STRIP, STRIP_TFS  # type: ignore

_DIR_SHORT = {"BULLISH": "↑", "BEARISH": "↓", "RANGE": "↔", "UNKNOWN": "—", "NEUTRAL": "—"}


def _market_state_label(ch: dict[str, Any] | None, interp: dict[str, Any] | None) -> str:
    if not ch:
        return "UNCLEAR"
    rel = (ch.get("relationship") or "").upper()
    phase = (ch.get("phase") or "").upper()
    ms = (interp or {}).get("marketState") or ch.get("marketState")
    if ms:
        return str(ms).upper()
    if "CORRECTION" in rel or phase == "CORRECTION":
        return "PULLBACK"
    if ch.get("status") == "RETESTING":
        return "RETEST"
    if ch.get("status") == "BROKEN":
        return "BREAKOUT_DEVELOPING"
    if ch.get("direction") in ("BULLISH", "BEARISH"):
        return "TRENDING"
    return "UNCLEAR"


def _structure_label(ch: dict[str, Any] | None) -> str:
    if not ch:
        return "UNKNOWN"
    events = (ch.get("evidence") or {}).get("events") or []
    for ev in reversed(events):
        kind = (ev.get("kind") or "").upper()
        if kind in ("BOS", "CHOCH"):
            d = ev.get("direction") or ch.get("direction")
            return f"{kind}_{d or 'UNKNOWN'}"
    trend = ch.get("trend") or ch.get("direction")
    if trend == "BULLISH":
        return "HH_HL"
    if trend == "BEARISH":
        return "LH_LL"
    return "TRANSITION"


def _channel_state(ch: dict[str, Any] | None) -> str:
    if not ch:
        return "NO_DATA"
    return str(ch.get("status") or "NO_CHANNEL")


def _supertrend_card(cards: dict[str, Any], strip_tf: str) -> dict[str, Any] | None:
    for key, mapped in ST_TO_STRIP.items():
        if mapped == strip_tf:
            card = cards.get(key)
            if card:
                return card
    return None


def _last_closed_ms(ch: dict[str, Any] | None, card: dict[str, Any] | None, m5_meta: dict[str, Any] | None) -> int | None:
    if strip_tf := (ch or {}).get("lastCandleClose"):
        return int(strip_tf)
    if card and card.get("lastClosedBarTime"):
        return int(card["lastClosedBarTime"])
    if m5_meta and m5_meta.get("lastClosedTs"):
        return int(m5_meta["lastClosedTs"])
    return None


def build_timeframe_strip(
    channels: dict[str, Any],
    supertrend: dict[str, Any] | None,
    interpretation: dict[str, Any] | None,
    m5_meta: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    cards = (supertrend or {}).get("cards") or {}
    interp = interpretation or {}
    out: list[dict[str, Any]] = []
    for tf in STRIP_TFS:
        ch_key = next((k for k, v in CHANNEL_TO_STRIP.items() if v == tf and k in channels), None)
        ch = channels.get(ch_key) if ch_key else None
        st = _supertrend_card(cards, tf)
        direction = (ch or {}).get("direction") if ch else None
        if (not direction or direction == "UNKNOWN") and st:
            direction = {"UP": "BULLISH", "DOWN": "BEARISH"}.get(st.get("trend") or "", "UNKNOWN")
        ms = _market_state_label(ch, interp if tf in ("D1", "H8", "H1") else None)
        short = _DIR_SHORT.get(str(direction or "UNKNOWN"), "—")
        if ms in ("PULLBACK", "CORRECTION", "COUNTER_CORRECTION") and direction in ("BULLISH", "BEARISH"):
            short = "PB"
        if ms in ("REVERSAL_CANDIDATE", "REVERSAL_DEVELOPING"):
            short = "REV"
        conf = float(ch.get("confidence") or 0) if ch else float(st.get("confidence") or 0) if st else 0.0
        out.append(
            {
                "timeframe": tf,
                "direction": direction or "UNKNOWN",
                "directionShort": short,
                "marketState": ms,
                "structure": _structure_label(ch),
                "channelState": _channel_state(ch),
                "supertrend": (
                    (st.get("direction") or st.get("confirmedDirection") or st.get("trend") if st else None)
                    or "UNKNOWN"
                ),
                "priceLocation": ch.get("positionLabel") if ch else None,
                "confidence": round(conf, 1),
                "lastClosedCandleMs": _last_closed_ms(ch, st, m5_meta if tf == "M5" else None),
                "sourceChannelTf": ch_key,
            }
        )
    return out


def aggregate_direction(strip: list[dict[str, Any]]) -> str:
    strategic = [r["direction"] for r in strip if r["timeframe"] in ("YTD", "Q", "MN", "W") and r["direction"] not in ("UNKNOWN", "NEUTRAL")]
    trading = [r["direction"] for r in strip if r["timeframe"] in ("D1", "H8", "H1") and r["direction"] not in ("UNKNOWN", "NEUTRAL")]
    entry = [r["direction"] for r in strip if r["timeframe"] in ("M15", "M5") and r["direction"] not in ("UNKNOWN", "NEUTRAL")]

    def vote(rows: list[str]) -> str | None:
        if not rows:
            return None
        bull = sum(1 for d in rows if d == "BULLISH")
        bear = sum(1 for d in rows if d == "BEARISH")
        if bull > bear:
            return "BULLISH"
        if bear > bull:
            return "BEARISH"
        return "MIXED"

    s, t, e = vote(strategic), vote(trading), vote(entry)
    if s and t and s == t:
        if e and e not in (s, "MIXED"):
            return "MIXED"
        return s
    if t:
        return t
    if s:
        return s
    return "NEUTRAL"
