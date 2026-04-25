# XiamuAgent - Local Services Auto-Start
# Services: HeyGem(7861) + ASR(8765) + IndexTTS(8766) + frpc(asr.yyagent.top)

$logFile = "$PSScriptRoot\startup.log"
$frpcExe = "C:\AIClaudecode\local_asr_server\frp\frp_0.61.0_windows_amd64\frp_0.61.0_windows_amd64\frpc.exe"
$frpcToml = "C:\AIClaudecode\local_asr_server\frp\frp_0.61.0_windows_amd64\frp_0.61.0_windows_amd64\frpc.toml"

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function IsPortInUse($port) {
    $conn = netstat -ano 2>$null | Select-String ":$port\s"
    return ($conn -ne $null -and $conn.Count -gt 0)
}

Log "=== startup begin ==="

# 1. HeyGem (7861)
if (IsPortInUse 7861) {
    Log "[HeyGem] already running, skip"
} else {
    Log "[HeyGem] starting V2 (hdModule)..."
    Start-Process `
        -FilePath "C:\ChaojiIP\aigc-human\python-modules\hdModule\venv\python.exe" `
        -ArgumentList "C:\AIClaudecode\desktop_client\heygem_server_v2.py" `
        -WorkingDirectory "C:\AIClaudecode\desktop_client" `
        -WindowStyle Hidden
    Log "[HeyGem] V2 process started (model init ~60-90s)"
}

# 2. ASR (8765)
if (IsPortInUse 8765) {
    Log "[ASR] already running, skip"
} else {
    Log "[ASR] starting..."
    $env:PYTHONIOENCODING = "utf-8"
    $env:PYTHONUNBUFFERED = "1"
    Start-Process `
        -FilePath "C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe" `
        -ArgumentList "-u", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765" `
        -WorkingDirectory "C:\AIClaudecode\local_asr_server" `
        -WindowStyle Hidden
    Log "[ASR] process started (Whisper loading ~60s)"
}

# 3. IndexTTS (8766)
if (IsPortInUse 8766) {
    Log "[IndexTTS] already running, skip"
} else {
    Log "[IndexTTS] starting..."
    Start-Process `
        -FilePath "C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe" `
        -ArgumentList "C:\AIClaudecode\local_asr_server\indextts_server.py" `
        -WorkingDirectory "C:\AIClaudecode\local_asr_server" `
        -WindowStyle Hidden
    Log "[IndexTTS] process started (model loading ~30s)"
}

# 等待模型加载完成
Log "[wait] waiting 90s for models to load..."
Start-Sleep -Seconds 90

# 4. frpc 穿透 (asr.yyagent.top -> 本地8765)
$frpcRunning = Get-Process -Name "frpc" -ErrorAction SilentlyContinue
if ($frpcRunning) {
    Log "[frpc] already running, skip"
} else {
    if (Test-Path $frpcExe) {
        Start-Process `
            -FilePath $frpcExe `
            -ArgumentList "-c", $frpcToml `
            -WindowStyle Hidden
        Log "[frpc] tunnel started: asr.yyagent.top -> localhost:8765"
    } else {
        Log "[frpc] WARNING: frpc.exe not found at $frpcExe"
    }
}

Log "=== startup complete ==="
