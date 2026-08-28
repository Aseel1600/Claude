import sqlite3

from orca import queue


class _FakeConn:
    def __init__(self, fail_wal: bool) -> None:
        self.fail_wal = fail_wal
        self.calls: list[str] = []

    def execute(self, sql: str, *args):
        self.calls.append(sql)
        if self.fail_wal and "journal_mode=WAL" in sql:
            raise sqlite3.OperationalError("unable to open database file")


def test_journal_mode_falls_back_when_wal_unavailable():
    conn = _FakeConn(fail_wal=True)
    queue.set_journal_mode(conn)
    assert "PRAGMA journal_mode=WAL" in conn.calls
    assert any("journal_mode=DELETE" in sql for sql in conn.calls)


def test_journal_mode_keeps_wal_when_supported():
    conn = _FakeConn(fail_wal=False)
    queue.set_journal_mode(conn)
    assert conn.calls == ["PRAGMA journal_mode=WAL"]
