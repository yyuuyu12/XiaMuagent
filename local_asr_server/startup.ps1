# XiamuAgent - Local Services Auto-Start
# Services: HeyGem(7861) + ASR(8765) + IndexTTS(8766) + frpc(asr.yyagent.top)

$logFile = "$PSScriptRoot\startup.log"
$frpcExe = "C:\AIClaudecode\local_asr_server\frp\frp_0.61.0_windows_amd64\frp_0.61.0_windows_amd64\frpc.exe"
$frpcToml = "C:\AIClaudecode\local_asr_server\frp\frp_0.61.0_windows_amd64\frp_0.61.0_windows_amd64\frpc.toml"

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}

function IsPortInUse($port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        return ($conn -ne $null)
    } catch {
        # 降级：用 netstat
        $conn = netstat -ano 2>$null | Select-String ":$port\s"
        return ($conn -ne $null -and $conn.Count -gt 0)
    }
}

Log "=== startup begin ==="

# ---- 全局环境变量：防止 Intel Fortran Runtime 崩溃 ----
# forrtl: error (200) program aborting due to window-CLOSE event
# 原因：MKL/numpy 底层 Fortran 运行时收到 Windows 控制台关闭事件后自杀
# 设置此变量后忽略该事件，进程在睡眠/唤醒后仍能存活
$env:FOR_IGNORE_EXCEPTIONS = "1"
$env:PYTHONIOENCODING     = "utf-8"
$env:PYTHONUNBUFFERED     = "1"

$pyExe    = "C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe"
$asrDir   = "C:\AIClaudecode\local_asr_server"
$asrErrLog = "$asrDir\asr_runtime_err.log"
$ttsErrLog = "$asrDir\tts_runtime_err.log"

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
    Start-Process `
        -FilePath $pyExe `
        -ArgumentList "-u", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765" `
        -WorkingDirectory $asrDir `
        -RedirectStandardError $asrErrLog `
        -WindowStyle Hidden
    Log "[ASR] process started (Whisper loading ~60s, stderr -> asr_runtime_err.log)"
}

# 3. IndexTTS (8766)
if (IsPortInUse 8766) {
    Log "[IndexTTS] already running, skip"
} else {
    Log "[IndexTTS] starting..."
    Start-Process `
        -FilePath $pyExe `
        -ArgumentList "$asrDir\indextts_server.py" `
        -WorkingDirectory $asrDir `
        -RedirectStandardError $ttsErrLog `
        -WindowStyle Hidden
    Log "[IndexTTS] process started (model loading ~30s, stderr -> tts_runtime_err.log)"
}

# 等待模型加载完成（90s）
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
