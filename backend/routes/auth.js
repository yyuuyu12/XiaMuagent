const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const JWT_EXPIRES = '7d';

// ==================== 阿里云短信发送 ====================
async function sendAliyunSms(phone, code, templateCode) {
  const Core = require('@alicloud/pop-core');
  const client = new Core({
    accessKeyId: process.env.ALIYUN_SMS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_SMS_KEY_SECRET,
    endpoint: 'https://dysmsapi.aliyuncs.com',
    apiVersion: '2017-05-25',
  });
  const result = await client.request('SendSms', {
    PhoneNumbers: phone,
    SignName: process.env.ALIYUN_SMS_SIGN || '烽鹏网络',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
  }, { method: 'POST' });
  if (result.Code !== 'OK') throw new Error(`短信发送失败：${result.Message || result.Code}`);
}

// ==================== 发送验证码 ====================
router.post('/send-sms', async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ code: 400, msg: '手机号格式不正确' });
  }

  try {
    // 60秒内只能发一次
    const { rows: recent } = await db.query(
      'SELECT id FROM sms_codes WHERE phone=? AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND) LIMIT 1',
      [phone]
    );
    if (recent.length > 0) {
      return res.status(429).json({ code: 429, msg: '发送太频繁，请60秒后再试' });
    }

    // 判断是新用户还是老用户，选模板
    const { rows: userRows } = await db.query('SELECT id FROM users WHERE phone=?', [phone]);
    const isNew = userRows.length === 0;
    const templateCode = isNew
      ? (process.env.ALIYUN_SMS_TEMPLATE_REG || 'SMS_505140372')
      : (process.env.ALIYUN_SMS_TEMPLATE_LOGIN || 'SMS_504845448');

    // 生成6位验证码
    const code = String(Math.floor(100000 + Math.random() * 900000));

    // 写入数据库（5分钟有效）
    await db.query(
      'INSERT INTO sms_codes (phone, code, type, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))',
      [phone, code, isNew ? 'register' : 'login']
    );

    // 发送短信
    await sendAliyunSms(phone, code, templateCode);

    res.json({ code: 200, msg: '验证码已发送', data: { isNew } });
  } catch (err) {
    console.error('/send-sms error:', err.message);
    res.status(500).json({ code: 500, msg: err.message || '发送失败，请稍后重试' });
  }
});

// ==================== 验证码登录 / 注册 ====================
router.post('/sms-login', async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ code: 400, msg: '手机号和验证码不能为空' });
  if (!/^1[3-9]\d{9}$/.test(phone)) return res.status(400).json({ code: 400, msg: '手机号格式不正确' });

  try {
    // 找最近一条未使用且未过期的验证码
    const { rows: codeRows } = await db.query(
      'SELECT * FROM sms_codes WHERE phone=? AND used=0 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [phone]
    );
    const smsRecord = codeRows[0];
    if (!smsRecord || smsRecord.code !== String(code).trim()) {
      return res.status(401).json({ code: 401, msg: '验证码错误或已过期' });
    }

    // 标记已使用
    await db.query('UPDATE sms_codes SET used=1 WHERE id=?', [smsRecord.id]);

    // 查用户，不存在则自动注册
    const { rows: userRows } = await db.query('SELECT * FROM users WHERE phone=?', [phone]);
    let user = userRows[0];
    if (!user) {
      const nickname = `用户${phone.slice(-4)}`;
      const { rows: ins } = await db.query(
        'INSERT INTO users (phone, nickname) VALUES (?, ?)',
        [phone, nickname]
      );
      const { rows: newRows } = await db.query(
        'SELECT id, phone, nickname, avatar, role, daily_limit, auth_code_id, auth_expires_at FROM users WHERE id=?',
        [ins[0]?.insertId || ins[0]?.id]
      );
      user = newRows[0];
    }

    const { password: _, avatar_image: _ai, ...safeUser } = user;
    const token = jwt.sign({ id: safeUser.id, role: safeUser.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    const isNew = smsRecord.type === 'register';
    res.json({ code: 200, msg: isNew ? '注册成功' : '登录成功', data: { token, user: safeUser, isNew } });
  } catch (err) {
    console.error('/sms-login error:', err.message);
    res.status(500).json({ code: 500, msg: '登录失败，请稍后重试' });
  }
});

