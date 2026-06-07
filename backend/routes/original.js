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
  let scriptSource = '';
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
        if (script.trim()) scriptSource = 'subtitle';
      }
    }
  } catch {}

  // 2. 无内置字幕 → 发给本地 Whisper ASR 转录
  let asrError = '';
  if (!script.trim()) {
    const mp4Url = extractMp4Url(item);
    const asrUrl = await getAsrUrl();
    if (!mp4Url) {
      asrError = 'TikHub 未返回可用的视频下载地址';
    } else if (!asrUrl) {
      asrError = 'ASR 服务地址未配置';
    } else {
      console.log(`[Original] TikHub 无字幕，启动 ASR 转录: aweme_id=${awemeId} mp4Url=${mp4Url.slice(0,60)}...`);
      const asrResult = await asrTranscribe(mp4Url, asrUrl);
      script = asrResult.text || '';
      asrError = asrResult.error || '';
      if (script.trim()) scriptSource = 'asr';
    }
  }

  // ⚠️ 不要用 item.desc（标题）兜底当原文，否则会把标题当口播去分析。
  // 取不到口播就返回空 script，由上层如实提示用户。
  return {
    script: script.trim(),
    scriptSource,            // 'subtitle' | 'asr' | ''（空表示口播未取到）
    asrError,                // 转录具体失败原因，便于用户排查
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
      checkPrompt: s.check_prompt || '',
      freeText: s.free_text || '',
      freeTextHistory: s.free_text_history
        ? (typeof s.free_text_history === 'string' ? JSON.parse(s.free_text_history) : s.free_text_history)
        : [],
      updatedAt: s.updated_at,
    };
  }
  // 创建空 Skill
  await db.query(
    "INSERT INTO cw_skills (user_id, version, rules, keywords, forbidden) VALUES (?, 'v1.0', '{}', '[]', '[]')",
    [userId]
  );
  return { version: 'v1.0', rules: {}, keywords: [], forbidden: [], checkPrompt: '', freeText: '', freeTextHistory: [], updatedAt: new Date() };
}

