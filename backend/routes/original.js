// routes/original.js — 原创工坊：Skill + 项目 + 对话 + 学习中心
const express = require('express');
const https = require('https');
const db = require('../db');
const { requireAuth } = require('./auth');
const { callAI } = require('../lib/callAI');
const { getAsrUrl, extractMp4Url, asrTranscribe } = require('../lib/asrHelper');
const router = express.Router();

/**
 * 手动取一次重定向的 Location 头（不用 fetch，避免 Node.js undici 对含中文字符
 * 的 Location 抛 ByteString 错误）
 */
function getRedirectLocation(url, timeout = 6000) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (val) => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(val); } };
    const timer = setTimeout(() => { try { req.destroy(); } catch {} done(''); }, timeout);
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': '*/*',
      },
    }, (res) => { res.resume(); done(res.headers?.location || ''); });
    req.on('error', () => done(''));
  });
}

/* ─────────── 工具函数 ─────────── */

// 读取 TikHub API Key（与 extract.js 复用同一配置）
async function getTikhubKey() {
  const { rows } = await db.query("SELECT value FROM system_config WHERE config_key = 'tikhub_api_key'");
  return rows?.[0]?.value || '';
}

// 从用户输入（可能是分享文本、短链、完整链接）中提取可用的抖音视频 URL
function extractDouyinVideoUrl(input) {
  const text = input.trim();
  // 1. 优先提取 https:// 开头的链接
  const urlMatch = text.match(/https?:\/\/[^\s，。,]+/);
  if (urlMatch) return urlMatch[0].replace(/[）)>》\]]+$/, '');
  // 2. 识别不带 https:// 的短链（如 v.douyin.com/xxx）
  const shortMatch = text.match(/(?:v\.douyin\.com|www\.douyin\.com)\/[^\s，。,]+/);
  if (shortMatch) return 'https://' + shortMatch[0].replace(/[）)>》\]]+$/, '');
  return '';
}

// 从 URL 或短链中解析 aweme_id（跟随重定向，用 https.get 避免 ByteString 问题）
async function resolveAwemeId(url) {
  // 1. 直接从完整 URL 提取（/video/XXXXXXXXXXXXXXXX）
  const direct = url.match(/\/video\/(\d{10,20})/);
  if (direct) return direct[1];
  // 2. 从查询参数提取
  const qp = url.match(/[?&]aweme_id=(\d{10,20})/);
  if (qp) return qp[1];
  // 3. 短链跟随重定向（最多两跳）
  try {
    const loc1 = await getRedirectLocation(url);
    if (loc1) {
      const m1 = loc1.match(/\/video\/(\d{10,20})/);
      if (m1) return m1[1];
      const loc2 = await getRedirectLocation(loc1);
      if (loc2) {
        const m2 = loc2.match(/\/video\/(\d{10,20})/);
        if (m2) return m2[1];
      }
    }
  } catch {}
  return null;
}

// 用 aweme_id 查视频详情（TikHub 新接口）
async function fetchVideoByAwemeId(awemeId, tikhubKey) {
  // 先试 app v3（参数 aweme_id）
  const r1 = await fetch(
    `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video?aweme_id=${awemeId}`,
    { headers: { Authorization: `Bearer ${tikhubKey}` } }
  );
  if (r1.ok) {
    const d = await r1.json();
    if (d?.data?.aweme_detail) return d.data.aweme_detail;
  }
  // 降级：web 接口
  const r2 = await fetch(
    `https://api.tikhub.io/api/v1/douyin/web/fetch_one_video?aweme_id=${awemeId}`,
    { headers: { Authorization: `Bearer ${tikhubKey}` } }
  );
  if (r2.ok) {
    const d = await r2.json();
    if (d?.data?.aweme_detail) return d.data.aweme_detail;
    if (d?.data?.item_list?.[0]) return d.data.item_list[0];
  }
  return null;
}

