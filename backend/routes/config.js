const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ code: 403, msg: '权限不足，仅管理员可操作' });
  next();
}

// ==================== AI Key 配置 ====================
router.get('/ai-keys', requireAuth, requireAdmin, async (req, res) => {
  const keys = ['ai_provider','openai_api_key','openai_base_url','openai_model',
    'claude_api_key','claude_model','qwen_api_key','qwen_model','zhipu_api_key','zhipu_model','tikhub_api_key','asr_url','video_url','fish_audio_api_key'];
  const result = {};
  for (const k of keys) {
    const { rows } = await db.query('SELECT value FROM system_config WHERE config_key = $1', [k]);
    let val = rows[0]?.value || '';
    if (k.includes('key') && val.length > 8) val = val.slice(0, 4) + '****' + val.slice(-4);
    result[k] = val;
  }
  res.json({ code: 200, data: result });
});

router.post('/ai-keys', requireAuth, requireAdmin, async (req, res) => {
  const allowedKeys = ['ai_provider','openai_api_key','openai_base_url','openai_model',
    'claude_api_key','claude_model','qwen_api_key','qwen_model','zhipu_api_key','zhipu_model','tikhub_api_key','asr_url','video_url','fish_audio_api_key'];
  for (const [k, v] of Object.entries(req.body)) {
    if (allowedKeys.includes(k) && v !== undefined) {
      if (typeof v === 'string' && v.includes('****')) continue;
      await db.query(
        `INSERT INTO system_config (config_key, value, updated_at) VALUES ($1, $2, NOW())
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()`,
        [k, v]
      );
    }
  }
  res.json({ code: 200, msg: '配置已保存' });
});

// ==================== 提示词模板 ====================
router.get('/prompts', requireAuth, async (req, res) => {
  const { type } = req.query;
  let rows;
  if (type) {
    ({ rows } = await db.query('SELECT * FROM prompt_templates WHERE type = $1 ORDER BY is_default DESC, id ASC', [type]));
  } else {
    ({ rows } = await db.query('SELECT * FROM prompt_templates ORDER BY type, is_default DESC, id ASC'));
  }
  res.json({ code: 200, data: rows });
});

router.post('/prompts', requireAuth, requireAdmin, async (req, res) => {
  const { id, name, type, content } = req.body;
  if (!name || !type || !content) return res.status(400).json({ code: 400, msg: '参数不完整' });

  if (id) {
    await db.query('UPDATE prompt_templates SET name=$1, type=$2, content=$3 WHERE id=$4', [name, type, content, id]);
    res.json({ code: 200, msg: '更新成功' });
  } else {
    const { rows } = await db.query(
      'INSERT INTO prompt_templates (name, type, content) VALUES ($1,$2,$3)', [name, type, content]
    );
    res.json({ code: 200, msg: '创建成功', data: { id: rows[0].id } });
  }
});

router.delete('/prompts/:id', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await db.query('SELECT is_default FROM prompt_templates WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ code: 404, msg: '不存在' });
  if (rows[0].is_default) return res.status(400).json({ code: 400, msg: '默认模板不能删除' });
  await db.query('DELETE FROM prompt_templates WHERE id = $1', [req.params.id]);
  res.json({ code: 200, msg: '删除成功' });
});

// ==================== 会员套餐配置 ====================
router.get('/member-plans', async (req, res) => {
  const keys = ['member_plan_day_price','member_plan_week_price','member_plan_month_price','member_plan_forever_price','member_note'];
  const result = {};
  for (const k of keys) {
    const { rows } = await db.query('SELECT value FROM system_config WHERE config_key=$1', [k]);
    result[k] = rows[0]?.value || '';
  }
  res.json({ code: 200, data: result });
});

router.post('/member-plans', requireAuth, requireAdmin, async (req, res) => {
  const allowed = ['member_plan_day_price','member_plan_week_price','member_plan_month_price','member_plan_forever_price','member_note'];
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) {
      await db.query(
        `INSERT INTO system_config (config_key, value, updated_at) VALUES ($1, $2, NOW())
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()`,
        [k, v]
      );
    }
  }
  res.json({ code: 200, msg: '保存成功' });
});

// ==================== 行业配置 ====================
router.get('/industries', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM industries ORDER BY sort_order ASC, id ASC');
  res.json({ code: 200, data: rows });
});

