# 爆款文案工坊 · 项目手册

## 仓库 & 部署
- GitHub: yyuuyu12/XiaMuagent
- 部署平台: Zeabur（push 到 master 自动部署）
- 本地路径: C:\AIClaudecode

---

## 整体架构

```
用户浏览器
    ↕ HTTPS
Zeabur 云后端（Node.js Express）   ← 认证、API、数据库、任务状态
    ↕ HTTP（通过 frp 穿透）
本地 Windows 机器（RTX 5070Ti）
    ├── ASR 主服务    :8765   Whisper / edge-tts / 字幕 / IndexTTS 代理 / 数字人代理
    ├── IndexTTS      :8766   声音克隆，异步任务模式
    └── HeyGem V2     :7861   数字人视频生成
        ↕
frpc 穿透（两条隧道）
    asr.yyagent.top    → 127.0.0.1:8765
    heygem.yyagent.top → 127.0.0.1:7861
```

> ⚠️ 穿透使用 frp，不是 ngrok。后台配置填 `http://` 不要填 `https://`。

### 开机自启
登录 Windows 后自动启动：**HeyGem(7861) → ASR(8765) → IndexTTS(8766)** → 等待 90 秒 → **frpc**
- 自启脚本：`local_asr_server/startup.ps1`
- 日志：`local_asr_server/startup.log`

---

## 文件结构

```
C:\AIClaudecode\
│
├── backend/                          ← Zeabur 部署的全部内容
│   ├── server.js                     ← Express 入口，挂载所有路由
│   ├── db.js                         ← MySQL 连接池
│   ├── initDb.js                     ← 建表/补字段（每次启动自动跑）
│   ├── worker.js                     ← 后台任务处理器
│   ├── taskRunner.js                 ← 内存任务队列（串行）
│   ├── package.json
│   ├── zbpack.json                   ← Zeabur 构建配置，不要动
│   │
│   ├── public/
│   │   ├── index.html                ← ★ H5 前端唯一文件（在这里改）
│   │   └── admin.html                ← ★ 管理后台唯一文件（在这里改）
│   │
│   └── routes/
│       ├── auth.js                   ← 注册/登录/JWT/个人信息
│       ├── ai.js                     ← AI文案/TTS/IndexTTS异步代理/数字人视频代理/字幕后期
│       ├── inspire.js                ← 灵感发现（账号/视频分析）
│       ├── industryVideos.js         ← 行业精选视频、采集任务、采集状态
│       ├── douyinToText.js           ← 抖音视频 → 文字
│       ├── extract.js                ← 文案提取
│       ├── history.js                ← 用户历史记录
│       ├── tasks.js                  ← 任务中心、任务状态、任务会话
│       ├── config.js                 ← 后台配置读写、服务诊断
│       └── codes.js                  ← 授权码管理
│
├── local_asr_server/                 ← 本地综合服务（端口 8765）
│   ├── main.py                       ← ★ 服务入口（ASR/TTS/字幕/IndexTTS代理/数字人代理）
│   ├── indextts_server.py            ← IndexTTS 声音克隆（端口 8766，异步任务模式）
│   ├── startup.ps1                   ← ★ 开机自启脚本（HeyGem+ASR+IndexTTS+frpc）
│   ├── register_autostart.bat        ← 重新注册自启（管理员运行一次）
│   ├── start_asr.bat                 ← 手动启动 ASR（调试用）
│   ├── start_indextts.bat            ← 手动启动 IndexTTS
│   └── frp/frp_0.61.0_windows_amd64/frp_0.61.0_windows_amd64/
│       ├── frpc.exe
│       └── frpc.toml                 ← ★ frp 穿透配置（域名/端口在这里改）
│
├── desktop_client/                   ← 数字人生成服务
│   ├── heygem_server_v2.py           ← ★ HeyGem V2 服务（端口 7861）
│   └── start_heygem.bat              ← 手动启动（调试用，开机已自动启动）
│
├── docs/                             ← 需求文档（只读参考）
├── CLAUDE.md                         ← 本文件
└── .gitignore
```

