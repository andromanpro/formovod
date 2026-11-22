@echo off
setlocal
set "PYTHONUTF8=1"
if not exist "%~dp0.venv\Scripts\python.exe" (
  py -3.14 -m venv "%~dp0.venv"
  if errorlevel 1 exit /b 1
)
"%~dp0.venv\Scripts\python.exe" -m pip install -r "%~dp0requirements.txt"
if errorlevel 1 exit /b 1
"%~dp0.venv\Scripts\python.exe" -m playwright install chromium
exit /b %errorlevel%
