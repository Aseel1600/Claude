# voice-agents — Domain-Glossar

Domain-Vokabular für Architektur-Arbeit an diesem Repo. Namen aus diesem Glossar
verwenden, wenn über Module und Seams gesprochen wird — nicht „Service", „API"
oder „Boundary".

## Kernbegriffe

| Begriff | Bedeutung |
|---|---|
| **ORCA** | Orchestrierungs-Layer: Job-Queue, Skills, Worker, Routing, Scheduler. Host-seitige Steuerung der Agenten-Arbeit. |
| **Control Room** | Die ArcRift-UI (`ui/static/index.html`), Frontend für Kanban, Jobs, Memory-Graph, Chat, Settings. |
| **Kanban** | Das Aufgaben-Board (`orca/kanban.py`): Karten in Spalten `todo → doing → done → archive`. Persistenz: `data/kanban/board.json`. |
| **Job-Queue** | Die asynchrone Arbeitswarteschlange (`orca/queue.py`): Jobs mit Status `queued → running → done | failed`, persistiert in `data/jobs.db` (SQLite, WAL-Fallback). |
| **Job** | Ein Eintrag in der Queue: `id`, `skill`, `input`, `result`, `status`, `trigger`, Zeitstempel. |
| **Skill** | Eine ausführbare Fähigkeit (`orca/skills.py` + `skills/*.md`): `description`, `model`, `pipeline`. Skill-Dateien sind untracked (Mount statt Image). |
| **Worker** | `orca/worker.py` — asyncio-Task, claimt atomar (`claim_next_queued`) und führt Jobs aus. Läuft in der UI-App, nie als eigener Port. |
| **Routing** | `orca/routing.py` — deterministische Befehls-zu-Skill-Zuordnung über `ROUTE_ALIASES` (deutsche Schlüsselwörter), Confidence-basiert. |
| **Ledger** | JSONL-Eintragsbuch (`data/ledger/<datum>.jsonl`): `task`- und `income`-Einträge. |
| **Beacon** | `POST /beacon` — Agenten melden `status`/`detail`/`last_seen`; `data/agent_status.json`. |
| **Memory-Layer** | `/memory`-Endpoint — baut den Wissensgraphen (Nodes/Links/Triples) aus Kanban, Jobs, Skills, Artifacts, Agenten. |

## Job-Status

`queued` (wartet) → `running` (geclaimt, `job.started`) → `done` (Ergebnis) | `failed` (Fehler, `error`-Feld).
Events werden je Job in `job_events` persistiert (`job.created`, `job.started`, `job.completed`, `job.failed`) und per SSE repliziert.

## Modul-Landkarte (Tiefe)

| Modul | Zweck | Seam |
|---|---|---|
| `ui/main.py` | FastAPI-Entrypoint, 39 Routen | Dünne HTTP-Adapter; Domain-Logik delegiert an `orca/*` |
| `ui/auth.py` | JWT-Auth (`/api/auth/*`), Default-User admin/admin | `get_current_user`, `require_auth` |
| `ui/tests/` | Playwright-Suite (`control_room_test.py`) + pytest (`test_*.py`) | Live-UI nötig (Port 20129, Container) |
| `orca/queue.py` | Job-Persistenz + atomares Claiming | `create_job`, `claim_next_queued`, `events_since` |
| `orca/kanban.py` | Board-Logik | `list_cards`, `add_card`, `move_card`, `delete_card`, `summary` |
| `orca/projects.py` | Projektverwaltung (Kunden-Projekte, Status/Kinds) | `add_project`, `update_project`, `list_projects` |
| `orca/skills.py` | Skill-Registry + LLM-Ausführung | `list_skills`, `load_skill`, `_llm_call` |
| `orca/worker.py` | Job-Ausführung (asyncio-Task in der UI-App) | `claim_next_queued` → `skills.load_skill` |
| `orca/routing.py` | Befehls-Routing | `route_command(text, skills)` → `RoutingDecision` |
| `orca/scheduler.py` | Cron-ähnliche Job-Auslösung (60s-Tick) | `run_scheduled_jobs` |
| `orca/service_health.py` | Stack-Health-Proben (Hinweis: 8081-Probe ist Fehl-Spec, siehe Memory) | — |
| `orca/notify.py` | Event-Notifier-Singleton | — |

## Bekannte Seams & offene Architektur-Fragen

- **LLM-Call dupliziert:** `ui/main.py:ask_llm` und `orca/skills.py:_llm_call` bauen beide
  `chat/completions`-Calls mit eigenem Bearer-Guard — nachgewiesene Duplikationskosten
  (dieselbe Leerkey-Reparatur musste doppelt gemacht werden). Kandidat: gemeinsames `orca/llm.py`.
- **`/memory`-Graph-Builder** (~180 Zeilen inline in `ui/main.py`) ist eine pure Transformation
  über 5 Quellen — Kandidat für `orca/memory_graph.py`.
- **Ledger** hat (anders als Kanban/Queue/Projects) kein eigenes `orca/*`-Modul — Muster-Inkonsistenz.
- **Betrieb:** Produktion = Container `omniroute-ui` (Port 20129, `OMNIROUTE_ROOT=B:\OmniRoute\voice-agents`);
  Skills/Data/Static als Mounts, nicht im Image. Preflight-Gate `scripts/verify_b_drive_migration.py`
  vor Live-Suite und Cutover. Siehe `docs/superpowers/runbooks/b-drive-ui-cutover.md`.
