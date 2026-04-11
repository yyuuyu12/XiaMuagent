// 抖音视频转文字路由（Whisper ASR）
const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const router = express.Router();

async function checkAndRecordUsage(userId, action) {
  const { rows } = await db.query('SELECT daily_limit, role FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user) return { ok: false, msg: '用户不存在，请重新登录' };

  if (user.role === 'admin') {
    await db.query('INSERT INTO usage_logs (user_id, action) VALUES ($1, $2)', [userId, action]);
    return { ok: true, remaining: 999 };
  }

  const { rows: usageRows } = await db.query(
    'SELECT COUNT(*) AS cnt FROM usage_logs WHERE user_id = $1 AND DATE(created_at) = CURRENT_DATE',
    [userId]
  );
  const used = parseInt(usageRows[0].cnt);

  if (used >= user.daily_limit) {
    return { ok: false, msg: `今日免费次数已用完（${user.daily_limit}次），明日再来~` };
  }

  await db.query('INSERT INTO usage_logs (user_id, action) VALUES ($1, $2)', [userId, action]);
  return { ok: true, remaining: user.daily_limit - used - 1 };
}

// POST /api/video/douyin-to-text
router.post('/douyin-to-text', requireAuth, async (req, res) => {
  const rawInput = req.body?.url?.trim() || '';
  if (!rawInput) return res.status(400).json({ code: 400, msg: '请输入视频链接' });

  // 从分享文本中提取真实 URL
  const urlMatch = rawInput.match(/https?:\/\/[^\s\u4e00-\u9fff，。！？、]+/);
  const url = urlMatch ? urlMatch[0].replace(/[\/]+$/, '') + '/' : rawInput;

  const usage = await checkAndRecordUsage(req.userId, 'extract');
  if (!usage.ok) return res.status(429).json({ code: 429, msg: usage.msg });

  try {
    const { rows: cfgRows } = await db.query("SELECT value FROM system_config WHERE config_key = 'tikhub_api_key'");
    const tikhubKey = cfgRows[0]?.value;

    const { rows: asrRows } = await db.query("SELECT value FROM system_config WHERE config_key = 'asr_url'");
    const asrUrl = String(asrRows[0]?.value || process.env.ASR_URL || '').trim();

    if (!tikhubKey) {
      return res.status(503).json({ code: 503, msg: '视频解析服务未配置，请联系管理员配置 TikHub API Key' });
    }

    if (!asrUrl) {
      return res.status(503).json({ code: 503, msg: '语音识别服务未配置，请联系管理员配置 ASR 服务地址' });
    }

    // Step 1：解析短链，提取 aweme_id
    let awemeId = '';
    try {
      const redirectResp = await fetch(url.trim(), { redirect: 'follow' });
      const finalUrl = redirectResp.url;
      const match = finalUrl.match(/\/video\/(\d+)/);
      awemeId = match?.[1] || '';
    } catch (e) {
      console.log('[短链解析失败]', e.message);
    }

    // Step 2：TikHub 解析视频信息
    const tikhubApiUrl = awemeId
      ? `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video?aweme_id=${awemeId}`
      : `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video?aweme_id=0&url=${encodeURIComponent(url.trim())}`;

    const videoResp = await fetch(tikhubApiUrl, { headers: { 'Authorization': `Bearer ${tikhubKey}` } });
    if (!videoResp.ok) throw new Error(`TikHub返回${videoResp.status}: ${await videoResp.text()}`);

    const videoData = await videoResp.json();
    const item = videoData?.data?.aweme_details?.[0] || videoData?.data?.aweme_detail;
    if (!item) throw new Error('无法获取视频信息，请检查链接是否正确');

    const mp4Url = item.video?.play_addr?.url_list?.[0] || item.video?.download_addr?.url_list?.[0];
    if (!mp4Url) throw new Error('无法获取视频下载地址');

    // Step 3：调用 Whisper ASR 服务
    const taskId = `task_${Date.now()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5分钟超时

    let asrResp;
    try {
      asrResp = await fetch(`${asrUrl}/asr/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, mp4Url }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!asrResp.ok) throw new Error(`语音识别失败: ${await asrResp.text()}`);

    const asrResult = await asrResp.json();
    const script = asrResult.text?.trim() || '未能识别到语音内容';

    res.json({
      code: 200,
      data: {
        script,
        title: item.desc?.slice(0, 30) || '无标题',
        author: item.author?.nickname || '未知',
        remaining: usage.remaining,
      },
    });

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ code: 504, msg: '语音识别超时（视频过长），请尝试较短的视频' });
    }
    res.status(500).json({ code: 500, msg: err.message });
  }
});

module.exports = router;
