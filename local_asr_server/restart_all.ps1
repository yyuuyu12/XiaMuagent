# ============================================================
# XiamuAgent - 一键重启所有本地服务
# 直接双击或 PowerShell 运行即可
# ============================================================

$pyExe    = "C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe"
$hdPyExe  = "C:\ChaojiIP\aigc-human\python-modules\hdModule\venv\python.exe"
$asrDir   = "C:\AIClaudecode\local_asr_server"
$frpcExe  = "$asrDir\frp\frp_0.61.0_windows_amd64\frp_0.61.0_windows_amd64\frpc.exe"
$frpcToml = "$asrDir\frp\frp_0.61.0_windows_amd64\frp_0.61.0_windows_amd64\frpc.toml"

function KillPort($port) {
    $pids = (netstat -ano 2>$null | Select-String ":$port\s") |
            ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
    foreach ($p in $pids) {
        if ($p -match '^\d+$' -and $p -ne '0') {
            try { taskkill /PID $p /F 2>$null | Out-Null } catch {}
        }
    }
}

Write-Host "[restart] 停止旧进程..." -ForegroundColor Yellow
KillPort 8765
KillPort 8766
KillPort 7861
Get-Process -Name "frpc" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

$env:FOR_IGNORE_EXCEPTIONS = "1"
$env:PYTHONIOENCODING      = "utf-8"
$env:PYTHONUNBUFFERED      = "1"

Write-Host "[restart] 启动 HeyGem (7861)..." -ForegroundColor Cyan
Start-Process -FilePath $hdPyExe `
    -ArgumentList "C:\AIClaudecode\desktop_client\heygem_server_v2.py" `
    -WorkingDirectory "C:\AIClaudecode\desktop_client" `
    -WindowStyle Hidden

Write-Host "[restart] 启动 ASR (8765)..." -ForegroundColor Cyan
Start-Process -FilePath $pyExe `
    -ArgumentList "-u", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765" `
    -WorkingDirectory $asrDir `
    -RedirectStandardError "$asrDir\asr_runtime_err.log" `
    -WindowStyle Hidden

Write-Host "[restart] 启动 IndexTTS (8766)..." -ForegroundColor Cyan
Start-Process -FilePath $pyExe `
    -ArgumentList "$asrDir\indextts_server.py" `
    -WorkingDirectory $asrDir `
    -RedirectStandardError "$asrDir\tts_runtime_err.log" `
    -WindowStyle Hidden

Write-Host "[restart] 等待模型加载 (90s)..." -ForegroundColor Yellow
Start-Sleep -Seconds 90

Write-Host "[restart] 启动 frpc 穿透..." -ForegroundColor Cyan
Start-Process -FilePath $frpcExe -ArgumentList "-c", $frpcToml -WindowStyle Hidden

Write-Host "[restart] 完成！所有服务已重启。" -ForegroundColor Green