---

## 本地服务一览

| 服务 | 端口 | 开机自启 | 手动启动 |
|------|------|----------|---------|
| **ASR 主服务** | 8765 | ✅ 自动 | `local_asr_server/start_asr.bat` |
| **IndexTTS 声音克隆** | 8766 | ✅ 自动 | `local_asr_server/start_indextts.bat` |
| **HeyGem 数字人** | 7861 | ✅ 自动 | `desktop_client/start_heygem.bat` |
| **frpc 穿透** | — | ✅ 自动（模型加载后90秒） | 见下方 frpc 启动命令 |

**一键启动所有服务：**
```powershell
C:\AIClaudecode\local_asr_server\startup.ps1
```

**手动启动 frpc（frpc 单独挂掉时用）：**
```powershell
cd C:\AIClaudecode\local_asr_server\frp\frp_0.61.0_windows_amd64\frp_0.61.0_windows_amd64
.\frpc.exe -c .\frpc.toml
```
看到 `[asr] start proxy success` + `[heygem] start proxy success` 才是成功。

**单独重启 ASR (8765)：**
```powershell
netstat -ano | findstr "8765"
taskkill /PID <PID> /F
cd C:\AIClaudecode\local_asr_server
C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe -u -m uvicorn main:app --host 0.0.0.0 --port 8765
```

**单独重启 IndexTTS (8766)：**
```powershell
netstat -ano | findstr "8766"
taskkill /PID <PID> /F
cd C:\AIClaudecode\local_asr_server
C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\python.exe indextts_server.py
```
成功标志：`IndexTTS2 v2 加载完成！GPU: True`

**单独重启 HeyGem (7861)：**
```powershell
netstat -ano | findstr "7861"
taskkill /PID <PID> /F
cd C:\AIClaudecode\desktop_client
C:\ChaojiIP\aigc-human\python-modules\hdModule\venv\python.exe heygem_server_v2.py
```

---

## 关键配置（管理后台设置，不要硬编码）

| 配置项 | 当前值 | 说明 |
|--------|--------|------|
| `asr_url` | `http://asr.yyagent.top` | ASR/TTS/字幕/IndexTTS 代理入口 |
| `video_url` | `http://heygem.yyagent.top` | 数字人视频服务，空时降级用 asr_url |
| `ai_provider` | — | AI 服务商 |
| `openai_api_key` | — | OpenAI Key |
| `deepseek_api_key` | — | DeepSeek Key |
| `tikhub_api_key` | — | 抖音解析/采集 API |
| `fish_audio_api_key` | — | Fish Audio 音色克隆（可选） |

> ⚠️ 填 `http://` 不要填 `https://`，frp 当前是 HTTP 穿透。

---

## API 路由挂载

```
/api/auth              → routes/auth.js
/api/config            → routes/config.js
/api/ai                → routes/ai.js
/api/extract           → routes/extract.js
/api/history           → routes/history.js
/api/codes             → routes/codes.js
/api/video             → routes/douyinToText.js
/api/inspire           → routes/inspire.js
/api/tasks             → routes/tasks.js
/api/industry-videos   → routes/industryVideos.js
```

---

## 数据库表（Zeabur MySQL）

| 表名 | 作用 |
|------|------|
| users | 用户账号、角色、授权信息、品牌名、头像 |
| usage_logs | 用户每日使用次数记录 |
| system_config | 后台配置（AI Key、URL 等） |
| prompt_templates | AI 提示词模板 |
| history | 用户创作历史 |
| auth_codes | 授权码 |
| industries | 行业分类与采集关键词 |
| industry_videos | 行业精选视频与文案 |
| tasks | 任务中心任务 |
| task_sessions | 克隆流程会话（改写/语音/数字人阶段状态） |
| sms_codes | 短信验证码 |

表结构由 `initDb.js` 自动创建/补字段，不需要手动建表。

