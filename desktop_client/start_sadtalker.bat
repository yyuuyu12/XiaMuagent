@echo off
chcp 65001 >nul
title SadTalker Service
cd /d "%~dp0"

if not exist "SadTalkerenv\Scripts\python.exe" (
    echo [ERROR] not found
    pause
    exit /b 1
)

echo [OK] Starting SadTalker server on port 7861...
SadTalkerenv\Scripts\python.exe sadtalker_server.py
pause