// 验证项目归属，自动解析 meta JSON
async function getProject(projectId, userId) {
  const { rows } = await db.query(
    'SELECT * FROM cw_original_projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  );
  if (!rows?.[0]) return null;
  const p = rows[0];
  if (p.meta && typeof p.meta === 'string') {
    try { p.meta = JSON.parse(p.meta); } catch { p.meta = {}; }
  }
  p.meta = p.meta || {};
  return p;
}

// 把 rules 对象格式化成文本供 AI 读取
// 若用户写了 freeText（自由编辑模式），优先使用它；结构化规则作为补充追加
function formatRulesForPrompt(skill) {
  if (!skill) return '（暂无规则）';

  // 自由文本优先
  const freeText = (skill.freeText || '').trim();

  // 结构化规则
  const structLines = [];
  const rules = skill.rules || {};
  for (const [group, arr] of Object.entries(rules)) {
    if (Array.isArray(arr) && arr.length > 0) {
      structLines.push(`【${group}】`);
      arr.forEach(r => structLines.push(`- ${typeof r === 'string' ? r : r.text}`));
    }
  }
  if ((skill.keywords || []).length > 0) {
    structLines.push(`【高频词】${skill.keywords.join('、')}`);
  }
  if ((skill.forbidden || []).length > 0) {
    structLines.push(`【禁区】${skill.forbidden.join('、')}`);
  }

  if (freeText && structLines.length > 0) {
    return `${freeText}\n\n---\n${structLines.join('\n')}`;
  }
  if (freeText) return freeText;
  return structLines.length > 0 ? structLines.join('\n') : '（暂无规则）';
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
  const { rules, keywords, forbidden, checkPrompt, freeText } = req.body;
  try {
    // 先确保记录存在
    await getOrCreateSkill(req.userId);
    // 获取当前 version 并 bump patch
    const { rows } = await db.query('SELECT version FROM cw_skills WHERE user_id = ?', [req.userId]);
    const curVer = rows?.[0]?.version || 'v1.0';
    const parts = curVer.replace('v', '').split('.').map(Number);
    parts[1] = (parts[1] || 0) + 1;
    const newVer = `v${parts[0]}.${parts[1]}`;

    // freeText 模式：只更新 free_text 列（rules 等不动），同时记录历史
    if (typeof freeText === 'string' && freeText !== undefined && rules === undefined) {
      // 把旧内容推进历史（最多保留 10 条）
      const { rows: oldRows } = await db.query('SELECT free_text, free_text_history FROM cw_skills WHERE user_id = ?', [req.userId]);
      const oldText = oldRows?.[0]?.free_text || '';
      const rawHist = oldRows?.[0]?.free_text_history;
      let history = rawHist ? (typeof rawHist === 'string' ? JSON.parse(rawHist) : rawHist) : [];
      if (oldText.trim()) {
        history.unshift({ text: oldText, savedAt: new Date().toISOString() });
        if (history.length > 10) history = history.slice(0, 10);
      }
      await db.query(
        'UPDATE cw_skills SET free_text = ?, free_text_history = ?, version = ? WHERE user_id = ?',
        [freeText || null, JSON.stringify(history), newVer, req.userId]
      );
    } else {
      await db.query(
        'UPDATE cw_skills SET rules = ?, keywords = ?, forbidden = ?, check_prompt = ?, version = ? WHERE user_id = ?',
        [JSON.stringify(rules || {}), JSON.stringify(keywords || []), JSON.stringify(forbidden || []), checkPrompt ?? null, newVer, req.userId]
      );
    }
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
  const { title, brief = '', duration, angle, style, platform } = req.body;
  if (!title?.trim()) return res.status(400).json({ code: 400, msg: '请填写项目标题' });
  const meta = { duration: duration || '1min', angle: angle || '', style: style || 'informative', platform: platform || 'douyin' };
  try {
    const { rows } = await db.query(
      "INSERT INTO cw_original_projects (user_id, title, brief, status, doc, turns, meta) VALUES (?, ?, ?, 'draft', '', 0, ?)",
      [req.userId, title.trim(), brief.trim(), JSON.stringify(meta)]
    );
    const id = rows?.[0]?.id;
    res.json({ code: 200, data: { id, title: title.trim(), brief: brief.trim(), status: 'draft', doc: '', turns: 0, meta } });
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

    // 读取项目元数据（时长/风格/平台）
    const meta = project.meta || {};
    const durationMap = { '30s': '30秒（约75字，6-8个镜头）', '1min': '1分钟（约150字，10-14个镜头）', '3min': '3分钟（约450字，22-28个镜头）' };
    const styleMap = { informative: '干货讲解（直接、数据、干货）', story: '故事叙事（情节弧线、情感共鸣）', contrast: '对比反差（before/after、A vs B）', twist: '悬念反转（埋伏笔、出乎意料）' };
    const platformMap = { douyin: '抖音', shipinhao: '视频号', xiaohongshu: '小红书' };
    const durationLabel = durationMap[meta.duration] || '1分钟';
    const styleLabel = styleMap[meta.style] || '干货讲解';
    const platformLabel = platformMap[meta.platform] || '抖音';

    const systemPrompt = `你是一位经验丰富的短视频口播文案写手，帮用户写出能直接用的口播脚本。

## 你的核心工作方式
**先写，再改。** 只要用户给了一点方向，就立刻写出第一版，不要无限追问。
- 信息足够 → 直接写完整口播
- 信息不够 → 问最关键的 1 个问题 + 同时写一版猜测方向的草稿
- 不要连续追问超过 1 次，第二条消息起必须有文案产出

## 用户 Skill 规则（写文案时遵守）
${rulesText}

## 当前项目信息
项目标题：${project.title}${project.brief ? `\n项目说明：${project.brief}` : ''}
目标时长：${durationLabel}
视频风格：${styleLabel}
目标平台：${platformLabel}${meta.angle ? `\n核心观点：${meta.angle}` : ''}

## 当前文案版本
${isFirstMessage ? '（还没有文案，这是第一次创作）' : `---\n${currentDoc}\n---`}

${history ? `## 最近对话记录\n${history}\n` : ''}

## 什么时候输出【新剧本】
- 用户说"帮我写/生成/来一版" → 立刻写，输出【新剧本】
- 用户描述了内容方向/主题/想法 → 直接写草稿，输出【新剧本】
- 用户说"改一下/调整/换" → 修改现有文案，输出【新剧本】
- 用户只是打招呼或反馈问题 → 简短回应，不输出【新剧本】
- 如果已经纯聊天了 1 轮还没有文案，下一轮必须主动产出草稿

## 输出格式（有文案时）
用一句话说你写/改了什么（≤30字）
【新剧本】
（连续口播台词，写成说话的语气）

在**画面自然需要切换**的地方，用一行括号简单标注画面建议，格式：
〔画面：xxx〕

示例结构：
40%的选题判断，我现在直接丢给AI做。

〔画面：屏幕录屏，AI扫描爆款列表〕

0粉创作者最痛苦的不是不会剪，是你根本不知道该拍哪条。以前我靠感觉，拍完才知道不行。现在先看预测，再决定要不要开拍。

〔画面：左右对比，左"凭感觉"右"AI预测后开拍"〕

（继续台词……）
【/新剧本】

## 文案质量要求
- **台词是主体**，口语化，说话的感觉，不是读稿
- 画面标注只在自然切换点出现，不强制每句都配，不超过总段落的 1/3
- 画面描述简短（一句话），是方向建议，不是精确分镜
- 结构完整：强钩子开场 → 内容主体 → 结尾引导
- 严格按目标时长控制字数：30s≈75字，1分钟≈150字，3分钟≈450字
- 不用"首先其次最后"等书面框架词`;

    const aiRaw = await callAI(systemPrompt + '\n\n用户：' + message.trim(), { maxTokens: 2500, temperature: 0.85 });

    // 解析 AI 回复：提取说明 + 新剧本（兼容旧格式【新文案】）
    const docMatch = aiRaw.match(/【新剧本】([\s\S]*?)【\/新剧本】/) || aiRaw.match(/【新文案】([\s\S]*?)【\/新文案】/);
    const docTag = aiRaw.includes('【新剧本】') ? '【新剧本】' : '【新文案】';
    let newDoc = currentDoc;
    let aiSummary = aiRaw.trim();
    let hasDocUpdate = 0;

    if (docMatch) {
      newDoc = docMatch[1].trim();
      hasDocUpdate = 1;
      // 摘要 = 标签之前的部分
      const beforeDoc = aiRaw.split(docTag)[0].trim();
      aiSummary = beforeDoc || '已更新剧本。';
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

// 工具：从 AI 文本中提取第一段 JSON
function extractJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

// 把一段原文粗切成句子（中文标点 + 换行），用于降级标注
function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？!?\n])/)
    .map(s => s.trim())
    .filter(Boolean);
}

// POST /api/original/learning/extract —【阶段一】先提取原文，交给用户挑选
// 单个视频：返回这一条的完整原文；账号主页：返回近期视频列表（标题+点赞），由用户勾选
router.post('/learning/extract', requireAuth, async (req, res) => {
  const { url, type = 'account' } = req.body;
  if (!url?.trim()) return res.status(400).json({ code: 400, msg: '请输入链接' });

  try {
    const tikhubKey = await getTikhubKey();
    if (!tikhubKey) return res.status(503).json({ code: 503, msg: '抖音解析未配置，请联系管理员配置 TikHub Key' });

    /* ── 单个视频：直接拉取完整原文 ── */
    if (type === 'video') {
      const realUrl = extractDouyinVideoUrl(url);
      if (!realUrl) {
        return res.status(422).json({ code: 422, msg: '未识别到有效的视频链接。请直接粘贴视频 URL（如 https://v.douyin.com/xxx），或复制视频分享文本（会自动提取链接）' });
      }
      const awemeId = await resolveAwemeId(realUrl);
      const v = await fetchVideoScript(realUrl, tikhubKey);
      if (!v.script.trim()) {
        const reason = v.asrError ? `转录失败原因：${v.asrError}` : '可能是纯画面/BGM，或本地转录服务未在线';
        return res.status(422).json({ code: 422, msg: `没取到这条视频的口播原文：无内置字幕，${reason}` });
      }
      const estSec = Math.round(v.script.length / 2.5);
      return res.json({
        code: 200,
        data: {
          type: 'video',
          items: [{ awemeId, desc: v.desc, likes: v.likes, script: v.script, estSec, selected: true }],
        },
      });
    }

    /* ── 账号主页：拉近期视频列表（标题 + 点赞），让用户挑选要学的几条 ── */
    const accountRealUrl = extractDouyinVideoUrl(url) || url.trim();
    let secUserId = extractSecUserId(accountRealUrl);
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

    // 按点赞从高到低排序，前 3 条默认勾选
    const items = videos
      .slice()
      .sort((a, b) => b.likes - a.likes)
      .map((v, i) => ({ awemeId: v.aweme_id, desc: v.desc, likes: v.likes, script: '', selected: i < 3 }));

    return res.json({ code: 200, data: { type: 'account', items } });
  } catch (err) {
    console.error('/original/learning/extract error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// 对单条视频原文做「掰碎式」逐句拆解
async function analyzeOneVideo(item, tikhubKey) {
  let script = (item.script || '').trim();
  // 账号场景：阶段一只给了 awemeId，这里按需补拉原文
  if (!script && item.awemeId) {
    try {
      const v = await fetchVideoScript(`https://www.douyin.com/video/${item.awemeId}`, tikhubKey);
      script = (v.script || '').trim();
      if (!item.desc) item.desc = v.desc;
      if (!item.likes) item.likes = v.likes;
    } catch (_) {}
  }
  if (!script) return null;

  const scriptForAI = script.slice(0, 1100); // 控制 token，过长截断
  const estSec = Math.round(script.length / 2.5);

  const prompt = `你是顶级短视频口播操盘手。下面是一条抖音爆款视频的完整口播原文。
你的任务不是挑几个亮点，而是把这条视频【彻底反推还原成一套从 0 到 1 的可复刻创作蓝图】——
要让另一个创作者只拿着这套蓝图 + 一个新选题，就能写出同等质量、同种人设、同种结构与节奏的完整视频。
所以你给出的规律必须是"成体系、能反推出整条视频"的，而不是零散的几个亮点。

【原文】
${scriptForAI}

【信息】标题：${item.desc || '—'}｜点赞：${item.likes || 0}｜约${estSec}秒

请严格只返回 JSON（不要输出 JSON 以外任何文字）：
{
  "summary": "一句话点破这条视频的核心套路，30字内",
  "persona": "人设/身份/口吻：他以什么身份、对谁、用什么语气和姿态说话，2-3句",
  "topic": "选题与主题逻辑：核心主题是什么、在第几秒或哪个位置正式界定主题、为什么目标观众会留下来看，2-3句",
  "rhythm": "时长与节奏：总时长约多少、语速快慢、信息密度、停顿与重音、节奏在哪几处变化，2-4句",
  "structure": "从头到尾的结构骨架：按时间顺序分段说明每一段在什么位置、抛出什么、起什么作用，写成一张能照着写的提纲，4-8句",
  "segments": [
    { "text": "原文里的一句或一小段（按自然句切分，原话不要改写）", "role": "hook|background|point|turn|example|cta|normal", "note": "这句起什么作用、为什么这么写、好在哪；普通过渡句留空字符串" }
  ],
  "rules": [
    { "dim": "维度标签", "text": "可直接复用的创作指令，25-50字，具体到怎么做、放在视频什么位置、达到什么效果", "freq": "出现位置/次数" }
  ]
}

硬性要求：
- segments 必须把原文【从头到尾完整覆盖】，按句切分，text 用原文原话，不得遗漏、不得改写
- role 含义：hook=开场钩子 / background=铺垫背景 / point=核心观点 / turn=转折反转 / example=举例论证 / cta=结尾引导互动 / normal=过渡句
- 至少明确标出 hook、turn、cta 分别落在哪一句；note 只在关键句写，普通句留空
- rules 是本次输出的核心：必须【覆盖下面全部 8 个维度】，每个维度给 1-3 条，合起来要能让人反推出整条视频该怎么从头写到尾。dim 字段就填下面这些标签：
  1.「人设｜身份」创作者用什么身份、口吻、和观众的关系
  2.「选题｜主题」选什么样的题、主题在什么位置界定、凭什么留住观众
  3.「时长｜节奏」总时长区间、语速、信息密度、停顿与重音的用法
  4.「结构｜骨架」最关键——开头/前段/中段/后段各自该干什么、按什么顺序推进
  5.「开头钩子」开场前几句具体怎么设计，抓住注意力
  6.「中段展开」用什么方式论证：举例、成本对比、制造对立冲突等
  7.「转折反转」在哪里反转、怎么反转、制造什么认知落差
  8.「结尾收束」怎么收尾、留什么悬念或引导动作
- 每条 text 要写成"换个选题也能照着执行"的通用指令，不要只描述这一条视频的具体内容`;

  const aiResult = await callAI(prompt, { maxTokens: 3500, temperature: 0.5 });
  let parsed = extractJson(aiResult);

  // 降级：解析失败时，按句切分原文当作 segments，AI 文本塞进 rules
  if (!parsed || !Array.isArray(parsed.segments) || !parsed.segments.length) {
    parsed = {
      summary: (item.desc || '').slice(0, 30) || '口播文案',
      rhythm: '—',
      segments: splitSentences(script).map(s => ({ text: s, role: 'normal', note: '' })),
      rules: (parsed?.rules) || [{ text: aiResult.replace(/\s+/g, ' ').slice(0, 120), freq: '全程' }],
    };
  }

  const segments = (parsed.segments || [])
    .filter(s => s && s.text)
    .map(s => ({ text: String(s.text), role: s.role || 'normal', note: s.note || '' }));
  const rules = (parsed.rules || [])
    .filter(r => r && r.text)
    .slice(0, 24)
    .map(r => ({ text: String(r.text), freq: r.freq || '', dim: r.dim ? String(r.dim) : '其他' }));

  return {
    awemeId: item.awemeId,
    desc: item.desc || '',
    likes: item.likes || 0,
    estSec,
    summary: parsed.summary || '',
    persona: parsed.persona || '',
    topic: parsed.topic || '',
    rhythm: parsed.rhythm || '',
    structure: parsed.structure || '',
    segments,
    rules,
  };
}

// POST /api/original/learning/analyze —【阶段二】对用户选中的原文做逐句深拆
router.post('/learning/analyze', requireAuth, async (req, res) => {
  const { type = 'video', items = [], scope = 'global' } = req.body;
  const picked = (Array.isArray(items) ? items : []).filter(it => it && (it.script || it.awemeId)).slice(0, 4);
  if (!picked.length) return res.status(400).json({ code: 400, msg: '请先选择要学习的视频' });

  try {
    const tikhubKey = await getTikhubKey();
    if (!tikhubKey) return res.status(503).json({ code: 503, msg: '抖音解析未配置，请联系管理员配置 TikHub Key' });

    // 逐条深拆（串行，避免并发触发 AI 限流）
    const videos = [];
    for (const it of picked) {
      const one = await analyzeOneVideo(it, tikhubKey);
      if (one) videos.push(one);
    }
    if (!videos.length) return res.status(422).json({ code: 422, msg: '所选视频未提取到可分析的文案' });

    // 汇总所有视频的规律，去重后供用户勾选写入 Skill
    const seen = new Set();
    const rules = [];
    for (const v of videos) {
      for (const r of v.rules) {
        const key = r.text.replace(/\s+/g, '');
        if (key && !seen.has(key)) {
          seen.add(key);
          rules.push({ text: r.text, freq: r.freq, dim: r.dim || '其他', checked: true });
        }
      }
    }

    res.json({ code: 200, data: { type, videos, rules } });
  } catch (err) {
    console.error('/original/learning/analyze error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// POST /api/original/learning/write — 把选中的规律【融合】进 Skill 工作流（非简单追加）
router.post('/learning/write', requireAuth, async (req, res) => {
  const { insights, scope = 'global', projectId } = req.body;
  if (!insights || !insights.length) return res.status(400).json({ code: 400, msg: '没有选中规律' });

  // 仅用于本项目：不改全局 Skill，对话时作为上下文参考
  if (scope !== 'global') {
    return res.json({ code: 200, msg: '规律已记录，本项目对话时会参考' });
  }

  try {
    const skill = await getOrCreateSkill(req.userId);
    const currentRules = skill.rules || {};
    const curText = formatRulesForPrompt(skill);
    const insightText = insights.map(i => `- ${i.text}`).join('\n');

    // 让 AI 把新规律融合进既有工作流：补缺口、改写、归位，而不是堆在末尾
    const prompt = `你是创作 Skill 工作流的架构师。下面是用户现有的创作 Skill（按创作流程节点分组）以及本次新学到的规律。
请把新规律【融合】进现有工作流：先判断现有流程缺哪些环节、哪些节点需要补充或改写，再把每条新规律安放到最合适的流程节点中；可以新增节点、改写或合并已有条目，让整体更完整、不重复、像一套从头到尾可执行的工作流。不要简单把新规律堆在最后。

【现有 Skill】
${curText || '（暂时为空，请基于新规律搭建工作流骨架）'}

【本次新学规律】
${insightText}

请只返回融合后的【完整】rules JSON（覆盖全部内容，按创作流程节点分组），示例结构：
{
  "选题方向": ["一句话可执行指令", "..."],
  "开场钩子": ["..."],
  "内容展开": ["..."],
  "节奏与转折": ["..."],
  "结尾引导": ["..."],
  "语言风格": ["..."]
}
要求：
- 分组名用创作流程节点（可按需增减分组）
- 保留现有有价值的条目，与新规律去重合并、措辞更精炼
- 每条是一句可直接执行的创作指令，不要解释
- 只输出 JSON`;

    let mergedRules = null;
    try {
      const aiResult = await callAI(prompt, { maxTokens: 2000, temperature: 0.4 });
      const parsed = extractJson(aiResult);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // AI 返回 {分组: [字符串]}，转成 {分组:[{text,...}]}，并尽量保留旧条目的 uses
        const oldFlat = {};
        for (const arr of Object.values(currentRules)) {
          if (Array.isArray(arr)) arr.forEach(r => { if (r && r.text) oldFlat[r.text.replace(/\s+/g, '')] = r; });
        }
        mergedRules = {};
        for (const [group, arr] of Object.entries(parsed)) {
          if (!Array.isArray(arr)) continue;
          const list = [];
          for (const entry of arr) {
            const text = typeof entry === 'string' ? entry : (entry && entry.text) || '';
            if (!text.trim()) continue;
            const prev = oldFlat[text.replace(/\s+/g, '')];
            list.push(prev
              ? { text: text.trim(), source: prev.source || '融合', sourceType: prev.sourceType || 'merge', uses: prev.uses || 0 }
              : { text: text.trim(), source: '学习融合', sourceType: 'merge', uses: 0 });
          }
          if (list.length) mergedRules[group] = list;
        }
        if (!Object.keys(mergedRules).length) mergedRules = null;
      }
    } catch (e) {
      console.warn('[Original] Skill 融合 AI 失败，降级为追加:', e.message);
    }

    // 降级：AI 融合失败时，退回到「学习中心」分组追加（保证数据不丢）
    if (!mergedRules) {
      mergedRules = { ...currentRules };
      if (!mergedRules['学习中心']) mergedRules['学习中心'] = [];
      for (const ins of insights) {
        if (!mergedRules['学习中心'].some(r => r.text === ins.text)) {
          mergedRules['学习中心'].push({ text: ins.text, source: '学习中心', sourceType: 'feed', uses: 0 });
        }
      }
    }

    const curVer = skill.version || 'v1.0';
    const parts = curVer.replace('v', '').split('.').map(Number);
    parts[1] = (parts[1] || 0) + 1;
    const newVer = `v${parts[0]}.${parts[1]}`;
    await db.query(
      'UPDATE cw_skills SET rules = ?, version = ? WHERE user_id = ?',
      [JSON.stringify(mergedRules), newVer, req.userId]
    );
    const updated = await getOrCreateSkill(req.userId);
    res.json({ code: 200, data: { skill: updated } });
  } catch (err) {
    console.error('/original/learning/write error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

/* ═══════════════════════════════════════
   智能选题
═══════════════════════════════════════ */

// POST /api/original/suggest-topics
// 根据 Skill 规则 + 最近项目标题，AI 生成 4 个选题建议
router.post('/suggest-topics', requireAuth, async (req, res) => {
  try {
    const skill = await getOrCreateSkill(req.userId);
    const rulesText = formatRulesForPrompt(skill);

    // 最近 6 个项目标题作为参考（避免重复）
    const { rows: projRows } = await db.query(
      'SELECT title FROM cw_original_projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 6',
      [req.userId]
    );
    const recentTitles = (projRows || []).map(p => p.title).join('、') || '（暂无）';

    const prompt = `你是一位经验丰富的短视频选题策划师。根据用户的创作风格（Skill规则）和最近的创作记录，为他生成 4 个差异化的选题建议。

## 用户 Skill 规则
${rulesText}

## 最近创作过的主题（避免重复）
${recentTitles}

## 要求
1. 每个选题必须差异化（不同角度/不同受众/不同结构）
2. 选题要符合用户的 Skill 风格
3. 贴近当前 AI/内容创业/效率工具等热点，有传播潜力
4. 每个选题包含：标题、核心观点（一句话）、推荐风格、推荐时长

## 严格按 JSON 格式输出，不要输出任何其他文字：
[
  {
    "title": "选题标题",
    "angle": "核心观点，一句话",
    "style": "informative|story|contrast|twist 其中一个",
    "duration": "30s|1min|3min 其中一个",
    "reason": "推荐理由，≤20字"
  }
]`;

    const raw = await callAI(prompt, { maxTokens: 800, temperature: 0.9 });

    // 解析 JSON
    let topics = [];
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try { topics = JSON.parse(jsonMatch[0]); } catch {}
    }
    // 兜底：至少给 4 条
    if (!Array.isArray(topics) || topics.length === 0) {
      topics = [
        { title: '我用 AI 把40%的重复工作自动化了', angle: '普通人也能用 AI 接管重复劳动', style: 'informative', duration: '1min', reason: '痛点精准，共鸣强' },
        { title: '3天一个AI工具：我验证了什么', angle: '用真实数据说明小工具的变现路径', style: 'story', duration: '1min', reason: '有进度感，适合系列' },
        { title: '同一个选题，有人10万播有人1万播', angle: '标题和前3秒决定80%流量', style: 'contrast', duration: '30s', reason: '对比结构，好奇心强' },
        { title: '我以为AI能帮我做内容，结果……', angle: '用反转讲述AI工具的真实局限', style: 'twist', duration: '1min', reason: '反预期，完播率高' },
      ];
    }

    res.json({ code: 200, data: topics.slice(0, 4) });
  } catch (err) {
    console.error('/original/suggest-topics error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

module.exports = router;