---

## 文件分布地图

### 代码文件
| 内容 | 路径 |
|------|------|
| H5 前端 + 管理后台 | `backend/public/` |
| 云后端 API | `backend/routes/` |
| 本地 ASR/TTS/字幕/代理 | `local_asr_server/main.py` |
| IndexTTS 声音克隆 | `local_asr_server/indextts_server.py` |
| HeyGem 数字人服务 | `desktop_client/heygem_server_v2.py` |
| frp 穿透配置 | `local_asr_server/frp/.../frpc.toml` |

### 模型文件（大文件，不进 Git）
| 模型 | 路径 |
|------|------|
| **Whisper medium** | `C:\Users\木木\.cache\whisper\medium.pt` |
| **IndexTTS** | `C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\checkpoints\` |
| **HeyGem V2** | `C:\ChaojiIP\aigc-human\python-modules\hdModule\pretrain_models\` |

### Python 环境（venv，不进 Git）
| 服务 | venv 路径 |
|------|-----------|
| ASR + IndexTTS | `C:\ChaojiIP\aigc-human\python-modules\voiceV2Module\venv\` |
| HeyGem V2 | `C:\ChaojiIP\aigc-human\python-modules\hdModule\venv\` |

### 运行时数据
| 内容 | 路径 |
|------|------|
| 数字人形象视频（用户上传） | `local_asr_server/avatars/u{userId}/` |
| TTS 临时输出 | `local_asr_server/tts_outputs/` |
| HeyGem 生成输出 + faststart 版 | `desktop_client/heygem_outputs/` |
| 数据库 | Zeabur MySQL 云端 |

---

## IndexTTS 异步任务模式

声音克隆不再同步等待，避免 Zeabur 504 超时：

```
前端点击合成
  → Zeabur /api/ai/tts（提交）
  → ASR /tts/indextts/submit
  → IndexTTS /tts/submit → 立即返回 task_id
  → 前端每 5 秒轮询 /api/ai/tts/indextts/task/{taskId}
  → 推理完成 → 返回 wav 音频
```

提速参数（`indextts_server.py`）：
```python
max_text_tokens_per_segment=300
```

---

## 数字人视频流程

> ⚠️ 此流程已优化，请严格遵守，不要改动关键环节。

```
前端提交音频 + 数字人素材
  → Zeabur /api/ai/video/generate
      ↳ 读取 OSS 配置 → 附带 oss_config + user_id 传给 HeyGem
  → HeyGem /video/generate → 立即返回 task_id（异步生成）
  → 前端每 5 秒轮询 /api/ai/video/task/{taskId}

【HeyGem 本地后台执行】
  1. GPU 推理生成原始视频（~90s）
  2. GPU 压缩至 1080p CRF22（h264_nvenc，~5s；失败降级 libx264 ~45s）
  3. 本地直传 OSS（本机网络直连阿里云，~10-20s）→ 写入 task.oss_url
  4. 任务状态变为 done，oss_url 已就绪

【Zeabur 轮询代理 /api/ai/video/task/{taskId}】
  - 检测到 data.oss_url → 直接作为 video_url 返回，同时写入 user_videos 表
  - 若 oss_url 为空（本地直传失败）→ 降级：Zeabur 从 frp 下载再传 OSS（慢）
  - 若 OSS 未配置 → 返回 video_direct_url（frp 直连，最慢）

【前端收到 video_url（OSS CDN 链接）】
  → setState({ avatarVideoUrl, avatarDoneTaskId }) + saveCloneSession(4)
  → 视频立即播放，URL 写入 session，下次回来直接展示无需等待
