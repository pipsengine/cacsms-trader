"""SQL Server persistence for MT5 accounts (db_Cacsms-Trader)."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

import pyodbc


def _parse_dt(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except Exception:
        return None


ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv()


def connection_string() -> str:
    driver = os.environ.get("MSSQL_DRIVER", "ODBC Driver 18 for SQL Server")
    server = os.environ.get("MSSQL_SERVER", "localhost")
    database = os.environ.get("MSSQL_DATABASE", "db_Cacsms-Trader")
    user = os.environ.get("MSSQL_USER", "cascms")
    password = os.environ.get("MSSQL_PASSWORD", "")
    trust = os.environ.get("MSSQL_TRUST_CERT", "1") in ("1", "true", "TRUE", "yes")
    parts = [
        f"DRIVER={{{driver}}}",
        f"SERVER={server}",
        f"DATABASE={database}",
        f"UID={user}",
        f"PWD={password}",
    ]
    if trust:
        parts.append("TrustServerCertificate=yes")
    return ";".join(parts)


def connect() -> pyodbc.Connection:
    return pyodbc.connect(connection_string(), autocommit=False)


def ensure_schema() -> None:
    schema = ROOT / "database" / "mssql" / "001_mt5_persistence.sql"
    sql = schema.read_text(encoding="utf-8")
    # sqlcmd batches use GO — execute statements split on GO
    batches = [b.strip() for b in sql.split("\nGO") if b.strip()]
    with connect() as conn:
        cur = conn.cursor()
        for batch in batches:
            cur.execute(batch)
        conn.commit()


def upsert_account(account: dict[str, Any]) -> dict[str, Any]:
    row = {
        "id": account["id"],
        "name": account.get("name") or "MT5 Account",
        "account_class": account.get("accountClass") or account.get("account_class") or "DEMO",
        "currency": account.get("currency") or "USD",
        "broker": account.get("broker") or "Broker",
        "firm_name": account.get("firm") or account.get("firm_name"),
        "server_name": account.get("server") or account.get("server_name") or "MT5",
        "login": str(account.get("login") or ""),
        "credential_secret_ref": account.get("secretRef") or account.get("credential_secret_ref"),
        "terminal_instance": account.get("terminalInstance") or account.get("terminal_instance") or "CACSMS-MT5-0001",
        "state": account.get("state") or "DISCONNECTED",
        "trading_mode": account.get("tradingMode") or account.get("trading_mode") or "ANALYSIS_ONLY",
        "trading_enabled": 1 if account.get("tradingEnabled") or account.get("trading_enabled") else 0,
        "leverage": int(account.get("leverage") or 100),
        "risk_profile": account.get("riskProfile") or account.get("risk_profile") or "BALANCED",
        "max_concurrent_trades": int(account.get("maxConcurrentTrades") or account.get("max_concurrent_trades") or 2),
        "balance": float(account.get("balance") or 0),
        "equity": float(account.get("equity") or 0),
        "margin": float(account.get("margin") or 0),
        "free_margin": float(account.get("freeMargin") if account.get("freeMargin") is not None else account.get("free_margin") or 0),
        "profit": float(account.get("profit") or 0),
        "latency_ms": account.get("latencyMs") if account.get("latencyMs") is not None else account.get("latency_ms"),
        "last_heartbeat": _parse_dt(account.get("lastHeartbeat") or account.get("last_heartbeat")),
        "connected_at": _parse_dt(account.get("connectedAt") or account.get("connected_at")),
        "assigned_symbols_json": json.dumps(account.get("assignedSymbols") or account.get("assigned_symbols") or []),
        "prop_rules_json": json.dumps(account.get("propRules") or account.get("prop_rules")) if (account.get("propRules") or account.get("prop_rules")) else None,
    }

    sql = """
    MERGE dbo.mt5_accounts AS t
    USING (SELECT ? AS id) AS s ON t.id = s.id
    WHEN MATCHED THEN UPDATE SET
      name=?, account_class=?, currency=?, broker=?, firm_name=?, server_name=?, login=?,
      credential_secret_ref=?, terminal_instance=?, state=?, trading_mode=?, trading_enabled=?,
      leverage=?, risk_profile=?, max_concurrent_trades=?, balance=?, equity=?, margin=?,
      free_margin=?, profit=?, latency_ms=?, last_heartbeat=?, connected_at=?,
      assigned_symbols_json=?, prop_rules_json=?, updated_at=SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (
      id, name, account_class, currency, broker, firm_name, server_name, login,
      credential_secret_ref, terminal_instance, state, trading_mode, trading_enabled,
      leverage, risk_profile, max_concurrent_trades, balance, equity, margin,
      free_margin, profit, latency_ms, last_heartbeat, connected_at,
      assigned_symbols_json, prop_rules_json
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    );
    """
    params = [
        row["id"],
        # UPDATE
        row["name"], row["account_class"], row["currency"], row["broker"], row["firm_name"],
        row["server_name"], row["login"], row["credential_secret_ref"], row["terminal_instance"],
        row["state"], row["trading_mode"], row["trading_enabled"], row["leverage"],
        row["risk_profile"], row["max_concurrent_trades"], row["balance"], row["equity"],
        row["margin"], row["free_margin"], row["profit"], row["latency_ms"],
        row["last_heartbeat"], row["connected_at"], row["assigned_symbols_json"], row["prop_rules_json"],
        # INSERT
        row["id"], row["name"], row["account_class"], row["currency"], row["broker"], row["firm_name"],
        row["server_name"], row["login"], row["credential_secret_ref"], row["terminal_instance"],
        row["state"], row["trading_mode"], row["trading_enabled"], row["leverage"],
        row["risk_profile"], row["max_concurrent_trades"], row["balance"], row["equity"],
        row["margin"], row["free_margin"], row["profit"], row["latency_ms"],
        row["last_heartbeat"], row["connected_at"], row["assigned_symbols_json"], row["prop_rules_json"],
    ]

    with connect() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        # balance history
        cur.execute(
            """
            INSERT INTO dbo.account_balances (account_id, currency, balance, equity, margin, free_margin, profit)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            row["id"],
            row["currency"],
            row["balance"],
            row["equity"],
            row["margin"],
            row["free_margin"],
            row["profit"],
        )
        conn.commit()
    return {"ok": True, "message": f"Account {row['id']} persisted", "id": row["id"]}


