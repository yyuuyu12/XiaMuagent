@echo off
set PATH=%LOCALAPPDATA%\Python\bin;%PATH%
cd /d C:\AIClaudecode\local_asr_server
python -m uvicorn main:app --host 0.0.0.0 --port 8765
