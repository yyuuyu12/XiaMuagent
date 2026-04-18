@echo off
chcp 65001 >nul
title VideoReTalking Server (port 7862)
cd /d C:\AIClaudecode\desktop_client
echo [VideoReTalking] 启动服务...
VideoReTalking\venv\Scripts\python videoretalking_server.py
pause
