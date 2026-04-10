const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('./auth');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ code: 403, msg: '权限不足' });
  next();
}

function genCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase(); // 10位
}

// 获取授权码列表（管理员）
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, u.phone, u.nickname
    FROM auth_codes c
    LEFT JOIN users u ON c.user_id = u.id
    ORDER BY c.created_at DESC
  `).all();
  res.json({ code: 200, data: rows });
});

// 批量生成授权码
router.post('/batch', requireAuth, requireAdmin, (req, res) => {
  const { count = 1, days = 30, daily_limit = 30 } = req.body;
  const n = Math.min(Math.max(1, parseInt(count) || 1), 100);
  const codes = [];
  const insert = db.prepare('INSERT INTO auth_codes (code, days, daily_limit) VALUES (?,?,?)');
  for (let i = 0; i < n; i++) {
    let code;
    do { code = genCode(); } while (db.prepare('SELECT id FROM auth_codes WHERE code=?').get(code));
    insert.run(code, parseInt(days), parseInt(daily_limit));
    codes.push(code);
  }
  res.json({ code: 200, msg: `已生成 ${n} 个授权码`, data: codes });
});

// 更新授权码配置
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const { days, daily_limit, status } = req.body;
  db.prepare('UPDATE auth_codes SET days=?, daily_limit=?, status=? WHERE id=?')
    .run(parseInt(days), parseInt(daily_limit), status, req.params.id);
  // 关闭授权：同步降级绑定用户
  if (status === 'disabled') {
    const authCode = db.prepare('SELECT user_id FROM auth_codes WHERE id=?').get(req.params.id);
    if (authCode?.user_id) {
      db.prepare('UPDATE users SET daily_limit=5, auth_code_id=NULL, auth_expires_at=NULL WHERE id=?')
        .run(authCode.user_id);
    }
  }
  res.json({ code: 200, msg: '更新成功' });
});

// 删除授权码
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM auth_codes WHERE id=?').run(req.params.id);
  res.json({ code: 200, msg: '删除成功' });
});

module.exports = router;
