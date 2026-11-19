@echo off
cd /d "%~dp0"
python scripts\run_library.py %*
if errorlevel 1 pause
