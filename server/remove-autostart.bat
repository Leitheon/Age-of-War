@echo off
rem Stops the Age of War server that install-autostart.bat started, and removes the task. Run as administrator.
rem (Only this folder's run-server.bat and the server it started are stopped, not any other Node program.)
cd /d "%~dp0"
net session >nul 2>&1 || (echo Right-click remove-autostart.bat and choose "Run as administrator". & pause & exit /b 1)
schtasks /delete /tn "Age of War server" /f
powershell -NoProfile -ExecutionPolicy Bypass -Command "$bat = (Join-Path '%~dp0' 'run-server.bat'); Get-CimInstance Win32_Process -Filter \"name='cmd.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($bat) } | ForEach-Object { $kids = Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force; $kids | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } }"
echo Done: the server is stopped and no longer starts by itself.
pause
