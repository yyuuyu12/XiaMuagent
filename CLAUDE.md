# 爆款文案工坊 · 项目手册

## 仓库 & 部署
- GitHub: yyuuyu12/XiaMuagent
- 部署平台: Zeabur（push 到 master 自动部署）
- 本地路径: C:\AIClaudecode

---

## 整体架构

```
用户手机/电脑（浏览器）
        ↕ HTTPS
Zeabur 云后端（Node.js Express）   ← 认证、API、数据库
        ↕ HTTP（通过 ngrok 穿透）
你的本地机器（Windows 11, RTX 5070Ti）
    ├── ASR服务     :8765   Whisper + edge-tts + 字幕 + 数字人代理
    ├── IndexTTS    :8766   语音克隆（按需手动启动）
    └── HeyGem      :7861   数字人视频生成
        ↕
ngrok 固定域名（把 8765 暴露到公网）
```

### 开机自启（已配置，无需手动操作）
登录 Windows 后自动启动：**HeyGem(7861) + ASR(8765)** 同时启动 → 等待 90 秒模型加载 → **ngrok** 启动
- 自启脚本：`local_asr_server/startup.ps1`
- 日志：`local_asr_server/startup.log`

---

## 文件结构

```
XiaMuagent/
│
├── backend/                        ← Zeabur 部署的全部内容
│   ├── server.js                   ← Express 入口，挂载所有路由
│   ├── db.js                       ← MySQL 连接池
│   ├── initDb.js                   ← 建表（每次启动自动跑）
│   ├── lib/callAI.js               ← AI 调用封装
│   ├── worker.js                   ← 后台任务处理器
│   ├── taskRunner.js               ← 内存任务队列（串行）
│   ├── package.json
│   ├── zbpack.json                 ← Zeabur 构建配置，不要动
│   │
│   ├── public/
│   │   ├── index.html              ← ★ H5 前端唯一文件（在这里改）
│   │   └── admin.html              ← ★ 管理后台唯一文件（在这里改）
│   │
│   └── routes/
│       ├── auth.js                 ← 注册/登录/JWT/个人信息
│       ├── ai.js                   ← AI文案/TTS/数字人视频代理
│       ├── inspire.js              ← 灵感发现（账号/视频分析）
│       ├── douyinToText.js         ← 抖音视频 → 文字
│       ├── extract.js              ← 文案提取
│       ├── history.js              ← 用户历史记录
│       ├── tasks.js                ← 任务状态查询
│       ├── config.js               ← 后台配置读写
│       └── codes.js                ← 授权码管理
│
├── local_asr_server/               ← 本地综合服务（端口 8765）
│   ├── main.py                     ← ★ 服务入口（Whisper/TTS/字幕/数字人代理）
│   ├── indextts_server.py          ← IndexTTS 语音克隆（端口 8766，按需启动）
│   ├── startup.ps1                 ← ★ 开机自启脚本（HeyGem+ASR+ngrok）
│   ├── register_autostart.bat      ← 重新注册自启用（管理员运行一次）
│   ├── start_asr.bat               ← 手动启动 ASR（调试用）
│   ├── start_ngrok.bat             ← 手动启动 ngrok（调试用）
│   └── start_indextts.bat          ← 手动启动 IndexTTS（声音克隆时用）
│
├── desktop_client/                 ← 数字人生成服务
│   ├── heygem_server.py            ← ★ HeyGem 服务（端口 7861）
│   └── start_heygem.bat            ← 手动启动（调试用，开机已自动启动）
│
├── docs/                           ← 需求文档（只读参考）
├── CLAUDE.md                       ← 本文件
└── .gitignore
```

---

## 本地服务一览

| 服务 | 端口 | 开机自启 | 手动启动脚本 |
|------|------|----------|-------------|
| **ASR 主服务** | 8765 | ✅ 自动 | `local_asr_server/start_asr.bat` |
| **HeyGem 数字人** | 7861 | ✅ 自动 | `desktop_client/start_heygem.bat` |
| **ngrok 穿透** | — | ✅ 自动（模型加载后90秒） | `local_asr_server/start_ngrok.bat` |
| **IndexTTS 声音克隆** | 8766 | ❌ 手动（按需） | `local_asr_server/start_indextts.bat` |

**开机无需任何手动操作**，所有核心服务自动启动。IndexTTS 仅在用声音克隆功能时才需要手动开启。

---

## 关键配置（管理后台设置，不要硬编码）

