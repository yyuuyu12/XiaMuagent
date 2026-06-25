const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const router = express.Router();

// 混剪矩阵智能体：通用反向代理，转发到本地 HunjianAgent 服务（frp穿透域名，同 asr_url 填法）
async function getVideomixUrl() {
  const { rows } = await db.query("SELECT value FROM system_config WHERE config_key='videomix_url'");
  return (rows[0]?.value || '').trim();
}

router.all('/*', requireAuth, async (req, res) => proxyToVideomix(req, res));

async function proxyToVideomix(req, res) {
  const base = await getVideomixUrl();
  if (!base) {
    return res.status(503).json({ code: 503, msg: '混剪服务未配置，请联系管理员在后台填写 videomix_url' });
  }

  const targetPath = req.originalUrl.replace(/^\/api\/videomix/, '');
  const target = `${base.replace(/\/$/, '')}${targetPath}`;

  try {
    const init = { method: req.method };
    if (!['GET', 'HEAD'].includes(req.method)) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(req.body || {});
    }
    const resp = await fetch(target, { ...init, signal: AbortSignal.timeout(120000) });
    const buf = Buffer.from(await resp.arrayBuffer());
    res.status(resp.status);
    const ct = resp.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);
    res.send(buf);
  } catch (e) {
    res.status(502).json({ code: 502, msg: `混剪服务连接失败（请确认本地服务和frp隧道已启动）: ${e.message}` });
  }
}

module.exports = router;
