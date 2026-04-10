# 彻底重建自启动任务 - 直接启动进程，不依赖 vbs+bat 中间层

$pythonPath = "$env:LOCALAPPDATA\Python\bin\python.exe"
$ngrokPath = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
$workDir = "C:\AIClaudecode\local_asr_server"

# 删除旧任务
Write-Host "删除旧任务..."
schtasks /delete /tn "ASR-AutoStart" /f 2>$null
schtasks /delete /tn "ASR-Service" /f 2>$null
schtasks /delete /tn "Ngrok-Service" /f 2>$null

# 任务1：ASR Python 服务（登录后延迟1分钟）
Write-Host "创建 ASR 服务任务..."
$action1 = New-ScheduledTaskAction `
    -Execute $pythonPath `
    -Argument "-m uvicorn main:app --host 0.0.0.0 --port 8765" `
    -WorkingDirectory $workDir

$trigger1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger1.Delay = "PT30S"  # 延迟30秒

$settings1 = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName "ASR-Service" `
    -Action $action1 `
    -Trigger $trigger1 `
    -Settings $settings1 `
    -RunLevel Highest `
    -Force

# 任务2：ngrok（登录后延迟3分钟，等 ASR 先启动）
Write-Host "创建 ngrok 任务..."
$action2 = New-ScheduledTaskAction `
    -Execute $ngrokPath `
    -Argument "http --domain=baculitic-derivable-sherilyn.ngrok-free.dev 8765"

$trigger2 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger2.Delay = "PT30S"  # 延迟30秒

$settings2 = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 99 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName "Ngrok-Service" `
    -Action $action2 `
    -Trigger $trigger2 `
    -Settings $settings2 `
    -RunLevel Highest `
    -Force

Write-Host ""
Write-Host "完成！两个任务已创建："
Write-Host "  ASR-Service  - 登录后30秒启动"
Write-Host "  Ngrok-Service - 登录后30秒启动（失败自动重试，最多99次）"
Write-Host ""
Write-Host "立即测试（不用重启）："
Write-Host "  Start-ScheduledTask -TaskName 'ASR-Service'"
Write-Host "  Start-ScheduledTask -TaskName 'Ngrok-Service'"
