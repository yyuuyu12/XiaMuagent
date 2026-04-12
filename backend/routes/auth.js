const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const JWT_EXPIRES = '7d';

// ==================== 注册 ====================
router.post('/register', async (req, res) => {
  const { phone, password, nickname } = req.body;
  if (!phone || !password) return res.status(400).json({ code: 400, msg: '手机号和密码不能为空' });
  if (!/^1[3-9]\d{9}$/.test(phone)) return res.status(400).json({ code: 400, msg: '手机号格式不正确' });
  if (password.length < 6) return res.status(400).json({ code: 400, msg: '密码至少6位' });

  try {
    const { rows: existing } = await db.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existing.length > 0) return res.status(409).json({ code: 409, msg: '该手机号已注册，请直接登录' });

    const hashed = bcrypt.hashSync(password, 10);
    const name = nickname || `用户${phone.slice(-4)}`;
    const { rows: ins } = await db.query(
      'INSERT INTO users (phone, password, nickname) VALUES ($1, $2, $3)',
      [phone, hashed, name]
    );
    const { rows } = await db.query(
      'SELECT id, phone, nickname, avatar, role FROM users WHERE id = $1',
      [ins[0].id]
    );
    const user = rows[0];
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ code: 200, msg: '注册成功', data: { token, user } });
  } catch (err) {
    console.error('/register error:', err.message);
    res.status(500).json({ code: 500, msg: '注册失败，请稍后重试' });
  }
});

// ==================== 登录 ====================
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ code: 400, msg: '手机号和密码不能为空' });

  try {
    const { rows } = await db.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const user = rows[0];
    if (!user) return res.status(401).json({ code: 401, msg: '手机号未注册' });

    const match = bcrypt.compareSync(password, user.password);
    if (!match) return res.status(401).json({ code: 401, msg: '密码错误' });

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    const { password: _, avatar_image: _ai, ...safeUser } = user;
    res.json({ code: 200, msg: '登录成功', data: { token, user: safeUser } });
  } catch (err) {
    console.error('/login error:', err.message);
    res.status(500).json({ code: 500, msg: '登录失败，请稍后重试' });
  }
});

// ==================== 获取当前用户信息 ====================
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, phone, nickname, avatar, avatar_image, brand_name, role, daily_limit, auth_code_id, auth_expires_at, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (!rows[0]) return res.status(404).json({ code: 404, msg: '用户不存在' });
    const user = rows[0];

    const { rows: usageRows } = await db.query(
      'SELECT COUNT(*) AS cnt FROM usage_logs WHERE user_id = $1 AND DATE(created_at) = CURRENT_DATE',
      [req.userId]
    );
    const usedToday = parseInt(usageRows[0].cnt);
    const isAdmin = user.role === 'admin';
    const remaining = isAdmin ? 999 : Math.max(0, user.daily_limit - usedToday);
    const dailyLimitOut = isAdmin ? 999 : user.daily_limit;

    res.json({
      code: 200,
      data: { ...user, daily_limit: dailyLimitOut, used_today: usedToday, remaining }
    });
  } catch (err) {
    console.error('/me error:', err.message);
    res.status(500).json({ code: 500, msg: '获取用户信息失败' });
  }
});

// ==================== 激活授权码 ====================
router.post('/activate-code', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code?.trim()) return res.status(400).json({ code: 400, msg: '请输入授权码' });

  try {
    const { rows: codeRows } = await db.query('SELECT * FROM auth_codes WHERE code = $1', [code.trim().toUpperCase()]);
    const authCode = codeRows[0];
    if (!authCode) return res.status(404).json({ code: 404, msg: '授权码无效，请检查后重新输入' });
    if (authCode.status === 'active') return res.status(400).json({ code: 400, msg: '该授权码已被激活，无法重复使用' });
    if (authCode.status === 'disabled' || authCode.days <= 0) return res.status(400).json({ code: 400, msg: '该授权码已失效，请联系管理员' });

    const { rows: userRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = userRows[0];
    if (user.auth_code_id) {
      const { rows: existCodeRows } = await db.query('SELECT * FROM auth_codes WHERE id = $1', [user.auth_code_id]);
      const existCode = existCodeRows[0];
      if (existCode?.status === 'active' && user.auth_expires_at && new Date(user.auth_expires_at) > new Date()) {
        return res.status(400).json({ code: 400, msg: '您已有有效授权码，激活失败' });
      }
    }

    const now = new Date();
    const activatedAt = now.toISOString().replace('T', ' ').slice(0, 19);
    const expiresAt = new Date(now.getTime() + authCode.days * 86400000).toISOString().replace('T', ' ').slice(0, 19);

    await db.query('UPDATE auth_codes SET status=$1, user_id=$2, activated_at=$3 WHERE id=$4',
      ['active', req.userId, activatedAt, authCode.id]);
    await db.query('UPDATE users SET daily_limit=$1, auth_code_id=$2, auth_expires_at=$3 WHERE id=$4',
      [authCode.daily_limit, authCode.id, expiresAt, req.userId]);

    res.json({
      code: 200,
      msg: `激活成功！已获得 ${authCode.days} 天免费使用资格，每日可用 ${authCode.daily_limit} 次`,
      data: { days: authCode.days, daily_limit: authCode.daily_limit, expires_at: expiresAt }
    });
  } catch (err) {
    console.error('/activate-code error:', err.message);
    res.status(500).json({ code: 500, msg: '激活失败，请稍后重试' });
  }
});

