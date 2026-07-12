$logOut = "C:\AIClaudecode\local_asr_server\asr_runtime.log"
$logErr = "C:\AIClaudecode\local_asr_server\asr_runtime_err.log"
"" | Out-File $logOut -Encoding UTF8
"" | Out-File $logErr -Encoding UTF8

$env:PYTHONUNBUFFERED = "1"

Start-Process `
    -FilePath "C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe" `
    -ArgumentList "-u", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765" `
    -WorkingDirectory "C:\AIClaudecode\local_asr_server" `
    -RedirectStandardOutput $logOut `
    -RedirectStandardError $logErr `
    -WindowStyle Hidden `
    -Environment @{PYTHONUNBUFFERED="1"}

Write-Host "ASR started with unbuffered logging -> $logOut"
