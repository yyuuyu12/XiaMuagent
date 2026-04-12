const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const { callAI } = require('../lib/callAI');
const crypto = require('crypto');

const router = express.Router();

// ===== 工具函数 =====

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';

function extractUrl(text) {
  const patterns = [
    /https?:\/\/www\.iesdouyin\.com\/share\/(video|user)\/[A-Za-z0-9_-]+/,
    /https?:\/\/www\.douyin\.com\/(video|user)\/[A-Za-z0-9_-]+/,
    /https?:\/\/v\.douyin\.com\/[A-Za-z0-9]+/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

async function expandShortUrl(url) {
  if (!url.includes('v.douyin.com')) return url;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': MOBILE_UA },
      signal: AbortSignal.timeout(10000),
    });
    return res.url;
  } catch (err) {
    throw new Error(`短链展开失败: ${err.message}`);
  }
}

function classifyUrl(url) {
  const userInPath = url.match(/\/(?:share\/)?user\/([A-Za-z0-9_-]+)/);
  if (userInPath) return { type: 'user', sec_user_id: userInPath[1] };

  const videoInPath = url.match(/\/(?:share\/)?video\/(\d+)/);
  if (videoInPath) return { type: 'video', aweme_id: videoInPath[1] };

  const secUidInQuery = url.match(/[?&]sec_uid=([A-Za-z0-9_-]+)/);
  if (secUidInQuery) return { type: 'user', sec_user_id: secUidInQuery[1] };

  return { type: 'unknown' };
}

