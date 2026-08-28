"""Minimal-Kanban für das Orchester. Karten liegen als JSON in data/kanban/board.json.

Eine Karte: {id, column, title, note, created, updated}
Spalten: todo | doing | done | archive
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

BOARD_FILE = Path(__file__).resolve().parent.parent / "data" / "kanban" / "board.json"

COLUMNS = ("todo", "doing", "done", "archive")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read() -> list[dict]:
    if not BOARD_FILE.exists():
        return []
    try:
        return json.loads(BOARD_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _write(cards: list[dict]) -> None:
    BOARD_FILE.parent.mkdir(parents=True, exist_ok=True)
    BOARD_FILE.write_text(json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8")


def list_cards(column: str | None = None) -> list[dict]:
    cards = _read()
    if column:
        cards = [c for c in cards if c.get("column") == column]
    return sorted(cards, key=lambda c: c.get("created", ""), reverse=True)


def add_card(title: str, note: str = "", column: str = "todo", source: str = "") -> dict:
    if column not in COLUMNS:
        column = "todo"
    card = {
        "id": uuid.uuid4().hex[:10],
        "column": column,
        "title": title.strip(),
        "note": note.strip(),
        "source": source.strip(),
        "created": _now(),
        "updated": _now(),
    }
    cards = _read()
    cards.append(card)
    _write(cards)
    return card


def find(card_id: str) -> dict | None:
    for c in _read():
        if c.get("id") == card_id:
            return c
    return None


def move_card(card_id: str, column: str) -> dict | None:
    if column not in COLUMNS:
        column = "todo"
    cards = _read()
    for c in cards:
        if c.get("id") == card_id:
            c["column"] = column
            c["updated"] = _now()
            _write(cards)
            return c
    return None


def delete_card(card_id: str) -> bool:
    cards = _read()
    rest = [c for c in cards if c.get("id") != card_id]
    if len(rest) == len(cards):
        return False
    _write(rest)
    return True


def summary() -> dict:
    cards = _read()
    return {col: sum(1 for c in cards if c.get("column") == col) for col in COLUMNS}