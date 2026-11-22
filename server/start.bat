@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist "client\EvonyClient1921.swf" (echo Copy EvonyClient1921.swf into the client folder first: the server reads the game's data from it. & pause & exit /b 1)
if not exist "art\flash" (echo Put the game art in the art folder first ^(flash, tiles, _uiassets, heroes, fonts, login-bg.jpg, mapTile.jpg^). & pause & exit /b 1)
title Age of War server
node src\server.js
pause
