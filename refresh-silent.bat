@echo off
cd /d "%~dp0"
py -3 -u sync.py >> "local\scheduler.log" 2>&1