def list_accounts() -> list[dict[str, Any]]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, account_class, currency, broker, firm_name, server_name, login,
                   credential_secret_ref, terminal_instance, state, trading_mode, trading_enabled,
                   leverage, risk_profile, max_concurrent_trades, balance, equity, margin,
                   free_margin, profit, latency_ms, last_heartbeat, connected_at,
                   assigned_symbols_json, prop_rules_json
            FROM dbo.mt5_accounts
            ORDER BY created_at ASC
            """
        )
        cols = [c[0] for c in cur.description]
        rows = []
        for raw in cur.fetchall():
            d = dict(zip(cols, raw))
            symbols = []
            prop = None
            try:
                symbols = json.loads(d["assigned_symbols_json"] or "[]")
            except Exception:
                symbols = []
            try:
                prop = json.loads(d["prop_rules_json"]) if d["prop_rules_json"] else None
            except Exception:
                prop = None
            rows.append(
                {
                    "id": d["id"],
                    "name": d["name"],
                    "accountClass": d["account_class"],
                    "currency": d["currency"],
                    "broker": d["broker"],
                    "firm": d["firm_name"],
                    "server": d["server_name"],
                    "login": d["login"],
                    "secretRef": d["credential_secret_ref"],
                    "terminalInstance": d["terminal_instance"],
                    "state": d["state"],
                    "tradingMode": d["trading_mode"],
                    "tradingEnabled": bool(d["trading_enabled"]),
                    "leverage": int(d["leverage"] or 100),
                    "riskProfile": d["risk_profile"],
                    "maxConcurrentTrades": int(d["max_concurrent_trades"] or 2),
                    "balance": float(d["balance"] or 0),
                    "equity": float(d["equity"] or 0),
                    "margin": float(d["margin"] or 0),
                    "freeMargin": float(d["free_margin"] or 0),
                    "profit": float(d["profit"] or 0),
                    "latencyMs": int(d["latency_ms"]) if d["latency_ms"] is not None else 0,
                    "lastHeartbeat": d["last_heartbeat"].isoformat() + "Z" if d["last_heartbeat"] else None,
                    "connectedAt": d["connected_at"].isoformat() + "Z" if d["connected_at"] else None,
                    "assignedSymbols": symbols,
                    "propRules": prop,
                }
            )
        return rows


def delete_account(account_id: str) -> dict[str, Any]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM dbo.mt5_accounts WHERE id = ?", account_id)
        conn.commit()
        return {"ok": True, "message": f"Deleted {account_id}", "deleted": cur.rowcount}


def replace_positions(account_id: str, positions: list[dict[str, Any]]) -> None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM dbo.mt5_positions WHERE account_id = ?", account_id)
        for p in positions:
            cur.execute(
                """
                INSERT INTO dbo.mt5_positions (
                  id, account_id, cacsms_trade_id, mt5_order_id, mt5_deal_id, mt5_position_id,
                  symbol, side, volume, entry_price, current_price, sl, tp, pnl, currency, status, opened_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                p.get("id"),
                account_id,
                p.get("cacsmsTradeId") or p.get("cacsms_trade_id"),
                p.get("mt5OrderId"),
                p.get("mt5DealId"),
                p.get("mt5PositionId"),
                p.get("symbol"),
                p.get("side"),
                float(p.get("volume") or 0),
                float(p.get("entry") or p.get("entry_price") or 0),
                float(p.get("current") or p.get("current_price") or 0),
                p.get("sl"),
                p.get("tp"),
                float(p.get("pnl") or 0),
                p.get("currency") or "USD",
                p.get("status") or "OPEN",
                p.get("openedAt") or p.get("opened_at"),
            )
        conn.commit()


