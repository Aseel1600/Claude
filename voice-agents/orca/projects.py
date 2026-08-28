"""Projekt-Registry für das Life-OS. Projekte liegen als JSON in data/projects/projects.json.

Ein Projekt: {id, name, kind, status, url, note, stats, created, updated}
Kinds: frei (z.B. tiktok | website | kunde)
Status: offen | laeuft | fertig | archiv
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECTS_FILE = Path(__file__).resolve().parent.parent / "data" / "projects" / "projects.json"

STATUSES = ("offen", "laeuft", "fertig", "archiv")
KINDS = ("tiktok", "website", "kunde")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read() -> list[dict]:
    if not PROJECTS_FILE.exists():
        return []
    try:
        return json.loads(PROJECTS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _write(projects: list[dict]) -> None:
    PROJECTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROJECTS_FILE.write_text(json.dumps(projects, ensure_ascii=False, indent=2), encoding="utf-8")


def add_project(name: str, kind: str = "kunde", status: str = "offen", url: str = "", note: str = "", stats: dict | None = None) -> dict:
    if kind not in KINDS:
        kind = "kunde"
    if status not in STATUSES:
        status = "offen"
    project = {
        "id": uuid.uuid4().hex[:10],
        "name": name.strip(),
        "kind": kind,
        "status": status,
        "url": url.strip(),
        "note": note.strip(),
        "stats": stats or {},
        "created": _now(),
        "updated": _now(),
    }
    projects = _read()
    projects.append(project)
    _write(projects)
    return project


def list_projects(kind: str | None = None, status: str | None = None) -> list[dict]:
    projects = _read()
    if kind:
        projects = [p for p in projects if p.get("kind") == kind]
    if status:
        projects = [p for p in projects if p.get("status") == status]
    return sorted(projects, key=lambda p: p.get("updated", ""), reverse=True)


def find(project_id: str) -> dict | None:
    for p in _read():
        if p.get("id") == project_id:
            return p
    return None


def update_project(project_id: str, **fields) -> dict | None:
    projects = _read()
    for p in projects:
        if p.get("id") != project_id:
            continue
        for key in ("name", "kind", "status", "url", "note"):
            if key in fields:
                value = fields[key]
                if key == "status" and value not in STATUSES:
                    continue
                if key == "kind" and value not in KINDS:
                    continue
                p[key] = str(value).strip()
        stats = fields.get("stats")
        if isinstance(stats, dict):
            current = p.get("stats") or {}
            current.update(stats)
            p["stats"] = current
        p["updated"] = _now()
        _write(projects)
        return p
    return None


def delete_project(project_id: str) -> bool:
    projects = _read()
    rest = [p for p in projects if p.get("id") != project_id]
    if len(rest) == len(projects):
        return False
    _write(rest)
    return True


def summary() -> dict:
    projects = _read()
    return {
        "by_status": {s: sum(1 for p in projects if p.get("status") == s) for s in STATUSES},
        "by_kind": {k: sum(1 for p in projects if p.get("kind") == k) for k in KINDS},
        "total": len(projects),
    }