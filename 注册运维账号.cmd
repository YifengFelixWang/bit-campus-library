@echo off
cd /d "%~dp0"
python scripts\register_ops1.py
set "REGISTER_EXIT=%ERRORLEVEL%"
pause
exit /b %REGISTER_EXIT%
