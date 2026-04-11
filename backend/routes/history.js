const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { type } = req.query;
  let rows;
  if (type) {
    ({ rows } = await db.query(
      'SELECT id, type, input, result, created_at FROM history WHERE user_id=$1 AND type=$2 ORDER BY id DESC LIMIT 50',
      [req.userId, type]
    ));
  } else {
    ({ rows } = await db.query(
      'SELECT id, type, input, result, created_at FROM history WHERE user_id=$1 ORDER BY id DESC LIMIT 50',
      [req.userId]
    ));
  }
  rows = rows.map(r => {
    try { r.result = JSON.parse(r.result); } catch {}
    return r;
  });
  res.json({ code: 200, data: rows });
});

router.delete('/:id', requireAuth, async (req, res) => {
  await db.query('DELETE FROM history WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  res.json({ code: 200, msg: '已删除' });
});

router.delete('/', requireAuth, async (req, res) => {
  const { type } = req.query;
  if (type) {
    await db.query('DELETE FROM history WHERE user_id=$1 AND type=$2', [req.userId, type]);
  } else {
    await db.query('DELETE FROM history WHERE user_id=$1', [req.userId]);
  }
  res.json({ code: 200, msg: '已清空' });
});

module.exports = router;
