/**
 * 行业热门视频采集 & 管理
 * 每日定时抓取高赞视频 → ASR 提取文案 → 存库
 * 管理后台可查看/删除
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');

// 行业关键词配置（管理员可在后台扩展）
const INDUSTRY_KEYWORDS = {
  '二手车': ['二手车 选车', '买二手车 避坑', '二手车 推荐'],
  '餐饮':   ['餐饮 开店', '餐厅 经营', '美食 探店 推荐'],
};

const KEEP_LATEST = 15;    // 每行业保留最新 N 条
const MIN_CHARS   = 15;    // 文案少于此字数视为无口播，自动丢弃

// ==================== 实时进度追踪 ====================
const collectState = {
  running: false,
  startedAt: null,
  industry: '',        // 当前行业
  keyword: '',         // 当前关键词
  keywordIdx: 0,
  keywordTotal: 0,
  saved: 0,            // 本次已入库总数
  skipped: 0,          // 本次跳过（无口播/重复）
  current: '',         // 当前正在处理的 aweme_id
  log: [],             // 最近10条日志
  finishedAt: null,
  error: null,
};

function csLog(msg) {
  console.log('[IndustryVideos]', msg);
  collectState.log.push(msg);
  if (collectState.log.length > 10) collectState.log.shift();
}

// ==================== 对外查询接口（用户端）====================

// GET /api/industry-videos?industry=二手车&limit=15
router.get('/', requireAuth, async (req, res) => {
  const { industry, limit = 15 } = req.query;
  if (!industry) return res.status(400).json({ code: 400, msg: '请传入 industry 参数' });

  const { rows } = await db.query(
    `SELECT id, industry, author, cover_url, likes, transcript, collected_at
     FROM industry_videos
     WHERE industry = ? AND status = 'ok' AND transcript IS NOT NULL
     ORDER BY likes DESC
     LIMIT ?`,
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

// ==================== 管理接口 ====================

// GET /api/industry-videos/admin — 管理后台查看全部（含已删除）
router.get('/admin', requireAdmin, async (req, res) => {
  const { industry, page = 1, pageSize = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(pageSize);
  const where = industry ? 'WHERE industry = ?' : '';
  const params = industry
    ? [industry, parseInt(pageSize), offset]
    : [parseInt(pageSize), offset];

  const { rows } = await db.query(
    `SELECT id, industry, author, cover_url, likes, transcript, status, collected_at
     FROM industry_videos ${where}
     ORDER BY collected_at DESC LIMIT ? OFFSET ?`,
    params
  );
  const { rows: total } = await db.query(
    `SELECT COUNT(*) AS cnt FROM industry_videos ${where}`,
    industry ? [industry] : []
  );
  res.json({ code: 200, data: rows, total: total[0].cnt });
});

// DELETE /api/industry-videos/admin/:id — 删除单条
router.delete('/admin/:id', requireAdmin, async (req, res) => {
  await db.query(
    `UPDATE industry_videos SET status = 'deleted' WHERE id = ?`,
    [req.params.id]
  );
  res.json({ code: 200, msg: '已删除' });
});

// GET /api/industry-videos/admin/progress — 查询采集进度
router.get('/admin/progress', requireAdmin, (req, res) => {
  const industries = Object.keys(INDUSTRY_KEYWORDS);
  const industryIdx = collectState.industry ? industries.indexOf(collectState.industry) : -1;
  res.json({
    code: 200,
    data: {
      running:      collectState.running,
      startedAt:    collectState.startedAt,
      finishedAt:   collectState.finishedAt,
      error:        collectState.error,
      industry:     collectState.industry,
      industryIdx:  industryIdx + 1,
      industryTotal: industries.length,
      keyword:      collectState.keyword,
      keywordIdx:   collectState.keywordIdx,
      keywordTotal: collectState.keywordTotal,
      saved:        collectState.saved,
      skipped:      collectState.skipped,
      current:      collectState.current,
      log:          collectState.log,
    }
  });
});

// POST /api/industry-videos/admin/trigger — 手动触发一次采集
router.post('/admin/trigger', requireAdmin, async (req, res) => {
  if (collectState.running) {
    return res.json({ code: 200, msg: '采集任务已在运行中' });
  }
  res.json({ code: 200, msg: '采集任务已触发' });
  // 异步执行，不阻塞响应
  runCollect().catch(e => console.error('[IndustryVideos] collect error:', e));
});

// ==================== 采集核心逻辑 ====================

async function getTikhubKey() {
  const { rows } = await db.query(
    `SELECT value FROM system_config WHERE config_key = 'tikhub_api_key'`
  );
  return rows[0]?.value || null;
}

async function getAsrUrl() {
  const { rows } = await db.query(
    `SELECT value FROM system_config WHERE config_key = 'asr_url'`
  );
  return rows[0]?.value?.trim() || null;
}

// 搜索抖音高赞视频
async function searchVideos(keyword, tikhubKey, count = 20) {
  const url = `https://api.tikhub.io/api/v1/douyin/web/fetch_search_result?keyword=${encodeURIComponent(keyword)}&count=${count}&sort_type=1&publish_time=1`;
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${tikhubKey}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`TikHub HTTP ${resp.status}`);
  const json = await resp.json();
  // 返回视频列表
  const items = json?.data?.data || [];
  return items.map(item => {
    const v = item.aweme_info || item;
    return {
      aweme_id: v.aweme_id,
      author:   v.author?.nickname || '',
      cover_url: v.video?.cover?.url_list?.[0] || v.cover?.url_list?.[0] || '',
      video_url: v.video?.play_addr?.url_list?.[0] || '',
      likes:    v.statistics?.digg_count || 0,
    };
  }).filter(v => v.aweme_id && v.video_url);
}

// 调用本地 ASR 提取文案
async function transcribeVideo(mp4Url, asrUrl) {
  const resp = await fetch(`${asrUrl}/asr/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'industry_' + Date.now(), mp4Url }),
    signal: AbortSignal.timeout(120000), // 2分钟超时
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  return json?.text?.trim() || null;
}

// 主采集函数
async function runCollect() {
  if (collectState.running) { console.log('[IndustryVideos] 已在采集中，跳过'); return; }

  // 初始化进度
  Object.assign(collectState, {
    running: true, startedAt: new Date().toISOString(), finishedAt: null, error: null,
    industry: '', keyword: '', keywordIdx: 0, keywordTotal: 0,
    saved: 0, skipped: 0, current: '', log: [],
  });
  csLog('开始采集...');

  try {
    const tikhubKey = await getTikhubKey();
    const asrUrl = await getAsrUrl();

    if (!tikhubKey) { collectState.error = 'TikHub Key 未配置'; csLog('错误：TikHub Key 未配置'); return; }
    if (!asrUrl)    { collectState.error = 'ASR URL 未配置';    csLog('错误：ASR URL 未配置');    return; }

    for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
      collectState.industry = industry;
      collectState.keywordTotal = keywords.length;
      collectState.keywordIdx = 0;
      csLog(`开始行业: ${industry}`);
      const collected = new Set();

      for (let ki = 0; ki < keywords.length; ki++) {
        const keyword = keywords[ki];
        collectState.keyword = keyword;
        collectState.keywordIdx = ki + 1;
        csLog(`搜索关键词: "${keyword}"`);

        let videos = [];
        try {
          videos = await searchVideos(keyword, tikhubKey, 20);
          csLog(`"${keyword}" 找到 ${videos.length} 个视频`);
        } catch (e) {
          csLog(`搜索失败: ${keyword} — ${e.message}`);
          continue;
        }

        videos.sort((a, b) => b.likes - a.likes);

        for (const v of videos) {
          if (collected.has(v.aweme_id)) continue;
          collectState.current = v.aweme_id;

          // 已存在则跳过
          const { rows: exist } = await db.query(
            `SELECT id FROM industry_videos WHERE aweme_id = ?`, [v.aweme_id]
          );
          if (exist.length > 0) {
            collected.add(v.aweme_id);
            collectState.skipped++;
            continue;
          }

          // ASR 提取
          let transcript = null;
          try {
            csLog(`ASR转录: ${v.aweme_id} (${v.likes}赞)`);
            transcript = await transcribeVideo(v.video_url, asrUrl);
          } catch (e) {
            csLog(`ASR失败: ${v.aweme_id} — ${e.message}`);
            collectState.skipped++;
          }

          // 自动过滤无口播
          if (!transcript || transcript.length < MIN_CHARS) {
            csLog(`跳过（无口播）: ${v.aweme_id}`);
            collectState.skipped++;
            continue;
          }

          // 写库
          await db.query(
            `INSERT IGNORE INTO industry_videos
             (industry, aweme_id, author, cover_url, video_url, likes, transcript)
             VALUES (?,?,?,?,?,?,?)`,
            [industry, v.aweme_id, v.author, v.cover_url, v.video_url, v.likes, transcript]
          );
          collected.add(v.aweme_id);
          collectState.saved++;
          csLog(`✓ 入库: ${industry} | ${v.aweme_id} | ${v.likes}赞`);
        }
      }

      // 保留最新 KEEP_LATEST 条，超出的软删除
      const { rows: all } = await db.query(
        `SELECT id FROM industry_videos WHERE industry = ? AND status = 'ok' ORDER BY likes DESC`,
        [industry]
      );
      if (all.length > KEEP_LATEST) {
        const toDelete = all.slice(KEEP_LATEST).map(r => r.id);
        await db.query(
          `UPDATE industry_videos SET status = 'old' WHERE id IN (${toDelete.map(() => '?').join(',')})`,
          toDelete
        );
        csLog(`${industry} 超额 ${toDelete.length} 条降级`);
      }
      csLog(`行业 ${industry} 完成，本次入库 ${collectState.saved} 条`);
    }

    csLog(`全部完成！共入库 ${collectState.saved} 条，跳过 ${collectState.skipped} 条`);
  } catch (e) {
    collectState.error = e.message;
    csLog(`采集异常: ${e.message}`);
  } finally {
    collectState.running = false;
    collectState.finishedAt = new Date().toISOString();
    collectState.current = '';
  }
}

module.exports = { router, runCollect, INDUSTRY_KEYWORDS };
