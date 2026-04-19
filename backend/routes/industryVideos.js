/**
 * 行业热门视频采集 & 管理
 * 每日定时抓取高赞视频 → ASR 提取文案 → 存库
 * 管理后台可查看/删除/配置
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const { requireAuth, requireAdmin } = require('./auth');

// 硬编码兜底关键词（若行业表中没有配置 collect_keywords 时使用）
const DEFAULT_KEYWORDS = {
  '二手车': ['二手车选车', '买二手车', '二手车推荐'],
  '餐饮':   ['餐饮开店', '餐厅经营', '美食探店'],
};

const KEEP_LATEST = 15;
const MIN_CHARS   = 15;

// ==================== 实时进度追踪 ====================
const collectState = {
  running:      false,
  paused:       false,
  stop:         false,
  startedAt:    null,
  finishedAt:   null,
  industry:     '',
  keyword:      '',
  keywordIdx:   0,
  keywordTotal: 0,
  saved:        0,
  skipped:      0,
  current:      '',
  log:          [],
  items:        [],   // 最近30条入库记录（实时 feed）
  error:        null,
};

function csLog(msg) {
  console.log('[IndustryVideos]', msg);
  collectState.log.push(msg);
  if (collectState.log.length > 15) collectState.log.shift();
}

// ==================== 定时采集 ====================
setInterval(async () => {
  try {
    const { rows } = await db.query(`SELECT value FROM system_config WHERE config_key='collect_schedule'`);
    const schedule = (rows[0]?.value || '').trim();
    if (!schedule || collectState.running) return;
    const parts = schedule.split(':');
    const sh = parseInt(parts[0]), sm = parseInt(parts[1] || '0');
    const now = new Date();
    if (now.getHours() !== sh || now.getMinutes() !== sm) return;
    const { rows: lRows } = await db.query(`SELECT value FROM system_config WHERE config_key='collect_last_auto'`);
    const today = now.toISOString().slice(0, 10);
    if ((lRows[0]?.value || '') === today) return;
    await db.query(`INSERT INTO system_config (config_key, value) VALUES ('collect_pending','1') ON DUPLICATE KEY UPDATE value='1'`);
    await db.query(`INSERT INTO system_config (config_key, value) VALUES ('collect_last_auto',?) ON DUPLICATE KEY UPDATE value=?`, [today, today]);
    Object.assign(collectState, {
      running: true, paused: false, stop: false,
      startedAt: now.toISOString(), finishedAt: null, error: null,
      industry: '定时任务等待本地服务...', keyword: '', keywordIdx: 0, keywordTotal: 0,
      saved: 0, skipped: 0, current: '', log: [`定时采集触发 ${schedule}`], items: [],
    });
    console.log(`[IndustryVideos] 定时采集触发 ${schedule}`);
  } catch (_) {}
}, 60000);

// ==================== 对外查询接口（用户端）====================

// GET /api/industry-videos?industry=二手车&limit=15
router.get('/', requireAuth, async (req, res) => {
  const { industry, limit = 15 } = req.query;
  if (!industry) return res.status(400).json({ code: 400, msg: '请传入 industry 参数' });
  const { rows } = await db.query(
    `SELECT id, industry, author, cover_url, likes, transcript, collected_at
     FROM industry_videos
     WHERE industry = ? AND status = 'ok' AND transcript IS NOT NULL
     ORDER BY likes DESC LIMIT ?`,
    [industry, parseInt(limit)]
  );
  res.json({ code: 200, data: rows });
});

// GET /api/industry-videos/industries — 返回已有数据的行业列表
router.get('/industries', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT industry, COUNT(*) AS cnt, MAX(collected_at) AS last_collected
     FROM industry_videos WHERE status = 'ok'
     GROUP BY industry ORDER BY industry`
  );
  res.json({ code: 200, data: rows });
});

// POST /api/industry-videos/start-clone/:id — 从精选视频创建克隆任务
router.post('/start-clone/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM industry_videos WHERE id = ? AND status = 'ok'`, [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ code: 404, msg: '视频不存在' });
    const v = rows[0];
    const taskId = crypto.randomUUID();
    const title = `精选·${v.industry}·${(v.transcript || '').slice(0, 15)}`;
    const result = JSON.stringify({
      transcript: v.transcript,
      source: 'featured',
      industry: v.industry,
    });
    await db.query(
      `INSERT INTO tasks (id, user_id, type, title, status, result) VALUES (?, ?, 'clone_video', ?, 'extracted', ?)`,
      [taskId, req.userId, title, result]
    );
    res.json({ code: 200, data: { task_id: taskId } });
  } catch (e) {
    res.status(500).json({ code: 500, msg: e.message });
  }
});

// ==================== 管理接口 ====================

// GET /api/industry-videos/admin — 管理后台查看（按行业筛选，分页）
router.get('/admin', requireAdmin, async (req, res) => {
  const { industry, page = 1, pageSize = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(pageSize);
  const where = industry ? 'WHERE industry = ? AND status != \'deleted\'' : 'WHERE status != \'deleted\'';
  const params = industry
    ? [industry, parseInt(pageSize), offset]
    : [parseInt(pageSize), offset];

  const { rows } = await db.query(
    `SELECT id, industry, author, cover_url, likes, transcript, status, collected_at
     FROM industry_videos ${where}
     ORDER BY collected_at DESC LIMIT ? OFFSET ?`, params
  );
  const { rows: total } = await db.query(
    `SELECT COUNT(*) AS cnt FROM industry_videos ${where}`,
    industry ? [industry] : []
  );
  res.json({ code: 200, data: rows, total: total[0].cnt });
});

// DELETE /api/industry-videos/admin/:id — 软删除单条视频
router.delete('/admin/:id', requireAdmin, async (req, res) => {
  await db.query(`UPDATE industry_videos SET status = 'deleted' WHERE id = ?`, [req.params.id]);
  res.json({ code: 200, msg: '已删除' });
});

// PUT /api/industry-videos/admin/:id/transcript — 修改单条文案
router.put('/admin/:id/transcript', requireAdmin, async (req, res) => {
  const { transcript } = req.body;
  if (!transcript?.trim()) return res.json({ code: 400, msg: '文案不能为空' });
  await db.query(`UPDATE industry_videos SET transcript = ? WHERE id = ?`, [transcript.trim(), req.params.id]);
  res.json({ code: 200, msg: '已保存' });
});

// GET /api/industry-videos/admin/collect-config — 行业采集配置总览
router.get('/admin/collect-config', requireAdmin, async (req, res) => {
  const { rows: indRows } = await db.query(
    `SELECT i.id, i.name, i.collect_keywords, i.sort_order,
            COUNT(CASE WHEN iv.status='ok' THEN 1 END) AS video_count,
            MAX(iv.collected_at) AS last_collected
     FROM industries i
     LEFT JOIN industry_videos iv ON i.name = iv.industry
     GROUP BY i.id, i.name, i.collect_keywords, i.sort_order
     ORDER BY i.sort_order ASC, i.id ASC`
  );
  const { rows: schRows } = await db.query(`SELECT value FROM system_config WHERE config_key='collect_schedule'`);
  res.json({
    code: 200,
    data: {
      industries: indRows,
      schedule: schRows[0]?.value || '',
      paused: collectState.paused,
      running: collectState.running,
    }
  });
});

// PATCH /api/industry-videos/admin/industry-keywords/:id — 更新行业关键词
router.patch('/admin/industry-keywords/:id', requireAdmin, async (req, res) => {
  const { keywords } = req.body;
  await db.query(`UPDATE industries SET collect_keywords = ? WHERE id = ?`, [keywords || '', req.params.id]);
  res.json({ code: 200, msg: '已保存' });
});

// GET/POST /api/industry-videos/admin/schedule — 定时采集设置
router.get('/admin/schedule', requireAdmin, async (req, res) => {
  const { rows } = await db.query(`SELECT value FROM system_config WHERE config_key='collect_schedule'`);
  res.json({ code: 200, data: { schedule: rows[0]?.value || '' } });
});
router.post('/admin/schedule', requireAdmin, async (req, res) => {
  const { schedule } = req.body;
  await db.query(`INSERT INTO system_config (config_key, value) VALUES ('collect_schedule',?) ON DUPLICATE KEY UPDATE value=?`, [schedule || '', schedule || '']);
  res.json({ code: 200, msg: schedule ? `定时采集已设置为 ${schedule}` : '定时采集已清除' });
});

// POST /api/industry-videos/admin/pause — 暂停/继续采集
router.post('/admin/pause', requireAdmin, (req, res) => {
  collectState.paused = !collectState.paused;
  csLog(collectState.paused ? '⏸ 采集已暂停' : '▶ 采集继续');
  res.json({ code: 200, paused: collectState.paused });
});

// POST /api/industry-videos/admin/stop — 停止采集
router.post('/admin/stop', requireAdmin, async (req, res) => {
  collectState.stop = true;
  collectState.paused = false;
  await db.query(`INSERT INTO system_config (config_key, value) VALUES ('collect_pending','0') ON DUPLICATE KEY UPDATE value='0'`);
  csLog('⛔ 停止指令已发出');
  res.json({ code: 200, msg: '停止指令已发出，本地服务将在当前视频处理完成后停止' });
});

// POST /api/industry-videos/admin/trigger — 触发采集
router.post('/admin/trigger', requireAdmin, async (req, res) => {
  if (collectState.running) {
    return res.json({ code: 200, msg: '采集任务已在运行中' });
  }
  await db.query(`INSERT INTO system_config (config_key, value) VALUES ('collect_pending','1') ON DUPLICATE KEY UPDATE value='1'`);
  Object.assign(collectState, {
    running: true, paused: false, stop: false,
    startedAt: new Date().toISOString(), finishedAt: null, error: null,
    industry: '等待本地服务拉取任务...', keyword: '', keywordIdx: 0, keywordTotal: 0,
    saved: 0, skipped: 0, current: '', log: ['采集请求已写入，本地服务将在30秒内开始...'], items: [],
  });
  res.json({ code: 200, msg: '采集请求已发出，本地服务将自动开始' });
});

// GET /api/industry-videos/admin/progress — 采集进度查询
router.get('/admin/progress', requireAdmin, (req, res) => {
  res.json({
    code: 200,
    data: {
      running:       collectState.running,
      paused:        collectState.paused,
      startedAt:     collectState.startedAt,
      finishedAt:    collectState.finishedAt,
      error:         collectState.error,
      industry:      collectState.industry,
      keyword:       collectState.keyword,
      keywordIdx:    collectState.keywordIdx,
      keywordTotal:  collectState.keywordTotal,
      saved:         collectState.saved,
      skipped:       collectState.skipped,
      current:       collectState.current,
      log:           collectState.log,
      items:         collectState.items,
    }
  });
});

// ==================== 本地 ASR 内部接口（无需鉴权）====================

// GET /api/industry-videos/collect-job — 本地 ASR 轮询，获取采集任务
router.get('/collect-job', async (req, res) => {
  const { rows } = await db.query(`SELECT value FROM system_config WHERE config_key = 'collect_pending'`);
  const pending = rows[0]?.value === '1';
  if (!pending) return res.json({ code: 200, pending: false });

  // 读取配置
  const { rows: cfgRows } = await db.query(
    `SELECT config_key, value FROM system_config WHERE config_key IN ('tikhub_api_key','asr_url')`
  );
  const cfg = {};
  cfgRows.forEach(r => cfg[r.config_key] = r.value);

  // 从 industries 表动态读取关键词
  const { rows: indRows } = await db.query(
    `SELECT name, collect_keywords FROM industries WHERE collect_keywords IS NOT NULL AND collect_keywords != '' ORDER BY sort_order ASC, id ASC`
  );
  const industries = {};
  for (const row of indRows) {
    const kws = row.collect_keywords.split(',').map(k => k.trim()).filter(Boolean);
    if (kws.length > 0) industries[row.name] = kws;
  }
  // 若无配置关键词，使用硬编码兜底
  if (Object.keys(industries).length === 0) {
    Object.assign(industries, DEFAULT_KEYWORDS);
  }

  res.json({
    code: 200,
    pending: true,
    tikhub_key: cfg.tikhub_api_key || '',
    industries,
    keep_latest: KEEP_LATEST,
    min_chars: MIN_CHARS,
    paused: collectState.paused,
    stop: collectState.stop,
  });
});

// GET /api/industry-videos/collect-status — 本地 ASR 采集中轮询（查暂停/停止状态）
router.get('/collect-status', (req, res) => {
  res.json({ paused: collectState.paused, stop: collectState.stop });
});

// POST /api/industry-videos/collect-item — 本地 ASR 每处理一条视频后上报
router.post('/collect-item', (req, res) => {
  const { industry, aweme_id, author, likes, action, transcript } = req.body || {};
  if (action === 'saved') {
    collectState.saved++;
    const item = {
      industry: industry || '',
      aweme_id: aweme_id || '',
      author: author || '匿名',
      likes: parseInt(likes) || 0,
      action: 'saved',
      preview: (transcript || '').slice(0, 60),
      at: new Date().toISOString(),
    };
    collectState.items.unshift(item);
    if (collectState.items.length > 30) collectState.items.pop();
    csLog(`✓ ${industry} | ${item.preview.slice(0, 30)}...`);
  } else if (action === 'skipped') {
    collectState.skipped++;
  }
  res.json({ code: 200 });
});

// POST /api/industry-videos/collect-heartbeat — 本地 ASR 推送进度心跳
router.post('/collect-heartbeat', (req, res) => {
  const { industry, keyword, keyword_idx, keyword_total, saved, skipped } = req.body || {};
  if (industry)           collectState.industry    = industry;
  if (keyword)            collectState.keyword     = keyword;
  if (keyword_idx != null) collectState.keywordIdx = keyword_idx;
  if (keyword_total != null) collectState.keywordTotal = keyword_total;
  if (saved    != null)   collectState.saved    = saved;
  if (skipped  != null)   collectState.skipped  = skipped;
  csLog(`[心跳] ${industry || '?'} / ${keyword || '?'}`);
  res.json({ code: 200 });
});

// POST /api/industry-videos/admin/submit — 本地 ASR 提交批量结果
router.post('/admin/submit', async (req, res) => {
  const { industry, videos } = req.body;
  if (!industry || !Array.isArray(videos)) {
    return res.status(400).json({ code: 400, msg: '参数错误' });
  }
  let inserted = 0;
  for (const v of videos) {
    if (!v.aweme_id || !v.transcript || v.transcript.length < 15) continue;
    await db.query(
      `INSERT IGNORE INTO industry_videos (industry, aweme_id, author, cover_url, video_url, likes, transcript) VALUES (?,?,?,?,?,?,?)`,
      [industry, v.aweme_id, v.author || '', v.cover_url || '', v.video_url || '', v.likes || 0, v.transcript]
    ).catch(() => {});
    inserted++;
  }
  // 超额降级
  const { rows: all } = await db.query(
    `SELECT id FROM industry_videos WHERE industry = ? AND status = 'ok' ORDER BY likes DESC`, [industry]
  );
  if (all.length > KEEP_LATEST) {
    const toDelete = all.slice(KEEP_LATEST).map(r => r.id);
    await db.query(
      `UPDATE industry_videos SET status = 'old' WHERE id IN (${toDelete.map(() => '?').join(',')})`, toDelete
    );
  }
  collectState.saved += inserted;
  collectState.industry = industry;
  csLog(`${industry} 批量提交完成，入库 ${inserted} 条`);
  res.json({ code: 200, msg: `入库 ${inserted} 条`, inserted });
});

// POST /api/industry-videos/collect-done — 本地 ASR 通知采集完成
router.post('/collect-done', async (req, res) => {
  await db.query(`INSERT INTO system_config (config_key, value) VALUES ('collect_pending','0') ON DUPLICATE KEY UPDATE value='0'`);
  const { total_saved = 0, total_skipped = 0, error = null } = req.body || {};
  collectState.running = false;
  collectState.paused  = false;
  collectState.stop    = false;
  collectState.finishedAt = new Date().toISOString();
  collectState.error   = error;
  collectState.saved   = total_saved;
  collectState.skipped = total_skipped;
  csLog(error ? `采集出错: ${error}` : `✅ 采集完成！入库 ${total_saved} 条，跳过 ${total_skipped} 条`);
  res.json({ code: 200, msg: 'ok' });
});

// ==================== 采集核心逻辑（服务器端备用，正常由本地 ASR 执行）====================

async function getTikhubKey() {
  const { rows } = await db.query(`SELECT value FROM system_config WHERE config_key = 'tikhub_api_key'`);
  return rows[0]?.value || null;
}

async function getAsrUrl() {
  const { rows } = await db.query(`SELECT value FROM system_config WHERE config_key = 'asr_url'`);
  return rows[0]?.value?.trim() || null;
}

module.exports = { router };
