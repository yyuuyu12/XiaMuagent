@echo off
chcp 65001 >nul
title ASR Service (port 8765)
cd /d "%~dp0"
set PYTHON=C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe
echo [OK] Starting ASR service on port 8765...
"%PYTHON%" -m uvicorn main:app --host 0.0.0.0 --port 8765
pause