// ==================== 设置/修改密码 ====================
router.post('/set-password', requireAuth, async (req, res) => {
  const { sms_code, new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ code: 400, msg: '新密码至少6位' });
  }
  try {
    const { rows } = await db.query('SELECT password, phone FROM users WHERE id=?', [req.userId]);
    const user = rows[0];
    if (!user) return res.status(404).json({ code: 404, msg: '用户不存在' });

    // 已有密码时，必须通过短信验证码验证身份
    if (user.password) {
      if (!sms_code) return res.status(400).json({ code: 400, msg: '请输入验证码' });
      const { rows: codeRows } = await db.query(
        'SELECT * FROM sms_codes WHERE phone=? AND used=0 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
        [user.phone]
      );
      const rec = codeRows[0];
      if (!rec || rec.code !== String(sms_code).trim()) {
        return res.status(401).json({ code: 401, msg: '验证码错误或已过期' });
      }
      await db.query('UPDATE sms_codes SET used=1 WHERE id=?', [rec.id]);
    }

    const hashed = bcrypt.hashSync(new_password, 10);
    await db.query('UPDATE users SET password=? WHERE id=?', [hashed, req.userId]);
    res.json({ code: 200, msg: '密码修改成功' });
  } catch (err) {
    console.error('/set-password error:', err.message);
    res.status(500).json({ code: 500, msg: '操作失败，请稍后重试' });
  }
});

// ==================== 注册 ====================
router.post('/register', async (req, res) => {
  const { phone, password, nickname } = req.body;
  if (!phone || !password) return res.status(400).json({ code: 400, msg: '手机号和密码不能为空' });
  if (!/^1[3-9]\d{9}$/.test(phone)) return res.status(400).json({ code: 400, msg: '手机号格式不正确' });
  if (password.length < 6) return res.status(400).json({ code: 400, msg: '密码至少6位' });

  try {
    const { rows: existing } = await db.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existing.length > 0) return res.status(409).json({ code: 409, msg: '该手机号已注册，请直接登录' });

    const hashed = bcrypt.hashSync(password, 10);
    const name = nickname || `用户${phone.slice(-4)}`;
    const { rows: ins } = await db.query(
      'INSERT INTO users (phone, password, nickname) VALUES (?, ?, ?)',
      [phone, hashed, name]
    );
    const { rows } = await db.query(
      'SELECT id, phone, nickname, avatar, role FROM users WHERE id = ?',
      [ins[0]?.insertId || ins[0]?.id]
    );
    const user = rows[0];
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ code: 200, msg: '注册成功', data: { token, user } });
  } catch (err) {
    console.error('/register error:', err.message);
    res.status(500).json({ code: 500, msg: '注册失败，请稍后重试' });
  }
});

// ==================== 密码登录 ====================
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ code: 400, msg: '手机号和密码不能为空' });

  try {
    const { rows } = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
    const user = rows[0];
    if (!user) return res.status(401).json({ code: 401, msg: '手机号未注册' });
    if (!user.password) return res.status(401).json({ code: 401, msg: '该账号未设置密码，请使用验证码登录' });

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
      'SELECT id, phone, nickname, avatar, avatar_image, brand_name, role, daily_limit, auth_code_id, auth_expires_at, created_at FROM users WHERE id = ?',
      [req.userId]
    );
    if (!rows[0]) return res.status(404).json({ code: 404, msg: '用户不存在' });
    const user = rows[0];

    // 返回是否已设置密码（前端用于判断是否显示"设置密码"还是"修改密码"）
    const hasPassword = !!user.password;
    delete user.password;

    const { rows: usageRows } = await db.query(
      'SELECT COUNT(*) AS cnt FROM usage_logs WHERE user_id = ? AND DATE(created_at) = CURRENT_DATE',
      [req.userId]
    );
    const usedToday = parseInt(usageRows[0].cnt);
    const isAdmin = user.role === 'admin';
    const remaining = isAdmin ? 999 : Math.max(0, user.daily_limit - usedToday);
    const dailyLimitOut = isAdmin ? 999 : user.daily_limit;

    res.json({
      code: 200,
      data: { ...user, daily_limit: dailyLimitOut, used_today: usedToday, remaining, has_password: hasPassword }
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

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.userRole !== 'admin') return res.status(403).json({ code: 403, msg: '需要管理员权限' });
    next();
  });
}

module.exports = { router, requireAuth, requireAdmin };
