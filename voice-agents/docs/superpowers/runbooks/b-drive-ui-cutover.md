# Runbook: Reversibler B:-Cutover des OmniRoute Control Rooms

Ziel: Produktiven UI-Container (`omniroute-ui`, Port 20129) von C:-Mounts auf
`B:\OmniRoute\voice-agents` umstellen, ohne Datenverlust und mit dokumentiertem
Rollback. Secrets (`.env`, `client_secrets.json`) werden dabei nie kopiert oder
geloggt; die `.env` wird separat am B:-Arbeitsstand bereitgestellt.

Gültig für: `docker-compose.ui.yml` mit `OMNIROUTE_ROOT`-Parametrisierung,
`Dockerfile.ui`, `ui/run-ui.cmd`, `ui/tests/run_ui_test.cmd`.

## Voraussetzungen

- Isolierter Worktree `B:\OmniRoute\.worktrees\b-drive-ui-migration` mit grüner
  Offline-Suite (Migrationssuite 7 passed, Regressionssuite grün).
- `Dockerfile.ui` + `.dockerignore` liegen im Worktree (C:-frei geprüft).
- `data/kanban/board.json` ist auf C: und B: byteidentisch.
- Produktiver Container läuft unverändert auf C:-Mounts (Port 20129).

## 1. Preflight

```bat
set OMNIROUTE_ROOT=B:\OmniRoute\voice-agents
python scripts\verify_b_drive_migration.py --root "%OMNIROUTE_ROOT%" ^
  --required docker-compose.ui.yml ui\main.py ui\static\index.html data\kanban\board.json ^
  --forbidden .env client_secrets.json
if errorlevel 1 (
  echo PREFLIGHT FEHLGESCHLAGEN - Cutover ABBRECHEN
  exit /b 1
)
```

Erwartung: Exit 0, keine missing-/forbidden-Fehler. Das Gate ist maschinell
erzwungen: Abbruch bei Exit != 0. Derselbe Aufruf (mit dem auf den getesteten
Baum passenden `--required`-Set ohne `board.json`) steckt in
`ui/tests/run_ui_test.cmd` und läuft dort vor jedem Suite-Start.

## 2. Backup (vor jedem Stopp)

```bat
copy /Y B:\OmniRoute\voice-agents\data\kanban\board.json B:\OmniRoute\voice-agents\data\kanban\board.json.bak-cutover
fc /b B:\OmniRoute\voice-agents\data\kanban\board.json B:\OmniRoute\voice-agents\data\kanban\board.json.bak-cutover
```

Erwartung: `fc` meldet keine Unterschiede. Zusätzlich bleibt der C:-Stand als
Original erhalten; erst nach erfolgreicher B:-Verifikation darf das Backup
archiviert werden. Auch `data/jobs.db` (+ WAL) in dasselbe Backup-Verzeichnis
kopieren, wenn es existiert.

## 3. Image bauen (berührt den laufenden Container nicht)

```bat
cd /d B:\OmniRoute\.worktrees\b-drive-ui-migration\voice-agents
set OMNIROUTE_ROOT=B:\OmniRoute\voice-agents
docker compose -f docker-compose.ui.yml build
```

Erwartung: Build erfolgreich; kein `.env`/Git-Metadaten im Image
(`.dockerignore` schließt sie aus).

## 4. Nur den UI-Container stoppen

```bat
cd /d B:\OmniRoute\.worktrees\b-drive-ui-migration\voice-agents
docker compose -f docker-compose.ui.yml down
```

Nur der UI-Dienst wird gestoppt; andere Dienste bleiben unberührt.

## 5. B:-gemounteten Container starten

```bat
set OMNIROUTE_ROOT=B:\OmniRoute\voice-agents
docker compose -f docker-compose.ui.yml up -d
```

## 6. Verifikation

```bat
docker inspect omniroute-ui --format "{{json .Mounts}}"
curl -f http://127.0.0.1:20129/health
curl -f http://127.0.0.1:20129/api/auth/ok
fc /b B:\OmniRoute\voice-agents\data\kanban\board.json B:\OmniRoute\voice-agents\data\kanban\board.json.bak-cutover
```

Erwartung: Mount-Sources beginnen mit `B:\OmniRoute\voice-agents`, beide
Endpunkte liefern HTTP 200, Container-Status `healthy`, `fc` ohne Differenz.

## 7. UI-Suite

```bat
set UI_BASE=http://127.0.0.1:20129
set OMNIROUTE_ROOT=B:\OmniRoute\voice-agents
B:\OmniRoute\voice-agents\.venv\Scripts\python.exe B:\OmniRoute\voice-agents\ui\tests\control_room_test.py
```

Erwartung: Exit 0, voller passed-Count. Für die Testumgebung gilt
`requirements-ui-test.txt` (`playwright==1.62.0`).

## 8. Ergebnis festhalten

Zeitstempel, Mount-Sources, Endpunkt-Status, Container-Health, Board-Vergleich
und Suite-Ergebnis dokumentieren — niemals Tokens, Secrets oder Credentials
enthaltende Response-Bodies.

## Rollback (jederzeit, solange C:-Baum unverändert)

```bat
cd /d C:\OmniRoute\voice-agents
docker compose -f docker-compose.ui.yml down
docker compose -f docker-compose.ui.yml up -d
curl -f http://127.0.0.1:20129/health
```

Erwartung: Container startet wieder mit C:-Mounts (`C:\OmniRoute\voice-agents\data`
und `...\ui\static`), `/health` liefert 200. Erst wenn der B:-Betrieb mehrere
Stunden stabil ist, darf entschieden werden, ob der C:-Baum read-only bleibt
oder archiviert wird — Löschen ist explizit nicht Teil dieses Runbooks.

## Durchführung (2026-08-27, erfolgreich)

- Preflight: Exit 0 (keine missing-/forbidden-Fehler).
- Backup: `board.json.bak-cutover` + `jobs.db.bak-cutover` byteidentisch.
- Build: `docker compose -f docker-compose.ui.yml build` erfolgreich (Cache).
- Trockenlauf: `omniroute-ui-dryrun` auf 20139 mit B:-Mounts → `healthy`, `/health`
  + `/api/auth/ok` 200, Mount-Sources B:, `sessionCount` 25 (B:-Board gelesen),
  `board.json` unverändert; Container danach entfernt. Dabei Orphan-PID 23036
  (verwaister nativer Testserver auf 20139) beendet.
- Root Cause `/health` 500 (Produktion vor Swap): `jobs.db` im Modus
  `journal_mode=WAL` (von Host-Prozess gesetzt) ließ sich über den Docker-
  Desktop-gRPC-FUSE-Bind-Mount nicht öffnen → `queue.counts()` warf → 500 →
  Container `unhealthy`. Fix: `orca/queue.py` `set_journal_mode()` mit
  WAL→DELETE-Fallback + `/health` fängt `queue.counts()` ab (wie `kanban`).
- Swap: `down` + `up -d` mit `OMNIROUTE_ROOT=B:\OmniRoute\voice-agents`;
  `/health` 200 nach 4s, Container `healthy`, Mount-Sources
  `B:\OmniRoute\voice-agents\data` + `...\ui\static`, `board.json`
  byteidentisch zum Backup, RestartCount 0.
- UI-Suite gegen 20129: **30/31 passed**. Einziger Fehler: `UI_ACCESS_TOKEN`
  fehlt in `.env` am B:-Arbeitsstand (Secrets werden bewusst nicht kopiert).
  Sobald die `.env` separat bereitgestellt ist, erneut ausführen für 31/31.
