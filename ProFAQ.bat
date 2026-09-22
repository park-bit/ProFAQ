@echo off
setlocal
cd /d "%~dp0"
title ProFAQ Desktop

:: Keep all caches, temporary files, and WebView2 data inside ./data (0 MB on C: drive)
set "DATA_DIR=%~dp0data"
set "HF_HOME=%DATA_DIR%\hf_cache"
set "TRANSFORMERS_CACHE=%DATA_DIR%\hf_cache\hub"
set "TORCH_HOME=%DATA_DIR%\torch_cache"
set "WEBVIEW2_USER_DATA_FOLDER=%DATA_DIR%\webview2_data"
set "TEMP=%DATA_DIR%\tmp"
set "TMP=%DATA_DIR%\tmp"
set "XDG_CACHE_HOME=%DATA_DIR%\.cache"
set "TIKTOKEN_CACHE_DIR=%DATA_DIR%\tiktoken_cache"

if not exist "%DATA_DIR%\tmp" mkdir "%DATA_DIR%\tmp"
if not exist "%DATA_DIR%\webview2_data" mkdir "%DATA_DIR%\webview2_data"
if not exist "%DATA_DIR%\hf_cache" mkdir "%DATA_DIR%\hf_cache"

if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" "%~dp0run_app.py"
) else (
    echo [ERROR] Python virtual environment not found at .venv\Scripts\python.exe
    pause
)
endlocal
