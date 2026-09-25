@echo off
setlocal
cd /d "%~dp0"
title ProFAQ Desktop Setup and Launch

if not exist ".venv\Scripts\python.exe" (
    echo [INFO] First-time setup: creating virtual environment and installing dependencies...
    powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\setup_dev.ps1"
)

if exist "ProFAQ.exe" (
    start "" "ProFAQ.exe"
) else (
    call "ProFAQ.bat"
)
endlocal
