# 爆款文案工坊 - 后端部署指南

## 一、安装 Node.js（阿里云 Linux 3）

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
node -v   # 应显示 v20.x.x
```

## 二、上传后端文件

用 FinalShell 将整个 `backend` 文件夹上传到服务器，建议放在：
```
/opt/content-creator/backend/
```

## 三、安装依赖

```bash
cd /opt/content-creator/backend
npm install
```

## 四、配置环境变量

```bash
cp .env.example .env
nano .env   # 编辑 .env，至少修改 JWT_SECRET
```

## 五、启动服务

### 临时启动（测试用）
```bash
node server.js
```

### 后台持久运行（生产用 PM2）
```bash
npm install -g pm2
pm2 start server.js --name "content-creator-api"
pm2 save            # 保存进程列表
pm2 startup         # 设置开机自启
```

### 常用 PM2 命令
```bash
pm2 status          # 查看状态
pm2 logs content-creator-api   # 查看日志
pm2 restart content-creator-api  # 重启
pm2 stop content-creator-api     # 停止
```

## 六、配置 Nginx 反向代理

```bash
nano /etc/nginx/conf.d/default.conf
```

参考 `nginx.conf.example` 文件，加入 `/api/` 反向代理配置。

```bash
nginx -t            # 测试配置
nginx -s reload     # 重载配置
```

## 七、设置管理员账号

注册后，手动将第一个账号设为管理员：
```bash
cd /opt/content-creator/backend
node -e "
const db = require('./db');
// 将 phone 换成你注册时的手机号
db.prepare(\"UPDATE users SET role='admin' WHERE phone=?\").run('13800138000');
console.log('Done');
"
```

## 八、API 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 注册 |
| POST | /api/auth/login | 登录 |
| GET  | /api/auth/me | 获取当前用户信息 |
| PUT  | /api/auth/profile | 修改昵称/头像 |
| GET  | /api/config/ai-keys | 获取 AI Key 配置（管理员）|
| POST | /api/config/ai-keys | 保存 AI Key 配置（管理员）|
| GET  | /api/config/prompts | 获取提示词列表 |
| POST | /api/config/prompts | 创建/更新提示词（管理员）|
| DELETE | /api/config/prompts/:id | 删除提示词（管理员）|
| POST | /api/ai/rewrite | AI 改写文案 |
| POST | /api/ai/inspire | AI 生成灵感 |
| POST | /api/extract/video | 提取抖音视频文案 |
| GET  | /api/health | 健康检查 |
