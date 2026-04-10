@echo off
chcp 65001 >nul
echo ============================================
echo   爆款文案工坊 - 本地语音识别服务
echo ============================================
echo.
echo 首次运行会自动下载 Whisper medium 模型（约1.5GB）
echo 请保持网络畅通，耐心等待...
echo.
echo 服务启动后请保持此窗口开启，不要关闭！
echo.
cd /d "%~dp0"
uvicorn main:app --host 0.0.0.0 --port 8765
pause
