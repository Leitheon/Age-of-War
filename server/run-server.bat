@echo off
rem Runs the Age of War server, and starts it again if it ever stops (used by the autostart task; start.bat is for
rem running it by hand in a window). Each restart is noted in data\restarts.log.
cd /d "%~dp0"
if not exist data mkdir data
:again
node src\server.js
echo %date% %time% The server stopped (exit code %errorlevel%); starting it again in 10 seconds.>> data\restarts.log
timeout /t 10 /nobreak >nul
goto again
