@echo off
rem Starts the Age of War server whenever this PC starts, before anyone signs in: a scheduled task that runs
rem run-server.bat as SYSTEM, 30 seconds after start-up. Run this once, as administrator. remove-autostart.bat undoes it.
cd /d "%~dp0"
net session >nul 2>&1 || (echo Right-click install-autostart.bat and choose "Run as administrator". & pause & exit /b 1)
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
schtasks /create /tn "Age of War server" /tr "\"%~dp0run-server.bat\"" /sc onstart /delay 0000:30 /ru SYSTEM /rl highest /f
if errorlevel 1 (echo Could not create the task. & pause & exit /b 1)
echo.
echo Done: the server will start by itself whenever this PC starts.
echo Starting it now as well. (Don't also run start.bat while it's running: both want the same port.)
schtasks /run /tn "Age of War server"
pause
