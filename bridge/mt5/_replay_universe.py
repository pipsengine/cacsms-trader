"""Full closed-bar L3/L4 replay. Removed after the result is captured."""
import json
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import execution_validation as ev
import opportunity

out_dir = Path(r"C:\Users\chrisogbaisi\AppData\Local\Cursor\AgentStores\cursor_agent_stores\64292b90-c5b6-4fe0-97b8-79fcb2f2b9f8\files\replay29")
out_dir.mkdir(parents=True, exist_ok=True)


def main() -> None:
    symbols = list(opportunity.SYMBOLS)
    if "XAUUSD" in symbols:
        symbols.insert(0, symbols.pop(symbols.index("XAUUSD")))
    with ProcessPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(ev.replay_both, symbol): symbol for symbol in symbols}
        for future in as_completed(futures):
            symbol = futures[future]
            result = future.result()
            (out_dir / f"{symbol}.json").write_text(json.dumps(result), encoding="utf-8")
            l3 = ((result.get("m15") or {}).get("funnel") or {}).get("L3") or {}
            l4 = ((result.get("m5") or {}).get("funnel") or {}).get("L4") or {}
            print(
                f"DONE {symbol} L3 episodes={l3.get('episodes')} erz={l3.get('erzReached')} p1={l3.get('p1Ready')} p2={l3.get('p2Ready')} "
                f"L4 episodes={l4.get('episodes')} erz={l4.get('erzReached')} p1={l4.get('p1Ready')} p2={l4.get('p2Ready')}",
                flush=True,
            )


if __name__ == "__main__":
    main()
