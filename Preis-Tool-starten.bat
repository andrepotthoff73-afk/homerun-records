@echo off
title Homerun Records - Preis-Tool
cd /d "%~dp0preis-tool"
where node >nul 2>nul || (echo Node.js fehlt. Bitte von https://nodejs.org installieren. & pause & exit /b)
if not exist node_modules (
  echo Einmalige Einrichtung, bitte kurz warten ...
  call npm install --silent
)
start "" http://localhost:4410/
node tool.mjs
pause