def list_positions(account_id: str | None = None) -> list[dict[str, Any]]:
    sql = """
      SELECT id, account_id, cacsms_trade_id, mt5_order_id, mt5_deal_id, mt5_position_id,
             symbol, side, volume, entry_price, current_price, sl, tp, pnl, currency, status, opened_at
      FROM dbo.mt5_positions
    """
    params: list[Any] = []
    if account_id:
        sql += " WHERE account_id = ?"
        params.append(account_id)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        cols = [c[0] for c in cur.description]
        out = []
        for raw in cur.fetchall():
            d = dict(zip(cols, raw))
            out.append(
                {
                    "id": d["id"],
                    "accountId": d["account_id"],
                    "cacsmsTradeId": d["cacsms_trade_id"],
                    "mt5OrderId": d["mt5_order_id"],
                    "mt5DealId": d["mt5_deal_id"],
                    "mt5PositionId": d["mt5_position_id"],
                    "symbol": d["symbol"],
                    "side": d["side"],
                    "volume": float(d["volume"] or 0),
                    "entry": float(d["entry_price"] or 0),
                    "current": float(d["current_price"] or 0),
                    "sl": d["sl"],
                    "tp": d["tp"],
                    "pnl": float(d["pnl"] or 0),
                    "currency": d["currency"],
                    "status": d["status"],
                    "openedAt": d["opened_at"].isoformat() + "Z" if d["opened_at"] else None,
                }
            )
        return out


def health() -> dict[str, Any]:
    try:
        with connect() as conn:
            cur = conn.cursor()
            cur.execute("SELECT DB_NAME()")
            db_name = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM dbo.mt5_accounts")
            accounts = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM dbo.app_instruments")
            instruments = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM dbo.app_positions WHERE status = N'ACTIVE'")
            open_positions = int(cur.fetchone()[0])
            return {
                "ok": True,
                "database": db_name,
                "accounts": accounts,
                "instruments": instruments,
                "openPositions": open_positions,
                "message": f"SQL Server ready ({db_name})",
            }
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


def get_setting(key: str, default: str | None = None) -> str | None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT [value] FROM dbo.app_settings WHERE [key] = ?", key)
        row = cur.fetchone()
        return row[0] if row else default


