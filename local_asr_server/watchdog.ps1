# ============================================================
# XiamuAgent - 服务守护进程（watchdog）
# 每 60 秒检查一次，发现服务挂了自动重启
# startup.ps1 会在后台启动这个脚本，无需手动运行
# ============================================================

$pyExe    = "C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe"
$hdPyExe  = "C:\ChaojiIP\aigc-human\python-modules\hdModule\venv\python.exe"
$asrDir   = "C:\AIClaudecode\local_asr_server"
$frpcExe  = "$asrDir\frp\frp_0.61.0_windows_amd64\frp_0.61.0_windows_amd64\frpc.exe"
$frpcToml = "$asrDir\frp\frp_0.61.0_windows_amd64\frp_0.61.0_windows_amd64\frpc.toml"
$logFile  = "$asrDir\watchdog.log"

$env:FOR_IGNORE_EXCEPTIONS = "1"
$env:PYTHONIOENCODING      = "utf-8"
$env:PYTHONUNBUFFERED      = "1"

# 各服务上次重启时间，防止短时间内反复重启
$lastRestart = @{ asr = [datetime]::MinValue; tts = [datetime]::MinValue; heygem = [datetime]::MinValue; frpc = [datetime]::MinValue }
$cooldown = 120  # 同一服务重启后冷却 120 秒再检查

function Log($msg) {
    $line = "[$(Get-Date -Format 'HH:mm:ss')] [watchdog] $msg"
    Write-Host $line
    try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}

function CanRestart($name) {
    return ((Get-Date) - $lastRestart[$name]).TotalSeconds -gt $cooldown
}

function CheckHttp($url) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function KillPort($port) {
    $pids = (netstat -ano 2>$null | Select-String ":$port\s") |
            ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
    foreach ($p in $pids) {
        if ($p -match '^\d+$' -and $p -ne '0') {
            try { taskkill /PID $p /F 2>$null | Out-Null } catch {}
        }
    }
}

Log "守护进程启动，每 60 秒巡检一次"

while ($true) {
    Start-Sleep -Seconds 60

    # ── ASR (8765) ──────────────────────────────────────────
    if (-not (CheckHttp "http://localhost:8765/health")) {
        if (CanRestart "asr") {
            Log "[ASR] 健康检查失败，正在重启..."
            KillPort 8765
            Start-Sleep -Seconds 2
            Start-Process -FilePath $pyExe `
                -ArgumentList "-u", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765" `
                -WorkingDirectory $asrDir `
                -RedirectStandardError "$asrDir\asr_runtime_err.log" `
                -WindowStyle Hidden
            $lastRestart["asr"] = Get-Date
            Log "[ASR] 已重启，等待加载..."
        } else {
            Log "[ASR] 健康检查失败，冷却中，跳过重启"
        }
    }

    # ── IndexTTS (8766) ─────────────────────────────────────
    if (-not (CheckHttp "http://localhost:8766/health")) {
        if (CanRestart "tts") {
            Log "[IndexTTS] 健康检查失败，正在重启..."
            KillPort 8766
            Start-Sleep -Seconds 2
            Start-Process -FilePath $pyExe `
                -ArgumentList "$asrDir\indextts_server.py" `
                -WorkingDirectory $asrDir `
                -RedirectStandardError "$asrDir\tts_runtime_err.log" `
                -WindowStyle Hidden
            $lastRestart["tts"] = Get-Date
            Log "[IndexTTS] 已重启，模型加载需 30s..."
        } else {
            Log "[IndexTTS] 健康检查失败，冷却中，跳过重启"
        }
    }

    # ── HeyGem (7861) ───────────────────────────────────────
    if (-not (CheckHttp "http://localhost:7861/health")) {
        if (CanRestart "heygem") {
            Log "[HeyGem] 健康检查失败，正在重启..."
            KillPort 7861
            Start-Sleep -Seconds 2
            Start-Process -FilePath $hdPyExe `
                -ArgumentList "C:\AIClaudecode\desktop_client\heygem_server_v2.py" `
                -WorkingDirectory "C:\AIClaudecode\desktop_client" `
                -WindowStyle Hidden
            $lastRestart["heygem"] = Get-Date
            Log "[HeyGem] 已重启，模型加载需 60s..."
        } else {
            Log "[HeyGem] 健康检查失败，冷却中，跳过重启"
        }
    }

    # ── frpc ────────────────────────────────────────────────
    $frpcAlive = [bool](Get-Process -Name "frpc" -ErrorAction SilentlyContinue)
    if (-not $frpcAlive) {
        if (CanRestart "frpc") {
            Log "[frpc] 进程不存在，正在重启..."
            Start-Process -FilePath $frpcExe -ArgumentList "-c", $frpcToml -WindowStyle Hidden
            $lastRestart["frpc"] = Get-Date
            Log "[frpc] 已重启"
        } else {
            Log "[frpc] 进程不存在，冷却中，跳过重启"
        }
    }
}
