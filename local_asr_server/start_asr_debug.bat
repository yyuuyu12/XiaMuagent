@echo off
set PYTHONUNBUFFERED=1
cd /d C:\AIClaudecode\local_asr_server
"C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe" -u -m uvicorn main:app --host 0.0.0.0 --port 8765 > asr_runtime.log 2> asr_runtime_err.log
