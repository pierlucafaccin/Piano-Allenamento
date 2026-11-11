@echo off
cd /d "%~dp0"
title Copenhagen 21K - Sincronizzazione Garmin
py -3 -u sync.py
if errorlevel 1 (
  echo.
  echo Errore: controlla local\sync-output.log e il file .env.local.
)
pause