// 拉取单个抖音视频的真实文案（字幕优先，无字幕降级用描述）
async function fetchVideoScript(url, tikhubKey) {
  // 解析 aweme_id（支持短链重定向）
  const awemeId = await resolveAwemeId(url);
  if (!awemeId) throw new Error('无法从链接中解析视频ID，请确认链接完整且为抖音视频链接');

  // 获取视频详情
  const item = await fetchVideoByAwemeId(awemeId, tikhubKey);
  if (!item) throw new Error('视频信息获取失败，请检查链接是否有效');

  // 1. 优先用 TikHub 内置字幕
  let script = '';
  try {
    const subtitleResp = await fetch(
      `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_video_subtitle?aweme_id=${awemeId}`,
      { headers: { Authorization: `Bearer ${tikhubKey}` } }
    );
    if (subtitleResp.ok) {
      const subData = await subtitleResp.json();
      const subtitles = subData?.data?.subtitle_infos?.[0]?.subtitle_list;
      if (subtitles?.length) {
        script = subtitles.map(s => s.words?.map(w => w.word).join('') || s.text).join('');
      }
    }
  } catch {}

  // 2. 无内置字幕 → 发给本地 Whisper ASR 转录
  if (!script) {
    const mp4Url = extractMp4Url(item);
    const asrUrl = await getAsrUrl();
    if (mp4Url && asrUrl) {
      console.log(`[Original] TikHub 无字幕，启动 ASR 转录: aweme_id=${awemeId}`);
      script = await asrTranscribe(mp4Url, asrUrl);
    }
  }

  return {
    script: script || item.desc || '',
    desc: item.desc || '',
    likes: item.statistics?.digg_count || 0,
    author: item.author?.nickname || '',
  };
}

