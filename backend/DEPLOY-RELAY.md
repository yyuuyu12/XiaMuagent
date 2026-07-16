# HeyGem 薄中继部署单（M2 最小版）

前置：本仓库两个提交已推到 GitHub（`bf84ef4` token 鉴权 + `0651227` 中继路由）；
家里已跑过 `F:\Projects\setup-remote-heygem.ps1`（token 在剪贴板里）。

## 〇、先修隧道路由（一次性；2026-07-16 实测确认缺失）

现状实测：家里 frpc → frps:7000 连接 Established（frps 活着），但
`https://heygem.yyagent.top` 和 `asr.` 都落到主站 backend 的 404——
**nginx 没有这三个子域的 server 块**，证书也不覆盖子域（Windows 端报 TLS 不受信）。

```bash
# 1. 确认 frps 的 HTTP 虚拟主机端口（frpc 用的是 type="http" 代理，必须有这项）
grep -ri vhost /etc/frp/frps.toml /opt/frp*/frps.toml 2>/dev/null
# 若没有任何 vhostHTTPPort，在 frps.toml 加一行： vhostHTTPPort = 8081  # 注意 8080 已被 pm2 的 wf-api 占用，勿用
# 然后重启 frps（systemctl restart frps 或对应的启动方式），并确认监听：
ss -tlnp | grep -E "7000|8081"

# 2. nginx 新增子域路由（把 8081 换成上一步实际的 vhostHTTPPort；8080 被 wf-api 占用）
cat > /etc/nginx/conf.d/frp-subdomains.conf <<'NGINX'
server {
    listen 80;
    server_name heygem.yyagent.top asr.yyagent.top videomix.yyagent.top;
    client_max_body_size 200m;
    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host $host;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
NGINX
nginx -t && systemctl reload nginx

# 3. 先验 HTTP 通（家里开机时）：
curl -s http://heygem.yyagent.top/health
# 预期 {"status":"ok","model":"heygem-v2","processor_ready":true}

# 4. 补 HTTPS 证书（certbot 会自动改 nginx 配置加 443）
certbot --nginx -d heygem.yyagent.top -d asr.yyagent.top -d videomix.yyagent.top
curl -s https://heygem.yyagent.top/health   # 同上预期

# 5. 主站也要放大上传限制（中继提交的 base64 载荷 30-60MB 走 www 域）：
#    在 www.yyagent.top 的 server 块里加一行  client_max_body_size 200m;
#    然后 nginx -t && systemctl reload nginx
```

## 一、上海机部署（SSH 后照抄，约 2 分钟）

```bash
cd /opt/XiaMuagent/backend
git pull
pm2 restart all
curl -s http://127.0.0.1:3001/api/relay/heygem/health   # 预期 {"ok":false,"error":"中继未配置"}——路由已活，差配置
```

## 二、写入三行配置（MariaDB）

```bash
mysql -u root -p
```

```sql
USE zeabur;  -- 库名实测为 zeabur（Zeabur 迁移时保留原名）

-- ① 隧道基址（固定值，照抄）
INSERT INTO system_config (config_key, value) VALUES ('relay_heygem_url', 'https://heygem.yyagent.top')
  ON DUPLICATE KEY UPDATE value = VALUES(value);

-- ② GPU token：把剪贴板里的 token 粘到引号里（就是 setup-remote-heygem.ps1 复制的那串 hgt_ 开头）
INSERT INTO system_config (config_key, value) VALUES ('relay_heygem_token', '<粘贴 hgt_ 开头的 token>')
  ON DUPLICATE KEY UPDATE value = VALUES(value);

-- ③ 客户端白名单：自己随便造，一人一串，逗号分隔（发给朋友的就是这个，不是上面的 GPU token）
INSERT INTO system_config (config_key, value) VALUES ('relay_whitelist', 'tok_self_test,tok_friend1')
  ON DUPLICATE KEY UPDATE value = VALUES(value);
```

## 三、端到端验收（任意机器）

```bash
# 探活（无需 token）
curl -s https://www.yyagent.top/api/relay/heygem/health
# 预期 {"ok":true,"ready":true}（家里开机+frpc 在线时）

# 鉴权拦截
curl -s https://www.yyagent.top/api/relay/heygem/video/task/x
# 预期 401 缺少 token

curl -s -H "X-Relay-Token: tok_self_test" https://www.yyagent.top/api/relay/heygem/video/task/x
# 预期 404 任务不存在（= 鉴权放行）
```

## 四、M2 验收（第二台设备 = 第一个外部用户）

第二台设备的 VideoForge 设置页只改两项：
- `heygem.baseUrl` → `https://www.yyagent.top/api/relay/heygem`
- `heygem.token` → `tok_self_test`（白名单 token，**不是** GPU token）

然后正常做一个启用数字人的作品，能出片即 M2 通过。

## 约束与已知边界

- 单 GPU 串行，M2 无排队可视化（M3 做）；额度粗限每 token 20 次/天（改 `routes/relayHeygem.js` 顶部常量）。
- 提交体载荷受 server.js `express.json limit 80mb` 约束：3 分钟内narration+出镜视频的 base64 通常 30-60MB，够用；超长视频等 M3 改流式上传。
- 家里停电/关机 = 服务中断，对内测用户明说"服务时段"。
