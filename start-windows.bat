@echo off
title NBA Matchup Lab
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required. Install the LTS version from https://nodejs.org/
    echo Then double-click this file again.
    pause
    exit /b 1
)
start "" "http://localhost:3000"
node server.js
pause
