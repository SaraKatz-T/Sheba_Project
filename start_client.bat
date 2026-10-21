@echo off
rem Starts the web client (Vite dev server) on http://localhost:5173
title Sheba - client
cd /d "%~dp0client"
if not exist "node_modules" call npm install
call npm run dev
pause
