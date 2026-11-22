@echo off
setlocal
if exist "%~dp0.venv\Scripts\python.exe" (
  "%~dp0.venv\Scripts\python.exe" -B -X utf8 %*
) else (
  py -3.14 -B -X utf8 %*
)
exit /b %errorlevel%
