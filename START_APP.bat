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
  echo ERROR: Python is not installed or not in PATH.
  pause
  exit /b 1
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo ERROR: FFmpeg is not installed or not in PATH.
  echo Install FFmpeg, add it to PATH, then restart this script.
  pause
  exit /b 1
)

echo Checking local Whisper and application packages...
python -c "import yt_dlp, fastapi, uvicorn, faster_whisper, numpy" >nul 2>nul
if errorlevel 1 (
  echo Installing missing Python dependencies...
  python -m pip install -r backend\requirements.txt
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

echo Starting local Whisper and YouTube Subtitles API...
start "Local Whisper API" cmd /k "cd /d "%CD%\backend" && python -m uvicorn main:app --host 127.0.0.1 --port 8000"

timeout /t 2 /nobreak >nul

echo Starting React app. Keep both windows open while using it.
call npm run dev
pause
