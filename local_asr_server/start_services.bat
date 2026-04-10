@echo off
chcp 65001 >nul

:: 启动 ASR 服务（完全隐藏，无窗口）
tasklist /FI "IMAGENAME eq python.exe" 2>nul | find /I "python.exe" >nul
if errorlevel 1 (
    wscript.exe "C:\AIClaudecode\local_asr_server\run_hidden.vbs" "C:\AIClaudecode\local_asr_server\start_asr.bat"
)

:: 立即启动 ngrok（无需等待 ASR 加载）
tasklist /FI "IMAGENAME eq ngrok.exe" 2>nul | find /I "ngrok.exe" >nul
if errorlevel 1 (
    wscript.exe "C:\AIClaudecode\local_asr_server\run_hidden.vbs" "C:\AIClaudecode\local_asr_server\start_ngrok.bat"
)

exit /b 0
