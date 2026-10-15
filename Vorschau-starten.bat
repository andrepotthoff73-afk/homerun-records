@echo off
title Homerun Records - Vorschau
cd /d "%~dp0vorschau"
where node >nul 2>nul || (echo Node.js fehlt. Bitte von https://nodejs.org installieren. & pause & exit /b)
if not exist node_modules (
  echo Einmalige Einrichtung, bitte kurz warten ...
  call npm install --silent
)
start "" http://localhost:4321/
node server.mjs
pause
