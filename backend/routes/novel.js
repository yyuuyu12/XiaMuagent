// routes/novel.js — AI 写小说：书架 + 设定卡 + 大纲/细纲 + 写章流水线 + 对话修改 + 导出
// 架构见 docs/AI写小说-架构设计v2.md。写章为异步任务（tasks 表 + taskRunner），单章 2-4 次 AI 调用。
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');
const { callAI } = require('../lib/callAI');
const taskRunner = require('../taskRunner');

async function getConfigVal(key) {
  try {
    const { rows } = await db.query('SELECT value FROM system_config WHERE config_key = ?', [key]);
    return (rows?.[0]?.value || '').trim();
  } catch { return ''; }
}

/* ═══════════ 工具 ═══════════ */

async function getProject(projectId, userId) {
  const { rows } = await db.query('SELECT * FROM nv_projects WHERE id = ? AND user_id = ?', [projectId, userId]);
  const p = rows?.[0];
  if (!p) return null;
  try { p.state = typeof p.state === 'string' ? JSON.parse(p.state) : (p.state || {}); } catch { p.state = {}; }
  return p;
}

async function getCards(projectId) {
  const { rows } = await db.query('SELECT * FROM nv_kb_cards WHERE project_id = ? ORDER BY sort, id', [projectId]);
  return rows || [];
}

// 去 AI 味词库（程序化终检：正文中出现则尽量删改，删不掉的由 critic 兜底）
const AI_SLOP_WORDS = ['不禁', '不由得', '心中一凛', '眼中闪过一丝', '嘴角勾起一抹', '缓缓说道', '冷冷地说', '深吸一口气', '不得不说', '值得一提的是', '总而言之', '综上所述'];

// 最简记忆包（MVP 规则版）：只注入"不知道就写错"的信息
// 设定卡全量（MVP 卡少）+ 世界基石状态 + 本卷大纲段 + 上一章结尾
async function buildMemoryPack(project, chapter, extraText) {
  // 设定卡（世界观/势力/文风，不含角色——角色走独立表）
  const cards = await getCards(project.id);
  const cardBlock = cards.map(c => {
    const kindLabel = { world: '世界观', character: '角色', faction: '势力', style: '文风' }[c.kind] || c.kind;
    return `【${kindLabel}·${c.title}】\n${(c.content || '').slice(0, 1200)}`;
  }).join('\n\n');

  // ── 角色 + 关系：裁剪式注入（本章细纲点名 + 主角 + extraText 命中的角色；extraText 用于对话改稿时纳入当前正文/用户指名的角色）──
  const { rows: allChars } = await db.query('SELECT * FROM nv_characters WHERE project_id = ? ORDER BY sort, id', [project.id]);
  const outlineText = (chapter.outline || '') + ' ' + (extraText || '');
  // 命中规则：主角始终带上；其余角色名出现在本章细纲里才带
  const involved = (allChars || []).filter(c => c.role_type === 'lead' || (c.name && outlineText.includes(c.name)));
  const involvedIds = new Set(involved.map(c => c.id));
  const charById = {}; (allChars || []).forEach(c => { charById[c.id] = c; });
  let charBlock = '';
  if (involved.length) {
    charBlock = '【本章相关角色（行为必须符合各自的灵魂烙印）】\n' + involved.map(c => {
      const cur = c.status ? `；当前：${c.status}` : '';
      return `· ${c.name}（${c.identity || c.role_type}）烙印：${(c.persona || '').slice(0, 120)}｜欲望/恐惧：${(c.goals || '').slice(0, 80)}${cur}`;
    }).join('\n');
  }
  // 组织 + 关系边（裁剪：角色↔角色都出场才注入；角色→组织归属带出该组织；相关组织间关系）
  const { rows: allFacs } = await db.query('SELECT * FROM nv_factions WHERE project_id = ?', [project.id]);
  const facById = {}; (allFacs || []).forEach(f => { facById[f.id] = f; });
  const { rows: rels } = await db.query('SELECT * FROM nv_relations WHERE project_id = ?', [project.id]);
  const relLines = []; const involvedFacIds = new Set();
  for (const r of (rels || [])) {
    const ft = r.from_type || 'char', tt = r.to_type || 'char';
    if (ft === 'char' && tt === 'char') {
      if (!involvedIds.has(r.from_id) || !involvedIds.has(r.to_id)) continue;
      const a = charById[r.from_id], b = charById[r.to_id]; if (!a || !b) continue;
      relLines.push(`· ${a.name} → ${b.name}：${r.rel_type}（亲密度${r.affinity}/100）${r.description ? '，' + r.description.slice(0, 80) : ''}`);
    } else if (ft === 'char' && tt === 'faction') {
      if (!involvedIds.has(r.from_id)) continue;
      const a = charById[r.from_id], f = facById[r.to_id]; if (!a || !f) continue;
      involvedFacIds.add(f.id);
      relLines.push(`· ${a.name} 隶属 ${f.name}（${r.rel_type}）`);
    }
  }
  // 相关组织之间的关系
  for (const r of (rels || [])) {
    if ((r.from_type === 'faction') && (r.to_type === 'faction') && involvedFacIds.has(r.from_id) && involvedFacIds.has(r.to_id)) {
      const a = facById[r.from_id], b = facById[r.to_id]; if (!a || !b) continue;
      relLines.push(`· ${a.name} → ${b.name}：${r.rel_type}${r.description ? '，' + r.description.slice(0, 80) : ''}`);
    }
  }
  const relBlock = relLines.length ? '【本章相关角色/组织关系（写对话、立场、冲突时必须符合）】\n' + relLines.join('\n') : '';
  // 涉及组织的设定
  const facBlock = involvedFacIds.size
    ? '【本章涉及的组织】\n' + [...involvedFacIds].map(id => { const f = facById[id]; return `· ${f.name}（${f.kind}）${(f.description || '').slice(0, 100)}`; }).join('\n')
    : '';

  const state = project.state || {};
  const stateBlock = state.summary ? `【前情提要】\n${state.summary}` : '';

  // 上一章结尾（衔接）
  let prevTail = '';
  const { rows: prevRows } = await db.query(
    'SELECT content, title, seq FROM nv_chapters WHERE project_id = ? AND status != ? AND ((volume = ? AND seq < ?) OR volume < ?) ORDER BY volume DESC, seq DESC LIMIT 1',
    [project.id, 'todo', chapter.volume, chapter.seq, chapter.volume]
  );
  if (prevRows?.[0]?.content) {
    prevTail = `【上一章（第${prevRows[0].seq}章 ${prevRows[0].title}）结尾，必须自然衔接】\n……${prevRows[0].content.slice(-800)}`;
  }

  return [cardBlock, charBlock, facBlock, relBlock, stateBlock, prevTail].filter(Boolean).join('\n\n');
}

// 小说写作戒律（自写，消化商业网文方法论；后续可由题材公式包覆盖补充）
const NOVEL_EDICTS = `## 写作戒律（必须遵守）
- 开篇前三段必须进入具体场景和动作，禁止环境铺陈或背景说明开场
- 每章结尾必须留钩子：悬念、危机、反转预告或情绪缺口，禁止圆满收束
- 展示而非陈述：情绪用动作和对话外化，禁止直接写"他很愤怒"
- 对话要有潜台词和性格区分度，禁止角色腔调一致的功能性对话
- 一章只推进 1-2 个剧情点，写透写满，禁止流水账赶进度
- 禁止以下 AI 腔：${AI_SLOP_WORDS.join('、')}
- 段落要短，多换行；单段不超过 4 行`;

/* ═══════════ 项目（书架） ═══════════ */

