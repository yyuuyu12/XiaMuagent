# XiamuAgent - Local Services Auto-Start
# Services: HeyGem(7861) + ASR(8765) + IndexTTS(8766) + ngrok

$logFile = "$PSScriptRoot\startup.log"

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

# wait for models to load
Log "[wait] waiting 90s for models to load..."
Start-Sleep -Seconds 90

# 4. ngrok
$ngrokRunning = Get-Process -Name "ngrok" -ErrorAction SilentlyContinue
if ($ngrokRunning) {
    Log "[ngrok] already running, skip"
} else {
    Log "[ngrok] starting tunnel..."
    $ngrokExe = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
    if (-not (Test-Path $ngrokExe)) {
        $found = Get-Command ngrok -ErrorAction SilentlyContinue
        if ($found) { $ngrokExe = $found.Source }
    }
    if (Test-Path $ngrokExe) {
        Start-Process `
            -FilePath $ngrokExe `
            -ArgumentList "http", "--domain=unburned-dollhouse-armhole.ngrok-free.dev", "8765" `
            -WindowStyle Hidden
        Log "[ngrok] tunnel started: baculitic-derivable-sherilyn.ngrok-free.dev"
    } else {
        Log "[ngrok] WARNING: ngrok.exe not found, skipped"
    }
}

Log "=== startup complete ==="
