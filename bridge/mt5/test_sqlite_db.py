"""SQL Server -> SQLite translation for queries the engines run against the local database."""

from __future__ import annotations

import json
import sqlite3
import unittest

import sqlite_db


class Translation(unittest.TestCase):
    def test_json_value_runs_on_sqlite(self):
        sql, _ = sqlite_db._translate("SELECT COUNT(*) FROM dbo.app_exec_ledger WHERE setup_key=? AND JSON_VALUE(data_json, '$.consumedAt') IS NOT NULL")
        raw = sqlite3.connect(":memory:")
        raw.execute("CREATE TABLE app_exec_ledger (setup_key TEXT, data_json TEXT)")
        raw.executemany("INSERT INTO app_exec_ledger VALUES (?, ?)", [
            ("K", json.dumps({"consumedAt": "2026-09-30T21:00:00+00:00"})), ("K", json.dumps({"consumedAt": None})), ("K", json.dumps({})),
        ])
        self.assertEqual(raw.execute(sql, ("K",)).fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