router.get('/projects', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.id, p.title, p.genre, p.brief, p.status, p.target_words, p.updated_at,
        (SELECT COUNT(*) FROM nv_chapters c WHERE c.project_id = p.id) AS chapter_total,
        (SELECT COUNT(*) FROM nv_chapters c WHERE c.project_id = p.id AND c.status = 'final') AS chapter_done,
        (SELECT COALESCE(SUM(word_count),0) FROM nv_chapters c WHERE c.project_id = p.id) AS words_written
       FROM nv_projects p WHERE p.user_id = ? ORDER BY p.updated_at DESC`,
      [req.userId]
    );
    res.json({ code: 200, data: rows || [] });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

router.post('/projects', requireAuth, async (req, res) => {
  const { title, genre, brief, targetWords, chapterWords } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ code: 400, msg: '请填写书名' });
  try {
    const { rows } = await db.query(
      'INSERT INTO nv_projects (user_id, title, genre, brief, target_words, chapter_words, state) VALUES (?,?,?,?,?,?,?)',
      [req.userId, String(title).trim().slice(0, 200), String(genre || '').slice(0, 50), String(brief || '').slice(0, 2000),
       parseInt(targetWords) || 200000, parseInt(chapterWords) || 2500, JSON.stringify({})]
    );
    res.json({ code: 200, msg: '已创建', data: { id: rows?.[0]?.id } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

router.get('/projects/:id', requireAuth, async (req, res) => {
  try {
    const p = await getProject(parseInt(req.params.id), req.userId);
    if (!p) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const cards = await getCards(p.id);
    const { rows: chapters } = await db.query(
      'SELECT id, volume, seq, title, outline, status, word_count FROM nv_chapters WHERE project_id = ? ORDER BY volume, seq', [p.id]);
    const { rows: characters } = await db.query('SELECT * FROM nv_characters WHERE project_id = ? ORDER BY sort, id', [p.id]);
    const { rows: relations } = await db.query('SELECT * FROM nv_relations WHERE project_id = ?', [p.id]);
    const { rows: factions } = await db.query('SELECT * FROM nv_factions WHERE project_id = ? ORDER BY sort, id', [p.id]);
    res.json({ code: 200, data: { project: p, cards, chapters: chapters || [], characters: characters || [], relations: relations || [], factions: factions || [] } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

router.patch('/projects/:id', requireAuth, async (req, res) => {
  try {
    const p = await getProject(parseInt(req.params.id), req.userId);
    if (!p) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const fields = []; const vals = [];
    for (const [k, col] of [['title','title'],['genre','genre'],['brief','brief'],['persona','persona'],['status','status'],['outline','outline']]) {
      if (req.body[k] !== undefined) { fields.push(`${col} = ?`); vals.push(String(req.body[k])); }
    }
    if (req.body.chapterWords !== undefined) { fields.push('chapter_words = ?'); vals.push(parseInt(req.body.chapterWords) || 2500); }
    if (fields.length) {
      vals.push(p.id);
      await db.query(`UPDATE nv_projects SET ${fields.join(', ')} WHERE id = ?`, vals);
    }
    res.json({ code: 200, msg: '已保存' });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

router.delete('/projects/:id', requireAuth, async (req, res) => {
  try {
    const p = await getProject(parseInt(req.params.id), req.userId);
    if (!p) return res.status(404).json({ code: 404, msg: '项目不存在' });
    await db.query('DELETE FROM nv_chapters WHERE project_id = ?', [p.id]);
    await db.query('DELETE FROM nv_kb_cards WHERE project_id = ?', [p.id]);
    await db.query('DELETE FROM nv_foreshadowing WHERE project_id = ?', [p.id]);
    await db.query('DELETE FROM nv_projects WHERE id = ?', [p.id]);
    res.json({ code: 200, msg: '已删除' });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

/* ═══════════ 设定卡 ═══════════ */

// ── 异步生成内部逻辑：设定卡/大纲/细纲都统一走 tasks 队列，避免同步 AI 几十秒被网关超时返 504 HTML ──

async function _genBootstrap(p) {
  const prompt = `你是资深网文主编。根据下面的小说设定，生成 1 个世界观 + 2 个角色（主角、主要对手）。只输出 JSON。
【书名】${p.title}
【题材】${p.genre || '未指定'}
【一句话设定】${p.brief || '（未填写，请按书名和题材合理虚构）'}

输出格式（严格 JSON，不要其他文字）：
{
  "world": { "title": "世界观名", "content": "力量/规则体系、社会结构、地理舞台、本书核心矛盾的世界根源。300-500字" },
  "protagonist": { "name":"主角名", "identity":"身份与处境(一句话)", "persona":"灵魂烙印：性格底色+核心缺陷，决定他一切行为的根源", "goals":"核心欲望与最深恐惧", "abilities":"开篇时的能力边界/金手指" },
  "antagonist": { "name":"对手名", "identity":"身份(一句话)", "persona":"灵魂烙印+行事逻辑(要让人理解他为何这么做)", "goals":"他要什么", "abilities":"优势与软肋", "rel_to_lead":"与主角的核心冲突是什么" }
}`;
  const raw = await callAI(prompt, { temperature: 0.7, maxTokens: 2000, bypassCap: true });
  const jm = raw.match(/\{[\s\S]*\}/);
  if (!jm) throw new Error('AI 输出解析失败');
  const data = JSON.parse(jm[0]);
  // 世界观 → 设定卡
  if (data.world && data.world.content) {
    await db.query('INSERT INTO nv_kb_cards (project_id, kind, title, content, sort) VALUES (?,?,?,?,?)',
      [p.id, 'world', (data.world.title || '世界观').slice(0, 200), data.world.content, 0]);
  }
  // 主角/反派 → 角色表
  const ids = {};
  const chars = [['lead', data.protagonist, '#F5762A', 0], ['antagonist', data.antagonist, '#E5534B', 1]];
  for (const [roleType, c, color, sort] of chars) {
    if (!c || !c.name) continue;
    const { rows } = await db.query(
      'INSERT INTO nv_characters (project_id, name, role_type, identity, persona, goals, abilities, rel_to_lead, first_chapter, color, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [p.id, String(c.name).slice(0, 100), roleType, String(c.identity || '').slice(0, 255),
       String(c.persona || ''), String(c.goals || ''), String(c.abilities || ''), String(c.rel_to_lead || ''), 1, color, sort]);
    ids[roleType] = rows?.[0]?.id;
  }
  // 主角 → 反派 建一条初始对立关系，让图谱不空
  if (ids.lead && ids.antagonist) {
    await db.query('INSERT INTO nv_relations (project_id, from_id, to_id, rel_type, affinity, description, updated_chapter) VALUES (?,?,?,?,?,?,?)',
      [p.id, ids.lead, ids.antagonist, '宿敌', 15, String(data.antagonist?.rel_to_lead || '核心冲突').slice(0, 500), 0]);
  }
}

async function _genOutline(p) {
  const cards = await getCards(p.id);
  const cardText = cards.filter(c => c.kind !== 'style').map(c => `【${c.title}】${(c.content || '').slice(0, 600)}`).join('\n');
  const volumes = Math.max(2, Math.round((p.target_words || 200000) / 80000));
  const prompt = `你是资深网文主编。基于设定生成全书卷级大纲。
【书名】${p.title}【题材】${p.genre}【目标字数】约${Math.round((p.target_words || 200000) / 10000)}万字，建议分 ${volumes} 卷
【设定】
${cardText}
${p.brief ? `【作者意图】${p.brief}` : ''}

要求：
- 每卷给出：卷名、本卷主线（2-3句）、开卷钩子、卷末高潮与转折、主角成长/获得、留给下一卷的悬念
- 整体要有递进：势力/舞台逐卷扩大，每卷结尾比开头的赌注更大
- 第一卷前三章必须能立住主角和核心冲突
- 用 Markdown 输出，## 第N卷·卷名 作为标题`;
  const outline = await callAI(prompt, { temperature: 0.7, maxTokens: 3000, bypassCap: true });
  await db.query('UPDATE nv_projects SET outline = ? WHERE id = ?', [outline, p.id]);
}

// 对话式修改大纲：在现有大纲基础上按作者指令调整，返回完整大纲
async function _reviseOutline(p, instruction) {
  const prompt = `你是资深网文主编。下面是当前全书大纲，请按作者的要求调整，输出【完整的】修改后大纲。
【当前大纲】
${p.outline || '（空）'}

【作者要求】${instruction}

要求：
- 只改作者要求的部分，没提到的卷/内容原样保留，不要删减或省略
- 保持 Markdown 卷级结构（## 第N卷·卷名）
- 直接输出完整大纲，不要解释、不要前后缀`;
  const outline = await callAI(prompt, { temperature: 0.6, maxTokens: 3500, bypassCap: true });
  if (outline && outline.trim().length > 20) {
    await db.query('UPDATE nv_projects SET outline = ? WHERE id = ?', [outline.trim(), p.id]);
  }
}