```

### ⚠️ 关键约束（不要破坏）

| 约束 | 原因 |
|------|------|
| HeyGem 本地直传 OSS，不经 Zeabur 中转 | frp 带宽有限，Zeabur 中转会占满带宽导致前后端同时下载竞争 |
| 视频压缩优先用 `h264_nvenc`，失败才降级 `libx264` | GPU 编码 ~5s vs CPU ~45s |
| 压缩参数：`scale=-2:'min(ih,1080)'` + `crf/cq 22` | 限制 1080p，文件从 ~190MB 压到 ~30-50MB |
| 轮询间隔前台 5s，后台 8s | 之前 10s/15s 体感太慢 |
| `avatarDoneTaskId` 在 OSS 上传开始前就写入 session | 防止用户切任务后恢复时走"生成中30%"错误路径 |
| OSS URL（http 开头）直接存入 session | 恢复时无需异步请求，视频立即显示 |
| `oss2` 已装在 hdModule venv | `C:\ChaojiIP\aigc-human\python-modules\hdModule\venv\python.exe -m pip install oss2` |

---

## 功能进展

### ✅ 已完成
- H5 前端（单文件，部署在 Zeabur）
- 用户注册/登录（手机验证码 + 密码）
- 抖音视频文案提取（TikHub API）
- AI 文案改写（支持多 AI 服务商）
- 灵感发现（行业赛道 → 爆款文案）
- 行业精选视频采集（本地 Whisper 转录）
- 语音合成（edge-tts 多音色 + IndexTTS 声音克隆，异步任务模式）
- 声音管理（上传参考音频）
- 数字人视频生成（HeyGem V2，本地 GPU，faststart 修复）
- 字幕烧录（Whisper 时间轴 → ASS → FFmpeg）
- 字幕模板（6 种预设 + 自定义微调）
- 封面生成（Canvas 抓帧 + AI 标题 + 文字叠加）
- 数字人管理（上传/库选/删除，本地磁盘存储）
- 管理后台（AI Key、提示词、行业、用户管理）

### ❌ 未做 / 已放弃
- 会员付费系统（已决定不做）
- 微信小程序（已暂停）
- VideoReTalking / SadTalker（效果不佳，已删除）

---

## 常见问题排查

### 公网域名返回 frp 404
frpc 没启动，执行：
```powershell
cd C:\AIClaudecode\local_asr_server\frp\frp_0.61.0_windows_amd64\frp_0.61.0_windows_amd64
.\frpc.exe -c .\frpc.toml
```

### 本地服务健康检查
```powershell
Invoke-WebRequest http://127.0.0.1:8765/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8766/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:7861/health -UseBasicParsing
Invoke-WebRequest http://asr.yyagent.top/health -UseBasicParsing
Invoke-WebRequest http://heygem.yyagent.top/health -UseBasicParsing
```

### IndexTTS 504 超时
确认已是异步模式（`ai.js` 有 `/tts/indextts/submit`，`index.html` 有 `_pollIndexTTSTask`）。再检查 8766 是否在跑：
```powershell
netstat -ano | findstr "8766"
```

### 数字人视频浏览器 0:00
检查 `heygem_server_v2.py` 的 `/video/file/{task_id}` 接口是否正常返回 mp4，以及后台 `video_url` 是否填了 `http://heygem.yyagent.top`。

---

## ⚠️ 黄金规则

### 每个文件只有一个位置
| 要改什么 | 改哪个文件 |
|----------|-----------|
| H5 页面（用户端） | `backend/public/index.html` |
| 管理后台 | `backend/public/admin.html` |
| API 接口 | `backend/routes/对应文件.js` |
| 数据库结构 | `backend/initDb.js` |
| ASR/TTS/字幕/代理 | `local_asr_server/main.py` |
| IndexTTS 推理 | `local_asr_server/indextts_server.py` |
| 数字人视频生成 | `desktop_client/heygem_server_v2.py` |
| frp 穿透域名/端口 | `local_asr_server/frp/.../frpc.toml` |

### Git 操作顺序
```bash
git pull          # 1. 先拉最新
# 改代码
git add <相关文件>
git commit -m "说明"
git push          # 改完立刻推
```

> 不要提交：模型文件、venv、生成视频、用户上传素材、frp 日志。
