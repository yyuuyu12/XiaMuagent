# ============================================================
#  爆款文案工坊 — 本地服务自动启动
#  服务：HeyGem(7861) + ASR(8765) + ngrok
#  用法：PowerShell -ExecutionPolicy Bypass -File startup.ps1
# ============================================================

$logFile = "$PSScriptRoot\startup.log"

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function IsPortInUse($port) {
    $r = netstat -ano 2>$null | Select-String ":$port\s"
    return $r.Count -gt 0
}

Log "========== 服务启动开始 =========="

# ---------- 1. HeyGem 数字人服务 (7861) ----------
if (IsPortInUse 7861) {
    Log "[HeyGem] 已在运行，跳过"
} else {
    Log "[HeyGem] 启动中..."
    # Waves Audio DLL 路径（HeyGem 依赖）
    $wavesPath = "C:\ProgramData\Waves Audio\Modules\AdditionalDLLs_x64"
    $heygemEnv = [System.Environment]::GetEnvironmentVariables()
    $heygemEnv["PATH"] = "$wavesPath;" + $heygemEnv["PATH"]

    Start-Process `
        -FilePath "C:\ChaojiIP\aigc-human\python-modules\humanModule\venv\python.exe" `
        -ArgumentList "C:\AIClaudecode\desktop_client\heygem_server.py" `
        -WorkingDirectory "C:\AIClaudecode\desktop_client" `
        -WindowStyle Hidden
    Log "[HeyGem] 进程已启动（模型初始化需约60秒）"
}

# ---------- 2. ASR + 代理服务 (8765) ----------
if (IsPortInUse 8765) {
    Log "[ASR] 已在运行，跳过"
} else {
    Log "[ASR] 启动中..."
    Start-Process `
        -FilePath "C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe" `
        -ArgumentList "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765" `
        -WorkingDirectory "C:\AIClaudecode\local_asr_server" `
        -WindowStyle Hidden
    Log "[ASR] 进程已启动（Whisper 加载需约60秒）"
}

# ---------- 等待服务就绪 ----------
Log "[等待] 等待模型加载完成（90秒）..."
Start-Sleep -Seconds 90

# ---------- 3. ngrok 公网隧道 ----------
$ngrokRunning = Get-Process -Name "ngrok" -ErrorAction SilentlyContinue
if ($ngrokRunning) {
    Log "[ngrok] 已在运行，跳过"
} else {
    Log "[ngrok] 启动隧道..."
    # 补充 ngrok 路径
    $ngrokDir = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe"
    $env:PATH = "$ngrokDir;$env:PATH"
    Start-Process `
        -FilePath "ngrok" `
        -ArgumentList "http", "--domain=baculitic-derivable-sherilyn.ngrok-free.dev", "8765" `
        -WindowStyle Hidden
    Log "[ngrok] 隧道已启动"
}

Log "========== 所有服务启动完成 =========="
