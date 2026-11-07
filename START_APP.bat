@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo English Word Trainer - MVP v1
echo ==========================================

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  echo Install Node.js 22, then close and reopen this window.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not available. Reinstall Node.js with npm included.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing packages for the first run...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed. Check your internet connection and terminal output.
    pause
    exit /b 1
  )
)

echo Starting app. Keep this window open while using the app.
call npm run dev
pause