// 对话式修改设定集（世界观/势力/文风卡）：按指令改卡或新增卡
async function _reviseCards(p, instruction) {
  const cards = await getCards(p.id);
  const list = cards.map(c => `[id:${c.id}|${c.kind}] ${c.title}\n${(c.content || '').slice(0, 800)}`).join('\n\n') || '（暂无设定卡）';
  const prompt = `你是小说设定管理员。下面是现有设定卡，请按作者要求调整。只输出 JSON 数组。
【现有设定卡】
${list}

【作者要求】${instruction}

输出格式（只返回需要改动或新增的卡，没动的不要返回）：
[{ "id": 要改的现有卡id（新增则不要这个字段）, "kind": "world/faction/style", "title": "卡名", "content": "完整内容" }]`;
  const raw = await callAI(prompt, { temperature: 0.5, maxTokens: 2000, bypassCap: true });
  const jm = raw.match(/\[[\s\S]*\]/);
  if (!jm) return;
  const arr = JSON.parse(jm[0]);
  for (const c of arr) {
    if (!c || !c.content) continue;
    if (c.id) {
      await db.query('UPDATE nv_kb_cards SET title = ?, content = ? WHERE id = ? AND project_id = ?',
        [String(c.title || '设定').slice(0, 200), String(c.content), parseInt(c.id), p.id]).catch(() => {});
    } else {
      await db.query('INSERT INTO nv_kb_cards (project_id, kind, title, content) VALUES (?,?,?,?)',
        [p.id, ['world', 'faction', 'style'].includes(c.kind) ? c.kind : 'world', String(c.title || '新设定').slice(0, 200), String(c.content)]).catch(() => {});
    }
  }
}

// 对话式修改人物（结构化补丁：改角色字段 / 新增角色 / 改关系）
async function _reviseChars(p, instruction) {
  const { rows: chars } = await db.query('SELECT id, name, role_type, identity, persona FROM nv_characters WHERE project_id = ?', [p.id]);
  const roster = (chars || []).map(c => `${c.name}（${c.role_type}）烙印：${(c.persona || '').slice(0, 60)}`).join('\n') || '（暂无角色）';
  const nameToId = {}; (chars || []).forEach(c => { nameToId[c.name] = c.id; });
  const prompt = `你是小说设定管理员。下面是现有角色，请按作者要求调整。只输出 JSON。
【现有角色】
${roster}

【作者要求】${instruction}

输出格式（只写要改/新增的）：
{
  "character_updates": [{ "name":"已有角色名", "persona":"新烙印(可选)", "goals":"(可选)", "identity":"(可选)", "abilities":"(可选)", "role_type":"lead/antagonist/supporting/love(可选)" }],
  "new_characters": [{ "name":"", "role_type":"", "identity":"", "persona":"", "goals":"", "abilities":"" }]
}`;
  const raw = await callAI(prompt, { temperature: 0.5, maxTokens: 1500, bypassCap: true });
  const jm = raw.match(/\{[\s\S]*\}/);
  if (!jm) return;
  const patch = JSON.parse(jm[0]);
  for (const u of (patch.character_updates || [])) {
    if (!u || !u.name || !nameToId[u.name]) continue;
    const fields = []; const vals = [];
    for (const k of ['persona', 'goals', 'identity', 'abilities', 'role_type']) {
      if (u[k] !== undefined && u[k] !== '') { fields.push(`${k} = ?`); vals.push(String(u[k])); }
    }
    if (fields.length) { vals.push(nameToId[u.name]); await db.query(`UPDATE nv_characters SET ${fields.join(', ')} WHERE id = ?`, vals).catch(() => {}); }
  }
  let idx = (chars || []).length;
  for (const c of (patch.new_characters || [])) {
    if (!c || !c.name || nameToId[c.name]) continue;
    const rt = ['lead', 'antagonist', 'supporting', 'love'].includes(c.role_type) ? c.role_type : 'supporting';
    await db.query('INSERT INTO nv_characters (project_id, name, role_type, identity, persona, goals, abilities, color, sort) VALUES (?,?,?,?,?,?,?,?,?)',
      [p.id, String(c.name).slice(0, 100), rt, String(c.identity || '').slice(0, 255), String(c.persona || ''), String(c.goals || ''), String(c.abilities || ''), CHAR_COLORS[idx % CHAR_COLORS.length], idx]).catch(() => {});
    idx++;
  }
}

async function _genToc(p, params) {
  const volume = parseInt(params.volume) || 1;
  const count = Math.min(parseInt(params.count) || 10, 20);
  const { rows: existRows } = await db.query('SELECT MAX(seq) AS maxSeq FROM nv_chapters WHERE project_id = ?', [p.id]);
  const startSeq = (existRows?.[0]?.maxSeq || 0) + 1;
  const { rows: recentRows } = await db.query(
    'SELECT seq, title, outline FROM nv_chapters WHERE project_id = ? ORDER BY seq DESC LIMIT 5', [p.id]);
  const recentBlock = (recentRows || []).reverse().map(r => `第${r.seq}章 ${r.title}：${r.outline}`).join('\n');
  const cw = p.chapter_words || 2500;
  const prompt = `你是资深网文主编。基于全书大纲，为第 ${volume} 卷规划第 ${startSeq} 到 ${startSeq + count - 1} 章的细纲。只输出 JSON 数组。
【全书大纲】
${(p.outline || '').slice(0, 3000)}
${recentBlock ? `【已有章节（必须延续，不要重复剧情）】\n${recentBlock}` : '【这是全书开头，第一章必须快速进入核心冲突】'}

每章要求（关键——细颗粒度切分）：
- **每章只承载一个小情节/一个场景/一次冲突**，是 ${cw} 字左右能写完的量。宁可把一段剧情拆成两三章，也不要一章塞多个情节。
- 不要删剧情、不要跳过情节——只是把同样的故事切得更细、章节更多。相邻章节自然衔接、推进连贯。
- outline：本章发生什么（2-3句，具体到场景和动作）；hook：章末钩子（一句话）。
- 节奏：每 3-4 章一个小高潮，本批最后一章留较大悬念。

输出格式（严格 JSON 数组，不要其他文字）：
[{ "seq": ${startSeq}, "title": "章名", "outline": "细纲…", "hook": "章末钩子" }]`;
  const raw = await callAI(prompt, { temperature: 0.7, maxTokens: 3500, bypassCap: true });
  const jm = raw.match(/\[[\s\S]*\]/);
  if (!jm) throw new Error('AI 输出解析失败');
  const list = JSON.parse(jm[0]);
  for (const ch of list) {
    if (!ch || !ch.outline) continue;
    await db.query('INSERT INTO nv_chapters (project_id, volume, seq, title, outline, status) VALUES (?,?,?,?,?,?)',
      [p.id, volume, parseInt(ch.seq) || startSeq, String(ch.title || `第${ch.seq}章`).slice(0, 200),
       String(ch.outline) + (ch.hook ? `\n章末钩子：${ch.hook}` : ''), 'todo']);
  }
}

// AI 识别角色：扫描现有设定卡+大纲+已写章节，提取角色与关系，批量建档（去重已有）
// 关系去重插入（支持 char/faction 跨类型）
async function _insertRelOnce(pid, fromId, fromType, toId, toType, relType, aff, desc) {
  if (!fromId || !toId || (fromId === toId && fromType === toType)) return;
  const { rows: ex } = await db.query('SELECT id FROM nv_relations WHERE project_id = ? AND from_id = ? AND from_type = ? AND to_id = ? AND to_type = ?', [pid, fromId, fromType, toId, toType]);
  if (ex?.length) return;
  await db.query('INSERT INTO nv_relations (project_id, from_id, to_id, from_type, to_type, rel_type, affinity, description, updated_chapter) VALUES (?,?,?,?,?,?,?,?,?)',
    [pid, fromId, toId, fromType, toType, String(relType || '关系').slice(0, 40), Math.max(0, Math.min(100, parseInt(aff) || 50)), String(desc || '').slice(0, 500), 0]).catch(() => {});
}