def set_setting(key: str, value: str) -> None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            MERGE dbo.app_settings AS t
            USING (SELECT ? AS [key]) AS s ON t.[key] = s.[key]
            WHEN MATCHED THEN UPDATE SET [value]=?, updated_at=SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT ([key], [value]) VALUES (?, ?);
            """,
            key,
            value,
            key,
            value,
        )
        conn.commit()


def load_app_state() -> dict[str, Any]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT [key], [value] FROM dbo.app_settings")
        settings = {row[0]: row[1] for row in cur.fetchall()}

        cur.execute(
            """
            SELECT symbol, kind, bid, ask, spread, change_pct, d1, h8, h1, score, state,
                   strength_diff, channel_pos, confidence
            FROM dbo.app_instruments ORDER BY symbol
            """
        )
        icols = [c[0] for c in cur.description]
        instruments = []
        for raw in cur.fetchall():
            d = dict(zip(icols, raw))
            instruments.append(
                {
                    "symbol": d["symbol"],
                    "kind": d["kind"],
                    "bid": float(d["bid"] or 0),
                    "ask": float(d["ask"] or 0),
                    "spread": float(d["spread"] or 0),
                    "change": float(d["change_pct"] or 0),
                    "d1": d["d1"],
                    "h8": d["h8"],
                    "h1": d["h1"],
                    "score": float(d["score"] or 0),
                    "state": d["state"],
                    "strengthDiff": float(d["strength_diff"] or 0),
                    "channelPos": float(d["channel_pos"] or 50),
                    "confidence": float(d["confidence"] or 0),
                }
            )

        cur.execute(
            "SELECT code, q, m, score, trend, classification FROM dbo.app_currency_strength ORDER BY score DESC"
        )
        scols = [c[0] for c in cur.description]
        strengths = [dict(zip(scols, raw)) for raw in cur.fetchall()]

        cur.execute(
            """
            SELECT id, symbol, side, entry_price, current_price, sl, tp, size_lots, risk_pct, pnl, status, opened_at, account_id
            FROM dbo.app_positions ORDER BY updated_at DESC
            """
        )
        pcols = [c[0] for c in cur.description]
        positions = []
        for raw in cur.fetchall():
            d = dict(zip(pcols, raw))
            positions.append(
                {
                    "id": d["id"],
                    "symbol": d["symbol"],
                    "side": d["side"],
                    "entry": float(d["entry_price"] or 0),
                    "current": float(d["current_price"] or 0),
                    "sl": float(d["sl"] or 0),
                    "tp": float(d["tp"] or 0),
                    "size": float(d["size_lots"] or 0),
                    "risk": float(d["risk_pct"] or 0),
                    "pnl": float(d["pnl"] or 0),
                    "status": d["status"],
                    "opened": d["opened_at"] or "",
                    "accountId": d["account_id"],
                }
            )

        cur.execute(
            "SELECT TOP 100 id, ts, severity, source, message FROM dbo.app_events ORDER BY id DESC"
        )
        ecols = [c[0] for c in cur.description]
        events = []
        for raw in cur.fetchall():
            d = dict(zip(ecols, raw))
            events.append(
                {
                    "id": int(d["id"]),
                    "ts": d["ts"].isoformat() + "Z" if d["ts"] else None,
                    "severity": d["severity"],
                    "source": d["source"],
                    "message": d["message"],
                }
            )

        return {
            "ok": True,
            "settings": settings,
            "instruments": instruments,
            "strengths": strengths,
            "positions": positions,
            "events": events,
        }


ENGINE_OWNED_SETTINGS = ("auto", "execution.")


def save_app_state(body: dict[str, Any]) -> dict[str, Any]:
    # trading/execution control is owned by the central engine (/execution/control, audited) — a browser snapshot never writes it
    settings = {k: v for k, v in (body.get("settings") or {}).items() if not any(k == p or (p.endswith(".") and k.startswith(p)) for p in ENGINE_OWNED_SETTINGS)}
    instruments = body.get("instruments") or []
    strengths = body.get("strengths") or []
    positions = body.get("positions") or []
    events = body.get("events")

    with connect() as conn:
        cur = conn.cursor()

        for key, value in settings.items():
            cur.execute(
                """
                MERGE dbo.app_settings AS t
                USING (SELECT ? AS [key]) AS s ON t.[key] = s.[key]
                WHEN MATCHED THEN UPDATE SET [value]=?, updated_at=SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT ([key], [value]) VALUES (?, ?);
                """,
                key,
                str(value),
                key,
                str(value),
            )

        if "instruments" in body:
            cur.execute("DELETE FROM dbo.app_instruments")
            for i in instruments:
                cur.execute(
                    """
                    INSERT INTO dbo.app_instruments (
                      symbol, kind, bid, ask, spread, change_pct, d1, h8, h1, score, state,
                      strength_diff, channel_pos, confidence
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    i.get("symbol"),
                    i.get("kind") or ("GOLD" if i.get("symbol") == "XAUUSD" else "FX"),
                    float(i.get("bid") or 0),
                    float(i.get("ask") or 0),
                    float(i.get("spread") or 0),
                    float(i.get("change") or 0),
                    i.get("d1") or "NEUTRAL",
                    i.get("h8") or "NEUTRAL",
                    i.get("h1") or "Waiting",
                    float(i.get("score") or 0),
                    i.get("state") or "WAIT",
                    float(i.get("strengthDiff") or 0),
                    float(i.get("channelPos") or 50),
                    float(i.get("confidence") or 0),
                )

        if "strengths" in body:
            cur.execute("DELETE FROM dbo.app_currency_strength")
            for s in strengths:
                cur.execute(
                    """
                    INSERT INTO dbo.app_currency_strength (code, q, m, score, trend, classification)
                    VALUES (?,?,?,?,?,?)
                    """,
                    s.get("code"),
                    float(s.get("q") or 0),
                    float(s.get("m") or 0),
                    float(s.get("score") or 0),
                    s.get("trend") or "Stable",
                    s.get("classification") or "NEUTRAL",
                )

        if "positions" in body:
            cur.execute("DELETE FROM dbo.app_positions")
            for p in positions:
                cur.execute(
                    """
                    INSERT INTO dbo.app_positions (
                      id, symbol, side, entry_price, current_price, sl, tp, size_lots, risk_pct, pnl, status, opened_at, account_id
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    p.get("id"),
                    p.get("symbol"),
                    p.get("side"),
                    float(p.get("entry") or 0),
                    float(p.get("current") or 0),
                    float(p.get("sl") or 0),
                    float(p.get("tp") or 0),
                    float(p.get("size") or 0),
                    float(p.get("risk") or 0),
                    float(p.get("pnl") or 0),
                    p.get("status") or "ACTIVE",
                    p.get("opened") or "",
                    p.get("accountId"),
                )

        if isinstance(events, list):
            # append-only for new messages without id
            for e in events:
                if e.get("id"):
                    continue
                cur.execute(
                    "INSERT INTO dbo.app_events (severity, source, message) VALUES (?,?,?)",
                    e.get("severity") or "INFO",
                    e.get("source") or "SYSTEM",
                    e.get("message") or "",
                )

        conn.commit()

    return {"ok": True, "message": "App state saved to db_Cacsms-Trader"}


# ---------------------------------------------------------------- Stage 3 Historical Regime

_regime_schema_ready = False


def ensure_regime_schema() -> None:
    global _regime_schema_ready
    if _regime_schema_ready:
        return
    sql = (ROOT / "database" / "mssql" / "003_historical_regime.sql").read_text(encoding="utf-8")
    batches = [b.strip() for b in sql.split("\nGO") if b.strip()]
    with connect() as conn:
        cur = conn.cursor()
        for batch in batches:
            cur.execute(batch)
        conn.commit()
    _regime_schema_ready = True


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat() + "Z"
    return value.isoformat()


def regime_load_states() -> dict[str, dict[str, Any]]:
    """Latest closed hysteresis state per asset — incremental runs continue from here."""
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT s.asset, s.obs_date, s.regime, s.regime_since, s.candidate, s.candidate_count, s.candidate_since
            FROM dbo.app_regime_snapshot s
            JOIN (
              SELECT asset, MAX(obs_date) AS obs_date FROM dbo.app_regime_snapshot WHERE is_closed = 1 GROUP BY asset
            ) x ON x.asset = s.asset AND x.obs_date = s.obs_date
            """
        )
        out: dict[str, dict[str, Any]] = {}
        for asset, obs_date, regime, since, candidate, count, cand_since in cur.fetchall():
            out[asset] = {
                "lastClosedDate": obs_date,
                "regime": regime,
                "since": since,
                "candidate": candidate,
                "candidateCount": int(count or 0),
                "candidateSince": cand_since,
            }
        return out


