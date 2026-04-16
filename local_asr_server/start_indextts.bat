@echo off
chcp 65001 >nul
echo ============================================
echo   IndexTTS 语音克隆服务 (端口 8766)
echo   首次启动加载模型约需 20-40 秒，请耐心等待
echo ============================================
echo.
cd /d "%~dp0"
"C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe" indextts_server.py
pause
