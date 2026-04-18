@echo off
echo ============================================
echo   IndexTTS Service - Port 8766
echo   Loading model, please wait 20-40 seconds
echo ============================================
echo.
cd /d "%~dp0"
"C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe" indextts_server.py
pause