_SNAPSHOT_MERGE = """
MERGE dbo.app_regime_snapshot AS t
USING (SELECT ? AS asset, ? AS obs_date) AS s ON t.asset = s.asset AND t.obs_date = s.obs_date
WHEN MATCHED THEN UPDATE SET
  is_closed=?, q=?, m=?, w=?, d=?, macro=?, current_strength=?, composite=?, prev_composite=?,
  momentum=?, acceleration=?, raw_regime=?, regime=?, regime_since=?, candidate=?, candidate_count=?,
  candidate_since=?, duration_obs=?, confidence=?, obs_confidence=?, persistence=?, updated_at=SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (
  asset, obs_date, is_closed, q, m, w, d, macro, current_strength, composite, prev_composite,
  momentum, acceleration, raw_regime, regime, regime_since, candidate, candidate_count,
  candidate_since, duration_obs, confidence, obs_confidence, persistence
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);
"""


def _snapshot_params(r: dict[str, Any]) -> list[Any]:
    body = [
        1 if r["closed"] else 0, r["q"], r["m"], r["w"], r["d"], r["macro"], r["current"], r["composite"],
        r["prev"], r["momentum"], r["acceleration"], r["raw"], r["regime"], r["since"], r["candidate"],
        int(r["candidateCount"]), r["candidateSince"], int(r["duration"]), r["confidence"], r["obsConfidence"],
        r["persistence"],
    ]
    return [r["asset"], r["date"], *body, r["asset"], r["date"], *body]