// ==================== 微信小程序登录 ====================
router.post('/wx-login', async (req, res) => {
  const { code, nickname } = req.body;
  if (!code) return res.status(400).json({ code: 400, msg: '缺少登录code' });

  const APPID = process.env.WX_APPID;
  const SECRET = process.env.WX_SECRET;
  if (!APPID || !SECRET) return res.status(500).json({ code: 500, msg: '服务器未配置微信AppID/Secret，请联系管理员' });

  const https = require('https');
  const wxUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${SECRET}&js_code=${code}&grant_type=authorization_code`;

  https.get(wxUrl, (r) => {
    let raw = '';
    r.on('data', chunk => { raw += chunk; });
    r.on('end', async () => {
      try {
        const wxData = JSON.parse(raw);
        if (wxData.errcode) return res.status(400).json({ code: 400, msg: `微信授权失败(${wxData.errmsg})，请重试` });

        const openid = wxData.openid;
        const { rows } = await db.query('SELECT * FROM users WHERE openid = $1', [openid]);
        let user = rows[0];

        if (!user) {
          const wxPhone = `wx_${openid}`;
          const wxPassword = bcrypt.hashSync(openid.slice(0, 12), 6);
          const wxNickname = nickname || `微信用户${openid.slice(-4)}`;
          const { rows: ins2 } = await db.query(
            'INSERT INTO users (phone, password, nickname, openid) VALUES ($1,$2,$3,$4)',
            [wxPhone, wxPassword, wxNickname, openid]
          );
          const { rows: newRows } = await db.query(
            'SELECT id, phone, nickname, avatar, role, daily_limit, auth_code_id, auth_expires_at FROM users WHERE id = $1',
            [ins2[0].id]
          );
          user = newRows[0];
        } else {
          const { password: _, avatar_image: _aim, ...safe } = user;
          user = safe;
        }

        const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
        res.json({ code: 200, msg: '登录成功', data: { token, user } });
      } catch (err) {
        console.error('/wx-login error:', err.message);
        res.status(500).json({ code: 500, msg: '登录失败，请稍后重试' });
      }
    });
  }).on('error', () => res.status(500).json({ code: 500, msg: '网络错误，请稍后重试' }));
});

// ==================== 修改头像 ====================
router.post('/update-avatar', requireAuth, async (req, res) => {
  const { avatar } = req.body;
  await db.query('UPDATE users SET avatar = $1, avatar_image = NULL WHERE id = $2', [avatar ?? 0, req.userId]);
  res.json({ code: 200, msg: '更新成功' });
});

// ==================== 修改昵称 / 头像 / 自定义头像图 ====================
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { nickname, avatar, avatar_image, brand_name } = req.body || {};
    const parts = [];
    const vals = [];

    if (nickname !== undefined) {
      parts.push('nickname = ?');
      vals.push(String(nickname || '用户').trim().slice(0, 50) || '用户');
    }
    if (avatar !== undefined) {
      parts.push('avatar = ?');
      vals.push(parseInt(avatar, 10) || 0);
    }
    if (avatar_image !== undefined) {
      if (avatar_image === null || avatar_image === '') {
        parts.push('avatar_image = ?');
        vals.push(null);
      } else if (typeof avatar_image === 'string' && avatar_image.startsWith('data:image')) {
        if (avatar_image.length > 900000) {
          return res.status(400).json({ code: 400, msg: '图片过大，请换一张较小的图片' });
        }
        parts.push('avatar_image = ?');
        vals.push(avatar_image);
      }
    }

    if (brand_name !== undefined) {
      parts.push('brand_name = ?');
      vals.push(String(brand_name || '').trim().slice(0, 100) || null);
    }

    if (!parts.length) return res.status(400).json({ code: 400, msg: '无更新项' });
    vals.push(req.userId);
    await db.query(`UPDATE users SET ${parts.join(', ')} WHERE id = ?`, vals);
    res.json({ code: 200, msg: '更新成功' });
  } catch (err) {
    console.error('/profile error:', err.message);
    res.status(500).json({ code: 500, msg: '更新失败' });
  }
});

// ==================== JWT 中间件 ====================
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ code: 401, msg: '请先登录' });
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
