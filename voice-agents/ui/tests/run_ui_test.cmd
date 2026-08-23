@echo off
rem ============================================================
rem  Control-Room UI-Test (CI-artig): faehrt den Server selbst
rem  hoch und fuehrt den Playwright-Test headless aus.
rem  Nutzung: ui\tests\run_ui_test.cmd [port]
rem ============================================================
chcp 65001 >nul
setlocal
set PORT=%1
if "%PORT%"=="" set PORT=20139
set ROOT=C:\OmniRoute\voice-agents
set SKILL=C:\Users\Sebastian\.agents\skills\webapp-testing
set PY=%ROOT%\.venv\Scripts\python.exe

echo [ui-test] Server auf Port %PORT% starten ...
"%PY%" "%SKILL%\scripts\with_server.py" ^
  --server "cd /d %ROOT% && %PY% -m uvicorn ui.main:app --host 0.0.0.0 --port %PORT%" ^
  --port %PORT% ^
  --timeout 40 ^
  -- %PY% "%ROOT%\ui\tests\run_test_with_base.py" "http://127.0.0.1:%PORT%/"
set EXIT=%ERRORLEVEL%
echo [ui-test] Exit-Code: %EXIT%
exit /b %EXIT%
