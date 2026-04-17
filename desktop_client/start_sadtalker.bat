@echo off
chcp 65001 >nul
title SadTalker 数字人视频服务 (端口 7861)
cd /d "%~dp0"

echo ========================================
echo  SadTalker 数字人视频生成服务
echo  端口: 7861
echo ========================================
echo.

REM 检查 SadTalker venv
if not exist "SadTalker\venv\Scripts\python.exe" (
    echo [错误] 未找到 SadTalker\venv\Scripts\python.exe
    echo 请先运行安装步骤
    pause
    exit /b 1
)

echo [启动] 使用 SadTalker venv Python...
SadTalker\venv\Scripts\python.exe sadtalker_server.py

pause
