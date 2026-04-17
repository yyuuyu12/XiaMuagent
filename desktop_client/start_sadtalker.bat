@echo off
chcp 65001 >nul
title SadTalker Service (port 7861)
cd /d "%~dp0"
if not exist "SadTalker\venv\Scripts\python.exe" (
    echo [ERROR] SadTalker\venv\Scripts\python.exe not found
    pause
    exit /b 1
)
echo [OK] Starting SadTalker server on port 7861...
"SadTalker\venv\Scripts\python.exe" sadtalker_server.py
pause
