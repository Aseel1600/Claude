@echo off
chcp 65001 >/dev/null
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT=%%~fI"
if not "%OMNIROUTE_ROOT%"=="" set "ROOT=%OMNIROUTE_ROOT%"
cd /d "%ROOT%"
"%ROOT%\.venv\Scripts\python.exe" -m uvicorn ui.main:app --host 0.0.0.0 --port 20129
