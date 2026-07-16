# HeyGem 薄中继部署单（M2 最小版）

前置：本仓库两个提交已推到 GitHub（`bf84ef4` token 鉴权 + `0651227` 中继路由）；
家里已跑过 `F:\Projects\setup-remote-heygem.ps1`（token 在剪贴板里）。

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
USE xiamuagent;  -- 若库名不同，用 SHOW DATABASES; 确认

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
