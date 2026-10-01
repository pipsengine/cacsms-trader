"""Read-only live diagnostic for the opportunity framework (29 instruments).

Builds the framework from the stored channel, Stage 4/6/7 and economic state exactly as the service does, plus the live
Breakout & Retest watchlist from the running bridge when it is reachable. Nothing is persisted, no notification is
queued and no order path is touched.

    py opportunity_diagnostic.py                 # counts by type / lifecycle, OP-01 diagnostic, per-opportunity rows
    py opportunity_diagnostic.py --json out.json # full state to a file
    py opportunity_diagnostic.py --replay 120 --symbols EURUSD,GBPUSD   # causal OP-01 replay with funnel + shadow comparison
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import channel_store  # noqa: E402
import direction_store  # noqa: E402
import economic_store  # noqa: E402
import opportunity  # noqa: E402
import opportunity_framework as fw  # noqa: E402
import opportunity_replay  # noqa: E402
import opportunity_service as osvc  # noqa: E402
import opportunity_types as ot  # noqa: E402
import scanner_store  # noqa: E402


def _bridge_breakouts() -> tuple[list[dict[str, Any]], str]:
    url = f"http://127.0.0.1:{os.environ.get('MT5_BRIDGE_PORT', '8765')}/channel-breakouts/state"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        return [], f"bridge unreachable ({type(exc).__name__}) — OP-06/07/09 scanner rows unavailable"
    rows = list(data.get("candidates") or [])
    horizon = time.time() - 86400
    rows += [r for r in data.get("history") or [] if (r.get("breakout") or {}).get("state") == "FAILED_BREAKOUT"
             and float(r.get("removedAt") or 0) >= horizon]
    return rows, f"{len(rows)} scanner rows from the running bridge"


def live_state() -> tuple[dict[str, Any], str]:
    worlds = channel_store.world_rows()
    channels = {r["symbol"]: r.get("timeframes") or {} for r in worlds}
    osvc._overlay_atr(channels)
    directions = {r["symbol"]: r for r in (direction_store.load_state().get("instruments") or [])}
    ranks = {r["symbol"]: r.get("rank") for r in (scanner_store.load_state().get("instruments") or [])}
    confirmations = osvc._execution_confirmations(channels)
    legacy = opportunity.scan(osvc.SYMBOLS, channels, directions, ranks, prices={}, confirmations=confirmations, missed=False,
                              data_ok=True, level_breaks={})
    try:
        econ = economic_store.gate_map()
    except Exception:
        econ = None
    try:
        bias = osvc._pair_bias()
    except Exception:
        bias = {}
    try:
        import confirm_store
        stage7 = {r["symbol"]: r for r in (confirm_store.load_state().get("instruments") or []) if r.get("symbol")}
    except Exception:
        stage7 = {}
    breakouts, note = _bridge_breakouts()
    state = fw.build(osvc.SYMBOLS, channels, legacy, fw.LiveSource(), directions=directions, ranks=ranks, breakouts=breakouts,
                     econ=econ, bias=bias, stage7=stage7)
    return state, note


def report(state: dict[str, Any], note: str) -> None:
    s = state["summary"]
    print(f"Opportunity framework {state['frameworkVersion']} · contracts {state['contractVersion']} · {state['generatedAt']}")
    print(f"Universe {s['universe']} · scanned {s['scanned']} · hypotheses {s['hypotheses']} · build {state['durationMs']} ms · {note}")
    print(f"Light scan escalated {s['lightScan']['escalated']} channel candidates {s['lightScan']['byType']}")
    print("\nBy type:")
    for op, n in s["byType"].items():
        print(f"  {op} {ot.TYPES[op]['name']:<40} {n:>3}   route mode(s): "
              + ", ".join(sorted({v['mode'] for k, v in ot.ROUTES.items() if k.startswith(op)})))
    print("\nBy lifecycle:", json.dumps(s["byLifecycle"]))
    print("By mode:", json.dumps(s["byMode"]))
    print("\nOP-01 diagnostic:")
    for k, v in s["op01"].items():
        print(f"  {k:<24} {v}")
    print(f"  legacy NORMAL (OP-01:LEGACY_H1) {s['legacyNormal']}")
    print("\nOpportunities:")
    for h in state["hypotheses"]:
        rr = (h.get("room") or {}).get("rewardRisk")
        print(f"  {h['symbol']:<7} {h['opportunityType']} {h['direction']:<7} {h['mode']:<10} {str(h.get('parentTimeframe')):<4}"
              f" {h['lifecycle']:<20} {h['confirmationState']:<30} {str(h['detectorState'])[:28]:<28}"
              f" missing={','.join(h['missingEvidence']) or '-'} rr={rr}")
    if state["errors"]:
        print("\nDetector errors:")
        for e in state["errors"]:
            print("  ", e)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="write the result to this path")
    ap.add_argument("--replay", type=int, default=0, help="OP-01 replay over the last N parent bars")
    ap.add_argument("--symbols", default="")
    ap.add_argument("--tf", default="D1", choices=("D1", "H8", "H1"), help="OP-01 parent timeframe (execution H1, or M15 for an H1 parent)")
    ap.add_argument("--stride", type=int, default=2)
    args = ap.parse_args()
    if args.replay:
        syms = [s.strip().upper() for s in args.symbols.split(",") if s.strip()] or None
        t0 = time.time()
        out = opportunity_replay.op01_replay(syms, tf=args.tf, days=args.replay, h1_stride=args.stride)
        out["elapsedSec"] = round(time.time() - t0, 1)
        print(json.dumps(out, indent=1))
        return
    state, note = live_state()
    report(state, note)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=1, default=str)


if __name__ == "__main__":
    main()