async function _genExtractChars(p) {
  const cards = await getCards(p.id);
  const cardText = cards.map(c => `【${c.kind}·${c.title}】${(c.content || '').slice(0, 800)}`).join('\n');
  const { rows: chs } = await db.query(
    "SELECT seq, title, content FROM nv_chapters WHERE project_id = ? AND content IS NOT NULL AND content != '' ORDER BY seq LIMIT 12", [p.id]);
  const chapterText = (chs || []).map(c => `第${c.seq}章 ${c.title}：${(c.content || '').slice(0, 1500)}`).join('\n\n');
  const material = `${cardText}\n\n${(p.outline || '').slice(0, 1500)}\n\n${chapterText}`.trim();
  if (material.replace(/\s/g, '').length < 50) throw new Error('没有可分析的设定或正文，请先生成设定卡/大纲或写几章');

  const { rows: existChars } = await db.query('SELECT name FROM nv_characters WHERE project_id = ?', [p.id]);
  const { rows: existFacs } = await db.query('SELECT name FROM nv_factions WHERE project_id = ?', [p.id]);
  const exC = (existChars || []).map(c => c.name), exF = (existFacs || []).map(f => f.name);

  const prompt = `你是小说设定管理员。从下面的设定与正文中，提取角色、组织（宗门/家族/势力）、以及它们之间的关系。排除路人/群众/龙套。只输出 JSON。
【素材】
${material.slice(0, 13000)}
${exC.length ? `【已登记角色，不要重复】${exC.join('、')}` : ''}
${exF.length ? `【已登记组织，不要重复】${exF.join('、')}` : ''}

输出格式（严格 JSON）：
{
  "characters": [{ "name":"角色名", "role_type":"lead/antagonist/supporting/love", "identity":"身份一句话", "persona":"灵魂烙印", "goals":"欲望与恐惧", "abilities":"能力" }],
  "factions": [{ "name":"组织名", "kind":"宗门/家族/势力/朝廷/帮派 之一", "description":"宗旨/势力范围/特点 一两句" }],
  "memberships": [{ "character":"角色名", "faction":"组织名", "role":"掌门/弟子/族长/叛徒/… 一词", "affinity":0到100整数 }],
  "char_relations": [{ "from":"角色A", "to":"角色B", "rel_type":"盟友/仇敌/师徒/爱慕/亲属", "affinity":0到100整数, "description":"现状" }],
  "faction_relations": [{ "from":"组织A", "to":"组织B", "rel_type":"联盟/敌对/从属", "affinity":0到100整数, "description":"现状" }]
}
全书最多 1 个 lead。没有的项给空数组。`;
  const raw = await callAI(prompt, { temperature: 0.3, maxTokens: 3000, bypassCap: true });
  const jm = raw.match(/\{[\s\S]*\}/);
  if (!jm) throw new Error('AI 输出解析失败');
  const data = JSON.parse(jm[0]);

  // 角色（去重）
  const nameToId = {};
  const { rows: cFull } = await db.query('SELECT id, name FROM nv_characters WHERE project_id = ?', [p.id]);
  (cFull || []).forEach(c => { nameToId[c.name] = c.id; });
  let hasLead = false; let addedC = 0;
  for (const c of (data.characters || [])) {
    const nm = c && c.name ? String(c.name).trim() : '';
    if (!nm || nameToId[nm]) continue;
    let rt = ['lead', 'antagonist', 'supporting', 'love'].includes(c.role_type) ? c.role_type : 'supporting';
    if (rt === 'lead' && hasLead) rt = 'supporting'; else if (rt === 'lead') hasLead = true;
    const idx = Object.keys(nameToId).length;
    const { rows: ins } = await db.query(
      'INSERT INTO nv_characters (project_id, name, role_type, identity, persona, goals, abilities, color, sort) VALUES (?,?,?,?,?,?,?,?,?)',
      [p.id, nm.slice(0, 100), rt, String(c.identity || '').slice(0, 255), String(c.persona || ''), String(c.goals || ''), String(c.abilities || ''), CHAR_COLORS[idx % CHAR_COLORS.length], idx]
    ).catch(() => ({ rows: [] }));
    if (ins?.[0]?.id) { nameToId[nm] = ins[0].id; addedC++; }
  }
  // 组织（去重）
  const facToId = {};
  const { rows: fFull } = await db.query('SELECT id, name FROM nv_factions WHERE project_id = ?', [p.id]);
  (fFull || []).forEach(f => { facToId[f.name] = f.id; });
  let addedF = 0;
  for (const f of (data.factions || [])) {
    const nm = f && f.name ? String(f.name).trim() : '';
    if (!nm || facToId[nm]) continue;
    const idx = Object.keys(facToId).length;
    const { rows: ins } = await db.query(
      'INSERT INTO nv_factions (project_id, name, kind, description, color, sort) VALUES (?,?,?,?,?,?)',
      [p.id, nm.slice(0, 100), String(f.kind || '宗门').slice(0, 20), String(f.description || ''), FACTION_COLORS[idx % FACTION_COLORS.length], idx]
    ).catch(() => ({ rows: [] }));
    if (ins?.[0]?.id) { facToId[nm] = ins[0].id; addedF++; }
  }
  // 角色↔角色
  for (const r of (data.char_relations || [])) {
    await _insertRelOnce(p.id, nameToId[r.from], 'char', nameToId[r.to], 'char', r.rel_type, r.affinity, r.description);
  }
  // 角色→组织（归属）
  for (const m of (data.memberships || [])) {
    await _insertRelOnce(p.id, nameToId[m.character], 'char', facToId[m.faction], 'faction', m.role || '隶属', m.affinity, '');
  }
  // 组织↔组织
  for (const r of (data.faction_relations || [])) {
    await _insertRelOnce(p.id, facToId[r.from], 'faction', facToId[r.to], 'faction', r.rel_type, r.affinity, r.description);
  }
  console.log(`[Novel] AI 识别：新增角色 ${addedC}、组织 ${addedF}`);
}

// worker 调用：统一处理设定卡/大纲/细纲的异步生成
async function processNovelGen(taskId) {
  const { rows } = await db.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
  const task = rows?.[0];
  if (!task || ['done', 'failed'].includes(task.status)) return;
  const input = typeof task.input_data === 'string' ? JSON.parse(task.input_data) : (task.input_data || {});
  try {
    await db.query("UPDATE tasks SET status = 'running', progress = 30, updated_at = NOW() WHERE id = ?", [taskId]).catch(() => {});
    const { rows: pRows } = await db.query('SELECT * FROM nv_projects WHERE id = ?', [input.projectId]);
    const p = pRows?.[0];
    if (!p) throw new Error('项目不存在');
    if (input.action === 'bootstrap') await _genBootstrap(p);
    else if (input.action === 'outline') await _genOutline(p);
    else if (input.action === 'toc') await _genToc(p, input.params || {});
    else if (input.action === 'extract_chars') await _genExtractChars(p);
    else if (input.action === 'revise_outline') await _reviseOutline(p, input.instruction || '');
    else if (input.action === 'revise_cards') await _reviseCards(p, input.instruction || '');
    else if (input.action === 'revise_chars') await _reviseChars(p, input.instruction || '');
    else throw new Error('未知生成类型: ' + input.action);
    await db.query("UPDATE tasks SET status = 'done', progress = 100, updated_at = NOW() WHERE id = ?", [taskId]).catch(() => {});
  } catch (e) {
    console.error('[processNovelGen]', input.action, e.message);
    await db.query('UPDATE tasks SET status = ?, error_msg = ?, updated_at = NOW() WHERE id = ?', ['failed', e.message, taskId]).catch(() => {});
  }
}

