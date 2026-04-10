// 系统配置路由：AI Key 管理、提示词模板（仅管理员）
const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const router = express.Router();

// ==================== 中间件：仅管理员 ====================
function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ code: 403, msg: '权限不足，仅管理员可操作' });
  }
  next();
}

// ==================== AI Key 配置 ====================

// 获取 AI Key 配置（管理员）
router.get('/ai-keys', requireAuth, requireAdmin, (req, res) => {
  const keys = [
    'ai_provider',     // openai / claude / qwen / zhipu
    'openai_api_key',
    'openai_base_url',
    'openai_model',
    'claude_api_key',
    'claude_model',
    'qwen_api_key',
    'qwen_model',
    'zhipu_api_key',
    'zhipu_model',
    'tikhub_api_key',  // 抖音解析服务 Key
  ];

  const result = {};
  for (const k of keys) {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(k);
    // 隐藏 key 的中间部分
    let val = row?.value || '';
    if (k.includes('key') && val.length > 8) {
      val = val.slice(0, 4) + '****' + val.slice(-4);
    }
    result[k] = val;
  }

  res.json({ code: 200, data: result });
});

// 保存 AI Key 配置（管理员）
router.post('/ai-keys', requireAuth, requireAdmin, (req, res) => {
  const allowedKeys = [
    'ai_provider', 'openai_api_key', 'openai_base_url', 'openai_model',
    'claude_api_key', 'claude_model', 'qwen_api_key', 'qwen_model',
    'zhipu_api_key', 'zhipu_model', 'tikhub_api_key'
  ];

  const upsert = db.prepare(`
    INSERT INTO system_config (key, value, updated_at)
    VALUES (?, ?, datetime('now', 'localtime'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  for (const [k, v] of Object.entries(req.body)) {
    if (allowedKeys.includes(k) && v !== undefined) {
      // 如果 value 全是 * 说明用户没改，跳过
      if (typeof v === 'string' && v.includes('****')) continue;
      upsert.run(k, v);
    }
  }

  res.json({ code: 200, msg: '配置已保存' });
});

// ==================== 提示词模板 ====================

// 获取提示词列表
router.get('/prompts', requireAuth, (req, res) => {
  const { type } = req.query;
  let rows;
  if (type) {
    rows = db.prepare('SELECT * FROM prompt_templates WHERE type = ? ORDER BY is_default DESC, id ASC').all(type);
  } else {
    rows = db.prepare('SELECT * FROM prompt_templates ORDER BY type, is_default DESC, id ASC').all();
  }
  res.json({ code: 200, data: rows });
});

// 创建/更新提示词（管理员）
router.post('/prompts', requireAuth, requireAdmin, (req, res) => {
  const { id, name, type, content } = req.body;
  if (!name || !type || !content) {
    return res.status(400).json({ code: 400, msg: '参数不完整' });
  }

  if (id) {
    db.prepare('UPDATE prompt_templates SET name=?, type=?, content=? WHERE id=?')
      .run(name, type, content, id);
    res.json({ code: 200, msg: '更新成功' });
  } else {
    const r = db.prepare('INSERT INTO prompt_templates (name, type, content) VALUES (?, ?, ?)').run(name, type, content);
    res.json({ code: 200, msg: '创建成功', data: { id: r.lastInsertRowid } });
  }
});

// 删除提示词（管理员，不能删默认）
router.delete('/prompts/:id', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT is_default FROM prompt_templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ code: 404, msg: '不存在' });
  if (row.is_default) return res.status(400).json({ code: 400, msg: '默认模板不能删除' });
  db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(req.params.id);
  res.json({ code: 200, msg: '删除成功' });
});

// ==================== 会员套餐配置 ====================

router.get('/member-plans', (req, res) => {
  const keys = ['member_plan_day_price','member_plan_week_price','member_plan_month_price','member_plan_forever_price','member_note'];
  const result = {};
  for (const k of keys) result[k] = db.prepare('SELECT value FROM system_config WHERE key=?').get(k)?.value || '';
  res.json({ code: 200, data: result });
});

router.post('/member-plans', requireAuth, requireAdmin, (req, res) => {
  const allowed = ['member_plan_day_price','member_plan_week_price','member_plan_month_price','member_plan_forever_price','member_note'];
  const upsert = db.prepare(`INSERT INTO system_config (key,value,updated_at) VALUES (?,?,datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`);
  for (const [k,v] of Object.entries(req.body)) {
    if (allowed.includes(k)) upsert.run(k, v);
  }
  res.json({ code: 200, msg: '保存成功' });
});

// ==================== 行业配置 ====================

// 获取行业列表（登录用户可读）
router.get('/industries', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM industries ORDER BY sort_order ASC, id ASC').all();
  res.json({ code: 200, data: rows });
});

// 新增/更新行业（管理员）
router.post('/industries', requireAuth, requireAdmin, (req, res) => {
  const { id, name, style_hint } = req.body;
  if (!name?.trim()) return res.status(400).json({ code: 400, msg: '行业名称不能为空' });
  if (id) {
    db.prepare('UPDATE industries SET name=?, style_hint=? WHERE id=?').run(name.trim(), style_hint || '', id);
    res.json({ code: 200, msg: '更新成功' });
  } else {
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM industries').get().m || 0;
    const r = db.prepare('INSERT INTO industries (name, style_hint, sort_order) VALUES (?,?,?)').run(name.trim(), style_hint || '', maxOrder + 1);
    res.json({ code: 200, msg: '创建成功', data: { id: r.lastInsertRowid } });
  }
});

// 删除行业（管理员）
router.delete('/industries/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM industries WHERE id=?').run(req.params.id);
  res.json({ code: 200, msg: '删除成功' });
});

module.exports = router;
