$exe = "C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe"
$arg = "C:\AIClaudecode\local_asr_server\indextts_server.py"
$dir = "C:\AIClaudecode\local_asr_server"

$action = New-ScheduledTaskAction -Execute $exe -Argument $arg -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Delay = "PT2M"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName "IndexTTS-Service" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
Write-Host "Done"
