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
async function buildMemoryPack(project, chapter) {
  const cards = await getCards(project.id);
  const cardBlock = cards.map(c => {
    const kindLabel = { world: '世界观', character: '角色', faction: '势力', style: '文风' }[c.kind] || c.kind;
    return `【${kindLabel}·${c.title}】\n${(c.content || '').slice(0, 1200)}`;
  }).join('\n\n');

  const state = project.state || {};
  const stateBlock = state.summary ? `【前情提要】\n${state.summary}` : '';
  const charStates = state.characters && Object.keys(state.characters).length
    ? '【角色当前状态】\n' + Object.entries(state.characters).map(([n, v]) => `${n}：${v.status || v}`).join('\n')
    : '';

  // 上一章结尾（衔接）
  let prevTail = '';
  const { rows: prevRows } = await db.query(
    'SELECT content, title, seq FROM nv_chapters WHERE project_id = ? AND status != ? AND ((volume = ? AND seq < ?) OR volume < ?) ORDER BY volume DESC, seq DESC LIMIT 1',
    [project.id, 'todo', chapter.volume, chapter.seq, chapter.volume]
  );
  if (prevRows?.[0]?.content) {
    prevTail = `【上一章（第${prevRows[0].seq}章 ${prevRows[0].title}）结尾，必须自然衔接】\n……${prevRows[0].content.slice(-800)}`;
  }

  return [cardBlock, stateBlock, charStates, prevTail].filter(Boolean).join('\n\n');
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
       parseInt(targetWords) || 200000, parseInt(chapterWords) || 3000, JSON.stringify({})]
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
    res.json({ code: 200, data: { project: p, cards, chapters: chapters || [] } });
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
    if (req.body.chapterWords !== undefined) { fields.push('chapter_words = ?'); vals.push(parseInt(req.body.chapterWords) || 3000); }
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
  const prompt = `你是资深网文主编。根据下面的小说设定，生成三张设定卡初稿。只输出 JSON。
【书名】${p.title}
【题材】${p.genre || '未指定'}
【一句话设定】${p.brief || '（未填写，请按书名和题材合理虚构）'}

输出格式（严格 JSON，不要其他文字）：
{
  "world": { "title": "世界观名", "content": "力量/规则体系、社会结构、地理舞台、本书核心矛盾的世界根源。300-500字，分行写要点" },
  "protagonist": { "title": "主角名", "content": "身份与处境、性格底色（含缺陷）、核心欲望与恐惧、说话方式特征、开篇时的能力边界。250-400字" },
  "antagonist": { "title": "反派/对手名", "content": "与主角的核心冲突、行事逻辑（要让人理解他为什么这么做）、优势与软肋。200-300字" }
}`;
  const raw = await callAI(prompt, { temperature: 0.7, maxTokens: 2000, bypassCap: true });
  const jm = raw.match(/\{[\s\S]*\}/);
  if (!jm) throw new Error('AI 输出解析失败');
  const data = JSON.parse(jm[0]);
  const inserts = [['world', data.world], ['character', data.protagonist], ['character', data.antagonist]];
  for (let i = 0; i < inserts.length; i++) {
    const [kind, card] = inserts[i];
    if (card && card.content) {
      await db.query('INSERT INTO nv_kb_cards (project_id, kind, title, content, sort) VALUES (?,?,?,?,?)',
        [p.id, kind, (card.title || '未命名').slice(0, 200), card.content, i]);
    }
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

async function _genToc(p, params) {
  const volume = parseInt(params.volume) || 1;
  const count = Math.min(parseInt(params.count) || 10, 20);
  const { rows: existRows } = await db.query('SELECT MAX(seq) AS maxSeq FROM nv_chapters WHERE project_id = ?', [p.id]);
  const startSeq = (existRows?.[0]?.maxSeq || 0) + 1;
  const { rows: recentRows } = await db.query(
    'SELECT seq, title, outline FROM nv_chapters WHERE project_id = ? ORDER BY seq DESC LIMIT 5', [p.id]);
  const recentBlock = (recentRows || []).reverse().map(r => `第${r.seq}章 ${r.title}：${r.outline}`).join('\n');
  const prompt = `你是资深网文主编。基于全书大纲，为第 ${volume} 卷规划第 ${startSeq} 到 ${startSeq + count - 1} 章的细纲。只输出 JSON 数组。
【全书大纲】
${(p.outline || '').slice(0, 3000)}
${recentBlock ? `【已有章节（必须延续，不要重复剧情）】\n${recentBlock}` : '【这是全书开头，第一章必须快速进入核心冲突】'}

每章要求：
- outline 包含：本章发生什么（2-4句，具体到场景和动作）+ 章末钩子是什么
- 节奏：每 3-4 章一个小高潮，本批最后一章留较大悬念
- hook 字段单独写出章末钩子（一句话）

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
  const prompt = `你是小说设定管理员。阅读本章正文，更新两样东西。只输出 JSON。
【本章】第${ch.seq}章 ${ch.title}
【正文】${ch.content.slice(0, 5000)}
【现有前情提要】${state.summary || '（无）'}
【现有角色状态】${JSON.stringify(state.characters || {})}

输出格式（严格 JSON）：
{
  "summary": "更新后的全书前情提要，250字内，覆盖到本章为止的主线进展",
  "characters": { "角色名": "一句话当前状态（能力/处境/关系的最新情况）" }
}
characters 只写本章有变化的角色。`;
  try {
    const raw = await callAI(prompt, { temperature: 0.2, maxTokens: 800 });
    const jm = raw.match(/\{[\s\S]*\}/);
    if (!jm) return;
    const patch = JSON.parse(jm[0]);
    if (patch.summary) state.summary = String(patch.summary).slice(0, 800);
    state.characters = state.characters || {};
    for (const [name, status] of Object.entries(patch.characters || {})) {
      state.characters[name] = { status: String(status).slice(0, 200), updatedCh: ch.seq };
    }
    await db.query('UPDATE nv_projects SET state = ? WHERE id = ?', [JSON.stringify(state), ch.pid]);
    console.log(`[Novel] 第${ch.seq}章已提交，state 已更新`);
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
    const targetWords = ch.chapter_words || 3000;
    const writePrompt = `你是签约多年的网文大神，正在写《${ch.book_title}》（${ch.genre || '网文'}）。
${ch.persona ? `【叙事视角/作家人设】${ch.persona}` : ''}
${memoryPack}

【全书大纲（节选）】
${(ch.book_outline || '').slice(0, 1500)}

【本章绝对蓝图（必须严格执行，不许偏移、不许提前写后面的剧情）】
第${ch.seq}章 ${ch.title}
${ch.outline}

${NOVEL_EDICTS}

【任务】写出本章完整正文，目标 ${targetWords} 字（允许 ±20%）。直接输出正文，不要任何解释、标题或元信息。`;
    let content = (await callAI(writePrompt, { temperature: 0.75, maxTokens: Math.min(targetWords * 3, 8000), bypassCap: true, model: (await getConfigVal('ai_model_novel')) || undefined })).trim();
    await upd('running', 60);

    // ③ critic 审查（blocking：字数偏离>35% / 蓝图偏移 / AI腔严重）→ 不过自动重写一轮
    const wc = content.replace(/\s/g, '').length;
    const slopHits = AI_SLOP_WORDS.filter(w => content.includes(w));
    let needRewrite = false; const issues = [];
    if (wc < targetWords * 0.65) { needRewrite = true; issues.push(`字数严重不足：${wc}/${targetWords}，需要扩写到目标字数`); }
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
    const hasContent = (ch.content || '').trim().length > 50;
    const prompt = `你是网文写作搭档，正在和作者讨论《${p.title}》第${ch.seq}章「${ch.title}」。
【本章细纲】${ch.outline || '（无）'}
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
