@echo off
cd /d "%~dp0"
echo Specifica la cartella originale di garmin-dashboard (con pull.py e data).
set /p SRC=Percorso completo: 
py -3 import_existing.py "%SRC%"
pause
