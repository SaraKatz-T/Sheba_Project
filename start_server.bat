@echo off
rem Starts the API server with the project's own Python (server\venv)
title Sheba - server
cd /d "%~dp0server"
if not exist "venv\Scripts\python.exe" (
  echo The Python environment is missing: server\venv
  pause
  exit /b 1
)
"venv\Scripts\python.exe" run_server.py
pause
