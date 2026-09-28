"""Small pyodbc-compatible SQLite adapter for the MT5 runtime stores."""

from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PATH = ROOT / "database" / "db_cacsms-trader.db"
_schema_ready = False

TABLE_MAP = {
    "mt5_accounts": "bridge_mt5_accounts",
    "account_balances": "bridge_account_balances",
}


def database_path() -> Path:
    raw = os.environ.get("DATABASE_URL", "").strip()
    if raw.startswith("file:"):
        path = Path(raw[5:])
        return path if path.is_absolute() else ROOT / path
    return DEFAULT_PATH


def _name(sql: str) -> str:
    sql = re.sub(r"\bdbo\.", "", sql, flags=re.I)
    for old, new in TABLE_MAP.items():
        sql = re.sub(rf"\b{old}\b", new, sql, flags=re.I)
    return sql


def _ddl(sql: str) -> str:
    sql = _name(sql)
    sql = re.sub(r"^\s*open_time\s+AS\s+DATEADD\(.*?PERSISTED,\s*$", "", sql, flags=re.I | re.M)
    sql = re.sub(r"\bN'", "'", sql)
    sql = re.sub(r"\bNVARCHAR\s*\(\s*(?:MAX|\d+)\s*\)", "TEXT", sql, flags=re.I)
    sql = re.sub(r"\bDATETIME2\b", "TEXT", sql, flags=re.I)
    sql = re.sub(r"\bBIGINT\s+IDENTITY\s*\(1,1\)\s+NOT NULL\s+PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT", sql, flags=re.I)
    sql = re.sub(r"\bINT\s+IDENTITY\s*\(1,1\)\s+NOT NULL\s+PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT", sql, flags=re.I)
    sql = re.sub(r"\bBIGINT\b", "INTEGER", sql, flags=re.I)
    sql = re.sub(r"\bFLOAT\b", "REAL", sql, flags=re.I)
    sql = re.sub(r"\bBIT\b", "INTEGER", sql, flags=re.I)
    sql = re.sub(r"\bCONSTRAINT\s+\w+\s+(?=DEFAULT)", "", sql, flags=re.I)
    sql = re.sub(r"\bPRIMARY KEY\s+CLUSTERED\b", "PRIMARY KEY", sql, flags=re.I)
    sql = re.sub(r"SYSUTCDATETIME\(\)", "CURRENT_TIMESTAMP", sql, flags=re.I)
    return sql


def ensure_runtime_schema(raw: sqlite3.Connection) -> None:
    global _schema_ready
    if _schema_ready:
        return
    raw.execute("PRAGMA foreign_keys=ON")
    raw.execute("PRAGMA journal_mode=WAL")
    for path in sorted((ROOT / "database" / "mssql").glob("*.sql")):
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(
            r"IF OBJECT_ID\([^\n]+N'U'\) IS NULL\s*BEGIN\s*(.*?)\s*END\s*GO",
            text,
            flags=re.I | re.S,
        ):
            block = _ddl(match.group(1)).strip()
            block = re.sub(r"^CREATE TABLE\s+", "CREATE TABLE IF NOT EXISTS ", block, count=1, flags=re.I)
            block = re.sub(r"\bCREATE INDEX\s+", "CREATE INDEX IF NOT EXISTS ", block, flags=re.I)
            raw.executescript(block)
    # Columns added by the SQL Server follow-up migration.
    cols = {r[1] for r in raw.execute("PRAGMA table_info(app_vision_instrument)")}
    if "live_tick_ts" not in cols:
        raw.execute("ALTER TABLE app_vision_instrument ADD COLUMN live_tick_ts INTEGER")
    if "live_market_open" not in cols:
        raw.execute("ALTER TABLE app_vision_instrument ADD COLUMN live_market_open INTEGER")
    raw.commit()
    _schema_ready = True


def _translate(sql: str) -> tuple[str, int | None]:
    sql = _name(sql).strip()
    sql = re.sub(r"\bN'", "'", sql)
    sql = re.sub(r"\s+WITH\s*\([^)]*\)", "", sql, flags=re.I)
    sql = re.sub(r"\bCOUNT_BIG\s*\(", "COUNT(", sql, flags=re.I)
    sql = re.sub(r"\bISNULL\s*\(", "COALESCE(", sql, flags=re.I)
    sql = re.sub(r"SYSUTCDATETIME\(\)", "CURRENT_TIMESTAMP", sql, flags=re.I)
    sql = re.sub(r"DATEADD\(\s*SECOND\s*,\s*\?\s*,\s*CURRENT_TIMESTAMP\s*\)", "datetime(CURRENT_TIMESTAMP, (? || ' seconds'))", sql, flags=re.I)
    sql = re.sub(r"DATEADD\(\s*SECOND\s*,\s*(-?\d+)\s*,\s*CURRENT_TIMESTAMP\s*\)", r"datetime(CURRENT_TIMESTAMP, '\1 seconds')", sql, flags=re.I)
    sql = re.sub(r"DATEADD\(\s*HOUR\s*,\s*\?\s*,\s*CURRENT_TIMESTAMP\s*\)", "datetime(CURRENT_TIMESTAMP, (? || ' hours'))", sql, flags=re.I)
    sql = re.sub(r"DATEADD\(\s*DAY\s*,\s*\?\s*,\s*CURRENT_TIMESTAMP\s*\)", "datetime(CURRENT_TIMESTAMP, (? || ' days'))", sql, flags=re.I)
    sql = re.sub(r"DATEADD\(\s*HOUR\s*,\s*(-?\d+)\s*,\s*CURRENT_TIMESTAMP\s*\)", r"datetime(CURRENT_TIMESTAMP, '\1 hours')", sql, flags=re.I)
    sql = re.sub(r"DATEADD\(\s*DAY\s*,\s*(-?\d+)\s*,\s*CURRENT_TIMESTAMP\s*\)", r"datetime(CURRENT_TIMESTAMP, '\1 days')", sql, flags=re.I)
    output = bool(re.search(r"OUTPUT\s+(?:INSERTED|inserted)\.id", sql, flags=re.I))
    sql = re.sub(r"\s+OUTPUT\s+(?:INSERTED|inserted)\.id\s+", " ", sql, flags=re.I)
    top = None
    m = re.search(r"SELECT\s+TOP\s*\(?\s*(\d+)\s*\)?\s+", sql, flags=re.I)
    if m:
        top = int(m.group(1))
        sql = sql[: m.start()] + "SELECT " + sql[m.end() :]
        sql = sql.rstrip().rstrip(";") + f" LIMIT {top}"
    return sql, (1 if output else None)


