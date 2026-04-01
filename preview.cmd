@echo off
setlocal
cd /d "%~dp0"

set PYTHONUNBUFFERED=1
if "%RETTMARK_OPEN_BROWSER%"=="" set RETTMARK_OPEN_BROWSER=1

where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  py -3 -u preview-server.py
) else (
  python -u preview-server.py
)

if errorlevel 1 (
  echo.
  echo Preview server stopped or failed to start. Read any errors above.
  if not "%RETTMARK_PREVIEW_PAUSE_ON_ERROR%"=="0" pause
)
