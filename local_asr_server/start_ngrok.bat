@echo off
chcp 65001 >nul
:loop
echo 正在启动 ngrok...
set PATH=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe;%PATH%
ngrok http --domain=baculitic-derivable-sherilyn.ngrok-free.dev 8765
echo ngrok 已断开，3秒后自动重连...
timeout /t 3 /nobreak >nul
goto loop
