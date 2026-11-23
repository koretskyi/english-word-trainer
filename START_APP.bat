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

echo Checking and installing Python dependencies...
python -m pip install -r backend\requirements.txt
if errorlevel 1 (
  echo ERROR: Python dependencies installation failed.
  pause
  exit /b 1
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

echo.
echo Starting local Whisper API on port 8001...
start "Local Whisper API - port 8001" /D "%CD%\backend" cmd /k "python -u -m uvicorn main:app --host 127.0.0.1 --port 8001"

echo Waiting for Whisper API to become ready...
python -c "import time,urllib.request,sys; url='http://127.0.0.1:8001/health'; exec('for i in range(20):\n try:\n  r=urllib.request.urlopen(url,timeout=1); print(r.read().decode()); sys.exit(0)\n except Exception:\n  time.sleep(1)'); print('ERROR: Whisper API did not start on port 8001. Check the Local Whisper API window above.'); sys.exit(1)"
if errorlevel 1 (
  echo.
  echo Whisper API failed to start. React app will not be launched.
  pause
  exit /b 1
)

echo.
echo Whisper API is ready. Starting React app...
echo Keep both terminal windows open while using the app.
call npm run dev
pause
