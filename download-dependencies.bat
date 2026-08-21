@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
set "SILENT_FLAG="
if /I "%~1"=="/s" set "SILENT_FLAG=-Silent"
if /I "%~1"=="--silent" set "SILENT_FLAG=-Silent"
if "%SILENT%"=="1" set "SILENT_FLAG=-Silent"
echo [dependencies] Starting dependency bootstrap from "%SCRIPT_DIR%".
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\download-dependencies.ps1" %SILENT_FLAG%
if errorlevel 1 (
  echo [dependencies] Failed. See the exact dependency and source error above.
  exit /b 1
)
echo [dependencies] Complete.
exit /b 0