| 配置项 | 说明 | 当前值 |
|--------|------|--------|
| `ai_provider` | AI 服务商 | — |
| `tikhub_api_key` | 抖音解析 API | — |
| `asr_url` | 本地服务公网地址 | `https://baculitic-derivable-sherilyn.ngrok-free.dev` |
| `openai_api_key` | AI Key | — |

> ngrok 固定域名：`baculitic-derivable-sherilyn.ngrok-free.dev`（免费固定域名，不会变）

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
| tasks | 任务队列 |

表结构由 `initDb.js` 自动创建，不需要手动建表。

---

## 文件分布地图（代码 / 模型 / 数据在哪里）

### 代码文件
| 内容 | 路径 |
|------|------|
| H5前端 + 管理后台 | `C:\AIClaudecode\backend\public\` |
| 云后端 API | `C:\AIClaudecode\backend\routes\` |
| 本地服务（ASR/TTS/字幕/数字人管理） | `C:\AIClaudecode\local_asr_server\main.py` |
| IndexTTS 服务 | `C:\AIClaudecode\local_asr_server\indextts_server.py` |
| HeyGem 数字人服务 | `C:\AIClaudecode\desktop_client\heygem_server.py` |

### 模型文件（大文件，不进 Git）
| 模型 | 路径 |
|------|------|
| **Whisper medium**（语音转写） | `C:\Users\木木\.cache\whisper\medium.pt` |
| **IndexTTS**（语音克隆） | `C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\checkpoints\` |
| **HeyGem**（数字人） | `C:\ChaojiIP\aigc-human\python-modules\humanModule\pretrain_models\` |

### Python 环境（venv）
| 服务 | venv 路径 |
|------|-----------|
| ASR + IndexTTS 共用 | `C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\` |
| HeyGem | `C:\ChaojiIP\aigc-human\python-modules\humanModule\venv\` |

### 运行时数据（用户数据）
| 内容 | 路径 |
|------|------|
| 数字人形象视频（用户上传） | `C:\AIClaudecode\local_asr_server\avatars\u{userId}\` |
| TTS 临时输出 | `C:\AIClaudecode\local_asr_server\tts_outputs\` |
| HeyGem 生成输出 | `C:\AIClaudecode\desktop_client\heygem_outputs\` |
| 数据库（用户/配置/历史） | Zeabur MySQL 云端，不在本地 |

### 如何管理
- **代码**：全部在 `C:\AIClaudecode\`，通过 Git 管理，push 到 GitHub 自动部署
- **模型**：在 `C:\ChaojiIP\` 下，不进 Git，机器迁移时需单独拷贝（几十GB）
- **用户数据**：`avatars/` 目录在本地磁盘，需定期备份；数据库在 Zeabur 云端自动维护
- **venv**：不进 Git，换机器需重新建（`pip install -r requirements.txt`）

---

## 功能进展

### ✅ 已完成
- H5 前端（单文件，部署在 Zeabur）
- 用户注册/登录（手机验证码 + 密码）
- 抖音视频文案提取（TikHub API）
- AI 文案改写（支持多 AI 服务商）
- 灵感发现（行业赛道 → 爆款文案）
- 语音合成（edge-tts 多音色 + IndexTTS 声音克隆）
- 声音管理（上传参考音频）
- 数字人视频生成（HeyGem，本地 GPU）
- 字幕烧录（Whisper 识别时间轴 → ASS → FFmpeg）
- 字幕模板（6 种预设 + 自定义微调）
- 封面生成（Canvas 抓帧 + AI 标题 + 文字叠加）
- 数字人管理（上传/库选/删除，本地磁盘存储）
- 管理后台（AI Key、提示词、行业、用户管理）

### ❌ 未做 / 已放弃
- 会员付费系统（已决定不做）
- 微信小程序（已暂停）
- VideoReTalking / SadTalker（效果不佳，已删除，使用 HeyGem）

---

## ⚠️ 黄金规则

### 每个文件只有一个位置
| 要改什么 | 改哪个文件 |
|----------|-----------|
| H5 页面（用户端） | `backend/public/index.html` |
| 管理后台 | `backend/public/admin.html` |
| API 接口 | `backend/routes/对应文件.js` |
| 数据库结构 | `backend/initDb.js` |
| 本地 AI 服务 | `local_asr_server/main.py` |

### 操作顺序
```bash
git pull        # 1. 先拉最新
# 改代码
git add .
git commit -m "说明"
git push        # 3. 改完立刻推
```