async function checkAndRecordUsage(userId, action) {
  const { rows } = await db.query('SELECT daily_limit, role FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user) return { ok: false, msg: '用户不存在，请重新登录' };
  if (user.role === 'admin') {
    await db.query('INSERT INTO usage_logs (user_id, action) VALUES ($1, $2)', [userId, action]);
    return { ok: true, remaining: 999 };
  }
  const { rows: u } = await db.query(
    'SELECT COUNT(*) AS cnt FROM usage_logs WHERE user_id = $1 AND DATE(created_at) = CURRENT_DATE', [userId]
  );
  const used = parseInt(u[0].cnt);
  if (used >= user.daily_limit) return { ok: false, msg: `今日免费次数已用完（${user.daily_limit}次），明日再来~` };
  await db.query('INSERT INTO usage_logs (user_id, action) VALUES ($1, $2)', [userId, action]);
  return { ok: true, remaining: user.daily_limit - used - 1 };
}

// ===== POST /api/inspire/resolve =====
// 解析链接：判断是单视频还是主页
router.post('/resolve', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ code: 400, msg: '请粘贴抖音链接或分享文本' });

  try {
    const url = extractUrl(text.trim());
    if (!url) return res.status(400).json({ code: 400, msg: '未识别到有效的抖音链接，请复制分享链接后重试' });

    const expandedUrl = await expandShortUrl(url);
    const result = classifyUrl(expandedUrl);
    if (result.type === 'unknown') return res.status(400).json({ code: 400, msg: '链接格式不支持，请确保是抖音主页或视频链接' });

    res.json({ code: 200, data: result });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// ===== POST /api/inspire/profile-videos =====
// 拉取主页视频列表（带 Redis 缓存）
router.post('/profile-videos', requireAuth, async (req, res) => {
  const { sec_user_id } = req.body;
  if (!sec_user_id) return res.status(400).json({ code: 400, msg: 'sec_user_id 缺失' });

  let redis = null;
  try { redis = require('../redis'); } catch {}

  try {
    // 查缓存
    if (redis) {
      try {
        const cached = await redis.get(`profile:${sec_user_id}`);
        if (cached) return res.json({ code: 200, data: JSON.parse(cached) });
      } catch {}
    }

    const { rows } = await db.query("SELECT value FROM system_config WHERE config_key = 'tikhub_api_key'");
    const tikhubKey = rows[0]?.value;
    if (!tikhubKey) return res.status(503).json({ code: 503, msg: 'TikHub API Key 未配置，请联系管理员' });

    const apiRes = await fetch(
      `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_user_post_videos?sec_user_id=${encodeURIComponent(sec_user_id)}&max_cursor=0&count=20&sort_type=0`,
      { headers: { 'Authorization': `Bearer ${tikhubKey}` }, signal: AbortSignal.timeout(15000) }
    );
    if (!apiRes.ok) throw new Error(`TikHub 返回 ${apiRes.status}`);

    const apiData = await apiRes.json();
    if (apiData.code !== 200 && apiData.code !== 0) throw new Error(`TikHub 错误: ${apiData.message || apiData.msg || apiData.code}`);

    const awemeList = apiData.data?.aweme_list || [];
    if (awemeList.length === 0) return res.status(400).json({ code: 400, msg: '该主页暂无视频或链接无法访问' });

    const author = awemeList[0]?.author || {};
    const videos = awemeList
      .map(a => ({
        aweme_id: String(a.aweme_id),
        title: a.item_title || a.desc?.slice(0, 60) || '(无标题)',
        duration_sec: Math.round((a.video?.duration || 0) / 1000),
        cover_url: a.video?.cover?.url_list?.[0] || a.cover?.url_list?.[0] || '',
        stats: { digg: a.statistics?.digg_count || 0, comment: a.statistics?.comment_count || 0 },
        play_urls: a.video?.play_addr?.url_list || [],
        expire_at: (a.video?.cdn_url_expired || 0) * 1000,
      }))
      .filter(v => v.duration_sec > 0 && v.duration_sec <= 120 && v.play_urls.length > 0)
      .sort((a, b) => b.stats.digg - a.stats.digg)
      .slice(0, 10);

    if (videos.length === 0) return res.status(400).json({ code: 400, msg: '该主页没有符合条件的视频（时长≤2分钟）' });

    const profileData = {
      author: { nickname: author.nickname || '', signature: author.signature || '', sec_uid: sec_user_id },
      videos,
    };

    if (redis) {
      try { await redis.setex(`profile:${sec_user_id}`, 30 * 60, JSON.stringify(profileData)); } catch {}
    }

    res.json({ code: 200, data: profileData });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// ===== POST /api/inspire/start-analyze =====
// 创建主页分析任务（路径A-主页）
router.post('/start-analyze', requireAuth, async (req, res) => {
  const { sec_user_id, selected_video_ids, brand_name } = req.body;
  if (!sec_user_id || !Array.isArray(selected_video_ids) || selected_video_ids.length === 0) {
    return res.status(400).json({ code: 400, msg: '参数缺失' });
  }

  const usage = await checkAndRecordUsage(req.userId, 'inspire');
  if (!usage.ok) return res.status(429).json({ code: 429, msg: usage.msg });

  let redis = null;
  try { redis = require('../redis'); } catch {}

  try {
    let profileData = null;
    if (redis) {
      try {
        const cached = await redis.get(`profile:${sec_user_id}`);
        if (cached) profileData = JSON.parse(cached);
      } catch {}
    }
    if (!profileData) return res.status(400).json({ code: 400, msg: '主页数据已过期，请重新解析链接' });

    const selectedVideos = profileData.videos.filter(v => selected_video_ids.includes(v.aweme_id));
    if (selectedVideos.length === 0) return res.status(400).json({ code: 400, msg: '所选视频不存在，请重新解析' });

    const taskId = crypto.randomUUID();
    const title = `@${profileData.author.nickname || sec_user_id} 的拆解`;

    await db.query(
      'INSERT INTO tasks (id, user_id, type, title, status, progress, thinking, input_data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [taskId, req.userId, 'profile_analyze', title, 'pending', 0, '', JSON.stringify({
        sec_user_id, author: profileData.author, selected_videos: selectedVideos, brand_name: brand_name || '',
      })]
    );

    const taskQueue = require('../queue');
    await taskQueue.add('analyze', { taskId, type: 'profile_analyze' });

    res.json({ code: 200, data: { taskId, title } });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// ===== POST /api/inspire/start-single-video =====
// 创建单视频分析任务（路径A-单视频）
router.post('/start-single-video', requireAuth, async (req, res) => {
  const { aweme_id, brand_name } = req.body;
  if (!aweme_id) return res.status(400).json({ code: 400, msg: 'aweme_id 缺失' });

  const usage = await checkAndRecordUsage(req.userId, 'inspire');
  if (!usage.ok) return res.status(429).json({ code: 429, msg: usage.msg });

  try {
    const taskId = crypto.randomUUID();
    const title = `视频 ${aweme_id} 的分析`;

    await db.query(
      'INSERT INTO tasks (id, user_id, type, title, status, progress, thinking, input_data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [taskId, req.userId, 'single_video_analyze', title, 'pending', 0, '', JSON.stringify({ aweme_id, brand_name: brand_name || '' })]
    );

    const taskQueue = require('../queue');
    await taskQueue.add('analyze', { taskId, type: 'single_video_analyze' });

    res.json({ code: 200, data: { taskId, title } });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// ===== POST /api/inspire/clarify =====
// 路径B：生成澄清问题
router.post('/clarify', requireAuth, async (req, res) => {
  const { industry } = req.body;
  if (!industry?.trim()) return res.status(400).json({ code: 400, msg: '请选择或输入行业' });

  try {
    const prompt = `你是短视频文案策划顾问。用户行业是"${industry.trim()}"，生成2-3个澄清问题帮你了解其具体业务。

要求：
1. 问题数量2-3个
2. 每个问题是单选题，3-5个选项
3. 覆盖：业务细分、目标客群、视频目的
4. 选项具体、互斥、贴合该行业

只输出JSON，不要任何解释：
{"questions":[{"id":"q1","question":"问题","type":"single","options":["选项1","选项2","选项3"]}]}`;

    const raw = await callAI(prompt, { temperature: 0.3 });
    let questions = [];
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      questions = parsed.questions || (Array.isArray(parsed) ? parsed : []);
    } catch {
      return res.status(500).json({ code: 500, msg: 'AI 返回格式异常，请重试' });
    }

    res.json({ code: 200, data: { questions } });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// ===== POST /api/inspire/generate-industry =====
// 路径B：根据澄清答案生成文案
router.post('/generate-industry', requireAuth, async (req, res) => {
  const { industry, brand_name, answers } = req.body;
  if (!industry?.trim()) return res.status(400).json({ code: 400, msg: '请选择行业' });

  const usage = await checkAndRecordUsage(req.userId, 'inspire');
  if (!usage.ok) return res.status(429).json({ code: 429, msg: usage.msg });

  try {
    const answersText = Array.isArray(answers) && answers.length > 0
      ? answers.map(a => `${a.question}: ${Array.isArray(a.answer) ? a.answer.join('、') : a.answer}`).join('\n')
      : '';

    const prompt = `你是短视频文案撰稿人，服务对象是个体户老板，需要真人口播视频文案。

用户信息：
行业：${industry}
店铺名称：${brand_name || '无'}
${answersText}

生成5条原创抖音文案：
1. 严格生成5条，差异化明显
2. 每条：开头钩子(1-2句)+主体(3-5句)+结尾CTA(1句)
3. 约30秒，口语化，像真人说话
4. 开头钩子类型5条全不同：痛点提问/反常识/数字冲击/故事开场/福利诱惑
5. 品牌名仅1-2条自然提及，放结尾
6. 禁止"家人们""老铁们"

只输出JSON数组：
[{"id":1,"hook_type":"痛点提问","content":"完整文案"}]`;

    const raw = await callAI(prompt, { temperature: 0.8, maxTokens: 2000 });
    let scripts = [];
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      scripts = JSON.parse(cleaned);
      if (!Array.isArray(scripts)) scripts = [];
    } catch {
      scripts = [{ id: 1, hook_type: '生成', content: raw }];
    }

    const taskId = crypto.randomUUID();
    const title = `${industry}${brand_name ? ' · ' + brand_name : ''}`;

    await db.query(
      'INSERT INTO tasks (id, user_id, type, title, status, progress, result) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [taskId, req.userId, 'industry_gen', title, 'done', 100, JSON.stringify({ scripts })]
    );
    await db.query('INSERT INTO history (user_id, type, input, result) VALUES ($1,$2,$3,$4)',
      [req.userId, 'inspire', industry, JSON.stringify(scripts)]);

    res.json({ code: 200, data: { taskId, scripts, title, remaining: usage.remaining } });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

module.exports = router;
