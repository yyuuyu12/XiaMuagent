@echo off
chcp 65001 >nul
title 注册开机自启动（需要管理员权限）

echo ============================================
echo   爆款文案工坊 — 注册开机自启动服务
echo   将自动启动：HeyGem + ASR + ngrok
echo ============================================
echo.

:: 检查管理员权限
net session >nul 2>&1
if errorlevel 1 (
    echo [错误] 请右键此文件 → "以管理员身份运行"
    pause
    exit /b 1
)

set SCRIPT=C:\AIClaudecode\local_asr_server\startup.ps1
set TASK_NAME=XiamuagentServices

:: 删除旧任务（如有）
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: 注册新任务：登录后延迟 60 秒启动（等桌面稳定）
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "PowerShell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%SCRIPT%\"" ^
  /sc onlogon ^
  /delay 0001:00 ^
  /rl highest ^
  /f

if errorlevel 1 (
    echo [失败] 任务注册失败，请检查权限
    pause
    exit /b 1
)

echo.
echo [完成] 开机自启动已注册！
echo   任务名称：%TASK_NAME%
echo   触发时机：登录后延迟 60 秒
echo   启动顺序：HeyGem → ASR → ngrok
echo.
echo 下次开机将自动启动所有服务，无需手动操作。
echo 如需手动触发：schtasks /run /tn "%TASK_NAME%"
echo.
pause
