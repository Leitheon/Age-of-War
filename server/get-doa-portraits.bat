@echo off
rem Downloads DoA's portraits for the historic heroes that have none here, into art\heroes. Nothing already there is replaced.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
node tools\get-doa-portraits.js %*
pause