def _executemany(cur: Any, sql: str, rows: list[list[Any]]) -> None:
    if not rows:
        return
    try:
        cur.fast_executemany = True
        cur.executemany(sql, rows)
    except pyodbc.Error:
        cur.fast_executemany = False
        for row in rows:
            cur.execute(sql, row)


def regime_persist(result: dict[str, Any], meta: dict[str, Any]) -> dict[str, int]:
    """Upsert new/changed snapshots, append confirmed transitions, refresh pair + strength outputs."""
    snapshots = result.get("snapshots") or []
    transitions = result.get("transitions") or []
    pairs = result.get("pairs") or []
    strengths = result.get("strengths") or []
    written_t = 0
    with connect() as conn:
        cur = conn.cursor()
        _executemany(cur, _SNAPSHOT_MERGE, [_snapshot_params(r) for r in snapshots])

        for t in transitions:
            cur.execute(
                """
                IF NOT EXISTS (SELECT 1 FROM dbo.app_regime_transition WHERE asset = ? AND confirmed_at = ?)
                INSERT INTO dbo.app_regime_transition
                  (asset, confirmed_at, first_seen, prev_regime, new_regime, confidence, reason, evidence_json)
                VALUES (?,?,?,?,?,?,?,?)
                """,
                t["asset"], t["confirmedAt"],
                t["asset"], t["confirmedAt"], t["firstSeen"], t["prev"], t["new"], t["confidence"],
                t["reason"][:600], json.dumps(t["evidence"]),
            )
            written_t += max(0, cur.rowcount)

        for p in pairs:
            params = [
                p["base"], p["quote"], p["status"], p["bias"], p["differential"], p["conviction"], p["persistence"],
                p["momentum"], p["confidence"], p["baseRegime"], p["quoteRegime"], p["relationship"],
                p["reason"][:600], p["date"],
            ]
            cur.execute(
                """
                MERGE dbo.app_regime_pair AS t
                USING (SELECT ? AS symbol) AS s ON t.symbol = s.symbol
                WHEN MATCHED THEN UPDATE SET
                  base=?, quote=?, status=?, bias=?, differential=?, conviction=?, persistence=?, momentum=?,
                  confidence=?, base_regime=?, quote_regime=?, relationship=?, reason=?, obs_date=?,
                  updated_at=SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT
                  (symbol, base, quote, status, bias, differential, conviction, persistence, momentum,
                   confidence, base_regime, quote_regime, relationship, reason, obs_date)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);
                """,
                p["symbol"], *params, p["symbol"], *params,
            )

        if strengths:
            cur.execute("DELETE FROM dbo.app_currency_strength")
            for s in strengths:
                cur.execute(
                    "INSERT INTO dbo.app_currency_strength (code, q, m, score, trend, classification) VALUES (?,?,?,?,?,?)",
                    s["code"], s["q"], s["m"], s["score"], s["trend"], s["classification"],
                )

        cur.execute(
            """
            MERGE dbo.app_settings AS t
            USING (SELECT N'regime.last_run' AS [key]) AS s ON t.[key] = s.[key]
            WHEN MATCHED THEN UPDATE SET [value]=?, updated_at=SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT ([key], [value]) VALUES (N'regime.last_run', ?);
            """,
            json.dumps(meta, default=str),
            json.dumps(meta, default=str),
        )
        conn.commit()
    return {"snapshots": len(snapshots), "transitions": written_t, "pairs": len(pairs)}


