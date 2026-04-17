@echo off
chcp 65001 >nul
title HeyGem Service (port 7861)
cd /d "%~dp0"
set PATH=C:\ProgramData\Waves Audio\Modules\AdditionalDLLs_x64;%PATH%
set PYTHON=C:\ChaojiIP\aigc-human\python-modules\humanModule\venv\python.exe
echo [OK] Starting HeyGem digital human server on port 7861...
"%PYTHON%" heygem_server.py
pause
