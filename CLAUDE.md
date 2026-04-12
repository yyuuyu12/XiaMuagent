# 爆款文案工坊 · 项目手册

## 仓库 & 部署
- GitHub: yyuuyu12/XiaMuagent
- 部署平台: Zeabur（push 到 master 自动部署）
- 本地路径: C:\AIClaudecode

## 完整架构规范
见 `docs/架构规范.md`（全平台设计、实施阶段、API列表、技术选型）

---

## 文件结构 & 职责（每个文件只有一个位置）

```
XiaMuagent/
│
├── backend/                        ← Zeabur 部署的全部内容
│   ├── server.js                   ← Express 入口，挂载所有路由
│   ├── db.js                       ← MySQL 连接池
│   ├── initDb.js                   ← 建表 + 初始数据（每次启动自动跑）
│   ├── package.json                ← 后端依赖
│   ├── zbpack.json                 ← Zeabur 构建配置，不要动
│   │
│   ├── public/
│   │   ├── index.html              ← ★ H5 前端唯一文件（在这里改）
│   │   └── admin.html              ← ★ 管理后台唯一文件（在这里改）
│   │
│   └── routes/
│       ├── auth.js                 ← 注册/登录/JWT/个人信息
│       ├── ai.js                   ← AI 文案生成（inspire / rewrite）
│       ├── douyinToText.js         ← 抖音视频 → 文字（调用 ASR）
│       ├── extract.js              ← 文案提取
│       ├── history.js              ← 用户历史记录
│       ├── config.js               ← 后台配置读写（AI Key / ASR 地址等）
│       └── codes.js                ← 授权码管理
│
├── wechatXiamuagent/               ← 微信小程序（微信开发者工具里改）
│   └── miniprogram/
│       └── pages/                  ← 各页面
│
├── local_asr_server/               ← 本地 Whisper 语音识别服务（Python）
│   ├── main.py                     ← FastAPI 服务入口
│   └── start.bat                   ← Windows 一键启动
│
├── docs/                           ← 需求文档（只读参考，不部署）
│
├── CLAUDE.md                       ← 本文件，项目规范
└── .gitignore
```

---

## ⚠️ 黄金规则

### 每个文件只有一个位置
| 要改什么 | 改哪个文件 |
|----------|-----------|
| H5 页面（用户端） | `backend/public/index.html` |
| 管理后台 | `backend/public/admin.html` |
| API 接口 | `backend/routes/对应文件.js` |
| 数据库结构 | `backend/initDb.js` |
| 小程序 | `wechatXiamuagent/miniprogram/` |
| 本地语音服务 | `local_asr_server/` |

**根目录没有任何业务文件**，看到根目录有 .html / .js 就是幽灵文件，直接删。

### 操作顺序（每次必须遵守）
```bash
# 1. 开始前先拉最新
git pull

# 2. 改代码

# 3. 改完立刻提交推送
git add .
git commit -m "说明改了什么"
git push
```

### 工具分工
| 工具 | 适合做什么 |
|------|-----------|
| Cursor | 写代码、大块功能开发 |
| Claude Code | 调试、修复、小改动、解释代码 |
| 微信开发者工具 | 小程序开发 |

**同一时间只用一个工具改代码**，改完 push 再换工具。

---

## 数据库表（Zeabur MySQL）
| 表名 | 作用 |
|------|------|
| users | 用户账号、权限、授权到期 |
| usage_logs | 每次使用记录，算每日次数 |
| system_config | 后台配置（AI Key、ASR 地址等） |
| prompt_templates | AI 提示词模板 |
| history | 用户创作历史 |
| auth_codes | 授权码 |
| industries | 行业标签 |

表结构由 `initDb.js` 自动创建，不需要手动建表。

---

## 关键配置（在管理后台设置，不要硬编码）
| 配置项 | 说明 |
|--------|------|
| ai_provider | AI 服务商（openai / zhipu 等） |
| tikhub_api_key | 抖音视频解析 API |
| asr_url | 本地 Whisper 语音识别地址 |
| member_plan_*_price | 各套餐价格 |
