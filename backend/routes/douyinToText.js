// 抖音视频转文字路由（Whisper ASR）
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

// POST /api/video/douyin-to-text
router.post('/douyin-to-text', requireAuth, async (req, res) => {
  const rawInput = req.body?.url?.trim() || '';
  if (!rawInput) return res.status(400).json({ code: 400, msg: '请输入视频链接' });

  // 从分享文本中提取真实 URL（支持粘贴完整分享文字）
  const urlMatch = rawInput.match(/https?:\/\/[^\s\u4e00-\u9fff，。！？、]+/);
  const url = urlMatch ? urlMatch[0].replace(/[\/]+$/, '') + '/' : rawInput;

  const usage = checkAndRecordUsage(req.userId, 'extract');
  if (!usage.ok) return res.status(429).json({ code: 429, msg: usage.msg });

  try {
    const tikhubKey = db.prepare("SELECT value FROM system_config WHERE key = 'tikhub_api_key'").get()?.value;
    const asrUrl = 'https://baculitic-derivable-sherilyn.ngrok-free.dev';

    if (!tikhubKey) {
      return res.status(503).json({ code: 503, msg: '视频解析服务未配置，请联系管理员配置 TikHub API Key' });
    }

    // Step 1：先跟随重定向解析短链，提取真实 aweme_id
    let awemeId = '';
    try {
      const redirectResp = await fetch(url.trim(), { redirect: 'follow' });
      const finalUrl = redirectResp.url;
      console.log('[最终URL]', finalUrl);
      const match = finalUrl.match(/\/video\/(\d+)/);
      awemeId = match?.[1] || '';
    } catch (e) {
      console.log('[短链解析失败]', e.message);
    }

    // Step 2：TikHub 解析视频信息，获取真实 MP4 地址
    const tikhubUrl = awemeId
      ? `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video?aweme_id=${awemeId}`
      : `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video?aweme_id=0&url=${encodeURIComponent(url.trim())}`;

    console.log('[TikHub请求URL]', tikhubUrl);
    const videoResp = await fetch(tikhubUrl, { headers: { 'Authorization': `Bearer ${tikhubKey}` } });

    if (!videoResp.ok) {
      const errBody = await videoResp.text();
      throw new Error(`TikHub返回${videoResp.status}: ${errBody}`);
    }

    const videoData = await videoResp.json();
    const item = videoData?.data?.aweme_details?.[0] || videoData?.data?.aweme_detail;
    console.log('[item获取结果]', item ? '成功' : '失败', 'status_code:', videoData?.data?.status_code);
    if (!item) throw new Error('无法获取视频信息，请检查链接是否正确');

    const mp4Url = item.video?.play_addr?.url_list?.[0]
      || item.video?.download_addr?.url_list?.[0];

    if (!mp4Url) throw new Error('无法获取视频下载地址');

    // Step 2：调用本地 Whisper ASR 服务
    const taskId = `task_${Date.now()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5 分钟超时

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

    if (!asrResp.ok) {
      const errText = await asrResp.text();
      throw new Error(`语音识别失败: ${errText}`);
    }

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
