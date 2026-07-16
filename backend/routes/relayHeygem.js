/**
 * HeyGem 薄中继（PRODUCT-PLAN C2，M2 最小版：固定白名单 token）。
 *
 * 链路：客户端 → 本路由（鉴权+记账）→ frp 隧道（heygem.yyagent.top）→ 家里 GPU。
 * 路径镜像 HeyGem 原生 API——VideoForge 客户端只需把 heygem.baseUrl 换成
 * https://www.yyagent.top/api/relay/heygem、token 换成白名单 token，代码零改动。
 * 客户端只拿白名单 token，真正的 HEYGEM_TOKEN 只存服务器 system_config，
 * 永不下发——换人/踢人只改 relay_whitelist，GPU token 不用轮换。
 *
 * system_config 需要三行（管理员手工 INSERT）：
 *   relay_heygem_url    隧道基址，如 https://heygem.yyagent.top
 *   relay_heygem_token  家里 HeyGem 的 HEYGEM_TOKEN（Bearer 转发用）
 *   relay_whitelist     逗号分隔的客户端 token 白名单，如 tok_friend1,tok_friend2
 *
 * M3 再做：登录态（requireAuth）、排队可视化、每用户每日额度。
 * M2 记账：usage_logs(user_id=0, action='relay_heygem:<token前8位>')。
 */
const express = require('express');
const db = require('../db');
const router = express.Router();

const DAILY_LIMIT_PER_TOKEN = 20; // M2 粗额度：每 token 每日提交数

async function cfg(key) {
  try {
    const { rows } = await db.query('SELECT value FROM system_config WHERE config_key = ?', [key]);
    return (rows?.[0]?.value || '').trim();
  } catch {
    return '';
  }
}

async function checkClientToken(req, res) {
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const token = ((req.headers['x-relay-token'] || bearer) + '').trim();
  if (!token) {
    res.status(401).json({ error: '缺少 token（X-Relay-Token 或 Authorization: Bearer）' });
    return null;
  }
  const whitelist = (await cfg('relay_whitelist')).split(',').map((t) => t.trim()).filter(Boolean);
  if (!whitelist.includes(token)) {
    res.status(403).json({ error: 'token 不在白名单内' });
    return null;
  }
  return token;
}

async function checkQuota(token, res) {
  const action = `relay_heygem:${token.slice(0, 8)}`;
  const { rows } = await db.query(
    'SELECT COUNT(*) AS cnt FROM usage_logs WHERE action = ? AND DATE(created_at) = CURDATE()',
    [action],
  );
  if (parseInt(rows[0].cnt) >= DAILY_LIMIT_PER_TOKEN) {
    res.status(429).json({ error: `今日额度已用完（${DAILY_LIMIT_PER_TOKEN} 次/天），明日再来` });
    return false;
  }
  await db.query('INSERT INTO usage_logs (user_id, action) VALUES (?, ?)', [0, action]);
  return true;
}

async function upstream() {
  const base = await cfg('relay_heygem_url');
  const gpuToken = await cfg('relay_heygem_token');
  if (!base) return null;
  return {
    base: base.replace(/\/$/, ''),
    headers: gpuToken ? { authorization: `Bearer ${gpuToken}` } : {},
  };
}

// 提交生成任务（体积大：base64 音频+视频，受 server.js 的 express.json limit 约束）
router.post('/video/generate', async (req, res) => {
  const token = await checkClientToken(req, res);
  if (!token) return;
  if (!(await checkQuota(token, res))) return;
  const up = await upstream();
  if (!up) return res.status(503).json({ error: '中继未配置（relay_heygem_url）' });
  try {
    const resp = await fetch(`${up.base}/video/generate`, {
      method: 'POST',
      headers: { ...up.headers, 'content-type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(60000),
    });
    res.status(resp.status).json(await resp.json());
  } catch (err) {
    res.status(502).json({ error: `GPU 服务不可达：${err.message}（家里机器可能未开机或隧道未连）` });
  }
});

// 轮询任务状态
router.get('/video/task/:id', async (req, res) => {
  const token = await checkClientToken(req, res);
  if (!token) return;
  const up = await upstream();
  if (!up) return res.status(503).json({ error: '中继未配置' });
  try {
    const resp = await fetch(`${up.base}/video/task/${encodeURIComponent(req.params.id)}`, {
      headers: up.headers,
      signal: AbortSignal.timeout(15000),
    });
    res.status(resp.status).json(await resp.json());
  } catch (err) {
    res.status(502).json({ error: `GPU 服务不可达：${err.message}` });
  }
});

// 下载结果 mp4（流式转发，不落盘）
router.get('/video/file/:id', async (req, res) => {
  const token = await checkClientToken(req, res);
  if (!token) return;
  const up = await upstream();
  if (!up) return res.status(503).json({ error: '中继未配置' });
  try {
    const resp = await fetch(`${up.base}/video/file/${encodeURIComponent(req.params.id)}`, {
      headers: up.headers,
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) return res.status(resp.status).json(await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })));
    res.setHeader('content-type', 'video/mp4');
    const { Readable } = require('stream');
    Readable.fromWeb(resp.body).pipe(res);
  } catch (err) {
    res.status(502).json({ error: `GPU 服务不可达：${err.message}` });
  }
});

// 探活（无需 token：给客户端"远程数字人是否可用"的开关判断）
router.get('/health', async (_req, res) => {
  const up = await upstream();
  if (!up) return res.json({ ok: false, error: '中继未配置' });
  try {
    const resp = await fetch(`${up.base}/health`, { headers: up.headers, signal: AbortSignal.timeout(6000) });
    const data = await resp.json();
    res.json({ ok: resp.ok && data.status === 'ok', ready: Boolean(data.processor_ready) });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
