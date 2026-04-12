const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const router = express.Router();

// GET /api/tasks - 列出当前用户任务（最近 30 条）
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, type, title, status, stage, progress, thinking, error_msg, created_at, updated_at FROM tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30',
      [req.userId]
    );
    res.json({ code: 200, data: rows });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// GET /api/tasks/:id - 获取单个任务详情（含结果）
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!rows[0]) return res.status(404).json({ code: 404, msg: '任务不存在' });

    const task = { ...rows[0] };
    if ((task.status === 'done' || task.status === 'extracted') && task.result) {
      try { task.result = JSON.parse(task.result); } catch { task.result = null; }
    } else {
      task.result = null;
    }
    if (task.input_data) {
      try { task.input_data = JSON.parse(task.input_data); } catch { task.input_data = null; }
    }

    res.json({ code: 200, data: task });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// POST /api/tasks/:id/start-rewrite - 触发克隆任务的改写阶段
router.post('/:id/start-rewrite', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, status, type FROM tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!rows[0]) return res.status(404).json({ code: 404, msg: '任务不存在' });
    if (rows[0].type !== 'clone_video') return res.status(400).json({ code: 400, msg: '任务类型不支持' });
    if (rows[0].status !== 'extracted') return res.status(400).json({ code: 400, msg: '文案尚未提取完成' });
    await db.query(
      "UPDATE tasks SET status='pending', thinking='', updated_at=NOW() WHERE id=$1",
      [req.params.id]
    );
    require('../taskRunner').enqueue({ taskId: req.params.id, type: 'clone_video' });
    res.json({ code: 200, msg: '改写任务已提交' });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// DELETE /api/tasks/:id - 删除任务（仅限 done / failed）
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, status FROM tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!rows[0]) return res.status(404).json({ code: 404, msg: '任务不存在' });
    if (rows[0].status === 'pending' || rows[0].status === 'running') {
      return res.status(400).json({ code: 400, msg: '进行中的任务无法删除' });
    }
    await db.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.json({ code: 200, msg: '已删除' });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

module.exports = router;
