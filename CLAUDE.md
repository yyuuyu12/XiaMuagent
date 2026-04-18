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
    ├── IndexTTS    :8766   语音克隆（声音复刻）
    └── 数字人服务  :7861   HeyGem（当前）/ VideoReTalking（安装中）
        ↕
ngrok 固定域名（把 8765 暴露到公网）
```

---

## 文件结构

```
XiaMuagent/
│
├── backend/                        ← Zeabur 部署的全部内容
│   ├── server.js                   ← Express 入口，挂载所有路由
│   ├── db.js                       ← MySQL 连接池
│   ├── initDb.js                   ← 建表（每次启动自动跑）
│   ├── package.json
│   ├── zbpack.json                 ← Zeabur 构建配置，不要动
│   │
│   ├── public/
│   │   ├── index.html              ← ★ H5 前端唯一文件（在这里改）
│   │   └── admin.html              ← ★ 管理后台唯一文件（在这里改）
│   │
│   └── routes/
│       ├── auth.js                 ← 注册/登录/JWT/个人信息
│       ├── ai.js                   ← AI 文案生成 + cover-title
│       ├── douyinToText.js         ← 抖音视频 → 文字
│       ├── extract.js              ← 文案提取
│       ├── history.js              ← 用户历史记录
│       ├── config.js               ← 后台配置读写
│       ├── codes.js                ← 授权码管理
│       ├── tasks.js                ← 任务队列
│       └── inspire.js              ← 灵感发现
│
├── local_asr_server/               ← 本地服务（Python，运行在你电脑上）
│   ├── main.py                     ← ★ 本地服务入口（端口 8765）
│   │                                  功能：Whisper转写、edge-tts、IndexTTS代理、
│   │                                       字幕烧录、数字人管理、视频生成代理
│   ├── indextts_server.py          ← IndexTTS 语音克隆服务（端口 8766）
│   ├── avatars/                    ← 数字人形象视频存储（按 u{userId}/ 分目录）
│   ├── tts_outputs/                ← TTS 临时输出
│   ├── start.bat                   ← 启动 ASR 服务（手动）
│   ├── start_indextts.bat          ← 启动 IndexTTS（手动）
│   ├── start_ngrok.bat             ← 启动 ngrok 穿透
│   ├── start_services.bat          ← 同时启动 ASR + ngrok（自启脚本用）
│   └── register_task.bat           ← 注册 IndexTTS 开机自启任务
│
├── desktop_client/                 ← 数字人生成服务（端口 7861）
│   ├── heygem_server.py            ← HeyGem 服务（当前使用）
│   ├── videoretalking_server.py    ← VideoReTalking 服务（安装中）
│   ├── start_heygem.bat            ← 启动 HeyGem
│   ├── start_videoretalking.bat    ← 启动 VideoReTalking
│   ├── VideoReTalking/             ← VideoReTalking 模型目录
│   └── SadTalker/                  ← SadTalker（已弃用）
│
├── docs/                           ← 需求文档（只读参考）
├── CLAUDE.md                       ← 本文件
└── .gitignore
```

---

## 本地服务一览

| 服务 | 端口 | 启动脚本 | 开机自启 | Python 路径 |
|------|------|----------|----------|-------------|
| **ASR 主服务** | 8765 | `start.bat` | ⚠️ 未配置（见下） | `C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe` |
| **ngrok 穿透** | — | `start_ngrok.bat` | ⚠️ 未配置（见下） | — |
| **IndexTTS** | 8766 | `start_indextts.bat` | ✅ 计划任务（`IndexTTS-Service`） | 同上 |
| **HeyGem 数字人** | 7861 | `desktop_client/start_heygem.bat` | ❌ 需手动启动 | HeyGem venv |
| **VideoReTalking** | 7861 | `desktop_client/start_videoretalking.bat` | ❌ 安装中 | `desktop_client/VideoReTalking/venv/` |

> ⚠️ **已知问题**：`start_services.bat` 引用了 `start_asr.bat`，但该文件已不存在（应为 `start.bat`），自启配置失效，需修复。

### 开机需手动启动的服务
每次开机需手动运行：
1. `local_asr_server\start.bat`（ASR + Whisper）
2. `local_asr_server\start_ngrok.bat`（公网穿透）
3. `desktop_client\start_heygem.bat`（数字人生成，用到时才需要开）

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

### 🔄 进行中
- **VideoReTalking 安装**：torch 2.11.0+cu128 已装，正在装 basicsr/facexlib 等依赖
  - 安装命令：`venv\Scripts\pip install basicsr facexlib gfpgan kornia==0.6.12 face-alignment librosa==0.9.2 einops numpy==1.23.4 ninja`
  - 装完后运行 `venv\Scripts\python -c "import basicsr"` 验证

### ❌ 未做 / 已放弃
- 会员付费系统（已决定不做）
- 微信小程序（已暂停）

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

### 待修复：start_services.bat 自启失效
```bat
:: 把第7行的 start_asr.bat 改为 start.bat
wscript.exe "...\run_hidden.vbs" "...\local_asr_server\start.bat"
```
