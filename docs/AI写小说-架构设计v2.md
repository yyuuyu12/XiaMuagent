# AI 写小说 · 综合架构设计 v2

> 调研四个开源系统后的融合设计。各家精华 + 爆款工坊现有基建 = 本方案。
> 取代 v1（AI写小说-设计规划.md），v1 保留作底稿。

---

## 一、四库精华对照（学到了什么）

| 库 | 定位 | 最值得抄的 | License |
|---|---|---|---|
| **tianming-skill**（天命） | 协议化 Prompt 系统 | 五件知识库模型；世界基石=单一动态事实源；冲突值量化节奏；伏笔三级 | CC BY-NC-SA（思想可学，文本不可搬） |
| **webnovel-writer** | Claude Code 插件，工程化最强 | **章节提交制**（写前合同→写后 CHAPTER_COMMIT，状态/索引/摘要全是派生视图）；9 步写章流水线；blocking 审查阻断；断点续跑 | GPL v3 |
| **arboris-novel** | FastAPI+Vue **Web 产品**（和我们形态最像） | 数据模型（蓝图/角色/关系/章节多版本）；**伏笔独立成表**；分维度优化器（对话/环境/心理/节奏）；六维审查；prompt 全文件化 | MIT（可参考改写） |
| **oh-story-claudecode** | 商业网文方法论 | **最简记忆包**（每章只注入"不知道就写错"的信息，有明确筛选标准）；扫榜→拆文→写作→去AI味闭环；38 份题材公式/钩子/反转知识库 | 见库内 |

**一句话总结四家分工**：天命给了"设定不崩"的哲学，webnovel-writer 给了"工程不乱"的主链，arboris 给了"产品长什么样"的参考，oh-story 给了"写得像人、写得商业"的方法论。

---

## 二、总体架构（五层）

```
┌─ 方法论层 ─────────────────────────────────────────┐
│ 题材公式包（玄幻/都市/悬疑…钩子公式+节奏模板+读者爽点）   │
│ 写作戒律 + 去AI味词库（禁区，critic 硬校验）             │
│ ↑ 复用现有：题材包体系 + 禁区机制，预置小说专用包          │
├─ 学习层 ──────────────────────────────────────────┤
│ 文风范例（show）/ 定稿diff学习 / 反馈效能分 / 待确认池    │
│ ↑ 全部复用现有 Skill 学习闭环                          │
├─ 生成层（每章流水线，异步任务）────────────────────────┤
│ ①组装最简记忆包 → ②起草 → ③审查(blocking阻断+自动重写)  │
│ → ④去AI味终检 → ⑤事实提取 → ⑥章节提交                 │
├─ 知识层 ──────────────────────────────────────────┤
│ 静态：设定卡(世界观/角色/势力/文风)  动态：世界基石state   │
│ 台账：伏笔表  滚动：前情摘要(每章提交后更新)              │
├─ 数据层（章节提交制 · 轻量事件溯源）────────────────────┤
│ nv_chapters 为主链：每章 final 即一次"提交"             │
│ state/摘要/伏笔状态 都由提交驱动更新，可追溯              │
└──────────────────────────────────────────────────┘
```

---

## 三、核心机制设计

### 1. 最简记忆包（oh-story 方案，解决上下文膨胀的关键）

每章生成前，从全部资料中**只筛出"不知道就会写错"的信息**：

```
筛选规则（程序化执行，不花 AI 调用）：
- 本章细纲提到的角色 → 取其角色卡 + state 里的当前状态
- 本章标记了伏笔动作（埋/推进/回收）→ 取该伏笔的埋设细节
- 本章涉及的地点/能力 → 取相关世界观条目（关键词匹配）
- 上一章结尾 600 字 + 滚动前情摘要（全书概况 300 字内）
- 纯背景、与本章无因果的 → 一律丢弃
```

> 对比：天命是"按协议加载"，webnovel-writer 用 RAG（embedding+rerank）。
> 我们 MVP 用规则筛选（零成本），P2 视效果决定是否上轻量检索。

### 2. 章节提交制（webnovel-writer 方案，简化版）

```
章节定稿（finalize）= 一次提交，原子地触发：
1. 事实提取（AI）：本章新实体 / 角色状态变化 / 伏笔动作 / 时间推进
2. 提取结果 → 「设定补丁」进待确认池（复用 addPendingRule 模式，
   默认全选一键采纳，降低操作成本）
3. 采纳后写回：nv_projects.state（世界基石）+ nv_foreshadowing 状态
4. 滚动前情摘要更新（AI 压缩一次）
5. 上一版正文存入 prev_content（轻量单版回滚）
```

state（世界基石）结构：
```json
{
  "characters": { "角色名": { "status": "一句话当前状态", "updatedCh": 12 } },
  "world": { "时间线": "...", "当前地点": "...", "重大事件": [] },
  "summary": "滚动前情摘要（300字内，每章更新）"
}
```

### 3. 写章流水线（融合 webnovel 9 步，压缩到产品可承受的成本）

```
POST /chapters/:id/generate → 入 tasks 异步队列（复用 taskRunner）

步骤                          AI调用   说明
① 组装最简记忆包                0      规则筛选
② 起草（3000-4500字）           1      细纲蓝图+记忆包+文风范例+戒律+题材包
③ critic 审查                  0-1    blocking：设定冲突/禁区词/字数偏离>30%
                                      不过 → 带审查意见自动重写一轮（最多1次）
④ 去AI味终检                    0      banned-words 程序化替换/标红
⑤ 返回正文                      —      前端轮询取回（同数字人任务模式）

定稿时（finalize，异步不阻塞）：
⑥ 事实提取 + 摘要更新            1-2    设定补丁→待确认

单章成本：2-4 次调用。100 章 ≈ 300 次，可控。
```