// 从抖音主页链接中解析 sec_user_id（形如 douyin.com/user/MS4wLjABAAAA...）
function extractSecUserId(url) {
  const m = url.match(/user\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : '';
}

// 拉取某账号最近的视频列表（真实数据）
async function fetchUserRecentVideos(secUserId, tikhubKey, count = 20) {
  const resp = await fetch(
    `https://api.tikhub.io/api/v1/douyin/web/fetch_user_post_videos?sec_user_id=${encodeURIComponent(secUserId)}&max_cursor=0&count=${count}`,
    { headers: { Authorization: `Bearer ${tikhubKey}` } }
  );
  if (!resp.ok) throw new Error(`账号主页解析失败: ${await resp.text()}`);
  const data = await resp.json();
  const list = data?.data?.aweme_list || [];
  return list.map(v => ({
    aweme_id: v.aweme_id,
    desc: v.desc || '',
    likes: v.statistics?.digg_count || 0,
  }));
}

// 获取用户 Skill（不存在则创建空模板）
async function getOrCreateSkill(userId) {
  const { rows } = await db.query('SELECT * FROM cw_skills WHERE user_id = ?', [userId]);
  if (rows && rows[0]) {
    const s = rows[0];
    return {
      id: s.id,
      version: s.version,
      rules: typeof s.rules === 'string' ? JSON.parse(s.rules) : (s.rules || {}),
      keywords: typeof s.keywords === 'string' ? JSON.parse(s.keywords) : (s.keywords || []),
      forbidden: typeof s.forbidden === 'string' ? JSON.parse(s.forbidden) : (s.forbidden || []),
      updatedAt: s.updated_at,
    };
  }
  // 创建空 Skill
  await db.query(
    "INSERT INTO cw_skills (user_id, version, rules, keywords, forbidden) VALUES (?, 'v1.0', '{}', '[]', '[]')",
    [userId]
  );
  return { version: 'v1.0', rules: {}, keywords: [], forbidden: [], updatedAt: new Date() };
}

// 验证项目归属
async function getProject(projectId, userId) {
  const { rows } = await db.query(
    'SELECT * FROM cw_original_projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  );
  return rows?.[0] || null;
}

// 把 rules 对象格式化成文本供 AI 读取
function formatRulesForPrompt(skill) {
  if (!skill) return '（暂无规则）';
  const lines = [];
  const rules = skill.rules || {};
  for (const [group, arr] of Object.entries(rules)) {
    if (Array.isArray(arr) && arr.length > 0) {
      lines.push(`【${group}】`);
      arr.forEach(r => lines.push(`- ${r.text}`));
    }
  }
  if ((skill.keywords || []).length > 0) {
    lines.push(`【高频词】${skill.keywords.join('、')}`);
  }
  if ((skill.forbidden || []).length > 0) {
    lines.push(`【禁区】${skill.forbidden.join('、')}`);
  }
  return lines.length > 0 ? lines.join('\n') : '（暂无规则）';
}

/* ═══════════════════════════════════════
   SKILL 接口
═══════════════════════════════════════ */

// GET /api/original/skill
router.get('/skill', requireAuth, async (req, res) => {
  try {
    const skill = await getOrCreateSkill(req.userId);
    res.json({ code: 200, data: skill });
  } catch (err) {
    console.error('/original/skill GET error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// PUT /api/original/skill — 全量更新 skill（管理员或用户手动编辑）
router.put('/skill', requireAuth, async (req, res) => {
  const { rules, keywords, forbidden } = req.body;
  try {
    // 先确保记录存在
    await getOrCreateSkill(req.userId);
    // 获取当前 version 并 bump patch
    const { rows } = await db.query('SELECT version FROM cw_skills WHERE user_id = ?', [req.userId]);
    const curVer = rows?.[0]?.version || 'v1.0';
    const parts = curVer.replace('v', '').split('.').map(Number);
    parts[1] = (parts[1] || 0) + 1;
    const newVer = `v${parts[0]}.${parts[1]}`;

    await db.query(
      'UPDATE cw_skills SET rules = ?, keywords = ?, forbidden = ?, version = ? WHERE user_id = ?',
      [JSON.stringify(rules || {}), JSON.stringify(keywords || []), JSON.stringify(forbidden || []), newVer, req.userId]
    );
    const skill = await getOrCreateSkill(req.userId);
    res.json({ code: 200, data: skill });
  } catch (err) {
    console.error('/original/skill PUT error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

/* ═══════════════════════════════════════
   PROJECT 接口
═══════════════════════════════════════ */

// GET /api/original/projects
router.get('/projects', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, title, brief, status, turns, created_at, updated_at FROM cw_original_projects WHERE user_id = ? ORDER BY updated_at DESC',
      [req.userId]
    );
    res.json({ code: 200, data: rows || [] });
  } catch (err) {
    console.error('/original/projects GET error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// POST /api/original/projects — 创建新项目
router.post('/projects', requireAuth, async (req, res) => {
  const { title, brief = '' } = req.body;
  if (!title?.trim()) return res.status(400).json({ code: 400, msg: '请填写项目标题' });
  try {
    const { rows } = await db.query(
      "INSERT INTO cw_original_projects (user_id, title, brief, status, doc, turns) VALUES (?, ?, ?, 'draft', '', 0)",
      [req.userId, title.trim(), brief.trim()]
    );
    const id = rows?.[0]?.id;
    res.json({ code: 200, data: { id, title: title.trim(), brief: brief.trim(), status: 'draft', doc: '', turns: 0 } });
  } catch (err) {
    console.error('/original/projects POST error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// GET /api/original/projects/:id — 项目详情 + 消息列表
router.get('/projects/:id', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  try {
    const project = await getProject(projectId, req.userId);
    if (!project) return res.status(404).json({ code: 404, msg: '项目不存在' });

    const { rows: msgs } = await db.query(
      'SELECT * FROM cw_original_messages WHERE project_id = ? ORDER BY created_at ASC',
      [projectId]
    );
    res.json({ code: 200, data: { project, messages: msgs || [] } });
  } catch (err) {
    console.error('/original/projects/:id GET error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// PATCH /api/original/projects/:id — 更新状态 / 更新消息 sync_done
router.patch('/projects/:id', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  const { status, msgId, syncDone } = req.body;
  try {
    const project = await getProject(projectId, req.userId);
    if (!project) return res.status(404).json({ code: 404, msg: '项目不存在' });

    if (status) {
      await db.query('UPDATE cw_original_projects SET status = ? WHERE id = ?', [status, projectId]);
    }
    if (msgId && syncDone) {
      await db.query('UPDATE cw_original_messages SET sync_done = ? WHERE id = ? AND project_id = ?', [syncDone, msgId, projectId]);
      // 如果是 synced，把这条规律写入 Skill
      if (syncDone === 'synced') {
        const { rows: msgRows } = await db.query('SELECT sync_label FROM cw_original_messages WHERE id = ?', [msgId]);
        const label = msgRows?.[0]?.sync_label;
        if (label) {
          const skill = await getOrCreateSkill(req.userId);
          const rules = skill.rules || {};
          if (!rules['项目同步']) rules['项目同步'] = [];
          // 去重
          const exists = rules['项目同步'].some(r => r.text === label);
          if (!exists) {
            rules['项目同步'].push({ text: label, source: `项目#${projectId}同步`, sourceType: 'project', uses: 0 });
            // 更新版本号
            const curVer = skill.version || 'v1.0';
            const parts = curVer.replace('v', '').split('.').map(Number);
            parts[1] = (parts[1] || 0) + 1;
            const newVer = `v${parts[0]}.${parts[1]}`;
            await db.query(
              'UPDATE cw_skills SET rules = ?, version = ? WHERE user_id = ?',
              [JSON.stringify(rules), newVer, req.userId]
            );
          }
        }
      }
    }
    res.json({ code: 200, msg: 'ok' });
  } catch (err) {
    console.error('/original/projects/:id PATCH error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

/* ═══════════════════════════════════════
   对话接口
═══════════════════════════════════════ */

// POST /api/original/projects/:id/chat
router.post('/projects/:id/chat', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ code: 400, msg: '消息不能为空' });

  try {
    const project = await getProject(projectId, req.userId);
    if (!project) return res.status(404).json({ code: 404, msg: '项目不存在' });

    const skill = await getOrCreateSkill(req.userId);
    const rulesText = formatRulesForPrompt(skill);

    // 保存用户消息
    await db.query(
      'INSERT INTO cw_original_messages (project_id, role, content) VALUES (?, ?, ?)',
      [projectId, 'user', message.trim()]
    );

    // 构建 AI 提示词
    const currentDoc = project.doc || '';
    const isFirstMessage = !currentDoc.trim();

    // 取最近的对话历史（最多 8 条）作为上下文
    const { rows: histRows } = await db.query(
      'SELECT role, content FROM cw_original_messages WHERE project_id = ? ORDER BY id DESC LIMIT 8',
      [projectId]
    );
    const history = (histRows || []).reverse()
      .map(m => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
      .join('\n');

    const systemPrompt = `你是一位经验丰富的短视频口播文案写手，专门帮用户写出能直接用的完整脚本。

## 你的核心工作方式
**先写，再改。** 只要用户给了一点方向，就立刻写出第一版完整文案，不要无限追问。
- 信息足够 → 直接写完整文案
- 信息不够 → 问最关键的 1 个问题 + 同时写一版猜测方向的草稿，让用户有东西可以反应
- 不要连续追问超过 1 次，第二条消息起必须有文案产出

## 用户 Skill 规则（写文案时遵守）
${rulesText}

## 当前项目信息
项目标题：${project.title}${project.brief ? `\n项目说明：${project.brief}` : ''}
⚠️ 注意：项目标题可能只是用户随手起的名字，不要过度解读标题，以用户在对话中说的内容为准。

## 当前文案版本
${isFirstMessage ? '（还没有文案，这是第一次创作）' : `---\n${currentDoc}\n---`}

${history ? `## 最近对话记录\n${history}\n` : ''}

## 什么时候输出【新文案】
- 用户说"帮我写/生成/来一版" → 立刻写，输出【新文案】
- 用户描述了内容方向/主题/想法 → 直接写草稿，输出【新文案】
- 用户说"改一下/调整/换" → 修改现有文案，输出【新文案】
- 用户只是打招呼"你好"或反馈"这里不对" → 简短回应，不输出【新文案】
- 但如果已经纯聊天了 1 轮还没写任何文案，下一轮必须主动产出文案草稿

## 输出格式（有文案时）
用一句话说你写/改了什么（≤30字）
【新文案】
完整文案内容
【/新文案】

## 文案质量要求
- 口播脚本，写成说话的语气，不要书面腔
- 1分钟≈150字，5分钟≈750字，按用户要求的时长写够
- 有钩子开场、内容主体、结尾引导，结构完整
- 不要用"首先其次最后"这种框架感强的词，要自然流畅`;

    const aiRaw = await callAI(systemPrompt + '\n\n用户：' + message.trim(), { maxTokens: 1500, temperature: 0.85 });

    // 解析 AI 回复：提取说明 + 新文案
    const docMatch = aiRaw.match(/【新文案】([\s\S]*?)【\/新文案】/);
    let newDoc = currentDoc;
    let aiSummary = aiRaw.trim();
    let hasDocUpdate = 0;

    if (docMatch) {
      newDoc = docMatch[1].trim();
      hasDocUpdate = 1;
      // 摘要 = 【新文案】之前的部分
      const beforeDoc = aiRaw.split('【新文案】')[0].trim();
      aiSummary = beforeDoc || '已更新文案。';
    }

    // 生成 sync_label（从摘要提取一个简短的规律标签）
    let syncLabel = null;
    if (hasDocUpdate) {
      const labelMatch = aiSummary.match(/[「」""](.{4,20})[「」""]/);
      if (labelMatch) {
        syncLabel = labelMatch[1];
      } else {
        // 从摘要中截取关键词作为 label
        const keywords = aiSummary.match(/[\u4e00-\u9fa5]{3,8}(钩子|写法|结构|开场|结尾|节奏|风格)/);
        if (keywords) syncLabel = keywords[0];
      }
    }

    // 更新活文档 + turns
    if (hasDocUpdate) {
      await db.query(
        'UPDATE cw_original_projects SET doc = ?, turns = turns + 1 WHERE id = ?',
        [newDoc, projectId]
      );
    } else {
      await db.query('UPDATE cw_original_projects SET turns = turns + 1 WHERE id = ?', [projectId]);
    }

    // 保存 AI 消息
    const { rows: ins } = await db.query(
      'INSERT INTO cw_original_messages (project_id, role, content, has_doc_update, sync_label, sync_done) VALUES (?, ?, ?, ?, ?, NULL)',
      [projectId, 'ai', aiSummary, hasDocUpdate, syncLabel]
    );
    const msgId = ins?.[0]?.id;

    // 获取最新项目数据
    const { rows: updated } = await db.query('SELECT * FROM cw_original_projects WHERE id = ?', [projectId]);

    res.json({
      code: 200,
      data: {
        message: {
          id: msgId,
          role: 'ai',
          content: aiSummary,
          has_doc_update: hasDocUpdate,
          sync_label: syncLabel,
          sync_done: null,
        },
        doc: newDoc,
        turns: updated?.[0]?.turns || 0,
      }
    });
  } catch (err) {
    console.error('/original/projects/:id/chat error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

/* ═══════════════════════════════════════
   学习中心
═══════════════════════════════════════ */

// POST /api/original/learning/analyze
// 真实拉取抖音内容（TikHub）后由 AI 提炼规律
router.post('/learning/analyze', requireAuth, async (req, res) => {
  const { url, type = 'account', scope = 'global' } = req.body;
  if (!url?.trim()) return res.status(400).json({ code: 400, msg: '请输入链接' });

  try {
    const tikhubKey = await getTikhubKey();
    if (!tikhubKey) return res.status(503).json({ code: 503, msg: '抖音解析未配置，请联系管理员配置 TikHub Key' });

    /* ── 单个视频：拉真实字幕 → AI 提炼结构规律 ── */
    if (type === 'video') {
      // 从用户输入中提取真实 URL（支持分享文本/短链/完整链接）
      const realUrl = extractDouyinVideoUrl(url);
      if (!realUrl) {
        return res.status(422).json({ code: 422, msg: '未识别到有效的视频链接。请直接粘贴视频 URL（如 https://v.douyin.com/xxx），或复制视频分享文本（会自动提取链接）' });
      }
      const v = await fetchVideoScript(realUrl, tikhubKey);
      if (!v.script.trim()) return res.status(422).json({ code: 422, msg: '该视频未提取到文案内容（可能无口播/无字幕）' });

      const prompt = `你是资深短视频口播文案分析师。下面是一条抖音视频的真实文案（口播字幕）：
---
${v.script.slice(0, 1500)}
---
请基于这条真实文案，提炼它的创作规律，重点分析：开场钩子写法、内容结构与节奏、结尾引导方式。
要求：用一段连贯的中文描述（80-140字），具体到可复用的手法，不要泛泛而谈，不要加标题或编号。`;
      const aiResult = await callAI(prompt, { maxTokens: 500, temperature: 0.6 });
      return res.json({ code: 200, data: { type: 'video', insight: aiResult.trim() } });
    }

    /* ── 账号主页：拉真实近期视频 → AI 归纳高频规律 ── */
    // 先从分享文本中提取 URL（支持短链 / 完整链接 / 纯文本粘贴）
    const accountRealUrl = extractDouyinVideoUrl(url) || url.trim();
    let secUserId = extractSecUserId(accountRealUrl);

    // 若直接提取不到 sec_user_id，跟随短链重定向（最多两跳）
    if (!secUserId) {
      try {
        const loc1 = await getRedirectLocation(accountRealUrl);
        if (loc1) {
          secUserId = extractSecUserId(loc1);
          if (!secUserId) {
            const loc2 = await getRedirectLocation(loc1);
            if (loc2) secUserId = extractSecUserId(loc2);
          }
        }
      } catch {}
    }

    if (!secUserId) {
      return res.status(422).json({ code: 422, msg: '未识别到账号主页链接。请打开抖音 → 进入对方主页 → 点右上角分享 → 复制链接，再粘贴到这里' });
    }

    const videos = await fetchUserRecentVideos(secUserId, tikhubKey, 20);
    if (!videos.length) return res.status(422).json({ code: 422, msg: '未获取到该账号的视频，请确认主页链接正确' });

    // 取点赞最高的前 6 条拉取真实字幕，结合所有标题构成语料
    const top = videos.slice().sort((a, b) => b.likes - a.likes).slice(0, 6);
    const subResults = await Promise.allSettled(
      top.map(v => fetchVideoScript(`https://www.douyin.com/video/${v.aweme_id}`, tikhubKey))
    );
    const corpusParts = [];
    subResults.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.script.trim()) {
        const charCount = r.value.script.length;
        const estSec = Math.round(charCount / 2.5);
        corpusParts.push(`【视频${i + 1}·赞${top[i].likes}·约${estSec}秒】\n${r.value.script.slice(0, 600)}`);
      }
    });
    const descCorpus = videos.filter(v => v.desc).slice(0, 20).map(v => `· ${v.desc}`).join('\n');
    const corpus = (corpusParts.join('\n\n') + '\n\n【全部视频标题】\n' + descCorpus).slice(0, 5000);

    if (!corpus.replace(/[\s【】·]/g, '').trim()) {
      return res.status(422).json({ code: 422, msg: '该账号视频缺少可分析的文案内容' });
    }

    const prompt = `你是一位资深短视频运营分析师。以下是某抖音账号近期 ${videos.length} 条视频的真实字幕/标题语料（按点赞排序）：

---
${corpus}
---

请对这个账号做一次完整深度拆解，严格以 JSON 格式返回下面的结构，不要输出 JSON 之外的任何内容：

{
  "overview": {
    "videoCount": ${videos.length},
    "contentTheme": "内容方向，25字内，说清赛道和人群",
    "avgDuration": "根据字数推算典型时长，150字≈60秒，300字≈2分钟",
    "style": "整体风格，15字内，如：快节奏口语化、强数字感"
  },
  "topScripts": [
    { "label": "赞XXX", "text": "该视频文案原文前150字，原样摘录不要改写" }
  ],
  "structure": {
    "opening": "开场（0-5秒）：具体用什么手法抓注意力，从语料里引用真实例句说明",
    "twist": "转折时机：约在第几秒出现转折或反转，转折套路是什么，引用真实例子",
    "body": "主体展开：内容如何组织（如3步骤/案例/对比），节奏怎样，具体说明",
    "cta": "结尾引导：用什么方式促互动或行动，引用语料中真实例句"
  },
  "topics": "选题规律（3-5句）：聚焦哪些话题方向、常用哪些切入角度、如何找到选题点",
  "language": "语言特征（3-5句）：语速快慢、句子长短、口语化程度、有无标志性句式或口头禅",
  "rules": [
    { "text": "可复用创作手法，20-40字，具体到怎么做、带真实例子更好", "freq": "出现X次" }
  ]
}

要求：
- topScripts 取语料中点赞最高的 2-3 条，原文摘录，不要改写
- structure 四个字段都要有具体细节，不能泛泛而谈，必须结合真实语料内容
- rules 给出 4-5 条，每条聚焦一个具体可操作手法
- 全部基于提供的语料，不编造数据`;

    const aiResult = await callAI(prompt, { maxTokens: 1500, temperature: 0.5 });

    let analysis = null;
    try {
      const jsonMatch = aiResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
    } catch (_) {
      // JSON 解析失败降级：把 AI 返回文本拆成几条 rules
      analysis = {
        overview: { videoCount: videos.length, contentTheme: '解析中', avgDuration: '—', style: '—' },
        topScripts: [],
        structure: { opening: '—', twist: '—', body: '—', cta: '—' },
        topics: aiResult.slice(0, 200),
        language: '—',
        rules: aiResult.split('\n').filter(l => l.trim().length > 10).slice(0, 5).map(l => ({
          text: l.replace(/^[-•\d.、\s"「」"]+/, '').trim(),
          freq: '基于近期视频',
        })).filter(x => x.text.length > 5),
      };
    }

    if (!analysis || (!analysis.rules?.length && !analysis.topics)) {
      return res.status(422).json({ code: 422, msg: '未能提炼到有效分析，请换个账号试试' });
    }

    // 规范化 rules
    analysis.rules = (analysis.rules || []).filter(x => x && x.text).slice(0, 5);
    // 规范化 topScripts
    analysis.topScripts = (analysis.topScripts || []).slice(0, 3);

    res.json({ code: 200, data: { type: 'account', analysis, analyzedCount: videos.length } });
  } catch (err) {
    console.error('/original/learning/analyze error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// POST /api/original/learning/write — 把选中的规律写入 Skill
router.post('/learning/write', requireAuth, async (req, res) => {
  const { insights, scope = 'global', projectId } = req.body;
  if (!insights || !insights.length) return res.status(400).json({ code: 400, msg: '没有选中规律' });

  try {
    if (scope === 'global') {
      const skill = await getOrCreateSkill(req.userId);
      const rules = skill.rules || {};
      if (!rules['学习中心']) rules['学习中心'] = [];
      for (const ins of insights) {
        const exists = rules['学习中心'].some(r => r.text === ins.text);
        if (!exists) {
          rules['学习中心'].push({ text: ins.text, source: '学习中心', sourceType: 'feed', uses: 0 });
        }
      }
      const curVer = skill.version || 'v1.0';
      const parts = curVer.replace('v', '').split('.').map(Number);
      parts[1] = (parts[1] || 0) + 1;
      const newVer = `v${parts[0]}.${parts[1]}`;
      await db.query(
        'UPDATE cw_skills SET rules = ?, version = ? WHERE user_id = ?',
        [JSON.stringify(rules), newVer, req.userId]
      );
      const updated = await getOrCreateSkill(req.userId);
      res.json({ code: 200, data: { skill: updated } });
    } else {
      // 仅用于本项目：返回成功，前端无需实际写入（这些规律在对话时由 AI 上下文处理）
      res.json({ code: 200, msg: '规律已记录，对话时会参考' });
    }
  } catch (err) {
    console.error('/original/learning/write error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

module.exports = router;
