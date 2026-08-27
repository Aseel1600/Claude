import subprocess
import sys
from pathlib import Path

from scripts.verify_b_drive_migration import compare_files, verify_tree


def test_verify_tree_reports_missing_required_and_forbidden_files(tmp_path: Path):
    (tmp_path / "present.txt").write_text("ok", encoding="utf-8")
    (tmp_path / ".env").write_text("secret", encoding="utf-8")
    errors = verify_tree(tmp_path, ("present.txt", "missing.txt"), (".env",))
    assert "missing: missing.txt" in errors
    assert "forbidden: .env" in errors


def test_compare_files_requires_identical_bytes(tmp_path: Path):
    left = tmp_path / "left"
    right = tmp_path / "right"
    left.write_bytes(b"same")
    right.write_bytes(b"same")
    assert compare_files(left, right)
    right.write_bytes(b"different")
    assert not compare_files(left, right)


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(Path(__file__).parents[2] / "scripts" / "verify_b_drive_migration.py"),
            *args,
        ],
        capture_output=True,
        text=True,
        check=False,
    )


def test_cli_reports_failed_preflight(tmp_path: Path):
    result = run_cli("--root", str(tmp_path), "--required", "missing.txt")
    assert result.returncode == 1
    assert result.stdout.strip() == "missing: missing.txt"


def test_launchers_resolve_configured_root_without_c_drive_dependency():
    root = Path(__file__).parents[2]
    compose = (root / "docker-compose.ui.yml").read_text(encoding="utf-8")
    launcher = (root / "ui" / "run-ui.cmd").read_text(encoding="utf-8")
    runner = (root / "ui" / "tests" / "run_ui_test.cmd").read_text(encoding="utf-8")

    assert "${OMNIROUTE_ROOT:-.}" in compose
    assert "OMNIROUTE_ROOT" in launcher
    assert "OMNIROUTE_ROOT" in runner
    assert "C:\\OmniRoute" not in launcher
    assert "C:\\OmniRoute" not in runner


def test_runtime_files_do_not_require_c_drive_paths():
    root = Path(__file__).parents[2]
    main = (root / "ui" / "main.py").read_text(encoding="utf-8")
    browser_test = (root / "ui" / "tests" / "control_room_test.py").read_text(encoding="utf-8")

    assert r"C:\\OmniRoute" not in main
    assert r"C:\\OmniRoute" not in browser_test
    assert "OMNIROUTE_ROOT" in main
    assert "OMNIROUTE_ROOT" in browser_test


def test_cli_accepts_valid_tree_and_identical_compare(tmp_path: Path):
    required = tmp_path / "present.txt"
    left = tmp_path / "left"
    right = tmp_path / "right"
    required.write_text("ok", encoding="utf-8")
    left.write_bytes(b"same")
    right.write_bytes(b"same")

    result = run_cli(
        "--root",
        str(tmp_path),
        "--required",
        "present.txt",
        "--compare",
        str(left),
        str(right),
    )
    assert result.returncode == 0
    assert result.stdout == ""


def test_playwright_dependency_is_test_only_and_pinned():
    root = Path(__file__).parents[2]
    runtime = (root / "requirements-ui.txt").read_text(encoding="utf-8")
    test_reqs = root / "requirements-ui-test.txt"
    assert "playwright" not in runtime.lower()
    assert test_reqs.is_file()
    pinned = test_reqs.read_text(encoding="utf-8")
    assert "playwright==1.62.0" in pinned


def test_dockerignore_excludes_secrets():
    root = Path(__file__).parents[2]
    dockerignore = (root / ".dockerignore").read_text(encoding="utf-8")
    assert ".env*" in dockerignore
    assert "client_secrets.json" in dockerignore


def test_run_ui_test_cmd_enforces_preflight_gate():
    root = Path(__file__).parents[2]
    runner = (root / "ui" / "tests" / "run_ui_test.cmd").read_text(encoding="utf-8")
    assert "verify_b_drive_migration.py" in runner
    assert '--root "%ROOT%"' in runner
    assert "errorlevel" in runner
    assert "exit /b 1" in runner


def test_cutover_runbook_enforces_preflight_gate():
    root = Path(__file__).parents[2]
    runbook = root / "docs" / "superpowers" / "runbooks" / "b-drive-ui-cutover.md"
    text = runbook.read_text(encoding="utf-8")
    preflight = text.split("## 1. Preflight", 1)[1].split("## 2.", 1)[0]
    assert "verify_b_drive_migration.py" in preflight
    assert "if errorlevel 1" in preflight


def test_cutover_runbook_has_backup_and_rollback_sections():
    root = Path(__file__).parents[2]
    runbook = root / "docs" / "superpowers" / "runbooks" / "b-drive-ui-cutover.md"
    text = runbook.read_text(encoding="utf-8")
    assert "Backup" in text
    assert "Rollback" in text
    assert r"B:\OmniRoute\voice-agents" in text
    assert "20129" in text


def _load_llm():
    import asyncio
    import importlib.machinery

    mod = {"captured": {}, "asyncio": asyncio}

    class FakeResp:
        status_code = 200

        def __init__(self, data=None):
            self._data = data or {"choices": [{"message": {"content": "Antwort"}}]}

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

        def json(self):
            return self._data

    class FakeClient:
        async def post(self, url, json=None, headers=None, timeout=None):
            mod["captured"].update(url=url, json=json, headers=headers, timeout=timeout)
            return FakeResp()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

    root = Path(__file__).parents[2]
    loader = importlib.machinery.SourceFileLoader("orca_llm_under_test", str(root / "orca" / "llm.py"))
    llm = loader.load_module()
    llm.httpx.AsyncClient = lambda **kw: FakeClient()
    return llm, mod


def test_chat_sends_messages_model_and_uses_bearer_only_with_key():
    llm, m = _load_llm()
    out = m["asyncio"].run(llm.chat(
        [{"role": "system", "content": "sys"}, {"role": "user", "content": "frag"}],
        model="auto/best-chat",
        timeout=7.0,
        base_url="http://test/v1",
        api_key="k",
    ))
    assert out == "Antwort"
    assert m["captured"] == {
        "url": "http://test/v1/chat/completions",
        "json": {
            "model": "auto/best-chat",
            "messages": [{"role": "system", "content": "sys"}, {"role": "user", "content": "frag"}],
            "stream": False,
        },
        "headers": {"Authorization": "Bearer k"},
        "timeout": 7.0,
    }


def test_chat_omits_bearer_header_when_key_empty():
    llm, m = _load_llm()
    m["asyncio"].run(llm.chat(
        [{"role": "user", "content": "x"}],
        model="m",
        timeout=1.0,
        base_url="http://test/v1",
        api_key="",
    ))
    assert m["captured"]["headers"] == {}