class Cursor:
    def __init__(self, raw: sqlite3.Cursor):
        self.raw = raw
        self._synthetic: list[tuple] = []
        self.fast_executemany = False

    @property
    def rowcount(self):
        return self.raw.rowcount

    @property
    def description(self):
        return self.raw.description

    def execute(self, sql: str, *params: Any):
        self._synthetic = []
        compact = sql.strip()
        if len(params) == 1 and isinstance(params[0], (list, tuple)):
            params = tuple(params[0])
        object_id = re.match(r"SELECT\s+OBJECT_ID\(N?'(?:dbo\.)?(\w+)'", compact, flags=re.I)
        if object_id:
            table = TABLE_MAP.get(object_id.group(1), object_id.group(1))
            found = self.raw.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
            self._synthetic = [(1 if found else None,)]
            return self
        if re.search(r"\bIF\s+(?:OBJECT_ID|COL_LENGTH)", compact, flags=re.I):
            return self
        conditional = re.match(
            r"IF NOT EXISTS\s*\(SELECT 1 FROM\s+([\w.]+)\s+WHERE\s+(.*?)\)\s*(INSERT INTO.*)",
            compact,
            flags=re.I | re.S,
        )
        if conditional:
            table = _name(conditional.group(1))
            where, insert = conditional.group(2), conditional.group(3)
            count = where.count("?")
            found = self.raw.execute(f"SELECT 1 FROM {table} WHERE {_translate(where)[0]}", params[:count]).fetchone()
            if not found:
                translated, output = _translate(insert)
                self.raw.execute(translated, params[count:])
                if output:
                    self._synthetic = [(self.raw.lastrowid,)]
            return self
        if re.match(r"MERGE\s+", compact, flags=re.I):
            return self._merge(compact, params)
        translated, output = _translate(sql)
        self.raw.execute(translated, params)
        if output:
            self._synthetic = [(self.raw.lastrowid,)]
        return self

    def _merge(self, sql: str, params: tuple[Any, ...]):
        sql = _name(sql)
        table = re.search(r"MERGE\s+(\w+)\s+AS\s+t", sql, flags=re.I).group(1)
        using = re.search(r"USING\s*\(SELECT\s+(.*?)\)\s+AS\s+s", sql, flags=re.I | re.S).group(1)
        keys = re.findall(r"(?:\?|N?'([^']*)')\s+AS\s+\[?(\w+)\]?", using, flags=re.I)
        key_values: list[Any] = []
        p = 0
        for literal, _ in keys:
            if "?" in using.split("AS", len(key_values) + 1)[len(key_values)]:
                key_values.append(params[p]); p += 1
            else:
                key_values.append(literal)
        key_cols = [k[1] for k in keys]
        um = re.search(r"WHEN MATCHED THEN UPDATE SET\s+(.*?)(?=WHEN NOT MATCHED)", sql, flags=re.I | re.S)
        update = um.group(1).strip() if um else ""
        q = update.count("?")
        update_params = params[p:p + q]; p += q
        exists = self.raw.execute(
            f"SELECT 1 FROM {table} WHERE " + " AND ".join(f"[{c}]=?" for c in key_cols), key_values
        ).fetchone()
        if exists and update:
            update, _ = _translate(update)
            self.raw.execute(
                f"UPDATE {table} SET {update} WHERE " + " AND ".join(f"[{c}]=?" for c in key_cols),
                (*update_params, *key_values),
            )
            return self
        if not exists:
            im = re.search(r"WHEN NOT MATCHED THEN INSERT\s*\((.*?)\)\s*VALUES\s*\((.*?)\)", sql, flags=re.I | re.S)
            cols, values = im.group(1), im.group(2)
            values, _ = _translate(values)
            self.raw.execute(f"INSERT INTO {table} ({cols}) VALUES ({values})", params[p:])
        return self

    def executemany(self, sql: str, rows):
        translated, _ = _translate(sql)
        self.raw.executemany(translated, rows)
        return self

    def fetchone(self):
        return self._synthetic.pop(0) if self._synthetic else self.raw.fetchone()

    def fetchall(self):
        if self._synthetic:
            rows, self._synthetic = self._synthetic, []
            return rows
        return self.raw.fetchall()


class Connection:
    def __init__(self, raw: sqlite3.Connection):
        self.raw = raw

    def cursor(self):
        return Cursor(self.raw.cursor())

    def commit(self):
        self.raw.commit()

    def close(self):
        self.raw.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.raw.commit()
        else:
            self.raw.rollback()
        self.raw.close()


def connect() -> Connection:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = sqlite3.connect(path, timeout=30, check_same_thread=False)
    ensure_runtime_schema(raw)
    return Connection(raw)
