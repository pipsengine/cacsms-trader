"""AI-assisted top-down chart analysis (interpretation layer only — no execution authority)."""

from __future__ import annotations

try:
    from ai_chart_analysis.analysis_service import run_analysis
except ImportError:  # pragma: no cover
    from bridge.mt5.ai_chart_analysis.analysis_service import run_analysis  # type: ignore

__all__ = ["run_analysis"]
