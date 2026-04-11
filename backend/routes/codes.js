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
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

// 获取授权码列表
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await db.query(`
    SELECT c.*, u.phone, u.nickname
    FROM auth_codes c
    LEFT JOIN users u ON c.user_id = u.id
    ORDER BY c.created_at DESC
  `);
  res.json({ code: 200, data: rows });
});

// 批量生成授权码
router.post('/batch', requireAuth, requireAdmin, async (req, res) => {
  const { count = 1, days = 30, daily_limit = 30 } = req.body;
  const n = Math.min(Math.max(1, parseInt(count) || 1), 100);
  const codes = [];

  for (let i = 0; i < n; i++) {
    let code;
    let exists = true;
    while (exists) {
      code = genCode();
      const { rows } = await db.query('SELECT id FROM auth_codes WHERE code=$1', [code]);
      exists = rows.length > 0;
    }
    await db.query('INSERT INTO auth_codes (code, days, daily_limit) VALUES ($1,$2,$3)',
      [code, parseInt(days), parseInt(daily_limit)]);
    codes.push(code);
  }

  res.json({ code: 200, msg: `已生成 ${n} 个授权码`, data: codes });
});

// 更新授权码
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { days, daily_limit, status } = req.body;
  await db.query('UPDATE auth_codes SET days=$1, daily_limit=$2, status=$3 WHERE id=$4',
    [parseInt(days), parseInt(daily_limit), status, req.params.id]);

  if (status === 'disabled') {
    const { rows } = await db.query('SELECT user_id FROM auth_codes WHERE id=$1', [req.params.id]);
    const uid = rows[0]?.user_id;
    if (uid) {
      await db.query('UPDATE users SET daily_limit=5, auth_code_id=NULL, auth_expires_at=NULL WHERE id=$1', [uid]);
    }
  }

  res.json({ code: 200, msg: '更新成功' });
});

// 删除授权码
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM auth_codes WHERE id=$1', [req.params.id]);
  res.json({ code: 200, msg: '删除成功' });
});

module.exports = router;
