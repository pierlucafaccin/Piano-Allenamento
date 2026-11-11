@echo off
cd /d "%~dp0"
title Copenhagen 21K - Dashboard privata
py -3 server.py
if errorlevel 1 (
  echo.
  echo Verifica che Python 3 sia installato e che la porta 8766 sia disponibile.
  pause
)
