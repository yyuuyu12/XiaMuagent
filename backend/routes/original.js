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

// 读取单个 system_config 配置值
async function getConfigVal(key) {
  const { rows } = await db.query('SELECT value FROM system_config WHERE config_key = ?', [key]);
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
  if (p.artifacts && typeof p.artifacts === 'string') {
    try { p.artifacts = JSON.parse(p.artifacts); } catch { p.artifacts = {}; }
  }
  p.artifacts = p.artifacts || {};
  if (!p.stage || !STAGES.includes(p.stage)) p.stage = 'script';
  return p;
}

// 遍历"可见"结构化规则（跳过 待确认 分组与所有 pending 条目），按稳定顺序返回。
// 返回 [{ group, idx, text }]，下标 i 对应规则编号 [R(i+1)]。
// 关键：formatRulesForPrompt 编号与 incrementRuleUses 写回必须共用此函数，确保编号-条目一一对应。
function iterateVisibleRules(skill) {
  const out = [];
  const rules = (skill && skill.rules) || {};
  for (const [group, arr] of Object.entries(rules)) {
    if (group === '待确认') continue;           // pending 分组整体跳过
    if (!Array.isArray(arr)) continue;
    arr.forEach((r, idx) => {
      if (r && typeof r === 'object' && r.pending) return; // 单条 pending 跳过
      const text = typeof r === 'string' ? r : (r && r.text) || '';
      if (!text) return;
      out.push({ group, idx, text });
    });
  }
  return out;
}

// 把 rules 对象格式化成文本供 AI 读取
// 若用户写了 freeText（自由编辑模式），优先使用它；结构化规则作为补充追加
// 结构化规则带稳定编号 [R1][R2]…（按 iterateVisibleRules 顺序），用于 USED 使用回执
function formatRulesForPrompt(skill) {
  if (!skill) return '（暂无规则）';

  // 自由文本优先
  const freeText = (skill.freeText || '').trim();

  // 结构化规则（带编号）
  const structLines = [];
  const visible = iterateVisibleRules(skill);
  let curGroup = null;
  visible.forEach((v, i) => {
    if (v.group !== curGroup) { structLines.push(`【${v.group}】`); curGroup = v.group; }
    structLines.push(`- [R${i + 1}] ${v.text}`);
  });
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

// 按编号给规则 uses +1 写回。ruleNumbers 为 USED 行解析出的编号数组（1-based）。
// 字符串型规则会就地升级为 { text, uses } 对象。解析/写回失败静默。
async function incrementRuleUses(userId, skill, ruleNumbers) {
  if (!ruleNumbers || !ruleNumbers.length) return;
  try {
    const visible = iterateVisibleRules(skill);
    const rules = skill.rules || {};
    let changed = false;
    for (const n of ruleNumbers) {
      const v = visible[n - 1];
      if (!v) continue;
      const arr = rules[v.group];
      if (!Array.isArray(arr) || arr[v.idx] === undefined) continue;
      let entry = arr[v.idx];
      if (typeof entry === 'string') { entry = { text: entry, uses: 0 }; arr[v.idx] = entry; }
      entry.uses = (entry.uses || 0) + 1;
      changed = true;
    }
    if (changed) await db.query('UPDATE cw_skills SET rules = ? WHERE user_id = ?', [JSON.stringify(rules), userId]);
  } catch (e) {
    console.warn('[incrementRuleUses] 失败:', e.message);
  }
}

// 从 AI 原始输出解析 USED 行的规则编号（去重）
function parseUsedRuleNumbers(raw) {
  const m = (raw || '').match(/USED\s*[:：]\s*([^\n]*)/i);
  if (!m) return [];
  const nums = [];
  const re = /R(\d+)/gi; let mm;
  while ((mm = re.exec(m[1])) !== null) nums.push(parseInt(mm[1], 10));
  return [...new Set(nums)];
}

// 从任意文本剥离 USED 行（用户不应看到使用回执）
function stripUsedLine(text) {
  return (text || '').replace(/^[ \t]*USED\s*[:：].*$/gim, '').replace(/\n{3,}/g, '\n\n').trim();
}

// 统一的"自动学到的规则"入口：写入 cw_skills.rules 的 '待确认' 分组，等用户在前端逐条采纳/忽略。
// 关键：pending 规则不会进入生成 prompt（formatRulesForPrompt 已跳过）。
// 去重：与全部分组现有条目按"去空格文本"比对；'待确认' 分组上限 10 条，满则移除最旧。
async function addPendingRule(userId, text, sourceType, source) {
  const clean = (text || '').trim();
  if (!clean) return false;
  try {
    const skill = await getOrCreateSkill(userId);
    const rules = skill.rules || {};
    // 全分组去重
    const key = clean.replace(/\s+/g, '');
    for (const arr of Object.values(rules)) {
      if (Array.isArray(arr) && arr.some(r => {
        const t = typeof r === 'string' ? r : (r && r.text) || '';
        return t.replace(/\s+/g, '') === key;
      })) return false; // 已存在，跳过
    }
    if (!Array.isArray(rules['待确认'])) rules['待确认'] = [];
    rules['待确认'].push({ text: clean, source: source || '', sourceType: sourceType || 'auto', uses: 0, pending: true, at: Date.now() });
    // 上限 10，移除最旧
    if (rules['待确认'].length > 10) rules['待确认'] = rules['待确认'].slice(-10);
    await db.query('UPDATE cw_skills SET rules = ? WHERE user_id = ?', [JSON.stringify(rules), userId]);
    return true;
  } catch (e) {
    console.warn('[addPendingRule] 失败:', e.message);
    return false;
  }
}

// 定稿触发：对比 AI 最后一版（artifacts._aiBaseline）与用户终版（project.doc），提炼写作偏好规则进待确认池。
// 异步调用、不阻塞响应；失败仅 warn。
async function extractEditDiffRules(project, userId) {
  try {
    const artifacts = parseArtifacts(project);
    const baseline = artifacts._aiBaseline;
    const userFinal = (project.doc || '').trim();
    if (!baseline || baseline.stage !== 'script') return;
    const aiDoc = (baseline.doc || '').trim();
    if (!aiDoc || !userFinal) return;
    if (aiDoc.replace(/\s+/g, '') === userFinal.replace(/\s+/g, '')) return;
    // 差异门槛：字符级差异量 / 终版长度 < 8% 不学习（只改错别字不值得）
    const diffAmount = Math.abs(aiDoc.length - userFinal.length)
      + levenshteinLite(aiDoc.slice(0, 800), userFinal.slice(0, 800));
    if (userFinal.length > 0 && (diffAmount / userFinal.length) < 0.08) return;

    const prompt = `你是写作风格分析师。下面是 AI 生成的口播剧本初稿和用户亲手修改后的定稿。
【AI 初稿】${aiDoc.slice(0, 800)}
【用户定稿】${userFinal.slice(0, 800)}
任务：对比两版差异，提炼用户的写作偏好，输出 1-3 条可复用的写作规则。
要求：
- 每条说清楚「什么情况下，怎么写」，要具体到写法，不要空洞结论
- 每条 20-50 字，一行一条，以 - 开头
- 差异若只是错别字或事实修正，输出 SKIP
只输出规则行或 SKIP。`;
    const raw = (await callAI(prompt, { temperature: 0.3, maxTokens: 300 })).trim();
    if (!raw || /^SKIP/i.test(raw)) return;
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('-'));
    for (const line of lines) {
      const ruleText = line.replace(/^-\s*/, '').trim();
      if (ruleText && !/^SKIP/i.test(ruleText)) {
        await addPendingRule(userId, ruleText, 'diff', `项目#${project.id}定稿对比`);
      }
    }
  } catch (e) {
    console.warn('[extractEditDiffRules] 失败:', e.message);
  }
}

