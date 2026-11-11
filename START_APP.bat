@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo English Word Trainer - Local Whisper
echo ==========================================

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not available.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python 3.12 is not installed or not in PATH.
  pause
  exit /b 1
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo ERROR: FFmpeg is not installed or not in PATH.
  pause
  exit /b 1
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  python -m venv backend\.venv
  if errorlevel 1 (
    echo ERROR: Could not create Python virtual environment.
    pause
    exit /b 1
  )
)

if not exist "backend\.venv\Scripts\uvicorn.exe" (
  echo Installing local speech recognition dependencies...
  call backend\.venv\Scripts\python.exe -m pip install --upgrade pip
  call backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
  if errorlevel 1 (
    echo ERROR: Python dependencies installation failed.
    pause
    exit /b 1
  )
)

if not exist "node_modules" (
  echo Installing JavaScript dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

echo Starting local Whisper API in a separate window...
start "Whisper API" cmd /k ""%CD%\backend\.venv\Scripts\python.exe" -m uvicorn main:app --app-dir "%CD%\backend" --host 127.0.0.1 --port 8000"

timeout /t 2 /nobreak >nul

echo Starting React app. Keep both windows open while using it.
call npm run dev
pause
