# 双保险自启动配置：启动文件夹 + 任务计划程序

$vbsPath = "C:\AIClaudecode\local_asr_server\autostart.vbs"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

# === 方案1：启动文件夹快捷方式（最可靠，不受Windows更新影响）===
$startupFolder = [System.Environment]::GetFolderPath("Startup")
$shortcutPath = "$startupFolder\ASR-AutoStart.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WindowStyle = 7  # 最小化
$shortcut.Description = "ASR自动启动服务"
$shortcut.Save()
Write-Host "✓ 启动文件夹快捷方式已创建：$shortcutPath"

# === 方案2：任务计划程序（支持延迟启动，避免开机时资源争抢）===
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$trigger.Delay = "PT1M"  # 延迟1分钟，等桌面稳定
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0)  # 不限运行时间

Register-ScheduledTask `
    -TaskName "ASR-AutoStart" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force | Out-Null
Write-Host "✓ 任务计划程序已注册（用户：$currentUser，延迟1分钟）"

Write-Host ""
Write-Host "双保险配置完成！启动文件夹会立即触发，任务计划延迟1分钟触发（会自动检测重复启动）"
