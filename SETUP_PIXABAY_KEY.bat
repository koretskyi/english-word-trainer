@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0SETUP_PIXABAY_KEY.ps1"
if errorlevel 1 (
  echo.
  echo Could not save the Pixabay key.
  pause
  exit /b 1
)
echo.
echo Done. Restart START_APP.bat to load the key.
pause