def save_regime_meta(meta: dict[str, Any]) -> None:
    set_setting("regime.last_run", json.dumps(meta, default=str))


_SNAPSHOT_COLS = """
asset, obs_date, is_closed, q, m, w, d, macro, current_strength, composite, prev_composite, momentum,
acceleration, raw_regime, regime, regime_since, candidate, candidate_count, candidate_since, duration_obs,
confidence, obs_confidence, persistence, updated_at
"""


def _snapshot_dict(d: dict[str, Any]) -> dict[str, Any]:
    return {
        "asset": d["asset"],
        "date": _iso(d["obs_date"]),
        "closed": bool(d["is_closed"]),
        "q": d["q"], "m": d["m"], "w": d["w"], "d": d["d"],
        "macro": d["macro"],
        "current": d["current_strength"],
        "composite": d["composite"],
        "previous": d["prev_composite"],
        "momentum": d["momentum"],
        "acceleration": d["acceleration"],
        "rawRegime": d["raw_regime"],
        "regime": d["regime"],
        "regimeSince": _iso(d["regime_since"]),
        "candidate": d["candidate"],
        "candidateCount": int(d["candidate_count"] or 0),
        "candidateSince": _iso(d["candidate_since"]),
        "durationObs": int(d["duration_obs"] or 0),
        "confidence": d["confidence"],
        "obsConfidence": d["obs_confidence"],
        "persistence": d["persistence"],
        "updatedAt": _iso(d["updated_at"]),
    }


def regime_history(asset: str, limit: int = 260) -> list[dict[str, Any]]:
    limit = max(5, min(int(limit), 2000))
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            f"SELECT TOP ({limit}) {_SNAPSHOT_COLS} FROM dbo.app_regime_snapshot WHERE asset = ? ORDER BY obs_date DESC",
            asset,
        )
        cols = [c[0] for c in cur.description]
        rows = [_snapshot_dict(dict(zip(cols, raw))) for raw in cur.fetchall()]
    rows.reverse()
    return rows


