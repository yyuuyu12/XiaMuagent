const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const router = express.Router();

// GET /api/tasks - 列出当前用户任务（最近 30 条），联查 session clone_step
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT t.id, t.type, t.title, t.status, t.stage, t.progress, t.thinking, t.error_msg, t.created_at, t.updated_at, t.result,
              COALESCE(ts.clone_step, CASE WHEN t.status = 'done' THEN 2 ELSE 1 END) AS clone_step,
              GREATEST(t.updated_at, COALESCE(ts.updated_at, t.updated_at)) AS activity_at
       FROM tasks t
       LEFT JOIN task_sessions ts ON ts.task_id = t.id AND ts.user_id = t.user_id
       WHERE t.user_id = $1
       ORDER BY activity_at DESC LIMIT 30`,
      [req.userId]
    );
    const data = rows.map(row => {
      const task = { ...row };
      if (task.type === 'clone_video' && task.result) {
        try {
          const result = typeof task.result === 'string' ? JSON.parse(task.result) : task.result;
          if (result && result.source === 'featured') task.task_kind = 'industry';
        } catch {}
      }
      delete task.result;
      return task;
    });
    res.json({ code: 200, data });
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

    // 如果前端传来了用户修改后的文案，写回 DB result.transcript
    const { editedTranscript } = req.body;
    if (editedTranscript && editedTranscript.trim()) {
      const { rows: resultRows } = await db.query('SELECT result FROM tasks WHERE id=$1', [req.params.id]);
      let existing = {};
      try { existing = typeof resultRows[0].result === 'string' ? JSON.parse(resultRows[0].result) : (resultRows[0].result || {}); } catch {}
      existing.transcript = editedTranscript.trim();
      await db.query(
        "UPDATE tasks SET status='pending', thinking='', result=$2, updated_at=NOW() WHERE id=$1",
        [req.params.id, JSON.stringify(existing)]
      );
    } else {
      await db.query(
        "UPDATE tasks SET status='pending', thinking='', updated_at=NOW() WHERE id=$1",
        [req.params.id]
      );
    }
    require('../taskRunner').enqueue({ taskId: req.params.id, type: 'clone_video' });
    res.json({ code: 200, msg: '改写任务已提交' });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// POST /api/tasks/:id/set-rewritten - 前端改写完成后把任务状态改为 done
router.post('/:id/set-rewritten', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, status, type, result FROM tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!rows[0]) return res.status(404).json({ code: 404, msg: '任务不存在' });
    if (rows[0].type !== 'clone_video') return res.status(400).json({ code: 400, msg: '仅支持克隆任务' });

    const { rewrittenScript } = req.body;
    if (!rewrittenScript?.trim()) return res.status(400).json({ code: 400, msg: '改写内容不能为空' });

    // 合并到已有 result（保留 transcript 等）
    let existing = {};
    try { existing = JSON.parse(rows[0].result || '{}'); } catch {}
    existing.rewritten = rewrittenScript.trim();

    await db.query(
      "UPDATE tasks SET status='done', result=$2, updated_at=NOW() WHERE id=$1",
      [req.params.id, JSON.stringify(existing)]
    );
    res.json({ code: 200, msg: 'ok' });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// GET /api/tasks/:id/session - 读取克隆任务跨会话状态
router.get('/:id/session', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT clone_step, session_json FROM task_sessions WHERE task_id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!rows[0]) return res.json({ code: 200, data: null }); // 未保存过，返回 null
    let session = null;
    try { session = JSON.parse(rows[0].session_json); } catch { session = null; }
    res.json({ code: 200, data: { clone_step: rows[0].clone_step, session } });
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// POST /api/tasks/:id/session - 保存克隆任务跨会话状态（upsert）
router.post('/:id/session', requireAuth, async (req, res) => {
  try {
    // 先验证任务属于该用户
    const { rows } = await db.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!rows[0]) return res.status(404).json({ code: 404, msg: '任务不存在' });

    const { clone_step, session } = req.body;
    if (clone_step == null) return res.status(400).json({ code: 400, msg: 'clone_step 必填' });

    const sessionJson = JSON.stringify(session || {});
    // MySQL UPSERT：存在则更新，不存在则插入
    await db.query(
      `INSERT INTO task_sessions (task_id, user_id, clone_step, session_json)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE clone_step = VALUES(clone_step), session_json = VALUES(session_json), updated_at = NOW()`,
      [req.params.id, req.userId, clone_step, sessionJson]
    );
    await db.query(
      'UPDATE tasks SET updated_at = NOW() WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    res.json({ code: 200, msg: 'ok' });
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
