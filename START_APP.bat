@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo English Word Trainer - YouTube Subtitles
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

echo Checking YouTube subtitle packages...
python -c "import yt_dlp, fastapi, uvicorn" >nul 2>nul
if errorlevel 1 (
  echo Installing only missing Python packages into your existing Python installation...
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

echo Starting YouTube Subtitles API in a separate window...
start "YouTube Subtitles API" cmd /k "cd /d "%CD%\backend" && python -m uvicorn main:app --host 127.0.0.1 --port 8000"

timeout /t 2 /nobreak >nul

echo Starting React app. Keep both windows open while using it.
call npm run dev
pause