// 轻量编辑距离（仅用于差异量估算，限长避免性能问题）
function levenshteinLite(a, b) {
  a = a || ''; b = b || '';
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/* ═══════════════════════════════════════
   分阶段创作（拆方向→粗纲→细纲→剧本）
═══════════════════════════════════════ */

const STAGES = ['direction', 'outline', 'detail', 'script'];
const STAGE_META = {
  direction: { name: '选题方向', short: '方向', tag: '选题方向', next: 'outline', prev: null },
  outline:   { name: '内容粗纲', short: '粗纲', tag: '粗纲',     next: 'detail',  prev: 'direction' },
  detail:    { name: '细化大纲', short: '细纲', tag: '细纲',     next: 'script',  prev: 'outline' },
  script:    { name: '口播剧本', short: '剧本', tag: '新剧本',   next: null,      prev: 'detail' },
};

// 解析项目 artifacts JSON（各阶段已确认产出快照）
function parseArtifacts(project) {
  let a = project.artifacts;
  if (a && typeof a === 'string') { try { a = JSON.parse(a); } catch { a = {}; } }
  return a || {};
}

// 读取项目绑定的对标素材（cw_project_materials → cw_materials）
async function getBoundMaterials(projectId) {
  const { rows } = await db.query(
    `SELECT m.id, m.title, m.raw_content
       FROM cw_project_materials pm
       JOIN cw_materials m ON m.id = pm.material_id
      WHERE pm.project_id = ?
      ORDER BY pm.id ASC`,
    [projectId]
  );
  return rows || [];
}

// 提取某阶段产出标签内容（兼容旧 script 标签【新文案】）
function extractStageDoc(raw, stage) {
  const tag = STAGE_META[stage]?.tag || '新剧本';
  let m = raw.match(new RegExp(`【${tag}】([\\s\\S]*?)【\\/${tag}】`));
  if (!m && stage === 'script') m = raw.match(/【新文案】([\s\S]*?)【\/新文案】/);
  return m ? m[1].trim() : null;
}

// 构建某阶段的 system prompt（含决策树分支 + 对标素材 + 前序产出）
function buildStagePrompt({ project, skill, stage, artifacts, boundMaterials, history, currentDraft }) {
  const meta = project.meta || {};
  const durationMap = { '30s': '30秒（约75字）', '1min': '1分钟（约150字）', '3min': '3分钟（约450字）' };
  const styleMap = { informative: '干货讲解', story: '故事叙事', contrast: '对比反差', twist: '悬念反转' };
  const platformMap = { douyin: '抖音', shipinhao: '视频号', xiaohongshu: '小红书' };
  const durationLabel = durationMap[meta.duration] || '1分钟';
  const styleLabel = styleMap[meta.style] || '干货讲解';
  const platformLabel = platformMap[meta.platform] || '抖音';
  const rulesText = formatRulesForPrompt(skill);

  // 对标素材区块（项目级对标：只参考绑定的素材，参考写法而非照抄）
  let benchmarkBlock = '';
  if (boundMaterials && boundMaterials.length) {
    const list = boundMaterials.slice(0, 4).map((m, i) =>
      `【对标${i + 1}·${m.title || '素材'}】\n${(m.raw_content || '').slice(0, 600)}`
    ).join('\n\n');
    benchmarkBlock = `\n## 对标素材（学习其结构/钩子/节奏，绝不照抄原句）\n${list}\n`;
  }

  // 前序阶段已确认产出
  const priorBlocks = [];
  if (artifacts.direction) priorBlocks.push(`【已确认·选题方向】\n${artifacts.direction}`);
  if (stage !== 'outline' && artifacts.outline) priorBlocks.push(`【已确认·内容粗纲】\n${artifacts.outline}`);
  if (stage === 'script' && artifacts.detail) priorBlocks.push(`【已确认·细化大纲】\n${artifacts.detail}`);
  const priorBlock = priorBlocks.length ? `\n## 前序已确认内容（必须严格延续，不要推翻）\n${priorBlocks.join('\n\n')}\n` : '';

  const projInfo = `## 当前项目
标题：${project.title}${project.brief ? `\n说明：${project.brief}` : ''}
时长：${durationLabel} · 风格：${styleLabel} · 平台：${platformLabel}${meta.angle ? `\n用户初始观点：${meta.angle}` : ''}`;

  const skillBlock = `## 用户 Skill 规则（始终遵守）\n${rulesText}`;
  // 本项目专属规律（仅本项目生效，与全局 Skill 冲突时以本区块为准）
  const projectRules = Array.isArray(meta.projectRules) ? meta.projectRules.filter(t => t && String(t).trim()) : [];
  const projectRulesBlock = projectRules.length
    ? `\n## 本项目专属规律（仅本项目生效，与全局 Skill 冲突时以本区块为准）\n${projectRules.map(t => `- ${t}`).join('\n')}\n`
    : '';
  const histBlock = history ? `\n## 最近对话\n${history}\n` : '';
  const draftBlock = currentDraft && currentDraft.trim()
    ? `\n## 本阶段当前草稿（在此基础上改）\n---\n${currentDraft}\n---\n`
    : '';

  const tag = STAGE_META[stage].tag;
  const common = `${skillBlock}\n${projectRulesBlock}\n${projInfo}\n${benchmarkBlock}${priorBlock}${draftBlock}${histBlock}`;

  // ── 决策树：是否已有明确方向 ──
  const hasDirection = !!(meta.angle || project.brief || artifacts.direction);

  if (stage === 'direction') {
    return `你是短视频选题策划。本阶段只定【选题方向】，不要写正文文案。
${common}
## 本阶段任务
${hasDirection
  ? '用户已给了大致方向，你的工作是把它打磨成 1 条清晰可执行的选题方向，并简短说明为什么这样切更容易出爆款。'
  : '用户方向还不明确。先给出 2-3 个差异化的候选选题方向（每条一句话点明角度+人群+钩子），引导用户选一个；如果用户已经选了，就细化成 1 条。'}

## 输出格式
先用一两句话说你的思路（≤40字），然后：
【选题方向】
角度：xxx
目标人群：xxx
核心钩子：xxx
一句话选题：xxx
【/选题方向】
（候选阶段可在标签外先列 2-3 个选项让用户挑，确定后再用标签输出最终方向）`;
  }

  if (stage === 'outline') {
    return `你是短视频内容架构师。本阶段只搭【粗纲】结构，不写完整台词。
${common}
## 本阶段任务
基于已确认的选题方向，搭出口播的三段式骨架：强钩子开场 → 内容主体（2-4 个递进要点）→ 结尾引导。只写要点，不写完整句子。

## 输出格式
先一句话说结构思路（≤30字），然后：
【粗纲】
开场钩子：xxx
主体要点1：xxx
主体要点2：xxx
（按需 3-4 个）
结尾引导：xxx
【/粗纲】`;
  }

  if (stage === 'detail') {
    return `你是短视频脚本细化师。本阶段把粗纲展开成【细纲】，仍不是最终台词。
${common}
## 本阶段任务
把已确认的粗纲每一节展开：这一节具体讲什么、给一个关键句示例、配什么画面方向。让写剧本时照着填就行。

## 输出格式
先一句话说细化重点（≤30字），然后：
【细纲】
〔开场〕讲什么：xxx ｜ 关键句：「xxx」 ｜ 画面：xxx
〔要点1〕讲什么：xxx ｜ 关键句：「xxx」 ｜ 画面：xxx
（逐节展开）
〔结尾〕讲什么：xxx ｜ 关键句：「xxx」
【/细纲】`;
  }

  // script
  return `你是一位经验丰富的短视频口播文案写手，把已确认的细纲写成可直接念的口播【新剧本】。
${common}
## 本阶段任务
严格按已确认的细纲，写出连贯口语化口播台词。${hasDirection ? '' : '若细纲缺失，可凭方向直接成稿。'}

## 输出格式
用一句话说你写/改了什么（≤30字），然后：
【新剧本】
（连续口播台词，说话的语气）

在画面自然切换处用一行括号标注：〔画面：xxx〕
【/新剧本】

## 质量要求
- 台词是主体，口语化，不是读稿；画面标注不超过段落的 1/3
- 强钩子开场 → 内容主体 → 结尾引导
- 严格控制时长：${durationLabel}
- 不用"首先其次最后"等书面框架词

## 规则使用回执
输出的最后另起一行写 USED:R编号列表（本次实际遵循的规则，如 USED:R1,R3；没有则写 USED:无）。此行不属于剧本内容，用户不会看到。`;
}

// 目标时长标签（critic 与 prompt 共用）
function getDurationLabel(meta) {
  const durationMap = { '30s': '30秒（约75字）', '1min': '1分钟（约150字）', '3min': '3分钟（约450字）' };
  return durationMap[(meta || {}).duration] || '1分钟';
}

// 统一的阶段生成：构建 prompt → 调 AI → 解析产出。返回 { aiSummary, newDoc, hasDocUpdate, syncLabel }
async function generateStageReply({ userId, project, skill, stage, boundMaterials, history, userMessage, currentDraftOverride }) {
  const artifacts = parseArtifacts(project);
  const currentDraft = currentDraftOverride !== undefined ? currentDraftOverride : (project.doc || '');
  const systemPrompt = buildStagePrompt({ project, skill, stage, artifacts, boundMaterials, history, currentDraft });
  // 写稿环节用一线模型（管理后台 ai_model_creation 配置；留空走默认）；bypassCap 避免长稿被中转站默认上限砍断
  const creationModel = (await getConfigVal('ai_model_creation')).trim();
  const callOpts = { maxTokens: 4000, temperature: 0.65, bypassCap: true };
  if (creationModel) callOpts.model = creationModel;
  const aiRaw = await callAI(systemPrompt + '\n\n用户：' + userMessage, callOpts);

  const tag = STAGE_META[stage].tag;
  const parsed = extractStageDoc(aiRaw, stage);
  let newDoc = currentDraft;
  let aiSummary = aiRaw.trim();
  let hasDocUpdate = 0;
  if (parsed !== null) {
    newDoc = parsed;
    hasDocUpdate = 1;
    const before = aiRaw.split(`【${tag}】`)[0].trim();
    aiSummary = before || `已更新${STAGE_META[stage].name}。`;
  } else {
    // 截断检测：有开标签但缺闭标签 → 视为被砍断，取残稿（残稿也比不更新强）
    const openTag = `【${tag}】`;
    const openIdx = aiRaw.indexOf(openTag);
    if (openIdx !== -1 && !aiRaw.includes(`【/${tag}】`)) {
      const partial = aiRaw.slice(openIdx + openTag.length).trim();
      if (partial) {
        newDoc = partial;
        hasDocUpdate = 1;
        const before = aiRaw.slice(0, openIdx).trim();
        aiSummary = (before || `已更新${STAGE_META[stage].name}。`)
          + '（本次输出可能不完整，建议点重新生成，或在设置里缩短目标时长）';
        console.warn('[Truncated]', stage, project.id);
      }
    }
  }

  // ── 规则使用回执（仅 script 阶段）：解析 USED 行 → 给规则 uses+1 → 从用户可见文本剥离 ──
  if (stage === 'script' && hasDocUpdate) {
    try {
      const usedNums = parseUsedRuleNumbers(aiRaw);
      // 不论是否解析到编号，都把 USED 行从摘要与文档中剥离，避免用户看到
      aiSummary = stripUsedLine(aiSummary);
      newDoc = stripUsedLine(newDoc);
      if (usedNums.length && userId) await incrementRuleUses(userId, skill, usedNums);
    } catch (e) {
      console.warn('[USED] 解析失败:', e.message);
    }
  }

  // ── critic 质检（仅 script 阶段，critic_enabled='1'）：不合格自动重写一轮（最多一次）──
  if (stage === 'script' && hasDocUpdate) {
    try {
      const criticOn = (await getConfigVal('critic_enabled')).trim();
      if (criticOn === '1') {
        const durationLabel = getDurationLabel(project.meta);
        const forbiddenList = (skill && skill.forbidden && skill.forbidden.length) ? skill.forbidden.join('、') : '无';
        const checkExtra = (skill && skill.checkPrompt && skill.checkPrompt.trim())
          ? `\n【用户自定义验收标准】${skill.checkPrompt.trim()}` : '';
        const criticPrompt = `你是短视频口播剧本的质检员。按以下标准审查剧本，只输出 JSON。
【剧本】${newDoc}
【硬性标准】
1. 字数符合目标：${durationLabel}（允许 ±20%）
2. 不出现以下禁区内容：${forbiddenList}
3. 开场前两句必须有钩子（数字/反差/悬念/动作之一），不得自我介绍
4. 口语化：不出现"首先/其次/综上所述"等书面框架词${checkExtra}
输出：{"pass": true/false, "issues": ["不通过的具体问题，每条≤30字"]}`;
        const criticRaw = await callAI(criticPrompt, { temperature: 0.2, maxTokens: 500, bypassCap: true });
        let verdict = null;
        const jm = criticRaw.match(/\{[\s\S]*\}/);
        if (jm) { try { verdict = JSON.parse(jm[0]); } catch { verdict = null; } }
        if (verdict && verdict.pass === false && Array.isArray(verdict.issues) && verdict.issues.length) {
          const issues = verdict.issues.slice(0, 8);
          const rewritePrompt = systemPrompt
            + `\n\n## 质检反馈（必须全部修正）\n上一版存在以下问题，必须全部修正后重新输出完整剧本：\n${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
            + '\n\n用户：' + userMessage;
          const reRaw = await callAI(rewritePrompt, callOpts);
          const reParsed = extractStageDoc(reRaw, stage);
          if (reParsed !== null) {
            newDoc = stripUsedLine(reParsed);
            const before = reRaw.split(`【${tag}】`)[0].trim();
            aiSummary = (before || `已更新${STAGE_META[stage].name}。`);
          }
          aiSummary += `（已按 ${issues.length} 条质检意见自动修正）`;
        }
      }
    } catch (e) {
      console.warn('[Critic] 质检跳过:', e.message);
    }
  }

  // sync_label 仅在剧本阶段提炼（与原逻辑一致）
  let syncLabel = null;
  if (hasDocUpdate && stage === 'script') {
    const labelMatch = aiSummary.match(/[「」""](.{4,20})[「」""]/);
    if (labelMatch) syncLabel = labelMatch[1];
    else {
      const kw = aiSummary.match(/[\u4e00-\u9fa5]{3,8}(钩子|写法|结构|开场|结尾|节奏|风格)/);
      if (kw) syncLabel = kw[0];
    }
  }
  return { aiSummary, newDoc, hasDocUpdate, syncLabel };
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
   待确认规则（学习提议制）接口
═══════════════════════════════════════ */

// Skill 版本号 minor +1（复用 PUT/PATCH 现成自增写法）
function bumpSkillVersion(curVer) {
  const parts = (curVer || 'v1.0').replace('v', '').split('.').map(Number);
  parts[1] = (parts[1] || 0) + 1;
  return `v${parts[0]}.${parts[1]}`;
}

// GET /api/original/skill/pending — 待确认列表（带索引）
router.get('/skill/pending', requireAuth, async (req, res) => {
  try {
    const skill = await getOrCreateSkill(req.userId);
    const pendingArr = (skill.rules?.['待确认'] || []).filter(r => r && typeof r === 'object' && r.pending);
    // 带原始索引返回，便于前端调 confirm/dismiss
    const list = (skill.rules?.['待确认'] || []).map((r, idx) => ({ idx, ...r }))
      .filter(r => r.pending);
    res.json({ code: 200, data: list, count: pendingArr.length });
  } catch (err) {
    console.error('/original/skill/pending GET error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// POST /api/original/skill/pending/:idx/confirm — 采纳：pending=false 并移入「自动学习」分组
router.post('/skill/pending/:idx/confirm', requireAuth, async (req, res) => {
  try {
    const idx = parseInt(req.params.idx, 10);
    const skill = await getOrCreateSkill(req.userId);
    const rules = skill.rules || {};
    const pendingGroup = rules['待确认'] || [];
    if (!Array.isArray(pendingGroup) || idx < 0 || idx >= pendingGroup.length || !pendingGroup[idx]) {
      return res.status(404).json({ code: 404, msg: '待确认规则不存在' });
    }
    const item = pendingGroup[idx];
    // 从待确认移除
    pendingGroup.splice(idx, 1);
    rules['待确认'] = pendingGroup;
    // 移入「自动学习」分组，去 pending 标记
    if (!Array.isArray(rules['自动学习'])) rules['自动学习'] = [];
    rules['自动学习'].push({
      text: item.text,
      source: item.source || '',
      sourceType: item.sourceType || 'auto',
      uses: item.uses || 0,
      at: item.at || Date.now(),
    });
    const newVer = bumpSkillVersion(skill.version);
    await db.query('UPDATE cw_skills SET rules = ?, version = ? WHERE user_id = ?',
      [JSON.stringify(rules), newVer, req.userId]);
    const updated = await getOrCreateSkill(req.userId);
    res.json({ code: 200, msg: '已采纳', data: updated });
  } catch (err) {
    console.error('/original/skill/pending confirm error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// POST /api/original/skill/pending/:idx/dismiss — 忽略：删除该条
router.post('/skill/pending/:idx/dismiss', requireAuth, async (req, res) => {
  try {
    const idx = parseInt(req.params.idx, 10);
    const skill = await getOrCreateSkill(req.userId);
    const rules = skill.rules || {};
    const pendingGroup = rules['待确认'] || [];
    if (!Array.isArray(pendingGroup) || idx < 0 || idx >= pendingGroup.length || !pendingGroup[idx]) {
      return res.status(404).json({ code: 404, msg: '待确认规则不存在' });
    }
    pendingGroup.splice(idx, 1);
    rules['待确认'] = pendingGroup;
    await db.query('UPDATE cw_skills SET rules = ? WHERE user_id = ?',
      [JSON.stringify(rules), req.userId]);
    res.json({ code: 200, msg: '已忽略' });
  } catch (err) {
    console.error('/original/skill/pending dismiss error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// POST /api/original/skill/compact — 整理自动学习记录：合并去重 free_text 的「## 自动学习」区块
router.post('/skill/compact', requireAuth, async (req, res) => {
  try {
    await getOrCreateSkill(req.userId);
    const { rows } = await db.query('SELECT free_text, free_text_history, version FROM cw_skills WHERE user_id = ?', [req.userId]);
    const oldText = rows?.[0]?.free_text || '';
    if (!oldText.trim()) {
      return res.json({ code: 200, msg: '暂无可整理内容', data: { before: 0, after: 0 } });
    }

    // 提取所有「## 自动学习」区块下的条目
    const lines = oldText.split('\n');
    const autoItems = [];
    let inAuto = false;
    const keptLines = []; // 非自动学习区块原样保留
    for (const line of lines) {
      const isHeader = /^#{1,6}\s*自动学习/.test(line.trim());
      if (isHeader) { inAuto = true; continue; }
      // 新的二级及以上标题结束自动学习区块
      if (inAuto && /^#{1,6}\s/.test(line.trim()) && !isHeader) { inAuto = false; }
      if (inAuto) {
        const t = line.trim().replace(/^[-*]\s*/, '').trim();
        if (t) autoItems.push(t);
      } else {
        keptLines.push(line);
      }
    }

    const before = autoItems.length;
    if (before === 0) {
      return res.json({ code: 200, msg: '没有「自动学习」条目需要整理', data: { before: 0, after: 0 } });
    }

    const prompt = `下面是一份口播文案写作 Skill 中「自动学习」区块累积的写作规则条目，可能存在重复、矛盾、过于琐碎的情况。
请合并去重、删除矛盾项、精炼措辞，输出一份干净的规则列表（每条一行，以"- "开头），保留所有关键写作偏好，不要丢失重要信息，也不要无中生有添加新规则。

【原始条目】
${autoItems.map(t => '- ' + t).join('\n')}

只输出整理后的条目列表，不要任何解释。`;

    let merged = [];
    try {
      const raw = await callAI(prompt, { temperature: 0.3, maxTokens: 800 });
      merged = (raw || '').split('\n')
        .map(l => l.trim().replace(/^[-*]\s*/, '').trim())
        .filter(l => l.length > 0 && !/^[#【]/.test(l));
    } catch (e) {
      console.warn('[compact] callAI 失败:', e.message);
      return res.status(500).json({ code: 500, msg: 'AI 整理失败：' + e.message });
    }
    if (!merged.length) merged = autoItems; // 兜底：模型没返回有效内容则保持原样

    const after = merged.length;

    // 重建 free_text：保留非自动学习内容 + 单个整理后的「## 自动学习」区块
    const head = keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const autoBlock = `## 自动学习\n${merged.map(t => '- ' + t).join('\n')}`;
    const newText = head ? `${head}\n\n${autoBlock}` : autoBlock;

    // 旧 free_text 推入 history（遵循现有历史结构，保证可还原）
    const rawHist = rows?.[0]?.free_text_history;
    let history = rawHist ? (typeof rawHist === 'string' ? JSON.parse(rawHist) : rawHist) : [];
    history.unshift({ text: oldText, savedAt: new Date().toISOString() });
    if (history.length > 10) history = history.slice(0, 10);

    const newVer = bumpSkillVersion(rows?.[0]?.version);
    await db.query(
      'UPDATE cw_skills SET free_text = ?, free_text_history = ?, version = ? WHERE user_id = ?',
      [newText, JSON.stringify(history), newVer, req.userId]
    );

    res.json({ code: 200, msg: `已合并 ${before} 条 → ${after} 条`, data: { before, after } });
  } catch (err) {
    console.error('/original/skill/compact error:', err.message);
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
      'SELECT id, title, brief, status, stage, turns, created_at, updated_at FROM cw_original_projects WHERE user_id = ? ORDER BY updated_at DESC',
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
  const { title, brief = '', duration, angle, style, platform, staged = true, materialIds = [] } = req.body;
  if (!title?.trim()) return res.status(400).json({ code: 400, msg: '请填写项目标题' });
  const meta = { duration: duration || '1min', angle: angle || '', style: style || 'informative', platform: platform || 'douyin' };
  const stage = staged ? 'direction' : 'script';
  try {
    const { rows } = await db.query(
      "INSERT INTO cw_original_projects (user_id, title, brief, status, doc, turns, meta, stage, artifacts) VALUES (?, ?, ?, 'draft', '', 0, ?, ?, '{}')",
      [req.userId, title.trim(), brief.trim(), JSON.stringify(meta), stage]
    );
    const id = rows?.[0]?.id;
    // 绑定对标素材（项目级对标）
    const ids = (Array.isArray(materialIds) ? materialIds : []).map(Number).filter(Boolean);
    if (id && ids.length) {
      const valid = ids.slice(0, 8);
      for (const mid of valid) {
        try {
          await db.query(
            'INSERT IGNORE INTO cw_project_materials (project_id, material_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM cw_materials WHERE id = ? AND user_id = ?)',
            [id, mid, mid, req.userId]
          );
        } catch (_) {}
      }
    }
    res.json({ code: 200, data: { id, title: title.trim(), brief: brief.trim(), status: 'draft', doc: '', turns: 0, meta, stage, artifacts: {} } });
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
    // 绑定的对标素材（精简字段）
    const { rows: bound } = await db.query(
      `SELECT m.id, m.title, LEFT(m.raw_content, 80) AS preview
         FROM cw_project_materials pm JOIN cw_materials m ON m.id = pm.material_id
        WHERE pm.project_id = ? ORDER BY pm.id ASC`,
      [projectId]
    );
    res.json({ code: 200, data: { project, messages: msgs || [], boundMaterials: bound || [] } });
  } catch (err) {
    console.error('/original/projects/:id GET error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// PATCH /api/original/projects/:id — 更新状态 / 更新消息 sync_done
router.patch('/projects/:id', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  const { status, msgId, syncDone, doc } = req.body;
  try {
    const project = await getProject(projectId, req.userId);
    if (!project) return res.status(404).json({ code: 404, msg: '项目不存在' });

    // 手动保存当前阶段活文档（PC 编辑器保存按钮）——先于定稿判断写入，确保 diff 用到最新终版
    if (typeof doc === 'string') {
      await db.query('UPDATE cw_original_projects SET doc = ? WHERE id = ?', [doc, projectId]);
    }
    if (status) {
      await db.query('UPDATE cw_original_projects SET status = ? WHERE id = ?', [status, projectId]);
      // 定稿触发 diff 学习（异步，不阻塞响应）
      if (status === 'final') {
        getProject(projectId, req.userId)
          .then(p => p && extractEditDiffRules(p, req.userId))
          .catch(e => console.warn('[extractEditDiffRules] PATCH final:', e.message));
      }
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
  const { message, activeStage } = req.body;
  // activeStage: undefined → 兼容旧版，使用 project.stage
  //              null       → 自由聊天模式，不更新任何文案
  //              string     → 明确指定操作的阶段 key
  if (!message?.trim()) return res.status(400).json({ code: 400, msg: '消息不能为空' });

  try {
    const project = await getProject(projectId, req.userId);
    if (!project) return res.status(404).json({ code: 404, msg: '项目不存在' });

    // 保存用户消息（先存，后面自动学习用得到对话历史）
    await db.query(
      'INSERT INTO cw_original_messages (project_id, role, content, stage) VALUES (?, ?, ?, ?)',
      [projectId, 'user', message.trim(), project.stage || 'script']
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

    // ── 自动学习：检测用户反馈，提炼规则写入 Skill ──────────────────
    let autoLearnRule = null;
    const feedbackPattern = /好多了|更好了|好了|对了|就这个|这版.*好|对味|不错了|棒|可以了|喜欢这|AI味|机器味|太.*了|还是.*味|生硬|套话|太模板|太套路|不够真实|感觉.*假|不对味|腔|太官方/;
    const hasFeedback = feedbackPattern.test(message) && message.trim().length < 60;

    if (hasFeedback) {
      try {
        // 找上一条有文案更新的 AI 消息（摘要）+ 该消息前用户的修改要求
        const { rows: lastAiRows } = await db.query(
          `SELECT m.id, m.content,
            (SELECT content FROM cw_original_messages WHERE project_id = ? AND role = 'user' AND id < m.id ORDER BY id DESC LIMIT 1) AS user_req
           FROM cw_original_messages m
           WHERE m.project_id = ? AND m.role = 'ai' AND m.has_doc_update = 1
           ORDER BY m.id DESC LIMIT 1`,
          [projectId, projectId]
        );
        const lastChange = lastAiRows?.[0]?.content || '';
        const lastUserReq = lastAiRows?.[0]?.user_req || '';

        // 同时拿上一条文案的前200字（存在 project.doc 里已是最新版，取倒数第二次doc更新前的内容不易拿，用lastChange摘要+当前doc片段）
        const docSnippet = (project.doc || '').slice(0, 200);

        if (lastChange) {
          const extractPrompt = `你是一个写作风格分析师。

【本次文案片段（前200字）】
${docSnippet}

【上一次修改方向】${lastUserReq.slice(0, 60)}
【AI修改摘要】${lastChange.slice(0, 80)}
【用户此刻反馈】${message}

任务：判断这条反馈是否说明某种写法"更好"或"有问题"，并提炼成一条可复用的写作规则。
要求：
- 规则要结合上面的内容背景，说清楚「什么情况下，怎么写比较好/不好」
- 不要说空洞结论（如"语言要口语化"），要说具体写法（如"写副业选题时开头别用'你是不是也...'，改成直接抛出真实数字"）
- 长度30-50字，以"-"开头
- 如果反馈只是新的修改指令，而非质量评价 → 只输出：SKIP

只输出一行规则或SKIP，不要其他文字。`;

          const extracted = (await callAI(extractPrompt, { maxTokens: 120, temperature: 0.3 })).trim();

          if (extracted && !extracted.startsWith('SKIP') && (extracted.startsWith('-') || extracted.length > 5)) {
            autoLearnRule = extracted.startsWith('-') ? extracted.slice(1).trim() : extracted;
            // 不再静默写入 free_text：进"待确认"池，等用户在首页逐条采纳/忽略
            await addPendingRule(req.userId, autoLearnRule, 'feedback', '对话反馈');
            console.log(`[AutoLearn] 已提炼规则进待确认池: ${autoLearnRule}`);
          }
        }
      } catch (e) {
        console.warn('[AutoLearn] 提取失败:', e.message);
      }
    }

    // 读取 Skill（在 autoLearn 更新 DB 之后再读，确保拿到最新规则）
    const skill = await getOrCreateSkill(req.userId);
    const rulesText = formatRulesForPrompt(skill);

    // 当前项目阶段 + 对标素材
    const projectStage = project.stage || 'script';
    const boundMaterials = await getBoundMaterials(projectId);

    // ── 确定操作模式 ──────────────────────────────────────────────
    // activeStage: undefined → 兼容旧版，用 projectStage
    //              null      → 自由聊天，纯回复不更新任何文案
    //              key       → 明确操作该阶段（可能与 projectStage 不同）
    const effectiveStage = (activeStage === undefined) ? projectStage : activeStage;
    const isFreeChatMode = (effectiveStage === null);
    const isCrossStageEdit = (!isFreeChatMode && effectiveStage !== projectStage);

    let aiSummary, newDoc, hasDocUpdate, syncLabel;

    if (isFreeChatMode) {
      // 自由聊天：不操作文案，只自然回答
      const artifacts = parseArtifacts(project);
      const freePrompt = `你是一位专注于短视频口播文案的创作助手，正在帮助用户进行项目「${project.title}」的创作。
这是自由对话模式，你无需输出任何文案标签，只需自然地回答用户的问题、提供建议或探讨想法。
${rulesText ? '用户风格参考（Skill）：\n' + rulesText + '\n' : ''}当前项目阶段：${projectStage}
${Object.keys(artifacts).length ? '已确认产出：' + Object.keys(artifacts).map(k => k).join('、') : ''}
对话历史：
${history}`;
      const aiRaw = await callAI(freePrompt + '\n\n用户：' + message.trim(), { maxTokens: 800, temperature: 0.85 });
      aiSummary = aiRaw.trim();
      newDoc = project.doc || '';
      hasDocUpdate = 0;
      syncLabel = null;
    } else {
      // 分阶段生成（可能是当前阶段，也可能是历史阶段的二次修改）
      const artifacts = parseArtifacts(project);
      // 历史阶段编辑时，currentDraft 用该阶段的已确认快照（不是 project.doc）
      const currentDraftOverride = isCrossStageEdit ? (artifacts[effectiveStage] || '') : undefined;
      const gen = await generateStageReply({
        userId: req.userId,
        project, skill, stage: effectiveStage, boundMaterials, history,
        userMessage: message.trim(), currentDraftOverride,
      });
      ({ aiSummary, newDoc, hasDocUpdate, syncLabel } = gen);
    }

    // ── 更新数据库 ────────────────────────────────────────────────
    let artifactKey = null;
    if (hasDocUpdate && isCrossStageEdit) {
      // 历史阶段编辑 → 更新 artifacts 字段，不动 project.doc
      const currentArtifacts = parseArtifacts(project);
      currentArtifacts[effectiveStage] = newDoc;
      // 记录 AI 基线供定稿 diff 学习（_ 开头为内部数据，前端跳过渲染）
      currentArtifacts._aiBaseline = { stage: effectiveStage, doc: newDoc, at: Date.now() };
      await db.query(
        'UPDATE cw_original_projects SET artifacts = ?, turns = turns + 1 WHERE id = ?',
        [JSON.stringify(currentArtifacts), projectId]
      );
      artifactKey = effectiveStage;
    } else if (hasDocUpdate) {
      // 当前阶段生成 → 更新活文档，同步记录 AI 基线
      const currentArtifacts = parseArtifacts(project);
      currentArtifacts._aiBaseline = { stage: effectiveStage, doc: newDoc, at: Date.now() };
      await db.query(
        'UPDATE cw_original_projects SET doc = ?, artifacts = ?, turns = turns + 1 WHERE id = ?',
        [newDoc, JSON.stringify(currentArtifacts), projectId]
      );
    } else {
      await db.query('UPDATE cw_original_projects SET turns = turns + 1 WHERE id = ?', [projectId]);
    }

    // 保存 AI 消息（记录所属阶段）
    const stageForMsg = isFreeChatMode ? projectStage : effectiveStage;
    const { rows: ins } = await db.query(
      'INSERT INTO cw_original_messages (project_id, role, content, has_doc_update, sync_label, sync_done, auto_learn, stage) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
      [projectId, 'ai', aiSummary, hasDocUpdate, syncLabel, autoLearnRule || null, stageForMsg]
    );
    const msgId = ins?.[0]?.id;

    // 获取最新项目数据
    const { rows: updated } = await db.query('SELECT * FROM cw_original_projects WHERE id = ?', [projectId]);

    // ── 构建响应 ─────────────────────────────────────────────────
    const responseData = {
      message: {
        id: msgId,
        role: 'ai',
        content: aiSummary,
        has_doc_update: hasDocUpdate,
        sync_label: syncLabel,
        sync_done: null,
        auto_learn: autoLearnRule || null,
        stage: stageForMsg,
      },
      turns: updated?.[0]?.turns || 0,
      stage: projectStage, // 项目当前阶段不变
    };

    if (artifactKey) {
      // 历史阶段编辑 → 前端更新对应 artifact
      responseData.artifactKey = artifactKey;
      responseData.artifactContent = newDoc;
    } else {
      // 当前阶段或自由聊天 → 前端更新 doc（自由聊天时 doc 不变）
      responseData.doc = newDoc;
    }

    res.json({ code: 200, data: responseData });
  } catch (err) {
    console.error('/original/projects/:id/chat error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

/* ═══════════════════════════════════════
   阶段流转（确认进入下一步 / 回退上一步）
═══════════════════════════════════════ */

// POST /api/original/projects/:id/stage/advance — 确认当前阶段产出，进入下一阶段并自动生成初稿
router.post('/projects/:id/stage/advance', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  try {
    const project = await getProject(projectId, req.userId);
    if (!project) return res.status(404).json({ code: 404, msg: '项目不存在' });

    const stage = project.stage || 'script';
    const nextStage = STAGE_META[stage]?.next;
    if (!nextStage) {
      // 已是最后一步：标记完成
      await db.query("UPDATE cw_original_projects SET status = 'final' WHERE id = ?", [projectId]);
      // 定稿触发 diff 学习（异步，不阻塞响应）
      getProject(projectId, req.userId)
        .then(p => p && extractEditDiffRules(p, req.userId))
        .catch(e => console.warn('[extractEditDiffRules] advance done:', e.message));
      return res.json({ code: 200, data: { done: true, stage, status: 'final' } });
    }
    const curDraft = (project.doc || '').trim();
    if (!curDraft) return res.status(400).json({ code: 400, msg: `请先生成${STAGE_META[stage].name}再进入下一步` });

    // 快照当前阶段产出到 artifacts
    const artifacts = parseArtifacts(project);
    artifacts[stage] = curDraft;

    // 进入下一阶段，doc 清空准备承载下一阶段草稿
    await db.query(
      'UPDATE cw_original_projects SET stage = ?, artifacts = ?, doc = ? WHERE id = ?',
      [nextStage, JSON.stringify(artifacts), '', projectId]
    );

    // 插入一条阶段分隔提示（system 信息以 ai 角色呈现，不含产出）
    const stageTipName = STAGE_META[nextStage].name;
    await db.query(
      "INSERT INTO cw_original_messages (project_id, role, content, has_doc_update, stage) VALUES (?, 'ai', ?, 0, ?)",
      [projectId, `✅ ${STAGE_META[stage].name}已确认。进入下一步：${stageTipName}。`, nextStage]
    );

    // 自动生成下一阶段初稿
    const skill = await getOrCreateSkill(req.userId);
    const boundMaterials = await getBoundMaterials(projectId);
    const freshProject = await getProject(projectId, req.userId); // doc 已清空、stage 已更新
    const gen = await generateStageReply({
      userId: req.userId,
      project: freshProject, skill, stage: nextStage, boundMaterials, history: '',
      userMessage: `请根据已确认的内容，直接写出这一阶段（${stageTipName}）的初稿。`,
    });

    if (gen.hasDocUpdate) {
      // 记录 AI 基线供定稿 diff 学习
      const advArtifacts = parseArtifacts(freshProject);
      advArtifacts._aiBaseline = { stage: nextStage, doc: gen.newDoc, at: Date.now() };
      await db.query('UPDATE cw_original_projects SET doc = ?, artifacts = ?, turns = turns + 1 WHERE id = ?', [gen.newDoc, JSON.stringify(advArtifacts), projectId]);
    }
    const { rows: ins } = await db.query(
      "INSERT INTO cw_original_messages (project_id, role, content, has_doc_update, sync_label, sync_done, stage) VALUES (?, 'ai', ?, ?, ?, NULL, ?)",
      [projectId, gen.aiSummary, gen.hasDocUpdate, gen.syncLabel, nextStage]
    );
    const { rows: updated } = await db.query('SELECT * FROM cw_original_projects WHERE id = ?', [projectId]);

    res.json({
      code: 200,
      data: {
        stage: nextStage,
        prevStage: stage,
        tipName: stageTipName,
        message: { id: ins?.[0]?.id, role: 'ai', content: gen.aiSummary, has_doc_update: gen.hasDocUpdate, sync_label: gen.syncLabel, sync_done: null, stage: nextStage },
        doc: gen.newDoc,
        turns: updated?.[0]?.turns || 0,
      }
    });
  } catch (err) {
    console.error('/original/projects/:id/stage/advance error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// POST /api/original/projects/:id/stage/back — 回退到上一阶段，恢复其已确认产出到 doc
router.post('/projects/:id/stage/back', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  try {
    const project = await getProject(projectId, req.userId);
    if (!project) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const stage = project.stage || 'script';
    const prevStage = STAGE_META[stage]?.prev;
    if (!prevStage) return res.status(400).json({ code: 400, msg: '已经是第一步' });

    const artifacts = parseArtifacts(project);
    const restored = artifacts[prevStage] || '';
    await db.query("UPDATE cw_original_projects SET stage = ?, doc = ?, status = 'draft' WHERE id = ?", [prevStage, restored, projectId]);
    res.json({ code: 200, data: { stage: prevStage, doc: restored } });
  } catch (err) {
    console.error('/original/projects/:id/stage/back error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

/* ═══════════════════════════════════════
   项目对标素材绑定
═══════════════════════════════════════ */

// GET /api/original/projects/:id/materials — 项目已绑定的对标素材
router.get('/projects/:id/materials', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  try {
    const project = await getProject(projectId, req.userId);
    if (!project) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const { rows } = await db.query(
      `SELECT m.id, m.title, LEFT(m.raw_content, 100) AS preview
         FROM cw_project_materials pm JOIN cw_materials m ON m.id = pm.material_id
        WHERE pm.project_id = ? ORDER BY pm.id ASC`,
      [projectId]
    );
    res.json({ code: 200, data: rows || [] });
  } catch (err) {
    console.error('/original/projects/:id/materials GET error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// POST /api/original/projects/:id/materials — 绑定对标素材 { materialIds: [] }
router.post('/projects/:id/materials', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  const { materialIds = [] } = req.body;
  try {
    const project = await getProject(projectId, req.userId);
    if (!project) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const ids = (Array.isArray(materialIds) ? materialIds : []).map(Number).filter(Boolean).slice(0, 8);
    for (const mid of ids) {
      try {
        await db.query(
          'INSERT IGNORE INTO cw_project_materials (project_id, material_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM cw_materials WHERE id = ? AND user_id = ?)',
          [projectId, mid, mid, req.userId]
        );
      } catch (_) {}
    }
    const { rows } = await db.query(
      `SELECT m.id, m.title, LEFT(m.raw_content, 100) AS preview
         FROM cw_project_materials pm JOIN cw_materials m ON m.id = pm.material_id
        WHERE pm.project_id = ? ORDER BY pm.id ASC`,
      [projectId]
    );
    res.json({ code: 200, data: rows || [] });
  } catch (err) {
    console.error('/original/projects/:id/materials POST error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// DELETE /api/original/projects/:id/materials/:mid — 解绑某个对标素材
router.delete('/projects/:id/materials/:mid', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  const mid = parseInt(req.params.mid);
  try {
    const project = await getProject(projectId, req.userId);
    if (!project) return res.status(404).json({ code: 404, msg: '项目不存在' });
    await db.query('DELETE FROM cw_project_materials WHERE project_id = ? AND material_id = ?', [projectId, mid]);
    res.json({ code: 200, msg: 'ok' });
  } catch (err) {
    console.error('/original/projects/:id/materials DELETE error:', err.message);
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
// 支持两种来源：items（旧，带 awemeId/script）或 materialIds（从素材库选）
router.post('/learning/analyze', requireAuth, async (req, res) => {
  const { type = 'video', items = [], scope = 'global', materialIds = [] } = req.body;

  let picked = [];
  let tikhubKey = null;

  if (Array.isArray(materialIds) && materialIds.length > 0) {
    // 从素材库加载
    const ids = materialIds.slice(0, 4).map(Number).filter(Boolean);
    if (ids.length) {
      const { rows: mats } = await db.query(
        `SELECT id, title, raw_content FROM cw_materials WHERE id IN (${ids.map(()=>'?').join(',')}) AND user_id = ?`,
        [...ids, req.userId]
      );
      picked = mats.map(m => ({ desc: m.title, script: m.raw_content || '', likes: 0 }));
    }
  } else {
    picked = (Array.isArray(items) ? items : []).filter(it => it && (it.script || it.awemeId)).slice(0, 4);
    if (picked.some(p => !p.script && p.awemeId)) {
      tikhubKey = await getTikhubKey();
    }
  }

  if (!picked.length) return res.status(400).json({ code: 400, msg: '请先选择要学习的素材' });

  try {
    if (!tikhubKey && picked.some(p => !p.script && p.awemeId)) {
      tikhubKey = await getTikhubKey();
      if (!tikhubKey) return res.status(503).json({ code: 503, msg: '抖音解析未配置，请联系管理员配置 TikHub Key' });
    }

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

  // 仅用于本项目：真实写入该项目 meta.projectRules，之后本项目对话生成都会带上
  if (scope !== 'global') {
    try {
      if (!projectId) return res.status(400).json({ code: 400, msg: '缺少 projectId' });
      const project = await getProject(projectId, req.userId);
      if (!project) return res.status(400).json({ code: 400, msg: '项目不存在或无权访问' });

      const meta = project.meta || {};
      const existing = Array.isArray(meta.projectRules) ? meta.projectRules.slice() : [];
      const seen = new Set(existing.map(t => String(t).replace(/\s+/g, '')));
      for (const ins of insights) {
        const text = (ins && ins.text ? String(ins.text) : '').trim();
        if (!text) continue;
        const key = text.replace(/\s+/g, '');
        if (seen.has(key)) continue;
        seen.add(key);
        existing.push(text);
      }
      // 上限 20 条，超出移除最旧的
      const projectRules = existing.slice(-20);
      meta.projectRules = projectRules;

      await db.query(
        'UPDATE cw_original_projects SET meta = ? WHERE id = ? AND user_id = ?',
        [JSON.stringify(meta), projectId, req.userId]
      );
      return res.json({ code: 200, msg: '规律已记录，本项目对话时会参考', data: { projectRules } });
    } catch (err) {
      console.error('/original/learning/write (project) error:', err.message);
      return res.status(500).json({ code: 500, msg: err.message });
    }
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

/* ═══════════════════════════════════════════════════════════════
   素材库 CRUD
═══════════════════════════════════════════════════════════════ */

// GET /api/original/materials — 列出用户所有素材
router.get('/materials', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, title, source_url, source_type,
              LEFT(raw_content, 120) AS preview,
              CHAR_LENGTH(raw_content) AS content_len,
              created_at
       FROM cw_materials WHERE user_id = ? ORDER BY created_at DESC`,
      [req.userId]
    );
    res.json({ code: 200, data: rows });
  } catch (err) {
    console.error('/original/materials GET error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// POST /api/original/materials — 保存素材（文字直存 or URL提取后存）
router.post('/materials', requireAuth, async (req, res) => {
  const { title, rawContent, sourceUrl, sourceType = 'text' } = req.body;
  if (!rawContent?.trim()) return res.status(400).json({ code: 400, msg: '素材内容不能为空' });
  const finalTitle = (title || '').trim() || `素材 ${new Date().toLocaleDateString('zh-CN')}`;
  try {
    const { rows } = await db.query(
      'INSERT INTO cw_materials (user_id, title, source_url, source_type, raw_content) VALUES (?, ?, ?, ?, ?)',
      [req.userId, finalTitle, sourceUrl || null, sourceType, rawContent.trim()]
    );
    res.json({ code: 200, data: { id: rows[0]?.id } });
  } catch (err) {
    console.error('/original/materials POST error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// DELETE /api/original/materials/:id — 删除素材
router.delete('/materials/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM cw_materials WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    res.json({ code: 200 });
  } catch (err) {
    console.error('/original/materials DELETE error:', err.message);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

module.exports = router;