### 4. 伏笔台账（arboris 方案）

独立表 + 独立页面，三个状态流转：`embedded(已埋) → advanced(已推进) → resolved(已回收)`。
写章时若本章细纲含伏笔动作，记忆包自动带上"伏笔提醒"；体检时扫出超过 N 章未推进的伏笔。

### 5. 题材公式包（oh-story 38 份知识库的产品化）

复用现有题材包机制，**预置官方小说题材包**（玄幻/都市/悬疑/言情…），内容结构：

```
## 读者与爽点（这个题材读者要什么，按优先级）
## 钩子公式（章末钩/段落钩/悬念钩，给句式）
## 节奏模板（几章一小爽、几章一大爽、感情线穿插频率）
## 题材禁忌（写了就掉追读的雷）
```

> 与口播题材包同表（cw_skill_packs 加 scope 字段或独立 nv_packs），挂载到小说项目。

### 6. 多版本对比（arboris，P2）

「重新生成」时保留旧版，左右对比挑段落合并——先做轻量版（prev_content 单版回滚），完整多版本 P2 再说。

---

## 四、数据库设计

```sql
nv_projects (
  id, user_id, title, genre VARCHAR(50), brief TEXT,
  persona TEXT,              -- 作家人设/叙事视角（arboris writer_persona）
  target_words INT, status ENUM(active/finished/archived),
  state JSON,                -- 世界基石（见上文结构）
  pack_id INT,               -- 挂载的题材公式包
  outline MEDIUMTEXT,        -- 全书大纲（卷级）
  created_at, updated_at )

nv_kb_cards (
  id, project_id, kind ENUM(world/character/faction/style),
  title VARCHAR(200), content MEDIUMTEXT, sort INT, updated_at )

nv_chapters (
  id, project_id, volume INT, seq INT, title VARCHAR(200),
  outline TEXT,              -- 本章细纲（蓝图，生成正文的"合同"）
  content MEDIUMTEXT, prev_content MEDIUMTEXT,
  word_count INT, status ENUM(todo/drafted/final), updated_at )

nv_foreshadowing (
  id, project_id, title VARCHAR(200), detail TEXT,
  setup_chapter INT, status ENUM(embedded/advanced/resolved),
  expected_chapter INT,      -- 预期回收章（体检用）
  updated_at )

nv_messages (                -- 章节内对话调整，同 cw_original_messages
  id, chapter_id, role, content, has_doc_update, created_at )
```

## 五、接口设计（routes/novel.js）

| 接口 | 模式 | 说明 |
|---|---|---|
| CRUD /api/novel/projects | 同步 | 书架 |
| POST /projects/:id/kb/bootstrap | 同步~30s | 一句话设定 → AI 生成世界观+主角+反派卡初稿 |
| CRUD /projects/:id/kb | 同步 | 设定卡 |
| POST /projects/:id/outline | 同步 | 全书大纲（卷级） |
| POST /projects/:id/toc | 同步 | 批量章节细纲（每批 10-20 章） |
| POST /chapters/:id/generate | **异步** | 写章流水线（tasks 队列+轮询） |
| POST /chapters/:id/chat | 同步 | 对话修改本章（复用原创工坊模式） |
| POST /chapters/:id/finalize | 同步+异步钩子 | 定稿 → 触发提交链 |
| CRUD /projects/:id/foreshadowing | 同步 | 伏笔台账 |
| GET /projects/:id/health | 同步 | 体检：未回收伏笔/状态矛盾/断更章 |
| GET /projects/:id/export | 同步 | 导出 txt（整书/分卷） |

## 六、页面设计（desktop.html 小说创作区）

```
AI 写小说
├── 书架页：项目卡（封面色块+书名+进度 N/M 章+最近更新）
├── 新建向导（3步）：①题材选择(预置公式包) ②一句话设定+篇幅
│                   ③AI 生成设定卡初稿 → 确认开写
└── 项目内（三栏，复用 do-ws 布局基因）
     ├── 左栏：卷/章节树 + 入口（设定集/伏笔台账/世界基石/体检）
     ├── 中栏：创作助手对话（调整细纲、讨论剧情、改写段落）
     └── 右栏：当前章正文（活文档：生成中显示进度/可编辑/定稿按钮）
```

## 七、分期落地

| 期 | 内容 | 估时 |
|---|---|---|
| **MVP** | 表结构+书架+新建向导+设定卡(AI bootstrap)+全书大纲+章节细纲+**写章流水线(①②③④)**+对话修改+手动编辑+导出 txt | 5 天 |
| **P1** | 章节提交制(⑤⑥事实提取→设定补丁→待确认→state 写回)+滚动摘要+最简记忆包完整版 | 2-3 天 |
| **P2** | 伏笔台账+体检+预置 4-6 个题材公式包+去AI味词库+多版本对比 | 2-3 天 |
| **P3** | 扫榜/拆文（**对接现有学习中心**：拆爆款书→规律入题材包）+追读力审查+epub | 按需 |

## 八、风险与对策

1. **单章 1-3 分钟生成** → 必须异步（IndexTTS 504 教训），前端轮询+可后台运行
2. **上下文膨胀** → 最简记忆包从 MVP 就做规则版；滚动摘要 P1 必做
3. **设定漂移** → 设定补丁"默认全选一键采纳"；体检定期兜底
4. **成本** → 单章 2-4 调用；管理后台给小说区独立模型配置（ai_model_novel），初稿可用便宜模型
5. **License** → 思想借鉴 + prompt 全部自写；arboris(MIT) 的 prompt 结构可参考改写；不搬 GPL/CC-NC 文本
```