router.post('/industries', requireAuth, requireAdmin, async (req, res) => {
  const { id, name, style_hint } = req.body;
  if (!name?.trim()) return res.status(400).json({ code: 400, msg: '行业名称不能为空' });
  if (id) {
    await db.query('UPDATE industries SET name=$1, style_hint=$2 WHERE id=$3', [name.trim(), style_hint || '', id]);
    res.json({ code: 200, msg: '更新成功' });
  } else {
    const { rows } = await db.query('SELECT MAX(sort_order) AS m FROM industries');
    const maxOrder = rows[0].m || 0;
    const { rows: newRows } = await db.query(
      'INSERT INTO industries (name, style_hint, sort_order) VALUES ($1,$2,$3)',
      [name.trim(), style_hint || '', maxOrder + 1]
    );
    res.json({ code: 200, msg: '创建成功', data: { id: newRows[0].id } });
  }
});

router.delete('/industries/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM industries WHERE id=$1', [req.params.id]);
  res.json({ code: 200, msg: '删除成功' });
});

// ==================== ASR 诊断 ====================
router.get('/asr-test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT config_key, value FROM system_config WHERE config_key IN ('asr_url','openai_api_key','openai_base_url')"
    );
    const cfg = {};
    rows.forEach(r => { cfg[r.config_key] = r.value; });

    const asrUrl = (cfg.asr_url || '').trim();
    const openaiKey = (cfg.openai_api_key || '').trim();
    const openaiBase = (cfg.openai_base_url || 'https://api.openai.com/v1').trim();

    const result = {
      asr_url: asrUrl || '(未配置)',
      openai_key: openaiKey ? `已配置 (${openaiKey.slice(0,4)}****)` : '(未配置)',
      openai_base_url: openaiBase,
      asr_ping: '(跳过)',
      whisper_reachable: '(跳过)',
    };

    if (asrUrl) {
      try {
        const r = await fetch(`${asrUrl}/health`, { signal: AbortSignal.timeout(5000) });
        result.asr_ping = r.ok ? `✅ 正常 (${r.status})` : `❌ 返回 ${r.status}`;
      } catch (e) {
        result.asr_ping = `❌ 连接失败: ${e.message}`;
      }
    }

    if (openaiKey) {
      try {
        const r = await fetch(`${openaiBase}/models`, {
          headers: { Authorization: `Bearer ${openaiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        result.whisper_reachable = r.ok ? `✅ 可达 (${r.status})` : `❌ ${r.status}: ${await r.text().then(t => t.slice(0,120))}`;
      } catch (e) {
        result.whisper_reachable = `❌ 连接失败: ${e.message}`;
      }
    }

    res.json({ code: 200, data: result });
  } catch (e) {
    res.status(500).json({ code: 500, msg: e.message });
  }
});

// ==================== H5「我的」页展示开关（默认关闭，后台可打开）====================
router.get('/app-h5-settings', async (req, res) => {
  const out = { showProfilePhone: false, showAccountType: false };
  try {
    const { rows: r1 } = await db.query('SELECT value FROM system_config WHERE config_key=$1', ['h5_show_profile_phone']);
    const { rows: r2 } = await db.query('SELECT value FROM system_config WHERE config_key=$1', ['h5_show_account_type']);
    const v1 = (r1[0]?.value || '').trim();
    const v2 = (r2[0]?.value || '').trim();
    out.showProfilePhone = v1 === '1' || v1 === 'true';
    out.showAccountType = v2 === '1' || v2 === 'true';
  } catch (err) {
    console.error('/app-h5-settings:', err.message);
  }
  res.json({ code: 200, data: out });
});

router.post('/app-h5-settings', requireAuth, requireAdmin, async (req, res) => {
  const { showProfilePhone, showAccountType } = req.body || {};
  const pairs = [];
  if (typeof showProfilePhone === 'boolean') {
    pairs.push(['h5_show_profile_phone', showProfilePhone ? '1' : '0']);
  }
  if (typeof showAccountType === 'boolean') {
    pairs.push(['h5_show_account_type', showAccountType ? '1' : '0']);
  }
  if (!pairs.length) return res.status(400).json({ code: 400, msg: '无有效参数' });
  for (const [k, v] of pairs) {
    await db.query(
      `INSERT INTO system_config (config_key, value, updated_at) VALUES ($1, $2, NOW())
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()`,
      [k, v]
    );
  }
  res.json({ code: 200, msg: '已保存' });
});

module.exports = router;
