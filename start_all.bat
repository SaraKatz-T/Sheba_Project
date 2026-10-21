@echo off
rem Starts the server and the client, each in its own window, then opens the browser
start "Sheba - server" cmd /c ""%~dp0start_server.bat""
start "Sheba - client" cmd /c ""%~dp0start_client.bat""
timeout /t 8 /nobreak >nul
start "" http://localhost:5173