def load_regime_state(history_limit: int = 130) -> dict[str, Any]:
    ensure_regime_schema()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("SELECT [value], updated_at FROM dbo.app_settings WHERE [key] = N'regime.last_run'")
        row = cur.fetchone()
        run = None
        if row:
            try:
                run = json.loads(row[0])
            except Exception:
                run = None

        cur.execute(
            f"""
            SELECT {_SNAPSHOT_COLS} FROM (
              SELECT *, ROW_NUMBER() OVER (PARTITION BY asset ORDER BY obs_date DESC) AS rn
              FROM dbo.app_regime_snapshot
            ) x WHERE rn <= ? ORDER BY asset, obs_date
            """,
            int(history_limit),
        )
        cols = [c[0] for c in cur.description]
        history: dict[str, list[dict[str, Any]]] = {}
        for raw in cur.fetchall():
            snap = _snapshot_dict(dict(zip(cols, raw)))
            history.setdefault(snap["asset"], []).append(snap)

        cur.execute("SELECT asset, COUNT(*) FROM dbo.app_regime_snapshot WHERE is_closed = 1 GROUP BY asset")
        counts = {a: int(c) for a, c in cur.fetchall()}

        cur.execute(
            """
            SELECT symbol, base, quote, status, bias, differential, conviction, persistence, momentum, confidence,
                   base_regime, quote_regime, relationship, reason, obs_date, updated_at
            FROM dbo.app_regime_pair ORDER BY symbol
            """
        )
        pcols = [c[0] for c in cur.description]
        pairs = []
        for raw in cur.fetchall():
            p = dict(zip(pcols, raw))
            pairs.append({
                "symbol": p["symbol"], "base": p["base"], "quote": p["quote"], "status": p["status"],
                "bias": p["bias"], "differential": p["differential"], "conviction": p["conviction"],
                "persistence": p["persistence"], "momentum": p["momentum"], "confidence": p["confidence"],
                "baseRegime": p["base_regime"], "quoteRegime": p["quote_regime"],
                "relationship": p["relationship"], "reason": p["reason"],
                "date": _iso(p["obs_date"]), "updatedAt": _iso(p["updated_at"]),
            })

        cur.execute(
            """
            SELECT TOP 500 id, asset, confirmed_at, first_seen, prev_regime, new_regime, confidence, reason,
                   evidence_json, created_at
            FROM dbo.app_regime_transition ORDER BY confirmed_at DESC, id DESC
            """
        )
        tcols = [c[0] for c in cur.description]
        transitions = []
        for raw in cur.fetchall():
            t = dict(zip(tcols, raw))
            try:
                evidence = json.loads(t["evidence_json"])
            except Exception:
                evidence = {}
            transitions.append({
                "id": int(t["id"]), "asset": t["asset"], "confirmedAt": _iso(t["confirmed_at"]),
                "firstSeen": _iso(t["first_seen"]), "previous": t["prev_regime"], "next": t["new_regime"],
                "confidence": t["confidence"], "reason": t["reason"], "evidence": evidence,
                "createdAt": _iso(t["created_at"]),
            })

        cur.execute("SELECT code, q, m, score, trend, classification FROM dbo.app_currency_strength ORDER BY score DESC")
        scols = [c[0] for c in cur.description]
        strengths = [dict(zip(scols, raw)) for raw in cur.fetchall()]

    run_assets = (run or {}).get("assets") or {}
    assets = []
    for a in ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "XAU"]:
        hist = history.get(a, [])
        meta = run_assets.get(a) or {}
        latest = hist[-1] if hist else None
        status = "CLASSIFIED" if latest and latest["regime"] else meta.get("status") or ("WARMING_UP" if hist else "NO_DATA")
        assets.append({
            "asset": a,
            "kind": "METAL" if a == "XAU" else "FIAT",
            "status": status,
            "latest": latest,
            "history": hist,
            "observations": {
                "collected": counts.get(a, meta.get("collected", 0)),
                "required": meta.get("required") or (run or {}).get("config", {}).get("requiredObs") or 0,
            },
            "bars": {"collected": meta.get("bars"), "required": meta.get("barsRequired")},
            "message": meta.get("message"),
        })

    return {
        "ok": True,
        "run": run,
        "assets": assets,
        "pairs": pairs,
        "transitions": transitions,
        "strengths": strengths,
    }


def append_event(message: str, severity: str = "INFO", source: str = "SYSTEM") -> None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO dbo.app_events (severity, source, message) VALUES (?,?,?)",
            severity,
            source,
            message,
        )
        conn.commit()
