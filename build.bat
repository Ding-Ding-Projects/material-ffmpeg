@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
set "SILENT_FLAG="
if /I "%~1"=="/s" set "SILENT_FLAG=-Silent"
if /I "%~1"=="--silent" set "SILENT_FLAG=-Silent"
if "%SILENT%"=="1" set "SILENT_FLAG=-Silent"
echo [build] Starting runnable application build from "%SCRIPT_DIR%".
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\build.ps1" %SILENT_FLAG%
if errorlevel 1 (
  echo [build] Failed. See the exact phase error above.
  exit /b 1
)
exit /b 0
