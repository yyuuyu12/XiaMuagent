# 生产部署实况（2026-07-12 迁移完成）

> 本文档记录 backend 当前真实的生产部署位置与运维方法。改部署（换机/换端口/换库）先改这里。
> 历史：原托管于 Zeabur（backend + MySQL8），2026-07-12 按 MACHINE-INDEX §6.5 路线 B 迁至自有服务器，Zeabur 已弃用。

## 一、部署拓扑

```
https://www.yyagent.top
  └─ 阿里云上海 106.14.151.37（2C2G，2027-01-23 到期）
      ├─ nginx（/etc/nginx/conf.d/yyagent.top.conf）
      │    location / → proxy_pass http://127.0.0.1:3001
      │    （改动前的 Zeabur 版备份在同目录 yyagent.top.conf.bak）
      ├─ 本仓库 backend → /opt/XiaMuagent/backend（git clone 部署）
      │    pm2 进程名 xiamu-backend，端口 3001
      │    （8080 被机上另一个 pm2 进程 wf-api 占用，勿用）
      └─ MariaDB 10.5（本机 127.0.0.1:3306，库名 zeabur，37 张表）
```

## 二、环境变量（.env 在 /opt/XiaMuagent/backend/.env，不入库）

必需项（值不写在这里）：`PORT`（=3001）、`MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`（本机 MariaDB）、
`JWT_SECRET`、`ASR_INTERNAL_SECRET`、`ALIYUN_SMS_KEY_ID/SECRET/SIGN/TEMPLATE_LOGIN/TEMPLATE_REG`、`WX_APPID/WX_SECRET`。
变量名以 [db.js](db.js) 与 routes/auth.js 实际读取为准（`MYSQL_USER` 或 `MYSQL_USERNAME` 都认）。

## 三、日常运维命令（SSH 到服务器后）

```bash
pm2 status                                  # 看进程
pm2 logs xiamu-backend --lines 50 --nostream # 看日志（别忘 --nostream，否则挂住）
pm2 restart xiamu-backend                   # 重启
curl -s http://127.0.0.1:3001/api/health    # 本机健康检查
curl -s https://www.yyagent.top/api/health  # 端到端健康检查
```

发新版本：
```bash
cd /opt/XiaMuagent && git pull
cd backend && npm install --omit=dev && npm run build:fe
pm2 restart xiamu-backend
```
（用 `npm install` 而非 `npm ci`——lockfile 漂移未修，见 [LOCKFILE-DRIFT.md](LOCKFILE-DRIFT.md)）

## 四、数据库

- 生产库：本机 MariaDB 10.5，库 `zeabur`。**MariaDB 不支持 MySQL8 的 `utf8mb4_0900_ai_ci`**，
  导入 MySQL8 的 dump 前先 `sed 's/utf8mb4_0900_ai_ci/utf8mb4_unicode_ci/g'`。
- 定期备份（建议每周/每次大改前）：
  ```bash
  mysqldump -uroot -p --single-transaction zeabur > /root/zeabur-backup-$(date +%F).sql
  ```
  并 scp 一份回本地 `F:\Projects\_archive\`。
- 现存冷备份：本地 `F:\Projects\_archive\zeabur-backup-2026-07-12.sql`（92MB，迁移时的全量原始 dump）。

## 五、迁移遗留待办

- [ ] 服务器跑 `pm2 startup` 并执行它输出的命令——**目前机器重启后 pm2 不会自动拉起**
- [ ] 轮换服务器 SSH 密码与 MariaDB root 密码（迁移当天曾出现在对话中）
- [ ] 2026-08-12 前后注销旧 Zeabur 项目（含几个失败的重复服务）
- [ ] 修 package-lock.json 漂移（LOCKFILE-DRIFT.md），修完 Dockerfile 换回 `npm ci`
