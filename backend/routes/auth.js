const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const JWT_EXPIRES = '7d'; // token 有效期 7 天

// ==================== 注册 ====================
router.post('/register', (req, res) => {
  const { phone, password, nickname } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ code: 400, msg: '手机号和密码不能为空' });
  }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ code: 400, msg: '手机号格式不正确' });
  }
  if (password.length < 6) {
    return res.status(400).json({ code: 400, msg: '密码至少6位' });
  }

  // 检查是否已注册
  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (existing) {
    return res.status(409).json({ code: 409, msg: '该手机号已注册，请直接登录' });
  }

  const hashed = bcrypt.hashSync(password, 10);
  const name = nickname || `用户${phone.slice(-4)}`;

  const result = db.prepare(
    'INSERT INTO users (phone, password, nickname) VALUES (?, ?, ?)'
  ).run(phone, hashed, name);

  const user = db.prepare('SELECT id, phone, nickname, avatar, role FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

  res.json({ code: 200, msg: '注册成功', data: { token, user } });
});

// ==================== 登录 ====================
router.post('/login', (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ code: 400, msg: '手机号和密码不能为空' });
  }

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    return res.status(401).json({ code: 401, msg: '手机号未注册' });
  }

  const match = bcrypt.compareSync(password, user.password);
  if (!match) {
    return res.status(401).json({ code: 401, msg: '密码错误' });
  }

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  const { password: _, ...safeUser } = user;

  res.json({ code: 200, msg: '登录成功', data: { token, user: safeUser } });
});

// ==================== 获取当前用户信息 ====================
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(
    'SELECT id, phone, nickname, avatar, role, daily_limit, auth_code_id, auth_expires_at, created_at FROM users WHERE id = ?'
  ).get(req.userId);

  if (!user) return res.status(404).json({ code: 404, msg: '用户不存在' });

  // 查询今日使用次数
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = db.prepare(
    `SELECT COUNT(*) as cnt FROM usage_logs WHERE user_id = ? AND created_at LIKE ?`
  ).get(req.userId, `${today}%`);

  res.json({
    code: 200,
    data: {
      ...user,
      used_today: usedToday.cnt,
      remaining: Math.max(0, user.daily_limit - usedToday.cnt)
    }
  });
});

// ==================== 激活授权码 ====================
router.post('/activate-code', requireAuth, (req, res) => {
  const { code } = req.body;
  if (!code?.trim()) return res.status(400).json({ code: 400, msg: '请输入授权码' });

  const authCode = db.prepare('SELECT * FROM auth_codes WHERE code = ?').get(code.trim().toUpperCase());
  if (!authCode) return res.status(404).json({ code: 404, msg: '授权码无效，请检查后重新输入' });
  if (authCode.status === 'active') return res.status(400).json({ code: 400, msg: '该授权码已被激活，无法重复使用' });
  if (authCode.status === 'disabled' || authCode.days <= 0) return res.status(400).json({ code: 400, msg: '该授权码已失效，请联系管理员' });

  // 检查用户是否已有有效授权
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (user.auth_code_id) {
    const existCode = db.prepare('SELECT * FROM auth_codes WHERE id = ?').get(user.auth_code_id);
    if (existCode && existCode.status === 'active') {
      const expiry = user.auth_expires_at;
      if (!expiry || new Date(expiry) > new Date()) {
        return res.status(400).json({ code: 400, msg: '您已有有效授权码，激活失败' });
      }
    }
  }

  const now = new Date();
  const activatedAt = now.toISOString().replace('T', ' ').slice(0, 19);
  const expiresAt = new Date(now.getTime() + authCode.days * 86400000).toISOString().replace('T', ' ').slice(0, 19);

  // 激活
  db.prepare('UPDATE auth_codes SET status=?, user_id=?, activated_at=? WHERE id=?')
    .run('active', req.userId, activatedAt, authCode.id);
  db.prepare('UPDATE users SET daily_limit=?, auth_code_id=?, auth_expires_at=? WHERE id=?')
    .run(authCode.daily_limit, authCode.id, expiresAt, req.userId);

  res.json({
    code: 200,
    msg: `激活成功！已获得 ${authCode.days} 天免费使用资格，每日可用 ${authCode.daily_limit} 次`,
    data: { days: authCode.days, daily_limit: authCode.daily_limit, expires_at: expiresAt }
  });
});

// ==================== 微信小程序登录 ====================
router.post('/wx-login', (req, res) => {
  const { code, nickname } = req.body;
  if (!code) return res.status(400).json({ code: 400, msg: '缺少登录code' });

  const APPID  = process.env.WX_APPID;
  const SECRET = process.env.WX_SECRET;
  if (!APPID || !SECRET) {
    return res.status(500).json({ code: 500, msg: '服务器未配置微信AppID/Secret，请联系管理员' });
  }

  const https = require('https');
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${SECRET}&js_code=${code}&grant_type=authorization_code`;

  https.get(url, (r) => {
    let raw = '';
    r.on('data', chunk => { raw += chunk; });
    r.on('end', () => {
      let wxData;
      try { wxData = JSON.parse(raw); } catch { return res.status(500).json({ code: 500, msg: '微信服务器响应异常' }); }

      if (wxData.errcode) {
        return res.status(400).json({ code: 400, msg: `微信授权失败(${wxData.errmsg})，请重试` });
      }

      const openid = wxData.openid;
      // 查找已有用户
      let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);

      if (!user) {
        // 新建微信用户（phone用wx_前缀占位，password用hash占位）
        const wxPhone    = `wx_${openid}`;
        const wxPassword = bcrypt.hashSync(openid.slice(0, 12), 6);
        const wxNickname = nickname || `微信用户${openid.slice(-4)}`;
        const result = db.prepare(
          'INSERT INTO users (phone, password, nickname, openid) VALUES (?, ?, ?, ?)'
        ).run(wxPhone, wxPassword, wxNickname, openid);
        user = db.prepare('SELECT id, phone, nickname, avatar, role, daily_limit, auth_code_id, auth_expires_at FROM users WHERE id = ?').get(result.lastInsertRowid);
      } else {
        const { password: _, ...safe } = user;
        user = safe;
      }

      const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
      res.json({ code: 200, msg: '登录成功', data: { token, user } });
    });
  }).on('error', () => {
    res.status(500).json({ code: 500, msg: '网络错误，请稍后重试' });
  });
});

// ==================== 修改头像（小程序专用） ====================
router.post('/update-avatar', requireAuth, (req, res) => {
  const { avatar } = req.body;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar ?? 0, req.userId);
  res.json({ code: 200, msg: '更新成功' });
});

// ==================== 修改昵称/头像 ====================
router.put('/profile', requireAuth, (req, res) => {
  const { nickname, avatar } = req.body;
  db.prepare('UPDATE users SET nickname = ?, avatar = ? WHERE id = ?')
    .run(nickname || '用户', avatar ?? 0, req.userId);
  res.json({ code: 200, msg: '更新成功' });
});

// ==================== 中间件：验证 JWT ====================
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, msg: '请先登录' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    req.userId = payload.id;
    req.userRole = payload.role;
    next();
  } catch {
    res.status(401).json({ code: 401, msg: 'token 已过期，请重新登录' });
  }
}

module.exports = { router, requireAuth };
