@echo off
set EXE=C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe
set ARG=C:\AIClaudecode\local_asr_server\indextts_server.py
%SystemRoot%\System32\schtasks.exe /create /tn "IndexTTS-Service" /tr "\"%EXE%\" \"%ARG%\"" /sc onlogon /delay 0002:00 /rl highest /f
echo Done: %errorlevel%
pause
