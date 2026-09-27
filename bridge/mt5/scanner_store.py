"""SQL Server access for Stage 4 Market Scanner: current ranking, ranking snapshots, promotion history."""

from __future__ import annotations

import json
from typing import Any

try:
    from db import ROOT, _SNAPSHOT_COLS, _iso, _snapshot_dict, connect, get_setting, set_setting
except ImportError:  # pragma: no cover
    from bridge.mt5.db import ROOT, _SNAPSHOT_COLS, _iso, _snapshot_dict, connect, get_setting, set_setting  # type: ignore

_schema_ready = False
META_KEY = "scanner.last_run"


def ensure_scanner_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "006_market_scanner.sql").read_text(encoding="utf-8")
    batches = [b.strip() for b in sql.split("\nGO") if b.strip()]
    with connect() as conn:
        cur = conn.cursor()
        for batch in batches:
            cur.execute(batch)
        conn.commit()
    _schema_ready = True


# ---------------------------------------------------------------- upstream reads (Stage 2/3, Stage 5)

def latest_assets() -> dict[str, dict[str, Any]]:
    """Latest closed Stage 3 observation per asset (strength composite, macro/current, momentum, regime)."""
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT {_SNAPSHOT_COLS} FROM (
              SELECT *, ROW_NUMBER() OVER (PARTITION BY asset ORDER BY obs_date DESC) AS rn
              FROM dbo.app_regime_snapshot WHERE is_closed = 1
            ) x WHERE rn = 1
            """
        )
        cols = [c[0] for c in cur.description]
        out = {}
        for raw in cur.fetchall():
            s = _snapshot_dict(dict(zip(cols, raw)))
            out[s["asset"]] = s
        return out


def regime_meta() -> dict[str, Any]:
    raw = get_setting("regime.last_run")
    try:
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


def downstream() -> dict[str, tuple]:
    """Stage 5 qualification per instrument (status, confirmed D1 channel) — read only, never recomputed here."""
    with connect() as conn:
        cur = conn.cursor()
        if cur.execute("SELECT OBJECT_ID(N'dbo.app_vision_instrument', N'U')").fetchone()[0] is None:
            return {}
        cur.execute(
            """
            SELECT i.symbol, i.status, ISNULL(c.confirmed, 0)
            FROM dbo.app_vision_instrument i
            LEFT JOIN dbo.app_vision_channel c ON c.symbol = i.symbol AND c.timeframe = 'D1'
            """
        )
        return {s: (st, bool(cf)) for s, st, cf in cur.fetchall()}


def previously_promoted() -> set[str]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol FROM dbo.app_scanner_instrument WHERE promoted = 1")
        return {r[0] for r in cur.fetchall()}


# ---------------------------------------------------------------- writes

_INSTRUMENT_SET = """
rank_no=?, state=?, direction=?, conviction=?, raw_score=?, confidence=?, differential=?, macro_bias=?, relationship=?,
alignment=?, trajectory=?, acceleration_state=?, persistence=?, stage1_status=?, freshness_status=?, promoted=?,
promoted_at=?, reason=?, obs_date=?, run_id=?, detail_json=?
"""
_INSTRUMENT_COLS = [c.split("=")[0].strip() for c in _INSTRUMENT_SET.replace("\n", " ").split(",")]


def _instrument_params(r: dict[str, Any], run_id: int | None, promoted_at: Any) -> list[Any]:
    return [
        r["rank"], r["state"], r["direction"], r.get("conviction"), r.get("rawScore"), r.get("confidence"), r.get("differential"),
        r.get("macroBias"), r["relationship"], r["alignment"], r.get("trajectory"), r.get("acceleration"), r.get("persistence"),
        r["stage1"]["status"], r["freshness"]["status"], 1 if r["state"] == "PROMOTED" else 0, promoted_at,
        r["reason"][:600], r["freshness"].get("obsDate"), run_id, json.dumps(r, default=str),
    ]


def persist(result: dict[str, Any], meta: dict[str, Any], snapshot: bool, changes: list[dict[str, Any]]) -> int | None:
    """Upsert the current ranking; append a ranking snapshot + promotion history only when the ranking materially changed."""
    rows = result["instruments"]
    c = result["counters"]
    run_id: int | None = None
    with connect() as conn:
        cur = conn.cursor()
        if snapshot:
            cur.execute(
                """
                INSERT INTO dbo.app_scanner_run (run_at, triggers, status, universe, available, directional, promoted, duration_ms, summary_json)
                OUTPUT INSERTED.id VALUES (?,?,?,?,?,?,?,?,?)
                """,
                meta["runAt"][:26].replace("T", " "), ", ".join(meta.get("triggers") or [])[:400], meta["status"],
                c["universe"], c["available"], c["directional"], c["promoted"], int(meta.get("durationMs") or 0),
                json.dumps({"counters": c, "byState": result["byState"], "downstream": meta.get("downstream")}, default=str),
            )
            run_id = int(cur.fetchone()[0])
            for r in rows:
                cur.execute(
                    """
                    INSERT INTO dbo.app_scanner_snapshot (run_id, symbol, rank_no, state, direction, conviction, differential,
                      confidence, relationship, stage1_status, promoted) VALUES (?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    run_id, r["symbol"], r["rank"], r["state"], r["direction"], r.get("conviction"), r.get("differential"),
                    r.get("confidence"), r["relationship"], r["stage1"]["status"], 1 if r["state"] == "PROMOTED" else 0,
                )
            for ch in changes:
                r = ch["row"]
                cur.execute(
                    """
                    INSERT INTO dbo.app_scanner_promotion (symbol, action, run_id, direction, conviction, differential,
                      relationship, confidence, freshness, reason, evidence_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    r["symbol"], ch["action"], run_id, r["direction"], r.get("conviction"), r.get("differential"),
                    r["relationship"], r.get("confidence"), r["freshness"]["status"], ch["reason"][:600],
                    json.dumps({"evidence": r.get("evidence") or [], "rules": (r.get("promotion") or {}).get("rules") or []}, default=str),
                )

        cur.execute("SELECT symbol, promoted, promoted_at FROM dbo.app_scanner_instrument")
        prev = {s: (bool(p), at) for s, p, at in cur.fetchall()}
        for r in rows:
            was, at = prev.get(r["symbol"], (False, None))
            now_promoted = r["state"] == "PROMOTED"
            promoted_at = (at if was else None) if now_promoted else None
            params = _instrument_params(r, run_id, promoted_at)
            if now_promoted and promoted_at is None:
                params[_INSTRUMENT_COLS.index("promoted_at")] = meta["runAt"][:26].replace("T", " ")
            cur.execute(
                f"""
                MERGE dbo.app_scanner_instrument AS t
                USING (SELECT ? AS symbol) AS s ON t.symbol = s.symbol
                WHEN MATCHED THEN UPDATE SET {_INSTRUMENT_SET}, updated_at=SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT (symbol, {', '.join(_INSTRUMENT_COLS)}) VALUES (?, {', '.join('?' for _ in _INSTRUMENT_COLS)});
                """,
                r["symbol"], *params, r["symbol"], *params,
            )
        conn.commit()
    return run_id


CONFIG_KEY = "scanner.config"


def load_config() -> dict[str, Any]:
    raw = get_setting(CONFIG_KEY)
    try:
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


def save_config(overrides: dict[str, Any]) -> None:
    set_setting(CONFIG_KEY, json.dumps(overrides))


def save_meta(meta: dict[str, Any]) -> None:
    set_setting(META_KEY, json.dumps(meta, default=str))


def load_meta() -> dict[str, Any] | None:
    raw = get_setting(META_KEY)
    try:
        return json.loads(raw) if raw else None
    except Exception:
        return None


# ---------------------------------------------------------------- reads for the UI + Stage 5

def _instrument(d: dict[str, Any]) -> dict[str, Any]:
    try:
        body = json.loads(d["detail_json"])
    except Exception:
        body = {"symbol": d["symbol"]}
    body.update({"rank": d["rank_no"], "state": d["state"], "promotedAt": _iso(d["promoted_at"]),
                 "runId": d["run_id"], "updatedAt": _iso(d["updated_at"])})
    return body


def load_instruments() -> list[dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol, rank_no, state, promoted_at, run_id, updated_at, detail_json FROM dbo.app_scanner_instrument ORDER BY rank_no")
        cols = [c[0] for c in cur.description]
        return [_instrument(dict(zip(cols, raw))) for raw in cur.fetchall()]


def _promotion(d: dict[str, Any]) -> dict[str, Any]:
    try:
        ev = json.loads(d["evidence_json"])
    except Exception:
        ev = {}
    return {"id": int(d["id"]), "symbol": d["symbol"], "action": d["action"], "runId": d["run_id"], "direction": d["direction"],
            "conviction": d["conviction"], "differential": d["differential"], "relationship": d["relationship"],
            "confidence": d["confidence"], "freshness": d["freshness"], "reason": d["reason"],
            "evidence": ev.get("evidence") or [], "createdAt": _iso(d["created_at"])}


_PROMO_COLS = "id, symbol, action, run_id, direction, conviction, differential, relationship, confidence, freshness, reason, evidence_json, created_at"


def load_state() -> dict[str, Any]:
    ensure_scanner_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT TOP 60 {_PROMO_COLS} FROM dbo.app_scanner_promotion ORDER BY id DESC")
        cols = [c[0] for c in cur.description]
        promotions = [_promotion(dict(zip(cols, raw))) for raw in cur.fetchall()]
        cur.execute("SELECT TOP 30 id, run_at, triggers, status, universe, available, directional, promoted, duration_ms FROM dbo.app_scanner_run ORDER BY id DESC")
        runs = [{"id": int(i), "runAt": _iso(at), "triggers": tr, "status": st, "universe": u, "available": a, "directional": d,
                 "promoted": p, "durationMs": ms} for i, at, tr, st, u, a, d, p, ms in cur.fetchall()]
    return {"ok": True, "run": load_meta(), "instruments": load_instruments(), "promotions": promotions, "snapshots": runs}


def load_detail(symbol: str) -> dict[str, Any]:
    ensure_scanner_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT symbol, rank_no, state, promoted_at, run_id, updated_at, detail_json FROM dbo.app_scanner_instrument WHERE symbol = ?", symbol)
        cols = [c[0] for c in cur.description]
        raw = cur.fetchone()
        inst = _instrument(dict(zip(cols, raw))) if raw else None
        cur.execute(f"SELECT TOP 40 {_PROMO_COLS} FROM dbo.app_scanner_promotion WHERE symbol = ? ORDER BY id DESC", symbol)
        pcols = [c[0] for c in cur.description]
        promotions = [_promotion(dict(zip(pcols, r))) for r in cur.fetchall()]
        cur.execute(
            """
            SELECT TOP 60 r.run_at, s.rank_no, s.state, s.direction, s.conviction, s.differential, s.stage1_status, s.promoted
            FROM dbo.app_scanner_snapshot s JOIN dbo.app_scanner_run r ON r.id = s.run_id
            WHERE s.symbol = ? ORDER BY s.run_id DESC
            """,
            symbol,
        )
        history = [{"runAt": _iso(at), "rank": rk, "state": st, "direction": d, "conviction": cv, "differential": df,
                    "stage1": s1, "promoted": bool(p)} for at, rk, st, d, cv, df, s1, p in cur.fetchall()]
    history.reverse()
    return {"ok": True, "symbol": symbol, "instrument": inst, "promotions": promotions, "history": history}


def promotions_for_vision() -> dict[str, dict[str, Any]]:
    """Stage 4 → Stage 5 publication: every instrument's promotion decision with its evidence."""
    with connect() as conn:
        cur = conn.cursor()
        if cur.execute("SELECT OBJECT_ID(N'dbo.app_scanner_instrument', N'U')").fetchone()[0] is None:
            return {}
        cur.execute(
            """
            SELECT symbol, state, direction, conviction, differential, relationship, confidence, freshness_status, promoted,
                   reason, obs_date, detail_json FROM dbo.app_scanner_instrument
            """
        )
        out: dict[str, dict[str, Any]] = {}
        for s, st, d, cv, df, rel, conf, fr, pr, why, od, dj in cur.fetchall():
            try:
                body = json.loads(dj)
            except Exception:
                body = {}
            out[s] = {"state": st, "direction": d, "conviction": cv, "differential": df, "relationship": rel, "confidence": conf,
                      "freshness": fr, "promoted": bool(pr), "reason": why, "date": _iso(od),
                      "alignment": body.get("alignment"), "evidence": body.get("evidence") or [],
                      "liveEligible": bool((body.get("promotion") or {}).get("liveEligible"))}
        return out
