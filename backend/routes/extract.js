// 抖音文案提取路由
const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const router = express.Router();

function checkAndRecordUsage(userId, action) {
  const user = db.prepare('SELECT daily_limit, role FROM users WHERE id = ?').get(userId);

  if (!user) return { ok: false, msg: '用户不存在，请重新登录' };

  if (user.role === 'admin') {
    db.prepare('INSERT INTO usage_logs (user_id, action) VALUES (?, ?)').run(userId, action);
    return { ok: true, remaining: 999 };
  }

  const today = new Date().toISOString().slice(0, 10);
  const used = db.prepare(
    `SELECT COUNT(*) as cnt FROM usage_logs WHERE user_id = ? AND created_at LIKE ?`
  ).get(userId, `${today}%`);

  if (used.cnt >= user.daily_limit) {
    return { ok: false, msg: `今日免费次数已用完（${user.daily_limit}次），明日再来~` };
  }

  db.prepare('INSERT INTO usage_logs (user_id, action) VALUES (?, ?)').run(userId, action);
  return { ok: true, remaining: user.daily_limit - used.cnt - 1 };
}

// ==================== 提取抖音视频文案 ====================
router.post('/video', requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url?.trim()) return res.status(400).json({ code: 400, msg: '请输入视频链接' });

  const usage = checkAndRecordUsage(req.userId, 'extract');
  if (!usage.ok) return res.status(429).json({ code: 429, msg: usage.msg });

  try {
    // 获取 Tikhub API Key
    const tikhubKey = db.prepare("SELECT value FROM system_config WHERE key = 'tikhub_api_key'").get()?.value;

    if (!tikhubKey) {
      // 没有配置 Key 时返回提示
      return res.status(503).json({
        code: 503,
        msg: '抖音解析服务未配置，请联系管理员配置 Tikhub API Key'
      });
    }

    // 解析短链接获取真实链接
    const cleanUrl = url.trim();

    // 调用 Tikhub API 获取视频信息和字幕
    const videoResponse = await fetch(
      `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video?aweme_id=&url=${encodeURIComponent(cleanUrl)}`,
      {
        headers: {
          'Authorization': `Bearer ${tikhubKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!videoResponse.ok) {
      const err = await videoResponse.text();
      throw new Error(`视频解析失败: ${err}`);
    }

    const videoData = await videoResponse.json();
    const item = videoData?.data?.aweme_detail;

    if (!item) throw new Error('无法获取视频信息，请检查链接是否正确');

    // 提取文案内容
    const desc = item.desc || '';
    const awemeId = item.aweme_id;

    // 尝试获取字幕（如果有）
    let subtitle = '';
    if (awemeId) {
      try {
        const subtitleResp = await fetch(
          `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_video_subtitle?aweme_id=${awemeId}`,
          { headers: { 'Authorization': `Bearer ${tikhubKey}` } }
        );
        if (subtitleResp.ok) {
          const subData = await subtitleResp.json();
          const subtitles = subData?.data?.subtitle_infos?.[0]?.subtitle_list;
          if (subtitles?.length) {
            subtitle = subtitles.map(s => s.words?.map(w => w.word).join('') || s.text).join('\n');
          }
        }
      } catch {}
    }

    const script = subtitle || desc || '未能提取到文案内容';

    res.json({
      code: 200,
      data: {
        script,
        title: item.desc?.slice(0, 30) || '无标题',
        author: item.author?.nickname || '未知',
        likes: item.statistics?.digg_count || 0,
        remaining: usage.remaining
      }
    });

  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

module.exports = router;
