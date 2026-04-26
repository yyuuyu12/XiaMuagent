Set objShell = CreateObject("WScript.Shell")
objShell.Run "PowerShell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\AIClaudecode\local_asr_server\startup.ps1""", 0, False