// 一句话设定 → AI 生成设定卡（异步任务）
router.post('/projects/:id/kb/bootstrap', requireAuth, async (req, res) => {
  try {
    const p = await getProject(parseInt(req.params.id), req.userId);
    if (!p) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const taskId = crypto.randomUUID();
    await db.query('INSERT INTO tasks (id, user_id, type, title, status, progress, input_data) VALUES (?,?,?,?,?,?,?)',
      [taskId, req.userId, 'novel_gen', `生成设定卡：${p.title}`.slice(0, 200), 'pending', 0, JSON.stringify({ projectId: p.id, action: 'bootstrap' })]);
    taskRunner.enqueue({ taskId, type: 'novel_gen' });
    res.json({ code: 200, data: { taskId } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

router.post('/projects/:id/kb', requireAuth, async (req, res) => {
  try {
    const p = await getProject(parseInt(req.params.id), req.userId);
    if (!p) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const { kind, title, content } = req.body;
    const { rows } = await db.query('INSERT INTO nv_kb_cards (project_id, kind, title, content) VALUES (?,?,?,?)',
      [p.id, String(kind || 'world').slice(0, 20), String(title || '未命名').slice(0, 200), String(content || '')]);
    res.json({ code: 200, msg: '已添加', data: { id: rows?.[0]?.id } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

router.put('/kb/:cardId', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id FROM nv_kb_cards c JOIN nv_projects p ON c.project_id = p.id WHERE c.id = ? AND p.user_id = ?`,
      [parseInt(req.params.cardId), req.userId]);
    if (!rows?.length) return res.status(404).json({ code: 404, msg: '设定卡不存在' });
    await db.query('UPDATE nv_kb_cards SET title = ?, content = ? WHERE id = ?',
      [String(req.body.title || '未命名').slice(0, 200), String(req.body.content || ''), parseInt(req.params.cardId)]);
    res.json({ code: 200, msg: '已保存' });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

router.delete('/kb/:cardId', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id FROM nv_kb_cards c JOIN nv_projects p ON c.project_id = p.id WHERE c.id = ? AND p.user_id = ?`,
      [parseInt(req.params.cardId), req.userId]);
    if (!rows?.length) return res.status(404).json({ code: 404, msg: '设定卡不存在' });
    await db.query('DELETE FROM nv_kb_cards WHERE id = ?', [parseInt(req.params.cardId)]);
    res.json({ code: 200, msg: '已删除' });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

/* ═══════════ 角色 & 关系（图谱） ═══════════ */

const CHAR_COLORS = ['#F5762A', '#E5534B', '#5B5FD9', '#16A34A', '#9333EA', '#0891B2', '#CA8A04', '#DB2777'];

async function ownProject(projectId, userId) {
  const { rows } = await db.query('SELECT id FROM nv_projects WHERE id = ? AND user_id = ?', [projectId, userId]);
  return rows?.length ? parseInt(projectId) : null;
}
// 校验角色/关系归属当前用户
async function ownByChar(charId, userId) {
  const { rows } = await db.query('SELECT c.id, c.project_id FROM nv_characters c JOIN nv_projects p ON c.project_id = p.id WHERE c.id = ? AND p.user_id = ?', [charId, userId]);
  return rows?.[0] || null;
}

// AI 识别角色（异步任务）：从已有设定/正文一键提取角色与关系
router.post('/projects/:id/characters/extract', requireAuth, async (req, res) => {
  try {
    const pid = await ownProject(parseInt(req.params.id), req.userId);
    if (!pid) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const taskId = crypto.randomUUID();
    await db.query('INSERT INTO tasks (id, user_id, type, title, status, progress, input_data) VALUES (?,?,?,?,?,?,?)',
      [taskId, req.userId, 'novel_gen', 'AI 识别角色', 'pending', 0, JSON.stringify({ projectId: pid, action: 'extract_chars' })]);
    taskRunner.enqueue({ taskId, type: 'novel_gen' });
    res.json({ code: 200, data: { taskId } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

// 新增角色
router.post('/projects/:id/characters', requireAuth, async (req, res) => {
  try {
    const pid = await ownProject(parseInt(req.params.id), req.userId);
    if (!pid) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const b = req.body || {};
    const { rows: cntRows } = await db.query('SELECT COUNT(*) AS c FROM nv_characters WHERE project_id = ?', [pid]);
    const idx = cntRows?.[0]?.c || 0;
    const { rows } = await db.query(
      'INSERT INTO nv_characters (project_id, name, role_type, identity, persona, goals, abilities, rel_to_lead, first_chapter, color, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [pid, String(b.name || '新角色').slice(0, 100), String(b.role_type || 'supporting').slice(0, 20),
       String(b.identity || '').slice(0, 255), String(b.persona || ''), String(b.goals || ''), String(b.abilities || ''),
       String(b.rel_to_lead || ''), parseInt(b.first_chapter) || 0, b.color || CHAR_COLORS[idx % CHAR_COLORS.length], idx]);
    res.json({ code: 200, data: { id: rows?.[0]?.id } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

// 更新角色
router.put('/characters/:cid', requireAuth, async (req, res) => {
  try {
    const own = await ownByChar(parseInt(req.params.cid), req.userId);
    if (!own) return res.status(404).json({ code: 404, msg: '角色不存在' });
    const b = req.body || {};
    const fields = []; const vals = [];
    for (const k of ['name', 'role_type', 'identity', 'persona', 'goals', 'abilities', 'rel_to_lead', 'color', 'status']) {
      if (b[k] !== undefined) { fields.push(`${k} = ?`); vals.push(String(b[k])); }
    }
    if (b.first_chapter !== undefined) { fields.push('first_chapter = ?'); vals.push(parseInt(b.first_chapter) || 0); }
    if (fields.length) { vals.push(parseInt(req.params.cid)); await db.query(`UPDATE nv_characters SET ${fields.join(', ')} WHERE id = ?`, vals); }
    res.json({ code: 200, msg: '已保存' });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

// 删除角色（连带删除其关系边）
router.delete('/characters/:cid', requireAuth, async (req, res) => {
  try {
    const own = await ownByChar(parseInt(req.params.cid), req.userId);
    if (!own) return res.status(404).json({ code: 404, msg: '角色不存在' });
    const cid = parseInt(req.params.cid);
    await db.query("DELETE FROM nv_relations WHERE (from_id = ? AND from_type='char') OR (to_id = ? AND to_type='char')", [cid, cid]);
    await db.query('DELETE FROM nv_characters WHERE id = ?', [cid]);
    res.json({ code: 200, msg: '已删除' });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

// 新增/更新关系
router.post('/projects/:id/relations', requireAuth, async (req, res) => {
  try {
    const pid = await ownProject(parseInt(req.params.id), req.userId);
    if (!pid) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const b = req.body || {};
    const fromId = parseInt(b.from_id), toId = parseInt(b.to_id);
    const fromType = b.from_type === 'faction' ? 'faction' : 'char';
    const toType = b.to_type === 'faction' ? 'faction' : 'char';
    if (!fromId || !toId || (fromId === toId && fromType === toType)) return res.status(400).json({ code: 400, msg: '请选择两个不同的节点' });
    const { rows } = await db.query(
      'INSERT INTO nv_relations (project_id, from_id, to_id, from_type, to_type, rel_type, affinity, description, updated_chapter) VALUES (?,?,?,?,?,?,?,?,?)',
      [pid, fromId, toId, fromType, toType, String(b.rel_type || '关系').slice(0, 40), Math.max(0, Math.min(100, parseInt(b.affinity) || 50)), String(b.description || ''), 0]);
    res.json({ code: 200, data: { id: rows?.[0]?.id } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

router.put('/relations/:rid', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT r.id FROM nv_relations r JOIN nv_projects p ON r.project_id = p.id WHERE r.id = ? AND p.user_id = ?', [parseInt(req.params.rid), req.userId]);
    if (!rows?.length) return res.status(404).json({ code: 404, msg: '关系不存在' });
    const b = req.body || {};
    const fields = []; const vals = [];
    if (b.rel_type !== undefined) { fields.push('rel_type = ?'); vals.push(String(b.rel_type).slice(0, 40)); }
    if (b.affinity !== undefined) { fields.push('affinity = ?'); vals.push(Math.max(0, Math.min(100, parseInt(b.affinity) || 50))); }
    if (b.description !== undefined) { fields.push('description = ?'); vals.push(String(b.description)); }
    if (fields.length) { vals.push(parseInt(req.params.rid)); await db.query(`UPDATE nv_relations SET ${fields.join(', ')} WHERE id = ?`, vals); }
    res.json({ code: 200, msg: '已保存' });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

router.delete('/relations/:rid', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT r.id FROM nv_relations r JOIN nv_projects p ON r.project_id = p.id WHERE r.id = ? AND p.user_id = ?', [parseInt(req.params.rid), req.userId]);
    if (!rows?.length) return res.status(404).json({ code: 404, msg: '关系不存在' });
    await db.query('DELETE FROM nv_relations WHERE id = ?', [parseInt(req.params.rid)]);
    res.json({ code: 200, msg: '已删除' });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

/* ── 组织（宗门/家族/势力）CRUD ── */
const FACTION_COLORS = ['#6E6860', '#8B5CF6', '#0D9488', '#B45309', '#BE123C', '#1D4ED8'];

router.post('/projects/:id/factions', requireAuth, async (req, res) => {
  try {
    const pid = await ownProject(parseInt(req.params.id), req.userId);
    if (!pid) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const b = req.body || {};
    const { rows: cntRows } = await db.query('SELECT COUNT(*) AS c FROM nv_factions WHERE project_id = ?', [pid]);
    const idx = cntRows?.[0]?.c || 0;
    const { rows } = await db.query(
      'INSERT INTO nv_factions (project_id, name, kind, description, color, sort) VALUES (?,?,?,?,?,?)',
      [pid, String(b.name || '新组织').slice(0, 100), String(b.kind || '宗门').slice(0, 20), String(b.description || ''), b.color || FACTION_COLORS[idx % FACTION_COLORS.length], idx]);
    res.json({ code: 200, data: { id: rows?.[0]?.id } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

router.put('/factions/:fid', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT f.id FROM nv_factions f JOIN nv_projects p ON f.project_id = p.id WHERE f.id = ? AND p.user_id = ?', [parseInt(req.params.fid), req.userId]);
    if (!rows?.length) return res.status(404).json({ code: 404, msg: '组织不存在' });
    const b = req.body || {};
    const fields = []; const vals = [];
    for (const k of ['name', 'kind', 'description', 'color']) {
      if (b[k] !== undefined) { fields.push(`${k} = ?`); vals.push(String(b[k])); }
    }
    if (fields.length) { vals.push(parseInt(req.params.fid)); await db.query(`UPDATE nv_factions SET ${fields.join(', ')} WHERE id = ?`, vals); }
    res.json({ code: 200, msg: '已保存' });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

router.delete('/factions/:fid', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT f.id FROM nv_factions f JOIN nv_projects p ON f.project_id = p.id WHERE f.id = ? AND p.user_id = ?', [parseInt(req.params.fid), req.userId]);
    if (!rows?.length) return res.status(404).json({ code: 404, msg: '组织不存在' });
    const fid = parseInt(req.params.fid);
    await db.query("DELETE FROM nv_relations WHERE (from_id = ? AND from_type='faction') OR (to_id = ? AND to_type='faction')", [fid, fid]);
    await db.query('DELETE FROM nv_factions WHERE id = ?', [fid]);
    res.json({ code: 200, msg: '已删除' });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

/* ═══════════ 大纲 / 细纲 ═══════════ */

// 全书大纲（卷级）— 异步任务
router.post('/projects/:id/outline', requireAuth, async (req, res) => {
  try {
    const p = await getProject(parseInt(req.params.id), req.userId);
    if (!p) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const taskId = crypto.randomUUID();
    await db.query('INSERT INTO tasks (id, user_id, type, title, status, progress, input_data) VALUES (?,?,?,?,?,?,?)',
      [taskId, req.userId, 'novel_gen', `生成大纲：${p.title}`.slice(0, 200), 'pending', 0, JSON.stringify({ projectId: p.id, action: 'outline' })]);
    taskRunner.enqueue({ taskId, type: 'novel_gen' });
    res.json({ code: 200, data: { taskId } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

// 对话式修改（统一入口）：target = outline / cards / characters
router.post('/projects/:id/revise', requireAuth, async (req, res) => {
  try {
    const p = await getProject(parseInt(req.params.id), req.userId);
    if (!p) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const instruction = String(req.body.instruction || '').trim();
    if (!instruction) return res.status(400).json({ code: 400, msg: '请说明怎么调整' });
    const map = { outline: 'revise_outline', cards: 'revise_cards', characters: 'revise_chars' };
    const action = map[req.body.target];
    if (!action) return res.status(400).json({ code: 400, msg: '未知调整对象' });
    if (action === 'revise_outline' && !(p.outline || '').trim()) return res.status(400).json({ code: 400, msg: '还没有大纲，先生成或写一版' });
    const labelMap = { outline: '大纲', cards: '设定集', characters: '人物' };
    const taskId = crypto.randomUUID();
    await db.query('INSERT INTO tasks (id, user_id, type, title, status, progress, input_data) VALUES (?,?,?,?,?,?,?)',
      [taskId, req.userId, 'novel_gen', `调整${labelMap[req.body.target]}：${p.title}`.slice(0, 200), 'pending', 0, JSON.stringify({ projectId: p.id, action, instruction })]);
    taskRunner.enqueue({ taskId, type: 'novel_gen' });
    res.json({ code: 200, data: { taskId } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

// 批量章节细纲（每批 ≤20 章）— 异步任务
router.post('/projects/:id/toc', requireAuth, async (req, res) => {
  try {
    const p = await getProject(parseInt(req.params.id), req.userId);
    if (!p) return res.status(404).json({ code: 404, msg: '项目不存在' });
    if (!(p.outline || '').trim()) return res.status(400).json({ code: 400, msg: '请先生成全书大纲' });
    const taskId = crypto.randomUUID();
    await db.query('INSERT INTO tasks (id, user_id, type, title, status, progress, input_data) VALUES (?,?,?,?,?,?,?)',
      [taskId, req.userId, 'novel_gen', `规划细纲：${p.title}`.slice(0, 200), 'pending', 0,
       JSON.stringify({ projectId: p.id, action: 'toc', params: { volume: req.body.volume, count: req.body.count } })]);
    taskRunner.enqueue({ taskId, type: 'novel_gen' });
    res.json({ code: 200, data: { taskId } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

/* ═══════════ 章节 ═══════════ */

async function getChapter(chapterId, userId) {
  const { rows } = await db.query(
    `SELECT c.*, p.user_id FROM nv_chapters c JOIN nv_projects p ON c.project_id = p.id WHERE c.id = ? AND p.user_id = ?`,
    [chapterId, userId]);
  return rows?.[0] || null;
}

router.get('/chapters/:id', requireAuth, async (req, res) => {
  try {
    const ch = await getChapter(parseInt(req.params.id), req.userId);
    if (!ch) return res.status(404).json({ code: 404, msg: '章节不存在' });
    const { rows: msgs } = await db.query('SELECT * FROM nv_messages WHERE chapter_id = ? ORDER BY id', [ch.id]);
    res.json({ code: 200, data: { chapter: ch, messages: msgs || [] } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

// 手动保存正文 / 改细纲 / 定稿
router.patch('/chapters/:id', requireAuth, async (req, res) => {
  try {
    const ch = await getChapter(parseInt(req.params.id), req.userId);
    if (!ch) return res.status(404).json({ code: 404, msg: '章节不存在' });
    if (typeof req.body.content === 'string') {
      const wc = req.body.content.replace(/\s/g, '').length;
      await db.query('UPDATE nv_chapters SET content = ?, word_count = ? WHERE id = ?', [req.body.content, wc, ch.id]);
    }
    if (typeof req.body.outline === 'string') {
      await db.query('UPDATE nv_chapters SET outline = ? WHERE id = ?', [req.body.outline, ch.id]);
    }
    if (typeof req.body.title === 'string') {
      await db.query('UPDATE nv_chapters SET title = ? WHERE id = ?', [String(req.body.title).slice(0, 200), ch.id]);
    }
    if (req.body.status === 'final') {
      await db.query("UPDATE nv_chapters SET status = 'final' WHERE id = ?", [ch.id]);
      // 章节提交（异步，不阻塞）：滚动摘要 + 角色状态更新（MVP 简版，P1 升级为设定补丁待确认）
      commitChapter(ch.id, req.userId).catch(e => console.warn('[novel commit]', e.message));
    }
    res.json({ code: 200, msg: '已保存' });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

router.delete('/chapters/:id', requireAuth, async (req, res) => {
  try {
    const ch = await getChapter(parseInt(req.params.id), req.userId);
    if (!ch) return res.status(404).json({ code: 404, msg: '章节不存在' });
    await db.query('DELETE FROM nv_chapters WHERE id = ?', [ch.id]);
    await db.query('DELETE FROM nv_messages WHERE chapter_id = ?', [ch.id]);
    res.json({ code: 200, msg: '已删除' });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

// 章节提交（MVP 简版）：定稿后 AI 提取事实 → 直接更新 state（P1 改为补丁进待确认）
async function commitChapter(chapterId, userId) {
  const { rows } = await db.query('SELECT c.*, p.id AS pid, p.state FROM nv_chapters c JOIN nv_projects p ON c.project_id = p.id WHERE c.id = ?', [chapterId]);
  const ch = rows?.[0];
  if (!ch || !(ch.content || '').trim()) return;
  let state = {};
  try { state = typeof ch.state === 'string' ? JSON.parse(ch.state) : (ch.state || {}); } catch {}
  // 本项目角色名册（供 AI 归因，并按名字回写状态/关系）
  const { rows: chars } = await db.query('SELECT id, name FROM nv_characters WHERE project_id = ?', [ch.pid]);
  const nameToId = {}; (chars || []).forEach(c => { nameToId[c.name] = c.id; });
  const roster = (chars || []).map(c => c.name).join('、') || '（暂无登记角色）';
  const prompt = `你是小说设定管理员。阅读本章正文，提取设定更新。只输出 JSON。
【本章】第${ch.seq}章 ${ch.title}
【正文】${ch.content.slice(0, 5000)}
【现有前情提要】${state.summary || '（无）'}
【已登记角色】${roster}

输出格式（严格 JSON）：
{
  "summary": "更新后的全书前情提要，250字内，覆盖到本章为止的主线进展",
  "new_characters": [{ "name": "新角色名", "role_type": "supporting/love/antagonist 之一", "identity": "身份一句话", "persona": "性格底色/行为逻辑（正文够则写，不够则简短）" }],
  "character_updates": [{ "name": "已登记角色名", "status": "一句话当前状态：能力/处境的最新情况" }],
  "relation_updates": [{ "from": "角色A", "to": "角色B", "rel_type": "盟友/仇敌/师徒/爱慕/…", "affinity": 0到100的整数, "note": "本章这段关系发生了什么变化" }]
}
规则：
- new_characters：只登记【本章首次出场】且【有名字、对剧情有实际作用】的角色。一次性提到的路人、群众、龙套、无名氏一律不要登记。已在【已登记角色】里的，不要再放进 new_characters。
- relation_updates 的 from/to 可以用 new_characters 里刚出现的新角色名。
- 都只写本章真正发生的，没有就给空数组。`;
  try {
    const raw = await callAI(prompt, { temperature: 0.2, maxTokens: 1200 });
    const jm = raw.match(/\{[\s\S]*\}/);
    if (!jm) return;
    const patch = JSON.parse(jm[0]);
    // 1) 前情提要 → state
    if (patch.summary) { state.summary = String(patch.summary).slice(0, 800); await db.query('UPDATE nv_projects SET state = ? WHERE id = ?', [JSON.stringify(state), ch.pid]); }
    // 1.5) 新角色自动登记 → nv_characters（加入 nameToId，供后续关系建立）
    let added = 0;
    for (const nc of (patch.new_characters || [])) {
      const nm = nc && nc.name ? String(nc.name).trim() : '';
      if (!nm || nameToId[nm]) continue; // 无名或已存在跳过
      const idx = Object.keys(nameToId).length + added;
      const rt = ['supporting', 'love', 'antagonist', 'lead'].includes(nc.role_type) ? nc.role_type : 'supporting';
      const { rows: ins } = await db.query(
        'INSERT INTO nv_characters (project_id, name, role_type, identity, persona, first_chapter, color, sort) VALUES (?,?,?,?,?,?,?,?)',
        [ch.pid, nm.slice(0, 100), rt, String(nc.identity || '').slice(0, 255), String(nc.persona || ''), ch.seq, CHAR_COLORS[idx % CHAR_COLORS.length], idx]
      ).catch(() => ({ rows: [] }));
      if (ins?.[0]?.id) { nameToId[nm] = ins[0].id; added++; }
    }
    if (added) console.log(`[Novel] 第${ch.seq}章自动登记 ${added} 个新角色`);
    // 2) 角色状态 → nv_characters.status（按名字匹配已登记角色）
    for (const u of (patch.character_updates || [])) {
      if (u && u.name && nameToId[u.name]) {
        await db.query('UPDATE nv_characters SET status = ? WHERE id = ?', [String(u.status || '').slice(0, 300), nameToId[u.name]]).catch(() => {});
      }
    }
    // 3) 关系变化 → nv_relations（两端都是已登记角色才回写；有则更新，无则新建）
    for (const r of (patch.relation_updates || [])) {
      const fromId = r && nameToId[r.from], toId = r && nameToId[r.to];
      if (!fromId || !toId || fromId === toId) continue;
      const aff = Math.max(0, Math.min(100, parseInt(r.affinity) || 50));
      const desc = String(r.note || '').slice(0, 500);
      const { rows: ex } = await db.query('SELECT id FROM nv_relations WHERE project_id = ? AND from_id = ? AND to_id = ?', [ch.pid, fromId, toId]);
      if (ex?.length) {
        await db.query('UPDATE nv_relations SET rel_type = ?, affinity = ?, description = ?, updated_chapter = ? WHERE id = ?',
          [String(r.rel_type || '关系').slice(0, 40), aff, desc, ch.seq, ex[0].id]).catch(() => {});
      } else {
        await db.query('INSERT INTO nv_relations (project_id, from_id, to_id, rel_type, affinity, description, updated_chapter) VALUES (?,?,?,?,?,?,?)',
          [ch.pid, fromId, toId, String(r.rel_type || '关系').slice(0, 40), aff, desc, ch.seq]).catch(() => {});
      }
    }
    console.log(`[Novel] 第${ch.seq}章已提交，角色/关系已回写`);
  } catch (e) { console.warn('[commitChapter]', e.message); }
}

/* ═══════════ 写章流水线（异步任务） ═══════════ */

router.post('/chapters/:id/generate', requireAuth, async (req, res) => {
  try {
    const ch = await getChapter(parseInt(req.params.id), req.userId);
    if (!ch) return res.status(404).json({ code: 404, msg: '章节不存在' });
    if (!(ch.outline || '').trim()) return res.status(400).json({ code: 400, msg: '本章还没有细纲，先在目录里补一份' });
    const taskId = crypto.randomUUID();
    await db.query(
      'INSERT INTO tasks (id, user_id, type, title, status, progress, input_data) VALUES (?,?,?,?,?,?,?)',
      [taskId, req.userId, 'novel_chapter', `写作：第${ch.seq}章 ${ch.title}`.slice(0, 200), 'pending', 0,
       JSON.stringify({ chapterId: ch.id })]
    );
    taskRunner.enqueue({ taskId, type: 'novel_chapter' });
    res.json({ code: 200, data: { taskId } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

// worker 调用：写章流水线主体
async function processNovelChapter(taskId) {
  const { rows: taskRows } = await db.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
  const task = taskRows?.[0];
  if (!task || ['done', 'failed'].includes(task.status)) return;
  const input = typeof task.input_data === 'string' ? JSON.parse(task.input_data) : (task.input_data || {});
  const chapterId = input.chapterId;
  const upd = (status, progress, extra = {}) =>
    db.query('UPDATE tasks SET status = ?, progress = ?, result = ?, updated_at = NOW() WHERE id = ?',
      [status, progress, JSON.stringify(extra), taskId]).catch(() => {});

  try {
    await upd('running', 10);
    const { rows } = await db.query(
      'SELECT c.*, p.id AS pid, p.user_id, p.title AS book_title, p.genre, p.persona, p.chapter_words, p.outline AS book_outline, p.state FROM nv_chapters c JOIN nv_projects p ON c.project_id = p.id WHERE c.id = ?',
      [chapterId]);
    const ch = rows?.[0];
    if (!ch) throw new Error('章节不存在');
    const project = { id: ch.pid, state: (() => { try { return typeof ch.state === 'string' ? JSON.parse(ch.state) : (ch.state || {}); } catch { return {}; } })() };

    // ① 最简记忆包（规则筛选，零调用）
    const memoryPack = await buildMemoryPack(project, ch);
    await upd('running', 25);

    // ② 起草
    const targetWords = ch.chapter_words || 2500;
    const upper = Math.round(targetWords * 1.2);
    const writePrompt = `你是签约多年的网文大神，正在写《${ch.book_title}》（${ch.genre || '网文'}）。
${ch.persona ? `【叙事视角/作家人设】${ch.persona}` : ''}
${memoryPack}

【全书大纲（节选）】
${(ch.book_outline || '').slice(0, 1500)}

【本章绝对蓝图（只写这一章的内容，写完即止；严禁把后面章节的剧情提前写进来）】
第${ch.seq}章 ${ch.title}
${ch.outline}

${NOVEL_EDICTS}

【字数与节奏（重要）】
- 目标 ${targetWords} 字，最多不超过 ${upper} 字。宁可短、不要注水拖长。
- 只完成本章蓝图这一个情节/场景，不要为了凑字数硬塞额外剧情或重复描写。
- 写到本章该停的钩子处就收尾——后面的事留给下一章。

【任务】写出本章完整正文，约 ${targetWords} 字。直接输出正文，不要任何解释、标题或元信息。`;
    let content = (await callAI(writePrompt, { temperature: 0.75, maxTokens: Math.min(upper * 3, 7000), bypassCap: true, model: (await getConfigVal('ai_model_novel')) || undefined })).trim();
    await upd('running', 60);

    // ③ critic 审查（字数过短/过长/AI腔）→ 不过自动重写一轮
    const wc = content.replace(/\s/g, '').length;
    const slopHits = AI_SLOP_WORDS.filter(w => content.includes(w));
    let needRewrite = false; const issues = [];
    if (wc < targetWords * 0.65) { needRewrite = true; issues.push(`字数不足：${wc}/${targetWords}，扩写到目标字数（充实细节，不要换剧情）`); }
    else if (wc > targetWords * 1.35) { needRewrite = true; issues.push(`字数超标：${wc}，压缩到 ${targetWords} 字左右——删冗余描写和重复，保留剧情主线，只写本章这一段，不要含后续情节`); }
    if (slopHits.length >= 4) { needRewrite = true; issues.push(`AI腔过重，删除这些表达并换成具体动作描写：${slopHits.join('、')}`); }
    if (needRewrite) {
      await upd('running', 70);
      const rewriteRaw = await callAI(writePrompt + `\n\n【上一版存在以下问题，必须全部修正后重新输出完整正文】\n${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
        { temperature: 0.75, maxTokens: Math.min(targetWords * 3, 8000), bypassCap: true });
      if (rewriteRaw.trim().length > content.length * 0.6) content = rewriteRaw.trim();
    }

    // ④ 去AI味终检（程序化：剩余高频 AI 腔词直接剔除连接性废词）
    for (const w of ['不得不说，', '值得一提的是，', '总而言之，', '综上所述，']) content = content.split(w).join('');

    // 落库
    const finalWc = content.replace(/\s/g, '').length;
    await db.query("UPDATE nv_chapters SET prev_content = content, content = ?, word_count = ?, status = 'drafted' WHERE id = ?",
      [content, finalWc, chapterId]);
    await db.query("INSERT INTO nv_messages (chapter_id, role, content, has_doc_update) VALUES (?,?,?,1)",
      [chapterId, 'ai', `已生成本章正文，约 ${finalWc} 字${needRewrite ? '（已按质检意见自动修正一轮）' : ''}。可以在右侧直接改，或在这里告诉我怎么调整。`]);
    await upd('done', 100, { chapterId, wordCount: finalWc });
  } catch (e) {
    console.error('[processNovelChapter]', e.message);
    await db.query('UPDATE tasks SET status = ?, error_msg = ?, updated_at = NOW() WHERE id = ?', ['failed', e.message, taskId]).catch(() => {});
  }
}

/* ═══════════ 对话修改 ═══════════ */

router.post('/chapters/:id/chat', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || !String(message).trim()) return res.status(400).json({ code: 400, msg: '请输入内容' });
  try {
    const ch = await getChapter(parseInt(req.params.id), req.userId);
    if (!ch) return res.status(404).json({ code: 404, msg: '章节不存在' });
    await db.query('INSERT INTO nv_messages (chapter_id, role, content) VALUES (?,?,?)', [ch.id, 'user', String(message).slice(0, 2000)]);

    const { rows: pRows } = await db.query('SELECT * FROM nv_projects WHERE id = ?', [ch.project_id]);
    const p = pRows?.[0] || {};
    let pState = {}; try { pState = typeof p.state === 'string' ? JSON.parse(p.state) : (p.state || {}); } catch {}
    // 注入角色/关系记忆包（含当前正文+用户消息里指名的角色，保证改稿时 AI 知道烙印与关系）
    const memoryPack = await buildMemoryPack({ id: ch.project_id, state: pState }, ch, (ch.content || '') + ' ' + message);
    const hasContent = (ch.content || '').trim().length > 50;
    const prompt = `你是网文写作搭档，正在和作者讨论《${p.title}》第${ch.seq}章「${ch.title}」。
【本章细纲】${ch.outline || '（无）'}
${memoryPack ? '\n' + memoryPack + '\n' : ''}
${hasContent ? `【当前正文】\n${ch.content.slice(0, 6000)}` : '【当前还没有正文】'}

${NOVEL_EDICTS}

【作者的要求】${message}

规则：
- 如果作者要求修改正文 → 输出修改后的【完整正文】，用标签包裹：【新正文】…【/新正文】，标签前用一句话（≤30字）说明你改了什么
- 如果作者只是讨论剧情/要建议 → 直接回答，不要输出正文标签
- 修改时保持未被点名部分原样不动`;
    const raw = await callAI(prompt, { temperature: 0.7, maxTokens: 8000, bypassCap: true });
    const m = raw.match(/【新正文】([\s\S]*?)【\/新正文】/);
    let aiSummary = raw, newContent = null;
    if (m) {
      newContent = m[1].trim();
      aiSummary = raw.split('【新正文】')[0].trim() || '已按要求修改本章正文。';
      const wc = newContent.replace(/\s/g, '').length;
      await db.query("UPDATE nv_chapters SET prev_content = content, content = ?, word_count = ? WHERE id = ?", [newContent, wc, ch.id]);
    }
    const { rows: ins } = await db.query('INSERT INTO nv_messages (chapter_id, role, content, has_doc_update) VALUES (?,?,?,?)',
      [ch.id, 'ai', aiSummary.slice(0, 5000), newContent ? 1 : 0]);
    res.json({ code: 200, data: { message: { id: ins?.[0]?.id, role: 'ai', content: aiSummary, has_doc_update: newContent ? 1 : 0 }, content: newContent } });
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

/* ═══════════ 导出 ═══════════ */

router.get('/projects/:id/export', requireAuth, async (req, res) => {
  try {
    const p = await getProject(parseInt(req.params.id), req.userId);
    if (!p) return res.status(404).json({ code: 404, msg: '项目不存在' });
    const { rows: chapters } = await db.query(
      "SELECT seq, title, content FROM nv_chapters WHERE project_id = ? AND content IS NOT NULL AND content != '' ORDER BY volume, seq", [p.id]);
    const text = `《${p.title}》\n\n` + (chapters || []).map(c => `第${c.seq}章 ${c.title}\n\n${c.content}`).join('\n\n\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(p.title)}.txt`);
    res.send(text);
  } catch (err) { res.status(500).json({ code: 500, msg: err.message }); }
});

module.exports = { router, processNovelChapter, processNovelGen };
