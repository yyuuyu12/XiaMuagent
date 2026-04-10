# 自动从 ngrok 读取当前 URL 并注册到服务器
$ngrok = Invoke-RestMethod http://localhost:4040/api/tunnels
$url = ($ngrok.tunnels | Where-Object { $_.public_url -like "https://*" } | Select-Object -First 1).public_url

if (-not $url) {
    Write-Host "未找到 ngrok HTTPS 隧道，请确认 ngrok 已启动" -ForegroundColor Red
    pause
    exit
}

Write-Host "当前 ngrok URL: $url" -ForegroundColor Cyan

$body = @{ url = $url; secret = "wf-asr-secret-2024" } | ConvertTo-Json
$resp = Invoke-RestMethod -Uri "http://106.14.151.37/api/internal/asr-register" -Method POST -Body $body -ContentType "application/json"

Write-Host "注册结果: $($resp.msg)" -ForegroundColor Green
pause
