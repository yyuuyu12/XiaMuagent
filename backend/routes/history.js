const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const router = express.Router();

// 获取历史记录（最近50条）
router.get('/', requireAuth, (req, res) => {
  const { type } = req.query;
  let rows;
  if (type) {
    rows = db.prepare(
      `SELECT id, type, input, result, created_at FROM history WHERE user_id=? AND type=? ORDER BY id DESC LIMIT 50`
    ).all(req.userId, type);
  } else {
    rows = db.prepare(
      `SELECT id, type, input, result, created_at FROM history WHERE user_id=? ORDER BY id DESC LIMIT 50`
    ).all(req.userId);
  }
  // result 是 JSON 字符串，解析后返回
  rows = rows.map(r => {
    try { r.result = JSON.parse(r.result); } catch {}
    return r;
  });
  res.json({ code: 200, data: rows });
});

// 删除一条历史记录
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM history WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ code: 200, msg: '已删除' });
});

// 清空历史记录
router.delete('/', requireAuth, (req, res) => {
  const { type } = req.query;
  if (type) {
    db.prepare('DELETE FROM history WHERE user_id=? AND type=?').run(req.userId, type);
  } else {
    db.prepare('DELETE FROM history WHERE user_id=?').run(req.userId);
  }
  res.json({ code: 200, msg: '已清空' });
});

module.exports = router;
